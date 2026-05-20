# Database schema — NDA Maths Tracker

Live schema of the Supabase project `exjnzrrlzcrsoxfoojcq` (production).
Column-level reference. For *how* the app uses this data (load/save paths, dual-path mutations, mode-conditional reads), see `CLAUDE.md` → "Data persistence".

**Last verified:** 2026-05-20 via `mcp__supabase__list_tables`.

---

## At a glance

| Domain | Tables | Rows |
|---|---|---|
| Admin workspace | `faculty_state` (kept for compatibility) | 1 |
| Students | `students`, `student_batches`, `students_meta` | 281 + 493 + 1 |
| Activity logs | `student_attendance`, `student_logins` | 2402 + 193 |
| Exams (Phase 5) | `exams`, `exam_results` | 45 + 1636 |
| Insights (Phase 6) | `class_reports`, `student_plans` | 0 + 1 |

10 tables, ~5057 rows. All RLS-enabled except `student_logins` — see warning below.

---

## 1. Admin workspace

### `faculty_state` — single-row JSONB blob

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | int4 PK | `1`, CHECK `id=1` | Sentinel — only one row ever exists |
| `data` | jsonb | nullable | Holds syllabus, timetable, costs, etc. |
| `updated_at` | timestamptz | `now()` | |

**Stripped from `data`:** `exams` (Phase 5), `savedInsights` (Phase 6). Re-introducing either field would double-write and drift from the normalised tables.

**Inside `data`:** `syllabusPrograms`, `syllabusBatches`, `syllabusBatchBranches`, `batchProgramAssignments`, `batchSyllabusProgress`, `batchChapterTimelines`, `timetableTeachers`, `timetableMappings`, `timetables`, `examSchedules`, `costLog`, `whatsappSendHistory`, `studentProfiles` (cached — overwritten on load by `loadStudentsFromSupabase()`), `ndaFreqBySubject`, `ndaMarksBySubject`, `lastDeployedAt`.

---

## 2. Students

### `students` — core profile

| Column | Type | Default | Notes |
|---|---|---|---|
| `lws_id` | text PK | — | e.g. `LWS-129` |
| `canonical_name` | text | — | Primary display name |
| `mobile` | text | `''` | Used for student-login auth |
| `dob` | text | `''` | XLS-imported, kept as text |
| `gender` | text | `''` | |
| `email` | text | `''` | |
| `eis_reg_no` | text | `''` | EIS registration number (external) |
| `registration_date` | text | `''` | YYYY-MM-DD; gates `regDate` analytics |
| `branch` | text | `''` | LWS / APJSCH / ... |
| `account_status` | text | `''` | Active / Quit / ... — display-only |
| `coming_status` | text | `''` | Attending / not |
| `quit_date` | text | `''` | |
| `name_variants` | text[] | `'{}'` | Alternate spellings appearing on exam papers |
| `evalbee_roll_nos` | text[] | `'{}'` | |
| `match_signatures` | text[] | `'{}'` | For dedup |
| `parent_mobiles` | text[] | `'{}'` | Receivers for WhatsApp results |
| `fees` | jsonb | `'{}'` | |
| `updated_at` | timestamptz | `now()` | |

**FKs in:** `student_batches`, `student_attendance`, `student_logins`, `student_plans`.

**Import matching:** the student-import flow (`mergeStudents` in `src/lib/merge/mergeLogic.js`) tries `eis_reg_no` first, falls back to `mobile` (unique-hit only), then to `canonical_name` + `branch` (both non-empty, unique-hit only). Blank-EIS rows that find no match are skipped — never inserted as new — so the canonical identifier contract is preserved. See the import section in [`CLAUDE.md`](./CLAUDE.md).

### `student_batches` — many-to-many junction

| Column | Type | Notes |
|---|---|---|
| `lws_id` | text | FK → `students(lws_id)` |
| `batch_name` | text | |
| **PK** | `(lws_id, batch_name)` | Renames require DELETE + INSERT (cannot UPDATE PK) |

### `students_meta` — single-row config

| Column | Type | Default |
|---|---|---|
| `id` | int4 PK, CHECK `id=1` | `1` |
| `version` | int4 | `1` |
| `last_updated` | text | `''` |
| `total_students` | int4 | `0` |
| `exam_tags` | jsonb | `'{}'` |
| `rejected_pairs` | jsonb | `'[]'` |

---

## 3. Activity logs

### `student_attendance` — per-day P/A records

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | int4 PK (serial) | nextval | |
| `lws_id` | text | — | FK → `students(lws_id)` |
| `date` | text | — | `DD-MM-YYYY` format (from XLS header) |
| `status` | text | `''` | `P` / `A` / `-` |
| **UNIQUE** | `(lws_id, date)` | | Upsert conflict target |

Original schema had `batch` + `eis_reg_no`; dropped 2026-05-07. UNIQUE was `(lws_id, date, batch)` originally.

### `student_logins` — login audit (⚠️ RLS DISABLED)

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | bigint PK (identity) | — | |
| `lws_id` | text | — | FK → `students(lws_id)` |
| `logged_in_at` | timestamptz | `now()` | |

Index: `(lws_id, logged_in_at DESC)`.
Written fire-and-forget by `api/student-login.js`. Read by `StudentView` (admin/teacher only).

---

## 4. Exams (Phase 5 normalisation)

