# Database schema — NDA Maths Tracker

Live schema of the Supabase project `exjnzrrlzcrsoxfoojcq` (production).
Column-level reference. For *how* the app uses this data (load/save paths, dual-path mutations, mode-conditional reads), see `CLAUDE.md` → "Data persistence".

**Last verified:** event/quiz/feedback tables (§6–8) on 2026-06-06 via `information_schema` + `pg_constraint`/`pg_policy`. Core 10 tables (§1–5) row counts as of 2026-05-20 — not re-counted since.

---

## At a glance

| Domain | Tables | Rows |
|---|---|---|
| Admin workspace | `faculty_state` (kept for compatibility) | 1 |
| Students | `students`, `student_batches`, `students_meta` | 281 + 493 + 1 |
| Activity logs | `student_attendance`, `student_logins` | 2402 + 193 |
| Exams (Phase 5) | `exams`, `exam_results` | 45 + 1636 |
| Insights (Phase 6) | `class_reports`, `student_plans` | 0 + 1 |
| Event logs | `lecture_absences`, `homework_pending`, `exam_absences`, `integrity_incidents` | 125 + 2 + 876 + 0 |
| Hostel (APJ) | `checkpoint_absences`, `leaves`, `checkpoint_confirmations` | 0 + 0 + 0 (new 2026-07-08) |
| Daily Quiz | `quizzes`, `quiz_attempts` | 0 + 0 |
| Teacher feedback | `teacher_feedback` (superadmin-RLS) | 499 |
| Calendar sync | `teacher_calendar_blocks` (service-role-RLS) | 165 |
| Mentorship | `mentor_assignments`, `mentor_nudges` | 86 + 0 |

20 tables. All RLS-enabled except `student_logins` — see warning below. `teacher_feedback` is the only role-restricted policy (superadmin); `teacher_calendar_blocks` has no public policy (service-role only).

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

## 3b. Hostel & mess (APJ boarders, Phase 1 — 2026-07-08)

Boarder attendance across hostel roll + mess meals. **Exception-capture model**, mirroring `lecture_absences`: a row = a deviation from present; no row = present. Scoped to `branch='APJ'`. Admin-only writes. Slices: `checkpointSlice.js` + `leavesSlice.js`; the daily chain aggregator is `src/lib/analytics/chain.js`. UI: the **Hostel & Mess** tab in `src/pages/Attendance/`. See [`FLOWS.md`](./FLOWS.md) → "Hostel & Mess".

### `checkpoint_absences` — hostel/mess exception rows

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` | |
| `lws_id` | text | — | FK → `students(lws_id)` |
| `date` | text | — | `DD-MM-YYYY` (matches `student_attendance` / `lecture_absences`) |
| `checkpoint` | text | — | `hostel_am` / `breakfast` / `lunch` / `dinner` / `hostel_pm` |
| `status` | text | `'absent'` | `absent` / `sick` / `outpass` (`leave` lives in `leaves`) |
| `note` | text | nullable | |
| `created_by` | text | nullable | admin email |
| `created_at` | timestamptz | `now()` | |
| **UNIQUE** | `(lws_id, date, checkpoint)` | | delete-then-insert per (date, checkpoint) card |

Index: `(date)`, `(lws_id)`. The `class` checkpoint in the chain view is **derived** from `student_attendance`, never stored here.

### `leaves` — leave / out-pass (the honesty mechanism)

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` | |
| `lws_id` | text | — | FK → `students(lws_id)` |
| `from_ts` / `to_ts` | timestamptz | — | leave window |
| `type` | text | `'leave'` | `leave` / `outpass` / `medical` |
| `reason` | text | nullable | |
| `approved_by` | text | nullable | admin email |
| `created_at` | timestamptz | `now()` | |

An active leave overlapping a day explains **every** checkpoint that day (day-granular; `resolveOnLeave` does the overlap test). Index: `(lws_id)`, `(from_ts, to_ts)`.

