# Architecture

A narrative overview for new contributors. For column-level schema reference see [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md). For commands, file inventories, decisions log, and per-feature rules see [`CLAUDE.md`](./CLAUDE.md).

---

## 1. Overview

A React + Vite tool for tracking NDA exam performance, used by LWS Pune teaching staff. Admins upload Excel result files from an OMR vendor (Evalbee), tag questions with chapter and subtopic metadata, and analyse student performance across exams, chapters, and time. Three additional read-only portals expose subsets of the data: a teacher portal (read-only across the cohort), a student portal (own results only, mobile-number login), and the developer console.

The application is a single React SPA. Different runtime modes are selected by hostname and Supabase session, not by separate builds. The same `dist/` artifact serves all four modes.

---

## 2. System topology

```
                              ┌────────────────────────────────────┐
                              │           SINGLE REACT SPA         │
                              │       (Vite build, served via      │
                              │        Vercel or GitHub Pages)     │
                              └───────────────┬────────────────────┘
                                              │
        ┌─────────────────────┬───────────────┼───────────────┬─────────────────────┐
        │                     │               │               │                     │
        ▼                     ▼               ▼               ▼                     ▼
  ┌──────────┐         ┌────────────┐  ┌────────────┐  ┌────────────┐         ┌──────────┐
  │ Dev      │         │ Online     │  │ Teacher    │  │ Student    │         │ Static   │
  │ Admin    │         │ Admin      │  │ Portal     │  │ Portal     │         │ GH Pages │
  │ localhost│         │ Vercel     │  │ Vercel     │  │ Vercel     │         │ (legacy) │
  └────┬─────┘         └─────┬──────┘  └─────┬──────┘  └─────┬──────┘         └──────────┘
       │                     │               │               │
       │ Vite plugin         │ Supabase Auth │ Supabase Auth │ /api/student-login
       │ /api/data           │ (email + pwd) │ role=teacher  │ serverless (mobile)
       ▼                     ▼               ▼               ▼
  ┌──────────┐         ┌──────────────────────────────────────────┐
  │ data/    │         │      SUPABASE PROJECT (Postgres)         │
  │ faculty- │         │ ────────────────────────────────────────│
  │ data.json│         │ faculty_state (JSONB)                   │
  │ (local)  │         │ exams, exam_results                     │
  └──────────┘         │ students, student_batches, _attendance  │
                       │ student_logins, students_meta           │
                       │ class_reports, student_plans            │
                       └──────────────────────────────────────────┘
```

Write path: dev mode writes to a local JSON file via a Vite plugin; production admin mode writes to Supabase. Teacher and student modes are read-only and never mutate state.

---

## 3. Data flow walkthrough — uploading an exam

A concrete trace that touches every layer.

1. An admin drops an Excel file (Evalbee results + tag sheet) into `UploadModal`. The browser parses both with `xlsx` ([`src/lib/excel.js`](src/lib/excel.js)), producing an in-memory `exam` object with `questions[]` and `students[]`.
2. The modal calls `addExam(exam)` on the Zustand store ([`src/store/slices/examsSlice.js`](src/store/slices/examsSlice.js)).
3. `addExam` is **dual-path**:
   - It updates the in-store `exams[]` array and calls `_save()` so the JSONB blob (in dev: `data/faculty-data.json`; in prod: `faculty_state.data`) reflects the change.
   - If a Supabase session is active, it also calls `upsertExam(supabase, exam)` from [`examSupabase.js`](src/store/slices/examSupabase.js), which writes the row to the normalised `exams` table and replaces the linked `exam_results` rows.
4. `saveToSupabase` strips `exams` (and `savedInsights`) from the JSONB blob before writing, so the normalised tables remain the source of truth for those domains.
5. A student now logs into the student portal with their mobile number. The frontend calls `POST /api/student-login` ([`api/student-login.js`](api/student-login.js)) — a Vercel serverless function. The function:
   - Normalises the mobile, queries `students` by `mobile`, gets the `lws_id` and `name_variants`.
   - Queries `exam_results WHERE student_name IN (canonical_name + variants)`, then `exams WHERE id IN (...)` to enrich with metadata.
   - Queries `student_attendance WHERE lws_id = ...`.
   - Fire-and-forgets an insert into `student_logins`.
   - Returns the full payload.
6. The student portal calls `loadStudentData(data)` on the store, which populates `exams[]` and `studentProfiles` in memory.
7. `StudentView` reads from the store, runs the analytics functions in [`src/lib/analytics/`](src/lib/analytics/), and renders.

The same `StudentView` component is used in all three portals — the data it receives is filtered by the mode-detection logic upstream.

**Student import follows the same dual-path shape.** Admin drops a Student Search List Excel; `useImportFlow.handleStudentFile` calls [`loadExistingStudents()`](src/lib/students/loadExistingStudents.js) (Supabase tables when a session is active, dev `/api/students-db` fetch otherwise) to obtain the baseline, runs [`mergeStudents`](src/lib/merge/mergeLogic.js) with the tiered match (EIS → mobile → name+branch), and renders a Step 3 preview that includes any `conflicts[]` for the admin to review before confirming. Confirm calls `importStudentsFromExcel` on the store, which upserts into `students` + `student_batches`.

---

## 4. The four runtime modes

| Mode | Hostname / Trigger | Auth | Capabilities | Storage |
|---|---|---|---|---|
| **Dev Admin** | `localhost` | None (assumed admin) | Full read-write | `data/faculty-data.json` via Vite `/api/data` plugin |
| **Online Admin** | Production hostname + Supabase session, no `role` metadata | Supabase Auth (email + password) | Full read-write | Supabase tables + JSONB blob (`faculty_state`) |
| **Teacher** | Production hostname + Supabase session with `user_metadata.role = 'teacher'` | Supabase Auth (email + password), individual accounts | Read-only across cohort, no edit UI | Reads `faculty_state` + `exams` + `exam_results` only; no writes |
| **Student** | Production hostname + `localStorage` session token | Mobile number via `/api/student-login` serverless (no Supabase Auth session) | Read-only, own data only | Server-rendered payload only; no direct DB access |

Mode is decided in [`src/App.jsx`](src/App.jsx) on every render based on `supabaseSession`, `studentData`, and the `user_metadata.role` claim. The chosen portal sets `ModeContext`, which propagates `'admin' | 'teacher' | 'student'` throughout the component tree. Component-level visibility decisions read from `useMode()`, never from `IS_READ_ONLY` (which only affects routing).

---

## 5. Storage architecture — why two patterns

The application uses **two storage patterns** in the same Supabase project. New contributors should understand when to use which.

### Pattern A — JSONB blob in `faculty_state`

A single row (`id=1`) with a `jsonb` column holding configuration-style state: the syllabus tree, timetable definitions, exam schedules, cost log, send history. Fire-and-forget UPDATE on every Zustand mutation.

Use this for state where:
- There is no need to query individual elements by ID from a serverless function
- The whole blob is read at session start and written as one unit
- Schema flexibility matters more than relational integrity (e.g. user-defined syllabus chapters)

### Pattern B — Normalised tables

