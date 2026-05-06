# NDA Maths Tracker — CLAUDE.md

## Project overview

A React + Vite faculty tool for LWS Pune to track NDA Maths exam performance.
Four runtime modes:

- **Faculty** (`localhost` / LAN): full read-write. Data in `data/faculty-data.json` via Vite plugin.
- **Online Faculty** (Vercel + Supabase): full read-write. Data in Supabase `faculty_state` JSONB row. Login via Supabase Auth (email/password). Live at `nda-tracker.vercel.app`.
- **Teacher** (GitHub Pages): read-only, password login decrypts `db.json` client-side.
- **Student** (GitHub Pages): read-only, mobile-number login, own data only.
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
| Deploy | GitHub Pages (`gh-pages`) for teacher/student; Vercel for online faculty |
| Backend | Supabase (Auth + `faculty_state` JSONB table + `students`, `student_batches`, `student_attendance`, `students_meta` tables) |
| Python crypto | `cryptography` (`pip install cryptography`), `tzdata` (`pip install tzdata`) |

## Key commands

```bash
npm run dev             # faculty mode, data saved to disk
npm run test            # Vitest
npm run test:watch
npm run split           # python -X utf8 split_students.py
npm run deploy          # split + build + gh-pages push
npm run results:preview # dry-run email — writes preview_<name>.html (gitignored; delete after review)
npm run results:email   # send result emails via Gmail
npm run migrate         # one-time: seed data/faculty-data.json → Supabase (needs SUPABASE_SERVICE_ROLE_KEY)
npm run migrate:students  # seed students_db.json → Supabase students tables (re-runnable, needs SUPABASE_SERVICE_ROLE_KEY)
npm run sync:students   # download Supabase → students_db.json (for Python scripts, needs SUPABASE_SERVICE_ROLE_KEY)
npm run lint
```

## Slash commands

| Command | Purpose |
|---|---|
| `/subtopic-analyse` | Near-duplicate subtopic names in `faculty-data.json`. Run after bulk tag uploads. |

---

## Architecture decisions

### Data persistence
- **Dev**: `data/faculty-data.json` via `POST /api/data` (Vite `localDataPlugin`). Bypasses 5 MB localStorage limit.
- **Prod online faculty** (Vercel): Two Supabase stores:
  - `faculty_state` JSONB row (`id=1`) — exams, syllabus, timetable, insights, etc. Fire-and-forget saves via `saveToSupabase` (session-gated).
  - Normalised student tables — `students`, `student_batches`, `student_attendance`, `students_meta`. Each mutation in `studentSlice.js` writes targeted rows; `loadStudentsFromSupabase()` is called on faculty login to populate `studentProfiles` in-store. Teacher/student portals never touch these tables (RLS: authenticated only).
  - `students_db.exams[]` is dead data — not mapped by any code path; dropped from Supabase schema.
- **Prod teacher**: sessionStorage (`TEACHER_SESSION_KEY`) — decrypted dataset only. Plain-text password never stored.
- **Prod student**: localStorage — session token only (`SESSION_KEY`), expires after `SESSION_DAYS`.
- `apiKey` is **never** persisted to disk or localStorage — memory only.

### Mode detection & routing
`src/config.js`: non-localhost hostname → `IS_READ_ONLY = true` (URL/routing only — never use for component visibility).
`ModeContext` (`src/context/ModeContext.jsx`) propagates `'faculty' | 'teacher' | 'student'` app-wide. Default is `'faculty'` so tests work without a Provider. Always use `useMode()` in components.

`src/App.jsx`: `supabaseSession` → `<OnlineFacultyPortal>`, `teacherData` → `<TeacherPortal>`, `studentData` → `<StudentPortal>`, neither → `<LoginPage>`. Each portal sets `ModeContext`. `sessionChecked` state prevents flash of login before `onAuthStateChange` fires.

**Hooks must be called before any early returns** — store is empty at first render in teacher mode; `loadRemoteData` fires after mount. All `useMemo` in Dashboard/Toppers is placed before early returns to prevent React error #310.