### `checkpoint_confirmations` — roll reconciliation gate

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` | |
| `date` | text | — | `DD-MM-YYYY` |
| `checkpoint` | text | — | roll only: `hostel_am` / `hostel_pm` |
| `branch` | text | `'APJ'` | |
| `expected_count` / `exception_count` / `confirmed_present` | int | — | reconciliation tallies |
| `reconciled` | boolean | `false` | `confirmed_present == expected − exceptions`; **false = open incident** |
| `confirmed_by` | text | nullable | admin email |
| `confirmed_at` | timestamptz | `now()` | |
| **UNIQUE** | `(date, checkpoint, branch)` | | one confirmation per roll per day |

Also new on `students`: **`residential boolean NOT NULL default true`** — future day-scholar split; today all APJ are boarders so the roster scopes on `branch='APJ'` alone. RLS: all three tables carry `faculty_rw` (`FOR ALL TO authenticated USING(true) WITH CHECK(true)`), matching the sibling attendance tables.

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
| `questions` | jsonb | `'[]'` | `[{q, chapter, subtopic?, subject?, ...}]` — **empty `[]` for offline exams** |
| `max_marks` | numeric | nullable | Explicit paper ceiling for **offline / manually-recorded** exams (no per-question data). NULL for MCQ exams (max derived as `questions.length × marking.correct`). Readers go through `examMaxMarks(exam)` which prefers `max_marks` when positive. Added 2026-06-09. |
| `created_at` | timestamptz | `now()` | |
| `updated_at` | timestamptz | `now()` | |

**FKs in:** `exam_results` (CASCADE), `class_reports` (SET NULL).

**Offline exams** (questions `[]` + `max_marks` set): total-marks-only records of hand-graded papers. `exam_results` rows carry `total_marks` with `correct/incorrect/not_attempted = 0` and `responses = {}`. They feed %-of-max trends / Toppers via `max_marks`, but per-question analytics (chapter stats, audits, hardest-Q) are intentionally empty — surfaced as an "Offline" notice in the UI, not as zeros.

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
| `responses` | jsonb | `'{}'` | `{ qNum: 1 \| -1 \| 0 }` (correct/wrong/skipped) — Evalbee's verdict |
| `choices` | jsonb | nullable | `{ qNum: 'A'–'Z' \| null }` — the student's chosen letter (null = blank). Additive (2026-06-10); NULL for rows uploaded before capture. Enables re-grading a corrected key (re-grade action not yet built). |
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

## 6. Event logs (sparse, one row per incident)

> Behavioural detail (write paths, replace-set vs reconcile semantics, send flows) lives in `CLAUDE.md` + `FLOWS.md`. These are the column-level shapes.

### `lecture_absences` — one row per (student, day, slot missed)

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` | |
| `lws_id` | text NOT NULL | — | FK → `students(lws_id)` ON DELETE CASCADE |
| `date` | text NOT NULL | — | |
| `subject` | text NOT NULL | — | Display-only (avoids a timetable join in the message body) |
| `slot_id` | text NOT NULL | — | The period identity: `timetables[].timeSlots[].id` for scheduled lectures, or a minted `adhoc_*` id for impromptu ones (2026-06-06) |
| `start_time` | text | nullable | Impromptu lectures only — persists the entered time (timetabled rows re-derive from the timetable, leave NULL) (2026-06-06) |
| `end_time` | text | nullable | Impromptu lectures only (2026-06-06) |
| `created_at` | timestamptz NOT NULL | `now()` | |
| `created_by` | text | nullable | Auth session email |
| **UNIQUE** | `(lws_id, date, slot_id)` | | Was `(…, subject)` until 2026-05-21 — same-subject double periods collapsed |

Indexes: `(date)`, `(lws_id, date)`, `(slot_id)`. RLS ✓ authenticated (`faculty_rw`). Replace-set per period via `setLectureAbsenteesForPeriod(date, slotId, subject, lwsIds, { startTime?, endTime? })` (delete-by-`(date,slot_id)` then insert). **Impromptu lectures** (not in the timetable) use a minted `adhoc_*` `slot_id` + the optional time columns; they reconstruct from these rows since there's no timetable to re-derive from.

