# Security

The application handles personally identifiable information about minors (full names, dates of birth, mobile numbers, parent mobile numbers, exam scores, attendance records) and integrates with paid third-party messaging APIs. This document captures the security model, the data being protected, and known gaps.

For column-level schema see [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md). For the *why* trail see [`DECISIONS.md`](./DECISIONS.md) and for the "what not to change" list see [`GUARDRAILS.md`](./GUARDRAILS.md).

---

## Reporting a vulnerability

This is a private internal application. To report a security issue, contact the project owner directly via the internal channel. Do not file a public issue.

---

## Threat model

**Assets:**
- Student PII: full names, mobile numbers, dates of birth, parent mobile numbers, registration dates, branch and batch assignments
- Exam results: per-student scores, per-question responses
- Admin access: write access to all of the above
- Third-party message-sending credentials (Wabridge WhatsApp, Gmail SMTP)

**Adversaries we plan for:**
- An external party with the Supabase anon key (it ships in the client bundle)
- A student attempting to access another student's data
- An accidental misuse — a script run with the wrong key, a SQL editor query that forgets a `WHERE`

**Out of scope:**
- An adversary with the Supabase service role key (treated as an admin)
- Browser-side malware on an admin machine

---

## Authentication model

Four distinct auth paths, each with different trust assumptions.

| Mode | Auth mechanism | What it proves |
|---|---|---|
| Admin | Supabase Auth — email + password, JWT, no `user_metadata.role` | The session holder is a designated admin. Single shared account today. |
| Superadmin | Supabase Auth — email + password, JWT, `user_metadata.role = 'superadmin'` | Admin powers **plus** access to teacher feedback (HR-sensitive). Single account (`vilas11shinde@gmail.com`). Routes through the admin portal; the extra surface is gated by the `isSuperadmin` flag + the `teacher_feedback` RLS role check. |
| Teacher | Supabase Auth — email + password, JWT, `user_metadata.role = 'teacher'` | The session holder is a designated teacher. Individual accounts. Read-only across the analytics portal; **may write attendance capture** for their own periods at `/school-attendance` (2026-07-27). |
| Student | `POST /api/student-login` with mobile number, returns a session token stored in `localStorage` | The caller knows a mobile number that exists in `students.mobile` **or any `students.parent_mobiles[]`**. No Supabase Auth session. |

**Teacher write surface (2026-07-27).** Teachers were never blocked at the DB — the capture tables' RLS is `authenticated`, so "read-only teacher" was always a UI convention. Giving them capture UI makes that explicit and adds the boundary that was missing: `faculty_state` **writes** are now denied to `role='teacher'` at the DB (`faculty_write_insert/update/delete`; reads stay open), because `saveToStorage` serialises the whole blob and one stray mutation from a teacher client would rewrite syllabus, timetable and send history wholesale. All parent-facing send endpoints 403 teachers. What a compromised teacher password still reaches: read of everything the teacher portal loads (incl. student mobiles), and writes to the capture tables + `quizzes`. Scoping to "your own lectures" on the page is **convenience, not a boundary** — RLS does not partition by teacher.

The student "auth" is mobile-number-only — there is no password and no OTP. Anyone who knows or guesses a student's mobile number can read their data via the student portal. This is an accepted trade-off for the coaching context (mobile numbers are not secret, and students should not need to remember a password).

A login number may be the student's **own** mobile or any entry in their `parent_mobiles[]` — a parent reaching their child's dashboard is intended (same accountability stance as the WhatsApp alerts). The blast radius of a known number is therefore unchanged: it still resolves only to the student(s) that number belongs to. When one number is linked to **two or more** students (siblings sharing a parent number), the endpoint returns a candidate list and the client shows a picker; see the `lwsId` validation rule in "Student portal — RLS bypass".

---

## Row Level Security

