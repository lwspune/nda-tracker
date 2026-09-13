
-- Phase 5: normalise exam data out of faculty_state JSONB
-- questions stay as JSONB on the exam row (never queried server-side)
-- responses stay as JSONB on the result row (never queried server-side)

CREATE TABLE exams (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  date         DATE NOT NULL,
  subject      TEXT,
  batch        TEXT,
  branch       TEXT,
  marking      JSONB NOT NULL DEFAULT '{"correct":4,"wrong":-1}',
  questions    JSONB NOT NULL DEFAULT '[]',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE exam_results (
  exam_id        TEXT        NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_name   TEXT        NOT NULL,
  roll_no        TEXT        NOT NULL DEFAULT '',
  total_marks    NUMERIC     NOT NULL DEFAULT 0,
  correct        INTEGER     NOT NULL DEFAULT 0,
  incorrect      INTEGER     NOT NULL DEFAULT 0,
  not_attempted  INTEGER     NOT NULL DEFAULT 0,
  responses      JSONB       NOT NULL DEFAULT '{}',
  PRIMARY KEY (exam_id, student_name)
);

-- Critical for student-login: scan by student name without full table scan
CREATE INDEX exam_results_student_name_idx ON exam_results (student_name);

-- RLS
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_results ENABLE ROW LEVEL SECURITY;

-- Authenticated users (faculty + teachers) get full read access
-- Teachers are read-only at the application layer, not enforced by RLS
CREATE POLICY "faculty_rw" ON exams
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "faculty_rw" ON exam_results
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
