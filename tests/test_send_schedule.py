"""Tests for send_schedule.py"""

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
from datetime import date
from send_schedule import (
    get_week_days,
    get_tomorrow_day,
    extract_schedule,
    extract_exam_schedule,
    get_exams_by_teacher,
    build_weekly_html,
    build_daily_html,
    build_exam_reminder_html,
)

# ── Fixtures ──────────────────────────────────────────────────────────────────

TEACHER_A = 'tchr_1'
TEACHER_B = 'tchr_2'

SAMPLE_DATA = {
    'timetableTeachers': [
        {'id': TEACHER_A, 'name': 'Navneet Sir', 'email': 'navneet@example.com'},
        {'id': TEACHER_B, 'name': 'Vilas Sir',   'email': 'vilas@example.com'},
    ],
    'timetableMappings': [
        {'id': 'map_1', 'label': 'Maths (Navneet Sir)',  'subject': 'Maths',   'teacherId': TEACHER_A},
        {'id': 'map_2', 'label': 'Physics (Vilas Sir)',  'subject': 'Physics', 'teacherId': TEACHER_B},
        {'id': 'map_3', 'label': 'Maths Advanced',       'subject': 'Maths',   'teacherId': TEACHER_A},
    ],
    'timetables': [
        {
            'id': 'tt_1',
            'branch': 'LWS Pune',
            'batchName': 'NDA Batch A',
            'timeSlots': [
                {'id': 'slot_1', 'startTime': '9:00 AM',  'endTime': '10:30 AM'},
                {'id': 'slot_2', 'startTime': '11:00 AM', 'endTime': '12:30 PM'},
            ],
            'grid': {
                'slot_1': {
                    'Monday':    {'type': 'class', 'mappingId': 'map_1'},
                    'Wednesday': {'type': 'class', 'mappingId': 'map_1'},
                    'Friday':    {'type': 'class', 'mappingId': 'map_2'},
                },
                'slot_2': {
                    'Tuesday':  {'type': 'class', 'mappingId': 'map_1'},
                    'Thursday': {'type': 'class', 'mappingId': 'map_2'},
                    '__span':   {'type': 'span',  'label': 'Lunch'},
                },
            },
        },
        {
            'id': 'tt_2',
            'branch': 'APJ',
            'batchName': 'NDA Batch B',
            'timeSlots': [
                {'id': 'slot_3', 'startTime': '14:00', 'endTime': '15:30'},
            ],
            'grid': {
                'slot_3': {
                    'Monday':   {'type': 'class', 'mappingId': 'map_3'},
                    'Saturday': {'type': 'class', 'mappingId': 'map_3'},
                },
            },
        },
    ],
}

# ── get_week_days ─────────────────────────────────────────────────────────────

def test_get_week_days_from_sunday():
    sunday = date(2026, 5, 3)
    days = get_week_days(sunday)
    assert len(days) == 6
    names = [d[0] for d in days]
    assert names == ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    assert days[0][1] == date(2026, 5, 4)
    assert days[5][1] == date(2026, 5, 9)

def test_get_week_days_from_monday_skips_to_next_week():
    monday = date(2026, 5, 4)
    days = get_week_days(monday)
    assert days[0][1] == date(2026, 5, 11)

def test_get_week_days_from_saturday():
    saturday = date(2026, 5, 9)
    days = get_week_days(saturday)
    assert days[0][1] == date(2026, 5, 11)

def test_get_week_days_always_six_days():
    from datetime import timedelta
    for offset in range(7):
        base = date(2026, 5, 3) + timedelta(days=offset)
        days = get_week_days(base)
        assert len(days) == 6
        names = [d[0] for d in days]
        assert names == ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

def test_get_week_days_consecutive_dates():
    sunday = date(2026, 5, 3)
    days = get_week_days(sunday)
    from datetime import timedelta
    for i in range(1, 6):
        assert days[i][1] == days[i-1][1] + timedelta(days=1)

# ── get_tomorrow_day ──────────────────────────────────────────────────────────

def test_get_tomorrow_normal():
    monday = date(2026, 5, 4)
    name, d = get_tomorrow_day(monday)
    assert name == 'Tuesday'
    assert d == date(2026, 5, 5)

def test_get_tomorrow_saturday_returns_monday():
    saturday = date(2026, 5, 9)
    name, d = get_tomorrow_day(saturday)
    assert name == 'Monday'
    assert d == date(2026, 5, 11)

def test_get_tomorrow_friday_returns_saturday():
    friday = date(2026, 5, 8)
    name, d = get_tomorrow_day(friday)
    assert name == 'Saturday'
    assert d == date(2026, 5, 9)

