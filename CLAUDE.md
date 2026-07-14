# NDA Maths Tracker — CLAUDE.md

> **Companion docs:** [`README.md`](./README.md) — public entry point + quick start. [`ARCHITECTURE.md`](./ARCHITECTURE.md) — narrative onboarding, the **code map (§6)**, the **mode-visibility matrix (§11)**, and the **detailed file reference (§12)**. [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md) — column-level schema for all tables. [`OPERATIONS.md`](./OPERATIONS.md) — production triage runbook (incl. lint/test failure scenarios). [`SECURITY.md`](./SECURITY.md) — auth model, RLS, PII, secrets. [`FLOWS.md`](./FLOWS.md) — end-to-end per-feature walkthroughs (WhatsApp results, exam absences, late/lecture/homework, Daily Quiz, Teacher Feedback, Monthly Reports, Mentorship). [`DECISIONS.md`](./DECISIONS.md) — long-form *why* trail. [`GUARDRAILS.md`](./GUARDRAILS.md) — the "what not to change" behavioural invariants.

## Charter — what belongs in this file

This is the **always-loaded** operational reference. Keep it to two things:
1. **Routing & invariants you must know *before* touching code** — the load-bearing rules whose violation causes incidents.
2. **Commands + conventions** used in daily work.

**Does NOT belong here** (lives elsewhere, loaded on demand):
- Current-state facts that go stale on every commit — **test/lint counts, "latest additions" logs, the live batch-name list.** Never hardcode these; point to the authoritative source (the test suite, `npm run lint`, Supabase).
- The full file inventory → [`ARCHITECTURE.md §12`](./ARCHITECTURE.md). The visibility matrix → [`§11`](./ARCHITECTURE.md). Per-feature deep-dives → [`FLOWS.md`](./FLOWS.md). Column shapes → [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md). The *why* behind a trade-off → [`DECISIONS.md`](./DECISIONS.md).

When a section here starts growing a running narrative or a current count, that's the signal to move it out and leave a pointer. Run `/update-docs` periodically to reconcile.

## Project overview

A React + Vite faculty tool for LWS Pune to track NDA Maths exam performance. Runtime modes:

- **Admin** (`localhost` / LAN): full read-write. Data in `data/faculty-data.json` via Vite plugin.
- **Online Admin** (Vercel + Supabase): full read-write. `faculty_state` JSONB row. Supabase Auth (email/password), no `role` metadata. Live at `nda-tracker.vercel.app`.
- **Superadmin**: Online Admin **plus** Teacher Feedback. Supabase account with `user_metadata.role='superadmin'`; gated by `isSuperadmin` + `teacher_feedback` RLS.
- **Teacher** (Vercel + Supabase): read-only. Account with `user_metadata.role='teacher'`. Same login form as Admin — role is server-side metadata, not a UI choice.
- **Student** (Vercel): read-only, mobile-number login (own **or parent** number) via `/api/student-login`, one student's data only.
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
| Timetable PNG export | html2canvas |
| Monthly report ZIP | jszip (dynamic import in `src/lib/monthlyReportZip.js`) |
| Math rendering | KaTeX |
| Deploy | Vercel for all portals (admin, teacher, student); GitHub Pages legacy static build via `npm run deploy` |
| Backend | Supabase (Auth + Postgres). 20 public tables — `faculty_state` (JSONB blob) + normalised exam / student / insights / event-log / quiz / feedback / calendar / mentorship tables. **Full table list + column-level schema: [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md)**; load/save behaviour in Data persistence below. |
| Python deps | `tzdata` (`pip install tzdata`) for `send_schedule.py`; `cryptography` only if regenerating `split_students.py` output |

## Key commands

