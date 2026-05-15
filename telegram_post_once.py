"""
CPO Leads — Telegram Channel Poster (run-once for GitHub Actions)
Posts jobs scraped in the last hour. No state needed.
"""
import os
import time
import requests
from datetime import datetime, timezone, timedelta

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://afrcpiheobzauwyftksr.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
CHANNEL_ID = os.environ.get("TELEGRAM_CHANNEL_ID", "-1003542781934")

HEADERS = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}

COUNTRY_FLAGS = {
    "USA": "\U0001f1fa\U0001f1f8", "UK": "\U0001f1ec\U0001f1e7", "UAE": "\U0001f1e6\U0001f1ea",
    "Saudi Arabia": "\U0001f1f8\U0001f1e6", "Qatar": "\U0001f1f6\U0001f1e6", "Iraq": "\U0001f1ee\U0001f1f6",
    "Nigeria": "\U0001f1f3\U0001f1ec", "Kenya": "\U0001f1f0\U0001f1ea", "South Africa": "\U0001f1ff\U0001f1e6",
    "Germany": "\U0001f1e9\U0001f1ea", "France": "\U0001f1eb\U0001f1f7", "Australia": "\U0001f1e6\U0001f1fa",
    "Canada": "\U0001f1e8\U0001f1e6", "Brazil": "\U0001f1e7\U0001f1f7",
}

def get_flag(country):
    if not country: return "\U0001f30d"
    for key, flag in COUNTRY_FLAGS.items():
        if key.lower() in country.lower(): return flag
    return "\U0001f30d"

def format_job(job):
    flag = get_flag(job.get("country", ""))
    lines = [f"{flag} <b>{job.get('title', 'Unknown')}</b>"]
    if job.get("company"): lines.append(f"\U0001f3e2 {job['company']}")
    loc = ", ".join(p for p in [job.get("location", ""), job.get("country", "")] if p)
    if loc: lines.append(f"\U0001f4cd {loc}")
    if job.get("salary"): lines.append(f"\U0001f4b0 {job['salary']}")
    notes = (job.get("notes") or "").replace("Enriched by Scout", "").strip()
    if notes:
        lines.append(f"\n{notes[:200]}{'...' if len(notes) > 200 else ''}")
    if job.get("source_url"):
        lines.append(f'\n\U0001f517 <a href="{job["source_url"]}">Apply / View Details</a>')
    lines.append(f"\n\U0001f4e1 {job.get('source', '?')}")
    lines.append('\U0001f310 <a href="https://cpoleads.com">cpoleads.com</a>')
    return "\n".join(lines)

def main():
    if not SUPABASE_KEY or not BOT_TOKEN:
        print("Missing env vars")
        return

    since = (datetime.now(timezone.utc) - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    print(f"Fetching jobs since {since}")

    r = requests.get(f"{SUPABASE_URL}/rest/v1/job_listings",
        headers=HEADERS,
        params={
            "select": "id,title,company,location,country,salary,source,source_url,notes,scraped_at",
            "order": "scraped_at.asc", "limit": "50",
            "scraped_at": f"gt.{since}"
        }, timeout=30)

    if r.status_code != 200:
        print(f"Supabase error: {r.status_code}")
        return

    import re
    raw_jobs = r.json()
    def has_apply_method(j):
        url = (j.get("source_url") or "").strip()
        notes = (j.get("notes") or "")
        has_url = url.startswith("http")
        has_mailto = url.startswith("mailto:")
        has_email = bool(re.search(r"[\w.-]+@[\w.-]+\.\w+", notes))
        has_phone = bool(re.search(r"[\+]?\d[\d\s\-]{7,}", notes))
        has_desc = len(notes.replace("Enriched by Scout", "").strip()) > 10
        return (has_url or has_mailto or has_email or has_phone) and has_desc
    jobs = [j for j in raw_jobs if has_apply_method(j)]

    print(f"Found {len(raw_jobs)} new, {len(jobs)} postable")

    posted = 0
    for job in jobs:
        try:
            resp = requests.post(f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
                json={"chat_id": CHANNEL_ID, "text": format_job(job), "parse_mode": "HTML", "disable_web_page_preview": True},
                timeout=15)
            if resp.status_code == 200:
                posted += 1
            time.sleep(3)
        except:
            print(f"Failed: {job.get('title', '?')}")

    print(f"Posted {posted}/{len(jobs)} jobs")

if __name__ == "__main__":
    main()
