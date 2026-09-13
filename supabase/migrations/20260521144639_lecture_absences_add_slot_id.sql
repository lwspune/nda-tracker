-- Wipe existing test data (2 rows, all from today's smoke tests)
DELETE FROM public.lecture_absences;

-- Add slot_id column so same-day same-subject periods can be disambiguated
ALTER TABLE public.lecture_absences ADD COLUMN slot_id text NOT NULL;

-- Replace the subject-based UNIQUE constraint with a slot-based one.
-- subject stays on the row for the message-body lookup; slot_id is now
-- the natural key for "this period".
ALTER TABLE public.lecture_absences DROP CONSTRAINT lecture_absences_lws_id_date_subject_key;
ALTER TABLE public.lecture_absences ADD CONSTRAINT lecture_absences_lws_id_date_slot_id_key UNIQUE (lws_id, date, slot_id);

-- Index slot_id for the per-period query in LectureLogTab
CREATE INDEX lecture_absences_slot_id_idx ON public.lecture_absences(slot_id);