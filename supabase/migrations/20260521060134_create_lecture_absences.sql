CREATE TABLE public.lecture_absences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lws_id text NOT NULL REFERENCES public.students(lws_id) ON DELETE CASCADE,
  date text NOT NULL,
  subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  UNIQUE (lws_id, date, subject)
);

CREATE INDEX lecture_absences_date_idx ON public.lecture_absences(date);
CREATE INDEX lecture_absences_lws_id_date_idx ON public.lecture_absences(lws_id, date);

ALTER TABLE public.lecture_absences ENABLE ROW LEVEL SECURITY;

CREATE POLICY faculty_rw ON public.lecture_absences
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);