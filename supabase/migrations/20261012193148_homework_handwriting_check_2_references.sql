-- Homework handwriting check, PART 2 of 3 (2026-10-13): each student's
-- handwriting reference — their first graded homework. See part 1 for the design.

-- ── References ─────────────────────────────────────────────────────────────
CREATE TABLE public.homework_hand_references (
  lws_id text PRIMARY KEY REFERENCES public.students(lws_id) ON DELETE CASCADE,
  submission_id uuid NOT NULL UNIQUE,
  chosen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT homework_hand_references_same_student
    FOREIGN KEY (submission_id, lws_id) REFERENCES public.homework_submissions (id, lws_id) ON DELETE CASCADE
);

COMMENT ON TABLE public.homework_hand_references IS
  'Each student''s handwriting reference: their first graded homework (2026-10-13). Kept until faculty delete it by hand; the page purge skips it. Written by homework_grade_commit only.';

ALTER TABLE public.homework_hand_references ENABLE ROW LEVEL SECURITY;
CREATE POLICY homework_hand_references_read ON public.homework_hand_references
  FOR SELECT TO authenticated USING (true);

-- Students graded before the check existed: their first graded homework.
INSERT INTO public.homework_hand_references (lws_id, submission_id)
SELECT DISTINCT ON (lws_id) lws_id, id
  FROM public.homework_submissions
 WHERE status = 'graded'
 ORDER BY lws_id, graded_at
ON CONFLICT (lws_id) DO NOTHING;

