create table if not exists public.teacher_calendar_blocks (
  block_key   text primary key,
  teacher_id  text,
  event_id    text not null,
  calendar_id text not null,
  signature   text not null,
  synced_at   timestamptz not null default now()
);
-- Sync ledger for Google Calendar teaching-block events. Written ONLY by the
-- sync-calendar serverless endpoint via the service role. RLS enabled with no
-- public policy => anon/authenticated clients are denied; service role bypasses.
alter table public.teacher_calendar_blocks enable row level security;
create index if not exists idx_tcb_teacher on public.teacher_calendar_blocks (teacher_id);