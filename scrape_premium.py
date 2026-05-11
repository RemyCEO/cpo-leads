"""
CPO Leads — Premium Source Scraper
Scrapes rare/exclusive sources that standard job boards miss:
1. Company career pages (top EP/CP firms)
2. Government contract sites (SAM.gov, Contracts Finder UK, TED/EU)
3. Embassy/UN/IO career portals
4. Niche security job boards
5. Maritime security sites
6. Google News for hiring announcements

Run:     python scrape_premium.py
Schedule: Windows Task Scheduler daily alongside scrape_jobs.py
Logs:    scrape_premium_log.txt
"""

import requests
import re
import time
import sys
import os
import json
from datetime import datetime, timedelta
from html import unescape

# --- PLAYWRIGHT (lazy-loaded) ---
_browser = None
_playwright = None

def get_browser_page():
    """Lazy-load Playwright browser"""
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
        ctx = _browser.new_context(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")
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

def fetch_with_browser(url, wait_time=5):
    """Fetch page using real Chromium browser"""
    page = get_browser_page()
    if not page:
        return None
    try:
        page.goto(url, timeout=30000, wait_until="domcontentloaded")
        time.sleep(wait_time)
        html = page.content()
        page.close()
        return html
    except Exception as e:
        log(f"  Browser fetch error for {url[:60]}: {e}")
        try: page.close()
        except: pass
        return None

# --- CONFIG ---
SUPABASE_URL = "https://afrcpiheobzauwyftksr.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmcmNwaWhlb2J6YXV3eWZ0a3NyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODE1MzMwNSwiZXhwIjoyMDkzNzI5MzA1fQ.s4pyLPAiFswQ426enQpmWqYYoohrHBTnSUmwrquE3XA"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(SCRIPT_DIR, "scrape_premium_log.txt")
MAX_RETRIES = 2
RETRY_DELAY = 3

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Keywords that indicate a CP/EP/security job
CP_KEYWORDS = [
    "close protection", "executive protection", "bodyguard", "protective services",
    "ep agent", "ep specialist", "ep manager", "ep director", "ep team",
    "cpo", "psd", "protective intelligence", "vip protection", "security driver",
    "protective operations", "security specialist", "security officer",
    "threat assessment", "residential security", "travel security",
    "maritime security", "armed security", "personal protection",
    "security manager", "security director", "security consultant",
    "protection officer", "protection agent", "protection detail",
]

# Keywords to EXCLUDE (not real CP jobs)
EXCLUDE_KEYWORDS = [
    "data protection", "child protection", "brand protection", "fire protection",
    "asset protection officer", "loss prevention", "cyber security analyst",
    "information security", "network security", "it security", "endpoint protection",
    "environmental protection", "consumer protection", "plant protection",
    "radiation protection", "intellectual property",
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

def fetch(url, retries=MAX_RETRIES, headers=None):
    h = headers or HEADERS
    for attempt in range(1, retries + 1):
        try:
            r = requests.get(url, headers=h, timeout=20)
            if r.status_code == 200:
                return r.text
            if r.status_code == 429:
                time.sleep(RETRY_DELAY * attempt * 2)
                continue
            if r.status_code >= 500:
                time.sleep(RETRY_DELAY * attempt)
                continue
            return None
        except:
            if attempt < retries:
                time.sleep(RETRY_DELAY * attempt)
    return None

def fetch_json(url, retries=MAX_RETRIES, headers=None):
    h = headers or HEADERS
    for attempt in range(1, retries + 1):
        try:
            r = requests.get(url, headers=h, timeout=20)
            if r.status_code == 200:
                return r.json()
            if attempt < retries:
                time.sleep(RETRY_DELAY * attempt)
        except:
            if attempt < retries:
                time.sleep(RETRY_DELAY * attempt)
    return None

def clean(text):
    if not text:
        return ""
    return unescape(re.sub(r'\s+', ' ', text)).strip()

def is_cp_job(title, description=""):
    """Check if a job is CP/EP related"""
    text = f"{title} {description}".lower()
    # Exclude non-CP jobs first
    if any(ex in text for ex in EXCLUDE_KEYWORDS):
        return False
    return any(kw in text for kw in CP_KEYWORDS)

def guess_country(location):
    """Guess country from location string"""
    loc = location.lower()
    country_map = {
        "uk": ["london", "manchester", "birmingham", "edinburgh", "glasgow", "bristol", "leeds", "united kingdom", ", uk"],
        "USA": ["new york", "los angeles", "washington", "chicago", "houston", "seattle", "dallas", "boston", "miami", "san francisco", ", ca", ", ny", ", tx", ", dc", ", fl", ", va", "united states"],
        "UAE": ["dubai", "abu dhabi", "uae", "emirates"],
        "Saudi Arabia": ["riyadh", "jeddah", "saudi", "ksa", "neom"],
        "Qatar": ["doha", "qatar"],
        "Germany": ["berlin", "munich", "frankfurt", "germany"],
        "France": ["paris", "france"],
        "Iraq": ["baghdad", "basrah", "erbil", "iraq"],
        "Afghanistan": ["kabul", "afghanistan"],
        "Nigeria": ["lagos", "abuja", "nigeria"],
        "Kenya": ["nairobi", "kenya"],
        "South Africa": ["johannesburg", "cape town", "south africa"],
        "Australia": ["sydney", "melbourne", "australia"],
        "Canada": ["toronto", "montreal", "vancouver", "canada"],
        "Switzerland": ["zurich", "geneva", "switzerland"],
        "Netherlands": ["amsterdam", "the hague", "netherlands"],
        "Singapore": ["singapore"],
        "Hong Kong": ["hong kong"],
    }
    for country, markers in country_map.items():
        if any(m in loc for m in markers):
            return country
    return ""


# ============================================================
# SOURCE 1: COMPANY CAREER PAGES
# ============================================================

# Top EP/CP companies with known career page patterns
CAREER_PAGES = [
    # Greenhouse ATS (verified working)
    {"company": "Concentric (GDBA)", "type": "greenhouse", "board": "concentric", "country": "USA"},

    # Direct career pages (keyword search)
    {"company": "GardaWorld", "type": "direct", "url": "https://jobs.garda.com/search/?q=protection&sortColumn=referencedate&sortDirection=desc", "country": "Canada"},
    {"company": "Constellis", "type": "direct", "url": "https://constellis.wd1.myworkdayjobs.com/constelliscareersexternal?q=protection", "country": "USA"},
    {"company": "Allied Universal", "type": "direct", "url": "https://jobs.aus.com/search/?q=executive+protection&sortColumn=referencedate&sortDirection=desc", "country": "USA"},
    {"company": "Pinkerton", "type": "direct", "url": "https://pinkerton.com/careers/current-openings", "country": "USA"},
    {"company": "International SOS", "type": "direct", "url": "https://careers.internationalsos.com/search/?q=security&sortColumn=referencedate&sortDirection=desc", "country": "Singapore"},
    {"company": "Amentum", "type": "direct", "url": "https://www.amentumcareers.com/search/?q=protection+security&sortColumn=referencedate&sortDirection=desc", "country": "USA"},
    {"company": "Ambrey", "type": "direct", "url": "https://ambrey.com/careers/", "country": "UK"},
    {"company": "Solace Global", "type": "direct", "url": "https://solaceglobal.com/careers-at-solace-global/", "country": "UK"},
    {"company": "Crisis24", "type": "direct", "url": "https://www.crisis24.com/en/careers", "country": "Canada"},
    {"company": "Healix International", "type": "direct", "url": "https://healix.com/careers/", "country": "UK"},
    {"company": "NEOM", "type": "direct", "url": "https://www.neom.com/en-us/careers", "country": "Saudi Arabia"},
    {"company": "Control Risks", "type": "direct", "url": "https://controlrisks.com/careers", "country": "UK"},
    {"company": "Gavin de Becker & Associates", "type": "direct", "url": "https://gdba.com/join-our-team", "country": "USA"},
    {"company": "TorchStone Global", "type": "direct", "url": "https://torchstoneglobal.com/contact-us/careers/", "country": "USA"},
    {"company": "AS Solution", "type": "direct", "url": "https://careers.assolution.com", "country": "Denmark"},
    {"company": "Pilgrims Group", "type": "direct", "url": "https://pilgrimsgroup.com/careers/", "country": "UK"},
    {"company": "ETS Risk Management", "type": "direct", "url": "https://ets-riskmanagement.com/careers/", "country": "USA"},
    {"company": "Neptune P2P Group", "type": "direct", "url": "https://neptunep2pgroup.com/careers/", "country": "UAE"},
    {"company": "Westminster Security", "type": "direct", "url": "https://westminstersecurity.co.uk/recruitment/", "country": "UK"},
    {"company": "Arcfyre International", "type": "direct", "url": "https://arcfyregroup.com/careers/", "country": "UK"},
    {"company": "Global Guardian", "type": "direct", "url": "https://www.globalguardian.com/careers", "country": "USA"},
    {"company": "Praetorian Security Group", "type": "direct", "url": "https://praetorian-sg.com/careers", "country": "UK"},
    {"company": "UCP Group", "type": "direct", "url": "https://www.ucp-group.com/recruitment", "country": "UK"},
    # New sources (2026-05-11)
    {"company": "Hart International", "type": "direct", "url": "https://hartinternational.com/careers/", "country": "UK"},
    {"company": "SOC LLC", "type": "direct", "url": "https://jobs.soc-usa.com/", "country": "USA"},
    {"company": "Kroll", "type": "direct", "url": "https://careers.kroll.com/en/listing-page", "country": "USA"},
    {"company": "Six Maritime", "type": "direct", "url": "https://www.sixmaritime.com/employment-opportunities/", "country": "USA"},
    {"company": "GardaWorld Federal", "type": "direct", "url": "https://garda-federal.com/careers/", "country": "USA"},
]

def scrape_greenhouse(company, board, country):
    """Scrape Greenhouse ATS job boards"""
    jobs = []
    url = f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs"
    data = fetch_json(url)
    if not data or "jobs" not in data:
        return jobs
    for j in data["jobs"]:
        title = j.get("title", "")
        if not is_cp_job(title):
            continue
        loc = ""
        if j.get("location", {}).get("name"):
            loc = j["location"]["name"]
        jobs.append({
            "title": clean(title),
            "company": company,
            "location": loc or country,
            "source": "Career Page",
            "source_url": j.get("absolute_url", ""),
            "country": guess_country(loc) or country,
            "salary": "",
            "notes": f"Direct from {company} careers (Greenhouse). ID: {j.get('id', '')}",
        })
    return jobs

def scrape_lever(company, board, country):
    """Scrape Lever ATS job boards"""
    jobs = []
    url = f"https://api.lever.co/v0/postings/{board}?mode=json"
    data = fetch_json(url)
    if not data:
        return jobs
    for j in data:
        title = j.get("text", "")
        if not is_cp_job(title):
            continue
        loc = j.get("categories", {}).get("location", "")
        jobs.append({
            "title": clean(title),
            "company": company,
            "location": loc or country,
            "source": "Career Page",
            "source_url": j.get("hostedUrl", ""),
            "country": guess_country(loc) or country,
            "salary": "",
            "notes": f"Direct from {company} careers (Lever).",
        })
    return jobs

def scrape_career_pages():
    """Scrape all company career pages"""
    log("=" * 60)
    log("SCRAPING COMPANY CAREER PAGES")
    all_jobs = []

    for cp in CAREER_PAGES:
        company = cp["company"]
        try:
            if cp["type"] == "greenhouse":
                jobs = scrape_greenhouse(company, cp["board"], cp["country"])
            elif cp["type"] == "lever":
                jobs = scrape_lever(company, cp["board"], cp["country"])
            else:
                # Direct pages — use HTML keyword search
                jobs = scrape_direct_career_page(company, cp["url"], cp["country"])

            if jobs:
                log(f"  {company}: {len(jobs)} CP/EP jobs found")
                all_jobs.extend(jobs)
            else:
                log(f"  {company}: 0 jobs (or no CP/EP match)")
        except Exception as e:
            log(f"  {company}: ERROR - {e}")
        time.sleep(1)  # Be polite

    log(f"  Career pages total: {len(all_jobs)} jobs")
    return all_jobs

def scrape_direct_career_page(company, url, country):
    """Scrape a direct career page by searching HTML for job titles"""
    jobs = []
    html = fetch(url)
    if not html:
        return jobs

    # Try to find job listing patterns in HTML
    # Common patterns: <a> tags with job titles, <h2>/<h3> with titles
    title_patterns = [
        r'<a[^>]*href="([^"]*)"[^>]*>\s*([^<]*(?:protection|security|bodyguard|cpo|ep\s)[^<]*)</a>',
        r'<h[23][^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>\s*([^<]+)</a>\s*</h[23]>',
        r'"title"\s*:\s*"([^"]*(?:protection|security|bodyguard)[^"]*)"[^}]*"url"\s*:\s*"([^"]*)"',
        r'"jobTitle"\s*:\s*"([^"]*)"',
    ]

    for pattern in title_patterns:
        matches = re.findall(pattern, html, re.IGNORECASE)
        for match in matches:
            if len(match) == 2:
                link, title = match
                if not link.startswith("http"):
                    title, link = match  # swap if reversed
            else:
                title = match[0] if match else ""
                link = url

            title = clean(title)
            if not title or not is_cp_job(title):
                continue

            if not link.startswith("http"):
                # Make relative URL absolute
                from urllib.parse import urljoin
                link = urljoin(url, link)

            jobs.append({
                "title": title,
                "company": company,
                "location": country,
                "source": "Career Page",
                "source_url": link,
                "country": country,
                "salary": "",
                "notes": f"Direct from {company} careers page.",
            })
    return jobs


# ============================================================
# SOURCE 2: GOVERNMENT CONTRACT SITES
# ============================================================

def scrape_contracts_finder_uk():
    """Scrape UK Contracts Finder for security contracts — uses search page + Playwright"""
    log("Scraping Contracts Finder UK...")
    jobs = []
    keywords = ["close protection", "executive protection", "protective services", "security guarding"]

    # OCDS endpoint works — fetch and filter for security-relevant tenders
    security_filters = ["security guard", "manned guard", "close protection", "protective",
                        "security service", "guard service", "static guard", "mobile patrol",
                        "security personnel", "security contract"]
    for search_term in ["security+guarding", "close+protection", "manned+security"]:
        try:
            url = f"https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search?keyword={search_term}"
            r = requests.get(url, headers={**HEADERS, "Accept": "application/json"}, timeout=20)
            if r.status_code != 200:
                log(f"  Contracts Finder HTTP {r.status_code}")
                continue

            data = r.json()
            releases = data.get("releases", [])

            for rel in releases:
                tender = rel.get("tender", {})
                title = tender.get("title", "")
                if not title:
                    continue
                # Only include security-relevant tenders
                title_lower = title.lower()
                if not any(kw in title_lower for kw in security_filters):
                    continue
                buyer = rel.get("buyer", {})
                buyer_name = buyer.get("name", "") if isinstance(buyer, dict) else "UK Government"
                notice_id = tender.get("id", rel.get("id", ""))
                ocid = rel.get("ocid", "")

                jobs.append({
                    "title": clean(title),
                    "company": clean(buyer_name) or "UK Government",
                    "location": "United Kingdom",
                    "source": "Contracts Finder UK",
                    "source_url": f"https://www.contractsfinder.service.gov.uk/Notice/{notice_id}" if notice_id else "",
                    "country": "UK",
                    "salary": "",
                    "notes": f"UK Government tender ({ocid}). Winning contractors hire operators.",
                })
        except Exception as e:
            log(f"  Contracts Finder error: {e}")
        time.sleep(1)

    # Deduplicate
    seen = set()
    unique = []
    for j in jobs:
        key = j["title"].lower()[:50]
        if key not in seen:
            seen.add(key)
            unique.append(j)

    log(f"  Contracts Finder UK: {len(unique)} security tenders")
    return unique

def scrape_sam_gov():
    """Scrape SAM.gov for security contract opportunities via Playwright (API deprecated)"""
    log("Scraping SAM.gov...")
    jobs = []
    keywords = ["executive+protection", "protective+services", "security+guard+services"]

    for kw in keywords:
        url = f"https://sam.gov/search/?keywords={kw}&sort=-modifiedDate&index=opp&is_active=true&page=1"
        html = fetch_with_browser(url, wait_time=8)
        if not html:
            continue

        # SAM.gov embeds data in JSON within the page
        titles = re.findall(r'"title"\s*:\s*"([^"]{10,200})"', html)
        sol_ids = re.findall(r'"solicitationNumber"\s*:\s*"([^"]+)"', html)
        notice_ids = re.findall(r'"noticeId"\s*:\s*"([^"]+)"', html)

        for i, title in enumerate(titles[:20]):
            title = clean(title)
            if not title:
                continue
            # Filter for security-relevant
            title_lower = title.lower()
            if not any(kw in title_lower for kw in ["protection", "security", "guard", "protective", "escort"]):
                continue
            if any(ex in title_lower for ex in ["data protection", "environmental", "cyber", "information"]):
                continue

            notice_id = notice_ids[i] if i < len(notice_ids) else ""
            sol_num = sol_ids[i] if i < len(sol_ids) else ""

            jobs.append({
                "title": title,
                "company": "US Government",
                "location": "USA",
                "source": "SAM.gov",
                "source_url": f"https://sam.gov/opp/{notice_id}/view" if notice_id else "",
                "country": "USA",
                "salary": "",
                "notes": f"US federal contract ({sol_num}). Winning contractors hire operators.",
            })
        time.sleep(2)

    log(f"  SAM.gov: {len(jobs)} opportunities")
    return jobs

def scrape_ted_eu():
    """Scrape TED (Tenders Electronic Daily) for EU security tenders"""
    log("Scraping TED EU tenders...")
    jobs = []
    keywords = ["close protection", "executive protection", "protective services", "security guarding"]

    for kw in keywords:
        # TED expert search API (v3)
        try:
            # Try the search endpoint with different URL patterns
            search_urls = [
                f"https://ted.europa.eu/api/v3.0/notices/search?q=%22{kw.replace(' ', '%20')}%22&pageSize=25&sortField=publication-date&sortOrder=desc",
                f"https://api.ted.europa.eu/v3/notices?q=%22{kw.replace(' ', '%20')}%22&limit=25",
            ]
            data = None
            for url in search_urls:
                data = fetch_json(url, headers={**HEADERS, "Accept": "application/json"})
                if data:
                    break

            if not data:
                # Fallback: scrape TED search results page with Playwright
                search_page = f"https://ted.europa.eu/en/search/result?q=%22{kw.replace(' ', '%20')}%22"
                html = fetch_with_browser(search_page, wait_time=6)
                if not html:
                    continue

                # Parse result cards from rendered HTML
                cards = re.findall(r'href="(/en/notice/-/detail/[^"]+)"[^>]*>([^<]+)</a>', html)
                if not cards:
                    cards = re.findall(r'href="([^"]*udl[^"]*)"[^>]*>\s*([^<]+)', html)
                for link, title in cards[:20]:
                    title = clean(title)
                    if not title or len(title) < 10:
                        continue
                    full_url = link if link.startswith("http") else f"https://ted.europa.eu{link}"
                    jobs.append({
                        "title": title,
                        "company": "EU Entity",
                        "location": "EU",
                        "source": "TED EU",
                        "source_url": full_url,
                        "country": "EU",
                        "salary": "",
                        "notes": f"EU public tender for {kw}. Winning contractors recruit operators.",
                    })
                continue

            # Parse API response — handle various response formats
            results = data.get("notices", data.get("results", data.get("items", [])))
            if isinstance(results, dict):
                results = results.get("notice", results.get("items", []))
            if not isinstance(results, list):
                log(f"  TED EU unexpected format: {list(data.keys())[:5]}")
                continue

            for r in results:
                title = ""
                for key in ["title-content", "title", "officialTitle", "name"]:
                    val = r.get(key)
                    if val:
                        title = val[0] if isinstance(val, list) else str(val)
                        break

                buyer = "EU Entity"
                for key in ["buyer-name", "buyer", "organisationName", "buyerName"]:
                    val = r.get(key)
                    if val:
                        buyer = val[0] if isinstance(val, list) else str(val)
                        break

                notice_id = r.get("notice-id", r.get("id", r.get("tedDocumentNumber", "")))
                link = f"https://ted.europa.eu/en/notice/-/detail/{notice_id}" if notice_id else ""

                jobs.append({
                    "title": clean(title) if title else f"Security tender: {kw}",
                    "company": clean(str(buyer)),
                    "location": "EU",
                    "source": "TED EU",
                    "source_url": link,
                    "country": "EU",
                    "salary": "",
                    "notes": f"EU public tender for {kw}. Winning contractors recruit operators.",
                })
        except Exception as e:
            log(f"  TED EU error for '{kw}': {e}")
        time.sleep(1)

    log(f"  TED EU: {len(jobs)} tenders")
    return jobs


# ============================================================
# SOURCE 3: UN / EMBASSY / IO CAREER PORTALS
# ============================================================

def scrape_un_careers():
    """Scrape UN Careers (careers.un.org) for security roles"""
    log("Scraping UN Careers...")
    jobs = []
    keywords = ["security", "protection", "safety"]

    for kw in keywords:
        url = f"https://careers.un.org/lbw/home.aspx?viewtype=SJ&exp=All&level=All&loc=All&occup=0025&syslang=EN"  # 0025 = Security
        html = fetch(url)
        if not html:
            continue

        # Parse UN career listings
        rows = re.findall(r'<tr[^>]*class="[^"]*jobList[^"]*"[^>]*>(.*?)</tr>', html, re.DOTALL)
        for row in rows:
            title_m = re.search(r'<a[^>]*href="([^"]*)"[^>]*>([^<]+)</a>', row)
            if not title_m:
                continue
            link, title = title_m.group(1), title_m.group(2)
            if not is_cp_job(title):
                continue

            loc_m = re.search(r'<td[^>]*>([^<]*(?:New York|Geneva|Vienna|Nairobi|Bangkok|Addis|Rome)[^<]*)</td>', row, re.IGNORECASE)
            loc = clean(loc_m.group(1)) if loc_m else ""

            if not link.startswith("http"):
                link = f"https://careers.un.org{link}"

            jobs.append({
                "title": clean(title),
                "company": "United Nations",
                "location": loc or "Various",
                "source": "UN Careers",
                "source_url": link,
                "country": guess_country(loc) or "International",
                "salary": "",
                "notes": "Direct from UN Careers portal (Security occupational group).",
            })
        break  # Only one search needed for security category

    log(f"  UN Careers: {len(jobs)} jobs")
    return jobs

def scrape_impactpool():
    """Scrape Impactpool for international security jobs — tries API first, then Playwright"""
    log("Scraping Impactpool...")
    jobs = []
    keywords = ["protection officer", "security officer", "close protection"]

    for kw in keywords:
        # Try Impactpool search API (JSON)
        api_url = f"https://www.impactpool.org/api/jobs?q={kw.replace(' ', '+')}&limit=25"
        data = fetch_json(api_url)
        if data and isinstance(data, list):
            for j in data:
                title = j.get("title", "")
                if not is_cp_job(title):
                    continue
                org = j.get("organization", j.get("company", "International Organization"))
                loc = j.get("location", j.get("city", ""))
                job_id = j.get("id", "")
                jobs.append({
                    "title": clean(title),
                    "company": clean(str(org)),
                    "location": clean(str(loc)) or "International",
                    "source": "Impactpool",
                    "source_url": f"https://www.impactpool.org/jobs/{job_id}" if job_id else "",
                    "country": guess_country(str(loc)) or "International",
                    "salary": "",
                    "notes": "International organization security role via Impactpool.",
                })
            continue

        # Fallback: Playwright
        url = f"https://www.impactpool.org/jobs?q={kw.replace(' ', '+')}"
        html = fetch_with_browser(url, wait_time=6)
        if not html:
            html = fetch(url)
        if not html:
            continue

        cards = re.findall(r'<a[^>]*href="(/jobs/\d+[^"]*)"[^>]*>\s*(?:<[^>]*>)*\s*([^<]+)</a>', html)
        if not cards:
            cards = re.findall(r'href="(/jobs/\d+[^"]*)"[^>]*>([^<]+)</a>', html)

        for link, title in cards:
            title = clean(title)
            if not is_cp_job(title):
                continue
            if not link.startswith("http"):
                link = f"https://www.impactpool.org{link}"
            jobs.append({
                "title": title,
                "company": "International Organization",
                "location": "International",
                "source": "Impactpool",
                "source_url": link,
                "country": "International",
                "salary": "",
                "notes": "International organization security role.",
            })
        time.sleep(1)

    log(f"  Impactpool: {len(jobs)} jobs")
    return jobs

def scrape_reliefweb():
    """Scrape ReliefWeb for humanitarian security roles via v2 API + Playwright fallback"""
    log("Scraping ReliefWeb...")
    jobs = []
    keywords = ["security officer", "protection officer", "security manager"]

    for kw in keywords:
        # ReliefWeb v2 API (v1 is decommissioned)
        api_url = "https://api.reliefweb.int/v2/jobs"
        try:
            r = requests.post(api_url, json={
                "query": {"value": kw},
                "filter": {"field": "status", "value": "active"},
                "fields": {"include": ["title", "url", "source.name", "country.name"]},
                "sort": ["date.created:desc"],
                "limit": 25,
            }, headers={**HEADERS, "Content-Type": "application/json"}, timeout=20)

            if r.status_code == 200:
                data = r.json()
                for item in data.get("data", []):
                    fields = item.get("fields", {})
                    title = fields.get("title", "")
                    if not is_cp_job(title):
                        continue

                    source = fields.get("source", [])
                    org = source[0].get("name", "Humanitarian Organization") if source else "Humanitarian Organization"
                    countries = fields.get("country", [])
                    location = ", ".join(c.get("name", "") for c in countries[:3]) if countries else "International"

                    jobs.append({
                        "title": clean(title),
                        "company": clean(org),
                        "location": location,
                        "source": "ReliefWeb",
                        "source_url": fields.get("url", ""),
                        "country": guess_country(location) or "International",
                        "salary": "",
                        "notes": "Humanitarian/NGO security role via ReliefWeb.",
                    })
                continue
            else:
                log(f"  ReliefWeb API HTTP {r.status_code}, trying Playwright...")
        except Exception as e:
            log(f"  ReliefWeb API error: {e}")

        # Fallback: Playwright
        url = f"https://reliefweb.int/jobs?search={kw.replace(' ', '+')}"
        html = fetch_with_browser(url, wait_time=6)
        if not html:
            continue

        cards = re.findall(r'href="(/job/[^"]+)"[^>]*>([^<]+)</a>', html)
        if not cards:
            cards = re.findall(r'href="(https://reliefweb\.int/job/[^"]+)"[^>]*>([^<]+)</a>', html)

        for link, title in cards:
            title = clean(title)
            if not is_cp_job(title):
                continue
            if not link.startswith("http"):
                link = f"https://reliefweb.int{link}"
            jobs.append({
                "title": title,
                "company": "Humanitarian Organization",
                "location": "International",
                "source": "ReliefWeb",
                "source_url": link,
                "country": "International",
                "salary": "",
                "notes": "Humanitarian/NGO security role via ReliefWeb.",
            })
        time.sleep(1)

    log(f"  ReliefWeb: {len(jobs)} jobs")
    return jobs


# ============================================================
# SOURCE 4: NICHE SECURITY JOB BOARDS
# ============================================================

def scrape_clearancejobs():
    """Scrape ClearanceJobs.com for cleared security roles via Playwright"""
    log("Scraping ClearanceJobs...")
    jobs = []
    keywords = ["executive+protection", "close+protection", "protective+services"]

    for kw in keywords:
        url = f"https://www.clearancejobs.com/jobs?keywords={kw}"
        html = fetch_with_browser(url, wait_time=6)
        if not html:
            html = fetch(url)
        if not html:
            continue

        # Parse job cards — multiple patterns
        cards = re.findall(r'<a[^>]*href="(/jobs/\d+[^"]*)"[^>]*[^>]*>([^<]+)</a>', html)
        if not cards:
            cards = re.findall(r'href="(/jobs/[^"]+)"[^>]*>([^<]*(?:protection|security|bodyguard)[^<]*)</a>', html, re.IGNORECASE)
        if not cards:
            # Try data attributes
            cards = re.findall(r'href="(/jobs/[^"]+)"[^>]*>\s*(?:<[^>]*>)*\s*([^<]+)', html)

        for link, title in cards:
            title = clean(title)
            if not is_cp_job(title):
                continue
            jobs.append({
                "title": title,
                "company": "ClearanceJobs Listing",
                "location": "USA",
                "source": "ClearanceJobs",
                "source_url": f"https://www.clearancejobs.com{link}",
                "country": "USA",
                "salary": "",
                "notes": "US security clearance required.",
            })
        time.sleep(1)

    log(f"  ClearanceJobs: {len(jobs)} jobs")
    return jobs

def scrape_security_cleared_jobs_uk():
    """Scrape SecurityClearedJobs.com for UK cleared roles via Playwright"""
    log("Scraping SecurityClearedJobs UK...")
    jobs = []

    url = "https://www.securityclearedjobs.com/search/?keywords=protection"
    html = fetch_with_browser(url, wait_time=6)
    if not html:
        html = fetch(url)
    if not html:
        log("  SecurityClearedJobs: no response")
        return jobs

    cards = re.findall(r'<a[^>]*href="(/job/[^"]+)"[^>]*>([^<]+)</a>', html)
    if not cards:
        cards = re.findall(r'href="(/job[^"]*)"[^>]*>\s*(?:<[^>]*>)*\s*([^<]+)', html)

    for link, title in cards:
        title = clean(title)
        if not is_cp_job(title):
            continue
        jobs.append({
            "title": title,
            "company": "SecurityClearedJobs Listing",
            "location": "United Kingdom",
            "source": "SecurityClearedJobs",
            "source_url": f"https://www.securityclearedjobs.com{link}",
            "country": "UK",
            "salary": "",
            "notes": "UK security clearance role.",
        })

    log(f"  SecurityClearedJobs: {len(jobs)} jobs")
    return jobs

def scrape_closecareer():
    """Scrape CloseCareer.com — dedicated CP job board"""
    log("Scraping CloseCareer...")
    jobs = []

    html = fetch("https://closecareer.com/jobs/")
    if not html:
        log("  CloseCareer: no response")
        return jobs

    # Parse job listings
    cards = re.findall(r'<a[^>]*href="(https?://closecareer\.com/job/[^"]+)"[^>]*>\s*([^<]+)</a>', html)
    if not cards:
        cards = re.findall(r'href="([^"]*job[^"]*)"[^>]*>([^<]*(?:protection|security|bodyguard|cpo)[^<]*)</a>', html, re.IGNORECASE)

    for link, title in cards:
        title = clean(title)
        if not title:
            continue
        jobs.append({
            "title": title,
            "company": "CloseCareer Listing",
            "location": "",
            "source": "CloseCareer",
            "source_url": link if link.startswith("http") else f"https://closecareer.com{link}",
            "country": "",
            "salary": "",
            "notes": "Dedicated close protection job board.",
        })

    log(f"  CloseCareer: {len(jobs)} jobs")
    return jobs

def scrape_unjobs():
    """Scrape UNjobs.org for close protection roles"""
    log("Scraping UNjobs.org...")
    jobs = []
    keywords = ["close-protection", "executive-protection", "security-officer", "protective-services"]

    for kw in keywords:
        html = fetch(f"https://unjobs.org/skills/{kw}")
        if not html:
            continue

        # Parse listings
        links = re.findall(r'<a[^>]*href="(https://unjobs\.org/vacancies/\d+)"[^>]*>([^<]+)</a>', html)
        for link, title in links:
            title = clean(title)
            # Try to find organization
            org_m = re.search(re.escape(f'</a>') + r'\s*</generic>\s*<text>([^<]+)', html)

            jobs.append({
                "title": title,
                "company": "International Organization",
                "location": "International",
                "source": "UNjobs",
                "source_url": link,
                "country": "International",
                "salary": "",
                "notes": "",
            })
        time.sleep(1)

    log(f"  UNjobs: {len(jobs)} jobs")
    return jobs


# ============================================================
# SOURCE 5: MARITIME SECURITY
# ============================================================

def scrape_maritime_security():
    """Scrape maritime security job sources"""
    log("Scraping Maritime Security sources...")
    jobs = []

    # MAST (Maritime Asset Security and Training)
    html = fetch("https://www.maboreal.com/careers")
    if html:
        cards = re.findall(r'href="([^"]*)"[^>]*>([^<]*(?:security|protection|maritime)[^<]*)</a>', html, re.IGNORECASE)
        for link, title in cards:
            if is_cp_job(title, "maritime"):
                jobs.append({
                    "title": clean(title),
                    "company": "MAST",
                    "location": "International",
                    "source": "Career Page",
                    "source_url": link if link.startswith("http") else f"https://www.maboreal.com{link}",
                    "country": "International",
                    "salary": "",
                    "notes": "Maritime security provider.",
                })

    # Diaplous maritime security
    html = fetch("https://diaplous.com/careers/")
    if html:
        cards = re.findall(r'href="([^"]*)"[^>]*>([^<]*(?:security|operator|protection)[^<]*)</a>', html, re.IGNORECASE)
        for link, title in cards:
            jobs.append({
                "title": clean(title),
                "company": "Diaplous",
                "location": "Greece / International",
                "source": "Career Page",
                "source_url": link if link.startswith("http") else f"https://diaplous.com{link}",
                "country": "Greece",
                "salary": "",
                "notes": "Maritime security provider.",
            })

    log(f"  Maritime sources: {len(jobs)} jobs")
    return jobs


# ============================================================
# SOURCE 6: GOOGLE NEWS — HIRING ANNOUNCEMENTS
# ============================================================

def scrape_google_news_hiring():
    """Search Google News for EP/CP hiring announcements"""
    log("Scraping Google News for hiring announcements...")
    jobs = []
    queries = [
        '"executive protection" hiring',
        '"close protection" recruiting',
        '"security company" "hiring" "bodyguard"',
    ]

    for q in queries:
        url = f"https://news.google.com/rss/search?q={requests.utils.quote(q)}&hl=en-US&gl=US&ceid=US:en"
        try:
            xml = fetch(url)
            if not xml:
                continue
            titles = re.findall(r'<title><!\[CDATA\[(.*?)\]\]></title>', xml)
            links = re.findall(r'<link>(https?://[^<]+)</link>', xml)

            for i, title in enumerate(titles[:10]):
                if is_cp_job(title):
                    jobs.append({
                        "title": clean(title),
                        "company": "News Mention",
                        "location": "",
                        "source": "Google News",
                        "source_url": links[i] if i < len(links) else "",
                        "country": "",
                        "salary": "",
                        "notes": "Hiring announcement found via Google News.",
                    })
        except Exception as e:
            log(f"  Google News error: {e}")
        time.sleep(1)

    log(f"  Google News: {len(jobs)} mentions")
    return jobs


# ============================================================
# SOURCE 7: RSS/ATOM FEED JOB BOARDS
# ============================================================

def scrape_rss_job_feeds():
    """Scrape RSS/Atom feeds from CP/EP job blogs and boards"""
    log("Scraping RSS job feeds...")
    jobs = []

    feeds = [
        # International Security Jobs blog — daily CP job posts
        {"name": "IntlSecurityJobs", "url": "https://internationalsecurityjobs.blogspot.com/feeds/posts/default", "type": "atom"},
        # EP Wired — EP industry + occasional job mentions
        {"name": "EP Wired", "url": "https://epwired.com/feed/", "type": "rss"},
        # OfficerList — EP career trends + job listings
        {"name": "OfficerList", "url": "https://officerlist.com/feed/", "type": "rss"},
    ]

    for feed in feeds:
        try:
            xml = fetch(feed["url"])
            if not xml:
                log(f"  {feed['name']}: no response")
                continue

            if feed["type"] == "atom":
                titles = re.findall(r"<title[^>]*>([^<]+)</title>", xml)
                links = re.findall(r'<link[^>]*href=["\']([^"\']+)["\'][^>]*rel=["\']alternate["\']', xml)
                if not links:
                    links = re.findall(r'<link[^>]*href=["\']([^"\']+)["\']', xml)
            else:
                titles = re.findall(r"<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>", xml)
                links = re.findall(r"<link>(https?://[^<]+)</link>", xml)

            count = 0
            for i, title in enumerate(titles[:20]):
                title = clean(title)
                if not title or title.lower() in ("comments", ""):
                    continue
                if is_cp_job(title):
                    jobs.append({
                        "title": title,
                        "company": f"Via {feed['name']}",
                        "location": "",
                        "source": feed["name"],
                        "source_url": links[i] if i < len(links) else "",
                        "country": "",
                        "salary": "",
                        "notes": f"Found via {feed['name']} RSS feed.",
                    })
                    count += 1
            log(f"  {feed['name']}: {count} CP jobs")
        except Exception as e:
            log(f"  {feed['name']}: ERROR - {e}")
        time.sleep(1)

    log(f"  RSS feeds total: {len(jobs)} jobs")
    return jobs


# ============================================================
# SOURCE 8: USAJobs API (free, no auth needed for search)
# ============================================================

def scrape_usajobs():
    """Scrape USAJobs.gov for federal protective security roles"""
    log("Scraping USAJobs...")
    jobs = []

    queries = [
        "protective security specialist",
        "executive protection",
        "security specialist protection",
        "force protection",
    ]

    for q in queries:
        url = f"https://data.usajobs.gov/api/search?Keyword={requests.utils.quote(q)}&ResultsPerPage=25"
        headers = {
            "Host": "data.usajobs.gov",
            "User-Agent": "strategioai@strategioai.com",
            "Authorization-Key": "rcDPwG36Wj8DQORcy3P/qFNj35A1Ta5AHjS/Q2v+plg=",
        }
        try:
            r = requests.get(url, headers=headers, timeout=15)
            if r.status_code != 200:
                log(f"  USAJobs '{q}': HTTP {r.status_code}")
                continue
            data = r.json()
            results = data.get("SearchResult", {}).get("SearchResultItems", [])
            for item in results:
                pos = item.get("MatchedObjectDescriptor", {})
                title = pos.get("PositionTitle", "")
                if not is_cp_job(title):
                    continue
                locs = pos.get("PositionLocation", [])
                loc = locs[0].get("CityName", "") + ", " + locs[0].get("CountrySubDivisionCode", "") if locs else ""
                salary_min = pos.get("PositionRemuneration", [{}])[0].get("MinimumRange", "") if pos.get("PositionRemuneration") else ""
                salary_max = pos.get("PositionRemuneration", [{}])[0].get("MaximumRange", "") if pos.get("PositionRemuneration") else ""
                salary = f"${salary_min}-${salary_max}/yr" if salary_min else ""
                org = pos.get("OrganizationName", "US Government")
                jobs.append({
                    "title": clean(title),
                    "company": org,
                    "location": clean(loc),
                    "source": "USAJobs",
                    "source_url": pos.get("PositionURI", ""),
                    "country": "USA",
                    "salary": salary,
                    "notes": f"Federal job via USAJobs. {pos.get('QualificationSummary', '')[:200]}",
                })
            log(f"  USAJobs '{q}': {len(results)} results, {sum(1 for r in results if is_cp_job(r.get('MatchedObjectDescriptor',{}).get('PositionTitle','')))} CP matches")
        except Exception as e:
            log(f"  USAJobs '{q}': ERROR - {e}")
        time.sleep(1)

    log(f"  USAJobs total: {len(jobs)} jobs")
    return jobs


# ============================================================
# SOURCE 9: JOOBLE AGGREGATOR
# ============================================================

def scrape_jooble():
    """Scrape Jooble via their free JSON API (POST to /api/)"""
    log("Scraping Jooble...")
    jobs = []

    queries = [
        {"keywords": "close protection", "location": ""},
        {"keywords": "executive protection", "location": ""},
        {"keywords": "bodyguard", "location": ""},
        {"keywords": "close protection officer", "location": "United Kingdom"},
        {"keywords": "executive protection agent", "location": "United States"},
    ]

    for q in queries:
        try:
            # Jooble has a free partner API at jooble.org/api/
            url = "https://jooble.org/api/"
            headers = {
                "Content-Type": "application/json",
                "User-Agent": HEADERS["User-Agent"],
            }
            payload = {
                "keywords": q["keywords"],
                "location": q["location"],
                "page": 1,
            }
            r = requests.post(url, headers=headers, json=payload, timeout=15)
            if r.status_code != 200:
                # Fallback: try scraping the search page HTML
                search_url = f"https://jooble.org/jobs-{q['keywords'].replace(' ', '-')}"
                html = fetch(search_url)
                if html:
                    # Extract from HTML - Jooble wraps jobs in header tags
                    page_titles = re.findall(r'<header[^>]*>.*?<a[^>]*>([^<]+)</a>', html, re.DOTALL)
                    if not page_titles:
                        page_titles = re.findall(r'"title"\s*:\s*"([^"]+)"', html)
                    for t in page_titles[:15]:
                        t = clean(t)
                        if is_cp_job(t):
                            jobs.append({
                                "title": t,
                                "company": "Via Jooble",
                                "location": q["location"] or "",
                                "source": "Jooble",
                                "source_url": search_url,
                                "country": guess_country(q["location"]) or "",
                                "salary": "",
                                "notes": "Aggregated via Jooble.",
                            })
                    log(f"  Jooble '{q['keywords']}': {len(page_titles)} results (HTML fallback)")
                    time.sleep(2)
                    continue

            data = r.json()
            results = data.get("jobs", [])
            count = 0
            for item in results[:20]:
                title = item.get("title", "")
                if not is_cp_job(title):
                    continue
                jobs.append({
                    "title": clean(title),
                    "company": clean(item.get("company", "Via Jooble")),
                    "location": clean(item.get("location", "")),
                    "source": "Jooble",
                    "source_url": item.get("link", ""),
                    "country": guess_country(item.get("location", "")) or "",
                    "salary": clean(item.get("salary", "")),
                    "notes": f"Aggregated via Jooble. {clean(item.get('snippet', ''))[:150]}",
                })
                count += 1
            log(f"  Jooble '{q['keywords']}': {count} CP jobs from {len(results)} results")
        except Exception as e:
            log(f"  Jooble '{q['keywords']}': ERROR - {e}")
        time.sleep(2)

    log(f"  Jooble total: {len(jobs)} jobs")
    return jobs


# ============================================================
# SOURCE 10: SEEK AUSTRALIA
# ============================================================

def scrape_seek_au():
    """Scrape SEEK.com.au for Australian CP/EP jobs"""
    log("Scraping SEEK Australia...")
    jobs = []

    urls = [
        "https://www.seek.com.au/close-protection-jobs",
        "https://www.seek.com.au/executive-protection-jobs",
        "https://www.seek.com.au/protective-services-officer-jobs",
    ]

    for url in urls:
        try:
            html = fetch_with_browser(url, wait_time=5)
            if not html:
                continue

            # SEEK uses data attributes and article cards
            titles = re.findall(r'data-automation="jobTitle"[^>]*>([^<]+)<', html)
            if not titles:
                titles = re.findall(r'aria-label="([^"]+)"[^>]*data-automation="jobTitle"', html)
            if not titles:
                titles = re.findall(r'<a[^>]*data-automation="jobTitle"[^>]*>([^<]+)</a>', html)

            companies_raw = re.findall(r'data-automation="jobCompany"[^>]*>([^<]+)<', html)
            locs = re.findall(r'data-automation="jobLocation"[^>]*>([^<]+)<', html)

            count = 0
            for i, title in enumerate(titles[:15]):
                title = clean(title)
                if not is_cp_job(title):
                    continue
                company = clean(companies_raw[i]) if i < len(companies_raw) else "Via SEEK"
                loc = clean(locs[i]) if i < len(locs) else ""
                jobs.append({
                    "title": title,
                    "company": company,
                    "location": loc,
                    "source": "SEEK AU",
                    "source_url": url,
                    "country": "Australia",
                    "salary": "",
                    "notes": f"Found on SEEK Australia.",
                })
                count += 1
            log(f"  SEEK '{url.split('/')[-1]}': {count} CP jobs")
        except Exception as e:
            log(f"  SEEK: ERROR - {e}")
        time.sleep(2)

    log(f"  SEEK AU total: {len(jobs)} jobs")
    return jobs


# ============================================================
# SOURCE 11: GISF NGO SECURITY VACANCIES
# ============================================================

def scrape_gisf():
    """Scrape GISF (Global Interagency Security Forum) vacancies"""
    log("Scraping GISF vacancies...")
    jobs = []

    try:
        html = fetch("https://gisf.ngo/vacancies/")
        if not html:
            return jobs

        # Find vacancy blocks
        blocks = re.findall(r'<h[23][^>]*>([^<]+)</h[23]>.*?<a[^>]*href="([^"]+)"', html, re.DOTALL)
        for title, link in blocks[:20]:
            title = clean(title)
            if not title or len(title) < 5:
                continue
            # GISF vacancies are all security-related
            if not link.startswith("http"):
                link = "https://gisf.ngo" + link
            jobs.append({
                "title": title,
                "company": "Via GISF",
                "location": "",
                "source": "GISF",
                "source_url": link,
                "country": "",
                "salary": "",
                "notes": "NGO security vacancy via GISF (Global Interagency Security Forum).",
            })
    except Exception as e:
        log(f"  GISF: ERROR - {e}")

    log(f"  GISF: {len(jobs)} vacancies")
    return jobs


# ============================================================
# SOURCE 12: CPWORLD FORUM VACANCIES
# ============================================================

def scrape_cpworld():
    """Scrape Close Protection World forum recruitment section"""
    log("Scraping CPWORLD forum...")
    jobs = []

    try:
        html = fetch_with_browser("https://www.closeprotectionworld.com/forum/forums/recruitment-and-vacancies.196/", wait_time=5)
        if not html:
            return jobs

        # Forum thread titles with links
        threads = re.findall(r'data-preview-url="[^"]*"[^>]*>([^<]+)</a>.*?href="([^"]+)"', html, re.DOTALL)
        if not threads:
            threads = re.findall(r'class="[^"]*structItem-title[^"]*"[^>]*>.*?<a[^>]*href="([^"]+)"[^>]*>([^<]+)</a>', html, re.DOTALL)
            threads = [(t, l) for l, t in threads]

        for title, link in threads[:20]:
            title = clean(title)
            if not title or len(title) < 5:
                continue
            if not link.startswith("http"):
                link = "https://www.closeprotectionworld.com" + link
            jobs.append({
                "title": title,
                "company": "Via CPWORLD Forum",
                "location": "",
                "source": "CPWORLD",
                "source_url": link,
                "country": "",
                "salary": "",
                "notes": "Vacancy posted on Close Protection World forum.",
            })
    except Exception as e:
        log(f"  CPWORLD: ERROR - {e}")

    log(f"  CPWORLD: {len(jobs)} threads")
    return jobs


# ============================================================
# SOURCE 13: iHireSecurity
# ============================================================

def scrape_ihiresecurity():
    """Scrape iHireSecurity for EP/bodyguard jobs using Playwright"""
    log("Scraping iHireSecurity...")
    jobs = []

    urls = [
        "https://www.ihiresecurity.com/t/executive-protection-jobs",
        "https://www.ihiresecurity.com/t/bodyguard-jobs",
        "https://www.ihiresecurity.com/t/close-protection-jobs",
    ]

    for url in urls:
        try:
            html = fetch_with_browser(url, wait_time=5)
            if not html:
                # Fallback to requests
                html = fetch(url)
            if not html:
                continue

            # Try multiple selector patterns — iHireSecurity changes HTML often
            titles = re.findall(r'"jobTitle"\s*:\s*"([^"]+)"', html)  # JSON-LD
            if not titles:
                titles = re.findall(r'<a[^>]*href="[^"]*job[^"]*"[^>]*>([^<]{10,80})</a>', html, re.IGNORECASE)
            if not titles:
                titles = re.findall(r'<h[23][^>]*>[^<]*(?:protection|security|bodyguard|guard)[^<]*</h[23]>', html, re.IGNORECASE)
                titles = [re.sub(r'<[^>]+>', '', t) for t in titles]

            # Extract companies and locations from JSON-LD if available
            companies_raw = re.findall(r'"hiringOrganization"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"', html)
            locs = re.findall(r'"jobLocation"\s*:\s*\{[^}]*"address"\s*:\s*\{[^}]*"addressLocality"\s*:\s*"([^"]+)"', html)

            # Fallback to HTML patterns
            if not companies_raw:
                companies_raw = re.findall(r'class="[^"]*(?:company|employer|org)[^"]*"[^>]*>([^<]+)<', html, re.IGNORECASE)
            if not locs:
                locs = re.findall(r'class="[^"]*(?:location|city|place)[^"]*"[^>]*>([^<]+)<', html, re.IGNORECASE)

            count = 0
            for i, title in enumerate(titles[:15]):
                title = clean(title)
                if not title or not is_cp_job(title):
                    continue
                company = clean(companies_raw[i]) if i < len(companies_raw) else "Via iHireSecurity"
                loc = clean(locs[i]) if i < len(locs) else ""
                jobs.append({
                    "title": title,
                    "company": company,
                    "location": loc,
                    "source": "iHireSecurity",
                    "source_url": url,
                    "country": "USA",
                    "salary": "",
                    "notes": "Found on iHireSecurity.",
                })
                count += 1
            log(f"  iHireSecurity '{url.split('/')[-1]}': {count} CP jobs from {len(titles)} total")
        except Exception as e:
            log(f"  iHireSecurity: ERROR - {e}")
        time.sleep(2)

    log(f"  iHireSecurity total: {len(jobs)} jobs")
    return jobs


# ============================================================
# DEDUPLICATION & INSERT
# ============================================================

def deduplicate(jobs):
    seen = set()
    unique = []
    for j in jobs:
        key = (j["title"].lower().strip(), j["company"].lower().strip(), j["source"])
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

def _days_ago(n):
    return (datetime.now() - timedelta(days=n)).strftime("%Y-%m-%d")


# ============================================================
# TELEGRAM NOTIFICATIONS
# ============================================================

TELEGRAM_BOT_TOKEN = "8647809461:AAGTsrtOCXyauEo5j74X_Cn6Jq3OeLw0Q8I"
TELEGRAM_CHAT_ID = "8790783341"

def send_telegram(text):
    """Send message to Telegram"""
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        r = requests.post(url, json={
            "chat_id": TELEGRAM_CHAT_ID,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }, timeout=10)
        return r.status_code == 200
    except:
        return False

def notify_new_jobs(jobs, total_new, total_db):
    """Post new jobs to Telegram"""
    if not jobs:
        return

    # Summary message
    source_counts = {}
    for j in jobs:
        src = j.get("source", "Unknown")
        source_counts[src] = source_counts.get(src, 0) + 1

    sources_text = "\n".join(f"  • {src}: {count}" for src, count in sorted(source_counts.items(), key=lambda x: -x[1]))

    summary = f"🟢 <b>CPO Leads — {total_new} nye jobber</b>\n\n{sources_text}\n\n📊 Totalt i database: {total_db}"
    send_telegram(summary)

    # Post each new job (max 15 to avoid spam)
    for j in jobs[:15]:
        title = j.get("title", "")
        company = j.get("company", "")
        location = j.get("location", "")
        salary = j.get("salary", "")
        source = j.get("source", "")
        url = j.get("source_url", "")

        msg = f"💼 <b>{title}</b>"
        if company:
            msg += f"\n🏢 {company}"
        if location:
            msg += f"\n📍 {location}"
        if salary:
            msg += f"\n💰 {salary}"
        if source:
            msg += f"\n📡 via {source}"
        if url:
            msg += f"\n🔗 <a href=\"{url}\">Apply</a>"

        send_telegram(msg)
        time.sleep(0.5)  # Rate limit

    if len(jobs) > 15:
        send_telegram(f"... og {len(jobs) - 15} flere jobber. Sjekk cpoleads.com 🔥")


# ============================================================
# MAIN
# ============================================================

def main():
    log("=" * 60)
    log("CPO LEADS — PREMIUM SOURCE SCRAPER")
    log("=" * 60)

    before = get_existing_count()
    log(f"Jobs in database before: {before}")

    all_jobs = []
    errors = []

    # 1. Company career pages
    try:
        all_jobs.extend(scrape_career_pages())
    except Exception as e:
        log(f"CAREER PAGES FAILED: {e}")
        errors.append(f"Career Pages: {e}")

    # 2. Government contracts
    try:
        all_jobs.extend(scrape_contracts_finder_uk())
    except Exception as e:
        log(f"CONTRACTS FINDER FAILED: {e}")
        errors.append(f"Contracts Finder: {e}")

    try:
        all_jobs.extend(scrape_sam_gov())
    except Exception as e:
        log(f"SAM.GOV FAILED: {e}")
        errors.append(f"SAM.gov: {e}")

    try:
        all_jobs.extend(scrape_ted_eu())
    except Exception as e:
        log(f"TED EU FAILED: {e}")
        errors.append(f"TED EU: {e}")

    # 3. UN / IO portals
    try:
        all_jobs.extend(scrape_un_careers())
    except Exception as e:
        log(f"UN CAREERS FAILED: {e}")
        errors.append(f"UN Careers: {e}")

    try:
        all_jobs.extend(scrape_impactpool())
    except Exception as e:
        log(f"IMPACTPOOL FAILED: {e}")
        errors.append(f"Impactpool: {e}")

    try:
        all_jobs.extend(scrape_reliefweb())
    except Exception as e:
        log(f"RELIEFWEB FAILED: {e}")
        errors.append(f"ReliefWeb: {e}")

    # 4. Niche boards
    try:
        all_jobs.extend(scrape_clearancejobs())
    except Exception as e:
        log(f"CLEARANCEJOBS FAILED: {e}")
        errors.append(f"ClearanceJobs: {e}")

    try:
        all_jobs.extend(scrape_security_cleared_jobs_uk())
    except Exception as e:
        log(f"SECURITYCLEAREDJOBS FAILED: {e}")
        errors.append(f"SecurityClearedJobs: {e}")

    try:
        all_jobs.extend(scrape_closecareer())
    except Exception as e:
        log(f"CLOSECAREER FAILED: {e}")
        errors.append(f"CloseCareer: {e}")

    try:
        all_jobs.extend(scrape_unjobs())
    except Exception as e:
        log(f"UNJOBS FAILED: {e}")
        errors.append(f"UNjobs: {e}")

    # 5. Maritime
    try:
        all_jobs.extend(scrape_maritime_security())
    except Exception as e:
        log(f"MARITIME FAILED: {e}")
        errors.append(f"Maritime: {e}")

    # 6. Google News hiring mentions
    try:
        all_jobs.extend(scrape_google_news_hiring())
    except Exception as e:
        log(f"GOOGLE NEWS FAILED: {e}")
        errors.append(f"Google News: {e}")

    # 7. RSS/Atom job feeds
    try:
        all_jobs.extend(scrape_rss_job_feeds())
    except Exception as e:
        log(f"RSS FEEDS FAILED: {e}")
        errors.append(f"RSS Feeds: {e}")

    # 8. USAJobs federal security
    try:
        all_jobs.extend(scrape_usajobs())
    except Exception as e:
        log(f"USAJOBS FAILED: {e}")
        errors.append(f"USAJobs: {e}")

    # 9. Jooble aggregator
    try:
        all_jobs.extend(scrape_jooble())
    except Exception as e:
        log(f"JOOBLE FAILED: {e}")
        errors.append(f"Jooble: {e}")

    # 10. SEEK Australia
    try:
        all_jobs.extend(scrape_seek_au())
    except Exception as e:
        log(f"SEEK AU FAILED: {e}")
        errors.append(f"SEEK AU: {e}")

    # 11. GISF NGO security
    try:
        all_jobs.extend(scrape_gisf())
    except Exception as e:
        log(f"GISF FAILED: {e}")
        errors.append(f"GISF: {e}")

    # 12. CPWORLD forum
    try:
        all_jobs.extend(scrape_cpworld())
    except Exception as e:
        log(f"CPWORLD FAILED: {e}")
        errors.append(f"CPWORLD: {e}")

    # 13. iHireSecurity
    try:
        all_jobs.extend(scrape_ihiresecurity())
    except Exception as e:
        log(f"IHIRESECURITY FAILED: {e}")
        errors.append(f"iHireSecurity: {e}")

    # Deduplicate & insert
    unique = deduplicate(all_jobs)
    log(f"Total scraped: {len(all_jobs)} | Unique: {len(unique)}")

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
    log(f"  Sources scraped: 20+")
    log(f"  Total found: {len(all_jobs)}")
    log(f"  Unique: {len(unique)}")
    log(f"  New jobs added: {new_jobs}")
    log(f"  Total in database: {after}")
    log(f"  Errors: {len(errors)}")
    if errors:
        for e in errors:
            log(f"    - {e}")
    log("=" * 60)

    # Notify Telegram with new jobs
    if new_jobs > 0:
        log("Sending to Telegram...")
        notify_new_jobs(unique[:new_jobs], new_jobs, after)
        log("Telegram notifications sent")
    else:
        send_telegram(f"📡 CPO Leads scrape done — 0 nye jobber. Database: {after} totalt.")


if __name__ == "__main__":
    try:
        main()
    finally:
        close_browser()
