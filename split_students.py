#!/usr/bin/env python3
"""
LWS Pune — NDA Maths Tracker
Student data split script

Usage:
    python split_students.py          # run manually
    npm run split                     # same, via npm
    npm run deploy                    # runs split + build + gh-pages automatically

Reads:  data/faculty-data.json  (written by the app in dev mode — primary data source)
        students_db.json        (for mobile number → login hash mapping)
        teacher_password.txt    (optional — if present, db.json is AES-256-GCM encrypted)
Writes: public/data/index.json
        public/data/students/lws-001.json ...
        public/data/db.json    (encrypted if teacher_password.txt exists, else plain JSON)
        data/faculty-data.json  (updates lastDeployedAt timestamp on success)

Encryption dependency (only needed when teacher_password.txt exists):
    pip install cryptography
"""

import base64
import json
import hashlib
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# ── Config ────────────────────────────────────────────────────
DB_FILE               = Path('data/faculty-data.json')
STUDENTS_DB_FILE      = Path('students_db.json')
OUTPUT_DIR            = Path('public/data')
STUDENTS_DIR          = OUTPUT_DIR / 'students'
INDEX_FILE            = OUTPUT_DIR / 'index.json'
DB_JSON_FILE          = OUTPUT_DIR / 'db.json'
TEACHER_PASSWORD_FILE = Path('teacher_password.txt')

PBKDF2_ITERATIONS = 100_000

# ── Pure helpers ─────────────────────────────────────────────

_DB_EXCLUDE = frozenset({
    'apiKey', 'costLog', 'savedInsights',
    'uploadModalOpen', 'activePage', 'activeStudent', 'hydrated',
})

def build_db_payload(db: dict) -> dict:
    """Return a sanitized copy of faculty-data suitable for the teacher view."""
    return {k: v for k, v in db.items() if k not in _DB_EXCLUDE}


def encrypt_db_payload(payload: dict, password: str) -> dict:
    """
    Encrypt the db payload with AES-256-GCM using a PBKDF2-derived key.

    Returns a dict with keys: encrypted, salt, iv, data (all base64-encoded).
    The browser decrypts this using Web Crypto API with the same password.
    Requires: pip install cryptography
    """
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
        from cryptography.hazmat.primitives import hashes as crypto_hashes
    except ImportError:
        print('❌  cryptography package not found.')
        print('    Run: pip install cryptography')
        sys.exit(1)

    salt  = os.urandom(16)
    kdf   = PBKDF2HMAC(
        algorithm=crypto_hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=PBKDF2_ITERATIONS,
    )
    key        = kdf.derive(password.strip().encode())
    iv         = os.urandom(12)
    aesgcm     = AESGCM(key)
    plaintext  = json.dumps(payload, ensure_ascii=False).encode()
    ciphertext = aesgcm.encrypt(iv, plaintext, None)

    return {
        'encrypted': True,
        'salt': base64.b64encode(salt).decode(),
        'iv':   base64.b64encode(iv).decode(),
        'data': base64.b64encode(ciphertext).decode(),
    }


# ── Helpers ───────────────────────────────────────────────────
def hash_mobile(mobile):
    m = str(mobile).strip().replace(' ', '').replace('-', '')
    if m.startswith('+91'): m = m[3:]
    if m.startswith('91') and len(m) == 12: m = m[2:]
    return hashlib.sha256(m.encode()).hexdigest()

def bigram_similarity(a, b):
    def bigrams(s):
        return set(s[i:i+2] for i in range(len(s) - 1))
    ba, bb = bigrams(a), bigrams(b)
    if not ba or not bb:
        return 0
    return len(ba & bb) / len(ba | bb)

def student_filename(lws_id):
    return lws_id.lower().replace(' ', '-') + '.json'

