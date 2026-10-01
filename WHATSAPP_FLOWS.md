# WhatsApp flows — surface in Settings + per-flow on/off switch

> **Status: Shipped 2026-10-01** on `feat/whatsapp-flow-switch`; this file is the spec of record. Deviations from the original text are listed in §11. Read
> [`CLAUDE.md`](./CLAUDE.md) first (routing, invariants, the 12-function cap, TDD rule), then this
> file end to end before touching code. Everything here was verified against the codebase on the
> date above; re-check line numbers, they drift.

## 0. The ask, in one paragraph

Seven parent-/staff-facing WhatsApp flows exist in `api/`, each keyed to a Meta template whose ID
lives in a Vercel env var. None of them is visible anywhere in the UI, and the only way to stop one
today is to delete its env var in Vercel and redeploy (recorded in `DECISIONS.md` as "the env-var
presence IS the flag"). Build a **Settings → WhatsApp** tab that lists all seven with what they
send, to whom, when, and whether they are configured, plus an **on/off switch per flow** that is
enforced **server-side** on every send path, including the cron.

## 1. Inventory (the thing being surfaced)

| key | Flow | Endpoint + branch | Template env var | Trigger | Recipients | Variables (positional) |
|---|---|---|---|---|---|---|
| `examResults` | Exam results | `api/send-whatsapp.js` | `WABRIDGE_TEMPLATE_ID` | Exams page → 💬 WhatsApp Results | student + parents (+ monitor copy) | `[name, examName, date, pct, scored, outOf, trackerUrl]` |
| `late` | Late to first lecture | `api/send-late-notifications.js` | `WABRIDGE_LATE_TEMPLATE_ID` | Attendance → Late widget | student + parents | `[name, date]` |
| `lectureMiss` | Lecture miss | `api/send-attendance-alerts.js` `kind:'lecture'` | `WABRIDGE_LECTURE_MISS_TEMPLATE_ID` | Attendance → Lecture log | student + parents | `[name, date, subjects]` |
| `examAbsence` | Exam absence | `api/send-exam-absence.js` | `WABRIDGE_EXAM_ABSENCE_TEMPLATE_ID` | Exams page → 📵 Send Absent Alert | student + parents | `[name, examName]` |
| `homework` | Homework / notes pending | `api/send-homework-pending.js` | `WABRIDGE_HOMEWORK_TEMPLATE_ID` | Attendance → Homework log | student + parents | `[name, subject, chapter, type]` |
| `mentorNudge` | Mentorship nudge | `api/send-mentor-nudges.js` | `WABRIDGE_MENTOR_NUDGE_TEMPLATE_ID` | **Vercel cron 07:30 IST Mon–Fri** + Settings → Mentorship (manual) | mentor **teacher** | `[date, students]` |
| `hostelAlert` | Hostel warden alert | `api/send-attendance-alerts.js` `kind:'hostel'` | `WABRIDGE_HOSTEL_ALERT_TEMPLATE_ID` | Hostel tab → 📣 Alert warden (cron-ready, unscheduled) | **warden** numbers | `[date, listText]` |

All seven go through `api/_wabridge.js` `sendWabridge(...)`. Full per-flow detail: memory
`reference_whatsapp_templates.md` and [`FLOWS.md`](./FLOWS.md).

**Not in scope.** `SendScheduleModal` → `/api/send-schedule` is Gmail SMTP via `send_schedule.py`,
dev-only, not WhatsApp. Leave it alone.

## 2. Decisions (defaults — the owner may override; ask once if unsure, then proceed)

| # | Decision | Default | Why |
|---|---|---|---|
| D1 | Do `redirectTo` test sends and `dryRun` bypass the switch? | **Yes** | Neither reaches a parent. Faculty must be able to verify a template body before switching the flow on. |
| D2 | What does an **absent** key mean? | **Enabled** | The live `faculty_state` blob has no `whatsappFlows` key, stale tabs may save without it, and the mentor cron is live. A disabled default would silently stop it on the deploy that introduces the key. See memory `feedback_backward_compatible_encoding`. |
| D3 | New tab or fold Monitoring into it? | **New `WhatsApp` tab**; Monitoring + Mentorship tabs untouched, cross-linked by text | Folding is rework of shipped UI; log it as a backfill candidate in `SUGGESTIONS.md` instead. |
| D4 | Show a "configured" badge (is the env var set)? | **Yes**, as its own commit, booleans only | It is the half of "surface them" that answers "is this one live?". Needs a server read (§5). Never return the value. |

## 3. Design

### 3.1 State — one persisted key

```js
whatsappFlows: { [flowKey]: { enabled: boolean } }   // e.g. { late: { enabled: false } }
```

- Lives in the `faculty_state` JSONB blob (config-style state, same tier as `monitorMobiles`).
- `DEFAULTS` in `src/store/slices/defaults.js`: `whatsappFlows: {}` (empty = all on, per D2).
- **Add to the `saveToStorage` allow-list in `src/store/persist.js`** — both the destructure and
  the `data` object — or it vanishes on reload (memory `feedback_persist_allowlist_footgun`).
  Extend the existing `saveToStorage allow-list` test in `src/store/__tests__/persist.test.js`.
- Action in `src/store/slices/configSlice.js`:

  ```js
  setWhatsappFlowEnabled(key, enabled)  // rejects unknown key (return { ok:false, reason:'unknown_flow' }); calls get()._save()
  ```
- Teachers cannot flip it: Settings is admin-only and `faculty_state` writes are RLS-denied for
  `role='teacher'`. No new policy needed.
- Version-guarded saves apply: a stale tab's flip fails closed with the existing banner. The server
  reads the live row, so the floor is always current regardless of tab state.

### 3.2 Registry — `src/lib/whatsappFlows.js` (pure, no imports from the store)

```js
export const WHATSAPP_FLOWS = [
  { key: 'examResults', label: 'Exam results', envVar: 'WABRIDGE_TEMPLATE_ID',
    endpoint: 'api/send-whatsapp.js', trigger: 'Exams page → WhatsApp Results',
    recipients: 'Student + parents (+ monitoring copy)', variables: ['name','examName','date','pct','scored','outOf','trackerUrl'],
    cron: false, settingsTab: null },
  // … all seven, in the §1 order. mentorNudge: cron:true, settingsTab:'mentorship'.
  // examResults: settingsTab:'monitoring' (for the cross-link).
]
export const FLOW_KEYS = WHATSAPP_FLOWS.map(f => f.key)
export function isFlowEnabled(whatsappFlows, key)   // true unless whatsappFlows?.[key]?.enabled === false
export function isKnownFlow(key)
```

Shared by the UI **and** the API. `api/*.js` may import from `../src/lib/whatsappFlows.js` —
**with the `.js` extension** (Node ESM; `api/__tests__/importGraph.test.js` enforces it).

### 3.3 Server floor — `api/_flowGate.js`

Underscore-prefixed, so it does not count against the 12-function cap.

```js
export class FlowGateReadError extends Error {}
// Reads faculty_state (id=1) .data.whatsappFlows through the client it is given.
// Returns true/false. THROWS FlowGateReadError on a read error (fail closed, mirroring _blockGate).
export async function isFlowEnabledOnServer(supabase, key)
```

Wire it into **all seven paths**, placed after auth and the env-var check, **before anything is
sent or written**:

| Path | Client to read with | Skip the gate when (D1) | Response when disabled |
|---|---|---|---|
| `send-whatsapp.js` | the existing JWT-scoped client | `redirectTo` set | `409 { ok:false, disabled:true, flow:'examResults', error:'Exam results WhatsApp is switched off in Settings → WhatsApp' }` |
| `send-late-notifications.js` | the existing JWT-scoped `db` | `redirectTo` set | same shape, `flow:'late'` |
| `send-attendance-alerts.js` lecture | the existing JWT-scoped `authed` client (the one that reads `leaves`) | `redirectTo` set | `flow:'lectureMiss'` |
| `send-exam-absence.js` | existing JWT-scoped client | `redirectTo` set | `flow:'examAbsence'` |
| `send-homework-pending.js` | existing JWT-scoped client | `redirectTo` set | `flow:'homework'` |
| `send-mentor-nudges.js` | the service client `svc` (cron has no session) | `dryRun` or `redirectTo` | **admin POST:** 409 as above. **cron GET:** `200 { ok:true, skipped:'disabled', sent:0, lines:['Skipped — mentorship nudge is switched off in Settings → WhatsApp'] }`. A cron 500 reads as an outage in Vercel; a skip is intended. **Must not insert into `mentor_nudges`.** Put the gate right after the weekend gate. |
| `send-attendance-alerts.js` hostel | service client `svc` | `dryRun` or `redirectTo` | admin POST: 409. cron GET: 200 skipped, same as mentor. |

- `faculty_state` reads are open to `authenticated`, so JWT-scoped reads work. The service client is
  used only where the path already has one.
- `FlowGateReadError` → `500 { ok:false, error: e.message }`, nothing sent. Never fail open.
- Why 409 and not 403: 403 is the teacher-refusal code and the client already treats it as an auth
  problem. 409 says "the state of the resource forbids this"; the `disabled:true` field is what the
  client keys on, the status code is secondary.
- This adds **no** `getUserOrNull` call, so `api/__tests__/authDoors.test.js` is unaffected. Do not
  touch the 401/403 preambles.
- **Log line format is load-bearing** (`parseFailedNames` parses `lines[]` client-side). A disabled
  response returns `lines: []`, not a `FAIL` line.

### 3.4 Client — buttons disabled, never hidden

Read `whatsappFlows` from the store and `isFlowEnabled` per button. Render the trigger **disabled**
with `title="Switched off in Settings → WhatsApp"` and the same `aria-label` suffix. Hiding would
make faculty think the feature was removed. Sites:

| Flow | Button | File |
|---|---|---|
| examResults | 💬 WhatsApp Results | `src/pages/Exams.jsx` (~line 509) |
| examAbsence | 📵 Send Absent Alert | `src/pages/Exams.jsx` (~line 524) |
| late | all three branches of the send button | `src/pages/Attendance/LateMarkingWidget.jsx` (~95–125) — pass a `flowOff` prop from `Attendance/index.jsx`, OR the widget with `disabled={loading \|\| flowOff}` |
| lectureMiss | both branches | `src/pages/Attendance/LectureLogTab.jsx` (~395–420) — it already takes `disabled`; OR it in the parent |
| homework | the one button | `src/pages/Attendance/HomeworkLogTab.jsx` (~190) — fold into `sendDisabled` |
| hostelAlert | 📣 Alert warden | `src/pages/Attendance/HostelTab.jsx` (~662) — add to the existing `disabled` expression |
| mentorNudge | "Send test" in `MentorshipTab.jsx` stays **enabled** (D1); show an inline notice "Daily nudge is switched off — the cron will skip until it is turned on in Settings → WhatsApp." |

Also handle the server's `disabled:true` in the three result-alert renderers (`confirmSend` in
`Attendance/index.jsx`, `handleWhatsAppConfirm` / `handleExamAbsenceConfirm` in `Exams.jsx`,
`sendWardenAlert` in `HostelTab.jsx`): show `error` as-is. They already display `data.error`, so
this is likely zero change — verify, don't assume.

