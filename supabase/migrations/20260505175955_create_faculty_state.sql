
-- Single-row JSONB store for all faculty state (replaces faculty-data.json)
CREATE TABLE faculty_state (
  id         int PRIMARY KEY DEFAULT 1,
  data       jsonb,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE faculty_state ADD CONSTRAINT single_row CHECK (id = 1);
INSERT INTO faculty_state (id, data) VALUES (1, null);

-- Only authenticated Supabase users (faculty) can read/write
ALTER TABLE faculty_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY faculty_rw ON faculty_state
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
