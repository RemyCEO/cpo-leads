"""
CPO Leads — Telegram Channel Auto-Poster
Posts new job listings from Supabase to the CPO Leads Telegram channel.

Setup:
1. Create Telegram channel (public, e.g. @cpoleadsjobs)
2. Add bot as admin with "Post Messages" permission
3. Set CHANNEL_ID below to @cpoleadsjobs (or numeric chat ID)
4. Run: python telegram_channel_bot.py
5. Schedule: pm2 start telegram_channel_bot.py --interpreter python --name cpo-channel-bot

Checks every 30 minutes for new jobs posted since last run.
"""

import requests
import time
import sys
import os
import json
from datetime import datetime, timezone

# --- CONFIG ---
BOT_TOKEN = "8647809461:AAGTsrtOCXyauEo5j74X_Cn6Jq3OeLw0Q8I"

# Private kanal — CPOLEADS.COM
CHANNEL_ID = -1003542781934

SUPABASE_URL = "https://afrcpiheobzauwyftksr.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmcmNwaWhlb2J6YXV3eWZ0a3NyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODE1MzMwNSwiZXhwIjoyMDkzNzI5MzA1fQ.s4pyLPAiFswQ426enQpmWqYYoohrHBTnSUmwrquE3XA"

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(SCRIPT_DIR, "channel_bot_log.txt")
LAST_CHECK_FILE = os.path.join(SCRIPT_DIR, "channel_bot_last_check.txt")

CHECK_INTERVAL = 1800  # 30 minutter

# --- LOGGING ---
def log(msg):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except:
        pass

# --- LAST CHECK TIMESTAMP ---
def get_last_check():
    try:
        with open(LAST_CHECK_FILE, "r") as f:
            return f.read().strip()
    except:
        return None

def save_last_check(ts):
    with open(LAST_CHECK_FILE, "w") as f:
        f.write(ts)

# --- COUNTRY FLAGS ---
COUNTRY_FLAGS = {
    "USA": "🇺🇸", "UK": "🇬🇧", "UAE": "🇦🇪", "Saudi Arabia": "🇸🇦",
    "Qatar": "🇶🇦", "Kuwait": "🇰🇼", "Bahrain": "🇧🇭", "Oman": "🇴🇲",
    "Iraq": "🇮🇶", "Afghanistan": "🇦🇫", "Nigeria": "🇳🇬", "Kenya": "🇰🇪",
    "South Africa": "🇿🇦", "Germany": "🇩🇪", "France": "🇫🇷", "Italy": "🇮🇹",
    "Spain": "🇪🇸", "Australia": "🇦🇺", "Canada": "🇨🇦", "Norway": "🇳🇴",
    "Sweden": "🇸🇪", "Denmark": "🇩🇰", "Netherlands": "🇳🇱", "Belgium": "🇧🇪",
    "Switzerland": "🇨🇭", "Egypt": "🇪🇬", "Jordan": "🇯🇴", "Lebanon": "🇱🇧",
    "Mexico": "🇲🇽", "Brazil": "🇧🇷", "Colombia": "🇨🇴", "India": "🇮🇳",
    "Singapore": "🇸🇬", "Hong Kong": "🇭🇰", "Japan": "🇯🇵", "Israel": "🇮🇱",
    "Global": "🌍", "Remote": "🌐", "Multiple": "🌍",
}

def get_flag(country):
    if not country:
        return "🌍"
    for key, flag in COUNTRY_FLAGS.items():
        if key.lower() in country.lower():
            return flag
    return "🌍"