def test_get_tomorrow_sunday_returns_monday():
    sunday = date(2026, 5, 3)
    name, d = get_tomorrow_day(sunday)
    assert name == 'Monday'
    assert d == date(2026, 5, 4)

# ── extract_schedule ──────────────────────────────────────────────────────────

def test_extract_teacher_a_monday_two_classes():
    days = [('Monday', date(2026, 5, 4))]
    slots = extract_schedule(SAMPLE_DATA, TEACHER_A, days)
    assert len(slots) == 2
    labels = {s['mapping']['label'] for s in slots}
    assert 'Maths (Navneet Sir)' in labels
    assert 'Maths Advanced' in labels

def test_extract_teacher_b_no_monday_classes():
    days = [('Monday', date(2026, 5, 4))]
    slots = extract_schedule(SAMPLE_DATA, TEACHER_B, days)
    assert slots == []

def test_extract_teacher_b_thursday():
    days = [('Thursday', date(2026, 5, 7))]
    slots = extract_schedule(SAMPLE_DATA, TEACHER_B, days)
    assert len(slots) == 1
    assert slots[0]['mapping']['label'] == 'Physics (Vilas Sir)'

def test_extract_skips_span_cells():
    days = [('Tuesday', date(2026, 5, 5))]
    result = (extract_schedule(SAMPLE_DATA, TEACHER_A, days) +
              extract_schedule(SAMPLE_DATA, TEACHER_B, days))
    assert all(s['day'] != '__span' for s in result)

def test_extract_skips_break_type_cells():
    data = {
        'timetableTeachers': [{'id': 'tchr_x', 'name': 'X', 'email': 'x@x.com'}],
        'timetableMappings': [],
        'timetables': [{
            'id': 'tt_x', 'branch': 'Test', 'batchName': 'Test',
            'timeSlots': [{'id': 'sl_x', 'startTime': '9:00 AM', 'endTime': '10:00 AM'}],
            'grid': {'sl_x': {'Monday': {'type': 'break', 'label': 'Break'}}},
        }],
    }
    assert extract_schedule(data, 'tchr_x', [('Monday', date(2026, 5, 4))]) == []

def test_extract_full_week_count():
    days = [
        ('Monday',    date(2026, 5, 4)),
        ('Tuesday',   date(2026, 5, 5)),
        ('Wednesday', date(2026, 5, 6)),
        ('Thursday',  date(2026, 5, 7)),
        ('Friday',    date(2026, 5, 8)),
        ('Saturday',  date(2026, 5, 9)),
    ]
    slots = extract_schedule(SAMPLE_DATA, TEACHER_A, days)
    # Mon: map_1(tt_1 slot_1) + map_3(tt_2 slot_3) = 2
    # Tue: map_1(tt_1 slot_2) = 1
    # Wed: map_1(tt_1 slot_1) = 1
    # Sat: map_3(tt_2 slot_3) = 1
    assert len(slots) == 5

def test_extract_sorted_by_day_then_time():
    days = [('Monday', date(2026, 5, 4))]
    slots = extract_schedule(SAMPLE_DATA, TEACHER_A, days)
    assert slots[0]['slot']['startTime'] == '9:00 AM'   # slot_1 (540 min)
    assert slots[1]['slot']['startTime'] == '14:00'      # slot_3 (840 min)

def test_extract_date_is_attached():
    target_date = date(2026, 5, 4)
    days = [('Monday', target_date)]
    slots = extract_schedule(SAMPLE_DATA, TEACHER_A, days)
    assert all(s['date'] == target_date for s in slots)

def test_extract_unknown_teacher_returns_empty():
    days = [('Monday', date(2026, 5, 4))]
    assert extract_schedule(SAMPLE_DATA, 'tchr_unknown', days) == []

def test_extract_includes_timetable_info():
    days = [('Saturday', date(2026, 5, 9))]
    slots = extract_schedule(SAMPLE_DATA, TEACHER_A, days)
    assert len(slots) == 1
    assert slots[0]['timetable']['branch'] == 'APJ'
    assert slots[0]['timetable']['batchName'] == 'NDA Batch B'

# ── build_weekly_html ─────────────────────────────────────────────────────────

def test_weekly_html_contains_teacher_name():
    days = [('Monday', date(2026, 5, 4)), ('Wednesday', date(2026, 5, 6))]
    slots = extract_schedule(SAMPLE_DATA, TEACHER_A, days)
    html = build_weekly_html('Navneet Sir', slots, date(2026, 5, 4), date(2026, 5, 9))
    assert 'Navneet Sir' in html

