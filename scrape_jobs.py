"""
CPO Leads — Daily Job Scraper
Scrapes LinkedIn, Indeed, and Silent Professionals for EP/CP jobs.
Inserts new listings into Supabase job_listings table.

Run: python scrape_jobs.py
Schedule: Windows Task Scheduler every 12 hours
"""

import requests
import re
import json
from datetime import datetime

SUPABASE_URL = "https://afrcpiheobzauwyftksr.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmcmNwaWhlb2J6YXV3eWZ0a3NyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODE1MzMwNSwiZXhwIjoyMDkzNzI5MzA1fQ.s4pyLPAiFswQ426enQpmWqYYoohrHBTnSUmwrquE3XA"

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

def scrape_linkedin():
    """Scrape LinkedIn public job listings API"""
    jobs = []
    keywords = [
        "%22executive+protection%22",
        "%22close+protection%22",
        "%22bodyguard%22+security",
        "%22protective+operations%22",
    ]
    for kw in keywords:
        try:
            url = f"https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords={kw}&sortBy=DD&start=0"
            r = requests.get(url, headers=HEADERS, timeout=15)
            if r.status_code != 200:
                continue
            html = r.text
            # Parse job cards
            pattern = r'<a[^>]*href="(https://[^"]*linkedin\.com/jobs/view/[^"?]+)[^"]*"[^>]*>[\s\S]*?<span[^>]*class="[^"]*sr-only[^"]*">([^<]+)</span>'
            company_pattern = r'<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>\s*<a[^>]*>([^<]+)</a>'
            location_pattern = r'<span[^>]*class="[^"]*job-search-card__location[^"]*">([^<]+)</span>'

            titles = re.findall(r'<span class="sr-only">([^<]+)</span>', html)
            companies = re.findall(company_pattern, html)
            locations = re.findall(location_pattern, html)
            urls = re.findall(r'href="(https://[^"]*linkedin\.com/jobs/view/\d+)', html)

            for i in range(min(len(titles), len(companies))):
                title = titles[i].strip() if i < len(titles) else ""
                company = companies[i].strip() if i < len(companies) else ""
                location = locations[i].strip() if i < len(locations) else ""
                link = urls[i] if i < len(urls) else ""
                if title and company:
                    jobs.append({
                        "title": title,
                        "company": company,
                        "location": location,
                        "source": "LinkedIn",
                        "source_url": link,
                        "country": guess_country(location),
                    })
        except Exception as e:
            print(f"LinkedIn error for {kw}: {e}")
    return jobs

def scrape_indeed():
    """Scrape Indeed for EP/CP jobs"""
    jobs = []
    try:
        url = 'https://www.indeed.com/jobs?q=%22executive+protection%22+OR+%22close+protection%22+OR+%22bodyguard%22&sort=date&fromage=3'
        r = requests.get(url, headers=HEADERS, timeout=15)
        if r.status_code != 200:
            return jobs
        html = r.text
        titles = re.findall(r'<span[^>]*id="jobTitle-[^"]*"[^>]*>([^<]+)</span>', html)
        companies = re.findall(r'<span[^>]*data-testid="company-name"[^>]*>([^<]+)</span>', html)
        locations = re.findall(r'<div[^>]*data-testid="text-location"[^>]*>([^<]+)</div>', html)

        for i in range(len(titles)):
            title = titles[i].strip()
            company = companies[i].strip() if i < len(companies) else ""
            location = locations[i].strip() if i < len(locations) else ""
            if title:
                jobs.append({
                    "title": title,
                    "company": company,
                    "location": location,
                    "source": "Indeed",
                    "source_url": "https://www.indeed.com",
                    "country": guess_country(location),
                })
    except Exception as e:
        print(f"Indeed error: {e}")
    return jobs

def scrape_silent_professionals():
    """Scrape Silent Professionals job board"""
    jobs = []
    try:
        url = "https://silentprofessionals.org/jobs/?search_keywords=executive+protection"
        r = requests.get(url, headers=HEADERS, timeout=15)
        if r.status_code != 200:
            return jobs
        html = r.text
        matches = re.findall(r'<a[^>]*href="(https://silentprofessionals\.org/jobs/[^"]+)"[^>]*>\s*([^<]+)\s*</a>', html)
        for url, title in matches:
            title = title.strip()
            if title and len(title) > 5 and "Silent" not in title and "Home" not in title and "Page" not in title:
                jobs.append({
                    "title": title,
                    "company": "Silent Professionals",
                    "location": "",
                    "source": "Silent Professionals",
                    "source_url": url,
                    "country": "",
                })
    except Exception as e:
        print(f"Silent Professionals error: {e}")
    return jobs

def guess_country(location):
    loc = location.lower()
    if any(x in loc for x in ["london", "surrey", "uk", "manchester", "birmingham"]):
        return "UK"
    if any(x in loc for x in ["dubai", "uae", "abu dhabi", "qatar", "saudi"]):
        return "UAE"
    if re.search(r'\b[A-Z]{2}\b', location) and any(x in loc for x in [", ca", ", ny", ", tx", ", fl", ", wa", ", dc", ", il", ", va"]):
        return "USA"
    if any(x in loc for x in ["singapore"]):
        return "Singapore"
    return ""

def insert_to_supabase(jobs):
    """Insert jobs to Supabase, ignoring duplicates"""
    if not jobs:
        print("No jobs to insert")
        return

    url = f"{SUPABASE_URL}/rest/v1/job_listings"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=ignore-duplicates,return=minimal"
    }

    # Insert in batches of 20
    for i in range(0, len(jobs), 20):
        batch = jobs[i:i+20]
        try:
            r = requests.post(url, headers=headers, json=batch, timeout=15)
            if r.status_code in (200, 201):
                print(f"  Inserted batch {i//20+1}: {len(batch)} jobs")
            elif r.status_code == 409:
                print(f"  Batch {i//20+1}: all duplicates (already exists)")
            else:
                print(f"  Batch {i//20+1} error {r.status_code}: {r.text[:200]}")
        except Exception as e:
            print(f"  Insert error: {e}")

def main():
    print(f"=== CPO Leads Job Scraper — {datetime.now().strftime('%Y-%m-%d %H:%M')} ===")

    all_jobs = []

    print("Scraping LinkedIn...")
    linkedin = scrape_linkedin()
    print(f"  Found {len(linkedin)} jobs")
    all_jobs.extend(linkedin)

    print("Scraping Indeed...")
    indeed = scrape_indeed()
    print(f"  Found {len(indeed)} jobs")
    all_jobs.extend(indeed)

    print("Scraping Silent Professionals...")
    sp = scrape_silent_professionals()
    print(f"  Found {len(sp)} jobs")
    all_jobs.extend(sp)

    # Deduplicate
    seen = set()
    unique = []
    for j in all_jobs:
        key = (j["title"].lower(), j["company"].lower(), j["source"])
        if key not in seen:
            seen.add(key)
            unique.append(j)

    print(f"\nTotal unique jobs: {len(unique)}")

    print("Inserting to Supabase...")
    insert_to_supabase(unique)

    print("Done!")

if __name__ == "__main__":
    main()