```bash
npm run dev             # admin mode, data saved to disk
npm run test            # Vitest
npm run test:watch
npm run lint
npm run split           # python -X utf8 split_students.py (manual only — updates lastDeployedAt)
npm run deploy          # build + gh-pages push (split no longer runs automatically)
npm run migrate         # one-time: seed data/faculty-data.json → Supabase (needs SUPABASE_SERVICE_ROLE_KEY)
npm run migrate:students  # seed students_db.json → Supabase students tables (re-runnable, needs key)
npm run migrate:exams   # seed exams + results → Supabase normalised tables (re-runnable, needs key; --cleanup prints SQL)
npm run migrate:insights  # seed savedInsights → class_reports + student_plans (re-runnable, needs key; --cleanup prints SQL)
npm run sync:students   # download Supabase → students_db.json (for Python scripts, needs key)
npm run merge:subtopics       # python -X utf8 merge_subtopics.py — apply subtopic + chapter renames to faculty-data.json
npm run merge:subtopics:sync  # node migrate_subtopics_supabase.js — push the same renames to Supabase (needs key)
# one-off (applied 2026-05-20): node migrate_unify_batches.js — verify current Supabase state before re-running
```

## Slash commands

| Command | Purpose |
|---|---|
| `/subtopic-analyse` | Near-duplicate subtopic names queried live from Supabase. Run after bulk tag uploads. |

---

## Architecture decisions

> The detail below is intentionally compact — invariant + pointer. For shapes see [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md), for flows [`FLOWS.md`](./FLOWS.md), for the *why* [`DECISIONS.md`](./DECISIONS.md).

### Data persistence
- **Dev**: `data/faculty-data.json` via `POST /api/data` (Vite `localDataPlugin`). Bypasses the 5 MB localStorage limit.
- **Prod admin** (Vercel): `faculty_state` JSONB row (`id=1`) for config-style state (syllabus, timetable, cost log, send history) **plus** normalised tables for exams, students, insights, event logs, quizzes, feedback, calendar, mentorship. `saveToSupabase` is fire-and-forget (session-gated) and **strips `exams`, `savedInsights`, and `quizzes`** before writing — the normalised tables are authoritative for those. Each normalised domain follows the dual-path slice pattern ([`ARCHITECTURE.md §7`](./ARCHITECTURE.md)).
- **Prod teacher**: Supabase session only; `loadFromSupabase()` then `loadExamsFromSupabase()` on mount, both before content renders. (Insights load is admin-only.)
- **Prod student**: localStorage session token only (`SESSION_KEY`, expires after `SESSION_DAYS`).
- `apiKey` is **never** persisted (memory only).

