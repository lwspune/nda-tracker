-- Homework may be a description alone (2026-10-12): "Exercise 3.2, Q1-10, as
-- announced in class" has no paper to upload. A published homework now needs
-- batches and EITHER a question paper OR a non-blank description — relaxed,
-- not dropped, so there is still always something for the student to do.
-- Mirrors validateAssignmentForPublish (src/lib/assignments/status.js).
ALTER TABLE public.homework_assignments DROP CONSTRAINT homework_assignments_publishable;
ALTER TABLE public.homework_assignments ADD CONSTRAINT homework_assignments_publishable CHECK (
  status = 'draft'
  OR (cardinality(batch_names) >= 1
      AND (jsonb_array_length(question_files) >= 1 OR length(btrim(coalesce(instructions, ''))) > 0))
);
