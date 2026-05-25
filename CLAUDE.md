# NDA Maths Tracker — CLAUDE.md

> **Companion docs:** [`README.md`](./README.md) — public-facing entry point and quick start. [`ARCHITECTURE.md`](./ARCHITECTURE.md) — narrative onboarding for new contributors. [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md) — column-level schema reference. [`OPERATIONS.md`](./OPERATIONS.md) — production triage runbook. [`SECURITY.md`](./SECURITY.md) — auth model, RLS, PII handling, secret management. [`DECISIONS.md`](./DECISIONS.md) — long-form *why* trail for non-obvious architectural choices. This file is the operational reference for daily work (commands, conventions, "what not to change").

## Project overview

A React + Vite faculty tool for LWS Pune to track NDA Maths exam performance.
Four runtime modes:

- **Admin** (`localhost` / LAN): full read-write. Data in `data/faculty-data.json` via Vite plugin.
- **Online Admin** (Vercel + Supabase): full read-write. Data in Supabase `faculty_state` JSONB row. Login via Supabase Auth (email/password); no `role` metadata on the user. Live at `nda-tracker.vercel.app`.
- **Teacher** (Vercel + Supabase): read-only. Individual Supabase account with `user_metadata.role='teacher'`. Loads data via `loadFromSupabase()` on mount. Same login form as Admin — the role distinction is server-side metadata, not a UI choice.
- **Student** (Vercel): read-only, mobile-number login via `/api/student-login` serverless function, own data only.
- **Demo** (`?demo=true`): NOT YET IMPLEMENTED — see memory `project_demo_mode.md`.

## Tech stack

| Layer | Choice |
|---|---|
| UI | React 19, Tailwind CSS 3 |
| State | Zustand 5 (`src/store/useStore.js`) |
| Build | Vite 8 |
| Testing | Vitest 4 + React Testing Library 16 + jsdom |
| Excel parsing | xlsx (`src/lib/excel.js`) |
| Excel export (styled) | xlsx-js-style (`src/pages/Timetable/TimetablePage.jsx`) |
| Timetable PNG export | html2canvas (`src/pages/Timetable/TimetablePage.jsx`) |
| Monthly report ZIP | jszip (loaded dynamically in `src/lib/monthlyReportZip.js`) |
| Math rendering | KaTeX |
| Deploy | Vercel for all three portals (admin, teacher, student); GitHub Pages legacy static build via `npm run deploy` |
| Backend | Supabase (Auth + `faculty_state` JSONB table + `exams`, `exam_results`, `students`, `student_batches`, `student_attendance`, `student_logins`, `students_meta`, `class_reports`, `student_plans`, `lecture_absences` tables) |
| Python deps | `tzdata` (`pip install tzdata`) for `send_schedule.py`; `cryptography` only if regenerating `split_students.py` output |

## Key commands

```bash
npm run dev             # admin mode, data saved to disk
npm run test            # Vitest
npm run test:watch
npm run split           # python -X utf8 split_students.py (manual only — updates lastDeployedAt)
npm run deploy          # build + gh-pages push (split no longer runs automatically)
npm run migrate         # one-time: seed data/faculty-data.json → Supabase (needs SUPABASE_SERVICE_ROLE_KEY)
npm run migrate:students  # seed students_db.json → Supabase students tables (re-runnable, needs SUPABASE_SERVICE_ROLE_KEY)
npm run migrate:exams   # seed exams + results → Supabase normalised tables (re-runnable, needs SUPABASE_SERVICE_ROLE_KEY; --cleanup prints cleanup SQL)
npm run migrate:insights  # seed savedInsights → class_reports + student_plans tables (re-runnable, needs SUPABASE_SERVICE_ROLE_KEY; --cleanup prints cleanup SQL)
npm run sync:students   # download Supabase → students_db.json (for Python scripts, needs SUPABASE_SERVICE_ROLE_KEY)
npm run merge:subtopics       # python -X utf8 merge_subtopics.py — apply subtopic renames to data/faculty-data.json
npm run merge:subtopics:sync  # node migrate_subtopics_supabase.js — push renames to Supabase (needs SUPABASE_SERVICE_ROLE_KEY)
# one-off (applied 2026-05-20): node migrate_unify_batches.js [--local] [--dry-run] — verify current Supabase state before re-running; central list has been reshaped since
npm run lint
```

## Slash commands

| Command | Purpose |
|---|---|
| `/subtopic-analyse` | Near-duplicate subtopic names queried live from Supabase. Run after bulk tag uploads. |

---

## Architecture decisions

### Data persistence

