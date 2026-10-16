-- The grader's marks on a student's pages (2026-10-16). Part 1 of 2: the
-- table and the page count.
--
-- Positions are percent of the PREPARED page (upright, PDFs split into pages:
-- scripts/grading/pages.py), stored at <submission>/marked/NN.jpg. The rules
-- repeat src/lib/assignments/pageMarks.js (MARK_KINDS, MAX_NOTE_CHARS) and
-- upload.js (MAX_MARKED_PAGES); a test pins them together. A score mark has no
-- text: what it prints is worked out from its grade row, so the page can never
-- show a number the grade does not hold.

ALTER TABLE public.homework_submissions
  ADD COLUMN marked_pages smallint;
ALTER TABLE public.homework_submissions
  ADD CONSTRAINT homework_submissions_marked_pages_check
    CHECK (marked_pages IS NULL OR marked_pages BETWEEN 1 AND 60);

COMMENT ON COLUMN public.homework_submissions.marked_pages IS
  'How many prepared pages were uploaded to <submission>/marked/ (2026-10-16). NULL on grades saved before page marks. Purged with the hand-in files.';

CREATE TABLE public.homework_page_marks (
  -- Direct as well as through the grade row: PostgREST embeds marks in a
  -- submission (grading:pull's regrade) only over a direct key.
  submission_id uuid NOT NULL REFERENCES public.homework_submissions (id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position >= 1),
  page smallint NOT NULL CHECK (page BETWEEN 1 AND 60),
  label text NOT NULL,
  kind text NOT NULL CONSTRAINT homework_page_marks_kind_check
    CHECK (kind IN ('tick', 'cross', 'circle', 'note', 'score')),
  x numeric(4,1) NOT NULL CHECK (x BETWEEN 0 AND 100),
  y numeric(4,1) NOT NULL CHECK (y BETWEEN 0 AND 100),
  w numeric(4,1),
  h numeric(4,1),
  text text,
  to_x numeric(4,1) CHECK (to_x BETWEEN 0 AND 100),
  to_y numeric(4,1) CHECK (to_y BETWEEN 0 AND 100),
  PRIMARY KEY (submission_id, position),
  -- A mark belongs to a graded question. Every (re)grade replaces the grade
  -- rows, and their marks go with them.
  CONSTRAINT homework_page_marks_grade FOREIGN KEY (submission_id, label)
    REFERENCES public.homework_grades (submission_id, label) ON DELETE CASCADE,
  -- Each kind carries only its own fields. coalesce(…, false): a NULL size or
  -- text must fail, and a bare comparison on NULL would pass the CHECK.
  CONSTRAINT homework_page_marks_size CHECK (CASE
    WHEN kind = 'circle' THEN coalesce(w > 0 AND w <= 100 AND h > 0 AND h <= 100, false)
    ELSE w IS NULL AND h IS NULL END),
  CONSTRAINT homework_page_marks_text CHECK (CASE
    WHEN kind = 'note' THEN coalesce(length(btrim(text)) BETWEEN 1 AND 80, false)
    ELSE text IS NULL END),
  CONSTRAINT homework_page_marks_to CHECK ((to_x IS NULL) = (to_y IS NULL) AND (to_x IS NULL OR kind = 'note'))
);

COMMENT ON TABLE public.homework_page_marks IS
  'Ticks, crosses, circles, notes and score marks written on a graded submission''s prepared pages. Written only by homework_grade_commit, with the grade.';

ALTER TABLE public.homework_page_marks ENABLE ROW LEVEL SECURITY;
-- Staff read; the student endpoint and the grading scripts use the service
-- role. No write policy, as for homework_grades.
CREATE POLICY homework_page_marks_read ON public.homework_page_marks
  FOR SELECT TO authenticated USING (true);
