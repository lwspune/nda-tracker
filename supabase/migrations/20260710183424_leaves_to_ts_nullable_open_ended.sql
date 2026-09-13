-- Open-ended hostel leaves: a NULL to_ts means "still out, until closed".
-- Existing rows (incl. the 2026-07-10 batch carrying a 2099 sentinel) are left
-- untouched here; the sentinel rows are migrated to NULL only after the
-- null-aware app code is deployed, to avoid dropping them from the old
-- .gte('to_ts', dayStart) chain query in production.
ALTER TABLE leaves ALTER COLUMN to_ts DROP NOT NULL;