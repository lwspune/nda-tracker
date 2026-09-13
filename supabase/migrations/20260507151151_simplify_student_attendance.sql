
-- Drop unused columns
ALTER TABLE student_attendance DROP COLUMN batch;
ALTER TABLE student_attendance DROP COLUMN eis_reg_no;

-- Drop old unique constraint if it exists (named by Postgres convention)
ALTER TABLE student_attendance DROP CONSTRAINT IF EXISTS student_attendance_lws_id_date_batch_key;
ALTER TABLE student_attendance DROP CONSTRAINT IF EXISTS student_attendance_lws_id_date_key;

-- Add clean unique constraint
ALTER TABLE student_attendance ADD CONSTRAINT student_attendance_lws_id_date_key UNIQUE (lws_id, date);
