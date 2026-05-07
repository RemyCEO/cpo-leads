"""
CPO Leads - Bulletproof Daily Job Scraper
Scrapes LinkedIn, Indeed, Silent Professionals, and GulfTalent for EP/CP jobs.
Inserts new listings into Supabase job_listings table.

Run:     python scrape_jobs.py
Schedule: Windows Task Scheduler every 12 hours via run_scraper.bat
Logs:    scrape_log.txt (appended)
"""

import requests
import re
import time
import sys
import os
from datetime import datetime
from html import unescape

# Playwright for sites that block simple requests
_browser = None
_playwright = None

def get_browser_page():
    """Lazy-load Playwright browser (only when needed)"""
    global _browser, _playwright
    if _browser is None:
        try:
            from playwright.sync_api import sync_playwright
            _playwright = sync_playwright().start()
            _browser = _playwright.chromium.launch(headless=True)
            log("  Playwright browser started")
        except Exception as e:
            log(f"  Playwright unavailable: {e}")
            return None
    try:
        ctx = _browser.new_context(user_agent=HEADERS["User-Agent"])
        page = ctx.new_page()
        return page
    except:
        return None

def close_browser():
    global _browser, _playwright
    try:
        if _browser: _browser.close()
        if _playwright: _playwright.stop()
    except:
        pass
    _browser = None
    _playwright = None

def fetch_with_browser(url, wait_selector=None, wait_time=5):
    """Fetch a page using real Chromium browser"""
    page = get_browser_page()
    if not page:
        return None
    try:
        page.goto(url, timeout=30000, wait_until="domcontentloaded")
        if wait_selector:
            try:
                page.wait_for_selector(wait_selector, timeout=10000)
            except:
                pass
        time.sleep(wait_time)
        html = page.content()
        page.close()
        return html
    except Exception as e:
        log(f"  Browser fetch error: {e}")
        try: page.close()
        except: pass
        return None

# --- CONFIG ---
SUPABASE_URL = "https://afrcpiheobzauwyftksr.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmcmNwaWhlb2J6YXV3eWZ0a3NyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODE1MzMwNSwiZXhwIjoyMDkzNzI5MzA1fQ.s4pyLPAiFswQ426enQpmWqYYoohrHBTnSUmwrquE3XA"
LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scrape_log.txt")
MAX_RETRIES = 3
RETRY_DELAY = 5  # seconds

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

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

# --- HTTP WITH RETRY ---
def fetch(url, retries=MAX_RETRIES):
    for attempt in range(1, retries + 1):
        try:
            r = requests.get(url, headers=HEADERS, timeout=20)
            if r.status_code == 200:
                return r.text
            if r.status_code == 429:  # Rate limited
                wait = RETRY_DELAY * attempt * 2
                log(f"  Rate limited (429). Waiting {wait}s...")
                time.sleep(wait)
                continue
            if r.status_code >= 500:
                log(f"  Server error {r.status_code}. Retry {attempt}/{retries}...")
                time.sleep(RETRY_DELAY * attempt)
                continue
            log(f"  HTTP {r.status_code} for {url[:80]}")
            return None
        except requests.exceptions.Timeout:
            log(f"  Timeout. Retry {attempt}/{retries}...")
            time.sleep(RETRY_DELAY * attempt)
        except requests.exceptions.ConnectionError:
            log(f"  Connection error. Retry {attempt}/{retries}...")
            time.sleep(RETRY_DELAY * attempt)
        except Exception as e:
            log(f"  Fetch error: {e}")
            return None
    log(f"  Failed after {retries} retries: {url[:80]}")
    return None

def clean(text):
    """Clean HTML entities and whitespace"""
    if not text:
        return ""
    return unescape(text).strip()

# --- SCRAPERS ---

