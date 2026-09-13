# Onboarding a second institute — the working ledger

Live working file for making the tracker deployable to an institute other than
LWS Pune. One entry per issue; each is worked and closed on its own. Closed
entries get struck with a one-line note saying what shipped and stay in place
until the whole job is done (unlike `SUGGESTIONS.md`, this file is short-lived).

## The decisions already made — don't re-litigate these

| Question | Answer | Where it was decided |
|---|---|---|
| Shared database, or one deployment per institute? | **One deployment each.** One codebase, N Vercel + N Supabase projects, **never a fork** | 2026-09-11, memory `project_multi_tenancy.md` + [`CROSS_APP_SYNC.md`](./CROSS_APP_SYNC.md) |
| First institute | **Modulus Classes**, inbound via the bank | 2026-09-13 |
| Commercial basis | **Paying customer** — so the config layer gets built properly and is reused for institute #3+ | 2026-09-13 |
| Do they get LWS's NDA analysis (weightage, subtopic shares, GAT taxonomy, syllabus spine)? | **Yes, full parity** | 2026-09-13 |
| Parent-facing WhatsApp? | **Yes** — so their own Wabridge account + 6 Meta-approved templates are on the critical path | 2026-09-13 |

**The discipline that makes this cheap:** every per-institute difference is an env
var or a flag, never a code branch. The moment one institute's copy is edited,
"every fix = N deploys" becomes N divergent codebases, which is the real cost.

## Two facts about Modulus that drive everything below

They use **neither Evalbee nor EIS** (confirmed 2026-09-13). The tracker's exam
pipeline is shaped around Evalbee's export, and its roster/attendance importers
around EIS's. Those are issues **#3, #4 and #5** and they are the bulk of the work.

---

## Ledger

| # | Issue | Size | Blocks go-live? | Status |
|---|---|---|---|---|
| 1 | Schema not reproducible | — | was: yes | **CLOSED 2026-09-13** |
| 2 | Institute identity hardcoded in ~15 places | 1–2 d | yes | open |
| 3 | **Results ingestion — no Evalbee** | see entry | **yes** | open · *first* |
| 4 | Roster import is keyed on EIS numbers | 3–5 d | yes | open |
| 5 | Attendance import expects the EIS export | 1–2 d | no | open |
| 6 | Per-institute WhatsApp (Wabridge + 6 Meta templates) | days–weeks *calendar* | yes | open · start now |
| 7 | Branch hardcodes (`APJ`, `HOSTEL_BRANCHES`) | 0.5 d | only if boarders | open |
| 8 | Vault sync target for their tracker | 0.5 d | no | open · other repo |
| 9 | `evalbee_roll_nos` is vendor-named | 0.5 d | no | open |
| 10 | No onboarding runbook | 0.5 d | no | open |

---

### 1. ~~Schema was not reproducible~~ — CLOSED 2026-09-13

All 30 migrations exported from the live project into `supabase/migrations/`,
verified byte-for-byte by md5, and diffed against the live schema: 28 tables, 33
policies, 247 columns. The diff found **3 real gaps** — `quizzes.exam`,
`.chapter`, `.theme` existed in production with no migration, yet are written on
every quiz save, so a rebuilt project would have rejected every quiz write.
Repaired by `20260913000000_quizzes_add_classification_columns.sql`. A new
project now stands up with `supabase db push`. See
[`supabase/migrations/README.md`](./supabase/migrations/README.md).

**Left open:** the repair migration is not registered in the live project's
migration history, so the two disagree by one row.

---

### 2. Institute identity is hardcoded

