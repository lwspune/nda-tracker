create table public.teacher_feedback (
  id           uuid primary key default gen_random_uuid(),
  cycle        text not null,                 -- form/cycle label, e.g. '03 LWS Pune'
  branch       text,                          -- 'LWS Pune' / 'APJ'
  submitted_at timestamptz,                   -- the form Timestamp
  teacher_name text not null,                 -- canonical timetableTeachers name
  clarity      int check (clarity      is null or clarity      between 1 and 5),
  engagement   int check (engagement   is null or engagement   between 1 and 5),
  support      int check (support      is null or support      between 1 and 5),
  feedback     int check (feedback     is null or feedback     between 1 and 5),
  pace         int check (pace         is null or pace         between 1 and 5),
  respect      int check (respect      is null or respect      between 1 and 5),
  organization int check (organization is null or organization between 1 and 5),
  availability int check (availability is null or availability between 1 and 5),
  comment      text,
  created_at   timestamptz default now(),
  created_by   text
);

create index teacher_feedback_teacher_idx on public.teacher_feedback (teacher_name);
create index teacher_feedback_cycle_idx   on public.teacher_feedback (cycle);

-- HR-sensitive: only a superadmin (user_metadata.role) may read or write. This is
-- stricter than the project's usual `authenticated`-only policies — the normal
-- admin account has no role claim and therefore cannot see staff feedback.
alter table public.teacher_feedback enable row level security;
create policy superadmin_all on public.teacher_feedback
  for all to authenticated
  using      ((auth.jwt() -> 'user_metadata' ->> 'role') = 'superadmin')
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') = 'superadmin');