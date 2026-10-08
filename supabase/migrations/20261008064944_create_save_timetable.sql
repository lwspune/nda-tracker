-- save_timetable: the ONLY way a teacher account can change faculty_state, and
-- only the timetable part of it.
--
-- Teachers are denied every write to faculty_state by RLS (faculty_write_*
-- policies). Some staff need to maintain the timetable, which lives in the same
-- one-row JSONB blob as the syllabus, settings and the teacher list — and every
-- client save rewrites the whole blob. A UI gate would not be a boundary: a
-- teacher allowed to write the row could write all of it. So this function is
-- the boundary instead. SECURITY DEFINER (runs as the owner, past RLS), and it:
--
--   1. admits only role='teacher' (app_metadata — never the self-editable
--      user_metadata) whose teacher record, matched by the JWT email and read
--      from the LIVE row, carries timetableAccess = true. Switching the
--      permission off in Settings takes effect on the next save;
--   2. accepts only the keys in v_allowed — never timetableTeachers, which
--      carries the permission flags themselves;
--   3. refuses adding, removing, or re-branching/renaming a timetable, and
--      refuses retiming or deleting an existing time slot. A timetabled
--      lecture_absences row stores no clock time, so retiming a slot silently
--      re-renders every past absence at the new time (CLAUDE.md, "Retiming a
--      slot rewrites HISTORY"); deleting one orphans them. Admins can still do
--      both, after running migrate_absence_times.js;
--   4. applies the same optimistic-concurrency guard as the admin path
--      (persist.js): NULL when the row moved since the caller loaded it.
--
-- Returns the new updated_at, the unchanged one for a no-op (so an untouched
-- reload never bumps the version and stales every admin tab), or NULL on a
-- lost race. Refusals raise: 42501 = not permitted, 22023 = a change it does
-- not accept.

create or replace function public.save_timetable(p_patch jsonb, p_known_version timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed constant text[] := array['timetables','timetableMappings','examSchedules'];
  v_claims  jsonb := auth.jwt();
  v_role    text  := (v_claims -> 'app_metadata') ->> 'role';
  v_email   text  := lower(btrim(coalesce(v_claims ->> 'email', '')));
  v_row     public.faculty_state%rowtype;
  v_old_tt  jsonb;
  v_new_tt  jsonb;
  v_new     jsonb;
  v_key     text;
  v_version timestamptz;
begin
  if v_role is distinct from 'teacher' or v_email = '' then
    raise exception 'save_timetable is only for teacher accounts with timetable access'
      using errcode = '42501';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'patch must be a JSON object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if not (v_key = any (v_allowed)) then
      raise exception '"%" cannot be changed from a teacher account', v_key using errcode = '22023';
    end if;
    if jsonb_typeof(p_patch -> v_key) <> 'array' then
      raise exception '"%" must be a list', v_key using errcode = '22023';
    end if;
  end loop;

  select * into v_row from public.faculty_state where id = 1 for update;
  if not found then
    raise exception 'faculty_state row is missing' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(coalesce(v_row.data -> 'timetableTeachers', '[]'::jsonb)) t
    where lower(btrim(coalesce(t ->> 'email', ''))) = v_email
      and (t -> 'timetableAccess') = 'true'::jsonb
  ) then
    raise exception 'this account does not have timetable access' using errcode = '42501';
  end if;

  -- Lost race (or never loaded): the caller's copy is stale. Checked before the
  -- structural rules so a stale tab is told to reload, not that its edit is invalid.
  if p_known_version is null or v_row.updated_at is distinct from p_known_version then
    return null;
  end if;

  if p_patch ? 'timetables' then
    v_old_tt := coalesce(v_row.data -> 'timetables', '[]'::jsonb);
    v_new_tt := p_patch -> 'timetables';

    -- Same timetables, in any order (reordering batch tabs is allowed).
    if (select coalesce(array_agg(t ->> 'id' order by t ->> 'id'), '{}') from jsonb_array_elements(v_old_tt) t)
       is distinct from
       (select coalesce(array_agg(t ->> 'id' order by t ->> 'id'), '{}') from jsonb_array_elements(v_new_tt) t)
    then
      raise exception 'timetables can only be created or deleted by an admin' using errcode = '22023';
    end if;

    -- batchName is the join key for exam schedules, student batches and exams;
    -- a rename must cascade, which only the admin path does.
    if exists (
      select 1
      from jsonb_array_elements(v_old_tt) o
      join jsonb_array_elements(v_new_tt) n on n ->> 'id' = o ->> 'id'
      where (n -> 'branch') is distinct from (o -> 'branch')
         or (n -> 'batchName') is distinct from (o -> 'batchName')
    ) then
      raise exception 'a timetable''s branch or batch can only be changed by an admin' using errcode = '22023';
    end if;

    -- Every existing slot must survive with its times unchanged. New slots are fine.
    if exists (
      select 1
      from jsonb_array_elements(v_old_tt) o,
           jsonb_array_elements(coalesce(o -> 'timeSlots', '[]'::jsonb)) os
      where not exists (
        select 1
        from jsonb_array_elements(v_new_tt) n,
             jsonb_array_elements(coalesce(n -> 'timeSlots', '[]'::jsonb)) ns
        where n ->> 'id' = o ->> 'id'
          and ns ->> 'id' = os ->> 'id'
          and (ns -> 'startTime') is not distinct from (os -> 'startTime')
          and (ns -> 'endTime')   is not distinct from (os -> 'endTime')
      )
    ) then
      raise exception 'existing time slots can only be retimed or deleted by an admin' using errcode = '22023';
    end if;
  end if;

  v_new := v_row.data || p_patch;
  if v_new = v_row.data then
    return v_row.updated_at;
  end if;

  -- clock_timestamp, not now(): now() is fixed for the whole transaction, so two
  -- writes inside one would share a version and the second could not be told apart.
  update public.faculty_state
     set data = v_new, updated_at = clock_timestamp()
   where id = 1
  returning updated_at into v_version;
  return v_version;
end;
$$;

revoke all on function public.save_timetable(jsonb, timestamptz) from public, anon;
grant execute on function public.save_timetable(jsonb, timestamptz) to authenticated;
