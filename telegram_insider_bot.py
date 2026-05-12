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
BOT_TOKEN = "8710333843:AAEQhCUtdYF7nmWIzb7fTJ3I_kJUCsB3aTs"
REMY_CHAT_ID = 8790783341
CHANNEL_ID = -1003542781934  # CPOLEADS.COM channel — auto-post parsed jobs here

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

def clean_title(title):
    """Strip LinkedIn share junk from titles"""
    if not title:
        return title
    # Remove "share NNNN XXXX" at end (LinkedIn share IDs)
    title = re.sub(r'\s+share\s+\d{5,}.*$', '', title, flags=re.IGNORECASE)
    # Remove standalone long numbers (tracking IDs)
    title = re.sub(r'\b\d{8,}\b', '', title)
    # Remove random 4-char codes (fJoq, bUsx, xBEy, zIJV etc)
    title = re.sub(r'\s+[a-zA-Z]{4}$', '', title)
    # Remove "job opportunity" prefix
    title = re.sub(r'^job\s+opportunity\s+', '', title, flags=re.IGNORECASE)
    # Split camelCase/hashtag-style words (executiveprotection → Executive Protection)
    title = re.sub(r'([a-z])([A-Z])', r'\1 \2', title)
    # Split concatenated lowercase words using known keywords
    known = ['executive','protection','close','bodyguard','security','jobs','manager',
             'communications','specialist','officer','analyst','intelligence','maritime',
             'residential','corporate','driver','instructor','consultant','director']
    for kw in known:
        title = re.sub(r'(?i)' + kw, lambda m: m.group().capitalize(), title)
    # Remove leftover hashtag-style concatenated words with no spaces
    # e.g. "securityjobs" → "Security Jobs"
    for kw in known:
        title = re.sub(r'(?i)(\w)(' + kw + r')', r'\1 \2', title)
    # Remove generic filler words when alone
    title = re.sub(r'\b(?:comms?|jobs?)\b', '', title, flags=re.IGNORECASE)
    # Clean whitespace
    title = re.sub(r'\s+', ' ', title).strip()
    # Title case each word that is fully lowercase
    words = title.split()
    acronyms = {'sia','cpo','psd','ep','uae','uk','usa','vip','uhnw','pmc','dod','nato'}
    words = [w.upper() if w.lower() in acronyms else (w.title() if w == w.lower() else w) for w in words]
    title = ' '.join(words)
    return title

def extract_job_info(text):
    """Parse a forwarded message into structured job data"""
    lines = text.strip().split('\n')
    title = ""
    company = ""
    location = ""
    salary = ""
    source_url = ""

    # Broad title keywords — CP, intel, security, logistics, medical
    title_keywords = [
        "close protection", "executive protection", "bodyguard", "cpo", "ep ",
        "security", "protection officer", "team leader", "ops manager", "psd",
        "intelligence", "analyst", "coordinator", "supervisor", "consultant",
        "advisor", "operator", "driver", "medic", "paramedic", "investigator",
        "instructor", "trainer", "escort", "guard", "warden", "logistic",
        "risk", "compliance", "surveillance", "counter", "threat", "director",
        "manager", "specialist", "officer", "agent",
    ]

    # Extract title — first substantial line or line with job keywords
    for line in lines:
        line = line.strip()
        if not line or len(line) < 5:
            continue
        line_lower = line.lower()
        if any(kw in line_lower for kw in title_keywords):
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

    # LinkedIn URL detection — extract info from URL path
    source = "INSIDER SOURCE"
    for url in urls:
        if 'linkedin.com' in url:
            source = "LinkedIn"
            # Try to extract readable name from URL path
            path_match = re.search(r'linkedin\.com/(?:posts|jobs/view)/([^/?]+)', url)
            if path_match:
                slug = path_match.group(1).replace('-', ' ').replace('_', ' ')
                # Clean up encoded chars
                slug = re.sub(r'%[0-9A-Fa-f]{2}', ' ', slug)
                slug = re.sub(r'\s+', ' ', slug).strip()
                if slug and len(slug) > 5:
                    title = slug[:120]
            if not title:
                title = f"LinkedIn — {url.split('/')[-1][:60]}"
            break
        if 'indeed.com' in url:
            source = "Indeed"
            break

    # If message is just a URL with minimal text, make title unique
    if not title and source_url:
        title = f"Job post — {source_url[-50:]}"
    if not title:
        title = f"Insider Job — {datetime.now().strftime('%Y-%m-%d %H:%M')}"

    # Clean title — strip LinkedIn share junk
    title = clean_title(title)

    # Guess country
    country = guess_country(location or text)

    return {
        "title": title or "Insider Job Post",
        "company": company or "Insider Source",
        "location": location,
        "source": source,
        "source_url": source_url,
        "country": country,
        "salary": salary,
        "notes": text.strip(),
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
        "Prefer": "return=representation"
    }
    try:
        r = requests.post(url, headers=headers, json=job, timeout=15)
        if r.status_code in (200, 201):
            return True
        log(f"  Supabase insert {r.status_code}: {r.text[:200]}")
        return False
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
    if not text or len(text) < 10:
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

    # Accept all messages from Remy — he only sends job posts here
    from_id = msg.get("from", {}).get("id", 0)
    if from_id != REMY_CHAT_ID:
        # For others: require CP keywords or forwarded content
        is_forwarded = msg.get("forward_date") is not None or msg.get("forward_origin") is not None
        if not is_job_post(text) and not is_forwarded:
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

