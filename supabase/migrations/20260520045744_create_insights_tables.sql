-- Class reports: AI-generated or manual reports, scoped to an exam (nullable for class-wide/legacy)
create table public.class_reports (
  id uuid primary key default gen_random_uuid(),
  exam_id text references public.exams(id) on delete set null,
  text text not null,
  generated_at timestamptz not null default now(),
  generated_by text,
  unique (generated_at)
);

create index class_reports_exam_id_generated_at_idx
  on public.class_reports (exam_id, generated_at desc);

-- Student plans: AI-generated or manual improvement plans per student
-- lws_id is nullable so plans for unresolved names can still be stored
create table public.student_plans (
  id uuid primary key default gen_random_uuid(),
  lws_id text references public.students(lws_id) on delete set null,
  student_name text not null,
  text text not null,
  generated_at timestamptz not null default now(),
  generated_by text,
  unique (student_name, generated_at)
);

create index student_plans_lws_id_generated_at_idx
  on public.student_plans (lws_id, generated_at desc);

create index student_plans_student_name_generated_at_idx
  on public.student_plans (student_name, generated_at desc);

-- RLS: authenticated users only (faculty + teacher accounts). UI gates teacher access to Insights page.
alter table public.class_reports enable row level security;
alter table public.student_plans  enable row level security;

create policy "auth read class_reports"
  on public.class_reports for select to authenticated using (true);

create policy "auth insert class_reports"
  on public.class_reports for insert to authenticated with check (true);

create policy "auth delete class_reports"
  on public.class_reports for delete to authenticated using (true);

create policy "auth read student_plans"
  on public.student_plans for select to authenticated using (true);

create policy "auth insert student_plans"
  on public.student_plans for insert to authenticated with check (true);

create policy "auth delete student_plans"
  on public.student_plans for delete to authenticated using (true);