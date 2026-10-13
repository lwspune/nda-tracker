-- Homework handwriting check, PART 3 of 3 (2026-10-13): the functions. See part 1
-- for the design. Applied in the Supabase SQL editor: the connector declined it.

-- ── Functions ──────────────────────────────────────────────────────────────

-- A held submission is the student's one hand-in, like a submitted or graded one.
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
                AND status IN ('submitted', 'held', 'graded')) THEN
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

-- Save a grade WITH its handwriting check. Replaces the five-argument version,
-- which is dropped so nothing can save a grade without a check.
DROP FUNCTION public.homework_grade_commit(uuid, jsonb, text, text, text);

CREATE OR REPLACE FUNCTION public.homework_grade_commit(
  p_submission uuid, p_grades jsonb, p_went_well text, p_next_steps text, p_grader text,
  p_hand_check text, p_hand_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_sub public.homework_submissions%ROWTYPE;
  v_max numeric;
  v_sum_max numeric;
  v_total numeric;
  v_ref uuid;
  v_note text := NULLIF(btrim(p_hand_note), '');
  v_status text;
BEGIN
  SELECT * INTO v_sub FROM public.homework_submissions WHERE id = p_submission FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'submission % not found', p_submission;
  END IF;
  IF v_sub.status NOT IN ('submitted', 'held', 'graded') THEN
    RAISE EXCEPTION 'submission % is %, so it cannot be graded', p_submission, v_sub.status;
  END IF;

  -- The handwriting check, against the reference this database holds.
  IF p_hand_check IS NULL OR p_hand_check NOT IN ('match', 'mismatch', 'unclear', 'no_reference') THEN
    RAISE EXCEPTION 'submission %: record a handwriting check', p_submission;
  END IF;
  SELECT submission_id INTO v_ref FROM public.homework_hand_references
   WHERE lws_id = v_sub.lws_id AND submission_id <> p_submission;
  IF v_ref IS NULL AND p_hand_check IN ('match', 'unclear') THEN
    RAISE EXCEPTION 'submission %: the student has no handwriting reference to compare against', p_submission;
  END IF;
  IF v_ref IS NOT NULL AND p_hand_check = 'no_reference' THEN
    RAISE EXCEPTION 'submission %: the student has a handwriting reference; compare against it', p_submission;
  END IF;
  IF p_hand_check IN ('mismatch', 'unclear') AND v_note IS NULL THEN
    RAISE EXCEPTION 'submission %: a % needs a note saying what differs', p_submission, p_hand_check;
  END IF;
  v_status := CASE WHEN p_hand_check = 'mismatch' THEN 'held' ELSE 'graded' END;

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
    status = v_status,
    graded_at = COALESCE(graded_at, now()),
    regraded_at = CASE WHEN v_sub.status IN ('graded', 'held') THEN now() ELSE NULL END,
    grader = p_grader,
    total_awarded = v_total,
    total_max = v_max,
    went_well = btrim(p_went_well),
    next_steps = btrim(p_next_steps),
    hand_check = p_hand_check,
    hand_note = v_note,
    hand_reference_id = v_ref,
    -- A regrade is new evidence: a mismatch must be released again.
    resolved_at = NULL,
    resolved_by = NULL
  WHERE id = p_submission;

  -- The student's first graded homework that was not held becomes their reference.
  IF v_status = 'graded' THEN
    INSERT INTO public.homework_hand_references (lws_id, submission_id)
    VALUES (v_sub.lws_id, p_submission)
    ON CONFLICT (lws_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('total', v_total, 'status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.homework_grade_commit(uuid, jsonb, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.homework_grade_commit(uuid, jsonb, text, text, text, text, text) TO service_role;

-- Release a held grade, or send it back with a reason. The one homework
-- function signed-in staff call directly, so it checks who is asking HERE:
-- an admin on any homework, a teacher only on homework they set (the same rule
-- as homework_assignments' write policies). The page hiding other teachers'
-- homework is a convenience, not this boundary.
CREATE OR REPLACE FUNCTION public.homework_held_resolve(p_submission uuid, p_action text, p_reason text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text := (auth.jwt() -> 'app_metadata') ->> 'role';
  v_email text := auth.jwt() ->> 'email';
  v_sub public.homework_submissions%ROWTYPE;
  v_created_by text;
  v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
  IF auth.uid() IS NULL OR v_email IS NULL THEN
    RAISE EXCEPTION 'Sign in to release or send back a grade.';
  END IF;
  SELECT * INTO v_sub FROM public.homework_submissions WHERE id = p_submission FOR UPDATE;
  IF NOT FOUND OR v_sub.status <> 'held' THEN
    RAISE EXCEPTION 'This grade is no longer held. Reload the page.';
  END IF;
  SELECT created_by INTO v_created_by FROM public.homework_assignments WHERE id = v_sub.assignment_id;
  IF v_role = 'teacher' AND lower(v_created_by) <> lower(v_email) THEN
    RAISE EXCEPTION 'This homework was set by another teacher.';
  END IF;

  IF p_action = 'release' THEN
    UPDATE public.homework_submissions
       SET status = 'graded', resolved_at = now(), resolved_by = v_email
     WHERE id = p_submission;
    RETURN 'graded';
  ELSIF p_action = 'reject' THEN
    IF v_reason IS NULL OR length(v_reason) < 10 OR length(v_reason) > 300 THEN
      RAISE EXCEPTION 'Give the student a reason of 10 to 300 characters.';
    END IF;
    -- The student sees only the reason; the held marks and feedback go.
    DELETE FROM public.homework_grades WHERE submission_id = p_submission;
    UPDATE public.homework_submissions
       SET status = 'rejected', rejected_reason = v_reason,
           total_awarded = NULL, total_max = NULL, went_well = NULL, next_steps = NULL,
           resolved_at = now(), resolved_by = v_email
     WHERE id = p_submission;
    RETURN 'rejected';
  END IF;
  RAISE EXCEPTION 'Unknown action %', p_action;
END;
$$;

REVOKE ALL ON FUNCTION public.homework_held_resolve(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.homework_held_resolve(uuid, text, text) TO authenticated;