### 3.5 UI — `src/pages/Settings/WhatsAppTab.jsx`

Add `{ id: 'whatsapp', label: 'WhatsApp' }` to `TABS` in `SettingsPage.jsx` **after `Monitoring`**
and render it. Update the `PageHeader` sub if it still says "Manage branches, batches, and teachers".

One `Card` per flow in `WHATSAPP_FLOWS` order. Each card:

- Header row: label, on/off switch (a `<button role="switch" aria-checked>` with visible focus
  ring; 44px min target — see the Accessibility rule in the global CLAUDE.md), configured badge
  (§5; render "Checking…" until the probe answers, "Configured" / "Not configured" after, and
  "Unknown" if the probe fails).
- Body: what it sends (one sentence), recipients, trigger, cron badge for `mentorNudge`
  (`hostelAlert` says "cron-ready, not scheduled"), variable order as `{{1}} name · {{2}} date …`,
  env var **name** in monospace (never a value).
- Footer: cross-link text where `settingsTab` is set ("Monitoring numbers are in the Monitoring
  tab", "Preview and test sends are in the Mentorship tab"). Plain text, or a button that calls a
  `onSwitchTab` prop if you thread one from `SettingsPage` — do not reach into the page's state.
- Off state: card gets a muted border and a line "Switched off — every send path refuses, including
  the daily cron. Test sends still work." (D1 wording stays true only if D1 holds.)

Follow the look of `MonitoringTab.jsx` (Card, `text-[11px] font-bold text-ink-3 uppercase
tracking-wide` headers, `btn` classes). Teacher mode never reaches Settings; nothing to gate here.

## 4. Tests — write each BEFORE its implementation, watch it fail for the right reason

Mirror source paths under `__tests__/`. Mock-completeness gotchas are in `CLAUDE.md` → Tests.

1. `src/lib/__tests__/whatsappFlows.test.js`
   - seven entries, unique keys, unique env var names;
   - the env var set equals exactly the seven in §1 (pin it; this is how the registry stays honest
     against the endpoints);
   - `isFlowEnabled({}, 'late') === true`, `isFlowEnabled({late:{enabled:false}}, 'late') === false`,
     `isFlowEnabled(undefined, 'late') === true`, unknown key → true.
2. `src/store/slices/__tests__/configSlice.test.js` — `setWhatsappFlowEnabled` writes the key,
   calls `_save`, rejects an unknown key without saving, is a no-op when already in that state.
3. `src/store/__tests__/persist.test.js` — `whatsappFlows` survives the allow-list (add to the
   existing regression test).
4. `api/__tests__/_flowGate.test.js` (`@vitest-environment node`) — absent key → true, `enabled:false`
   → false, read error → throws `FlowGateReadError`, `data:null` → throws.
5. One `describe('flow switch')` in **each** of the seven endpoint tests
   (`send-whatsapp`, `send-late-notifications`, `send-lecture-absences`, `send-exam-absence`,
   `send-homework-pending`, `send-mentor-nudges`, `send-hostel-alert`):
   - disabled → 409 with `disabled:true`, **`fetch` (Wabridge) never called**;
   - disabled + `redirectTo` → proceeds (D1);
   - gate read error → 500, nothing sent;
   - mentor + hostel cron GET disabled → 200 `skipped:'disabled'`, `insertSpy` never called.
   The existing `mockDb` in `send-mentor-nudges.test.js` already serves `faculty_state`; extend its
   `teachers` fixture object with a `whatsappFlows` field. Endpoints that mock `createClient` with
   only `auth.getUser` need a `from('faculty_state')` builder added — copy the chainable shape
   (`select → eq → single`) from the mentor test.
6. `src/pages/Settings/__tests__/WhatsAppTab.test.jsx` — renders seven cards; toggling calls
   `setWhatsappFlowEnabled(key, false)`; off state shows the "Switched off" line; env var names
   render, no values; badge states (mock the probe fetch).
7. Button tests — add one case each where the flow is off and the button is `disabled` with the
   title: `Exams.test.jsx` (both buttons), `LateMarkingWidget`, `LectureLogTab`, `HomeworkLogTab`,
   `HostelTab`. Mock stores for these pages **must include `whatsappFlows: {}`** or the selector
   returns `undefined` — fine for `isFlowEnabled`, but add it anyway so the off case is expressible.
8. `api/__tests__/send-hostel-alert.test.js` (or a new `whatsapp-status.test.js`) for §5: 401 without
   JWT, 403 teacher, returns only booleans, never echoes a value.

Run `npm run test -- <path>` per file while iterating; full `npm run test` + `npm run lint` before
each commit. If the full run looks flaky, `npx vitest run --no-file-parallelism` is the verdict.

## 5. Configured badge — `kind:'whatsapp-status'` on `api/send-attendance-alerts.js` (D4)

No new file (12-function cap). Add a third branch to the dispatcher:

```js
if (kind === 'whatsapp-status') return handleWhatsappStatus(req, res)
```

- POST only. Admin JWT required; **403 `role='teacher'`** (this is a new session door in a file that
  already has two — `authDoors.test.js` counts `getUserOrNull(` vs `isTeacherUser(` per file, so add
  both or it fails).
- Response: `{ ok:true, configured: { examResults:true, late:true, … }, shared: true }` where
  `shared` = all three of `WABRIDGE_APP_KEY/AUTH_KEY/DEVICE_ID` present. Booleans only. Use
  `envReader()` from `api/_env.js`.
- The tab fetches it once on mount with the session bearer (same pattern as `MentorshipTab`'s
  `callNudges`). No Supabase locally → badge "Unknown".
- Add the kind to the comment block at the top of the file and to the dev shim list in
  `vite.config.js` **only if** it is not already routed (it is: the file is already shimmed; a `kind`
  needs no shim change — verify, don't edit `vite.config.js` unless required, since editing it
  breaks every shim until a restart).

## 6. Known gap — document, do not fix here

In `npm run dev` the results flow (`/api/send-whatsapp`) is served by the Vite plugin spawning
`send_results_whatsapp.py`, not by the JS handler, so the dev-only path ignores the switch. The other
six run the real handler in dev through `makeApiShim`. Record this in the WhatsApp tab's About card
("in local dev the exam-results switch is not enforced") and in `CLAUDE.md`. Fixing it means editing
`vite.config.js` to read `data/faculty-data.json` before spawning; park it in `SUGGESTIONS.md`.

## 7. Commits (conventional, atomic, each green on lint + tests)

1. `feat(whatsapp): flow registry + per-flow enabled flag in config` — §3.1, §3.2, tests 1–3.
2. `feat(api): server-side switch on every WhatsApp send path` — §3.3, tests 4–5.
3. `feat(settings): WhatsApp tab listing every flow with an on/off switch` — §3.5 minus the badge,
   test 6.
4. `feat(whatsapp): disable trigger buttons for switched-off flows` — §3.4, test 7.
5. `feat(api): whatsapp-status probe for the configured badge` — §5, test 8, badge wiring.
6. `docs(whatsapp): record the per-flow switch` — see §8.

Branch off `main` (`feat/whatsapp-flow-switch`), merge with `--no-ff` like the recent history. End
each commit message with the attribution line the session reminder gives you.

## 8. Docs to update in commit 6

- `CLAUDE.md` → Feature subsystems: one bullet pointing here; note the dev-only gap (§6).
- `DECISIONS.md`: append a row that **supersedes** the existing row ending "No feature flag in code;
  the env-var presence IS the flag" (grep for it; ~line 77). Keep the old row; mark it superseded.
- `GUARDRAILS.md`: "Every WhatsApp send path calls `isFlowEnabledOnServer` before dispatch; a new
  send path must too. Cron paths return 200 skipped, never 500, when off. Read errors refuse."
- `ARCHITECTURE.md` §11 (visibility matrix: WhatsApp tab admin-only) + §12 (new files).
- `FLOWS.md`: one line per flow — "Gated by Settings → WhatsApp".
- `SUGGESTIONS.md`: backfill candidates — fold Monitoring into the WhatsApp tab (D3); dev shim gap (§6).
- Memory `reference_whatsapp_templates.md`: add the `key` column and the switch.
- Mark this file's status line **Shipped <date>** and keep it as the spec of record (same convention
  as `EXAM_REPORT_DOCX.md`, `RESULTS_REUPLOAD.md`).

