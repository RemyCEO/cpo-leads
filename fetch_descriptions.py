"""Fetch missing job descriptions from source URLs and update Supabase."""
import json
import time
import re
import requests

SUPABASE_URL = "https://afrcpiheobzauwyftksr.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmcmNwaWhlb2J6YXV3eWZ0a3NyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODE1MzMwNSwiZXhwIjoyMDkzNzI5MzA1fQ.s4pyLPAiFswQ426enQpmWqYYoohrHBTnSUmwrquE3XA"

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
}

def clean_text(text):
    """Clean scraped text."""
    text = re.sub(r'\s+', ' ', text).strip()
    text = re.sub(r'cookie|privacy policy|terms of use|sign in|log in|create account|accept all', '', text, flags=re.IGNORECASE)
    return text[:1000] if len(text) > 1000 else text

def fetch_description(url, source):
    """Fetch job description from URL."""
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
        resp = requests.get(url, headers=headers, timeout=15, allow_redirects=True)
        if resp.status_code != 200:
            return None

        html = resp.text

        # Try to extract job description from common patterns
        desc = None

        # Meta description
        meta = re.search(r'<meta[^>]*name=["\']description["\'][^>]*content=["\']([^"\']+)', html, re.IGNORECASE)
        if meta and len(meta.group(1)) > 50:
            desc = meta.group(1)

        # OG description
        if not desc or len(desc) < 50:
            og = re.search(r'<meta[^>]*property=["\']og:description["\'][^>]*content=["\']([^"\']+)', html, re.IGNORECASE)
            if og and len(og.group(1)) > 50:
                desc = og.group(1)

        # JSON-LD structured data
        if not desc or len(desc) < 80:
            jsonld = re.findall(r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', html, re.DOTALL | re.IGNORECASE)
            for jl in jsonld:
                try:
                    data = json.loads(jl)
                    if isinstance(data, list):
                        data = data[0]
                    if data.get('description') and len(data['description']) > 50:
                        desc = data['description']
                        break
                    if data.get('jobPosting', {}).get('description'):
                        desc = data['jobPosting']['description']
                        break
                except:
                    pass

        # Common job description selectors - extract text between tags
        if not desc or len(desc) < 80:
            patterns = [
                r'class=["\'][^"\']*job.?description[^"\']*["\'][^>]*>(.*?)</(?:div|section)',
                r'class=["\'][^"\']*description.?content[^"\']*["\'][^>]*>(.*?)</(?:div|section)',
                r'id=["\']job.?description["\'][^>]*>(.*?)</(?:div|section)',
                r'class=["\'][^"\']*posting.?description[^"\']*["\'][^>]*>(.*?)</(?:div|section)',
            ]
            for pat in patterns:
                match = re.search(pat, html, re.DOTALL | re.IGNORECASE)
                if match:
                    text = re.sub(r'<[^>]+>', ' ', match.group(1))
                    text = clean_text(text)
                    if len(text) > 80:
                        desc = text
                        break

        if desc:
            # Strip HTML tags
            desc = re.sub(r'<[^>]+>', ' ', desc)
            desc = clean_text(desc)
            return desc if len(desc) > 30 else None

        return None
    except Exception as e:
        print(f"  Error: {e}")
        return None

def update_notes(job_id, notes):
    """Update job notes in Supabase."""
    url = f"{SUPABASE_URL}/rest/v1/job_listings?id=eq.{job_id}"
    resp = requests.patch(url, headers=HEADERS, json={"notes": notes})
    return resp.status_code < 300

def main():
    with open('jobs_to_scrape.json', encoding='utf-8') as f:
        jobs = json.load(f)

    print(f"Fetching descriptions for {len(jobs)} jobs...\n")

    success = 0
    failed = 0

    for i, job in enumerate(jobs):
        print(f"[{i+1}/{len(jobs)}] {job['title'][:60]}")
        print(f"  URL: {job['url'][:80]}")

        desc = fetch_description(job['url'], job['source'])

        if desc and len(desc) > 30:
            if update_notes(job['id'], desc):
                print(f"  OK Updated ({len(desc)} chars)")
                success += 1
            else:
                print(f"  FAIL DB update failed")
                failed += 1
        else:
            print(f"  SKIP No description found")
            failed += 1

        time.sleep(1)  # Rate limit

    print(f"\nDone! Updated: {success}, Failed: {failed}")

if __name__ == '__main__':
    main()
