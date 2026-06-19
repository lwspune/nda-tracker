# Suggestions

A running list of actionable improvements surfaced during `/update-docs` runs and other sessions. Each item is **outside the scope of the work that surfaced it** — i.e. the suggesting session deliberately didn't implement it. Strike through when done; delete after archiving the context elsewhere.

---

## 2026-05-21

### ~~Soft-archive pre-Vercel-migration decisions out of CLAUDE.md~~ — **DONE 2026-06-09** (already satisfied; verified)

Closed after a full re-read of both surfaces — the work this suggestion asked for had already happened in two steps that postdate it:
- **Decisions log:** extracted wholesale into `DECISIONS.md` (CLAUDE.md "## Decisions log" is now a one-line pointer, ~line 513). It's read on-demand, not auto-loaded, so it no longer adds to per-session context — the original "both load on every read" premise is moot.
- **"What not to change":** the genuinely pre-Vercel bullets were already moved on 2026-05-21 into `memory/project_completed_archive.md` → "Archived decisions (pre-Vercel)" table (db.json, `teacher_password.txt`, the old subject-keyed `lecture_absences` UNIQUE, batch-name spacing).

2026-06-09 verification: read all ~170 current "What not to change" bullets + all 115 DECISIONS.md rows. Every remaining guardrail is post-Vercel and load-bearing — the few that name deleted files (`ManageTeachersModal.jsx`, `KpiStrip.jsx`, `html-to-image`) are live "do not re-introduce" rules, not dead weight. No further safe *content* trim exists under the "pre-Vercel / file-or-feature replaced" criterion; removing any guardrail would strip a real regression guard. **Instead, the whole "What not to change" section (171 bullets) was extracted to a new [`GUARDRAILS.md`](./GUARDRAILS.md) on 2026-06-09** (same lossless pattern as the DECISIONS.md split — content preserved, CLAUDE.md left a one-line pointer). CLAUDE.md dropped 693 → 521 lines; all cross-doc pointers (README/ARCHITECTURE/OPERATIONS/SECURITY/FLOWS/DECISIONS) repointed to GUARDRAILS.md. New guardrails now go in GUARDRAILS.md, not CLAUDE.md. If size becomes a problem again, the next lever is *consolidating verbose bullets within GUARDRAILS.md* — a separate (riskier) editing task.

---

### Decide AI insights cadence (manual / post-test / calendar)

The trigger question for AI-generated student plans has been pending since 2026-05-20. Underlying tables (`class_reports`, `student_plans`) are already in production with one row written by hand. See `memory/project_ai_insights_cadence.md`.

**Why:** without a chosen cadence, the supporting code drifts without a target use-case. A 5-minute decision unblocks a small but real feature. Deferring indefinitely risks the insights tables becoming dead schema.

**How to apply:**
- Pick one of:
  1. **Manual** — admin clicks "generate plan" per student. Zero automation needed; existing flow works today.
  2. **Post-test** — a meaningful subject test finishing triggers an auto-plan refresh for that student. Needs a server hook + Claude API call.
  3. **Calendar** — weekly/fortnightly cron-driven refresh. Needs at-risk filtering to keep volume sane.
- Lock the choice in `memory/project_ai_insights_cadence.md` (mark it DECIDED with the date) before talking about stratification or two-row-types.
- If the answer is "Manual," nothing further to build — close the file.

---

## 2026-05-25

### Decide how monthly report PDFs reach parents

The Monthly Reports page (shipped 2026-05-24) downloads PDFs to the admin's machine and packages them as a ZIP for bulk download. Faculty still has to forward them manually — no delivery channel is wired up.

**Why:** without a delivery path the feature stops at "PDF on admin's laptop". Picking the path before the next month-end means the workflow is ready when it matters; deferring means a one-month gap of manual forwarding (or skipping the send entirely).

