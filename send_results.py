"""
send_results.py — Email exam results to students.

Usage:
  python -X utf8 send_results.py [--exam "Exam Name"] [--subject "Maths"] [--dry-run]

Requires:
  - data/faculty-data.json
  - students_db.json  (must have 'email' field per student)
  - gmail_app_password.txt  (Gmail App Password, one line)

Gmail setup: https://myaccount.google.com/apppasswords
Sender address is read from GMAIL_SENDER env var or prompted.
"""

import argparse
import json
import os
import re
import smtplib
import sys
from collections import defaultdict
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

def _load_env_local():
    """Inject .env.local key=value pairs into os.environ (only if not already set)."""
    try:
        with open('.env.local', encoding='utf-8') as f:
            for line in f:
                m = re.match(r'^([A-Z_]+)=(.*)', line.strip())
                if m and m.group(1) not in os.environ:
                    os.environ[m.group(1)] = m.group(2).strip()
    except FileNotFoundError:
        pass

_load_env_local()

FACULTY_DATA = "data/faculty-data.json"
STUDENTS_DB  = "students_db.json"
APP_PASSWORD_FILE = "gmail_app_password.txt"
GMAIL_PORT = 465


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_data():
    if not os.path.exists(FACULTY_DATA):
        sys.exit(f"ERROR: {FACULTY_DATA} not found. Run the dev server first.")
    with open(FACULTY_DATA, encoding="utf-8") as f:
        return json.load(f)


def load_students_db():
    if not os.path.exists(STUDENTS_DB):
        sys.exit(f"ERROR: {STUDENTS_DB} not found.")
    with open(STUDENTS_DB, encoding="utf-8") as f:
        return json.load(f)


def load_app_password():
    if not os.path.exists(APP_PASSWORD_FILE):
        sys.exit(
            f"ERROR: {APP_PASSWORD_FILE} not found.\n"
            "Create it with your Gmail App Password (one line, no spaces).\n"
            "Guide: https://myaccount.google.com/apppasswords"
        )
    with open(APP_PASSWORD_FILE, encoding="utf-8") as f:
        return f.read().strip()


# ---------------------------------------------------------------------------
# Exam selection
# ---------------------------------------------------------------------------

def pick_exam(data, exam_name=None, subject_filter=None):
    """Return the matching exam, or the latest one (by date) if exam_name is None."""
    exams = data.get("exams", [])
    if subject_filter:
        # For subject filtering we look at whether the exam has questions for that subject
        exams = [e for e in exams if any(
            (q.get("subject") or "Maths") == subject_filter
            for q in e.get("questions", [])
        )]
    if not exams:
        sys.exit("ERROR: No exams found matching criteria.")

    if exam_name:
        matches = [e for e in exams if e.get("name", "").strip().lower() == exam_name.strip().lower()]
        if not matches:
            available = "\n  ".join(e.get("name", "") for e in exams)
            sys.exit(f"ERROR: Exam '{exam_name}' not found. Available:\n  {available}")
        return matches[0]

    return sorted(exams, key=lambda e: e.get("date", ""), reverse=True)[0]


# ---------------------------------------------------------------------------
# Per-student stats
# ---------------------------------------------------------------------------

def chapter_stats(exam, student_name, q_subject=None):
    """
    Returns dict:
      {
        chapter: {
          subtopics: { name: {correct, wrong, skipped} },
          correct: int, wrong: int, skipped: int
        }
      }
    Only considers questions where q.subject == q_subject (if set).
    """
    questions = exam.get("questions", [])
    # find student's response row — field is 'students' in faculty-data.json
    responses = {}
    for row in exam.get("students", exam.get("results", [])):
        if (row.get("name") or "").strip().lower() == student_name.strip().lower():
            responses = row.get("responses", {})
            break

    stats = defaultdict(lambda: {
        "subtopics": defaultdict(lambda: {"correct": 0, "wrong": 0, "skipped": 0}),
        "correct": 0, "wrong": 0, "skipped": 0
    })

    for i, q in enumerate(questions):
        qs = q.get("subject")  # None for non-GAT exams
        if q_subject and qs and qs != q_subject:
            continue

        chapter = (q.get("chapter") or "Unknown").strip()
        subtopic = (q.get("subtopic") or "").strip()
        # responses are integers: 1=correct, -1=wrong, 0=skipped
        resp = responses.get(str(i + 1), responses.get(i + 1, 0))

        if resp == 1:
            outcome = "correct"
        elif resp == -1:
            outcome = "wrong"
        else:
            outcome = "skipped"

        stats[chapter][outcome] += 1
        if subtopic:
            stats[chapter]["subtopics"][subtopic][outcome] += 1

    return stats


