-- Why each question lost marks (2026-10-16). Part 1 of 2: columns and checks.
--
-- `cause` names why a question lost marks, one per question (the one that cost
-- the most); `topic` names what to relearn or show. The student's report adds
-- lost marks up by cause. The rules repeat src/lib/assignments/grade.js
-- (CAUSES, TOPIC_CAUSES, MAX_TOPIC_CHARS); a test pins the two together.
--
-- homework_grades_cause_needed is NOT VALID: the grades saved before causes
-- existed keep their lost marks without one. A regrade deletes and re-inserts
-- the rows, and every inserted row is checked.

ALTER TABLE public.homework_grades
  ADD COLUMN cause text,
  ADD COLUMN topic text;

ALTER TABLE public.homework_grades
  ADD CONSTRAINT homework_grades_cause_check
    CHECK (cause IS NULL OR cause IN ('concept', 'careless', 'incomplete', 'misread', 'mcq')),
  ADD CONSTRAINT homework_grades_topic_check
    CHECK (topic IS NULL OR length(btrim(topic)) BETWEEN 1 AND 60),
  ADD CONSTRAINT homework_grades_topic_needed
    CHECK (cause IS NULL OR cause NOT IN ('concept', 'incomplete') OR topic IS NOT NULL),
  ADD CONSTRAINT homework_grades_topic_has_cause
    CHECK (topic IS NULL OR cause IS NOT NULL),
  ADD CONSTRAINT homework_grades_cause_needed
    CHECK ((outcome = 'scored' AND awarded < max_marks) = (cause IS NOT NULL)) NOT VALID;

COMMENT ON COLUMN public.homework_grades.cause IS
  'Why marks were lost: concept | careless | incomplete | misread | mcq. Set exactly when a scored question lost marks (NULL on rows saved before 2026-10-16).';
COMMENT ON COLUMN public.homework_grades.topic IS
  'What to relearn (concept) or show (incomplete), 1-60 chars. Required for those two causes, allowed only with a cause.';
