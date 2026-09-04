#!/usr/bin/env python3
"""
scripts/update_sellers.py

Dual-Feed Daily diff & sync job for Mediavine Ecosystem:
1. Journey by Mediavine (https://sellers.journeymv.com/sellers.json)
2. Mediavine Premier / Core (https://www.mediavine.com/sellers.json)

Generates:
- data/journey_sellers.csv (and docs/journey_sellers.csv)
- data/mediavine_sellers.csv (and docs/mediavine_sellers.csv)
- data/sellers.csv (Unified master with network attribution & graduation detection)
- data/last_run.json (Unified metrics)
"""

import csv
import json
import os
import shutil
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone

JOURNEY_FEED_URL = "https://sellers.journeymv.com/sellers.json"
MEDIAVINE_CORE_FEED_URL = "https://www.mediavine.com/sellers.json"
RAPTIVE_FEED_URL = "https://adthrive.com/sellers.json"
MEDIAVINE_HISTORICAL_URL = "https://raw.githubusercontent.com/Rubayet123/Sellers-Tracker/main/data/sellers-mv.csv"

SINGLE_NETWORK_COLUMNS = [
    "seller_id",
    "domain",
    "name",
    "seller_type",
    "first_seen",
    "last_seen",
    "removed_on",
    "date_source"
]

UNIFIED_COLUMNS = [
    "domain",
    "name",
    "seller_type",
    "network",
    "first_seen",
    "last_seen",
    "removed_on",
    "seller_id",
    "journey_seller_id",
    "mediavine_seller_id",
    "raptive_seller_id",
    "date_source",
    "status_details"
]

