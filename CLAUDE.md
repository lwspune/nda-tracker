# NDA Maths Tracker — CLAUDE.md

> **Companion docs:** [`README.md`](./README.md) — public-facing entry point and quick start. [`ARCHITECTURE.md`](./ARCHITECTURE.md) — narrative onboarding for new contributors. [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md) — column-level schema reference. [`OPERATIONS.md`](./OPERATIONS.md) — production triage runbook. [`SECURITY.md`](./SECURITY.md) — auth model, RLS, PII handling, secret management. This file is the operational reference for daily work (commands, conventions, decisions log, "what not to change").

## Project overview

A React + Vite faculty tool for LWS Pune to track NDA Maths exam performance.
Four runtime modes:

- **Faculty** (`localhost` / LAN): full read-write. Data in `data/faculty-data.json` via Vite plugin.
- **Online Faculty** (Vercel + Supabase): full read-write. Data in Supabase `faculty_state` JSONB row. Login via Supabase Auth (email/password). Live at `nda-tracker.vercel.app`.
- **Teacher** (Vercel + Supabase): read-only. Individual Supabase account with `role='teacher'` in `user_metadata`. Loads data via `loadFromSupabase()` on mount.
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
| Math rendering | KaTeX |
| Deploy | Vercel for all three portals (faculty, teacher, student); GitHub Pages legacy static build via `npm run deploy` |
| Backend | Supabase (Auth + `faculty_state` JSONB table + `exams`, `exam_results`, `students`, `student_batches`, `student_attendance`, `student_logins`, `students_meta`, `class_reports`, `student_plans` tables) |
| Python deps | `tzdata` (`pip install tzdata`) for `send_schedule.py`; `cryptography` only if regenerating `split_students.py` output |

## Key commands

