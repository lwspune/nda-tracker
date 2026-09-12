# Suggestions — archive

Closed entries lifted out of [`SUGGESTIONS.md`](./SUGGESTIONS.md) so the live list stays scannable.
Same lossless-extraction pattern as [`DECISIONS.md`](./DECISIONS.md) and [`GUARDRAILS.md`](./GUARDRAILS.md):
nothing is rewritten here, only moved. Each entry is kept verbatim as it stood when closed, including
its `<details>` original where the closing session kept one — the reasoning trail is the point.

**Nothing here is actionable.** An entry that still has live work in it belongs in `SUGGESTIONS.md`,
not here; the 2026-09-12 review promoted **six** such remainders back out before this file was created
(warden-alert rollout, the offline-exam template labels, the preview-vs-delivered check, the
`MenteeAssignments` component test, subtopic-cleanup Tier 3, and the unrun batch retirement).

Grouped by the date the entry was *filed*, newest first.

---

## 2026-09-12

### ~~`api/` repeats its bearer-JWT auth preamble nine times~~ — **DONE 2026-09-12** (two unlocked doors found)

Refactor-ledger item 1, the remainder left open when the leaf helpers shipped. It was left open on
the grounds that the nine copies are **not** identical — CRON_SECRET bypasses, two shared-secret
paths, a superadmin layer — so collapsing them wrongly would grant access rather than garble a
message. Tabulating them first is what found the actual problem.

**Two endpoints were not enforcing "teachers never send", and neither was a decision:**

1. **`send-whatsapp.js`** — the endpoint that WhatsApps **exam results to students and parents** —
   accepted any valid Supabase session, with no teacher check at all. It was the only parent-facing
   send without one.
2. **The lecture-miss path of `send-attendance-alerts.js`** — also parent-facing, also unguarded,
   while `handleHostelAlert` **in the same file** was correctly gated.

The second explains the first's blast radius: `send-late-notifications`, `send-homework-pending` and
`send-exam-absence` all carry comments saying they 403 teachers *"mirroring
api/send-attendance-alerts.js"* — they were modelled on the one path that never had the check.
`CLAUDE.md` asserted the rule was enforced; it was not. Fixed, with a failing test written first in
each case.

**Shipped:**
- `api/_auth.js` — `bearerFrom(req)` + `getUserOrNull(client, jwt)`. **Only the mechanical steps.**
  Every 401 body, every 403, every wording stays **inline** in its endpoint, because a
  `requireAdminSession()` that hides *which* callers refuse a teacher is precisely what let these two
  hide. `getUserOrNull` also never throws — the nine inline copies all destructured
  `{ data: { user } }`, which raises an unhandled rejection on a failed auth call instead of
  refusing; null routes it into each caller's existing `if (!user) → 401`, failing closed.
- `api/__tests__/authDoors.test.js` — a **structural** guard: every file calling `getUserOrNull` must
  call `isTeacherUser` at least as many times, so a *second* door in an existing file cannot be added
  unlocked (exactly the attendance-alerts shape). Opt out deliberately with an `ALLOWS_TEACHERS`
  comment. Verified to go red when the `send-whatsapp` gate is removed.
- Door tests where there were none: `sync-calendar` had **no test file at all**; the lecture path had
  no teacher test. 401 and 403 are asserted **separately** everywhere, since "the feature works" was
  never evidence the door was locked.

**Not done, deliberately:** the cron-secret, shared-secret and superadmin paths were left exactly as
they are. They are genuinely different policies and belong where a reader can see them.

### ~~`lib/hostelLeave.js` claims to be shared and is not~~ — **DONE 2026-09-12**

Refactor-ledger item 3. The module's own header said it was *"shared by the admin Hostel board and
the warden's own capture page"*, but only the warden page imported it. The admin board re-derived the
identical open-leave list inline at `HostelTab.jsx:363-381`, with private copies of
`STALE_LEAVE_DAYS` and the 2099 open-ended sentinel.

**Why it mattered.** **Both** screens can open AND close a leave, and an open leave excuses a boarder
at every one of the five daily checkpoints until someone closes it. The stale flag (open ≥ 3 days) is
the only guard against that running forever. A threshold that drifted between the two screens would
make one silently stop flagging a boarder the other flags — no error, no visible breakage. Latent,
not live: the two implementations were identical apart from date formatting when this was done.

**Shipped:** `HostelTab` now calls the shared `buildOpenLeaveList`, converting `fromIso` →
`DD-MM-YYYY` at the render boundary rather than forking the helper. New `src/lib/hostelStatus.js`
carries the tap cycle and the "away" set, which were also duplicated, under a comment that read
*"Mirrors HostelTab."* The lib's header is now true.

**`STATUS_META` was deliberately NOT merged** — same ruling as the exam-absence preview in item 5.
The two screens render genuinely different sets: the admin board also shows `leave` and `late`, which
the daily chain **derives** rather than captures, and colours `present` green where the capture page
greys it out. Those are presentational differences owned by each screen; merging them would force one
look on two different jobs. Each copy now says so.

**A test caught a real gap while writing it:** `nextStatus(null)` fell through instead of advancing.
`null` and `undefined` both mean "no exception stored", but a bare object lookup coerces them to the
different keys `'null'` and `'undefined'`, so a null would have skipped the first step of the cycle.
Normalised with `?? undefined`; the implementation was fixed rather than the test.

**Verification note.** The Hostel board **cannot be rendered on localhost** — dev's
`data/faculty-data.json` has no Active APJ residential students, so the tab shows "No APJ boarders"
and the On Leave panel never mounts. Covered instead by the existing `HostelTab.test.jsx` on-leave
cases plus a **module probe through the browser's own graph** (37 days out / stale for the real
2026-08-06 outlier, 3 days = stale at the threshold, 0 days = not stale, off-roster row dropped,
DD-MM-YYYY conversion correct). Added to `reference_browser_verify_portals`.

### ~~The blocked-contact gate: three UI copies + three unguarded endpoints~~ — **DONE 2026-09-12**

Refactor-ledger items 5 and 5b, closed together because doing 5 alone would have produced tidier
code and **exactly the same exposure**. 87 of 329 students are `Block` (queried 2026-09-12), so this
gate fires on more than a quarter of the roster on every send.

**5b — the real fix (server-side).** `send-late-notifications`, `send-homework-pending` and
`send-exam-absence` looped straight over `req.body.students[]` and **never read the `students` table
at all**, so the browser's preview filter was the only thing between a blocked family and a WhatsApp
message. New `api/_blockGate.js` (`loadBlockedLwsIds` / `partitionBlocked`), keyed on `lws_id` —
all four flows already post `lwsId`, verified at each call site before building on it, so no
name-variant matching is involved. Each endpoint now reads through a **JWT-scoped** client (RLS still
applies) and returns a `blocked` count plus an `Excluded N blocked/inactive student(s).` line.

Two rules, deliberately different from each other:
- **not found / blank status → send** (fail OPEN), mirroring `isBlockedStatus` and the login gate.
  A missing profile must not silently mute a real student.
- **read error → refuse the whole send** (fail CLOSED, 500, nothing dispatched), mirroring the
  lecture-miss alert's leaves-read behaviour. A gate that vanishes on a database blip is not a gate.

