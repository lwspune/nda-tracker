-- The transitional deny-union (added with the app_metadata migration earlier today)
-- also tested user_metadata, to cover access tokens issued BEFORE the migration —
-- RLS reads the JWT directly and access tokens are stateless, so the global
-- sign-out could not revoke them. All refresh tokens were revoked at ~10:35 UTC,
-- so the longest-lived pre-migration access token expired one TTL later
-- (Supabase default 3600s). That window has passed; drop the user_metadata half.
alter policy faculty_write_insert on public.faculty_state
  with check (((auth.jwt() -> 'app_metadata') ->> 'role') is distinct from 'teacher');

alter policy faculty_write_update on public.faculty_state
  using      (((auth.jwt() -> 'app_metadata') ->> 'role') is distinct from 'teacher')
  with check (((auth.jwt() -> 'app_metadata') ->> 'role') is distinct from 'teacher');

alter policy faculty_write_delete on public.faculty_state
  using (((auth.jwt() -> 'app_metadata') ->> 'role') is distinct from 'teacher');