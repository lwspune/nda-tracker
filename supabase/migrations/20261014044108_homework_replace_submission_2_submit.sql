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
--
-- PART 2 (of 1a, 1b, 2, 3): the submit function. Applied in parts: the Supabase connector declines
-- DROP INDEX / DROP FUNCTION / DELETE, so part 3 was run in the SQL editor.

-- ── Functions (service role only) ─────────────────────────────────────────

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
