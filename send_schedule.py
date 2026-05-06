"""
send_schedule.py  —  Email teacher timetable schedules.

Modes
  --weekly          Next Mon-Sat (designed to run Sunday evening IST)
  --daily           Tomorrow's classes (Saturday → shows Monday)
  --exam-reminder N Send reminder for exams N days from now (N=1 or 2)

Options
  --dry-run           Save HTML previews, do not send
  --to ADDR           Send only to this address (test mode; only first teacher)
  --teacher NAME      Filter by teacher name substring
  --teacher-id ID     Filter by exact teacher ID (used by the Vite UI endpoint)
"""

import argparse, json, os, re, smtplib, ssl, sys
from datetime import date, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from zoneinfo import ZoneInfo

IST  = ZoneInfo('Asia/Kolkata')
DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']


# ── Date helpers ──────────────────────────────────────────────────────────────

def get_week_days(today: date) -> list:
    """Return [(day_name, date)] for Mon–Sat of the immediately upcoming week."""
    # days_until_monday: Mon=0→7, Tue=6, Wed=5, Thu=4, Fri=3, Sat=2, Sun=1
    days_until_monday = (7 - today.weekday()) % 7
    if days_until_monday == 0:
        days_until_monday = 7
    next_monday = today + timedelta(days=days_until_monday)
    return [(DAYS[i], next_monday + timedelta(days=i)) for i in range(6)]


def get_tomorrow_day(today: date) -> tuple:
    """Return (day_name, date) for tomorrow; Saturday → Monday, Sunday → Monday."""
    tomorrow = today + timedelta(days=1)
    if tomorrow.weekday() == 6:   # Sunday → skip to Monday
        tomorrow += timedelta(days=1)
    return tomorrow.strftime('%A'), tomorrow


# ── Time parsing ──────────────────────────────────────────────────────────────

def _parse_time_minutes(s: str) -> int:
    s = s.strip().upper()
    m12 = re.match(r'^(\d{1,2}):(\d{2})\s*(AM|PM)$', s)
    if m12:
        h, m, period = int(m12.group(1)), int(m12.group(2)), m12.group(3)
        if period == 'PM' and h != 12: h += 12
        if period == 'AM' and h == 12: h = 0
        return h * 60 + m
    m24 = re.match(r'^(\d{1,2}):(\d{2})$', s)
    if m24:
        return int(m24.group(1)) * 60 + int(m24.group(2))
    return 0


# ── Schedule extraction ────────────────────────────────────────────────────────

def extract_schedule(data: dict, teacher_id: str, days: list) -> list:
    """
    Return all class slots for teacher_id on the given days.

    days: [(day_name, date), ...]
    Returns: [{day, date, slot, mapping, timetable}, ...] sorted by day then start time.
    """
    day_set  = {d[0] for d in days}
    date_map = {d[0]: d[1] for d in days}
    mappings_by_id = {m['id']: m for m in data.get('timetableMappings', [])}

    results = []
    for tt in data.get('timetables', []):
        for slot in tt.get('timeSlots', []):
            row = tt.get('grid', {}).get(slot['id'], {})
            for day, cell in row.items():
                if day == '__span':
                    continue
                if day not in day_set:
                    continue
                if not cell or cell.get('type') != 'class':
                    continue
                mapping = mappings_by_id.get(cell.get('mappingId'))
                if not mapping or mapping.get('teacherId') != teacher_id:
                    continue
                results.append({
                    'day':      day,
                    'date':     date_map[day],
                    'slot':     slot,
                    'mapping':  mapping,
                    'timetable': tt,
                })

    day_order = {d: i for i, d in enumerate(DAYS)}
    results.sort(key=lambda r: (
        day_order.get(r['day'], 99),
        _parse_time_minutes(r['slot']['startTime']),
    ))
    return results


# ── Exam schedule extraction ──────────────────────────────────────────────────

