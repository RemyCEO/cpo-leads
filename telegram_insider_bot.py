"""
CPO Leads — Telegram Insider Job Bot
Remy forwards FB group job posts to a private Telegram channel/chat.
This bot listens, parses the text, extracts job info, and inserts to Supabase
with source="INSIDER SOURCE".

Setup:
1. Create a new Telegram bot via @BotFather (or reuse existing)
2. Create a private Telegram channel for insider jobs
3. Add the bot as admin of that channel
4. Forward FB group posts to the channel
5. Bot auto-parses and inserts to CPO Leads database

Run: python telegram_insider_bot.py
Keep running: pm2 start telegram_insider_bot.py --interpreter python --name cpo-insider-bot
"""

import requests
import re
import time
import sys
import os
import json
from datetime import datetime

# --- CONFIG ---
# Uses same bot as telegram-calendar (or create a dedicated one)
BOT_TOKEN = "8647809461:AAGTsrtOCXyauEo5j74X_Cn6Jq3OeLw0Q8I"
REMY_CHAT_ID = 8790783341

SUPABASE_URL = "https://afrcpiheobzauwyftksr.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmcmNwaWhlb2J6YXV3eWZ0a3NyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODE1MzMwNSwiZXhwIjoyMDkzNzI5MzA1fQ.s4pyLPAiFswQ426enQpmWqYYoohrHBTnSUmwrquE3XA"

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(SCRIPT_DIR, "insider_bot_log.txt")
OFFSET_FILE = os.path.join(SCRIPT_DIR, "insider_bot_offset.txt")

# CP/EP keywords
CP_KEYWORDS = [
    "close protection", "executive protection", "bodyguard", "protective services",
    "ep agent", "ep specialist", "cpo", "psd", "vip protection",
    "security driver", "protective operations", "security detail",
    "protection officer", "personal protection", "residential security",
    "travel security", "armed security", "security specialist",
    "cp team", "ep team", "security manager", "security director",
    "threat assessment", "advance team", "maritime security",
    "cp officer", "ep officer", "protection detail", "psd team",
    # Common in FB group posts
    "rotation", "deployment", "task", "contract", "position available",
    "hiring", "looking for", "send cv", "send your cv", "immediate start",
    "day rate", "apply", "vacancy", "operatives needed", "operators needed",
    "requirement", "urgent requirement", "team leader", "ops manager",
]

EXCLUDE_KEYWORDS = [
    "data protection", "child protection", "fire protection", "gdpr",
    "training course", "sia course", "first aid course",
]

def log(msg):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{timestamp}] {msg}"
    print(line)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except:
        pass

def get_offset():
    try:
        with open(OFFSET_FILE, "r") as f:
            return int(f.read().strip())
    except:
        return 0

def save_offset(offset):
    with open(OFFSET_FILE, "w") as f:
        f.write(str(offset))

def is_job_post(text):
    """Check if text looks like a CP/EP job posting"""
    lower = text.lower()
    if any(ex in lower for ex in EXCLUDE_KEYWORDS):
        return False
    return any(kw in lower for kw in CP_KEYWORDS)

