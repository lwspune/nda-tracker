-- Daily Quiz feature (Phase 0)
-- quizzes: teacher-authored MCQ quizzes. Question shape mirrors exams.questions[]
-- so all existing rendering/tagging reuses. Deliberately a SEPARATE table from
-- `exams` so daily quizzes never pollute mock dashboards or the exam-absence flow.
create table public.quizzes (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  subject     text,
  batch       text,                       -- comma-joined for multi-batch (read via getExamBatches)
  branch      text,
  marking     jsonb not null default '{"correct": 1, "wrong": 0}'::jsonb,
  questions   jsonb not null default '[]'::jsonb,
  opens_at    timestamptz,
  closes_at   timestamptz,
  status      text not null default 'draft' check (status in ('draft','published')),
  created_by  text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- quiz_attempts: one row per (quiz, student). Stores the chosen LETTER per question
-- (A/B/C/D) so review + recompute work; score is graded server-side at submit time.
create table public.quiz_attempts (
  id            uuid primary key default gen_random_uuid(),
  quiz_id       uuid not null references public.quizzes(id) on delete cascade,
  lws_id        text not null references public.students(lws_id) on delete cascade,
  student_name  text not null,            -- denormalized, history-safe
  answers       jsonb not null default '{}'::jsonb,   -- { "1": "A", "2": "C", ... }
  score         numeric not null default 0,
  correct       int not null default 0,
  incorrect     int not null default 0,
  not_attempted int not null default 0,
  started_at    timestamptz,
  submitted_at  timestamptz default now(),
  created_at    timestamptz default now(),
  unique (quiz_id, lws_id)
);

create index quizzes_status_idx        on public.quizzes(status);
create index quiz_attempts_quiz_id_idx on public.quiz_attempts(quiz_id);
create index quiz_attempts_lws_id_idx  on public.quiz_attempts(lws_id);

-- RLS: authenticated (admin + teacher) read/write directly — same pattern as the
-- exam/attendance/homework tables. Students have NO Supabase session and reach
-- these only through serverless endpoints (service role), added in Phase 2.
alter table public.quizzes       enable row level security;
alter table public.quiz_attempts enable row level security;

create policy quizzes_authenticated_all on public.quizzes
  for all to authenticated using (true) with check (true);
create policy quiz_attempts_authenticated_all on public.quiz_attempts
  for all to authenticated using (true) with check (true);