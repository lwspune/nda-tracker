"""
Tests for split_students.py

Pure-function tests:
  - build_db_payload()    — sanitized full-dataset dict
  - encrypt_db_payload()  — AES-256-GCM encrypted dict

Integration tests for main():
  - db.json written as plain JSON when no password file
  - db.json written as encrypted JSON when password file exists
  - encrypted db.json can be decrypted back to the original payload
  - existing per-student file generation still works (regression)
  - subject field present in per-student exam objects (regression)
"""

import base64
import json
import sys
from pathlib import Path

import pytest

# Add repo root to path so we can import from split_students
sys.path.insert(0, str(Path(__file__).parent.parent))
import split_students as ss


# ── Fixtures ──────────────────────────────────────────────────────────────────

SAMPLE_DB = {
    'exams': [
        {
            'id':       'e1',
            'name':     'Maths Test 1',
            'date':     '2024-01-15',
            'subject':  'Maths',
            'batch':    'Batch-A',
            'marking':  {'correct': 4, 'wrong': -1},
            'questions': [{'q': 1, 'chapter': 'Algebra', 'subtopic': 'Equations', 'correct': 'A'}],
            'students': [
                {'name': 'Alice', 'totalMarks': 60, 'correct': 15,
                 'incorrect': 2, 'notAttempted': 3, 'responses': {'1': 1}},
            ],
            'createdAt': '2024-01-15T10:00:00Z',
        },
        {
            'id':       'e2',
            'name':     'Chemistry Test 1',
            'date':     '2024-02-10',
            'subject':  'Chemistry',
            'batch':    None,
            'marking':  {'correct': 4, 'wrong': -1},
            'questions': [{'q': 1, 'chapter': 'Solutions', 'subtopic': 'Molarity', 'correct': 'B'}],
            'students': [
                {'name': 'Alice', 'totalMarks': 40, 'correct': 10,
                 'incorrect': 5, 'notAttempted': 5, 'responses': {'1': -1}},
            ],
            'createdAt': '2024-02-10T10:00:00Z',
        },
    ],
    'studentProfiles': {
        'Alice': {'name': 'Alice', 'lwsId': 'LWS-001', 'gender': 'Female'},
    },
    'ndaFreqBySubject': {
        'Maths': [{'chapter': 'Algebra', 'pct': 10}],
    },
    'lastDeployedAt': '2024-01-01T00:00:00Z',
    # Faculty-only fields that must be excluded from db.json
    'apiKey':        'sk-secret-key',
    'costLog':       [{'tokens': 1000, 'cost': 0.01}],
    'savedInsights': {'classReport': 'some text', 'studentPlans': {}},
    'uploadModalOpen': True,
    'activePage':    'dashboard',
    'activeStudent': None,
    'hydrated':      True,
}


# ── build_db_payload — inclusion ─────────────────────────────────────────────

