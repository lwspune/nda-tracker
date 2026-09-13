
-- ── students ──────────────────────────────────────────────────
CREATE TABLE students (
  lws_id             TEXT PRIMARY KEY,
  canonical_name     TEXT NOT NULL,
  mobile             TEXT NOT NULL DEFAULT '',
  dob                TEXT NOT NULL DEFAULT '',
  gender             TEXT NOT NULL DEFAULT '',
  email              TEXT NOT NULL DEFAULT '',
  eis_reg_no         TEXT NOT NULL DEFAULT '',
  registration_date  TEXT NOT NULL DEFAULT '',
  branch             TEXT NOT NULL DEFAULT '',
  account_status     TEXT NOT NULL DEFAULT '',
  coming_status      TEXT NOT NULL DEFAULT '',
  quit_date          TEXT NOT NULL DEFAULT '',
  name_variants      TEXT[] NOT NULL DEFAULT '{}',
  evalbee_roll_nos   TEXT[] NOT NULL DEFAULT '{}',
  match_signatures   TEXT[] NOT NULL DEFAULT '{}',
  parent_mobiles     TEXT[] NOT NULL DEFAULT '{}',
  fees               JSONB NOT NULL DEFAULT '{}',
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE students ENABLE ROW LEVEL SECURITY;
CREATE POLICY "faculty_rw" ON students
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── student_batches ───────────────────────────────────────────
CREATE TABLE student_batches (
  lws_id      TEXT NOT NULL REFERENCES students(lws_id) ON DELETE CASCADE,
  batch_name  TEXT NOT NULL,
  PRIMARY KEY (lws_id, batch_name)
);

ALTER TABLE student_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "faculty_rw" ON student_batches
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── student_attendance ────────────────────────────────────────
CREATE TABLE student_attendance (
  id          SERIAL PRIMARY KEY,
  lws_id      TEXT NOT NULL REFERENCES students(lws_id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  batch       TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT '',
  eis_reg_no  TEXT NOT NULL DEFAULT '',
  UNIQUE (lws_id, date, batch)
);

ALTER TABLE student_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "faculty_rw" ON student_attendance
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── students_meta (single row) ────────────────────────────────
CREATE TABLE students_meta (
  id              INTEGER PRIMARY KEY DEFAULT 1,
  version         INTEGER NOT NULL DEFAULT 1,
  last_updated    TEXT NOT NULL DEFAULT '',
  total_students  INTEGER NOT NULL DEFAULT 0,
  exam_tags       JSONB NOT NULL DEFAULT '{}',
  rejected_pairs  JSONB NOT NULL DEFAULT '[]',
  CONSTRAINT single_row CHECK (id = 1)
);

ALTER TABLE students_meta ENABLE ROW LEVEL SECURITY;
CREATE POLICY "faculty_rw" ON students_meta
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO students_meta (id, version, last_updated, total_students, exam_tags, rejected_pairs)
VALUES (1, 1, '', 0, '{}', '[]')
ON CONFLICT (id) DO NOTHING;