def test_weekly_html_contains_slot_time():
    days = [('Monday', date(2026, 5, 4))]
    slots = extract_schedule(SAMPLE_DATA, TEACHER_A, days)
    html = build_weekly_html('Navneet Sir', slots, date(2026, 5, 4), date(2026, 5, 9))
    assert '9:00' in html

def test_weekly_html_contains_batch_name():
    days = [('Monday', date(2026, 5, 4))]
    slots = extract_schedule(SAMPLE_DATA, TEACHER_A, days)
    html = build_weekly_html('Navneet Sir', slots, date(2026, 5, 4), date(2026, 5, 9))
    assert 'NDA Batch' in html

def test_weekly_html_empty_schedule_has_no_classes_message():
    html = build_weekly_html('Ghost Teacher', [], date(2026, 5, 4), date(2026, 5, 9))
    assert 'Ghost Teacher' in html
    assert 'no classes' in html.lower()

def test_weekly_html_is_valid_html():
    days = [('Monday', date(2026, 5, 4))]
    slots = extract_schedule(SAMPLE_DATA, TEACHER_A, days)
    html = build_weekly_html('Navneet Sir', slots, date(2026, 5, 4), date(2026, 5, 9))
    assert html.strip().startswith('<!DOCTYPE html>')
    assert '</html>' in html

# ── build_daily_html ──────────────────────────────────────────────────────────

def test_daily_html_contains_teacher_name():
    days = [('Monday', date(2026, 5, 4))]
    slots = extract_schedule(SAMPLE_DATA, TEACHER_A, days)
    html = build_daily_html('Navneet Sir', slots, 'Monday', date(2026, 5, 4))
    assert 'Navneet Sir' in html

def test_daily_html_contains_day_name():
    days = [('Monday', date(2026, 5, 4))]
    slots = extract_schedule(SAMPLE_DATA, TEACHER_A, days)
    html = build_daily_html('Navneet Sir', slots, 'Monday', date(2026, 5, 4))
    assert 'Monday' in html

def test_daily_html_empty_has_no_classes_message():
    html = build_daily_html('Navneet Sir', [], 'Tuesday', date(2026, 5, 5))
    assert 'Navneet Sir' in html
    assert 'no classes' in html.lower()

def test_daily_html_is_valid_html():
    days = [('Monday', date(2026, 5, 4))]
    slots = extract_schedule(SAMPLE_DATA, TEACHER_A, days)
    html = build_daily_html('Navneet Sir', slots, 'Monday', date(2026, 5, 4))
    assert html.strip().startswith('<!DOCTYPE html>')
    assert '</html>' in html


# ── Exam schedule fixtures ────────────────────────────────────────────────────

EXAM_DATA = {
    **SAMPLE_DATA,
    'examSchedules': [
        {
            'id': 'exam_1',
            'date': '2026-05-11',   # Monday of next week
            'startTime': '9:00 AM',
            'endTime': '11:00 AM',
            'subject': 'Maths',
            'chapter': 'Trigonometry',
            'teacherId': TEACHER_A,
            'branch': 'LWS Pune',
            'batchName': 'NDA Batch A',
            'status': 'Planned',
        },
        {
            'id': 'exam_2',
            'date': '2026-05-13',   # Wednesday
            'startTime': '10:00 AM',
            'endTime': '12:00 PM',
            'subject': 'Physics',
            'chapter': 'Kinematics',
            'teacherId': TEACHER_B,
            'branch': 'APJ',
            'batchName': 'NDA Batch B',
            'status': 'Planned',
        },
        {
            'id': 'exam_3',
            'date': '2026-05-11',   # Same day as exam_1, different teacher
            'startTime': '2:00 PM',
            'endTime': '4:00 PM',
            'subject': 'English',
            'chapter': 'Grammar',
            'teacherId': TEACHER_A,
            'branch': 'LWS Pune',
            'batchName': 'NDA Batch A',
            'status': 'Completed',
        },
        {
            'id': 'exam_4',
            'date': '2026-05-20',   # Outside any test week
            'startTime': '9:00 AM',
            'endTime': '11:00 AM',
            'subject': 'Maths',
            'chapter': 'Algebra',
            'teacherId': TEACHER_A,
            'branch': 'LWS Pune',
            'batchName': 'NDA Batch A',
            'status': 'Planned',
        },
    ],
}

# ── extract_exam_schedule ─────────────────────────────────────────────────────

def test_extract_exam_matches_teacher_and_date_range():
    exams = extract_exam_schedule(EXAM_DATA, TEACHER_A, date(2026, 5, 11), date(2026, 5, 16))
    assert len(exams) == 2
    ids = {e['id'] for e in exams}
    assert 'exam_1' in ids
    assert 'exam_3' in ids