def scrape_linkedin():
    """Scrape LinkedIn public guest API (no auth required)"""
    jobs = []
    keywords = [
        "%22executive+protection%22",
        "%22close+protection%22",
        "%22bodyguard%22+security",
        "%22protective+operations%22",
        "%22personal+protection%22+officer",
    ]
    for kw in keywords:
        time.sleep(2)  # Be polite
        for start in [0, 25]:  # First 2 pages
            url = f"https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords={kw}&sortBy=DD&start={start}"
            html = fetch(url)
            if not html:
                continue

            # Parse: each job card has title in sr-only span, company in subtitle, location
            titles = [clean(m) for m in re.findall(r'<span class="sr-only">([^<]+)</span>', html)]
            companies = [clean(m) for m in re.findall(r'<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>\s*<a[^>]*>([^<]+)</a>', html)]
            locations = [clean(m) for m in re.findall(r'<span[^>]*class="[^"]*job-search-card__location[^"]*">([^<]+)</span>', html)]
            urls = re.findall(r'href="(https://[^"]*linkedin\.com/jobs/view/\d+)', html)

            count = min(len(titles), len(companies))
            for i in range(count):
                title = titles[i]
                company = companies[i]
                # Skip irrelevant titles
                if not title or not company:
                    continue
                if any(skip in title.lower() for skip in ["data protection", "child protection", "brand protection", "fire protection", "asset protection officer", "loss prevention"]):
                    continue

                jobs.append({
                    "title": title,
                    "company": company,
                    "location": locations[i] if i < len(locations) else "",
                    "source": "LinkedIn",
                    "source_url": urls[i] if i < len(urls) else "",
                    "country": guess_country(locations[i] if i < len(locations) else ""),
                    "salary": "",
                    "notes": "",
                })
            time.sleep(1)
    return jobs

def _parse_indeed_html(html, source="Indeed"):
    """Parse Indeed HTML (shared by US and UK)"""
    jobs = []
    if not html:
        return jobs
    titles = [clean(m) for m in re.findall(r'<span[^>]*id="jobTitle-[^"]*"[^>]*>([^<]+)</span>', html)]
    companies = [clean(m) for m in re.findall(r'<span[^>]*data-testid="company-name"[^>]*>([^<]+)</span>', html)]
    locations = [clean(m) for m in re.findall(r'<div[^>]*data-testid="text-location"[^>]*>([^<]+)</div>', html)]
    salaries = [clean(m) for m in re.findall(r'<div[^>]*class="[^"]*salary-snippet[^"]*"[^>]*>([^<]+)</div>', html)]
    for i in range(len(titles)):
        title = titles[i]
        if any(skip in title.lower() for skip in ["data protection", "child protection", "fire protection", "loss prevention", "brand protection"]):
            continue
        jobs.append({
            "title": title,
            "company": companies[i] if i < len(companies) else "",
            "location": locations[i] if i < len(locations) else "",
            "source": source,
            "source_url": "https://www.indeed.com",
            "country": guess_country(locations[i] if i < len(locations) else ""),
            "salary": salaries[i] if i < len(salaries) else "",
            "notes": "",
        })
    return jobs

def scrape_indeed():
    """Scrape Indeed US — tries HTTP first, falls back to Playwright"""
    jobs = []
    searches = [
        '%22executive+protection%22+OR+%22close+protection%22+OR+%22bodyguard%22',
        '%22protective+operations%22+OR+%22EP+agent%22+OR+%22security+detail%22',
    ]
    for q in searches:
        time.sleep(2)
        url = f'https://www.indeed.com/jobs?q={q}&sort=date&fromage=3'
        # Try HTTP first
        html = fetch(url)
        if html and '<span' in html and 'jobTitle' in html:
            jobs.extend(_parse_indeed_html(html, "Indeed"))
            continue
        # Fallback to Playwright
        log("  Indeed blocked HTTP, trying Playwright...")
        html = fetch_with_browser(url, wait_selector='[data-testid="company-name"]', wait_time=4)
        if html:
            jobs.extend(_parse_indeed_html(html, "Indeed"))
    return jobs

def scrape_indeed_uk():
    """Scrape Indeed UK — tries HTTP first, falls back to Playwright"""
    jobs = []
    time.sleep(2)
    url = 'https://uk.indeed.com/jobs?q=%22close+protection%22+OR+%22executive+protection%22&sort=date&fromage=7'
    html = fetch(url)
    if html and 'jobTitle' in html:
        parsed = _parse_indeed_html(html, "Indeed UK")
        for j in parsed:
            j["country"] = "UK"
        return parsed
    # Fallback to Playwright
    log("  Indeed UK blocked HTTP, trying Playwright...")
    html = fetch_with_browser(url, wait_selector='[data-testid="company-name"]', wait_time=4)
    if html:
        parsed = _parse_indeed_html(html, "Indeed UK")
        for j in parsed:
            j["country"] = "UK"
        return parsed
    return jobs

