-- Homework assignments (2026-10-12): a teacher uploads a question paper (PDF or
-- photos) for their batches with a deadline; a student uploads photographed or
-- scanned answers from the portal; the submission is graded and the grade is
-- shown to the student as soon as it is saved (auto-release).
--
-- HOW IT IS GRADED. For now, by hand in a Claude Code session against
-- scripts/grading/GRADING.md, one submission per session (pull.js writes the
-- brief, the grader fills grade.json, commit.js checks it with
-- src/lib/assignments/grade.js and calls homework_grade_commit). Automatic
-- grading through the API is planned and will commit through the same function
-- with grader = 'api'.
--
-- Separate from homework_pending, which is the "who didn't do their homework"
-- defaulter log behind the WhatsApp flow. Nothing here writes to it.
--
-- RULES THE DATABASE ENFORCES:
--   * marks between 0 and the question's maximum, in halves; marks only on a
--     scored question; the questions' maximums add up to the assignment's;
--   * the total is summed HERE from the rows, never taken from the caller;
--   * one submitted-or-graded submission per student per assignment; a REJECTED
--     one (unreadable, wrong homework) does not use it up;
--   * a submission starts and is sent only while the assignment is published
--     and before its due time, by the database's clock;
--   * a status carries exactly the fields it needs (state CHECK).
--
-- FILES. Two private buckets.
--   homework-files       — question papers (<assignment>/questions/NN.ext) and
--                          answer keys (<assignment>/key/NN.ext). Staff upload
--                          directly; a teacher only into an assignment they
--                          created. Students get signed links to questions/
--                          only, from api/student-quizzes.js.
--   homework-submissions — students' answers (<assignment>/<lws_id>/<submission>/NN.ext).
--                          NO write policy: students have no Supabase session,
--                          so they upload through signed links the service role
--                          issues. Staff read (to see a student's work).
-- Both repeat the per-file size and type limits of src/lib/assignments/upload.js
-- (a test pins them). Scans are deleted 30 days after grading
-- (scripts/grading/purge.js sets scans_deleted_at); the grade stays.
--
-- ACCESS. Staff read everything. Assignments: staff write, a teacher only their
-- own (created_by = their login email). Submissions and grades: service role
-- only — the student endpoint and the grading scripts.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('homework-files', 'homework-files', false, 20971520, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('homework-submissions', 'homework-submissions', false, 20971520, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── Assignments ────────────────────────────────────────────────────────────
CREATE TABLE public.homework_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  subject text NOT NULL CHECK (length(btrim(subject)) > 0),
  branch text,
  -- text[], not the comma-joined string quizzes use: a containment test on an
  -- array cannot match '12th_A' against '12th_A2'.
  batch_names text[] NOT NULL DEFAULT '{}',
  instructions text CHECK (instructions IS NULL OR length(instructions) <= 2000),
  -- [{ path, name, type, size }] — paths built by assignmentFilePath.
  question_files jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(question_files) = 'array'),
  answer_key_files jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(answer_key_files) = 'array'),
  -- Optional breakdown [{ label, marks }]; empty = the grader splits the marks.
  questions jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(questions) = 'array'),
  max_marks numeric NOT NULL CHECK (max_marks > 0 AND max_marks * 2 = floor(max_marks * 2)),
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_by text NOT NULL CHECK (length(btrim(created_by)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT homework_assignments_no_blank_batch CHECK (array_position(batch_names, '') IS NULL),
  CONSTRAINT homework_assignments_publishable CHECK (
    status = 'draft'
    OR (cardinality(batch_names) >= 1 AND jsonb_array_length(question_files) >= 1)
  )
);

CREATE INDEX homework_assignments_batches ON public.homework_assignments USING gin (batch_names);
CREATE INDEX homework_assignments_due ON public.homework_assignments (due_at DESC);

COMMENT ON TABLE public.homework_assignments IS
  'Homework a teacher sets for batches with a deadline (2026-10-12). A teacher writes only rows they created.';

-- ── Submissions ────────────────────────────────────────────────────────────
CREATE TABLE public.homework_submissions (
  id uuid PRIMARY KEY,
  -- RESTRICT: homework someone has submitted is never deleted out from under them.
  assignment_id uuid NOT NULL REFERENCES public.homework_assignments(id) ON DELETE RESTRICT,
  lws_id text NOT NULL REFERENCES public.students(lws_id) ON DELETE CASCADE,
  student_name text NOT NULL CHECK (length(btrim(student_name)) > 0),
  status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'submitted', 'graded', 'rejected')),
  -- [path] in page order, built by submissionFilePath.
  files jsonb NOT NULL CHECK (jsonb_typeof(files) = 'array' AND jsonb_array_length(files) BETWEEN 1 AND 20),
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  graded_at timestamptz,
  regraded_at timestamptz,
  grader text CHECK (grader IS NULL OR grader IN ('session', 'api')),
  total_awarded numeric,
  total_max numeric,
  went_well text CHECK (went_well IS NULL OR length(btrim(went_well)) BETWEEN 1 AND 1500),
  next_steps text CHECK (next_steps IS NULL OR length(btrim(next_steps)) BETWEEN 1 AND 1500),
  rejected_reason text CHECK (rejected_reason IS NULL OR length(btrim(rejected_reason)) BETWEEN 1 AND 300),
  scans_deleted_at timestamptz,
  CONSTRAINT homework_submissions_state CHECK (
    (status = 'uploading' AND submitted_at IS NULL AND graded_at IS NULL
      AND total_awarded IS NULL AND rejected_reason IS NULL AND grader IS NULL)
    OR (status = 'submitted' AND submitted_at IS NOT NULL AND graded_at IS NULL
      AND total_awarded IS NULL AND rejected_reason IS NULL AND grader IS NULL)
    OR (status = 'graded' AND submitted_at IS NOT NULL AND graded_at IS NOT NULL AND grader IS NOT NULL
      AND total_awarded IS NOT NULL AND total_max IS NOT NULL
      AND total_awarded >= 0 AND total_awarded <= total_max
      AND went_well IS NOT NULL AND next_steps IS NOT NULL AND rejected_reason IS NULL)
    OR (status = 'rejected' AND submitted_at IS NOT NULL AND graded_at IS NOT NULL
      AND rejected_reason IS NOT NULL AND total_awarded IS NULL)
  )
);