### `homework_pending` — one row per (student, day, subject, chapter, type) flagged

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` | |
| `lws_id` | text NOT NULL | — | FK → `students(lws_id)` ON DELETE CASCADE |
| `date` | text NOT NULL | — | |
| `subject` | text NOT NULL | — | Free text |
| `chapter` | text NOT NULL | — | Free text |
| `type` | text NOT NULL | — | CHECK ∈ `('homework','notes','both')` |
| `created_at` | timestamptz | `now()` | |
| `created_by` | text | nullable | |
| `resolved_at` | timestamptz | nullable | Stamped on closure — row is NEVER deleted, only stamped |
| `resolved_by` | text | nullable | |
| `notified_at` | timestamptz | nullable | Server audit; UI pending logic uses `notifiedItemKeys` not this |
| **UNIQUE** | `(lws_id, date, subject, chapter, type)` | | |

Indexes: `(date)`, `(lws_id, date)`, `(lws_id, resolved_at)`. RLS ✓ authenticated (`faculty_rw`). Written by `homeworkSlice` via a **reconcile** (select→delete-unticked→insert-new), preserving `resolved_at` across card re-edits.

### `exam_absences` — one row per (exam, student who didn't attend)

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` | |
| `exam_id` | text NOT NULL | — | FK → `exams(id)` ON DELETE CASCADE |
| `lws_id` | text NOT NULL | — | FK → `students(lws_id)` ON DELETE CASCADE |
| `marked_at` | timestamptz NOT NULL | `now()` | `timestamptz` — query with ISO `gte`, not a date string |
| `marked_by` | text | nullable | |
| `notified_at` | timestamptz | nullable | Stamped client-side after a successful send |
| **UNIQUE** | `(exam_id, lws_id)` | | |

Indexes: `(exam_id)`, `(lws_id)`, `(lws_id, marked_at DESC)`. RLS ✓ authenticated (`exam_absences_authenticated_all`). Written ONLY by `examAbsenceSlice.syncExamAbsences(examId)` (diff reconciliation — never direct INSERT elsewhere).

### `integrity_incidents` — one row per (student, exam) confirmed copying incident

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` | |
| `lws_id` | text NOT NULL | — | FK → `students(lws_id)` ON DELETE CASCADE |
| `student_name` | text NOT NULL | — | Snapshot (survives canonical rename) |
| `exam_id` | text | nullable | **NO FK** — snapshot, so the record survives exam delete/re-upload |
| `exam_name` / `exam_date` | text | nullable | Snapshot |
| `counterpart_name` / `counterpart_lws_id` | text | nullable | The other student in the flagged pair |
| `shared_wrong` / `same_correct` / `diff` / `both_answered` | int | nullable | Evidence snapshot at log time |
| `status` | text NOT NULL | `'admitted'` | The student agreed when confronted |
| `note` | text | nullable | Free-text (unused by the one-click capture; reserved) |
| `created_at` | timestamptz NOT NULL | `now()` | |
| `created_by` | text | nullable | Recorder email (admin or teacher) |
| **UNIQUE** | `(lws_id, exam_id)` | | Re-log = upsert, no duplicate |

Indexes: `(lws_id)`, `(exam_id)`. RLS ✓ authenticated (`integrity_incidents_authenticated_all`). Written by `integritySlice.logIntegrityIncident` (admin OR teacher, from the Exam Integrity panel). Delete is admin-only (UI gate). Surfaced in StudentView's `IntegrityIncidents` card and the student/parent portal (`api/student-login.js` returns `integrityIncidents[]`). Does NOT alter marks.

---

## 7. Daily Quiz (deliberately separate from `exams`)

### `quizzes` — quiz definition + question bank

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` | |
| `title` | text NOT NULL | — | |
| `subject` / `batch` / `branch` | text | nullable | Targeting |
| `marking` | jsonb NOT NULL | `{"wrong":0,"correct":1}` | |
| `questions` | jsonb NOT NULL | `'[]'` | Includes answer key — stripped before reaching students |
| `opens_at` / `closes_at` | timestamptz | nullable | Open window; submit blocked after `closes_at` |
| `status` | text NOT NULL | `'draft'` | CHECK ∈ `('draft','published')` |
| `created_by` | text | nullable | |
| `created_at` / `updated_at` | timestamptz | `now()` | |

