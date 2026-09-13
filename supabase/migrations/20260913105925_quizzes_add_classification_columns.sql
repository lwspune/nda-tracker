-- Repair, found by the 2026-09-13 migration export: quizzes.exam / .chapter /
-- .theme exist in production but were added out-of-band (hand-run SQL, no
-- migration), so they were absent from migration history entirely.
--
-- They are NOT dormant — `buildQuizRow` (src/store/slices/quizSupabase.js)
-- writes all three on every quiz save, so a Supabase project rebuilt by
-- replaying the other migrations would reject every quiz write with
-- PGRST204 "column not found".
--
-- IF NOT EXISTS throughout: this is a no-op against the project that already
-- has them, and the real definition for any project built from scratch.
alter table public.quizzes
  add column if not exists exam    text,
  add column if not exists chapter text,
  add column if not exists theme   text;