**Load-bearing grading invariant — Evalbee-authoritative, NOT key-derived (confirmed 2026-06-07).** `exam_results.responses` is `{ "<qno>": 1 | -1 | 0 }` — the per-question **verdict** (Evalbee's mark), not the chosen option. `total_marks = correct×marking.correct + incorrect×marking.wrong`. `exams.questions[].answer` drives only the *displayed* correct answer + solution + per-question analytics, **never** student marks. Chosen letters ARE captured additively in `exam_results.choices` (`{qn:'A'|null}`, 2026-06-10) — makes a corrected key re-gradeable, but the re-grade action is **not built** (deferred). NULL for pre-2026-06-10 rows. See [[reference_exam_grading_data_model]] + [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md) → exam_results.

**Cohort snapshot (`batch_at_exam`/`branch_at_exam`) is capture-only.** Stamped at upload, frozen thereafter. **No consumer — a point-in-time consumer was explicitly declined as overengineering (2026-06-06).** Can't be backfilled, so kept as inert capture. `loadExamsFromSupabase` does not load these columns; do not add a reader without a fresh decision.

### Mode detection & routing
`src/config.js`: non-localhost hostname → `IS_READ_ONLY = true`. **Two distinct uses, never conflate:**
- **Component visibility** — use `useMode()` (`'admin' | 'teacher' | 'student'`), **never** `IS_READ_ONLY`.
- **Dev-vs-prod data-path branching** — use `IS_READ_ONLY` (or `IS_DEV = !IS_READ_ONLY` in `persist.js`). **Do NOT use `import.meta.env.DEV`** — Vercel's Vite 8.0.3 substitutes it incorrectly. See [[project_vite_dev_substitution_bug]].

`ModeContext` (`src/context/ModeContext.jsx`) defaults to `'admin'` so tests work without a Provider. `src/App.jsx` routes by `user_metadata.role` (`'teacher'` → `TeacherPortal`, other session → `OnlineAdminPortal`, `studentData` → `StudentPortal`). **Hooks must be called before any early returns** — store is empty at first render in teacher mode; all `useMemo` in Dashboard/Toppers sits before early returns (prevents React error #310).

### Login (`src/components/auth/LoginPage.jsx`)
Two tabs. **Admin · Teacher**: one Supabase form, routed by `user_metadata.role`. **Student**: mobile → `POST /api/student-login`; the number may be the student's own OR any `parent_mobiles[]` entry. Siblings sharing a parent number → `{ multiple, candidates[] }` sibling picker; chosen `lwsId` re-sent, response carries `viaParent`. `?mobile=` pre-fills; `?exam=<id>` (WhatsApp deep-link) → `FocusedExamResult` for that exam + "View full performance" reveal. **Inactive-account gate:** login is denied (`403`) when `account_status ∈ {Block, Quit, Inactive}` — fails **closed** on those, **open** on blank (legacy rows still log in). Blocking/unblocking is done in-app via the Block/Unblock control on the Students page (`setAccountStatus`) — reversible, keeps history, unlike hard-delete. See `api/student-login.js` guardrails in [`GUARDRAILS.md`](./GUARDRAILS.md).

### Store (`src/store/useStore.js`)
Slices under `src/store/slices/`; all mutations call `get()._save()` immediately. `loadStudentData(data)` = student portal; `loadRemoteData(data)` = teacher portal (sets all six syllabus keys from the decrypted payload). Persisted state keys are the allow-list in `persist.js` `saveToStorage` — **a new persisted key must be added there or it silently vanishes on reload** ([[feedback_persist_allowlist_footgun]]). Session-derived flags like `isSuperadmin` are not persisted — recompute on every `onAuthStateChange` AND re-apply through every `set({...DEFAULTS})` ([[feedback_session_flag_clobber]]). `studentList` (raw snake_case array) is not persisted; required by `FindDuplicatesTab` so same-`canonical_name` duplicates stay visible.

### Subject / batch / regDate filtering (invariants)
- **Subject filter is local state per page**, not in the store. `StudentView` and `Toppers` default to `'Maths'` (not `'all'`) — projected NDA score is per-subject. The dropdown binds to a derived `effectiveSubject`/`effectiveFilter` that snaps to `'all'` when the held subject isn't in scope (prevents the empty-state contradicting the dropdown). Snap at the derived level, never via `setSubjectFilter` in an effect.
- **Batch/branch filtering uses `profile.batches[]` / `profile.branch` as primary**, `exam.batch`/`exam.branch` only as fallback for profile-less exams. Helpers in `src/lib/analytics/filters.js` (`getBatchOptions`, `getExamsForBatch`, `getExamsForBranch`). **Do not revert to filtering on `exam.batch`/`exam.branch` directly.**
- **Current-members (not exam-roster) scoping on Toppers + Dashboard.** A batch/branch filter = *"students whose **current** batch/branch is X, over their full history"* — robust to moves. Implemented by intersecting analytics `validNames` with `getBatchMemberNames`/`getBranchMemberNames`. The Exams *page* stays exam-roster-centric. See [[feedback_current_cohort_over_exam_roster]].
- **Valid student** = `studentProfiles` entry with non-empty `regDate`; **valid exam** = `exam.date >= regDate`. Class-level analytics ignore `accountStatus`; the exam-absence cohort gate flags only `'Active'`. Analytics fns take optional `validNames: Set | null`.
- **Projected NDA score** (`computeProjectedScore`, `src/lib/analytics/projection.js`): per chapter, accuracy is **pooled across all the chapter's questions** (`Σ score×weight / Σ weight`, weights = recency × skip-half) — **not** a mean of per-subtopic ratios (that gave a 1-Q subtopic equal vote). `weightedSum`/`weightTotal` are exposed per subtopic in `chapterStats.js` for this. `getPriorityChapters` keeps its own separate accuracy calc. **Toppers qualifies on projected MARKS** (`getToppers(exams, freq, thresholdMarks, max)` gates `projected.total >= threshold`), not avg %. The `>=` is load-bearing — `getClassProjectedAvg` passes threshold `0` to average *every* scored student (incl. projected-0). See DECISIONS.md (2026-07-14).

### Student import — tiered match (`src/lib/merge/mergeLogic.js`)
`mergeStudents(existing, importedRows, { defaultBranch? })` matches each row, first hit wins: **(1) EIS** exact → **(2) mobile** uniquely identifying → **(3) name + non-empty branch** uniquely. No match → insert **only when EIS is non-empty** (blank-EIS unmatched rows are skipped, not inserted). Matched via step 2/3 → existing `eis_reg_no` updated from import. Ambiguities surface as non-blocking `conflicts[]` in the Step 3 preview, never auto-picked ([[feedback_conservative_auto_merge]]). **`defaultBranch`** fills blank branches only (never overwrites). **XLS Batch column is discarded** by the merge — the lock that stops HR-namespace batch names re-entering after the alignment sweep; faculty assigns batches manually (central-only dropdown). Full conflict-reason list + dedup signals in [`ARCHITECTURE.md §12`](./ARCHITECTURE.md) / `src/lib/merge/`.

### Duplicate detection & name-variant linking (`src/lib/merge/`)
`findDuplicateCandidates` (profile↔profile) + `findExamNameCandidates` (exam-name↔profile) power `FindDuplicatesTab`'s combined scan. Signals: Jaccard bigram ≥ 0.75, token-subset, token-edit (Levenshtein), token-prefix, initial-match, same mobile/EIS. `addNameVariant(lwsId, variantName)` links an exam-sheet spelling into a profile's `name_variants[]` and re-indexes `studentProfiles`. The scan's `students` prop is built from `studentList` (raw array), not the canonical-keyed map, so duplicates aren't collapsed. Threshold trade-off (Patil/Patel surfaces, Skip in one click): [[project_dedup_threshold_decision]].

### GAT subject routing
`computeStudentChapterStats / computeWrongAudit / computeSkippedAudit` take `qSubject?` (filters `q.subject`; `q.subject=null` always included). GAT total (600) is always derived, never stored; `CONFIGURABLE_SUBJECTS` excludes GAT. Combined GAT mock tags files **must** carry a `Subject` column per question.

### Settings page — sole CRUD surface (2026-05-20)
`src/pages/Settings/SettingsPage.jsx` (admin-only) is the **only** place branches, batches, and teachers are added / renamed / deleted. Tabs: **Branches** (`branches[]` + cascade), **Batches** (`addBatch` requires name + existing branch; unified `renameBatch` cascades to syllabus + timetable + `student_batches` + `exams.batch`), **Teachers**, **NDA Weightage** (`FrequencyTableEditor`), **Monitoring** (`monitorMobiles[]`), **Mentorship** (daily-nudge preview/test + mentee assignments). Other surfaces (`AddTimetableModal`, Syllabus tab bar, `ManageMappingsModal`) became **select-only** — free-text batch/branch creation is gone everywhere else. Teacher auth accounts are provisioned here too (two-client pattern: anon client verifies caller JWT + rejects `role='teacher'`; service-role client does the `admin.*` call — key Vercel-env-only). Detail per tab → [`ARCHITECTURE.md §12`](./ARCHITECTURE.md).

### Batch namespace unification (2026-05-20)
`syllabusBatches[]` and `timetables[].batchName` are kept **1:1** by the unified `renameBatch`/`deleteBatch` in `configSlice` (renamed atomically; cascades to `examSchedules`, `syllabusBatchBranches`, `batchProgramAssignments`, progress, timelines). The unification *contract* (syllabus == timetable) is enforced by the slice; the *specific name list* is whatever Settings says today — **verify the current set against Supabase before reasoning about specific batch names.** `profile.batches[]` alignment (student-portal join key) runs via a manual sweep (Students-tab row editor flags "⚠ Needs review"). Plan + history: [[project_branch_batch_plan]].

### Feature subsystems → companion docs
These are real subsystems with deep detail kept out of this file:
- **Dashboard command center** (`src/pages/Dashboard/`) — trend / priority chapters / batch comparison / attendance roll-up + leaders / integrity rollup / heatmap / at-risk / hardest-Q over a subject→branch→batch→exam chain. Pure aggregates in `src/lib/analytics/dashboard.js`. Widgets + aggregators in [`ARCHITECTURE.md §12`](./ARCHITECTURE.md).
- **Syllabus Tracker** (`src/pages/Syllabus/`) — per-batch teaching progress, status cycle `null→In Progress→Done→null`, per-chapter timeline. Data model + cascade rules in [`ARCHITECTURE.md §12`](./ARCHITECTURE.md); mutations in `syllabusSlice.js`.
- **Timetable** (`src/pages/Timetable/`) — branch/batch grids, mappings, exam schedule, Subject Hours pivot, Teacher Schedule (per-day hours row is superadmin-only; `getTeacherDayHours` in `src/lib/timetable.js`), batch-tab reorder. **Join-key invariant:** `batchName` is the join key (`examSchedules.batchName`, `student_batches.batch_name`, `exams.batch`); rename via `renameTimetableBatch` (cascades) — a bare `updateTimetable({batchName})` leaves exam schedules stale. **Slot-time invariant:** a lecture's clock time is owned by the **slot row** (`timeSlots[].startTime/endTime`), shared across all days; `grid[slotId][day]` holds only the cell (`{type:'class',mappingId}` / break / `__span`). There is **no per-(slot,day) time override** — moving one day's lecture to a new time needs an existing free slot row at that time, else editing the slot shifts every day or adding a slot adds an empty cell to every day. Mutate via the EditCell flow, not raw JSONB. `title`/`footnotes` are presentation-only. Excel export uses `xlsx-js-style` (do not revert to `xlsx`). In-app teacher-clash detection runs only for the *selected* teacher — branch-wide clashes are not surfaced.
- **Teacher calendar sync** (Google Calendar) — keyed reconcile ledger (`teacher_calendar_blocks`), release-old/add-new on teacher swap, bounded 2-week recurrence window, `sendUpdates:'none'`. Full playbook: [[reference_google_calendar_sync]].
- **Hostel & mess attendance** (APJ boarders — 2026-07-08, leaves extended 2026-07-11) — exception-capture (default-present) for 5 checkpoints (`hostel_am`/`breakfast`/`lunch`/`dinner`/`hostel_pm`), mirroring `lecture_absences`. Roll checkpoints add a **reconciliation gate** (`checkpoint_confirmations`; `reconciled=false` → open incident). The daily **chain** (`src/lib/analytics/chain.js`, pure) composes hostel/mess + derived class attendance to flag unexplained "fell off the chain" boarders. **Warden alert** (`api/send-attendance-alerts.js` `kind:'hostel'`): admin button re-computes the chain server-side and WhatsApps the unexplained list to `hostelAlertMobiles[]` (config, edited in the Hostel tab); fail-closed until `WABRIDGE_HOSTEL_ALERT_TEMPLATE_ID` is set (cron-ready, not scheduled). Admin-only **Hostel & Mess** tab in `src/pages/Attendance/HostelTab.jsx`; slices `checkpointSlice.js` + `leavesSlice.js`; scoped to `branch='APJ'` **boarders** — day-scholars (`students.residential=false`) excluded from board **and** alert.
  - **Leaves are open-ended (persist-until-return).** A leave explains **every** checkpoint in its window; open-ended = "still out, until closed", encoded as the far-future **`OPEN_LEAVE_TO_TS` 2099 sentinel** (exported from `leavesSlice.js`), **not NULL** — the sentinel is readable by both the new `.or('to_ts.is.null,to_ts.gte.<dayStart>')` query AND any stale client still on `.gte('to_ts',…)` (which drops NULL). [[project_open_ended_leave]]. **Load-bearing:** both leave readers — `leavesSlice.getActiveLeaves` AND the `send-attendance-alerts` hostel+lecture paths — must keep the `.or` null-branch + map `to_ts null → toMs null` for `resolveOnLeave`, or open leaves silently drop and their boarders flag as unexplained. Full lifecycle is in-app in the **On Leave** tab: **Put on leave** (`addLeave`) → view + days-out + stale flag (≥`STALE_LEAVE_DAYS`=3) → **Mark returned** (`endLeave`, close/shorten). Tables + flow: [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md) §3b + [`FLOWS.md`](./FLOWS.md) + [[project_hostel_attendance]] + [[reference_whatsapp_templates]].
- **Lecture log + lecture-miss alert are leave-aware** (2026-07-11) — the alert (`kind:'lecture'`) **suppresses students on an active leave** (no student/parent message; `onLeaveSkipped`; fails closed on a leaves-read error). Marking (`MarkAbsenteesModal`) has a **Present/Absent toggle**: pure `src/lib/lectureRoster.js` `computeAbsentees({rosterIds,selectedIds,mode,onLeaveIds})` derives `absent = roster − present − onLeave` (present mode) or the tapped set (absent mode), on-leave **always excluded** + locked + "returned?" (`endLeave`). `LectureLogTab` loads the day's leaves and offers an **"Also attending" pooled-roster** multi-select (unions batches for classes that span batches, e.g. 12th + 6M). Branch-agnostic: empty leave set (non-hostel branch) → plain toggle, nothing locked, zero `if APJ` code.
- **All parent-/student-facing flows** (WhatsApp results, exam absences, late/lecture/homework, Daily Quiz, Teacher Feedback, Monthly Reports, Mentorship nudge) → [`FLOWS.md`](./FLOWS.md). WhatsApp template param rules → [[reference_whatsapp_templates]] + [[feedback_whatsapp_template_param_rules]].

### Students page browser
`src/pages/Students/index.jsx` shows either the paginated `StudentsTable` (default) or `StudentView` (when `activeStudent` set). Table: searchable/filterable, PAGE_SIZE 25, optional "Aligned" column (✓ / ⚠ Needs review) when central batches exist. Source list prefers `studentList` (raw array), excludes variants. Inline `StudentRowEditor` (admin) edits branch + batches; **delete** is hard-delete dual-path (`studentSlice.deleteStudent` — cascades `student_batches`/`attendance`/`logins`, SET NULL on `student_plans`, leaves orphaned `exam_results`). `StudentView` normalizes name variants to canonical in an in-memory copy so analytics find records regardless of sheet spelling.

### Mode-conditional visibility
Use `useMode()` — never `IS_READ_ONLY` — for component visibility. **Full per-feature matrix:** [`ARCHITECTURE.md §11`](./ARCHITECTURE.md).

---

## Excel upload format

- **Results** (Evalbee): `Name`, `Total Marks`, `Correct/Incorrect Answers`, `Q N Marks`, `Q N Options`, `Q N Key`. `responses[q]` = `Q N Options` blank → `0`, else `Q N Marks > 0` → `1` else `-1` (the verdict; grading is Evalbee's). Chosen letter persisted to `exam_results.choices`; `Q N Key` feeds `questions[].answer`. See grading invariant above + [[reference_exam_grading_data_model]].
- **Tags**: required `Q` (or `Question#`), `Chapter`. Optional `Subtopic`, `Question`, `OptionA–D`, `Answer`, `Solution`, `Difficulty`, `SubtopicSlug`/`ConceptSlug` (remediation links). **GAT combined**: `Subject` column per question required.
- **Offline results** (hand-graded, total marks only): minimal `Name`, `Marks` template → exam with `questions:[]` + explicit `maxMarks` (`exams.max_marks`). Offline-ness is derived (`!exam.questions?.length`); `examMaxMarks(exam)` is the single %-of-max denominator. Per-question analytics are intentionally empty (UI shows "Offline"). Absence-flagging defaults **off** for offline.
- **Student import** (Student Search List export): row 0 title, row 1 headers, row 2+ data. `Guardian No.` → `parent_mobiles[]`. XLS Batch column discarded by merge (see tiered match).
- **Attendance import** (LWS export): date columns `DD-MM-YYYY`, values `P`/`A`/`-`. Matched by mobile (primary) / name (fallback), upserted with `onConflict:'lws_id,date'`. **`L` (late) rows are preserved on import** — existing L for imported (lws_id,date) pairs is filtered out of the upsert so morning late-marking survives the end-of-day XLS.

---

## Key files (load-bearing subset)

> **Full inventory: [`ARCHITECTURE.md §12`](./ARCHITECTURE.md).** Below are the entry points worth knowing first.

| File | Purpose |
|---|---|
| `src/App.jsx` | Top-level mode dispatcher (routes by `user_metadata.role` + `studentData`) |
| `src/config.js` | `IS_READ_ONLY`, session keys, `BASE_URL`, app info |
| `src/context/ModeContext.jsx` | `ModeContext` + `useMode()` |
| `src/store/useStore.js` | Zustand store assembler; slices in `src/store/slices/` |
| `src/store/persist.js` | Dev disk / Supabase load+save dispatcher + the `saveToStorage` allow-list |
| `src/lib/supabase.js` | Null-guarded Supabase client (`null` if env vars absent) |
| `src/lib/excel.js` | All Excel parsing (results, tags, students, attendance, offline) |
| `src/lib/analytics.js` + `analytics/dashboard.js` | Analytics facade + Dashboard aggregates (pure; %-of-max only) |
| `src/lib/mergeStudents.js` | Re-export barrel for `src/lib/merge/` (dedup, tiered import match, variants) |
| `api/student-login.js` | Student auth + payload assembly (own/parent number, siblings, integrity incidents) |
| `api/send-whatsapp.js` | WhatsApp result dispatch (deep-link, monitoring copy) |
| `vite.config.js` | Dev server + `makeApiShim` dev shims for all `api/*` endpoints |
| `data/faculty-data.json` · `students_db.json` | Dev data store · student roster (both gitignored) |

For the slice pattern (the shape ~every domain follows), read [`ARCHITECTURE.md §7`](./ARCHITECTURE.md) + `examsSlice.js` + `examSupabase.js`.

---

## Tests

Setup: `src/test/setup.js`. `ModeContext` defaults to `'admin'` (no Provider needed). Test files mirror source paths under `__tests__/`; Python tests under `tests/`. Test-first is mandatory (see global CLAUDE.md). Run `npm run test` for the live count and `npm run test -- <path>` for one file — **do not hardcode counts here.** Coverage map, growth log, mock patterns, and the chainable Supabase-builder mock live in memory `project_testing.md`.

**Mock-completeness gotchas** (omitting these causes silent "0 tests" / TypeError at setup — keep these; they're timeless, not drift):
- Mock stores for pages using batch filtering must include `studentProfiles: {}`.
- `vi.mock('../../../lib/ndaFreq', ...)` must include `NDA_FREQ_BY_SUBJECT: {}` (`validateTags.js` imports it directly).
- `WrongAnswerAudit` / `UnattemptedAudit` / `ExamHistoryTable` use `PAGE_SIZE = 5`.
- `syllabusSlice.test.js` mock state must include `syllabusBatchBranches: {}` + `batchChapterTimelines: {}`.
- Async slice actions calling `fetch` must `vi.stubGlobal('fetch', ...)` with a `beforeEach(vi.restoreAllMocks)` guard.
- `Exams.test.jsx` mock store must include `whatsappSendHistory: {}`, `bulkUpdateStudentContacts: vi.fn()`, `setWhatsappSendHistory: vi.fn()`.
- Exams pagination tests use `data-testid="exam-card"` (names render in `<div>`, not `<h3>`).
- `api/__tests__/student-login.test.js` uses `@vitest-environment node` + mocks `@supabase/supabase-js` per-test via `makeMockClient()`.
- `attendanceSlice` / `lectureAbsenceSlice` tests use the chainable query-builder mock (`{select,eq,in,gte,order,delete,upsert,then}`, each returns the builder, `then` resolves `{data,error}`).

## Lint

`npm run lint` (`eslint.config.js`, flat config). For current error/warning triage see [`OPERATIONS.md`](./OPERATIONS.md) → "Lint or test failures block a deploy" — **do not hardcode the baseline count here.**

**Config structure (timeless):**
- Browser globals + React plugins for all source files.
- `globals.node` (+ browser) block for Node files: `vite.config.js`, `api/**/*.{js,jsx}`, `migrate_*.js`, `sync_*.js`, `create_teacher_account.js`. **Add any new root-level Node script's glob here** or it re-introduces `'process' is not defined` errors.
- Vitest globals block for `**/__tests__/**` + `**/*.test.*` (includes `globals.node`).
- `no-unused-vars`: `varsIgnorePattern:'^[A-Z_]'`, `argsIgnorePattern:'^_'`, `caughtErrorsIgnorePattern:'^_'` — prefix unused with `_` to suppress.
- `react-hooks/preserve-manual-memoization` disabled globally (React Compiler rule, N/A here).

Intentional `react-hooks/set-state-in-effect` + `react-refresh/only-export-components` disables exist for deliberate auto-select / co-located-session-helper patterns (`SyllabusPage`, `ExamScheduleView`, `LoginPage`, `StudentLogin`, `ExamHistoryTable`). `App.jsx` + `StudentView.jsx` have the same intentional pattern without the disable comment yet — add it if you touch those lines.

---

## Deployment

### GitHub Pages (legacy static build)
`npm run deploy` → `vite build --base=/nda-tracker/` → push to `gh-pages`. Static host has no serverless functions, so student/teacher login won't work there — direct users to `nda-tracker.vercel.app`. `BASE_URL` is derived from `import.meta.env.BASE_URL` (no hardcoded repo name).

### Vercel (production)
- Repo connected; every push to `main` triggers a production deploy.
- **⚠ 12-function Hobby cap.** Vercel counts one Serverless Function per `.js` at the root of `api/` (ignores `_`-prefixed helpers like `_googleCalendar.js` and the `__tests__/` folder). The Hobby plan **hard-fails the build at >12**. We are AT the ceiling — adding a 13th endpoint file breaks the deploy. Add a new server flow by **folding it into an existing endpoint via a `body.kind` dispatch** (see `api/send-attendance-alerts.js`, which hosts both `kind:'lecture'` and `kind:'hostel'`), not a new file — or move to Vercel Pro (100-function limit). When you merge/add, update the dev shim list in `vite.config.js` to match. See [[project_vercel_function_cap]].
- **Required env:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. WhatsApp endpoints: `WABRIDGE_APP_KEY`/`AUTH_KEY`/`DEVICE_ID` + per-flow template IDs (`WABRIDGE_LATE_TEMPLATE_ID`, `..._LECTURE_MISS_...`, `..._EXAM_ABSENCE_...`, `..._HOMEWORK_...`). Calendar sync: `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET`/`_REFRESH_TOKEN` + `FACULTY_CALENDAR_ID` + `SUPABASE_SERVICE_ROLE_KEY`. Mentorship: `WABRIDGE_MENTOR_NUDGE_TEMPLATE_ID` + `CRON_SECRET`. Hostel warden alert: `WABRIDGE_HOSTEL_ALERT_TEMPLATE_ID` (+ `SUPABASE_SERVICE_ROLE_KEY`). Endpoints fail-closed (500 config error) until their vars are set. Local dev reads from `.env.local`.
- **Cron** (`vercel.json`): `/api/send-mentor-nudges` at `0 2 * * 1-5` (07:30 IST, Mon–Fri); handler also gates weekdays as a backstop.
- **Local-dev caveat:** editing `vite.config.js` breaks the `makeApiShim` dynamic imports for **all** shimmed endpoints until a clean restart (dev-only; irrelevant on Vercel). Verify endpoint logic with unit tests or a preview deploy after a config edit.
- Supabase project `exjnzrrlzcrsoxfoojcq`; auth user `official.lwspune@gmail.com`. Re-seed: `SUPABASE_SERVICE_ROLE_KEY=<key> node migrate_to_supabase.js`.

---

## Decisions log → [`DECISIONS.md`](./DECISIONS.md)
The long-form *why* trail for non-obvious choices. Consult it when a [`GUARDRAILS.md`](./GUARDRAILS.md) entry says "see decisions log" or a change would contradict an established trade-off. New decisions append there.

## What not to change → [`GUARDRAILS.md`](./GUARDRAILS.md)
The behavioural invariants the codebase depends on (each prevents a class of bug). Read before touching `persist.js`, store slices, send endpoints, or analytics. New guardrails go there; their *why* lives in [`DECISIONS.md`](./DECISIONS.md).