# ── Main ──────────────────────────────────────────────────────
def main():
    # Load data/faculty-data.json
    if not DB_FILE.exists():
        print(f"❌  {DB_FILE} not found.")
        print("    Start the app with 'npm run dev', add at least one exam, then re-run this script.")
        sys.exit(1)

    with open(DB_FILE, encoding='utf-8') as f:
        db = json.load(f)

    if db is None:
        print(f"❌  {DB_FILE} is empty. Open the app, add exams, then re-run.")
        sys.exit(1)

    exams            = db.get('exams', [])
    student_profiles = db.get('studentProfiles', {})
    nda_freq         = db.get('ndaFreq', [])

    if not exams:
        print(f"⚠️  No exams in {DB_FILE}. Add exams in the app first.")
        sys.exit(0)

    # ── Load students_db.json ──────────────────────────────────
    mobile_map  = {}   # lwsId → hashed mobile
    name_to_lws = {}   # lowercase name/variant → lwsId
    lws_to_info = {}   # lwsId → { name, batches, gender, ... }

    if not STUDENTS_DB_FILE.exists():
        print(f"⚠️  {STUDENTS_DB_FILE} not found.")
        print("    Students won't be able to log in (no mobile hashes to match against).")
    else:
        with open(STUDENTS_DB_FILE, encoding='utf-8') as f:
            sdb = json.load(f)
        students_list = sdb if isinstance(sdb, list) else sdb.get('students', [])

        for s in students_list:
            lws_id   = s.get('lws_id', '').strip()
            canon    = (s.get('canonical_name', '') or s.get('name', '')).strip()
            mobile   = str(s.get('mobile') or '').strip()
            variants = [v.strip() for v in (s.get('name_variants', []) or []) if v]

            if not lws_id or not canon:
                continue

            lws_to_info[lws_id] = {
                'name':          canon,
                'gender':        s.get('gender', ''),
                'dob':           s.get('dob', ''),
                'branch':        s.get('branch', ''),
                'batches':       s.get('batches', []),
                'accountStatus': s.get('account_status', ''),
                'regDate':       s.get('registration_date', ''),
            }

            for nm in [canon] + variants:
                if nm:
                    name_to_lws[nm.lower()] = lws_id

            if mobile:
                mobile_map[lws_id] = hash_mobile(mobile)

        print(f"✅  Loaded {len(mobile_map)} mobile numbers from {STUDENTS_DB_FILE}")
        print(f"    {len(name_to_lws)} name variants indexed")

    # ── Get all unique student names from exams ────────────────
    all_names = set()
    for exam in exams:
        for s in exam.get('students', []):
            name = s.get('name', '').strip()
            if name:
                all_names.add(name)

    print(f"\n📊  Found {len(exams)} exams · {len(all_names)} unique students")

    # ── LWS ID lookup with fuzzy fallback ─────────────────────
    def get_lws_id(name):
        lws = name_to_lws.get(name.lower())
        if lws:
            return lws, 'exact'

        best_lws, best_score = None, 0
        for variant, lws_id in name_to_lws.items():
            score = bigram_similarity(name.lower(), variant)
            if score > best_score:
                best_score = score
                best_lws   = lws_id

        if best_score >= 0.5:
            return best_lws, f'fuzzy({best_score:.2f})'

        return 'tmp-' + hashlib.md5(name.encode()).hexdigest()[:8], 'no_match'

    # ── Generate per-student files ────────────────────────────
    STUDENTS_DIR.mkdir(parents=True, exist_ok=True)

    index      = []
    generated  = 0
    no_mobile  = []
    match_log  = []

    for name in sorted(all_names):
        lws_id, match_method = get_lws_id(name)
        info = lws_to_info.get(lws_id, {})

        match_log.append({
            'exam_name': name,
            'lws_id':    lws_id,
            'method':    match_method,
            'db_name':   info.get('name', ''),
        })

        student_exams = []
        for exam in exams:
            record = next(
                (s for s in exam.get('students', [])
                 if s.get('name', '').strip() == name),
                None
            )
            if not record:
                continue
            student_exams.append({
                'id':        exam['id'],
                'name':      exam['name'],
                'date':      exam['date'],
                'subject':   exam.get('subject', 'Maths'),
                'batch':     exam.get('batch'),
                'marking':   exam['marking'],
                'questions': exam.get('questions', []),
                'students':  [record],
            })

        if not student_exams:
            continue

        filename = student_filename(lws_id)
        out_path = STUDENTS_DIR / filename
        student_data = {
            'name':    name,
            'lwsId':   lws_id,
            'profile': {
                'name':          info.get('name', name),
                'lwsId':         lws_id,
                'gender':        info.get('gender', ''),
                'dob':           info.get('dob', ''),
                'branch':        info.get('branch', ''),
                'batches':       info.get('batches', []),
                'accountStatus': info.get('accountStatus', ''),
                'regDate':       info.get('regDate', ''),
            },
            'exams':   student_exams,
            'ndaFreq': nda_freq,
        }
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(student_data, f, ensure_ascii=False, separators=(',', ':'))

        mobile_hash = mobile_map.get(lws_id, '')
        if mobile_hash:
            index.append({
                'lwsId':      lws_id,
                'name':       info.get('name', name),
                'mobileHash': mobile_hash,
                'file':       filename,
            })
        else:
            no_mobile.append(name)

        generated += 1

    # Write index.json
    with open(INDEX_FILE, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, separators=(',', ':'))

    # Write db.json — encrypted if teacher_password.txt exists, else plain JSON
    db_payload = build_db_payload(db)
    if TEACHER_PASSWORD_FILE.exists():
        password   = TEACHER_PASSWORD_FILE.read_text(encoding='utf-8')
        db_output  = encrypt_db_payload(db_payload, password)
        print(f'🔒  db.json encrypted with teacher password → {DB_JSON_FILE}')
    else:
        db_output  = db_payload
        print(f'ℹ️   teacher_password.txt not found — db.json written as plain JSON (teacher login disabled)')

    with open(DB_JSON_FILE, 'w', encoding='utf-8') as f:
        json.dump(db_output, f, ensure_ascii=False, separators=(',', ':'))

    # ── Stamp lastDeployedAt in faculty-data.json ─────────────
    # The app reads this on next load to determine if data is stale.
    if generated > 0:
        deployed_at = datetime.now(timezone.utc).isoformat()
        db['lastDeployedAt'] = deployed_at
        with open(DB_FILE, 'w', encoding='utf-8') as f:
            json.dump(db, f, ensure_ascii=False, separators=(',', ':'))
        print(f"\n🕐  Stamped lastDeployedAt = {deployed_at}")

    # ── Summary ───────────────────────────────────────────────
    print(f"\n✅  Generated {generated} student files → {STUDENTS_DIR}/")
    print(f"✅  Index written → {INDEX_FILE} ({len(index)} students can log in)\n")

    print("📋  Name matching log:")
    print(f"  {'Exam name':<30} {'LWS ID':<12} {'Method':<18} {'DB name':<25} {'Mobile'}")
    print(f"  {'-'*30} {'-'*12} {'-'*18} {'-'*25} {'-'*8}")
    for m in match_log:
        flag   = '⚠️ ' if m['method'] == 'no_match' else '✅ ' if m['method'] == 'exact' else '🔶 '
        mobile = '✅ yes' if mobile_map.get(m['lws_id']) else '❌ no'
        print(f"  {flag}{m['exam_name']:<28} {m['lws_id']:<12} {m['method']:<18} {m['db_name']:<25} {mobile}")

    if no_mobile:
        print(f"\n⚠️  {len(no_mobile)} students have no mobile → can't log in:")
        for n in no_mobile:
            print(f"    · {n}")

    if generated > 0:
        print(f"\n🚀  Student files ready. Run 'npm run deploy' to push to GitHub Pages.\n")
    else:
        print(f"\n⚠️  No files generated — check name matching above.\n")
        sys.exit(1)


if __name__ == '__main__':
    main()