```bash
npm run dev             # faculty mode, data saved to disk
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
- **Prod online faculty** (Vercel): Four Supabase stores:
  - `faculty_state` JSONB row (`id=1`) — syllabus, timetable, cost log, etc. (exams removed Phase 5; savedInsights removed Phase 6). Fire-and-forget saves via `saveToSupabase` (session-gated). `saveToSupabase` strips both `exams` and `savedInsights` before writing.
  - Normalised exam tables — `exams` (id, name, date, subject, batch, branch, marking JSONB, questions JSONB, created_at) + `exam_results` (exam_id FK ON DELETE CASCADE, student_name, roll_no, total_marks, correct, incorrect, not_attempted, responses JSONB). Written by `examsSlice.js` via `src/store/slices/examSupabase.js` helpers. Read via `loadExamsFromSupabase()` (paginated, 1000-row pages).
  - Normalised student tables — `students`, `student_batches`, `student_attendance`, `students_meta`. Each mutation in `studentSlice.js` writes targeted rows; `loadStudentsFromSupabase()` is called on faculty login to populate `studentProfiles` in-store. Teacher/student portals never touch these tables (RLS: authenticated only).
  - Normalised insights tables (Phase 6) — `class_reports` (id, exam_id text FK ON DELETE SET NULL, text, generated_at, generated_by) + `student_plans` (id, lws_id FK ON DELETE SET NULL, student_name NOT NULL, text, generated_at, generated_by). Insert-only (history preserved by never updating in place). Written by `insightsSlice.js` via `src/store/slices/insightsSupabase.js` helpers. Read via `loadInsightsFromSupabase()` which collapses to "latest per scope" — `{ classReport, studentPlans }` shape matches the legacy store. RLS: authenticated only.
  - `student_logins (id, lws_id, logged_in_at)` — one row per student login event. Written fire-and-forget by `api/student-login.js` after successful mobile auth. Read by `StudentView` (faculty/teacher only) to show last-login and login count in `ProfileCard`.
  - `students_db.exams[]` is dead data — not mapped by any code path; dropped from Supabase schema.
- **Prod teacher**: no local storage — Supabase session only. `TeacherPortal` calls `loadFromSupabase()` then `loadExamsFromSupabase()` on mount; both must complete before content renders. (Teacher UI does not link to Insights — `loadInsightsFromSupabase()` is faculty-only.)
- **Prod student**: localStorage — session token only (`SESSION_KEY`, contains `lwsId`, `name`, `mobile`), expires after `SESSION_DAYS`.
- `apiKey` is **never** persisted to disk or localStorage — memory only.

### Mode detection & routing
`src/config.js`: non-localhost hostname → `IS_READ_ONLY = true`. Two distinct uses:
- **Component visibility:** never use `IS_READ_ONLY` for this — use `useMode()` (faculty/teacher/student).
- **Dev-vs-prod data-path branching** (e.g. fetch `/api/data` vs `loadFromSupabase`): use `IS_READ_ONLY` directly (or `IS_DEV = !IS_READ_ONLY` in `persist.js`). Do NOT use `import.meta.env.DEV` — Vercel's Vite 8.0.3 substitutes it incorrectly. See decisions log + memory `project_vite_dev_substitution_bug`.

`ModeContext` (`src/context/ModeContext.jsx`) propagates `'faculty' | 'teacher' | 'student'` app-wide. Default is `'faculty'` so tests work without a Provider. Always use `useMode()` in components.

`src/App.jsx`: `supabaseSession.user.user_metadata.role === 'teacher'` → `<TeacherPortal>`, other `supabaseSession` → `<OnlineFacultyPortal>`, `studentData` → `<StudentPortal>`, neither → `<LoginPage>`. Each portal sets `ModeContext`. `sessionChecked` state prevents flash of login before `onAuthStateChange` fires.

**Hooks must be called before any early returns** — store is empty at first render in teacher mode; `loadRemoteData` fires after mount. All `useMemo` in Dashboard/Toppers is placed before early returns to prevent React error #310.

### Login (`src/components/auth/LoginPage.jsx`)
Three-tab unified login page (Student / Teacher / Faculty):
- **Faculty**: email + password → `supabase.auth.signInWithPassword()` → `onAuthStateChange` fires → `OnlineFacultyPortal` renders.
- **Teacher**: email + password → `supabase.auth.signInWithPassword()` → role check in `onAuthStateChange` → `TeacherPortal` renders. Teacher accounts have `user_metadata.role = 'teacher'` (set via `create_teacher_account.js`).
- **Student**: mobile → `POST /api/student-login` → on success saves session to localStorage → `onStudentLogin(data)`. Session restore on mount re-calls the same endpoint with stored mobile.
- `?mobile=XXXXXXXXXX` param pre-fills mobile input (used in result emails for one-click login).

### Student split script (`split_students.py`)
**Legacy** — output files (`public/data/index.json`, `public/data/students/*.json`, `public/data/db.json`) are no longer consumed by teacher or student login (both now use Vercel + Supabase). Script still updates `lastDeployedAt` in `faculty-data.json` and can regenerate static files if needed. Removed from `predeploy` — run manually via `npm run split`.

### Store (`src/store/useStore.js`)
State keys: `exams`, `studentProfiles`, `studentList`, `savedInsights`, `ndaFreqBySubject`, `ndaMarksBySubject`, `costLog`, `apiKey`, `lastDeployedAt`, `hydrated`, `syllabusPrograms`, `syllabusBatches`, `syllabusBatchBranches`, `batchProgramAssignments`, `batchSyllabusProgress`, `batchChapterTimelines`, `timetableTeachers`, `timetableMappings`, `timetables`, `examSchedules`, `whatsappSendHistory`.

`studentList` is the raw snake_case array set by `importStudentsDB` (alongside the canonical-name-keyed `studentProfiles` map). Not persisted — reloaded from Supabase / `students_db.json` each session. Required by `FindDuplicatesTab` so two profiles sharing the same `canonical_name` are both visible to the scan (the map collapses them to one key).
Slices under `src/store/slices/`. All mutations call `get()._save()` immediately.
- `loadStudentData(data)` — student portal; `loadRemoteData(data)` — teacher portal.
- `loadRemoteData` sets all six syllabus keys (`syllabusPrograms`, `syllabusBatches`, `syllabusBatchBranches`, `batchProgramAssignments`, `batchSyllabusProgress`, `batchChapterTimelines`) from the decrypted payload.

### Subject filtering
Subject filter is **local state per page** — not in the store. Dashboard: subject → branch → batch → exam chain. Exams: sort + subject → branch → batch. StudentView: self-contained, shown when student has 2+ subjects. **`StudentView` defaults to `'Maths'`** (not `'all'`) — matches the primary use-case. When the default Maths filter returns zero exams (e.g. a GAT-only student), the `!examData.length` early return still renders the subject selector + ProfileCard so the user can switch to "All Subjects" or "GAT" — without this, GAT-only students hit a dead-end empty state.

### Batch filtering
Batch dropdown options and filter logic use **`profile.batches[]` as primary** (app-assigned), with `exam.batch` as fallback only for exams where no student has a profile.
- `getBatchOptions(exams, studentProfiles)` — builds dropdown options from profiles; falls back to `exam.batch` for unmatched exams.
- `getExamsForBatch(exams, studentProfiles, batchName)` — returns exams where ≥1 student has `batchName` in their `profile.batches[]`; falls back to `exam.batch` when no student has a profile.
- Both helpers live in `src/lib/analytics/filters.js` and are re-exported via `src/lib/analytics.js`.
- Used by Dashboard, Exams, and Toppers pages. Do not revert to filtering on `exam.batch` directly.

### Valid students & regDate filtering
Valid student = `studentProfiles` entry with non-empty `regDate`. Valid exam = `exam.date >= profile.regDate`. Students without `regDate` are excluded from class-level analytics. `accountStatus` is display-only.
Analytics functions (`getAllStudents`, `computeChapterStats`, `getAtRisk`, `getHardestQuestions`, `getToppers`) accept optional `validNames: Set | null` (`null` = no filter).

### Students page browser
`src/pages/Students/index.jsx` renders a paginated, filterable **table** (`StudentsTable`) above the optional `StudentView` detail. Pattern X — when a row is clicked the table stays visible and `StudentView` expands below.

**Table** (`StudentsTable.jsx`): 8 columns (Name, LWS ID, Branch, Batch(es), Mobile, Status, Exams count, Last activity). Filters: search (canonical name + LWS ID + name variants), branch, batch, status. PAGE_SIZE = 25. Page resets to 1 on any filter change. Exam count and last-activity are derived per render from `exams` keyed on canonical name + variants.

**Source list:** prefers `studentList` (raw Supabase array — one row per record); falls back to canonical-only `studentProfiles` entries when `studentList` is empty. Variants are excluded.

**Inline editor** (`StudentRowEditor.jsx`): faculty-only. Per-row Edit button toggles a sub-row with branch select + batches editor (remove chips, add from dropdown) + Save/Cancel. Save calls `updateStudentBranchBatch(lwsId, name, { branch, batches })`. Editing other fields (mobile, parent mobiles, name variants) stays in `ProfileCard` inside the detail view below.

`StudentView` still shows a profile card for students with no exams (early-return at `!allExamData.length` renders `<ProfileCard>` + empty state, not a blank screen).

**Name variant normalization in `StudentView`**: after the profile lookup, builds `allNames = Set([name, ...(profile?.nameVariants || [])])` and creates `normalizedExams` — a shallow in-memory copy where any student entry whose name is a known variant is renamed to the canonical name. All analytics (`getStudentExams`, `computeStudentChapterStats`, audits, etc.) then operate on the canonical name and find records regardless of which spelling appeared in the uploaded results. No-op when the student has no variants.

### Duplicate detection & name-variant linking (`src/lib/merge/`)

Six files under `src/lib/merge/`, re-exported as a flat API via `src/lib/mergeStudents.js`.

**Profile–profile dedup** (`deduplication.js`): `findDuplicateCandidates(snakeStudents, opts)` signals: Jaccard bigram similarity ≥ 0.75 (`name_similar`), all tokens of shorter name in longer name (`name_subset`, requires ≥ 2 tokens to avoid false positives on shared surnames), same mobile, same EIS. No `branchFilter` → flat cross-branch scan; specific `branchFilter` → within that branch only.

**Exam-name scanning** (`deduplication.js`):
- `getUnmatchedExamNames(exams, studentProfiles)` — exam names not yet indexed in `studentProfiles` (includes canonical name + all name variants as keys).
- `findExamNameCandidates(unmatchedNames, snakeProfiles)` — same signals, returns `{ examName, profile, score, reasons }[]`.

**Link action** (`studentSlice.js`): `addNameVariant(lwsId, variantName)` — appends exam name to `name_variants[]` in `students_db.json` and immediately re-indexes `studentProfiles` in memory.

**UI** (`FindDuplicatesTab.jsx`): combined scan runs both passes. Profile–profile pairs → merge (choose primary). Exam-name–profile pairs → "Link as variant" button (directional, exam name always goes into the profile). `ExamNameCard` uses dashed border + purple "exam name" badge + exam count. `pairKey` for exam pairs: `'exam:' + examName + '|' + lws_id`.

**Data source for the scan** (`ManageBatchBranchModal.jsx`): the `students` prop passed to `FindDuplicatesTab` is built from `studentList` (raw Supabase array), not `Object.values(studentProfiles)`. The map is keyed by `canonical_name` — two students with the same name collapse into one entry, hiding the duplicate. Rename and Bulk Assign tabs still use `uniqueStudents(studentProfiles)` since they don't need to see duplicates.

### WhatsApp Results flow
`💬 WhatsApp Results` button (faculty, Exams page) → `WhatsAppPreviewModal` (review + edit) → `POST /api/send-whatsapp` → `WhatsAppResultsModal` (log).

**Pre-send modal** (`WhatsAppPreviewModal.jsx`): rows built from `exam.students` + `studentProfiles`; branch dropdown (derived from `studentProfiles`), mobile + parent mobiles editable inline. Footer has optional "redirect all to" test field. On "Confirm Send": calls `bulkUpdateStudentContacts(edits)` (single fetch→patch→write to `students_db.json`), then POSTs `{ examName, redirectTo?, students? }` to `/api/send-whatsapp`.

**Send history** (`whatsappSendHistory` store key, `{ [examId]: { sentAt, sent, skipped, failedNames[] } }`): persisted to `faculty-data.json`. Button shows `💬 Sent N✓ M✗ · Resend` after first send. `failedNames[]` is parsed from log lines client-side (`SKIP Name —` and `FAIL → Name (student`).

**Resend scope toggle**: when `failedNames` is non-null (previous send exists), modal shows amber banner with radio: "Failed & skipped only (N)" (default) / "All students". Scope controls the `students[]` array forwarded to `--students` in the script.

**`--students` filter** in `send_results_whatsapp.py`: comma-separated names, case-insensitive; filters `results` list before the send loop. Forwarded from POST body by the Vite dev endpoint or the `api/send-whatsapp.js` Vercel serverless function — same URL (`/api/send-whatsapp`) in both environments.

### Student profiles & parent mobiles
`importStudentsDB` maps `students_db.json` snake_case fields to camelCase profile keys. Profile shape includes `parentMobiles: string[]` (from `parent_mobiles[]` in `students_db.json`).

**Population**: Student import XLS `Guardian No.` column is parsed as `guardian_mobile` in `parseStudentsExcel`. `mergeStudents` appends it to `parent_mobiles[]` if not already present — merge never overwrites, so manually-added numbers survive re-import. New students get `parent_mobiles: [guardian_mobile]` on first import.

**Edit UI**: `ProfileCard` (`studentViewComponents.jsx`) shows parent mobiles as pills and lets faculty add/remove numbers (digits-only normalisation on input). Saved via `updateStudentParentMobiles(lwsId, name, parentMobiles)` in `studentSlice.js`, alongside branch/batch in one Save action.

`split_students.py`'s `lws_to_info` carries `parent_mobiles` for use by `send_results_whatsapp.py`.

### GAT subject routing
`computeStudentChapterStats / computeWrongAudit / computeSkippedAudit` accept `qSubject?` — filters questions where `q.subject` matches. Questions with `q.subject=null` (non-GAT exams) are always included.
GAT total (600) is always derived — never stored. `CONFIGURABLE_SUBJECTS` excludes GAT from the freq editor. Tags file **must** include a `Subject` column per question for combined GAT mocks.

### Syllabus Tracker (`src/pages/Syllabus/`)
Tracks teaching progress per batch, independent of exam data.

**Data model**: `syllabusPrograms` — `{ id, name, trackingColumns[], subjects[{ id, name, chapters[{ id, name, group }] }] }`. `syllabusBatches` — `string[]` (user-managed, independent of exam batches). `syllabusBatchBranches` — `{ batchName: branchName }` (optional per-batch branch tag). `batchProgramAssignments` — `{ batchName: [programId] }`. `batchSyllabusProgress` — `{ batchName: { programId: { subjectId: { chapterId: { col: status } } } } }`. `batchChapterTimelines` — `{ batchName: { programId: { subjectId: { chapterId: "YYYY-MM" } } } }` — per-batch scheduled month for each chapter.

**Status cycle**: `null → 'In Progress' → 'Done' → null` (faculty only). Seed data in `src/lib/syllabusSeed.js` (generated by `generate_syllabus_seed.py`) auto-loaded when `syllabusPrograms` is empty.

**Chapter timeline**: `setChapterTimeline(batchName, programId, subjectId, chapterId, "YYYY-MM")` / `getChapterTimeline(...)` in `syllabusSlice.js`. Displayed in `SubjectAccordion` as a fixed "Timeline" column (before tracking columns) showing `"Jun 2026"` format. Faculty clicks cell → inline `<input type="month">`; teacher sees read-only. `clearSubjectProgress` does NOT clear timelines — resetting tracking status keeps the planned schedule. Timeline is batch-level (different batches may have different schedules for the same chapter).

**Batch tabs** come from `syllabusBatches` — standalone list independent of `exams[].batch` or `studentProfiles[].batches`. Faculty can add, rename, and delete batches from the tab bar. `AssignProgramsModal` selects from this list only (no inline batch creation). Migration: on first load, if `syllabusBatches` is empty, seeded from `Object.keys(batchProgramAssignments)`. Chapters support optional `group` string for section headers.

**Branch filter**: branch pills above batch tabs are sourced from `timetables[].branch` (same source as TimetablePage/ExamScheduleView). `syllabusBatchBranches` maps batch names to branches — set via `setSyllabusBatchBranch(batchName, branch)` or the ⋯ menu "Set branch" option. When adding a batch with a branch filter active, the batch is auto-tagged to that branch.

Syllabus batch mutations: `addSyllabusBatch`, `renameSyllabusBatch` (cascades to assignments + progress + `syllabusBatchBranches` + `batchChapterTimelines` keys), `deleteSyllabusBatch` (cascades all four) — all in `syllabusSlice.js`. `deleteProgram`, `deleteSubject`, `deleteChapter` also cascade to `batchChapterTimelines`.

### Timetable (`src/pages/Timetable/`)
CRUD for branch/batch timetables: time slots, a Mon–Sat grid of cells (class, break, or full-row span), subject-teacher mappings, and a batchwise exam schedule.

**Data model**:
- `timetableTeachers` — `{ id, name, email }`
- `timetableMappings` — `{ id, label, subject, teacherId }`
- `timetables` — `{ id, branch, batchName, timeSlots[{ id, startTime, endTime }], grid: { [slotId]: { [day]: { type, mappingId|label } | null, __span? } } }`
- `examSchedules` — `{ id, date, startTime, endTime, subject, chapter, teacherId, branch, batchName, status }`. `status` cycles `Planned → Completed → Cancelled → Planned` (faculty only). `branch`/`batchName` come from existing `timetables[]` entries — not from syllabus batches or exam batches.

**Teacher email**: stored on `timetableTeachers[].email`. `updateTimetableTeacher(id, patch)` accepts `{ name?, email? }` — not a bare string. Teachers without email are skipped by `send_schedule.py`. Deleting a teacher cascades: nulls `teacherId` on both `timetableMappings` and `examSchedules`.

**Schedule emails**: `send_schedule.py` reads `faculty-data.json` and sends HTML email via Gmail SMTP. Modes: `--weekly` (next Mon–Sat, appends "Upcoming Exams This Week" section); `--daily` (tomorrow, Sat → Mon); `--exam-reminder N` (exams N days from today, N=1 or 2). Triggered from the UI via `POST /api/send-schedule` (`vite.config.js`). `SendScheduleModal` handles all three modes.

**Excel export**: `downloadTimetableExcel` uses `xlsx-js-style` (not `xlsx`) to produce a styled workbook — Times New Roman font, bold title row (merged, 13 pt), bold headers and time column (10–11 pt), thin black borders on all cells, and explicit row heights. Do not revert this import to `xlsx` (the community edition has no styling API).

**Views**: "Student View" (timetable grid per branch/batch, PNG + Excel export), "Teacher Schedule" (all slots for a selected teacher, clash detection), and "Exam Schedule" (batchwise exam list with branch-pill / batch-underline-tab filter identical to Student View, status badges, reminder email buttons).

### Mode-conditional visibility
Use `useMode()` — never `IS_READ_ONLY` — for component-level visibility.

| Feature | Faculty | Teacher | Student |
|---|---|---|---|
| Add/delete exams, re-upload, edit questions | ✓ | — | — |
| WhatsApp Results button | ✓ | — | — |
| Edit student branch/batch | ✓ | — | — |
| Attendance page (import XLS + class metrics table) | ✓ | ✓ | — |
| Attendance rings (student monthly % view) | ✓ (StudentView) | ✓ (StudentView) | ✓ (portal, inline scroll) |
| Syllabus Tracker (edit) | ✓ | — | — |
| ProjectedScoreCard | ✓ | ✓ | — |
| WrongAnswerAudit / UnattemptedAudit | ✓ | ✓ | ✓ |
| Download exam PDF | ✓ | ✓ | — |
| Toppers page | ✓ | ✓ | — |
| Syllabus Tracker (view) | ✓ | ✓ | — |
| Insights / API Costs pages | ✓ | — | — |
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

**Attendance import** (LWS attendance export): row 0 = title, row 1 = headers, row 2+ = data. Required columns: `Student Name`, `Mobile No.`. Date columns in `DD-MM-YYYY` format (header), values `P` / `A` / `-` (dash = skip). Parsed by `parseAttendanceExcel` in `src/lib/excel.js`; matched to `studentProfiles` by mobile (primary) or name (fallback). Upserted into `student_attendance` with `onConflict: 'lws_id,date'`.

---

## Key files

| File | Purpose |
|---|---|
| `src/config.js` | Mode detection (`IS_READ_ONLY`), session keys (`SESSION_KEY`, `SESSION_DAYS`), app info |
| `api/student-login.js` | Vercel serverless — normalises mobile, queries `students` table, fetches `exam_results` + `exams` + `student_attendance`; fire-and-forgets a `student_logins` insert; returns student data |
| `create_teacher_account.js` | Admin script — creates/updates Supabase auth user with `role='teacher'` metadata. Usage: `node create_teacher_account.js <email> <password>` |
| `src/context/ModeContext.jsx` | `ModeContext` + `useMode()` |
| `src/store/useStore.js` | Zustand store assembler |
| `src/store/persist.js` | Dev: disk via Vite plugin. Prod faculty: Supabase `faculty_state`. Teacher/student: no-op. |
| `src/lib/supabase.js` | Null-guarded Supabase client (returns `null` if env vars absent) |
| `src/stubs/empty.js` | One-line `export default {}` — aliased from `stream` in `vite.config.js` so xlsx's optional `require('stream')` short-circuits cleanly instead of throwing on Vite's externalised-module stub. |
| `vercel.json` | SPA rewrite rule — all non-`/data/|api/` paths → `index.html` |
| `api/send-whatsapp.js` | Vercel serverless function — verifies faculty JWT, loads exam from `exams` table + results from `exam_results`, builds Wabridge payloads; mirrors the Vite dev endpoint at the same `/api/send-whatsapp` URL |
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
| `src/pages/Timetable/` | TimetablePage, TimetableGrid, ExamScheduleView, AddExamScheduleModal, Edit/Add modals, SendScheduleModal |
| `src/pages/Exams/WhatsAppPreviewModal.jsx` | Pre-send review modal: editable student table (branch dropdown, mobile, parent mobiles), scope toggle for resend, test redirect-to field |
| `src/pages/Exams/WhatsAppResultsModal.jsx` | Post-send log modal — sent/skipped counts + per-line colour-coded log |
| `src/components/auth/LoginPage.jsx` | Three-tab login (Faculty/Teacher/Student); Faculty + Teacher via Supabase auth; Student via `/api/student-login` |
| `src/components/upload/UploadModal.jsx` | 4-step add-exam modal |
| `src/lib/excel.js` | Excel parsing (results, tags, student import, attendance import) |
| `src/store/slices/attendanceSlice.js` | `importAttendance(parsed)` — mobile→lwsId matching, upsert to `student_attendance` |
| `src/pages/Attendance/index.jsx` | Faculty/teacher page: consecutive absences alert (editable N days, ignores Sundays), paginated Supabase fetch, class avg/at-risk metrics, student table with % badges, Import XLS button |
| `src/pages/Attendance/consecutiveAbsent.js` | Pure fn `buildConsecutiveAbsent(records, lwsIdToName, n)` — uses last N non-Sunday global dates; students absent on all N are flagged with `{ lwsId, name, since }` |
| `src/pages/Attendance/AttendanceRings.jsx` | SVG donut rings per calendar month (R=40, stroke-dasharray arc); sorted latest-first; rendered inside `StudentView` (below exam data), visible in all three portals |
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
| `src/lib/students/loadExistingStudents.js` | Dual-path loader returning the existing snake_case students array: Supabase tables when faculty session active, `/api/students-db` fetch otherwise, `[]` on any failure. Used by `useImportFlow` (pre-merge baseline) and `studentSlice.refreshStudents` (post-merge re-read). |
| `src/store/slices/studentSlice.js` | `importStudentsDB`, `addNameVariant`, `mergeStudentProfiles`, `bulkUpdateStudentContacts`, branch/batch/mobile updates |
| `src/pages/Students/StudentsTable.jsx` | Filterable + paginated student table (Name / LWS ID / Branch / Batches / Mobile / Status / Exams / Last activity). PAGE_SIZE=25. Click name → activates Pattern X (table stays + StudentView below). |
| `src/pages/Students/StudentRowEditor.jsx` | Inline expand-in-place editor for branch + batches per row (faculty only). Save calls `updateStudentBranchBatch`. |
| `src/pages/Students/ManageBatchBranchModal.jsx` | Rename / Bulk Assign / Find Duplicates tabs |
| `src/pages/Students/batchBranch/FindDuplicatesTab.jsx` | Combined profile–profile + exam-name scan; merge and link-as-variant actions |
| `src/pages/Syllabus/` | SyllabusPage, SubjectAccordion, Manage*Modal, AssignProgramsModal |
| `split_students.py` | Pre-deploy: per-student files + encrypted db.json |
| `send_results_whatsapp.py` | Wabridge WhatsApp result messages to students + parents. `--exam` / `--dry-run` / `--to` / `--redirect-to` / `--students "Name1,Name2"`. Payload: top-level `variables` array. Logs to `whatsapp_send_log.jsonl` (capped 500 entries). Triggered via `POST /api/send-whatsapp` in `vite.config.js`. |
| `send_schedule.py` | Gmail SMTP teacher schedule + exam reminder emails. `--weekly` / `--daily` / `--exam-reminder N` / `--dry-run` / `--to` / `--teacher-id`. Requires `tzdata`. |
| `generate_syllabus_seed.py` | Excel → `src/lib/syllabusSeed.js` |
| `merge_subtopics.py` | One-time subtopic rename script: 28-entry `SUBTOPIC_RENAMES` map + `apply_renames(exams, map)` — updates `data/faculty-data.json`; run `merge:subtopics:sync` after to push to Supabase |
| `migrate_subtopics_supabase.js` | Patches `exams.questions` JSONB in Supabase with the same 28-entry rename map (needs `SUPABASE_SERVICE_ROLE_KEY`); idempotent |
| `tests/test_subtopic_merge.py` | 39 pytest tests for `merge_subtopics.py` rename logic |
| `data/faculty-data.json` | Primary dev data store (gitignored) |
| `students_db.json` | Student roster with mobiles (gitignored) |
| `teacher_password.txt` | Legacy — was used to encrypt `db.json` for static teacher login. No longer needed; teacher login is now Supabase auth. |

---

## Tests

Setup: `src/test/setup.js`. `ModeContext` defaults to `'faculty'` — no Provider needed in tests.
Test files mirror source paths under `__tests__/`. Python tests under `tests/`. **640 Vitest tests passing**. **39 Python tests** in `tests/test_subtopic_merge.py`.
Key coverage: analytics filters, GAT routing, tag validation, dashboard filters, Exams/Students/StudentView pages, re-upload modals, mergeStudents (incl. dedup signals, exam-name candidates, `addNameVariant`), split script, send_schedule (44 tests), timetableSlice (35 tests), studentSlice (6 tests), insightsSlice + insightsSupabase (21 tests covering save/clear dual-path + table helpers), persist.js (Supabase load/save/pagination), useStore loadExamsFromSupabase action, Exams pagination (11 tests), attendance parse (8 tests), attendanceSlice (10 tests), AttendanceRings (6 tests), student-login login tracking (2 tests), consecutiveAbsent (14 tests), migrate_insights (11 tests: name lookup + classReport/studentPlan seed + duplicate skip), subtopic rename (39 Python tests).

**Mock completeness rules** (omitting these causes silent "0 tests" or TypeError at setup):
- Mock stores for pages using batch filtering must include `studentProfiles: {}`.
- `vi.mock('../../../lib/ndaFreq', ...)` must include `NDA_FREQ_BY_SUBJECT: {}` — `validateTags.js` imports it directly.
- `WrongAnswerAudit` + `UnattemptedAudit` + `ExamHistoryTable` all use `PAGE_SIZE = 5`.
- `syllabusSlice.test.js` mock state must include `syllabusBatchBranches: {}` and `batchChapterTimelines: {}` — `deleteSyllabusBatch` and `renameSyllabusBatch` destructure both.
- Async slice actions that call `fetch` (e.g. `addNameVariant`) must use `vi.stubGlobal('fetch', vi.fn(...))` with a `beforeEach(() => vi.restoreAllMocks())` guard — see `src/store/slices/__tests__/studentSlice.test.js`.
- `Exams.test.jsx` mock store must include `whatsappSendHistory: {}`, `bulkUpdateStudentContacts: vi.fn()`, and `setWhatsappSendHistory: vi.fn()` — all three are now read from the store at component mount.
- Exams pagination tests use `data-testid="exam-card"` (not `role="heading"`) — exam names render in `<div>`, not `<h3>`; `Card` spreads `...props` so the attribute passes through.
- `api/__tests__/student-login.test.js` uses `@vitest-environment node` docblock (Node.js APIs: `fs`, `process.env`) and mocks `@supabase/supabase-js` with `createClient: vi.fn()` configured per-test via `makeMockClient()`.

## Lint

`npm run lint` — `eslint.config.js` (flat config). Current state: **11 errors** (all pre-existing — `'global' is not defined` in test files using `global.fetch`, plus 3 intentional `setState in effect` rule violations in `Sidebar.jsx` / `LoginPage.jsx`), **13 warnings** (all `react-hooks/exhaustive-deps` — intentional). Node-only scripts (`api/*`, `migrate_*.js`, `sync_*.js`) additionally report `'process' is not defined`; environment-level, not code issues.

**Config structure:**
- Browser globals + React/react-hooks/react-refresh plugins for all source files.
- Extra `globals.node` block for `vite.config.js` (uses `process`, `__dirname`).
- Extra Vitest globals block for `**/__tests__/**` and `**/*.test.*` files (`describe`, `it`, `expect`, `vi`, etc.).
- `no-unused-vars`: `varsIgnorePattern: '^[A-Z_]'`, `argsIgnorePattern: '^_'`, `caughtErrorsIgnorePattern: '^_'` — prefix unused args/catches with `_` to suppress.
- `react-hooks/preserve-manual-memoization` disabled globally (React Compiler rule, not applicable here).

**Intentional `eslint-disable` comments in source:**
- `SyllabusPage.jsx` and `ExamScheduleView.jsx`: `react-hooks/set-state-in-effect` — auto-select first item when the list changes; the pattern is deliberate.
- `LoginPage.jsx` and `StudentLogin.jsx`: `react-refresh/only-export-components` — session-clear helpers are co-located with the component that owns the session; splitting would be artificial.

---

## Deployment

### GitHub Pages (legacy static build)
`npm run deploy` — `vite build --base=/nda-tracker/` → push to `gh-pages`. Split script no longer runs automatically. The GH Pages site still loads the app but student/teacher login won't work (no serverless functions on static hosting) — users should be directed to `nda-tracker.vercel.app`.

`BASE_URL` is derived from `import.meta.env.BASE_URL` in `src/config.js` — no hardcoded `REPO_NAME`.

### Vercel (online faculty portal)
- Repo is connected to Vercel; every push to `main` triggers a production deploy.
- Required env vars in Vercel: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- Supabase project: `exjnzrrlzcrsoxfoojcq`. Auth user: `official.lwspune@gmail.com`.
- To re-seed data after local changes: `SUPABASE_SERVICE_ROLE_KEY=<key> node migrate_to_supabase.js`.

---

## Decisions log

Captures the *why* behind non-obvious architectural choices so they aren't re-litigated.

| Decision | Why |
|---|---|
| `whatsappSendHistory` lives in Zustand (persisted to `faculty-data.json`), not on the exam record | It's operational state (last-sent timestamp, fail list) that must survive page refresh but is not educational data. Keeping it separate from the exam record avoids bloating exam objects and makes it easy to clear independently. |
| `failedNames` parsed client-side from script log lines (`SKIP Name —` / `FAIL → Name (student`) | Simpler than changing the Python script's stdout format. Log line format is stable; parsing it in JS avoids adding a structured JSON output path that would need to stay in sync across both ends. |
| `bulkUpdateStudentContacts` does a single fetch→patch→write for all edited rows | Avoids N sequential round-trips when the faculty edits many students in the preview modal before sending. One read, one map, one write. |
| `db.json` is always valid JSON (encrypted or not) — checking `json.load()` success does not confirm it is plain | Encrypted `db.json` is `{ encrypted: true, salt, iv, data }` — all valid JSON. Always check for the `encrypted: true` key explicitly, not whether `json.load()` succeeds. |
| Batch name `LWS_NDA_2Y_(26-28)` has no space before `(` | Normalised 2026-05-04. The stray-space variant (`LWS_NDA_2Y_ (26-28)`) caused exam-filter mismatches in teacher mode. All three data sources (`students_db.json`, `faculty-data.json` exams, `faculty-data.json` profiles) were patched. The correct form matches the `(25-27)` cohort pattern. |
| Subject filter is local component state, not in the store | Filters reset naturally on navigation (correct UX). No cross-page filter persistence was ever requested. Lifting to the store would add complexity with no benefit. |
| `failedNames` defaults to `null` (not `[]`) on first send | `null` means "no history" — the preview modal uses this to decide whether to show the resend scope toggle. An empty `[]` would show the toggle but with 0 students, which is confusing. |
| `stripLatex` in `examPdf.js` outputs ASCII only (not Unicode math symbols) | jsPDF's built-in Helvetica is WinAnsi-encoded — every Unicode symbol above U+00FF (Greek letters, set operators, arrows, `≤≥≠`, `∈∪∩`, `∞`, `ℝ`, etc.) renders as garbage bytes. `×` `÷` `±` `·` (U+00D7/F7/B1/B7) are within WinAnsi and are kept. Embedding a custom Unicode font would significantly inflate the bundle; ASCII equivalents (`in`, `U`, `->`, `<=`, `alpha`, `inf`, etc.) are readable for NDA students. |
| `faculty_state` JSONB for non-exam/non-insights data; normalised tables for exams + students + insights | Exams normalised in Phase 5: 2.3 MB → 224 KB JSONB. Insights normalised in Phase 6 to enable history (multiple rows per student/class), per-row updates without rewriting the blob, and an FK path for future student-portal surfaces. Syllabus/timetable stay in JSONB — no mutation gap and no `api/` endpoint reads them by ID. |
| Insights tables are insert-only — `saveClassReport` / `saveStudentPlan` append a new row each time; the store only holds the latest | History was free with the new schema and "latest-only" would have wasted the upgrade. The Insights page reads the latest per scope via `loadInsightsFromSupabase()` to preserve the existing UI shape; full history surfaces (timeline, audit log) can be added later without schema changes. |
| `student_plans` keeps both `lws_id` (nullable FK) and `student_name` (NOT NULL) | The legacy JSONB shape was keyed by `student_name`; mapping names → `lws_id` at write time can fail (unresolved variants, deleted students). Keeping `student_name` always-present means a plan can be saved even when the name doesn't resolve, while `lws_id` (when populated) gives proper relational integrity. `ON DELETE SET NULL` preserves historical plans if a student is deleted. |
| `class_reports.exam_id` is nullable | Legacy reports had no exam scope; nullable column allows migrating them with `exam_id = null`. New reports written by the chat-driven flow will populate it. Schema stays permissive so we never have to backfill. |
| `migrate_insights_to_supabase.js` resolves `lws_id` from `students_db.json` (canonical name + name variants), not by querying the `students` table at runtime | The migration runs against a stable snapshot of the student data; querying Supabase per row would add hundreds of round-trips for no gain. Unresolved names are logged and inserted with `lws_id = null` so the caller can fix the variants and re-run idempotently. |
| Students use normalised tables; exams now normalised too (Phase 5) | Student mutations (batch assign, name variants, profile edits) were no-ops on Vercel because `/api/students-db` is a Vite-only dev plugin. Exam mutations had the same gap — reads came from JSONB but writes landed only in local JSON. Both are now dual-path: Supabase table write if session active, else dev-server fetch. |
| `studentSlice.js` mutations use dual-path (Supabase if session, fetch if not) | Keeps dev workflow (local `students_db.json`) unchanged. No Vite config changes needed. The `getSession()` check is cheap — single Supabase client call. |
| `sync:students` as a manual step for Python scripts | `send_results_whatsapp.py` reads `students_db.json`. Rather than rewriting it to query Supabase, a one-command sync keeps the Python side unchanged. Only needed before sends when student profile data changed online. |
| `saveToSupabase` is fire-and-forget (no await) | Blocking the UI on every Zustand mutation would degrade responsiveness. Supabase writes are idempotent (last-write-wins on a single row); a dropped write is recovered on next mutation or reload. |
| Supabase query chains use `async/await`, not `.catch()` | `PostgrestFilterBuilder` (Supabase JS v2) is a thenable but NOT a full Promise — `.catch` is `undefined` on it. Calling `.catch()` throws `TypeError` silently (inside `.then()`), blocking all saves. Every Supabase query must be `await`-ed inside an `async` callback with `{ error }` destructuring. |
| `api/send-whatsapp.js` uses same URL as Vite dev endpoint | The Vite dev server intercepts `/api/send-whatsapp` before Vercel sees it. On Vercel, the serverless function handles it. No client-side URL switching needed — `fetch('/api/send-whatsapp', ...)` works identically in both environments. |
| Vercel `BASE_URL` approach instead of hardcoded `REPO_NAME` | `import.meta.env.BASE_URL` is set by Vite at build time — `vite build --base=/nda-tracker/` for GitHub Pages, default `/` for Vercel. Eliminates the two-file sync requirement. |
| Student login via `/api/student-login` serverless instead of static JSON files | GitHub Pages can only serve static files — `/api/student-login` can't run there. Moving student login to a Vercel serverless function enables live Supabase queries, removes the need to regenerate `public/data/` on every deploy, and keeps student data server-side. |
| Teacher accounts use individual Supabase auth with `role='teacher'` in `user_metadata` | AES-GCM shared password was brittle (one password for all teachers) and required a static `db.json` that needed regenerating on every data change. Individual Supabase accounts give per-teacher accountability, work with the existing `onAuthStateChange` flow, and always serve fresh data via `loadFromSupabase()`. |
| `create_teacher_account.js` uses `supabase.auth.admin` (service role) not the public API | `signUp` would require email confirmation and a browser context. Admin API creates confirmed accounts instantly with custom metadata — appropriate for provisioning internal users. Requires `SUPABASE_SERVICE_ROLE_KEY` locally; teacher accounts are created once and managed via the Supabase dashboard thereafter. |
| `migrate_exams_to_supabase.js --cleanup` prints SQL but does not execute it | The 2026-05-07 incident: cleanup ran before the tables were populated (script read local file, which had 0 exams on dev). Lesson: always seed → verify row count matches source → then run cleanup SQL manually in Supabase SQL editor after confirming the app works with normalised data. |
| `loadExamsFromSupabase` uses paginated `.range(from, from+PAGE-1)` loop | Supabase default `SELECT *` is capped at 1000 rows. With 1472+ `exam_results` rows the bare query silently cut off 472 rows, making new exams show 0 students. All queries on tables that can exceed 1000 rows must use `fetchAllRows()` pagination. |
| Exams page pagination: PAGE_SIZE = 10 | 39+ exams and growing made a single-page list hard to scan. 10 per page keeps the list short without excessive clicks. `page` state resets on filter/sort changes. |
| Attendance not stored in Zustand — fetched on demand from Supabase | Attendance data is large (many rows per student, many students) and is read-only in the app (no client-side mutations after import). Fetching per-page avoids bloating the store and makes RLS enforcement natural. |
| `student_logins` insert is fire-and-forget (`.then(() => {})`) | Blocking the student login response on an audit write would degrade perceived performance and punish students for Supabase latency spikes. A missed login record is tolerable; a slow login is not. |
| `student_logins` table separate from `students` | Login events are operational audit data, not student profile data. Separate table keeps the `students` row small and allows efficient "last login per student" queries via the `(lws_id, logged_in_at desc)` index. |
| `StudentView` subject filter defaults to `'Maths'` | Nearly all NDA students at LWS sit Maths exams; defaulting to `'all'` caused GAT students' exams to appear alongside Maths in the default view, diluting the Maths analytics. Faculty can still select `'All Subjects'`. |
| WhatsApp TRACKER_BASE hardcoded in `api/send-whatsapp.js` (not an env var) | The tracker URL is stable and public — it's the same Vercel deployment the file lives on. Making it an env var adds a config step for no benefit. If the domain ever changes, update the constant in both `api/send-whatsapp.js` and `send_results_whatsapp.py`. |
| Attendance page has no batch filter | Consecutive absence detection is meaningful class-wide: if a student missed every class in the last N days, faculty needs to know regardless of batch. A batch filter would require joining across tables or client-side filtering of a large paginated dataset. |
| `buildConsecutiveAbsent` uses the last N non-Sunday dates from the **global** dataset | Using per-student "last N" would vary by student and produce incoherent comparisons. Global last-N shared dates means the alert has a consistent meaning: these students were absent on the same N days the rest of the class attended. |
| `/subtopic-analyse` skill reads from Supabase, not `faculty-data.json` | Tags uploaded on Vercel go to Supabase but don't sync back to the local file. Reading from the local file after a prod upload would produce stale or incomplete analysis results. |
| Subtopic renames applied via direct MCP SQL, not the migration script | For a known one-time JSONB fixup, a single SQL `UPDATE` with `jsonb_agg(CASE ...)` is atomic and requires no env vars. `migrate_subtopics_supabase.js` is retained for future runs and for team members without MCP access. |
| `studentList` stored alongside `studentProfiles` (raw vs canonical map) | `studentProfiles` is keyed by `canonical_name` — two profiles sharing a name collapse into one entry. `FindDuplicatesTab` needs both entries to detect identical-name duplicates. Storing the raw Supabase array as `studentList` (not persisted) is cheaper than re-querying Supabase from the modal. |
| Subject selector rendered in `StudentView`'s filtered-empty-state | The default `'Maths'` filter produces zero exams for GAT-only students. Without the selector in the early-return path, those students hit a dead-end empty state with no way to switch filters. ProfileCard is also rendered for layout consistency with the other two empty states. |
| `IS_READ_ONLY` (runtime hostname check) gates dev/prod data paths in `persist.js`, `useStore.js`, `defaults.js`, `App.jsx` — NOT `import.meta.env.DEV` | On 2026-05-20, Vercel's Vite 8.0.3 + Rolldown was confirmed to substitute `import.meta.env.DEV` with `true` in production bundles — the opposite of correct behaviour. `loadFromDisk` was running the dev branch in prod, fetching the non-existent `/api/data` route and 404-ing. The bug survived inline refactor, version bump, and "Redeploy without cache". Switched to `IS_READ_ONLY` (a runtime hostname check that can't be miscompiled). Trade-off: dev/prod code paths can no longer be tree-shaken — both ship in the bundle. Fix commit `7b96030`. See memory `project_vite_dev_substitution_bug`. |
| `vite.config.js` aliases `stream` to `src/stubs/empty.js` | xlsx probes `require('stream')` at module init for optional streaming support. Vite 8 externalises `stream` for the browser and its stub throws on property access (`.Readable`), turning xlsx's harmless `(stream || {}).Readable && ...` short-circuit into a startup crash (`Cannot access ".Readable" in client code`). The empty-module alias makes the optional check short-circuit cleanly. Fix commit `0127900`. |
| Student import baseline comes from `loadExistingStudents()` (Supabase if session, dev fetch otherwise) — not from a bare `fetch('/api/students-db')` | On Vercel the bare fetch 404s → `existingStudents = []` → `mergeStudents` flagged every row "new" → on confirm, upsert created fresh LWS-IDs for already-existing students (silent duplicate row creation). The fix mirrors the dual-path pattern already in `studentSlice` mutations and `studentList`/`studentProfiles` loads. Bug surfaced 2026-05-20 when "21 students loaded — 21 new" appeared after a re-import of an unchanged file. |

---

## What not to change

- Do not persist `apiKey` anywhere — memory only.
- Subject filter state is local per page — do not lift to Zustand.
- `StudentView` subject filtering is self-contained — no prop threading.
- Use `useMode()` for visibility — no new `IS_READ_ONLY` imports in components.
- `ModeContext` default is `'faculty'` — changing it breaks tests.
- All hooks must be called **before** any early returns in page components.
- Do not filter batch dropdowns or exam lists on `exam.batch` directly — always use `getBatchOptions` / `getExamsForBatch` from `src/lib/analytics`.
- Syllabus Tracker batch names are independent of exam/student-profile batch names — do not derive them from `exams` or `studentProfiles`. Manage via `addSyllabusBatch` / `renameSyllabusBatch` / `deleteSyllabusBatch`.
- Syllabus branch filter branches are sourced from `timetables[].branch` — do not create a separate branch list for the Syllabus Tracker. `syllabusBatchBranches` cascades on batch rename/delete.
- `updateTimetableTeacher(id, patch)` takes `{ name?, email? }` — do not pass a bare string (breaking change from original signature).
- Exam Schedule `branch`/`batchName` must come from `timetables[]` entries — do not derive from `syllabusBatches` or `exams[].batch`.
- `guardian_mobile` from Excel merges (appends if absent) into `parent_mobiles[]` — do not change to overwrite semantics; manually-added parent numbers must survive re-import.
- Touch targets must be ≥ 44px on all mobile-facing screens (`min-h-[44px]` or equivalent padding). Use `py-2.5`+ for buttons, `py-3`+ for nav items.
- `findDuplicateCandidates` with no `branchFilter` does a flat cross-branch scan — do not revert to per-branch-group iteration.
- The `name_subset` signal requires `shorter.length >= 2` — do not remove this guard (prevents false positives on shared single-word surnames).
- `addNameVariant` deduplicates before appending — do not change to unconditional push.
- Search list shows only canonical names — do not add variant names (keys where key ≠ `profile.name`) back into the search list; they would create duplicate entries for the same student.
- `StudentView` normalizes exam records in-memory via `normalizedExams` — do not remove this or revert `getStudentExams` to using raw `exams`; doing so breaks analytics for students whose exam records are stored under a variant spelling.
- Timetable Excel export uses `xlsx-js-style` — do not change the import back to `xlsx`.
- `batchChapterTimelines` cascades on `deleteProgram`, `deleteSubject`, `deleteChapter`, `renameSyllabusBatch`, `deleteSyllabusBatch` — do not remove these cascade blocks.
- `clearSubjectProgress` intentionally does NOT clear `batchChapterTimelines` — the planned chapter schedule must survive a status reset.
- The "Timeline" column in `SubjectAccordion` is a fixed column (not a user-defined tracking column). If a user has a tracking column also named "Timeline", they will see two Timeline columns — the old one should be deleted from the program's tracking columns.
- `stripLatex` in `examPdf.js` must only output ASCII + safe Latin-1 (`×÷±·`). Do not re-introduce Unicode math symbols (Greek, set ops, arrows, `≤≥≠`, `∈∪∩`, `ℝ`) — all fall outside jsPDF Helvetica's WinAnsi encoding and render as garbage.
- `saveToSupabase` must gate on `supabase.auth.getSession()` before writing — do not remove this check. Teacher and student visits must never overwrite faculty data.
- Do not use `.catch()` on Supabase query builder chains — `PostgrestFilterBuilder` is a thenable, not a full Promise; `.catch` is `undefined` and throws silently. Always use `async/await` with `{ error }` destructuring inside the `.then()` callback.
- `studentSlice.js` mutations must check `getSession()` before choosing Supabase vs fetch path — do not remove this dual-path logic. Dev mode depends on the fetch path; Vercel depends on the Supabase path.
- `loadStudentsFromSupabase()` must be called after `faculty_state` loads in `initStore()` — it overwrites the stale `studentProfiles` baked into `faculty_state` with fresh data from the normalised tables. Do not remove this call.
- `loadInsightsFromSupabase()` must be called in `initStore()` after `faculty_state` loads (faculty path only) — same reason as `loadStudentsFromSupabase`: it overwrites the stale `savedInsights` baked into the JSONB blob with fresh data from `class_reports` / `student_plans`. Do not remove this call.
- `saveToSupabase` strips both `exams` AND `savedInsights` from the JSONB blob before writing — do not remove either field from the destructure. Re-introducing them would double-write the data and let the JSONB drift out of sync with the normalised tables on faculty mutations.
- `insightsSlice.js` mutations are append-only — `saveClassReport` / `saveStudentPlan` insert new rows each time, never update in place. Do not change to upsert; history would be lost.
- `class_reports` and `student_plans` are read by `loadInsightsFromSupabase()` which collapses to "latest per scope" — preserves the legacy `{ classReport, studentPlans }` store shape. Do not change the in-store shape; the Insights page depends on it.
- `loadExamsFromSupabase()` is called in `initStore()` (faculty) and in `TeacherPortal` mount (teacher) — both paths must await it; removing it leaves the store with stale JSONB data (or no data).
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
- `buildConsecutiveAbsent` uses the last N non-Sunday dates from the **global** `records` dataset — all students are measured against the same reference dates. Do not switch to per-student date filtering.
- `StudentView`'s `attendance: attendanceProp = null` prop bypasses the Supabase fetch when provided — required for the student portal because students have no Supabase auth session (RLS blocks unauthenticated reads). Removing the prop bypass breaks attendance rings in the student portal.
- Attendance page has no batch filter by design — consecutive absence detection is class-wide.
- `FindDuplicatesTab` must scan `studentList` (raw Supabase array), not `Object.values(studentProfiles)`. The map collapses identical canonical names; the scan needs to see both entries to flag them.
- `StudentView`'s `!examData.length` early return must render the subject selector + ProfileCard. Removing the selector strands GAT-only students on the default Maths filter with no escape.
- `importStudentsDB` must call `set({ studentProfiles, studentList: students })` together — the two are kept in sync and both are required (profiles for lookups, list for duplicate scanning).
- Do not use `import.meta.env.DEV` anywhere in `src/`. Vercel's Vite 8.0.3 substitutes it with `true` in prod builds (confirmed 2026-05-20). Use `IS_READ_ONLY` from `src/config.js` (or `IS_DEV = !IS_READ_ONLY` in `persist.js`) for any dev-vs-prod branching. Other `import.meta.env.*` (`BASE_URL`, `VITE_SUPABASE_URL`) appear unaffected.
- Do not remove the `stream` → `src/stubs/empty.js` alias in `vite.config.js`. xlsx's optional stream-probe will crash the bundle at startup without it. If xlsx ever drops the probe (or moves it behind a feature flag), the alias can go — verify by rebuilding and checking that `(va = HM())` no longer appears near `.Readable` in the minified output.
- `useImportFlow.handleStudentFile` must call `loadExistingStudents()` (not a bare `fetch('/api/students-db')`) before `mergeStudents`. The bare fetch 404s on Vercel and causes silent duplicate creation. Same rule for any future code that needs the snake_case students baseline — go through the helper so the Supabase path is taken when a faculty session exists.
