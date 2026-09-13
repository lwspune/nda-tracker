-- faculty_state is a single whole-blob row: persist.js saveToStorage serialises
-- EVERY allow-listed key, so any mutation from any client rewrites everything.
-- Teacher clients now have write UI (/school-attendance), and saveToStorage is
-- session-gated but NOT mode-gated — so a stray store mutation from a teacher
-- would clobber syllabus/timetable/send-history wholesale.
--
-- Reads stay open (the teacher portal loads syllabus + timetable from here).
-- Writes are denied to role='teacher'. Admin has no role claim and superadmin
-- has 'superadmin', so both satisfy IS DISTINCT FROM 'teacher'.
drop policy if exists faculty_rw on public.faculty_state;

create policy faculty_read on public.faculty_state
  for select to authenticated using (true);

create policy faculty_write_insert on public.faculty_state
  for insert to authenticated
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') is distinct from 'teacher');

create policy faculty_write_update on public.faculty_state
  for update to authenticated
  using      ((auth.jwt() -> 'user_metadata' ->> 'role') is distinct from 'teacher')
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') is distinct from 'teacher');

create policy faculty_write_delete on public.faculty_state
  for delete to authenticated
  using ((auth.jwt() -> 'user_metadata' ->> 'role') is distinct from 'teacher');