# --- FORMAT JOB MESSAGE ---
def format_job(job):
    flag = get_flag(job.get("country", ""))
    title = job.get("title", "Unknown Position")
    company = job.get("company", "Unknown")
    location = job.get("location", "")
    country = job.get("country", "")
    salary = job.get("salary", "")
    source = job.get("source", "")
    url = job.get("source_url", "")
    notes = job.get("notes", "")

    # Bygg melding
    lines = []
    lines.append(f"{flag} <b>{title}</b>")
    lines.append(f"🏢 {company}")

    if location and country:
        lines.append(f"📍 {location}, {country}")
    elif location:
        lines.append(f"📍 {location}")
    elif country:
        lines.append(f"📍 {country}")

    if salary:
        lines.append(f"💰 {salary}")

    if notes:
        # Kutt til 200 tegn
        short_notes = notes[:200] + "..." if len(notes) > 200 else notes
        lines.append(f"\n{short_notes}")

    if url:
        lines.append(f"\n🔗 <a href=\"{url}\">Apply / View Details</a>")

    lines.append(f"\n📡 Source: {source}")
    lines.append(f"🌐 More jobs: <a href=\"https://cpoleads.com\">cpoleads.com</a>")

    return "\n".join(lines)

# --- FETCH NEW JOBS FROM SUPABASE ---
def fetch_new_jobs(since_ts):
    """Hent jobber nyere enn since_ts fra Supabase"""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }

    # Hent jobber sortert etter scraped_at, nyere enn sist sjekk
    url = f"{SUPABASE_URL}/rest/v1/job_listings"
    params = {
        "select": "id,title,company,location,country,salary,source,source_url,notes,scraped_at",
        "order": "scraped_at.asc",
        "limit": "50",
    }

    if since_ts:
        params["scraped_at"] = f"gt.{since_ts}"

    try:
        resp = requests.get(url, headers=headers, params=params, timeout=30)
        if resp.status_code == 200:
            return resp.json()
        else:
            log(f"Supabase error: {resp.status_code} — {resp.text[:200]}")
            return []
    except Exception as e:
        log(f"Supabase fetch error: {e}")
        return []

# --- SEND TO TELEGRAM CHANNEL ---
def send_to_channel(text):
    """Send formatert melding til Telegram-kanalen"""
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": CHANNEL_ID,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }

    try:
        resp = requests.post(url, json=payload, timeout=15)
        if resp.status_code == 200:
            return True
        else:
            log(f"Telegram send error: {resp.status_code} — {resp.text[:200]}")
            return False
    except Exception as e:
        log(f"Telegram error: {e}")
        return False

# --- MAIN LOOP ---
def run():
    log("=" * 50)
    log("CPO Leads Channel Bot started")
    log(f"Channel: {CHANNEL_ID}")
    log(f"Check interval: {CHECK_INTERVAL}s ({CHECK_INTERVAL // 60} min)")

    while True:
        try:
            last_check = get_last_check()
            if not last_check:
                # Første kjøring — start fra nå (ikke poster alt historisk)
                now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
                save_last_check(now)
                log(f"First run — starting from {now}")
                time.sleep(CHECK_INTERVAL)
                continue

            raw_jobs = fetch_new_jobs(last_check)

            if raw_jobs:
                # Track latest timestamp from ALL jobs (including filtered) to avoid re-fetching
                latest_ts = last_check
                for j in raw_jobs:
                    jts = j.get("scraped_at", "")
                    if jts > latest_ts:
                        latest_ts = jts

                # Filter: MUST have apply method (URL/email/phone) AND description
                import re
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
                log(f"Found {len(raw_jobs)} new, {len(jobs)} postable (after quality filter)")
                posted = 0

                for job in jobs:
                    msg = format_job(job)
                    if send_to_channel(msg):
                        posted += 1
                        # Oppdater siste timestamp
                        job_ts = job.get("scraped_at", "")
                        if job_ts > latest_ts:
                            latest_ts = job_ts
                        # Rate limit — maks 20 meldinger/minutt i kanaler
                        time.sleep(3)
                    else:
                        log(f"Failed to post: {job.get('title', '?')}")

                if latest_ts > last_check:
                    save_last_check(latest_ts)

                log(f"Posted {posted}/{len(jobs)} jobs to channel")
            else:
                log("No new jobs")

        except Exception as e:
            log(f"Loop error: {e}")

        time.sleep(CHECK_INTERVAL)

if __name__ == "__main__":
    run()
