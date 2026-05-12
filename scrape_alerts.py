"""
CPO Leads — Google Alerts RSS Scraper
Fetches Google Alerts RSS feeds for CP/EP keywords and inserts new job leads to Supabase.
Also scrapes Google News RSS for hiring announcements.

Setup: Create Google Alerts at https://www.google.com/alerts with these searches:
  - "close protection" hiring
  - "executive protection" job
  - "bodyguard" vacancy
  - "protective services" contract
  - "EP agent" hiring
  - "CPO" security job
Set delivery to RSS feed. Copy the RSS URLs below.

Run:     python scrape_alerts.py
Schedule: Windows Task Scheduler every 12 hours (08:00 + 20:00)
Logs:    scrape_alerts_log.txt
"""

import requests
import re
import time
import sys
import os
from datetime import datetime
from html import unescape
import xml.etree.ElementTree as ET

# --- CONFIG ---
SUPABASE_URL = "https://afrcpiheobzauwyftksr.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmcmNwaWhlb2J6YXV3eWZ0a3NyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODE1MzMwNSwiZXhwIjoyMDkzNzI5MzA1fQ.s4pyLPAiFswQ426enQpmWqYYoohrHBTnSUmwrquE3XA"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(SCRIPT_DIR, "scrape_alerts_log.txt")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
}

# Google Alerts RSS feeds — add your alert RSS URLs here
# To create: go to https://www.google.com/alerts → create alert → set "Deliver to: RSS feed" → copy URL
GOOGLE_ALERTS_RSS = [
    # These are Google News RSS searches (work without creating alerts)
    "https://news.google.com/rss/search?q=%22close+protection%22+hiring&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=%22executive+protection%22+job+OR+hiring&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=%22bodyguard%22+security+job+OR+vacancy&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=%22protective+services%22+contract+OR+hiring&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=%22close+protection+officer%22+OR+%22CPO%22+vacancy&hl=en-GB&gl=GB&ceid=GB:en",
    "https://news.google.com/rss/search?q=%22executive+protection%22+agent+OR+specialist+hiring&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=%22VIP+protection%22+job+OR+career&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=%22security+detail%22+hiring+OR+recruiting&hl=en-US&gl=US&ceid=US:en",
]

# Additional: niche RSS feeds from security industry sites
NICHE_RSS = [
    # SecurityInfoWatch
    "https://www.securityinfowatch.com/rss",
    # ASIS International news
    "https://www.asisonline.org/rss/",
]

# CP/EP keywords for filtering
CP_KEYWORDS = [
    "close protection", "executive protection", "bodyguard", "protective services",
    "ep agent", "ep specialist", "cpo", "psd", "protective intelligence",
    "vip protection", "security driver", "protective operations",
    "security detail", "protection officer", "protection agent",
    "personal protection", "residential security", "travel security",
    "armed security", "security specialist", "threat assessment",
]

EXCLUDE_KEYWORDS = [
    "data protection", "child protection", "brand protection", "fire protection",
    "asset protection officer", "loss prevention", "cyber security",
    "information security", "network security", "endpoint protection",
    "environmental protection", "consumer protection", "plant protection",
    "intellectual property", "gdpr", "privacy policy",
]

# --- LOGGING ---
def log(msg):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{timestamp}] {msg}"
    print(line)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except:
        pass

def clean(text):
    if not text:
        return ""
    text = unescape(text)
    text = re.sub(r'<[^>]+>', '', text)  # Strip HTML tags
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def classify_job_type(title, company="", notes=""):
    text = f"{title} {company} {notes}".lower()
    if any(k in text for k in ["maritime", "vessel", "ship", "offshore", "anti-piracy", "seafarer"]):
        return "maritime"
    if any(k in text for k in ["psd", "hostile", "conflict zone", "war zone", "armed escort", "hostile environment"]):
        return "psd"
    if any(k in text for k in ["pmc", "private military", "contractor", "defense contractor", "military contractor"]):
        return "pmc"
    if any(k in text for k in ["uhnw", "hnw", "family office", "private client", "private estate", "principal protection", "celebrity", "vip protect"]):
        return "uhnw"
    if any(k in text for k in ["corporate", "tech company", "corporate security", "corporate ep", "fortune 500"]):
        return "corporate"
    if any(k in text for k in ["static", "residential", "estate security", "site security", "gatehouse", "concierge security"]):
        return "static"
    if any(k in text for k in ["government", "embassy", "diplomatic", "federal", "dod", "state department", "un security", "nato"]):
        return "government"
    if any(k in text for k in ["close protection", "executive protection", "bodyguard", "protection officer", "cpo", "ep agent", "ep specialist", "personal protection"]):
        return "cpo"
    return "security"

def is_cp_relevant(text):
    """Check if text is CP/EP related"""
    lower = text.lower()
    if any(ex in lower for ex in EXCLUDE_KEYWORDS):
        return False
    return any(kw in lower for kw in CP_KEYWORDS)

