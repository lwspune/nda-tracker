CREATE TABLE exam_absences (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id      text NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  lws_id       text NOT NULL REFERENCES students(lws_id) ON DELETE CASCADE,
  marked_at    timestamptz NOT NULL DEFAULT now(),
  marked_by    text,
  notified_at  timestamptz,
  UNIQUE (exam_id, lws_id)
);

CREATE INDEX exam_absences_exam_id_idx ON exam_absences(exam_id);
CREATE INDEX exam_absences_lws_id_idx  ON exam_absences(lws_id);
CREATE INDEX exam_absences_lws_marked_idx ON exam_absences(lws_id, marked_at DESC);

ALTER TABLE exam_absences ENABLE ROW LEVEL SECURITY;

CREATE POLICY exam_absences_authenticated_all ON exam_absences
  FOR ALL TO authenticated USING (true) WITH CHECK (true);