### Login (`src/components/auth/LoginPage.jsx`)
Three-tab unified login page (Student / Teacher / Faculty):
- **Faculty**: email + password → `supabase.auth.signInWithPassword()` → `onAuthStateChange` in `App.jsx` fires → `OnlineFacultyPortal` renders. No explicit success callback needed.
- **Teacher**: password → PBKDF2 key → AES-256-GCM decrypt `db.json` → store in sessionStorage.
- **Student**: mobile → SHA-256 → match `index.json` → fetch per-student file → store in localStorage.
- `?mobile=XXXXXXXXXX` param pre-fills mobile input (used in result emails for one-click login).

### Student split script (`split_students.py`)
Outputs `public/data/index.json`, `public/data/students/<lws-id>.json`, `public/data/db.json`.
- `lws_to_info` uses camelCase keys (`regDate`, `accountStatus`) from snake_case `students_db.json` fields.
- PBKDF2 iteration count (`100_000`) **must stay in sync** with `LoginPage.jsx` (`decryptDb`).

### Store (`src/store/useStore.js`)
State keys: `exams`, `studentProfiles`, `savedInsights`, `ndaFreqBySubject`, `ndaMarksBySubject`, `costLog`, `apiKey`, `lastDeployedAt`, `hydrated`, `syllabusPrograms`, `syllabusBatches`, `syllabusBatchBranches`, `batchProgramAssignments`, `batchSyllabusProgress`, `batchChapterTimelines`, `timetableTeachers`, `timetableMappings`, `timetables`, `examSchedules`, `whatsappSendHistory`.
Slices under `src/store/slices/`. All mutations call `get()._save()` immediately.
- `loadStudentData(data)` — student portal; `loadRemoteData(data)` — teacher portal.
- `loadRemoteData` sets all six syllabus keys (`syllabusPrograms`, `syllabusBatches`, `syllabusBatchBranches`, `batchProgramAssignments`, `batchSyllabusProgress`, `batchChapterTimelines`) from the decrypted payload.

### Subject filtering
Subject filter is **local state per page** — not in the store. Dashboard: subject → branch → batch → exam chain. Exams: sort + subject → branch → batch. StudentView: self-contained, shown when student has 2+ subjects.

### Batch filtering
Batch dropdown options and filter logic use **`profile.batches[]` as primary** (app-assigned), with `exam.batch` as fallback only for exams where no student has a profile.
- `getBatchOptions(exams, studentProfiles)` — builds dropdown options from profiles; falls back to `exam.batch` for unmatched exams.
- `getExamsForBatch(exams, studentProfiles, batchName)` — returns exams where ≥1 student has `batchName` in their `profile.batches[]`; falls back to `exam.batch` when no student has a profile.
- Both helpers live in `src/lib/analytics/filters.js` and are re-exported via `src/lib/analytics.js`.
- Used by Dashboard, Exams, and Toppers pages. Do not revert to filtering on `exam.batch` directly.

### Valid students & regDate filtering
Valid student = `studentProfiles` entry with non-empty `regDate`. Valid exam = `exam.date >= profile.regDate`. Students without `regDate` are excluded from class-level analytics. `accountStatus` is display-only.
Analytics functions (`getAllStudents`, `computeChapterStats`, `getAtRisk`, `getHardestQuestions`, `getToppers`) accept optional `validNames: Set | null` (`null` = no filter).

### Students page search
`src/pages/Students/index.jsx` builds the search list as a union of exam-appearing names **and** all `studentProfiles` names — so all 309+ registered students are searchable even if they have no exam records. **Only canonical (primary) names appear in search** — variant names (keys in `studentProfiles` where key ≠ `profile.name`) are filtered out before building the list. `StudentView` shows a profile card for students with no exams (early-return at `!allExamData.length` renders `<ProfileCard>` + empty state, not a blank screen).

**Name variant normalization in `StudentView`**: after the profile lookup, builds `allNames = Set([name, ...(profile?.nameVariants || [])])` and creates `normalizedExams` — a shallow in-memory copy where any student entry whose name is a known variant is renamed to the canonical name. All analytics (`getStudentExams`, `computeStudentChapterStats`, audits, etc.) then operate on the canonical name and find records regardless of which spelling appeared in the uploaded results. No-op when the student has no variants.