-- One per student per assignment, counting an unfinished upload (the start
-- function clears a stale one first). A rejected one frees the slot.
CREATE UNIQUE INDEX homework_submissions_one_per_student
  ON public.homework_submissions (assignment_id, lws_id) WHERE status <> 'rejected';
CREATE INDEX homework_submissions_queue ON public.homework_submissions (submitted_at) WHERE status = 'submitted';
CREATE INDEX homework_submissions_student ON public.homework_submissions (lws_id, created_at DESC);

COMMENT ON TABLE public.homework_submissions IS
  'A student''s uploaded answers to one homework assignment and its grading state (2026-10-12). Written by the service role only.';

-- ── Grades ─────────────────────────────────────────────────────────────────
CREATE TABLE public.homework_grades (
  submission_id uuid NOT NULL REFERENCES public.homework_submissions(id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position >= 1),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 40),
  max_marks numeric NOT NULL CHECK (max_marks > 0 AND max_marks * 2 = floor(max_marks * 2)),
  outcome text NOT NULL CHECK (outcome IN ('scored', 'not_attempted')),
  awarded numeric,
  earned text CHECK (earned IS NULL OR length(btrim(earned)) BETWEEN 1 AND 1000),
  missing text CHECK (missing IS NULL OR length(btrim(missing)) BETWEEN 1 AND 1000),
  PRIMARY KEY (submission_id, position),
  CONSTRAINT homework_grades_label_unique UNIQUE (submission_id, label),
  CONSTRAINT homework_grades_marks CHECK (
    (outcome = 'scored' AND awarded IS NOT NULL AND awarded >= 0 AND awarded <= max_marks
      AND awarded * 2 = floor(awarded * 2))
    OR (outcome <> 'scored' AND awarded IS NULL AND earned IS NULL AND missing IS NULL)
  )
);

