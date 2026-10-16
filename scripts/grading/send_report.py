"""Email one marked-paper report through Gmail (2026-10-16).

Reads one JSON message on stdin:
  { sender, to, subject, text, html, filename, pdfBase64 }
and sends it with the app password in gmail_app_password.txt (the same login
send_schedule.py uses). Run by scripts/grading/_mailer.js from the local admin
app's dev server; it decides who gets what (src/lib/assignments/reportEmail.js).
Prints {"ok": true} on success; exits non-zero with the reason on failure.
"""
import base64
import json
import smtplib
import ssl
import sys
from email.message import EmailMessage
from pathlib import Path

FIELDS = ('sender', 'to', 'subject', 'text', 'html', 'filename', 'pdfBase64')
PASSWORD_FILE = Path('gmail_app_password.txt')


def build_message(p):
    for field in FIELDS:
        if not str(p.get(field) or '').strip():
            raise ValueError(f'missing {field}')
    pdf = base64.b64decode(p['pdfBase64'])
    if not pdf.startswith(b'%PDF'):
        raise ValueError('the attachment is not a PDF')
    msg = EmailMessage()
    msg['From'] = f'LWS Pune <{p["sender"]}>'
    msg['To'] = p['to']
    msg['Subject'] = p['subject']
    msg.set_content(p['text'])
    msg.add_alternative(p['html'], subtype='html')
    msg.add_attachment(pdf, maintype='application', subtype='pdf', filename=p['filename'])
    return msg


def send(msg, sender, password):
    ctx = ssl.create_default_context()
    with smtplib.SMTP_SSL('smtp.gmail.com', 465, context=ctx) as s:
        s.login(sender, password)
        s.send_message(msg)


def main():
    try:
        p = json.loads(sys.stdin.read())
        msg = build_message(p)
        if not PASSWORD_FILE.exists():
            raise ValueError(f'{PASSWORD_FILE} not found: generate a Gmail App Password and save it there')
        send(msg, p['sender'], PASSWORD_FILE.read_text(encoding='utf-8').strip())
    except Exception as e:  # one line back to the caller, never a traceback
        print(f'{type(e).__name__}: {e}', file=sys.stderr)
        raise SystemExit(1)
    print(json.dumps({'ok': True}))


if __name__ == '__main__':
    main()
