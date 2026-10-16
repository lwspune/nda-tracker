-- Why each question lost marks (2026-10-16). Part 2 of 2: the grade function
-- writes cause and topic. Same signature, so CREATE OR REPLACE keeps every
-- caller; the grants are restated anyway. Otherwise identical to the version
-- in 20261013000000_homework_handwriting_check_3_functions.sql (checked against
-- the live definition before writing).

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
  -- cause/topic (2026-10-16): the table's checks refuse lost marks without a
  -- cause, a cause on full marks, and a concept/incomplete cause without a topic.
  INSERT INTO public.homework_grades
    (submission_id, position, label, max_marks, outcome, awarded, earned, missing, cause, topic)
  SELECT p_submission, (g->>'position')::smallint, btrim(g->>'label'), (g->>'maxMarks')::numeric,
         g->>'outcome', (g->>'awarded')::numeric,
         NULLIF(btrim(g->>'earned'), ''), NULLIF(btrim(g->>'missing'), ''),
         NULLIF(btrim(g->>'cause'), ''), NULLIF(btrim(g->>'topic'), '')
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
