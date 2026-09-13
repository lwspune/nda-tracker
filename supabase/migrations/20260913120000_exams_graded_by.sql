-- Who decided the marks on this exam.
--
-- `exam_results.responses` has always been the per-question VERDICT, and for an
-- Evalbee exam that verdict is the machine's: `exams.questions[].answer` drives
-- the displayed answer, solution and analytics but never a student's marks. The
-- rule exists so that correcting a key cannot silently move marks that a parent
-- has already been told.
--
-- A scanned sheet has no machine verdict. We read the letter the student filled
-- and grade it against the key, so on those exams WE are the grader. Both models
-- now coexist, and this column is what tells them apart:
--
--   'evalbee' — the vendor's verdict. Never re-derive it from a key.
--   'scanner' — ours, from our own sheet. A key correction may legitimately
--               re-grade it, because nothing external owns the number.
--
-- Without this, a future re-grade action cannot tell which exams it is allowed
-- to touch, and the safe answer would have to be "none of them".
--
-- Not derivable, unlike `format` (which comes from questions[] being populated),
-- so it is a stored column rather than a computed one. Defaulting to 'evalbee'
-- is correct for every row that exists today.

alter table public.exams
  add column if not exists graded_by text not null default 'evalbee';

alter table public.exams
  add constraint exams_graded_by_check check (graded_by in ('evalbee', 'scanner'));

comment on column public.exams.graded_by is
  'evalbee = the vendor machine-graded the sheet; responses are its verdict and must not be re-derived from questions[].answer. scanner = graded by our own OMR reader from the student''s chosen letter, so a key correction may legitimately re-grade it.';
