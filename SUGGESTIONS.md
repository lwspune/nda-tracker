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

### ~~Manually verify the offline-exam golden path in the browser~~ — **DONE 2026-06-29** (cleared in the batch browser-verification pass)

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

### ~~Manually verify the WhatsApp result-monitoring golden path in the browser~~ — **DONE 2026-06-29** (cleared in the batch browser-verification pass)

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

### ~~Manually verify the remediation links resolve on PYQ Vault (cross-app golden path)~~ — **DONE 2026-06-29** (cleared in the batch browser-verification pass)

The wrong-answer "Learn this / Practice" feature (commits `d278e65` + `5a303f1`, 2026-06-17) shipped with full unit/lint coverage (~30 tests) but the **cross-app golden path was not confirmed in this log** — the links deep-link out to the sister **PYQ Vault** app's `/go/learn` + `/go/practice` redirects, and `remediation.js` builds them name-based / notes-slug-based. The unit tests assert the *URL we construct*, not that PYQ Vault actually resolves those slugs/names to a real page.

**Why:** the seam crosses two apps. A URL that's well-formed on the nda-tracker side can still 404 on PYQ Vault if a subtopic/concept name (or `subtopicSlug`/`conceptSlug`) doesn't match a Vault route — and that failure is invisible to nda-tracker's tests. A student clicking "Learn this" and landing on a Vault 404 is worse than no link. Cheap to confirm; the feature is now live on every exam/quiz review surface.

**How to apply:**
- On `nda-tracker.vercel.app`, open a wrong-answer surface (a quiz `QuizReview`, or an exam `WrongAnswerAudit` / `FocusedExamResult`) and click both **Learn this** and **Practice** on a Maths question (Practice is Maths-gated via `PRACTICE_SUBJECTS`).
- Confirm each lands on a real PYQ Vault page for the right subtopic/concept — test one question whose tags carry `SubtopicSlug`/`ConceptSlug` (slug path) AND one that falls back to name-based, since `remediation.js` prefers the slug when present.
- Spot-check a non-Maths (GAT) question shows **Learn this** but not **Practice** (the Maths gate), and that a question with no resolvable concept degrades gracefully (no broken button).

---

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

---

## 2026-06-21

### Backfill `exam_results.choices` to widen copying-detection coverage

The Exam Integrity panel (shipped 2026-06-20) can only analyze the **8 exams** uploaded since 2026-06-10 — chosen-option capture (`exam_results.choices`) didn't exist before then, and copying detection is impossible without it. Every older exam shows the "re-upload to enable" notice.

**Why:** the detector is built, tested, and live, but its coverage is a thin recent slice. The full back-catalogue of mocks (the exams most worth auditing for patterns) is invisible to it. The fix is pure data entry, not code.

**How to apply:** re-upload each older exam's original **Evalbee results XLS** (it still carries the `Q N Options` column) via Update Results — `parseExcelFull` repopulates `choices` on save, no migration needed. Prioritise the large full-syllabus mocks. Carry-forward: this is the same backfill the [2026-06-09 re-grade-from-stored-choices entry](#build-the-re-grade-from-stored-choices-action-now-that-choices-are-captured) lists as its precondition — doing it once unblocks **both** features (re-grade + integrity coverage).

### ~~Cross-exam "repeat offender" integrity rollup — flavour 1 (incident-log aggregation)~~ — **DONE 2026-06-21**

Shipped the incident-log flavour: pure `buildIntegrityLeaders(rows, studentProfiles)` ([src/lib/analytics/integrityLeaders.js](src/lib/analytics/integrityLeaders.js)) + `getAllIntegrityIncidents()` slice reader + `IntegrityLeaders.jsx` Dashboard widget (hide-when-empty, ranked repeat-first, expandable exam list, click-through). +9 tests; 1618 green. Empty until incidents accrue. **Flavour 2 (below) remains open.**

### Cross-exam integrity rollup — flavour 2 (statistical re-detection across exams)

The shipped flavour 1 only counts **admitted** incidents you logged by hand — it re-displays, it doesn't *discover*. The discovery value is flavour 2: run `buildExamIntegrityReport` across **all** choice-bearing exams and re-key the output **by student** to surface "statistically anomalous in N exams, M times with the same partner" — serial copiers nobody confronted.

**Why:** recurrence across exams is the strongest, least-confoundable copying signal, and a per-exam panel is structurally blind to it. Flavour 1 can't find it (admissions only).

**Why deferred (the data, not the worth) — verified 2026-06-21:** of 191 students across the 8 choice-bearing exams, **0 are in 3+ exams and only 38 in exactly 2** (one APJ 12th+6M cohort, across a Maths + a GAT exam). There is essentially no recurrence to find yet — gate this **behind the `choices` backfill** (the entry above) which widens per-student exam counts.

**How to apply (when data exists):**
- Aggregate `buildExamIntegrityReport` per student across exams, but **do NOT naively count "flagged in N exams"** — that treats correlated evidence as independent. A student with an idiosyncratic-but-honest distractor style + a genuine study partner who shares a method will co-flag repeatedly on the *same* innocent confound, manufacturing a fake serial cheater. Weight **same-partner recurrence** (genuinely strong) very differently from scattered low-z co-flags (likely the same hub/confound repeating). See `memory/reference_collusion_detection.md`.
- Keep the "leads, not proof" framing — cross-exam aggregation amplifies apparent confidence, so the false-positive cost is higher than a single-exam flag. Validate the weighting against real recurrence before surfacing accusations.

### ~~Manually verify the Exam Integrity golden path in the browser~~ — **DONE 2026-06-29** (cleared in the batch browser-verification pass)

The integrity feature (detection panel + admitted-incident logging) shipped with tests + lint green (1609 passing) but the end-to-end browser pass wasn't run — same gap noted for offline exams (2026-06-08), monitoring (2026-06-16), remediation (2026-06-18), and mentee-assignments (2026-06-19).

**Why:** the wiring spans panel → `studentProfiles` name→lwsId resolution → `logIntegrityIncident` upsert → StudentView card → student/parent portal (`api/student-login` return). That's a lot of seams a unit test can't fully exercise; the global Definition of Done requires the manual pass.

**How to apply:** as admin/teacher on a choice-bearing exam (e.g. the APJ 11th Maths mock), open 🕵 Integrity → confirm a flagged pair (Manas↔Saarth should be Tier B) → click "[name] admitted" → confirm the "✓ logged" badge → open that student in StudentView → see the red "⚠ Academic Integrity" card → log in to the student/parent portal for that student and confirm the card shows there too → finally test admin-only delete (× present for admin, absent for teacher).

### Resolve the 3 APJ teacher scheduling clashes

A branch-wide scan of APJ (queried live from `faculty_state`, 2026-06-21) found three real teacher double-bookings: **Navneet Sir** Tue 11th-A Physics 1:45–2:50 ∩ 12th Physics 2:00–3:20; **Manisha Mam** Tue 11th-A English 3:00–4:00 ∩ 12th English 3:30–5:00; **Manisha Mam** Wed 11th-B English 1:45–2:50 ∩ 12th English 2:00–3:20. (All Asha Bade Mam Saturday overlaps are exam-block / proctoring tags, not teaching clashes — ignore.) The fix was scoped this session but the user said to hold off applying.

**Why:** these are live conflicts in the current term timetable — a teacher physically can't be in two batches at once, so one batch is silently losing its lecture. 12th is the fixed anchor (its day is fully booked), so every fix has to move the 11th-grade lecture.

**How to apply:** move via the in-app **EditCell flow** (not raw JSONB — the slot row owns the time, shared across days; see the CLAUDE.md Timetable slot-time invariant). Tuesday reshuffle of 11th-A's afternoon: English → 1:45–2:50 (vacated slot) and Physics → a free slot ≥3:20 (only the 4:00–6:30 Hi-Tea/Sports or the 8:30–9:30 morning self-study slot rows are free that day — both are break slots, so this is a policy call). Wednesday: 11th-B English → 4:00–5:05 (Hi-Tea) or assign a second English teacher. Verify each move clears the overlap **and** leaves the batch with no new student-side clash before saving.

### Surface branch-wide teacher clashes in the UI

The in-app clash detector (`detectClashes` in `TimetablePage.jsx`) only runs for the **currently-selected** teacher in the Teacher Schedule view. A clash between two teachers' batches is invisible unless someone happens to open that one teacher. The APJ clashes above were only found via an ad-hoc Supabase query.

**Why:** scheduling conflicts are exactly the kind of thing that should be flagged automatically, not discovered by manual SQL. A faculty member building the timetable has no signal that a teacher is double-booked across batches.

**How to apply:** add a branch-level (or all-teachers) clash roll-up — reuse the existing `groupScheduleRows` + `detectClashes` logic but iterate every `timetableTeachers` entry instead of one. Surface as a count/badge on the Timetable page (admin/superadmin), or a dedicated "Conflicts" tab listing each clash as `teacher · day · batch A ↔ batch B (overlap window)`. Keep it pure/testable like `getTeacherDayHours`.

---

## 2026-06-29

### ~~Manually verify the timetable week-of-dates golden path in the browser~~ — **DONE 2026-06-29** (cleared in the batch browser-verification pass)

The "Week of" date feature (commit `b3118d9`) shipped with full unit/lint coverage (helper + grid-render tests, 43 green in the timetable area, prod build ✓) but the **end-to-end browser pass was not run** (global Definition of Done requires it). The picker → `weekDates` → grid header → PNG/Excel export seams are only unit-covered. Same gap noted for offline exams (2026-06-09), monitoring (2026-06-16), remediation (2026-06-18), mentee-assignments (2026-06-19), and integrity (2026-06-21).

**Why:** the export seams in particular are unit-blind — the PNG path relies on the cloned `<table>` carrying the new header `<div>` along (plus a dark-header contrast tint applied only in the clone), and the Excel path emits `Mon\n29 Jun` into a styled `xlsx-js-style` cell with a taller header row. A wrong wrap/clip or a low-contrast date line wouldn't fail a test. A 2-minute pass confirms it before faculty prints a dated timetable.

**How to apply:**
- On the Timetable page (Student View), confirm the "Week of" picker defaults to the current week's Monday and each Mon–Sat header shows the right date beneath the day name; change the week and confirm the dates shift; click **Clear dates** and confirm the plain recurring grid returns.
- Click **⬇ PNG** — confirm the dates appear under each day in the image and are legible on the dark indigo header (the indigo-300 tint).
- Click **⬇ Excel** — open the file and confirm each day header cell shows the day name with the date on a second line, not clipped.
- Edge: pick a Sunday in the picker and confirm the grid anchors to the *preceding* Mon–Sat week (ISO behaviour), not the next one.

---

## 2026-07-08

### ~~Verify the hostel golden path in the browser~~ — **DONE 2026-07-29** · finish the warden-alert rollout (STILL OPEN)

> Browser pass confirmed by the owner 2026-07-29. **The warden-alert rollout below is still outstanding** — the endpoint stays fail-closed until `WABRIDGE_HOSTEL_ALERT_TEMPLATE_ID` is set in Vercel and the variable order is confirmed with a live `redirectTo` test.

The hostel & mess feature (Phases 1+2, commits `5821163`/`f9a5760`/`b5bcdc5`) shipped with full unit/lint coverage (chain aggregator, both slices, endpoint, HostelTab) and a **DB-contract smoke test** (sentinel insert/read/delete of all three tables), but the **end-to-end browser pass was not run** — the session was non-interactive and the board needs a live Supabase **admin session** (only exists on Vercel). The warden alert is also inert until its env is set. Same manual-verify gap noted for offline exams / monitoring / remediation / mentee-assignments / integrity / week-of-dates.

