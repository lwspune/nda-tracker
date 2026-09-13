
alter table lecture_absences
  add column if not exists start_time text,
  add column if not exists end_time text;