def _rows(exam):
    """Return the student result rows regardless of field name."""
    return exam.get("students", exam.get("results", []))


def class_avg(exam, q_subject=None):
    """Return overall class average score as a percentage."""
    totals = []
    for row in _rows(exam):
        c = row.get("correct", 0) or 0
        w = row.get("incorrect", row.get("wrong", 0)) or 0
        s = row.get("notAttempted", row.get("skipped", 0)) or 0
        total_q = c + w + s
        if total_q:
            totals.append(c / total_q)
    return (sum(totals) / len(totals) * 100) if totals else 0.0


def student_rank(exam, student_name):
    """Return (rank, total) tuple based on correct answers descending."""
    scores = []
    my_score = None
    for row in _rows(exam):
        c = row.get("correct", 0) or 0
        scores.append(c)
        if (row.get("name") or "").strip().lower() == student_name.strip().lower():
            my_score = c
    if my_score is None:
        return None, len(scores)
    scores.sort(reverse=True)
    rank = scores.index(my_score) + 1
    return rank, len(scores)


# ---------------------------------------------------------------------------
# Email body formatting (HTML)
# ---------------------------------------------------------------------------

def _pct_color(pct):
    if pct >= 70: return "#16a34a"   # green
    if pct >= 50: return "#d97706"   # amber
    return "#dc2626"                  # red


def _weakest_subtopic(subtopics):
    if not subtopics:
        return None, None
    return max(subtopics.items(), key=lambda x: x[1]["wrong"])


def _chapter_body_html(stats):
    chapters = list(stats.keys())
    html = ""

    if len(chapters) == 1:
        chapter = chapters[0]
        ch = stats[chapter]
        html += f'<h3 style="margin:24px 0 12px;font-size:15px;color:#1e293b;text-transform:uppercase;letter-spacing:.05em">{chapter}</h3>'

        if ch["subtopics"]:
            html += '''<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
  <tr style="background:#f1f5f9">
    <th align="left"  style="padding:8px 12px;color:#64748b;font-weight:600">Subtopic</th>
    <th align="center" style="padding:8px 12px;color:#16a34a;font-weight:600">✓ Correct</th>
    <th align="center" style="padding:8px 12px;color:#dc2626;font-weight:600">✗ Wrong</th>
    <th align="center" style="padding:8px 12px;color:#94a3b8;font-weight:600">— Skipped</th>
  </tr>'''
            for i, (st, v) in enumerate(sorted(ch["subtopics"].items(), key=lambda x: -x[1]["correct"])):
                bg = "#ffffff" if i % 2 == 0 else "#f8fafc"
                html += f'''  <tr style="background:{bg}">
    <td style="padding:8px 12px;color:#334155">{st}</td>
    <td align="center" style="padding:8px 12px;color:#16a34a;font-weight:600">{v["correct"]}</td>
    <td align="center" style="padding:8px 12px;color:#dc2626">{v["wrong"]}</td>
    <td align="center" style="padding:8px 12px;color:#94a3b8">{v["skipped"]}</td>
  </tr>'''
            html += "</table>"

            wk_name, wk = _weakest_subtopic(ch["subtopics"])
            if wk_name and wk["wrong"] > 0:
                total = wk["correct"] + wk["wrong"] + wk["skipped"]
                html += f'''<div style="margin-top:16px;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;border-radius:4px;font-size:13px;color:#7f1d1d">
  ⚠️ <strong>Needs most attention:</strong> {wk_name} — {wk["correct"]}/{total} correct, {wk["wrong"]} wrong
</div>'''
        else:
            html += f'<p style="font-size:14px;color:#334155">Correct: {ch["correct"]} &nbsp;|&nbsp; Wrong: {ch["wrong"]} &nbsp;|&nbsp; Skipped: {ch["skipped"]}</p>'

    else:
        strong = [(ch, s) for ch, s in stats.items() if s["correct"] >= s["wrong"] + s["skipped"]]
        weak   = [(ch, s) for ch, s in stats.items() if s["correct"] <  s["wrong"] + s["skipped"]]

        def _chapter_row(ch, s, color, icon):
            return (f'<tr><td style="padding:7px 12px;font-size:14px;color:#334155">{icon} {ch}</td>'
                    f'<td align="center" style="padding:7px 12px;font-size:13px;color:#16a34a">{s["correct"]}</td>'
                    f'<td align="center" style="padding:7px 12px;font-size:13px;color:#dc2626">{s["wrong"]}</td>'
                    f'<td align="center" style="padding:7px 12px;font-size:13px;color:#94a3b8">{s["skipped"]}</td></tr>')

        html += '''<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:16px">
  <tr style="background:#f1f5f9">
    <th align="left"   style="padding:8px 12px;font-size:13px;color:#64748b;font-weight:600">Chapter</th>
    <th align="center" style="padding:8px 12px;font-size:13px;color:#16a34a;font-weight:600">✓</th>
    <th align="center" style="padding:8px 12px;font-size:13px;color:#dc2626;font-weight:600">✗</th>
    <th align="center" style="padding:8px 12px;font-size:13px;color:#94a3b8;font-weight:600">—</th>
  </tr>'''
        for ch, s in sorted(strong, key=lambda x: -x[1]["correct"]):
            html += _chapter_row(ch, s, "#16a34a", "✅")
        for ch, s in sorted(weak, key=lambda x: x[1]["correct"]):
            html += _chapter_row(ch, s, "#dc2626", "⚠️")
        html += "</table>"

    return html


