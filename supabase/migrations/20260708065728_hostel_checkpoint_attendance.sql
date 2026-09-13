-- Hostel + mess attendance for boarders (APJ branch). Exception-capture model,
-- mirroring lecture_absences: a row = a deviation from present.

-- 1. Capturable hostel/mess checkpoint exceptions.
create table if not exists checkpoint_absences (
  id uuid primary key default gen_random_uuid(),
  lws_id text not null references students(lws_id),
  date text not null,                    -- DD-MM-YYYY (matches student_attendance / lecture_absences)
  checkpoint text not null,              -- hostel_am | breakfast | lunch | dinner | hostel_pm
  status text not null default 'absent', -- absent | sick | outpass
  note text,
  created_by text,
  created_at timestamptz default now(),
  unique (lws_id, date, checkpoint)
);
create index if not exists checkpoint_absences_date_idx on checkpoint_absences (date);
create index if not exists checkpoint_absences_lws_idx on checkpoint_absences (lws_id);

-- 2. Leave / out-pass — explains absences across every checkpoint in its window.
create table if not exists leaves (
  id uuid primary key default gen_random_uuid(),
  lws_id text not null references students(lws_id),
  from_ts timestamptz not null,
  to_ts timestamptz not null,
  type text not null default 'leave',    -- leave | outpass | medical
  reason text,
  approved_by text,
  created_at timestamptz default now()
);
create index if not exists leaves_lws_idx on leaves (lws_id);
create index if not exists leaves_window_idx on leaves (from_ts, to_ts);

-- 3. Roll reconciliation gate (hostel_am / hostel_pm). reconciled=false => open incident.
create table if not exists checkpoint_confirmations (
  id uuid primary key default gen_random_uuid(),
  date text not null,
  checkpoint text not null,              -- hostel_am | hostel_pm
  branch text not null default 'APJ',
  expected_count int not null,
  exception_count int not null,
  confirmed_present int not null,
  reconciled boolean not null default false,
  confirmed_by text,
  confirmed_at timestamptz default now(),
  unique (date, checkpoint, branch)
);
create index if not exists checkpoint_confirmations_date_idx on checkpoint_confirmations (date);

-- Residential flag: default true (all current APJ students are boarders). Lets a
-- future day-scholar split scope the hostel/mess roster via a data edit, no migration.
alter table students add column if not exists residential boolean not null default true;

-- RLS — mirror the faculty_rw policy on the sibling attendance tables.
alter table checkpoint_absences enable row level security;
alter table leaves enable row level security;
alter table checkpoint_confirmations enable row level security;

create policy faculty_rw on checkpoint_absences      for all to authenticated using (true) with check (true);
create policy faculty_rw on leaves                    for all to authenticated using (true) with check (true);
create policy faculty_rw on checkpoint_confirmations  for all to authenticated using (true) with check (true);