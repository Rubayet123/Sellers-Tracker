#!/usr/bin/env python3
"""
scripts/update_sellers.py

Daily diff job for Mediavine Journey sellers.json tracker.
Uses Python 3 standard library only.

Workflow:
1. Fetch live sellers.json (default: https://sellers.journeymv.com/sellers.json, overridable by SELLERS_JSON_URL)
2. Load existing data/sellers.csv (if exists) keyed by seller_id
3. Compute diff:
   - New seller_id: first_seen = today, last_seen = today, removed_on = "", date_source = "tracker"
   - Existing seller_id: keep first_seen and date_source unchanged, last_seen = today, clear removed_on
   - Removed seller_id: if absent from feed and removed_on is empty, set removed_on = today
4. Write merged results to data/sellers.csv and docs/sellers.csv (sorted first_seen desc, domain asc)
5. Write data/last_run.json
6. Output summary and changed status to GitHub Actions environment ($GITHUB_OUTPUT)
"""

import csv
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone

DEFAULT_FEED_URL = "https://sellers.journeymv.com/sellers.json"
CSV_COLUMNS = [
    "seller_id",
    "domain",
    "name",
    "seller_type",
    "first_seen",
    "last_seen",
    "removed_on",
    "date_source"
]

def get_today_iso() -> str:
    """Return today's date in YYYY-MM-DD UTC format."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")

def fetch_sellers_json(url: str = None) -> dict:
    """Fetch and parse sellers.json from specified URL or environment variable."""
    feed_url = url or os.environ.get("SELLERS_JSON_URL") or DEFAULT_FEED_URL
    req = urllib.request.Request(
        feed_url,
        headers={
            "User-Agent": "JourneySellersTracker/1.0 (+https://github.com)",
            "Accept": "application/json, text/plain, */*"
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            content = resp.read().decode("utf-8")
            data = json.loads(content)
            return data
    except Exception as e:
        print(f"Error fetching sellers.json from {feed_url}: {e}", file=sys.stderr)
        raise

def load_sellers_csv(filepath: str) -> dict:
    """Load existing sellers.csv into a dictionary keyed by seller_id."""
    sellers = {}
    if not os.path.exists(filepath):
        return sellers

    with open(filepath, mode="r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            sid = str(row.get("seller_id", "")).strip()
            if not sid:
                continue
            sellers[sid] = {
                "seller_id": sid,
                "domain": str(row.get("domain", "")).strip(),
                "name": str(row.get("name", "")).strip(),
                "seller_type": str(row.get("seller_type", "PUBLISHER")).strip(),
                "first_seen": str(row.get("first_seen", "")).strip(),
                "last_seen": str(row.get("last_seen", "")).strip(),
                "removed_on": str(row.get("removed_on", "")).strip(),
                "date_source": str(row.get("date_source", "tracker")).strip(),
            }
    return sellers

def write_sellers_csv(filepath: str, sellers: list):
    """Write list of seller dictionaries to CSV file."""
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, mode="w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        for s in sellers:
            writer.writerow(s)

def write_last_run(filepath: str, metrics: dict):
    """Write run metadata metrics to JSON file."""
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, mode="w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)

def set_github_output(name: str, value: str):
    """Write an output parameter to $GITHUB_OUTPUT if running in GitHub Actions."""
    gh_output_path = os.environ.get("GITHUB_OUTPUT")
    if gh_output_path:
        with open(gh_output_path, "a", encoding="utf-8") as f:
            if "\n" in value:
                f.write(f"{name}<<EOF\n{value}\nEOF\n")
            else:
                f.write(f"{name}={value}\n")

def run_update(data_csv_path="data/sellers.csv", docs_csv_path="docs/sellers.csv", last_run_path="data/last_run.json"):
    today = get_today_iso()
    print(f"[{datetime.now(timezone.utc).isoformat()}] Fetching sellers feed...")
    feed_data = fetch_sellers_json()
    live_sellers_raw = feed_data.get("sellers", [])
    print(f"Live feed contains {len(live_sellers_raw)} sellers.")

    old_sellers = load_sellers_csv(data_csv_path)
    print(f"Existing tracking dataset has {len(old_sellers)} records.")

    live_seller_ids = set()
    new_count = 0
    reactivated_count = 0
    updated_count = 0

    merged_sellers = dict(old_sellers)

    for item in live_sellers_raw:
        # Ignore non-seller entries if any
        raw_sid = item.get("seller_id")
        if raw_sid is None:
            continue
        sid = str(raw_sid).strip()
        if not sid:
            continue
        
        live_seller_ids.add(sid)
        domain = str(item.get("domain", "") or "").strip().lower()
        name = str(item.get("name", "") or "").strip()
        seller_type = str(item.get("seller_type", "PUBLISHER") or "PUBLISHER").strip()

        if sid in merged_sellers:
            existing = merged_sellers[sid]
            was_removed = bool(existing.get("removed_on"))
            
            existing["last_seen"] = today
            if domain:
                existing["domain"] = domain
            if name:
                existing["name"] = name
            if seller_type:
                existing["seller_type"] = seller_type

            if was_removed:
                existing["removed_on"] = ""
                reactivated_count += 1
            else:
                updated_count += 1
        else:
            # New seller in live feed
            merged_sellers[sid] = {
                "seller_id": sid,
                "domain": domain,
                "name": name,
                "seller_type": seller_type,
                "first_seen": today,
                "last_seen": today,
                "removed_on": "",
                "date_source": "tracker"
            }
            new_count += 1

    removed_today_count = 0
    for sid, seller in merged_sellers.items():
        # Do not alter synthetic legacy items that are already marked pre-tracking
        if seller.get("removed_on") == "pre-tracking":
            continue
        if sid not in live_seller_ids:
            if not seller.get("removed_on"):
                seller["removed_on"] = today
                removed_today_count += 1

    # Sort merged results: first_seen descending, then domain ascending
    def sort_key(s):
        fs = s.get("first_seen", "") or "0000-00-00"
        dom = s.get("domain", "") or ""
        return (fs, dom)

    sorted_sellers = sorted(merged_sellers.values(), key=sort_key, reverse=True)

    # Save to data/sellers.csv and docs/sellers.csv
    write_sellers_csv(data_csv_path, sorted_sellers)
    write_sellers_csv(docs_csv_path, sorted_sellers)

    total_sellers = len(sorted_sellers)
    active_sellers = sum(1 for s in sorted_sellers if not s.get("removed_on"))
    total_removed = total_sellers - active_sellers

    has_changed = (new_count > 0 or removed_today_count > 0 or reactivated_count > 0 or len(old_sellers) == 0)

    metrics = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "date": today,
        "total_tracked": total_sellers,
        "active_sellers": active_sellers,
        "removed_sellers": total_removed,
        "live_feed_count": len(live_sellers_raw),
        "new_today": new_count,
        "removed_today": removed_today_count,
        "reactivated_today": reactivated_count,
        "changed": has_changed
    }
    write_last_run(last_run_path, metrics)

    summary_text = (
        f"Sync sellers.json: {total_sellers} total ({active_sellers} active), "
        f"+{new_count} new, -{removed_today_count} removed, ~{reactivated_count} reactivated"
    )
    print(summary_text)

    set_github_output("summary", summary_text)
    set_github_output("changed", "true" if has_changed else "false")
    set_github_output("new_count", str(new_count))
    set_github_output("removed_count", str(removed_today_count))
    set_github_output("total_active", str(active_sellers))

    return metrics

if __name__ == "__main__":
    run_update()
