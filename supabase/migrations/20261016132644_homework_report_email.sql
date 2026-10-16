-- Emailing the marked-paper report (2026-10-16). Staff send it from the local
-- admin app (scripts/grading/_sendReports.js via the dev server); the sender
-- stamps report_emailed_at after Gmail accepts the message.
--
-- Any change to the grade (a regrade, a hold, a release) clears the stamp in a
-- BEFORE UPDATE trigger, so a changed grade shows as "not sent" and the
-- student is sent the updated paper. Written before the row, so the CHECK
-- below sees the cleared value.

ALTER TABLE public.homework_submissions
  ADD COLUMN report_emailed_at timestamptz;
ALTER TABLE public.homework_submissions
  ADD CONSTRAINT homework_submissions_report_emailed
    CHECK (report_emailed_at IS NULL OR (status = 'graded' AND marked_pages IS NOT NULL));

COMMENT ON COLUMN public.homework_submissions.report_emailed_at IS
  'When the marked-paper report was last emailed to the student (2026-10-16). Only on a released grade with a marked paper; cleared by any change to the grade.';

CREATE OR REPLACE FUNCTION public.homework_submissions_regrade_unsent()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF NEW.regraded_at IS DISTINCT FROM OLD.regraded_at OR NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.report_emailed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER homework_submissions_regrade_unsent
  BEFORE UPDATE ON public.homework_submissions FOR EACH ROW
  EXECUTE FUNCTION public.homework_submissions_regrade_unsent();
