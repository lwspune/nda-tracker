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

### Verify the hostel golden path in the browser + finish the warden-alert rollout

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

### Browser golden-path verify the leave lifecycle + present/absent lecture marking

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