def extract_exam_schedule(data: dict, teacher_id: str, start_date: date, end_date: date) -> list:
    """
    Return examSchedules for teacher_id where start_date <= exam.date <= end_date.
    Returns: [{id, date, startTime, endTime, subject, chapter, branch, batchName, status}, ...]
    sorted by date then startTime.
    """
    teachers_by_id = {t['id']: t for t in data.get('timetableTeachers', [])}
    results = []
    for e in data.get('examSchedules', []):
        if e.get('teacherId') != teacher_id:
            continue
        try:
            exam_date = date.fromisoformat(e['date'])
        except (KeyError, ValueError):
            continue
        if start_date <= exam_date <= end_date:
            results.append({**e, '_date': exam_date})
    results.sort(key=lambda e: (e['_date'], _parse_time_minutes(e.get('startTime', ''))))
    for e in results:
        del e['_date']
    return results


def get_exams_by_teacher(data: dict, target_date: date) -> dict:
    """
    Return { teacher_id: [exam_entry, ...] } for all exams on target_date,
    grouped by teacherId (None/missing teacherId entries are skipped).
    """
    by_teacher: dict = {}
    for e in data.get('examSchedules', []):
        tid = e.get('teacherId')
        if not tid:
            continue
        try:
            if date.fromisoformat(e['date']) != target_date:
                continue
        except (KeyError, ValueError):
            continue
        by_teacher.setdefault(tid, []).append(e)
    return by_teacher


# ── HTML ──────────────────────────────────────────────────────────────────────

_CSS = """
body{margin:0;padding:0;font-family:system-ui,-apple-system,sans-serif;background:#f1f5f9}
.wrap{max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden}
.hdr{background:#1e1b4b;padding:28px 32px}
.hdr h1{color:#e0e7ff;font-size:20px;margin:0 0 4px}
.hdr p{color:#a5b4fc;font-size:13px;margin:0}
.body{padding:28px 32px}
.greeting{font-size:16px;font-weight:600;color:#1e1b4b;margin-bottom:20px}
.lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
     color:#6366f1;background:#eef2ff;padding:4px 10px;border-radius:6px;
     display:inline-block;margin-bottom:16px}
table{width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px}
th{background:#312e81;color:#e0e7ff;padding:9px 12px;text-align:left;
   font-size:10px;text-transform:uppercase;letter-spacing:.06em;font-weight:700}
td{padding:10px 12px;border-bottom:1px solid #f1f5f9;vertical-align:top}
tr:last-child td{border-bottom:none}
.dc{font-weight:700;color:#1e1b4b;white-space:nowrap}
.ds{font-size:10px;color:#94a3b8;font-weight:400}
.tc{white-space:nowrap;color:#374151}
.sc{font-weight:600;color:#4f46e5}
.bc{color:#374151}
.bs{font-size:10px;color:#94a3b8}
.empty{background:#fafafa;border-radius:10px;padding:32px;text-align:center;
       color:#94a3b8;font-size:14px;margin-bottom:24px}
.ftr{padding:20px 32px;background:#f8fafc;font-size:11px;color:#94a3b8;
     border-top:1px solid #f1f5f9}
.exam-lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
          color:#7c3aed;background:#f5f3ff;padding:4px 10px;border-radius:6px;
          display:inline-block;margin:24px 0 16px}
.ex-st{display:inline-block;padding:2px 8px;border-radius:9999px;font-size:10px;font-weight:700}
.st-planned{background:#eef2ff;color:#4338ca}
.st-completed{background:#dcfce7;color:#16a34a}
.st-cancelled{background:#fee2e2;color:#dc2626}
"""