COMMENT ON TABLE public.homework_grades IS
  'One graded question of a homework submission (2026-10-12). Replaced as a whole on every (re)grade.';

-- ── Row-level security ────────────────────────────────────────────────────
ALTER TABLE public.homework_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_grades ENABLE ROW LEVEL SECURITY;

CREATE POLICY homework_assignments_read ON public.homework_assignments
  FOR SELECT TO authenticated USING (true);
-- Staff write; a teacher only rows they created. Keyed on app_metadata (never
-- the self-editable user_metadata) and on the login email the row names.
CREATE POLICY homework_assignments_insert ON public.homework_assignments
  FOR INSERT TO authenticated
  WITH CHECK (((auth.jwt() -> 'app_metadata') ->> 'role') IS DISTINCT FROM 'teacher'
              OR created_by = (auth.jwt() ->> 'email'));
CREATE POLICY homework_assignments_update ON public.homework_assignments
  FOR UPDATE TO authenticated
  USING      (((auth.jwt() -> 'app_metadata') ->> 'role') IS DISTINCT FROM 'teacher'
              OR created_by = (auth.jwt() ->> 'email'))
  WITH CHECK (((auth.jwt() -> 'app_metadata') ->> 'role') IS DISTINCT FROM 'teacher'
              OR created_by = (auth.jwt() ->> 'email'));
CREATE POLICY homework_assignments_delete ON public.homework_assignments
  FOR DELETE TO authenticated
  USING (((auth.jwt() -> 'app_metadata') ->> 'role') IS DISTINCT FROM 'teacher'
         OR created_by = (auth.jwt() ->> 'email'));

CREATE POLICY homework_submissions_read ON public.homework_submissions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY homework_grades_read ON public.homework_grades
  FOR SELECT TO authenticated USING (true);

-- Storage. Staff read both buckets; staff write question/key files, a teacher
-- only into an assignment they created (the first path segment is its id).
CREATE POLICY homework_files_read ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'homework-files');
CREATE POLICY homework_files_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'homework-files' AND EXISTS (
    SELECT 1 FROM public.homework_assignments a
     WHERE a.id::text = (storage.foldername(name))[1]
       AND (((auth.jwt() -> 'app_metadata') ->> 'role') IS DISTINCT FROM 'teacher'
            OR a.created_by = (auth.jwt() ->> 'email'))));
CREATE POLICY homework_files_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'homework-files' AND EXISTS (
    SELECT 1 FROM public.homework_assignments a
     WHERE a.id::text = (storage.foldername(name))[1]
       AND (((auth.jwt() -> 'app_metadata') ->> 'role') IS DISTINCT FROM 'teacher'
            OR a.created_by = (auth.jwt() ->> 'email'))));
CREATE POLICY homework_files_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'homework-files' AND EXISTS (
    SELECT 1 FROM public.homework_assignments a
     WHERE a.id::text = (storage.foldername(name))[1]
       AND (((auth.jwt() -> 'app_metadata') ->> 'role') IS DISTINCT FROM 'teacher'
            OR a.created_by = (auth.jwt() ->> 'email'))));
CREATE POLICY homework_submissions_files_read ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'homework-submissions');

-- ── Functions (service role only) ─────────────────────────────────────────

