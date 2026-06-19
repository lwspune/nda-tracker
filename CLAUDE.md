# NDA Maths Tracker — CLAUDE.md

> **Companion docs:** [`README.md`](./README.md) — public-facing entry point and quick start. [`ARCHITECTURE.md`](./ARCHITECTURE.md) — narrative onboarding for new contributors. [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md) — column-level schema reference. [`OPERATIONS.md`](./OPERATIONS.md) — production triage runbook. [`SECURITY.md`](./SECURITY.md) — auth model, RLS, PII handling, secret management. [`FLOWS.md`](./FLOWS.md) — end-to-end per-feature flow walkthroughs (WhatsApp results, exam absences, late/lecture/homework notifications, Daily Quiz, Teacher Feedback, Monthly Reports). [`DECISIONS.md`](./DECISIONS.md) — long-form *why* trail for non-obvious architectural choices. [`GUARDRAILS.md`](./GUARDRAILS.md) — the "what not to change" list of behavioural invariants (read before touching persistence, slices, send endpoints, or analytics). This file is the operational reference for daily work (commands, conventions, the file/visibility maps).

## Project overview

A React + Vite faculty tool for LWS Pune to track NDA Maths exam performance.
Four runtime modes:

- **Admin** (`localhost` / LAN): full read-write. Data in `data/faculty-data.json` via Vite plugin.
- **Online Admin** (Vercel + Supabase): full read-write. Data in Supabase `faculty_state` JSONB row. Login via Supabase Auth (email/password); no `role` metadata on the user. Live at `nda-tracker.vercel.app`.
- **Superadmin** (Vercel + Supabase): Online Admin **plus** the Teacher Feedback page. Supabase account with `user_metadata.role='superadmin'`; routes through the admin portal, gated by the `isSuperadmin` flag + `teacher_feedback` RLS. See [`FLOWS.md`](./FLOWS.md) → Teacher Feedback.
- **Teacher** (Vercel + Supabase): read-only. Individual Supabase account with `user_metadata.role='teacher'`. Loads data via `loadFromSupabase()` on mount. Same login form as Admin — the role distinction is server-side metadata, not a UI choice.
- **Student** (Vercel): read-only, mobile-number login (own **or parent** number) via `/api/student-login` serverless function, one student's data only.
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
| Backend | Supabase (Auth + Postgres). **All 19 public tables** (load/save behaviour in Data persistence below): `faculty_state` (JSONB blob) · exams: `exams`, `exam_results` · students: `students`, `student_batches`, `student_attendance`, `students_meta`, `student_logins` · insights: `class_reports`, `student_plans` · events: `lecture_absences`, `homework_pending`, `exam_absences` · quiz: `quizzes`, `quiz_attempts` · `teacher_feedback` (superadmin-RLS) · `teacher_calendar_blocks` (Google-Calendar sync ledger, service-role-RLS) · mentorship: `mentor_assignments`, `mentor_nudges`. **Column-level schema for all tables: [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md)**; behavioural detail (write paths, send flows) in the Data persistence section below + [`FLOWS.md`](./FLOWS.md). |
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
npm run merge:subtopics       # python -X utf8 merge_subtopics.py — apply subtopic + chapter renames to data/faculty-data.json
npm run merge:subtopics:sync  # node migrate_subtopics_supabase.js — push subtopic + chapter renames to Supabase (needs SUPABASE_SERVICE_ROLE_KEY)
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
  - Normalised exam tables — `exams` (id, name, date, subject, batch, branch, marking JSONB, questions JSONB, created_at) + `exam_results` (exam_id FK ON DELETE CASCADE, student_name, roll_no, total_marks, correct, incorrect, not_attempted, responses JSONB, **`batch_at_exam`/`branch_at_exam`** — point-in-time cohort snapshot, see below). Written by `examsSlice.js` via `src/store/slices/examSupabase.js` helpers. Read via `loadExamsFromSupabase()` (paginated, 1000-row pages).
    - **Cohort snapshot (2026-06-06, capture-only).** `buildResultRows(exam, studentProfiles)` stamps each result row with the student's **current** batch (comma-joined `batches[]`) + branch *at upload time*; `upsertExam` threads `studentProfiles` from `examsSlice.addExam`/`replaceExam`. The exam is an immutable event, so the snapshot freezes — a later batch/branch move never rewrites it (re-upload *does* re-snapshot at that moment). NULL for older rows (pre-2026-06-06) and unmatched students. **No consumer — and a point-in-time consumer was explicitly declined as overengineering (2026-06-06).** The columns are kept as inert capture (cheap, frozen-on-write) in case true point-in-time cohort reporting is ever wanted — they can't be backfilled, so capturing now is the only way to leave that door open; it is NOT a planned feature. Live filters stay current-cohort (see "Batch filtering"). `loadExamsFromSupabase` does not load these columns into the store (nothing reads them in-app); do not add a reader without a fresh decision.
    - **Grading is Evalbee-authoritative, NOT key-derived (confirmed 2026-06-07).** `exam_results.responses` is `{ "<qno>": 1 | -1 | 0 }` (correct / wrong / not-attempted) — the **verdict**, not the chosen option. Computed at upload in `parseExcelFull` ([src/lib/excel.js](src/lib/excel.js) ~L104) as `responses[qn] = (!op) ? 0 : (mk > 0 ? 1 : -1)`, where `op` = the "Q N Options" column (chosen letter) and `mk` = Evalbee's "Q N Marks". The verdict is Evalbee's per-question mark. `total_marks` = `correct×marking.correct + incorrect×marking.wrong`. **`exams.questions[].answer`** (tags file, or Evalbee's `Q N Key`) drives the *displayed* correct answer + solution + per-question analytics — NOT student marks.
    - **Chosen options ARE now captured (2026-06-10):** `exam_results.choices` is `{ "<qno>": 'A'–'Z' | null }` — the student's picked letter (null = blank), written alongside `responses` by `parseExcelFull`/`buildResultRows`/`loadExamsFromSupabase`. Additive; `responses` is unchanged (zero analytics churn). NULL for rows uploaded before this date (re-upload the Evalbee XLS to backfill). This makes a corrected key **re-gradeable from the DB** — but the re-grade action itself is **not yet built** (deferred; full-recompute + preview model chosen). Until then a corrected `questions[].answer` still doesn't change marks, and a plain re-upload reproduces Evalbee's verdict. See [[reference_exam_grading_data_model]].
    - **The chosen letter is now displayed (2026-06-10):** `QuestionCard` already supported a `studentAnswer` prop (renders the pick in red + ✗ and a "Marked: X · Correct: Y" banner on wrong answers); it was previously fed `null` everywhere. Now the per-student builders thread `choices`: `getSubtopicQuestions` (→ WrongAnswerAudit + ChapterAccordion) and `getIssues` (→ ExamHistoryTable's `ExamIssuesPanel`, incl. the parent/student **FocusedExamResult** deep-link) attach `studentAnswer = student.choices?.[q]`. `api/student-login.js` now returns `choices` so the parent/student portal gets it. Aggregate views (`ExamInsightsPanel`) and skipped questions stay `null` (no single chosen option). Only lights up for exams that have `choices` (graceful null otherwise).
  - Normalised student tables — `students`, `student_batches`, `student_attendance`, `students_meta`. Each mutation in `studentSlice.js` writes targeted rows; `loadStudentsFromSupabase()` is called on admin login to populate `studentProfiles` in-store. Teacher/student portals never touch these tables (RLS: authenticated only). `student_attendance.status` accepts `P` / `A` / `-` / `L` — `L` = present but late to first lecture (faculty marks in-app from the LateMarkingWidget; see [`FLOWS.md`](./FLOWS.md) → Late marking & lecture-miss).
  - Normalised insights tables (Phase 6) — `class_reports` (id, exam_id text FK ON DELETE SET NULL, text, generated_at, generated_by) + `student_plans` (id, lws_id FK ON DELETE SET NULL, student_name NOT NULL, text, generated_at, generated_by). Insert-only (history preserved by never updating in place). Written by `insightsSlice.js` via `src/store/slices/insightsSupabase.js` helpers. Read via `loadInsightsFromSupabase()` which collapses to "latest per scope" — `{ classReport, studentPlans }` shape matches the legacy store. RLS: authenticated only.
  - `quizzes` + `quiz_attempts` — Daily Quiz (deliberately separate from `exams`). Written by `quizSlice.js`/`quizSupabase.js`; read via `loadQuizzesFromSupabase()`. Stripped from the JSONB blob in `saveToSupabase`, kept in `saveToStorage` (dev disk). See [`FLOWS.md`](./FLOWS.md) → Daily Quiz for the full schema + flow.
  - `lecture_absences (id uuid, lws_id FK ON DELETE CASCADE, date text, slot_id text NOT NULL, subject text, start_time text, end_time text, created_at, created_by)` — UNIQUE `(lws_id, date, slot_id)` (was `subject` until 2026-05-21 — see decisions log). Indexed on `date`, `(lws_id, date)`, and `slot_id`. Sparse event log: one row per (student, day, slot the student missed). `slot_id` is the **period identity**: the timetable's `timeSlots[].id` for scheduled lectures, or a minted `adhoc_*` id for **impromptu lectures** (not in the timetable, 2026-06-06). `subject` is persisted alongside so the message body can read it without a timetable join; `start_time`/`end_time` (nullable) persist an impromptu lecture's time (timetabled rows re-derive time from the timetable and leave these NULL). Faculty enters via the Lecture log tab on the Attendance page; replace-set semantics per "period card" via `lectureAbsenceSlice.setLectureAbsenteesForPeriod(date, slotId, subject, lwsIds, { startTime?, endTime? })`. RLS: authenticated only.
  - `homework_pending (id uuid, lws_id FK ON DELETE CASCADE, date text, subject text, chapter text, type text CHECK in ('homework','notes','both'), created_at, created_by, resolved_at, resolved_by, notified_at)` — UNIQUE `(lws_id, date, subject, chapter, type)`. Indexed on `date`, `(lws_id, date)`, `(lws_id, resolved_at)`. Sparse event log for incomplete homework/notes: one row per (student, day, subject, chapter, type) flagged. `chapter` is free text; `type='both'` covers homework+notes in one row. `resolved_at` stamps closure (student submitted) — the row is NEVER deleted by resolving, only stamped. Written by `homeworkSlice.js`; faculty enters via the **Homework / Notes** tab on the Attendance page. RLS: authenticated only. See [`FLOWS.md`](./FLOWS.md) → Homework / Notes.
  - `teacher_feedback (id uuid, cycle text NOT NULL, branch, submitted_at timestamptz, teacher_name text NOT NULL, clarity/engagement/support/feedback/pace/respect/organization/availability int 1-5, comment, created_at, created_by)` — one row per (form submission × teacher). **RLS: superadmin only** — policy checks `(auth.jwt() -> 'user_metadata' ->> 'role') = 'superadmin'`, so a normal admin cannot read it (the project's only role-restricted policy). Written by `teacherFeedbackSlice.importTeacherFeedback`. The Google Form is "wide" (Timestamp + repeated 9-col block per teacher); reshaped to long form by `src/lib/teacherFeedback.js`. See [`FLOWS.md`](./FLOWS.md) → Teacher Feedback + [`SECURITY.md`](./SECURITY.md).
  - `student_logins (id, lws_id, logged_in_at)` — one row per student login event. Written fire-and-forget by `api/student-login.js` after successful mobile auth. Read by `StudentView` (admin/teacher only) to show last-login and login count in `ProfileCard`.
  - `mentor_assignments (lws_id PK → teacher_id, created_at)` + `mentor_nudges (id, teacher_id, lws_id, date, created_at)` — the **mentorship daily-nudge** feature (2026-06-19). `mentor_assignments` is the teacher↔mentee map (one mentor per student; `lws_id` PK enforces it; seeded by SQL from the mapping file, then managed in-app via Settings → Mentorship → Mentee assignments using `mentorSlice`). `mentor_nudges` is a sparse event log that doubles as the **rotation cursor**: the daily pick = each mentor's active mentees ranked by past nudge **count** (lowest tier first, random tiebreak), so the log both audits and derives rotation — no stored queue, self-healing on roster changes. Both authenticated RLS; written by `api/send-mentor-nudges.js` via the service-role client. See the Mentorship nudge section below + [[reference_whatsapp_templates]].
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
- **Student**: mobile → `POST /api/student-login` → on success saves session to localStorage → `onStudentLogin(data)`. Session restore on mount re-calls the same endpoint with stored mobile **+ lwsId**. The number may be the student's **own** mobile OR any entry in `parent_mobiles[]` (parents reach their child's dashboard). When a number resolves to 2+ students (siblings sharing a parent number), the endpoint returns `{ multiple: true, candidates: [{lwsId, name, branch, batches}] }` and `LoginPage` shows a **sibling picker**; the chosen `lwsId` is re-sent and the response carries `viaParent`. See the `api/student-login.js` guardrails in [`GUARDRAILS.md`](./GUARDRAILS.md).
- `?mobile=XXXXXXXXXX` param pre-fills mobile input (used in result emails for one-click login).
- `?exam=<id>` (carried by the WhatsApp result deep-link) → after login, `StudentPortal` (in `App.jsx`) shows **only** `FocusedExamResult` for that exam (full per-exam report) + a **"View full performance ↓"** button that reveals the rest. Strips `?exam=` after first read. Unmatched/missing exam → normal full dashboard. A **parent-view banner** names the child when `viaParent`, and the child's name shows in the top bar. See the `api/student-login.js` / FocusedExamResult guardrails.

### Student split script (`split_students.py`)
**Legacy** — output files (`public/data/index.json`, `public/data/students/*.json`, `public/data/db.json`) are no longer consumed by teacher or student login (both now use Vercel + Supabase). Script still updates `lastDeployedAt` in `faculty-data.json` and can regenerate static files if needed. Removed from `predeploy` — run manually via `npm run split`.

### Store (`src/store/useStore.js`)
State keys: `exams`, `quizzes`, `studentProfiles`, `studentList`, `savedInsights`, `ndaFreqBySubject`, `ndaMarksBySubject`, `costLog`, `apiKey`, `lastDeployedAt`, `hydrated`, `syllabusPrograms`, `syllabusBatches`, `syllabusBatchBranches`, `batchProgramAssignments`, `batchSyllabusProgress`, `batchChapterTimelines`, `timetableTeachers`, `timetableMappings`, `timetables`, `examSchedules`, `whatsappSendHistory`, `lateSendHistory`, `lectureMissSendHistory`, `examAbsenceSendHistory`, `homeworkSendHistory`, `branches`, `monitorMobiles` (WhatsApp-result monitoring numbers, seeded `['9021869427']`), `isSuperadmin` (session-derived, not persisted), `activePage`, `activeStudent`.

`studentList` is the raw snake_case array set by `importStudentsDB` (alongside the canonical-name-keyed `studentProfiles` map). Not persisted — reloaded from Supabase / `students_db.json` each session. Required by `FindDuplicatesTab` so two profiles sharing the same `canonical_name` are both visible to the scan (the map collapses them to one key).
Slices under `src/store/slices/`. All mutations call `get()._save()` immediately.
- `loadStudentData(data)` — student portal; `loadRemoteData(data)` — teacher portal.
- `loadRemoteData` sets all six syllabus keys (`syllabusPrograms`, `syllabusBatches`, `syllabusBatchBranches`, `batchProgramAssignments`, `batchSyllabusProgress`, `batchChapterTimelines`) from the decrypted payload.

### Subject filtering
Subject filter is **local state per page** — not in the store. Dashboard: subject → branch → batch → exam chain. Exams: sort + subject → branch → batch. StudentView: self-contained, shown when student has 2+ subjects. **`StudentView` and `Toppers` default to `'Maths'`** (not `'all'`) — the projected NDA score is per-subject (Maths = 300, GAT = 600…), so `'all'` would silently project the dominant subject; defaulting to Maths makes it explicit.

**`effectiveFilter`/`effectiveSubject` snap-to-all:** in `StudentView.jsx` (and `Toppers/index.jsx`), the subject dropdown is bound to a derived `effectiveSubject`, not `subjectFilter` directly. When the state holds a subject that isn't in the in-scope subjects (e.g. default `'Maths'` for a GAT-only student, or a batch with no Maths exams), it resolves to `'all'`. When the state holds a subject that isn't in `studentSubjects[]` (e.g. default `'Maths'` for a GAT-only student), `effectiveFilter` resolves to `'all'`. Without this guard, `<select value="Maths">` with no matching option visually falls back to displaying its first option (`"All Subjects"`) while state stays `'Maths'` — the empty-state then reads "No Maths exam records" and contradicts the dropdown. Snapping at the derived level (not via `setSubjectFilter` in an effect) avoids a render loop and keeps subject state stable when the user has just deselected manually.

### Batch filtering
Batch dropdown options and filter logic use **`profile.batches[]` as primary** (app-assigned), with `exam.batch` as fallback only for exams where no student has a profile.
- `getBatchOptions(exams, studentProfiles)` — builds dropdown options from profiles; falls back to `exam.batch` for unmatched exams.
- `getExamsForBatch(exams, studentProfiles, batchName)` — returns exams where ≥1 student has `batchName` in their `profile.batches[]`; falls back to `exam.batch` when no student has a profile. `getExamsForBranch(exams, studentProfiles, branchName)` is the branch parallel (roster-based on current `profile.branch`, not the `exam.branch` tag — so a moved student's earlier-branch exams are still in scope).
- All live in `src/lib/analytics/filters.js`, re-exported via `src/lib/analytics.js`. Used by Dashboard, Exams, Toppers. Do not revert to filtering on `exam.batch`/`exam.branch` directly.

**Student-centric (current-members) filtering on Toppers + Dashboard (2026-06-06).** A batch/branch filter means *"students whose **current** batch/branch is X,"* scored over their full exam history — NOT "everyone who sat an exam involving X." This is robust to **moves**: a student who moves into batch/branch X surfaces there with their full history; one who moves out drops off; a cross-cohort co-attendee of a combined exam is excluded. Implemented by intersecting the analytics `validNames` set with `getBatchMemberNames(studentProfiles, batch)` and/or `getBranchMemberNames(studentProfiles, branch)` (exam-record names — canonical + every `nameVariant` — of current members; skip variant-keyed map entries via `p.name === key`). Branch/batch *exam-scoping* (`getExamsForBranch`/`getExamsForBatch`) still narrows the exam set (roster-based, so it ⊇ the members' exams), but the **student restriction is the `validNames` intersection**. The Exams *page* stays exam-roster-centric (it lists exams, where the historical lens is right). Trade-off accepted: cohort views show each current member's full history regardless of which batch/branch they sat each exam under — that's what makes moves clean. See [[feedback_current_cohort_over_exam_roster]].

### Valid students & regDate filtering
Valid student = `studentProfiles` entry with non-empty `regDate`. Valid exam = `exam.date >= profile.regDate`. Students without `regDate` are excluded from class-level analytics. `accountStatus` drives the exam-absence cohort gate (only `'Active'` students are flagged; see the EIS+Active gate in `getExamAbsentees` below); class-level analytics still ignore it.
Analytics functions (`getAllStudents`, `computeChapterStats`, `getAtRisk`, `getHardestQuestions`, `getToppers`) accept optional `validNames: Set | null` (`null` = no filter).

### Dashboard — faculty command center (2026-06-01 rebuild)
`src/pages/Dashboard/index.jsx` composes longitudinal + comparative + cross-cutting analytics that the other pages don't cover. The old page (raw "Avg Score" KPI + heatmap + at-risk + hardest-Q + freq editor) was replaced. Same subject → branch → batch → exam filter chain at top.

- **Pure aggregates** in [`src/lib/analytics/dashboard.js`](src/lib/analytics/dashboard.js) (composed from existing primitives): `examAvgPct(exam, nameFilter?)` → `{avgPct, n, maxMarks}` (the comparable **%-of-max** = `score/(questions.length×marking.correct)`); `getPerformanceSeries(exams, nameFilter?)` → chronological per-exam avg%; `getClassProjectedAvg(exams, ndaFreq, totalMarks, opts)` → mean projected NDA score (reuses `getToppers` threshold-0 so regDate scoping is identical to Toppers); `getPriorityChapters(exams, ndaFreq, totalMarks, opts)` → weak×high-yield ranked by `weightPct×(1−accuracy)`; `getBatchComparison(exams, studentProfiles, ndaFreq, totalMarks)` → per-batch avg%/projected/at-risk, worst-first.
- **Widgets** (`src/pages/Dashboard/`): `PerformanceTrend` (hand-rolled SVG line chart — no chart lib — + `computeTrend` badge), `PriorityChapters` + `BatchComparison` tables, plus the retained chapter heatmap and hardest-questions table. **At-Risk rows click through to the student** via `setActiveStudent(name)` (which flips `activePage='students'` + opens the detail view). **The `KpiStrip` was removed 2026-06-07** (file deleted) — the Registered/Latest-Avg/Projected/At-Risk strip wasn't useful; `getClassProjectedAvg` still lives in `dashboard.js` (tested) but is no longer surfaced on the page.
- The weightage subject for projection + priority is the page subject filter, defaulting to `'Maths'` when `'all'`; freq rows come from `getFreqForSubject(ndaFreqBySubject, subject)`.
- **Attendance roll-up** (`AttendanceRollup.jsx`, 2026-06-06) — rendered above `PerformanceTrend`. Class-wide for ONE recorded day (deliberately ignores the page's subject/branch/batch/exam filter chain — attendance isn't exam-scoped). One table **per branch, side by side**; rows = batches; columns **Present / Absent / Total**, each split Male/Female. Every numeric cell (incl. the per-branch **Total** footer row) has a `▸` drill-down to the names behind the count (single-open across the whole widget, mirrors `AttendanceRings`). **Absent = status `A`; Present = everyone else** (P / L / `-` / no record); **Active-only** cohort; branch grouping via `syllabusBatchBranches` (falls back to `profile.branch`). Batches sort **lower→higher std** (`batchStdRank` = number before "th": 9th<10th<11th<12th; non-numbered programs 2Y/6M/CDS rank last, alphabetical). Each **branch heading shows the active headcount** in parens — e.g. `APJ (159)` / `LWS Pune (91)` (present + absent, both genders). Date defaults to the **latest recorded day**, changeable via a date picker. Pure aggregator `buildAttendanceRollup({attendanceRows, studentProfiles, syllabusBatchBranches})` in [`src/lib/analytics/attendanceRollup.js`](src/lib/analytics/attendanceRollup.js); day fetch via `attendanceSlice.fetchDailyAttendance(date|null)` (null → latest-date lookup + paginated day read).
- **Attendance leaders** (`AttendanceLeaders.jsx`, 2026-06-07) — rendered below `AttendanceRollup`. Four **top-5** boards (Most Absent · Most Late · Most Lectures Missed · Most Homework/Notes Missed) over a **Last 7 / Last 30 days** toggle (default 30). **Class-wide + Active-only** (ignores the page filter chain, like the roll-up); homework counts **all flagged** items. Rows click through via `setActiveStudent`. Pure aggregator `buildAttendanceLeaders({attendanceRows, lectureRows, homeworkRows, studentProfiles, topN=5})` in [`src/lib/analytics/attendanceLeaders.js`](src/lib/analytics/attendanceLeaders.js) (count desc / name asc, variant-skip, Active-only); windowed bulk fetch via `attendanceSlice.fetchAttendanceLeadersData(sinceIso)` (paginated reads of `student_attendance` A/L, `lecture_absences`, `homework_pending`; session-gated; not stored).
- **Deferred (flagged, not built):** operational strip (upcoming exams), batch syllabus-pace column, per-batch trend overlay.

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

### Feature flows → [`FLOWS.md`](./FLOWS.md)
The end-to-end walkthroughs for the parent-/student-facing feature flows live in **[`FLOWS.md`](./FLOWS.md)**: WhatsApp Results · Exam absences (event log + alert) · Late marking & lecture-miss · Homework / Notes · Teacher Feedback · Daily Quiz · Monthly Reports. This file keeps the cross-cutting conventions and the file/visibility maps; the invariants live in [`GUARDRAILS.md`](./GUARDRAILS.md).

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

### Syllabus Tracker (`src/pages/Syllabus/`)
Tracks teaching progress per batch, independent of exam data.

**Data model**: `syllabusPrograms` — `{ id, name, trackingColumns[], subjects[{ id, name, chapters[{ id, name, group }] }] }`. `syllabusBatches` — `string[]` (user-managed, independent of exam batches). `syllabusBatchBranches` — `{ batchName: branchName }` (optional per-batch branch tag). `batchProgramAssignments` — `{ batchName: [programId] }`. `batchSyllabusProgress` — `{ batchName: { programId: { subjectId: { chapterId: { col: status } } } } }`. `batchChapterTimelines` — `{ batchName: { programId: { subjectId: { chapterId: "YYYY-MM" } } } }` — per-batch scheduled month for each chapter.

**Status cycle**: `null → 'In Progress' → 'Done' → null` (admin only). Seed data in `src/lib/syllabusSeed.js` (generated by `generate_syllabus_seed.py`) auto-loaded when `syllabusPrograms` is empty.

**Chapter timeline**: `setChapterTimeline(batchName, programId, subjectId, chapterId, "YYYY-MM")` / `getChapterTimeline(...)` in `syllabusSlice.js`. Displayed in `SubjectAccordion` as a fixed "Timeline" column (before tracking columns) showing `"Jun 2026"` format. Faculty clicks cell → inline `<input type="month">`; teacher sees read-only. `clearSubjectProgress` does NOT clear timelines — resetting tracking status keeps the planned schedule. Timeline is batch-level (different batches may have different schedules for the same chapter).

**Batch tabs** come from `syllabusBatches` — standalone list independent of `exams[].batch` or `studentProfiles[].batches`. Admin can add, rename, and delete batches from the tab bar. `AssignProgramsModal` selects from this list only (no inline batch creation). Migration: on first load, if `syllabusBatches` is empty, seeded from `Object.keys(batchProgramAssignments)`. Chapters support optional `group` string for section headers.

**Branch filter**: branch pills above batch tabs are sourced from `timetables[].branch` (same source as TimetablePage/ExamScheduleView). `syllabusBatchBranches` maps batch names to branches — set via `setSyllabusBatchBranch(batchName, branch)` or the ⋯ menu "Set branch" option. When adding a batch with a branch filter active, the batch is auto-tagged to that branch.

Syllabus batch mutations: `addSyllabusBatch`, `renameSyllabusBatch` (cascades to assignments + progress + `syllabusBatchBranches` + `batchChapterTimelines` keys), `deleteSyllabusBatch` (cascades all four) — all in `syllabusSlice.js`. `deleteProgram`, `deleteSubject`, `deleteChapter` also cascade to `batchChapterTimelines`.

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
`src/pages/Settings/SettingsPage.jsx` is admin-only and the **only** place branches, batches, and teachers can be added / renamed / deleted. Six tabs:
- **Branches** — reads/writes `branches[]` (top-level store key, seeded on first load from the union of `timetables[].branch` + `Object.values(syllabusBatchBranches)`). `addBranch` / `renameBranch` (cascades to `timetables[].branch`, `examSchedules[].branch`, `syllabusBatchBranches` values) / `deleteBranch` (blocks when in use; returns `{ ok, usage }`). `students.branch` and `exams.branch` are NOT cascaded — they were one-off-aligned via SQL on 2026-05-21 and the Evalbee XLS doesn't carry branch, so they stay stable. Future central renames would leave those untouched; rerun SQL if needed.
- **Batches** — reads `syllabusBatches[]` ∪ `timetables[].batchName` (union so drift is visible). `addBatch(name, branch)` **requires** both name AND a branch that exists in `branches[]` (returns `{ ok, reason }`); the unified `renameBatch(old, new)` delegates to both `renameSyllabusBatch` AND `renameTimetableBatch` AND fires the Supabase cascade for `student_batches` + `exams.batch` via `cascadeBatchRenameToSupabase`; `deleteBatch` blocks when a timetable or exam-schedule still references the batch (returns `{ ok, usage }`). Each existing batch row has an inline branch dropdown so reassigning is a single click. The "no branch" choice no longer exists in the UI.
- **Teachers** — same actions as the slice exposes (`addTimetableTeacher` / `updateTimetableTeacher` / `deleteTimetableTeacher`). The legacy `ManageTeachersModal.jsx` was deleted (2026-05-20); the "Manage Teachers" button on the Timetable page is gone.
- **NDA Weightage** (2026-06-01) — `NdaWeightageTab` hosts `FrequencyTableEditor` (per-subject NDA chapter weightage `[{chapter, pct}]` + `ndaMarksBySubject` totals). Moved off the Dashboard in the command-center rebuild — it's config, not overview. The editor file still lives under `pages/Dashboard/`; the tab just wires store props into it.
- **Monitoring** (2026-06-16) — `MonitoringTab` edits the top-level `monitorMobiles[]` store key (seeded `['9021869427']`) via `setMonitorMobiles(list)` (configSlice; normalises each to last-10-digits, dedupes, drops non-10-digit, persists). On **every real WhatsApp result blast**, `api/send-whatsapp.js` sends a copy of **one random student's** result message to each monitor number (process observability only — does not change what students/parents receive). **Skipped on test sends** (`redirectTo` set) and when the list is empty. Returns a separate `monitor` count + `MONITOR → <num> (sample: <name>)` log lines (styled 👁 in `WhatsAppResultsModal`). Parity in the Python path: `send_results_whatsapp.py --monitor "n1,n2"` (also skipped on `--redirect-to`/`--to`); dev shim threads it through `vite.config.js`. Add/remove chips in the tab.
- **Mentorship** (2026-06-19) — `MentorshipTab` is the admin control surface for the daily mentor nudge. **Preview today's picks** (POST `{dryRun, force}` to `api/send-mentor-nudges` — shows each mentor's would-be 3 mentees; works without the Wabridge template configured and never advances rotation) and **Send test to [mobile]** (POST `{redirectTo, force}` — sends the real message to one number only; also non-destructive, no rotation advance). `force:true` bypasses the Mon–Fri gate for any-day preview/testing. Also hosts **Mentee assignments** (`MenteeAssignments` + `mentorSlice`): reassign/remove a mentee's mentor and an "active students with no mentor" list so nobody falls out of rotation. See the Mentorship nudge section below.

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
- `timetableTeachers` — `{ id, name, email, mobile }` (`mobile` added 2026-06-19 for mentorship WhatsApp nudges; edited in Settings → Teachers)
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

**Views**: "Student View" (timetable grid per branch/batch, PNG + Excel export), "Teacher Schedule" (all slots for a selected teacher, clash detection), "Subject Hours" (subject×batch weekly-hours pivot, below), and "Exam Schedule" (batchwise exam list with branch-pill / batch-underline-tab filter identical to Student View, status badges, reminder email buttons).

**Subject Hours view** (2026-06-10): 4th view toggle — a subject×batch pivot of weekly scheduled hours (the subject-side analogue of Teacher Schedule's roll-up), branch-filtered. Pure `getSubjectHoursByBatch(timetables, mappings, { branch })` in `src/lib/timetable.js`: walks class cells, sums `slot-duration × days`, groups by `mapping.subject` (granular labels roll up; e.g. `Maths PYQs`→`Maths`), with per-batch + per-subject totals. Breaks/`__span`/unmapped cells excluded — same rules as `getTodaysLectures`.

**Batch tab reorder** (2026-06-10): the active batch tab (admin) shows ◀ ▶ buttons next to ⚙ — `moveTimetableWithinBranch(id, dir)` (`timetableSlice`) swaps with the nearest same-branch sibling in the `timetables[]` array (persisted in `faculty_state`), no-op at the ends, cross-branch order preserved. Student-View tabs and Subject-Hours columns share this array order.

### Teacher calendar sync (Google Calendar) (2026-06-10)
"📅 Sync calendars" (Timetable → Teacher Schedule, admin) reconciles each teacher's weekly teaching periods onto a shared Google Calendar ("LWS Faculty Timetable", owned by `connect.lwspune@gmail.com`) as recurring busy-blocks with the teacher as **attendee** (the only way to land events on personal-Gmail calendars). `RRULE FREQ=WEEKLY`, `Asia/Kolkata`, `sendUpdates:'none'` (events appear silently — no invite-email storm).
- **Bounded 2-week window** (`computeWindow(refYmd)`): each block is `BYDAY=X;UNTIL=<next week's Saturday>`, first occurrence anchored to the next weekday **on/after the sync day** — so it covers *remaining current week + all of next week* whether synced Sunday evening or mid-week (a passed weekday rolls to next week only; matches faculty syncing any day "for the remaining week"). The window (first-occurrence date + UNTIL) is folded into the block **signature**, so a weekly re-sync rolls every block forward (signature changes → patch; the recurrence rewrite auto-drops last week — no orphan cleanup). Same-day re-sync with no timetable change = no-op.
- **Rate-limit backoff** (`isRateLimit` + `withRetry` in `api/_googleCalendar.js`): the weekly roll patches all ~165 events at once and Google throttles bursts, so writes retry 403 `rateLimitExceeded`/429 with exponential backoff; endpoint concurrency is 4.
- **Reconcile** is keyed by `teacherId|timetableId|slotId|day` + a content `signature`: each run **releases** vanished blocks, **adds** new, **patches** changed. A teacher swap moves the block between keys (old released, new added). Pure logic in `src/lib/calendarSync.js` (`buildTeacherBlocks`/`diffBlocks`/`toGCalEvent`); `diffBlocks` is the sole reconcile authority.
- **Ledger**: `teacher_calendar_blocks` (`block_key` PK → `event_id` + `signature`; RLS-locked, written only by the endpoint via service role).
- **Endpoint** `api/sync-calendar.js` (+ `vite.config.js` dev shim): admin-JWT-gated (rejects `role='teacher'`), reads `faculty_state` server-side, supports `dryRun` + per-`teacherId` scope, bounded concurrency, idempotent/resumable. Google REST client in `api/_googleCalendar.js` (OAuth2 refresh-token).
- **Env** (Vercel + `.env.local`): `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET`/`_REFRESH_TOKEN`, `FACULTY_CALENDAR_ID`. One-time setup helpers: `get_google_refresh_token.cjs` (mint a durable refresh token), `create_faculty_calendar.cjs` (create the calendar). Full playbook in [[reference_google_calendar_sync]].
- **v1 limits**: recurs through holidays/exam days within the 2-week window (no `EXDATE`); per-occurrence reminders use each teacher's default (suppress by adding `reminders:{useDefault:false,overrides:[]}` to `toGCalEvent`). (The earlier "recurs forever" limit is **resolved** by the bounded window above — the window must be re-synced periodically, e.g. each Sunday, to roll forward.)

### Mode-conditional visibility
Use `useMode()` — never `IS_READ_ONLY` — for component-level visibility.

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
| Send Late / Lecture-Miss / Homework notifications | ✓ | — | — |
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

## Excel upload format

**Results** (Evalbee): `Name`, `Total Marks`, `Correct Answers`, `Incorrect Answers`, `Q N Marks`, `Q N Options`, `Q N Key`. The `Subject 1/2` columns are aggregate totals — no per-question subject info. `responses[q]` is derived per question as `Q N Options` blank → `0`, else `Q N Marks > 0` → `1`, else `-1` (the 1/-1/0 verdict; grading is Evalbee's, not derived from `questions[].answer`). The **chosen letter is now also persisted** in `exam_results.choices` (`{qn: 'A'|null}`, additive, 2026-06-10) for future re-gradeability; `Q N Key` feeds `questions[].answer`. See Data persistence → exam_results + [[reference_exam_grading_data_model]].

**Tags**: required `Q` (or `Question#`), `Chapter`. Optional: `Subtopic`, `Question`, `OptionA–D`, `Answer`, `Solution`, `Difficulty`. **GAT combined exams**: `Subject` column per question is required — without it all 150 Qs are unroutable.

**Offline results** (hand-graded paper, **total marks only** — 2026-06-09): a minimal `Name`, `Marks` template (alt headers `Total Marks`/`Score`; optional `Roll No`). Parsed by `parseOfflineResults` in `src/lib/excel.js` → student rows with `correct/incorrect/notAttempted = 0`, `responses = {}`. Entered via the **"+ Offline marks"** button on the Exams page → `OfflineExamModal` (faculty types name/date/subject/**max marks (required)**/batch/branch). Saved as a normal exam with `questions: []` + an explicit **`maxMarks`** (persisted to the `exams.max_marks` column). Offline-ness is **derived** (`!exam.questions?.length`), not a stored flag. The %-of-max unit comes from `examMaxMarks(exam)` (= `exam.maxMarks ?? questions.length × marking.correct`), so offline exams DO appear in trends/Toppers/history, but per-question analytics (chapter stats, audits, hardest-Q, Insights panel, exam PDF) are intentionally empty — the UI shows an "Offline" badge / notice instead. `addExam(exam, { syncAbsences })` gates the absence-flagging WhatsApp flow; the offline modal defaults it **off** (opt-in checkbox).

**Student import** (same XLS format as the Student Search List export): row 0 = title, row 1 = headers, row 2+ = data. Key columns: `RegistrationNo.`, `Name`, `Mobile No`, `Email`, `Guardian No.`, `Batch`, `Coming Status`, `Account Status`, `RegistrationDate`, `Quit Date`. `Guardian No.` is merged into `parent_mobiles[]` (see Student profiles section above).

**Attendance import** (LWS attendance export): row 0 = title, row 1 = headers, row 2+ = data. Required columns: `Student Name`, `Mobile No.`. Date columns in `DD-MM-YYYY` format (header), values `P` / `A` / `-` (dash = skip). Parsed by `parseAttendanceExcel` in `src/lib/excel.js`; matched to `studentProfiles` by mobile (primary) or name (fallback). Upserted into `student_attendance` with `onConflict: 'lws_id,date'`. **`L` rows (late) are preserved on import** — the slice queries existing L for the imported (lws_id, date) pairs and filters them out of the upsert so morning late-marking isn't overwritten by the end-of-day XLS.

---

## Key files

| File | Purpose |
|---|---|
| `src/config.js` | Mode detection (`IS_READ_ONLY`), session keys (`SESSION_KEY`, `SESSION_DAYS`), app info |
| `api/student-login.js` | Vercel serverless — normalises mobile, matches it against each student's **own mobile OR `parent_mobiles[]`**, fetches `exam_results` + `exams` + `student_attendance` + `lecture_absences`; fire-and-forgets a `student_logins` insert; returns student data + `viaParent`. Multi-match (siblings) → `{ multiple, candidates[] }` picker payload (no data, no login recorded); a supplied `lwsId` is honoured only if it's in the candidate set for that number |
| `create_teacher_account.js` | Admin script — creates/updates Supabase auth user with `role='teacher'` metadata. Usage: `node create_teacher_account.js <email> <password>` |
| `src/context/ModeContext.jsx` | `ModeContext` + `useMode()` |
| `src/store/useStore.js` | Zustand store assembler |
| `src/store/persist.js` | Dev: disk via Vite plugin. Prod admin: Supabase `faculty_state`. Teacher/student: no-op. |
| `src/lib/supabase.js` | Null-guarded Supabase client (returns `null` if env vars absent) |
| `src/stubs/empty.js` | One-line `export default {}` — aliased from `stream` in `vite.config.js` so xlsx's optional `require('stream')` short-circuits cleanly instead of throwing on Vite's externalised-module stub. |
| `vercel.json` | SPA rewrite rule — all non-`/data/|api/` paths → `index.html` |
| `api/send-whatsapp.js` | Vercel serverless function — verifies admin JWT, loads exam from `exams` table + results from `exam_results`, builds Wabridge payloads; mirrors the Vite dev endpoint at the same `/api/send-whatsapp` URL. The tracker-link variable is a **deep-link** `?mobile=<student>&exam=<exam.id>` built by `buildTrackerUrl`, used for **both** the student AND parent messages (parents were previously sent the bare URL). **The message name (var 1) is the matched profile's `canonical_name`** (2026-06-10), not the exam-sheet `student_name` — `student_name` is still used to look up the mobile/parent numbers (variant-aware) and in the result log lines; falls back to the sheet name when no profile matches. Accepts an optional `monitorMobiles[]` body param: after the student loop, on a **real** send (no `redirectTo`) it sends one random student's exact message to each monitor number via the shared `makeParamsForRow` builder, returns a separate `monitor` count + `MONITOR → …` log lines (see Settings → Monitoring). `send_results_whatsapp.py` mirrors this (incl. `--monitor`). |
| `api/send-late-notifications.js` | Vercel serverless — verifies admin JWT, loops `students[]` from request body, Wabridge template variables `[name, date]`. Requires `WABRIDGE_LATE_TEMPLATE_ID` env. Dev shim in `vite.config.js` dynamically imports the same handler so the endpoint works in `npm run dev` too. |
| `api/send-lecture-absences.js` | Vercel serverless — verifies admin JWT, loops `students[]` from request body (each with `subjects[{subject, startTime?, endTime?}]`). Wabridge variables `[name, date, formatted]` where `formatted` is a comma-joined ASCII string `Subject HH:MM AM to HH:MM PM, …`. Requires `WABRIDGE_LECTURE_MISS_TEMPLATE_ID` env. Skips students with empty subjects. Same dev shim pattern as above. |
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
| `src/pages/Attendance/index.jsx` | Admin/teacher page: tab strip (Class metrics / Lecture log), `LateMarkingWidget` at top of Class metrics (admin), consecutive absences alert, paginated Supabase fetch, class avg/at-risk metrics, student table, Import XLS button, send-result Alert. |
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
| `src/lib/analytics/attendanceRollup.js` | Pure `buildAttendanceRollup({attendanceRows, studentProfiles, syllabusBatchBranches})` → `{branch:{batch:{male,female:{present[],absent[]}}}}`. Absent=`A`, Present=rest; Active-only; skips variant-keyed + batch-less profiles; multi-batch student counted per batch. |
| `src/pages/Dashboard/AttendanceRollup.jsx` | Per-branch attendance tables (side by side) with gender sub-columns + `▸` name drill-down + date picker. Class-wide for one day; ignores the page filter chain. |
| `src/pages/Dashboard/index.jsx` | Command-center page (KPI strip + trend + priority chapters + batch comparison + heatmap + at-risk + hardest-Q). Subject→branch→batch→exam filter chain. |
| `src/pages/Dashboard/{PerformanceTrend,PriorityChapters,BatchComparison}.jsx` | Dashboard widgets. `PerformanceTrend` is a hand-rolled SVG line chart (no chart lib). (`KpiStrip.jsx` deleted 2026-06-07.) |
| `src/pages/Dashboard/AttendanceLeaders.jsx` | Top-5 absent/late/lecture-miss/homework-miss boards w/ 7d/30d toggle. Class-wide + Active-only; fetch-on-demand via `fetchAttendanceLeadersData`. |
| `src/lib/analytics/attendanceLeaders.js` | Pure `buildAttendanceLeaders({attendanceRows,lectureRows,homeworkRows,studentProfiles,topN})` → `{absentees,late,lectureMiss,homeworkMiss}` (Active-only, variant-skip, count-desc/name-asc). |
| `src/pages/Students/FocusedExamResult.jsx` | Student-portal-only deep-link landing: shows ONE exam's report (summary + reused `ExamIssuesPanel`) when `?exam=<id>` is present; null otherwise. Has a "Show all questions" toggle (`includeAll`). |
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
| `tests/test_subtopic_merge.py` | 76 pytest tests for `merge_subtopics.py` subtopic + chapter rename logic |
| `data/faculty-data.json` | Primary dev data store (gitignored) |
| `students_db.json` | Student roster with mobiles (gitignored) |

---

## Tests

Setup: `src/test/setup.js`. `ModeContext` defaults to `'admin'` — no Provider needed in tests.
Test files mirror source paths under `__tests__/`. Python tests under `tests/`. **1579 Vitest tests passing** (2026-06-19 full-suite-green). Latest additions — **mentorship daily nudge** (2026-06-19): `mentorNudge.js` 13 (`pickDailyMentees` round-robin/short-tail/idempotent + `fmtNudgeDate`/`isNudgeDay`/`istDateString`), `api/send-mentor-nudges.js` 14 (gates, weekday skip, dry-run-without-template, active-only, non-destructive `redirectTo`, cron-secret send), `mentorSlice` 9 (assignment CRUD — fetch/set/remove, session-gated), `timetableSlice` teacher `mobile` 1. (The `MenteeAssignments` UI itself is untested — slice-only coverage.) Earlier — wrong-answer **remediation links** (2026-06-17): `remediation.js` lib 25 (`buildLearnUrl`/`buildPracticeUrl`/`examRemediationLinks`, Maths-gating, notes-slug preference), `excel.js` `SubtopicSlug`/`ConceptSlug` parse 3, `QuestionCard` `showRemediation` 2. Earlier — WhatsApp **monitoring copy** (2026-06-16): `setMonitorMobiles` 6 (configSlice), `send-whatsapp` monitor 7, `MonitoringTab` 6, persist allow-list `monitorMobiles` round-trip 1. **76 Python tests** in `tests/test_subtopic_merge.py` (was 39 — +37 for the 2026-06-16 Maths subject-wide cleanup: 26 new subtopic renames + 4 distinct-concept-preserved + chapter rename `apply_chapter_renames`/`CHAPTER_RENAMES` + no-chain invariants). Earlier additions: offline exams (`examMaxMarks` helper 5, `parseOfflineResults` 7, `buildExamRow` max_marks round-trip, `examsSlice` syncAbsences-opt-out, `examAvgPct` offline-via-maxMarks); `StudentPortal` smoke test (6 — focused-mode reveal + parent banner; `StudentPortal` now a named export from `App.jsx`); Dashboard attendance leaders (`buildAttendanceLeaders` 9, `fetchAttendanceLeadersData` slice 2, `AttendanceLeaders` widget 4, Dashboard strip-gone/leaders-present); student-portal result deep-link landing (`FocusedExamResult` 8 incl. show-all toggle, `getIssues` includeAll 3, `send-whatsapp` deep-link + parent prefill 2); student-login parent-number + sibling picker (8 endpoint + 3 `LoginPage` picker UI tests); Dashboard attendance roll-up (`attendanceRollup` aggregator 8, `fetchDailyAttendance` slice 4, `AttendanceRollup` widget 11 — incl. Total-row sum/drill-down, std ordering, branch-heading headcount); Daily Quiz (quiz lib 24, quizStats 17 — incl. per-option `dist`/`skipped` + `attemptsWithProfile`, quizSlice + quizSupabase, `student-quizzes`/`quiz-submit` endpoints, `QuizLinkPage`, `QuizResults` 3 — branch/batch columns + per-question option/distribution dropdown); pending-aware notifications (late/lecture/homework widget + modal pending coverage); AttendanceRings homework chip + monthly-report homework section; current-members batch/branch filter helpers (`filters.test.js` +9) + `Toppers.test.jsx` (cross-cohort exclusion + Maths default); timetable Subject Hours + batch reorder + calendar sync (`getSubjectHoursByBatch` 9, `moveTimetableWithinBranch` 7 in timetableSlice, `calendarSync` 11 — `buildTeacherBlocks`/`diffBlocks`/`toGCalEvent` incl. teacher-swap release+add + `2:50PM`-no-space parse). For test-infrastructure detail (mock patterns, growth log, chainable Supabase builder) see memory `project_testing.md`.
Key coverage: analytics filters, GAT routing, tag validation, dashboard filters, Exams/Students/StudentView pages, re-upload modals, mergeStudents (incl. dedup signals, exam-name candidates, `addNameVariant`), split script, send_schedule (44 tests), timetableSlice (46 tests — incl. `updateTimetable` footnotes + title round-trip), configSlice (36 tests), studentSlice (6 tests), insightsSlice + insightsSupabase (21 tests covering save/clear dual-path + table helpers), persist.js (Supabase load/save/pagination), useStore loadExamsFromSupabase action, Exams pagination (11 tests), attendance parse (8 tests), attendanceSlice (20 tests covering import + L-protection + markLate/unmarkLate/getLateStudentsForDate), AttendanceRings (12 tests including the clickable Days-late badge), student-login login tracking + lecture-absences (2+ tests), consecutiveAbsent (23 tests — incl. streak > N, the `count` field, and count-desc sort with name tiebreak), migrate_insights (11 tests), subtopic + chapter rename (76 Python tests), `getTodaysLectures` pure helper (12 tests), `lectureAbsenceSlice` (15 tests, slot_id signature), `TimetableGrid` (6 tests — label-on-line-1 / teacher-on-line-2 / break cells / missing-teachers fallback), `LateMarkingWidget` (12 tests covering 3 button states), `MarkAbsenteesModal` (9 tests), `LectureLogTab` (13 tests including two-same-subject-slots regression), `LateNotificationPreviewModal` (12 tests covering resend-failed scope toggle + `bulkUpdateStudentContacts` persistence), `LectureMissPreviewModal` (6 tests, time-formatted subjects), `RecentIncidents` (6 tests), `parseFailedNames` (8 tests), `send-late-notifications` endpoint (8 tests), `send-lecture-absences` endpoint (8 tests), `ExamHistoryTable` `fmtMarks` bracketed-marks helper (4 tests), dashboard analytics (16 tests — `examAvgPct` / `getPerformanceSeries` / `getClassProjectedAvg` / `getPriorityChapters` / `getBatchComparison`), `persist.js` `saveToStorage` allow-list regression (lateSendHistory/lectureMissSendHistory/branches round-trip), Dashboard command-center widgets (KPI strip presence + trend/priority widgets + freq-editor-gone).

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

`npm run lint` — `eslint.config.js` (flat config). Current state (re-baselined 2026-06-01 after the config fix below; **re-verified 2026-06-07, unchanged**): **10 errors, 13 warnings** (down from 140/13 — the 122 `process` + 8 `global` false positives were eliminated by giving Node files Node globals). Breakdown:
- **6** `Calling setState synchronously within an effect` — intentional in `App.jsx` (session-check gate), `pages/Students/StudentView.jsx` (auto-select + attendance fetch), and a handful of admin pages. Use `// eslint-disable-next-line react-hooks/set-state-in-effect` on individual lines as needed; new components in `pages/Attendance/Late*`, `LectureLogTab`, `MarkAbsenteesModal`, `pages/Students/RecentIncidents` already have these disables on the lines that fire `setState` from an effect.
- **3** `no-unused-vars` — `sourceResults`, `allNamesLower`, plus one `y` in a destructure. Genuine dead variables; clean up next time touching those files.
- **1** Fast-refresh warning on a co-located export — pre-existing.
- **13** warnings — all `react-hooks/exhaustive-deps`. Intentional (auto-select / sync-with-external patterns).

The `'process' is not defined` / `'global' is not defined` errors that dominated the count until 2026-06-01 are gone — they were environment false positives (Node files lint'd under browser globals), fixed by the config change below, not real code issues.

**Config structure:**
- Browser globals + React/react-hooks/react-refresh plugins for all source files.
- `globals.node` (+ browser) block for Node files: `vite.config.js`, `api/**/*.{js,jsx}`, `migrate_*.js`, `sync_*.js`, `create_teacher_account.js`. Browser globals kept too (api endpoints use `fetch`). Add any new root-level Node script's glob here so it doesn't re-introduce `'process' is not defined` errors.
- Vitest globals block for `**/__tests__/**` and `**/*.test.*` files (`describe`, `it`, `expect`, `vi`, etc.) — also includes `globals.node` so `global.*` in tests resolves.
- `no-unused-vars`: `varsIgnorePattern: '^[A-Z_]'`, `argsIgnorePattern: '^_'`, `caughtErrorsIgnorePattern: '^_'` — prefix unused args/catches with `_` to suppress.
- `react-hooks/preserve-manual-memoization` disabled globally (React Compiler rule, not applicable here).

**Intentional `eslint-disable` comments in source:**
- `SyllabusPage.jsx`, `ExamScheduleView.jsx`, `LoginPage.jsx`: `react-hooks/set-state-in-effect` — auto-select first item when the list changes, or reset state on flag change; the pattern is deliberate.
- `LoginPage.jsx` and `StudentLogin.jsx`: `react-refresh/only-export-components` — session-clear helpers are co-located with the component that owns the session; splitting would be artificial. Same disable on `ExamHistoryTable.jsx` for the exported `fmtMarks` helper (tested in isolation; not worth a separate file).
- `App.jsx` and `pages/Students/StudentView.jsx` have `setState synchronously within an effect` errors that are NOT yet suppressed with `eslint-disable` comments — the pattern is intentional but the disables haven't been added. Add `// eslint-disable-next-line react-hooks/set-state-in-effect` if you touch those lines.

---

## Deployment

### GitHub Pages (legacy static build)
`npm run deploy` — `vite build --base=/nda-tracker/` → push to `gh-pages`. Split script no longer runs automatically. The GH Pages site still loads the app but student/teacher login won't work (no serverless functions on static hosting) — users should be directed to `nda-tracker.vercel.app`.

`BASE_URL` is derived from `import.meta.env.BASE_URL` in `src/config.js` — no hardcoded `REPO_NAME`.

### Vercel (online admin portal)
- Repo is connected to Vercel; every push to `main` triggers a production deploy.
- Required env vars in Vercel: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. WhatsApp send endpoints additionally need `WABRIDGE_APP_KEY` / `WABRIDGE_AUTH_KEY` / `WABRIDGE_DEVICE_ID` plus per-flow template IDs: `WABRIDGE_LATE_TEMPLATE_ID`, `WABRIDGE_LECTURE_MISS_TEMPLATE_ID`, `WABRIDGE_EXAM_ABSENCE_TEMPLATE_ID`, **`WABRIDGE_HOMEWORK_TEMPLATE_ID`** (the homework flow's Meta-approved template — single item per message, positional `{{1}}=name {{2}}=subject {{3}}=topic {{4}}=type`, no date; until it's set, the capture/resolve/preview flow works but the final send returns a 500 config error). The calendar-sync endpoint needs `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `GOOGLE_OAUTH_REFRESH_TOKEN` / `FACULTY_CALENDAR_ID` + `SUPABASE_SERVICE_ROLE_KEY` (until set, the deployed Sync button returns a 500 config error; local dev reads them from `.env.local`). The **mentorship nudge** endpoint needs `WABRIDGE_MENTOR_NUDGE_TEMPLATE_ID` + `CRON_SECRET` (+ the shared Wabridge creds + `SUPABASE_SERVICE_ROLE_KEY`); until `CRON_SECRET` is set the daily cron call is rejected (a safe fail-closed — no accidental sends).
- **Cron** (`vercel.json` `crons`): `/api/send-mentor-nudges` at `0 2 * * 1-5` (02:00 UTC = 07:30 IST, Mon–Fri). The handler also gates weekdays as a backstop.
- **Local-dev caveat:** editing `vite.config.js` makes Vite reload the config from `node_modules/.vite-temp/`, which breaks the `makeApiShim` dynamic `import('./api/<file>.js')` for **all** shimmed endpoints (module-not-found 500) until a clean restart — a dev-only artifact, irrelevant on Vercel. Verify endpoint logic with unit tests or a real preview deploy, not the dev shim, right after a config edit.
- Supabase project: `exjnzrrlzcrsoxfoojcq`. Auth user: `official.lwspune@gmail.com`.
- To re-seed data after local changes: `SUPABASE_SERVICE_ROLE_KEY=<key> node migrate_to_supabase.js`.

---

## Decisions log

Moved to [`DECISIONS.md`](./DECISIONS.md) — the long-form *why* trail for non-obvious architectural choices. Use it when an entry in [`GUARDRAILS.md`](./GUARDRAILS.md) references "see decisions log" or when a code change would contradict an established trade-off. New decisions go at the end of that file.

---

## What not to change

Moved to [`GUARDRAILS.md`](./GUARDRAILS.md) — the behavioural invariants the codebase depends on (each prevents a class of bugs from re-appearing). Read it before touching persistence (`persist.js`), store slices, send endpoints, or analytics. New guardrails go there. The *why* behind any of them lives in [`DECISIONS.md`](./DECISIONS.md).