def extract_job_info(text):
    """Parse a forwarded message into structured job data"""
    lines = text.strip().split('\n')
    title = ""
    company = ""
    location = ""
    salary = ""
    source_url = ""

    # Extract title — first substantial line or line with job keywords
    for line in lines:
        line = line.strip()
        if not line or len(line) < 5:
            continue
        line_lower = line.lower()
        # Look for title-like lines
        if any(kw in line_lower for kw in ["close protection", "executive protection", "bodyguard",
                                            "cpo", "ep ", "security", "protection officer",
                                            "team leader", "ops manager", "psd"]):
            title = line[:120]
            break
    if not title:
        # Use first substantial line
        for line in lines:
            line = line.strip()
            if line and len(line) > 10 and not line.startswith('http'):
                title = line[:120]
                break

    # Extract company
    company_patterns = [
        r'(?:company|client|employer|firm|provider)[:\s]+([^\n]{3,60})',
        r'(?:for|with|at)\s+([A-Z][A-Za-z\s&\-]+(?:Ltd|Group|Security|International|Global|Services))',
        r'^([A-Z][A-Za-z\s&\-]+(?:Security|Group|International|Global|Services|Protection))\s*$',
    ]
    for pat in company_patterns:
        m = re.search(pat, text, re.IGNORECASE | re.MULTILINE)
        if m:
            company = m.group(1).strip()[:80]
            break

    # Extract location
    location_patterns = [
        r'(?:location|based in|based|area|region|country|deployment)[:\s]+([^\n]{3,60})',
        r'(?:in|to)\s+(Iraq|Dubai|London|UAE|Saudi|Qatar|Kuwait|Bahrain|Nigeria|Kenya|Afghanistan|Libya|Syria|Somalia|Yemen|Jordan|Egypt)',
        r'(UK|USA|UAE|Middle East|Africa|Asia|Europe|Gulf|GCC)\b',
    ]
    for pat in location_patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            location = m.group(1).strip()[:60]
            break

    # Extract salary/rate
    salary_patterns = [
        r'(?:rate|salary|pay|compensation|day rate|daily rate)[:\s]*([£$€]\s*[\d,]+(?:\s*[-/]\s*[£$€]?\s*[\d,]+)?(?:\s*(?:per day|pd|p/d|per month|pm|per annum|pa))?)',
        r'([£$€]\s*[\d,]+\s*(?:per day|pd|p/d|daily|per month|pm|per annum|pa))',
        r'(\d{2,4}\s*(?:USD|GBP|EUR)\s*(?:per day|daily|pd))',
    ]
    for pat in salary_patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            salary = m.group(1).strip()
            break

    # Extract URLs
    urls = re.findall(r'https?://[^\s<>"\')\]]+', text)
    if urls:
        source_url = urls[0].rstrip('.')

    # Guess country
    country = guess_country(location or text)

    return {
        "title": title or "Insider Job Post",
        "company": company or "Insider Source",
        "location": location,
        "source": "INSIDER SOURCE",
        "source_url": source_url,
        "country": country,
        "salary": salary,
        "notes": text[:300],
    }

def guess_country(text):
    loc = text.lower()
    countries = {
        "UK": ["london", "uk", "united kingdom", "manchester", "birmingham", "england"],
        "USA": ["usa", "united states", "washington", "new york", "california"],
        "UAE": ["dubai", "abu dhabi", "uae", "emirates"],
        "Saudi Arabia": ["riyadh", "jeddah", "saudi", "ksa", "neom"],
        "Qatar": ["doha", "qatar"],
        "Iraq": ["baghdad", "erbil", "basrah", "iraq"],
        "Kuwait": ["kuwait"],
        "Bahrain": ["bahrain"],
        "Nigeria": ["lagos", "abuja", "nigeria"],
        "Kenya": ["nairobi", "kenya"],
        "Libya": ["libya", "tripoli"],
        "Afghanistan": ["kabul", "afghanistan"],
        "Somalia": ["mogadishu", "somalia"],
        "France": ["paris", "france"],
        "Germany": ["berlin", "munich", "germany"],
        "South Africa": ["johannesburg", "cape town", "south africa"],
    }
    for country, markers in countries.items():
        if any(m in loc for m in markers):
            return country
    return ""

def insert_to_supabase(job):
    """Insert a single job to Supabase"""
    url = f"{SUPABASE_URL}/rest/v1/job_listings"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=ignore-duplicates,return=minimal"
    }
    try:
        r = requests.post(url, headers=headers, json=[job], timeout=15)
        return r.status_code in (200, 201)
    except Exception as e:
        log(f"  Supabase error: {e}")
        return False

def send_telegram(chat_id, text):
    """Send a message via Telegram"""
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    try:
        requests.post(url, json={
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
        }, timeout=10)
    except:
        pass