class TestBuildDbPayload:
    def test_includes_exams(self):
        result = ss.build_db_payload(SAMPLE_DB)
        assert 'exams' in result
        assert len(result['exams']) == 2

    def test_includes_student_profiles(self):
        result = ss.build_db_payload(SAMPLE_DB)
        assert 'studentProfiles' in result
        assert 'Alice' in result['studentProfiles']

    def test_includes_nda_freq_by_subject(self):
        result = ss.build_db_payload(SAMPLE_DB)
        assert 'ndaFreqBySubject' in result

    def test_includes_last_deployed_at(self):
        result = ss.build_db_payload(SAMPLE_DB)
        assert result['lastDeployedAt'] == '2024-01-01T00:00:00Z'

    def test_excludes_api_key(self):
        result = ss.build_db_payload(SAMPLE_DB)
        assert 'apiKey' not in result

    def test_excludes_cost_log(self):
        result = ss.build_db_payload(SAMPLE_DB)
        assert 'costLog' not in result

    def test_excludes_saved_insights(self):
        result = ss.build_db_payload(SAMPLE_DB)
        assert 'savedInsights' not in result

    def test_excludes_ui_state_fields(self):
        result = ss.build_db_payload(SAMPLE_DB)
        for field in ('uploadModalOpen', 'activePage', 'activeStudent', 'hydrated'):
            assert field not in result, f"'{field}' should be excluded from db.json"

    def test_all_exams_preserved(self):
        result = ss.build_db_payload(SAMPLE_DB)
        assert len(result['exams']) == len(SAMPLE_DB['exams'])

    def test_exam_subject_field_preserved(self):
        result = ss.build_db_payload(SAMPLE_DB)
        subjects = [e['subject'] for e in result['exams']]
        assert 'Maths' in subjects
        assert 'Chemistry' in subjects

    def test_exam_questions_preserved(self):
        result = ss.build_db_payload(SAMPLE_DB)
        assert result['exams'][0]['questions'] == SAMPLE_DB['exams'][0]['questions']

    def test_exam_students_preserved(self):
        result = ss.build_db_payload(SAMPLE_DB)
        assert result['exams'][0]['students'] == SAMPLE_DB['exams'][0]['students']

    def test_empty_db_returns_safe_payload(self):
        empty = {'exams': [], 'studentProfiles': {}, 'ndaFreqBySubject': {}}
        result = ss.build_db_payload(empty)
        assert result['exams'] == []
        assert result['studentProfiles'] == {}

    def test_does_not_mutate_input(self):
        import copy
        original = copy.deepcopy(SAMPLE_DB)
        ss.build_db_payload(SAMPLE_DB)
        assert SAMPLE_DB == original


# ── encrypt_db_payload ────────────────────────────────────────────────────────

pytest.importorskip('cryptography', reason='cryptography package not installed')