-- Start an upload: refuse outside the open window or when the student already
-- has one that counts; clear a stale unfinished upload; insert the new row.
-- The caller mints p_id so it can build the file paths (submissionFilePath)
-- before the row exists.
CREATE OR REPLACE FUNCTION public.homework_submission_start(
  p_id uuid, p_assignment uuid, p_lws_id text, p_files jsonb
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_a public.homework_assignments%ROWTYPE;
  v_name text;
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
  IF EXISTS (SELECT 1 FROM public.homework_submissions
              WHERE assignment_id = p_assignment AND lws_id = p_lws_id
                AND status IN ('submitted', 'graded')) THEN
    RAISE EXCEPTION 'homework %: % has already submitted', p_assignment, p_lws_id;
  END IF;
  DELETE FROM public.homework_submissions
   WHERE assignment_id = p_assignment AND lws_id = p_lws_id AND status = 'uploading';
  INSERT INTO public.homework_submissions (id, assignment_id, lws_id, student_name, files)
  VALUES (p_id, p_assignment, p_lws_id, v_name, p_files);
END;
$$;

REVOKE ALL ON FUNCTION public.homework_submission_start(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.homework_submission_start(uuid, uuid, text, jsonb) TO service_role;

-- Send an uploaded submission for grading, still inside the open window.
CREATE OR REPLACE FUNCTION public.homework_submission_submit(p_id uuid, p_lws_id text)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_sub public.homework_submissions%ROWTYPE;
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
  UPDATE public.homework_submissions SET status = 'submitted', submitted_at = now() WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.homework_submission_submit(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.homework_submission_submit(uuid, text) TO service_role;

-- Save a grade: replace the rows, check they cover the assignment's marks, sum
-- the total HERE, and mark the submission graded, in one transaction. Accepts a
-- submission already graded (a regrade).
CREATE OR REPLACE FUNCTION public.homework_grade_commit(
  p_submission uuid, p_grades jsonb, p_went_well text, p_next_steps text, p_grader text
)
RETURNS numeric
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_sub public.homework_submissions%ROWTYPE;
  v_max numeric;
  v_sum_max numeric;
  v_total numeric;
BEGIN
  SELECT * INTO v_sub FROM public.homework_submissions WHERE id = p_submission FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'submission % not found', p_submission;
  END IF;
  IF v_sub.status NOT IN ('submitted', 'graded') THEN
    RAISE EXCEPTION 'submission % is %, so it cannot be graded', p_submission, v_sub.status;
  END IF;
  SELECT max_marks INTO v_max FROM public.homework_assignments WHERE id = v_sub.assignment_id;

  DELETE FROM public.homework_grades WHERE submission_id = p_submission;
  INSERT INTO public.homework_grades
    (submission_id, position, label, max_marks, outcome, awarded, earned, missing)
  SELECT p_submission, (g->>'position')::smallint, btrim(g->>'label'), (g->>'maxMarks')::numeric,
         g->>'outcome', (g->>'awarded')::numeric,
         NULLIF(btrim(g->>'earned'), ''), NULLIF(btrim(g->>'missing'), '')
    FROM jsonb_array_elements(p_grades) AS g;

  SELECT COALESCE(sum(max_marks), 0) INTO v_sum_max FROM public.homework_grades WHERE submission_id = p_submission;
  IF v_sum_max <> v_max THEN
    RAISE EXCEPTION 'submission %: the questions add up to % but the homework is out of %', p_submission, v_sum_max, v_max;
  END IF;
  SELECT COALESCE(sum(awarded), 0) INTO v_total
    FROM public.homework_grades WHERE submission_id = p_submission AND outcome = 'scored';

  UPDATE public.homework_submissions SET
    status = 'graded',
    graded_at = COALESCE(graded_at, now()),
    regraded_at = CASE WHEN v_sub.status = 'graded' THEN now() ELSE NULL END,
    grader = p_grader,
    total_awarded = v_total,
    total_max = v_max,
    went_well = btrim(p_went_well),
    next_steps = btrim(p_next_steps)
  WHERE id = p_submission;
  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.homework_grade_commit(uuid, jsonb, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.homework_grade_commit(uuid, jsonb, text, text, text) TO service_role;

-- Turn a submission away (unreadable, wrong homework, blank). Frees the
-- student's slot — but only while the homework is still open can they use it.
CREATE OR REPLACE FUNCTION public.homework_submission_reject(p_submission uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  UPDATE public.homework_submissions
     SET status = 'rejected', graded_at = now(), rejected_reason = btrim(p_reason)
   WHERE id = p_submission AND status = 'submitted';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'submission % is not waiting to be graded', p_submission;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.homework_submission_reject(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.homework_submission_reject(uuid, text) TO service_role;
