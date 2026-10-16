"""Tests for scripts/grading/send_report.py: the marked-paper email."""

import base64, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'grading'))

import pytest
import send_report

PDF = b'%PDF-1.7 fake report bytes'


def payload(**over):
    p = {
        'sender': 'connect.lwspune@gmail.com', 'to': 'student@example.com',
        'subject': 'Your marked homework: Limits (15/20)', 'text': 'Hi Arjun,\nPlain body.',
        'html': '<p>Hi Arjun,</p>', 'filename': 'Marked - Limits.pdf',
        'pdfBase64': base64.b64encode(PDF).decode(),
    }
    p.update(over)
    return p


def test_addresses_and_subject():
    msg = send_report.build_message(payload())
    assert msg['From'] == 'LWS Pune <connect.lwspune@gmail.com>'
    assert msg['To'] == 'student@example.com'
    assert msg['Subject'] == 'Your marked homework: Limits (15/20)'


def test_carries_text_and_html_and_the_pdf():
    msg = send_report.build_message(payload())
    assert msg.get_body(('plain',)).get_content().strip() == 'Hi Arjun,\nPlain body.'
    assert '<p>Hi Arjun,</p>' in msg.get_body(('html',)).get_content()
    [att] = list(msg.iter_attachments())
    assert att.get_content_type() == 'application/pdf'
    assert att.get_filename() == 'Marked - Limits.pdf'
    assert att.get_content() == PDF


def test_refuses_a_payload_missing_a_field():
    for field in ('sender', 'to', 'subject', 'text', 'html', 'filename', 'pdfBase64'):
        with pytest.raises(ValueError, match=field):
            send_report.build_message(payload(**{field: ''}))


def test_refuses_an_attachment_that_is_not_a_pdf():
    with pytest.raises(ValueError, match='PDF'):
        send_report.build_message(payload(pdfBase64=base64.b64encode(b'<html>').decode()))
