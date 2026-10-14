-- Homework: a student may replace a hand-in that has not been marked yet
-- (2026-10-14). Students were handing in the wrong pages, or spotting a
-- mistake after Submit, and the only way back was a grader rejecting it.
--
-- RULES:
--   * only before the deadline, and only while the hand-in is waiting to be
--     graded (submitted) or held — a held grade looks exactly like a waiting
--     one to the student, so it must be replaceable the same way;
--   * never once graded: a marked hand-in is final;
--   * at most 2 replacements (3 hand-ins); grader rejections do not count.
--     src/lib/assignments/status.js MAX_REPLACEMENTS holds the same number;
--   * a replacement is asked for explicitly (p_replace), so a double tap can
--     never replace anything;
--   * the old hand-in is retired only when the new one is SENT, in the same
--     transaction — a student who gives up half way still has their first one.
--     It becomes `replaced`: kept (with any held grade and handwriting note on
--     it), never marked, never live. Its pages are purged 30 days later.
--
-- Backward compatible both ways: the old four-argument call still works
-- (p_replace defaults to false), and the endpoint sends p_replace only on a
-- replacement.

ALTER TABLE public.homework_submissions ADD COLUMN replaced_at timestamptz;

COMMENT ON COLUMN public.homework_submissions.replaced_at IS
  'When the student replaced this hand-in with a newer one before it was marked (2026-10-14). Set only on status replaced.';

ALTER TABLE public.homework_submissions DROP CONSTRAINT homework_submissions_status_check;
ALTER TABLE public.homework_submissions ADD CONSTRAINT homework_submissions_status_check
  CHECK (status IN ('uploading', 'submitted', 'held', 'graded', 'rejected', 'replaced'));

-- As before, plus: a replaced row was a real hand-in. It may carry a held
-- grade (it was held when replaced), so the grade fields are left free.
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
  OR (status = 'replaced' AND submitted_at IS NOT NULL AND replaced_at IS NOT NULL AND rejected_reason IS NULL)
);
ALTER TABLE public.homework_submissions ADD CONSTRAINT homework_submissions_replaced_at CHECK (
  (status = 'replaced') = (replaced_at IS NOT NULL)
);

-- One live hand-in per student per homework, and beside it at most one upload
-- in progress (the replacement uploads while the old hand-in still counts).
-- The single index this replaces counted an upload as the one slot.
DROP INDEX public.homework_submissions_one_per_student;
CREATE UNIQUE INDEX homework_submissions_one_per_student
  ON public.homework_submissions (assignment_id, lws_id) WHERE status IN ('submitted', 'held', 'graded');
CREATE UNIQUE INDEX homework_submissions_one_upload
  ON public.homework_submissions (assignment_id, lws_id) WHERE status = 'uploading';

-- ── Functions (service role only) ─────────────────────────────────────────

-- Start an upload. Without p_replace, refused when the student already has a
-- hand-in; with it, refused when that hand-in is marked or the replacements
-- are used up. The old hand-in is NOT touched here — see submit.
DROP FUNCTION public.homework_submission_start(uuid, uuid, text, jsonb);

CREATE OR REPLACE FUNCTION public.homework_submission_start(
  p_id uuid, p_assignment uuid, p_lws_id text, p_files jsonb, p_replace boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_a public.homework_assignments%ROWTYPE;
  v_name text;
  v_live text;
BEGIN
  SELECT * INTO v_a FROM public.homework_assignments WHERE id = p_assignment FOR SHARE;
  IF NOT FOUND OR v_a.status <> 'published' THEN
    RAISE EXCEPTION 'homework % is not open', p_assignment;
  END IF;
  IF now() >= v_a.due_at THEN
    RAISE EXCEPTION 'homework %: the deadline has passed', p_assignment;
  END IF;
  SELECT canonical_name INTO v_name FROM public.students WHERE lws_id = p_lws_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'student % not found', p_lws_id;
  END IF;
  SELECT status INTO v_live FROM public.homework_submissions
   WHERE assignment_id = p_assignment AND lws_id = p_lws_id
     AND status IN ('submitted', 'held', 'graded');
  IF v_live IS NOT NULL THEN
    IF NOT p_replace THEN
      RAISE EXCEPTION 'homework %: % has already submitted', p_assignment, p_lws_id;
    END IF;
    IF v_live = 'graded' THEN
      RAISE EXCEPTION 'homework %: the hand-in it replaces has already been marked', p_assignment;
    END IF;
    IF (SELECT count(*) FROM public.homework_submissions
         WHERE assignment_id = p_assignment AND lws_id = p_lws_id AND status = 'replaced') >= 2 THEN
      RAISE EXCEPTION 'homework %: no replacements left', p_assignment;
    END IF;
  END IF;
  DELETE FROM public.homework_submissions
   WHERE assignment_id = p_assignment AND lws_id = p_lws_id AND status = 'uploading';
  INSERT INTO public.homework_submissions (id, assignment_id, lws_id, student_name, files)
  VALUES (p_id, p_assignment, p_lws_id, v_name, p_files);
END;
$$;

REVOKE ALL ON FUNCTION public.homework_submission_start(uuid, uuid, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.homework_submission_start(uuid, uuid, text, jsonb, boolean) TO service_role;

-- Send an uploaded submission for grading, still inside the open window. If
-- the student has a hand-in already, this one replaces it — in this
-- transaction, under the same row lock the grade function takes, so a grader
-- who marks the old one first wins and the replacement is refused.
CREATE OR REPLACE FUNCTION public.homework_submission_submit(p_id uuid, p_lws_id text)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_sub public.homework_submissions%ROWTYPE;
  v_old public.homework_submissions%ROWTYPE;
  v_due timestamptz;
BEGIN
  SELECT * INTO v_sub FROM public.homework_submissions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_sub.lws_id <> p_lws_id OR v_sub.status <> 'uploading' THEN
    RAISE EXCEPTION 'submission % is not an upload in progress for %', p_id, p_lws_id;
  END IF;
  SELECT due_at INTO v_due FROM public.homework_assignments WHERE id = v_sub.assignment_id;
  IF now() >= v_due THEN
    RAISE EXCEPTION 'submission %: the deadline has passed', p_id;
  END IF;

  SELECT * INTO v_old FROM public.homework_submissions
   WHERE assignment_id = v_sub.assignment_id AND lws_id = p_lws_id
     AND status IN ('submitted', 'held', 'graded')
   FOR UPDATE;
  IF FOUND THEN
    IF v_old.status = 'graded' THEN
      RAISE EXCEPTION 'submission %: the hand-in it replaces has already been marked', p_id;
    END IF;
    IF (SELECT count(*) FROM public.homework_submissions
         WHERE assignment_id = v_sub.assignment_id AND lws_id = p_lws_id AND status = 'replaced') >= 2 THEN
      RAISE EXCEPTION 'submission %: no replacements left', p_id;
    END IF;
    UPDATE public.homework_submissions SET status = 'replaced', replaced_at = now() WHERE id = v_old.id;
  END IF;

  UPDATE public.homework_submissions SET status = 'submitted', submitted_at = now() WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.homework_submission_submit(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.homework_submission_submit(uuid, text) TO service_role;
