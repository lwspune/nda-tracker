# Suggestions

A running list of actionable improvements surfaced during `/update-docs` runs and other sessions. Each item is **outside the scope of the work that surfaced it** — i.e. the suggesting session deliberately didn't implement it. Strike through when done; delete after archiving the context elsewhere.

---

## 2026-05-21

### Soft-archive pre-Vercel-migration decisions out of CLAUDE.md

Move pre-Phase-0 decisions (anything from 2026-04 — multi-subject support, store modularisation, the early teacher AES-GCM portal) from `CLAUDE.md`'s "Decisions log" and "What not to change" sections into `memory/project_completed_archive.md` (or a new `DECISIONS_ARCHIVE.md` at the root if you'd rather keep them outside auto-memory).

**Why:** the decisions log is ~155 rows and what-not-to-change is ~85 bullets. Both load on every `CLAUDE.md` read. Anything pre-Vercel is historical context, not active guidance — moving it cheaply trims the file by 20–30 rows without losing the "why" trail (it just lives one click away).

**How to apply:**
- Skim the decisions log; mark rows whose date is before 2026-05-06 (Phase 0 cutover).
- Move them as a block to `project_completed_archive.md` under a new "Archived decisions (pre-Vercel)" heading.
- Same pass for "What not to change" bullets whose underlying file/feature has been replaced or deprecated.
- Verify by re-reading CLAUDE.md end-to-end — every remaining row should describe behaviour that is still load-bearing.

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