Index: `(status)`. RLS ✓ authenticated (`quizzes_authenticated_all`) — teachers can write by design (UI exposure is the only gate; see CLAUDE.md guardrail).

### `quiz_attempts` — one submission per student per quiz

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` | |
| `quiz_id` | uuid NOT NULL | — | FK → `quizzes(id)` ON DELETE CASCADE |
| `lws_id` | text NOT NULL | — | FK → `students(lws_id)` ON DELETE CASCADE |
| `student_name` | text NOT NULL | — | |
| `answers` | jsonb NOT NULL | `'{}'` | |
| `score` | numeric NOT NULL | `0` | Server-graded |
| `correct` / `incorrect` / `not_attempted` | int4 NOT NULL | `0` | |
| `started_at` | timestamptz | nullable | |
| `submitted_at` | timestamptz | `now()` | |
| `created_at` | timestamptz | `now()` | |
| **UNIQUE** | `(quiz_id, lws_id)` | | Enforces one-attempt-per-student |

Indexes: `(lws_id)`, `(quiz_id)`. RLS ✓ authenticated. Graded server-side by `api/quiz-submit.js` (close-window + one-attempt checks are the integrity boundary).

---

## 8. Teacher feedback

### `teacher_feedback` — one row per (form submission × teacher)

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` | |
| `cycle` | text NOT NULL | — | Per-form-export label (e.g. `'03 LWS Pune'`); drives trend/filter |
| `branch` | text | nullable | |
| `submitted_at` | timestamptz | nullable | IST (`parseFormTimestamp` appends `+05:30`) |
| `teacher_name` | text NOT NULL | — | Mapped at import from Form section titles (not in the sheet) |
| `clarity`, `engagement`, `support`, `feedback`, `pace`, `respect`, `organization`, `availability` | int4 | nullable | 8 dims; each CHECK `(NULL OR 1..5)` |
| `comment` | text | nullable | |
| `created_at` | timestamptz | `now()` | |
| `created_by` | text | nullable | |

Indexes: `(cycle)`, `(teacher_name)`. **RLS ✓ superadmin only** (`superadmin_all`): `(auth.jwt() -> 'user_metadata' ->> 'role') = 'superadmin'` — the project's only role-restricted policy; a normal admin cannot read it. Written by `teacherFeedbackSlice.importTeacherFeedback`; wide Google-Form export reshaped long by `src/lib/teacherFeedback.js`.

---

## 9. Calendar sync

### `teacher_calendar_blocks` — Google Calendar sync ledger (one row per synced teaching-block)

| Column | Type | Default | Notes |
|---|---|---|---|
| `block_key` | text PK | — | Stable identity `teacherId\|timetableId\|slotId\|day` — keying by teacher makes a teacher-swap on a cell release the old block + add the new |
| `teacher_id` | text | nullable | `timetableTeachers[].id` (not a DB FK — timetable lives in the `faculty_state` JSONB) |
| `event_id` | text NOT NULL | — | The Google Calendar event id (for patch/delete) |
| `calendar_id` | text NOT NULL | — | The faculty calendar the event lives on (`FACULTY_CALENDAR_ID`) |
| `signature` | text NOT NULL | — | Content fingerprint (`startTime\|endTime\|label\|batchName\|branch\|teacherEmail`); a change → patch the event |
| `synced_at` | timestamptz NOT NULL | `now()` | |