## 9. Definition of done (from the global CLAUDE.md — all three, not two)

- `npm run lint` clean against the baseline in `OPERATIONS.md`.
- `npm run test` green.
- Golden path verified in a real browser (memory `reference_browser_verify_portals.md`): switch
  `late` off in Settings → the Late widget's button is disabled → a direct POST to
  `/api/send-late-notifications` (via the dev shim, admin session) returns 409 `disabled:true` →
  switch on → the button re-enables. Check the mentor cron skip with an admin POST
  `{ force:true }` while `mentorNudge` is off: expect 409, and with `{ dryRun:true, force:true }`
  expect the normal preview (D1). Reload a second admin tab after flipping to confirm the blob
  round-trips.

## 10. Things that will bite if ignored

- **12-function cap** — no new `api/*.js` without an underscore. `_flowGate.js` is fine; the status
  probe is a `kind`.
- **`.js` extensions** on every relative import reachable from `api/`.
- **Allow-list** in `persist.js`, both halves.
- **`authDoors.test.js`** counts doors per file; the status probe adds one.
- **Never return env var values** from the probe; names are already in the client registry, values
  are secrets.
- **Cron must not 500 on "off"**, and must not advance `mentor_nudges`.
- **Fail closed on a read error** — same posture as `_blockGate.js`.
- **Absent key = enabled** (D2). Do not seed `DEFAULTS` with seven `enabled:true` entries: a stale tab
  would then write them over a newer blob's `false` through the whole-blob save, and the version
  guard only catches it when the tab is stale by version, not by content.