def scrape_silent_professionals():
    """Scrape Silent Professionals job board"""
    jobs = []
    searches = ["executive+protection", "close+protection", "security"]
    for q in searches:
        time.sleep(2)
        url = f"https://silentprofessionals.org/jobs/?search_keywords={q}"
        html = fetch(url)
        if not html:
            continue

        matches = re.findall(r'<a[^>]*href="(https://silentprofessionals\.org/jobs/[^"]+)"[^>]*>\s*([^<]+)\s*</a>', html)
        skip_words = ["silent", "home", "page", "search", "login", "register", "post", "browse", "jobs"]
        for link, title in matches:
            title = clean(title)
            if title and len(title) > 8 and not any(s in title.lower() for s in skip_words):
                # Try to extract location from the listing page nearby
                loc_match = re.search(re.escape(link) + r'[\s\S]{0,500}?<li[^>]*class="[^"]*location[^"]*"[^>]*>([^<]+)</li>', html)
                location = clean(loc_match.group(1)) if loc_match else ""

                jobs.append({
                    "title": title,
                    "company": "Silent Professionals",
                    "location": location,
                    "source": "Silent Professionals",
                    "source_url": link,
                    "country": guess_country(location),
                    "salary": "",
                    "notes": "",
                })
    return jobs

def scrape_gulftalent():
    """Scrape GulfTalent for CP jobs in Middle East — uses Playwright"""
    jobs = []
    time.sleep(2)
    urls = [
        "https://www.gulftalent.com/jobs/title/close-protection-officer",
        "https://www.gulftalent.com/jobs/title/executive-protection",
        "https://www.gulftalent.com/jobs/title/bodyguard",
    ]
    for url in urls:
        # GulfTalent always blocks HTTP, go straight to Playwright
        log(f"  GulfTalent: fetching with Playwright...")
        html = fetch_with_browser(url, wait_time=5)
        if not html:
            continue

        # Parse job listings - try multiple selectors
        titles = [clean(m) for m in re.findall(r'<a[^>]*class="[^"]*job-title[^"]*"[^>]*>([^<]+)</a>', html)]
        if not titles:
            titles = [clean(m) for m in re.findall(r'<h2[^>]*>\\s*<a[^>]*>([^<]+)</a>', html)]
        if not titles:
            # Broader match
            titles = [clean(m) for m in re.findall(r'class="[^"]*title[^"]*"[^>]*>([^<]{10,})<', html)]

        companies = [clean(m) for m in re.findall(r'<a[^>]*class="[^"]*company[^"]*"[^>]*>([^<]+)</a>', html)]
        locations = [clean(m) for m in re.findall(r'<span[^>]*class="[^"]*location[^"]*"[^>]*>([^<]+)</span>', html)]

        for i in range(len(titles)):
            jobs.append({
                "title": titles[i],
                "company": clean(companies[i]) if i < len(companies) else "",
                "location": clean(locations[i]) if i < len(locations) else "UAE",
                "source": "GulfTalent",
                "source_url": url,
                "country": "UAE",
                "salary": "",
                "notes": "",
            })
        time.sleep(2)
    return jobs

# --- UTILITIES ---

US_STATES = [", al", ", ak", ", az", ", ar", ", ca", ", co", ", ct", ", de", ", fl", ", ga", ", hi", ", id", ", il", ", in", ", ia", ", ks", ", ky", ", la", ", me", ", md", ", ma", ", mi", ", mn", ", ms", ", mo", ", mt", ", ne", ", nv", ", nh", ", nj", ", nm", ", ny", ", nc", ", nd", ", oh", ", ok", ", or", ", pa", ", ri", ", sc", ", sd", ", tn", ", tx", ", ut", ", vt", ", va", ", wa", ", wv", ", wi", ", wy", ", dc"]

def guess_country(location):
    if not location:
        return ""
    loc = location.lower()
    if any(x in loc for x in ["london", "surrey", "uk", "united kingdom", "manchester", "birmingham", "glasgow", "edinburgh", "bristol", "leeds", "liverpool"]):
        return "UK"
    if any(x in loc for x in ["dubai", "uae", "abu dhabi", "qatar", "saudi", "doha", "riyadh", "jeddah", "bahrain", "kuwait", "oman", "muscat"]):
        return "UAE"
    if any(x in loc for x in US_STATES):
        return "USA"
    if any(x in loc for x in ["singapore"]):
        return "Singapore"
    if any(x in loc for x in ["paris", "france"]):
        return "France"
    if any(x in loc for x in ["germany", "berlin", "munich", "frankfurt"]):
        return "Germany"
    if any(x in loc for x in ["brussels", "belgium"]):
        return "Belgium"
    if any(x in loc for x in ["switzerland", "geneva", "zurich"]):
        return "Switzerland"
    return ""

def deduplicate(jobs):
    """Remove duplicates by title+company+source"""
    seen = set()
    unique = []
    for j in jobs:
        key = (j["title"].lower().strip(), j["company"].lower().strip(), j["source"])
        if key not in seen and j["title"]:
            seen.add(key)
            unique.append(j)
    return unique

