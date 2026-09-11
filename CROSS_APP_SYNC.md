# Cross-app question sync — PYQ Vault ⇄ nda-tracker

**Status:** spec, nothing built. Written 2026-09-11, after `questionId` (Phase 0) shipped.
**Audience:** both repos. The vault implements the two producers; the tracker implements the two consumers.

## The one rule

**There is ONE question payload shape, built ONCE on the vault, used by three transports:**
the Tags `.xlsx`, the by-ids read API, and the paper push.

`src/lib/export/tagsSheet.ts` already owns it — `TagRow` *is* the shape. Extract a
`buildQuestionPayload(QuestionRow)` that `toTagRow` also calls, and let the two JSON
transports return it directly. Do **not** hand-roll a second shape per endpoint: two apps
solving the same problem separately is how the OMML repairs drifted
(`ommlRepair.js` vs `ommlBuilder.ts`), and this shape is far more load-bearing.

### The shape

Field names are **nda-tracker's**, not the vault's, so hydration is a merge and never a
translation. They match `exams.questions[]` exactly.

| field | notes |
|---|---|
| `questionId` | the vault `questions.id`. Always present on this path. |
| `subject` | tracker key — run it through `mapSubjectToTracker` (Mathematics→Maths, Current Affairs→Others). |
| `chapter`, `subtopic` | vault names verbatim. `subtopic` falls back to `"General"`. |
| `question` | the stem. |
| `optionA`–`optionD` | option text. |
| `answer` | `"A"`–`"D"`, or `null` when no option is flagged correct. |
| `solution`, `difficulty` | `Easy` / `Moderate` / `Hard` — tracker casing. |
| `context` | passage / shared context. **Never inlined into `question`.** |
| `subtopicSlug`, `conceptSlug` | notes slugs, for the existing `/go` remediation links. |
| `imageUrl`, `solutionImageUrl` | **new.** Absolute public URLs. |
| `optionImages` | **new.** `{A,B,C,D}` → URL or `null`. `options.image_url` exists and is dropped today. |
| `format`, `numericAnswer` | `mcq` \| `subjective` \| `numeric`; the numeric answer for JEE-style NAT rows. |
| `q` | printed number. **Push only** — the by-ids reader doesn't know your numbering. |

**Absent is `null`, not `""`.** The xlsx uses `""` because cells can't hold null; JSON can, and
the tracker's `parseTagsFile` already normalises blanks to `null`. Keep the two consistent at the
consumer, not by degrading the JSON.

**Images are already public** — `question-images` is a public bucket and `publicImageUrl()` builds a
plain unsigned URL. No signing, no proxy, no auth. Return absolute URLs so the tracker stores
something it can render years later without knowing the vault's Supabase host.

---

## 1. `GET /api/questions/by-ids` (vault) — hydrate

```
GET /api/questions/by-ids?ids=<uuid>,<uuid>,…
→ 200 { "questions": [ …shape… ], "missing": ["<uuid>", …] }
```

- **Authenticated and org-scoped. NOT public — this was corrected 2026-09-11.** The first draft of
  this spec made it anonymous over PUBLIC rows, reasoning that the caller is a browser. That is
  wrong: the vault's read path is `anon → PUBLIC only`, `authenticated → PUBLIC + the caller's own
  org's PRIVATE rows`, and a great deal of the bank is PRIVATE (the CDS English corpus, practice
  content behind entitlements). An anonymous endpoint returns **nothing** for those, with no error —
  the hydrate would silently do nothing for exactly the papers that matter, the same silent-empty
  failure as the discarded `.in()` error. It also cannot serve a second institute at all.
- **Therefore the tracker calls it SERVER-side**, folded into an existing endpoint via a `kind`
  discriminator (12/12 functions — no new file). The key never reaches a browser bundle, where it
  would not be a key. CORS stops being a consideration entirely.
- **The key identifies the INSTITUTE.** The vault resolves key → org and scopes the read to that
  org's rows plus public ones. One key per tracker deployment; see *Multi-institute* below.
- **Cap at 100 ids per request**, and answer an over-cap request with a `400`, never a silent
  truncation. The vault's known `.in()` failure was **833 ids ≈ 31 kB of URL**, and a `/guide`
  page still passes **488 ids (~18 kB)** in one call while discarding the error on failure — it
  renders an empty stats map with no signal. Cap it here rather than inherit that.
- **`missing` is REQUIRED and must never be silently dropped.** It carries **TWO causes, and they
  are indistinguishable on purpose** (sharpened by the vault session, 2026-09-11):
  1. **The id names no row.** A stem repair in the vault is a delete-and-re-commit (`content_hash`
     covers the stem), which **mints a new uuid** — so a tracker exam can hold a dead id through
     nobody's error.
  2. **The id names another institute's PRIVATE row.** Same reason an unknown secret returns the
     same `401` as no secret: the response must not confirm that a question exists but isn't yours.

  Inert while one org owns the bank; live at institute #2. **So no tracker-side message may claim a
  question was repaired** — an operator would hunt for a repair that never happened. Say "not
  available from the bank" and show the id.
- Reuse `queryQuestionsByIds` — it already applies RLS with the same client.

### Tracker-side rules for hydration

- **Hydrate on an explicit action, store the result. Never fetch at render.** Two triggers: at
  upload, and a faculty "Refresh from bank" that shows a diff first. Fetching at render would make
  a past paper change under a student because someone edited the bank — the same class of bug as
  retiming a timetable slot and rewriting 490 historical absences.
