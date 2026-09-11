# Batch retirement — spec

**Status: ALL THREE TIERS BUILT, 2026-09-12.** Tier 2 (`archivedBatches[]`) ships with the store
action, the Settings UI and every call site below. Tier 1 is the live procedure in
[`OPERATIONS.md`](./OPERATIONS.md) → *Retiring a finished batch*. Tier 3 (`deleteBatch` refuses
while students still hold the batch) is in `configSlice.js`. **No batch has been archived in
production yet** — the procedure is written but not yet run. Triggered by
the Sept-2026 attempt batches finishing while the app had no way to retire one. All counts below
were measured against live Supabase on 2026-09-12 — **re-query before acting on them**, they are
illustration, not truth.

> Keep this line current. A stale "nothing built" header on `ITEM_STATS.md` once cost a session's
> work when it was taken at face value after the thing had shipped.

## The gap

**There is no "retire" in this codebase.** A batch's lifecycle is create → rename → *hard
delete*. `deleteBatch` (`src/store/slices/configSlice.js`) is a config-list cleanup for a batch
created in error; used as a retirement tool it deletes teaching history and orphans student
membership. Nothing in `CLAUDE.md`, `DECISIONS.md`, `GUARDRAILS.md` or `SUGGESTIONS.md`
addresses this, and `retire|graduat|archiv|alumni|rollover` has zero hits across the repo.

The batches that need it now:

| Batch | Students (active/blocked) | Exams | Timetable | Syllabus progress | Lecture submissions |
|---|---|---|---|---|---|
| `LWS_NDA_6M_(Sep26)` | 8 / 0 | 12 own | **yes** | yes | 3 |
| `APJ_NDA_6M_(Sep26)` | 4 / 2 | 1 own + **55 co-tagged with APJ_12th** | no | no | 0 |
| `LWS_CDS_(Sep26)` | 1 / 2 | 0 | no | no | 0 |

`LWS_NDA_2Y_(25-27)_A/B` (67 students) hits the same wall in 2027. This recurs every September
and January.

## Retirement is three different operations

Conflating them is where the damage happens.

1. **Cohort finished, students leave** (the Sep26 batches) — stop the batch generating work,
   keep every record queryable. *This is what the rest of this document is about.*
2. **Cohort rolls forward** (`APJ_NDA_11th_(26-27)` becomes 12th next year) — this is
   `renameBatch`, which already cascades correctly across JSONB + `student_batches` +
   `exams.batch` (`src/store/slices/batchSupabase.js`). **Not retirement.**
3. **Batch created in error, never ran** — this is what `deleteBatch` was built for. Correct
   as-is.

## Blast radius — where a batch name lives

**JSONB (`faculty_state.data`)** — `syllabusBatches[]` · `syllabusBatchBranches{}` ·
`batchProgramAssignments{}` · `batchSyllabusProgress{}` · `batchChapterTimelines{}` ·
`timetables[].batchName` · `examSchedules[].batchName`

**Normalised Supabase** — `student_batches.batch_name` (membership, the load-bearing one) ·
`exams.batch` (comma-joined, historical) · `quizzes.batch` · `lecture_submissions.batch_name` ·
`exam_results.batch_at_exam` (capture-only, no consumer)

**Not batch-keyed at all** — verified via `information_schema`, only those five tables have a
batch column. `lecture_absences` keys on `slot_id`, `homework_pending` is per-student,
hostel/leave tables are branch + student scoped.

The batch *list* is read from **three independent sources**, and retirement affects them in
opposite directions:

- `syllabusBatches[]` — every **authoring picker**: results upload Step 2, `OfflineExamModal`,
  `QuizEditor`, `MonthlyReports`, `ErrorSets`, Students-page filter + row editor, Syllabus tab
  bar, `AddTimetableModal`, Settings.
- `getBatchOptions(exams, studentProfiles)` (`src/lib/analytics/filters.js`) — derived from
  **`profile.batches[]`**; drives Dashboard, Exams, ItemStats.
- `timetables[].grid` — `getTeacherBatches` / `getTeacherSubjectBatches`, and through them
  `/school-attendance`, `WrittenQuizModal`, `FilingBoard`, `LectureLogTab`,
  `AddExamScheduleModal`.

## Why `deleteBatch` is the wrong tool — three traps

**1. Clearing `student_batches` does not archive a batch, it erases your ability to look at
it.** `getExamsForBatch` falls back to `exam.batch` only when *no* attendee has a profile. Sep26
students all have profiles, so stripping their `batches[]` makes `getBatchMemberNames` return
empty and `getBatchOptions` drop the name — those 12 exams become unfilterable by batch on
Dashboard / Exams / ItemStats, permanently, even though `exams.batch` still names the batch.
**This is the single most important thing not to do.**