**How to apply:**
- Pick one of:
  1. **WhatsApp document send via Wabridge** — most parent-friendly (matches the channel parents already get exam-results / late / absence messages on). Needs a new Meta-approved template like "Monthly report for {{1}}" plus a `api/send-monthly-report.js` endpoint that uploads the PDF as a document attachment. ~3-day Meta approval lead time. Same template-param rules apply (ASCII, positional `{{N}}`, see `memory/feedback_whatsapp_template_param_rules.md`).
  2. **Email PDF attachment** via a new `send_monthly_reports.py` mirroring `send_results_whatsapp.py`'s pattern (Gmail SMTP per `send_schedule.py`). Works without Wabridge but parents in this market check email less reliably.
  3. **WhatsApp link to a live web report** — cheapest to build (no PDF lib in the path, no Meta document workflow). Reuses `StudentPortal` infrastructure. Snapshot-in-time concern: the report changes if data is later corrected, which can either be a feature (corrections propagate) or a confusion (parent sees different numbers than admin "sent"). Mitigate by serving a snapshot rather than live data.
  4. **Print + hand-deliver** — for parents without smartphones / WhatsApp; the bulk ZIP already covers this.
- Lock the choice in a new `memory/project_monthly_report_delivery.md` once decided.

---

### ~~Decide Jaccard threshold for `findExamNameCandidates`~~ — **DONE 2026-05-25**

Picked Shape A (token-level signals, threshold unchanged). Shipped in two commits: `17d9079` (`name_token_edit` + `name_token_prefix`) and `03f3698` (`name_initial_match` for the middle-initial collapse). Decision rationale captured in `memory/project_dedup_threshold_decision.md`.

---

### Pick AI-insights cadence trigger (carry-forward, still pending)

Same shape as the 2026-05-21 entry above — manual / post-test / calendar. Carried into 2026-05-25 because the teacher auth account loop just shipped, which closes the last piece of admin scaffolding the post-test auto-flow would need (admin-gated endpoint pattern + service-role client setup are now both proven in `api/teacher-account.js`).

