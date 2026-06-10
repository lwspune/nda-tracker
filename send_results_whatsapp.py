"""
send_results_whatsapp.py — WhatsApp exam results to students and parents via Wabridge.

Usage:
  python -X utf8 send_results_whatsapp.py [--exam "Exam Name"] [--dry-run] [--to 9876543210]

Credentials in .env.local:
  WABRIDGE_APP_KEY=27849ef7-0293-4d6c-9fe7-ff7810c2a823
  WABRIDGE_AUTH_KEY=6203b29c1a8592f34bc4e0a7226c3e9f3a83efe531a584d977
  WABRIDGE_DEVICE_ID=679e0938e32d04d46930dcb9
  WABRIDGE_TEMPLATE_ID=1757579868958595
"""

import argparse
import json
import os
import re
import sys
import urllib.request
from datetime import datetime

FACULTY_DATA = "data/faculty-data.json"
STUDENTS_DB  = "students_db.json"
TRACKER_BASE = "https://nda-tracker.vercel.app/"
WABRIDGE_URL = "https://web.wabridge.com/api/createmessage"


def _load_env_local():
    try:
        with open('.env.local', encoding='utf-8') as f:
            for line in f:
                m = re.match(r'^([A-Z_]+)=(.*)', line.strip())
                if m and m.group(1) not in os.environ:
                    os.environ[m.group(1)] = m.group(2).strip()
    except FileNotFoundError:
        pass

_load_env_local()


def load_data():
    if not os.path.exists(FACULTY_DATA):
        sys.exit(f"ERROR: {FACULTY_DATA} not found. Run the dev server first.")
    with open(FACULTY_DATA, encoding='utf-8') as f:
        return json.load(f)


def load_students_db():
    if not os.path.exists(STUDENTS_DB):
        sys.exit(f"ERROR: {STUDENTS_DB} not found.")
    with open(STUDENTS_DB, encoding='utf-8') as f:
        return json.load(f)


def pick_exam(data, exam_name=None):
    exams = data.get('exams', [])
    if not exams:
        sys.exit("ERROR: No exams found.")
    if exam_name:
        matches = [e for e in exams if e.get('name', '').strip().lower() == exam_name.strip().lower()]
        if not matches:
            available = "\n  ".join(e.get('name', '') for e in exams)
            sys.exit(f"ERROR: Exam '{exam_name}' not found. Available:\n  {available}")
        return matches[0]
    return sorted(exams, key=lambda e: e.get('date', ''), reverse=True)[0]


def normalise_mobile(mobile):
    """Return 12-digit international format (91XXXXXXXXXX), or None if unrecognised."""
    m = re.sub(r'\D', '', str(mobile or ''))
    if m.startswith('0') and len(m) == 11:
        m = '91' + m[1:]
    if len(m) == 10:
        m = '91' + m
    if m.startswith('91') and len(m) == 12:
        return m
    return None


LOG_FILE = 'whatsapp_send_log.jsonl'


def _log_payload(payload_dict, response=None):
    entry = {'payload': payload_dict}
    if response is not None:
        entry['response'] = response
    try:
        with open(LOG_FILE, encoding='utf-8') as f:
            lines = f.readlines()
    except FileNotFoundError:
        lines = []
    lines.append(json.dumps(entry, ensure_ascii=False) + '\n')
    if len(lines) > 500:
        lines = lines[-500:]
    with open(LOG_FILE, 'w', encoding='utf-8') as f:
        f.writelines(lines)


def send_whatsapp(app_key, auth_key, device_id, template_id, destination, params, dry_run):
    """Send one WhatsApp message. Returns (ok: bool, detail: str)."""
    payload_dict = {
        'app-key':            app_key,
        'auth-key':           auth_key,
        'destination_number': destination,
        'device_id':          device_id,
        'template_id':        template_id,
        'variables':          params,
    }

    if dry_run:
        _log_payload(payload_dict, response='DRY-RUN')
        return True, f'DRY-RUN params={params}'

    payload = json.dumps(payload_dict).encode()

    try:
        req = urllib.request.Request(
            WABRIDGE_URL,
            data=payload,
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read())
        _log_payload(payload_dict, response=result)
        if result.get('status'):
            return True, str(result.get('data', {}).get('messageid', 'ok'))
        return False, result.get('message', 'Unknown error')
    except Exception as e:
        _log_payload(payload_dict, response={'error': str(e)})
        return False, str(e)


def _rows(exam):
    return exam.get('students', exam.get('results', []))


def fmt_date(date_str):
    try:
        d = datetime.strptime(date_str, '%Y-%m-%d')
        return f"{d.day} {d.strftime('%B %Y')}"
    except ValueError:
        return date_str