| Table | RLS | Policy |
|---|---|---|
| `faculty_state` | Enabled | Authenticated users only (admin + teacher) |
| `students`, `student_batches`, `student_attendance`, `students_meta` | Enabled | Authenticated users only |
| `exams`, `exam_results` | Enabled | Authenticated users only |
| `class_reports`, `student_plans` | Enabled | Authenticated read / insert / delete |
| `homework_pending` | Enabled | Authenticated users only |
| **`teacher_feedback`** | Enabled | **Superadmin only** — `(auth.jwt() -> 'user_metadata' ->> 'role') = 'superadmin'`. The **first role-restricted policy** in the project: a normal admin (no role claim) cannot read or write it. This is a real DB-level boundary, not just a UI gate. |
| `student_logins` | Enabled | **Authenticated read only** (`authenticated can read`). Deliberately **no insert policy** — the only writer is `api/student-login.js` via the service role, which bypasses RLS. Fixed 2026-08-11. |
| `faculty_state_backup_selfstudy_20260730` | Enabled | **No policies = service-role only.** Dead 30-July snapshot; RLS enabled 2026-08-11 (see Known gaps for the delete review date). |

Component-level visibility (which features render for which mode) is enforced in the UI via `useMode()` / the `isSuperadmin` store flag and acts as defence-in-depth on top of RLS. **UI gating is not a security boundary by itself** — anyone able to obtain a Supabase session for an authenticated user can read any RLS-permitted table directly. The teacher account is not a security boundary against the admin data — it can read everything authenticated users can read; teacher mode is read-only by UI convention, not by RLS. **`teacher_feedback` was believed to be the exception** — its policy checks the `superadmin` role claim, so the `isSuperadmin` UI gate looked like it was backed by a true RLS boundary. **It is not (found 2026-08-11).** The policy reads `auth.jwt() -> 'user_metadata' ->> 'role'`, and `user_metadata` is **self-editable** by any signed-in user via `supabase.auth.updateUser({ data: { role: 'superadmin' } })`. The same flaw affects the three `faculty_state` `faculty_write_*` policies, so the "teacher writes are denied at the DB" boundary is also defeatable by a teacher relabelling their own account. Supabase's linter flags all four as `rls_references_user_metadata` (level ERROR). **The fix is `app_metadata`**, which only the Admin API can set — see Known gaps. Until then, treat both as UI conventions, not boundaries.

**Superadmin account provenance:** `vilas11shinde@gmail.com` was created directly in `auth.users` + `auth.identities` via SQL (the local env had no service-role key for the Admin API), mirroring an existing working row, with `raw_user_meta_data = {"role":"superadmin"}` and a bcrypt password. Password resets / future superadmins should go through the Supabase dashboard or the Admin API, not more hand-rolled SQL.

---

## Student portal — RLS bypass

The student portal does not authenticate to Supabase. RLS would block its reads. The application solves this by routing all student-portal data through `api/student-login.js`, a Vercel serverless function that authenticates with the **service role key** server-side, applies row-level filters in SQL (e.g. `WHERE student_name IN (canonical + variants)`), and returns the filtered payload.

This makes `api/student-login.js` a security-critical file:

- It must filter results by the mobile-number lookup. A bug that returns un-filtered data is a full PII leak.
- It must never log the service role key or include it in any response.
- It must not accept SQL-influencing parameters from the request body (no template substitution into queries).
- **The request body's optional `lwsId` (used by the sibling picker and session restore) is an authorization input, not just a selector.** It is honoured **only when it is in the candidate set computed from the looked-up mobile** — i.e. the number is that student's own or parent number. Trusting a client-supplied `lwsId` on its own would let any caller pull any student's data by guessing an id. Do not relax this check, and do not collapse a multi-candidate (sibling) match to "first hit wins".

The student portal also has a parallel attendance fetch — to bypass RLS, attendance data is passed as a prop from the serverless response into `StudentView` instead of fetched client-side.

---

## Secret management

Secrets are managed at three levels.

| Where it lives | Examples | Risk if leaked |
|---|---|---|
| **Vercel environment** (production) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `WABRIDGE_*`, `SUPABASE_SERVICE_ROLE_KEY`, Gmail SMTP creds | Production-equivalent access |
| **Browser bundle** (publicly visible) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Read-only Postgres access subject to RLS — known and accepted |
| **`.env.local`** (developer machine, gitignored) | `SUPABASE_SERVICE_ROLE_KEY` (for one-off scripts), `WABRIDGE_*` (for dev `/api/send-whatsapp`), Gmail SMTP creds | Same as Vercel; never commit |

**Rules:**

