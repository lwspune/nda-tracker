-- Filing record for the /school-attendance teacher capture flow.
-- Without this, zero lecture_absences rows means BOTH "filed, nobody absent"
-- AND "never filed" — so an unfiled period silently reads as clean attendance.
-- One row per (date, slot_id, batch_name) = "this period was accounted for".
create table if not exists public.lecture_submissions (
  id           uuid primary key default gen_random_uuid(),
  date         text not null,                      -- 'YYYY-MM-DD', matches lecture_absences
  slot_id      text not null,                      -- timetable slot, or 'adhoc_*' for impromptu
  batch_name   text not null,                      -- slot ids are per-timetable, so batch is part of identity
  subject      text,
  teacher_id   text,                               -- timetableTeachers[].id — JSONB-owned, so no FK
  absent_count integer not null default 0,
  submitted_by text,                                -- auth email (accountability)
  submitted_at timestamptz not null default now(),
  source       text not null default 'teacher',     -- 'teacher' | 'admin'
  unique (date, slot_id, batch_name)
);

create index if not exists lecture_submissions_date_idx on public.lecture_submissions (date);
create index if not exists lecture_submissions_teacher_idx on public.lecture_submissions (teacher_id);

alter table public.lecture_submissions enable row level security;

-- Same posture as lecture_absences: teachers MUST be able to write this one.
drop policy if exists faculty_rw on public.lecture_submissions;
create policy faculty_rw on public.lecture_submissions
  for all to authenticated using (true) with check (true);