### Duplicate detection & name-variant linking (`src/lib/merge/`)

Six files under `src/lib/merge/`, re-exported as a flat API via `src/lib/mergeStudents.js`.

**Profile–profile dedup** (`deduplication.js`): `findDuplicateCandidates(snakeStudents, opts)` signals: Jaccard bigram similarity ≥ 0.75 (`name_similar`), all tokens of shorter name in longer name (`name_subset`, requires ≥ 2 tokens to avoid false positives on shared surnames), same mobile, same EIS. No `branchFilter` → flat cross-branch scan; specific `branchFilter` → within that branch only.

**Exam-name scanning** (`deduplication.js`):
- `getUnmatchedExamNames(exams, studentProfiles)` — exam names not yet indexed in `studentProfiles` (includes canonical name + all name variants as keys).
- `findExamNameCandidates(unmatchedNames, snakeProfiles)` — same signals, returns `{ examName, profile, score, reasons }[]`.

**Link action** (`studentSlice.js`): `addNameVariant(lwsId, variantName)` — appends exam name to `name_variants[]` in `students_db.json` and immediately re-indexes `studentProfiles` in memory.

**UI** (`FindDuplicatesTab.jsx`): combined scan runs both passes. Profile–profile pairs → merge (choose primary). Exam-name–profile pairs → "Link as variant" button (directional, exam name always goes into the profile). `ExamNameCard` uses dashed border + purple "exam name" badge + exam count. `pairKey` for exam pairs: `'exam:' + examName + '|' + lws_id`.

### WhatsApp Results flow
`💬 WhatsApp Results` button (faculty, Exams page) → `WhatsAppPreviewModal` (review + edit) → `POST /api/send-whatsapp` → `WhatsAppResultsModal` (log).

**Pre-send modal** (`WhatsAppPreviewModal.jsx`): rows built from `exam.students` + `studentProfiles`; branch dropdown (derived from `studentProfiles`), mobile + parent mobiles editable inline. Footer has optional "redirect all to" test field. On "Confirm Send": calls `bulkUpdateStudentContacts(edits)` (single fetch→patch→write to `students_db.json`), then POSTs `{ examName, redirectTo?, students? }` to `/api/send-whatsapp`.

**Send history** (`whatsappSendHistory` store key, `{ [examId]: { sentAt, sent, skipped, failedNames[] } }`): persisted to `faculty-data.json`. Button shows `💬 Sent N✓ M✗ · Resend` after first send. `failedNames[]` is parsed from log lines client-side (`SKIP Name —` and `FAIL → Name (student`).

**Resend scope toggle**: when `failedNames` is non-null (previous send exists), modal shows amber banner with radio: "Failed & skipped only (N)" (default) / "All students". Scope controls the `students[]` array forwarded to `--students` in the script.

**`--students` filter** in `send_results_whatsapp.py`: comma-separated names, case-insensitive; filters `results` list before the send loop. Forwarded from POST body by the Vite endpoint.

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
| Email Results button | hidden | — | — |
| Edit student branch/batch | ✓ | — | — |
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

---

## Key files

