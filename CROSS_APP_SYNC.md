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

- **Unauthenticated, read-only, PUBLIC-visibility rows only** — exactly what `/browse` already
  shows an anonymous visitor. No secret: the caller is the tracker's *browser*, and a shared secret
  in a client bundle is not a secret. Add auth to this one route later if content ever becomes gated.
- **Send no custom headers.** A bare `GET` stays a CORS "simple request" and skips the preflight;
  an `Authorization` or custom header forces an `OPTIONS` round trip on every call.
- **Cap at 100 ids per request**, and answer an over-cap request with a `400`, never a silent
  truncation. The vault's known `.in()` failure was **833 ids ≈ 31 kB of URL**, and a `/guide`
  page still passes **488 ids (~18 kB)** in one call while discarding the error on failure — it
  renders an empty stats map with no signal. Cap it here rather than inherit that.
- **`missing` is REQUIRED and must never be silently dropped.** A stem repair in the vault is a
  delete-and-re-commit (`content_hash` covers the stem), which **mints a new uuid** — so a tracker
  exam can hold a dead id through nobody's error. An unmatched id means *"this question was repaired
  since the exam"*, which is exactly the thing worth surfacing.
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
