"""
CPO Leads - Bulletproof Daily Job Scraper
Scrapes LinkedIn, Indeed, Silent Professionals, GulfTalent, Glassdoor UK, Recruit.net ZA, and Reed for EP/CP jobs.
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

# --- JOB TYPE CLASSIFIER ---
def classify_job_type(title, company="", notes=""):
    """Auto-classify job into CP/EP categories based on keywords"""
    text = f"{title} {company} {notes}".lower()
    # Order matters — more specific first
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
    title_matches = re.findall(r'<span[^>]*id="jobTitle-([^"]*)"[^>]*>([^<]+)</span>', html)
    job_ids = [m[0] for m in title_matches]
    titles = [clean(m[1]) for m in title_matches]
    companies = [clean(m) for m in re.findall(r'<span[^>]*data-testid="company-name"[^>]*>([^<]+)</span>', html)]
    locations = [clean(m) for m in re.findall(r'<div[^>]*data-testid="text-location"[^>]*>([^<]+)</div>', html)]
    salaries = [clean(m) for m in re.findall(r'<div[^>]*class="[^"]*salary-snippet[^"]*"[^>]*>([^<]+)</div>', html)]
    base = "https://www.indeed.com" if source == "Indeed" else "https://uk.indeed.com"
    for i in range(len(titles)):
        title = titles[i]
        if any(skip in title.lower() for skip in ["data protection", "child protection", "fire protection", "loss prevention", "brand protection"]):
            continue
        jid = job_ids[i] if i < len(job_ids) else ""
        job_url = f"{base}/viewjob?jk={jid}" if jid else base
        jobs.append({
            "title": title,
            "company": companies[i] if i < len(companies) else "",
            "location": locations[i] if i < len(locations) else "",
            "source": source,
            "source_url": job_url,
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

def scrape_linkedin_company_posts():
    """Scrape LinkedIn company pages that regularly post CP/EP jobs (uses Playwright)"""
    jobs = []
    pages = [
        ("ODIN Security Consulting", "https://www.linkedin.com/company/odin-security-consulting-osc-worldwide/posts/"),
        ("M.S Security Group", "https://www.linkedin.com/company/m-s-security-group/posts/"),
    ]
    for company_name, url in pages:
        log(f"  Scraping {company_name} LinkedIn page...")
        html = fetch_with_browser(url, wait_time=6)
        if not html:
            continue
        # Extract post text blocks
        import re as _re
        posts = _re.findall(r'<span[^>]*dir="ltr"[^>]*>([\s\S]*?)</span>', html)
        if not posts:
            posts = _re.findall(r'class="[^"]*feed-shared-text[^"]*"[^>]*>([\s\S]*?)</div>', html)
        for post_text in posts:
            text = _re.sub(r'<[^>]+>', '', post_text).strip()
            if len(text) < 30:
                continue
            text_lower = text.lower()
            # Must be job-related
            if not any(kw in text_lower for kw in ["hiring", "looking for", "position", "apply", "send your cv", "required", "recruiting", "vacancy", "we are seeking"]):
                continue
            if any(skip in text_lower for skip in ["data protection", "gdpr", "training course only"]):
                continue
            # Extract title
            title = ""
            for pat in [r'^([A-Z][A-Z\s&\-–/]+)(?:\n|$)', r'(?:hiring|position|role)[:\s]*([^\n]{10,60})', r'^([^\n]{10,80})']:
                m = _re.search(pat, text)
                if m:
                    title = m.group(1).strip()
                    if len(title) > 10:
                        break
            if not title or len(title) < 5:
                continue
            # Extract location
            location = ""
            for pat in [r'(?:Location|Based in|Location:)\s*([^\n]{3,40})', r'(Iraq|Dubai|London|UAE|Saudi|Qatar|Remote|USA|UK|France|Germany|Africa)']:
                m = _re.search(pat, text, _re.IGNORECASE)
                if m:
                    location = m.group(1).strip()
                    break
            # Extract apply link
            apply_url = ""
            urls = _re.findall(r'https?://[^\s<>"\')\]]+', text)
            for u in urls:
                apply_url = u.rstrip('.')
                break
            jobs.append({
                "title": title[:300],
                "company": company_name,
                "location": location,
                "source": "LinkedIn Company Page",
                "source_url": apply_url or url,
                "country": guess_country(location),
                "salary": "",
                "notes": text[:500],
            })
        time.sleep(3)
    # Deduplicate
    seen = set()
    unique = []
    for j in jobs:
        key = j["title"].lower()[:30]
        if key not in seen:
            seen.add(key)
            unique.append(j)
    return unique

def scrape_linkedin_posts():
    """
    Scrape LinkedIn POSTS (not job listings) where people announce CP/EP work.
    Uses Google search to find public LinkedIn posts mentioning hiring/positions.
    This catches recruiters posting in groups and on their profiles.
    """
    jobs = []
    queries = [
        'site:linkedin.com/posts "close protection" ("hiring" OR "looking for" OR "position" OR "contract" OR "available" OR "seeking")',
        'site:linkedin.com/posts "executive protection" ("hiring" OR "opportunity" OR "role" OR "position available")',
        'site:linkedin.com/posts "CPO" "bodyguard" ("hiring" OR "immediate" OR "contract" OR "rotation")',
        'site:linkedin.com/feed "close protection" "hiring"',
        'site:linkedin.com/groups "executive protection" ("vacancy" OR "hiring" OR "looking for")',
    ]

    for query in queries:
        time.sleep(3)  # Be polite to Google
        log(f"  Google searching LinkedIn posts...")
        encoded = requests.utils.quote(query)
        url = f"https://www.google.com/search?q={encoded}&num=20&tbs=qdr:w"  # Last week

        # Google blocks simple requests too, use Playwright
        html = fetch_with_browser(url, wait_selector='#search', wait_time=3)
        if not html:
            # Fallback: try with requests + different user agent
            try:
                r = requests.get(url, headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
                    "Accept": "text/html,application/xhtml+xml",
                    "Accept-Language": "en-US,en;q=0.5",
                }, timeout=15)
                if r.status_code == 200:
                    html = r.text
            except:
                pass
        if not html:
            continue

        # Use Brave Search (no CAPTCHA, works with simple HTTP)
        encoded = requests.utils.quote(query.replace('site:linkedin.com/posts ', 'site:linkedin.com ').replace('site:linkedin.com/feed ', 'site:linkedin.com ').replace('site:linkedin.com/groups ', 'site:linkedin.com '))
        brave_url = f"https://search.brave.com/search?q={encoded}&source=web"
        try:
            r = requests.get(brave_url, headers=HEADERS, timeout=15)
            if r.status_code != 200:
                continue
            brave_html = r.text
        except:
            continue

        # Parse Brave results - find LinkedIn links with surrounding text
        # Extract title and snippet from Brave's svelte components
        result_blocks = re.findall(r'<div[^>]*class="[^"]*snippet[^"]*svelte[^"]*"[^>]*>([\s\S]*?)</div>\s*</div>', brave_html)
        link_results = re.findall(r'<a[^>]*href="(https://[^"]*linkedin\.com/(?:posts|pulse|feed)[^"]*)"[^>]*>([\s\S]*?)</a>', brave_html)

        # Also get snippets near LinkedIn post links
        all_snippets = []
        for link_url, link_text in link_results:
            link_text_clean = re.sub(r'<[^>]+>', '', link_text).strip()
            # Find snippet text near this link
            link_pos = brave_html.find(link_url)
            if link_pos > 0:
                nearby = brave_html[link_pos:link_pos+1000]
                snippet_match = re.search(r'class="[^"]*snippet-description[^"]*"[^>]*>([\s\S]*?)</div>', nearby)
                if not snippet_match:
                    snippet_match = re.search(r'<p[^>]*>([\s\S]{20,300}?)</p>', nearby)
                snippet_text = re.sub(r'<[^>]+>', '', snippet_match.group(1)).strip() if snippet_match else link_text_clean
                all_snippets.append({'url': link_url, 'title': link_text_clean, 'snippet': snippet_text})

        if not all_snippets:
            continue
        log(f"    Found {len(all_snippets)} LinkedIn post results")

        for result in all_snippets:
            url_part = result.get('url', '') if isinstance(result, dict) else result[0]
            snippet = result.get('snippet', '') if isinstance(result, dict) else result[1]
            google_title = result.get('title', '') if isinstance(result, dict) else ''
            # Extract job-like info from the snippet
            snippet_lower = snippet.lower()

            # Skip if not actually about hiring/jobs
            # Skip obvious non-job content
            if any(skip in snippet_lower for skip in ["data protection officer", "child protection", "gdpr", "training program", "certification course"]):
                continue

            # For LinkedIn posts, the Google title IS the useful info
            # Use google_title as primary, snippet as fallback
            combined = (google_title + ' ' + snippet).strip()
            combined_lower = combined.lower()

            # Must contain at least one CP-related keyword
            if not any(kw in combined_lower for kw in ["close protection", "executive protection", "bodyguard", "cpo", "ep agent", "security detail", "protective", "psd"]):
                continue

            # Build title from google_title or snippet
            title = google_title if google_title and len(google_title) > 10 else ""
            if not title:
                first_sentence = snippet.split('.')[0].split('!')[0]
                if len(first_sentence) > 10:
                    title = first_sentence[:100]
            if not title:
                continue

            # Extract location if mentioned
            location = ""
            loc_patterns = [
                r'(?:in|based in|location[:\s])\s+([A-Z][a-z]+(?:\s*,\s*[A-Z][a-z]+)?)',
                r'(Dubai|London|UAE|Abu Dhabi|Riyadh|Qatar|New York|Los Angeles|Miami|Singapore)',
            ]
            for pat in loc_patterns:
                m = re.search(pat, snippet, re.IGNORECASE)
                if m:
                    location = clean(m.group(1))
                    break

            # Extract poster/company name from Google title
            company = "LinkedIn Post"
            gt = google_title or url_part
            if ' - ' in gt:
                company = gt.split(' - ')[0].strip()
            elif ' | ' in gt:
                company = gt.split(' | ')[0].strip()

            # Build source URL
            source_url = url_part if 'linkedin.com' in url_part else ""

            jobs.append({
                "title": title[:300],
                "company": company[:100],
                "location": location,
                "source": "LinkedIn Posts",
                "source_url": source_url,
                "country": guess_country(location),
                "salary": "",
                "notes": snippet[:500],
            })

    # Deduplicate within this source
    seen = set()
    unique = []
    for j in jobs:
        key = j["title"].lower()[:30]
        if key not in seen:
            seen.add(key)
            unique.append(j)
    return unique

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
    if any(x in loc for x in ["south africa", "johannesburg", "cape town", "durban", "pretoria", "gauteng", "western cape", "eastern cape", "kwazulu", "kzn"]):
        return "South Africa"
    return ""

def scrape_google_jobs():
    """Scrape CP/EP job listings found via Google search"""
    jobs = []
    queries = [
        'site:indeed.com "close protection officer" -"data protection"',
        'site:indeed.co.uk "close protection" -"data protection"',
        '"close protection officer" hiring site:linkedin.com/jobs',
        '"executive protection agent" hiring -"data protection"',
    ]
    for q in queries:
        time.sleep(3)
        try:
            url = f"https://www.google.com/search?q={q.replace(' ', '+')}&num=20"
            html = fetch_with_browser(url, wait_time=3)
            if not html:
                continue
            # Extract search result titles and URLs
            results = re.findall(r'<a[^>]*href="(https?://[^"]*(?:indeed|linkedin|reed)[^"]*)"[^>]*>.*?<h3[^>]*>([^<]+)</h3>', html, re.DOTALL)
            for link, title in results:
                title = clean(title)
                if not title or any(skip in title.lower() for skip in ["data protection", "child protection", "fire protection", "loss prevention", "brand protection"]):
                    continue
                source = "Indeed" if "indeed" in link else "LinkedIn" if "linkedin" in link else "Reed"
                jobs.append({
                    "title": title,
                    "company": "",
                    "location": "",
                    "source": f"Google/{source}",
                    "source_url": link,
                    "country": "",
                    "salary": "",
                    "notes": "",
                })
        except Exception as e:
            log(f"  Google Jobs error: {e}")
    return jobs


def scrape_glassdoor_uk():
    """Scrape Glassdoor UK for close protection jobs in London — uses Playwright"""
    jobs = []
    skip_words = ["data protection", "child protection", "fire protection", "loss prevention",
                  "brand protection", "crop protection", "consumer protection", "asset protection",
                  "product proposition", "legal counsel", "frontend", "apprentice", "trainee",
                  "training contract", "intern", "cash/coin", "talent acquisition"]
    urls = [
        "https://www.glassdoor.co.uk/Job/london-close-protection-jobs-SRCH_IL.0,6_IC2671300_KO7,23.htm",
        "https://www.glassdoor.co.uk/Job/uk-executive-protection-jobs-SRCH_IL.0,2_IN2_KO3,23.htm",
        "https://www.glassdoor.co.uk/Job/uk-bodyguard-jobs-SRCH_IL.0,2_IN2_KO3,12.htm",
    ]
    for page_url in urls:
        time.sleep(3)
        log(f"  Glassdoor UK: fetching with Playwright...")
        html = fetch_with_browser(page_url, wait_time=5)
        if not html:
            continue

        # Extract job cards via regex on rendered HTML
        # Glassdoor uses data-test attributes
        titles = [clean(m) for m in re.findall(r'data-test="job-title"[^>]*>([^<]+)<', html)]
        companies_raw = re.findall(r'data-test="emp-name"[^>]*>([^<]+)<', html)
        locations_raw = re.findall(r'data-test="emp-location"[^>]*>([^<]+)<', html)
        salaries_raw = re.findall(r'data-test="detailSalary"[^>]*>([^<]+)<', html)
        job_urls = re.findall(r'href="(/job-listing/[^"]+)"', html)

        if not titles:
            # Fallback: broader pattern
            titles = [clean(m) for m in re.findall(r'class="[^"]*jobTitle[^"]*"[^>]*>([^<]+)<', html)]

        seen = set()
        for i in range(len(titles)):
            title = titles[i]
            title_lower = title.lower()
            if any(skip in title_lower for skip in skip_words):
                continue
            # Must contain at least one relevant keyword
            if not any(kw in title_lower for kw in ["protection", "security", "bodyguard", "cp", "gsoc",
                                                     "csoc", "threat", "intelligence", "surveillance",
                                                     "door supervisor"]):
                continue
            company = clean(companies_raw[i]).rstrip('0123456789.') if i < len(companies_raw) else ""
            key = title.lower() + "|" + company.lower()
            if key in seen:
                continue
            seen.add(key)
            location = clean(locations_raw[i]) if i < len(locations_raw) else "London, England"
            salary = clean(salaries_raw[i]) if i < len(salaries_raw) else ""
            source_url = f"https://www.glassdoor.co.uk{job_urls[i]}" if i < len(job_urls) else page_url

            jobs.append({
                "title": title,
                "company": company,
                "location": location,
                "source": "Glassdoor UK",
                "source_url": source_url,
                "country": "UK",
                "salary": salary,
                "notes": "",
            })
        time.sleep(2)
    return jobs


def scrape_recruit_net_za():
    """Scrape Recruit.net South Africa for close protection jobs — uses Playwright"""
    jobs = []
    skip_words = ["data protection", "child protection", "fire protection", "crop protection",
                  "sales phone", "engineering specialist", "consultant paediatrician",
                  "carbon projects", "telemarketer", "technical consultant", "service delivery",
                  "project engineer", "regional manager", "sales consultant", "wet services"]
    urls = [
        "https://za.recruit.net/search-close-protection-jobs",
        "https://za.recruit.net/search-executive-protection-jobs",
        "https://za.recruit.net/search-bodyguard-jobs",
    ]
    for page_url in urls:
        time.sleep(3)
        log(f"  Recruit.net ZA: fetching with Playwright...")
        html = fetch_with_browser(page_url, wait_time=6)
        if not html:
            continue

        # Accept consent dialog if present
        # Extract job links and nearby company links
        job_links = re.findall(r'<a[^>]*href="(https://www\.recruit\.net/job/[^"]+)"[^>]*>\s*([^<]+)\s*</a>', html)
        company_links = re.findall(r'<a[^>]*href="https://za\.recruit\.net/company-[^"]*"[^>]*>\s*([^<]+)\s*</a>', html)

        seen = set()
        for idx, (link, title) in enumerate(job_links):
            title = clean(title)
            title_lower = title.lower()
            if not title or len(title) < 5:
                continue
            if any(skip in title_lower for skip in skip_words):
                continue
            # Must contain at least one relevant keyword
            if not any(kw in title_lower for kw in ["protection", "security", "bodyguard", "cp ",
                                                     "close protection", "executive protection",
                                                     "surveillance", "threat"]):
                continue
            key = title.lower()
            if key in seen:
                continue
            seen.add(key)

            company = clean(company_links[idx]) if idx < len(company_links) else ""
            # Guess location from title
            location = ""
            for region in ["Western Cape", "Eastern Cape", "Gauteng", "KZN", "KwaZulu-Natal",
                          "Johannesburg", "Cape Town", "Durban", "Pretoria", "Global"]:
                if region.lower() in title_lower:
                    location = region
                    break

            jobs.append({
                "title": title,
                "company": company,
                "location": location or "South Africa",
                "source": "Recruit.net ZA",
                "source_url": link,
                "country": "South Africa",
                "salary": "",
                "notes": "",
            })
        time.sleep(2)
    return jobs


def scrape_reed():
    """Scrape Reed.co.uk — HTML scraping with strict CP/EP filtering"""
    jobs = []
    keywords = ["close protection", "bodyguard", "security officer close protection", "CPO security"]
    skip_words = ["data protection", "child protection", "fire protection", "loss prevention",
                  "brand protection", "asset protection", "insurance", "broker", "lifeguard",
                  "governance", "compliance", "safeguarding", "trainee jobs"]
    for kw in keywords:
        time.sleep(2)
        try:
            html = fetch(f"https://www.reed.co.uk/jobs/{kw.replace(' ', '-')}-jobs")
            if not html:
                continue
            cards = re.findall(r'<h2[^>]*>.*?<a\s+href="(/jobs/[^"]+)"[^>]*>([^<]+)</a>', html, re.DOTALL)
            for url, title in cards[1:]:  # Skip first (promoted category)
                title = clean(title)
                if not title or any(skip in title.lower() for skip in skip_words):
                    continue
                jobs.append({
                    "title": title,
                    "company": "",
                    "location": "United Kingdom",
                    "source": "Reed",
                    "source_url": f"https://www.reed.co.uk{url.split('?')[0]}",
                    "country": "UK",
                    "salary": "",
                    "notes": "",
                })
        except Exception as e:
            log(f"  Reed error for '{kw}': {e}")
    return jobs


def is_bad_title(title):
    """Reject non-job titles: person names, raw URLs, vague posts"""
    t = (title or '').lower().strip()
    if len(t) < 10: return True
    if any(x in t for x in ['https://', 'http://', '?src=', '/jobba-', 'candidates europe']):
        return True
    if t.startswith('post ') or t.startswith('hiring ') and len(t) < 30:
        return True
    # Reject if title is mostly numbers/IDs
    digits = sum(1 for c in t if c.isdigit())
    if digits > len(t) * 0.3 and len(t) > 15: return True
    return False

def deduplicate(jobs):
    """Remove duplicates by title+company+source, filter bad titles"""
    seen = set()
    unique = []
    for j in jobs:
        if not j["title"] or is_bad_title(j["title"]):
            continue
        key = (j["title"].lower().strip(), j["company"].lower().strip(), j["source"])
        if key not in seen:
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

    # Strip type field until column exists in Supabase
    for j in jobs:
        j.pop("type", None)

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
    # Trigger Scout immediately to enrich new jobs
    if inserted > 0:
        try:
            log(f"Triggering Scout to enrich {inserted} new jobs...")
            batches = max(1, min(5, inserted // 10))  # 1-5 batches based on new job count
            for b in range(batches):
                sr = requests.get("https://cpoleads.com/api/enrich-jobs?secret=cpo-scout-2026&batch_size=20", timeout=60)
                if sr.status_code == 200:
                    sd = sr.json()
                    log(f"  Scout batch {b+1}: checked={sd.get('jobs_checked',0)}, enriched={sd.get('jobs_enriched',0)}")
                else:
                    log(f"  Scout batch {b+1} failed: HTTP {sr.status_code}")
                time.sleep(3)
        except Exception as e:
            log(f"  Scout trigger failed: {e}")

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
        send_telegram(f"📡 CPO Leads scrape (main) — 0 nye. Database: {total_db}")
        return
    source_counts = {}
    for j in jobs:
        src = j.get("source", "Unknown")
        source_counts[src] = source_counts.get(src, 0) + 1
    sources_text = "\n".join(f"  • {src}: {c}" for src, c in sorted(source_counts.items(), key=lambda x: -x[1]))
    send_telegram(f"🟢 <b>CPO Leads (main) — {total_new} nye jobber</b>\n\n{sources_text}\n\n📊 Totalt: {total_db}")
    for j in jobs[:15]:
        msg = f"💼 <b>{j.get('title','')}</b>"
        if j.get('company'): msg += f"\n🏢 {j['company']}"
        if j.get('location'): msg += f"\n📍 {j['location']}"
        if j.get('salary'): msg += f"\n💰 {j['salary']}"
        if j.get('source'): msg += f"\n📡 via {j['source']}"
        if j.get('source_url'): msg += f"\n🔗 <a href=\"{j['source_url']}\">Apply</a>"
        send_telegram(msg)
        time.sleep(0.5)
    if len(jobs) > 15:
        send_telegram(f"... og {len(jobs) - 15} flere. cpoleads.com 🔥")

def scrape_usajobs():
    """Scrape USAJobs.gov via HTML search pages (no API key needed)"""
    jobs = []
    queries = ["executive+protection", "protective+security+specialist", "security+specialist+protection"]
    skip_words = ["data protection", "child protection", "it specialist", "information security", "cybersecurity"]
    for q in queries:
        time.sleep(3)
        try:
            url = f"https://www.usajobs.gov/search/results?k={q}&p=1"
            html = fetch_with_browser(url, wait_time=4)
            if not html:
                continue
            # Extract job cards from search results
            cards = re.findall(r'<a[^>]*href="(/job/[^"]+)"[^>]*class="[^"]*usajobs-search-result--core[^"]*"[^>]*>.*?<h3[^>]*>([^<]+)</h3>.*?<span[^>]*class="[^"]*department[^"]*"[^>]*>([^<]*)</span>.*?<span[^>]*class="[^"]*location[^"]*"[^>]*>([^<]*)</span>', html, re.DOTALL)
            if not cards:
                # Fallback: simpler pattern
                titles = re.findall(r'<h3[^>]*class="[^"]*usajobs[^"]*"[^>]*>([^<]+)</h3>', html)
                links = re.findall(r'href="(/job/[^"]+)"', html)
                for i, title in enumerate(titles[:15]):
                    title = clean(title)
                    if not title or any(skip in title.lower() for skip in skip_words):
                        continue
                    link = f"https://www.usajobs.gov{links[i]}" if i < len(links) else "https://www.usajobs.gov"
                    jobs.append({
                        "title": title,
                        "company": "US Federal Government",
                        "location": "",
                        "source": "USAJobs",
                        "source_url": link,
                        "country": "US",
                        "salary": "",
                        "notes": "",
                    })
            else:
                for link, title, dept, loc in cards[:15]:
                    title = clean(title)
                    if not title or any(skip in title.lower() for skip in skip_words):
                        continue
                    jobs.append({
                        "title": title,
                        "company": clean(dept) or "US Federal Government",
                        "location": clean(loc),
                        "source": "USAJobs",
                        "source_url": f"https://www.usajobs.gov{link}",
                        "country": "US",
                        "salary": "",
                        "notes": "",
                    })
        except Exception as e:
            log(f"  USAJobs error for '{q}': {e}")
    return jobs


def scrape_career_sites():
    """Scrape major EP company career pages via Greenhouse/Workday/ADP APIs"""
    jobs = []
    skip_words = ["data protection", "child protection", "intern", "trainee", "marketing analyst"]

    # GDBA - Greenhouse
    try:
        r = requests.get("https://boards-api.greenhouse.io/v1/boards/gavindebeckerassociates/jobs", timeout=15)
        if r.status_code == 200:
            for j in r.json().get("jobs", []):
                title = j.get("title", "")
                if any(skip in title.lower() for skip in skip_words):
                    continue
                loc = j.get("location", {}).get("name", "")
                jobs.append({
                    "title": title,
                    "company": "Gavin de Becker & Associates",
                    "location": loc,
                    "source": "GDBA Careers",
                    "source_url": j.get("absolute_url", ""),
                    "country": "US" if any(s in loc for s in ["CA", "TX", "NY", "DC", "VA"]) else "",
                    "salary": "",
                    "notes": "",
                })
    except Exception as e:
        log(f"  GDBA Greenhouse error: {e}")

    # Global Guardian - Greenhouse
    try:
        r = requests.get("https://boards-api.greenhouse.io/v1/boards/globalguardian/jobs", timeout=15)
        if r.status_code == 200:
            for j in r.json().get("jobs", []):
                title = j.get("title", "")
                if any(skip in title.lower() for skip in skip_words):
                    continue
                loc = j.get("location", {}).get("name", "")
                jobs.append({
                    "title": title,
                    "company": "Global Guardian",
                    "location": loc,
                    "source": "Global Guardian Careers",
                    "source_url": j.get("absolute_url", ""),
                    "country": "US" if any(s in loc for s in ["CA", "TX", "NY", "DC", "VA", "NV"]) else "",
                    "salary": "",
                    "notes": "",
                })
    except Exception as e:
        log(f"  Global Guardian Greenhouse error: {e}")

    # Pinkerton - Greenhouse
    try:
        r = requests.get("https://boards-api.greenhouse.io/v1/boards/pinkerton/jobs", timeout=15)
        if r.status_code == 200:
            for j in r.json().get("jobs", []):
                title = j.get("title", "")
                if not any(kw in title.lower() for kw in ["protection", "security", "investigat", "intelligence"]):
                    continue
                if any(skip in title.lower() for skip in skip_words):
                    continue
                loc = j.get("location", {}).get("name", "")
                jobs.append({
                    "title": title,
                    "company": "Pinkerton",
                    "location": loc,
                    "source": "Pinkerton Careers",
                    "source_url": j.get("absolute_url", ""),
                    "country": guess_country(loc),
                    "salary": "",
                    "notes": "",
                })
    except Exception as e:
        log(f"  Pinkerton Greenhouse error: {e}")

    # Crisis24/GardaWorld - Dayforce (Playwright — JS-rendered)
    try:
        html = fetch_with_browser("https://jobs.dayforcehcm.com/en-US/crisis24/CANDIDATEPORTAL/jobs?search=protection", wait_time=5)
        if html:
            # Extract job cards: title + link
            cards = re.findall(r'<a[^>]*href="(/en-US/crisis24/CANDIDATEPORTAL/jobs/\d+)"[^>]*>([^<]+)</a>', html)
            for link, title in cards:
                title = clean(title)
                if not title or any(skip in title.lower() for skip in skip_words):
                    continue
                jobs.append({
                    "title": title,
                    "company": "Crisis24 (GardaWorld)",
                    "location": "",
                    "source": "Crisis24 Careers",
                    "source_url": f"https://jobs.dayforcehcm.com{link}",
                    "country": "",
                    "salary": "",
                    "notes": "",
                })
    except Exception as e:
        log(f"  Crisis24 Dayforce error: {e}")

    return jobs


def scrape_jooble():
    """Scrape Jooble for EP/CP jobs — Playwright (blocks simple requests)"""
    jobs = []
    skip_words = ["data protection", "child protection", "fire protection", "loss prevention"]
    searches = [
        "https://jooble.org/SearchResult?ukw=close+protection+officer",
        "https://jooble.org/SearchResult?ukw=executive+protection+agent",
        "https://jooble.org/SearchResult?ukw=bodyguard+security",
    ]
    for url in searches:
        time.sleep(3)
        try:
            html = fetch_with_browser(url, wait_time=4)
            if not html:
                continue
            # Multiple patterns for Jooble's job cards
            cards = re.findall(r'<a[^>]*class="[^"]*jooble[^"]*"[^>]*href="([^"]+)"[^>]*>([^<]+)</a>', html, re.DOTALL)
            if not cards:
                cards = re.findall(r'<h2[^>]*>.*?<a[^>]*href="([^"]+)"[^>]*>([^<]+)</a>', html, re.DOTALL)
            if not cards:
                cards = re.findall(r'<a[^>]*href="(https://jooble\.org/desc/[^"]+)"[^>]*>([^<]+)</a>', html, re.DOTALL)
            for link, title in cards[:20]:
                title = clean(title)
                if not title or any(skip in title.lower() for skip in skip_words):
                    continue
                if not link.startswith("http"):
                    link = "https://jooble.org" + link
                jobs.append({
                    "title": title,
                    "company": "",
                    "location": "",
                    "source": "Jooble",
                    "source_url": link,
                    "country": "",
                    "salary": "",
                    "notes": "",
                })
        except Exception as e:
            log(f"  Jooble error: {e}")
    return jobs


def scrape_ssr_personnel():
    """Scrape SSR Personnel for security/protection jobs — Playwright"""
    jobs = []
    ep_keywords = ["protection", "executive", "close protection", "bodyguard", "ep ", "cpo",
                   "security director", "security manager", "intelligence", "risk", "investigat",
                   "security operative", "security officer", "corporate security"]
    skip_words = ["data protection", "child protection", "fire alarm", "fire engineer",
                  "windchill", "software", "developer", "marketing", "sales engineer"]
    try:
        html = fetch_with_browser("https://www.ssr-personnel.com/jobs?countrycode=&keywords=security&page=1&pagesize=50", wait_time=5) or ""
        # Extract job cards: title, URL, location, salary
        cards = re.findall(r'<a[^>]*href="(/job/[^"]+)"[^>]*>([^<]+)</a>', html)
        locations = re.findall(r'<span[^>]*class="[^"]*location[^"]*"[^>]*>([^<]+)</span>', html)
        salaries = re.findall(r'<span[^>]*class="[^"]*salary[^"]*"[^>]*>([^<]+)</span>', html)
        for i, (url, title) in enumerate(cards):
            title = clean(title)
            if not title:
                continue
            title_lower = title.lower()
            if any(skip in title_lower for skip in skip_words):
                continue
            if not any(kw in title_lower for kw in ep_keywords):
                continue
            loc = clean(locations[i]) if i < len(locations) else ""
            sal = clean(salaries[i]) if i < len(salaries) else ""
            full_url = f"https://www.ssr-personnel.com{url}" if not url.startswith("http") else url
            jobs.append({
                "title": title,
                "company": "SSR Personnel",
                "location": loc,
                "source": "SSR Personnel",
                "source_url": full_url,
                "country": guess_country(loc),
                "salary": sal,
                "notes": "",
            })
    except Exception as e:
        log(f"  SSR Personnel error: {e}")
    return jobs


def scrape_unjobs():
    """Scrape UNjobs.org for UN security positions"""
    jobs = []
    skip_words = ["data protection", "child protection", "information security", "cybersecurity", "it security"]
    queries = ["security+officer", "protection+officer", "field+security"]
    for q in queries:
        time.sleep(3)
        try:
            html = fetch(f"https://unjobs.org/search/{q}")
            if not html:
                html = fetch_with_browser(f"https://unjobs.org/search/{q}", wait_time=4) or ""
            cards = re.findall(r'<a[^>]*href="(https://unjobs\.org/vacancies/[^"]+)"[^>]*>([^<]+)</a>', html)
            for link, title in cards[:20]:
                title = clean(title)
                if not title or any(skip in title.lower() for skip in skip_words):
                    continue
                # Extract org from page structure
                jobs.append({
                    "title": title,
                    "company": "United Nations",
                    "location": "",
                    "source": "UNjobs",
                    "source_url": link,
                    "country": "International",
                    "salary": "",
                    "notes": "",
                })
        except Exception as e:
            log(f"  UNjobs error: {e}")
    return jobs


def scrape_control_risks():
    """Scrape Control Risks careers page"""
    jobs = []
    skip_words = ["data protection", "intern", "trainee", "marketing"]
    ep_keywords = ["protection", "security", "intelligence", "risk", "investigat", "travel security",
                   "crisis", "resilience", "executive", "consultant"]
    try:
        html = fetch_with_browser("https://www.controlrisks.com/careers/current-vacancies", wait_time=5)
        if not html:
            return jobs
        cards = re.findall(r'<a[^>]*href="(/careers/current-vacancies/[^"]+)"[^>]*>([^<]+)</a>', html)
        for link, title in cards:
            title = clean(title)
            if not title or any(skip in title.lower() for skip in skip_words):
                continue
            if not any(kw in title.lower() for kw in ep_keywords):
                continue
            jobs.append({
                "title": title,
                "company": "Control Risks",
                "location": "",
                "source": "Control Risks Careers",
                "source_url": f"https://www.controlrisks.com{link}",
                "country": "International",
                "salary": "",
                "notes": "",
            })
    except Exception as e:
        log(f"  Control Risks error: {e}")
    return jobs


def scrape_nato():
    """Scrape NATO careers for security positions"""
    jobs = []
    try:
        html = fetch_with_browser("https://nato.taleo.net/careersection/2/jobsearch.ftl?lang=en", wait_time=5)
        if not html:
            return jobs
        # Extract job titles and links
        cards = re.findall(r'<a[^>]*href="(jobdetail\.ftl\?job=[^"]+)"[^>]*>([^<]+)</a>', html)
        for link, title in cards:
            title = clean(title)
            if not title:
                continue
            if not any(kw in title.lower() for kw in ["security", "protection", "intelligence", "crisis", "defence"]):
                continue
            jobs.append({
                "title": title,
                "company": "NATO",
                "location": "Brussels / International",
                "source": "NATO Careers",
                "source_url": f"https://nato.taleo.net/careersection/2/{link}",
                "country": "International",
                "salary": "",
                "notes": "",
            })
    except Exception as e:
        log(f"  NATO error: {e}")
    return jobs


def scrape_careers24_za():
    """Scrape Careers24 South Africa for security/protection jobs"""
    jobs = []
    skip_words = ["data protection", "child protection", "it security", "cybersecurity"]
    try:
        html = fetch_with_browser("https://www.careers24.com/jobs/keywords-close-protection/", wait_time=4)
        if not html:
            html = fetch_with_browser("https://www.careers24.com/jobs/keywords-security-protection/", wait_time=4) or ""
        cards = re.findall(r'<a[^>]*href="(/jobs/adverts/[^"]+)"[^>]*>([^<]+)</a>', html)
        for link, title in cards[:20]:
            title = clean(title)
            if not title or any(skip in title.lower() for skip in skip_words):
                continue
            jobs.append({
                "title": title,
                "company": "",
                "location": "South Africa",
                "source": "Careers24",
                "source_url": f"https://www.careers24.com{link}" if not link.startswith("http") else link,
                "country": "South Africa",
                "salary": "",
                "notes": "",
            })
    except Exception as e:
        log(f"  Careers24 error: {e}")
    return jobs


def scrape_bayt():
    """Scrape Bayt.com for Middle East security/EP jobs"""
    jobs = []
    skip_words = ["data protection", "cybersecurity", "it security", "information security"]
    try:
        html = fetch_with_browser("https://www.bayt.com/en/international/jobs/close-protection-jobs/", wait_time=4)
        if not html:
            html = fetch_with_browser("https://www.bayt.com/en/international/jobs/executive-protection-jobs/", wait_time=4) or ""
        cards = re.findall(r'<a[^>]*href="(/en/[^"]*job[^"]*\d+/)"[^>]*>([^<]+)</a>', html)
        for link, title in cards[:20]:
            title = clean(title)
            if not title or any(skip in title.lower() for skip in skip_words):
                continue
            if not any(kw in title.lower() for kw in ["security", "protection", "guard", "officer", "investigat"]):
                continue
            jobs.append({
                "title": title,
                "company": "",
                "location": "Middle East",
                "source": "Bayt",
                "source_url": f"https://www.bayt.com{link}" if not link.startswith("http") else link,
                "country": "UAE",
                "salary": "",
                "notes": "",
            })
    except Exception as e:
        log(f"  Bayt error: {e}")
    return jobs


def scrape_allied_securitas_g4s():
    """Scrape Allied Universal, Securitas, G4S via their career search pages"""
    jobs = []
    skip_words = ["data protection", "intern", "trainee", "janitorial", "custodian"]
    ep_keywords = ["executive protection", "close protection", "protective", "ep agent",
                   "security director", "security manager", "intelligence", "investigations"]
    sites = [
        ("Allied Universal", "https://jobs.aus.com/search/?q=executive+protection&sortColumn=referencedate&sortDirection=desc"),
        ("Allied Universal", "https://jobs.aus.com/search/?q=close+protection&sortColumn=referencedate&sortDirection=desc"),
        ("Securitas", "https://www.securitas.com/careers/job-openings/?search=executive+protection"),
        ("G4S", "https://careers.g4s.com/search/?q=close+protection&sortColumn=referencedate&sortDirection=desc"),
    ]
    for company, url in sites:
        time.sleep(3)
        try:
            html = fetch_with_browser(url, wait_time=4)
            if not html:
                continue
            cards = re.findall(r'<a[^>]*href="([^"]*(?:job|position|opening)[^"]*)"[^>]*>([^<]+)</a>', html, re.IGNORECASE)
            for link, title in cards[:15]:
                title = clean(title)
                if not title or any(skip in title.lower() for skip in skip_words):
                    continue
                if not any(kw in title.lower() for kw in ep_keywords + ["security"]):
                    continue
                if not link.startswith("http"):
                    link = url.split("/search")[0] + link if "/search" in url else link
                jobs.append({
                    "title": title,
                    "company": company,
                    "location": "",
                    "source": f"{company} Careers",
                    "source_url": link,
                    "country": "",
                    "salary": "",
                    "notes": "",
                })
        except Exception as e:
            log(f"  {company} error: {e}")
    return jobs


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

    # LinkedIn Company Pages (ODIN/OSC, M.S Security Group)
    try:
        log("Scraping LinkedIn Company Pages...")
        li_company = scrape_linkedin_company_posts()
        log(f"  Found {len(li_company)} jobs from company pages")
        all_jobs.extend(li_company)
    except Exception as e:
        log(f"  LINKEDIN COMPANY PAGES FAILED: {e}")
        errors.append(f"LinkedIn Company Pages: {e}")

    # LinkedIn Posts (people posting about jobs in groups/profiles)
    try:
        log("Scraping LinkedIn Posts (Brave Search)...")
        li_posts = scrape_linkedin_posts()
        log(f"  Found {len(li_posts)} jobs from posts")
        all_jobs.extend(li_posts)
    except Exception as e:
        log(f"  LINKEDIN POSTS FAILED: {e}")
        errors.append(f"LinkedIn Posts: {e}")

    # Google Jobs
    try:
        log("Scraping Google Jobs...")
        google = scrape_google_jobs()
        log(f"  Found {len(google)} jobs")
        all_jobs.extend(google)
    except Exception as e:
        log(f"  GOOGLE JOBS FAILED: {e}")
        errors.append(f"Google Jobs: {e}")

    # Reed UK
    try:
        log("Scraping Reed UK...")
        reed = scrape_reed()
        log(f"  Found {len(reed)} jobs")
        all_jobs.extend(reed)
    except Exception as e:
        log(f"  REED FAILED: {e}")
        errors.append(f"Reed: {e}")

    # Glassdoor UK
    try:
        log("Scraping Glassdoor UK...")
        glassdoor = scrape_glassdoor_uk()
        log(f"  Found {len(glassdoor)} jobs")
        all_jobs.extend(glassdoor)
    except Exception as e:
        log(f"  GLASSDOOR UK FAILED: {e}")
        errors.append(f"Glassdoor UK: {e}")

    # Recruit.net South Africa
    try:
        log("Scraping Recruit.net ZA...")
        recruit_za = scrape_recruit_net_za()
        log(f"  Found {len(recruit_za)} jobs")
        all_jobs.extend(recruit_za)
    except Exception as e:
        log(f"  RECRUIT.NET ZA FAILED: {e}")
        errors.append(f"Recruit.net ZA: {e}")

    # SSR Personnel
    try:
        log("Scraping SSR Personnel...")
        ssr = scrape_ssr_personnel()
        log(f"  Found {len(ssr)} jobs")
        all_jobs.extend(ssr)
    except Exception as e:
        log(f"  SSR PERSONNEL FAILED: {e}")
        errors.append(f"SSR Personnel: {e}")

    # USAJobs (Federal EP)
    try:
        log("Scraping USAJobs.gov...")
        usajobs = scrape_usajobs()
        log(f"  Found {len(usajobs)} jobs")
        all_jobs.extend(usajobs)
    except Exception as e:
        log(f"  USAJOBS FAILED: {e}")
        errors.append(f"USAJobs: {e}")

    # Company Career Sites (GDBA, Global Guardian, Pinkerton, Crisis24)
    try:
        log("Scraping Company Career Sites...")
        careers = scrape_career_sites()
        log(f"  Found {len(careers)} jobs")
        all_jobs.extend(careers)
    except Exception as e:
        log(f"  CAREER SITES FAILED: {e}")
        errors.append(f"Career Sites: {e}")

    # Jooble
    try:
        log("Scraping Jooble...")
        jooble = scrape_jooble()
        log(f"  Found {len(jooble)} jobs")
        all_jobs.extend(jooble)
    except Exception as e:
        log(f"  JOOBLE FAILED: {e}")
        errors.append(f"Jooble: {e}")

    # UNjobs
    try:
        log("Scraping UNjobs.org...")
        unjobs = scrape_unjobs()
        log(f"  Found {len(unjobs)} jobs")
        all_jobs.extend(unjobs)
    except Exception as e:
        log(f"  UNJOBS FAILED: {e}")
        errors.append(f"UNjobs: {e}")

    # Control Risks
    try:
        log("Scraping Control Risks...")
        cr = scrape_control_risks()
        log(f"  Found {len(cr)} jobs")
        all_jobs.extend(cr)
    except Exception as e:
        log(f"  CONTROL RISKS FAILED: {e}")
        errors.append(f"Control Risks: {e}")

    # NATO
    try:
        log("Scraping NATO Careers...")
        nato = scrape_nato()
        log(f"  Found {len(nato)} jobs")
        all_jobs.extend(nato)
    except Exception as e:
        log(f"  NATO FAILED: {e}")
        errors.append(f"NATO: {e}")

    # Careers24 South Africa
    try:
        log("Scraping Careers24 ZA...")
        c24 = scrape_careers24_za()
        log(f"  Found {len(c24)} jobs")
        all_jobs.extend(c24)
    except Exception as e:
        log(f"  CAREERS24 FAILED: {e}")
        errors.append(f"Careers24: {e}")

    # Bayt (Middle East)
    try:
        log("Scraping Bayt.com...")
        bayt = scrape_bayt()
        log(f"  Found {len(bayt)} jobs")
        all_jobs.extend(bayt)
    except Exception as e:
        log(f"  BAYT FAILED: {e}")
        errors.append(f"Bayt: {e}")

    # Allied Universal, Securitas, G4S
    try:
        log("Scraping Allied/Securitas/G4S...")
        big3 = scrape_allied_securitas_g4s()
        log(f"  Found {len(big3)} jobs")
        all_jobs.extend(big3)
    except Exception as e:
        log(f"  ALLIED/SECURITAS/G4S FAILED: {e}")
        errors.append(f"Allied/Securitas/G4S: {e}")

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
    log(f"  Sources scraped: 11")
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

    # Notify Telegram
    if new_jobs > 0:
        log("Sending to Telegram...")
        notify_telegram_jobs(unique[:new_jobs], new_jobs, after)
    else:
        notify_telegram_jobs([], 0, after)

    # Cleanup
    close_browser()

    return 0 if not errors else 1

if __name__ == "__main__":
    sys.exit(main())