- The service role key is **never** present in any code path that runs in the browser. It is used only by Node scripts (`migrate_*.js`, `sync_*.js`, `create_teacher_account.js`) and by Vercel serverless functions where it lives in `process.env`.
- `apiKey` (Anthropic API key, if ever used in-app) is held in memory only — never persisted to disk, JSON, or localStorage. See [`GUARDRAILS.md`](./GUARDRAILS.md).
- No secrets in `git log`. If a secret was committed and pushed, rotate it immediately rather than rewriting history.
- `.env.local` is gitignored. Verify before any `git add -A`.

---

## Hand-created tables default to RLS OFF — the 2026-08-11 incident

**Two tables were readable with the browser-bundle anon key, bypassing every gate the app assumes.** Both were created by hand via SQL, where **RLS defaults to disabled** — so they silently opted out of the protection every table created through the normal path has. This is a *class* of bug, not two instances: any future hand-created table starts wide open.

| Table | What was exposed | Fixed |
|---|---|---|
| `faculty_state_backup_selfstudy_20260730` | A 30-July snapshot of the `faculty_state` blob whose `studentProfiles` key held **493 student profiles** — name, `mobile`, `parentMobiles`, `dob`, `gender`, `lwsId`, branch, batches, `accountStatus`, `regDate`. Readable **and writable** (anon held `SELECT,INSERT,UPDATE,DELETE,TRUNCATE`). | RLS enabled, no policies → service-role only |
| `student_logins` | Every student's login timestamps + `lws_id`s; anon could also `INSERT`/`TRUNCATE` — i.e. pollute or erase the audit trail. | RLS enabled + `authenticated can read`; **no insert policy** |

**Why the backup table mattered more than it looks.** Student auth is mobile-only, which is defensible *because the mobile number is the gate*. That table **was the list of mobile numbers** — 493 of them, downloadable by anyone who opened devtools on the deployed site. It converted "an attacker must know a number" into "an attacker reads all the numbers, then walks them through `/api/student-login`". The front door was sound; the keys were in the lobby.

**No insert policy on `student_logins`, deliberately.** An earlier draft of this fix granted `anon` INSERT "defensively". That would have preserved exactly the audit-log pollution listed above. The only writer is `api/student-login.js` via the service role, which bypasses RLS — so no policy is needed, and adding one only re-opens the hole.

**Verified at the real REST boundary**, not just in the DB (an internal `select` runs privileged and bypasses RLS, so it proves nothing):

| Probe | Before | After |
|---|---|---|
| anon `GET` either table | full rows | `[]` (empty, matching a locked control table) |
| anon `POST student_logins` | inserted | `401` — `new row violates row-level security policy` |
| service-role `GET` / `POST` | works | works (351 KB blob; insert `201`) |

**Prevention:** `mcp__supabase__get_advisors` (or the Supabase dashboard linter) catches `rls_disabled_in_public` in one call. Run it after **any** hand-written DDL — that is the durable control, not remembering this incident.

**Still open from the same advisor run:** three `rls_references_user_metadata` ERRORs (see Row Level Security above and Known gaps below).

---

## PII inventory

For an audit or a data-subject request, the following tables hold student PII:

| Table | PII columns |
|---|---|
| `students` | `canonical_name`, `mobile`, `dob`, `gender`, `email`, `eis_reg_no`, `parent_mobiles[]`, `name_variants[]`, `evalbee_roll_nos[]` |
| `student_batches` | `lws_id` (FK only — no direct PII) |
| `student_attendance` | `lws_id`, `date`, `status` |
| `student_logins` | `lws_id`, `logged_in_at` |
| `exam_results` | `student_name`, `roll_no`, scores, per-question responses |
| `class_reports`, `student_plans` | `student_name`, free-text plan body (may contain quoted PII) |
| `faculty_state.data.studentProfiles` | Cached subset of `students` (re-overwritten on each admin load). Should be considered stale-PII. |

**Data flow for a student delete request:**