# --- SUPABASE ---

def insert_to_supabase(jobs):
    """Insert jobs to Supabase with retry, ignoring duplicates"""
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

    inserted = 0
    for i in range(0, len(jobs), 20):
        batch = jobs[i:i+20]
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                r = requests.post(url, headers=headers, json=batch, timeout=15)
                if r.status_code in (200, 201):
                    inserted += len(batch)
                    log(f"  Batch {i//20+1}: {len(batch)} jobs inserted")
                    break
                elif r.status_code == 409:
                    log(f"  Batch {i//20+1}: all duplicates")
                    break
                else:
                    log(f"  Batch {i//20+1} HTTP {r.status_code}: {r.text[:150]}")
                    if attempt < MAX_RETRIES:
                        time.sleep(RETRY_DELAY * attempt)
            except Exception as e:
                log(f"  Batch {i//20+1} error: {e}")
                if attempt < MAX_RETRIES:
                    time.sleep(RETRY_DELAY * attempt)
    return inserted

def get_existing_count():
    """Get current count of jobs in Supabase"""
    try:
        url = f"{SUPABASE_URL}/rest/v1/job_listings?select=count"
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Prefer": "count=exact"
        }
        r = requests.get(url, headers=headers, timeout=10)
        cr = r.headers.get("content-range", "")
        if "/" in cr:
            return int(cr.split("/")[1])
    except:
        pass
    return -1

# --- MAIN ---

def main():
    log("=" * 60)
    log(f"CPO Leads Job Scraper started")
    log("=" * 60)

    before = get_existing_count()
    log(f"Jobs in database before: {before}")

    all_jobs = []
    errors = []

    # LinkedIn
    try:
        log("Scraping LinkedIn...")
        linkedin = scrape_linkedin()
        log(f"  Found {len(linkedin)} jobs")
        all_jobs.extend(linkedin)
    except Exception as e:
        log(f"  LINKEDIN FAILED: {e}")
        errors.append(f"LinkedIn: {e}")

    # Indeed US
    try:
        log("Scraping Indeed US...")
        indeed = scrape_indeed()
        log(f"  Found {len(indeed)} jobs")
        all_jobs.extend(indeed)
    except Exception as e:
        log(f"  INDEED US FAILED: {e}")
        errors.append(f"Indeed US: {e}")

    # Indeed UK
    try:
        log("Scraping Indeed UK...")
        indeed_uk = scrape_indeed_uk()
        log(f"  Found {len(indeed_uk)} jobs")
        all_jobs.extend(indeed_uk)
    except Exception as e:
        log(f"  INDEED UK FAILED: {e}")
        errors.append(f"Indeed UK: {e}")

    # Silent Professionals
    try:
        log("Scraping Silent Professionals...")
        sp = scrape_silent_professionals()
        log(f"  Found {len(sp)} jobs")
        all_jobs.extend(sp)
    except Exception as e:
        log(f"  SILENT PROFESSIONALS FAILED: {e}")
        errors.append(f"Silent Professionals: {e}")

    # GulfTalent
    try:
        log("Scraping GulfTalent...")
        gulf = scrape_gulftalent()
        log(f"  Found {len(gulf)} jobs")
        all_jobs.extend(gulf)
    except Exception as e:
        log(f"  GULFTALENT FAILED: {e}")
        errors.append(f"GulfTalent: {e}")

    # Deduplicate
    unique = deduplicate(all_jobs)
    log(f"Total scraped: {len(all_jobs)} | Unique: {len(unique)}")

    # Insert
    if unique:
        log("Inserting to Supabase...")
        inserted = insert_to_supabase(unique)
    else:
        inserted = 0
        log("Nothing to insert")

    after = get_existing_count()
    new_jobs = max(0, after - before) if before >= 0 and after >= 0 else inserted

    # Summary
    log("-" * 40)
    log(f"SUMMARY:")
    log(f"  Sources scraped: 5")
    log(f"  Total found: {len(all_jobs)}")
    log(f"  Unique: {len(unique)}")
    log(f"  New jobs added: {new_jobs}")
    log(f"  Total in database: {after}")
    if errors:
        log(f"  ERRORS: {len(errors)}")
        for e in errors:
            log(f"    - {e}")
    else:
        log(f"  Errors: 0")
    log("=" * 60)

    # Cleanup
    close_browser()

    return 0 if not errors else 1

if __name__ == "__main__":
    sys.exit(main())