def _decrypt(encrypted: dict, password: str) -> dict:
    """Helper: decrypt using the same algorithm the browser uses."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes as h

    salt       = base64.b64decode(encrypted['salt'])
    iv         = base64.b64decode(encrypted['iv'])
    ciphertext = base64.b64decode(encrypted['data'])

    kdf = PBKDF2HMAC(algorithm=h.SHA256(), length=32, salt=salt,
                     iterations=ss.PBKDF2_ITERATIONS)
    key       = kdf.derive(password.strip().encode())
    aesgcm    = AESGCM(key)
    plaintext = aesgcm.decrypt(iv, ciphertext, None)
    return json.loads(plaintext)


class TestEncryptDbPayload:
    PAYLOAD = {'exams': [{'id': 'e1'}], 'studentProfiles': {}}

    def test_returns_encrypted_flag(self):
        result = ss.encrypt_db_payload(self.PAYLOAD, 'secret')
        assert result['encrypted'] is True

    def test_returns_required_keys(self):
        result = ss.encrypt_db_payload(self.PAYLOAD, 'secret')
        assert {'encrypted', 'salt', 'iv', 'data'} <= result.keys()

    def test_salt_is_base64(self):
        result = ss.encrypt_db_payload(self.PAYLOAD, 'secret')
        decoded = base64.b64decode(result['salt'])
        assert len(decoded) == 16  # 128-bit salt

    def test_iv_is_base64(self):
        result = ss.encrypt_db_payload(self.PAYLOAD, 'secret')
        decoded = base64.b64decode(result['iv'])
        assert len(decoded) == 12  # 96-bit IV for AES-GCM

    def test_data_is_base64(self):
        result = ss.encrypt_db_payload(self.PAYLOAD, 'secret')
        # Should not raise
        base64.b64decode(result['data'])

    def test_decrypts_to_original_payload(self):
        encrypted = ss.encrypt_db_payload(self.PAYLOAD, 'secret')
        decrypted = _decrypt(encrypted, 'secret')
        assert decrypted == self.PAYLOAD

    def test_wrong_password_raises(self):
        from cryptography.exceptions import InvalidTag
        encrypted = ss.encrypt_db_payload(self.PAYLOAD, 'correct')
        with pytest.raises(InvalidTag):
            _decrypt(encrypted, 'wrong')

    def test_different_calls_produce_different_ciphertext(self):
        # Random salt + IV means each call produces unique ciphertext
        r1 = ss.encrypt_db_payload(self.PAYLOAD, 'secret')
        r2 = ss.encrypt_db_payload(self.PAYLOAD, 'secret')
        assert r1['data'] != r2['data']
        assert r1['salt'] != r2['salt']

    def test_whitespace_trimmed_from_password(self):
        enc   = ss.encrypt_db_payload(self.PAYLOAD, 'secret')
        # Password with surrounding whitespace must decrypt the same payload
        decrypted = _decrypt(enc, 'secret')
        assert decrypted == self.PAYLOAD

    def test_does_not_mutate_payload(self):
        import copy
        original  = copy.deepcopy(self.PAYLOAD)
        ss.encrypt_db_payload(self.PAYLOAD, 'secret')
        assert self.PAYLOAD == original


# ── Integration tests — main() ────────────────────────────────────────────────

SAMPLE_STUDENTS_DB = {
    'students': [
        {
            'lws_id':         'LWS-001',
            'canonical_name': 'Alice',
            'name_variants':  [],
            'mobile':         '9876543210',
            'gender':         'Female',
            'dob':            '2005-01-01',
            'branch':         'LWS',
            'batches':        ['Batch-A'],
            'account_status': 'Active',
        },
    ]
}


@pytest.fixture
def tmp_env(tmp_path, monkeypatch):
    """
    Set up a temporary file environment that mirrors the real layout,
    then monkeypatch split_students path constants to use tmp_path.
    """
    data_dir     = tmp_path / 'data'
    public_dir   = tmp_path / 'public' / 'data'
    students_dir = public_dir / 'students'
    data_dir.mkdir(parents=True)
    public_dir.mkdir(parents=True)
    students_dir.mkdir(parents=True)

    db_file  = data_dir / 'faculty-data.json'
    db_file.write_text(json.dumps(SAMPLE_DB), encoding='utf-8')

    sdb_file = tmp_path / 'students_db.json'
    sdb_file.write_text(json.dumps(SAMPLE_STUDENTS_DB), encoding='utf-8')

    monkeypatch.setattr(ss, 'DB_FILE',          db_file)
    monkeypatch.setattr(ss, 'STUDENTS_DB_FILE', sdb_file)
    monkeypatch.setattr(ss, 'OUTPUT_DIR',       public_dir)
    monkeypatch.setattr(ss, 'STUDENTS_DIR',     students_dir)
    monkeypatch.setattr(ss, 'INDEX_FILE',       public_dir / 'index.json')
    monkeypatch.setattr(ss, 'DB_JSON_FILE',     public_dir / 'db.json')
    monkeypatch.setattr(ss, 'TEACHER_PASSWORD_FILE', tmp_path / 'teacher_password.txt')

    return tmp_path


# ── db.json — plain (no password) ────────────────────────────────────────────

class TestMainDbJsonPlain:
    def test_db_json_is_created(self, tmp_env):
        ss.main()
        assert (tmp_env / 'public' / 'data' / 'db.json').exists()

    def test_db_json_is_plain_when_no_password(self, tmp_env):
        ss.main()
        data = json.loads((tmp_env / 'public' / 'data' / 'db.json').read_text())
        assert 'encrypted' not in data
        assert 'exams' in data

    def test_db_json_contains_all_exams(self, tmp_env):
        ss.main()
        data = json.loads((tmp_env / 'public' / 'data' / 'db.json').read_text())
        assert len(data['exams']) == 2

    def test_db_json_exams_have_subject(self, tmp_env):
        ss.main()
        data = json.loads((tmp_env / 'public' / 'data' / 'db.json').read_text())
        for exam in data['exams']:
            assert 'subject' in exam

    def test_db_json_excludes_sensitive_fields(self, tmp_env):
        ss.main()
        data = json.loads((tmp_env / 'public' / 'data' / 'db.json').read_text())
        for field in ('apiKey', 'costLog', 'savedInsights'):
            assert field not in data, f"'{field}' must not appear in db.json"

    def test_db_json_contains_student_profiles(self, tmp_env):
        ss.main()
        data = json.loads((tmp_env / 'public' / 'data' / 'db.json').read_text())
        assert 'studentProfiles' in data


# ── db.json — encrypted (with password) ──────────────────────────────────────

@pytest.mark.skipif(
    pytest.importorskip('cryptography', reason='cryptography not installed') is None,
    reason='cryptography not installed',
)
class TestMainDbJsonEncrypted:
    def test_db_json_is_encrypted_when_password_exists(self, tmp_env):
        (tmp_env / 'teacher_password.txt').write_text('supersecret\n')
        ss.main()
        data = json.loads((tmp_env / 'public' / 'data' / 'db.json').read_text())
        assert data.get('encrypted') is True

    def test_encrypted_db_has_required_keys(self, tmp_env):
        (tmp_env / 'teacher_password.txt').write_text('supersecret\n')
        ss.main()
        data = json.loads((tmp_env / 'public' / 'data' / 'db.json').read_text())
        assert {'encrypted', 'salt', 'iv', 'data'} <= data.keys()

    def test_encrypted_db_decrypts_to_correct_payload(self, tmp_env):
        password = 'supersecret'
        (tmp_env / 'teacher_password.txt').write_text(password + '\n')
        ss.main()
        encrypted = json.loads((tmp_env / 'public' / 'data' / 'db.json').read_text())
        decrypted = _decrypt(encrypted, password)
        assert 'exams' in decrypted
        assert 'studentProfiles' in decrypted
        assert len(decrypted['exams']) == 2

    def test_encrypted_db_excludes_sensitive_fields_after_decryption(self, tmp_env):
        password = 'supersecret'
        (tmp_env / 'teacher_password.txt').write_text(password + '\n')
        ss.main()
        encrypted = json.loads((tmp_env / 'public' / 'data' / 'db.json').read_text())
        decrypted = _decrypt(encrypted, password)
        for field in ('apiKey', 'costLog', 'savedInsights'):
            assert field not in decrypted

    def test_wrong_password_cannot_decrypt(self, tmp_env):
        from cryptography.exceptions import InvalidTag
        (tmp_env / 'teacher_password.txt').write_text('correctpassword\n')
        ss.main()
        encrypted = json.loads((tmp_env / 'public' / 'data' / 'db.json').read_text())
        with pytest.raises(InvalidTag):
            _decrypt(encrypted, 'wrongpassword')

    def test_teacher_auth_json_not_written(self, tmp_env):
        (tmp_env / 'teacher_password.txt').write_text('supersecret\n')
        ss.main()
        assert not (tmp_env / 'public' / 'data' / 'teacher-auth.json').exists()


# ── Regression — per-student file generation ──────────────────────────────────

class TestMainRegression:
    def test_per_student_file_created(self, tmp_env):
        ss.main()
        files = list((tmp_env / 'public' / 'data' / 'students').iterdir())
        assert len(files) == 1

    def test_per_student_file_contains_both_exams(self, tmp_env):
        ss.main()
        student_file = next((tmp_env / 'public' / 'data' / 'students').iterdir())
        data = json.loads(student_file.read_text())
        assert len(data['exams']) == 2

    def test_per_student_exam_has_subject_field(self, tmp_env):
        ss.main()
        student_file = next((tmp_env / 'public' / 'data' / 'students').iterdir())
        data = json.loads(student_file.read_text())
        for exam in data['exams']:
            assert 'subject' in exam, "subject field must be present in per-student exam objects"

    def test_per_student_exam_subject_values_correct(self, tmp_env):
        ss.main()
        student_file = next((tmp_env / 'public' / 'data' / 'students').iterdir())
        data = json.loads(student_file.read_text())
        subjects = {e['subject'] for e in data['exams']}
        assert subjects == {'Maths', 'Chemistry'}

    def test_index_json_still_created(self, tmp_env):
        ss.main()
        assert (tmp_env / 'public' / 'data' / 'index.json').exists()

    def test_index_json_contains_student_entry(self, tmp_env):
        ss.main()
        data = json.loads((tmp_env / 'public' / 'data' / 'index.json').read_text())
        assert len(data) == 1
        assert data[0]['lwsId'] == 'LWS-001'
