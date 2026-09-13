-- Close two RLS-disabled holes reachable with the browser-bundle anon key.
-- Found 2026-08-11: both tables were created by hand via SQL, where RLS
-- defaults to OFF, so they silently opted out of the protection every other
-- public table has.

-- 1. Dead 30-July snapshot of faculty_state. Held 493 student profiles
--    (name, mobile, parent mobiles, DOB, gender) readable by anon.
--    RLS on with NO policies = service-role only, matching the existing
--    teacher_calendar_blocks posture. Data is preserved; delete decision
--    deferred by ~1 month (review 2026-09-11).
ALTER TABLE public.faculty_state_backup_selfstudy_20260730
  ENABLE ROW LEVEL SECURITY;

-- 2. Login audit trail. Reads are admin/teacher only (StudentView's
--    "Last login" badge, already gated to mode !== 'student').
ALTER TABLE public.student_logins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can read"
  ON public.student_logins FOR SELECT
  TO authenticated
  USING (true);

-- NOTE: deliberately NO insert policy. api/student-login.js writes with the
-- service role key, which bypasses RLS. The variant drafted in SECURITY.md
-- granted anon INSERT "defensively" — that would preserve exactly the
-- audit-log pollution this migration exists to close.