def get_updates(offset=0):
    """Get new Telegram updates"""
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/getUpdates"
    params = {"offset": offset, "timeout": 30, "allowed_updates": ["message", "channel_post"]}
    try:
        r = requests.get(url, params=params, timeout=35)
        if r.status_code == 200:
            return r.json().get("result", [])
    except Exception as e:
        log(f"Telegram error: {e}")
    return []

def process_message(msg):
    """Process a single Telegram message"""
    text = msg.get("text", "") or msg.get("caption", "")
    if not text or len(text) < 20:
        return None

    chat_id = msg.get("chat", {}).get("id", 0)

    # Check if it's a command
    if text.startswith("/"):
        if text.strip() == "/start":
            send_telegram(chat_id, "CPO Insider Bot active.\n\nForward FB group job posts here.\nI'll parse and add them to the CPO Leads database.\n\nCommands:\n/status — Check bot status\n/count — Jobs in database")
            return None
        if text.strip() == "/status":
            send_telegram(chat_id, "Bot is running. Forward job posts to add them.")
            return None
        if text.strip() == "/count":
            count = get_db_count()
            send_telegram(chat_id, f"Jobs in database: {count}")
            return None
        return None

    # Check if it's a job post
    if not is_job_post(text):
        # If sent by Remy, accept anything forwarded
        from_id = msg.get("from", {}).get("id", 0)
        is_forwarded = msg.get("forward_date") is not None or msg.get("forward_origin") is not None
        if from_id != REMY_CHAT_ID and not is_forwarded:
            return None
        # Even non-keyword messages from Remy that are forwarded = treat as insider intel
        if not is_forwarded:
            return None

    # Parse job info
    job = extract_job_info(text)

    # Add forwarded-from info if available
    forward_from = msg.get("forward_from_chat", {}).get("title", "")
    if not forward_from:
        forward_from = msg.get("forward_sender_name", "")
    if forward_from:
        job["notes"] = f"Forwarded from: {forward_from}\n{job['notes']}"[:300]
        if not job["company"] or job["company"] == "Insider Source":
            job["company"] = f"via {forward_from}"

    return job, chat_id

def get_db_count():
    try:
        url = f"{SUPABASE_URL}/rest/v1/job_listings?select=id&limit=1"
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Prefer": "count=exact"
        }
        r = requests.get(url, headers=headers, timeout=10)
        count = r.headers.get("content-range", "").split("/")[-1]
        return int(count) if count and count != "*" else "?"
    except:
        return "?"

def main():
    log("=" * 60)
    log("CPO LEADS — INSIDER TELEGRAM BOT STARTED")
    log("=" * 60)

    offset = get_offset()
    log(f"Starting from offset: {offset}")
    jobs_added = 0

    while True:
        try:
            updates = get_updates(offset)

            for update in updates:
                offset = update["update_id"] + 1
                save_offset(offset)

                # Handle both direct messages and channel posts
                msg = update.get("message") or update.get("channel_post")
                if not msg:
                    continue

                result = process_message(msg)
                if not result:
                    continue

                job, chat_id = result

                # Insert to Supabase
                success = insert_to_supabase(job)
                if success:
                    jobs_added += 1
                    log(f"INSIDER JOB ADDED: {job['title'][:60]} | {job['company']} | {job['location']}")
                    send_telegram(chat_id,
                        f"Added to CPO Leads DB:\n"
                        f"<b>{job['title'][:80]}</b>\n"
                        f"Company: {job['company']}\n"
                        f"Location: {job['location'] or 'TBD'}\n"
                        f"Source: INSIDER\n"
                        f"Total added this session: {jobs_added}")
                else:
                    send_telegram(chat_id, "Duplicate or error — not added.")

        except KeyboardInterrupt:
            log(f"Bot stopped. Jobs added this session: {jobs_added}")
            break
        except Exception as e:
            log(f"Error: {e}")
            time.sleep(5)


if __name__ == "__main__":
    main()