**2. `deleteBatch` orphans membership and then hides the mess.** It never touches Supabase.
Delete `LWS_NDA_6M_(Sep26)` and the name leaves `syllabusBatches` — so Settings → Batches can no
longer see it, since `allBatches` is `syllabusBatches ∪ timetables[].batchName` — while all 8
`student_batches` rows survive. Result: it keeps appearing in Dashboard / Exams / ItemStats
forever, all 8 members flag **⚠ Needs review** in `StudentsTable.isAligned`, and the
Students-page batch filter (which prefers `centralBatches`) no longer offers it, so you cannot
filter to them to fix it. It also drops `batchSyllabusProgress` + `batchChapterTimelines` — a
year of teaching record, no undo.

**3. Deleting the timetable blanks historical absence times.** `deleteBatch` *requires* zero
timetables first, and `LWS_NDA_6M_(Sep26)` has one. But `buildAbsentRoster`
(`src/lib/absentRoster.js`) resolves `r.start_time ?? slot?.startTime ?? null`, and **681 of
1,203 `lecture_absences` rows are still `start_time IS NULL`** (2026-09-12). Deleting the
timetable strips the clock time off every unstamped row in scope. Same hazard `GUARDRAILS.md`
flags for *retiming* a slot; deleting is strictly worse. `node migrate_absence_times.js` exists
to freeze them first. Separately, the batch's recurring Google Calendar events are only released
on the next `sync-calendar` run — skip it and teachers keep the class on their calendar
indefinitely.

Also: `APJ_NDA_6M_(Sep26)` shares 55 exams comma-joined with `APJ_NDA_12th_(26-27)`. Anything
touching `exams.batch` must split tokens and re-check exactly, the way
`cascadeBatchRenameToSupabase` already does.

## Tier 1 — the runbook

**Shipped as a procedure in [`OPERATIONS.md`](./OPERATIONS.md) → *Retiring a finished batch*,
which is the version to follow** — it carries the verification SQL and the co-tagged-exam note.
Summarised here for context; the ordering is the load-bearing part.

1. `node migrate_absence_times.js --dry-run`, then apply — freeze historical absence clock
   times *before* anything touches the timetable.
2. Delete the batch's timetable (Timetable page).
3. Run **calendar sync** — releases the teachers' recurring events. Skipping this is silent.
4. Clear any exam schedules for the batch, and remove it from `quizzes.batch` targeting.
5. Set the departing members to **`Block`** on the Students page. Login already 403s on
   `account_status ∈ {Block, Quit, Inactive}` and every send flow is gated by `isBlockedStatus`.
6. **Leave `student_batches` and `syllabusBatches` intact.** Membership is what keeps the
   cohort's history queryable (trap 1).

The live procedure inserts **Archive** before the timetable is touched, so the batch leaves the
pickers immediately and its archived row lists the residue still to be cleared.

---

# Tier 2 — archived batches

**Built 2026-09-12.** Pure core `src/lib/batchVisibility.js`; store action `setBatchArchived` in
`configSlice.js`; UI in `src/pages/Settings/BatchesTab.jsx`. The spec below is what was built —
it is the record, not a plan. The two traps in §2 are each pinned by a named regression test.

## Goal

A batch can be marked **archived**: it stops being *offered* as a target for new work, while
every existing record, analytic and membership stays exactly as it is. Fully reversible,
destroys nothing, no migration.

**Non-goals:** no change to `student_batches`, `exams.batch`, `quizzes.batch`,
`lecture_submissions`, or any analytics function. No new Supabase column. No auto-cascade —
archiving does not delete a timetable, it *reports* that one still exists.

## 1. Data model

One new persisted store key, beside `syllabusBatches`:

```js
archivedBatches: []   // string[], a subset of syllabusBatches ∪ timetables[].batchName
```

Lives in the `faculty_state` JSONB blob. It is **config, not data** — a visibility flag in the
same family as `branches[]`.

## 2. The governing rule

Every consumer of the batch list falls into exactly one of three classes, and the class decides
the behaviour. This is the whole spec in three lines:

| Class | Question it answers | Archived treatment |
|---|---|---|
| **Offer** | "which batch should this *new* thing go to?" | **Hidden** |
| **Lens** | "which batch do I want to *look at*?" | **Kept** (grouped / flagged) |
| **Record** | "is this value valid / what order do I join in?" | **Untouched — full list, always** |