Per-domain tables with explicit columns, FKs, and indexes. Currently: `exams` + `exam_results`, `students` + four child tables, and `class_reports` + `student_plans`.

Use this for state where:
- Serverless functions need to query by ID without loading the whole blob (e.g. `/api/student-login` filters exam results per student)
- The data is large enough that JSONB read/write cost matters (`exam_results` is 1636 rows and growing)
- History needs to be preserved (insights are insert-only)
- Foreign key integrity has real value

### Migration pattern

Moving a domain from Pattern A to Pattern B follows a standard sequence (see [`migrate_exams_to_supabase.js`](migrate_exams_to_supabase.js) and [`migrate_insights_to_supabase.js`](migrate_insights_to_supabase.js) for canonical examples):

1. Apply schema migration creating the new table(s) with RLS.
2. Write a re-runnable seed script with idempotency keys (`UNIQUE` constraints, `ON CONFLICT DO NOTHING`).
3. Make slice mutations dual-path: state always; Supabase table insert when a session is active.
4. Add a load function that reconstructs the in-store shape from the normalised tables.
5. Strip the domain from the JSONB blob in `saveToSupabase`.
6. Verify row counts match the source.
7. Run the cleanup SQL **manually** in the Supabase SQL editor (never automate destructive cleanup) — see the safety incident notes in [`CLAUDE.md`](./CLAUDE.md) decisions log.

For column-level shape see [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md).

---

## 6. Code map

```
src/
  App.jsx                  → Top-level mode dispatcher
  config.js                → IS_READ_ONLY, session keys, BASE_URL
  context/ModeContext.jsx  → ModeContext + useMode()
  lib/
    supabase.js            → Null-guarded Supabase client
    excel.js               → All Excel parsing (results, tags, students, attendance)
    analytics/             → Pure functions: getAtRisk, computeChapterStats, etc.
    merge/                 → Student deduplication, name-variant linking, and the import tiered match
    students/              → loadExistingStudents — dual-path (Supabase / dev fetch) baseline for the import flow
    examPdf.js             → jsPDF exam reports (WinAnsi-safe)
  store/
    useStore.js            → Zustand store assembler
    persist.js             → Dev-file / Supabase load+save dispatcher
    slices/                → One slice per domain (exams, students, insights, ...)
      examSupabase.js      → Supabase write helpers for the exams slice
      insightsSupabase.js  → Same pattern for insights
  pages/                   → Page components (Dashboard, Exams, Students, Insights, ...)
  components/              → Shared UI (ui/, layout/, upload/, auth/)
api/                       → Vercel serverless functions
  student-login.js         → Student auth + payload assembly
  send-whatsapp.js         → WhatsApp result-message dispatch
  data.js                  → Dev-only Vite endpoint for faculty-data.json
public/                    → Static assets
data/faculty-data.json     → Dev data store (gitignored)
students_db.json           → Student roster for Python scripts (gitignored)
migrate_*.js               → Re-runnable Supabase seed scripts
send_*.py                  → Python scripts: schedule emails, WhatsApp results
tests/                     → Python pytest tests
```

The single most important folder is `src/store/slices/`. Every domain (exams, students, attendance, insights, syllabus, timetable, NDA frequency tables, WhatsApp send history) is implemented as a slice. The dispatch pattern is uniform across all of them.

---

## 7. The slice pattern

Every domain follows the same three-layer pattern. Knowing this pattern means understanding 80% of the codebase.

### Layer 1 — Pure helper module (`<domain>Supabase.js`)

Stateless Supabase mutation functions. Take a Supabase client and an object; return a Promise. No dependency on the store. Unit-testable in isolation. Example: `upsertExam(supabase, exam)`, `insertStudentPlan(supabase, { studentName, text })`.

### Layer 2 — Slice (`<domain>Slice.js`)

Zustand slice factory. Each action is **dual-path**:

```js
async saveStudentPlan(name, text) {
  const generatedAt = new Date().toISOString()

  // Path A: always update state and trigger the JSONB save (dev mode persists here)
  set(s => ({ savedInsights: { ...s.savedInsights, studentPlans: { ...s.savedInsights.studentPlans, [name]: { text, generatedAt } } } }))
  get()._save()

  // Path B: also write to the normalised table when a Supabase session exists
  const session = await getSession()
  if (session) {
    try {
      await insertStudentPlan(supabase, { studentName: name, text, generatedAt })
    } catch (e) {
      console.error('[insightsSlice] Supabase insert failed:', e.message)
    }
  }
}
```

Path A keeps the dev workflow simple (one JSON file on disk). Path B keeps prod consistent with the normalised tables. The `getSession()` check distinguishes the two cleanly. Errors from path B are logged, not thrown — consistent with the fire-and-forget save semantics.

### Layer 3 — Load function (in `persist.js`)

`loadXFromSupabase()` reads the normalised tables, paginates if needed (the default Supabase select is capped at 1000 rows), and returns a shape that the store consumes. It is called once per session from `initStore()` (admin) or `TeacherPortal` mount (teacher) — **after** the JSONB blob has loaded — to overwrite stale fields in the blob with the canonical normalised data.

---

## 8. Open roadmap

Four significant pieces of design work are documented but not implemented. A new contributor should read these before proposing related changes.

- **Demo mode** — public read-only view of an anonymised topper student, gated by `?demo=true`. Four-phase plan agreed April 2026. See memory file `project_demo_mode.md`.
- **Branch/batch unification** — link the timetable, syllabus, and exam-schedule batch namespaces (currently independent strings) so the student portal can personalise its views to the logged-in student's branch and batches. Three-phase plan. See `project_branch_batch_plan.md`.
- **AI insights cadence** — the trigger event for generating new student plans is not decided (manual / post-test / calendar). The Supabase tables (`class_reports`, `student_plans`) and the slice are ready; the trigger and the student-portal surface are not. See `project_ai_insights_cadence.md`.
- **Multi-tenancy** — serving a second institute (inbound request 2026-06-06). **Not decided, not started.** The app is single-tenant with "authenticated-sees-all" RLS, so data cannot be co-mingled. Three paths (separate deployment per institute / true multi-tenant shared DB+codebase / paid copy); a shared-DB rebuild is ~5–8 weeks with break-even ≈ 3–4 institutes. Start with separate deployments. See `project_multi_tenancy.md`.

---

## 9. Where to start reading

In order, for a new contributor:

1. [`src/App.jsx`](src/App.jsx) — understand the mode dispatch first.
2. [`src/store/useStore.js`](src/store/useStore.js) and [`src/store/persist.js`](src/store/persist.js) — the store assembler and the load/save layer.
3. [`src/store/slices/examsSlice.js`](src/store/slices/examsSlice.js) + [`src/store/slices/examSupabase.js`](src/store/slices/examSupabase.js) — the canonical example of the dual-path pattern. Every other slice follows this shape.
4. [`api/student-login.js`](api/student-login.js) — the most complete example of a serverless function (auth, multi-table query, response shaping).
5. [`src/lib/analytics/index.js`](src/lib/analytics/index.js) — entry point to all derived metrics. The functions are pure; the page components compose them.
6. [`src/pages/Students/StudentView.jsx`](src/pages/Students/StudentView.jsx) — the largest page component. Shared across all three portals. Demonstrates `useMode()`-based visibility and the subject-filter pattern.
7. [`CLAUDE.md`](./CLAUDE.md) — the project conventions; [`DECISIONS.md`](./DECISIONS.md) — the decisions log; [`GUARDRAILS.md`](./GUARDRAILS.md) — the "what not to change" list.

