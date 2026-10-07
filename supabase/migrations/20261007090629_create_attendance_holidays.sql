-- Days with no class, per branch (and optionally per batch). Attendance % skips a
-- student's row on a date covered by a holiday for their branch/batch; the
-- register row itself is never deleted, so removing a holiday restores the
-- numbers. Sundays are off by rule in src/lib/holidays.js and are NOT stored here.
--
-- branch is free text with no FK: branches and batches live in the
-- faculty_state JSONB, same as lecture_submissions.batch_name.
create table if not exists public.attendance_holidays (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  from_date   date not null,
  to_date     date not null,
  branch      text not null check (length(btrim(branch)) > 0),
  batch_names text[] not null default '{}',   -- empty = the whole branch
  created_by  text,
  created_at  timestamptz not null default now(),
  constraint attendance_holidays_range_order check (to_date >= from_date),
  -- A typo guard: a mistyped year would otherwise silently excuse a whole year.
  constraint attendance_holidays_range_span  check (to_date - from_date <= 92),
  constraint attendance_holidays_no_blank_batch check (array_position(batch_names, '') is null)
);

create index if not exists attendance_holidays_range_idx
  on public.attendance_holidays (branch, from_date, to_date);

-- Hand-written DDL leaves RLS off by default — enable explicitly.
alter table public.attendance_holidays enable row level security;

-- Everyone signed in reads (teachers see attendance %, so they need the days off).
create policy holidays_read on public.attendance_holidays
  for select to authenticated using (true);

-- Writes: anyone but a teacher, keyed on app_metadata (never user_metadata).
create policy holidays_write_insert on public.attendance_holidays
  for insert to authenticated
  with check (((auth.jwt() -> 'app_metadata') ->> 'role') is distinct from 'teacher');
create policy holidays_write_update on public.attendance_holidays
  for update to authenticated
  using      (((auth.jwt() -> 'app_metadata') ->> 'role') is distinct from 'teacher')
  with check (((auth.jwt() -> 'app_metadata') ->> 'role') is distinct from 'teacher');
create policy holidays_write_delete on public.attendance_holidays
  for delete to authenticated
  using (((auth.jwt() -> 'app_metadata') ->> 'role') is distinct from 'teacher');
