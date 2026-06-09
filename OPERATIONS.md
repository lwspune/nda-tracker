# Operations runbook

Triage steps for known production failure modes. For each scenario: how to recognise it, where to look first, and the SQL or commands that have helped before.

For column-level schema see [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md). For the *why* trail see [`DECISIONS.md`](./DECISIONS.md) and for the "what not to change" list see [`GUARDRAILS.md`](./GUARDRAILS.md).

---

## Where to look first

| Surface | Where logs / state live |
|---|---|
| Browser console | Vercel deploy URL → DevTools → Console. Look for `[persist]`, `[insightsSlice]`, `[studentSlice]` prefixes — application code logs Supabase failures here. |
| Vercel function logs | Vercel dashboard → Project → Functions → individual function → Logs. Used by `api/student-login.js`, `api/send-whatsapp.js`. |
| Supabase logs | Supabase dashboard → Logs → Postgres / Auth / API. Filter by status code or table name. |
| Supabase advisor | `mcp__supabase__get_advisors` from a Claude Code session — flags RLS gaps, missing indexes, performance issues. |
| Build logs | Vercel dashboard → Deployments → individual deploy → Build Logs. |

---

## Scenario 1 — An admin mutation isn't appearing in production

**Symptoms:** Admin adds an exam, assigns a batch, or saves an insight. Refresh shows the change is gone, or another user doesn't see it.

**Most likely cause:** The dual-path Supabase write failed silently. The state update succeeded (so the admin sees it in their own session) but the database write didn't.

**Triage:**
1. Open the browser console on the admin session and look for `[persist] Supabase save failed:` or `[insightsSlice]` / `[studentSlice]` Supabase errors.
2. If you see a `PostgrestError` with code `42501`, it's an RLS policy block — verify the session is authenticated admin (not anon).
3. If you see a `TypeError: ...catch is not a function` anywhere near a Supabase call, it's the thenable-vs-Promise trap. Every Supabase query chain must use `async/await` with `{ error }` destructuring, never `.catch()`. See decisions log in `CLAUDE.md`.
4. Confirm the data in Supabase:
   ```sql
   -- Did the exam row actually land?
   select id, name, updated_at from exams where id = '<exam_id>';
   -- Did the result rows land?
   select count(*) from exam_results where exam_id = '<exam_id>';
   ```

**Recovery:** If state and DB are out of sync, re-trigger the mutation from the UI (e.g. re-save the form). The dual-path will retry.

---

## Scenario 2 — Student can't log in

**Symptoms:** Student enters mobile, gets "Student not found" or a generic error.

**Triage:**
1. Confirm the mobile number is in the `students` table:
   ```sql
   select lws_id, canonical_name, mobile, account_status
   from students where mobile = '<10-digit-number>';
   ```
   `mobile` is stored without country code. If the student typed `91XXXXXXXXXX`, `api/student-login.js` strips the leading `91` before querying.
2. If the mobile is correct but the student name on the exam paper differs, check `name_variants`:
   ```sql
   select canonical_name, name_variants from students where lws_id = '<lws_id>';
   ```
   Their exam papers may use a variant spelling that hasn't been linked. Fix via the Find Duplicates tab (admin → Students → Manage Batch/Branch → Find Duplicates).
3. Check the Vercel function log for `api/student-login.js` — surfaces 500 errors or unexpected payload shape.
4. Verify `account_status` is not `Quit` (the API does not currently filter on this, so the student would log in successfully — but no recent exam data would be expected).

**Recovery:** Add the missing mobile or name variant. The session restore will retry on next login.

---

## Scenario 3 — Exam upload completes but exam is missing or shows 0 students

**Symptoms:** Admin uploads results + tags, modal closes successfully, exam doesn't appear in the list — or appears with 0 students despite a populated Excel file.

**Most likely cause:** A silent pagination cutoff during the next read of `exam_results`, OR the upload itself failed at the Supabase write step.

**Triage:**
1. Confirm the exam row was written:
   ```sql
   select id, name, jsonb_array_length(questions) as q_count, updated_at
   from exams order by updated_at desc limit 5;
   ```
2. Confirm the result rows landed:
   ```sql
   select count(*) from exam_results where exam_id = '<exam_id>';
   ```
3. If the row count is non-zero in DB but the UI shows 0, the read path is the problem. `loadExamsFromSupabase` paginates via `fetchAllRows()` — if pagination is broken, rows past index 1000 are cut. Verify the helper still uses `.range(from, from+PAGE-1)`.
4. If `exam_results` has 0 rows, the upload write failed. Check the console for the slice's error log; re-trigger the upload.

