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

### Decide Jaccard threshold for `findExamNameCandidates` (or document the status quo)

The dedup scan's `DEDUP_NAME_THRESHOLD = 0.75` misses single-letter swaps where the differing letters appear twice in the bigram window (`V`/`W` in "Neel Vardhamane" vs "Neel Wardhamane" scores 0.73). Four manual variant-link SQLs in the 2026-05-24 session (Neel, Sharwari, Rajivkumar, Sumit) are a leading indicator.

**Why:** without a decision, future V/W or l/i swaps will keep falling through the scan and require manual SQL; that pattern isn't going to change shape on its own. A short doc capturing the trade-off prevents the analysis from being re-derived from scratch next time someone asks.

**How to apply:**
- Pick one of:
  1. **Status quo + document** — keep 0.75, write `memory/project_dedup_threshold_decision.md` explaining the trade-off (Patel/Patil + Rohit/Mohit false positives if lowered) and that occasional manual SQL is acceptable.
  2. **Lower to 0.70** — simplest fix; catches all four 2026-05-24 cases. Expect ~1-3 more "Skip" clicks per scan from common-Indian-surname pairs.
  3. **Shape A — add a token-level edit-distance signal** — narrowest fix: if N-1 tokens match exactly and the remaining token has Levenshtein ≤ 2 (or for the 1-token case, exact match against any longer token), flag as candidate. Doesn't lower Jaccard. ~30 LOC + tests. Surfaced earlier session; not yet shipped.
- Either way, capture the decision in `memory/project_dedup_threshold_decision.md` (or a one-line note in CLAUDE.md if you pick #1).
