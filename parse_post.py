"""
CPO Leads — Smart LinkedIn Post Parser
Paste a LinkedIn post text and it auto-extracts job details and inserts to Supabase.

Usage: python parse_post.py
       Then paste the post text and press Enter twice.

Or:    python parse_post.py "paste the entire post here"
"""

import re
import sys
import requests
from datetime import datetime

SUPABASE_URL = "https://afrcpiheobzauwyftksr.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmcmNwaWhlb2J6YXV3eWZ0a3NyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODE1MzMwNSwiZXhwIjoyMDkzNzI5MzA1fQ.s4pyLPAiFswQ426enQpmWqYYoohrHBTnSUmwrquE3XA"

CITIES = {
    "london": "UK", "dubai": "UAE", "abu dhabi": "UAE", "riyadh": "Saudi Arabia",
    "doha": "Qatar", "new york": "USA", "los angeles": "USA", "miami": "USA",
    "washington": "USA", "singapore": "Singapore", "paris": "France",
    "johannesburg": "South Africa", "nairobi": "Kenya", "lagos": "Nigeria",
    "brussels": "Belgium", "geneva": "Switzerland", "monaco": "Monaco",
    "berlin": "Germany", "madrid": "Spain", "rome": "Italy",
    "sydney": "Australia", "hong kong": "Hong Kong", "tokyo": "Japan",
    "bogota": "Colombia", "mexico city": "Mexico", "sao paulo": "Brazil",
    "accra": "Ghana", "kampala": "Uganda", "addis ababa": "Ethiopia",
}

def parse_post(text):
    """Extract job details from a LinkedIn post"""
    lines = text.strip().split('\n')
    result = {"title": "", "company": "", "location": "", "country": "", "salary": "", "source_url": "", "notes": ""}

    # Extract Title — look for "Title:" or first prominent line
    for line in lines:
        line = line.strip()
        if re.match(r'^Title:\s*(.+)', line, re.IGNORECASE):
            result["title"] = re.match(r'^Title:\s*(.+)', line, re.IGNORECASE).group(1).strip()
            break
        # Check for role-like first lines
        if not result["title"] and len(line) > 5 and any(kw in line.lower() for kw in ["director", "manager", "officer", "agent", "specialist", "protection", "security", "cpo", "team lead"]):
            result["title"] = line.strip()

    # Extract Location
    for line in lines:
        m = re.match(r'^Location:\s*(.+)', line, re.IGNORECASE)
        if m:
            result["location"] = m.group(1).strip()
            break
    if not result["location"]:
        for city, country in CITIES.items():
            if city in text.lower():
                result["location"] = city.title()
                result["country"] = country
                break

    # Extract Country from location
    if not result["country"] and result["location"]:
        loc_lower = result["location"].lower()
        for city, country in CITIES.items():
            if city in loc_lower:
                result["country"] = country
                break

    # Extract Salary
    for line in lines:
        m = re.match(r'^Salary:\s*(.+)', line, re.IGNORECASE)
        if m:
            result["salary"] = m.group(1).strip()
            break
    if not result["salary"]:
        sal = re.search(r'(\$[\d,]+[Kk]?(?:\s*[-–]\s*\$[\d,]+[Kk]?)?(?:/(?:yr|year|day|month))?|£[\d,]+[Kk]?(?:\s*[-–]\s*£[\d,]+[Kk]?)?|Executive Package[^.]*|[\d,]+\s*(?:per day|/day|per annum|p\.a\.))', text, re.IGNORECASE)
        if sal:
            result["salary"] = sal.group(1).strip()

    # Extract Apply URL
    urls = re.findall(r'https?://[^\s<>"\')\]]+', text)
    for u in urls:
        if 'linkedin.com' not in u:  # Prefer non-LinkedIn apply links
            result["source_url"] = u.rstrip('.')
            break
    if not result["source_url"] and urls:
        result["source_url"] = urls[0].rstrip('.')

    # Extract Sector/Company
    for line in lines:
        m = re.match(r'^(?:Sector|Company|Client|Employer):\s*(.+)', line, re.IGNORECASE)
        if m:
            result["company"] = m.group(1).strip()
            break
    if not result["company"]:
        # Look for company-like patterns
        m = re.search(r'(?:at|for|with|@)\s+([A-Z][A-Za-z\s&]+(?:Ltd|Inc|Corp|Group|Security|Services|International)?)', text)
        if m:
            result["company"] = m.group(1).strip()

    if not result["company"]:
        result["company"] = "LinkedIn Post"

    # Build notes from the full text (first 300 chars of description)
    desc_start = 0
    for i, line in enumerate(lines):
        if line.strip().startswith(('We seek', 'We are', 'The Role', 'About', 'Key ', 'Responsibilities', 'Requirements', 'The successful')):
            desc_start = i
            break
    desc = ' '.join(lines[desc_start:]).strip()
    result["notes"] = desc[:300] if desc else text[:300]

    return result

def insert_job(job):
    """Insert parsed job to Supabase"""
    payload = {
        "title": job["title"],
        "company": job["company"],
        "location": job["location"],
        "country": job["country"],
        "salary": job["salary"],
        "source": "LinkedIn Posts",
        "source_url": job["source_url"],
        "notes": job["notes"],
    }

    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/job_listings",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=ignore-duplicates,return=minimal"
        },
        json=payload,
        timeout=10
    )
    return r.status_code in (200, 201)

def main():
    if len(sys.argv) > 1:
        text = ' '.join(sys.argv[1:])
    else:
        print("Paste LinkedIn post text (press Enter twice when done):")
        lines = []
        empty_count = 0
        while True:
            try:
                line = input()
                if line == "":
                    empty_count += 1
                    if empty_count >= 2:
                        break
                else:
                    empty_count = 0
                lines.append(line)
            except EOFError:
                break
        text = '\n'.join(lines)

    if not text.strip():
        print("No text provided.")
        return

    print("\nParsing...")
    job = parse_post(text)

    print(f"\n  Title:    {job['title']}")
    print(f"  Company:  {job['company']}")
    print(f"  Location: {job['location']}")
    print(f"  Country:  {job['country']}")
    print(f"  Salary:   {job['salary']}")
    print(f"  Apply:    {job['source_url']}")
    print(f"  Notes:    {job['notes'][:100]}...")

    if not job['title']:
        print("\nCould not extract a job title. Skipping.")
        return

    print("\nInserting to Supabase...")
    if insert_job(job):
        print("Done! Job added to CPO Leads.")
    else:
        print("Error inserting job.")

if __name__ == "__main__":
    main()