def get_today_iso() -> str:
    """Return today's date in YYYY-MM-DD UTC format."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")

def fetch_feed(url: str) -> list:
    """Fetch and parse sellers.json from specified URL."""
    print(f"Fetching {url}...")
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*"
        }
    )
    with urllib.request.urlopen(req, timeout=45) as resp:
        content = resp.read().decode("utf-8")
        data = json.loads(content)
        return data.get("sellers", [])

def load_network_csv(filepath: str) -> dict:
    """Load single-network sellers CSV into a dict keyed by seller_id."""
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
                "domain": str(row.get("domain", "")).strip().lower(),
                "name": str(row.get("name", "")).strip(),
                "seller_type": str(row.get("seller_type", "PUBLISHER")).strip(),
                "first_seen": str(row.get("first_seen", "")).strip(),
                "last_seen": str(row.get("last_seen", "")).strip(),
                "removed_on": str(row.get("removed_on", "")).strip(),
                "date_source": str(row.get("date_source", "tracker")).strip(),
            }
    return sellers

def load_mediavine_historical_seed(filepath: str = "data/sellers-mv.csv") -> tuple:
    """
    Load Mediavine historical baseline dataset (sellers-mv.csv).
    Returns (hist_by_sid, hist_by_dom).
    """
    hist_by_sid = {}
    hist_by_dom = {}

    if not os.path.exists(filepath):
        print(f"Downloading historical Mediavine baseline from {MEDIAVINE_HISTORICAL_URL}...")
        try:
            req = urllib.request.Request(
                MEDIAVINE_HISTORICAL_URL,
                headers={"User-Agent": "Mozilla/5.0"}
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                os.makedirs(os.path.dirname(filepath), exist_ok=True)
                with open(filepath, "wb") as f_out:
                    f_out.write(resp.read())
            print(f"Successfully cached {filepath}")
        except Exception as e:
            print(f"Warning: Could not download historical baseline: {e}")
            return hist_by_sid, hist_by_dom

    try:
        with open(filepath, mode="r", encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                sid = str(row.get("seller", "")).strip()
                dom = str(row.get("domain", "")).strip().lower()
                name = str(row.get("name", "")).strip()
                changed_raw = str(row.get("changed", "")).strip()
                changed_date = changed_raw[:10] if changed_raw else ""
                change_type = str(row.get("change", "")).strip()

                if not changed_date:
                    continue

                item = {
                    "seller_id": sid,
                    "domain": dom,
                    "name": name,
                    "date": changed_date,
                    "change": change_type
                }

                if sid:
                    hist_by_sid[sid] = item
                if dom:
                    # If duplicate domain, keep the earliest date
                    if dom not in hist_by_dom or changed_date < hist_by_dom[dom]["date"]:
                        hist_by_dom[dom] = item

        print(f"Loaded {len(hist_by_sid)} historical Mediavine seller records ({len(hist_by_dom)} unique domains).")
    except Exception as e:
        print(f"Error loading {filepath}: {e}")

    return hist_by_sid, hist_by_dom

def update_single_network(network_name: str, live_raw: list, existing_dict: dict, today: str,
                          historical_by_sid: dict = None, historical_by_dom: dict = None):
    """
    Perform diff on a single network's sellers.
    Enriches records with historical seed dates when available.
    Returns (updated_list, updated_dict, metrics_dict)
    """
    merged = dict(existing_dict)
    live_sids = set()
    new_count = 0
    reactivated_count = 0
    updated_count = 0

    for item in live_raw:
        raw_sid = item.get("seller_id")
        if raw_sid is None:
            continue
        sid = str(raw_sid).strip()
        if not sid:
            continue

        live_sids.add(sid)
        domain = str(item.get("domain", "") or "").strip().lower()
        name = str(item.get("name", "") or "").strip()
        seller_type = str(item.get("seller_type", "PUBLISHER") or "PUBLISHER").strip()

        # Check historical seeds
        seed = None
        if historical_by_sid and sid in historical_by_sid:
            seed = historical_by_sid[sid]
        elif historical_by_dom and domain in historical_by_dom:
            seed = historical_by_dom[domain]

        if sid in merged:
            existing = merged[sid]
            was_removed = bool(existing.get("removed_on"))
            existing["last_seen"] = today
            if domain:
                existing["domain"] = domain
            if name:
                existing["name"] = name
            if seller_type:
                existing["seller_type"] = seller_type

            # Enrich first_seen and date_source from historical seed
            if seed:
                hist_date = seed["date"]
                curr_fs = existing.get("first_seen", "")
                if not curr_fs or curr_fs > hist_date or existing.get("date_source") in ("tracker", ""):
                    existing["first_seen"] = hist_date
                    existing["date_source"] = "mediavine_historical"
                if not existing.get("name") and seed.get("name"):
                    existing["name"] = seed["name"]

            if was_removed:
                existing["removed_on"] = ""
                reactivated_count += 1
            else:
                updated_count += 1
        else:
            # Brand new seller
            fs = today
            ds = "tracker"
            if seed:
                fs = seed["date"]
                ds = "mediavine_historical"
                if not name and seed.get("name"):
                    name = seed["name"]

            merged[sid] = {
                "seller_id": sid,
                "domain": domain,
                "name": name,
                "seller_type": seller_type,
                "first_seen": fs,
                "last_seen": today,
                "removed_on": "",
                "date_source": ds
            }
            new_count += 1

    # In case there are inactive/historical records in existing_dict that can also be enriched
    if historical_by_sid or historical_by_dom:
        for sid, existing in merged.items():
            seed = None
            if historical_by_sid and sid in historical_by_sid:
                seed = historical_by_sid[sid]
            elif historical_by_dom and existing.get("domain") in historical_by_dom:
                seed = historical_by_dom[existing.get("domain")]
            if seed:
                hist_date = seed["date"]
                curr_fs = existing.get("first_seen", "")
                if not curr_fs or curr_fs > hist_date or existing.get("date_source") in ("tracker", ""):
                    existing["first_seen"] = hist_date
                    existing["date_source"] = "mediavine_historical"
                if not existing.get("name") and seed.get("name"):
                    existing["name"] = seed["name"]

    removed_count = 0
    for sid, s in merged.items():
        if s.get("removed_on") == "pre-tracking":
            continue
        if sid not in live_sids:
            if not s.get("removed_on"):
                s["removed_on"] = today
                removed_count += 1

    # Sort
    def sort_key(s):
        fs = s.get("first_seen", "") or "0000-00-00"
        dom = s.get("domain", "") or ""
        return (fs, dom)

    sorted_list = sorted(merged.values(), key=sort_key, reverse=True)
    active_count = sum(1 for s in sorted_list if not s.get("removed_on"))

    metrics = {
        "network": network_name,
        "total_tracked": len(sorted_list),
        "active_sellers": active_count,
        "removed_sellers": len(sorted_list) - active_count,
        "live_feed_count": len(live_raw),
        "new_today": new_count,
        "removed_today": removed_count,
        "reactivated_today": reactivated_count
    }

    return sorted_list, merged, metrics

def build_unified_dataset(journey_dict: dict, mediavine_dict: dict, raptive_dict: dict, today: str):
    """
    Build unified master dataset from Journey, Mediavine Core, and Raptive dictionaries.
    Detects graduations, dual-network active publishers, and cross-network presence.
    """
    # Index by domain for cross-network correlation
    # Note: If multiple seller IDs have the same domain in the same feed, we aggregate them
    j_by_domain = {}
    for sid, s in journey_dict.items():
        dom = s.get("domain", "").strip().lower()
        if not dom:
            continue
        # Prefer active over removed
        if dom not in j_by_domain or (not s.get("removed_on") and j_by_domain[dom].get("removed_on")):
            j_by_domain[dom] = s

    m_by_domain = {}
    for sid, s in mediavine_dict.items():
        dom = s.get("domain", "").strip().lower()
        if not dom:
            continue
        if dom not in m_by_domain or (not s.get("removed_on") and m_by_domain[dom].get("removed_on")):
            m_by_domain[dom] = s

    r_by_domain = {}
    for sid, s in raptive_dict.items():
        dom = s.get("domain", "").strip().lower()
        if not dom:
            continue
        if dom not in r_by_domain or (not s.get("removed_on") and r_by_domain[dom].get("removed_on")):
            r_by_domain[dom] = s

    all_domains = set(j_by_domain.keys()) | set(m_by_domain.keys()) | set(r_by_domain.keys())
    unified_records = []
    graduated_count = 0
    journey_to_raptive_count = 0
    both_count = 0
    raptive_count = 0

    for dom in all_domains:
        j_entry = j_by_domain.get(dom)
        m_entry = m_by_domain.get(dom)
        r_entry = r_by_domain.get(dom)

        j_active = bool(j_entry and not j_entry.get("removed_on"))
        m_active = bool(m_entry and not m_entry.get("removed_on"))
        r_active = bool(r_entry and not r_entry.get("removed_on"))

        # Determine active networks
        active_nets = []
        if j_active:
            active_nets.append("JOURNEY")
        if m_active:
            active_nets.append("MEDIAVINE_CORE")
        if r_active:
            active_nets.append("RAPTIVE")

        network = "JOURNEY"
        status_details = ""

        if len(active_nets) > 1:
            if j_active and m_active and not r_active:
                network = "BOTH"
                both_count += 1
                status_details = "Active in both Journey and Mediavine Premier"
            else:
                network = ",".join(active_nets)
                both_count += 1
                status_details = f"Active across multiple networks ({', '.join(active_nets)})"
        elif m_active:
            network = "MEDIAVINE_CORE"
            # Check if domain was previously on Journey
            # Genuine graduation requires: domain was on Journey, removed from Journey,
            # and Journey first_seen is earlier than or equal to Mediavine Premier join date.
            if j_entry and j_entry.get("removed_on"):
                fs_j = j_entry.get("first_seen", "")
                fs_m = m_entry.get("first_seen", "")
                if not fs_m or not fs_j or fs_j <= fs_m:
                    graduated_count += 1
                    status_details = f"Graduated from Journey to Mediavine Premier (Journey exit: {j_entry.get('removed_on')}, Premier joined: {fs_m or 'verified'})"
                else:
                    status_details = f"Mediavine Premier established publisher (historical Premier since {fs_m})"
            elif r_entry and r_entry.get("removed_on"):
                fs_r = r_entry.get("first_seen", "")
                fs_m = m_entry.get("first_seen", "")
                if not fs_m or not fs_r or fs_r <= fs_m:
                    status_details = f"Migrated from Raptive to Mediavine Premier (Raptive exit: {r_entry.get('removed_on')}, Premier joined: {fs_m or 'verified'})"
            else:
                status_details = f"Mediavine Premier publisher (active since {m_entry.get('first_seen', 'verified')})"
        elif j_active:
            network = "JOURNEY"
            if r_entry and r_entry.get("removed_on"):
                fs_r = r_entry.get("first_seen", "")
                fs_j = j_entry.get("first_seen", "")
                if not fs_j or not fs_r or fs_r <= fs_j:
                    status_details = f"Migrated from Raptive to Journey (Raptive exit: {r_entry.get('removed_on')}, Journey joined: {j_entry.get('first_seen', 'verified')})"
            elif m_entry and m_entry.get("removed_on"):
                fs_m = m_entry.get("first_seen", "")
                fs_j = j_entry.get("first_seen", "")
                if not fs_j or not fs_m or fs_m <= fs_j:
                    status_details = f"Moved from Mediavine Premier to Journey (Mediavine exit: {m_entry.get('removed_on')}, Journey joined: {j_entry.get('first_seen', 'verified')})"
            else:
                status_details = f"Journey by Mediavine publisher (active since {j_entry.get('first_seen', 'verified')})"
        elif r_active:
            network = "RAPTIVE"
            raptive_count += 1
            if j_entry and j_entry.get("removed_on"):
                fs_j = j_entry.get("first_seen", "")
                fs_r = r_entry.get("first_seen", "")
                if not fs_r or not fs_j or fs_j <= fs_r:
                    journey_to_raptive_count += 1
                    status_details = f"Migrated from Journey to Raptive (Journey exit: {j_entry.get('removed_on')}, Raptive joined: {fs_r or 'verified'})"
            elif m_entry and m_entry.get("removed_on"):
                fs_m = m_entry.get("first_seen", "")
                fs_r = r_entry.get("first_seen", "")
                if not fs_r or not fs_m or fs_m <= fs_r:
                    status_details = f"Migrated from Mediavine Premier to Raptive (Mediavine exit: {m_entry.get('removed_on')}, Raptive joined: {fs_r or 'verified'})"
            else:
                status_details = f"Raptive publisher (active since {r_entry.get('first_seen', 'verified')})"
        else:
            # Both/all inactive/removed
            if m_entry and j_entry:
                network = "MEDIAVINE_CORE"
                status_details = "Previously on both networks, currently removed"
            elif m_entry:
                network = "MEDIAVINE_CORE"
                status_details = "Mediavine Premier (currently removed)"
            elif j_entry:
                network = "JOURNEY"
                status_details = "Journey by Mediavine (currently removed)"
            elif r_entry:
                network = "RAPTIVE"
                status_details = "Raptive (currently removed)"
            else:
                network = "JOURNEY"
                status_details = "Currently removed from active feeds"

        # Determine primary metadata
        primary = m_entry if m_active else (j_entry if j_active else (r_entry if r_active else (m_entry or j_entry or r_entry)))
        secondary = j_entry if primary is not j_entry and j_entry else (m_entry if primary is not m_entry and m_entry else r_entry)

        name = primary.get("name") or (secondary.get("name") if secondary else "") or dom
        seller_type = primary.get("seller_type") or (secondary.get("seller_type") if secondary else "PUBLISHER") or "PUBLISHER"
        
        # Earliest first_seen across either network
        fs_j = j_entry.get("first_seen", "") if j_entry else ""
        fs_m = m_entry.get("first_seen", "") if m_entry else ""
        fs_r = r_entry.get("first_seen", "") if r_entry else ""
        valid_fs = [d for d in [fs_j, fs_m, fs_r] if d]
        first_seen = min(valid_fs) if valid_fs else today

        # Latest last_seen
        ls_j = j_entry.get("last_seen", "") if j_entry else ""
        ls_m = m_entry.get("last_seen", "") if m_entry else ""
        ls_r = r_entry.get("last_seen", "") if r_entry else ""
        valid_ls = [d for d in [ls_j, ls_m, ls_r] if d]
        last_seen = max(valid_ls) if valid_ls else today

        # removed_on: only set if NOT active in ANY network
        removed_on = ""
        if not j_active and not m_active and not r_active:
            # Pick removal date
            rem_j = j_entry.get("removed_on", "") if j_entry else ""
            rem_m = m_entry.get("removed_on", "") if m_entry else ""
            rem_r = r_entry.get("removed_on", "") if r_entry else ""
            removed_on = rem_m or rem_j or rem_r or today

        sid_j = j_entry.get("seller_id", "") if j_entry else ""
        sid_m = m_entry.get("seller_id", "") if m_entry else ""
        sid_r = r_entry.get("seller_id", "") if r_entry else ""
        primary_sid = sid_m or sid_j or sid_r

        date_source = primary.get("date_source", "tracker")
        for ent in [j_entry, m_entry, r_entry]:
            if ent and ent.get("date_source") in ("historical_import", "mediavine_historical", "historical_seed"):
                date_source = "historical_import"
                break

        unified_records.append({
            "domain": dom,
            "name": name,
            "seller_type": seller_type,
            "network": network,
            "first_seen": first_seen,
            "last_seen": last_seen,
            "removed_on": removed_on,
            "seller_id": primary_sid,
            "journey_seller_id": sid_j,
            "mediavine_seller_id": sid_m,
            "raptive_seller_id": sid_r,
            "date_source": date_source,
            "status_details": status_details
        })

    # Sort unified records: first_seen desc, domain asc
    def unified_sort_key(s):
        fs = s.get("first_seen", "") or "0000-00-00"
        dom = s.get("domain", "") or ""
        return (fs, dom)

    unified_sorted = sorted(unified_records, key=unified_sort_key, reverse=True)
    return unified_sorted, graduated_count, both_count, raptive_count, journey_to_raptive_count

def write_csv(filepath: str, records: list, columns: list):
    """Write list of dictionaries to CSV file."""
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, mode="w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for r in records:
            writer.writerow(r)

def sync_file_copies(src_path: str, targets: list):
    """Copy a generated file to target paths (e.g. docs/, public/, dist/)."""
    for target in targets:
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.copy2(src_path, target)

def set_github_output(name: str, value: str):
    """Write an output parameter to $GITHUB_OUTPUT if running in GitHub Actions."""
    gh_output_path = os.environ.get("GITHUB_OUTPUT")
    if gh_output_path:
        with open(gh_output_path, "a", encoding="utf-8") as f:
            if "\n" in value:
                f.write(f"{name}<<EOF\n{value}\nEOF\n")
            else:
                f.write(f"{name}={value}\n")

def run_update():
    today = get_today_iso()
    print(f"[{datetime.now(timezone.utc).isoformat()}] Starting Multi-Network Sellers Tracker Sync...")

    # 1. Fetch live feeds
    live_journey = fetch_feed(JOURNEY_FEED_URL)
    live_core = fetch_feed(MEDIAVINE_CORE_FEED_URL)
    live_raptive = fetch_feed(RAPTIVE_FEED_URL)

    # 2. Load existing datasets
    existing_journey = load_network_csv("data/journey_sellers.csv")
    if not existing_journey and os.path.exists("data/sellers.csv"):
        existing_journey = load_network_csv("data/sellers.csv")

    existing_core = load_network_csv("data/mediavine_sellers.csv")
    existing_raptive = load_network_csv("data/raptive_sellers.csv")

    # Load Mediavine historical baseline (sellers-mv.csv)
    mv_hist_by_sid, mv_hist_by_dom = load_mediavine_historical_seed("data/sellers-mv.csv")

    # 3. Update individual networks
    journey_list, journey_dict, journey_metrics = update_single_network("JOURNEY", live_journey, existing_journey, today)
    core_list, core_dict, core_metrics = update_single_network("MEDIAVINE_CORE", live_core, existing_core, today, mv_hist_by_sid, mv_hist_by_dom)
    raptive_list, raptive_dict, raptive_metrics = update_single_network("RAPTIVE", live_raptive, existing_raptive, today)

    # 4. Build unified master dataset
    unified_list, graduated_count, both_count, raptive_count, journey_to_raptive_count = build_unified_dataset(journey_dict, core_dict, raptive_dict, today)
    active_unified = sum(1 for s in unified_list if not s.get("removed_on"))

    # 5. Write CSV files
    write_csv("data/journey_sellers.csv", journey_list, SINGLE_NETWORK_COLUMNS)
    write_csv("data/mediavine_sellers.csv", core_list, SINGLE_NETWORK_COLUMNS)
    write_csv("data/raptive_sellers.csv", raptive_list, SINGLE_NETWORK_COLUMNS)
    write_csv("data/sellers.csv", unified_list, UNIFIED_COLUMNS)

    # Copy files to docs/ and public/ for static deployments
    for fname in ["journey_sellers.csv", "mediavine_sellers.csv", "raptive_sellers.csv", "sellers.csv"]:
        sync_file_copies(f"data/{fname}", [f"docs/{fname}", f"public/{fname}", f"dist/{fname}", f"dist/docs/{fname}"])

    if os.path.exists("data/sellers-mv.csv"):
        sync_file_copies("data/sellers-mv.csv", ["docs/sellers-mv.csv", "public/data/sellers-mv.csv", "dist/data/sellers-mv.csv"])

    # 6. Write comprehensive last_run.json
    metrics = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "date": today,
        "total_tracked_ecosystem": len(unified_list),
        "active_ecosystem": active_unified,
        "graduated_count": graduated_count,
        "journey_to_raptive_count": journey_to_raptive_count,
        "dual_active_count": both_count,
        "raptive_tracked_count": len(raptive_list),
        "journey": journey_metrics,
        "mediavine_core": core_metrics,
        "raptive": raptive_metrics
    }
    
    with open("data/last_run.json", "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)
    sync_file_copies("data/last_run.json", ["docs/last_run.json", "public/data/last_run.json", "dist/data/last_run.json"])

    summary_text = (
        f"Sync Multi-Network Tracker: {len(unified_list)} total domains ({active_unified} active) | "
        f"Journey: {journey_metrics['active_sellers']}/{journey_metrics['total_tracked']} | "
        f"Premier: {core_metrics['active_sellers']}/{core_metrics['total_tracked']} | "
        f"Raptive: {raptive_metrics['active_sellers']}/{raptive_metrics['total_tracked']} | "
        f"Graduated (J→MV): {graduated_count} | Migrated (J→Raptive): {journey_to_raptive_count} | Multi-Network: {both_count}"
    )
    print("\n==================================================")
    print("           ECOSYSTEM SYNC COMPLETE                ")
    print("==================================================")
    print(summary_text)
    print(f"Journey CSV written:       data/journey_sellers.csv ({len(journey_list)} rows)")
    print(f"Mediavine Core CSV written:data/mediavine_sellers.csv ({len(core_list)} rows)")
    print(f"Raptive CSV written:       data/raptive_sellers.csv ({len(raptive_list)} rows)")
    print(f"Unified Master CSV written:data/sellers.csv ({len(unified_list)} rows)")
    print("==================================================\n")

    set_github_output("summary", summary_text)
    has_changed = (journey_metrics["new_today"] > 0 or journey_metrics["removed_today"] > 0 or
                   core_metrics["new_today"] > 0 or core_metrics["removed_today"] > 0 or
                   raptive_metrics["new_today"] > 0 or raptive_metrics["removed_today"] > 0)
    set_github_output("changed", "true" if has_changed else "false")
    set_github_output("total_ecosystem", str(len(unified_list)))
    set_github_output("active_ecosystem", str(active_unified))

    return metrics

if __name__ == "__main__":
    run_update()
