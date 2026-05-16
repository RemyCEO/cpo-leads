"""Audit ALL job listings: check URLs are alive + flag expired/missing data."""
import requests
import json
import time
import sys
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

SUPABASE_URL = 'https://afrcpiheobzauwyftksr.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmcmNwaWhlb2J6YXV3eWZ0a3NyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODE1MzMwNSwiZXhwIjoyMDkzNzI5MzA1fQ.s4pyLPAiFswQ426enQpmWqYYoohrHBTnSUmwrquE3XA'
HEADERS_SB = {'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'}
HEADERS_WEB = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'}

# Fetch all jobs
print("Fetching all jobs...")
r = requests.get(
    f'{SUPABASE_URL}/rest/v1/job_listings?select=id,title,company,location,country,notes,source_url,source,scraped_at,created_at',
    headers=HEADERS_SB
)
jobs = r.json()
print(f"Total jobs: {len(jobs)}")

# --- 0. Remove military/jooble/article jobs that shouldn't be here ---
MILITARY_ORGS = ['national guard', 'air force', 'navy', 'marine corps', 'usaf',
                 'department of defense', 'army', 'naval facilities', 'air mobility command']
ARTICLE_WORDS = ['how much', 'how to', 'what is', 'guide to', 'tips for', 'please read before']

auto_delete = []
for j in jobs:
    company = (j.get('company') or '').lower()
    title = (j.get('title') or '').lower()
    url = (j.get('source_url') or '').lower()
    source = (j.get('source') or '').lower()
    # Military
    if any(org in company for org in MILITARY_ORGS) or 'usajobs.gov' in url or 'title 32' in title:
        auto_delete.append((j, 'MILITARY'))
    # Jooble
    elif 'jooble' in source or 'jooble' in url:
        auto_delete.append((j, 'JOOBLE'))
    # Articles
    elif any(w in title for w in ARTICLE_WORDS) or title.endswith('?'):
        auto_delete.append((j, 'ARTICLE'))

if auto_delete:
    print(f"\n=== AUTO-REMOVE ({len(auto_delete)} bad entries) ===")
    for j, reason in auto_delete:
        print(f"  [{reason}] {j['title'][:50]}")
    if '--delete' in sys.argv:
        for j, reason in auto_delete:
            requests.delete(f"{SUPABASE_URL}/rest/v1/job_listings?id=eq.{j['id']}", headers=HEADERS_SB)
        print(f"  Deleted {len(auto_delete)} entries")
    # Remove from jobs list for further checks
    auto_ids = {j['id'] for j, _ in auto_delete}
    jobs = [j for j in jobs if j['id'] not in auto_ids]

# --- 1. Missing data check ---
no_url = [j for j in jobs if not j.get('source_url')]
no_notes = [j for j in jobs if not j.get('notes')]
no_country = [j for j in jobs if not j.get('country')]
bad_urls = [j for j in jobs if j.get('source_url') in ['cpoleads.com', 'https://cpoleads.com/', 'https://cpoleads.com']]

print(f"\n=== MISSING DATA ===")
print(f"No URL: {len(no_url)}")
for j in no_url:
    print(f"  {j['title'][:60]} ({j['source']})")
print(f"No notes: {len(no_notes)}")
print(f"No country: {len(no_country)}")
print(f"Bad URLs (cpoleads.com): {len(bad_urls)}")
for j in bad_urls:
    print(f"  {j['title'][:60]}")

# --- 2. Age check ---
now = datetime.utcnow()
old_30 = []
old_60 = []
for j in jobs:
    date_str = j.get('scraped_at') or j.get('created_at') or ''
    if not date_str:
        continue
    try:
        d = datetime.fromisoformat(date_str.replace('Z', '+00:00').replace('+00:00', ''))
    except:
        try:
            d = datetime.strptime(date_str[:19], '%Y-%m-%dT%H:%M:%S')
        except:
            continue
    age = (now - d).days
    if age > 60:
        old_60.append((j, age))
    elif age > 30:
        old_30.append((j, age))

print(f"\n=== AGE CHECK ===")
print(f"30-60 days old: {len(old_30)}")
print(f"60+ days old: {len(old_60)}")
for j, age in old_60[:10]:
    print(f"  [{age}d] {j['title'][:50]} ({j['source']})")

# --- 3. URL check (parallel) ---
print(f"\n=== CHECKING URLs ({len(jobs)} jobs) ===")
jobs_with_url = [j for j in jobs if j.get('source_url') and j['source_url'] not in ['cpoleads.com', 'https://cpoleads.com/', 'https://cpoleads.com']]