- **Do not touch `vite.config.js`** unless something genuinely needs a new shim (nothing here does).
- **Do not hide buttons**; disable with a title.
- **Do not refactor the seven endpoints' auth preambles** while in there — the inline 401/403 lines
  are deliberate (see `CLAUDE.md` → teacher-filed school attendance).

## 11. As built — where it differs from the text above

- **`cron` is `'live' | 'ready' | null`, not a boolean**, so the hostel alert can say "schedule ready, not running" honestly.
- **Every disabled response carries `sent: 0` and `lines: []`**, so clients that read those fields unconditionally still render.
- **The test-send bypass keys on the parsed redirect (`redirectNorm`)**, not `redirectTo`. Not in §3.3's wording; found while wiring it, pinned by a test per endpoint.
- **The gate runs before the expensive reads where it could**: before the exam/results/roster loads in `send-whatsapp.js`, before the leaves read on the lecture path, before the chain's five reads on the hostel path.
- **Disabled buttons also show visible text** (`FlowOffNote`, or `· off` inside the exam card buttons), because some browsers show no tooltip on a disabled button.
- **Configured badge has three states plus unknown**: Configured / Not configured / Credentials missing (template set but shared Wabridge keys absent) / Status unknown.
- **Phone layout:** the Settings tab row scrolls on its own below `md`. It already overflowed a 390px phone before this work (616px); the new tab made it 716px.
- **Gap left open:** five flows keep their redirect field inside the preview modal, which the disabled trigger no longer opens, so those templates cannot be test-sent while switched off. Logged in `SUGGESTIONS.md`.

## 12. Verification record (2026-10-01)

- Full suite green; `npm run lint` identical to `main` (all problems pre-existing).
- The gate was run read-only against the live `faculty_state` row: every flow reads on (no key yet), and a read without a session is refused rather than read as on.
- Golden path driven in headless Chrome against `npm run dev`: seven switches; switching exam results off disables all ten WhatsApp Results buttons with the reason while Send Absent Alert stays live; survives a reload; switching back re-enables; Tab reaches the switch with a visible ring; Space and Enter both toggle; no sideways scroll at 390px.
- **Not verified in a browser:** a 409 from a real send. Localhost has no admin session, so the endpoints answer 401 before the gate. Covered by the endpoint tests; verify on a branch preview with an admin login.
