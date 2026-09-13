-- Point-in-time cohort snapshot on each result row, captured at exam-upload time
-- (the only moment the membership is reliably known). Immutable thereafter — a
-- later batch/branch move does NOT rewrite it. NULL for older rows / unmatched
-- students. No consumer yet: this is forward-capture so point-in-time cohort
-- reporting becomes possible without a (impossible) backfill.
alter table public.exam_results
  add column if not exists batch_at_exam  text,
  add column if not exists branch_at_exam text;