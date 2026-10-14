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
-- PART 1b (of 1a, 1b, 2, 3): status list and state check. Applied in parts: the Supabase connector declines
-- DROP INDEX / DROP FUNCTION / DELETE, so part 3 was run in the SQL editor.

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