---

## 10. Conventions

Project-level conventions and decisions are catalogued in [`CLAUDE.md`](./CLAUDE.md). The most consequential ones for a new contributor:

- **Test-first.** Tests are written before implementation, fail for the right reason, then are made to pass. Failing tests are usually stale tests, not broken components — see `feedback_test_fixes.md` in the memory directory.
- **Decisions log.** Non-obvious architectural choices are recorded in [`DECISIONS.md`](./DECISIONS.md) with the *why*. Add entries when making similar choices.
- **What not to change.** A list of behavioural invariants that have caused incidents in the past lives in [`GUARDRAILS.md`](./GUARDRAILS.md). Read it before touching `persist.js`, `studentSlice.js`, or any pagination-sensitive code.
- **Refactors require concrete problem evidence.** File size, repetition, and aesthetics alone do not justify restructuring. See `feedback_no_speculative_refactors.md`.
- **Migration safety.** Destructive cleanup SQL is never automated. Seed → verify row counts → run cleanup SQL manually. See `feedback_migration_safety.md`.

The repo also follows a separate set of global conventions (TDD, conventional commits, accessibility, security) maintained outside this project. A new contributor should read the parent CLAUDE.md file referenced in the project's setup documentation.

---

## 11. Mode-conditional visibility

Component-level visibility is decided with `useMode()` — **never** `IS_READ_ONLY` (which only affects data-path routing). The full per-feature matrix:

| Feature | Admin | Teacher | Student |
|---|---|---|---|
| Add/delete exams, re-upload, edit questions | ✓ | — | — |
| Daily Quiz page — author / publish / delete / Copy-link | ✓ | ✓ | — |
| Daily Quiz Results dashboard | ✓ | ✓ | — |
| Take a quiz (portal section or `?quiz=` link) | — | — | ✓ |
| WhatsApp Results button | ✓ | — | — |
| Send Exam Absence Alert (📵 button on Exams row) | ✓ | — | — |
| Edit student branch/batch | ✓ | — | — |
| Attendance page (import XLS + class metrics table) | ✓ | ✓ | — |
| Late marking widget (Attendance page) | ✓ | — | — |
| Lecture log tab (Attendance page) | ✓ | — | — |
| Homework / Notes tab (Attendance page) | ✓ | — | — |
| Hostel & Mess tab — marking + reconciliation + chain (Attendance page, APJ boarders) | ✓ | — | — |
| Send Late / Lecture-Miss / Homework notifications | ✓ | — | — |
| Recent incidents strip (StudentView) | ✓ | ✓ | ✓ (portal) |
| Missed exams card (StudentView) | ✓ | ✓ | ✓ (portal) |
| Exam Integrity panel (🕵 on Exams card) | ✓ | ✓ | — |
| Log "admitted" integrity incident (from panel) | ✓ | ✓ | — |
| Academic-integrity incidents card (StudentView) | ✓ | ✓ | ✓ (portal) |
| Integrity Incidents rollup widget (Dashboard) | ✓ | ✓ | — |
| Delete an integrity incident | ✓ | — | — |
| Attendance rings (student monthly % view) | ✓ (StudentView) | ✓ (StudentView) | ✓ (portal, inline scroll) |
| Syllabus Tracker (edit) | ✓ | — | — |
| Performance block (StudentView) — stat tiles (Latest Score / Exams Taken / Attempt Quality / Consistency) + ProjectedScoreCard | superadmin only (gated on `isSuperadmin`; regular admin, teacher, and student portal all hidden) | — | — |
| WrongAnswerAudit / UnattemptedAudit | ✓ | ✓ | ✓ |
| Download exam PDF | ✓ | ✓ | — |
| Toppers page | ✓ | ✓ | — |
| Syllabus Tracker (view) | ✓ | ✓ | — |
| Insights / API Costs pages | ✓ | — | — |
| Monthly Reports page (generate PDFs + ZIP) | ✓ | — | — |
| Settings page (Branches / Batches / Teachers / NDA Weightage / Monitoring / Mentorship) | ✓ | — | — |
| Mentorship nudge — dry-run preview / test send (Settings → Mentorship) | ✓ | — | — |
| Teacher Feedback page (view + import) | superadmin only (admin without role claim: hidden + RLS-blocked) | — | — |
| Timetable (edit cells, add slots) | ✓ | — | — |
| Send Schedule email button | ✓ | — | — |
| Sync teacher calendars (Timetable → Teacher Schedule) | ✓ | — | — |
| Exam Schedule (add/edit/delete, status cycle, send reminders) | ✓ | — | — |
| Exam Schedule (view) | ✓ | ✓ | — |
| Sidebar | ✓ | ✓ | — |

---

## 12. File reference (detailed)

The high-level code map is §6. This is the exhaustive file→purpose inventory (moved here from CLAUDE.md so the always-loaded file stays lean; CLAUDE.md keeps only the load-bearing subset). When a file is renamed or its purpose changes, update the row here.

