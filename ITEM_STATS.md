# Item statistics — spec

**Status:** spec, nothing built. 2026-09-11. Phase 2 of the cross-app question link
(`CROSS_APP_SYNC.md`); depends on `questionId`, which 35 exams now carry.

## What it is

Every mock already produces the evidence of how good each question is — who attempted it,
who got it right, which wrong option pulled them. Filed and then thrown away, because nothing
connected an answer sheet back to the bank item. With ids it accumulates.

Three outputs, in descending order of certainty:

1. **Measured difficulty** — replaces the hand-typed `EASY / MODERATE / HARD`, which is a guess
   made once at upload by one person.
2. **Wrong-key LEADS** — questions where a distractor outpulls the keyed answer. A lead for
   human review, never a verdict (see below).
3. **Exposure** — which items a batch has already sat, for the paper builder. Falls out for free.

## Measured today (not projected)

| | |
|---|---|
| exams carrying ids | 35 |
| result rows behind them | 1,247 |
| rows carrying `choices` (the chosen letter) | **1,247 — 100%** |
| distinct questions with response data | 1,435 |
| ... with >= 20 attempts | 1,259 |
| questions where a distractor beats the key (>= 20 attempted) | **122 of 553** |
| ... where a distractor more than doubles the key | **56** |
| questions appearing in more than one exam record | 444 |
| ... keyed DIFFERENTLY across records | **3** |

The 100% `choices` coverage is the load-bearing surprise: distractor analysis was expected to
be impossible for rows predating 2026-06-10, and it is not.

## The data, and the invariant that governs it

- **`exam_results.responses`** is `{ "<qno>": 1 | -1 | 0 }` — Evalbee's per-question VERDICT
  (correct / wrong / not attempted). **It is authoritative and this feature must never re-derive
  it** from `questions[].answer`. See the grading invariant in `CLAUDE.md`.
- **`exam_results.choices`** is `{ "<qno>": "A" | null }` — the letter the student actually
  filled. This is what makes distractor analysis possible at all.
- **`exams.questions[].answer`** is the DISPLAYED correct answer. It drives the wrong-key check
  and nothing else.
- The join is `exam_id` + question number -> `questionId`.

## Pooling — the part that is easy to get wrong

**The same paper is deliberately conducted for several batches, and each sitting is its own exam
record.** That is not duplication; it is how the school runs. 444 questions already appear in more
than one record.

So **statistics pool by `questionId` across exam records**, never per exam. A per-exam view would
split one question's evidence into several under-powered samples and would make exposure control
wrong as well.

Two consequences:

- **A question keyed DIFFERENTLY across records is a finding, not an input.** 3 exist today. Pooling
  them blindly would average two different notions of "correct". Report them separately and pool
  nothing for that question until a human resolves it.
- **Cohorts differ in ability between batches.** For difficulty that is acceptable — it is your
  population, and that is exactly what you want calibrated against. For DISCRIMINATION it is not:
  compute the upper/lower split **within each exam record** and pool the counts, never rank
  students across batches.

## Metrics

For each `questionId`, over all records it appears in:

| metric | definition | why this way |
|---|---|---|
| `seen` | rows where the question number is present in `responses` | denominator for skipping |
| `attempted` | `seen` minus verdict `0` | |
| `skipped` | verdict `0` | |
| `pValue` | `correct / attempted` | **NOT `correct / seen`.** Mixing them makes an easy-but-avoided question read as hard. Skipping is a separate behaviour and deserves its own number. |
| `skipRate` | `skipped / seen` | an item nobody dares attempt is its own signal |
| `choiceCounts` | `{A,B,C,D}` from `choices`, attempted only | a skip says nothing about which option pulls |
| `discrimination` | correct-rate in the top 27% by exam total minus the bottom 27%, computed per record then pooled | the classic index; negative means the item rewards the weaker half, which is the strongest wrong-key signal there is |

**Minimum n.** Report nothing below 20 attempts; carry `n` on every row so the reader can discount.
Everything below that threshold stays in the export marked `insufficient`, never silently dropped.

## Wrong-key leads are LEADS

A distractor outpulling the key means one of three things, and the data cannot tell them apart:

1. the key is wrong;
2. the question is hard and the distractor is a well-built trap — which is what a good PYQ does;
3. a systematic misconception worth teaching to.

So the output is a **ranked review queue**, never an automatic correction. Rank by
`distractorCount / keyCount` with negative discrimination as a strong secondary signal. Same posture
as the collusion playbook: leads, not proof.

**Nothing here re-grades anything.** Marks are Evalbee's. A key confirmed wrong is fixed in the bank
by a human, and the re-grade action remains unbuilt and out of scope.

## Shape

- **Pure core** `src/lib/itemStats.js` — `computeItemStats(exams, results, opts)` -> per-question
  rows plus `conflicts[]` (differing keys) and `insufficient[]`. No DB, no fetch, fully testable.
- **A script** `item_stats.js` at the root, matching the `migrate_*.js` convention: reads Supabase,
  runs the pure core, writes a JSON report. Dry/report-only; it never writes to either database.
- **No endpoint.** The tracker is at 12/12 Vercel Hobby functions. The bank ingests the JSON through
  a CLI on its side, the way it ingests everything else.
- **Bank side, later:** store measured difficulty against `questions.id` and surface the review queue.
  Out of scope here; the JSON is the contract.

## Deliberately NOT in scope

- Re-grading students. Ever.
- Auto-updating the bank's difficulty from measurements. The export is evidence; a human promotes it.
- Showing item statistics to students. This is faculty and content-team instrumentation. A student
  learning that 88% of their batch missed a question changes nothing they can act on.
- Cross-institute pooling. Another institute's cohort is not your population.

## Open questions

1. **Difficulty bands.** What p-value cuts map to EASY / MODERATE / HARD? Needs a content-team call,
   and the answer should come from the distribution of the 1,259 measured items, not from a
   convention borrowed elsewhere.
2. **Does the bank store measurements, or just the review queue?** Storing them means a new column
   or table there and a decision about staleness when a question is edited.
3. **Refresh cadence.** After every upload, or on demand? On demand is the cheaper start.
