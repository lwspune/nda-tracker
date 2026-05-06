"""Tests for send_results.py"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
from unittest.mock import patch, MagicMock
from send_results import (
    pick_exam,
    chapter_stats,
    class_avg,
    student_rank,
    format_email,
    send_email,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

EXAM_SINGLE_CHAPTER = {
    "name": "Trig Quiz",
    "date": "2026-04-01",
    "questions": [
        {"chapter": "Trigonometry", "subtopic": "Heights & Distance", "subject": None},
        {"chapter": "Trigonometry", "subtopic": "Heights & Distance", "subject": None},
        {"chapter": "Trigonometry", "subtopic": "Identities",         "subject": None},
        {"chapter": "Trigonometry", "subtopic": "Identities",         "subject": None},
        {"chapter": "Trigonometry", "subtopic": "Inverse Trig",       "subject": None},
    ],
    "results": [
        {"name": "Rahul Sharma",  "correct": 3, "wrong": 1, "skipped": 1,
         "responses": {"1": "correct", "2": "correct", "3": "wrong", "4": "correct", "5": "skipped"}},
        {"name": "Priya Patel",   "correct": 4, "wrong": 1, "skipped": 0,
         "responses": {"1": "correct", "2": "correct", "3": "correct", "4": "correct", "5": "wrong"}},
        {"name": "Amit Singh",    "correct": 1, "wrong": 3, "skipped": 1,
         "responses": {"1": "wrong",   "2": "wrong",   "3": "wrong",   "4": "correct", "5": "skipped"}},
    ],
}

EXAM_MULTI_CHAPTER = {
    "name": "Maths Full",
    "date": "2026-04-10",
    "questions": [
        {"chapter": "Trigonometry",   "subtopic": "Heights & Distance", "subject": None},
        {"chapter": "Trigonometry",   "subtopic": "Identities",         "subject": None},
        {"chapter": "Algebra",        "subtopic": "Quadratics",         "subject": None},
        {"chapter": "Algebra",        "subtopic": "Quadratics",         "subject": None},
    ],
    "results": [
        {"name": "Rahul Sharma", "correct": 3, "wrong": 1, "skipped": 0,
         "responses": {"1": "correct", "2": "wrong", "3": "correct", "4": "correct"}},
    ],
}

DATA_TWO_EXAMS = {
    "exams": [
        {**EXAM_SINGLE_CHAPTER, "date": "2026-03-01"},
        {**EXAM_MULTI_CHAPTER,  "date": "2026-04-10"},
    ]
}


# ---------------------------------------------------------------------------
# Test 1: pick_exam returns latest by default
# ---------------------------------------------------------------------------

def test_pick_exam_returns_latest():
    exam = pick_exam(DATA_TWO_EXAMS)
    assert exam["name"] == "Maths Full"


# ---------------------------------------------------------------------------
# Test 2: pick_exam returns named exam
# ---------------------------------------------------------------------------

def test_pick_exam_by_name():
    exam = pick_exam(DATA_TWO_EXAMS, exam_name="Trig Quiz")
    assert exam["name"] == "Trig Quiz"


# ---------------------------------------------------------------------------
# Test 3: chapter_stats maps responses to subtopics correctly
# ---------------------------------------------------------------------------

def test_chapter_stats_single_chapter():
    stats = chapter_stats(EXAM_SINGLE_CHAPTER, "Rahul Sharma")
    trig = stats["Trigonometry"]
    assert trig["correct"] == 3
    assert trig["wrong"]   == 1
    assert trig["skipped"] == 1
    assert trig["subtopics"]["Heights & Distance"]["correct"] == 2
    assert trig["subtopics"]["Identities"]["wrong"]           == 1


# ---------------------------------------------------------------------------
# Test 4: format_email single chapter shows subtopic table
# ---------------------------------------------------------------------------

def test_format_email_single_chapter_has_subtopic_table():
    body = format_email("Rahul Sharma", EXAM_SINGLE_CHAPTER, {})
    assert body is not None
    assert "Subtopic" in body
    assert "Heights & Distance" in body
    assert "Identities" in body


# ---------------------------------------------------------------------------
# Test 5: format_email multi chapter shows strong/weak sections
# ---------------------------------------------------------------------------

def test_format_email_multi_chapter_shows_strong_weak():
    body = format_email("Rahul Sharma", EXAM_MULTI_CHAPTER, {})
    assert body is not None
    # Should contain either "Strong" or "Needs work" section headers
    assert "Strong chapters:" in body or "Needs work:" in body


# ---------------------------------------------------------------------------
# Test 6: send_email calls SMTP sendmail with correct args
# ---------------------------------------------------------------------------

def test_send_email_calls_sendmail():
    import base64, email as email_lib
    mock_smtp = MagicMock()
    send_email(mock_smtp, "sender@gmail.com", "student@example.com", "Subject", "Body text")
    mock_smtp.sendmail.assert_called_once()
    call_args = mock_smtp.sendmail.call_args
    assert call_args[0][0] == "sender@gmail.com"
    assert call_args[0][1] == "student@example.com"
    raw = call_args[0][2]
    msg = email_lib.message_from_string(raw)
    payload = msg.get_payload(decode=True).decode("utf-8")
    assert "Body text" in payload