| File | Purpose |
|---|---|
| `src/config.js` | Mode detection, URL constants, session keys |
| `src/context/ModeContext.jsx` | `ModeContext` + `useMode()` |
| `src/store/useStore.js` | Zustand store assembler |
| `src/store/persist.js` | Dev: disk via Vite plugin. Prod faculty: Supabase `faculty_state`. Teacher/student: no-op. |
| `src/lib/supabase.js` | Null-guarded Supabase client (returns `null` if env vars absent) |
| `vercel.json` | SPA rewrite rule — all non-`/data/` paths → `index.html` |
| `migrate_to_supabase.js` | One-time seed script: `faculty-data.json` → Supabase (needs `SUPABASE_SERVICE_ROLE_KEY`) |
| `migrate_students_to_supabase.js` | Re-runnable seed: `students_db.json` → 4 Supabase tables (upsert; drops dead `exams[]`) |
| `sync_students_from_supabase.js` | Reverse sync: Supabase tables → `students_db.json` (for Python scripts) |
| `src/store/slices/syllabusSlice.js` | Syllabus CRUD + progress cycle |
| `src/store/slices/timetableSlice.js` | Timetable, slot, mapping, teacher CRUD |
| `src/pages/Timetable/` | TimetablePage, TimetableGrid, ExamScheduleView, AddExamScheduleModal, Edit/Add modals, SendScheduleModal |
| `src/pages/Exams/WhatsAppPreviewModal.jsx` | Pre-send review modal: editable student table (branch dropdown, mobile, parent mobiles), scope toggle for resend, test redirect-to field |
| `src/pages/Exams/WhatsAppResultsModal.jsx` | Post-send log modal — sent/skipped counts + per-line colour-coded log |
| `src/components/auth/LoginPage.jsx` | Three-tab login (Faculty/Teacher/Student); Supabase auth + AES-GCM decrypt |
| `src/components/upload/UploadModal.jsx` | 4-step add-exam modal |
| `src/lib/excel.js` | Excel parsing (results, tags, student import) |
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
| `src/store/slices/studentSlice.js` | `importStudentsDB`, `addNameVariant`, `mergeStudentProfiles`, `bulkUpdateStudentContacts`, branch/batch/mobile updates |
| `src/pages/Students/ManageBatchBranchModal.jsx` | Rename / Bulk Assign / Find Duplicates tabs |
| `src/pages/Students/batchBranch/FindDuplicatesTab.jsx` | Combined profile–profile + exam-name scan; merge and link-as-variant actions |
| `src/pages/Syllabus/` | SyllabusPage, SubjectAccordion, Manage*Modal, AssignProgramsModal |
| `split_students.py` | Pre-deploy: per-student files + encrypted db.json |
| `send_results.py` | Gmail SMTP result emails. `--dry-run` / `--to <addr>`. Reads `students_db.json` + `faculty-data.json`. |
| `send_results_whatsapp.py` | Wabridge WhatsApp result messages to students + parents. `--exam` / `--dry-run` / `--to` / `--redirect-to` / `--students "Name1,Name2"`. Payload: top-level `variables` array. Logs to `whatsapp_send_log.jsonl` (capped 500 entries). Triggered via `POST /api/send-whatsapp` in `vite.config.js`. |
| `send_schedule.py` | Gmail SMTP teacher schedule + exam reminder emails. `--weekly` / `--daily` / `--exam-reminder N` / `--dry-run` / `--to` / `--teacher-id`. Requires `tzdata`. |
| `generate_syllabus_seed.py` | Excel → `src/lib/syllabusSeed.js` |
| `data/faculty-data.json` | Primary dev data store (gitignored) |
| `students_db.json` | Student roster with mobiles (gitignored) |
| `teacher_password.txt` | Teacher password for db.json encryption (gitignored) |

---

## Tests

Setup: `src/test/setup.js`. `ModeContext` defaults to `'faculty'` — no Provider needed in tests.
Test files mirror source paths under `__tests__/`. Python tests under `tests/`. **387 tests passing** (as of 2026-05-06; 1 pre-existing failure in `Exams.test.jsx` — Email Results button hidden from UI).
Key coverage: analytics filters, GAT routing, tag validation, dashboard filters, Exams/Students/StudentView pages, re-upload modals, mergeStudents (incl. dedup signals, exam-name candidates, `addNameVariant`), split/send_results scripts, send_schedule (44 tests), timetableSlice (35 tests), studentSlice (6 tests).

**Mock completeness rules** (omitting these causes silent "0 tests" or TypeError at setup):
- Mock stores for pages using batch filtering must include `studentProfiles: {}`.
- `vi.mock('../../../lib/ndaFreq', ...)` must include `NDA_FREQ_BY_SUBJECT: {}` — `validateTags.js` imports it directly.
- `WrongAnswerAudit` + `UnattemptedAudit` + `ExamHistoryTable` all use `PAGE_SIZE = 5`.
- `syllabusSlice.test.js` mock state must include `syllabusBatchBranches: {}` and `batchChapterTimelines: {}` — `deleteSyllabusBatch` and `renameSyllabusBatch` destructure both.
- Async slice actions that call `fetch` (e.g. `addNameVariant`) must use `vi.stubGlobal('fetch', vi.fn(...))` with a `beforeEach(() => vi.restoreAllMocks())` guard — see `src/store/slices/__tests__/studentSlice.test.js`.
- `Exams.test.jsx` mock store must include `whatsappSendHistory: {}`, `bulkUpdateStudentContacts: vi.fn()`, and `setWhatsappSendHistory: vi.fn()` — all three are now read from the store at component mount.

