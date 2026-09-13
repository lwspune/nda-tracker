create table if not exists mentor_assignments (
  lws_id      text primary key references students(lws_id) on delete cascade,
  teacher_id  text not null,
  created_at  timestamptz default now()
);

create table if not exists mentor_nudges (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  text not null,
  lws_id      text not null,
  date        text not null,
  created_at  timestamptz default now()
);

create index if not exists mentor_nudges_teacher_date on mentor_nudges (teacher_id, date);
create index if not exists mentor_nudges_lws on mentor_nudges (lws_id);
create index if not exists mentor_assignments_teacher on mentor_assignments (teacher_id);

alter table mentor_assignments enable row level security;
alter table mentor_nudges enable row level security;

create policy faculty_rw on mentor_assignments for all to authenticated using (true) with check (true);
create policy faculty_rw on mentor_nudges for all to authenticated using (true) with check (true);