Index: `(teacher_id)`. **RLS ✓ with NO public policy** → anon/authenticated denied; only the **service-role** client reaches it. Written exclusively by `api/sync-calendar.js` (the reconcile endpoint). **Derived sync ledger** — safe to truncate to force a full re-create, BUT truncating orphans the existing Google events (the next sync can't find them to delete), so pair any truncate with a manual calendar clear. See CLAUDE.md → "Teacher calendar sync" + [[reference_google_calendar_sync]].

---

## 10. Mentorship (2026-06-19)

### `mentor_assignments` — teacher↔mentee map (one mentor per student)

| Column | Type | Default | Notes |
|---|---|---|---|
| `lws_id` | text PK | — | FK → `students(lws_id)` ON DELETE CASCADE. **PK enforces one mentor per student** — reassigning is an upsert on this key. |
| `teacher_id` | text NOT NULL | — | `timetableTeachers[].id` (not a DB FK — timetable lives in `faculty_state` JSONB) |
| `created_at` | timestamptz | `now()` | |

Index: `(teacher_id)`. RLS ✓ authenticated (`faculty_rw`). Seeded by SQL from the mentor mapping; managed in-app via Settings → Mentorship (`mentorSlice` `fetchMentorAssignments`/`setMentorAssignment`/`removeMentorAssignment`) and read server-side by `api/send-mentor-nudges.js`.

### `mentor_nudges` — daily-nudge event log (doubles as the rotation cursor)

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` | |
| `teacher_id` | text NOT NULL | — | The mentor who was sent this mentee |
| `lws_id` | text NOT NULL | — | The mentee named in the nudge (not a DB FK — kept as a flat append-only log) |
| `date` | text NOT NULL | — | `YYYY-MM-DD` IST send-day |
| `created_at` | timestamptz | `now()` | |

Indexes: `(teacher_id, date)`, `(lws_id)`. RLS ✓ authenticated (`faculty_rw`). **Append-only** — one row per (mentor, mentee) actually nudged. The daily pick is *derived* from this log (each mentee's nudge **count** → lowest tier first), so it is both the audit trail and the rotation state; never updated in place. Written only by `api/send-mentor-nudges.js` on a successful real send (test/dry-run never write). See CLAUDE.md → "Mentorship nudge" + [[feedback_event_log_over_derive]].

---

## FK graph

```
        exams (45)
         │
         ├──→ exam_results (1636, ON DELETE CASCADE)
         ├──→ class_reports (0, ON DELETE SET NULL)
         └──→ exam_absences (876, ON DELETE CASCADE)

      students (281)
         │
         ├──→ student_batches (493)
         ├──→ student_attendance (2402)
         ├──→ student_logins (193)
         ├──→ student_plans (1, ON DELETE SET NULL)
         ├──→ lecture_absences (125, ON DELETE CASCADE)
         ├──→ homework_pending (2, ON DELETE CASCADE)
         ├──→ exam_absences (876, ON DELETE CASCADE)
         ├──→ mentor_assignments (86, ON DELETE CASCADE)
         └──→ quiz_attempts (0, ON DELETE CASCADE)

        quizzes (0)
         └──→ quiz_attempts (0, ON DELETE CASCADE)

  faculty_state (1)    ← no FKs (JSONB blob)
  students_meta (1)    ← no FKs (single-row config)
  teacher_feedback (499) ← no FKs (teacher_name is text, not a join)
  teacher_calendar_blocks ← no FKs (teacher_id is text; lives in faculty_state JSONB)
  mentor_nudges (event log) ← no FKs (flat append-only; teacher_id/lws_id are text)
```

---

## Row Level Security

| Table | RLS | Policy |
|---|---|---|
| `faculty_state` | ✓ | Authenticated only |
| `students`, `student_batches`, `student_attendance`, `students_meta` | ✓ | Authenticated only (policy named `faculty_rw` for historical reasons) |
| `exams`, `exam_results` | ✓ | Authenticated only |
| `class_reports`, `student_plans` | ✓ | Authenticated read/insert/delete (Phase 6) |
| `lecture_absences`, `homework_pending` | ✓ | Authenticated only (`faculty_rw`) |
| `exam_absences`, `quizzes`, `quiz_attempts` | ✓ | Authenticated only (`*_authenticated_all`) |
| **`teacher_feedback`** | ✓ | **Superadmin only** — `(auth.jwt() -> 'user_metadata' ->> 'role') = 'superadmin'`. The only role-restricted policy. |
| **`teacher_calendar_blocks`** | ✓ | **No public policy** — anon/authenticated denied; only the service-role client (`api/sync-calendar.js`) reaches it. |
| `mentor_assignments`, `mentor_nudges` | ✓ | Authenticated only (`faculty_rw`). The cron send path reads/writes via the service-role client (no user session). |
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