| File | Purpose |
|---|---|
| `src/config.js` | Mode detection (`IS_READ_ONLY`), session keys (`SESSION_KEY`, `SESSION_DAYS`), app info |
| `api/student-login.js` | Vercel serverless — normalises mobile, matches it against each student's **own mobile OR `parent_mobiles[]`**, fetches `exam_results` + `exams` + `student_attendance` + `lecture_absences`; fire-and-forgets a `student_logins` insert; returns student data + `viaParent` + `integrityIncidents[]` (confirmed copying incidents, self-contained — exam name/date/evidence snapshotted on the row). Multi-match (siblings) → `{ multiple, candidates[] }` picker payload (no data, no login recorded); a supplied `lwsId` is honoured only if it's in the candidate set for that number |
| `create_teacher_account.js` | Admin script — creates/updates Supabase auth user with `role='teacher'` metadata. Usage: `node create_teacher_account.js <email> <password>` |
| `src/context/ModeContext.jsx` | `ModeContext` + `useMode()` |
| `src/store/useStore.js` | Zustand store assembler |
| `src/store/persist.js` | Dev: disk via Vite plugin. Prod admin: Supabase `faculty_state`. Teacher/student: no-op. |
| `src/lib/supabase.js` | Null-guarded Supabase client (returns `null` if env vars absent) |
| `src/stubs/empty.js` | One-line `export default {}` — aliased from `stream` in `vite.config.js` so xlsx's optional `require('stream')` short-circuits cleanly instead of throwing on Vite's externalised-module stub. |
| `vercel.json` | SPA rewrite rule — all non-`/data/|api/` paths → `index.html` |
| `api/send-whatsapp.js` | Vercel serverless function — verifies admin JWT, loads exam from `exams` table + results from `exam_results`, builds Wabridge payloads; mirrors the Vite dev endpoint at the same `/api/send-whatsapp` URL. The tracker-link variable is a **deep-link** `?mobile=<student>&exam=<exam.id>` built by `buildTrackerUrl`, used for **both** the student AND parent messages (parents were previously sent the bare URL). **The message name (var 1) is the matched profile's `canonical_name`** (2026-06-10), not the exam-sheet `student_name` — `student_name` is still used to look up the mobile/parent numbers (variant-aware) and in the result log lines; falls back to the sheet name when no profile matches. Accepts an optional `monitorMobiles[]` body param: after the student loop, on a **real** send (no `redirectTo`) it sends one random student's exact message to each monitor number via the shared `makeParamsForRow` builder, returns a separate `monitor` count + `MONITOR → …` log lines (see Settings → Monitoring). `send_results_whatsapp.py` mirrors this (incl. `--monitor`). |
| `api/send-late-notifications.js` | Vercel serverless — verifies admin JWT, loops `students[]` from request body, Wabridge template variables `[name, date]`. Requires `WABRIDGE_LATE_TEMPLATE_ID` env. Dev shim in `vite.config.js` dynamically imports the same handler so the endpoint works in `npm run dev` too. |
| `api/send-attendance-alerts.js` (`kind:'lecture'`) | Vercel serverless — verifies admin JWT, loops `students[]` from request body (each with `subjects[{subject, startTime?, endTime?}]`). Wabridge variables `[name, date, formatted]` where `formatted` is a comma-joined ASCII string `Subject HH:MM AM to HH:MM PM, …`. Requires `WABRIDGE_LECTURE_MISS_TEMPLATE_ID` env. Skips students with empty subjects. Same dev shim pattern as above. **This file also hosts the hostel warden alert (`kind:'hostel'`, row below) — two flows share one Serverless Function to stay under Vercel's 12-function Hobby cap; the top-level handler dispatches on `body.kind`.** |
| `api/send-homework-pending.js` | Vercel serverless — verifies admin JWT, loops `students[]` from request body (each with `items[{subject, chapter, type}]`). **One Wabridge message per (student, item)** to student mobile **+ each `parentMobiles[]`**. Positional variables `[name, subject, chapter, typeLabel]` (matches the approved single-item template; no date var). `asciiClean` strips unicode dashes/newlines from free-text subject + chapter. Requires `WABRIDGE_HOMEWORK_TEMPLATE_ID` env. Skips students with empty items. Dev shim in `vite.config.js`. |
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
| `src/store/slices/configSlice.js` | Central branches[] + unified `renameBatch` / `deleteBatch` / `branchInUseBy` / `batchInUseBy` (renameBatch also fires `cascadeBatchRenameToSupabase` so `student_batches` + `exams.batch` stay aligned) + `setMonitorMobiles(list)` (replaces `monitorMobiles[]`, normalises to last-10-digits, dedupes, persists). |
| `src/store/slices/batchSupabase.js` | `cascadeBatchRenameToSupabase(client, oldName, newName)` — fire-and-forget Supabase cascade for batch renames. Rewrites `student_batches.batch_name` (DELETE old + UPSERT new — PK is composite) and `exams.batch` (LIKE-narrow then exact-token replace via `getExamBatches` to avoid substring matches). No-op for empty/equal names or clientless calls. |
| `src/pages/Settings/` | Admin-only Settings page (`SettingsPage`, `BranchesTab`, `BatchesTab`, `TeachersTab`, `NdaWeightageTab`, `MonitoringTab`, `MentorshipTab`) |
| `src/pages/Settings/MonitoringTab.jsx` | Edits `monitorMobiles[]` (WhatsApp-result monitoring numbers) via `setMonitorMobiles` — add/remove 10-digit chips, dup-guarded, empty list disables monitoring. See Settings page → Monitoring. |
| `src/pages/Settings/MentorshipTab.jsx` | Admin control for the daily mentor nudge — calls `api/send-mentor-nudges` (admin JWT) with `{dryRun,force}` to preview today's picks per mentor, or `{redirectTo,force}` to send a non-destructive test. Also hosts `MenteeAssignments` (manage the roster: reassign/remove mentees + surface active students with no mentor). Renders the planned picks + endpoint log. See Settings page → Mentorship + Mentorship nudge section. |
| `src/store/slices/mentorSlice.js` | Admin CRUD for `mentor_assignments` (session-gated): `fetchMentorAssignments()` → `[{lwsId,teacherId}]`, `setMentorAssignment(lwsId,teacherId)` (upsert on `lws_id` PK = reassign), `removeMentorAssignment(lwsId)`. Consumed by `MenteeAssignments`. |
| `api/send-mentor-nudges.js` | Vercel serverless — the daily mentorship nudge. **Dual-auth**: Vercel cron (GET, `Authorization: Bearer <CRON_SECRET>`) for the real Mon–Fri send, or admin JWT (POST) for manual `{dryRun, redirectTo, force}`. Service-role reads (`mentor_assignments` + `students` for active filtering + `mentor_nudges` history + `faculty_state.timetableTeachers` for mobiles); excludes non-Active mentees; picks via `pickDailyMentees`; sends one Wabridge msg per mentor to their `mobile` with `[fmtNudgeDate(today), names.join(', ')]`. **Logs `mentor_nudges` only on a successful real send** (advances rotation); a `redirectTo` test send and `dryRun` never advance it. Dry-run works without the Wabridge template. Dev shim in `vite.config.js`. Env: `WABRIDGE_MENTOR_NUDGE_TEMPLATE_ID`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`. |
| `src/lib/mentorNudge.js` | Pure rotation engine: `pickDailyMentees(mentees, nudgeLog, {n,today,rng})` (count-tier round-robin — lowest nudge-count tier only, random tiebreak, short tail day = clean rounds, no cross-round overlap; idempotent + resumable within a day via `doneToday`), `fmtNudgeDate` ("22nd June 2026"), `isNudgeDay` (Mon–Fri), `istDateString` (IST send-day from a UTC instant). |
| `src/pages/MonthlyReports/` | Admin-only Monthly Reports page (`index`, `ReportRow`) — month/batch picker, cohort preview, per-row + bulk-ZIP PDF download |
| `src/lib/monthlyReportBuilder.js` | Pure `buildMonthlyReport({ profile, month, exams, attendance, lectureAbsences, examAbsences, batchChapterTimelines, syllabusPrograms })` + `getMonthlyReportCohort(profiles, batch, month)` |
| `src/lib/monthlyReportPdf.js` | `buildMonthlyReportPdfBlob(report, { remark })` + `downloadMonthlyReportPdf` + exported `attendanceDescriptor` helper. Dynamic jsPDF + autotable imports. |
| `src/lib/monthlyReportZip.js` | `buildMonthlyReportsZipBlob(items)` + `downloadMonthlyReportsZip(items, zipName)` + `zipFilename(batch, monthLabel)`. Dynamic JSZip import. |
| `src/store/slices/monthlyReportSlice.js` | `fetchMonthlyReportData(month, lwsIds)` — bulk reads `student_attendance`, `lecture_absences`, `exam_absences` for the cohort. Returns `{ attendanceByLwsId, lectureAbsencesByLwsId, examAbsencesByLwsId }` or `null` on error/no-session. |
| `src/pages/Timetable/` | TimetablePage (Student / Teacher Schedule / Subject Hours / Exam Schedule views; batch-tab reorder; 📅 Sync calendars), TimetableGrid, ExamScheduleView, AddExamScheduleModal, Edit/Add modals, SendScheduleModal, SyncCalendarModal |
| `src/lib/calendarSync.js` | Pure Google-Calendar reconcile: `buildTeacherBlocks` / `diffBlocks` / `toGCalEvent` (weekly RRULE, teacher attendee, signature). Keyed `teacherId\|timetableId\|slotId\|day` → teacher swap = release-old + add-new. |
| `api/sync-calendar.js` | Admin-gated calendar-sync endpoint: diff live timetable vs `teacher_calendar_blocks` ledger → create/patch/delete Google events; updates ledger on success. `dryRun` + per-teacher scope; idempotent. Dev shim in `vite.config.js`. |
| `api/_googleCalendar.js` | OAuth2 refresh-token Google Calendar REST client (`getAccessToken`, insert/patch/delete, `sendUpdates=none`). |
| `src/pages/Timetable/SyncCalendarModal.jsx` | Sync UI: dry-run preview (add/update/release counts) → apply → result; teacher-scope selector for a safe single-teacher first run. |
| `get_google_refresh_token.cjs` / `create_faculty_calendar.cjs` | One-time Google setup helpers (mint durable refresh token via loopback OAuth; create the faculty calendar) — both write straight into `.env.local`. |
| `src/pages/Exams/WhatsAppPreviewModal.jsx` | Pre-send review modal: editable student table (branch dropdown, mobile, parent mobiles), scope toggle for resend, test redirect-to field |
| `src/pages/Exams/WhatsAppResultsModal.jsx` | Post-send log modal — sent/skipped counts + per-line colour-coded log (incl. 👁 `MONITOR →` lines). Accepts `recipientLabel` prop (defaults to `'students + parents'`). |
| `src/pages/Exams/ExamAbsencePreviewModal.jsx` | Pre-send modal for exam absence alerts. Reads the persistent absentee list from `getExamAbsencesForExam(examId)` (self-heals via `syncExamAbsences` if the table is empty for a legacy exam). Joins with `studentProfiles` for contact info. One card per absentee with editable student `mobile` + `parent_mobiles`. Green "Notified" badge on rows whose `notified_at` is set. Same `failedNames` scope toggle + `bulkUpdateStudentContacts` persistence pattern as `LateNotificationPreviewModal`. |
| `src/store/slices/examAbsenceSlice.js` | `syncExamAbsences(examId)` — asymmetric reconciliation: read current absentee rows, compute target from `getExamAbsentees(exam, studentProfiles)`, DELETE only rows whose student NOW appears as an attendee (re-upload correction), INSERT new absentees, preserve rows for students who left the cohort but didn't attend (batch moves, deleted profiles) so historical absences aren't silently lost. Returns `{ added, removed, kept }`. Plus `getExamAbsencesForExam`, `getExamAbsencesForStudent(lwsId, sinceDate?)`, `markExamAbsencesNotified(examId, lwsIds)`. |
| `src/pages/Students/MissedExams.jsx` | Renders absences for one student on `StudentView`. Admin/teacher fetch via `getExamAbsencesForStudent(lwsId)`; student portal supplies the rows via `examAbsencesProp` (same prop-bypass as `RecentIncidents`). Joined with `exams[]` for the display name+date+batch. Hidden when empty. Notified badge per row. |
| `src/components/auth/LoginPage.jsx` | Two-tab login (Admin·Teacher / Student); Admin + Teacher share one Supabase auth form, routed by `user_metadata.role`; Student via `/api/student-login` (own or parent number). Renders the **sibling picker** when the endpoint returns `multiple`; choosing re-calls with the chosen `lwsId`. Restore passes stored `lwsId` |
| `src/components/upload/UploadModal.jsx` | 4-step add-exam modal (Evalbee MCQ) |
| `src/components/upload/OfflineExamModal.jsx` | Single-form "Add Offline Exam" modal — `Name,Marks` template upload + metadata (max marks, subject, batch, branch) + absentee opt-in; saves a `questions:[]` + `maxMarks` exam via `addExam(exam,{syncAbsences})` |
| `src/lib/excel.js` | Excel parsing (results, tags, student import, attendance import, **offline `parseOfflineResults` + `buildOfflineTemplateRows`**) |
| `src/lib/analyticsHelpers.js` | `stdDev`, `scoreColor`, `scoreBg`, **`examMaxMarks(exam)`** (the single %-of-max denominator: `exam.maxMarks ?? questions.length×marking.correct`) |
| `src/store/slices/attendanceSlice.js` | `importAttendance(parsed)` — mobile→lwsId matching, upsert to `student_attendance` with L-status protection. Also `markLate(lwsId, date)` / `unmarkLate(lwsId, date)` / `getLateStudentsForDate(date)` for the LateMarkingWidget, and `fetchDailyAttendance(date\|null)` → `{date, rows}` for the Dashboard roll-up (null → latest-date lookup, then paginated day read). |
| `src/store/slices/lectureAbsenceSlice.js` | `setLectureAbsenteesForPeriod(date, slotId, subject, lwsIds, { startTime?, endTime? })` (replace-set: delete by `(date, slot_id)` then insert; the time opts persist on the row for impromptu lectures, default null) / `getLectureAbsencesForDate(date)` (returns rows incl. `slot_id`, `start_time`, `end_time`) / `getLectureAbsencesForStudent(lwsId, sinceDate?)`. Tags inserts with `created_by` from the auth session email. |
| `src/store/slices/homeworkSlice.js` | `setHomeworkDefaultersForItem(date, subject, chapter, type, lwsIds)` (reconcile — preserves `resolved_at` on remaining rows, unlike lecture's delete-then-insert) / `resolveHomeworkItem(id)` / `reopenHomeworkItem(id)` / `getHomeworkForDate` / `getOpenHomeworkForBatch(lwsIds)` / `getHomeworkForStudent(lwsId, sinceDate?)` / `markHomeworkNotified(ids)`. Tags inserts with `created_by` from the auth session email. |
| `src/lib/homework.js` | UI helpers: `homeworkTypeLabel(type)`, `formatHomeworkItem(item)`, `homeworkItemKey(subject, chapter, type)`, `homeworkNotifyKey(lwsId, subject, chapter, type)` (per-(student,item) key for pending tracking). In-app display only (the ASCII wire format lives in `api/send-homework-pending.js`). |
| `src/store/slices/checkpointSlice.js` | Hostel/mess exception capture (APJ). `setCheckpointExceptions(date, checkpoint, exceptions[])` (delete-then-insert per (date,checkpoint); `exceptions` = `[{lwsId, status?, note?}]`) / `getCheckpointExceptionsForDate(date)` / `confirmRoll(date, checkpoint, {expectedCount, exceptionCount, confirmedPresent, branch?})` (roll-only; `reconciled` computed) / `getConfirmationsForDate(date)`. Exports `CAPTURE_CHECKPOINTS`, `ROLL_CHECKPOINTS`, `CHECKPOINT_STATUSES`. Validates checkpoint + status at the boundary; tags `created_by`. |
| `src/store/slices/leavesSlice.js` | Leave / out-pass (the honesty mechanism). `addLeave({lwsId, fromTs, toTs, type?, reason?})` (validates type + non-inverted window) / `getActiveLeaves(dayStartIso, dayEndIso)` (overlap query) / `deleteLeave(id)`. Exports `LEAVE_TYPES`. |
| `src/lib/analytics/chain.js` | Pure hostel daily-chain aggregator. `buildDailyChain({roster, attendanceRows, checkpointRows, onLeaveIds, order?})` → per-boarder `{statuses, anomaly, firstBreak, onLeave}`; `class` derived from `student_attendance`, leave overrides all checkpoints, anomaly = bare `absent`. `resolveOnLeave(leaves, dayStartMs, dayEndMs)` (day-overlap → Set of lwsIds). `buildWardenAlert(chainRows, dateLabel)` → `{count, listText, message}` for the warden WhatsApp. `CHECKPOINT_ORDER`, `CHECKPOINT_LABEL`. |
| `api/send-attendance-alerts.js` (`kind:'hostel'`) | Hostel warden alert (Phase 2). Admin-JWT POST (`{kind:'hostel', dryRun, redirectTo, date}`) — a bare GET routes here for the (unscheduled) cron — + cron-secret branch (not scheduled). Service-role reloads roster (APJ Active residential) + `student_attendance` + `checkpoint_absences` + `leaves` for the date, **re-computes the chain** (`buildDailyChain`), and WhatsApps `buildWardenAlert` output (`[date, listText]`) to `faculty_state.hostelAlertMobiles[]`. Fail-closed on `WABRIDGE_HOSTEL_ALERT_TEMPLATE_ID`; only sends when count>0 and a number exists; stateless. |
| `src/pages/Quizzes/` | Daily Quiz: `index.jsx` (list + Copy-link + Results), `QuizEditor.jsx` (manual MCQ authoring), `QuizResults.jsx` (per-quiz dashboard — per-question rows are click-to-expand, showing the question + options with the correct one highlighted + per-option pick % distribution; Attempted list has dedicated Branch/Batch columns via `attemptsWithProfile`), `StudentQuizzes.jsx` (portal section), `QuizLinkPage.jsx` (`?quiz=` focused page), `quizTaking.jsx` (shared QuizTaker/QuizReview). |
| `src/lib/quiz.js` | Pure quiz helpers: `gradeQuizAttempt`, `quizStatus`, `validateQuizForPublish`, `quizQuestionComplete`, `stripAnswerKey`, `LETTERS`, `DEFAULT_MARKING`. Reused server-side by the quiz endpoints. |
| `src/lib/quizStats.js` | Pure quiz dashboard analytics: `quizCohort`, `quizSummary`, `quizQuestionStats` (also returns per-option pick `dist{A-D}` + `skipped`), `quizNotAttempted`, `attemptsWithProfile` (joins each attempt's current branch + batches by `lwsId`, variant-keyed entries skipped). |
| `src/lib/remediation.js` | Pure builders for the cross-app "Learn this / Practice" links (2026-06-17) → PYQ Vault's `/go/learn` + `/go/practice` redirects (`PYQVAULT_URL`). Quiz side: `buildLearnUrl`/`buildPracticeUrl` (Maths-gated `PRACTICE_SUBJECTS`) + `practiceMistakesUrl`. Exam side: `examLearnUrl`/`examPracticeUrl`/`examRemediationLinks` (name-based; prefer the notes slugs when `parseTagsFile` provides `subtopicSlug`/`conceptSlug`). Consumed by `QuestionCard` (`showRemediation` prop) + `quizTaking` `QuizReview`. See `reference_remediation_links`. |
| `src/store/slices/quizSlice.js` | Quiz CRUD (dual-path; `_save()` only in the no-session branch — avoids teacher faculty_state clobber) + session-gated `getQuizAttempts` / `getQuizAttemptsForStudent`. |
| `src/store/slices/quizSupabase.js` | `buildQuizRow`, `upsertQuiz`, `deleteQuizById`. |
| `api/student-quizzes.js` | Student-facing (mobile, service-role): batch-filtered open quizzes with answer key stripped + done quizzes for review; returns `name`. |
| `api/quiz-submit.js` | Student-facing: server-side grade against the key, close-window + one-attempt enforcement, writes `quiz_attempts`. Imports `../src/lib/quiz.js`. |
| `src/pages/Students/StudentQuizHistory.jsx` | Per-student daily-quiz history card in `StudentView` (admin/teacher only). |
| `src/lib/teacherFeedback.js` | Pure feedback helpers: `FEEDBACK_DIMENSIONS`, `detectBlockStarts`, `parseFormTimestamp`, `reshapeFeedbackMatrix(matrix, teacherNames, {cycle,branch})` (wide→long), `aggregateFeedback(rows)`, `feedbackTrend(rows)`. |
| `src/store/slices/teacherFeedbackSlice.js` | `loadTeacherFeedback()` + `importTeacherFeedback(rows)`. Session-gated; `teacher_feedback` RLS (superadmin claim) is the real guard. |
| `src/pages/TeacherFeedback/index.jsx` | Superadmin-only page: per-teacher cards (overall, 8-dim bars, month-labelled trend, per-card date range, comments), worst-first, cycle + teacher filters. Guards on `isSuperadmin`. |
| `src/pages/TeacherFeedback/ImportFeedbackModal.jsx` | Upload Form export → `parseFeedbackExcel` → block→teacher mapping (datalist from `timetableTeachers`) + cycle/branch → preview → `importTeacherFeedback`. |
| `src/pages/Attendance/HomeworkLogTab.jsx` | Admin-only Homework / Notes tab: date+batch pickers, add-item form (subject datalist + free-text chapter + HW/Notes checkboxes), per-item cards (`Mark pending` → `MarkDefaultersModal`), `Open items` resolve list. Send button: first-send / `Notify N pending` / `✓ All N notified · Resend all` from `homeworkSendHistory[…].notifiedItemKeys` (pending = students with ≥1 un-notified open item). Sends only unresolved items. |
| `src/pages/Attendance/MarkDefaultersModal.jsx` | Searchable multi-select for one homework item (modeled on `MarkAbsenteesModal`). Draft checked-set spans all students; search filters visible only. |
| `src/pages/Attendance/HomeworkPreviewModal.jsx` | Pre-send modal (clone of `LectureMissPreviewModal`): editable mobile + parent_mobiles, redirect-to test field, **`notifiedItemKeys`** pending-only scope toggle (item-level — a partially-notified student's row shows/sends only un-notified items; row identity kept stable so edits still work), `bulkUpdateStudentContacts` before send. |
| `src/lib/timetable.js` | Pure `getTodaysLectures(timetable, date, mappings)` (ordered class periods for the weekday; skips `__span`/breaks/missing mappings; `[]` for Sunday/missing) + `getSubjectHoursByBatch(timetables, mappings, {branch})` (subject×batch weekly-hours pivot for the Subject Hours view). |
| `src/pages/Attendance/index.jsx` | Admin/teacher page: tab strip (Class metrics / Lecture log / Homework / **Hostel & Mess** — last three admin-only), `LateMarkingWidget` at top of Class metrics (admin), consecutive absences alert, paginated Supabase fetch, class avg/at-risk metrics, student table, Import XLS button, send-result Alert. |
| `src/pages/Attendance/HostelTab.jsx` | Admin-only Hostel & Mess tab (APJ boarders). Mark view: date + checkpoint pills, roster all-green with tap-to-cycle status (present→absent→sick→outpass), Save (`setCheckpointExceptions`), and a **reconciliation gate** on roll checkpoints (expected-in-dorm = roster − away; headcount → `confirmRoll`). Chain view: `buildDailyChain` anomaly board + open-roll banner. Roster scoped to `branch='APJ'` Active non-variant profiles. |
| `src/pages/Attendance/LateMarkingWidget.jsx` | Admin-only top-of-Attendance widget. Search + chip list + contextual send button (first-send, `Notify N pending`, or `✓ All N notified · Resend all`) computed from `lateSendHistory[date].notifiedLwsIds`; per-chip ✓ for notified. Each add/remove writes/deletes a `status='L'` row via `markLate`/`unmarkLate`. See "Pending-aware resend". |
| `src/pages/Attendance/LectureLogTab.jsx` | Date + batch pickers → per-period cards from `getTodaysLectures`, PLUS **impromptu (ad-hoc) lecture** cards. Cards key by `slot.id` (two same-subject periods stay independent). Click "Mark absentees" → `MarkAbsenteesModal` with `{slotId, subject}` context. **Impromptu:** "+ Add impromptu lecture" (subject required, time optional) mints an `adhoc_*` slotId; the card behaves like a timetabled one (+ a remove ×) and is reconstructed on reload from `adhoc_*` rows (subject + time live on the row). `lecturesBySlotId` merges timetabled + ad-hoc so ad-hoc absences reach the send payload. Send button: first-send / `Notify N pending` / `✓ All N notified · Resend all` from `lectureMissSendHistory[…].notifiedLwsIds`; passes `(absencesByLwsId, date, batchName)` up to parent. |
| `src/pages/Attendance/MarkAbsenteesModal.jsx` | Searchable multi-select scoped to one (date, slot). Search filters visible list but does NOT drop previously-checked students from the saved set. Save calls parent's `onSave(lwsIds)`. |
| `src/pages/Attendance/LateNotificationPreviewModal.jsx` | Pre-send modal for late notifications: editable mobile + parent_mobiles per student, redirect-to test field, Confirm/Cancel. Accepts **`notifiedLwsIds`** prop — when non-null shows an amber "Send to: Pending only (K) / All students (N)" scope toggle (default = **pending**, rows whose `lwsId ∉ notifiedLwsIds`) and filters both visible rows and wire payload by scope. Calls `bulkUpdateStudentContacts(edits)` before send. |
| `src/pages/Attendance/LectureMissPreviewModal.jsx` | Pre-send modal for lecture-miss: same shape as LateNotification (incl. **`notifiedLwsIds`** prop + pending-only scope toggle + `bulkUpdateStudentContacts`). Each row shows the comma-joined subjects-missed list with times (ASCII, no parens — see Wabridge rules above). Subjects forwarded to the endpoint as `subjects[{subject, startTime?, endTime?}]`. |
| `src/pages/Attendance/consecutiveAbsent.js` | Pure fn `buildConsecutiveAbsent(records, lwsIdToName, n)` — walks the global non-Sunday date sequence backwards from the latest known date, counting each student's consecutive `A` streak until the first `P` / `L` / missing record. Flags when streak ≥ n. Each result is `{ lwsId, name, since, count }` (`since` = earliest `A` in the actual streak; `count` = streak length in recorded non-Sunday days). Sorted by `count` desc, tiebreak name asc. The chip renders `since {date} ({count} days)`. |
| `src/pages/Attendance/AttendanceRings.jsx` | SVG donut rings per calendar month (R=40, stroke-dasharray arc); sorted latest-first; rendered inside `StudentView` (below exam data), visible in all three portals. Below each ring, up to four conditional chips: `Days late: N` (yellow), `Missed Lectures: N` (red), `Missed Exams: N` (dark red), `Homework: N` (orange — all flagged that month, resolved or not) — each clickable to expand an inline list (latest first). Single-open across the whole component (`expanded: { month, kind } \| null`). Accepts `attendance`, `lectureAbsences`, `examAbsences`, `exams`, `homework` props. Exam-absence rows are joined with `exams[]` for name/date (admin/teacher path), with fallback to row-level `exam_name`/`exam_date` (student portal path post-enrichment). **Chip palette is light-mode-tuned** (`bg-*-50/100`, `text-warning/danger/red-900`) — earlier dark-mode tints (`bg-*-400/10`, `text-*-300`) were unreadable on the app's white/pale surface. |
| `src/pages/Students/RecentIncidents.jsx` | Last 30 days of L markers (from `attendance` prop) + lecture absences + exam absences (fetched for admin/teacher via slice; supplied via `lectureAbsencesProp` / `examAbsencesProp` for the student portal — same prop-bypass pattern as `attendanceProp` in StudentView). Three chip styles, all light-mode-tuned (`bg-yellow-50/red-50/red-100`, `text-warning/danger/red-900`). Hidden when zero incidents. |
| `src/lib/analytics.js` | Analytics facade |
| `src/lib/analytics/dashboard.js` | Dashboard aggregates: `examAvgPct`, `getPerformanceSeries`, `getClassProjectedAvg`, `getPriorityChapters`, `getBatchComparison`. All pure; %-of-max is the only score unit. |
| `src/lib/analytics/examIntegrity.js` | Pure copying-detection: `buildExamIntegrityReport(exam, opts?)` → pairwise **shared-wrong-answer** analysis over `exam.students[].choices`. Tier A (near-identical papers: `diff ≤ 5 && sameWrong ≥ 8`), Tier B (z-score outlier ≥ 4 **gated by Harpp-Hogan ratio ≥ 1** so high-diff "hub" pairs / popular-distractor weak students are NOT flagged), union-find clusters, roll-adjacency, per-pair `sharedWrongQ` for drill-down. `available:false` for offline exams or pre-2026-06-10 uploads (no `choices` captured). Leads, not proof. |
| `src/pages/Exams/ExamIntegrityPanel.jsx` | 🕵 Integrity toggle on each exam card (admin + teacher; hidden for students). Renders flagged clusters/pairs with tier badge, rolls, %-scores, adjacent-seats pill, metrics, and a per-pair **Evidence** drill-down reusing `QuestionCard` (`studentAnswer`=shared wrong option). Each pair has a **one-click "[name] admitted"** action (resolves name→`lwsId` via `studentProfiles`, `window.confirm` guard, `logIntegrityIncident`) → "✓ logged" badge from `getIntegrityIncidentsForExam`. Standing "investigative leads, not proof" disclaimer. |
| `src/store/slices/integritySlice.js` | Academic-integrity incident CRUD (session-gated): `logIntegrityIncident(payload)` (upsert on `lws_id,exam_id`, stamps `created_by` from session email), `getIntegrityIncidentsForStudent(lwsId)`, `getIntegrityIncidentsForExam(examId)`, `getAllIntegrityIncidents()` (Dashboard rollup), `deleteIntegrityIncident(id)`. Writes `integrity_incidents`. |
| `src/lib/analytics/integrityLeaders.js` | Pure `buildIntegrityLeaders(rows, studentProfiles)` — groups `integrity_incidents` rows per student, ranked by incident count (repeat offenders first), with distinct-exam count + per-student exam list. Prefers the current profile's canonical name/branch, falls back to the row's snapshot `student_name` (works for deleted/inactive students). NOT Active-only (a record stands regardless of status). |
| `src/pages/Dashboard/IntegrityLeaders.jsx` | Dashboard "⚠ Integrity Incidents" rollup widget (admin + teacher, hide-when-empty). Fetches via `getAllIntegrityIncidents`; rows ranked repeat-first, expandable to the per-student exam list (exam · date · counterpart · status), click-through via `setActiveStudent`. |
| `src/pages/Students/IntegrityIncidents.jsx` | StudentView "⚠ Academic Integrity" card — hide-when-empty (like `MissedExams`). Admin/teacher fetch via `getIntegrityIncidentsForStudent`; student portal via `integrityIncidentsProp` (served by `api/student-login.js`). Lists exam · date · counterpart · evidence · note · recorder. **Delete (×) admin-only** (`mode === 'admin'`). |
| `src/lib/analytics/attendanceRollup.js` | Pure `buildAttendanceRollup({attendanceRows, studentProfiles, syllabusBatchBranches})` → `{branch:{batch:{male,female:{present[],absent[]}}}}`. Absent=`A`, Present=rest; Active-only; skips variant-keyed + batch-less profiles; multi-batch student counted per batch. |
| `src/pages/Dashboard/AttendanceRollup.jsx` | Per-branch attendance tables (side by side) with gender sub-columns + `▸` name drill-down + date picker. Class-wide for one day; ignores the page filter chain. |
| `src/pages/Dashboard/index.jsx` | Command-center page (KPI strip + trend + priority chapters + batch comparison + heatmap + at-risk + hardest-Q). Subject→branch→batch→exam filter chain. |
| `src/pages/Dashboard/{PerformanceTrend,PriorityChapters,BatchComparison}.jsx` | Dashboard widgets. `PerformanceTrend` is a hand-rolled SVG line chart (no chart lib). (`KpiStrip.jsx` deleted 2026-06-07.) |
| `src/pages/Dashboard/AttendanceLeaders.jsx` | Top-5 absent/late/lecture-miss/homework-miss boards w/ 7d/30d toggle. Class-wide + Active-only; fetch-on-demand via `fetchAttendanceLeadersData`. |
| `src/lib/analytics/attendanceLeaders.js` | Pure `buildAttendanceLeaders({attendanceRows,lectureRows,homeworkRows,studentProfiles,topN})` → `{absentees,late,lectureMiss,homeworkMiss}` (Active-only, variant-skip, count-desc/name-asc). |
| `src/pages/Students/FocusedExamResult.jsx` | ONE exam's report: score summary + own flat sequential `SimpleResultTable` (all Qs, "Show only wrong & skipped" toggle). Primary use = student-portal deep-link landing (`?exam=<id>`); **also reused faculty-side in `ExamHistoryTable`** — clicking an exam name expands the exact parent-facing report. Renders null when examId/exam/result missing. |
| `src/pages/Dashboard/FrequencyTableEditor.jsx` | Per-subject NDA weightage editor. Rendered by `Settings/NdaWeightageTab` (no longer on the Dashboard since 2026-06-01); file kept in its original folder. |
| `src/pages/Settings/NdaWeightageTab.jsx` | Settings → NDA Weightage tab — wires store props into `FrequencyTableEditor`. |
| `src/lib/ndaFreq.js` | `SUBJECTS`, `CONFIGURABLE_SUBJECTS`, `syncFreqChapters`, `getFreqForSubject`, `NDA_TOTAL_MARKS_BY_SUBJECT` |
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
| `send_results_whatsapp.py` | Wabridge WhatsApp result messages to students + parents. `--exam` / `--dry-run` / `--to` / `--redirect-to` / `--students "Name1,Name2"` / `--monitor "n1,n2"` (one random student's result copied to each monitor number; skipped on `--redirect-to`/`--to`). Payload: top-level `variables` array. Logs to `whatsapp_send_log.jsonl` (capped 500 entries). Triggered via `POST /api/send-whatsapp` in `vite.config.js`. |
| `send_schedule.py` | Gmail SMTP teacher schedule + exam reminder emails. `--weekly` / `--daily` / `--exam-reminder N` / `--dry-run` / `--to` / `--teacher-id`. Requires `tzdata`. |
| `generate_syllabus_seed.py` | Excel → `src/lib/syllabusSeed.js` |
| `merge_subtopics.py` | Re-runnable rename script: 54-entry `SUBTOPIC_RENAMES` (via `apply_renames`) + `CHAPTER_RENAMES` (via `apply_chapter_renames`) maps — updates `data/faculty-data.json`; run `merge:subtopics:sync` after to push to Supabase. Both maps invariant: no canonical is also a key (no chains). **Renaming a chapter here does NOT cascade to `ndaFreqBySubject` weightage rows** — `syncFreqChapters` would orphan the chapter's pct; rename the weightage key too (direct JSONB update) when a chapter rename has a freq row. |
| `migrate_subtopics_supabase.js` | Patches `exams.questions` JSONB in Supabase with the same subtopic + chapter rename maps (needs `SUPABASE_SERVICE_ROLE_KEY`); idempotent. **Renames across ALL subjects** (not Maths-only) — a generic variant string in a GAT/combined exam is renamed too, by design. |
| `migrate_unify_batches.js` | One-off (applied 2026-05-20): unifies `syllabusBatches[]` and `timetables[].batchName` to a 10-name `_A`/`_B` scheme; pre-creates B sections and `APJ_9th_Std`. **Idempotent — but the central list has been actively reshaped via Settings → Batches since.** Re-running would re-create the `_B` sections and `APJ_9th_Std` and rename current values back toward the 10-name scheme. Retained for archaeology; verify current Supabase state before considering a re-run. |
| `tests/test_subtopic_merge.py` | pytest tests for `merge_subtopics.py` subtopic + chapter rename logic |
| `data/faculty-data.json` | Primary dev data store (gitignored) |
| `students_db.json` | Student roster with mobiles (gitignored) |