**A live defect found while writing it:** [`send-whatsapp.js:92`](api/send-whatsapp.js#L92)
destructured only `{ data: studentRows }` and never inspected the error. A failed read yielded
`null`, `blockedKeys` came out empty, and the guard passed **every** blocked student — the guard
disappeared at exactly the moment it was needed. Now fails closed like the rest.

**5 — the de-duplication.** `src/lib/recipientRows.js` (`buildRecipientRows` +
`indexProfilesByLwsId`) replaces three copies of the same index-skip-shape logic in the late,
lecture-miss and homework previews.

**`ExamAbsencePreviewModal` was deliberately left out**, and that is recorded in the component. Its
`=== 'Active'` test and its dropping of profile-less rows are a **stricter policy stated in the
function's own header** — not drift. The shared builder fails open on both counts, so folding it in
would have quietly relaxed a decision someone made on purpose. The server floor applies underneath
either rule.

**Testing note worth keeping.** The three endpoints' existing tests passed the moment the gate was
added — because their fixtures carry no `lwsId`, so the gate short-circuited before any query and was
never exercised. New fixtures that do carry one were added, and each was **verified to fail against
the pre-gate handler** before being kept. A test that passes both with and without the code under
test proves nothing.

### ~~`parseTimeToMinutes` exists four times under two different contracts~~ — **DONE 2026-09-12**

Refactor-ledger item 4. One helper — clock time to minutes past midnight — written out four times:
`lib/timetable.js` plus byte-identical copies in `TimetablePage`, `TimetableGrid` and `AddSlotModal`.
The copies agreed on everything except the only case that matters: the three page copies returned
**null** for input they could not read; the library copy returned **0**.

**Why null is the right contract.** `0` is also a real answer — midnight. A 0-returning parser cannot
tell `12:00 AM` from *"I could not read this"*, so an unreadable slot time silently became midnight,
sorted ahead of the first period of the day, and computed a duration of zero, without erroring.
`AddSlotModal`'s validation is the one caller that must tell them apart, and it could only do so by
keeping its own copy.

**Shipped:** one exported `parseTimeToMinutes` on the null contract, three copies deleted, and `?? 0`
added at the five library call sites that sort or subtract (`timetable.js` ×2, `teacherDay.js` ×2,
`absentRoster.js`) so a null cannot become `NaN`. **Behaviour is unchanged** — the coercion is now
deliberate and local rather than baked into the parser. The helper was **exported and completely
untested** despite four copies; it now has 10 cases, including one asserting midnight stays
distinguishable from unreadable.

**Exposure was latent, not live.** Before changing anything, production was queried: all **88**
timetable slots parse cleanly — zero blank, zero unreadable — and `AddSlotModal` validates typed
input, so a bad time cannot be entered through the UI. The reachable routes are a raw JSONB edit or a
future import path.

**Verified in a real browser, not only vitest** (`reference_browser_verify_portals`): the Timetable
page renders its grid with the TIME column in correct ascending order (6:00 AM → 8:45 PM) and no
console errors, and the browser-resolved module itself returns `0` for `00:00`, `null` for `rubbish`,
and reports the two as distinguishable.

### ~~Three parsers of one server log format, and the Exams copy is stale~~ — **DONE 2026-09-12**

Refactor-ledger item 2, and a **live bug**, not only duplication. `api/send-*.js` return a
human-readable `lines[]` transcript; the client parsed it back with regexes to work out who was NOT
reached, stored that as `failedNames`, and treated everyone else as notified. Three divergent
implementations existed: one in `Attendance/index.jsx` and two inside `Exams.jsx`.

**What was actually broken.** `api/send-whatsapp.js:245` emits
`FAIL → <name> (parent → …)`, and the Exams copy matched only `\(student` — so an exam-result send
that failed on the **parent leg alone** was recorded as a success and the student was stamped
notified. Its `SKIP` pattern also captured `SKIP <name> parent 98765 — unrecognised format` as a
student called `"<name> parent 98765"`, and `SKIP monitor 98765 — …` as one called
`"monitor 98765"`. The Attendance copy had fixed the first two cases and never got ported back;
neither copy handled the monitor lines.

**Shipped:** `src/lib/sendLog.js` `parseFailedNames(lines)` with 13 cases in
`src/lib/__tests__/sendLog.test.js`, every literal copied from an actual `lines.push()` call. All
five call sites (three in Attendance, two in Exams) now share it; the Attendance-local test was
folded in, including its first-seen-order case. **−114 lines, +59.**

Two semantics were decided rather than inherited: a `— on leave` suppression **counts as
not-reached** (the consumer marks everyone absent from the set as notified, and a suppressed student
was not notified), and monitor legs are **excluded entirely** (staff sample, not a student — both
old parsers inflated the "Resend N failed" count with a person who does not exist).

Side effect: lint dropped from 13 errors to 12. Removing the exported `parseFailedNames` from
`Attendance/index.jsx` cleared a `react-refresh/only-export-components` error — a page module that
also exports a helper is exactly what that rule is for.

### ~~Extract `api/`'s duplicated leaf helpers~~ — **DONE 2026-09-12** (auth preamble split out, still live)

Refactor-ledger item 1. `sendWabridge` existed **6 times** (five byte-identical, one differing only
in whitespace), `normMobile` **9 times** byte-identical, `readEnvLocal` **11 times**, and
`fmtDate` + `MONTHS` **3 times** — with no direct test on any copy, despite `normMobile` being the
function that decides which number a parent message is delivered to and whether a login mobile
matches a student or guardian record.

**Shipped:** `api/_mobile.js` (`normMobile`), `api/_env.js` (`readEnvLocal` + `envReader`),
`api/_wabridge.js` (`sendWabridge`, `fmtDate`, `MONTHS`, `WABRIDGE_URL`), each with its own test
file. Eleven endpoints rewritten: **−397 lines, +26**. Vercel function count unchanged at **12/12** —
underscore-prefixed helpers are not counted, same precedent as `_authRole.js` / `_googleCalendar.js`.

**One divergence surfaced and was resolved rather than preserved:** the eleven `readEnvLocal` copies
did not agree. Eight matched env-var names with `[A-Z_]+`, three (`sync-calendar`,
`send-mentor-nudges`, `send-attendance-alerts`) allowed digits with `[A-Z0-9_]+`. No key in use
carries a digit, so nothing was broken, but the permissive pattern is the strict superset — a narrow
one can only ever drop a key silently — so `_env.js` adopted `[A-Z0-9_]+` and a test pins it. The
codemod refused those three files rather than guessing, which is how the difference was found at all.

**Verified:** 3066 tests / 196 files pass; lint unchanged at its 28-problem baseline; and every
`api/*.js` was loaded under **plain Node's ESM loader** — not just Vitest's resolver — because that
is precisely where the 2026-07-28 `whatsappResultScore.js` extension bug hid behind 2106 green tests.

**Remainder promoted back to [`SUGGESTIONS.md`](./SUGGESTIONS.md)**: the bearer-JWT auth preamble,
repeated across seven endpoints, was deliberately left alone — those copies are *not* identical
(CRON_SECRET bypasses, a superadmin layer, a shared-secret path), and collapsing them wrongly grants
access rather than garbling a message.

### ~~De-duplicate the docx OMML pipeline (backfill candidate)~~ — **DONE 2026-09-12**

`gatErrorSetDocx.js` is a verbatim copy of `practiceSetDocx.js`'s maths pipeline — `MARKER`,
`MATH_PR_BLOCK`, `pickFn`, `latexToOmml`, `mathRuns`, `contentTable` and the post-pack marker swap.
Only `prettifyMath` is shared. The single-pass marker-swap optimisation (measured at 675 s → 441 ms
on a 1,740-equation set) had to be applied **twice**, by hand.

Shipped the same day. `src/lib/docxMath.js` now owns `MARKER`, `MATH_PR_BLOCK`, `pickFn`,
`latexToOmml`, `mathRuns`, `contentTable` and the post-pack marker swap; `practiceSetDocx.js` went
468 → 267 lines (`4ecff2d`) and `gatErrorSetDocx.js` 415 → 300 (`8bc8c18`), one revertable commit
each. `escapeRegex` deliberately stayed local to `gatErrorSetDocx` — its other caller,
`stripAnswerPrefix`, has nothing to do with maths. Verified in real Word (`OMaths.Count` 9/9 and
6/6 on fixtures), not just by parsing the zip. The 360 that authorised it is in
[`EXAM_REPORT_DOCX.md`](./EXAM_REPORT_DOCX.md) §2.

**How to apply:** after `src/lib/docxMath.js` exists and the practice set is on it, repoint
`gatErrorSetDocx` and delete its copies. Its existing tests are the guard. Verify in real Word — a
repair prompt is invisible to the suite.

## ~~2026-09-12 — No way to retire a batch~~ — **DONE 2026-09-12** (all three tiers)

`BATCH_RETIREMENT.md` (spec, nothing built). A batch's lifecycle is create → rename → hard
delete; `deleteBatch` is a cleanup for a batch created in error, and using it to retire a
finished cohort deletes teaching history and orphans `student_batches`. The Sept-2026 attempt
batches need this now and `LWS_NDA_2Y_(25-27)_A/B` (67 students) hits it in 2027.

The spec covers a **Tier 1 zero-code runbook** (usable today, order matters — freeze absence
times before touching the timetable, and run calendar sync after), **Tier 2 `archivedBatches[]`**
(the real fix: a visibility flag, ~10 call sites, half a day), and **Tier 3** (tighten
`deleteBatch` to refuse while `student_batches` rows exist).

**Shipped:** Tier 2 (`archivedBatches[]` + `src/lib/batchVisibility.js` + Settings UI), Tier 3
(`deleteBatch` refuses while `memberCount > 0`), Tier 1 (procedure in `OPERATIONS.md` →
*Retiring a finished batch*). The three "Record"-class sites — `isAligned` and the three
`syllabusBatches.filter(...).join(', ')` join-order expressions — keep reading the *unfiltered*
list, each pinned by a named regression test. The remaining production step is promoted to its own
open entry below.

## 2026-09-11

### ~~Backfill `questionId` onto exams uploaded before the column existed~~ — **DONE 2026-09-11** (the 10 most recent Maths mocks)

`migrate_question_ids.js` matched **1,191 of 1,200** questions to exactly one bank row by exact whitespace-normalised text, across 10 vault-built Maths mocks; **zero unmatched**, and the 9 ambiguous (text duplicated in the bank) were skipped rather than guessed. Verified from the DB: `with_ids == distinct_ids` on every exam, so no two questions claim the same row. NOT done by the `paper_questions` join proposed below — exact text against 33.5k LWS Maths questions proved unambiguous enough to verify directly, and zero misses is itself the evidence these papers came from the bank verbatim. **Older exams (pre-2026-08-29) still have none** — re-run with a larger `LIMIT` to extend. Original entry kept below for the reasoning trail.

The PYQ Vault Tags export now emits `QuestionId` and `parseTagsFile` stores it, but **forward-only** — every exam already in the bank has no bank provenance. Logged as a backfill candidate, **not** to be run without an explicit decision (it edits shipped exam rows).

**Why:** the value of the link (measured item difficulty, exposure control, finding every exam that used a mis-keyed question) scales with how much history carries ids. The forward-only set will take a full season to become useful on its own.

**How to apply:**
- **Do NOT fuzzy-match question text.** The vault knows exactly which questions went into which generated paper — `paper_questions` (migration 0039) holds the junction, and `papers` carries the finalize-snapshot. A per-paper join is exact; text matching would re-introduce the guessing this feature exists to remove.
- Papers built before the paper-builder existed, hand-typed sheets, and teacher written quizzes have no vault row at all — they stay null, permanently and correctly.
- Cheapest path for a recent exam needing no script: re-export its Tags sheet from the vault and re-upload via **Update Tags** — `ReuploadTagsModal` already merges `questionId` (`?? q.questionId` so a sheet without the column never wipes one).
- A backfill must be a dry-run-first script that reports matched/unmatched per exam and writes only `questions[].questionId`, touching no other field. Run the 360 (scope · blast radius · does-it-apply · risk · cost) before proposing it.

## 2026-07-29

### ~~Subtopic cleanup Tiers 2 and 3 are unapplied~~ — **Tier 2 DONE 2026-07-29; Tier 3 open**

Tier 1 (mechanical: casing, `&`-vs-`and`, plural/suffix, exact synonym) shipped 2026-07-29 — 58 questions, 2,665 → 2,641 distinct `(subject, chapter, subtopic)` triples. The remaining ~70 groups from `/subtopic-analyse` were deliberately left.

**Why:** they cross concept boundaries, so each needs a judgment call rather than a string rule, and bundling them behind the safe merges would have hidden the risky ones inside a large diff.

**How to apply:** re-run `/subtopic-analyse` first — it reads Supabase live, so it will already reflect Tier 1. Then, per tier:
- ~~**Tier 2 — concept merges.**~~ **Applied 2026-07-29** — 51 renames / 69 questions / 10 exams; distinct triples 2,641 → 2,597. Three groups were **narrowed** against live data first: Clouds (the report's 6 types were really ~27 subtopics / 45 Q including distinct concepts — only the `<X> Cloud Characteristics` family merged), Question Tags (30 buckets, not 6 — half are distinct grammar rules and stayed split), Total Internal Reflection (spans 3 chapters — only the same-chapter 6 merged). Original scope was: Question Tags → `Simple Present` (7 one-Q buckets), `Classical Probability` (split by Cards/Coins/Dice), `Cloud Types & Characteristics` (6 cloud types, 12 Q — the best non-Maths consolidation), `Conservation of Angular Momentum` (split by Earth/Gymnast/Human Body), `Phrasal Verbs` (split by keyword), `Common Chemicals` (one bucket per chemical). All share one shape: **split by prop or scenario rather than by concept**, leaving ~45 Q in buckets of 1–3.
- **Tier 3 — needs a call per item.** `Polar Form` + `Exponential Form`, `First`/`Second Ionization Enthalpy`, `Velocity-Time Graph Area` + `Slope`, `Absolute Value Equations` + `Inequalities`, `Determinant Equations` + `Solving Determinant Equation` (neither name is the canonical — a new one must be chosen).
- **Not renames — do not fold into either tier.** `Geometric Progressions` (32 Q) is a catch-all that likely already contains the sum questions; it needs re-tagging at the question level. `Inverse Trigonometric Identities` in the *Differentiation* chapter is a wrong chapter tag.

Add entries to **both** `merge_subtopics.py` and `migrate_subtopics_supabase.js` (the drift test enforces this), with a test case per pair and a KEEP case per near-miss, then `node migrate_subtopics_supabase.js --dry-run` before applying.

## 2026-07-28

### ~~Browser golden-path verify the 2026-07-28 staff-parity work~~ — **DONE 2026-07-29** (browser pass confirmed by the owner — covers the Written Quiz flow noted in the body)

Four capture flows shipped without a manual browser pass: teacher extra-class filing and homework filing on `/school-attendance`, and the leave lifecycle + meal filing on `/hostel-mess-attendance`. All are covered by tests and a serialized full suite (2073/2073), but the project's Definition of Done requires the golden path clicked through in a real browser, and these are phone-first surfaces used by staff mid-shift.

**Why:** the failure modes left are the ones tests cannot see — a mis-tap target on a phone, a modal footer that still needs scrolling on a short viewport, a copied link that pastes wrong into WhatsApp. This subsystem exists because capture wasn't happening; friction here is the whole risk.

**Also covers (added 2026-07-28, later the same day):** the **Written Quiz** flow — create one, check Save stays disabled until every student is marked or ticked absent, save, then re-open it from the "Written Quizzes today" strip and confirm the marks pre-fill. Then confirm the admin Exams page shows the *Written Quiz* badge + "by <teacher>", and that a monthly report PDF for that student renders `Name (Written Quiz)`.

**How to apply:** on a real handset — (1) `/school-attendance` → **+ Extra class** → file → reload → the card must come back from the submission row; (2) same page → **Homework** → chapter + tick → the count badge appears; (3) `/hostel-mess-attendance` → save Breakfast with nobody missing → pill gets a ✓ and admin's Hostel tab reads 1/5 filed; (4) put a boarder on leave → the open-leave panel lists them → **back?** unlocks the row. Carries forward the still-open `/school-attendance` Phase-1 verification entry from 2026-07-27.

### ~~Decide the "Sets" resend~~ — **DONE 2026-07-28** (the label question below is still open)

Resent the same day: `POST /api/send-whatsapp 200` at 13:56 UTC, **17 messages, 0 skipped**, recorded under the re-uploaded exam `exam_1785246646088`. Marks behind it check out (Shivam 5 → 100%, Satyam 4 → 80%, Vihan 0 → 0% genuinely). Note the exam was deleted and re-uploaded first, so the original wrong message's deep-link points at a dead id and its focused card renders nothing — harmless, since every family got a fresh link.

**The template-label half survives** and is the reason this entry stays readable rather than deleted: on an offline exam the corrected numbers are **marks** sitting under the approved template's fixed "Correct Qs" / "Total Qs" labels. For Sets that happens to read true (marking is `{correct:1, wrong:0}`, so 4 marks *is* 4 correct out of 5 questions), but for a paper marked out of 30 it will not. Either accept it as a documented quirk, or get a neutral template approved ("Marks: {{5}} / {{6}}") — ~3-day Meta lead time, a second template ID in Vercel env, and a branch in the endpoint choosing template by offline-ness. Param rules in `memory/feedback_whatsapp_template_param_rules.md`.

<details><summary>Original entry</summary>

The 13 Sets families were messaged "Score: 0%, Correct Qs: 0, Total Qs: 0" for a paper they scored 0–5 on. The scoring fix is deployed (`c5edadf`), so a resend now reads correctly (80% for a 4/5). The decision was never made. It is coupled to a second one: on an offline exam the corrected numbers are **marks** sitting under the approved template's fixed "Correct Qs" / "Total Qs" labels. For Sets that happens to read true (marking is `{correct:1, wrong:0}`, so 4 marks *is* 4 correct out of 5 questions), but for a paper marked out of 30 it will not.

**Why:** these are the same families who already received a wrong message, so a second one wants to be right in both senses. And the label question only gets more expensive later — every offline exam sent between now and a template change inherits it.

**How to apply:** resend is a normal blast (💬 Send on the exam, all students) once you decide it is wanted — but do it *after* confirming the deployed fix with a redirect-to-self test send, not before. For the labels, either accept marks-under-question-labels as a documented quirk, or get a neutral template approved ("Marks: {{5}} / {{6}}") — ~3-day Meta lead time, a second template ID in Vercel env, and a branch in the endpoint choosing template by offline-ness. Param rules in `memory/feedback_whatsapp_template_param_rules.md`.

</details>

### ~~Browser golden-path verify the offline-exam WhatsApp score + the new preview column~~ — **DONE 2026-07-29** (browser pass confirmed by the owner)

Both 2026-07-28 WhatsApp changes shipped without a manual browser pass: the offline scoring fix in `api/send-whatsapp.js` and the read-only "Score (as sent)" column in `WhatsAppPreviewModal`. Covered by tests (12 on the pure module, 7 on the modal including a parameterised binding assertion, 32 on the endpoint, full suite 2106/2106), but the project's Definition of Done requires the golden path clicked through, and there is no browser automation in the repo to do it from a session.

**Why:** the remaining failure modes are the ones tests cannot see — the extra column crowding the parent-mobiles input at real widths (table min-width was bumped 560→660px on inspection alone), and, more importantly, whether the delivered WhatsApp body actually matches the previewed number. The whole point of the column is that it is trustworthy; nobody has yet seen it agree with a real message.

**How to apply:** Exams → an **offline** exam (Sets, or Integration from 5 Jun which is in local dev data) → 💬 Send. Confirm the column reads `80% 4 / 5` for Satyam Pune rather than `0% 0 / 0`, and that the Branch / Mobile / Parent Mobiles fields are still comfortable. Then put your own number in "Test — redirect all to" and confirm the received message says 80%. Check one MCQ exam too, to confirm nothing regressed on the common path.

**Narrowed 2026-07-28:** the *send* half is now confirmed in production, not just by tests — a real blast returned 200 with 17 messages against correct marks, and the student portal was opened on the resulting deep-link. What remains unverified is the **preview column's layout** at real widths and, strictly, that the previewed number matches the delivered message body for the same student (nobody has compared the two side by side). Also still unverified by anyone: the student-portal display changes that followed (`a5cb79b`, `f61dc9f`, `60a1796`) — the `—` cells, `5 / 5` score, and the `▲ N pts` delta.

## 2026-07-27

### ~~Browser golden-path verify the offline-exam marks grid~~ — **DONE 2026-07-27**

Verified in-browser by the user on `nda-tracker.vercel.app` — the derived roster, marks entry, and save path work end-to-end against live `studentProfiles`. This closes the last open Definition-of-Done item for commit `95ae7be`. Original entry kept below for the record.

The in-app marks grid shipped this session (commit `95ae7be`, pushed to `main` → already deployed) with TDD coverage (+37 tests, 1924 green), clean lint, and a passing `vite build` — but **not click-verified**. The session had no browser tooling, and the save path needs a live Supabase **admin session** (only exists on Vercel). Same manual-verify gap logged for every prior feature; note the *file-upload* offline path was verified back on 2026-06-29, but the grid is a new path to the same `addExam`.

**Why:** the seams unit tests can't reach are exactly the ones that matter here — `buildOfflineRoster` reading **live** `studentProfiles` (the tests use hand-built fixtures, so a real `batches[]`/`accountStatus` shape mismatch would be invisible), the `addExam` → Supabase round-trip with `questions: []` + `max_marks`, and whether the derived roster actually matches who sat the paper. If the roster comes back empty or wrong for a real batch, the whole feature is unusable and nothing in CI would say so.

**How to apply:**
- On `nda-tracker.vercel.app` (admin): Exams → **+ Offline marks** → fill name + max marks → tick a real batch → **confirm the roster loads with the expected students** (count matches the batch; no blocked/quit students; no duplicate rows for students with name variants).
- Type marks for 2–3 students, leave one blank, Save. Confirm: the exam card shows an "Offline" badge with the right %-of-max; the blank student is **absent** from the results, not a zero; the exam appears in the Dashboard trend and that student's Exam History.
- Test **📋 Paste a column**: paste `72`, blank line, `55` and confirm it fills rows 1 and 3 in roster order, leaving row 2 empty.
- Switch to **📄 Upload file** → **Download template** and confirm the Name column arrives pre-filled with the selected batch's roster.
- Edge: with no batch ticked, confirm the grid shows "Select a batch above to load its students" and Save stays disabled.

### ~~Verify the `/school-attendance` teacher flow in a real browser (Definition-of-Done gap)~~ — **DONE 2026-07-29** (browser pass confirmed by the owner)

Phase 1 shipped with TDD coverage (1967 green), baseline-clean lint and the migration applied to production Supabase — but **not click-verified**. Everything that matters here needs a live session and live data, which unit tests fixture away.

**Why:** the seams the tests can't reach are exactly the risky ones. `findTeacherByEmail` joins the **auth email** to `timetableTeachers[].email` with no FK behind it — if the live teacher rows have blank or differently-spelled emails, every teacher sees "not linked to a teacher record" and the feature is dead on arrival. Likewise the `mapping.teacherId` coverage: if live mappings mostly have no teacher assigned, teachers will see an empty day while the admin board shows everything as "unassigned". Both are data-shape questions, invisible in CI.

**How to apply:**
- Query first (cheap, do this before touching a phone): how many `timetableTeachers` have a non-blank `email`, and what share of `timetableMappings` have a non-null `teacherId`. If either is thin, fix the data before rollout — the feature is only as good as that join.
- Sign in as a real teacher account on a phone → `nda-tracker.vercel.app/school-attendance`. Confirm: their own periods only, right batches, ordered by time; the identity line names them.
- File one period with absentees and one with **nobody** absent. Confirm both flip to **Filed**, and that the all-present one is what proves `lecture_submissions` is doing its job.
- As admin: Attendance → Lecture log → confirm `FilingBoard` shows the same two as filed and names who is outstanding.
- Confirm a teacher session does **not** trip the "your data is out of date · Reload" banner while navigating the portal (the `persist.js` early return).
- Add to home screen; confirm the icon label reads "NDA Tracker" and the icon reopens the page.

### ~~Meal checkpoints have no filed-vs-silent record~~ — **DONE 2026-07-28**

Shipped in `4cedaa8`. `checkpoint_confirmations` gained a `kind` discriminator (`roll` | `meal`) with the count columns made nullable and a CHECK keeping rolls strict — deliberately **not** the plain "drop NOT NULL" suggested below, which would also have let a roll be written with no reconciliation. `markCheckpointFiled` writes meal rows and refuses roll checkpoints; the `ROLL_CHECKPOINTS` guard in `confirmRoll` therefore stayed. Admin filing board added atop the Hostel tab. (Original entry retained below for the reasoning trail.)

Roll checkpoints get `checkpoint_confirmations` (headcount + `reconciled`), so "the warden did the night roll" is recorded. Meals have nothing: an unmarked breakfast and a breakfast where everyone showed up are both zero `checkpoint_absences` rows. Now that mess staff file their own meals, that ambiguity is live — the same gap `lecture_submissions` was created to close for lectures.

**Why:** it is the failure mode that hides itself. An unfiled meal reads as a clean one, so nobody is chased and the gap never surfaces. The hostel subsystem already models the concept (`checkpoint_confirmations`), it just doesn't cover meals.

**How to apply:** the table's `expected_count` / `confirmed_present` / `reconciled` are all `NOT NULL`, so extending it to meals needs either a migration making them nullable (a meal has no headcount) or a "filed" row with sentinel counts — the former is cleaner. Then add a filed/outstanding strip to the admin Hostel tab mirroring `FilingBoard`, and drop the `ROLL_CHECKPOINTS` guard in `confirmRoll` accordingly. Deferred because it needs a schema change and was outside the requested scope.

## 2026-07-25

### ~~Add an optimistic-concurrency guard to `saveToSupabase` so stale tabs can't silently clobber~~ — **DONE 2026-07-25**

Shipped option (1), the version guard: `src/store/persist.js` keeps a module-level `knownVersion` (the `updated_at` captured by `loadFromSupabase`) and predicates every update on it via `.eq('updated_at', knownVersion).select('updated_at')`. Zero rows matched → `staleLock` set, all further saves short-circuit, `onSaveConflict` fires → store `saveConflict` → new `src/components/layout/StaleDataBanner.jsx` ("Your data is out of date · Reload", no dismiss). Saves are serialised through a promise chain so overlapping fire-and-forget saves don't self-conflict; a null version (never loaded) still writes unguarded. TDD: +8 persist tests, +3 banner tests, 1884 green. Original entry kept below for the record.

`faculty_state.data` is one JSONB blob written last-write-wins. Prod `saveToStorage` (`src/store/persist.js`) serialises **every allow-listed key** — `syllabusPrograms`, `batchSyllabusProgress`, timetables, send history, … — and `saveToSupabase` PUTs the whole object with no merge and no version check. The table already has an `updated_at` column, but **nothing reads it**. On 2026-07-25 this reverted a completed out-of-band syllabus rewrite ~2 minutes after it landed: a single admin tab that had loaded *before* the write flushed its stale in-memory blob on an unrelated mutation, restoring all 51 old chapters and their progress. Nothing was lost (the revert was a faithful copy of the prior state) but the work had to be re-applied, and the failure was **silent** — no error, no console warning, no UI hint.

**Why:** this is a data-durability hole, not just an annoyance. Two admins working simultaneously will overwrite each other the same way, and neither will know — the loser's edits simply vanish on the winner's next save. It also makes every direct SQL/MCP edit to `faculty_state` conditionally safe at best, which matters because such edits are routine in this project (syllabus programs, `ndaFreqBySubject`, timelines). Today the only mitigation is a procedural "have everyone hard-refresh", which depends on a human remembering.

**How to apply:** pick one —
1. **Version guard (recommended).** Stash the `updated_at` returned by `loadFromSupabase()` in the store (non-persisted). Have `saveToSupabase` send it as a predicate — `.eq('updated_at', knownVersion)` on the update, or a small RPC doing a compare-and-set — and set `updated_at = now()` on success. Zero rows affected → the row moved under you: surface a non-dismissable "Your data is stale — reload before continuing" banner and **stop saving** until reload. Cheap, no schema change.
2. **Per-key writes.** Split the blob save into targeted `jsonb_set` calls per changed key so two tabs editing different domains stop colliding. Narrows the blast radius but doesn't fix same-key races, and is a larger refactor of the save path.
3. **Realtime invalidation.** Subscribe to `faculty_state` via Supabase Realtime and force a reload/merge when another client writes. Best UX, most moving parts.
Note (1) and (3) compose well. Whichever is picked, add a test that a save from a client holding a stale version is rejected — that's the regression that matters.

### ~~Browser-verify the rebuilt NDA P/C/B syllabus (still unconfirmed)~~ — **DONE 2026-07-25**

Verified in-browser by the user: the rebuilt 14 / 12 / 9 P/C/B chapters render correctly on `nda-tracker.vercel.app` with the weightage suffixes and descending order intact, and the clobber has not recurred. Original entry kept below for the record.

The NDA Program's Physics/Chemistry/Biology chapters were rebuilt to PYQ Vault's taxonomy on 2026-07-25 (14 / 12 / 9 chapters, weightage in each name, sorted desc) and re-applied after the clobber described above. The database was verified by query — 14/12/9, zero orphaned progress ids, surviving `Done` marks intact — but **nobody has confirmed it renders correctly in the app**, because the one attempt to look at it happened while the reverted data was live.

**Why:** the golden-path check is the project's definition of done and it is the one step still open. It also double-checks that the clobber has not recurred — if the chapters show the old names again, a stale tab is still flushing and the version guard above stops being optional.

**How to apply:** on `nda-tracker.vercel.app` → **Syllabus** → batch `LWS_NDA_2Y_(25-27)_B` → **NDA Program**, expand each of Physics / Chemistry / Biology. Confirm (a) counts read 14 / 12 / 9; (b) order is descending by the bracketed % (Physics starts `Light and Optics (21.6%)`, Chemistry `Carbon and Its Compounds (17.2%)`, Biology `Human Physiology (27.4%)`); (c) the carried-over `Done` ticks are present — Physics should show Done on Kinematics, Laws of Motion, Work/Energy/Power, Gravitation, Fluid Mechanics, Heat and Thermodynamics, Sound. Also spot-check `APJ_NDA_12th_(26-27)` (Chemistry: Metals and Non-Metals, Acids/Bases/Salts, Atomic Structure all Done). If any old chapter name appears, re-query Supabase before assuming a render bug.

## 2026-07-21

### ~~Ship + browser-verify the chapter-level Learn/Practice links on "Where to focus" (deploy PYQ Vault FIRST)~~ — **DONE 2026-07-29** (browser pass confirmed by the owner on 2026-07-29, which implies both repos shipped — reopen if PYQ Vault is not actually deployed)

This session fixed the student **"Where to focus"** card's Practice link (it fell through to the generic `/browse?kind=practice` bank because it sent bare subtopic *names* with no subject/chapter) and added a **Learn →** link, both now **chapter-level**. Two repos changed, both green + lint-clean via TDD, but **nothing is committed or deployed yet**. nda-tracker: `chapterLearnUrl`/`chapterPracticeUrl` in `src/lib/remediation.js`, `src/lib/focusAreas.js` emits `learnUrl`+`practiceUrl`, `FocusAreas.jsx` renders Learn (primary) + Practice. PYQ Vault (`Question_Bank`): `goLinks.ts` `BY_CHAPTER`/`getChapterByName`/`buildChapterLearnPath`, `/go/learn` chapter fallback, `/go/practice` NAME mode fires on `subject && chapter` alone. See [[reference_remediation_links]] point 3.

**Why:** the links are the user-visible fix that started this session — worthless until live. **Deploy order is load-bearing:** the tracker's new URLs (`/go/learn?chapter=…`, chapter-only `/go/practice`) only resolve once the PYQ Vault route changes are live, so ship `Question_Bank` first, then nda-tracker. The cross-app golden path can only be checked after both deploy (sessions are non-interactive; no browser driver) — same manual-verify gap logged for every prior feature.

**How to apply:**
- Commit both repos (separate `feat:` commits) — PYQ Vault first, confirm its deploy is live, then nda-tracker.
- On `nda-tracker.vercel.app`, open a student with a populated "Where to focus" card (e.g. Pooja): click **Learn →** on a chapter → confirm it lands on that chapter's notes index (`/notes/nda-maths/<chapter>`), and **Practice →** on a Maths chapter → confirm it lands on the chapter-filtered practice bank (not the generic browse).
- Confirm graceful degrade: a focus chapter with **no notes** lands on the `/notes` index (not a 404); a chapter with **no practice questions** lands on `/browse` — acceptable fallbacks, but note which chapters hit them (notes/practice coverage is incomplete) in case coverage should be prioritised.
- Pre-existing lint note: `StudentView.jsx:119` has 4 `set-state-in-effect` errors (baseline, unrelated to this change — a line not touched); leave them per the CLAUDE.md "add the disable comment only if you touch those lines" rule.

## 2026-07-20

### ~~Feed the upload key-resolver into the re-grade action (carry-forward)~~ — **SUPERSEDED 2026-09-12** → folded into [Build the re-grade action if key corrections recur](#build-the-re-grade-action-if-key-corrections-recur) (2026-09-11)

Folded as the second entry point into one re-grade item, rather than a third place telling you to build it. Its substance — an upload-time key override is the moment faculty is most certain a key is wrong, and `keyMismatches[].chosen` already threads the corrected keys into wizard state — is carried into the surviving entry.

<details><summary>original</summary>

The answer-key cross-check shipped this session (`KeyMismatchPanel` + `findKeyMismatches`, commit `d9ae77c`) lets faculty override the Evalbee `Q N Key` with the tags-file `Answer` at Step 1 of upload. Picking "Tags" is an explicit assertion that **Evalbee's key — and therefore Evalbee's grading of that question — is wrong**. But the cross-check only sets the *displayed* answer/solution/analytics (`questions[].answer`); `total_marks`/`responses` stay at Evalbee's original (now-known-wrong) grading. This is a **new, at-upload trigger** for the already-open **"Build the re-grade-from-stored-choices action"** entry (2026-06-09 above) — not a separate feature.

**Why:** an upload-time key override is the moment faculty is *most certain* a key is wrong, yet today it silently leaves scores/ranks wrong for exactly those questions. The two features compose: the resolver already threads the chosen keys into wizard state (`keyMismatches[]` with `chosen`, passed at `onNext`), so `regradeFromChoices` has its input ready.

**How to apply:**
- Do the re-grade entry first (it's the prerequisite; this is just a new entry point into it).
- When built, after an upload where the user overrode ≥1 conflict to the Tags key, offer (or auto-open) the re-grade **preview** for that exam — corrected `questions[].answer` × captured `exam_results.choices` × `marking` makes it deterministic.
- Keep it preview-gated/opt-in like the parent entry — overriding display ≠ auto-shifting grading authority Evalbee→app.

</details>

### ~~Browser golden-path verify the Monthly Reports date-range + branch + conduct-block PDF~~ — **DONE 2026-07-29** (browser pass confirmed by the owner)

The Monthly Reports rework this session (custom From→To range + branch-narrows-batch, commit `4fecd00`; exception-only stacked conduct blocks in the PDF, commit `13b422c`) shipped **test-verified but not click-verified** — sessions are non-interactive, no browser driver is available, and the Generate→download flow needs a live Supabase **admin session** (only on Vercel). A sample PDF *was* rendered headlessly end-to-end (valid, all four conduct blocks), but the real UI seams weren't driven. Same manual-verify gap logged for every prior feature.

**Why:** the unit tests cover `conductBlocks`/`rangeLabel`/cohort exactly and the fetch signature, but not: the date pickers → `fetchMonthlyReportData(from,to,ids)` round-trip, the Branch dropdown actually narrowing the Batch list, the invalid-range Generate-disable, and — the one thing no headless check can confirm — the **visual layout/spacing** of the stacked blocks and the "Period:" header on a real multi-student batch. FLOWS.md notes PDF layout is "reviewed out of band."

**How to apply:** on `nda-tracker.vercel.app` (admin): Sidebar → Monthly Reports → pick a Branch (confirm the Batch list narrows to that branch's batches) → pick a Batch → confirm the default range = previous month and cohort count → set a custom From→To that spans part of a month (confirm the header reads e.g. "5 Jun - 20 Jun 2026", a whole month reads "Jun 2026") → Generate → download one PDF and eyeball the stacked conduct blocks (Attendance line present; Late/Missed/Homework blocks appear only when non-empty; a clean student shows just Attendance or none) → download the ZIP and confirm the filename carries the range label. Edge: set From > To and confirm Generate is disabled with the inline hint.

## 2026-07-14

### ~~Align (or deliberately keep divergent) `getPriorityChapters` accuracy vs the pooled projection~~ — **MOOT 2026-09-12**

The Priority Chapters widget was removed from the Dashboard (2026-09-12), so there is no longer a second surface for faculty to cross-read against the Projected card — the credibility gap this described cannot be seen. `getPriorityChapters` itself is untouched and still tested; if the widget is ever re-wired, decide (a) or (b) below *before* shipping it.

The projected-score accuracy was reworked (2026-07-14) to **pool a chapter's questions** (`Σ score×weight / Σ weight`) instead of averaging per-subtopic ratios — see `computeProjectedScore` in [src/lib/analytics/projection.js](src/lib/analytics/projection.js) and the DECISIONS.md entry. The Dashboard's **Priority Chapters** widget (`getPriorityChapters` in `src/lib/analytics/dashboard.js`) still computes chapter accuracy its own way (`priority = weightPct × (1 − accuracy)`), so the two surfaces can now disagree slightly on a chapter's accuracy for the same student/cohort. This divergence was **deliberately deferred** to keep the projection change's blast radius small.

**Why:** two Dashboard/Toppers surfaces showing different "accuracy" for the same chapter is a subtle credibility gap — a teacher comparing the Projected card's Functions accuracy against the Priority Chapters list may see mismatched numbers. Low urgency (numbers are close and priority is a *ranking*, not an absolute), rising if faculty start cross-reading the two.

**How to apply:**
- Decide: (a) **align** `getPriorityChapters` to the same pooled `Σ score×weight / Σ weight` method (extract a shared `chapterAccuracy(subs)` helper both call, so they can't drift), or (b) **keep divergent on purpose** and document why (priority is class-level weightage×gap, projection is per-student potential — arguably different questions).
- If aligning: it's class-level (uses `computeChapterStats`, not the per-student `computeStudentChapterStats`), so the pooled helper needs a counts-based variant or the raw weighted sums exposed there too. TDD against `dashboard.test.js`'s existing `getPriorityChapters` block.

## 2026-07-11

### ~~Browser golden-path verify the leave lifecycle + present/absent lecture marking~~ — **DONE 2026-07-29** (browser pass confirmed by the owner)

This session shipped a lot of leave-aware UI (On Leave tab: Put on leave / Mark returned / stale flag; lecture `MarkAbsenteesModal` present/absent toggle + leave-lock; `LectureLogTab` "Also attending" pooled roster) — all **test-verified but not click-verified** (sessions are non-interactive; the board needs a live Supabase admin session that only exists on Vercel). Same manual-verify gap logged for every prior feature.

**Why:** the seams unit tests can't reach — `addLeave`→board round-trip, the present-mode derivation writing the right absentee set, the pooled-roster union actually pulling 6M students into a 12th period, the `endLeave` "returned?" closing a leave and unlocking the row — are where a regression hides. And the whole point (stop hand-entering leaves via SQL) only pays off if the UI works end-to-end.

**How to apply:** on `nda-tracker.vercel.app` (admin, hard-refresh first): Hostel & Mess → **On Leave** → **+ Put on leave** → select 2 boarders → confirm they appear on the list open-ended, then **Mark returned** on one and confirm it closes. Attendance → **Lecture log** → pick the APJ 12th batch → **Also attending** = the 6M batch → open a period → toggle **Present list** → tap the present students → confirm the preview "will log absent N" matches roster−present−leave and an on-leave student shows locked with a "returned?" link.

## 2026-07-08

### ~~Verify the hostel golden path in the browser~~ — **DONE 2026-07-29** · finish the warden-alert rollout (STILL OPEN)

> Browser pass confirmed by the owner 2026-07-29. **The warden-alert rollout below is still outstanding** — the endpoint stays fail-closed until `WABRIDGE_HOSTEL_ALERT_TEMPLATE_ID` is set in Vercel and the variable order is confirmed with a live `redirectTo` test.

The hostel & mess feature (Phases 1+2, commits `5821163`/`f9a5760`/`b5bcdc5`) shipped with full unit/lint coverage (chain aggregator, both slices, endpoint, HostelTab) and a **DB-contract smoke test** (sentinel insert/read/delete of all three tables), but the **end-to-end browser pass was not run** — the session was non-interactive and the board needs a live Supabase **admin session** (only exists on Vercel). The warden alert is also inert until its env is set. Same manual-verify gap noted for offline exams / monitoring / remediation / mentee-assignments / integrity / week-of-dates.

**Why:** the seams that unit tests can't reach — the marking→save round-trip, the reconciliation gate writing `checkpoint_confirmations`, the chain board flagging a real unexplained boarder, and (critically) the **filter-as-display-lens** guarantee that a filtered save doesn't drop hidden rows — are exactly where a regression hides. And the alert is half-live: code deployed, but nothing sends until the template + a warden number exist.

**How to apply:**
- On `nda-tracker.vercel.app` (admin): Attendance → **Hostel & Mess**. Mark a Night Roll exception → Save → filter to Boys/Girls, mark one, Save → **reopen and confirm the other wing's marks survived** (the display-lens guarantee). Enter a headcount → **Reconcile & close** (tie = ✓; mismatch = OPEN incident). Switch to **Chain** → confirm a real unexplained boarder is flagged with the right first-break.
- Warden alert rollout: get the Meta/Wabridge template approved → set `WABRIDGE_HOSTEL_ALERT_TEMPLATE_ID` in Vercel (`SUPABASE_SERVICE_ROLE_KEY` already set) → add a warden number in the Hostel tab → **Send test via `redirectTo` to your own number to confirm the `[date, listText]` variable order** (order isn't knowable from the template ID — per the template-param rules) → flip the `variables` order in `api/send-attendance-alerts.js` + the `reference_whatsapp_templates` row if swapped.

### ~~Push the day-scholar filter deploy (pending)~~ — **DONE** (shipped as `f5c0d0a`; confirmed 2026-09-12)

Committed and pushed as `f5c0d0a` "feat(hostel): exclude APJ day-scholars from the boarder board + alert" — verified an ancestor of `origin/main`, so it has been live on Vercel since that deploy. The entry simply never got struck.

<details><summary>original</summary>

The day-scholar wiring (studentSlice + HostelTab + tests + DATABASE_SCHEMA/FLOWS) is committed-ready in the working tree but **not yet committed/pushed**, so it isn't live on Vercel. Anvay Sawant is flagged `residential=false` in the DB but still shows on the prod board until this deploys.

**Why:** the data change is live but the code that acts on it isn't — a half-applied state.

**How to apply:** commit the working-tree changes (`feat(hostel): exclude day-scholars from the boarder board`) and push to `main`; verify on `nda-tracker.vercel.app` that Anvay Sawant no longer appears on the Hostel & Mess board.

</details>

## 2026-06-29

### ~~Manually verify the timetable week-of-dates golden path in the browser~~ — **DONE 2026-06-29** (cleared in the batch browser-verification pass)

The "Week of" date feature (commit `b3118d9`) shipped with full unit/lint coverage (helper + grid-render tests, 43 green in the timetable area, prod build ✓) but the **end-to-end browser pass was not run** (global Definition of Done requires it). The picker → `weekDates` → grid header → PNG/Excel export seams are only unit-covered. Same gap noted for offline exams (2026-06-09), monitoring (2026-06-16), remediation (2026-06-18), mentee-assignments (2026-06-19), and integrity (2026-06-21).

**Why:** the export seams in particular are unit-blind — the PNG path relies on the cloned `<table>` carrying the new header `<div>` along (plus a dark-header contrast tint applied only in the clone), and the Excel path emits `Mon\n29 Jun` into a styled `xlsx-js-style` cell with a taller header row. A wrong wrap/clip or a low-contrast date line wouldn't fail a test. A 2-minute pass confirms it before faculty prints a dated timetable.

**How to apply:**
- On the Timetable page (Student View), confirm the "Week of" picker defaults to the current week's Monday and each Mon–Sat header shows the right date beneath the day name; change the week and confirm the dates shift; click **Clear dates** and confirm the plain recurring grid returns.
- Click **⬇ PNG** — confirm the dates appear under each day in the image and are legible on the dark indigo header (the indigo-300 tint).
- Click **⬇ Excel** — open the file and confirm each day header cell shows the day name with the date on a second line, not clipped.
- Edge: pick a Sunday in the picker and confirm the grid anchors to the *preceding* Mon–Sat week (ISO behaviour), not the next one.

## 2026-06-21

### ~~Cross-exam "repeat offender" integrity rollup — flavour 1 (incident-log aggregation)~~ — **DONE 2026-06-21**

Shipped the incident-log flavour: pure `buildIntegrityLeaders(rows, studentProfiles)` ([src/lib/analytics/integrityLeaders.js](src/lib/analytics/integrityLeaders.js)) + `getAllIntegrityIncidents()` slice reader + `IntegrityLeaders.jsx` Dashboard widget (hide-when-empty, ranked repeat-first, expandable exam list, click-through). +9 tests; 1618 green. Empty until incidents accrue. **Flavour 2 (below) remains open.**

### ~~Manually verify the Exam Integrity golden path in the browser~~ — **DONE 2026-06-29** (cleared in the batch browser-verification pass)

The integrity feature (detection panel + admitted-incident logging) shipped with tests + lint green (1609 passing) but the end-to-end browser pass wasn't run — same gap noted for offline exams (2026-06-08), monitoring (2026-06-16), remediation (2026-06-18), and mentee-assignments (2026-06-19).

**Why:** the wiring spans panel → `studentProfiles` name→lwsId resolution → `logIntegrityIncident` upsert → StudentView card → student/parent portal (`api/student-login` return). That's a lot of seams a unit test can't fully exercise; the global Definition of Done requires the manual pass.

**How to apply:** as admin/teacher on a choice-bearing exam (e.g. the APJ 11th Maths mock), open 🕵 Integrity → confirm a flagged pair (Manas↔Saarth should be Tier B) → click "[name] admitted" → confirm the "✓ logged" badge → open that student in StudentView → see the red "⚠ Academic Integrity" card → log in to the student/parent portal for that student and confirm the card shows there too → finally test admin-only delete (× present for admin, absent for teacher).

## 2026-06-19

### ~~Finish the mentorship-nudge production rollout (env + mobiles + live var-order check)~~ — **DONE 2026-06-19**

Rollout completed by the user: Vercel env (`WABRIDGE_MENTOR_NUDGE_TEMPLATE_ID` + `CRON_SECRET`) set, teacher mobiles entered, and the live test-send confirmed the `[date, students]` variable order. The daily cron is now live (07:30 IST, Mon–Fri).

The daily mentor nudge shipped (commit `728ddf1`, pushed to main) with full unit/lint coverage (1568 Vitest) and a verified live dry-run against real data, but three user-side steps remain before the cron can fire for real. The cron is already in `vercel.json` but is **fail-closed** — without `CRON_SECRET` set in Vercel it rejects the daily call, so nothing sends until the rollout is finished.

**Why:** the feature is half-live — code deployed, but the autonomous send is inert until the env vars exist and teacher mobiles are entered. And the Wabridge template's positional variable order (`[date, students]`) is a guess until a real message confirms it (per the project's template-param rules, order isn't knowable from the template ID).

**How to apply:**
- Vercel → Settings → Environment Variables: `WABRIDGE_MENTOR_NUDGE_TEMPLATE_ID=1563510878524516` and a random `CRON_SECRET` (the shared `WABRIDGE_*` + `SUPABASE_SERVICE_ROLE_KEY` already exist). Redeploy (env changes need a fresh deploy).
- Settings → Teachers: enter each mentor's WhatsApp `mobile` (at least your own first).
- Settings → Mentorship: **Preview today's picks** (sanity), then **Send test to** your own number and confirm the message renders `Date: …` / `Students: …` correctly — if the date/students are swapped, flip the `variables` order in `api/send-mentor-nudges.js` (the `[dateLabel, namesList]` line) and the `reference_whatsapp_templates` row.

### ~~Decide mentor-nudge name style: canonical vs familiar short names~~ — **CLOSED 2026-06-19 (not needed — canonical names kept)**

Decided: keep full canonical names in the message. No change to `api/send-mentor-nudges.js`.

The nudge message lists mentees by **full `canonical_name`** (e.g. "Pooja Harishchandra Gaikwad", "Himanshu Suvarna Kutal") rather than the short familiar names mentors used on their own sheets ("Pooja Gaikwad", "Himanshu Kutal"). Canonical is unambiguous and always present; short names read more naturally to the teacher.

**Why:** purely cosmetic, but a mentor scanning 3 names daily may prefer the form they already use. Cheap to change; flagged at build time, left as canonical (the safe default).

**How to apply:** in `api/send-mentor-nudges.js`, when building `namesList`, prefer a shorter display form — e.g. the first `name_variants` entry, or first+last token of the canonical — falling back to canonical. Decide whether "familiar" should be a stored per-student display field or a derived first+last (deriving is zero-schema but can mis-shorten some names).

### ~~Mentor-assignment management UI (currently SQL-seeded only)~~ — **DONE 2026-06-19**

Shipped same session it was filed: `mentorSlice.js` (`fetchMentorAssignments`/`setMentorAssignment`/`removeMentorAssignment`, 9 tests) + `MenteeAssignments` section in `MentorshipTab` — reassign/remove a mentee's mentor and a highlighted "active students with no mentor" list. Docs in CLAUDE.md / DATABASE_SCHEMA §10 / FLOWS.

<details><summary>original</summary>

`mentor_assignments` was seeded once by SQL from the user's mapping images. There's no UI to add/remove a mentee, reassign one to a different mentor, or onboard a new mentor — any change needs a manual SQL edit.

**Why:** rosters drift (new admissions, mentor changes). Without a UI, every change is a developer task and the map silently goes stale — mentees who join after the seed never get nudged, and reassignments require hand-written SQL. Low urgency now (just seeded), rising as the cohort changes.

**How to apply:** a Mentors panel (likely a Settings sub-view or an extension of the Mentorship tab) — list mentors with their mentee counts, let admin reassign a student's mentor (writes `mentor_assignments`, `lws_id` PK = upsert), and surface **unassigned active students** (a `students` left-join `mentor_assignments` where null) so nobody silently falls out of rotation. Reuse the student-search pattern from the existing assignment modals.

</details>

### ~~Verify the Mentee-assignments UI golden path~~ — **DONE 2026-06-29** (browser pass; the optional component test remains open)

The `MenteeAssignments` panel (commit `f778897`) shipped with **slice-only** coverage (`mentorSlice` 9 tests). The component itself — fetch-on-mount, reassign-moves-the-row, remove, the "active students with no mentor" list, the search filter — is untested and the browser golden path wasn't run (global Definition of Done requires it).

**Why:** the wiring (slice ↔ store ↔ Supabase ↔ re-fetch after mutation) is exactly where a regression would hide, and it's admin-only data-mutating UI. A 2-minute manual pass + a small render test would lock it.

**How to apply:**
- Manual: Settings → Mentorship → reassign a mentee (row moves to the new mentor group), remove one (drops + reappears in "no mentor" if Active), confirm counts + search filter.
- Test: a `MentorshipTab`/`MenteeAssignments` render test mocking the store (`timetableTeachers`, `studentProfiles`, and the three `mentor*` actions) — assert unassigned-active detection and that `setMentorAssignment`/`removeMentorAssignment` fire with the right args. Mirror the store-mock pattern in `MonitoringTab.test.jsx`.

## 2026-06-18

### ~~Manually verify the remediation links resolve on PYQ Vault (cross-app golden path)~~ — **DONE 2026-06-29** (cleared in the batch browser-verification pass)

The wrong-answer "Learn this / Practice" feature (commits `d278e65` + `5a303f1`, 2026-06-17) shipped with full unit/lint coverage (~30 tests) but the **cross-app golden path was not confirmed in this log** — the links deep-link out to the sister **PYQ Vault** app's `/go/learn` + `/go/practice` redirects, and `remediation.js` builds them name-based / notes-slug-based. The unit tests assert the *URL we construct*, not that PYQ Vault actually resolves those slugs/names to a real page.

**Why:** the seam crosses two apps. A URL that's well-formed on the nda-tracker side can still 404 on PYQ Vault if a subtopic/concept name (or `subtopicSlug`/`conceptSlug`) doesn't match a Vault route — and that failure is invisible to nda-tracker's tests. A student clicking "Learn this" and landing on a Vault 404 is worse than no link. Cheap to confirm; the feature is now live on every exam/quiz review surface.

**How to apply:**
- On `nda-tracker.vercel.app`, open a wrong-answer surface (a quiz `QuizReview`, or an exam `WrongAnswerAudit` / `FocusedExamResult`) and click both **Learn this** and **Practice** on a Maths question (Practice is Maths-gated via `PRACTICE_SUBJECTS`).
- Confirm each lands on a real PYQ Vault page for the right subtopic/concept — test one question whose tags carry `SubtopicSlug`/`ConceptSlug` (slug path) AND one that falls back to name-based, since `remediation.js` prefers the slug when present.
- Spot-check a non-Maths (GAT) question shows **Learn this** but not **Practice** (the Maths gate), and that a question with no resolvable concept degrades gracefully (no broken button).

## 2026-06-16

### ~~Manually verify the WhatsApp result-monitoring golden path in the browser~~ — **DONE 2026-06-29** (cleared in the batch browser-verification pass)

The monitoring-copy feature (commit `81761ce`) shipped with full unit/lint coverage (1512 Vitest passing) but the **end-to-end browser check was not done** (the global Definition of Done requires it). The Settings → Monitoring tab + the `monitorMobiles[]` body param + the `api/send-whatsapp.js` random-pick path are all deployed and go live on the next Vercel build; the seam (Settings edit → persist round-trip → real send → MONITOR message actually arrives on `9021869427`) is only unit-covered.

**Why:** monitoring is *itself* the verification mechanism for the result blast — if it silently doesn't fire (e.g. a Wabridge quirk on the extra send, or `monitorMobiles` not reaching the endpoint in prod), the faculty loses the observability they asked for without knowing. A 2-minute live pass confirms it.

**How to apply:**
- On `nda-tracker.vercel.app`: Settings → Monitoring → confirm `9021869427` is listed (add a test number you control if preferred).
- Send a real result blast for a small/old exam (or use a redirect-to test FIRST to confirm the monitor copy is correctly **suppressed** on test sends), then a real send and confirm exactly one `👁 MONITOR → … (sample: <name>)` line appears in the results modal and the message lands on the monitor phone.
- Confirm removing all numbers (empty list) cleanly disables it (no monitor line, `monitor: 0`).

## 2026-06-10

### ~~Add `teacher_calendar_blocks` to DATABASE_SCHEMA.md~~ — **DONE 2026-06-10**

Added as `DATABASE_SCHEMA.md` §9 "Calendar sync" (full column table) + FK-graph "no FKs" note + RLS row (service-role-only). Verified present.

### ~~Calendar sync: bound the recurrence (no more "recurs forever")~~ — **DONE 2026-06-10**

Replaced infinite weekly recurrence with a **bounded 2-week window** (`computeWindow` → `UNTIL=<next week's Saturday>`, first occurrence anchored to the next weekday on/after the sync day = remaining current week + next week) + folded the window into the block signature so weekly re-syncs roll it forward, + rate-limit backoff for the ~165-event weekly patch. Shipped this session; all 165 live events migrated to bounded. See `reference_google_calendar_sync.md`.

### ~~Build the re-grade-from-stored-choices action (now that choices are captured)~~ — **SUPERSEDED 2026-09-12** → folded into [Build the re-grade action if key corrections recur](#build-the-re-grade-action-if-key-corrections-recur) (2026-09-11)

Folded, not dropped. This entry said *build it*; the 2026-09-11 entry says **do not build it yet** and names the trigger that would change that. Both instructions lived in the file at once, three months apart, with this one read first by anyone scanning by date. The design detail below (full-recompute-plus-preview, the never-blind-zero rule, the enabled-only-when-`choices`-exist gate) has been carried into the surviving entry.

<details><summary>original</summary>

`exam_results.choices` is now populated on every Evalbee upload (2026-06-10), so a corrected answer key can be re-graded deterministically — but the action that does it isn't built. User-chosen model when this is built: **full recompute + preview**.

**Why:** the whole point of capturing choices is to make key corrections fix the marks/ranks, not just the displayed answer. Until the re-grade action exists, a corrected `questions[].answer` still leaves `total_marks`/`responses` frozen at Evalbee's original grading.

**How to apply:**
- Pure `regradeFromChoices(exam)`: per student, per question → if the question has a valid key AND a captured choice, verdict = `choice === key ? +1 : (choice ? −1 : 0)`; else keep Evalbee's original `responses[q]` (never blind-zero a question we can't re-grade — protects bonus/dropped/multi-key items). Recompute `correct/incorrect/notAttempted` + `total_marks` from `exam.marking`.
- Admin action on the Exams row / Update-Tags flow, **enabled only when `choices` exist** for that exam. Run a **preview/diff first** (N students change, Δ marks, rank shifts), snapshot prior values, write back to `exam_results` (+ store) only on confirm.
- ⚠️ It shifts grading authority Evalbee→app-key — keep it explicit/opt-in/preview-gated, never automatic. Backfill old exams first by re-uploading their Evalbee XLS so `choices` exist.

</details>

## 2026-06-09

### ~~Manually verify the offline-exam golden path in the browser~~ — **DONE 2026-06-29** (cleared in the batch browser-verification pass)

The offline-exam feature (totals-only, template upload — commit `b4f49fd`) shipped with full test + lint coverage (1429 Vitest passing) but the **golden-path browser check was not done** (the global Definition of Done requires it). The DB column + code are deployed, so it goes live on the next Vercel build.

**Why:** the integration seam (template parse → modal → `addExam` with `maxMarks` → Supabase round-trip → exam appears in trends/Toppers/history with correct %) is only unit-covered. A 5-minute manual pass on `nda-tracker.vercel.app` confirms the end-to-end flow before faculty relies on it for real marks.

**How to apply:**
- On the Exams page, click **"+ Offline marks"** → Download template → fill 2-3 names + marks → upload → set max marks + batch → Save.
- Confirm: the exam shows an "Offline" badge with the right %-of-max on the card; it appears in the Dashboard performance trend and the student's Exam History; per-question surfaces show the "Offline" notice (not zeros); Insights/PDF buttons are absent.
- Optionally tick the absentee opt-in once and confirm it flags/notifies as expected (leave off otherwise).

## 2026-06-07

### ~~Decide `getClassProjectedAvg`'s fate (now unused-but-tested)~~ — **CLOSED 2026-09-12 (premise false — it has a live consumer)**

Closed on inspection: `getClassProjectedAvg` is **not** dead. [`dashboard.js:125`](src/lib/analytics/dashboard.js#L125) calls it inside `getBatchComparison`, which renders through `BatchComparison` at [`Dashboard/index.jsx:96`](src/pages/Dashboard/index.jsx#L96) — so it feeds the per-batch *projected* column, not just the deleted KPI strip. The 2026-09-12 "orphaned dashboard analytics" entry below already says as much (it names only `getPriorityChapters` and `rootCauseMap` as consumer-less, correctly excluding this one). Option 2 ("remove it") would have broken the batch table. No action; the 16-test block earns its place.

<details><summary>original</summary>

The KPI strip was removed on 2026-06-07 (`KpiStrip.jsx` deleted, commit `4cae24f`). `getClassProjectedAvg` in `src/lib/analytics/dashboard.js` was the projection feeding that strip; it's still exported and still has its 16-test block, but **nothing on the dashboard calls it anymore**.

**Why:** dead-but-tested code drifts silently — the tests keep passing so it never surfaces as a problem, but it's maintenance weight with no live consumer. Either it earns its place by being surfaced again, or it should go.

**How to apply:**
- Pick one of:
  1. **Surface it** — add a small "Avg Projected NDA" stat somewhere it's genuinely useful (e.g. the `BatchComparison` card already shows per-batch projected; a class-wide figure could sit there or on Toppers). Keep the function + tests.
  2. **Remove it** — delete `getClassProjectedAvg` from `dashboard.js`, drop its `getClassProjectedAvg` describe block from `dashboard.test.js`, and confirm nothing else imports it (`grep getClassProjectedAvg src/`). Net test count drops by that block.
- It reuses `getToppers(…, 0, …)` for regDate scoping, so removal is self-contained — no shared helper to worry about.

</details>

### ~~Persist each student's chosen option on results upload~~ — **capture DONE 2026-06-10** (re-grade UI deferred → see 2026-06-10 entry)

**Shipped (capture):** `parseExcelFull` now also builds `choices[qn] = 'A'|null`; persisted via `buildResultRows` → new additive `exam_results.choices` JSONB column; loaded by `loadExamsFromSupabase`. `responses` (1/-1/0 verdict) unchanged. NULL for pre-2026-06-10 rows (re-upload the Evalbee XLS to backfill). +5 tests. The **re-grade action that consumes `choices`** was deferred — tracked as its own entry below.

Original context (kept for the why): `parseExcelFull` used to collapse each answer to a `1/-1/0` verdict and discard the chosen option (`Q N Options`); a later key fix couldn't re-grade from the DB. See `memory/reference_exam_grading_data_model.md`.

**Why:** answer-key errors are not rare (this session's audit found ~32 defects across 270 questions — ~12%, incl. ~12 outright wrong keys). Each correction currently fixes only the *displayed* answer + solution, never the scores/rankings. Storing the raw choice once makes every future key fix a one-query re-grade.

**How to apply:**
- In `parseExcelFull` ([src/lib/excel.js](src/lib/excel.js) ~L104), persist the chosen letter alongside (or instead of) the verdict — e.g. `responses[qn] = { opt: <A-D|null>, v: 1|-1|0 }`, or a parallel `choices` map.
- Add a pure `gradeResults(exam, choices)` that derives `correct/incorrect/not_attempted/total_marks/responses` from choices × `questions[].answer` × `marking`. Use it at upload AND expose a "re-grade from stored choices" admin action.
- Migration is forward-only (old rows have no stored choice); document that pre-change exams remain Evalbee-graded and un-re-gradeable.
- Note the trade-off: this moves grading authority from Evalbee to the app key — only worth it if `questions[].answer` is trusted (it now has an audit path).

## 2026-05-25

### ~~Decide Jaccard threshold for `findExamNameCandidates`~~ — **DONE 2026-05-25**

Picked Shape A (token-level signals, threshold unchanged). Shipped in two commits: `17d9079` (`name_token_edit` + `name_token_prefix`) and `03f3698` (`name_initial_match` for the middle-initial collapse). Decision rationale captured in `memory/project_dedup_threshold_decision.md`.

### ~~Pick AI-insights cadence trigger (carry-forward, still pending)~~ — **SUPERSEDED 2026-09-12** → folded into [Orphaned insights plumbing](#2026-09-12--orphaned-insights-plumbing-after-the-insights-tab-removal)

The duplicate of the 2026-05-21 entry, filed 4 days later. Same reason for folding: the renderers are gone, so the cadence question is downstream of "is this feature coming back?". The one thing worth keeping is its framing note — ask the single trigger question, do not open with stratification or schema.

<details><summary>original</summary>

Same shape as the 2026-05-21 entry above — manual / post-test / calendar. Carried into 2026-05-25 because the teacher auth account loop just shipped, which closes the last piece of admin scaffolding the post-test auto-flow would need (admin-gated endpoint pattern + service-role client setup are now both proven in `api/teacher-account.js`).

**Why now:** the supporting infrastructure (insights tables in production since 2026-05-20, Saurabh's plan written by hand, admin-gated endpoint pattern proven, Claude API SDK available) is all in place. The blocker is purely the trigger decision — once locked, the build is small (post-test = one server hook + Claude API call; manual = nothing to build).

**How to apply:**
- One question, three options — do not lead with stratification, schema, or two-row-types. Memory `project_ai_insights_cadence.md` documents why the earlier conversation overwhelmed (and the "manual / post-test / calendar" framing that worked).
- Lock the choice in `project_ai_insights_cadence.md` with a DECIDED date before opening any secondary design.
- If Manual: close the question — nothing to build.

</details>

## 2026-05-21

### ~~Soft-archive pre-Vercel-migration decisions out of CLAUDE.md~~ — **DONE 2026-06-09** (already satisfied; verified)

Closed after a full re-read of both surfaces — the work this suggestion asked for had already happened in two steps that postdate it:
- **Decisions log:** extracted wholesale into `DECISIONS.md` (CLAUDE.md "## Decisions log" is now a one-line pointer, ~line 513). It's read on-demand, not auto-loaded, so it no longer adds to per-session context — the original "both load on every read" premise is moot.
- **"What not to change":** the genuinely pre-Vercel bullets were already moved on 2026-05-21 into `memory/project_completed_archive.md` → "Archived decisions (pre-Vercel)" table (db.json, `teacher_password.txt`, the old subject-keyed `lecture_absences` UNIQUE, batch-name spacing).

2026-06-09 verification: read all ~170 current "What not to change" bullets + all 115 DECISIONS.md rows. Every remaining guardrail is post-Vercel and load-bearing — the few that name deleted files (`ManageTeachersModal.jsx`, `KpiStrip.jsx`, `html-to-image`) are live "do not re-introduce" rules, not dead weight. No further safe *content* trim exists under the "pre-Vercel / file-or-feature replaced" criterion; removing any guardrail would strip a real regression guard. **Instead, the whole "What not to change" section (171 bullets) was extracted to a new [`GUARDRAILS.md`](./GUARDRAILS.md) on 2026-06-09** (same lossless pattern as the DECISIONS.md split — content preserved, CLAUDE.md left a one-line pointer). CLAUDE.md dropped 693 → 521 lines; all cross-doc pointers (README/ARCHITECTURE/OPERATIONS/SECURITY/FLOWS/DECISIONS) repointed to GUARDRAILS.md. New guardrails now go in GUARDRAILS.md, not CLAUDE.md. If size becomes a problem again, the next lever is *consolidating verbose bullets within GUARDRAILS.md* — a separate (riskier) editing task.

### ~~Decide AI insights cadence (manual / post-test / calendar)~~ — **SUPERSEDED 2026-09-12** → folded into [Orphaned insights plumbing](#2026-09-12--orphaned-insights-plumbing-after-the-insights-tab-removal)

Superseded by a change of facts, not a decision: the Insights page and the `ImprovementPlan` card were removed on 2026-09-12, so `savedInsights` now has **zero renderers**. Picking a refresh cadence for a feature with no UI is the wrong question in the wrong order — the live question is whether AI-written plans are coming back at all. Asked twice (2026-05-21 and 2026-05-25, 4 days apart) and never answered; the three options survive in the folded entry.

<details><summary>original</summary>

The trigger question for AI-generated student plans has been pending since 2026-05-20. Underlying tables (`class_reports`, `student_plans`) are already in production with one row written by hand. See `memory/project_ai_insights_cadence.md`.

**Why:** without a chosen cadence, the supporting code drifts without a target use-case. A 5-minute decision unblocks a small but real feature. Deferring indefinitely risks the insights tables becoming dead schema.

**How to apply:**
- Pick one of:
  1. **Manual** — admin clicks "generate plan" per student. Zero automation needed; existing flow works today.
  2. **Post-test** — a meaningful subject test finishing triggers an auto-plan refresh for that student. Needs a server hook + Claude API call.
  3. **Calendar** — weekly/fortnightly cron-driven refresh. Needs at-risk filtering to keep volume sane.
- Lock the choice in `memory/project_ai_insights_cadence.md` (mark it DECIDED with the date) before talking about stratification or two-row-types.
- If the answer is "Manual," nothing further to build — close the file.

</details>