def guess_country(text):
    loc = text.lower()
    countries = {
        "UK": ["london", "uk", "united kingdom", "manchester", "birmingham", "scotland", "england"],
        "USA": ["washington", "new york", "los angeles", "california", "texas", "florida", "virginia", "usa", "united states"],
        "UAE": ["dubai", "abu dhabi", "uae", "emirates"],
        "Saudi Arabia": ["riyadh", "jeddah", "saudi", "neom"],
        "Qatar": ["doha", "qatar"],
        "Singapore": ["singapore"],
        "France": ["paris", "france"],
        "Germany": ["berlin", "munich", "germany"],
        "South Africa": ["johannesburg", "cape town", "south africa", "pretoria"],
        "Iraq": ["baghdad", "erbil", "iraq"],
        "Nigeria": ["lagos", "nigeria"],
        "Kenya": ["nairobi", "kenya"],
    }
    for country, markers in countries.items():
        if any(m in loc for m in markers):
            return country
    return ""

def extract_location(text):
    """Try to extract location from text"""
    patterns = [
        r'(?:in|based in|location[:\s])\s+([A-Z][a-z]+(?:\s*,\s*[A-Z][a-z]+)?)',
        r'(Dubai|London|New York|Washington|Abu Dhabi|Riyadh|Qatar|Singapore|UAE|UK|USA)',
    ]
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return ""


def fetch_rss(url):
    """Fetch and parse an RSS feed, return list of entries"""
    try:
        r = requests.get(url, headers=HEADERS, timeout=20)
        if r.status_code != 200:
            log(f"  HTTP {r.status_code} for {url[:80]}")
            return []

        # Parse XML
        root = ET.fromstring(r.content)
        entries = []

        # Handle both RSS 2.0 and Atom feeds
        # RSS 2.0: channel/item
        for item in root.findall('.//item'):
            title = item.findtext('title', '')
            link = item.findtext('link', '')
            description = item.findtext('description', '')
            pub_date = item.findtext('pubDate', '')
            source_el = item.find('source')
            source_name = source_el.text if source_el is not None else ''

            entries.append({
                'title': clean(title),
                'link': link,
                'description': clean(description),
                'pub_date': pub_date,
                'source_name': clean(source_name),
            })

        # Atom: entry
        ns = {'atom': 'http://www.w3.org/2005/Atom'}
        for entry in root.findall('.//atom:entry', ns):
            title = entry.findtext('atom:title', '', ns)
            link_el = entry.find('atom:link', ns)
            link = link_el.get('href', '') if link_el is not None else ''
            content = entry.findtext('atom:content', '', ns)
            published = entry.findtext('atom:published', entry.findtext('atom:updated', '', ns), ns)

            entries.append({
                'title': clean(title),
                'link': link,
                'description': clean(content),
                'pub_date': published,
                'source_name': '',
            })

        return entries
    except ET.ParseError as e:
        log(f"  XML parse error: {e}")
        return []
    except Exception as e:
        log(f"  RSS fetch error: {e}")
        return []


def process_alerts():
    """Process all Google Alerts RSS feeds"""
    log("Processing Google Alerts RSS feeds...")
    jobs = []

    for i, rss_url in enumerate(GOOGLE_ALERTS_RSS):
        time.sleep(1)
        entries = fetch_rss(rss_url)
        if not entries:
            continue

        log(f"  Feed {i+1}: {len(entries)} entries")

        for entry in entries:
            title = entry['title']
            desc = entry['description']
            combined = f"{title} {desc}"

            if not is_cp_relevant(combined):
                continue

            # Extract useful info
            location = extract_location(combined)
            country = guess_country(combined)

            # Try to extract company from source or title
            company = entry.get('source_name', '')
            if not company:
                # Try to extract from title format "Title - Company"
                if ' - ' in title:
                    parts = title.rsplit(' - ', 1)
                    if len(parts[1]) < 50:
                        company = parts[1]

            jobs.append({
                "title": title[:150],
                "company": company[:100] if company else "Google Alert",
                "location": location,
                "source": "Google Alerts",
                "source_url": entry['link'],
                "country": country,
                "salary": "",
                "notes": desc[:250] if desc else "",
            })

    log(f"  Google Alerts total: {len(jobs)} relevant entries")
    return jobs


def process_niche_rss():
    """Process niche security industry RSS feeds"""
    log("Processing niche security RSS feeds...")
    jobs = []

    for rss_url in NICHE_RSS:
        time.sleep(1)
        entries = fetch_rss(rss_url)
        if not entries:
            continue

        for entry in entries:
            combined = f"{entry['title']} {entry['description']}"
            if not is_cp_relevant(combined):
                continue

            # Only include if it looks like a job/hiring announcement
            hiring_words = ["hiring", "job", "position", "vacancy", "recruit", "career", "apply", "seeking", "contract", "role"]
            if not any(hw in combined.lower() for hw in hiring_words):
                continue

            location = extract_location(combined)

            jobs.append({
                "title": entry['title'][:150],
                "company": entry.get('source_name', 'Security News')[:100],
                "location": location,
                "source": "Industry RSS",
                "source_url": entry['link'],
                "country": guess_country(combined),
                "salary": "",
                "notes": entry['description'][:250],
            })

    log(f"  Niche RSS total: {len(jobs)} relevant entries")
    return jobs


