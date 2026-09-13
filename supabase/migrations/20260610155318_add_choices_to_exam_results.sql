-- Additive: per-question chosen letter {qn: 'A'|null} captured at upload, so a
-- corrected answer key can later re-grade results. responses (1/-1/0 verdict)
-- is unchanged. NULL for rows uploaded before capture (unrecoverable).
alter table public.exam_results add column if not exists choices jsonb;