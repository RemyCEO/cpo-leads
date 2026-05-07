#!/usr/bin/env python3
"""
CPO Leads Daily Scraper
Scrapes close protection / executive protection job listings from multiple sources.
Run: python daily_scraper.py [--dry-run]
"""

import requests
from bs4 import BeautifulSoup
import json
import time
import random
import os
import sys
import logging
from datetime import datetime, date
from pathlib import Path

BASE_DIR = Path(__file__).parent
LISTINGS_FILE = BASE_DIR / "new_listings.json"
LOG_FILE = BASE_DIR / "scraper.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(LOG_FILE, encoding="utf-8")
    ]
)
log = logging.getLogger("cpo_scraper")

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
]

def get_headers():
    return {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }

def delay():
    time.sleep(random.uniform(2.0, 4.0))

def load_existing():
    if LISTINGS_FILE.exists():
        with open(LISTINGS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []

def save_listings(listings):
    with open(LISTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(listings, f, indent=2, ensure_ascii=False)

def deduplicate(listings):
    seen = set()
    unique = []
    for l in listings:
        key = l.get("url", "") or l.get("title", "") + l.get("company", "")
        if key and key not in seen:
            seen.add(key)
            unique.append(l)
    return unique

# === SCRAPERS ===

def scrape_silent_professionals():
    """Scrape Silent Professionals job listings."""
    log.info("Scraping Silent Professionals...")
    listings = []
    try:
        url = "https://silentprofessionals.org/jobs/"
        resp = requests.get(url, headers=get_headers(), timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        # Look for job listing links
        for link in soup.find_all("a", href=True):
            href = link.get("href", "")
            text = link.get_text(strip=True)
            if "/jobs/" in href and href != url and text and len(text) > 10:
                if any(kw in text.lower() for kw in ["protection", "security", "ep ", "psd", "cp ", "surveillance", "maritime"]):
                    listings.append({
                        "title": text,
                        "company": "Silent Professionals",
                        "location": "",
                        "salary": "",
                        "url": href if href.startswith("http") else "https://silentprofessionals.org" + href,
                        "source": "Silent Professionals",
                        "date_found": date.today().isoformat(),
                    })
        log.info(f"  Found {len(listings)} listings from Silent Professionals")
    except Exception as e:
        log.error(f"  Silent Professionals failed: {e}")
    return listings

def scrape_gdba_greenhouse():
    """Scrape GDBA Greenhouse job board."""
    log.info("Scraping GDBA (Greenhouse)...")
    listings = []
    try:
        url = "https://boards.greenhouse.io/gavindebackerassociates"
        resp = requests.get(url, headers=get_headers(), timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        for opening in soup.select(".opening"):
            title_el = opening.select_one("a")
            location_el = opening.select_one(".location")
            if title_el:
                href = title_el.get("href", "")
                listings.append({
                    "title": title_el.get_text(strip=True),
                    "company": "Gavin de Becker & Associates",
                    "location": location_el.get_text(strip=True) if location_el else "",
                    "salary": "",
                    "url": "https://boards.greenhouse.io" + href if href.startswith("/") else href,
                    "source": "GDBA Greenhouse",
                    "date_found": date.today().isoformat(),
                })
        log.info(f"  Found {len(listings)} listings from GDBA")
    except Exception as e:
        log.error(f"  GDBA Greenhouse failed: {e}")
    return listings

def scrape_gardaworld():
    """Scrape GardaWorld international jobs."""
    log.info("Scraping GardaWorld...")
    listings = []
    try:
        url = "https://jobs.garda.com/go/International-Jobs/7695900/"
        resp = requests.get(url, headers=get_headers(), timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        for row in soup.select("tr.data-row, .jobTitle-link, a[href*='/job/']"):
            text = row.get_text(strip=True)
            href = row.get("href", "") or ""
            if not href:
                link = row.find("a", href=True)
                if link:
                    href = link.get("href", "")
                    text = link.get_text(strip=True)
            if href and any(kw in text.lower() for kw in ["protection", "security", "cp ", "cpo"]):
                listings.append({
                    "title": text[:100],
                    "company": "GardaWorld",
                    "location": "",
                    "salary": "",
                    "url": href if href.startswith("http") else "https://jobs.garda.com" + href,
                    "source": "GardaWorld",
                    "date_found": date.today().isoformat(),
                })
        log.info(f"  Found {len(listings)} listings from GardaWorld")
    except Exception as e:
        log.error(f"  GardaWorld failed: {e}")
    return listings

def scrape_impactpool():
    """Scrape Impactpool security jobs."""
    log.info("Scraping Impactpool...")
    listings = []
    try:
        url = "https://www.impactpool.org/search?q=security+officer&category=Security&sort=newest"
        resp = requests.get(url, headers=get_headers(), timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        for card in soup.select("a[href*='/jobs/']"):
            title = card.get_text(strip=True)
            href = card.get("href", "")
            if title and len(title) > 5 and "security" in title.lower():
                listings.append({
                    "title": title[:120],
                    "company": "Via Impactpool",
                    "location": "",
                    "salary": "",
                    "url": href if href.startswith("http") else "https://www.impactpool.org" + href,
                    "source": "Impactpool",
                    "date_found": date.today().isoformat(),
                })
        log.info(f"  Found {len(listings)} listings from Impactpool")
    except Exception as e:
        log.error(f"  Impactpool failed: {e}")
    return listings

def scrape_reliefweb():
    """Scrape ReliefWeb safety & security jobs via API."""
    log.info("Scraping ReliefWeb...")
    listings = []
    try:
        api_url = "https://api.reliefweb.int/v1/jobs?appname=cpoleads&filter[field]=theme.name&filter[value]=Safety and Security&sort[]=date:desc&limit=20"
        resp = requests.get(api_url, headers=get_headers(), timeout=15)
        resp.raise_for_status()
        data = resp.json()

        for item in data.get("data", []):
            fields = item.get("fields", {})
            listings.append({
                "title": fields.get("title", ""),
                "company": fields.get("source", [{}])[0].get("name", "") if fields.get("source") else "",
                "location": ", ".join(c.get("name", "") for c in fields.get("country", [])),
                "salary": "",
                "url": fields.get("url_alias", "") or f"https://reliefweb.int/job/{item.get('id', '')}",
                "source": "ReliefWeb",
                "date_found": date.today().isoformat(),
            })
        log.info(f"  Found {len(listings)} listings from ReliefWeb")
    except Exception as e:
        log.error(f"  ReliefWeb failed: {e}")
    return listings

def scrape_reed():
    """Scrape Reed.co.uk for close protection jobs."""
    log.info("Scraping Reed.co.uk...")
    listings = []
    try:
        url = "https://www.reed.co.uk/jobs/close-protection-officer-jobs"
        resp = requests.get(url, headers=get_headers(), timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        for article in soup.select("article, .job-result-card, [data-qa='job-card']"):
            title_el = article.find("a", href=True)
            if title_el:
                title = title_el.get_text(strip=True)
                href = title_el.get("href", "")
                salary_el = article.select_one(".job-salary, .salary")
                location_el = article.select_one(".job-location, .location")
                if any(kw in title.lower() for kw in ["protection", "security", "cpo", "bodyguard"]):
                    listings.append({
                        "title": title,
                        "company": "Via Reed",
                        "location": location_el.get_text(strip=True) if location_el else "",
                        "salary": salary_el.get_text(strip=True) if salary_el else "",
                        "url": href if href.startswith("http") else "https://www.reed.co.uk" + href,
                        "source": "Reed.co.uk",
                        "date_found": date.today().isoformat(),
                    })
        log.info(f"  Found {len(listings)} listings from Reed")
    except Exception as e:
        log.error(f"  Reed failed: {e}")
    return listings

# === MAIN ===

def main():
    dry_run = "--dry-run" in sys.argv
    log.info(f"=== CPO Leads Daily Scraper — {date.today()} {'(DRY RUN)' if dry_run else ''} ===")

    existing = load_existing()
    existing_urls = {l.get("url") for l in existing if l.get("url")}
    log.info(f"Existing listings: {len(existing)}")

    all_new = []
    scrapers = [
        scrape_silent_professionals,
        scrape_gdba_greenhouse,
        scrape_gardaworld,
        scrape_impactpool,
        scrape_reliefweb,
        scrape_reed,
    ]

    for scraper in scrapers:
        try:
            results = scraper()
            new = [r for r in results if r.get("url") not in existing_urls]
            all_new.extend(new)
            if new:
                log.info(f"  → {len(new)} NEW listings")
            delay()
        except Exception as e:
            log.error(f"Scraper {scraper.__name__} crashed: {e}")

    all_new = deduplicate(all_new)
    log.info(f"\nTotal new listings found: {len(all_new)}")

    if all_new and not dry_run:
        combined = all_new + existing
        save_listings(combined)
        log.info(f"Saved {len(combined)} total listings to {LISTINGS_FILE}")

    # Generate daily report
    report_file = BASE_DIR / f"daily_report_{date.today()}.txt"
    report = [
        f"CPO Leads Daily Report — {date.today()}",
        f"{'='*50}",
        f"New listings found: {len(all_new)}",
        f"Total in database: {len(existing) + len(all_new)}",
        "",
    ]

    for l in all_new:
        report.append(f"[{l['source']}] {l['title']}")
        if l.get("location"): report.append(f"  Location: {l['location']}")
        if l.get("salary"): report.append(f"  Salary: {l['salary']}")
        report.append(f"  URL: {l['url']}")
        report.append("")

    if not all_new:
        report.append("No new listings found today.")

    if not dry_run:
        with open(report_file, "w", encoding="utf-8") as f:
            f.write("\n".join(report))
        log.info(f"Report saved to {report_file}")
    else:
        print("\n".join(report))

    log.info("Done.")

if __name__ == "__main__":
    main()