COUNTRY_FLAGS = {
    "USA": "🇺🇸", "UK": "🇬🇧", "UAE": "🇦🇪", "Saudi Arabia": "🇸🇦",
    "Qatar": "🇶🇦", "Iraq": "🇮🇶", "Nigeria": "🇳🇬", "Kenya": "🇰🇪",
    "South Africa": "🇿🇦", "Germany": "🇩🇪", "France": "🇫🇷",
    "Australia": "🇦🇺", "Canada": "🇨🇦", "Kuwait": "🇰🇼",
}

def post_to_channel(job):
    """Format and post job to CPOLEADS.COM Telegram channel"""
    flag = "🌍"
    for key, f in COUNTRY_FLAGS.items():
        if key.lower() in (job.get("country","") or job.get("location","")).lower():
            flag = f
            break

    lines = [f'{flag} <b>{job["title"][:100]}</b>']
    if job.get("company"):
        lines.append(f'🏢 {job["company"]}')
    loc = job.get("location","")
    country = job.get("country","")
    if loc and country:
        lines.append(f'📍 {loc}, {country}')
    elif loc or country:
        lines.append(f'📍 {loc or country}')
    if job.get("salary"):
        lines.append(f'💰 {job["salary"]}')
    if job.get("source_url"):
        lines.append(f'\n🔗 <a href="{job["source_url"]}">Apply / View Details</a>')
    lines.append(f'\n📡 Source: INSIDER')
    lines.append(f'🌐 More jobs: <a href="https://cpoleads.com">cpoleads.com</a>')

    text = "\n".join(lines)
    try:
        requests.post(f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage", json={
            "chat_id": CHANNEL_ID,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }, timeout=10)
        log(f"  Posted to channel: {job['title'][:50]}")
    except Exception as e:
        log(f"  Channel post error: {e}")

def main():
    log("=" * 60)
    log("CPO LEADS — INSIDER TELEGRAM BOT STARTED")
    log("=" * 60)

    offset = get_offset()
    log(f"Starting from offset: {offset}")
    jobs_added = 0
    poll_count = 0
    errors_in_row = 0

    while True:
        try:
            updates = get_updates(offset)
            poll_count += 1
            errors_in_row = 0  # Reset on successful poll

            # Heartbeat every 60 polls (~30 min)
            if poll_count % 60 == 0:
                log(f"Heartbeat: {poll_count} polls, {jobs_added} jobs added, offset={offset}")

            for update in updates:
                offset = update["update_id"] + 1
                save_offset(offset)

                try:
                    # Handle both direct messages and channel posts
                    msg = update.get("message") or update.get("channel_post")
                    if not msg:
                        continue

                    text_preview = (msg.get("text","") or msg.get("caption",""))[:80]
                    from_id = msg.get("from",{}).get("id",0)
                    log(f"  MSG from={from_id} len={len(msg.get('text','')or msg.get('caption',''))} text={text_preview}")

                    result = process_message(msg)
                    if not result:
                        log(f"  Skipped: not a job post")
                        continue

                    job, chat_id = result

                    # Insert to Supabase
                    success = insert_to_supabase(job)
                    if success:
                        jobs_added += 1
                        log(f"INSIDER JOB ADDED: {job['title'][:60]} | {job['company']} | {job['location']}")
                        send_telegram(chat_id,
                            f"✅ Added to CPO Leads DB:\n"
                            f"<b>{job['title'][:80]}</b>\n"
                            f"Company: {job['company']}\n"
                            f"Location: {job['location'] or 'TBD'}\n"
                            f"Source: INSIDER\n"
                            f"Total added this session: {jobs_added}")
                        # Also post to CPOLEADS.COM channel
                        post_to_channel(job)
                    else:
                        send_telegram(chat_id, "⚠️ Duplicate or error — not added.")

                except Exception as e:
                    log(f"  Error processing update {update.get('update_id')}: {e}")
                    continue

        except KeyboardInterrupt:
            log(f"Bot stopped. Jobs added this session: {jobs_added}")
            break
        except Exception as e:
            errors_in_row += 1
            log(f"Poll error ({errors_in_row}): {e}")
            if errors_in_row > 10:
                log("Too many errors in a row — restarting in 60s")
                time.sleep(60)
                errors_in_row = 0
            else:
                time.sleep(5)


if __name__ == "__main__":
    main()