1. `DELETE FROM students WHERE lws_id = '<id>'` — cascades clear `student_batches`, `student_attendance`, `student_logins`. `student_plans.lws_id` is `ON DELETE SET NULL` so plan history persists with the student's name retained in `student_name`. Decide explicitly whether to also delete plan history.
2. `DELETE FROM exam_results WHERE student_name IN (canonical + variants)`. This is the only manual step — there is no FK from exam_results to students.
3. Manually scrub `class_reports.text` and `student_plans.text` if either contains the student's name in narrative.
4. Admin must log out and back in for the in-memory `studentProfiles` cache to refresh.

There is no automated "right-to-be-forgotten" tool today. If this becomes a recurring need, add a script under the `migrate_*` pattern.

---

## Known gaps and accepted risks

| Gap | Severity | Mitigation / accepted reason |
|---|---|---|
| ~~`student_logins` RLS disabled~~ | ~~High~~ | **FIXED 2026-08-11** — RLS enabled, authenticated read only, no insert policy. See the incident section above. |
| ~~`faculty_state_backup_selfstudy_20260730` anon-readable (493 student profiles)~~ | ~~Critical~~ | **FIXED 2026-08-11** — RLS enabled, service-role only. Data preserved; **delete decision deferred to ~2026-09-11** by explicit choice (it is the only 30-July rollback point, and two small unexplained diffs vs live were noted: `studentProfiles` 6 bytes smaller, `timetableMappings` changed at identical length). Nothing in the codebase references it. |
| **`user_metadata` used in 4 RLS policies** (`teacher_feedback.superadmin_all`, `faculty_state.faculty_write_{insert,update,delete}`) | **High** | **OPEN.** `user_metadata` is self-editable, so a signed-in teacher can relabel their own account `superadmin` and defeat both the teacher-feedback boundary and the teacher-write denial. Needs migration to `app_metadata` (Admin-API-only) plus a re-check of `create_teacher_account.js` / `api/teacher-account.js`, which set the role today. Requires an authenticated account, so not publicly reachable. |
| No rate limiting on `/api/student-login` | **Medium→High** | **OPEN.** No throttle anywhere in `api/`. Responses distinguish hit (200 + name) from miss (404), so a known-prefix scan enumerates the roster cheaply. Materially worse while any copy of the 493-number list may already be out. Fix belongs in a shared `api/_rateLimit.js` (underscore-prefixed helpers do not count against the 12-function cap). |
| Student payload discloses more than the portal renders | Low→Medium | **OPEN.** `api/student-login.js` returns `parentMobiles`, `dob`, `gender`, and `integrity_incidents.counterpart_name` — the last discloses *another* student's name through a mobile-only gate. Shrinking it reduces the blast radius of every threat at once at zero friction. |
| Student auth is mobile-only (no OTP, no password) | Medium | Accepted, re-affirmed 2026-08-11. Mobile numbers are not secret; the coaching context tolerates this. Note the ceiling: any classmate with your number (every batch WhatsApp group lists them) can open your portal, and only OTP or a real second factor changes that. Throttling makes it non-scalable and detectable, which is the chosen posture. |
| The admin account is a single shared login | Medium | Accepted today (one institute, two staff members who trust each other). Becomes a problem if expanded. |
| The Supabase anon key is in the browser bundle | Low | Inherent to Supabase architecture. RLS is the enforcement layer; the anon key is not a secret. |
| No CI gate on lint/tests before deploy | Low | Vercel auto-deploys from `main`. Discipline is to run `npm test && npm run lint` locally before pushing. |
| Wabridge auth tokens are long-lived | Low | Rotate in both Vercel env and `.env.local` when needed. No automated rotation. |
| No audit trail for admin mutations | Medium | Decisions log is human-maintained in CLAUDE.md. A real audit would require triggers writing to a log table — not implemented. |

---

## Checklist before adding a new collaborator

- [ ] They have their own Supabase Auth account (do not share credentials).
- [ ] They have read `ARCHITECTURE.md`, `SECURITY.md`, and the global CLAUDE.md preferences.
- [ ] They understand the difference between the anon key (safe in bundle) and the service role key (never in bundle).
- [ ] They know to never run destructive SQL or `--cleanup` flags before verifying row counts.
- [ ] If they are taking on a teacher role, their `user_metadata.role` is set to `'teacher'` via `create_teacher_account.js` rather than promoted to admin.
- [ ] They have their own copy of `.env.local` — never share by email or chat.
