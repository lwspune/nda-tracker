-- Homework handwriting check (2026-10-13): catch someone else writing a
-- student's homework.
--
-- Every grade now records whether the pages are in the same hand as the
-- student's REFERENCE — their first graded homework. The check is a grader
-- comparing photographs by eye (scripts/grading/GRADING.md), so it is a lead
-- for a teacher, never proof, and it never changes the marks.
--
--   match / no_reference  → graded, released to the student at once (as before)
--   unclear               → graded and released, with a note for the teacher
--   mismatch              → HELD: saved, but the student sees "waiting to be
--                           graded" until the homework's teacher or an admin
--                           releases it or sends it back (homework_held_resolve)
--
-- References are kept until faculty delete them by hand; the 30-day page purge
-- (scripts/grading/purge.js) skips them. src/lib/assignments/handwriting.js holds
-- the same rules; a test pins the constants together.
--
-- PART 1 of 3 (applied as its own migration: one large migration was declined
-- by the Supabase connector's confirmation step). Parts 2 and 3 follow.

-- ── A submission can be held ────────────────────────────────────────────────
ALTER TABLE public.homework_submissions DROP CONSTRAINT homework_submissions_status_check;
ALTER TABLE public.homework_submissions ADD CONSTRAINT homework_submissions_status_check
  CHECK (status IN ('uploading', 'submitted', 'held', 'graded', 'rejected'));

ALTER TABLE public.homework_submissions
  ADD COLUMN hand_check text CHECK (hand_check IS NULL OR hand_check IN ('match', 'mismatch', 'unclear', 'no_reference')),
  ADD COLUMN hand_note text CHECK (hand_note IS NULL OR length(btrim(hand_note)) BETWEEN 1 AND 300),
  -- The submission the pages were compared against (looked up here, never sent in).
  ADD COLUMN hand_reference_id uuid REFERENCES public.homework_submissions(id) ON DELETE SET NULL,
  -- Who released a held grade, or sent it back, and when.
  ADD COLUMN resolved_at timestamptz,
  ADD COLUMN resolved_by text CHECK (resolved_by IS NULL OR length(btrim(resolved_by)) > 0);

COMMENT ON COLUMN public.homework_submissions.hand_check IS
  'Handwriting vs the student''s reference (2026-10-13). Faculty-only: never in the student payload. NULL on grades saved before the check existed.';

-- A held row is a full grade that has not been released; everything else is as before.
ALTER TABLE public.homework_submissions DROP CONSTRAINT homework_submissions_state;
ALTER TABLE public.homework_submissions ADD CONSTRAINT homework_submissions_state CHECK (
  (status = 'uploading' AND submitted_at IS NULL AND graded_at IS NULL
    AND total_awarded IS NULL AND rejected_reason IS NULL AND grader IS NULL)
  OR (status = 'submitted' AND submitted_at IS NOT NULL AND graded_at IS NULL
    AND total_awarded IS NULL AND rejected_reason IS NULL AND grader IS NULL)
  OR (status = 'held' AND submitted_at IS NOT NULL AND graded_at IS NOT NULL AND grader IS NOT NULL
    AND total_awarded IS NOT NULL AND total_max IS NOT NULL
    AND total_awarded >= 0 AND total_awarded <= total_max
    AND went_well IS NOT NULL AND next_steps IS NOT NULL AND rejected_reason IS NULL
    AND hand_check = 'mismatch' AND hand_note IS NOT NULL AND resolved_at IS NULL)
  OR (status = 'graded' AND submitted_at IS NOT NULL AND graded_at IS NOT NULL AND grader IS NOT NULL
    AND total_awarded IS NOT NULL AND total_max IS NOT NULL
    AND total_awarded >= 0 AND total_awarded <= total_max
    AND went_well IS NOT NULL AND next_steps IS NOT NULL AND rejected_reason IS NULL)
  OR (status = 'rejected' AND submitted_at IS NOT NULL AND graded_at IS NOT NULL
    AND rejected_reason IS NOT NULL AND total_awarded IS NULL)
);
-- A mismatch reaches a student only once a named person released it.
ALTER TABLE public.homework_submissions ADD CONSTRAINT homework_submissions_mismatch_released CHECK (
  status <> 'graded' OR hand_check IS DISTINCT FROM 'mismatch' OR resolved_at IS NOT NULL
);
ALTER TABLE public.homework_submissions ADD CONSTRAINT homework_submissions_resolved_pair CHECK (
  (resolved_at IS NULL) = (resolved_by IS NULL)
);
-- A mismatch or an unclear page says what was seen, for the teacher.
ALTER TABLE public.homework_submissions ADD CONSTRAINT homework_submissions_hand_note_needed CHECK (
  hand_check IS NULL OR hand_check NOT IN ('mismatch', 'unclear') OR hand_note IS NOT NULL
);

CREATE INDEX homework_submissions_held ON public.homework_submissions (assignment_id) WHERE status = 'held';

-- (id, lws_id) is unique because id is; naming it lets a reference row prove,
-- by foreign key, that its submission belongs to the same student.
ALTER TABLE public.homework_submissions ADD CONSTRAINT homework_submissions_id_student UNIQUE (id, lws_id);