**Historic incident:** 2026-05-07 — Phase 5 cleanup SQL ran before the normalised tables were seeded. All 37 exams disappeared from the JSONB blob with nothing to replace them. Recovery from JSON backup. Migration scripts now verify counts and only print cleanup SQL (`--cleanup` does not execute).

---

## Scenario 4 — WhatsApp send fails for some students

**Symptoms:** WhatsApp Results modal shows `Sent N✓ M✗`, with the failed-student names listed.

**Triage:**
1. Check the on-screen log lines. Common patterns:
   - `SKIP <name> — no mobile` → student has no `mobile` in `students_db.json` / `students` table.
   - `SKIP <name> — invalid mobile` → mobile doesn't match the Indian 10-digit format.
   - `FAIL → <name> (student): <error>` → Wabridge API rejected the request. Most often expired auth or a template not approved.
2. Check the Vercel function log for `api/send-whatsapp.js` — surfaces the Wabridge response body.
3. Wabridge auth tokens are in `WABRIDGE_*` env vars. If they're rotated, both the local `.env.local` and the Vercel env must be updated.
4. Use the Resend button in the WhatsApp Preview modal — it re-runs only the failed/skipped students by default.

**For testing without sending to real students:** the modal has a "redirect all to" field. Forwards to `--redirect-to` in the Python script.

---

## Scenario 5 — Insights page is blank or shows stale plans

**Symptoms:** Admin opens Insights, sees the empty state instead of a saved plan, or sees an older plan than expected.

**Triage:**
1. Confirm the plan was saved:
   ```sql
   select id, student_name, generated_by, generated_at, length(text) as text_len
   from student_plans
   order by generated_at desc
   limit 10;
   ```
2. The Insights page reads from the store, populated by `loadInsightsFromSupabase()` during `initStore`. If the function ran before the row was inserted (e.g. you inserted via SQL while the page was open), refresh the page.
3. The store only holds the **latest** plan per `student_name`. Older versions stay in the table as history but don't surface in the UI.
4. If you wrote SQL with the wrong `student_name` (variant instead of canonical), the plan exists but won't be found by lookups using the canonical name.

---

## Scenario 6 — Attendance not loading or showing wrong numbers

**Symptoms:** Attendance page is blank, shows 0 students, or shows a partial set.

**Triage:**
1. Verify rows exist:
   ```sql
   select count(*) from student_attendance;                       -- total rows
   select min(date), max(date) from student_attendance;           -- date range covered
   select count(distinct lws_id) from student_attendance;         -- unique students
   ```
2. `student_attendance` exceeds 1000 rows — confirms pagination is required. The page fetches via `.range()` loop; if this is bypassed, rows are silently truncated.
3. If a specific student is missing from the table but is enrolled, the XLS import probably failed mobile → lws_id matching. Re-import; admin can check the log lines in the import flow.
4. `student_attendance.date` is stored as `text` in `DD-MM-YYYY` format (matches the XLS header). Lexical sort is correct because all rows use the same format, but never compare across format styles.

---

## Scenario 7 — Tests fail locally but pass on someone else's machine

**Triage:**
1. Pull the latest `main` and re-run `npm install` — a forgotten `package.json` change is a common cause.
2. Vitest under heavy parallel load on jsdom can flake (5s default timeout). If failures are all `Test timed out`, re-run; if they reproduce, debug.
3. Check `data/faculty-data.json` is gitignored — a corrupted local file used to leak into tests via the persist layer. The current setup mocks the persist layer, but worth checking if tests touch it.
4. Mode tests fail if `ModeContext` default isn't `'admin'`. Do not change the default — multiple tests depend on it.

---

## Scenario 8 — Vercel deploy succeeded but the app shows old content

**Triage:**
1. The deploy may be partial. Check Vercel dashboard → Deployments → latest deploy is marked Ready and matches the `main` HEAD commit.
2. Browser cache. Hard-refresh (Ctrl+Shift+R / Cmd+Shift+R).
3. Service worker. The app does not currently register one, but check DevTools → Application → Service Workers in case a stale registration persists from an older deploy.
4. Vercel env vars changed but the deploy wasn't re-triggered. Vercel does not rebuild automatically when env vars change — push a no-op commit or click Redeploy.

---

## Scenario 9 — Lint or test failures block a deploy

There is currently no CI gate; Vercel builds from `main` directly. To prevent a broken build:

```bash
npm run lint                              # 11 expected errors + 13 warnings — see CLAUDE.md lint section
npm run test                              # 653 tests; 0 expected failures
```