def test_extract_exam_excludes_other_teacher():
    exams = extract_exam_schedule(EXAM_DATA, TEACHER_A, date(2026, 5, 13), date(2026, 5, 13))
    assert exams == []

def test_extract_exam_excludes_outside_range():
    exams = extract_exam_schedule(EXAM_DATA, TEACHER_A, date(2026, 5, 11), date(2026, 5, 16))
    assert all(e['id'] != 'exam_4' for e in exams)

def test_extract_exam_sorted_by_date_then_time():
    exams = extract_exam_schedule(EXAM_DATA, TEACHER_A, date(2026, 5, 11), date(2026, 5, 16))
    assert exams[0]['startTime'] == '9:00 AM'
    assert exams[1]['startTime'] == '2:00 PM'

def test_extract_exam_empty_when_no_schedules():
    data = {**EXAM_DATA, 'examSchedules': []}
    assert extract_exam_schedule(data, TEACHER_A, date(2026, 5, 11), date(2026, 5, 16)) == []

# ── get_exams_by_teacher ──────────────────────────────────────────────────────

def test_get_exams_by_teacher_groups_correctly():
    by_teacher = get_exams_by_teacher(EXAM_DATA, date(2026, 5, 11))
    assert TEACHER_A in by_teacher
    assert len(by_teacher[TEACHER_A]) == 2
    assert TEACHER_B not in by_teacher   # exam_2 is on May 13

def test_get_exams_by_teacher_excludes_null_teacher():
    data = {**EXAM_DATA, 'examSchedules': [
        {**EXAM_DATA['examSchedules'][0], 'teacherId': None},
    ]}
    by_teacher = get_exams_by_teacher(data, date(2026, 5, 11))
    assert by_teacher == {}

def test_get_exams_by_teacher_empty_when_no_match():
    by_teacher = get_exams_by_teacher(EXAM_DATA, date(2026, 5, 1))
    assert by_teacher == {}

# ── build_exam_reminder_html ──────────────────────────────────────────────────

def test_exam_reminder_html_contains_teacher_name():
    exams = [EXAM_DATA['examSchedules'][0]]
    html = build_exam_reminder_html('Navneet Sir', exams, 2, date(2026, 5, 11))
    assert 'Navneet Sir' in html

def test_exam_reminder_html_contains_subject_and_chapter():
    exams = [EXAM_DATA['examSchedules'][0]]
    html = build_exam_reminder_html('Navneet Sir', exams, 2, date(2026, 5, 11))
    assert 'Maths' in html
    assert 'Trigonometry' in html

def test_exam_reminder_html_contains_status_badge():
    exams = [EXAM_DATA['examSchedules'][0]]
    html = build_exam_reminder_html('Navneet Sir', exams, 1, date(2026, 5, 11))
    assert 'Planned' in html

def test_exam_reminder_html_empty_has_no_exams_message():
    html = build_exam_reminder_html('Navneet Sir', [], 1, date(2026, 5, 11))
    assert 'No exams' in html

def test_exam_reminder_html_is_valid_html():
    exams = [EXAM_DATA['examSchedules'][0]]
    html = build_exam_reminder_html('Navneet Sir', exams, 2, date(2026, 5, 11))
    assert html.strip().startswith('<!DOCTYPE html>')
    assert '</html>' in html

# ── build_weekly_html with exams ──────────────────────────────────────────────

def test_weekly_html_includes_exam_section_when_exams_present():
    days = [('Monday', date(2026, 5, 11))]
    slots = extract_schedule(EXAM_DATA, TEACHER_A, days)
    exams = extract_exam_schedule(EXAM_DATA, TEACHER_A, date(2026, 5, 11), date(2026, 5, 16))
    html = build_weekly_html('Navneet Sir', slots, date(2026, 5, 11), date(2026, 5, 16), exams)
    assert 'Upcoming Exams' in html
    assert 'Trigonometry' in html

def test_weekly_html_no_exam_section_when_exams_empty():
    days = [('Monday', date(2026, 5, 11))]
    slots = extract_schedule(EXAM_DATA, TEACHER_A, days)
    html = build_weekly_html('Navneet Sir', slots, date(2026, 5, 11), date(2026, 5, 16), [])
    assert 'Upcoming Exams' not in html

def test_weekly_html_no_exam_section_when_exams_omitted():
    days = [('Monday', date(2026, 5, 11))]
    slots = extract_schedule(EXAM_DATA, TEACHER_A, days)
    html = build_weekly_html('Navneet Sir', slots, date(2026, 5, 11), date(2026, 5, 16))
    assert 'Upcoming Exams' not in html
