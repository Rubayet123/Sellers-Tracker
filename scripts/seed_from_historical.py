#!/usr/bin/env python3
"""
scripts/seed_from_historical.py

One-time bootstrap script for Mediavine Journey sellers tracker.
Imports historical date-added CSV data, matches against live sellers.json feed,
and initializes data/sellers.csv and docs/sellers.csv.

Usage:
  python scripts/seed_from_historical.py [--force]
"""

import csv
import os
import sys
from datetime import datetime, timezone

# Add project root to sys.path to import update_sellers helpers
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from scripts.update_sellers import (
    fetch_sellers_json,
    write_sellers_csv,
    write_last_run,
    get_today_iso,
    load_sellers_csv,
    CSV_COLUMNS
)

def parse_date(date_str: str) -> str:
    """Parse date from various formats (M/D/YY, MM/DD/YYYY, YYYY-MM-DD) into YYYY-MM-DD."""
    if not date_str:
        return ""
    clean_date = date_str.strip()
    
    # Try standard known formats
    formats = [
        "%m/%d/%y",    # 8/4/24, 08/04/24
        "%m/%d/%Y",    # 08/04/2024, 8/4/2024
        "%Y-%m-%d",    # 2024-08-04
        "%Y/%m/%d",    # 2024/08/04
        "%d/%m/%Y",    # fallback if needed
        "%d-%m-%Y",
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(clean_date, fmt)
            # Two-digit year handling sanity check: if year > 2060, it's 1900s, else 2000s
            if dt.year < 2000 and fmt == "%m/%d/%y":
                dt = dt.replace(year=dt.year + 100)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    
    # If all parsing failed, return original stripped string
    return clean_date

def normalize_domain(domain_str: str) -> str:
    """Clean domain string (lowercase, remove protocol, trailing slash, www optional)."""
    if not domain_str:
        return ""
    d = domain_str.strip().lower()
    if d.startswith("http://"):
        d = d[7:]
    elif d.startswith("https://"):
        d = d[8:]
    d = d.rstrip("/")
    return d

def load_historical_seed(filepath: str) -> dict:
    """
    Load historical_seed.csv.
    Expected columns: Domain, Date Added (case-insensitive headers).
    Returns dict: {normalized_domain: earliest_iso_date}
    """
    if not os.path.exists(filepath):
        print(f"Error: Historical seed file '{filepath}' not found.", file=sys.stderr)
        sys.exit(1)

    domain_dates = {}
    with open(filepath, mode="r", encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f)
        header = next(reader, None)
        if not header:
            print(f"Error: '{filepath}' is empty.", file=sys.stderr)
            sys.exit(1)

        domain_idx = -1
        date_idx = -1
        for i, col in enumerate(header):
            col_clean = col.strip().lower()
            if "domain" in col_clean:
                domain_idx = i
            elif "date" in col_clean:
                date_idx = i

        if domain_idx == -1 or date_idx == -1:
            # Fallback to column 0, column 1
            domain_idx, date_idx = 0, 1

        for row in reader:
            if len(row) <= max(domain_idx, date_idx):
                continue
            raw_domain = row[domain_idx]
            raw_date = row[date_idx]

            norm_domain = normalize_domain(raw_domain)
            iso_date = parse_date(raw_date)

            if not norm_domain or not iso_date:
                continue

            if norm_domain in domain_dates:
                # Keep earliest date
                if iso_date < domain_dates[norm_domain]:
                    domain_dates[norm_domain] = iso_date
            else:
                domain_dates[norm_domain] = iso_date

    return domain_dates

def seed_database(
    seed_csv_path="data/historical_seed.csv",
    data_csv_path="data/sellers.csv",
    docs_csv_path="docs/sellers.csv",
    last_run_path="data/last_run.json",
    force=False
):
    # Safety Check: Refuse to run if data/sellers.csv exists and has data rows
    if os.path.exists(data_csv_path) and not force:
        existing = load_sellers_csv(data_csv_path)
        if len(existing) > 0:
            print(
                f"ERROR: '{data_csv_path}' already contains {len(existing)} records.\n"
                f"seed_from_historical.py is a one-time bootstrap script and will not overwrite tracking history.\n"
                f"Pass --force if you deliberately want to re-seed.",
                file=sys.stderr
            )
            sys.exit(1)

    print(f"Loading historical seed from {seed_csv_path}...")
    historical_dates = load_historical_seed(seed_csv_path)
    print(f"Loaded {len(historical_dates)} unique historical domain entries.")

    print("Fetching live sellers.json feed...")
    feed_data = fetch_sellers_json()
    live_sellers_raw = feed_data.get("sellers", [])
    print(f"Live feed contains {len(live_sellers_raw)} seller records.")

    today = get_today_iso()
    sellers = {}
    seen_domains_live = set()

    matched_count = 0
    fallback_count = 0

    # 1. Process Live Sellers
    for item in live_sellers_raw:
        raw_sid = item.get("seller_id")
        if raw_sid is None:
            continue
        sid = str(raw_sid).strip()
        if not sid:
            continue

        raw_domain = str(item.get("domain", "") or "").strip()
        norm_domain = normalize_domain(raw_domain)
        name = str(item.get("name", "") or "").strip()
        seller_type = str(item.get("seller_type", "PUBLISHER") or "PUBLISHER").strip()

        if norm_domain:
            seen_domains_live.add(norm_domain)

        if norm_domain and norm_domain in historical_dates:
            first_seen = historical_dates[norm_domain]
            date_source = "historical_import"
            matched_count += 1
        else:
            first_seen = today
            date_source = "tracker_seed"
            fallback_count += 1

        sellers[sid] = {
            "seller_id": sid,
            "domain": norm_domain,
            "name": name,
            "seller_type": seller_type,
            "first_seen": first_seen,
            "last_seen": today,
            "removed_on": "",
            "date_source": date_source
        }

    # 2. Process Domains in Historical File NOT in Live Feed (Churned before tracking started)
    legacy_count = 0
    for hist_domain, hist_date in historical_dates.items():
        if hist_domain not in seen_domains_live:
            legacy_sid = f"legacy:{hist_domain}"
            sellers[legacy_sid] = {
                "seller_id": legacy_sid,
                "domain": hist_domain,
                "name": hist_domain,
                "seller_type": "PUBLISHER",
                "first_seen": hist_date,
                "last_seen": hist_date,
                "removed_on": "pre-tracking",
                "date_source": "historical_import"
            }
            legacy_count += 1

    # Sort merged results: first_seen descending, then domain ascending
    def sort_key(s):
        fs = s.get("first_seen", "") or "0000-00-00"
        dom = s.get("domain", "") or ""
        return (fs, dom)

    sorted_sellers = sorted(sellers.values(), key=sort_key, reverse=True)

    # Save to data/sellers.csv and docs/sellers.csv
    write_sellers_csv(data_csv_path, sorted_sellers)
    write_sellers_csv(docs_csv_path, sorted_sellers)

    total_count = len(sorted_sellers)
    active_count = sum(1 for s in sorted_sellers if not s.get("removed_on"))

    metrics = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "date": today,
        "total_tracked": total_count,
        "active_sellers": active_count,
        "removed_sellers": total_count - active_count,
        "live_feed_count": len(live_sellers_raw),
        "new_today": 0,
        "removed_today": 0,
        "reactivated_today": 0,
        "historical_matches": matched_count,
        "tracker_seeds": fallback_count,
        "legacy_pre_tracking": legacy_count,
        "bootstrap": True
    }
    write_last_run(last_run_path, metrics)

    print("\n==================================================")
    print("           SEED BOOTSTRAP COMPLETE                ")
    print("==================================================")
    print(f"Total domains tracked:       {total_count}")
    print(f"Currently active sellers:    {active_count}")
    print(f"Matched historical dates:    {matched_count}")
    print(f"Fell back to today (new):    {fallback_count}")
    print(f"Legacy pre-tracking domains: {legacy_count}")
    print(f"Master CSV written to:       {data_csv_path}")
    print(f"Pages CSV written to:        {docs_csv_path}")
    print(f"Metrics saved to:            {last_run_path}")
    print("==================================================\n")

if __name__ == "__main__":
    force_flag = "--force" in sys.argv
    seed_database(force=force_flag)
