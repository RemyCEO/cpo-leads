"""
CPO Leads — Telegram Channel Poster (run-once for GitHub Actions)
Posts new job listings since last run. State stored in Supabase kv table.
"""
import os
import requests
from datetime import datetime, timezone

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://afrcpiheobzauwyftksr.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
CHANNEL_ID = os.environ.get("TELEGRAM_CHANNEL_ID", "-1003542781934")

HEADERS = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json"}

COUNTRY_FLAGS = {
    "USA": "🇺🇸", "UK": "🇬🇧", "UAE": "🇦🇪", "Saudi Arabia": "🇸🇦",
    "Qatar": "🇶🇦", "Iraq": "🇮🇶", "Nigeria": "🇳🇬", "Kenya": "🇰🇪",
    "South Africa": "🇿🇦", "Germany": "🇩🇪", "France": "🇫🇷", "Australia": "🇦🇺",
    "Canada": "🇨🇦", "Brazil": "🇧🇷", "India": "🇮🇳", "Singapore": "🇸🇬",
}

def get_flag(country):
    if not country: return "🌍"
    for key, flag in COUNTRY_FLAGS.items():
        if key.lower() in country.lower():
            return flag
    return "🌍"

def get_last_check():
    """Get last check timestamp from Supabase kv (or fallback to 1 hour ago)"""
    try:
        r = requests.get(f"{SUPABASE_URL}/rest/v1/kv_store?key=eq.telegram_last_check&select=value",
                         headers=HEADERS, timeout=10)
        if r.status_code == 200 and r.json():
            return r.json()[0]["value"]
    except:
        pass
    # Default: 1 hour ago
    from datetime import timedelta
    return (datetime.now(timezone.utc) - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")

def save_last_check(ts):
    """Upsert last check timestamp to Supabase kv"""
    try:
        requests.post(f"{SUPABASE_URL}/rest/v1/kv_store",
                      headers={**HEADERS, "Prefer": "resolution=merge-duplicates"},
                      json={"key": "telegram_last_check", "value": ts}, timeout=10)
    except:
        pass

def fetch_new_jobs(since_ts):
    params = {
        "select": "id,title,company,location,country,salary,source,source_url,notes,scraped_at",
        "order": "scraped_at.asc",
        "limit": "50",
        "scraped_at": f"gt.{since_ts}",
    }
    try:
        r = requests.get(f"{SUPABASE_URL}/rest/v1/job_listings", headers=HEADERS, params=params, timeout=30)
        return r.json() if r.status_code == 200 else []
    except:
        return []

def format_job(job):
    flag = get_flag(job.get("country", ""))
    lines = [f"{flag} <b>{job.get('title', 'Unknown')}</b>"]
    if job.get("company"): lines.append(f"🏢 {job['company']}")
    loc_parts = [job.get("location", ""), job.get("country", "")]
    loc = ", ".join(p for p in loc_parts if p)
    if loc: lines.append(f"📍 {loc}")
    if job.get("salary"): lines.append(f"💰 {job['salary']}")
    notes = (job.get("notes") or "").replace("Enriched by Scout", "").strip()
    if notes:
        short = notes[:200] + "..." if len(notes) > 200 else notes
        lines.append(f"\n{short}")
    if job.get("source_url"):
        lines.append(f'\n🔗 <a href="{job["source_url"]}">Apply / View Details</a>')
    lines.append(f"\n📡 {job.get('source', '?')}")
    lines.append('🌐 <a href="https://cpoleads.com">cpoleads.com</a>')
    return "\n".join(lines)

def send_to_channel(text):
    try:
        r = requests.post(f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
                          json={"chat_id": CHANNEL_ID, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True},
                          timeout=15)
        return r.status_code == 200
    except:
        return False

def main():
    if not SUPABASE_KEY or not BOT_TOKEN:
        print("Missing SUPABASE_KEY or TELEGRAM_BOT_TOKEN")
        return

    last_check = get_last_check()
    print(f"Last check: {last_check}")

    raw_jobs = fetch_new_jobs(last_check)
    if not raw_jobs:
        print("No new jobs")
        return

    # Track latest timestamp from ALL jobs
    latest_ts = last_check
    for j in raw_jobs:
        jts = j.get("scraped_at", "")
        if jts > latest_ts:
            latest_ts = jts

    # Quality filter: skip jobs without URL or description
    jobs = [j for j in raw_jobs if j.get("source_url") and j["source_url"].strip()
            and j.get("notes") and j["notes"].replace("Enriched by Scout", "").strip()]

    print(f"Found {len(raw_jobs)} new, {len(jobs)} postable")

    posted = 0
    for job in jobs:
        if send_to_channel(format_job(job)):
            posted += 1
            import time; time.sleep(3)
        else:
            print(f"Failed: {job.get('title', '?')}")

    # Always save latest timestamp
    save_last_check(latest_ts)
    print(f"Posted {posted}/{len(jobs)} jobs")

if __name__ == "__main__":
    main()