`APP_SUB = 'LWS PUNE'` in [`src/config.js`](./src/config.js) looks like config;
the other ~15 are string literals — the student header
([`App.jsx:368`](./src/App.jsx#L368)), five login/error strings
(`LoginPage.jsx`, `StudentLogin.jsx`), the PDF and Word report headers and
footers (`examPdf.js`, `examReportDocx.js`, `monthlyReportPdf.js`,
`monthlyReportDocx.js`), `QuizLinkPage.jsx`, and the two API 404 messages
(`api/student-login.js`, `api/quiz-submit.js`).

Plus **`nextLwsId`** ([`src/lib/merge/lwsHelpers.js`](./src/lib/merge/lwsHelpers.js))
mints `LWS-001`, `LWS-002`… — Modulus students would carry IDs labelled *LWS*,
visible in the Students page, every export and the student portal.

Needs a `VITE_`-prefixed pair for the client bundle **and** plain vars for the
serverless functions. The `lws_id` **column** stays as-is — internal, and
renaming it would ripple through 20+ tables, every slice and every endpoint for
no user-visible gain.

Placeholder text (`placeholder="e.g. LWS Pune"`) is cosmetic — lowest priority.

---

### 3. Results ingestion — no Evalbee · **FIRST**

**The seam is better than expected.** All Evalbee-specific parsing is in ONE
function, `parseExcelFull` ([`src/lib/excel.js`](./src/lib/excel.js)), with three
call sites ([`Step1Upload.jsx:134`](./src/components/upload/Step1Upload.jsx#L134),
[`ReuploadResultsModal.jsx:96`](./src/components/upload/ReuploadResultsModal.jsx#L96),
[`useImportFlow.js:116`](./src/components/students/import/useImportFlow.js#L116)).
It emits a normalised contract that the ~26 downstream consumers read:

```
students[] = { name, rollNo, totalMarks, correct, incorrect, notAttempted,
               responses{qn: 1|-1|0}, choices{qn: 'A'|null} }
```

So any new source — another vendor, or our own scanner — is a new producer
writing to that contract, not a rewrite.

**Three things that do NOT come free:**

1. **The grading invariant.** `responses[qn] = blank ? 0 : (mk > 0 ? 1 : -1)`
   reads the *machine's per-question mark*. A source that yields only the chosen
   letter plus a key means the tracker must **grade**, which it does nowhere
   today (the re-grade action was explicitly deferred and never built). Not a
   parser change — a new authority model.
2. **`assessMarking`** ([`src/lib/markingCheck.js`](./src/lib/markingCheck.js))
   blocks Save, calibrated on 210 Evalbee exports where `Σ(Q N Marks) == Total
   Marks` held for every student. With no per-question marks it cannot run, and
   it is the guard stopping a mis-read scheme from silently shifting every
   percentage. Needs a replacement, not deletion.
3. **`evalbee_roll_nos`** — see #9.

**DECIDED 2026-09-13: build our own OMR**, rather than have Modulus buy Evalbee —
"why sell someone else's product when we can sell ours". Modulus is **willing to
wait**, so this is a strategic build on its own timeline, not a rushed onboarding
fix. Evalbee keeps working alongside it (optionality), which costs nothing
structurally: a scanner is a second producer of the contract above.

Shape: generic photocopiable sheet · student bubbles their own ID · phone capture
· up to 150 questions. Design, risks and the go/no-go gate: **[`OMR.md`](./OMR.md)**.

**Fallback if we don't:** marks-only exams already work (`questions: []` +
`maxMarks`, the `written` format), but that loses chapter stats, projected NDA
score, priority chapters, wrong/skipped audits, practice sets, item stats and
integrity detection — i.e. most of the product.

---

### 4. Roster import is keyed on EIS numbers

[`mergeLogic.js:193`](./src/lib/merge/mergeLogic.js#L193):

```js
if (!eisKey) continue   // no usable identifier → skip
```

A row with no EIS number that matches nothing existing is **skipped, not
inserted**. With no EIS at Modulus the importer would run, report success and
insert **zero students**. Separately, EIS-exact is tier 1 of the three-tier
match; without it everything falls to mobile then name+branch, which is where
the conservative-merge design deliberately surfaces conflicts rather than
guessing.

Needs a decision on their stable student identifier, then rework of the insert
rule and the match tiers — not a new spreadsheet reader. `parseStudentsExcel`
also assumes the EIS layout (row 0 title, row 1 headers).

---

### 5. Attendance import expects the EIS export

`parseAttendanceExcel` wants `Student Name` / `Mobile No.` / `DD-MM-YYYY`
columns of `P`/`A`/`-`. A new parser to the same output shape, matched on mobile
then name. The easy one — but note `student_attendance` keeps exactly one
writer, and `L` (late) rows must survive an import (existing L for imported
`(lws_id, date)` pairs is filtered out of the upsert).

---

### 6. Per-institute WhatsApp — start now, it is calendar-bound

Their own Wabridge account (`APP_KEY` / `AUTH_KEY` / `DEVICE_ID`) plus **six
Meta-approved templates** (results, late, lecture-miss, exam-absence, homework,
mentor-nudge). Approval takes days to weeks and is outside our control, so it
should be in flight while everything else is built. Every send endpoint fails
closed until its template ID is set, so nothing breaks meanwhile.

Template variable rules (positional `{{N}}`, ASCII-only, no newlines) are in
memory `reference_whatsapp_templates` + `feedback_whatsapp_template_param_rules`.

---

### 7. Branch hardcodes

`HOSTEL_BRANCHES = ['APJ']` ([`src/lib/hostelRoster.js`](./src/lib/hostelRoster.js)),
`branch = 'APJ'` defaults in `checkpointSlice.js`, and `.eq('branch','APJ')` in
`api/send-attendance-alerts.js`. Only matters if Modulus has boarders. If they
don't, the hostel subsystem simply stays dark — no work needed to go live.

---

### 8. Vault sync target

A `tracker_sync_targets` row (`org_id`, `tracker_url`, `shared_secret`) in the
**vault's** Supabase — migration 0094, service-role only. Routing is config,
never a payload field. The Push button lights up by itself once the row exists.
Their org scoping is what keeps LWS's private bank content out of reach; that
protection already exists and must not be loosened.

**Unverified:** whether Modulus exists as an org in the vault at all. Tracker-side
Supabase access can't see that project.

---

### 9. ~~`evalbee_roll_nos` is vendor-named~~ — DO NOT RENAME (2026-09-13)

Settled by #3. Students keep using the Evalbee roll number they already know
during the transition, so `src/lib/omr/resolveRoll.js` matches this column to
identify a scanned sheet. It is load-bearing for as long as both numbering
schemes are in use, and the vendor name is the least of its properties.

---

### 10. No onboarding runbook

Write `ONBOARDING.md` once #2 lands so institute #3 is a checklist rather than a
re-derivation. The migrations README is the first piece of it.