def format_email(student_name, exam, student_row, q_subject=None, mobile=None):
    stats = chapter_stats(exam, student_name, q_subject)
    if not stats:
        return None

    my_result = None
    for row in _rows(exam):
        if (row.get("name") or "").strip().lower() == student_name.strip().lower():
            my_result = row
            break

    score_correct = (my_result.get("correct") or 0) if my_result else 0
    if my_result:
        w = my_result.get("incorrect", my_result.get("wrong", 0)) or 0
        s = my_result.get("notAttempted", my_result.get("skipped", 0)) or 0
        total_q = score_correct + w + s
    else:
        total_q = 0

    pct      = int(score_correct / total_q * 100) if total_q else 0
    pct_col  = _pct_color(pct)
    first    = student_name.split()[0]
    exam_name = exam.get("name", "Exam")
    exam_date = exam.get("date", "")
    chapter_html = _chapter_body_html(stats)
    tracker_url = f"https://nda-tracker.vercel.app/?mobile={mobile}" if mobile else "https://nda-tracker.vercel.app"
    login_html = (f'<span style="font-weight:600;color:#1e293b">{mobile}</span>' if mobile
                  else "your registered mobile number")

    html = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%">

  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);padding:28px 32px;border-radius:12px 12px 0 0">
    <p style="margin:0;font-size:11px;color:#93c5fd;letter-spacing:.1em;text-transform:uppercase">LWS Pune · NDA Tracker</p>
    <h1 style="margin:6px 0 0;font-size:22px;color:#ffffff">Exam Results</h1>
    <p style="margin:4px 0 0;font-size:13px;color:#bfdbfe">{exam_name} &nbsp;·&nbsp; {exam_date}</p>
  </td></tr>

  <!-- Body -->
  <tr><td style="background:#ffffff;padding:28px 32px">

    <p style="margin:0 0 20px;font-size:16px;color:#1e293b">Hi <strong>{first}</strong>,</p>
    <p style="margin:0 0 24px;font-size:14px;color:#475569">Here are your results for the latest exam. Keep pushing — every question you get wrong is one more you'll get right next time!</p>

    <!-- Score card -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:24px">
      <tr>
        <td style="padding:20px 24px">
          <p style="margin:0;font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em">Your Score</p>
          <p style="margin:6px 0 0;font-size:36px;font-weight:700;color:{pct_col}">{pct}%</p>
          <p style="margin:4px 0 0;font-size:14px;color:#64748b">{score_correct} correct out of {total_q} questions</p>
        </td>
      </tr>
    </table>

    <!-- Chapter breakdown -->
    {chapter_html}

  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#1e293b;padding:24px 32px;border-radius:0 0 12px 12px">
    <p style="margin:0 0 12px;font-size:14px;color:#f1f5f9">View your detailed results on the NDA Tracker:</p>
    <a href="{tracker_url}" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:10px 20px;border-radius:6px">Open NDA Tracker →</a>
    <p style="margin:16px 0 0;font-size:12px;color:#94a3b8">Login using your mobile number: {login_html}</p>
    <p style="margin:12px 0 0;font-size:12px;color:#64748b">— LWS Pune</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>"""

    return html


# ---------------------------------------------------------------------------
# Email sending
# ---------------------------------------------------------------------------

def send_email(smtp, sender, to_addr, subject, html):
    msg = MIMEMultipart("alternative")
    msg["From"]    = sender
    msg["To"]      = to_addr
    msg["Subject"] = subject
    msg.attach(MIMEText(html, "html", "utf-8"))
    smtp.sendmail(sender, to_addr, msg.as_string())


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Email exam results to students.")
    parser.add_argument("--exam",    help="Exam name (default: latest)")
    parser.add_argument("--subject", help="Subject filter (e.g. 'Maths')")
    parser.add_argument("--dry-run", action="store_true", help="Print emails, do not send")
    parser.add_argument("--to",      help="Send a single test email to this address (uses first student's data)")
    args = parser.parse_args()

    data        = load_data()
    students_db = load_students_db()

    exam = pick_exam(data, args.exam, args.subject)
    print(f"Exam: {exam.get('name')}  ({exam.get('date', '')})")
    print(f"Mode: {'DRY RUN — no emails will be sent' if args.dry_run else 'LIVE SEND'}")
    print()

    # Build name → email and name → mobile lookups from students_db
    email_map  = {}
    mobile_map = {}
    for s in students_db if isinstance(students_db, list) else students_db.get("students", []):
        # students_db uses canonical_name; fall back to name for forward compatibility
        name   = (s.get("canonical_name") or s.get("name") or "").strip()
        email  = (s.get("email") or "").strip()
        mobile = (s.get("mobile") or "").strip()
        keys   = [name.lower()] + [v.strip().lower() for v in s.get("name_variants", [])]
        for key in keys:
            if key:
                if email:
                    email_map[key]  = email
                if mobile:
                    mobile_map[key] = mobile

    # Collect result rows
    results = _rows(exam)
    if not results:
        sys.exit("ERROR: Exam has no results.")

    sent = skipped = 0
    smtp = None

    if not args.dry_run:
        sender   = os.environ.get("GMAIL_SENDER") or sys.exit(
            "ERROR: GMAIL_SENDER not set. Add GMAIL_SENDER=you@gmail.com to .env.local"
        )
        password = load_app_password()
        smtp     = smtplib.SMTP_SSL("smtp.gmail.com", GMAIL_PORT)
        smtp.login(sender, password)
    else:
        sender = "preview@example.com"

    try:
        for row in results:
            name = (row.get("name") or "").strip()
            if not name:
                continue

            mobile = mobile_map.get(name.lower())
            body = format_email(name, exam, row, args.subject, mobile=mobile)
            if not body:
                print(f"  SKIP {name} — no question data found")
                skipped += 1
                continue

            subject_line = f"Results: {exam.get('name', 'Exam')} — {exam.get('date', '')}"

            if args.to:
                # Test mode — send first student's email to the override address, then stop
                send_email(smtp, sender, args.to, subject_line, body)
                print(f"  TEST SENT → {name}'s result to <{args.to}>")
                sent += 1
                break

            to_addr = email_map.get(name.lower())
            if not to_addr:
                print(f"  SKIP {name} — no email in students_db.json")
                skipped += 1
                continue

            if args.dry_run:
                preview_file = f"preview_{name.replace(' ', '_')}.html"
                with open(preview_file, "w", encoding="utf-8") as f:
                    f.write(body)
                print(f"  PREVIEW → {name} ({to_addr}) → {preview_file}")
            else:
                send_email(smtp, sender, to_addr, subject_line, body)
                print(f"  SENT → {name} <{to_addr}>")
                sent += 1

    finally:
        if smtp:
            smtp.quit()

    if not args.dry_run:
        print(f"\nDone. Sent: {sent}  Skipped: {skipped}")


if __name__ == "__main__":
    main()