The Record class is load-bearing and is where this feature can do real damage.

**Trap A — the join-order source.** `Step2Review`, `OfflineExamModal` and `QuizEditor` all build
the comma-joined `batch` string as `syllabusBatches.filter(b => selected.has(b)).join(', ')`. If
the *filtered* list feeds that expression, re-editing an exam tagged with an archived batch
**silently drops the archived tag** the moment you toggle any other batch. Filter what is
*rendered*; never filter the ordering source. This is the `feedback_control_cannot_represent_value`
shape — the same one that cost 193 questions on 2026-08-08.

**Trap B — `isAligned`.** `src/pages/Students/StudentsTable.jsx` requires every entry in
`profile.batches[]` to be in `centralBatches`. Feed it the filtered list and all 8 members of
`LWS_NDA_6M_(Sep26)` flag **⚠ Needs review** — trap 2 above, reintroduced by the fix for it.
`isAligned` gets the full list, unconditionally.

**Guardrail to add to `GUARDRAILS.md`:** *`archivedBatches` is a presentational filter. Nothing
that computes a number, validates a value, or determines a stored string's content may read it.*

## 3. Site-by-site

**Offer — hide archived (all read `syllabusBatches`)**

| Site | Note |
|---|---|
| `src/components/upload/Step2Review.jsx` | chip group. An already-selected archived batch **still renders**, flagged amber — same posture as the Step-3 off-list chapter value |
| `src/components/upload/OfflineExamModal.jsx` | same; `buildOfflineRoster` must still resolve an archived batch when re-opening an old exam |
| `src/pages/Quizzes/QuizEditor.jsx` | same |
| `src/pages/Timetable/AddTimetableModal.jsx` | already keeps the currently-held `timetable?.batchName` in options — extend that same guard to archived |
| `src/pages/Students/StudentRowEditor.jsx` | add-batch dropdown only. Existing chips come from the student's own list, so an archived batch stays visible and removable |
| `src/pages/Syllabus/SyllabusPage.jsx` | tab bar — behind a **"Show archived"** checkbox, not hidden outright. The syllabus tracker *is* the teaching record and has to stay reachable |
| `src/pages/Syllabus/AssignProgramsModal.jsx` | inherits via the `batches` prop from `SyllabusPage` |
| `src/pages/Settings/BatchesTab.jsx` | shows everything (§5) |

**Lens — keep archived**

- `src/pages/MonthlyReports/index.jsx` and `src/pages/ErrorSets/index.jsx` — generating a final
  report for a batch that just finished is the *most* likely time to use these. Both already
  narrow by branch (`branch ? all.filter(...) : all`), so archived slots into the same `useMemo`.
  Render archived entries in a trailing `<optgroup label="Archived">`; seed the initial
  `useState((syllabusBatches||[])[0])` from the non-archived list.
- `StudentsTable` batch **filter** — keep. You need it to find a retired cohort's members.
  (`feedback_filter_is_display_lens`.)

**Record — full list, no change**

`isAligned` (trap B) and all three join-order expressions (trap A).

**Explicitly untouched — this is the payoff**

`getBatchOptions` / `getExamsForBatch` / `getBatchMemberNames` stay as they are, so an archived
batch **remains fully filterable on Dashboard, Exams and ItemStats**. Also untouched because
they derive from `timetables` and self-heal once the timetable goes: `getTeacherBatches`,
`getTeacherSubjectBatches`, `/school-attendance`, `WrittenQuizModal`, `FilingBoard`,
`LectureLogTab`, `AddExamScheduleModal`.

## 4. Store API (`configSlice`)

```js
setBatchArchived(name, archived)   // → { ok: true } | { ok: false, reason: 'unknown_batch' }
```

One action, both directions — mirrors the reversible `setAccountStatus` Block/Unblock precedent
rather than an irreversible verb. Guard: `name` must exist in
`syllabusBatches ∪ timetables[].batchName`.

Three existing actions need cascade work. **Each is a silent-loss bug if missed:**

- **`renameBatch`** — must carry the flag to the new name, alongside the existing syllabus +
  timetable + Supabase cascade. Otherwise a rename silently un-archives.
- **`deleteBatch`** — must prune the entry, so an archived-then-deleted name cannot linger and
  shadow a future batch of the same name.
- **`addBatch`** — new batches are never archived; the `deleteBatch` prune is what guarantees
  this for a re-used name.

Optional read helper for the UI: `batchRetirementResidue(name)` →
`{ timetableCount, examScheduleCount, activeMembers, quizTargets }`.

## 5. UI — Settings → Batches