If lint reports more than the 11 expected errors, the new errors are real. If tests fail, do not push.

---

## Scenario 10 — Student re-import shows every row as "new" (or duplicates were created)

**Symptoms:** Admin re-imports the same `Student Search List` Excel and the modal says "N students loaded — N new, 0 unchanged". Or: after a confirmed import, Supabase has two rows for the same person with different `lws_id`s.

**Most likely cause:** the pre-merge baseline didn't load. `useImportFlow.handleStudentFile` must call [`loadExistingStudents()`](src/lib/students/loadExistingStudents.js), not a bare `fetch('/api/students-db')` — the bare fetch 404s on Vercel (no dev plugin in prod) and `existingStudents = []` makes every row look new. Fix landed in commits `86e0fcd` + `d67f34f` (2026-05-20). If the symptom returns, suspect a regression in `useImportFlow` or `loadExistingStudents`.

**Triage:**
1. Check Supabase for duplicates by stable identifier:
   ```sql
   select mobile, array_agg(lws_id || ':' || canonical_name) as rows, count(*)
   from students where mobile <> '' group by mobile having count(*) > 1;

   select eis_reg_no, array_agg(lws_id || ':' || canonical_name) as rows, count(*)
   from students where eis_reg_no <> '' group by eis_reg_no having count(*) > 1;
   ```
   Empty result → no duplicates exist. Non-empty → resolve via Admin → Students → Manage Batch/Branch → Find Duplicates → Merge.

2. If the modal still shows "all new" on a freshly deployed build, verify the import baseline actually loads. In the browser console on the import page:
   ```js
   // After picking the file, before clicking Next:
   //   mergeResult is set in useImportFlow. If existingStudents.length was 0,
   //   added === number of file rows.
   ```
   If `loadExistingStudents` is taking the Supabase branch it should log nothing; if it's taking the dev fetch branch on Vercel it'll log a 404 in the Network tab for `/api/students-db`.

3. When the matcher does have a baseline but a specific row still inserts new, check `conflicts[]` in the Step 3 preview — `ambiguous_mobile` or `ambiguous_name_branch` means the row hit 2+ candidates and was deliberately not auto-merged. Resolve manually post-import via Find Duplicates.

**Recovery:** Merge any duplicates that were created (Find Duplicates tab). Don't re-import to "fix" the count — that creates the next round of duplicates if the underlying bug is still present.

---

## Scenario 11 — Migration script "no-op" or "0 inserted, 0 skipped"

**Most likely:** the source file (`data/faculty-data.json` or `students_db.json`) is empty on the dev machine that ran the script. Production data lives in Supabase; the local file may not have been synced.

**Triage:**
1. Confirm the source has data. For exam migrations:
   ```bash
   node -e "console.log(JSON.parse(require('fs').readFileSync('data/faculty-data.json','utf8')).exams.length)"
   ```
2. Migration scripts fall back to Supabase JSONB when the local file has 0 rows. Confirm the script's "Source:" log line.
3. Never run `--cleanup` SQL before verifying row counts match. See `feedback_migration_safety.md` in the memory directory and the decisions log in CLAUDE.md.

---

## Useful one-liners

```sql
-- Row counts across all main tables (sanity check)
select 'exams' as t, count(*) from exams
union all select 'exam_results', count(*) from exam_results
union all select 'students', count(*) from students
union all select 'student_batches', count(*) from student_batches
union all select 'student_attendance', count(*) from student_attendance
union all select 'student_logins', count(*) from student_logins
union all select 'class_reports', count(*) from class_reports
union all select 'student_plans', count(*) from student_plans;

-- Faculty state blob size
select pg_size_pretty(octet_length(data::text)::bigint) as blob_size
from faculty_state where id = 1;

-- Recent student logins (audit)
select s.canonical_name, sl.logged_in_at
from student_logins sl
join students s on s.lws_id = sl.lws_id
order by sl.logged_in_at desc limit 20;

-- Students with no exams (regDate-valid but never sat an exam)
select s.lws_id, s.canonical_name
from students s
left join exam_results er on er.student_name = s.canonical_name
where s.registration_date <> '' and er.student_name is null;
```

---

## When to update this runbook

After any production incident:

1. Add a new scenario (or extend an existing one) with the symptoms you observed.
2. Document the SQL or commands that diagnosed it.
3. If the underlying cause is something that shouldn't have happened, add an entry to the [`GUARDRAILS.md`](./GUARDRAILS.md) "what not to change" list as well.

A runbook only stays useful if it grows with the incidents you've actually seen.
