-- Superadmin-only fee tracking. Three tables: the agreement, the schedule, the ledger.
--
-- Everything derivable stays derived (paid, remaining, next due, overdue, status)
-- and lives in src/lib/fees.js — the EIS exports prove `Remaining = Committed - Paid`
-- on every row, so storing it would only create a value that can go stale.
--
-- The `eis_*` columns are the vendor's own snapshot figures. They are NOT the
-- app's source of truth; they are kept as an INDEPENDENT second opinion to
-- cross-check our ledger-derived numbers against.

create table public.student_fee_plans (
  id                    uuid primary key default gen_random_uuid(),
  lws_id                text not null references public.students(lws_id) on delete cascade,
  plan_label            text,                 -- "Registrationfor Course" from the export
  gross                 numeric(12,2),        -- list price before discount
  committed             numeric(12,2),        -- agreed price; NULL = not yet known
  notes                 text,
  -- vendor snapshot (cross-check only, never the denominator)
  eis_paid              numeric(12,2),
  eis_next_due_date     date,
  eis_next_due_amount   numeric(12,2),
  eis_fees_status       text,
  snapshot_date         date,
  created_by            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- plan_label is nullable, and NULLs never collide in a plain UNIQUE — coalesce so
-- a re-import updates the existing unlabelled plan instead of adding a duplicate.
create unique index student_fee_plans_lws_label_key
  on public.student_fee_plans (lws_id, coalesce(plan_label, ''));
create index student_fee_plans_lws_idx on public.student_fee_plans (lws_id);

create table public.fee_installments (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references public.student_fee_plans(id) on delete cascade,
  seq           int  not null,
  due_date      date not null,
  amount        numeric(12,2) not null,
  waived        boolean not null default false,
  snapshot_date date,
  created_at    timestamptz not null default now(),
  unique (plan_id, seq)
);
create index fee_installments_plan_idx on public.fee_installments (plan_id);
create index fee_installments_due_idx  on public.fee_installments (due_date);

-- Attached to the student, not the plan: the receipts export identifies the payer
-- but not which plan the money was for, and inferring it from a free-text course
-- string would be a guess. Students carry one plan in practice.
create table public.fee_payments (
  id              uuid primary key default gen_random_uuid(),
  lws_id          text not null references public.students(lws_id) on delete cascade,
  receipt_no      text not null unique,       -- unique across all 125 export rows -> the upsert key
  paid_on         date not null,
  cleared_on      date,
  amount          numeric(12,2) not null,
  mode            text,                       -- Online Gateway | Cash | Google Pay
  reference       text,
  reference_date  date,
  bank_name       text,
  cleared_status  text,
  course_raw      text,
  recorded_by     text,
  imported_at     timestamptz not null default now()
);
create index fee_payments_lws_idx     on public.fee_payments (lws_id);
create index fee_payments_paid_on_idx on public.fee_payments (paid_on);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Hand-written DDL leaves RLS OFF by default; that is how two tables ended up
-- anon-readable on 2026-08-11. Enable explicitly, then a single superadmin policy
-- keyed on app_metadata (Admin-API-only) — never user_metadata, which the account
-- holder can rewrite.
alter table public.student_fee_plans enable row level security;
alter table public.fee_installments  enable row level security;
alter table public.fee_payments      enable row level security;

create policy fees_superadmin_all on public.student_fee_plans
  for all to authenticated
  using      (((auth.jwt() -> 'app_metadata') ->> 'role') = 'superadmin')
  with check (((auth.jwt() -> 'app_metadata') ->> 'role') = 'superadmin');

create policy fees_superadmin_all on public.fee_installments
  for all to authenticated
  using      (((auth.jwt() -> 'app_metadata') ->> 'role') = 'superadmin')
  with check (((auth.jwt() -> 'app_metadata') ->> 'role') = 'superadmin');

create policy fees_superadmin_all on public.fee_payments
  for all to authenticated
  using      (((auth.jwt() -> 'app_metadata') ->> 'role') = 'superadmin')
  with check (((auth.jwt() -> 'app_metadata') ->> 'role') = 'superadmin');