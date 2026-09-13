-- Explicit paper ceiling for exams without a questions[] array (offline / manually
-- recorded exams). NULL for Evalbee MCQ exams, whose max is derived as
-- questions.length * marking.correct. Readers prefer max_marks when present.
ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS max_marks numeric;

COMMENT ON COLUMN public.exams.max_marks IS
  'Explicit paper total for offline/manually-recorded exams (no per-question data). NULL → derive from questions.length * marking.correct.';