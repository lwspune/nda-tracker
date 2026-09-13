-- Teachers can now create their own offline "Written Quiz" exams from
-- /school-attendance. There was no way to tell who added an exam, which is the
-- one thing the office needs in exchange for dropping the approval gate:
-- review-after instead of approve-before.
--
-- `source` also drives the parent-facing report tag — a teacher-created offline
-- exam renders as "Written Quiz" so it does not read like a full mock. All 116
-- existing rows are admin-created, so the default is already correct and no
-- backfill is needed.
alter table exams
  add column if not exists created_by text,
  add column if not exists source text not null default 'admin';

alter table exams
  add constraint exams_source_check check (source in ('admin', 'teacher'));

comment on column exams.created_by is
  'Auth session email of whoever created the exam. Displayed on the admin Exams page, resolved to timetableTeachers[].name where possible. NULL for rows predating 2026-07-28.';
comment on column exams.source is
  'admin = office-created (Evalbee mocks, admin offline entry) | teacher = created from /school-attendance. Drives the "Written Quiz" tag in parent-facing reports.';