def main():
    parser = argparse.ArgumentParser(description='WhatsApp exam results to students and parents.')
    parser.add_argument('--exam',        help='Exam name (default: latest)')
    parser.add_argument('--dry-run',     action='store_true', help='Print messages, do not send')
    parser.add_argument('--to',          help='Send test to this mobile number (uses first student data)')
    parser.add_argument('--redirect-to', help='Send all messages to this number instead of actual student/parent numbers')
    parser.add_argument('--students',    help='Comma-separated student names to process (default: all)')
    args = parser.parse_args()

    redirect_to = normalise_mobile(args.redirect_to) if args.redirect_to else None
    if args.redirect_to and not redirect_to:
        sys.exit(f"ERROR: Cannot normalise --redirect-to '{args.redirect_to}'")

    app_key     = os.environ.get('WABRIDGE_APP_KEY',     '')
    auth_key    = os.environ.get('WABRIDGE_AUTH_KEY',    '')
    device_id   = os.environ.get('WABRIDGE_DEVICE_ID',  '')
    template_id = os.environ.get('WABRIDGE_TEMPLATE_ID','')

    if not args.dry_run:
        missing = [k for k, v in [
            ('WABRIDGE_APP_KEY', app_key), ('WABRIDGE_AUTH_KEY', auth_key),
            ('WABRIDGE_DEVICE_ID', device_id), ('WABRIDGE_TEMPLATE_ID', template_id),
        ] if not v]
        if missing:
            sys.exit(
                f"ERROR: Missing credentials in .env.local: {', '.join(missing)}\n"
                "Add:\n"
                "  WABRIDGE_APP_KEY=...\n  WABRIDGE_AUTH_KEY=...\n"
                "  WABRIDGE_DEVICE_ID=...\n  WABRIDGE_TEMPLATE_ID=..."
            )

    data        = load_data()
    students_db = load_students_db()
    exam        = pick_exam(data, args.exam)
    exam_name   = exam.get('name', 'Exam')
    exam_date   = fmt_date(exam.get('date', ''))
    exam_id     = str(exam.get('id') or '')

    print(f"Exam: {exam_name}  ({exam.get('date', '')})")
    print(f"Mode: {'DRY RUN — no messages will be sent' if args.dry_run else 'LIVE SEND'}")
    print()

    # Build name-keyed lookups from students_db
    mobile_map = {}
    parent_map = {}
    canonical_map = {}   # name-key (canonical or variant, lc) -> canonical roster spelling
    for s in (students_db if isinstance(students_db, list) else students_db.get('students', [])):
        name    = (s.get('canonical_name') or s.get('name') or '').strip()
        mobile  = str(s.get('mobile') or '').strip()
        parents = [str(p).strip() for p in (s.get('parent_mobiles') or []) if p]
        keys    = [name.lower()] + [v.strip().lower() for v in s.get('name_variants', [])]
        for key in keys:
            if key:
                canonical_map[key] = name
                if mobile:
                    mobile_map[key] = mobile
                if parents:
                    parent_map[key] = parents

    results = _rows(exam)
    if not results:
        sys.exit("ERROR: Exam has no results.")

    if args.students:
        student_filter = {n.strip().lower() for n in args.students.split(',') if n.strip()}
        results = [r for r in results if (r.get('name') or '').strip().lower() in student_filter]
        print(f"Filtering to {len(results)} student(s): {args.students}")

    sent = skipped = 0

    for row in results:
        name = (row.get('name') or '').strip()   # exam-sheet spelling (mobile/parent lookup)
        if not name:
            continue
        # Message shows the canonical roster spelling (fallback: exam-sheet name).
        display_name = canonical_map.get(name.lower(), name)

        correct = row.get('correct', 0) or 0
        wrong   = row.get('incorrect', row.get('wrong', 0)) or 0
        na      = row.get('notAttempted', row.get('skipped', 0)) or 0
        total   = correct + wrong + na
        pct     = round(correct / total * 100) if total else 0

        student_mobile_raw  = mobile_map.get(name.lower(), '')
        student_mobile_norm = normalise_mobile(student_mobile_raw) if student_mobile_raw else None
        # Deep-link: pre-fill the student's own mobile (one-tap login → right
        # child, no sibling picker) + the exam id (portal lands on this result).
        # Same link for student AND parent — parents previously got a bare URL.
        _parts          = ([f"mobile={student_mobile_raw}"] if student_mobile_raw else []) + ([f"exam={exam_id}"] if exam_id else [])
        tracker_student = f"{TRACKER_BASE}?{'&'.join(_parts)}" if _parts else TRACKER_BASE

        def make_params(tracker_url, _dn=display_name):
            return [_dn, exam_name, exam_date, f"{pct}%", str(correct), str(total), tracker_url]

        if args.to:
            dest = normalise_mobile(args.to)
            if not dest:
                sys.exit(f"ERROR: Cannot normalise mobile '{args.to}'")
            ok, detail = send_whatsapp(app_key, auth_key, device_id, template_id,
                                       dest, make_params(tracker_student), args.dry_run)
            status = 'SENT' if ok else 'FAIL'
            print(f"  {status} → {name}'s result to {dest} ({detail})")
            sent += ok; skipped += not ok
            break

        # Student
        dest_student = redirect_to or student_mobile_norm
        if dest_student:
            ok, detail = send_whatsapp(app_key, auth_key, device_id, template_id,
                                       dest_student, make_params(tracker_student), args.dry_run)
            if ok:
                print(f"  SENT → {name} (student → {dest_student})")
                sent += 1
            else:
                print(f"  FAIL → {name} (student → {dest_student}): {detail}")
                skipped += 1
        else:
            print(f"  SKIP {name} — no mobile in students_db.json")
            skipped += 1

        # Parents
        for parent_raw in parent_map.get(name.lower(), []):
            parent_norm = redirect_to or normalise_mobile(parent_raw)
            if not parent_norm:
                print(f"  SKIP {name} parent {parent_raw} — unrecognised format")
                skipped += 1
                continue
            ok, detail = send_whatsapp(app_key, auth_key, device_id, template_id,
                                       parent_norm, make_params(tracker_student), args.dry_run)
            if ok:
                print(f"  SENT → {name} (parent → {parent_norm})")
                sent += 1
            else:
                print(f"  FAIL → {name} (parent → {parent_norm}): {detail}")
                skipped += 1

    print(f"\nDone. Sent: {sent}  Skipped: {skipped}")


if __name__ == '__main__':
    main()
