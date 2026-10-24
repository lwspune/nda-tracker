-- One row per (date, student) the nightly attendance report has reached
-- (2026-10-23). Written by api/send-attendance-alerts.js kind:'attendance-report'
-- BEFORE any message goes out: the primary key is the "never twice" guard, so a
-- re-upload, a double click or two tabs racing reach each family once. A row
-- whose family no message reached is deleted again so the next run retries it.
--
-- `date` is the report's day (from the Punch Monitor file title), not the day
-- it was sent.
create table if not exists public.attendance_report_sends (
  date     date not null,
  lws_id   text not null references public.students(lws_id) on delete cascade,
  sent_at  timestamptz not null default now(),
  sent_by  uuid default auth.uid(),
  primary key (date, lws_id)
);

comment on table public.attendance_report_sends is
  'Nightly attendance report: which students were messaged for which date (2026-10-23). PK is the no-double-send guard.';

-- Hand-written DDL leaves RLS off by default — enable explicitly.
alter table public.attendance_report_sends enable row level security;

-- Office only, keyed on app_metadata (never user_metadata). Teachers neither
-- read nor write: the send is parent-facing and stays with the office.
-- No UPDATE policy: a row is claimed or released, never edited.
create policy attendance_report_sends_read on public.attendance_report_sends
  for select to authenticated
  using (((auth.jwt() -> 'app_metadata') ->> 'role') is distinct from 'teacher');
create policy attendance_report_sends_insert on public.attendance_report_sends
  for insert to authenticated
  with check (((auth.jwt() -> 'app_metadata') ->> 'role') is distinct from 'teacher');
create policy attendance_report_sends_delete on public.attendance_report_sends
  for delete to authenticated
  using (((auth.jwt() -> 'app_metadata') ->> 'role') is distinct from 'teacher');