- Each active row gains an **Archive** button between Rename and Delete.
- Archived rows move to a collapsed **"Archived (N)"** section below, each with **Unarchive**.
  Delete stays available there, still gated on timetable / exam-schedule count.
- **An archived row displays what is still live on it** — "1 timetable · 8 active members · in 1
  quiz". This is the part worth arguing for: it turns the archived list into the Tier 1 runbook,
  made self-checking. Archive `LWS_NDA_6M_(Sep26)` and the row tells you the timetable is still
  attached, so teachers still see the class and the calendar events are still out.
- About card gains a line: archiving hides a batch from new-work pickers; nothing is deleted and
  all history stays visible in Dashboard / Exams / Item Stats.

## 6. Persistence wiring — the footgun checklist

Every one of these fails silently if skipped.

1. `DEFAULTS.archivedBatches: []` — `src/store/slices/defaults.js`, beside `syllabusBatches`.
2. `hydrate()` → `archivedBatches: saved.archivedBatches || []`.
3. **`src/store/persist.js` `saveToStorage` — both the destructure *and* the `data` object.**
   Miss either and the flag vanishes on reload with no error
   (`feedback_persist_allowlist_footgun`).
4. `useStore.loadRemoteData` → `archivedBatches: data.archivedBatches || []` (teacher portal).
   Teachers have no batch picker today, but `loadRemoteData` already sets every sibling syllabus
   key and drift here is free to prevent.
5. **Not** in `api/student-login.js` — admin config, no student-facing consumer.
6. No `migrateFreq`-style branch, no Supabase DDL, no backfill. An absent key reads as `[]` =
   nothing archived = today's behaviour exactly.

## 7. Tests (written first)

`configSlice.test.js` — archive/unarchive round-trip · idempotent re-archive · `unknown_batch`
rejection · **`renameBatch` carries the flag** · **`deleteBatch` prunes it** · a re-added name
starts unarchived.

`persist` — `archivedBatches` survives a `saveToStorage` → `hydrate` round-trip (the allow-list
regression).

Component, one per trap:

- **`Step2Review`** — an exam pre-tagged with an archived batch renders that chip, and toggling a
  *different* batch preserves the archived tag in the joined string. **Trap A. The most important
  test in the set.**
- **`StudentsTable`** — a student whose only batch is archived is **Aligned**, no ⚠ pill. Trap B.
- `StudentRowEditor` — archived absent from the add dropdown; an existing archived chip is still
  removable.
- `BatchesTab` — archive moves the row to the Archived section; unarchive returns it.
- `Dashboard` or `Exams` — an archived batch is **still present** in `getBatchOptions`. Pins the
  payoff against a future over-eager filter.

Mock stores for any of these need `archivedBatches: []` added, or they throw at mount.

## 8. Build order

1. Tests (all of §7, red).
2. `defaults.js` + `persist.js` + `loadRemoteData` wiring.
3. `setBatchArchived` + the three cascades in `configSlice`.
4. `BatchesTab` UI + the residue helper.
5. The Offer sites, then the Lens sites.
6. `GUARDRAILS.md` entry (§2) + `DECISIONS.md` note on why archive-not-delete.
7. `npm run lint` · `npm run test` · verify the golden path in the browser — archive
   `LWS_CDS_(Sep26)` first, it has 0 exams and 0 timetables and is the zero-risk subject.

Roughly half a day. It is one flag and about ten call sites; the cost is concentrated entirely
in getting the three Record-class sites right.

---

# Tier 3 — tighten `deleteBatch`

**Built 2026-09-12.** `batchInUseBy` gained `memberCount` and `deleteBatch` now refuses while it
is non-zero, making trap 2 unreachable by accident. `deleteBatch` remains correct for scenario 3
(a batch created in error).

The count is read from the in-memory `studentProfiles`, **not** from Supabase: it is the same
source `StudentsTable.isAligned` uses (so the two cannot disagree), it needs no round-trip, and it
works on the dev disk path where there is no Supabase at all. Variant-keyed entries are skipped
via the `p.name === key` guard — `studentProfiles` is indexed by canonical name *and* every name
variant, so without it a student with variants counts more than once.

In the UI the Delete button is disabled with the count in its tooltip, the row's meta line now
carries `N students`, and the blocked-delete message points at **Archive** by name rather than
just refusing.

## Open calls

Two judgement calls made in this spec, both cheap to reverse before implementation:

- **MonthlyReports / ErrorSets keep archived batches**, read as retrospective tools rather than
  authoring surfaces.
- **The Syllabus tab bar hides them behind a toggle** rather than dropping them, because the
  syllabus progress record has no other reader.