> **Column-level schema reference:** see [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md). This section covers *behaviour* (load/save paths, what's normalised); the schema file covers *shape* (types, defaults, constraints, RLS).

- **Dev**: `data/faculty-data.json` via `POST /api/data` (Vite `localDataPlugin`). Bypasses 5 MB localStorage limit.
- **Prod online admin** (Vercel): Four Supabase stores:
  - `faculty_state` JSONB row (`id=1`) — syllabus, timetable, cost log, etc. (exams removed Phase 5; savedInsights removed Phase 6). Fire-and-forget saves via `saveToSupabase` (session-gated). `saveToSupabase` strips both `exams` and `savedInsights` before writing.
  - Normalised exam tables — `exams` (id, name, date, subject, batch, branch, marking JSONB, questions JSONB, created_at) + `exam_results` (exam_id FK ON DELETE CASCADE, student_name, roll_no, total_marks, correct, incorrect, not_attempted, responses JSONB). Written by `examsSlice.js` via `src/store/slices/examSupabase.js` helpers. Read via `loadExamsFromSupabase()` (paginated, 1000-row pages).
  - Normalised student tables — `students`, `student_batches`, `student_attendance`, `students_meta`. Each mutation in `studentSlice.js` writes targeted rows; `loadStudentsFromSupabase()` is called on admin login to populate `studentProfiles` in-store. Teacher/student portals never touch these tables (RLS: authenticated only). `student_attendance.status` accepts `P` / `A` / `-` / `L` — `L` = present but late to first lecture (faculty marks in-app from the LateMarkingWidget; see "Late marking & lecture-miss flow" below).
  - Normalised insights tables (Phase 6) — `class_reports` (id, exam_id text FK ON DELETE SET NULL, text, generated_at, generated_by) + `student_plans` (id, lws_id FK ON DELETE SET NULL, student_name NOT NULL, text, generated_at, generated_by). Insert-only (history preserved by never updating in place). Written by `insightsSlice.js` via `src/store/slices/insightsSupabase.js` helpers. Read via `loadInsightsFromSupabase()` which collapses to "latest per scope" — `{ classReport, studentPlans }` shape matches the legacy store. RLS: authenticated only.
  - `lecture_absences (id uuid, lws_id FK ON DELETE CASCADE, date text, slot_id text NOT NULL, subject text, created_at, created_by)` — UNIQUE `(lws_id, date, slot_id)` (was `subject` until 2026-05-21 — see decisions log). Indexed on `date`, `(lws_id, date)`, and `slot_id`. Sparse event log: one row per (student, day, slot the student missed). `slot_id` is the timetable's `timeSlots[].id`; `subject` is still persisted alongside so the message body can read it without a timetable join. Faculty enters via the Lecture log tab on the Attendance page; replace-set semantics per "period card" via `lectureAbsenceSlice.setLectureAbsenteesForPeriod(date, slotId, subject, lwsIds)`. RLS: authenticated only.
  - `student_logins (id, lws_id, logged_in_at)` — one row per student login event. Written fire-and-forget by `api/student-login.js` after successful mobile auth. Read by `StudentView` (admin/teacher only) to show last-login and login count in `ProfileCard`.
  - `students_db.exams[]` is dead data — not mapped by any code path; dropped from Supabase schema.
- **Prod teacher**: no local storage — Supabase session only. `TeacherPortal` calls `loadFromSupabase()` then `loadExamsFromSupabase()` on mount; both must complete before content renders. (Teacher UI does not link to Insights — `loadInsightsFromSupabase()` is admin-only.)
- **Prod student**: localStorage — session token only (`SESSION_KEY`, contains `lwsId`, `name`, `mobile`), expires after `SESSION_DAYS`.
- `apiKey` is **never** persisted to disk or localStorage — memory only.

### Mode detection & routing
`src/config.js`: non-localhost hostname → `IS_READ_ONLY = true`. Two distinct uses:
- **Component visibility:** never use `IS_READ_ONLY` for this — use `useMode()` (admin/teacher/student).
- **Dev-vs-prod data-path branching** (e.g. fetch `/api/data` vs `loadFromSupabase`): use `IS_READ_ONLY` directly (or `IS_DEV = !IS_READ_ONLY` in `persist.js`). Do NOT use `import.meta.env.DEV` — Vercel's Vite 8.0.3 substitutes it incorrectly. See decisions log + memory `project_vite_dev_substitution_bug`.

`ModeContext` (`src/context/ModeContext.jsx`) propagates `'admin' | 'teacher' | 'student'` app-wide. Default is `'admin'` so tests work without a Provider. Always use `useMode()` in components.

`src/App.jsx`: `supabaseSession.user.user_metadata.role === 'teacher'` → `<TeacherPortal>`, other `supabaseSession` → `<OnlineAdminPortal>`, `studentData` → `<StudentPortal>`, neither → `<LoginPage>`. Each portal sets `ModeContext`. `sessionChecked` state prevents flash of login before `onAuthStateChange` fires.

**Hooks must be called before any early returns** — store is empty at first render in teacher mode; `loadRemoteData` fires after mount. All `useMemo` in Dashboard/Toppers is placed before early returns to prevent React error #310.

### Login (`src/components/auth/LoginPage.jsx`)
Two-tab login page (Student / Admin · Teacher):
- **Admin · Teacher** (single form): email + password → `supabase.auth.signInWithPassword()` → `onAuthStateChange` fires → App.jsx routes by `user_metadata.role` — `'teacher'` → `<TeacherPortal>`, anything else → `<OnlineAdminPortal>`. Admin and teacher accounts are both Supabase users; the role is server-side metadata, never a UI choice. Teacher accounts are created with `user_metadata.role = 'teacher'` (via `create_teacher_account.js`); admin accounts have no `role` metadata.
- **Student**: mobile → `POST /api/student-login` → on success saves session to localStorage → `onStudentLogin(data)`. Session restore on mount re-calls the same endpoint with stored mobile.
- `?mobile=XXXXXXXXXX` param pre-fills mobile input (used in result emails for one-click login).

### Student split script (`split_students.py`)
**Legacy** — output files (`public/data/index.json`, `public/data/students/*.json`, `public/data/db.json`) are no longer consumed by teacher or student login (both now use Vercel + Supabase). Script still updates `lastDeployedAt` in `faculty-data.json` and can regenerate static files if needed. Removed from `predeploy` — run manually via `npm run split`.

### Store (`src/store/useStore.js`)
State keys: `exams`, `studentProfiles`, `studentList`, `savedInsights`, `ndaFreqBySubject`, `ndaMarksBySubject`, `costLog`, `apiKey`, `lastDeployedAt`, `hydrated`, `syllabusPrograms`, `syllabusBatches`, `syllabusBatchBranches`, `batchProgramAssignments`, `batchSyllabusProgress`, `batchChapterTimelines`, `timetableTeachers`, `timetableMappings`, `timetables`, `examSchedules`, `whatsappSendHistory`, `branches`.

`studentList` is the raw snake_case array set by `importStudentsDB` (alongside the canonical-name-keyed `studentProfiles` map). Not persisted — reloaded from Supabase / `students_db.json` each session. Required by `FindDuplicatesTab` so two profiles sharing the same `canonical_name` are both visible to the scan (the map collapses them to one key).
Slices under `src/store/slices/`. All mutations call `get()._save()` immediately.
- `loadStudentData(data)` — student portal; `loadRemoteData(data)` — teacher portal.
- `loadRemoteData` sets all six syllabus keys (`syllabusPrograms`, `syllabusBatches`, `syllabusBatchBranches`, `batchProgramAssignments`, `batchSyllabusProgress`, `batchChapterTimelines`) from the decrypted payload.

### Subject filtering
Subject filter is **local state per page** — not in the store. Dashboard: subject → branch → batch → exam chain. Exams: sort + subject → branch → batch. StudentView: self-contained, shown when student has 2+ subjects. **`StudentView` defaults to `'Maths'`** (not `'all'`) — matches the primary use-case.

**`effectiveFilter` snap-to-all:** in `StudentView.jsx`, the dropdown is bound to `effectiveFilter`, not `subjectFilter` directly. When the state holds a subject that isn't in `studentSubjects[]` (e.g. default `'Maths'` for a GAT-only student), `effectiveFilter` resolves to `'all'`. Without this guard, `<select value="Maths">` with no matching option visually falls back to displaying its first option (`"All Subjects"`) while state stays `'Maths'` — the empty-state then reads "No Maths exam records" and contradicts the dropdown. Snapping at the derived level (not via `setSubjectFilter` in an effect) avoids a render loop and keeps subject state stable when the user has just deselected manually.

### Batch filtering
Batch dropdown options and filter logic use **`profile.batches[]` as primary** (app-assigned), with `exam.batch` as fallback only for exams where no student has a profile.
- `getBatchOptions(exams, studentProfiles)` — builds dropdown options from profiles; falls back to `exam.batch` for unmatched exams.
- `getExamsForBatch(exams, studentProfiles, batchName)` — returns exams where ≥1 student has `batchName` in their `profile.batches[]`; falls back to `exam.batch` when no student has a profile.
- Both helpers live in `src/lib/analytics/filters.js` and are re-exported via `src/lib/analytics.js`.
- Used by Dashboard, Exams, and Toppers pages. Do not revert to filtering on `exam.batch` directly.

### Valid students & regDate filtering
Valid student = `studentProfiles` entry with non-empty `regDate`. Valid exam = `exam.date >= profile.regDate`. Students without `regDate` are excluded from class-level analytics. `accountStatus` drives the exam-absence cohort gate (only `'Active'` students are flagged; see the EIS+Active gate in `getExamAbsentees` below); class-level analytics still ignore it.
Analytics functions (`getAllStudents`, `computeChapterStats`, `getAtRisk`, `getHardestQuestions`, `getToppers`) accept optional `validNames: Set | null` (`null` = no filter).

### Students page browser
`src/pages/Students/index.jsx` renders one of two views at a time: the paginated, filterable `StudentsTable` (default), or — when `activeStudent` is set — a "← Back to list" button followed by `StudentView`. Clicking a row replaces the table; clicking "Back to list" restores it. The table is unmounted while a student is selected, so filter/page state resets on return (acceptable for now; lift the filter state up if that becomes a pain point).

**Table** (`StudentsTable.jsx`): 8 columns (Name, LWS ID, Branch, Batch(es), Mobile, Status, Exams count, Last activity) + an optional 9th "Aligned" column (✓ / ⚠ Needs review) shown only when the `centralBatches` prop is non-empty. Filters: search (canonical name + LWS ID + name variants), branch, batch, status, alignment (when shown). PAGE_SIZE = 25. Page resets to 1 on any filter change. Exam count and last-activity are derived per render from `exams` keyed on canonical name + variants.

**Source list:** prefers `studentList` (raw Supabase array — one row per record); falls back to canonical-only `studentProfiles` entries when `studentList` is empty. Variants are excluded.

**Alignment** (2026-05-21): a student is "Aligned" iff `batches[]` is non-empty AND every entry is in `syllabusBatches[]`. Empty batches[] or any non-central entry → ⚠ Needs review. Drives the post-cleanup manual sweep (see decisions log). Page-level props passed from `Students/index.jsx`: `centralBranches={branches}`, `centralBatches={syllabusBatches}`, `batchBranchMap={syllabusBatchBranches}`.

**Inline editor** (`StudentRowEditor.jsx`): admin-only. Per-row Edit button toggles a sub-row with branch select + batches editor (remove chips, add from dropdown) + Save/Cancel/Delete. When `batchBranches` prop is provided, the "add batch" dropdown filters to entries whose central branch matches the row's draft branch — prevents APJ batches from being assigned to LWS students. Save calls `updateStudentBranchBatch(lwsId, name, { branch, batches })`. Editing other fields (mobile, parent mobiles, name variants) stays in `ProfileCard` inside the detail view. **Delete** (admin only, behind a `window.confirm`) calls `deleteStudent(lwsId)` — see "Student deletion" below.

**Student deletion** (`studentSlice.deleteStudent`): hard-delete dual-path. On Supabase the row is removed via `delete().eq('lws_id', lwsId)` — `student_batches`, `student_attendance`, `student_logins` cascade-delete; `student_plans` SET NULL (history preserved by `student_name` text column); `exam_results` are not FK-linked so the student's scores remain in the DB as orphaned rows under their name. After deletion, if `activeStudent` referenced the deleted student, it is cleared.

`StudentView` still shows a profile card for students with no exams (early-return at `!allExamData.length` renders `<ProfileCard>` + empty state, not a blank screen).

**Name variant normalization in `StudentView`**: after the profile lookup, builds `allNames = Set([name, ...(profile?.nameVariants || [])])` and creates `normalizedExams` — a shallow in-memory copy where any student entry whose name is a known variant is renamed to the canonical name. All analytics (`getStudentExams`, `computeStudentChapterStats`, audits, etc.) then operate on the canonical name and find records regardless of which spelling appeared in the uploaded results. No-op when the student has no variants.

### Student import — tiered match (`src/lib/merge/mergeLogic.js`)

`mergeStudents(existingStudents, importedRows, { defaultBranch? })` matches each Excel row to an existing student via three tiered steps. The first hit wins:

1. **EIS** — `eis_reg_no` exact match.
2. **Mobile** — non-empty mobile that uniquely identifies one existing student (2+ candidates → falls through with `ambiguous_mobile` conflict).
3. **Name + branch** — `canonical_name` (case-insensitive) AND non-empty `branch` matching exactly one existing student (2+ → `ambiguous_name_branch` conflict).

If still no match: insert as new **only when EIS is non-empty** (preserves the safety net — blank-EIS rows that can't be matched are skipped, not inserted, so we don't create students without their canonical identifier). When matched via step 2 or 3, the existing row's `eis_reg_no` is updated from the import (lets re-registration with a new EIS still resolve to the same student).

Returns `{ students, added, updated, unchanged, conflicts }`. `conflicts[]` shape: `{ row, reason, candidates: [{ lws_id, canonical_name, mobile, branch }] }`. Surfaced in the Step 3 preview in `ImportStudentsModal.jsx` (amber section). Reasons:
- `ambiguous_mobile` / `ambiguous_name_branch` — non-blocking; the row was inserted as new because no unique match could be found.
- `mobile_conflict_on_eis_match` — non-blocking; EIS matched but the existing student's non-empty mobile differs from the import row's. The update still proceeds (EIS wins) — the conflict lets admin notice when an EIS might be shared by different people.

**`defaultBranch` option** (added 2026-05-21): when set, applies a fallback branch to (a) brand-new inserts whose XLS row has no branch, and (b) existing matched students whose current branch is empty. **Never overwrites a non-empty branch** — XLS row branch wins per-row, then `defaultBranch` fills remaining blanks. Wired into the Step 1 dropdown in `ImportStudentsModal.jsx`; the dropdown reads from `useStore(s => s.branches)`. `useImportFlow` caches the parsed inputs so changing the dropdown re-merges without re-reading the file.

**XLS Batch column is discarded** (added 2026-05-21): `mergeStudents` intentionally ignores `row.batches` from the XLS. Existing students' `batches[]` is never modified by import; new students arrive with `batches: []`. Faculty assigns batches manually via the StudentRowEditor (central-only dropdown). This is the lock that prevents HR-namespace batch names from re-entering the system after the alignment sweep — without it, the next HR re-import would undo the sweep. `parseStudentsExcel` still parses the column into `row.batches` (callers may use it for read-only signal); only the merge step ignores it.

### Duplicate detection & name-variant linking (`src/lib/merge/`)

Six files under `src/lib/merge/`, re-exported as a flat API via `src/lib/mergeStudents.js`.

**Profile–profile dedup** (`deduplication.js`): `findDuplicateCandidates(snakeStudents, opts)` signals: Jaccard bigram similarity ≥ 0.75 (`name_similar`), all tokens of shorter name in longer name (`name_subset`, requires ≥ 2 tokens to avoid false positives on shared surnames), same mobile, same EIS. No `branchFilter` → flat cross-branch scan; specific `branchFilter` → within that branch only.

**Exam-name scanning** (`deduplication.js`):
- `getUnmatchedExamNames(exams, studentProfiles)` — exam names not yet indexed in `studentProfiles` (includes canonical name + all name variants as keys).
- `findExamNameCandidates(unmatchedNames, snakeProfiles)` — returns `{ examName, profile, score, reasons }[]`. Reasons may include `name_similar` (Jaccard ≥ 0.75), `name_subset` (≥ 2 shorter tokens all in longer), `name_token_edit` (≥ 2 tokens each side, exactly one unique-per-side, Levenshtein ≤ 2 on the unique pair, min length ≥ 5 — catches V/W, l/i, Aaditya/Aditya class), `name_token_prefix` (single-token exam name length ≥ 4 matching one token of a multi-token profile — catches Rajivkumar → Rajivkumar Singh), `name_initial_match` (≥ 2 tokens each side, longer side ≥ 3 tokens, exactly one unique-per-side, one unique is a single letter optionally followed by `.`, the other unique starts with that letter — catches `Anant V. Sharma` ↔ `Anant Vijay Sharma`). Multiple signals can fire per pair. See [[project_dedup_threshold_decision]] for the trade-off (Patil/Patel surfaces as a candidate; faculty Skips in one click).

**Link action** (`studentSlice.js`): `addNameVariant(lwsId, variantName)` — appends exam name to `name_variants[]` in `students_db.json` and immediately re-indexes `studentProfiles` in memory.

**UI** (`FindDuplicatesTab.jsx`): combined scan runs both passes. Profile–profile pairs → merge (choose primary). Exam-name–profile pairs → "Link as variant" button (directional, exam name always goes into the profile). `ExamNameCard` uses dashed border + purple "exam name" badge + exam count. `pairKey` for exam pairs: `'exam:' + examName + '|' + lws_id`.

**Data source for the scan** (`ManageBatchBranchModal.jsx`): the `students` prop passed to `FindDuplicatesTab` is built from `studentList` (raw Supabase array), not `Object.values(studentProfiles)`. The map is keyed by `canonical_name` — two students with the same name collapse into one entry, hiding the duplicate. Bulk Assign tab still uses `uniqueStudents(studentProfiles)` since it doesn't need to see duplicates. (The legacy Rename tab was removed 2026-05-21 — rename CRUD lives in Settings.)

### WhatsApp Results flow
`💬 WhatsApp Results` button (admin, Exams page) → `WhatsAppPreviewModal` (review + edit) → `POST /api/send-whatsapp` → `WhatsAppResultsModal` (log).

**Pre-send modal** (`WhatsAppPreviewModal.jsx`): rows built from `exam.students` + `studentProfiles`; branch dropdown (derived from `studentProfiles`), mobile + parent mobiles editable inline. Footer has optional "redirect all to" test field. On "Confirm Send": calls `bulkUpdateStudentContacts(edits)` (single fetch→patch→write to `students_db.json`), then POSTs `{ examName, redirectTo?, students? }` to `/api/send-whatsapp`.

**Send history** (`whatsappSendHistory` store key, `{ [examId]: { sentAt, sent, skipped, failedNames[] } }`): persisted to `faculty-data.json`. Button shows `💬 Sent N✓ M✗ · Resend` after first send. `failedNames[]` is parsed from log lines client-side (`SKIP Name —` and `FAIL → Name (student`).

**Resend scope toggle**: when `failedNames` is non-null (previous send exists), modal shows amber banner with radio: "Failed & skipped only (N)" (default) / "All students". Scope controls the `students[]` array forwarded to `--students` in the script.

**`--students` filter** in `send_results_whatsapp.py`: comma-separated names, case-insensitive; filters `results` list before the send loop. Forwarded from POST body by the Vite dev endpoint or the `api/send-whatsapp.js` Vercel serverless function — same URL (`/api/send-whatsapp`) in both environments.

### Exam absences — persistent event log

`exam_absences` is a sparse event log: one row per (exam_id, lws_id) for every student in the expected cohort who didn't appear in `exam.students[]`. Columns: `id`, `exam_id` (FK ON DELETE CASCADE), `lws_id` (FK ON DELETE CASCADE), `marked_at`, `marked_by` (`'upload'` by default), `notified_at` (set when the WhatsApp absence alert lands). UNIQUE `(exam_id, lws_id)`. Indexed on `exam_id`, `lws_id`, and `(lws_id, marked_at DESC)`. RLS: authenticated only.

**Auto-sync on upload.** `examsSlice.addExam` and `replaceExam` both call `get().syncExamAbsences(examId)` after the local state write. The sync helper computes the current absentee set via `getExamAbsentees(exam, studentProfiles)`, reads existing `exam_absences` rows for the exam, and reconciles asymmetrically: **DELETE only for students who now appear in `exam.students[]`** (i.e. re-upload reveals they attended after all); INSERT for new absentees; **leave alone** any existing row whose student fell out of the cohort but didn't attend (batch moves, profile deletions) — those historical absences are still factual. Preserves `notified_at` across re-uploads. Returns `{ added, removed, kept }`.

**Self-heal on first modal open.** `ExamAbsencePreviewModal` reads from `getExamAbsencesForExam(examId)` on mount. If the table is empty (legacy exam uploaded before this feature), it triggers `syncExamAbsences(examId)` once and re-fetches. Replaces the previous inline computation and means legacy exams get backfilled lazily as faculty opens them — no migration script needed.

**Surfacing per-student.** `MissedExams.jsx` renders a card on `StudentView` listing absences (enriched with exam name, date, batch) sorted newest-first; hidden when zero. `RecentIncidents` extends to include exam absences in its last-30-days strip as `Missed exam · {examName}` chips. Both components support a `examAbsencesProp` prop bypass for the student portal (no Supabase session, so the slice fetch would return [] — `api/student-login.js` returns `examAbsences[]` (last 30 days) which threads through App.jsx → StudentView → MissedExams/RecentIncidents).

**Notified audit.** After a successful absence-alert send, `Exams.jsx`'s `handleExamAbsenceConfirm` computes `notifiedLwsIds = edits.filter(e => !failedSet.has(e.name)).map(e => e.lwsId)` and calls `markExamAbsencesNotified(examId, notifiedLwsIds)` to stamp `notified_at`. Rows whose student leg OR any parent leg failed are NOT marked (they appear in `failedNames` via `parseFailedNamesAbsence`). The modal shows a green "Notified" badge per row whose `notified_at` is set.

### Exam absence alert flow
`📵 Send Absent Alert` button (admin, Exams page, next to `💬 WhatsApp Results`) → `ExamAbsencePreviewModal` → `POST /api/send-exam-absence` → `WhatsAppResultsModal`.

**Multi-batch exams.** An exam may be sat by ≥1 batch. Step 2 of the upload modal stores the central batches as a **comma-joined string** in `exam.batch` — e.g. `"APJ_NDA_2Y_(26-28), LWS_NDA_2Y_(26-28)_A"` for an exam sat by two cohorts together. Readers split via the pure `getExamBatches(exam)` helper in `src/lib/analytics/filters.js`. Single-batch exams are just the bare name with no comma; legacy exams with HR-namespace `exam.batch` parse to a single (stale) element.

**Cohort derivation.** `getExamAbsentees(exam, studentProfiles)` returns profiles whose `batches[] ∩ getExamBatches(exam) ≠ ∅` AND whose canonical name (or any `nameVariants[]` entry) is NOT in `exam.students[]` AND whose `accountStatus === 'Active'` AND whose `regDate` (if set) is on/before `exam.date`. Variant-keyed entries in the profiles map are skipped via `p.name === key`, so each absentee is returned exactly once. Empty when `exam.batches` is empty (legacy exam) or no profile matches. **EIS+Active gate**: demo students (never registered → not in `studentProfiles`) are excluded structurally; Block / quit / batch-over students are excluded by the `accountStatus` check. **regDate gate**: students registered after the exam date are excluded (they weren't enrolled yet); missing `regDate` is permissive (no filter applied — matches `filterValidExams`).

**Modal-layer EIS+Active filter.** `ExamAbsencePreviewModal`'s `joinRows` independently filters historical `exam_absences` rows: drops rows whose joined profile is missing OR whose `accountStatus !== 'Active'`. Needed because a student may have been Active when the absence was recorded but Block now — the audit log preserves the historical fact, but the WhatsApp send must only reach currently-Active students.

**Student + parents.** Endpoint sends to **both** the student's own mobile and every entry in `parentMobiles[]` — accountability signal so the student knows their parents are being informed (decisions log). Template body still reads "Your ward was absent…" (Meta-approved, neutral re-wording deferred); slight off-tone on the student-copy was accepted in exchange for shipping today.

**Template (Wabridge / Meta).** Body uses positional `{{1}} = name`, `{{2}} = examName`. `examName` is ASCII-sanitised in `api/send-exam-absence.js` — en-dash/em-dash → `-`, newlines → space, runs of whitespace collapsed. Same Meta silent-drop rules as the other flows; see `feedback_whatsapp_template_param_rules`. Env: `WABRIDGE_EXAM_ABSENCE_TEMPLATE_ID`.

**Send history**: `examAbsenceSendHistory[examId] = { sentAt, sent, skipped, failedNames[] }`, persisted via `saveToStorage` (added to both the destructure and the data object). Button shows `📵 Sent N✓ M✗ · Resend` after first send. `failedNames[]` parsed via `parseFailedNamesAbsence` in `Exams.jsx` — captures `FAIL → Name (parent`, `SKIP Name parent ...`, and `SKIP Name —` lines (separate parser from the WhatsApp Results flow which only matches `(student`).

**Resend scope toggle**: when `failedNames` non-null, modal shows the amber `Failed & skipped only (N) / All students (M)` radio, defaulted to failed-only (same shape as `LateNotificationPreviewModal`). `bulkUpdateStudentContacts(edits)` runs before send to persist any parent-mobile edits.

### Step 2 upload — multi-batch picker (central-only)
`Step2Review.jsx` renders a checkbox group (one chip per `syllabusBatches[]` entry — `configSlice`'s central list, written only by Settings → Batches). Checking N chips writes them comma-joined to `state.batch` in `syllabusBatches[]` order. The picker has no free-text fallback — when `syllabusBatches` is empty the form shows "Add one in Settings → Batches" instead. `addBatch` in `configSlice` rejects names containing commas (reason: `comma_in_name`) so the separator can't sneak into a batch name.

### Student profiles & parent mobiles
`importStudentsDB` maps `students_db.json` snake_case fields to camelCase profile keys. Profile shape includes `parentMobiles: string[]` (from `parent_mobiles[]` in `students_db.json`).

**Population**: Student import XLS `Guardian No.` column is parsed as `guardian_mobile` in `parseStudentsExcel`. `mergeStudents` appends it to `parent_mobiles[]` if not already present — merge never overwrites, so manually-added numbers survive re-import. New students get `parent_mobiles: [guardian_mobile]` on first import.

**Edit UI**: `ProfileCard` (`studentViewComponents.jsx`) shows parent mobiles as pills and lets admin add/remove numbers (digits-only normalisation on input). Saved via `updateStudentParentMobiles(lwsId, name, parentMobiles)` in `studentSlice.js`, alongside branch/batch in one Save action.

`split_students.py`'s `lws_to_info` carries `parent_mobiles` for use by `send_results_whatsapp.py`.

### GAT subject routing
`computeStudentChapterStats / computeWrongAudit / computeSkippedAudit` accept `qSubject?` — filters questions where `q.subject` matches. Questions with `q.subject=null` (non-GAT exams) are always included.
GAT total (600) is always derived — never stored. `CONFIGURABLE_SUBJECTS` excludes GAT from the freq editor. Tags file **must** include a `Subject` column per question for combined GAT mocks.

### Late marking & lecture-miss flow (Attendance page)

Two related signals beyond daily P/A, both surfacing on the Attendance page (`src/pages/Attendance/index.jsx`):

**(1) Late to first lecture** — sparse, in-app marking. `student_attendance.status='L'` replaces the daily P/A for that (lws_id, date). Faculty marks via the top-of-page `LateMarkingWidget` (admin only): search → add → chip list → "Send Morning Late Notifications" button. Actions `markLate(lwsId, date)` / `unmarkLate(lwsId, date)` / `getLateStudentsForDate(date)` live on `attendanceSlice.js`. `importAttendance` queries existing L rows for the (lws_id, date) pairs in the XLS and filters them out before upsert — without this, the morning marking would be silently overwritten when the LWS attendance XLS imports at end of day (the XLS only carries P/A/-). Returns `lateProtected` count so the success banner can surface preserved markings.

**(2) Per-lecture absences during the day** — sparse event log in `lecture_absences`. Faculty enters via the **Lecture log tab** on the Attendance page: pick date + batch → per-period cards (derived from `getTodaysLectures(timetable, date, mappings)`) → click "Mark absentees" → modal with searchable multi-select → save. Replace-set semantics per period card via `lectureAbsenceSlice.setLectureAbsenteesForPeriod(date, slotId, subject, lwsIds)` which deletes existing rows for `(date, slot_id)` then inserts the new set. Keying by **slot_id** (not subject) means two same-day same-subject periods (e.g. Maths at 11 AM + Maths at 2 PM) stay independent — see decisions log. Subjects come from the batch's timetable for that weekday, NOT from a hardcoded list — when no timetable exists for the picked batch, the tab shows "Set up the timetable for this batch first". Sunday returns an empty list.

**Pure helper** `src/lib/timetable.js` → `getTodaysLectures(timetable, date, mappings)` returns `[{ slotId, startTime, endTime, subject, mappingId, label }]` in time order. Skips `__span` rows (lunch), breaks, slots with no entry for the resolved day, and class cells whose `mappingId` no longer exists in `mappings`. Accepts either a `Date` object or a `YYYY-MM-DD` ISO string; ISO strings are parsed as local dates so `getDay()` returns the local weekday.

**Sending** — two Vercel serverless endpoints mirror the `api/send-whatsapp.js` pattern: `api/send-late-notifications.js` (variables `[name, date]`) and `api/send-lecture-absences.js` (variables `[name, date, formattedSubjects]`). Both verify the admin JWT (Bearer header), then loop `students[]` from the request body, sending one Wabridge call per student mobile + each parent mobile. `redirectTo` overrides every destination (test-mode). Template IDs come from `WABRIDGE_LATE_TEMPLATE_ID` and `WABRIDGE_LECTURE_MISS_TEMPLATE_ID` env vars; endpoints return `500` with a helpful message if missing (Meta template approval is parallel — UI flows still work end-to-end without templates so dev can rehearse the marking + preview without firing real messages). The Vite dev plugin (`vite.config.js`) has a small shim that imports the same JS handler and adapts the req/res shape, so the endpoints work in both dev and prod under the same URL.

**Wabridge / Meta template parameter rules** (learned the hard way; see decisions log + memory `feedback_whatsapp_template_param_rules`):
- Template body must use **positional** `{{1}} {{2}} {{N}}` placeholders — Meta does NOT substitute named placeholders like `{{name}}`.
- Variable values must be **ASCII-only**: no en-dash `–`, em-dash `—`, or other Unicode punctuation (Meta drops messages silently).
- No newlines, tabs, or 5+ consecutive spaces inside a variable value (same — silent drop).
- Avoid parentheses-around-colons patterns like `(11:00 AM - 12:30 PM)` — Meta's "looks-like-rich-formatting" filter rejects them. `api/send-lecture-absences.js` formats the per-subject string as `Subject HH:MM AM to HH:MM PM` (plain ASCII, comma-joined for multiple subjects).

**Resend failed-only** (late + lecture-miss) — after a send, AttendancePage parses `data.lines` for `FAIL → Name (student|parent)` and `SKIP Name —|parent` patterns via `parseFailedNames()` (exported from `src/pages/Attendance/index.jsx`). Names are persisted to one of two store keys: `lateSendHistory[YYYY-MM-DD]` for late notifications, `lectureMissSendHistory[\`${date}|${batchName}\`]` for lecture-miss (compound key so two batches sent on the same day stay independent). Both `LateMarkingWidget` and `LectureLogTab` render three contextual button states based on their history entry: first send (`Send …`), after-send with failures (`Sent ✓X · Failed ✗Y · Resend`), or after-send clean (`✓ Sent today · Resend all`, secondary style). Both preview modals (`LateNotificationPreviewModal`, `LectureMissPreviewModal`) accept a `failedNames` prop — when non-null they show an amber scope banner with `Failed & skipped only (N)` / `All students (M)` radio defaulted to failed-only, and filter both the visible rows and the wire payload by scope. Both modals call `bulkUpdateStudentContacts(edits)` before send so mobile/parent-mobile fixes persist to the student profile (parity with `WhatsAppPreviewModal`).

**Preview modals** (`LateNotificationPreviewModal`, `LectureMissPreviewModal`) mirror the existing `WhatsAppPreviewModal` shape: editable mobile + parent_mobiles per row, redirect-to test field at the bottom, Confirm / Cancel. The lecture-miss modal additionally shows the missed-subjects list per student. Empty input → Confirm disabled.

**Recent incidents** — `src/pages/Students/RecentIncidents.jsx` sits below `AttendanceRings` on `StudentView`. Shows last 30 days of L markers (from the `attendance` prop) + lecture absences (fetched via `getLectureAbsencesForStudent` for admin/teacher, or supplied via `lectureAbsencesProp` for the student portal — same prop-bypass pattern as `attendanceProp`). Hidden when there are zero incidents. `api/student-login.js` was extended to return `lectureAbsences[]` (last 30 days) alongside `attendance[]`.

**Per-month chips on AttendanceRings** — below each monthly donut, up to three clickable chips, each shown only when the count is > 0:

- **Days late: N** (yellow) — from `attendance` `L` rows. Expanded list: `5 Jun · 12 Jun · 19 Jun` (latest first).
- **Missed Lectures: N** (red) — from `lecture_absences` rows. Expanded list: `19 Jun English · 12 Jun Physics · 5 Jun Maths`.
- **Missed Exams: N** (darker red) — from `exam_absences` rows bucketed by the exam's date (not `marked_at`). Expanded list: `22 May Mock #5 · 8 May Mock #3`.

Expansion model is `expanded: { month, kind } | null` at the component level — single-open across the whole component. Clicking a chip in any month opens it and auto-collapses any other open chip (in the same month OR a different month). Months that have only `L` rows still render a ring at 0%, same applies for months with only lecture/exam misses.

**UI guardrails:**
- Tab strip on Attendance: `Class metrics` (existing content + `LateMarkingWidget` at top, admin-only) / `Lecture log` (new). `LectureLogTab` is shown to admin only; teachers see only Class metrics.
- "Send Morning Late Notifications" disabled until at least one L row exists for the day; "Send Lecture-Miss Notifications" disabled until at least one lecture absence is logged for the (date, batch) pair.
- After send, a fixed-bottom `Alert` shows `sent` / `skipped` counts (or the error). Dismissable.

### Syllabus Tracker (`src/pages/Syllabus/`)
Tracks teaching progress per batch, independent of exam data.

**Data model**: `syllabusPrograms` — `{ id, name, trackingColumns[], subjects[{ id, name, chapters[{ id, name, group }] }] }`. `syllabusBatches` — `string[]` (user-managed, independent of exam batches). `syllabusBatchBranches` — `{ batchName: branchName }` (optional per-batch branch tag). `batchProgramAssignments` — `{ batchName: [programId] }`. `batchSyllabusProgress` — `{ batchName: { programId: { subjectId: { chapterId: { col: status } } } } }`. `batchChapterTimelines` — `{ batchName: { programId: { subjectId: { chapterId: "YYYY-MM" } } } }` — per-batch scheduled month for each chapter.

**Status cycle**: `null → 'In Progress' → 'Done' → null` (admin only). Seed data in `src/lib/syllabusSeed.js` (generated by `generate_syllabus_seed.py`) auto-loaded when `syllabusPrograms` is empty.

**Chapter timeline**: `setChapterTimeline(batchName, programId, subjectId, chapterId, "YYYY-MM")` / `getChapterTimeline(...)` in `syllabusSlice.js`. Displayed in `SubjectAccordion` as a fixed "Timeline" column (before tracking columns) showing `"Jun 2026"` format. Faculty clicks cell → inline `<input type="month">`; teacher sees read-only. `clearSubjectProgress` does NOT clear timelines — resetting tracking status keeps the planned schedule. Timeline is batch-level (different batches may have different schedules for the same chapter).

**Batch tabs** come from `syllabusBatches` — standalone list independent of `exams[].batch` or `studentProfiles[].batches`. Admin can add, rename, and delete batches from the tab bar. `AssignProgramsModal` selects from this list only (no inline batch creation). Migration: on first load, if `syllabusBatches` is empty, seeded from `Object.keys(batchProgramAssignments)`. Chapters support optional `group` string for section headers.

**Branch filter**: branch pills above batch tabs are sourced from `timetables[].branch` (same source as TimetablePage/ExamScheduleView). `syllabusBatchBranches` maps batch names to branches — set via `setSyllabusBatchBranch(batchName, branch)` or the ⋯ menu "Set branch" option. When adding a batch with a branch filter active, the batch is auto-tagged to that branch.

Syllabus batch mutations: `addSyllabusBatch`, `renameSyllabusBatch` (cascades to assignments + progress + `syllabusBatchBranches` + `batchChapterTimelines` keys), `deleteSyllabusBatch` (cascades all four) — all in `syllabusSlice.js`. `deleteProgram`, `deleteSubject`, `deleteChapter` also cascade to `batchChapterTimelines`.

### Monthly Reports (2026-05-24)
Admin-only sidebar entry that generates per-student PDF report cards for a (batch, month) pair. Compute-on-demand — no persistence. Designed for parents.

**Page** [`src/pages/MonthlyReports/index.jsx`](src/pages/MonthlyReports/index.jsx): month picker (default = previous calendar month) + batch picker (from `syllabusBatches`). "Generate" calls `fetchMonthlyReportData(month, lwsIds)` (one Supabase query per table for the whole cohort, not three × N round-trips). After generating, renders one `ReportRow` per cohort student. Per-row Download. Bulk **"Download all as ZIP"** packages every report into one archive via JSZip (loaded dynamically).

**Cohort rule** in `getMonthlyReportCohort(profiles, batch, month)`: Active `accountStatus` + `batches[]` includes selected batch + `regDate ≤ last-day-of-month`. Skips variant-keyed entries. Students with zero exams still get a report (attendance only).

**Builder** [`src/lib/monthlyReportBuilder.js`](src/lib/monthlyReportBuilder.js): pure `buildMonthlyReport({ profile, month, exams, attendance, lectureAbsences, examAbsences, batchChapterTimelines, syllabusPrograms })` returns sections object — `meta`, `examTable` (with ABSENT rows from exam_absences, regDate-filtered), `attendance` (P/A/L counts + percentage + missed lectures list + late dates), `nextMonthFocus` (chapters scheduled for following month from `batchChapterTimelines`).

**PDF** [`src/lib/monthlyReportPdf.js`](src/lib/monthlyReportPdf.js): jsPDF + jspdf-autotable (dynamic imports, same pattern as `examPdf.js`). Renders REPORT CARD title + underline, Name/Month meta block (no Roll No), exam table mirroring the institute's paper format (ABSENT in danger colour), attendance row with conditional non-zero segments via `attendanceDescriptor(a)`, optional faculty remark (transient, typed at preview time), next-month focus footer, institute footer line.

**Bulk ZIP** [`src/lib/monthlyReportZip.js`](src/lib/monthlyReportZip.js): `buildMonthlyReportsZipBlob(items)` iterates the cohort, renders each PDF sequentially, writes to a JSZip archive. `zipFilename(batch, monthLabel)` sanitises to `{batch}_{Month}_Reports.zip` (no parens, no whitespace).

**Remark UX**: typed at generate-time, lives in page-level state as `{ [lwsId]: remark }`, written into the PDF on download. Not persisted — re-typed if faculty re-generates. Per the agreed compute-on-demand decision.

**Trimmed from the original spec (2026-05-24, faculty feedback)**: Subject summary table + Weakest chapter line removed (rendered the trend ↑/↓ glyphs as garbage via jsPDF's WinAnsi encoding — same class as the LaTeX-symbols bug in `examPdf.js`). Roll No row removed (never populated). Attendance descriptor hides zero segments.

### Teacher auth accounts — Settings → Teachers tab
Admins provision Supabase auth users with `user_metadata.role='teacher'` directly from the Settings → Teachers tab (no CLI for routine use; `create_teacher_account.js` retained for migration / break-glass). UI exposes Create / Delete / Reset password per-row plus an inline "Also create a login account" checkbox on Add Teacher.

**Endpoint** [`api/teacher-account.js`](api/teacher-account.js) — single POST, action-routed:
- `list` → `{ emails: string[] }` of lowercase emails whose `user_metadata.role === 'teacher'`
- `create { email, password, name? }` → calls `auth.admin.createUser({ email_confirm: true, user_metadata: { role: 'teacher', full_name? }})` — accounts are instant-active, no Supabase email
- `delete { email }` → looks up UID via `listUsers` (case-insensitive email match), calls `auth.admin.deleteUser(uid)`
- `reset { email, newPassword }` → same lookup, calls `auth.admin.updateUserById(uid, { password })`

**Two-client pattern.** Anon client verifies the caller's Bearer JWT and rejects when `user.user_metadata.role === 'teacher'` (a teacher must never be able to escalate). Service-role client (`SUPABASE_SERVICE_ROLE_KEY`) performs the admin.* call. Service key MUST live only in Vercel env — never ships to the browser. Endpoint returns 500 with a configuration message when missing.

**`timetableTeachers[]` ↔ auth accounts are loosely coupled by email.** No FK, no shared id. A row may have an email without a login account (timetable-only) or vice versa (admin assistant). The Teachers tab fetches `list` on mount and shows a "🔐 has login" badge for matching rows; UI buttons toggle between `🔑 Create login` and `🔄 Reset password` + `🗑 Delete login` based on that fetch.

**Dev shim** in `vite.config.js` reuses the same JS handler via `makeApiShim('./api/teacher-account.js')` so `/api/teacher-account` works identically in `npm run dev` and prod.

**Required env:** `SUPABASE_SERVICE_ROLE_KEY` in Vercel (Project → Settings → Environment Variables). Local dev reads from `.env.local`.

### Settings page — sole CRUD surface for branches / batches / teachers (2026-05-20)
`src/pages/Settings/SettingsPage.jsx` is admin-only and the **only** place branches, batches, and teachers can be added / renamed / deleted. Three tabs:
- **Branches** — reads/writes `branches[]` (top-level store key, seeded on first load from the union of `timetables[].branch` + `Object.values(syllabusBatchBranches)`). `addBranch` / `renameBranch` (cascades to `timetables[].branch`, `examSchedules[].branch`, `syllabusBatchBranches` values) / `deleteBranch` (blocks when in use; returns `{ ok, usage }`). `students.branch` and `exams.branch` are NOT cascaded — they were one-off-aligned via SQL on 2026-05-21 and the Evalbee XLS doesn't carry branch, so they stay stable. Future central renames would leave those untouched; rerun SQL if needed.
- **Batches** — reads `syllabusBatches[]` ∪ `timetables[].batchName` (union so drift is visible). `addBatch(name, branch)` **requires** both name AND a branch that exists in `branches[]` (returns `{ ok, reason }`); the unified `renameBatch(old, new)` delegates to both `renameSyllabusBatch` AND `renameTimetableBatch` AND fires the Supabase cascade for `student_batches` + `exams.batch` via `cascadeBatchRenameToSupabase`; `deleteBatch` blocks when a timetable or exam-schedule still references the batch (returns `{ ok, usage }`). Each existing batch row has an inline branch dropdown so reassigning is a single click. The "no branch" choice no longer exists in the UI.
- **Teachers** — same actions as the slice exposes (`addTimetableTeacher` / `updateTimetableTeacher` / `deleteTimetableTeacher`). The legacy `ManageTeachersModal.jsx` was deleted (2026-05-20); the "Manage Teachers" button on the Timetable page is gone.

Other surfaces became select-only:
- `AddTimetableModal` — branch picker is a closed dropdown from `branches[]` (no "Custom" entry); batch picker is a closed dropdown from `syllabusBatches[]` **filtered** to the selected branch via `syllabusBatchBranches`. Save is disabled until both are picked; duplicate timetable detection prevents creating two timetables for the same (branch, batch) pair. Free-text batch creation here is gone — adding a new batch requires Settings → Batches.
- `SyllabusPage` batch tab bar — view-only. The tab-bar inline "+ Add batch", rename input, and ⋯ menu (Rename / Set branch / Delete) are gone. Branch filter pills + batch tabs remain for navigation. The page still owns per-batch program assignments and chapter status — those are batch *contents*, not batch *identity*.
- `ManageMappingsModal` still has a teacher *picker* (subject-teacher pair) — selection, not edit, so it stays.

### Syllabus + timetable batch unification (2026-05-20)
`syllabusBatches[]` and `timetables[].batchName` are kept **1:1** by the unified `renameBatch` / `deleteBatch` actions in `configSlice`. The original `migrate_unify_batches.js` (retained for archaeology) produced a 10-name `_A`/`_B` scheme; the central list was reshaped to a 7-batch state, then cleaned and extended to **8 batches on 2026-05-21** following the `BRANCH_NDA_DURATION_(YY-YY)[_SECTION]` convention (no spaces, underscores throughout). Renames cascaded via a single atomic DO block in Supabase to `syllabusBatches`, `timetables[].batchName`, `examSchedules[].batchName`, `syllabusBatchBranches`, `batchProgramAssignments`, `batchSyllabusProgress`, `batchChapterTimelines`. The unification *contract* (syllabus == timetable, both renamed atomically) is enforced by the slice; the *specific name list* is whatever Settings says today. Verify the current set against Supabase before reasoning about specific batch names.

`profile.batches[]` alignment (the student-portal join key, Phase 3 of the branch-batch plan) is now being executed via a **manual sweep**: faculty replaces each student's HR-namespace batches with central names via the Students-tab row editor (which shows an "⚠ Needs review" pill on unaligned rows and filters the dropdown to central-only). Bulk-assign via backend SQL is also viable for large cohort moves — see `project_branch_batch_plan` in memory. The `mergeStudents` XLS Batch lock (above) prevents drift from returning post-sweep.

`branches[]` (the top-level store key seeded by `seedBranches(saved)` in `defaults.js`) was seeded to `["APJ", "LWS Pune"]` directly into Supabase JSONB on 2026-05-21 alongside the central name cleanup.

### Timetable (`src/pages/Timetable/`)
CRUD for branch/batch timetables: time slots, a Mon–Sat grid of cells (class, break, or full-row span), subject-teacher mappings, and a batchwise exam schedule.

**Data model**:
- `timetableTeachers` — `{ id, name, email }`
- `timetableMappings` — `{ id, label, subject, teacherId }`
- `timetables` — `{ id, branch, batchName, title?, footnotes?, timeSlots[{ id, startTime, endTime }], grid: { [slotId]: { [day]: { type, mappingId|label } | null, __span? } } }`. `title` and `footnotes` are optional JSONB strings persisted via existing `updateTimetable` patch path — no schema migration.
- `examSchedules` — `{ id, date, startTime, endTime, subject, chapter, teacherId, branch, batchName, status }`. `status` cycles `Planned → Completed → Cancelled → Planned` (admin only). `branch`/`batchName` come from existing `timetables[]` entries — not from syllabus batches or exam batches.

**Cell render** (2026-05-25): `TimetableGrid` renders `mapping.label` on line 1 (e.g. `Maths_12th_NDA`, `Physics_NDA`) and the resolved teacher name on line 2 (only when `teacherId` is set). The `subject` field is intentionally NOT used for cell display — labels carry the 12th-vs-NDA / PYQ / per-teacher distinctions that the coarser `subject` collapses. `subject` is still used by `ManageMappingsModal` for grouping and by `api/send-lecture-absences.js` for the message body. `<TimetableGrid>` accepts a `teachers` prop; falls back gracefully when missing.

**Title** (optional, 2026-05-25): `timetable.title` overrides the auto-generated `${branch} — ${batchName}` at three render points — page subheading, Excel export title row, PNG export titleEl. Empty/missing → fallback. Centralised via `getTimetableTitle(tt)` helper at the top of `TimetablePage.jsx`. Edited via the "Title (optional)" input in `AddTimetableModal`. **Tab labels still use `batchName`** — title is presentation-only and is never used as a join key (`examSchedules.batchName`, `student_batches.batch_name`, `exams.batch` all key on `batchName`).

**Footnotes** (optional, 2026-05-25): `timetable.footnotes` is a multi-line string. Edited via inline textarea below the grid (admin-only "✎ Edit notes" / "+ Add notes" button). Renders as a numbered `<ol>` (`\n`-split, blanks dropped). Captured in PNG export (cloned-block construction in `handleDownloadPng`) and Excel export (header row "Notes" + one merged row per non-blank line, body style).

**Teacher email**: stored on `timetableTeachers[].email`. `updateTimetableTeacher(id, patch)` accepts `{ name?, email? }` — not a bare string. Teachers without email are skipped by `send_schedule.py`. Deleting a teacher cascades: nulls `teacherId` on both `timetableMappings` and `examSchedules`.

**Batch rename**: to rename a timetable's `batchName`, use `renameTimetableBatch(oldName, newName)` — it cascades to `examSchedules[].batchName`. `updateTimetable(id, { batchName })` is a bare patch that does NOT cascade and will leave exam schedules pointing at a stale name. `AddTimetableModal` routes the edit through `renameTimetableBatch` when the batchName changes and only uses `updateTimetable` for branch-only edits.

**Schedule emails**: `send_schedule.py` reads `faculty-data.json` and sends HTML email via Gmail SMTP. Modes: `--weekly` (next Mon–Sat, appends "Upcoming Exams This Week" section); `--daily` (tomorrow, Sat → Mon); `--exam-reminder N` (exams N days from today, N=1 or 2). Triggered from the UI via `POST /api/send-schedule` (`vite.config.js`). `SendScheduleModal` handles all three modes.

**Excel export**: `downloadTimetableExcel` uses `xlsx-js-style` (not `xlsx`) to produce a styled workbook — Times New Roman font, bold title row (merged, 13 pt), bold headers and time column (10–11 pt), thin black borders on all cells, and explicit row heights. Do not revert this import to `xlsx` (the community edition has no styling API).

**Views**: "Student View" (timetable grid per branch/batch, PNG + Excel export), "Teacher Schedule" (all slots for a selected teacher, clash detection), and "Exam Schedule" (batchwise exam list with branch-pill / batch-underline-tab filter identical to Student View, status badges, reminder email buttons).

### Mode-conditional visibility
Use `useMode()` — never `IS_READ_ONLY` — for component-level visibility.

| Feature | Admin | Teacher | Student |
|---|---|---|---|
| Add/delete exams, re-upload, edit questions | ✓ | — | — |
| WhatsApp Results button | ✓ | — | — |
| Send Exam Absence Alert (📵 button on Exams row) | ✓ | — | — |
| Edit student branch/batch | ✓ | — | — |
| Attendance page (import XLS + class metrics table) | ✓ | ✓ | — |
| Late marking widget (Attendance page) | ✓ | — | — |
| Lecture log tab (Attendance page) | ✓ | — | — |
| Send Late / Lecture-Miss notifications | ✓ | — | — |
| Recent incidents strip (StudentView) | ✓ | ✓ | ✓ (portal) |
| Missed exams card (StudentView) | ✓ | ✓ | ✓ (portal) |
| Attendance rings (student monthly % view) | ✓ (StudentView) | ✓ (StudentView) | ✓ (portal, inline scroll) |
| Syllabus Tracker (edit) | ✓ | — | — |
| ProjectedScoreCard | ✓ | ✓ | — |
| WrongAnswerAudit / UnattemptedAudit | ✓ | ✓ | ✓ |
| Download exam PDF | ✓ | ✓ | — |
| Toppers page | ✓ | ✓ | — |
| Syllabus Tracker (view) | ✓ | ✓ | — |
| Insights / API Costs pages | ✓ | — | — |
| Monthly Reports page (generate PDFs + ZIP) | ✓ | — | — |
| Settings page (Branches / Batches / Teachers) | ✓ | — | — |
| Timetable (edit cells, add slots) | ✓ | — | — |
| Send Schedule email button | ✓ | — | — |
| Exam Schedule (add/edit/delete, status cycle, send reminders) | ✓ | — | — |
| Exam Schedule (view) | ✓ | ✓ | — |
| Sidebar | ✓ | ✓ | — |

---

## Excel upload format

**Results** (Evalbee): `Name`, `Total Marks`, `Correct Answers`, `Incorrect Answers`, `Q N Marks`, `Q N Options`. The `Subject 1/2` columns are aggregate totals — no per-question subject info.

**Tags**: required `Q` (or `Question#`), `Chapter`. Optional: `Subtopic`, `Question`, `OptionA–D`, `Answer`, `Solution`, `Difficulty`. **GAT combined exams**: `Subject` column per question is required — without it all 150 Qs are unroutable.

**Student import** (same XLS format as the Student Search List export): row 0 = title, row 1 = headers, row 2+ = data. Key columns: `RegistrationNo.`, `Name`, `Mobile No`, `Email`, `Guardian No.`, `Batch`, `Coming Status`, `Account Status`, `RegistrationDate`, `Quit Date`. `Guardian No.` is merged into `parent_mobiles[]` (see Student profiles section above).

**Attendance import** (LWS attendance export): row 0 = title, row 1 = headers, row 2+ = data. Required columns: `Student Name`, `Mobile No.`. Date columns in `DD-MM-YYYY` format (header), values `P` / `A` / `-` (dash = skip). Parsed by `parseAttendanceExcel` in `src/lib/excel.js`; matched to `studentProfiles` by mobile (primary) or name (fallback). Upserted into `student_attendance` with `onConflict: 'lws_id,date'`. **`L` rows (late) are preserved on import** — the slice queries existing L for the imported (lws_id, date) pairs and filters them out of the upsert so morning late-marking isn't overwritten by the end-of-day XLS.

---

## Key files

| File | Purpose |
|---|---|
| `src/config.js` | Mode detection (`IS_READ_ONLY`), session keys (`SESSION_KEY`, `SESSION_DAYS`), app info |
| `api/student-login.js` | Vercel serverless — normalises mobile, queries `students` table, fetches `exam_results` + `exams` + `student_attendance` + `lecture_absences` (last 30 days); fire-and-forgets a `student_logins` insert; returns student data including `lectureAbsences[]` for the RecentIncidents strip |
| `create_teacher_account.js` | Admin script — creates/updates Supabase auth user with `role='teacher'` metadata. Usage: `node create_teacher_account.js <email> <password>` |
| `src/context/ModeContext.jsx` | `ModeContext` + `useMode()` |
| `src/store/useStore.js` | Zustand store assembler |
| `src/store/persist.js` | Dev: disk via Vite plugin. Prod admin: Supabase `faculty_state`. Teacher/student: no-op. |
| `src/lib/supabase.js` | Null-guarded Supabase client (returns `null` if env vars absent) |
| `src/stubs/empty.js` | One-line `export default {}` — aliased from `stream` in `vite.config.js` so xlsx's optional `require('stream')` short-circuits cleanly instead of throwing on Vite's externalised-module stub. |
| `vercel.json` | SPA rewrite rule — all non-`/data/|api/` paths → `index.html` |
| `api/send-whatsapp.js` | Vercel serverless function — verifies admin JWT, loads exam from `exams` table + results from `exam_results`, builds Wabridge payloads; mirrors the Vite dev endpoint at the same `/api/send-whatsapp` URL |
| `api/send-late-notifications.js` | Vercel serverless — verifies admin JWT, loops `students[]` from request body, Wabridge template variables `[name, date]`. Requires `WABRIDGE_LATE_TEMPLATE_ID` env. Dev shim in `vite.config.js` dynamically imports the same handler so the endpoint works in `npm run dev` too. |
| `api/send-lecture-absences.js` | Vercel serverless — verifies admin JWT, loops `students[]` from request body (each with `subjects[{subject, startTime?, endTime?}]`). Wabridge variables `[name, date, formatted]` where `formatted` is a comma-joined ASCII string `Subject HH:MM AM to HH:MM PM, …`. Requires `WABRIDGE_LECTURE_MISS_TEMPLATE_ID` env. Skips students with empty subjects. Same dev shim pattern as above. |
| `api/send-exam-absence.js` | Vercel serverless — verifies admin JWT, loops `students[]` from request body. Sends to **both** the student's own mobile and every entry in `parentMobiles[]` (accountability — see decisions log). Wabridge variables `[name, examName]` (positional). `examName` is ASCII-sanitised (en-dash/em-dash → `-`, whitespace collapsed). Requires `WABRIDGE_EXAM_ABSENCE_TEMPLATE_ID` env. Dev shim in `vite.config.js`. |
| `api/teacher-account.js` | Vercel serverless — admin-only CRUD for Supabase auth users with `role='teacher'`. Single POST, action-routed (`list` / `create` / `delete` / `reset`). Verifies caller JWT via anon client and rejects `role='teacher'` callers (no privilege escalation). All admin.* calls use a service-role client; requires `SUPABASE_SERVICE_ROLE_KEY` in Vercel env. `create` uses `email_confirm: true` (instant-active, no Supabase email). Email lookups for delete/reset are case-insensitive via `listUsers()`. Dev shim in `vite.config.js`. |
| `src/pages/Settings/TeachersTab.jsx` | Teachers tab + auth-account UI. Fetches `{action:'list'}` on mount → drives `🔐 has login` badges. Add Teacher form has optional "Also create a login account" checkbox + password (min 8). Per-row controls (admin only): `🔑 Create login` when no auth account, `🔄 Reset password` + `🗑 Delete login` when one exists. All login mutations re-fetch the list on success. |
| `migrate_to_supabase.js` | One-time seed script: `faculty-data.json` → Supabase (needs `SUPABASE_SERVICE_ROLE_KEY`) |
| `migrate_exams_to_supabase.js` | Re-runnable seed: exams + results → `exams`/`exam_results` tables. Falls back to Supabase JSONB if local file has 0 exams. Verifies row count after seed; `--cleanup` prints SQL only (run manually after verification) |
| `migrate_students_to_supabase.js` | Re-runnable seed: `students_db.json` → 4 Supabase tables (upsert; drops dead `exams[]`) |
| `sync_students_from_supabase.js` | Reverse sync: Supabase tables → `students_db.json` (for Python scripts) |
| `src/store/slices/examSupabase.js` | Supabase helpers for exam mutations: `upsertExam`, `deleteExamById`, `updateExamQuestions`, `buildExamRow`, `buildResultRows` |
| `src/store/slices/insightsSupabase.js` | Supabase helpers for insights mutations: `insertClassReport`, `insertStudentPlan`, `deleteAllClassReports`, `deleteStudentPlansByName` |
| `src/store/slices/insightsSlice.js` | Insights CRUD — dual-path: state always updated; if `getSession()` returns a session, also inserts into `class_reports` / `student_plans`. Inserts are append-only (history preserved). |
| `migrate_insights_to_supabase.js` | Re-runnable seed: `savedInsights` → `class_reports` + `student_plans`. Resolves `lws_id` from `students_db.json` by canonical name + name variants. Tags rows with `generated_by='legacy-import'`. `--cleanup` prints SQL to drop `savedInsights` from `faculty_state.data`. |
| `src/store/slices/syllabusSlice.js` | Syllabus CRUD + progress cycle |
| `src/store/slices/timetableSlice.js` | Timetable, slot, mapping, teacher CRUD |
| `src/store/slices/configSlice.js` | Central branches[] + unified `renameBatch` / `deleteBatch` / `branchInUseBy` / `batchInUseBy`. `renameBatch` also fires `cascadeBatchRenameToSupabase` so `student_batches` + `exams.batch` stay aligned. |
| `src/store/slices/batchSupabase.js` | `cascadeBatchRenameToSupabase(client, oldName, newName)` — fire-and-forget Supabase cascade for batch renames. Rewrites `student_batches.batch_name` (DELETE old + UPSERT new — PK is composite) and `exams.batch` (LIKE-narrow then exact-token replace via `getExamBatches` to avoid substring matches). No-op for empty/equal names or clientless calls. |
| `src/pages/Settings/` | Admin-only Settings page (`SettingsPage`, `BranchesTab`, `BatchesTab`, `TeachersTab`) |
| `src/pages/MonthlyReports/` | Admin-only Monthly Reports page (`index`, `ReportRow`) — month/batch picker, cohort preview, per-row + bulk-ZIP PDF download |
| `src/lib/monthlyReportBuilder.js` | Pure `buildMonthlyReport({ profile, month, exams, attendance, lectureAbsences, examAbsences, batchChapterTimelines, syllabusPrograms })` + `getMonthlyReportCohort(profiles, batch, month)` |
| `src/lib/monthlyReportPdf.js` | `buildMonthlyReportPdfBlob(report, { remark })` + `downloadMonthlyReportPdf` + exported `attendanceDescriptor` helper. Dynamic jsPDF + autotable imports. |
| `src/lib/monthlyReportZip.js` | `buildMonthlyReportsZipBlob(items)` + `downloadMonthlyReportsZip(items, zipName)` + `zipFilename(batch, monthLabel)`. Dynamic JSZip import. |
| `src/store/slices/monthlyReportSlice.js` | `fetchMonthlyReportData(month, lwsIds)` — bulk reads `student_attendance`, `lecture_absences`, `exam_absences` for the cohort. Returns `{ attendanceByLwsId, lectureAbsencesByLwsId, examAbsencesByLwsId }` or `null` on error/no-session. |
| `src/pages/Timetable/` | TimetablePage, TimetableGrid, ExamScheduleView, AddExamScheduleModal, Edit/Add modals, SendScheduleModal |
| `src/pages/Exams/WhatsAppPreviewModal.jsx` | Pre-send review modal: editable student table (branch dropdown, mobile, parent mobiles), scope toggle for resend, test redirect-to field |
| `src/pages/Exams/WhatsAppResultsModal.jsx` | Post-send log modal — sent/skipped counts + per-line colour-coded log. Accepts `recipientLabel` prop (defaults to `'students + parents'`). |
| `src/pages/Exams/ExamAbsencePreviewModal.jsx` | Pre-send modal for exam absence alerts. Reads the persistent absentee list from `getExamAbsencesForExam(examId)` (self-heals via `syncExamAbsences` if the table is empty for a legacy exam). Joins with `studentProfiles` for contact info. One card per absentee with editable student `mobile` + `parent_mobiles`. Green "Notified" badge on rows whose `notified_at` is set. Same `failedNames` scope toggle + `bulkUpdateStudentContacts` persistence pattern as `LateNotificationPreviewModal`. |
| `src/store/slices/examAbsenceSlice.js` | `syncExamAbsences(examId)` — asymmetric reconciliation: read current absentee rows, compute target from `getExamAbsentees(exam, studentProfiles)`, DELETE only rows whose student NOW appears as an attendee (re-upload correction), INSERT new absentees, preserve rows for students who left the cohort but didn't attend (batch moves, deleted profiles) so historical absences aren't silently lost. Returns `{ added, removed, kept }`. Plus `getExamAbsencesForExam`, `getExamAbsencesForStudent(lwsId, sinceDate?)`, `markExamAbsencesNotified(examId, lwsIds)`. |
| `src/pages/Students/MissedExams.jsx` | Renders absences for one student on `StudentView`. Admin/teacher fetch via `getExamAbsencesForStudent(lwsId)`; student portal supplies the rows via `examAbsencesProp` (same prop-bypass as `RecentIncidents`). Joined with `exams[]` for the display name+date+batch. Hidden when empty. Notified badge per row. |
| `src/components/auth/LoginPage.jsx` | Two-tab login (Admin·Teacher / Student); Admin + Teacher share one Supabase auth form, routed by `user_metadata.role`; Student via `/api/student-login` |
| `src/components/upload/UploadModal.jsx` | 4-step add-exam modal |
| `src/lib/excel.js` | Excel parsing (results, tags, student import, attendance import) |
| `src/store/slices/attendanceSlice.js` | `importAttendance(parsed)` — mobile→lwsId matching, upsert to `student_attendance` with L-status protection. Also `markLate(lwsId, date)` / `unmarkLate(lwsId, date)` / `getLateStudentsForDate(date)` for the LateMarkingWidget. |
| `src/store/slices/lectureAbsenceSlice.js` | `setLectureAbsenteesForPeriod(date, slotId, subject, lwsIds)` (replace-set: delete by `(date, slot_id)` then insert) / `getLectureAbsencesForDate(date)` (returns rows including `slot_id`) / `getLectureAbsencesForStudent(lwsId, sinceDate?)`. Tags inserts with `created_by` from the auth session email. |
| `src/lib/timetable.js` | Pure `getTodaysLectures(timetable, date, mappings)` — returns ordered class periods for the resolved weekday. Skips `__span`, breaks, missing mappings; returns `[]` for Sunday or missing timetable. Accepts `Date` or `YYYY-MM-DD`. |
| `src/pages/Attendance/index.jsx` | Admin/teacher page: tab strip (Class metrics / Lecture log), `LateMarkingWidget` at top of Class metrics (admin), consecutive absences alert, paginated Supabase fetch, class avg/at-risk metrics, student table, Import XLS button, send-result Alert. |
| `src/pages/Attendance/LateMarkingWidget.jsx` | Admin-only top-of-Attendance widget. Search + chip list + contextual send button (first-send, `Sent ✓X · Failed ✗Y · Resend`, or `✓ Sent today · Resend all` based on `lateSendHistory[date]`). Each add/remove writes/deletes a `status='L'` row via `markLate`/`unmarkLate`. |
| `src/pages/Attendance/LectureLogTab.jsx` | Date + batch pickers → per-period cards from `getTodaysLectures`. Cards key by `slot.id` (two same-subject periods stay independent). Click "Mark absentees" → `MarkAbsenteesModal` with `{slotId, subject}` context. Send button is contextual (3 states) based on `lectureMissSendHistory[\`${date}\|${batchName}\`]`; passes `(absencesByLwsId, date, batchName)` up to parent. |
| `src/pages/Attendance/MarkAbsenteesModal.jsx` | Searchable multi-select scoped to one (date, slot). Search filters visible list but does NOT drop previously-checked students from the saved set. Save calls parent's `onSave(lwsIds)`. |
| `src/pages/Attendance/LateNotificationPreviewModal.jsx` | Pre-send modal for late notifications: editable mobile + parent_mobiles per student, redirect-to test field, Confirm/Cancel. Accepts `failedNames` prop — when non-null shows an amber "Resend to: Failed & skipped only (N) / All students (M)" scope toggle (default = failed-only) and filters both visible rows and wire payload by scope. Calls `bulkUpdateStudentContacts(edits)` before send so edits persist back to the student profile. |
| `src/pages/Attendance/LectureMissPreviewModal.jsx` | Pre-send modal for lecture-miss: same shape as LateNotification (incl. `failedNames` prop + amber scope toggle banner + `bulkUpdateStudentContacts` persistence). Each row shows the comma-joined subjects-missed list with times (ASCII, no parens — see Wabridge rules above). Subjects forwarded to the endpoint as `subjects[{subject, startTime?, endTime?}]`. |
| `src/pages/Attendance/consecutiveAbsent.js` | Pure fn `buildConsecutiveAbsent(records, lwsIdToName, n)` — walks the global non-Sunday date sequence backwards from the latest known date, counting each student's consecutive `A` streak until the first `P` / `L` / missing record. Flags when streak ≥ n; `since` = earliest `A` in the actual streak (may go back further than n). |
| `src/pages/Attendance/AttendanceRings.jsx` | SVG donut rings per calendar month (R=40, stroke-dasharray arc); sorted latest-first; rendered inside `StudentView` (below exam data), visible in all three portals. Below each ring, up to three conditional chips: `Days late: N` (yellow), `Missed Lectures: N` (red), `Missed Exams: N` (dark red) — each clickable to expand an inline list (latest first). Single-open across the whole component (`expanded: { month, kind } \| null`). Accepts `attendance`, `lectureAbsences`, `examAbsences`, `exams` props. Exam-absence rows are joined with `exams[]` for name/date (admin/teacher path), with fallback to row-level `exam_name`/`exam_date` (student portal path post-enrichment). **Chip palette is light-mode-tuned** (`bg-*-50/100`, `text-warning/danger/red-900`) — earlier dark-mode tints (`bg-*-400/10`, `text-*-300`) were unreadable on the app's white/pale surface. |
| `src/pages/Students/RecentIncidents.jsx` | Last 30 days of L markers (from `attendance` prop) + lecture absences + exam absences (fetched for admin/teacher via slice; supplied via `lectureAbsencesProp` / `examAbsencesProp` for the student portal — same prop-bypass pattern as `attendanceProp` in StudentView). Three chip styles, all light-mode-tuned (`bg-yellow-50/red-50/red-100`, `text-warning/danger/red-900`). Hidden when zero incidents. |
| `src/lib/analytics.js` | Analytics facade |
| `src/lib/ndaFreq.js` | `SUBJECTS`, `CONFIGURABLE_SUBJECTS`, `syncFreqChapters` |
| `src/lib/examPdf.js` | `downloadExamPdf(exam)` — jsPDF exam report; `stripLatex()` converts LaTeX → ASCII for WinAnsi-safe rendering |
| `src/lib/studentReportPdf.js` | `downloadStudentReportsPdf(exam)` — per-student A4 PDF |
| `src/lib/validateTags.js` | Tags + GAT subject validation |
| `src/lib/syllabusSeed.js` | Seed programs (generated by `generate_syllabus_seed.py`) |
| `src/lib/persistence.js` | `exportDB`, `importDB`, `migrateMarks` |
| `src/lib/mergeStudents.js` | Re-export barrel for `src/lib/merge/` (dedup, record merge, roll enrichment) |
| `src/lib/merge/deduplication.js` | `findDuplicateCandidates`, `getUnmatchedExamNames`, `findExamNameCandidates` |
| `src/lib/merge/recordMerge.js` | `mergeStudentRecords` — merges two profile records, primary wins on conflicts |
| `src/lib/students/loadExistingStudents.js` | Dual-path loader returning the existing snake_case students array: Supabase tables when admin session active, `/api/students-db` fetch otherwise, `[]` on any failure. Used by `useImportFlow` (pre-merge baseline) and `studentSlice.refreshStudents` (post-merge re-read). |
| `src/store/slices/studentSlice.js` | `importStudentsDB`, `addNameVariant`, `mergeStudentProfiles`, `deleteStudent`, `bulkUpdateStudentContacts`, branch/batch/mobile updates |
| `src/pages/Students/StudentsTable.jsx` | Filterable + paginated student table (Name / LWS ID / Branch / Batches / Mobile / Status / Exams / Last activity). PAGE_SIZE=25. Click name → replaces the table with `StudentView` (Back-to-list button restores). |
| `src/pages/Students/StudentRowEditor.jsx` | Inline expand-in-place editor for branch + batches per row (admin only). Save calls `updateStudentBranchBatch`; Delete calls `deleteStudent` after `window.confirm`. |
| `src/pages/Students/ManageBatchBranchModal.jsx` | Bulk Assign + Find Duplicates tabs (Rename tab removed 2026-05-21 — Settings owns rename CRUD) |
| `src/pages/Students/batchBranch/FindDuplicatesTab.jsx` | Combined profile–profile + exam-name scan; merge and link-as-variant actions |
| `src/pages/Syllabus/` | SyllabusPage, SubjectAccordion, Manage*Modal, AssignProgramsModal |
| `split_students.py` | Pre-deploy: per-student files + encrypted db.json |
| `send_results_whatsapp.py` | Wabridge WhatsApp result messages to students + parents. `--exam` / `--dry-run` / `--to` / `--redirect-to` / `--students "Name1,Name2"`. Payload: top-level `variables` array. Logs to `whatsapp_send_log.jsonl` (capped 500 entries). Triggered via `POST /api/send-whatsapp` in `vite.config.js`. |
| `send_schedule.py` | Gmail SMTP teacher schedule + exam reminder emails. `--weekly` / `--daily` / `--exam-reminder N` / `--dry-run` / `--to` / `--teacher-id`. Requires `tzdata`. |
| `generate_syllabus_seed.py` | Excel → `src/lib/syllabusSeed.js` |
| `merge_subtopics.py` | One-time subtopic rename script: 28-entry `SUBTOPIC_RENAMES` map + `apply_renames(exams, map)` — updates `data/faculty-data.json`; run `merge:subtopics:sync` after to push to Supabase |
| `migrate_subtopics_supabase.js` | Patches `exams.questions` JSONB in Supabase with the same 28-entry rename map (needs `SUPABASE_SERVICE_ROLE_KEY`); idempotent |
| `migrate_unify_batches.js` | One-off (applied 2026-05-20): unifies `syllabusBatches[]` and `timetables[].batchName` to a 10-name `_A`/`_B` scheme; pre-creates B sections and `APJ_9th_Std`. **Idempotent — but the central list has been actively reshaped via Settings → Batches since.** Re-running would re-create the `_B` sections and `APJ_9th_Std` and rename current values back toward the 10-name scheme. Retained for archaeology; verify current Supabase state before considering a re-run. |
| `tests/test_subtopic_merge.py` | 39 pytest tests for `merge_subtopics.py` rename logic |
| `data/faculty-data.json` | Primary dev data store (gitignored) |
| `students_db.json` | Student roster with mobiles (gitignored) |

---

## Tests

Setup: `src/test/setup.js`. `ModeContext` defaults to `'admin'` — no Provider needed in tests.
Test files mirror source paths under `__tests__/`. Python tests under `tests/`. **1133 Vitest tests passing** (2026-05-25). **39 Python tests** in `tests/test_subtopic_merge.py`. For test-infrastructure detail (mock patterns, growth log, chainable Supabase builder) see memory `project_testing.md`.
Key coverage: analytics filters, GAT routing, tag validation, dashboard filters, Exams/Students/StudentView pages, re-upload modals, mergeStudents (incl. dedup signals, exam-name candidates, `addNameVariant`), split script, send_schedule (44 tests), timetableSlice (46 tests — incl. `updateTimetable` footnotes + title round-trip), configSlice (36 tests), studentSlice (6 tests), insightsSlice + insightsSupabase (21 tests covering save/clear dual-path + table helpers), persist.js (Supabase load/save/pagination), useStore loadExamsFromSupabase action, Exams pagination (11 tests), attendance parse (8 tests), attendanceSlice (20 tests covering import + L-protection + markLate/unmarkLate/getLateStudentsForDate), AttendanceRings (12 tests including the clickable Days-late badge), student-login login tracking + lecture-absences (2+ tests), consecutiveAbsent (18 tests — incl. 4 covering streak > N), migrate_insights (11 tests), subtopic rename (39 Python tests), `getTodaysLectures` pure helper (12 tests), `lectureAbsenceSlice` (15 tests, slot_id signature), `TimetableGrid` (6 tests — label-on-line-1 / teacher-on-line-2 / break cells / missing-teachers fallback), `LateMarkingWidget` (12 tests covering 3 button states), `MarkAbsenteesModal` (9 tests), `LectureLogTab` (13 tests including two-same-subject-slots regression), `LateNotificationPreviewModal` (12 tests covering resend-failed scope toggle + `bulkUpdateStudentContacts` persistence), `LectureMissPreviewModal` (6 tests, time-formatted subjects), `RecentIncidents` (6 tests), `parseFailedNames` (8 tests), `send-late-notifications` endpoint (8 tests), `send-lecture-absences` endpoint (8 tests).

**Mock completeness rules** (omitting these causes silent "0 tests" or TypeError at setup):
- Mock stores for pages using batch filtering must include `studentProfiles: {}`.
- `vi.mock('../../../lib/ndaFreq', ...)` must include `NDA_FREQ_BY_SUBJECT: {}` — `validateTags.js` imports it directly.
- `WrongAnswerAudit` + `UnattemptedAudit` + `ExamHistoryTable` all use `PAGE_SIZE = 5`.
- `syllabusSlice.test.js` mock state must include `syllabusBatchBranches: {}` and `batchChapterTimelines: {}` — `deleteSyllabusBatch` and `renameSyllabusBatch` destructure both.
- Async slice actions that call `fetch` (e.g. `addNameVariant`) must use `vi.stubGlobal('fetch', vi.fn(...))` with a `beforeEach(() => vi.restoreAllMocks())` guard — see `src/store/slices/__tests__/studentSlice.test.js`.
- `Exams.test.jsx` mock store must include `whatsappSendHistory: {}`, `bulkUpdateStudentContacts: vi.fn()`, and `setWhatsappSendHistory: vi.fn()` — all three are now read from the store at component mount.
- Exams pagination tests use `data-testid="exam-card"` (not `role="heading"`) — exam names render in `<div>`, not `<h3>`; `Card` spreads `...props` so the attribute passes through.
- `api/__tests__/student-login.test.js` uses `@vitest-environment node` docblock (Node.js APIs: `fs`, `process.env`) and mocks `@supabase/supabase-js` with `createClient: vi.fn()` configured per-test via `makeMockClient()`.
- `attendanceSlice.test.js` and `lectureAbsenceSlice.test.js` use a chainable query-builder mock pattern: `{ select, eq, in, gte, order, delete, upsert, then }` where each chainable method returns the builder and `then` makes the builder thenable to `{ data, error }`. Required because Supabase's PostgrestFilterBuilder is thenable but is queried via fluent chains; tests need to assert call args (`builder.select`, `builder.eq`, etc.) AND `await` the chain.

## Lint

`npm run lint` — `eslint.config.js` (flat config). Current state (2026-05-25, post Timetable label+title+footnotes): **140 errors, 13 warnings**. Breakdown:
- **122** `'process' is not defined` — Node-only scripts (`api/*` endpoints + their tests, `migrate_*.js`, `sync_*.js`, `create_teacher_account.js`). Environment-level, not code issues.
- **8** `'global' is not defined` — test files using `global.fetch`. Pre-existing.
- **6** `Calling setState synchronously within an effect` — intentional in `App.jsx` (session-check gate), `pages/Students/StudentView.jsx` (auto-select + attendance fetch), and a handful of admin pages. Use `// eslint-disable-next-line react-hooks/set-state-in-effect` on individual lines as needed; new components in `pages/Attendance/Late*`, `LectureLogTab`, `MarkAbsenteesModal`, `pages/Students/RecentIncidents` already have these disables on the lines that fire `setState` from an effect.
- **3** `no-unused-vars` — `sourceResults`, `allNamesLower`, plus one `y` in a destructure. Genuine dead variables; clean up next time touching those files.
- **1** Fast-refresh warning on a co-located export — pre-existing.
- **13** warnings — all `react-hooks/exhaustive-deps`. Intentional (auto-select / sync-with-external patterns).

**Config structure:**
- Browser globals + React/react-hooks/react-refresh plugins for all source files.
- Extra `globals.node` block for `vite.config.js` (uses `process`, `__dirname`).
- Extra Vitest globals block for `**/__tests__/**` and `**/*.test.*` files (`describe`, `it`, `expect`, `vi`, etc.).
- `no-unused-vars`: `varsIgnorePattern: '^[A-Z_]'`, `argsIgnorePattern: '^_'`, `caughtErrorsIgnorePattern: '^_'` — prefix unused args/catches with `_` to suppress.
- `react-hooks/preserve-manual-memoization` disabled globally (React Compiler rule, not applicable here).

**Intentional `eslint-disable` comments in source:**
- `SyllabusPage.jsx`, `ExamScheduleView.jsx`, `LoginPage.jsx`: `react-hooks/set-state-in-effect` — auto-select first item when the list changes, or reset state on flag change; the pattern is deliberate.
- `LoginPage.jsx` and `StudentLogin.jsx`: `react-refresh/only-export-components` — session-clear helpers are co-located with the component that owns the session; splitting would be artificial.
- `App.jsx` and `pages/Students/StudentView.jsx` have `setState synchronously within an effect` errors that are NOT yet suppressed with `eslint-disable` comments — the pattern is intentional but the disables haven't been added. Add `// eslint-disable-next-line react-hooks/set-state-in-effect` if you touch those lines.

---

## Deployment

### GitHub Pages (legacy static build)
`npm run deploy` — `vite build --base=/nda-tracker/` → push to `gh-pages`. Split script no longer runs automatically. The GH Pages site still loads the app but student/teacher login won't work (no serverless functions on static hosting) — users should be directed to `nda-tracker.vercel.app`.

`BASE_URL` is derived from `import.meta.env.BASE_URL` in `src/config.js` — no hardcoded `REPO_NAME`.

### Vercel (online admin portal)
- Repo is connected to Vercel; every push to `main` triggers a production deploy.
- Required env vars in Vercel: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- Supabase project: `exjnzrrlzcrsoxfoojcq`. Auth user: `official.lwspune@gmail.com`.
- To re-seed data after local changes: `SUPABASE_SERVICE_ROLE_KEY=<key> node migrate_to_supabase.js`.

---

## Decisions log

Moved to [`DECISIONS.md`](./DECISIONS.md) — the long-form *why* trail for non-obvious architectural choices. Use it when an entry below in "What not to change" references "see decisions log" or when a code change would contradict an established trade-off. New decisions go at the end of that file.

---

## What not to change

Guardrails — invariants the codebase depends on. Each bullet is something that broke something else when changed, OR something that prevents a class of bugs from re-appearing. For the *why* behind any of these, look up the matching entry in [`DECISIONS.md`](./DECISIONS.md).

- Do not persist `apiKey` anywhere — memory only.
- Subject filter state is local per page — do not lift to Zustand.
- `StudentView` subject filtering is self-contained — no prop threading.
- Use `useMode()` for visibility — no new `IS_READ_ONLY` imports in components.
- `ModeContext` default is `'admin'` — changing it breaks tests.
- All hooks must be called **before** any early returns in page components.
- Do not filter batch dropdowns or exam lists on `exam.batch` directly — always use `getBatchOptions` / `getExamsForBatch` from `src/lib/analytics`.
- Syllabus Tracker batch names are independent of **student-profile** batch names (`profile.batches[]`) — do not derive them from `studentProfiles`. As of 2026-05-20 syllabus batch names match `timetables[].batchName` 1:1 (unified scheme). Use the unified `renameBatch(old, new)` / `deleteBatch(name)` actions on the configSlice when an admin renames or deletes a batch — they delegate to both `renameSyllabusBatch` + `renameTimetableBatch` (and respectively `deleteSyllabusBatch` + the timetable/exam-schedule guard) so the two stores can't drift. The side-specific actions (`renameSyllabusBatch`, `renameTimetableBatch`, `deleteSyllabusBatch`) are still exposed and still used internally by the unified actions and by code that legitimately needs to touch one side (e.g. `migrate_unify_batches.js`); UI code should always go through the unified action.
- Syllabus branch filter branches are sourced from `timetables[].branch` — do not create a separate branch list for the Syllabus Tracker. `syllabusBatchBranches` cascades on batch rename/delete.
- To rename a timetable's `batchName`, use `renameTimetableBatch(oldName, newName)` — it cascades to `examSchedules[].batchName`. Do not use `updateTimetable(id, { batchName })` for renames; that's a bare patch that leaves exam schedules pointing at a stale name.
- `updateTimetableTeacher(id, patch)` takes `{ name?, email? }` — do not pass a bare string (breaking change from original signature).
- Exam Schedule `branch`/`batchName` must come from `timetables[]` entries — do not derive from `syllabusBatches` or `exams[].batch`.
- `guardian_mobile` from Excel merges (appends if absent) into `parent_mobiles[]` — do not change to overwrite semantics; manually-added parent numbers must survive re-import.
- Touch targets must be ≥ 44px on all mobile-facing screens (`min-h-[44px]` or equivalent padding). Use `py-2.5`+ for buttons, `py-3`+ for nav items.
- `findDuplicateCandidates` with no `branchFilter` does a flat cross-branch scan — do not revert to per-branch-group iteration.
- The `name_subset` signal requires `shorter.length >= 2` — do not remove this guard (prevents false positives on shared single-word surnames).
- `name_token_edit` requires `min(unique-token length) >= 5` (`TOKEN_EDIT_MIN_LEN`) — do not lower without expecting Anil/Sunil/Amit-class false positives. Levenshtein cap is 2 (`TOKEN_EDIT_MAX_DIST`). Order-independent — both `"Neel Vardhamane" / "Neel Wardhamane"` and the reverse fire the same way. Patil/Patel surfacing as a candidate is INTENTIONAL (documented trade-off) — never auto-link; faculty Skips. Don't add per-name carve-outs for known distinct surnames.
- `name_token_prefix` requires `singleToken.length >= 4` (`TOKEN_PREFIX_MIN_LEN`) and `profileTokens.length >= 2`. The first guard protects 3-letter `Anu/Raj/Om` from matching every Anu* profile; the second prevents the rule from firing on `"Rajivkumar"` vs `"Rajivkumar"` (true duplicates handled upstream by `getUnmatchedExamNames`).
- `name_initial_match` requires both sides ≥ 2 tokens, longer side ≥ 3 tokens (real first+last anchor — prevents `V. Sharma` ↔ `Vijay Sharma` siblings-class noise), exactly one unique token per side, one unique matches `/^[a-z]\.?$/`, and the other unique starts with that initial. Order-independent (initial may be on either side). Closes the middle-initial gap where `name_subset` rejects on token inequality (`v.` ≠ `vijay`), `name_token_edit` rejects on the 5-char floor (`"v."` is 2 chars), and Jaccard falls below 0.75 due to punctuation bigrams. Surfaces `Anant V. Sharma` ↔ `Anant Vinay Sharma` too — that's the ambiguous case faculty should review; do NOT add per-letter carve-outs.
- `addNameVariant` deduplicates before appending — do not change to unconditional push.
- `addNameVariant` (Supabase path only) calls `cleanStaleAbsencesForVariant(supabase, lwsId, variantName)` after the variant is persisted but before `refreshStudents`. This sweeps `exam_absences` rows for the student where `exam_results` already has the just-linked variant as an attendee — pre-link audit rows that are now factually wrong (the student attended under a spelling the system didn't yet recognise). Do NOT remove — without it, every Find-Duplicates → Link-as-variant action leaves a stale "Missed exam" chip on the student's RecentIncidents + MissedExams surfaces.
- Search list shows only canonical names — do not add variant names (keys where key ≠ `profile.name`) back into the search list; they would create duplicate entries for the same student.
- `StudentView` normalizes exam records in-memory via `normalizedExams` — do not remove this or revert `getStudentExams` to using raw `exams`; doing so breaks analytics for students whose exam records are stored under a variant spelling.
- Timetable Excel export uses `xlsx-js-style` — do not change the import back to `xlsx`.
- `batchChapterTimelines` cascades on `deleteProgram`, `deleteSubject`, `deleteChapter`, `renameSyllabusBatch`, `deleteSyllabusBatch` — do not remove these cascade blocks.
- `clearSubjectProgress` intentionally does NOT clear `batchChapterTimelines` — the planned chapter schedule must survive a status reset.
- The "Timeline" column in `SubjectAccordion` is a fixed column (not a user-defined tracking column). If a user has a tracking column also named "Timeline", they will see two Timeline columns — the old one should be deleted from the program's tracking columns.
- `stripLatex` in `examPdf.js` must only output ASCII + safe Latin-1 (`×÷±·`). Do not re-introduce Unicode math symbols (Greek, set ops, arrows, `≤≥≠`, `∈∪∩`, `ℝ`) — all fall outside jsPDF Helvetica's WinAnsi encoding and render as garbage.
- `saveToSupabase` must gate on `supabase.auth.getSession()` before writing — do not remove this check. Teacher and student visits must never overwrite admin data.
- Do not use `.catch()` on Supabase query builder chains — `PostgrestFilterBuilder` is a thenable, not a full Promise; `.catch` is `undefined` and throws silently. Always use `async/await` with `{ error }` destructuring inside the `.then()` callback.
- `studentSlice.js` mutations must check `getSession()` before choosing Supabase vs fetch path — do not remove this dual-path logic. Dev mode depends on the fetch path; Vercel depends on the Supabase path.
- `loadStudentsFromSupabase()` must be called after `faculty_state` loads in `initStore()` — it overwrites the stale `studentProfiles` baked into `faculty_state` with fresh data from the normalised tables. Do not remove this call.
- `loadInsightsFromSupabase()` must be called in `initStore()` after `faculty_state` loads (admin path only) — same reason as `loadStudentsFromSupabase`: it overwrites the stale `savedInsights` baked into the JSONB blob with fresh data from `class_reports` / `student_plans`. Do not remove this call.
- `saveToSupabase` strips both `exams` AND `savedInsights` from the JSONB blob before writing — do not remove either field from the destructure. Re-introducing them would double-write the data and let the JSONB drift out of sync with the normalised tables on admin mutations.
- `insightsSlice.js` mutations are append-only — `saveClassReport` / `saveStudentPlan` insert new rows each time, never update in place. Do not change to upsert; history would be lost.
- `class_reports` and `student_plans` are read by `loadInsightsFromSupabase()` which collapses to "latest per scope" — preserves the legacy `{ classReport, studentPlans }` store shape. Do not change the in-store shape; the Insights page depends on it.
- `loadExamsFromSupabase()` is called in `initStore()` (admin) and in `TeacherPortal` mount (teacher) — both paths must await it; removing it leaves the store with stale JSONB data (or no data).
- `fetchAllRows` pagination in `persist.js` is required for all Supabase tables that can exceed 1000 rows (`exam_results` already at 1472+). Do not replace with a bare `.select('*')` — it silently truncates.
- `migrate_exams_to_supabase.js --cleanup` only prints the cleanup SQL; it does not execute it. Run the SQL manually in Supabase SQL editor only after confirming exam counts match and the live app shows correct data. Never run cleanup before seeding.
- `students_db.exams[]` must not be seeded into Supabase — confirmed dead data (no code path reads it). The normalised schema deliberately omits it.
- `student_batches` PK is `(lws_id, batch_name)` — to rename a batch, you must DELETE old rows and INSERT new ones; you cannot UPDATE the PK in place.
- `student_attendance` UNIQUE constraint is `(lws_id, date)` — batch column was dropped (2026-05-07); upsert conflict target is `lws_id,date`.
- Vercel env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` must be set in the Vercel dashboard; they are not in the repo. `src/lib/supabase.js` returns `null` when they are absent (safe no-op on dev/GH Pages).
- Attendance data is not stored in Zustand — always fetched from Supabase on demand. Do not add it to the store or persist it to `faculty-data.json`.
- `attendanceSlice.importAttendance` matches students by mobile first, then by name — do not change to name-only matching; mobile is more reliable when names vary across XLS files.
- `AttendanceRings` uses `relative` + `absolute inset-0` overlay for the % label — do not revert to the `marginTop` hack; it places text outside the ring bounds on light backgrounds.
- `student_logins` insert uses `.then(() => {})` — do not add `await`; it must remain fire-and-forget so login latency is unaffected.
- `AttendanceRings` renders months latest-first (`b.localeCompare(a)`) — do not revert to ascending sort.
- `buildConsecutiveAbsent` measures against the **global** non-Sunday date sequence (all students share the same reference dates — do not switch to per-student date filtering) AND reports the TRUE streak length by walking backwards from the latest known date until the first `P` / `L` / missing record. `since` is the earliest `A` in the actual streak, NOT `earliest-of-last-N`. Do not revert to "check only last N dates" — a student absent for 10 consecutive days must show `since 10 days ago`, not `since N days ago`.
- `StudentView`'s `attendance: attendanceProp = null` prop bypasses the Supabase fetch when provided — required for the student portal because students have no Supabase auth session (RLS blocks unauthenticated reads). Removing the prop bypass breaks attendance rings in the student portal.
- Attendance page has no batch filter by design — consecutive absence detection is class-wide.
- `FindDuplicatesTab` must scan `studentList` (raw Supabase array), not `Object.values(studentProfiles)`. The map collapses identical canonical names; the scan needs to see both entries to flag them.
- `StudentView`'s `!examData.length` early return must render the subject selector + ProfileCard. Removing the selector strands GAT-only students on the default Maths filter with no escape.
- `importStudentsDB` must call `set({ studentProfiles, studentList: students })` together — the two are kept in sync and both are required (profiles for lookups, list for duplicate scanning).
- Do not use `import.meta.env.DEV` anywhere in `src/`. Vercel's Vite 8.0.3 substitutes it with `true` in prod builds (confirmed 2026-05-20). Use `IS_READ_ONLY` from `src/config.js` (or `IS_DEV = !IS_READ_ONLY` in `persist.js`) for any dev-vs-prod branching. Other `import.meta.env.*` (`BASE_URL`, `VITE_SUPABASE_URL`) appear unaffected.
- Do not remove the `stream` → `src/stubs/empty.js` alias in `vite.config.js`. xlsx's optional stream-probe will crash the bundle at startup without it. If xlsx ever drops the probe (or moves it behind a feature flag), the alias can go — verify by rebuilding and checking that `(va = HM())` no longer appears near `.Readable` in the minified output.
- `useImportFlow.handleStudentFile` must call `loadExistingStudents()` (not a bare `fetch('/api/students-db')`) before `mergeStudents`. The bare fetch 404s on Vercel and causes silent duplicate creation. Same rule for any future code that needs the snake_case students baseline — go through the helper so the Supabase path is taken when an admin session exists.
- `mergeStudents` returns `conflicts: []` always (even when empty). Do not remove this field or change to `null` — `ImportStudentsModal.jsx` reads `mergeResult.conflicts?.length` and the test `mergeStudents — return shape > always includes conflicts in the result` asserts on it.
- Tiered match's "exactly one hit" rule in steps 2 and 3 is a hard requirement — do not change to "first hit wins". Ambiguous matches must surface in `conflicts[]` so admin resolves manually; auto-picking risks attaching exam/attendance/fee history to the wrong student.
- Step 3 (name+branch) requires a non-empty branch on BOTH sides — do not relax to name-only matching. Two students named "Rohan Patil" with no branch would otherwise auto-merge incorrectly.
- Tiered match still skips inserting when EIS is blank AND no match is found via steps 2/3 — do not change to insert-on-blank-EIS. Creating EIS-less rows leaves future re-imports unable to match the student and breaks the canonical identifier contract.
- `mergeStudents(_, _, { defaultBranch })` is "fill blanks only" — applies to new inserts and existing students whose branch is empty. Never overwrites a non-empty branch. Do not flip this to "overwrite all" without adding an explicit confirm step in the UI; a wrong dropdown pick would clobber correctly-aligned data.
- The Students page renders either the table OR the StudentView — never both. Do not revert to the stacked "Pattern X" layout without explicit user request; it was deliberately removed 2026-05-20.
- `deleteStudent` must always go through a `window.confirm` (or stricter) at the UI layer. Do not bypass — the action is irreversible at the attendance/login level. The confirm message must name the student and mention what data is lost.
- `deleteStudent` clears `activeStudent` if (and only if) it matched the deleted student's name. Do not unconditionally clear; switching to another student before deleting should not jump back to the table.
- The privileged role is `'admin'`, not `'faculty'`. Do not reintroduce `mode === 'faculty'` or `<ModeContext.Provider value="faculty">` — use `'admin'`. The Supabase table name `faculty_state` and the dev file `data/faculty-data.json` are deliberately retained (internal storage, no UI). The user-facing copy "LWS Pune faculty" in the login footer and message templates is also retained — it refers to the real-world teaching staff.
- The login page has exactly two tabs (Student / Admin · Teacher). Do not split the staff tab back into separate Admin and Teacher tabs — they share a single Supabase auth form, and the role is decided server-side from `user_metadata.role`.
- `branches[]` is owned by `configSlice` and seeded by `seedBranches(saved)` on first load (union of `timetables[].branch` ∪ `Object.values(syllabusBatchBranches)`). Do not derive a branch list inline in components going forward — read `useStore(s => s.branches)`. Existing inline `[...new Set(timetables.map(t => t.branch))]` patterns in `Dashboard`, `Exams`, `Toppers`, `AddExamScheduleModal`, `ExamScheduleView`, `TimetablePage` were left in place because they're cosmetic-only (filter dropdowns); migrate them opportunistically, but do not introduce new inline derivations. `SyllabusPage` was already migrated to `useStore(s => s.branches)`.
- `renameBranch` (configSlice) cascades to `timetables[].branch`, `examSchedules[].branch`, and `syllabusBatchBranches` values. It does NOT touch `students.branch` or `exams.branch` — those were aligned to the central namespace via one-off SQL on 2026-05-21 (see decisions log). The Evalbee XLS does not carry per-student branch info (no `Branch` column in the documented format), so `mergeStudents` won't undo the alignment on re-import. If branch values ever drift again, run the same SQL pattern — there is no UI surface for this rename.
- `renameBatch` (configSlice) cascades to **seven JSONB paths** (`syllabusBatches[]`, `syllabusBatchBranches`, `batchProgramAssignments`, `batchSyllabusProgress`, `batchChapterTimelines`, `timetables[].batchName`, `examSchedules[].batchName`) AND fires a Supabase cascade for `student_batches.batch_name` + `exams.batch` via `cascadeBatchRenameToSupabase`. The Supabase cascade is fire-and-forget (`.catch(console.error)`) — caller doesn't await. Guards skip both the JSONB rename AND the Supabase cascade when oldName/newName are empty, equal, or `newName` already exists in either local list — without the guard, a rejected JSONB rename would still merge rows in Supabase. Do NOT add other code paths that mutate `syllabusBatches[]` or `timetables[].batchName` directly — they would bypass the Supabase cascade and re-introduce drift.
- `deleteBranch` / `deleteBatch` return `{ ok, usage }` — they refuse to delete when references exist and surface the usage breakdown. UI callers must check `result.ok` and show the blocking detail; do not assume success.
- `addBatch(name, branch)` REQUIRES both parameters and a branch that exists in `branches[]`. Returns `{ ok: true, name }` or `{ ok: false, reason: 'name_required' | 'branch_required' | 'unknown_branch' | 'duplicate_name' }`. UI must check `result.ok` and surface the reason. Do not call `addSyllabusBatch(name)` directly from UI — the internal action stays for migration scripts and slice-internal use only (it does not enforce the branch invariant).
- Settings page is the SOLE CRUD surface for branches, batches, and teachers. Do not add new "Manage X" buttons or modals on other pages that mutate these lists. Selection (picker dropdowns referencing existing entries) is fine; CRUD (add/rename/delete) is not. The `ManageTeachersModal.jsx` file was deleted 2026-05-20 — do not re-introduce it.
- `AddTimetableModal` is select-only — branch dropdown from `branches[]`, batch dropdown from `syllabusBatches[]` filtered by `syllabusBatchBranches[batch] === selectedBranch`. Do not add a free-text fallback for either field; the modal must not be able to create new branches or batches that the central lists don't know about.
- `SyllabusPage` batch tab bar is view-only. Do not re-introduce inline "+ Add batch", rename input, or the ⋯ menu (Rename / Set branch / Delete). The page still owns program assignments and chapter status — those are batch contents, not identity.
- `mergeStudents` discards the XLS `Batch` column — existing students' `batches[]` is never modified by import; new students arrive with `batches: []`. Do not re-introduce batch-merging on import; it would undo the manual alignment sweep on every HR re-import.
- The central batch list follows `BRANCH_NDA_DURATION_(YY-YY)[_SECTION]` convention (no spaces, underscores throughout). Verify the current set against Supabase before adding to it — Settings → Batches is the only UI path; direct SQL is the migration path.
- `StudentsTable`'s Aligned column / filter are gated on `centralBatches.length > 0`. Do not refactor to read from `useStore` directly — the prop-based gate keeps the table testable without store mocks.
- `StudentRowEditor`'s `batchBranches` prop filters the add-batch dropdown by the row's draft branch. When `batchBranches` is `null` (legacy tests), all batches show. Keep this fallback — removing it would break the existing test suite.
- `lecture_absences.lws_id` `ON DELETE CASCADE` — student deletion drops their lecture-absence history. Do not change to SET NULL without first adding a `student_name` column (see `student_plans` for the precedent).
- `student_attendance.status` values are `P` / `A` / `-` / `L`. Do not add new status codes without auditing every consumer: `buildStudentStats`, `buildConsecutiveAbsent` (only counts A), `AttendanceRings` (only counts P), the import L-protection filter, and `RecentIncidents` (filters L only). New codes silently get ignored by all of these.
- `importAttendance` MUST preserve existing L rows on re-import. The L-protection block (query existing L for the imported (lws_id, date) pairs, filter them out of the upsert) is non-negotiable — without it, the morning late-marking is destroyed when the LWS XLS imports at end of day. The return value's `lateProtected` count surfaces the preserved rows in the success banner.
- `setLectureAbsenteesForPeriod` uses delete-then-insert (replace-set semantics). Do not change to upsert — the UI's "Save" action implies "the absentees for this period are now exactly these N students", which includes clearing prior absences not in the new set. Upsert wouldn't remove rows; the UI would silently retain stale absences.
- `getTodaysLectures(timetable, date, mappings)` is the only source of truth for "which subjects appear on the Lecture log cards". Do not parallel-import a hardcoded subject list. If you need to filter subjects (e.g. exclude GAT), filter the result of `getTodaysLectures`, not the timetable upstream.
- `getTodaysLectures` ISO-string parsing splits `YYYY-MM-DD` and constructs a local `new Date(year, month-1, day)` so `getDay()` returns the local weekday. Do not switch to `new Date(isoString)` — that parses as UTC midnight, which shifts the weekday in IST (and any timezone east of UTC).
- Lecture log batch dropdown sources from `timetables[].batchName`, not `syllabusBatches` or `studentProfiles[].batches`. Faculty needs the same batch identifier the timetable uses (so `getTodaysLectures` resolves to the right grid). Different students may be in the same syllabus batch but a different timetable batch; only the timetable list is authoritative for "which periods today".
- `LateMarkingWidget`'s search filters out students already in the late list (`!lateSet.has(p.lwsId)`). Do not remove this filter — without it, the "add" button would no-op for already-marked students (since `markLate` upserts to the same row) and chip rendering would duplicate.
- `MarkAbsenteesModal` search filters the visible list but the **draft `checked` Set spans all students**, not just visible ones. Do not change `Save` to derive checked from visible rows — that would silently drop students who were checked, then filtered out of view.
- `RecentIncidents`'s `lectureAbsencesProp` prop-bypass pattern is required for the student portal (no Supabase session → RLS blocks the fetch). When `lectureAbsencesProp !== null`, the slice fetch is skipped entirely. Same contract as `attendanceProp` on `StudentView`. Removing the bypass breaks the student portal silently.
- `api/send-late-notifications.js` and `api/send-lecture-absences.js` require a Bearer JWT in the `Authorization` header and verify it via `supabase.auth.getUser(jwt)`. Do not relax to anonymous — the endpoints fire WhatsApp messages and any caller could spam parents otherwise.
- Both send endpoints fail with 500 + a descriptive `error` field when their template ID env var (`WABRIDGE_LATE_TEMPLATE_ID` / `WABRIDGE_LECTURE_MISS_TEMPLATE_ID`) is missing. Do not silently no-op or fall back to a default template — the user must see the misconfiguration.
- `vite.config.js` dev shim for the two new send endpoints dynamically imports the same JS handler used in prod (no Python equivalent). Do not split into a Python script — the prod handler is self-contained (no DB lookup for contacts), so a single code path serves both environments.
- `api/student-login.js` returns `lectureAbsences[]` (last 30 days) alongside `attendance[]`. Keep the 30-day window in sync with the `isoDaysAgo(30)` constant in `RecentIncidents` — if you change one, change the other.
- `lecture_absences` UNIQUE is `(lws_id, date, slot_id)` (since 2026-05-21). Do NOT revert to `(lws_id, date, subject)` — same-day same-subject periods would collapse again. `slot_id` is `timetables[].timeSlots[].id` (globally unique via `uid('slot')` in `timetableSlice`). `subject` stays on the row for message-body display only.
- `setLectureAbsenteesForPeriod` signature is `(date, slotId, subject, lwsIds)`. Do not drop `slotId` — the delete step is keyed by `(date, slot_id)`. If a future call site doesn't have a slot context, that's a sign the call doesn't belong here.
- Wabridge template variables (`api/send-late-notifications.js` and `api/send-lecture-absences.js`) MUST be ASCII-only, with no en-dash/em-dash, no parens-around-colons time patterns, and no newlines/tabs. Meta drops messages silently when any of these appear. The `LectureMissPreviewModal`'s display formatter uses the same rules so the preview matches the wire. Approved template bodies must use positional `{{1}}/{{2}}/{{N}}` placeholders — `{{name}}` and friends do not substitute.
- `lateSendHistory` store key is keyed by `YYYY-MM-DD`. `lectureMissSendHistory` uses the compound key `${date}|${batchName}` — do NOT collapse to date-only, you'd lose per-batch granularity on multi-batch-per-day workflows. Both persisted in `faculty_state` JSONB; `saveToSupabase` does NOT strip them (small admin state, same convention as `whatsappSendHistory`). `parseFailedNames` regex in `src/pages/Attendance/index.jsx` depends on the endpoint's stable log-line format (`FAIL → Name (student|parent)` / `SKIP Name —|parent`) — if you change either log format, update the parser.
- `downloadTimetableExcel` in `TimetablePage.jsx` uses `XLSX.write({ type: 'array' })` + Blob URL + synthetic `<a>` click. Do NOT switch back to `XLSX.writeFile` — it calls Node's `fs.writeFileSync`, which Vite externalises for the browser bundle and crashes at click time.
- `TimetableGrid` cells use `mapping.label` on line 1, NOT `mapping.subject`. Multiple mappings share the same `subject` (e.g. `Maths_12th_NDA` / `Maths_VS` / `Maths PYQs` all have `subject='Maths'`); rendering subject would collapse them into one display string and lose the 12th/NDA/PYQ/per-teacher distinctions. `subject` stays in the data model for `ManageMappingsModal` grouping and the lecture-miss WhatsApp body — do not remove the field.
- Timetable cells render two lines: `mapping.label` (line 1), then the resolved teacher name (line 2, only when `mapping.teacherId` is set AND the `teachers` prop is passed). The `<TimetableGrid teachers={…}>` prop is required at the `TimetablePage.jsx` call site; if you reuse the component elsewhere and omit the prop, cells silently lose the teacher line. Break cells render unchanged (single span line).
- `getTimetableTitle(tt)` helper is the SINGLE source of truth for the timetable display title. Three render points read it: page subheading, Excel title row, PNG titleEl. Empty/missing `tt.title` → fallback to `${tt.branch} — ${tt.batchName}`. Do NOT hardcode the `${branch} — ${batchName}` form at any new render point — pipe through the helper so a future title change propagates everywhere.
- `timetable.title` is presentation-only. Do NOT use it as a join key anywhere — `examSchedules.batchName`, `student_batches.batch_name`, `exams.batch`, `syllabusBatchBranches`, the lecture-log subject lookup, etc. all key on `batchName`. Tab labels also stay on `batchName` (titles are often long; would overflow the tab strip).
- `timetable.footnotes` is a multi-line string (`\n`-separated, blank lines dropped on render). Edited via inline textarea in `TimetablePage.jsx` (admin-only). Both PNG export (`handleDownloadPng` appends a notes block to the cloned wrapper) and Excel export (`downloadTimetableExcel` appends a "Notes" header row + one merged row per line) include it. Do NOT switch to a `string[]` shape — the single-textarea editing model was chosen to keep CRUD simple; a structured list would add per-item UI for no user-facing gain.
- `handleDownloadPng` in `TimetablePage.jsx` uses `html2canvas`, NOT `html-to-image`. Do NOT swap back — `html-to-image`'s foreignObject step silently fails on this codebase (returns a correctly-sized PNG with every pixel `rgba(0,0,0,0)`). The page's serialized stylesheets contain something (likely an `@import url(...)` left in the Vite-built CSS bundle, or a KaTeX cross-origin reference) that prevents the inner SVG from drawing to canvas; `skipFonts: true` doesn't reach the trigger. `html2canvas`'s DOM-traversal approach has no foreignObject step, which is why it works here. If you ever need to reintroduce `html-to-image`, first reproduce the all-transparent failure via pixel sampling on the returned dataUrl before claiming it's "fixed".
- `AttendanceRings` chips (`Days late`, `Missed Lectures`, `Missed Exams`) are each gated on `count > 0` per month. Expansion state is `expanded: { month, kind } | null` at the `AttendanceRings` level — single-open across the whole component, NOT per-ring. Do not move state into `Ring` — that would lose the auto-collapse-on-open-another behaviour.
- `AttendanceRings` + `RecentIncidents` chip palettes are LIGHT-mode (`bg-*-50`/`-100`, `text-warning`/`text-danger`/`text-red-900`). Do NOT revert to dark-mode tints (`bg-*-400/10`, `text-*-300`) — the app's surface is white/pale and dark tones become unreadable. Caught + fixed by the user 2026-05-24 after the initial chip work shipped with dark-mode-friendly tones.
- `StudentView` dropdown is bound to `effectiveFilter`, not `subjectFilter` directly. When `subjectFilter` holds a value the student doesn't have any exams for (e.g. default `'Maths'` for a GAT-only student), `effectiveFilter` resolves to `'all'` so the visible `<option>` matches the rendered exam set. Do NOT change to `<select value={subjectFilter}>` — the browser would silently fall back to displaying the first option while state stayed `'Maths'`, dead-ending the user on a contradictory empty state. Do NOT replace with an effect that calls `setSubjectFilter` — derive-at-render avoids a wasted render and preserves manual deselections.
- `AttendanceRings` joins `examAbsences` rows with `exams[]` for display name + date, with fallback to row-level `exam_name`/`exam_date` (student portal serves these pre-joined because the portal's `exams[]` only contains attended exams). Do NOT remove the fallback — would silently drop every absent-exam chip in the student portal.
- `api/student-login.js` returns 12 months of `lectureAbsences` + `examAbsences` (matches AttendanceRings' monthly chip horizon). `RecentIncidents` narrows to 30 days client-side. Do NOT narrow the endpoint window without also narrowing the rings' display, or the student portal will silently lose chips for months > 30 days back.
- `api/student-login.js` enriches every `examAbsences` row with `exam_name`, `exam_date`, `exam_batch` from a second `exams` lookup keyed by `absent` exam ids. Do NOT remove the enrichment — student portal's `exams[]` only contains exams the student sat (built from their `exam_results` rows), so any absent exam wouldn't match the join in MissedExams / RecentIncidents / AttendanceRings without the row-level metadata.
- `exam.batch` may be comma-joined for multi-batch exams (e.g. `"APJ_NDA_2Y_(26-28), LWS_NDA_2Y_(26-28)_A"`). Always read via `getExamBatches(exam)` — do NOT split on comma inline at the call site. The helper handles empty/whitespace-only segments and missing fields. Single-batch exams have no comma; the helper still returns a one-element array.
- Step 2 upload batch picker is closed-list against `syllabusBatches` only. Do NOT re-introduce a free-text input fallback or a `studentProfiles`-derived list — both were drift sources before Settings became the sole CRUD surface. When `syllabusBatches.length === 0` the picker is replaced with an empty-state pointing to Settings → Batches; do NOT silently accept a free-text value.
- `configSlice.addBatch` rejects names containing a comma (`reason: 'comma_in_name'`). Do NOT relax this — comma is the multi-batch separator in `exam.batch`. If a future use case requires a comma in a batch name, change the separator across all readers AND the addBatch guard simultaneously.
- `api/send-exam-absence.js` sends to BOTH the student's own `mobile` and every entry in `parentMobiles[]` (accountability — student knows parents are informed). Earlier "parents only" rule was reversed. Do NOT drop the student-send loop again unless the template body is also re-worded to be parent-exclusive ("Dear parent, your ward..."). Today's body says "Your ward was absent" — slight off-tone for the student-copy, accepted in exchange for shipping today.
- `api/send-exam-absence.js` MUST sanitise `examName` before passing to Wabridge: en-dash/em-dash → `-`, newlines → space, whitespace collapsed. Meta drops messages silently when any of these slip through (see `feedback_whatsapp_template_param_rules`). If you change the sanitiser, keep it ASCII-only.
- `getExamAbsentees` filters out variant-keyed profile entries via `if (p.name !== key) continue`. Do NOT remove — `studentProfiles` is keyed by canonical name AND every variant; without the guard absentees with N variants are returned N+1 times.
- `getExamAbsentees` filters `if (p.accountStatus !== 'Active') continue` (EIS+Active gate at the audit-log writer). Do NOT remove — Block / quit / batch-over students would re-enter the absence cohort and get WhatsApp'd on the next exam upload. Demo students are excluded structurally (not in `studentProfiles`); the only filter we need is `accountStatus`. If a new status enum value appears (today only `Active` / `Block`), it's excluded by default — that's the conservative behaviour.
- `getExamAbsentees` filters `if (p.regDate && exam.date && exam.date < p.regDate) continue` (regDate gate). Do NOT remove — newly enrolled students would otherwise be flagged absent for exams that happened before they joined. Missing `regDate` skips the filter (permissive — matches `filterValidExams`); not modal-mirrored because `regDate` is write-time-stable (unlike `accountStatus` which can flip Active→Block).
- `ExamAbsencePreviewModal`'s `joinRows` independently filters historical absence rows: skips rows where the joined profile is missing OR `accountStatus !== 'Active'`. Do NOT collapse this into the audit-log filter — they operate on different time slices (write-time vs send-time). A student Active at write but Block at send-time MUST be hidden from the modal even though their absence row exists.
- `examAbsenceSendHistory` is keyed by `examId`. Same shape as `whatsappSendHistory`: `{ sentAt, sent, skipped, failedNames[] }`. Both included in `saveToStorage`'s destructure + data object so they persist across reloads. Do NOT remove from either list — would silently lose send history on the next save.
- `parseFailedNamesAbsence` in `Exams.jsx` is the absence-flow parser — captures `FAIL → Name (student|parent)`, `SKIP Name parent ...`, and `SKIP Name —` (both no-mobile and no-parent-mobile lines). The original `parseFailedNames` matches `(student` only and is for the WhatsApp Results flow. Do NOT merge into one function unless you're touching both endpoint log formats at the same time.
- `WhatsAppResultsModal`'s `recipientLabel` prop defaults to `'students + parents'`. The absence flow uses the default (no override). If a future flow has different recipient mix, pass the right label; don't hard-code in the modal.
- `exam_absences` rows are written by `examAbsenceSlice.syncExamAbsences(examId)` ONLY. The hook points are `examsSlice.addExam` and `replaceExam` (`get().syncExamAbsences?.(id)` after the local state write). Do NOT add direct INSERTs into `exam_absences` from other code paths — the sync helper does diff reconciliation that any direct write would break (`notified_at` preservation in particular).
- `syncExamAbsences` DELETE branch is gated on "now appears as attendee", NOT on "no longer in cohort". Cohort-shrink (batch moves, profile deletions) MUST NOT trigger DELETE — that would silently destroy historical absence audit rows. Only re-upload-reveals-they-attended triggers DELETE. Do NOT regress this to the simpler `currentIds NOT IN targetIds` diff; the `student_batches` table has no time-of-event history so the current state can't tell you whether a row was correctly captured at the time.
- `ExamAbsencePreviewModal` self-heals via ONE `syncExamAbsences` call when its first fetch returns empty. The local `synced` flag prevents loops. Do NOT remove the flag — without it, an exam that genuinely has zero absentees would re-sync on every fetch.
- `MissedExams` and `RecentIncidents` BOTH accept `examAbsencesProp` for the student portal — students have no Supabase session, so the slice returns []. `api/student-login.js` returns `examAbsences[]` (last 30 days) which threads through App.jsx → StudentView. Do NOT remove the prop bypass — would silently break the student portal.
- `examAbsenceSlice.markExamAbsencesNotified(examId, lwsIds)` is called CLIENT-SIDE from `Exams.jsx` after a successful send, using `edits - failedNames` as the notified set. Endpoint stays neutral. Do NOT move this into the endpoint without first confirming the endpoint has Supabase write access in its env (it currently only has anon — JWT user verification, not service role).
- `RecentIncidents` accepts `exams` prop now (needed to look up exam name for absence chips). When the prop is empty, exam-absence rows are silently dropped from the strip. Do NOT remove the lookup — would render raw `exam_id` strings to the user.
- `api/student-login.js` queries `exam_absences` with `.gte('marked_at', sinceIso + 'T00:00:00.000Z')`. Keep the ISO timestamp format — `marked_at` is `timestamptz`, not a date string like `lecture_absences.date`.
- Monthly Reports are compute-on-demand — there is NO `monthly_reports` table. Re-generating recomputes from current `exams[]` + freshly-fetched attendance/absence rows. Do not introduce a snapshot table; if the audit history of "what we sent" is needed later, capture that separately (e.g. `monthly_report_sends` log) rather than mirroring the report body.
- The faculty `remark` on a monthly report is TRANSIENT — typed in the page's `{ [lwsId]: remark }` state, written into the PDF on download, lost when the user navigates away or re-generates. Do NOT add persistence (table or JSONB) without an explicit user decision — the agreed tradeoff is "re-type if you re-generate".
- `monthlyReportSlice.fetchMonthlyReportData(month, lwsIds)` is the SOLE bulk-fetch path. Do NOT replace it with N per-student calls to `getExamAbsencesForStudent` etc. — the bulk shape exists specifically to avoid `cohortSize × 3` round-trips.
- `getMonthlyReportCohort` enforces Active + in-batch + `regDate ≤ month-end`. Do NOT loosen any of the three — Block / wrong-batch / not-yet-enrolled students must not get a report card. Variant-keyed entries skipped via `p.name === key` (same pattern as `getExamAbsentees`).
- `attendanceDescriptor` is exported for unit tests but is conceptually private to the PDF lib. Do NOT use it as a general-purpose attendance formatter elsewhere; copies of the rule would drift. The signal it encodes is "hide zero counts, always show present, singular vs plural lecture(s)" — narrow contract.
- The monthly report PDF intentionally OMITS subject-summary and weakest-chapter sections, even though `buildMonthlyReport` could compute them (the compute blocks were removed 2026-05-24). Do not re-add either section without confirming with faculty — the trim was a deliberate response to their review. If you do re-add, watch out for the jsPDF Helvetica WinAnsi encoding issue: `↑`/`↓` trend glyphs render as garbage and need ASCII alternatives (`+` / `-` or words).
- `monthlyReportPdf.js` + `monthlyReportZip.js` use **dynamic imports** for `jspdf` / `jspdf-autotable` / `jszip`. Do not switch to static imports — the libs are only needed when the user clicks Download / ZIP, so deferring keeps the initial bundle smaller. Same pattern as `examPdf.js`.
- `api/teacher-account.js` MUST construct two separate Supabase clients: anon (for `getUser(jwt)`) and service-role (for `auth.admin.*`). Do NOT reuse the service-role client to verify the caller's JWT — the service role bypasses RLS and would silently accept any session. The admin-gate check (`user.user_metadata?.role === 'teacher'` → 403) is the only barrier preventing a logged-in teacher from creating / deleting other auth accounts; never relax it.
- `SUPABASE_SERVICE_ROLE_KEY` MUST live ONLY in Vercel env (and local `.env.local` for dev). It bypasses RLS — if it ever ships in the browser bundle, the entire DB is open. Do not import it from any file under `src/`; only `api/*` and migration scripts may read it. Endpoint must return 500 with a clear configuration message when missing — never silently fall back to the anon key.
- `api/teacher-account.js` `create` action uses `email_confirm: true` (instant-active, no Supabase email). If switching to email confirmation, Supabase Auth SMTP must first be configured in the dashboard (Authentication → Email → SMTP Settings) and the URL config must include the Vercel domain. The existing `send_schedule.py` Gmail SMTP setup does NOT carry over — those are independent systems. See decisions log.
- `timetableTeachers[]` and Supabase auth users are loosely coupled BY EMAIL only — no FK, no shared id. A teacher row may have no login account (timetable-only) and a login account may exist without a teacher row (legacy / admin-assistant). UI must drive button state from the `list` fetch, not from any assumed coupling. Email comparison is case-insensitive in both the endpoint and the UI's `authEmails` Set (lowercased on ingress).
- `TeachersTab` re-fetches `{action:'list'}` after every successful create / delete / reset so the badges stay current. Do not cache the result across mutations — drift between "auth account exists" and the badge would lead admin to attempt duplicate creates or click Delete on a missing account.
