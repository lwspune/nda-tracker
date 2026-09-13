
CREATE TABLE student_logins (
  id bigint generated always as identity primary key,
  lws_id text not null references students(lws_id) on delete cascade,
  logged_in_at timestamptz not null default now()
);

CREATE INDEX idx_student_logins_lws_id ON student_logins (lws_id, logged_in_at desc);
