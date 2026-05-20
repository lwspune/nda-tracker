# Architecture

A narrative overview for new contributors. For column-level schema reference see [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md). For commands, file inventories, decisions log, and per-feature rules see [`CLAUDE.md`](./CLAUDE.md).

---

## 1. Overview

A React + Vite faculty tool for tracking NDA exam performance. Faculty upload Excel result files from an OMR vendor (Evalbee), tag questions with chapter and subtopic metadata, and analyse student performance across exams, chapters, and time. Three additional read-only portals expose subsets of the data: a teacher portal (read-only across the cohort), a student portal (own results only, mobile-number login), and the developer console.

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
  │ Faculty  │         │ Faculty    │  │ Portal     │  │ Portal     │         │ GH Pages │
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

Write path: dev mode writes to a local JSON file via a Vite plugin; production faculty mode writes to Supabase. Teacher and student modes are read-only and never mutate state.

---

## 3. Data flow walkthrough — uploading an exam

A concrete trace that touches every layer.

1. Faculty drops an Excel file (Evalbee results + tag sheet) into `UploadModal`. The browser parses both with `xlsx` ([`src/lib/excel.js`](src/lib/excel.js)), producing an in-memory `exam` object with `questions[]` and `students[]`.
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

---

## 4. The four runtime modes

| Mode | Hostname / Trigger | Auth | Capabilities | Storage |
|---|---|---|---|---|
| **Dev Faculty** | `localhost` | None (assumed faculty) | Full read-write | `data/faculty-data.json` via Vite `/api/data` plugin |
| **Online Faculty** | Production hostname + Supabase session, no `role` claim | Supabase Auth (email + password) | Full read-write | Supabase tables + JSONB blob (`faculty_state`) |
| **Teacher** | Production hostname + Supabase session with `user_metadata.role = 'teacher'` | Supabase Auth (email + password), individual accounts | Read-only across cohort, no edit UI | Reads `faculty_state` + `exams` + `exam_results` only; no writes |
| **Student** | Production hostname + `localStorage` session token | Mobile number via `/api/student-login` serverless (no Supabase Auth session) | Read-only, own data only | Server-rendered payload only; no direct DB access |

Mode is decided in [`src/App.jsx`](src/App.jsx) on every render based on `supabaseSession`, `studentData`, and the `user_metadata.role` claim. The chosen portal sets `ModeContext`, which propagates `'faculty' | 'teacher' | 'student'` throughout the component tree. Component-level visibility decisions read from `useMode()`, never from `IS_READ_ONLY` (which only affects routing).

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
    merge/                 → Student deduplication and name-variant linking
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

`loadXFromSupabase()` reads the normalised tables, paginates if needed (the default Supabase select is capped at 1000 rows), and returns a shape that the store consumes. It is called once per session from `initStore()` (faculty) or `TeacherPortal` mount (teacher) — **after** the JSONB blob has loaded — to overwrite stale fields in the blob with the canonical normalised data.

---

## 8. Open roadmap

Three significant pieces of design work are documented but not implemented. A new contributor should read these before proposing related changes.

- **Demo mode** — public read-only view of an anonymised topper student, gated by `?demo=true`. Four-phase plan agreed April 2026. See memory file `project_demo_mode.md`.
- **Branch/batch unification** — link the timetable, syllabus, and exam-schedule batch namespaces (currently independent strings) so the student portal can personalise its views to the logged-in student's branch and batches. Three-phase plan. See `project_branch_batch_plan.md`.
- **AI insights cadence** — the trigger event for generating new student plans is not decided (manual / post-test / calendar). The Supabase tables (`class_reports`, `student_plans`) and the slice are ready; the trigger and the student-portal surface are not. See `project_ai_insights_cadence.md`.

---

## 9. Where to start reading

In order, for a new contributor:

1. [`src/App.jsx`](src/App.jsx) — understand the mode dispatch first.
2. [`src/store/useStore.js`](src/store/useStore.js) and [`src/store/persist.js`](src/store/persist.js) — the store assembler and the load/save layer.
3. [`src/store/slices/examsSlice.js`](src/store/slices/examsSlice.js) + [`src/store/slices/examSupabase.js`](src/store/slices/examSupabase.js) — the canonical example of the dual-path pattern. Every other slice follows this shape.
4. [`api/student-login.js`](api/student-login.js) — the most complete example of a serverless function (auth, multi-table query, response shaping).
5. [`src/lib/analytics/index.js`](src/lib/analytics/index.js) — entry point to all derived metrics. The functions are pure; the page components compose them.
6. [`src/pages/Students/StudentView.jsx`](src/pages/Students/StudentView.jsx) — the largest page component. Shared across all three portals. Demonstrates `useMode()`-based visibility and the subject-filter pattern.
7. [`CLAUDE.md`](./CLAUDE.md) — the project conventions, decisions log, and the "what not to change" list.

---

## 10. Conventions

Project-level conventions and decisions are catalogued in [`CLAUDE.md`](./CLAUDE.md). The most consequential ones for a new contributor:

- **Test-first.** Tests are written before implementation, fail for the right reason, then are made to pass. Failing tests are usually stale tests, not broken components — see `feedback_test_fixes.md` in the memory directory.
- **Decisions log.** Non-obvious architectural choices are recorded in the "Decisions log" section of CLAUDE.md with the *why*. Add entries when making similar choices.
- **What not to change.** A list of behavioural invariants that have caused incidents in the past lives in CLAUDE.md. Read it before touching `persist.js`, `studentSlice.js`, or any pagination-sensitive code.
- **Refactors require concrete problem evidence.** File size, repetition, and aesthetics alone do not justify restructuring. See `feedback_no_speculative_refactors.md`.
- **Migration safety.** Destructive cleanup SQL is never automated. Seed → verify row counts → run cleanup SQL manually. See `feedback_migration_safety.md`.

The repo also follows a separate set of global conventions (TDD, conventional commits, accessibility, security) maintained outside this project. A new contributor should read the parent CLAUDE.md file referenced in the project's setup documentation.
