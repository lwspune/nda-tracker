create table public.homework_pending (
  id          uuid primary key default gen_random_uuid(),
  lws_id      text not null references public.students(lws_id) on delete cascade,
  date        text not null,
  subject     text not null,
  chapter     text not null,
  type        text not null check (type in ('homework','notes','both')),
  created_at  timestamptz default now(),
  created_by  text,
  resolved_at timestamptz,
  resolved_by text,
  notified_at timestamptz,
  unique (lws_id, date, subject, chapter, type)
);

create index homework_pending_date_idx     on public.homework_pending (date);
create index homework_pending_lws_date_idx on public.homework_pending (lws_id, date);
create index homework_pending_open_idx     on public.homework_pending (lws_id, resolved_at);

alter table public.homework_pending enable row level security;
create policy faculty_rw on public.homework_pending for all to authenticated using (true) with check (true);