- **First cut fills only what is ABSENT** (images, and anything the sheet left blank). A field that
  *differs* is reported, not applied, until faculty confirm it. The stored text stays the record of
  what the student actually sat.
- **Fail soft.** Bank unreachable → keep the sheet's text and carry on. Hydration is an enrichment,
  never a precondition for filing an exam.

---

## 2. Paper push (vault → tracker) — the tags file disappears

Build the paper in the vault → push → the exam exists in the tracker **with diagrams** → conduct it
→ upload only the Evalbee results. No tags file for vault-built papers.

**Host it on the existing `POST /api/quiz-import`** behind a `kind` discriminator. The tracker is at
**12/12 Vercel Hobby functions** and a 13th file fails the build; folding a flow into an existing
endpoint is the established pattern (`send-attendance-alerts` hosts `lecture` + `hostel`). The path
name becomes a slight misnomer — accept it, or rename the file *and* the vault's
`NDA_TRACKER_IMPORT_URL` in one coordinated change. Auth is the existing `QUIZ_IMPORT_SECRET` Bearer,
which is fine here because the caller is a CLI, not a browser.

```
POST /api/quiz-import     Authorization: Bearer <QUIZ_IMPORT_SECRET>
{
  "kind": "paper",
  "paperId": "<vault papers.id>",
  "title": "NDA Mock 7",
  "subject": "Maths",
  "questions": [ { "q": 1, …shape… }, … ]
}
```

- **Deliberately NOT sent:** batch, date, marking scheme. Those are tracker-side facts the vault
  does not know. The paper lands as a **draft exam** faculty complete by hand — the same model the
  quiz push already uses, and the reason nothing goes live through this endpoint.
- **`paperId` is the idempotency key.** Re-pushing an edited paper UPDATES that exam rather than
  duplicating it (the quiz push already works this way via a stable id).
- **A re-push MUST NOT rewrite an exam that already has results.** Refuse it (`409`) with the exam
  named. Students sat those questions; silently swapping them rewrites history and invalidates every
  per-question analytic already computed. Same guard as the quiz delete, which refuses to remove a
  published quiz because attempts may exist.
- **Deleting a paper in the vault must not delete a tracker exam that has results** — mirror the
  quiz-delete status filter (a no-op rather than a destructive cascade).
- Q-number parity is already guaranteed: `buildTagRows` and the docx builder walk the same
  `groupBySet` loop, so `q` matches the printed paper and the Evalbee sheet by construction. Keep
  the push on that same loop.

### Two prerequisites on the tracker side

- **The push MUST write `students: []` explicitly.** `ReuploadResultsModal.jsx:18` reads
  `exam.students.length` unguarded, so an exam created without the key crashes that modal — at
  precisely the moment faculty are trying to file results. Add the guard there too; do both, not
  either.
- **Surface a bank-key vs Evalbee-key disagreement instead of swallowing it.** That modal currently
  lets the results file's `Q N Key` overwrite the stored answer **silently**, which was fine when the
  stored answer came from a hand-typed sheet. With a bank-sourced key it is two independent,
  high-confidence sources disagreeing — a real second opinion, and one of them is wrong. Show it the
  way `KeyMismatchPanel` already does on the wizard path.

### To verify before building the push

- How a **zero-result exam** renders on the Exams page and in analytics. The row mapper reads
  `exam.students || []` so the shape is representable, but no surface has been checked against it.
- That "Update Results" (`ReuploadResultsModal`) cleanly attaches Evalbee output to an exam that was
  created empty — that's the whole second half of the flow.

---

## Sequencing

1. **by-ids first.** Smaller, forces the payload shape into the open, and immediately fixes diagrams
   on exams already filed.
2. **Paper push second**, reusing that shape.

Hydrate does not become redundant once push exists: it serves exams already in the tracker,
refresh-after-correction, and any paper that did not originate in the vault.

---

## Multi-institute

**Decided 2026-09-11: every institute gets its OWN tracker deployment** (one codebase, N Vercel
projects, N Supabase projects — never a fork). PYQ Vault stays ONE multi-tenant app; only the
trackers multiply. The shared-DB tracker rebuild is a stated direction but is **not** built — see
memory `project_multi_tenancy.md` for the estimate and the break-even.

- **The vault holds a per-org sync target** — `(org_id, tracker_url, shared_secret)` — in a
  service-role-only table (RLS on, no policies: the `platform_admins` pattern). Both directions read
  from it: pushes route to the org's URL, and an inbound hydrate key resolves back to the org.
- **Routing NEVER comes from the payload.** A destination chosen by the caller means one wrong value
  delivers institute B's paper into institute A's tracker. Config only.
- **The shared secret IS the tenant boundary**, in both directions. One per tracker deployment.
- **The Push button is enabled IF AND ONLY IF the org has a sync target configured** — so it is
  **inactive for every other institute** until one is provisioned, and it lights up by itself the day
  one is. Deliberately NOT an allow-list of institute names: the vault already carries a hardcoded
  `DESTINATION_ORG_NAME = "LWS Pune"` in its sync route, and that is the wart this avoids repeating.
  A disabled button must say *why* ("no tracker configured for this institute"), never just sit dead.
- **Org scoping is what keeps LWS's bank private.** Another institute's tracker can only ever hydrate
  its own org's questions plus public ones. That protection already exists in the vault — the job
  here is not to undo it, which an anonymous endpoint would have.

Because the shared-DB rebuild is the eventual direction, prefer choices that survive it: a config
**table** keyed by org rather than env vars, and a secret **per org** rather than one global one.
Both are what a multi-tenant vault would need anyway.
