
create table if not exists public.integrity_incidents (
  id uuid primary key default gen_random_uuid(),
  lws_id text not null references public.students(lws_id) on delete cascade,
  student_name text not null,
  exam_id text,
  exam_name text,
  exam_date text,
  counterpart_name text,
  counterpart_lws_id text,
  shared_wrong int,
  same_correct int,
  diff int,
  both_answered int,
  status text not null default 'admitted',
  note text,
  created_at timestamptz not null default now(),
  created_by text,
  unique (lws_id, exam_id)
);

alter table public.integrity_incidents enable row level security;

create policy integrity_incidents_authenticated_all on public.integrity_incidents
  for all to authenticated using (true) with check (true);

create index if not exists integrity_incidents_lws_id_idx on public.integrity_incidents (lws_id);
create index if not exists integrity_incidents_exam_id_idx on public.integrity_incidents (exam_id);