**Why now:** the supporting infrastructure (insights tables in production since 2026-05-20, Saurabh's plan written by hand, admin-gated endpoint pattern proven, Claude API SDK available) is all in place. The blocker is purely the trigger decision — once locked, the build is small (post-test = one server hook + Claude API call; manual = nothing to build).

**How to apply:**
- One question, three options — do not lead with stratification, schema, or two-row-types. Memory `project_ai_insights_cadence.md` documents why the earlier conversation overwhelmed (and the "manual / post-test / calendar" framing that worked).
- Lock the choice in `project_ai_insights_cadence.md` with a DECIDED date before opening any secondary design.
- If Manual: close the question — nothing to build.

---

### Reshape or drop demo mode given Monthly Reports exists

`memory/project_demo_mode.md` (April 2026) proposed a `?demo=true` URL serving a sanitised single-student `StudentView` to prospective parents. NOT YET IMPLEMENTED. Monthly Reports (shipped 2026-05-24) is now the primary parent-facing surface — covers most of the "show parents what they get" intent the demo plan was designed for, but is a PDF rather than a portal.

**Why now:** the original demo plan's premises are partly stale. Choices needed:
- Is the prospective-parent showcase still wanted at all?
- If yes, is a sanitised live portal the right shape, or would a sample Monthly Report PDF be a better fit (matches what real parents receive, fewer moving parts, no portal session wiring)?
- The two could coexist (portal demo for analytical depth, report demo for the take-home artifact), but only if there's a real audience for both.

**How to apply:**
- Pick one of:
  1. **Build as designed** — sanitised `?demo=true` StudentView per `project_demo_mode.md`. ~1 dev session. Original use case unchanged.
  2. **Switch to a sample Monthly Report PDF** — a single hosted PDF (or a "Generate sample" button on a public page) using anonymised cohort data. Same showcase intent, no portal session / no fetch wiring. Smaller surface to maintain.
  3. **Drop demo mode entirely** — delete `project_demo_mode.md`. Use the real product (sample login or screenshots) when showcasing. Removes a permanent surface.
- Whichever path: update or delete `memory/project_demo_mode.md` to match the decision.

---

## 2026-06-05

### Branch filter on the Teacher Feedback page

The Feedback page (`src/pages/TeacherFeedback/index.jsx`) now has cycle + teacher filters, but no **branch** filter. `teacher_feedback.branch` holds `LWS Pune` / `APJ`, and `teacher_name` is shared across branches where a teacher works both (today: **Akash Rathod Sir** appears in LWS cycles *and* `03 APJ`). So the default "All cycles" card blends his LWS + APJ feedback into one overall score, and his trend line interleaves both branches' cycles.

**Why:** as more teachers span both branches (or APJ accumulates its own cycle history), the blended view gets misleading — you can't read "how is this teacher doing *at APJ*" without manually picking teacher + a specific APJ cycle. A branch filter keeps "All cycles" meaningful per branch. Low urgency today (only one shared-name teacher), rising as APJ data grows.

**How to apply:**
- Add a `branch` filter (pills or dropdown, sourced from `[...new Set(rows.map(r => r.branch))]`) alongside the existing cycle + teacher filters in `TeacherFeedbackPage`.
- Thread it into the `filtered` memo (`(branch === 'all' || r.branch === branchSel)`), same pattern as the cycle/teacher predicates.
- Decide trend scope: either keep the trend over ALL rows (current) or scope it to the selected branch — scoping is more honest once branches diverge. The cycle labels (`03 APJ` vs `03 LWS Pune`) already disambiguate, so a branch-scoped trend mainly removes cross-branch interleave.
- No schema change — `branch` is already on every row.

---

## 2026-06-07

### Decide `getClassProjectedAvg`'s fate (now unused-but-tested)

The KPI strip was removed on 2026-06-07 (`KpiStrip.jsx` deleted, commit `4cae24f`). `getClassProjectedAvg` in `src/lib/analytics/dashboard.js` was the projection feeding that strip; it's still exported and still has its 16-test block, but **nothing on the dashboard calls it anymore**.

**Why:** dead-but-tested code drifts silently — the tests keep passing so it never surfaces as a problem, but it's maintenance weight with no live consumer. Either it earns its place by being surfaced again, or it should go.

**How to apply:**
- Pick one of:
  1. **Surface it** — add a small "Avg Projected NDA" stat somewhere it's genuinely useful (e.g. the `BatchComparison` card already shows per-batch projected; a class-wide figure could sit there or on Toppers). Keep the function + tests.
  2. **Remove it** — delete `getClassProjectedAvg` from `dashboard.js`, drop its `getClassProjectedAvg` describe block from `dashboard.test.js`, and confirm nothing else imports it (`grep getClassProjectedAvg src/`). Net test count drops by that block.
- It reuses `getToppers(…, 0, …)` for regDate scoping, so removal is self-contained — no shared helper to worry about.

---

### ~~Persist each student's chosen option on results upload~~ — **capture DONE 2026-06-10** (re-grade UI deferred → see 2026-06-10 entry)

**Shipped (capture):** `parseExcelFull` now also builds `choices[qn] = 'A'|null`; persisted via `buildResultRows` → new additive `exam_results.choices` JSONB column; loaded by `loadExamsFromSupabase`. `responses` (1/-1/0 verdict) unchanged. NULL for pre-2026-06-10 rows (re-upload the Evalbee XLS to backfill). +5 tests. The **re-grade action that consumes `choices`** was deferred — tracked as its own entry below.

Original context (kept for the why): `parseExcelFull` used to collapse each answer to a `1/-1/0` verdict and discard the chosen option (`Q N Options`); a later key fix couldn't re-grade from the DB. See `memory/reference_exam_grading_data_model.md`.

**Why:** answer-key errors are not rare (this session's audit found ~32 defects across 270 questions — ~12%, incl. ~12 outright wrong keys). Each correction currently fixes only the *displayed* answer + solution, never the scores/rankings. Storing the raw choice once makes every future key fix a one-query re-grade.

**How to apply:**
- In `parseExcelFull` ([src/lib/excel.js](src/lib/excel.js) ~L104), persist the chosen letter alongside (or instead of) the verdict — e.g. `responses[qn] = { opt: <A-D|null>, v: 1|-1|0 }`, or a parallel `choices` map.
- Add a pure `gradeResults(exam, choices)` that derives `correct/incorrect/not_attempted/total_marks/responses` from choices × `questions[].answer` × `marking`. Use it at upload AND expose a "re-grade from stored choices" admin action.
- Migration is forward-only (old rows have no stored choice); document that pre-change exams remain Evalbee-graded and un-re-gradeable.
- Note the trade-off: this moves grading authority from Evalbee to the app key — only worth it if `questions[].answer` is trusted (it now has an audit path).

---

### Sweep older exams for key/solution defects

The correctness audit only covered the latest GAT + Maths mocks. The same failure mode (hand-entered keys + AI-generated solutions, never cross-verified) likely affects other recent exams. The method that worked: independent re-derivation via fanned-out subagents, NOT a key-vs-solution consistency check (which is blind to shared errors). See `memory/feedback_rederive_over_consistency_check.md`.

**Why:** a ~12% defect rate on the two newest mocks implies a meaningful tail of wrong keys students are revising against — the opposite of the product's "grounded, verified" positioning. Bad solutions are worse than none for active recall.

**How to apply:**
- Prioritise high-traffic exams (recent mocks, large cohorts). Pull `questions` per exam, fan out ~30-question chunks to subagents that *solve* each independently and return MIS-KEYED / DEFECTIVE / SOLUTION-WRONG / DUPLICATE / AMBIGUOUS rows.
- Apply only high-confidence MIS-KEYED fixes via the JSONB recipe in `reference_exam_grading_data_model.md`; route DEFECTIVE / AMBIGUOUS / SOLUTION-WRONG to faculty.
- Snapshot pre-change keys (revert map) and verify `jsonb_array_length` after each write.

---

### Resolve the non-key defects in the two audited mocks (faculty judgment)

Beyond the 12 keys already corrected, the audit left open: **7 defective questions** (correct answer not among options — GAT 5/116, Maths 12/45/48/52/75), **4 misleading solutions** with a correct key (GAT 20, Maths 5/16/71), **5 duplicate pairs** (GAT 65≈72, 66=69, 67=71, 143=144; Maths Q30 has two identical options), and **4 ambiguous** (GAT 7/8, Maths 38/84). These need option-set edits or faculty calls, not a key flip.

**Why:** defective questions are un-answerable as written (students lose marks on impossible items); duplicate GAT 143/144 was keyed two different ways; misleading solutions teach the wrong method even when the key is right.

**How to apply:**
- For DEFECTIVE: fix the option set (or drop the question) in the tags source + re-upload, or edit `questions[]` JSONB directly.
- For SOLUTION-WRONG: rewrite the `solution` text to match the (correct) key.
- For DUPLICATEs: delete one of each pair; for Maths Q30, fix the duplicated option.
- All of these are content decisions — surface the list to faculty rather than auto-applying.

---

## 2026-06-09

### Manually verify the offline-exam golden path in the browser

The offline-exam feature (totals-only, template upload — commit `b4f49fd`) shipped with full test + lint coverage (1429 Vitest passing) but the **golden-path browser check was not done** (the global Definition of Done requires it). The DB column + code are deployed, so it goes live on the next Vercel build.

**Why:** the integration seam (template parse → modal → `addExam` with `maxMarks` → Supabase round-trip → exam appears in trends/Toppers/history with correct %) is only unit-covered. A 5-minute manual pass on `nda-tracker.vercel.app` confirms the end-to-end flow before faculty relies on it for real marks.

**How to apply:**
- On the Exams page, click **"+ Offline marks"** → Download template → fill 2-3 names + marks → upload → set max marks + batch → Save.
- Confirm: the exam shows an "Offline" badge with the right %-of-max on the card; it appears in the Dashboard performance trend and the student's Exam History; per-question surfaces show the "Offline" notice (not zeros); Insights/PDF buttons are absent.
- Optionally tick the absentee opt-in once and confirm it flags/notifies as expected (leave off otherwise).

---

## 2026-06-10

### Finish the teacher-calendar-sync production rollout

The Google Calendar sync feature shipped (commit `48f37c3`) and was verified locally — Google write path proven live + a single-teacher in-app trial confirmed by the user. Two production steps remain unfinished. See `memory/reference_google_calendar_sync.md`.

**Update 2026-06-10:** the **full all-teacher sync is now DONE** — all **165 teaching-blocks** across all teachers are on the "LWS Faculty Timetable" calendar (the user had already synced 163 via the app; a headless `run_full_sync` reconcile closed the last 2 for Vishal Sir; ledger == calendar, 0 pending). `SUPABASE_SERVICE_ROLE_KEY` is now in local `.env.local`. **Still open:** the 4 Google env vars + `SUPABASE_SERVICE_ROLE_KEY` in **Vercel** (deployed Sync button still 500s without them), and the notification-mode decision (currently silent + teacher-default reminders).

**Why:** every push to `main` already deployed the code, so the **deployed** "📅 Sync calendars" button will 500 until the env vars exist — a half-live feature. And the full benefit (all teachers' calendars blocked) only lands after the full-teacher run.

**How to apply:**
- Add to Vercel → Settings → Environment Variables: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`, `FACULTY_CALENDAR_ID` (values are in local `.env.local`; `SUPABASE_SERVICE_ROLE_KEY` is already set).
- In the app (local dev works now), open Sync calendars → Scope = **All teachers** → dry-run → Apply (~300–360 events, silent, ~bounded concurrency 6; idempotent if it times out — re-run or chunk by teacher).
- Decide the notification mode (currently default: no invite emails via `sendUpdates:'none'`, but teachers' default per-occurrence reminders fire). To go fully silent add `reminders:{useDefault:false,overrides:[]}` to `toGCalEvent`; to actively notify on change switch `sendUpdates` to `'all'`.

### ~~Add `teacher_calendar_blocks` to DATABASE_SCHEMA.md~~ — **DONE 2026-06-10**

Added as `DATABASE_SCHEMA.md` §9 "Calendar sync" (full column table) + FK-graph "no FKs" note + RLS row (service-role-only). Verified present.

### ~~Calendar sync: bound the recurrence (no more "recurs forever")~~ — **DONE 2026-06-10**

Replaced infinite weekly recurrence with a **bounded 2-week window** (`computeWindow` → `UNTIL=<next week's Saturday>`, first occurrence anchored to the next weekday on/after the sync day = remaining current week + next week) + folded the window into the block signature so weekly re-syncs roll it forward, + rate-limit backoff for the ~165-event weekly patch. Shipped this session; all 165 live events migrated to bounded. See `reference_google_calendar_sync.md`.

### Build the re-grade-from-stored-choices action (now that choices are captured)

`exam_results.choices` is now populated on every Evalbee upload (2026-06-10), so a corrected answer key can be re-graded deterministically — but the action that does it isn't built. User-chosen model when this is built: **full recompute + preview**.

**Why:** the whole point of capturing choices is to make key corrections fix the marks/ranks, not just the displayed answer. Until the re-grade action exists, a corrected `questions[].answer` still leaves `total_marks`/`responses` frozen at Evalbee's original grading.

**How to apply:**
- Pure `regradeFromChoices(exam)`: per student, per question → if the question has a valid key AND a captured choice, verdict = `choice === key ? +1 : (choice ? −1 : 0)`; else keep Evalbee's original `responses[q]` (never blind-zero a question we can't re-grade — protects bonus/dropped/multi-key items). Recompute `correct/incorrect/notAttempted` + `total_marks` from `exam.marking`.
- Admin action on the Exams row / Update-Tags flow, **enabled only when `choices` exist** for that exam. Run a **preview/diff first** (N students change, Δ marks, rank shifts), snapshot prior values, write back to `exam_results` (+ store) only on confirm.
- ⚠️ It shifts grading authority Evalbee→app-key — keep it explicit/opt-in/preview-gated, never automatic. Backfill old exams first by re-uploading their Evalbee XLS so `choices` exist.

### Calendar sync: automate the weekly window roll + holiday EXDATEs

Two follow-ups remain after the bounded-window change.

**Why:** the window now **must be re-synced periodically** to roll forward (it's no longer fire-and-forget). Today that's a manual click each Sunday — easy to forget, leaving stale/empty calendars. Separately, blocks still recur through holidays/exam days within the window (phantom classes on off days).

### "Reconcile names against roster" as an admin action

Done manually this session (canonical names matched against "Student Search List 10 JUN 2026.xls" by reg-no; 3 spelling fixes applied). It's worth productising because **`canonical_name` is sticky** — re-imports match by EIS and never overwrite the name, so HR spelling corrections silently never propagate. See `memory/reference_roster_reconciliation.md`.

**Why:** every future HR spelling correction stays invisible until someone manually reconciles. A button (dry-run preview → apply, with anomaly flagging) makes it routine instead of a one-off script.

**How to apply:**
- Admin action: upload the roster XLS → match DB students by **reg-no = `eis_reg_no`** → list `canonical ≠ roster_name` mismatches, **categorised**: clean spelling variant (auto-applicable) · middle-name add/drop (confirm) · different-name anomaly (flag, never auto-rename — e.g. LWS-493 `Pranali`/`Droupadi`).
- On apply: set canonical to the roster spelling, **keep the old canonical in `name_variants`** (so `exam_results` keyed on the old spelling still resolve).
- Note the export is often a **filtered** search list (159 of 281 on 2026-06-10) — only reconciles who's in the file.
- **Open data decisions from this session** (do via this tool or manually): LWS-105 `Sanmod Santosh Jambagi`→`Sanmod Jambagi` and LWS-093 `Bhumi Mahesh Ranjane`→`Bhumi Ranjane` (middle-name drops, held); LWS-493 `Pranali Sarpale` vs roster `Droupadi Sarpale` (anomaly — investigate, do not rename).

### Audit other exams for `answer` vs `solution` key mismatches

The English Test 1 cleanup caught **3 silent wrong keys** where the `answer` field disagreed with the option named in the question's own `solution` text. The same defect likely sits in other recent exams (hand-entered keys + AI-generated solutions).

**Why:** a wrong `questions[].answer` shows students/parents the wrong "correct" option in the per-question view (and now mis-flags the chosen-option highlighting), even though marks are unaffected. Cheap to find.

**How to apply:** run the divergence check per exam — `where (q->>'answer') <> substring(q->>'solution' from 'Matches option ([A-D])')` over `jsonb_array_elements(questions)`. It's a *first filter* only (blind to errors where key AND solution agree but are both wrong); for a real correctness audit, re-derive — see `memory/feedback_rederive_over_consistency_check.md`. Fix high-confidence MIS-KEYED via the JSONB recipe in `reference_exam_grading_data_model.md`.

**How to apply (when it matters):**
- **Auto-roll:** a Sunday-evening cron that calls the sync endpoint (or a small scheduled job) so the window advances without a manual click. The endpoint is already idempotent + admin-gated; a cron would need a service-role or stored-admin-token path since there's no interactive JWT.
- **Holidays / exam days:** add `EXDATE`s to the recurrence (needs a holiday/exam-day source) so blocks skip non-teaching days.

---

## 2026-06-15

### A populated Class-10 / SSC chapter list (or a dedicated school subject) for tag validation

Chapter-name validation was just downgraded to a non-blocking warning (DECISIONS.md 2026-06-15), so non-NDA **school Class-10** tests (e.g. the APJ Maths paper) now upload fine — but their chapters (Polynomials, Arithmetic Progressions, Real Numbers, …) still show as amber *"not in the Maths list"* warnings because `getValidChapters('Maths')` is the NDA list. A populated Class-10 list would make those validate cleanly (and re-enable typo-catching for school tests).

**Why:** purely cosmetic now (the warning is walk-past-able). Low priority — only worth it if school tests become frequent and the amber warnings get noisy.

**How to apply (`src/lib/ndaFreq.js`):** add a subject key (e.g. `'Maths (School)'` / `'SSC Maths'`) whose chapter list is the CBSE/SSC Class-10 set (Real Numbers, Polynomials, Pair of Linear Equations, Quadratic Equations, Arithmetic Progressions, Triangles, Coordinate Geometry, Introduction to Trigonometry, Some Applications of Trigonometry, Circles, Areas Related to Circles, Surface Areas and Volumes, Statistics, Probability), and have school papers tagged with that `Subject` (the PYQ-Vault tags generator can emit it). An empty `[]` list also works (skips validation) but loses typo-catching.

---

## 2026-06-16

### Manually verify the WhatsApp result-monitoring golden path in the browser

The monitoring-copy feature (commit `81761ce`) shipped with full unit/lint coverage (1512 Vitest passing) but the **end-to-end browser check was not done** (the global Definition of Done requires it). The Settings → Monitoring tab + the `monitorMobiles[]` body param + the `api/send-whatsapp.js` random-pick path are all deployed and go live on the next Vercel build; the seam (Settings edit → persist round-trip → real send → MONITOR message actually arrives on `9021869427`) is only unit-covered.

**Why:** monitoring is *itself* the verification mechanism for the result blast — if it silently doesn't fire (e.g. a Wabridge quirk on the extra send, or `monitorMobiles` not reaching the endpoint in prod), the faculty loses the observability they asked for without knowing. A 2-minute live pass confirms it.

**How to apply:**
- On `nda-tracker.vercel.app`: Settings → Monitoring → confirm `9021869427` is listed (add a test number you control if preferred).
- Send a real result blast for a small/old exam (or use a redirect-to test FIRST to confirm the monitor copy is correctly **suppressed** on test sends), then a real send and confirm exactly one `👁 MONITOR → … (sample: <name>)` line appears in the results modal and the message lands on the monitor phone.
- Confirm removing all numbers (empty list) cleanly disables it (no monitor line, `monitor: 0`).

### Decide whether to strip the deep-link mobile from monitoring copies

The monitoring copy reuses the sampled student's exact message, including the tracker deep-link with that student's mobile pre-filled (`?mobile=<student>&exam=<id>`) — i.e. a one-tap login into that student's portal lands on the monitor phone. Acceptable today (the monitor number is the faculty owner's own phone), flagged during the build but left as-is.

**Why:** low risk now, but if the monitoring list ever grows beyond the owner's own device (e.g. a staff member, a shared phone), the copy hands out a working student-portal login. Cheap to neutralise.

**How to apply:** in `api/send-whatsapp.js` (and `send_results_whatsapp.py`), when building the monitor copy's params, swap the per-student `trackerUrl` for one without the `mobile=` param (exam-only or bare base) — a 1-line change in `makeParamsForRow`'s monitor call site, or pass a flag. Only worth doing if the list becomes multi-recipient.

### Decide the Maths chapter-consolidation candidates (deferred from the subtopic cleanup)

The 2026-06-16 Maths cleanup applied the 23 safe subtopic merges + the one clear chapter duplicate (`Height & Distance` → `Heights and Distances`, weightage row renamed too). The user **deferred** the taxonomy-changing consolidations: `Arithmetic Progressions` (5 Qs) → `Sequence & Series`; `Area Under Curve` (1) → `Integration`; `Areas Related to Circles` (2) → `Circles`; and the CBSE-class-10 fragments (`Real Numbers`, `Polynomials`, `Pair of Linear Equations`, `Triangles`, `Coordinate Geometry`, `Introduction to Trigonometry`) that may belong under broader NDA chapters.

**Why:** these aren't typos — they're real taxonomy decisions that change chapter-level analytics, NDA-weightage rows, and (for the CBSE fragments) overlap with the open 2026-06-15 "Class-10 / SSC subject for tag validation" suggestion. Worth a deliberate call rather than an over-eager merge. Several fragments are likely **school-paper chapters** that should route to a separate school subject (see the 2026-06-15 entry), not fold into NDA Maths.

**How to apply:**
- Decide per group: fold into the parent NDA chapter, OR route to a dedicated school subject (ties into the 2026-06-15 Class-10 list suggestion), OR leave as-is.
- For any fold: add `CHAPTER_RENAMES` entries to **both** `merge_subtopics.py` and `migrate_subtopics_supabase.js` (the chapter-rename plumbing now exists), add TDD coverage to `tests/test_subtopic_merge.py`, run `merge:subtopics` + `:sync`, then **rename the matching `ndaFreqBySubject` weightage key** (chapter renames do NOT cascade to weightage — `syncFreqChapters` would orphan the pct).
- Verify with a Supabase `COUNT` before/after (exact-string match — pull literal chapter strings first; see `memory/feedback_query_database_before_reasoning.md`).

---

## 2026-06-17

### Teacher per-student drill-in: expand `StudentQuizHistory` rows into `QuizReview`

The wrong-answer remediation links (2026-06-17) render in `QuestionCard` and reach both the student exam review (`FocusedExamResult`) and the teacher exam-insights cohort view (`ExamInsightsPanel`). But the teacher's **per-student** view (`StudentView` → `StudentQuizHistory`) only lists quiz attempts as summary rows (title · X/total · score) — it can't expand into the per-question review, so a teacher can't see an individual student's misses + the Learn/Practice links there.

**Why:** in a coaching setting the teacher often drives remediation ("go drill this"). The data is all present (`quiz_attempts.answers` per student + the quiz's questions/key), and it reuses the existing `QuizReview` — small, self-contained, arguably more useful than the student-only path.

**How to apply:** make `StudentQuizHistory` rows expandable → render `QuizReview` (read-only) for the clicked attempt, passing `subject` so the buttons resolve. Confirm `getQuizAttemptsForStudent` returns `answers` (add to the select if not). The exam side has the same gap (per-student exam review) and could get the same treatment.

### Error-type signal: don't push remediation on a likely careless slip

The remediation links show on EVERY wrong/skipped question. But not every miss is a knowledge gap — a careless slip on a topic the student otherwise aces doesn't need drilling, and pushing remediation there reads as punitive. Cheap proxy: if the student got the OTHER questions in the same subtopic right, the miss is likely a slip.

**Why:** the feature's design thesis is "remediate the concept gap, not the slip." Without this signal it over-triggers. nda-tracker already computes per-student per-subtopic accuracy (`computeStudentChapterStats`), so the signal is available locally.

**How to apply:** in `QuestionCard`/`FocusedExamResult`, soften or de-emphasise the buttons when the student's same-subtopic accuracy (this exam, or recency-weighted) is high. Keep it a gentle de-emphasis, not a hard hide — a student may still want to revise.

---

## 2026-06-18

### Manually verify the remediation links resolve on PYQ Vault (cross-app golden path)

The wrong-answer "Learn this / Practice" feature (commits `d278e65` + `5a303f1`, 2026-06-17) shipped with full unit/lint coverage (~30 tests) but the **cross-app golden path was not confirmed in this log** — the links deep-link out to the sister **PYQ Vault** app's `/go/learn` + `/go/practice` redirects, and `remediation.js` builds them name-based / notes-slug-based. The unit tests assert the *URL we construct*, not that PYQ Vault actually resolves those slugs/names to a real page.

**Why:** the seam crosses two apps. A URL that's well-formed on the nda-tracker side can still 404 on PYQ Vault if a subtopic/concept name (or `subtopicSlug`/`conceptSlug`) doesn't match a Vault route — and that failure is invisible to nda-tracker's tests. A student clicking "Learn this" and landing on a Vault 404 is worse than no link. Cheap to confirm; the feature is now live on every exam/quiz review surface.

**How to apply:**
- On `nda-tracker.vercel.app`, open a wrong-answer surface (a quiz `QuizReview`, or an exam `WrongAnswerAudit` / `FocusedExamResult`) and click both **Learn this** and **Practice** on a Maths question (Practice is Maths-gated via `PRACTICE_SUBJECTS`).
- Confirm each lands on a real PYQ Vault page for the right subtopic/concept — test one question whose tags carry `SubtopicSlug`/`ConceptSlug` (slug path) AND one that falls back to name-based, since `remediation.js` prefers the slug when present.
- Spot-check a non-Maths (GAT) question shows **Learn this** but not **Practice** (the Maths gate), and that a question with no resolvable concept degrades gracefully (no broken button).

---

## 2026-06-19

### Finish the mentorship-nudge production rollout (env + mobiles + live var-order check)

The daily mentor nudge shipped (commit `728ddf1`, pushed to main) with full unit/lint coverage (1568 Vitest) and a verified live dry-run against real data, but three user-side steps remain before the cron can fire for real. The cron is already in `vercel.json` but is **fail-closed** — without `CRON_SECRET` set in Vercel it rejects the daily call, so nothing sends until the rollout is finished.

**Why:** the feature is half-live — code deployed, but the autonomous send is inert until the env vars exist and teacher mobiles are entered. And the Wabridge template's positional variable order (`[date, students]`) is a guess until a real message confirms it (per the project's template-param rules, order isn't knowable from the template ID).

**How to apply:**
- Vercel → Settings → Environment Variables: `WABRIDGE_MENTOR_NUDGE_TEMPLATE_ID=1563510878524516` and a random `CRON_SECRET` (the shared `WABRIDGE_*` + `SUPABASE_SERVICE_ROLE_KEY` already exist). Redeploy (env changes need a fresh deploy).
- Settings → Teachers: enter each mentor's WhatsApp `mobile` (at least your own first).
- Settings → Mentorship: **Preview today's picks** (sanity), then **Send test to** your own number and confirm the message renders `Date: …` / `Students: …` correctly — if the date/students are swapped, flip the `variables` order in `api/send-mentor-nudges.js` (the `[dateLabel, namesList]` line) and the `reference_whatsapp_templates` row.

### Decide mentor-nudge name style: canonical vs familiar short names

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