def deduplicate(jobs):
    seen = set()
    unique = []
    for j in jobs:
        key = (j["title"].lower().strip()[:60], j["source"])
        if key not in seen and j["title"]:
            seen.add(key)
            unique.append(j)
    return unique


def insert_to_supabase(jobs):
    if not jobs:
        log("No jobs to insert")
        return 0

    url = f"{SUPABASE_URL}/rest/v1/job_listings"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=ignore-duplicates,return=minimal"
    }

    # Strip type field until column exists in Supabase
    for j in jobs:
        j.pop("type", None)

    inserted = 0
    for i in range(0, len(jobs), 20):
        batch = jobs[i:i+20]
        try:
            r = requests.post(url, headers=headers, json=batch, timeout=15)
            if r.status_code in (200, 201):
                inserted += len(batch)
                log(f"  Batch {i//20+1}: {len(batch)} jobs inserted")
            elif r.status_code == 409:
                log(f"  Batch {i//20+1}: all duplicates")
            else:
                log(f"  Batch {i//20+1} HTTP {r.status_code}: {r.text[:150]}")
        except Exception as e:
            log(f"  Batch {i//20+1} error: {e}")
    return inserted


def get_existing_count():
    try:
        url = f"{SUPABASE_URL}/rest/v1/job_listings?select=id&limit=1"
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Prefer": "count=exact"
        }
        r = requests.get(url, headers=headers, timeout=10)
        count = r.headers.get("content-range", "").split("/")[-1]
        return int(count) if count and count != "*" else -1
    except:
        return -1


# --- TELEGRAM ---
TELEGRAM_BOT_TOKEN = "8647809461:AAGTsrtOCXyauEo5j74X_Cn6Jq3OeLw0Q8I"
TELEGRAM_CHAT_ID = "8790783341"

def send_telegram(text):
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        requests.post(url, json={"chat_id": TELEGRAM_CHAT_ID, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True}, timeout=10)
    except:
        pass

def notify_telegram_jobs(jobs, total_new, total_db):
    if not jobs or total_new == 0:
        send_telegram(f"📡 CPO Leads alerts — 0 nye. Database: {total_db}")
        return
    send_telegram(f"🟢 <b>CPO Leads (alerts) — {total_new} nye jobber</b>\n\n📊 Totalt: {total_db}")
    for j in jobs[:10]:
        msg = f"💼 <b>{j.get('title','')}</b>"
        if j.get('company'): msg += f"\n🏢 {j['company']}"
        if j.get('location'): msg += f"\n📍 {j['location']}"
        if j.get('source_url'): msg += f"\n🔗 <a href=\"{j['source_url']}\">Link</a>"
        send_telegram(msg)
        time.sleep(0.5)
    if len(jobs) > 10:
        send_telegram(f"... og {len(jobs) - 10} flere. cpoleads.com 🔥")


def main():
    log("=" * 60)
    log("CPO LEADS — GOOGLE ALERTS & RSS SCRAPER")
    log("=" * 60)

    before = get_existing_count()
    log(f"Jobs in database before: {before}")

    all_jobs = []

    # Google Alerts RSS
    try:
        all_jobs.extend(process_alerts())
    except Exception as e:
        log(f"GOOGLE ALERTS FAILED: {e}")

    # Niche RSS
    try:
        all_jobs.extend(process_niche_rss())
    except Exception as e:
        log(f"NICHE RSS FAILED: {e}")

    # Deduplicate & insert
    unique = deduplicate(all_jobs)
    log(f"Total found: {len(all_jobs)} | Unique: {len(unique)}")

    if unique:
        log("Inserting to Supabase...")
        inserted = insert_to_supabase(unique)
    else:
        inserted = 0
        log("Nothing to insert")

    after = get_existing_count()
    new_jobs = max(0, after - before) if before >= 0 and after >= 0 else inserted

    log("-" * 40)
    log("SUMMARY:")
    log(f"  RSS feeds checked: {len(GOOGLE_ALERTS_RSS) + len(NICHE_RSS)}")
    log(f"  Relevant entries: {len(all_jobs)}")
    log(f"  Unique: {len(unique)}")
    log(f"  New jobs added: {new_jobs}")
    log(f"  Total in database: {after}")
    log("=" * 60)

    # Notify Telegram
    if new_jobs > 0:
        log("Sending to Telegram...")
        notify_telegram_jobs(unique[:new_jobs], new_jobs, after)
    else:
        notify_telegram_jobs([], 0, after)


if __name__ == "__main__":
    main()