### `exams` — exam metadata + questions

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | text PK | — | Legacy timestamp ID like `exam_1778414153509` |
| `name` | text | — | |
| `date` | date | — | (real DATE — unlike `student_attendance.date`) |
| `subject` | text | nullable | `Maths` / `GAT` / `English` / `Geography` / `Chemistry` / `Physics` / null |
| `batch` | text | nullable | Free text — see `getBatchOptions` for resolution |
| `branch` | text | nullable | |
| `marking` | jsonb | `{"correct":4,"wrong":-1}` | `{correct: number, wrong: number}` |
| `questions` | jsonb | `'[]'` | `[{q, chapter, subtopic?, subject?, ...}]` |
| `created_at` | timestamptz | `now()` | |
| `updated_at` | timestamptz | `now()` | |

**FKs in:** `exam_results` (CASCADE), `class_reports` (SET NULL).

### `exam_results` — one row per student per exam

| Column | Type | Default | Notes |
|---|---|---|---|
| `exam_id` | text | — | FK → `exams(id)` ON DELETE CASCADE |
| `student_name` | text | — | May match `canonical_name` or `name_variants` |
| `roll_no` | text | `''` | |
| `total_marks` | numeric | `0` | Can be decimal (e.g. `33.36`) |
| `correct` | int4 | `0` | |
| `incorrect` | int4 | `0` | |
| `not_attempted` | int4 | `0` | |
| `responses` | jsonb | `'{}'` | `{ qNum: 1 \| -1 \| 0 }` (correct/wrong/skipped) |
| **PK** | `(exam_id, student_name)` | | |

Reads must paginate with `fetchAllRows()` — 1636+ rows exceeds Supabase's 1000-row default.

---

## 5. Insights (Phase 6, 2026-05-20)

### `class_reports` — class-level summaries

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` | |
| `exam_id` | text | nullable | FK → `exams(id)` ON DELETE SET NULL. Nullable for legacy/class-wide reports. |
| `text` | text | — | Plain-text body |
| `generated_at` | timestamptz | `now()`, **UNIQUE** | Idempotency key for migration re-runs |
| `generated_by` | text | nullable | `'manual'` \| `'claude-opus-4-7'` \| `'legacy-import'` \| ... |

Index: `(exam_id, generated_at DESC)`. **Insert-only** — history preserved by never updating in place.

### `student_plans` — per-student improvement plans

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` | |
| `lws_id` | text | nullable | FK → `students(lws_id)` ON DELETE SET NULL. Nullable when name doesn't resolve. |
| `student_name` | text NOT NULL | — | Always present; the "name" axis of the latest-per-scope read |
| `text` | text | — | Plain-text body |
| `generated_at` | timestamptz | `now()` | |
| `generated_by` | text | nullable | Same vocabulary as `class_reports.generated_by` |
| **UNIQUE** | `(student_name, generated_at)` | | Idempotency key for migration re-runs |

Indexes: `(lws_id, generated_at DESC)`, `(student_name, generated_at DESC)`.
**Insert-only.** `loadInsightsFromSupabase()` collapses to "latest per `student_name`" to reconstruct the legacy `{ classReport, studentPlans }` shape consumed by the Insights page.

---

## FK graph

```
        exams (45)
         │
         ├──→ exam_results (1636, ON DELETE CASCADE)
         └──→ class_reports (0, ON DELETE SET NULL)

      students (281)
         │
         ├──→ student_batches (493)
         ├──→ student_attendance (2402)
         ├──→ student_logins (193)
         └──→ student_plans (1, ON DELETE SET NULL)

  faculty_state (1)   ← no FKs (JSONB blob)
  students_meta (1)   ← no FKs (single-row config)
```

---

## Row Level Security

| Table | RLS | Policy |
|---|---|---|
| `faculty_state` | ✓ | Authenticated only |
| `students`, `student_batches`, `student_attendance`, `students_meta` | ✓ | Authenticated only (policy named `faculty_rw` for historical reasons) |
| `exams`, `exam_results` | ✓ | Authenticated only |
| `class_reports`, `student_plans` | ✓ | Authenticated read/insert/delete (Phase 6) |
| **`student_logins`** | **✗ DISABLED** | **Exposed to `anon` + `authenticated`** |

### ⚠️ `student_logins` RLS gap

Supabase advisory flags this as critical. With the anon key, anyone can `SELECT *` from the audit log or `INSERT` arbitrary rows. The reason RLS is off: `api/student-login.js` writes here without a Supabase session (students authenticate by mobile, not by Supabase Auth), and any policy must allow that insert path.

**Recommended fix** (run manually after reviewing the policy shape):

```sql
ALTER TABLE student_logins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon + auth can insert"
  ON student_logins FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated can read"
  ON student_logins FOR SELECT
  TO authenticated
  USING (true);
```

This matches the existing behaviour (`api/student-login.js` insert succeeds; `StudentView` admin/teacher read succeeds) while blocking unauthenticated reads.

---

## Keeping this file current

This file is hand-maintained. Regenerate from live state when schema changes:

1. Run `mcp__supabase__list_tables` (verbose) in a Claude Code session, OR query `information_schema.columns` directly in the Supabase SQL editor.
2. Update the affected table section here.
3. Bump the "Last verified" date at the top.
4. Note any new FK or RLS policy in the relevant section.

Schema-changing PRs should include a diff to this file. If you're applying a migration via `mcp__supabase__apply_migration`, edit this file in the same commit.