def _wrap(subtitle: str, footer: str, body: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{subtitle}</title>
<style>{_CSS}</style>
</head>
<body>
<div style="padding:24px 16px">
<div class="wrap">
  <div class="hdr">
    <h1>LWS Pune · Dashboard</h1>
    <p>{subtitle}</p>
  </div>
  <div class="body">{body}</div>
  <div class="ftr">LWS Pune — Dashboard · {footer}</div>
</div>
</div>
</body></html>"""



def _status_class(status: str) -> str:
    return {'Planned': 'st-planned', 'Completed': 'st-completed', 'Cancelled': 'st-cancelled'}.get(status, 'st-planned')


def _exam_section_html(exams: list) -> str:
    """Build the upcoming exams table section (shared by weekly and reminder emails)."""
    rows = ''
    for e in exams:
        status = e.get('status', 'Planned')
        rows += (
            f'<tr>'
            f'<td class="dc">{e.get("date", "")}<br>'
            f'<span class="ds">{e.get("startTime","")}&nbsp;–&nbsp;{e.get("endTime","")}</span></td>'
            f'<td class="sc">{e.get("subject","")}</td>'
            f'<td class="bc">{e.get("chapter","")}</td>'
            f'<td class="bc">{e.get("batchName","")}<br>'
            f'<span class="bs">{e.get("branch","")}</span></td>'
            f'<td><span class="ex-st {_status_class(status)}">{status}</span></td>'
            f'</tr>'
        )
    return (
        f'<table><thead><tr>'
        f'<th>Date / Time</th><th>Subject</th><th>Chapter</th><th>Batch</th><th>Status</th>'
        f'</tr></thead><tbody>{rows}</tbody></table>'
    )


def build_exam_reminder_html(teacher_name: str, exams: list, days_ahead: int, target_date: date) -> str:
    date_label = target_date.strftime('%A, %d %b %Y')
    first = teacher_name.split()[0]
    day_word = 'tomorrow' if days_ahead == 1 else f'in {days_ahead} days'

    if not exams:
        body = (f'<div class="greeting">Hi {first},</div>'
                f'<div class="exam-lbl">Exam Reminder — {date_label}</div>'
                f'<div class="empty">No exams scheduled for {date_label}.</div>')
        return _wrap(f'{teacher_name} — exam reminder: {date_label}', date_label, body)

    body = (f'<div class="greeting">Hi {first},</div>'
            f'<div class="exam-lbl">Exam Reminder — {date_label}</div>'
            f'<p style="font-size:13px;color:#374151;margin:0 0 16px">'
            f'You have {len(exams)} exam{"s" if len(exams) != 1 else ""} {day_word} '
            f'({date_label}).</p>'
            f'{_exam_section_html(exams)}')
    return _wrap(f'{teacher_name} — exam reminder: {date_label}', date_label, body)


def build_weekly_html(teacher_name: str, slots: list, week_start: date, week_end: date, exams: list | None = None) -> str:
    week_label = f"{week_start.strftime('%d %b')} – {week_end.strftime('%d %b %Y')}"
    first = teacher_name.split()[0]
    exams = exams or []

    if not slots:
        class_section = f'<div class="empty">You have no classes scheduled for this week.</div>'
    else:
        by_day: dict = {}
        for s in slots:
            by_day.setdefault(s['day'], []).append(s)

        rows = ''
        for day in DAYS:
            if day not in by_day:
                continue
            day_slots = by_day[day]
            date_str = day_slots[0]['date'].strftime('%d %b') if day_slots[0]['date'] else ''
            for i, s in enumerate(day_slots):
                day_td = (f'<td class="dc" rowspan="{len(day_slots)}">'
                          f'{day}<br><span class="ds">{date_str}</span></td>') if i == 0 else ''
                rows += (f'<tr>{day_td}'
                         f'<td class="tc">{s["slot"]["startTime"]}<br>'
                         f'<span class="ds">to {s["slot"]["endTime"]}</span></td>'
                         f'<td class="sc">{s["mapping"]["label"]}</td>'
                         f'<td class="bc">{s["timetable"]["batchName"]}<br>'
                         f'<span class="bs">{s["timetable"]["branch"]}</span></td></tr>')

        total = len(slots)
        class_section = (
            f'<p style="font-size:13px;color:#374151;margin:0 0 16px">'
            f'Here is your timetable for the upcoming week — '
            f'{total} class{"es" if total != 1 else ""} scheduled.</p>'
            f'<table><thead><tr>'
            f'<th>Day</th><th>Time</th><th>Subject</th><th>Batch</th>'
            f'</tr></thead><tbody>{rows}</tbody></table>'
        )

    exam_section = ''
    if exams:
        exam_section = (
            f'<div class="exam-lbl">Upcoming Exams This Week</div>'
            f'{_exam_section_html(exams)}'
        )

    body = (f'<div class="greeting">Hi {first},</div>'
            f'<div class="lbl">Week of {week_label}</div>'
            f'{class_section}'
            f'{exam_section}')
    return _wrap(f'{teacher_name} — weekly schedule: {week_label}', week_label, body)


def build_daily_html(teacher_name: str, slots: list, target_day: str, target_date: date) -> str:
    date_label = f"{target_day}, {target_date.strftime('%d %b %Y')}"
    first = teacher_name.split()[0]

    if not slots:
        body = (f'<div class="greeting">Hi {first},</div>'
                f'<div class="lbl">Tomorrow — {date_label}</div>'
                f'<div class="empty">No classes scheduled for tomorrow.</div>')
        return _wrap(f"{teacher_name} — tomorrow's schedule: {date_label}", date_label, body)

    rows = ''
    for s in slots:
        rows += (f'<tr>'
                 f'<td class="tc">{s["slot"]["startTime"]}<br>'
                 f'<span class="ds">to {s["slot"]["endTime"]}</span></td>'
                 f'<td class="sc">{s["mapping"]["label"]}</td>'
                 f'<td class="bc">{s["timetable"]["batchName"]}<br>'
                 f'<span class="bs">{s["timetable"]["branch"]}</span></td></tr>')

    total = len(slots)
    body = (f'<div class="greeting">Hi {first},</div>'
            f'<div class="lbl">Tomorrow — {date_label}</div>'
            f'<p style="font-size:13px;color:#374151;margin:0 0 16px">'
            f'You have {total} class{"es" if total != 1 else ""} tomorrow.</p>'
            f'<table><thead><tr>'
            f'<th>Time</th><th>Subject</th><th>Batch</th>'
            f'</tr></thead><tbody>{rows}</tbody></table>')
    return _wrap(f'{teacher_name} — tomorrow: {date_label}', date_label, body)


# ── Email sending ─────────────────────────────────────────────────────────────

def send_email(sender: str, recipient: str, subject: str, html: str, app_password: str) -> None:
    msg = MIMEMultipart('alternative')
    msg['Subject'] = subject
    msg['From']    = sender
    msg['To']      = recipient
    msg.attach(MIMEText(html, 'html', 'utf-8'))
    ctx = ssl.create_default_context()
    with smtplib.SMTP_SSL('smtp.gmail.com', 465, context=ctx) as s:
        s.login(sender, app_password)
        s.sendmail(sender, [recipient], msg.as_string())


def _load_app_password() -> str:
    path = 'gmail_app_password.txt'
    if not os.path.exists(path):
        raise FileNotFoundError(f'{path} not found — generate a Gmail App Password and save it there')
    return open(path, encoding='utf-8').read().strip()


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description='Email teacher timetable schedules')
    ap.add_argument('--weekly',        action='store_true', help='Send next Mon–Sat schedule')
    ap.add_argument('--daily',         action='store_true', help="Send tomorrow's schedule")
    ap.add_argument('--exam-reminder', type=int, default=None, metavar='N',
                    help='Send exam reminder for exams N days from today (1 or 2)')
    ap.add_argument('--dry-run',       action='store_true', help='Save HTML previews, do not send')
    ap.add_argument('--to',            default=None, help='Override recipient (test mode)')
    ap.add_argument('--teacher',       default=None, help='Filter by teacher name substring')
    ap.add_argument('--teacher-id',    default=None, help='Filter by exact teacher ID')
    args = ap.parse_args()

    if not args.weekly and not args.daily and args.exam_reminder is None:
        print('Error: specify --weekly, --daily, or --exam-reminder N', file=sys.stderr)
        sys.exit(1)

    try:
        data = json.load(open('data/faculty-data.json', encoding='utf-8'))
    except FileNotFoundError:
        print('Error: data/faculty-data.json not found', file=sys.stderr)
        sys.exit(1)

    sender = os.environ.get('GMAIL_SENDER', '')
    if not sender and not args.dry_run:
        print('Error: GMAIL_SENDER env var not set', file=sys.stderr)
        sys.exit(1)

    app_password = None
    if not args.dry_run:
        try:
            app_password = _load_app_password()
        except FileNotFoundError as e:
            print(f'Error: {e}', file=sys.stderr)
            sys.exit(1)

    from datetime import datetime
    today = datetime.now(tz=IST).date()

    # ── Exam reminder mode ────────────────────────────────────────────────────
    if args.exam_reminder is not None:
        days_ahead = args.exam_reminder
        target_date = today + timedelta(days=days_ahead)
        mode_label = f'exam-reminder-{days_ahead}'
        print(f'Mode: {mode_label}')

        by_teacher = get_exams_by_teacher(data, target_date)
        if not by_teacher:
            print(f'No exams found for {target_date}.')
            print('Done. Sent: 0  Skipped: 0')
            return

        teachers_map = {t['id']: t for t in data.get('timetableTeachers', [])}
        if args.teacher_id:
            by_teacher = {k: v for k, v in by_teacher.items() if k == args.teacher_id}
        elif args.teacher:
            lc = args.teacher.lower()
            by_teacher = {k: v for k, v in by_teacher.items()
                          if lc in teachers_map.get(k, {}).get('name', '').lower()}

        sent = skipped = 0
        for i, (tid, exams) in enumerate(by_teacher.items()):
            teacher = teachers_map.get(tid)
            if not teacher:
                continue
            if not teacher.get('email', '').strip():
                print(f'⏭ SKIP {teacher["name"]} — no email address')
                continue
            if args.to and i > 0:
                break

            email_to = args.to if (args.to and i == 0) else teacher['email']
            html = build_exam_reminder_html(teacher['name'], exams, days_ahead, target_date)
            subj_day = target_date.strftime('%A, %d %b %Y')
            subject = f'Exam reminder: {subj_day}'

            if args.dry_run:
                fname = f"preview_exam_reminder_{teacher['name'].replace(' ', '_')}.html"
                with open(fname, 'w', encoding='utf-8') as f:
                    f.write(html)
                print(f'⏭ DRY-RUN {teacher["name"]} → {fname}')
                sent += 1
                continue

            try:
                send_email(sender, email_to, subject, html, app_password)
                print(f'✅ SENT {teacher["name"]} → {email_to}')
                sent += 1
            except Exception as e:
                print(f'❌ ERR: {teacher["name"]}: {e}')
                skipped += 1

        print(f'Done. Sent: {sent}  Skipped: {skipped}')
        return

    # ── Weekly / daily mode ───────────────────────────────────────────────────
    if args.weekly:
        days = get_week_days(today)
        week_start, week_end = days[0][1], days[-1][1]
        mode_label = 'weekly'
    else:
        day_name, d = get_tomorrow_day(today)
        days = [(day_name, d)]
        mode_label = 'daily'

    print(f'Mode: {mode_label}')

    teachers = data.get('timetableTeachers', [])
    if args.teacher_id:
        teachers = [t for t in teachers if t['id'] == args.teacher_id]
    elif args.teacher:
        lc = args.teacher.lower()
        teachers = [t for t in teachers if lc in t['name'].lower()]

    teachers_with_email = [t for t in teachers if t.get('email', '').strip()]
    no_email = [t['name'] for t in teachers if not t.get('email', '').strip()]
    if no_email:
        for name in no_email:
            print(f'⏭ SKIP {name} — no email address')

    if not teachers_with_email:
        print('No teachers with email addresses found.')
        print('Done. Sent: 0  Skipped: 0')
        return

    sent = skipped = 0
    for i, teacher in enumerate(teachers_with_email):
        if args.to and i > 0:
            break

        email_to = args.to if (args.to and i == 0) else teacher['email']
        slots = extract_schedule(data, teacher['id'], days)

        if args.weekly:
            exams = extract_exam_schedule(data, teacher['id'], week_start, week_end)
            html = build_weekly_html(teacher['name'], slots, week_start, week_end, exams)
            subject = (f"Your weekly schedule: "
                       f"{week_start.strftime('%d %b')}–{week_end.strftime('%d %b %Y')}")
        else:
            day_name, target_date = days[0]
            html = build_daily_html(teacher['name'], slots, day_name, target_date)
            subject = f"Tomorrow's schedule: {day_name}, {target_date.strftime('%d %b %Y')}"

        if args.dry_run:
            fname = f"preview_schedule_{teacher['name'].replace(' ', '_')}.html"
            with open(fname, 'w', encoding='utf-8') as f:
                f.write(html)
            print(f'⏭ DRY-RUN {teacher["name"]} → {fname}')
            sent += 1
            continue

        try:
            send_email(sender, email_to, subject, html, app_password)
            print(f'✅ SENT {teacher["name"]} → {email_to}')
            sent += 1
        except Exception as e:
            print(f'❌ ERR: {teacher["name"]}: {e}')
            skipped += 1

    print(f'Done. Sent: {sent}  Skipped: {skipped}')


if __name__ == '__main__':
    main()