# Group by domain to avoid hammering same server
from urllib.parse import urlparse
domains = {}
for j in jobs_with_url:
    try:
        d = urlparse(j['source_url']).netloc
    except:
        d = 'unknown'
    if d not in domains:
        domains[d] = 0
    domains[d] += 1

print(f"Unique domains: {len(domains)}")
for d, c in sorted(domains.items(), key=lambda x: -x[1])[:10]:
    print(f"  {d}: {c}")

dead_urls = []
redirect_urls = []
checked = 0
errors = 0

def check_url(job):
    url = job['source_url']
    try:
        r = requests.head(url, headers=HEADERS_WEB, timeout=10, allow_redirects=True)
        final = r.url
        status = r.status_code
        # If HEAD fails, try GET
        if status >= 400:
            r = requests.get(url, headers=HEADERS_WEB, timeout=10, allow_redirects=True, stream=True)
            status = r.status_code
            final = r.url
            r.close()
        return (job, status, final)
    except requests.exceptions.Timeout:
        return (job, 0, 'TIMEOUT')
    except requests.exceptions.ConnectionError:
        return (job, 0, 'CONNECTION_ERROR')
    except Exception as e:
        return (job, 0, str(e)[:50])

# Check in parallel (10 threads, be polite)
print(f"\nChecking {len(jobs_with_url)} URLs...")
with ThreadPoolExecutor(max_workers=10) as executor:
    futures = {executor.submit(check_url, j): j for j in jobs_with_url}
    for future in as_completed(futures):
        checked += 1
        job, status, final = future.result()
        if status == 0:
            dead_urls.append((job, 'ERROR', final))
            errors += 1
        elif status >= 400:
            dead_urls.append((job, status, final))
        elif status in [301, 302, 308] or (final and 'expired' in final.lower()):
            redirect_urls.append((job, status, final))
        if checked % 50 == 0:
            print(f"  Checked {checked}/{len(jobs_with_url)}...")

print(f"\n=== URL RESULTS ===")
print(f"Checked: {checked}")
print(f"Dead/Error: {len(dead_urls)}")
print(f"Redirects: {len(redirect_urls)}")

# Categorize dead URLs
print(f"\n--- DEAD URLs (to delete) ---")
delete_ids = []
for job, status, info in dead_urls:
    reason = f"HTTP {status}" if status else info[:30]
    print(f"  [{reason}] {job['title'][:50]} | {job['source_url'][:60]}")
    delete_ids.append(job['id'])

# Also add jobs with no URL and bad URLs
for j in no_url + bad_urls:
    if j['id'] not in delete_ids:
        delete_ids.append(j['id'])
        print(f"  [NO URL] {j['title'][:50]}")

# Save results
results = {
    'total': len(jobs),
    'checked': checked,
    'dead_count': len(dead_urls),
    'no_url_count': len(no_url),
    'bad_url_count': len(bad_urls),
    'old_60_count': len(old_60),
    'old_30_count': len(old_30),
    'delete_ids': delete_ids,
    'dead_details': [(j['id'], j['title'][:60], j['source'], str(s), i[:80]) for j, s, i in dead_urls],
}
with open('audit_results.json', 'w') as f:
    json.dump(results, f, indent=2, ensure_ascii=False)

print(f"\n=== SUMMARY ===")
print(f"Total jobs: {len(jobs)}")
print(f"URLs checked: {checked}")
print(f"Dead/broken URLs: {len(dead_urls)}")
print(f"Missing URL: {len(no_url)}")
print(f"Bad URL (cpoleads.com): {len(bad_urls)}")
print(f"60+ days old: {len(old_60)}")
print(f"30-60 days old: {len(old_30)}")
print(f"\nTotal candidates for deletion: {len(delete_ids)}")
print(f"Results saved to audit_results.json")
print(f"\nRun with --delete to remove dead jobs")

if '--delete' in sys.argv and delete_ids:
    print(f"\n--- DELETING {len(delete_ids)} dead jobs ---")
    headers_del = {'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'}
    deleted = 0
    for i in range(0, len(delete_ids), 50):
        batch = delete_ids[i:i+50]
        r = requests.delete(
            f"{SUPABASE_URL}/rest/v1/job_listings?id=in.({','.join(batch)})",
            headers=headers_del
        )
        if r.status_code in [200, 204]:
            deleted += len(batch)
    print(f"Deleted: {deleted}")