**Why:** the seams that unit tests can't reach — the marking→save round-trip, the reconciliation gate writing `checkpoint_confirmations`, the chain board flagging a real unexplained boarder, and (critically) the **filter-as-display-lens** guarantee that a filtered save doesn't drop hidden rows — are exactly where a regression hides. And the alert is half-live: code deployed, but nothing sends until the template + a warden number exist.

**How to apply:**
- On `nda-tracker.vercel.app` (admin): Attendance → **Hostel & Mess**. Mark a Night Roll exception → Save → filter to Boys/Girls, mark one, Save → **reopen and confirm the other wing's marks survived** (the display-lens guarantee). Enter a headcount → **Reconcile & close** (tie = ✓; mismatch = OPEN incident). Switch to **Chain** → confirm a real unexplained boarder is flagged with the right first-break.
- Warden alert rollout: get the Meta/Wabridge template approved → set `WABRIDGE_HOSTEL_ALERT_TEMPLATE_ID` in Vercel (`SUPABASE_SERVICE_ROLE_KEY` already set) → add a warden number in the Hostel tab → **Send test via `redirectTo` to your own number to confirm the `[date, listText]` variable order** (order isn't knowable from the template ID — per the template-param rules) → flip the `variables` order in `api/send-attendance-alerts.js` + the `reference_whatsapp_templates` row if swapped.

### Hostel Phase 3 — alert durability: nightly cron + a "did we alert?" log + parent notify

The warden alert is currently **manual + stateless**. The endpoint already has a cron-secret auth branch (unused) and the chain recompute is server-side, so a nightly auto-send is a small add; but there's no record of who was alerted when.

**Why:** a safety alert that only fires when someone remembers to press a button isn't a safety net. And without a send log, you can't answer "did we already alert the warden about Rahul tonight?" — the pending-aware pattern this project uses everywhere else ([[feedback_pending_aware_over_sent_flag]], [[feedback_event_log_over_derive]]) is exactly what's missing here.

**How to apply:**
- Add a `vercel.json` cron (e.g. post-night-roll, weekday evening IST) hitting `/api/send-attendance-alerts` with the `CRON_SECRET`; gate weekdays in-handler as a backstop (mirror `send-mentor-nudges`).
- Add a `hostel_alerts` event-log table (`date, checkpoint?, lws_ids[], sent_at, sent_by, recipients`) so re-runs are idempotent-aware and the board can show "alerted N of M"; scope re-sends to pending = unexplained − already-alerted.
- Parent notification is a further step — highest value but most sensitive; needs false-positive control (only alert parents after the reconciliation gate is closed AND the absence is still unexplained) before it goes near parents.

### Hostel Phase 3 — analytics + roster refinements

Deferred non-alert follow-ups: **per-student boarding timeline** in `StudentView` (a hostel/mess history strip beside the existing lecture/attendance incidents — read-only, composes existing data); **compliance % reports** (per-boarder checkpoint attendance % over a range — pure queries over `checkpoint_absences` + `leaves`); the ~~**day-scholar split**~~ — **DONE 2026-07-08** (`importStudentsDB` now loads `residential` into `studentProfiles` as `s.residential ?? true`; `HostelTab` roster skips `residential===false`; the warden endpoint already filtered — day-scholars excluded from board **and** alert; Anvay Sawant LWS-554 is the first flagged day-scholar); and **time-granular partial leave** (leave windows that cover only some checkpoints of a day — today leave coverage is day-granular, partial deviations are marked as an `outpass` checkpoint status instead).

**Why:** these are the "compliance/parent-visibility" half of the original brief that Phase 1–2 (safety) didn't cover. Each is self-contained and low-risk; none is urgent.

**How to apply:** pick per demand. The boarding timeline reuses `getCheckpointExceptionsForDate`-style reads keyed by student; compliance % is a new pure aggregator alongside `chain.js`. (The day-scholar split shipped 2026-07-08 — see the struck item above.) See [[project_hostel_attendance]].

### APJ 11th batch-split — data-hygiene loose ends

The Batch A↔B section split + day-scholar tagging (2026-07-08) surfaced anomalies the user deliberately left unactioned. Small integrity items, not blockers.

**Why:** each will quietly skew a roster, a duplicate scan, or a class count if left — cheap to fix now, confusing later.

**How to apply:**
- **Pranali / Droupadi Sarpale (LWS-493)** — the printed Batch B list had *both* "Dropadi sarpale" and "Pranali sarpale" as separate roll numbers, but they collapse to one profile (LWS-493 carries `Droupadi Sarpale` as a name-variant). In **Find Duplicates**, verify whether these are two real girls mis-merged into one record; if so, split them (a distinct record + re-tag). See the cross-profile-collision note in [[reference_roster_reconciliation.md]].
- **Zishan Shaikh (Batch B list roll 52)** — no profile anywhere in the DB (searched phonetic variants); not tagged. Import via the Students flow if a real 11th-B student. (Anvay Sawant, the other original not-found, was since imported → LWS-554.)
- **Blocked students on live batch lists** — Kartik Shinde (LWS-473) + Ganesh Mane (LWS-505) are `account_status=Block` yet appear on the handwritten Batch B list and are tagged B. If the block is stale, reactivate; else leave (blocked students keep historical tags).

### Push the day-scholar filter deploy (pending)

The day-scholar wiring (studentSlice + HostelTab + tests + DATABASE_SCHEMA/FLOWS) is committed-ready in the working tree but **not yet committed/pushed**, so it isn't live on Vercel. Anvay Sawant is flagged `residential=false` in the DB but still shows on the prod board until this deploys.

**Why:** the data change is live but the code that acts on it isn't — a half-applied state.

**How to apply:** commit the working-tree changes (`feat(hostel): exclude day-scholars from the boarder board`) and push to `main`; verify on `nda-tracker.vercel.app` that Anvay Sawant no longer appears on the Hostel & Mess board.

---

## 2026-07-11

### Suppress on-leave students in the late-arrival + homework-pending alerts

The lecture-miss alert now skips students on an active hostel leave (commit `84a393e`) — but the sibling parent-alert flows (`api/send-late-notifications.js` late-arrival, and the homework-pending send inside `api/send-attendance-alerts.js`/its caller) were **not** touched and almost certainly still message parents of boarders who went home. Same class of gap the lecture alert just closed.

**Why:** a boarder on leave getting a "late to first lecture" or "homework pending" WhatsApp to their parents is wrong and erodes trust in the alerts — exactly the reason the lecture flow was fixed. It's a shipped feature so it needs a 360 + confirmation before reworking, but the fix pattern is already proven.

**How to apply:** mirror the lecture fix — load the day's leaves with the null-safe query (`.lte('from_ts',endIso).or('to_ts.is.null,to_ts.gte.'+startIso)` via an authed user client), build an `onLeaveIds` Set, and skip any student whose `lwsId` is in it (report an `onLeaveSkipped` count; fail closed on a leaves-read error). Reuse `computeAbsentees`/`resolveOnLeave` semantics. Add a test per endpoint (on-leave suppressed; fail-closed). Note the late flow keys students differently — confirm it carries `lwsId` before matching.

### ~~Browser golden-path verify the leave lifecycle + present/absent lecture marking~~ — **DONE 2026-07-29** (browser pass confirmed by the owner)

This session shipped a lot of leave-aware UI (On Leave tab: Put on leave / Mark returned / stale flag; lecture `MarkAbsenteesModal` present/absent toggle + leave-lock; `LectureLogTab` "Also attending" pooled roster) — all **test-verified but not click-verified** (sessions are non-interactive; the board needs a live Supabase admin session that only exists on Vercel). Same manual-verify gap logged for every prior feature.

**Why:** the seams unit tests can't reach — `addLeave`→board round-trip, the present-mode derivation writing the right absentee set, the pooled-roster union actually pulling 6M students into a 12th period, the `endLeave` "returned?" closing a leave and unlocking the row — are where a regression hides. And the whole point (stop hand-entering leaves via SQL) only pays off if the UI works end-to-end.

**How to apply:** on `nda-tracker.vercel.app` (admin, hard-refresh first): Hostel & Mess → **On Leave** → **+ Put on leave** → select 2 boarders → confirm they appear on the list open-ended, then **Mark returned** on one and confirm it closes. Attendance → **Lecture log** → pick the APJ 12th batch → **Also attending** = the 6M batch → open a period → toggle **Present list** → tap the present students → confirm the preview "will log absent N" matches roster−present−leave and an on-leave student shows locked with a "returned?" link.

### Auto-close a leave when the student returns (class-attendance `P` signal)

Deferred by design this session: "persist-until-return" leaves are closed **manually** (Mark returned). True auto-close ("mark present at a roll → leave ends") turned out ill-defined under exception-capture — default-present means "present" = *no row*, indistinguishable from "on leave, unmarked", so saving a roll can't safely close leaves. The one real positive present signal is the imported class attendance `P` (`student_attendance`).

**Why:** an open-ended leave that nobody closes is a permanent blind spot — it suppresses every checkpoint anomaly for that student forever (the stale-leave ≥3-day flag is the current mitigation, not a fix). Auto-close tied to a real "they're back" observation would make persist-until-return safe without relying on someone remembering.

**How to apply:** when the daily attendance import (or a roll marking) records a boarder as **present** while they hold an open leave, offer/apply an `endLeave(id, thatDay)` — surface it as a confirm ("N on-leave students marked present — close their leaves?") rather than silent auto-close, to avoid a stray `P` ending a real leave. Gate on a *positive* present signal only (attendance `P`), never on absence-of-exception. Ties into the existing On-Leave panel + `endLeave`.

---

## 2026-07-14

### Align (or deliberately keep divergent) `getPriorityChapters` accuracy vs the pooled projection

The projected-score accuracy was reworked (2026-07-14) to **pool a chapter's questions** (`Σ score×weight / Σ weight`) instead of averaging per-subtopic ratios — see `computeProjectedScore` in [src/lib/analytics/projection.js](src/lib/analytics/projection.js) and the DECISIONS.md entry. The Dashboard's **Priority Chapters** widget (`getPriorityChapters` in `src/lib/analytics/dashboard.js`) still computes chapter accuracy its own way (`priority = weightPct × (1 − accuracy)`), so the two surfaces can now disagree slightly on a chapter's accuracy for the same student/cohort. This divergence was **deliberately deferred** to keep the projection change's blast radius small.

**Why:** two Dashboard/Toppers surfaces showing different "accuracy" for the same chapter is a subtle credibility gap — a teacher comparing the Projected card's Functions accuracy against the Priority Chapters list may see mismatched numbers. Low urgency (numbers are close and priority is a *ranking*, not an absolute), rising if faculty start cross-reading the two.

**How to apply:**
- Decide: (a) **align** `getPriorityChapters` to the same pooled `Σ score×weight / Σ weight` method (extract a shared `chapterAccuracy(subs)` helper both call, so they can't drift), or (b) **keep divergent on purpose** and document why (priority is class-level weightage×gap, projection is per-student potential — arguably different questions).
- If aligning: it's class-level (uses `computeChapterStats`, not the per-student `computeStudentChapterStats`), so the pooled helper needs a counts-based variant or the raw weighted sums exposed there too. TDD against `dashboard.test.js`'s existing `getPriorityChapters` block.

### Reconsider the Toppers default projected-marks floor (currently a flat 60)

The Toppers "Min projected" gate defaults to **60 marks** (`useState(60)` in `src/pages/Toppers/index.jsx`), clamped to the active subject's ceiling. It's a reasonable NDA-Maths cut but is subject-agnostic — on a small-max subject (e.g. a 40-mark paper) 60 clamps to the max and the list can look oddly gated, and on a real cohort the "right" floor varies.

**Why:** purely a default-value ergonomics question, not a correctness issue (faculty can adjust the input any time). Worth a glance only if faculty report the default hides too many / too few students, or once non-Maths subjects use the Toppers page more.

**How to apply:** either lower the default to `0` (threshold becomes purely opt-in narrowing, list shows everyone ranked) or derive a per-subject default as a fraction of `subjectMaxScore` (e.g. `Math.round(subjectMaxScore * 0.2)`) computed once when the subject is known. Both are a few lines in `ToppersPage`.

### Cross-subject subtopic merges — the non-Maths remainder of the 2026-07-14 scan (backfill ledger)

The 2026-07-14 subtopic cleanup (commit `a2c1d03`) applied **Maths only** by explicit user scope: 4 duplicate groups + the cube-roots-of-unity same-concept fold (79 questions consolidated in Supabase; twin maps + TDD updated). The full `/subtopic-analyse` scan (2,652 rows, all subjects) surfaced **~13 more high-confidence merges in other subjects** that were deliberately **not** applied. Logging them here so the remainder survives across sessions rather than needing a re-scan.

**High-confidence groups found (counts from the 2026-07-14 scan — re-verify exact live strings before writing, per [[feedback_query_database_before_reasoning]]):**
- **English / Ordering of Words in a Sentence** — `Sentence Rearrangement` (5) → `Sentence Rearrangement (PQRS)` (50). *Biggest single win, 55 Qs.*
- **English / Reading Comprehension** — `Factual Detail Recall` (4) → `Factual Detail Retrieval` (15). 19 Qs.
- **English / Fill in the Blanks** — `Grammar - Articles and Determiners` (1) → `Articles and Determiners` (1).
- **English / Parts of Speech** — `Determiners & Pronouns` (1) → `Determiners and Pronouns` (1) (`&`/`and`).
- **English / Idioms & Phrases** — `Change & Transition Idioms` (1) → `Change & Transformation Idioms` (1).
- **Chemistry / Atomic Structure** — `Isotopes and average atomic mass` (1) → `Isotopes and Average Atomic Mass` (4) (casing); `Electronic configuration and shells` (1) → `Electronic Configuration` (2).
- **Chemistry / Chemical Reactions** — `Physical vs chemical processes` (1) → `Physical vs chemical changes` (3).
- **Chemistry / Matter & Its Classification** — `Separation of liquid mixtures` (1) → `Separation of mixtures` (1).
- **Chemistry / Periodic Table** — `Noble gases` (1) → `Noble Gases` (1) (casing).
- **Physics / Motion in a Straight Line** — `Distance and Displacement` (1) → `Distance vs Displacement` (1).
- **Physics / Electrostatics** — `Electrostatic Potential` (1) → `Electric Potential` (1); **keep `Electric Potential Energy` separate** (distinct concept).
- **Polity / Constitutional Framework** — `Basic Features of Constitution` (1) → `Features of Constitution` (1).

**Why:** same rationale as the Maths pass — split subtopics fragment the per-subtopic signal that drill-downs, wrong-answer audits, and remediation links read (chapter-level projection is unaffected — it pools across all a chapter's questions). ~106 non-Maths questions affected. Not urgent (English/Ordering at 55 Qs is the only large one); the rest are low-volume tidy-ups. Worth folding into one pass next time the merge maps are touched, rather than a separate round.

**Explicitly NOT to merge** (algorithm false positives — distinct concepts): `Molality`/`Molarity`; `Atomic mass number`/`Atomic Number`; `First`/`Second Ionization Enthalpy`; the `Common Chemicals` set; the `Avogadro's Number and …` set; `Concave`/`Convex Mirror`; `Inferential`/`Literal Comprehension`; the cloud-type set; `Basic Concepts of Latitude`/`Longitude`; `Ashrama`/`Varna System`; the `Vocabulary -` and `Phrasal Verbs with '…'` sets; `Active to Passive` tense variants. Also the deliberately-granular optional groups (English Question-Tags, Chemistry Mole-Concept `Formula`/`Molar`/`Empirical` mass distinctions).

**How to apply:** same recipe as the Maths pass — for each group add a `SUBTOPIC_RENAMES` entry to **both** `merge_subtopics.py` and `migrate_subtopics_supabase.js` (keep the twin maps in sync), add TDD coverage to `tests/test_subtopic_merge.py` (rename asserts + distinct-preserved guards), run the JS `--dry-run` against live Supabase to confirm exact-string matches and expected counts, then apply + verify old strings → 0 rows / canonicals consolidated. Re-verify the literal strings first — they may have shifted since the 2026-07-14 scan (Binary Numbers was already clean by then).

---

## 2026-07-17

### Server-side blocked-contact guard on the 4 client-fed send endpoints (defense-in-depth)

The blocked-contact gate shipped 2026-07-17 ([[project_whatsapp_block_gate]]) is **UI-only** for `send-late-notifications`, `send-homework-pending`, `send-attendance-alerts` (`kind:'lecture'`), and `send-exam-absence` — each trusts a client-built `students[]` array. Only `send-whatsapp` (exam results) got a server guard. So a stale SPA bundle or a crafted POST to those four could still deliver to a `Block`/`Quit`/`Inactive` contact. This was a deliberate scope choice (user picked UI-only for those flows), logged here so the residual is visible.

**Why:** the project's own Backend-Integrity rule keeps recipient/business logic server-side; the client filter is a UX correctness aid, not a security boundary. Low urgency (the UI is the only real send path today, 0 blank-status rows on the roster), rising if any endpoint is ever called from a stale client or externally.

**How to apply:** in each of the four endpoints, after assembling the recipient list, load `account_status` for the target students (by `lws_id`, or by mobile/name where no id is carried) and drop `isBlockedStatus(...)` rows before the Wabridge loop — reuse `import { isBlockedStatus } from '../src/lib/accountStatus.js'` (api already imports from `../src/lib/*`). Add a test per endpoint (blocked dropped; blank kept). **Companion to the open 2026-07-11 entry** "Suppress on-leave students in the late-arrival + homework-pending alerts" — both are the same shape (server-side recipient filter on these endpoints) and are best done in one pass: load leaves + status together, skip on either. Note the predicate difference to reconcile at the same time: exam-absence + analytics use `!== 'Active'` (fail-closed on blank) while the new send gate uses the block-set (fail-open on blank); pick one deliberately (block-set is the login-gate-authoritative "blocked contact" definition).

---

## 2026-07-20

### Feed the upload key-resolver into the re-grade action (carry-forward)

The answer-key cross-check shipped this session (`KeyMismatchPanel` + `findKeyMismatches`, commit `d9ae77c`) lets faculty override the Evalbee `Q N Key` with the tags-file `Answer` at Step 1 of upload. Picking "Tags" is an explicit assertion that **Evalbee's key — and therefore Evalbee's grading of that question — is wrong**. But the cross-check only sets the *displayed* answer/solution/analytics (`questions[].answer`); `total_marks`/`responses` stay at Evalbee's original (now-known-wrong) grading. This is a **new, at-upload trigger** for the already-open **"Build the re-grade-from-stored-choices action"** entry (2026-06-09 above) — not a separate feature.

**Why:** an upload-time key override is the moment faculty is *most certain* a key is wrong, yet today it silently leaves scores/ranks wrong for exactly those questions. The two features compose: the resolver already threads the chosen keys into wizard state (`keyMismatches[]` with `chosen`, passed at `onNext`), so `regradeFromChoices` has its input ready.

**How to apply:**
- Do the re-grade entry first (it's the prerequisite; this is just a new entry point into it).
- When built, after an upload where the user overrode ≥1 conflict to the Tags key, offer (or auto-open) the re-grade **preview** for that exam — corrected `questions[].answer` × captured `exam_results.choices` × `marking` makes it deterministic.
- Keep it preview-gated/opt-in like the parent entry — overriding display ≠ auto-shifting grading authority Evalbee→app.

### ~~Browser golden-path verify the Monthly Reports date-range + branch + conduct-block PDF~~ — **DONE 2026-07-29** (browser pass confirmed by the owner)

The Monthly Reports rework this session (custom From→To range + branch-narrows-batch, commit `4fecd00`; exception-only stacked conduct blocks in the PDF, commit `13b422c`) shipped **test-verified but not click-verified** — sessions are non-interactive, no browser driver is available, and the Generate→download flow needs a live Supabase **admin session** (only on Vercel). A sample PDF *was* rendered headlessly end-to-end (valid, all four conduct blocks), but the real UI seams weren't driven. Same manual-verify gap logged for every prior feature.

**Why:** the unit tests cover `conductBlocks`/`rangeLabel`/cohort exactly and the fetch signature, but not: the date pickers → `fetchMonthlyReportData(from,to,ids)` round-trip, the Branch dropdown actually narrowing the Batch list, the invalid-range Generate-disable, and — the one thing no headless check can confirm — the **visual layout/spacing** of the stacked blocks and the "Period:" header on a real multi-student batch. FLOWS.md notes PDF layout is "reviewed out of band."

**How to apply:** on `nda-tracker.vercel.app` (admin): Sidebar → Monthly Reports → pick a Branch (confirm the Batch list narrows to that branch's batches) → pick a Batch → confirm the default range = previous month and cohort count → set a custom From→To that spans part of a month (confirm the header reads e.g. "5 Jun - 20 Jun 2026", a whole month reads "Jun 2026") → Generate → download one PDF and eyeball the stacked conduct blocks (Attendance line present; Late/Missed/Homework blocks appear only when non-empty; a clean student shows just Attendance or none) → download the ZIP and confirm the filename carries the range label. Edge: set From > To and confirm Generate is disabled with the inline hint.

### Align the on-screen ReportRow preview with the PDF's conduct signals

The Monthly Reports **preview card** (`src/pages/MonthlyReports/ReportRow.jsx`) still shows its original 4 stat tiles (Exams taken · Missed exams · Attendance **%** · Late days) and was left unchanged when the **PDF** conduct section was redesigned (2026-07-20). So the admin preview and the downloadable PDF now diverge: the preview shows attendance as a bare `%` (not "10 / 12 days present"), and it surfaces neither **missed lectures** nor **homework-incomplete**, both of which now appear in the PDF. Flagged to the user at build time and deliberately deferred (scope was the downloadable report).

**Why:** low-stakes cosmetic/consistency — an admin scanning the preview gets a different picture than the parent gets in the PDF. Not wrong, just inconsistent; worth aligning if faculty find the mismatch confusing, or when the preview is next touched.

**How to apply:** either (a) reuse the pure `conductBlocks(report)` from `monthlyReportPdf.js` to drive a compact preview strip (single source of truth for the omit rules + "X/Y days present" wording), or (b) minimally change the preview's Attendance tile to "X / Y" + add missed-lecture / homework-incomplete tiles. Option (a) keeps preview and PDF from drifting. `conductBlocks` is already exported and pure, so no new logic — just a render mapping. Keep it a preview *summary* (counts), not the full detail lists the PDF shows.

---

## 2026-07-21

### ~~Ship + browser-verify the chapter-level Learn/Practice links on "Where to focus" (deploy PYQ Vault FIRST)~~ — **DONE 2026-07-29** (browser pass confirmed by the owner on 2026-07-29, which implies both repos shipped — reopen if PYQ Vault is not actually deployed)

This session fixed the student **"Where to focus"** card's Practice link (it fell through to the generic `/browse?kind=practice` bank because it sent bare subtopic *names* with no subject/chapter) and added a **Learn →** link, both now **chapter-level**. Two repos changed, both green + lint-clean via TDD, but **nothing is committed or deployed yet**. nda-tracker: `chapterLearnUrl`/`chapterPracticeUrl` in `src/lib/remediation.js`, `src/lib/focusAreas.js` emits `learnUrl`+`practiceUrl`, `FocusAreas.jsx` renders Learn (primary) + Practice. PYQ Vault (`Question_Bank`): `goLinks.ts` `BY_CHAPTER`/`getChapterByName`/`buildChapterLearnPath`, `/go/learn` chapter fallback, `/go/practice` NAME mode fires on `subject && chapter` alone. See [[reference_remediation_links]] point 3.

**Why:** the links are the user-visible fix that started this session — worthless until live. **Deploy order is load-bearing:** the tracker's new URLs (`/go/learn?chapter=…`, chapter-only `/go/practice`) only resolve once the PYQ Vault route changes are live, so ship `Question_Bank` first, then nda-tracker. The cross-app golden path can only be checked after both deploy (sessions are non-interactive; no browser driver) — same manual-verify gap logged for every prior feature.

**How to apply:**
- Commit both repos (separate `feat:` commits) — PYQ Vault first, confirm its deploy is live, then nda-tracker.
- On `nda-tracker.vercel.app`, open a student with a populated "Where to focus" card (e.g. Pooja): click **Learn →** on a chapter → confirm it lands on that chapter's notes index (`/notes/nda-maths/<chapter>`), and **Practice →** on a Maths chapter → confirm it lands on the chapter-filtered practice bank (not the generic browse).
- Confirm graceful degrade: a focus chapter with **no notes** lands on the `/notes` index (not a 404); a chapter with **no practice questions** lands on `/browse` — acceptable fallbacks, but note which chapters hit them (notes/practice coverage is incomplete) in case coverage should be prioritised.
- Pre-existing lint note: `StudentView.jsx:119` has 4 `set-state-in-effect` errors (baseline, unrelated to this change — a line not touched); leave them per the CLAUDE.md "add the disable comment only if you touch those lines" rule.

---

## 2026-07-25

### Re-enable the "next-month focus" line once the report PDF can render Devanagari

The Monthly Report PDF's "…focus:" line (batch's next-month teaching schedule) is **hidden as of 2026-07-25** — flag `SHOW_NEXT_MONTH_FOCUS = false` in `src/lib/monthlyReportPdf.js`. Root cause: jsPDF's built-in `helvetica` is a Standard-14 WinAnsi (Latin-1) font with no Devanagari glyphs, so Hindi/Marathi chapter names garbled (`Hindi: ->0$ .9?.>`, `Marathi: $B ,A&M'@ …`) while Latin subjects rendered fine. `drawNextMonthFocus` + the `nextMonthFocus` builder logic (`monthlyReportBuilder.js`) are intact behind the flag — this is a display suppression only.

**Why:** it's a parent-facing report card; shipping garbled Hindi/Marathi is worse than omitting the line. The fix is real work (a Unicode font), not a one-liner, so it was deferred. Note the same helvetica-only limit affects **every** PDF generator (`examPdf.js`, `studentReportPdf.js`, `hostelLeaveReportPdf.js`, and this file's conduct/exam sections) — any Devanagari there garbles too; only the focus line was actively hit.

**How to apply:** pick one —
1. **Embed Noto Sans Devanagari TTF** (`addFileToVFS` + `addFont`, regular + bold), switch the focus/chapter text to it. ⚠ jsPDF does **no complex-script shaping** — matras/conjuncts may render mis-ordered even with the glyphs present; verify real chapter names before trusting it. +~300–600 KB bundle.
2. **html2canvas → image PDF** (html2canvas is already a dep for the timetable PNG). Browser shapes Devanagari correctly; output is rasterized (non-selectable) and heavier. Larger rewrite.
3. **Romanize/transliterate** the Devanagari chapter names for the report. Cheap, correct Latin output, loses native script — changes what the report says.
Recommendation: (2) if native script must look right, (1) is the trap (looks fixed, can ship malformed). Then flip `SHOW_NEXT_MONTH_FOCUS = true`.

### Strip the "(x%)" weightage suffix before re-enabling the next-month focus line

The NDA Program's **Physics / Chemistry / Biology** syllabus chapters were rebuilt on **2026-07-25** to PYQ Vault's taxonomy, and each chapter name now carries its PYQ weightage inline — e.g. `Light and Optics (21.6%)`, `Human Physiology (27.4%)`. Chapter names are display-only in the Syllabus tracker (the join key is `chapter.id`), so this is safe there.

**Why it matters here:** `monthlyReportBuilder.js` (~L178) copies `chapter.name` verbatim into `nextMonthFocus.chapters`, which `monthlyReportPdf.js` prints on a **parent-facing** report card. Today that line is hidden behind `SHOW_NEXT_MONTH_FOCUS = false` (see the Devanagari entry above), so nothing leaks — but whoever flips that flag will start printing `Sept focus: Physics — Light and Optics (21.6%)` to parents, which reads as internal exam-analytics noise on a student report.

**How to apply:** when re-enabling, strip the suffix at the render boundary, not in the data — a one-line `name.replace(/\s*\(\d+(\.\d+)?%\)\s*$/, '')` in `drawNextMonthFocus` (or in the builder's `chapters.push`). Don't remove the weightage from the syllabus chapter names; it's the whole point of the rebuild. Also re-check any *future* consumer that surfaces syllabus chapter names to students or parents — the weightage suffix is a faculty-facing annotation only.

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

---

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

### Paste-a-column silently drops values past the end of the roster

`applyPaste` in [src/components/upload/OfflineExamModal.jsx](src/components/upload/OfflineExamModal.jsx) walks the roster and skips any index `>= values.length`, so a paste **longer** than the roster silently discards the extras (paste 20 marks onto an 18-student roster → 2 vanish, no warning). A short paste is fine by design (it tops up without wiping typed marks), but the long case is real: it usually means the pasted list is from a different or stale roster, i.e. **every** row may be misaligned, not just the tail.

**Why:** silent truncation on a marks-entry path is the bad kind of quiet — a misaligned paste assigns the wrong marks to the wrong students and looks completely normal on screen. Faculty would have to eyeball all 18 rows to catch it. Low likelihood, high cost, cheap to fix.

**How to apply:** in `applyPaste`, compare `values.length` against `roster.length` and surface a mismatch **before** applying — either a confirm ("Pasted 20 values for 18 students — the list may not match this roster") or a non-blocking `Alert` after the fill stating how many were used and how many dropped. Keep the short-paste case silent (it's the intended top-up). `parseMarksPaste` already returns the full parsed array, so no change to the pure helper — this is a UI guard only. Add a modal test for the long-paste warning.

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

### Phase 2 + 3 of teacher-filed attendance

Deliberately out of Phase 1 scope, in rough priority order:
- ~~**Homework / notes on the same lecture cards**~~ — **DONE 2026-07-28** (`96f2832`). Two-step: name the item (chapter free-text + homework/notes) → tick defaulters via `MarkDefaultersModal`. Chapter is free text, not a syllabus-sourced picker — a syllabus picker is still worth doing and is carried forward below.
- **Outstanding-filing nudge** — still open. A WhatsApp to teachers who haven't filed by end of day. Recipients are staff, so no blocked-contact gate applies; folds into `send-attendance-alerts` as another `kind` (do **not** add an api file — 12-function ceiling). Now also wanted for unfiled *meals* — see the 2026-07-28 entry.
- ~~**Impromptu lectures**~~ — **DONE 2026-07-28** (`96f2832`). Ports the `adhoc_*` machinery; batch comes from the new `getTeacherBatches` (falls closed, day-independent), and cards rebuild from `lecture_submissions` filtered on `teacher_id` rather than the absence log.
- **Late marking** stays front-desk unless there's a reason to move it; it's a day-level concept, not a per-period one.

### Backfill ledger — `buildOfflineRoster` is now misnamed

[src/lib/offlineRoster.js](src/lib/offlineRoster.js) `buildOfflineRoster(studentProfiles, batchNames)` is a generic "current members of these batches, minus blocked/quit" helper. It was written for the offline-exam marks grid, and `SchoolAttendancePage` now reuses it (correctly — duplicating it would be worse). The name now under-describes it.

**Why:** a misleading name on a shared helper invites the next person to write a second copy rather than reuse this one, which is how the duplication rule gets violated in good faith.

**How to apply:** rename to `buildBatchRoster` in a module named for the concept, keeping `buildOfflineRoster` as a thin re-export if anything external depends on it. Touches shipped code (`OfflineExamModal` + its tests), so it needs a 360 + explicit go-ahead — logged here rather than done silently. Low urgency; bundle it with the next change in that area.

### Teacher mobile bottom nav is now nine items

Adding the teacher-only **My Lectures** entry took the teacher-mode nav from 8 items to 9. The desktop sidebar is fine; the mobile bottom bar (`Sidebar.jsx`, `visibleNav.map`) lays every item out in one flex row, so at 9 the labels get very tight on a small phone — which is exactly the device teachers will use.

**Why:** the crowding predates this change (8 was already a lot) but the attendance rollout is what puts teachers on phones daily, so it stops being cosmetic. A mis-tap on a cramped bar during a lecture changeover is the realistic failure.

**How to apply:** options, cheapest first — (a) cap the mobile bottom bar at the 4–5 most-used items per mode and move the rest into the existing drawer (the drawer already renders the full `visibleNav`); (b) make the bottom bar horizontally scrollable; (c) shorten labels in teacher mode. (a) is the conventional pattern and needs no new component. Worth checking on a real handset before deciding — it may be tolerable.

### `App.jsx` still lacks the intentional-pattern lint disable

CLAUDE.md's lint section notes that `App.jsx` and `StudentView.jsx` carry the same deliberate `react-hooks/set-state-in-effect` pattern as the files that have an inline disable comment, "add it if you touch those lines". `App.jsx` was edited this session, but not on the offending line (the auth listener at ~L42), so the disable was deliberately not added — it stays one of the 9 baseline lint errors.

**Why:** the baseline error count is the signal used to tell "my change is clean" from "my change broke something". Every un-annotated intentional error dilutes it, and the number is checked by hand each session.

**How to apply:** either add the `// eslint-disable-next-line react-hooks/set-state-in-effect` comment at the four intentional sites (`App.jsx` auth listener, `StudentView.jsx` ×4, `MissedExams.jsx`, `quizTaking.jsx`) so `npm run lint` reaches zero errors, or decide the pattern is fine and disable the rule project-wide in `eslint.config.js` with a comment saying why. Either beats a permanent non-zero baseline; the first is more honest, the second is one line.

### Memory index entries run well past the 150-character guideline

12 of the 47 pointers in `MEMORY.md` exceed 160 characters (longest 335). Left unchanged this run: the long text is doing real work — recall matches against these descriptions, so truncating them would trade index tidiness for worse retrieval.

**Why:** it is a genuine judgement call, not an oversight, and it should be made deliberately rather than by a doc-maintenance pass silently shortening them.

**How to apply:** either relax the guideline (and say so in the skill's expectations), or trim only the entries whose length comes from *restating* the memory body rather than from distinct recall hooks — `project_whatsapp_block_gate` (302) and `project_open_ended_leave` (335) are the two clearest candidates. The store is also 350 KB total with `project_completed_archive.md` alone at 115 KB; folding its pre-2026-06 rows into a summary block (the file already did this once for the pre-Vercel era) would halve it.

### ~~Meal checkpoints have no filed-vs-silent record~~ — **DONE 2026-07-28**

Shipped in `4cedaa8`. `checkpoint_confirmations` gained a `kind` discriminator (`roll` | `meal`) with the count columns made nullable and a CHECK keeping rolls strict — deliberately **not** the plain "drop NOT NULL" suggested below, which would also have let a roll be written with no reconciliation. `markCheckpointFiled` writes meal rows and refuses roll checkpoints; the `ROLL_CHECKPOINTS` guard in `confirmRoll` therefore stayed. Admin filing board added atop the Hostel tab. (Original entry retained below for the reasoning trail.)

Roll checkpoints get `checkpoint_confirmations` (headcount + `reconciled`), so "the warden did the night roll" is recorded. Meals have nothing: an unmarked breakfast and a breakfast where everyone showed up are both zero `checkpoint_absences` rows. Now that mess staff file their own meals, that ambiguity is live — the same gap `lecture_submissions` was created to close for lectures.

**Why:** it is the failure mode that hides itself. An unfiled meal reads as a clean one, so nobody is chased and the gap never surfaces. The hostel subsystem already models the concept (`checkpoint_confirmations`), it just doesn't cover meals.

**How to apply:** the table's `expected_count` / `confirmed_present` / `reconciled` are all `NOT NULL`, so extending it to meals needs either a migration making them nullable (a meal has no headcount) or a "filed" row with sentinel counts — the former is cleaner. Then add a filed/outstanding strip to the admin Hostel tab mirroring `FilingBoard`, and drop the `ROLL_CHECKPOINTS` guard in `confirmRoll` accordingly. Deferred because it needs a schema change and was outside the requested scope.

### `residential` is wrong for all 126 LWS Pune students

Every LWS Pune student is flagged `residential = true`, but LWS Pune has no boarders (confirmed 2026-07-27). Harmless today because `HOSTEL_BRANCHES = ['APJ']` bounds the hostel cohort, so the flag is never the deciding filter — 325 of 326 students are flagged residential, meaning the column carries no signal at all.

**Why:** it is a loaded gun rather than a live bug. Anyone who later relaxes the branch filter — reasonably assuming `residential` is what identifies boarders — pulls the entire LWS Pune roster into the hostel marking board and the warden alert.

**How to apply:** either set `residential = false` for the 126 LWS Pune rows (a one-line UPDATE, but it is real student data so it needs an explicit go-ahead), or drop the column from the boarder predicate entirely and let branch be the single source of scope. The second is arguably more honest given the column has never been curated. `buildBoarderRoster` and the alert endpoint's `.eq('residential', true)` would both need to agree either way.

## 2026-07-28

### Backfill ledger — converge the 9 hand-rolled modal shells onto `ModalShell`

`ModalShell` gained a `footer` slot and dialog semantics (role/aria/Escape/focus) this session, and its 5 consumers with a single action row were migrated. But **nine other modals never used `ModalShell` at all** — they each hand-roll the same `fixed inset-0` backdrop + panel + header + `overflow-y-auto flex-1` body + `flex-shrink-0` footer: `ExamAbsencePreviewModal`, `HomeworkPreviewModal`, `LateNotificationPreviewModal`, `LectureMissPreviewModal`, `ImportFeedbackModal`, `WhatsAppPreviewModal`, `WhatsAppResultsModal`, `ManageBatchBranchModal`, `AssignProgramsModal`.

**Why:** they already get the footer layout right — that's why they were hand-rolled, and it's why the bug never showed up there. But they now *lack* what `ModalShell` gained: none has `role="dialog"`, `aria-modal`, Escape-to-close, or focus restore. So the accessibility gap that was uniform across the app is now uneven, which is harder to reason about than uniformly missing.

**How to apply:** opportunistically, one at a time, only when already editing the file — not as a sweep. Each is a working, shipped surface with its own tests; a big-bang migration is churn against no reported problem, and the shells differ in padding and header content. If the a11y gap needs closing sooner than attrition allows, the cheaper move is to extract the Escape + focus effects into a `useDialogBehaviour(onClose)` hook and drop one line into each hand-rolled modal, leaving the markup alone.

### `ModalShell` has no focus trap

Focus now moves into the dialog on open and returns to the opener on close, but Tab can still walk out of the panel into the page behind the backdrop.

**Why:** it is the remaining half of the keyboard story. Getting focus in without keeping it there is better than nothing but still lets a keyboard user land on controls they cannot see, under a `backdrop-filter` blur.

**How to apply:** a small `useFocusTrap(ref)` — collect focusable descendants, wrap Tab/Shift+Tab at the ends. Roughly 25 lines, no dependency. Deliberately not done in the same change as the footer/semantics work to keep that diff reviewable; the tests for it belong alongside the existing `ModalShell.test.jsx` dialog-semantics block.

### Backfill ledger — two helpers now duplicated between admin and staff surfaces

Building the staff-parity work extracted two pure helpers that the admin surfaces still have local copies of:

- `buildOpenLeaveList` + `STALE_LEAVE_DAYS` (`src/lib/hostelLeave.js`) — `HostelTab` still computes `onLeaveList` / `staleCount` inline (~L349) with its own `STALE_LEAVE_DAYS` const.
- `deriveHomeworkType` (`src/lib/homework.js`) — `HomeworkLogTab` still has a local `deriveType` (L19).

**Why:** both are the "shared helper so they can't drift" pattern GUARDRAILS already mandates for `buildBoarderRoster`. Two implementations of the stale threshold is exactly how the admin board and the warden page end up disagreeing about who needs chasing.

**How to apply:** mechanical — import the lib version, delete the local copy, keep the existing tests. Not done in the same change because it edits shipped, working surfaces that were not part of the request; it wants its own small diff. Both are pure and covered by tests on the lib side already.

### Meal filings are recorded but not yet chased end-to-end

`markCheckpointFiled` + the Hostel tab's filing board close the "was this meal filed?" gap, but there is no equivalent of the lecture-miss chase loop: nothing alerts anyone that dinner went unfiled, and the warden alert (`kind:'hostel'`) still only reports unexplained boarders from the chain.

**Why:** a filing record nobody looks at is only half the fix. Lectures have `FilingBoard` *plus* an admin who works the outstanding list; meals now have the board but no prompt.

**How to apply:** cheapest is to fold an "unfiled checkpoints" line into the existing `send-attendance-alerts` `kind:'hostel'` payload (no new endpoint — the Vercel 12-function cap is at its ceiling). Needs a decision on timing: an alert at 09:00 for an unfiled breakfast is useful, one at 23:00 for an unfiled dinner is too late to fix anything.

### ~~Browser golden-path verify the 2026-07-28 staff-parity work~~ — **DONE 2026-07-29** (browser pass confirmed by the owner — covers the Written Quiz flow noted in the body)

Four capture flows shipped without a manual browser pass: teacher extra-class filing and homework filing on `/school-attendance`, and the leave lifecycle + meal filing on `/hostel-mess-attendance`. All are covered by tests and a serialized full suite (2073/2073), but the project's Definition of Done requires the golden path clicked through in a real browser, and these are phone-first surfaces used by staff mid-shift.

**Why:** the failure modes left are the ones tests cannot see — a mis-tap target on a phone, a modal footer that still needs scrolling on a short viewport, a copied link that pastes wrong into WhatsApp. This subsystem exists because capture wasn't happening; friction here is the whole risk.

**Also covers (added 2026-07-28, later the same day):** the **Written Quiz** flow — create one, check Save stays disabled until every student is marked or ticked absent, save, then re-open it from the "Written Quizzes today" strip and confirm the marks pre-fill. Then confirm the admin Exams page shows the *Written Quiz* badge + "by <teacher>", and that a monthly report PDF for that student renders `Name (Written Quiz)`.

**How to apply:** on a real handset — (1) `/school-attendance` → **+ Extra class** → file → reload → the card must come back from the submission row; (2) same page → **Homework** → chapter + tick → the count badge appears; (3) `/hostel-mess-attendance` → save Breakfast with nobody missing → pill gets a ✓ and admin's Hostel tab reads 1/5 filed; (4) put a boarder on leave → the open-leave panel lists them → **back?** unlocks the row. Carries forward the still-open `/school-attendance` Phase-1 verification entry from 2026-07-27.

### A syllabus-sourced chapter picker for teacher homework filing

Teacher homework filing takes the chapter as **free text**. The admin `HomeworkLogTab` does too, so this is not a regression — but hand-typed chapter names are the same class of problem as hand-typed student names, and `homework_pending` groups items by exact `(subject, chapter, type)`.

**Why:** two teachers typing "Trigonometry" and "Trig" create two items for the same work, which fragments the defaulter set and the parent messages built from it. There is no dedup or variant-linking on `homework_pending` the way there is for student names.

**How to apply:** the batch's assigned syllabus program already knows its chapters (`batchProgramAssignments` → `syllabusPrograms`), so offer a datalist/select of those with free text as the fallback for genuinely off-syllabus work. Worth doing on both surfaces at once so they can't diverge. Remember to strip the `(x%)` weightage suffix that NDA Program Physics/Chemistry/Biology chapter names carry.

### Move the WhatsApp send record server-side (the record of the "Sets" blast was lost)

The 28 Jul "Sets" results blast reached 13 students + parents — a recipient forwarded the message, and its deep-link carried `exam=exam_1785160409048`, which only `api/send-whatsapp.js` generates. `whatsappSendHistory` has no entry for it; the last recorded results send is 21 Jul. Diagnosis (full write-up in `memory/project_whatsapp_send_record_gap.md`): send histories are persisted store keys, so recording a send means a whole-blob `faculty_state` write, and `doSave` short-circuits on `if (staleLock) return` — once a tab loses the version race it silently drops **every** later save until reload. Blob writes at 10:31 and 17:25 that day both succeeded, so the guard was working; the 11:59 tab was stale. The version guard shipped 25 Jul (`33600df`) and this was the first results blast after it.

**Why:** the guard turned a data-integrity failure into a **traceability failure on a non-reversible action** — you cannot un-send a WhatsApp. The Exams page now shows "Send" rather than "Sent N✓" for Sets, so someone re-blasts all 13 families believing it never went. Worse, `lateSendHistory.notifiedLwsIds` — the pending-aware gate that stops duplicate parent messages — rides the same blob, so this is a live duplicate-message risk on every stale tab, not a one-off.

**How to apply:** have `api/send-whatsapp.js` write its own `whatsapp_send_log` row before returning — row-level writes are immune to the blob guard, it is the same dual-path pattern every normalised domain already uses, and it needs no new serverless function (the Vercel 12-function cap is at its ceiling). The client then reads that for the "Sent N✓" badge. Second, smaller half: stop `staleLock` swallowing saves silently — surface "sent, but the record could not be saved, reload before doing anything else" on the send modal's result screen. One check would confirm the diagnosis outright: did whoever ran the blast see the red "Your data is out of date · Reload" banner? Also unrecorded and possibly the same cause — "ENG &Geo - Interior & pos" (23 Jul) and "Math's : Sets" (25 Jul).

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

### `StatCard` prepends an arrow to captions that aren't deltas

`StatCard` renders `{deltaUp ? '▲' : '▼'} {delta}` whenever `delta` is truthy, so any consumer passing a *caption* rather than a change gets a meaningless arrow. Two of the three callers do exactly that: **Attempt Quality** passes `'correct ÷ attempted'` with `deltaUp={null}` → renders "▼ correct ÷ attempted", and **Consistency** passes `σ = 22%` → "▼ σ = 22%", in red. Both are visible on the student page today.

Found while fixing the Latest Score delta, which had the mirror-image bug: it passed its *own* arrow inside the string and StatCard added a second, so it rendered "▼ ▼ 0.5 from prev". That one is fixed (the string no longer carries an arrow); these two are not.

**Why:** a red downward arrow beside "σ = 22%" reads as "consistency is falling", which the number does not say — it is a standard deviation, not a trend. It is the same defect class as the offline zeros: a glyph that means something specific rendered in a context where it means nothing.

**How to apply:** make the arrow conditional on `deltaUp !== null` in `StatCard` and pass `deltaUp={null}` from the two caption callers (Attempt Quality already does; Consistency needs it). That is a change to a shared UI component with other consumers outside `StudentView` — check `Dashboard` and `Toppers` for `StatCard` usage first, and keep the `deltaUp={false}` (genuine decline) path rendering ▼ as it does now.

### Audit the remaining surfaces that print raw marks across exams

`ExamHistoryTable`, the focused result card and the Latest Score tile now all print `score / max`, because a bare mark can't be read when the column interleaves a 75-mark chapter test and a 300-mark mock. The same reasoning applies anywhere else raw `totalMarks` is shown across differently-sized papers — the Monthly Report PDF is the obvious candidate, and `examPdf` may be another. Not checked this session.

**Why:** the failure isn't cosmetic. On one real student's page the raw column ordered three rows against actual performance — the best result (39%) sat below a number four times its size (38%). Anywhere that ordering is reproduced without a denominator carries the same inversion, and a PDF goes to a parent who cannot ask what the max was.

**How to apply:** grep for consumers of `totalMarks` / `scores[].score` that render across multiple exams (`src/lib/monthlyReportBuilder.js`, `src/lib/examPdf.js`, `src/pages/Toppers/`). Both already import `examMaxMarks`, so the denominator is in reach; the question is only whether each rendering *shows* it. Where a per-exam list exists, print `score / max`; where an aggregate exists, confirm it's %-of-max and not a raw mean (GUARDRAILS already requires the latter).

### Editing a saved Written Quiz can't recover who was marked absent

An absent student is simply omitted from the exam's `students[]` — there is no stored "absent" fact. So re-opening a saved quiz cannot distinguish "was absent" from "was never entered", and the edit view starts everyone blank, making the teacher re-declare absences they already declared once.

**Why:** it is friction on the correction path, which is exactly where friction hurts most — a teacher fixing one mistyped mark has to re-tick every absentee to get past the completeness gate. Left as-is because the two obvious fixes both have real costs, and quietly picking one would have been the wrong call inside a feature that was already contested.

**How to apply:** either (a) write the absences to `exam_absences` — but that table drives the parent-facing "missed exam" WhatsApp flow, which this capture path deliberately cannot touch, so it would need a way to record an absence without arming a send; or (b) add a nullable `absent_lws_ids` (or a per-result `absent` flag) so absence is stored alongside the marks. (b) is smaller and keeps the send boundary intact. Decide before the flow gets heavy use, since the ambiguity is unrecoverable for quizzes saved in the meantime.

### Watch whether Written Quiz volume changes what the Exams page and trends are for

Every teacher logging a weekly class test could add a large number of small exams. They cannot move projected NDA score, priority chapters or Toppers (offline exams carry no question data), but they *do* land in the Exams page listing, the %-of-max trend series and the monthly-report exam table alongside full mocks.

**Why:** it is a "watch it" item, not a bug — the extra signal per student may be exactly what you want. But if a parent's monthly report starts showing eight 10-mark class tests and one 300-mark mock in the same table, the mock stops standing out, and that table is one of the most-read parent-facing surfaces.

**How to apply:** look again after a few weeks of real use. Options if it does become noisy, cheapest first — group the report's exam table by `writtenQuiz` with a subheading; add a `source` filter to the Exams page (the column exists now); or weight the trend series by `maxMarks` so a 10-mark quiz doesn't swing a line built from 300-mark mocks.

## 2026-07-29

### Written exams still can't be compared against a student's own history

The written insights panel is descriptive only — every mark, median, spread, bands, absentees. The one genuinely analytical read a totals-only paper supports is comparative: *who scored below their own running average?* Deliberately not built.

**Why:** on a max-5 class test one mark is 20 percentage points, so a percentage delta against a student's average over a 70-question mock is mostly granularity noise, not a signal. A "−20%" that is really "one mark" would send faculty chasing students who did nothing wrong — worse than showing nothing.

**How to apply:** express it as **rank movement within the batch** rather than a percentage delta (rank is robust to a coarse mark scale), or gate the percentage form on a minimum `maxMarks`. Either way it needs its own pure fn (`src/lib/analytics/examInsights.js`, next to `getExamScoreSummary`) taking the student's other exams, and a decision about which exams count as comparable — all of them, same subject, or same format.

### The per-student Reports PDF is still MCQ-only

`📄 PDF` (the class report) now works for written exams; `📋 Reports` (one page per student) does not, and is hidden for them.

**Why:** `studentReportPdf.js` is *entirely* a per-question chapter/subtopic breakdown built from `responses`. Strip that from a written exam and the page is name, marks, percentage — one line, one page per student. Printing that per student is worse than not offering it.

**How to apply:** it only becomes worth a page with the student's **history** on it (this mark against their recent exams, class average, rank) — which is the comparison work above wearing a different hat. Do that first, then reuse it here; don't build a thin written page in the meantime.

### ~~Subtopic cleanup Tiers 2 and 3 are unapplied~~ — **Tier 2 DONE 2026-07-29; Tier 3 open**

Tier 1 (mechanical: casing, `&`-vs-`and`, plural/suffix, exact synonym) shipped 2026-07-29 — 58 questions, 2,665 → 2,641 distinct `(subject, chapter, subtopic)` triples. The remaining ~70 groups from `/subtopic-analyse` were deliberately left.

**Why:** they cross concept boundaries, so each needs a judgment call rather than a string rule, and bundling them behind the safe merges would have hidden the risky ones inside a large diff.

**How to apply:** re-run `/subtopic-analyse` first — it reads Supabase live, so it will already reflect Tier 1. Then, per tier:
- ~~**Tier 2 — concept merges.**~~ **Applied 2026-07-29** — 51 renames / 69 questions / 10 exams; distinct triples 2,641 → 2,597. Three groups were **narrowed** against live data first: Clouds (the report's 6 types were really ~27 subtopics / 45 Q including distinct concepts — only the `<X> Cloud Characteristics` family merged), Question Tags (30 buckets, not 6 — half are distinct grammar rules and stayed split), Total Internal Reflection (spans 3 chapters — only the same-chapter 6 merged). Original scope was: Question Tags → `Simple Present` (7 one-Q buckets), `Classical Probability` (split by Cards/Coins/Dice), `Cloud Types & Characteristics` (6 cloud types, 12 Q — the best non-Maths consolidation), `Conservation of Angular Momentum` (split by Earth/Gymnast/Human Body), `Phrasal Verbs` (split by keyword), `Common Chemicals` (one bucket per chemical). All share one shape: **split by prop or scenario rather than by concept**, leaving ~45 Q in buckets of 1–3.
- **Tier 3 — needs a call per item.** `Polar Form` + `Exponential Form`, `First`/`Second Ionization Enthalpy`, `Velocity-Time Graph Area` + `Slope`, `Absolute Value Equations` + `Inequalities`, `Determinant Equations` + `Solving Determinant Equation` (neither name is the canonical — a new one must be chosen).
- **Not renames — do not fold into either tier.** `Geometric Progressions` (32 Q) is a catch-all that likely already contains the sum questions; it needs re-tagging at the question level. `Inverse Trigonometric Identities` in the *Differentiation* chapter is a wrong chapter tag.

Add entries to **both** `merge_subtopics.py` and `migrate_subtopics_supabase.js` (the drift test enforces this), with a test case per pair and a KEEP case per near-miss, then `node migrate_subtopics_supabase.js --dry-run` before applying.

### Prevent question-text-as-subtopic-name at the tagging stage

Several subtopics are a single question's text — `f(π/2) for f(x)=sin[π²]x+cos[−π²]x`, `Sum of inverse cosines equals 3pi`, `AP — sum condition and sum of 10 terms`. Each is permanently a 1-question bucket that can never aggregate.

**Why:** renaming them after the fact is unbounded cleanup — the Tags upload will keep minting new ones. Sequence & Series alone now carries three competing naming schemes (`Sum of AP`, `Arithmetic Progression - Sum of Terms`, `AP — sum condition…`).

**How to apply:** validate at upload in `src/lib/validateTags.js`, as a **non-blocking warning** in the Step 1 preview (same posture as `KeyMismatchPanel` — surface it, let the uploader decide; never silently rewrite). Cheap signals that catch the real cases: length over ~60 chars, contains `=` or a digit-heavy run, or matches the question text for that row. A per-chapter naming convention (`<AP|GP|HP> - <nth Term | Sum of n Terms | Mean>`) would prevent the scheme drift, but the warning is the smaller first step.

> **Carry-forward 2026-07-31 — this got easier, and more urgent.** `src/lib/ndaSubtopics.js` now ships the canonical **111 NDA Maths subtopic names**, so validation no longer needs heuristics for Maths: check the tag against `getSubtopicShares(chapter)` and offer a closest-match suggestion, exactly like the existing chapter check (heuristics still apply to subjects with no taxonomy). More urgent because the 2026-07-31 sweep took Maths from 1,014 distinct names to canonical and **every subtopic-level surface now joins by exact name** — projected-score subtopic rows, the cross-chapter ranking, and the question drill-down all silently drop an off-taxonomy tag. Without the gate, each new tag file re-earns the problem this cleanup just paid off.

### Chapter-name conformance: Maths + English tags, then the incomplete freq tables

The validation leak is closed and `Height & Distance` is fixed (2026-07-29), but **1,850 questions still sit on chapter names the weightage table doesn't carry**, so they contribute nothing to projected NDA score. This is *two* different jobs, and the per-subject numbers say which is which:

| Subject | Configured chapters | Unmatched Q | Diagnosis |
|---|---|---|---|
| ~~Maths~~ | 31 | ~~73~~ → **29** | **DONE 2026-07-29** — 44 renamed; the 29 remaining are one class-11 foundation paper, deliberately left off-table (see GUARDRAILS.md) |
| ~~English~~ | 31 | ~~106~~ → **0** | **DONE 2026-07-29** — 56 via an `and`/`&` rename, 50 via a per-question re-tag (`migrate_gat_test4_tags.js`) |
| Physics | 33 | 317 | mixed — triage needed |
| Chemistry | 6 | 681 | **freq table incomplete** |
| Geography | 7 | 506 | **freq table incomplete** |
| Biology | 3 | 87 | **freq table incomplete** |
| Polity | 3 | 20 | **freq table incomplete** |
| Others | 2 | 30 | **freq table incomplete** |
| History | 4 | 30 | mixed |

**Why the split matters:** renaming 681 Chemistry questions into the 6 chapters currently configured would be actively wrong — there the *table* is the incomplete thing, and completing it is a subject-matter judgement (which chapters exist, what each is worth), not something a script should guess.

**How to apply:**
- **Maths (73 Q)** — genuine conformance, canonical targets are looked up not guessed: `Integration` (25) → `Indefinite`/`Definite Integration` (needs per-question triage — the name doesn't say which), `Limits` (10) → `Limits & Continuity`, `Straight Line` (8) → `Lines`, `Area Under Curve` (1) → `Applications of Integration`. The CBSE-flavoured leftovers (`Polynomials`, `Real Numbers`, `Triangles`, `Coordinate Geometry`, `Pair of Linear Equations`, `Areas Related to Circles`, `Introduction to Trigonometry`, `Arithmetic Progressions`) have **no NDA equivalent** — decide whether to map them onto the nearest NDA chapter or add them to the freq table at pct 0. Do not silently fold them into a big chapter; that inflates its weightage-backed score.
- **English (106 Q)** — only 2 unmatched names; check them against the configured 31 first, they may just be casing.
- **Then the freq tables** — hand Chemistry/Geography/Biology/Polity/Others to faculty via Settings → NDA Weightage. Until those are filled, tag validation for those subjects still can't fire (the list is what switches it on), so the drift keeps accruing.
- **Announce it.** Fixing this moves projected NDA scores **upward** for GAT subjects, because currently-invisible questions start counting. Parents see those numbers in monthly reports — it should land as a stated correction, not a silent shift.

Use `node migrate_subtopics_supabase.js --chapters-only --dry-run` to preview; `--subtopics-only` is the mirror.

### Two content bugs found while re-tagging NDA GAT : Test 4 (2026-07-29)

Neither is a tagging problem, so neither was fixed by the re-tag.

**Q48's question text is truncated.** It reads *"FILL IN THE BLANKS: John yesterday, and it was a pleasant surprise."* — the blank and its verb are missing. From the options (`by / off / beside / into`, key `into`) it was almost certainly *"I ran ____ John yesterday."* A student opening this question in the portal cannot answer it, and it has already been sat.

**Why:** this is stored question text, not a tag, so no rename touches it. It needs an edit to `exams.questions[47].question` for `exam_1781529960467` — or a Tags re-upload carrying the correct text.

**How to apply:** worth a sweep for siblings before fixing one — questions whose text is suspiciously short relative to their options, or that begin mid-sentence. If the pattern is common it belongs in `validateTags.js` as a non-blocking upload warning, next to the chapter check.

### `Idioms & Phrases` subtopics are the worst bucket-scatter in the dataset

299 questions across **60+ subtopics, most holding exactly two** — `Complacency`, `Elusiveness`, `Peace & Reconciliation`, `Burdensome Possession` — plus **four competing generic labels**: `Idiom Meaning` (63), `Common English Idioms` (25), `Meaning of Idioms` (5), `Idiomatic Expressions` (5).

**Why:** it is the same split-by-theme-not-concept pattern Tier 2 fixed elsewhere, but an order of magnitude larger, and it is actively growing — each new idioms paper mints another dozen two-question themes. No aggregate over these buckets means anything.

**How to apply:** two separable decisions. (1) The four generic labels are unambiguously one thing — collapse into `Idiom Meaning` (98 Q) as a Tier-1-style mechanical merge. (2) The ~55 semantic micro-buckets are a policy call: either fold them all into `Idiom Meaning` too (accepting that idiom questions are only ever tracked at chapter level, which is what the NDA paper actually tests), or keep them and accept they will never aggregate. Recommend (1) now and a decision on (2) before the next idioms upload. Note the 2026-07-29 re-tag deliberately used `Idiom Meaning` for its 10 rather than adding themes.

## 2026-07-31

### Maths subtopic tagging now conforms to the PYQ Vault taxonomy — 3 follow-ups remain

**Shipped today.** 80 Maths subtopic renames + 28 retargets applied to `data/faculty-data.json` and Supabase (645 questions across 36 exams). Conformance to the canonical 111-subtopic PYQ Vault taxonomy (`Question_Bank/src/app/guide/nda-maths/_data/nda-maths.ts`): **all Maths 47.5% → 66.0%**, **LWS 25-27 since 13 Jun 80.9% → 91.5%**, canonical subtopics covered 89 → 94 of 111. Two entries that renamed a canonical name *away* were dropped — the same wrong-direction bug as the `Height & Distance` chapter entry (2026-07-29).

**1. Re-tag three exams — DONE, same day.** 117 questions across `Math's Mock test : 4` (45), `Math's: mock test 6` (40), `LWS MATHS MOCK 2 (A)` (32) were re-tagged question-by-question against the canonical subtopic list *for each question's own chapter*, so nothing could land on a subtopic its chapter does not own. **LWS 25-27 since 13 Jun is now 99.7% (1,426 / 1,431); all Maths 69.4%; 95 of 111 canonical subtopics covered.** The only 5 questions left are the flagged ones below — they were deliberately not forced onto a wrong target.

**2. Four names need a chapter-scoped rename the map cannot express.** `Arithmetic Mean` (Sequence & Series | Statistics), `Mean and Variance` (Binomial Distribution | Statistics), `Product Rule` and `Quotient Rule` (Differentiation | Logarithms — the derivative rule vs `log(ab)=log a+log b`). One key, two chapters, two meanings; either global target misfiles the other chapter. Same gap as the `Vocabulary - Nouns` entries. Pinned by `test_tier3_chapter_ambiguous_names_stay_unmapped`. Fixing needs `apply_renames` to key on `(chapter, subtopic)` — worth doing only if the list grows.

**3. `validateTags` never inspects `subtopic` — this WILL decay without a gate.** `src/lib/validateTags.js` validates chapters only; `src/lib/excel.js` defaults `subtopic` to `'General'` and nothing downstream constrains it. That is why 1,014 distinct names existed for 111 real subtopics. Add subtopic validation at upload (same closest-match warning pattern as chapters, plus a dropdown in `Step3Tags`) — otherwise every new tag file re-earns this problem.
  - **PARTIAL 2026-08-09 (commit `3b8255b`).** `Step3Tags` now offers chapter-scoped subtopic **suggestions** via `<input list>`+`<datalist>`, sourced from `src/lib/gatTaxonomy.js`. Two deliberate limits remain: (a) it is **suggestions, not validation** — `validateTags` still never inspects `subtopic`, and that is now an intentional stance, because a locked control is exactly what destroyed 193 correct tags (see the 2026-08-09 entry); the gate should be a **warning panel**, never a blocker. (b) **GAT only** — `getTaxonomySubtopics` has no Maths branch, so Maths tagging still gets no suggestions. Carried forward below.

**4. `Math's: mock test 6` — chapter fix DONE, 2 questions remain.**
- **Q91, Q93, Q95 — mis-chaptered, now corrected.** All three were definite-integral evaluations filed under `Applications of Integration`, whose only two canonical subtopics are area-based. Moved to `Definite Integration`: Q91 (`∫₀⁵x²[x]dx`) → *Integration of Absolute Value, Piecewise, and Greatest Integer Functions*; Q93 (`∫₀¹√((1-x)/(1+x))dx`, rationalises to `sin⁻¹x + √(1-x²)`) → *Fundamental Theorem, Periodic Integrals, and Leibniz Rule*; Q95 (symmetric-interval rational) → *Properties of Definite Integrals — Symmetry, King's, Odd/Even*. The 6 genuine area questions stayed put. Both chapters carry NDA weightage (`Applications of Integration` 1.2%, `Definite Integration` 3.1%), so this **moved 3 questions' accuracy from one scoring chapter to another** — intended, but note it when reading either chapter's trend across this exam.
- **Q63, Q64 — related rates, STILL OPEN** (ladder sliding down a wall; rod moving on perpendicular axes). `Application of Derivatives` has exactly three canonical subtopics: Monotonicity/Extrema/Critical Points, Optimisation, Tangents and Slopes. **Related rates is not among them.** Either NDA does not test it (and our mocks over-cover) or the PYQ Vault taxonomy has a hole. Resolve on the PYQ Vault side — these are the last 2 off-taxonomy questions in the LWS 25-27 window (now **99.86%**, 1,429 / 1,431).

**Not easy — flagged, not attempted.** (a) Merged super-labels spanning several canonical subtopics, e.g. `Inverse Trigonometric Functions — Identities, Equations, Principal Values, and Sums` (13 Q) covers three at once. *Resolved for mock test 6 by per-question split; the label still exists elsewhere.* (b) **Real taxonomy gaps with no canonical home at all**: `Arc Length` (11), `Degree to Radian Conversion` (10), `Rate of Change` + `Rate of Change of Quantities` (15), `Clock Angle Problems` (6). Either NDA does not test these and our papers over-cover, or PYQ Vault's taxonomy has a hole — worth resolving on the PYQ Vault side. (c) ~679 free-text singletons (`BODMAS – Distance-Speed-Time`, `Square of rotation at π`) — one name per question, nothing to rename to; almost all pre-May, so irrelevant to LWS 25-27.

**Why this mattered.** Subtopic weightage joins to a student's questions by exact name, so an off-taxonomy tag is invisible to any subtopic-level analysis — the same way an off-table chapter name scores 0 in `computeProjectedScore`. This sweep is the prerequisite for taking the ProjectedScoreCard breakdown one level deeper than chapters.

## 2026-08-01

*Surfaced during the 2026-07-31 subtopic-analysis session; filed after midnight.*

### `/api/student-login` has no dev shim — the student portal cannot be verified locally

`vite.config.js` shims every `api/*` endpoint except this one, and `src/config.js` treats `localhost`, `127.*`, `192.168.*`, `10.*` and `172.*` all as dev — so a local server renders the **admin** portal with no login screen at all, and the one hostname trick that flips it (`lvh.me`) is rejected by Vite's `allowedHosts`. The only way to exercise a student login is a Vercel deployment.

**Why:** the student portal is the most externally-visible surface in the app (students and parents), and it is the one nobody can smoke-test before shipping. Verifying the 2026-07-31 student card needed a branch push, a preview build, and an SSO share token — several minutes per iteration, and easy to skip under time pressure. Every student-portal change since has been effectively test-only until deployed.

**How to apply:** add `server.middlewares.use('/api/student-login', makeApiShim('./api/student-login.js'))` alongside the others. It needs `SUPABASE_SERVICE_ROLE_KEY` from `.env.local` (already how the other shims work). Separately, decide whether `IS_READ_ONLY` should honour an explicit override (e.g. `?portal=student` or a `VITE_FORCE_READ_ONLY` env) so the student/teacher portals are reachable in dev at all — today the LAN-IP allowances make that impossible by construction. Note the standing caveat: editing `vite.config.js` breaks all shim dynamic imports until a clean restart. Procedure for the deployment route meanwhile: memory `reference_browser_verify_portals`.

### Decide whether the chapter projection should stop extrapolating over untested subtopics

`computeProjectedScore` applies one pooled chapter accuracy across the chapter's **entire** marks allocation, including subtopics the student has never seen a question from. The subtopic breakdown added 2026-07-31 does not extrapolate — it scores untested at 0 — so the two disagree by **~11 marks (19%)** for a typical student (57 vs 46.6 on the sample checked).

**Why:** both numbers are on the same card. The chapter total is the one faculty quote to students, and it is systematically optimistic in exactly the situation that matters most — a student with thin coverage. With ~60% of subtopics untested for a median student, the headline is substantially an assumption rather than a measurement. Nobody has decided which behaviour is wanted; today it is an accident of the two views being written years apart.

**How to apply:** three options, in increasing order of disruption. (1) Leave it and document — done; CLAUDE.md now states the non-reconciliation and warns against "fixing" it by summing. (2) Surface coverage alongside the score: a "based on N of M subtopics tested" line makes the assumption visible without changing the number. (3) Change the basis so the chapter scores only its tested subtopics' share and reports the rest as untested marks — most honest, but it **moves every projected score downward**, so it needs a deliberate call and a heads-up to faculty before students see a different number. Recommend (2).

### `Direction Cosines and Ratios` is filed under a different chapter than PYQ Vault puts it

PYQ Vault's taxonomy places this subtopic in **3D Geometry**; several tracker questions carry it under **Vectors**. The projected card therefore shows it as a 3D Geometry blind spot while the student has in fact answered questions with that exact name.

**Why:** it is small (a handful of questions) but it is the failure mode the whole 2026-07-31 conformance sweep exists to prevent — a *chapter*-level disagreement that the subtopic-name join cannot detect, because the name matches perfectly. It will read as "never tested" forever, and any similar case is equally invisible.

**How to apply:** run a check for `(chapter, subtopic)` pairs where the subtopic is canonical but sits under a different chapter than `NDA_SUBTOPIC_SHARES` assigns it — a single query over `exams.questions`, and a natural addition to `/subtopic-analyse`. Then decide per case whether the tracker's chapter or PYQ Vault's is right (here PYQ Vault looks correct; direction cosines are 3D geometry) and fix via `CHAPTER_SUBTOPIC_RENAMES`. Worth adding the same check as a validation warning at upload alongside the subtopic gate above.

## 2026-08-09

*Surfaced while repairing GAT tagging on three mocks (commits `45da592`, `3b8255b`, `adbf8b0`).*

### Browser golden-path verify the Step 3 tag pickers

The chapter control changed from `<select>` to `<input list>` + `<datalist>`, and subtopic gained a chapter-scoped datalist. Nine component tests cover the regression (an off-list value renders its value, untouched file chapters pass through `onChange` unmodified), but nobody has driven the real screen.

**Why:** the defect being fixed was *invisible in tests and visible only on screen* — a `<select>` bound to an unknown value fails silently in exactly the way jsdom will not complain about. Re-verifying in a browser is the one check that would have caught the original bug, so skipping it here is the specific irony worth avoiding. Datalist rendering also differs across browsers more than most controls.

**How to apply:** upload `Question_Bank/generated-papers/Tags_NDA_GAT_Mock_W2.xlsx` against any results file on a Vercel preview, stop at Step 3, and confirm: the header reads **all tagged ✓** (not "95 need tagging"); every chapter cell shows its real value; clicking a chapter cell suggests that subject's taxonomy chapters; the subtopic cell suggests only that chapter's subtopics; typing a brand-new subtopic is accepted. Do **not** confirm the upload — W02 already exists and is correct.

### Decide what to do with the pre-taxonomy GAT papers

Everything from `NDA GAT : Test 4` (2026-06-13) backwards uses a subtopic vocabulary that predates the PYQ Vault taxonomy: 115–156 unknown subtopics per paper, and the four papers before May 2026 have **zero** overlap with it. The 2026-08-09 repair deliberately touched only W02 / G1 / W09.

**Why:** these are invisible to every subtopic-level surface, the same way the Maths tags were before the 2026-07-31 sweep. Unlike that sweep there is no rename map — the names are free-text singletons, so this is a re-tagging job, not a mapping one. It is also lower value: they are older papers and mostly other cohorts. Worth an explicit "not doing this" as much as a plan.

**How to apply:** first measure — for each pre-June GAT exam, the share of questions whose subtopic is in `NDA_GAT_TAXONOMY` and whose chapter matches. Then pick a cut-off by *cohort relevance*, not completeness: only papers a currently-active batch actually sat are worth re-tagging. For those, re-tag question-by-question against each question's own chapter (the method used for the three Maths mocks on 2026-07-31), since a global rename map cannot express one name meaning two things. For the rest, record the decision to leave them and move on.

### Give Maths subtopic suggestions the same treatment as GAT

`Step3Tags` reads suggestions from `getTaxonomySubtopics`, which is backed by `NDA_GAT_TAXONOMY` — and Maths is deliberately absent from it (`ndaSubtopics.js` owns that level). So a Maths tags upload gets chapter suggestions but **no subtopic suggestions at all**, which is the surface that generated 1,014 names against 111 real ones.

**Why:** the fix that just landed protects GAT from re-earning the problem and leaves Maths exactly as exposed as it was. The asymmetry is an accident of where the taxonomies live, not a decision — and Maths is the subject with the mature 111-subtopic taxonomy, so it is the easier half.

**How to apply:** add a Maths branch to `getTaxonomySubtopics` reading `NDA_SUBTOPIC_SHARES` (keys are chapter names, values carry the subtopic names) — roughly a five-line change plus a test, no new data. Keep `NDA_GAT_TAXONOMY` free of Maths so the two masters stay separate; branch in the accessor, not in the constant. Then re-check suggestion #3 from 2026-07-31, which this would largely close.

---

## 2026-08-11

*Surfaced while reviewing the risk of password-less student login. The login itself turned out not to be the problem — two hand-created tables were readable with the browser-bundle anon key, bypassing the mobile gate entirely. Both are now locked; full write-up in [`SECURITY.md`](./SECURITY.md) → "Hand-created tables default to RLS OFF".*

### ⏰ Review deleting `faculty_state_backup_selfstudy_20260730` — **due ~2026-09-11**

The table is locked (RLS on, service-role only), so there is no longer any urgency. What is deferred is whether to **delete** it. Deliberately not deleted on 2026-08-11: it is the only snapshot of 30 July state, and locking achieved the entire security benefit with zero data loss and full reversibility.

**Why revisit at all:** a dead 341 KB copy of student PII is a standing liability with no consumer — nothing in the codebase references it (verified by full-tree grep). Once enough time has passed that a 30-July rollback is worthless, it should go.

**How to apply:**
- First resolve the two unexplained diffs vs live, or accept them: `studentProfiles` is **6 bytes smaller** live than in the backup (both hold 493 students, so no student was lost — some field shortened), and `timetableMappings` **differs at identical length** (something swapped rather than added). Neither looks like damage; neither has been examined.
- Then: download a copy locally (`select data from …` → a JSON file kept off-repo), confirm nothing references it, and `DROP TABLE`.
- If in doubt, leaving it locked indefinitely is a perfectly acceptable outcome — the security issue is already closed.

### Migrate 4 RLS policies off `user_metadata` onto `app_metadata`

`teacher_feedback.superadmin_all` and `faculty_state.faculty_write_{insert,update,delete}` all gate on `auth.jwt() -> 'user_metadata' ->> 'role'`. **`user_metadata` is self-editable** — any signed-in teacher can call `supabase.auth.updateUser({ data: { role: 'superadmin' } })` and thereby read HR-sensitive teacher feedback *and* regain `faculty_state` write access. Supabase's linter flags all four as ERROR.

**Why:** these are the only two places in the project documented as *real DB-level boundaries* rather than UI conventions (CLAUDE.md calls the teacher-write denial "the boundary"; SECURITY.md called `teacher_feedback` "a real RLS boundary, not just a UI gate"). Both claims are false as written — now corrected in SECURITY.md, but the code is unchanged. It needs an authenticated account, so it is not publicly reachable; the exposure is teacher → superadmin escalation.

**How to apply:**
- Move the role claim to `app_metadata`, which only the Admin API (service-role) can write. Update the four policies to read `auth.jwt() -> 'app_metadata' ->> 'role'`.
- Backfill existing accounts' `app_metadata.role` before switching the policies, or every teacher/superadmin check fails closed at once.
- Audit the writers: `create_teacher_account.js` and `api/teacher-account.js` set `user_metadata.role` today, as does the hand-rolled superadmin SQL noted in SECURITY.md.
- ⚠️ `App.jsx` routing and `isSuperadmin` also read `user_metadata.role`. Those are *visibility* gates, so they can keep reading it or move too — but decide deliberately, and remember `initStore` sets `isSuperadmin: true` unconditionally on localhost.

### Rate-limit `/api/student-login` (and the two other mobile-identified endpoints)

There is **no rate limiting anywhere** in `api/` — grep confirms the only 429 handling is Google Calendar's *outbound* backoff. Responses cleanly distinguish a hit (200 + the student's name) from a miss (404), so a known-prefix scan of the last four digits (~10,000 requests, no throttle) harvests the roster. `student-quizzes.js` and `quiz-submit.js` share the same mobile-only trust model.

**Why:** blind brute force is genuinely infeasible (4×10⁹ space vs ~750 valid numbers), so this was low-priority in theory. It is not low-priority in practice: a copy of the 493-number list may already have been taken while the backup table was open, which turns the login endpoint into a bulk-extraction API. Throttling is what makes "you must know a mobile number" an *enforced* property rather than a description.

**How to apply:**
- Shared `api/_rateLimit.js` — **underscore-prefixed helpers are not counted against the 12-function Hobby cap**, so this adds no deployable function.
- Per-IP sliding window off `x-forwarded-for` (e.g. 5 distinct failed mobiles / 10 min → 429 + backoff) plus a per-mobile ceiling. Back it with a small Supabase table: no new dependency, and each handler already opens a service-role client. **An in-memory `Map` is not an option** — Vercel runs many instances.
- If a CAPTCHA is ever wanted, trigger it *only* after the throttle trips, so real students never see one.

### Trim the student-login payload to what the portal renders

`api/student-login.js` returns `parentMobiles`, `dob`, `gender`, `nameVariants`, and every `integrity_incidents` row including **`counterpart_name`** — which discloses *another student's* name through a mobile-only gate. Confirmed rendered: [`IntegrityIncidents.jsx:77`](src/pages/Students/IntegrityIncidents.jsx#L77) inside the shared `StudentView`, and DOB/gender/parent numbers in `studentViewComponents.jsx`'s profile header (not mode-gated).

**Why:** this is the highest-leverage *non-auth* mitigation — it shrinks the blast radius of every threat at once, including the one throttling cannot touch (a classmate who already has your number from the batch WhatsApp group). Zero friction, no schema change.

**How to apply:** gate per audience in the response, following the existing `ProjectedScoreCard` `showScore` precedent (keyed on `mode`, **not** `isSuperadmin` — `initStore` sets that true on localhost). Drop `parentMobiles`/`dob`/`gender` from the student branch and redact `counterpart_name` to a neutral label. Faculty keep everything.

### Add the Supabase security linter to the deploy routine

The 2026-08-11 leak existed because a table created by hand via SQL starts with **RLS off**, silently opting out of the protection every other table has. One `get_advisors` call (or the dashboard linter) catches it as `rls_disabled_in_public`. It also caught the `user_metadata` escalation above, which no amount of code review had surfaced in months.

**Why:** this is the durable control the incident actually calls for. Memory recall and good intentions are not mechanisms; a check that runs is. Note it needs **no** new npm dependency and no CI infrastructure to start.

**How to apply:** simplest useful version — add a line to [`OPERATIONS.md`](./OPERATIONS.md)'s pre-deploy checklist and to the "before adding a collaborator" list in SECURITY.md: *after any hand-written DDL, run the Supabase advisors and confirm zero `rls_disabled_in_public`.* Stronger version: a small script that hits the advisors API and exits non-zero on any ERROR-level lint, run alongside `npm run lint`. Two current INFO-level `rls_enabled_no_policy` notices (`teacher_calendar_blocks`, the backup table) are **intentional** service-role-only tables — any gate should allow-list them rather than treat them as failures.

---

## 2026-08-19

### Sunday routine has no home in the timetable model

`TT_Prototype_1.xlsx` specifies a full Sunday routine (trekking 07:30–09:00, clubs 10:00–13:00, self time 14:00–20:00) for the four APJ boarding batches. The Mon–Sat restructure shipped; **Sunday was deliberately left out** and is being captured as free text in each timetable's `footnotes` instead.

**Why it wasn't just "add a 7th column":** the blocker is the **slot-time invariant** — a lecture's clock time is owned by the *slot row* and shared across every day; there is no per-(slot, day) override. Sunday runs on almost entirely different clock times, so representing it needs ~8 extra slot rows that are **blank on all six weekdays and overlap existing teaching times** (Sunday's 14:00–20:00 Self Time alone spans five weekday rows). The grid would go to ~25 rows sorted by start time with weekday and Sunday rows interleaved.

Adding `'Sunday'` to `DAYS` is the small part. The real cost is one of:
- **per-(slot, day) time overrides** — a data-model change the codebase explicitly rules out, and which `getTodaysLectures` / `getTeacherDayHours` / `getWeekDates` all assume away (`getWeekDates` also encodes "a Sunday anchor groups with the *preceding* Mon–Sat week", which a Mon–Sun week would invert); or
- **a separate read-only "Sunday routine" concept**, stored outside `grid` and rendered as its own card.

**Worth noting:** the prototype's Sunday contains **no teaching at all** — every cell is a break. So it has zero effect on attendance filing, the `FilingBoard`, teacher hours, or calendar sync. It is purely a display artifact, which is why footnotes are an honest interim answer and why the second option above (a static card) is almost certainly the right shape if it's ever built.

**How to apply:** if it's wanted, prefer the separate-card route. Do **not** widen `DAYS` without first deciding what owns a Sunday slot's clock time.
