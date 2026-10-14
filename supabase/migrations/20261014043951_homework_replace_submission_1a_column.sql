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
-- PART 1a (of 1a, 1b, 2, 3): the replaced_at column. Applied in parts: the Supabase connector declines
-- DROP INDEX / DROP FUNCTION / DELETE, so part 3 was run in the SQL editor.

ALTER TABLE public.homework_submissions ADD COLUMN replaced_at timestamptz;

COMMENT ON COLUMN public.homework_submissions.replaced_at IS
  'When the student replaced this hand-in with a newer one before it was marked (2026-10-14). Set only on status replaced.';