## Lint

`npm run lint` — `eslint.config.js` (flat config). Current state: **2 errors** (unused vars in `Exams.jsx` from hidden Email Results button — pre-existing), **13 warnings** (all `react-hooks/exhaustive-deps` — intentional).

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

### GitHub Pages (teacher + student portals)
1. `npm run dev` — add exams, tag questions.
2. Create `teacher_password.txt` (absent → plain JSON, teacher login disabled).
3. `npm run deploy` — runs `split_students.py` → `vite build --base=/nda-tracker/` → push to `gh-pages`.

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
| Single JSONB row in Supabase vs normalised schema | 2.3 MB state blob migrates and evolves without SQL schema changes; relational normalisation (Phase 5) is deferred until there's a clear read-performance need. |
| Students use normalised tables; everything else stays in JSONB | Student mutations (batch assign, name variants, profile edits) were no-ops on Vercel because `/api/students-db` is a Vite-only dev plugin. Normalised tables fix this without migrating the full 2.3 MB state. Exam/syllabus/timetable data stays in `faculty_state` JSONB since it never had the same mutation gap. |
| `studentSlice.js` mutations use dual-path (Supabase if session, fetch if not) | Keeps dev workflow (local `students_db.json`) unchanged. No Vite config changes needed. The `getSession()` check is cheap — single Supabase client call. |
| `sync:students` as a manual step for Python scripts | Python scripts (`send_results.py`, `send_results_whatsapp.py`) read `students_db.json`. Rather than rewriting them to query Supabase, a one-command sync keeps the Python side unchanged. Only needed before sends when student profile data changed online. |
| `saveToSupabase` is fire-and-forget (no await) | Blocking the UI on every Zustand mutation would degrade responsiveness. Supabase writes are idempotent (last-write-wins on a single row); a dropped write is recovered on next mutation or reload. |
| Vercel `BASE_URL` approach instead of hardcoded `REPO_NAME` | `import.meta.env.BASE_URL` is set by Vite at build time — `vite build --base=/nda-tracker/` for GitHub Pages, default `/` for Vercel. Eliminates the two-file sync requirement. |

---

## What not to change

- Do not persist `apiKey` anywhere — memory only.
- Do not persist teacher password or derived key — only decrypted dataset in sessionStorage.
- Subject filter state is local per page — do not lift to Zustand.
- `StudentView` subject filtering is self-contained — no prop threading.
- Use `useMode()` for visibility — no new `IS_READ_ONLY` imports in components.
- `ModeContext` default is `'faculty'` — changing it breaks tests.
- PBKDF2 count (`100_000`) must match between `split_students.py` and `LoginPage.jsx`.
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
- `studentSlice.js` mutations must check `getSession()` before choosing Supabase vs fetch path — do not remove this dual-path logic. Dev mode depends on the fetch path; Vercel depends on the Supabase path.
- `loadStudentsFromSupabase()` must be called after `faculty_state` loads in `initStore()` — it overwrites the stale `studentProfiles` baked into `faculty_state` with fresh data from the normalised tables. Do not remove this call.
- `students_db.exams[]` must not be seeded into Supabase — confirmed dead data (no code path reads it). The normalised schema deliberately omits it.
- `student_batches` PK is `(lws_id, batch_name)` — to rename a batch, you must DELETE old rows and INSERT new ones; you cannot UPDATE the PK in place.
- `student_attendance` UNIQUE constraint is `(lws_id, date, batch)` — not just `(lws_id, date)` because a student can have multiple attendance records on the same date (different batches).
- Vercel env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` must be set in the Vercel dashboard; they are not in the repo. `src/lib/supabase.js` returns `null` when they are absent (safe no-op on dev/GH Pages).
