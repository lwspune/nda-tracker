# Rich text on screen — spec

**Status:** spec, nothing built. 2026-09-11. Triggered by a garbled frequency-distribution
table on the new Question Stats page; the investigation found the same defect across every
on-screen question surface, including student-facing ones.

## The defect

`src/components/ui/Math.jsx` splits text on `\(...\)` and HTML-escapes everything else. So any
other markup the bank stores renders as source. Measured over the 13,548 questions that carry text:

| stored as | questions | renders on screen as |
|---|---|---|
| GFM pipe table | **68** | a run of `\|` and `---` |
| `**bold**` | **427** | literal asterisks |
| `\[ ... \]` block math | **267** | raw LaTeX |
| `\underline{\text{word}}` | **433** | KaTeX-typeset, wrong typeface mid-sentence |

(Plus 124 solutions with bold.) These overlap, so the affected set is somewhere under ~900 of
13,548 — small in share, and concentrated exactly where it hurts: data-interpretation questions
in Statistics, and English/Biology vocabulary items.

**This is not a Question Stats bug.** `QuestionCard` renders question text through `<Math>` and
has **six** render sites, one of which is `FocusedExamResult` — the student's own result review.
Students already see the garbling; the new page only made it visible to faculty.

## Both halves already exist. Neither is wired to the screen.

**In this repo:** `src/lib/richText.js` — `parseTableBlocks` (GFM tables, gated on a separator
row so `P(A | B)` and `|x|` are never tables, math zones masked first so a pipe inside `\(...\)`
cannot split a cell) and `parseRichSegments` (bold resolved on the MASKED string, so a bold span
may contain maths). Ported from PYQ Vault, tested. Used ONLY by `practiceSetDocx` and
`gatErrorSetDocx` — the Word exports. The screen was never wired up.

**In the bank:** `src/components/math/BlockText.tsx` renders exactly this on screen today, over a
`parseTableBlocks.ts` that is **line-for-line equivalent to ours** (diffed: identical
`isRowLike` / `isSeparatorRow` / `splitCells`, bar one redundant clause). So unlike the OMML
repairs, there is no engine mismatch here and no re-probing hazard — the donor fix applies.

**The one idea worth taking from the bank that I would not have invented:** its `BlockText` has a
**fast path**. When the text contains no table — the overwhelming majority — it returns the bare
text renderer, byte-for-byte the previous behaviour. That is what makes changing a component with
six render sites a safe edit rather than a rewrite of how every question looks.

## Build

### 1. `src/components/ui/RichText.jsx` (new)

Mirrors the bank's `BlockText`:

- `parseTableBlocks(text)`; **fast path** — no table, or a single text block, returns
  `<Math>{text}</Math>` unchanged.
- Otherwise interleaves `<Math>` prose with real `<table>` blocks.
- The table wrapper is `overflow-x-auto`: a wide frequency distribution must scroll in its own
  box, never widen the page.
- Cells render through `<Math>` too — headers and cells routinely contain `\(x_i\)`.

`Math.jsx` is NOT modified. It stays the inline-math primitive; `RichText` composes it.

### 2. Wire it

- **Question Stats** (new code, no gate): question text and the key-conflict list.
- **`QuestionCard`** (shipped, six render sites): the `q.question`, `q.context`, option and
  `q.solution` renders. One component swap; the six call sites need no change because the swap is
  inside `QuestionCard`.

### Deliberately NOT in this change

- **Bold, block math and the underline bypass.** Each is a real defect (427 / 267 / 433
  questions) and each is a SEPARATE change to `Math.jsx` itself, which is the primitive every
  question surface in the app depends on. Tables can be fixed by composition, without touching
  that primitive. Doing all four at once means a single change to the most-rendered component in
  the codebase with no way to attribute a regression. Sequence them, tables first, because tables
  are the ones that render as unreadable noise rather than merely as unstyled text.
- **Re-parsing stored text.** Nothing is rewritten in the database. This is a render-time change
  only; `exams.questions[].question` stays exactly what the student sat.

## Risk

Low, and asymmetric in our favour: text with no table takes a path that returns the identical
element tree as today, so 13,480 of 13,548 questions cannot change appearance. The only new
behaviour is on the 68 that are currently unreadable.

The one hazard is a **false-positive table** — prose mistaken for a grid. The separator-row gate
is what prevents it, it is already proven in production by the Word exports, and `richText.test.js`
pins the two cases that would otherwise trip it (`P(A | B)`, `\(|A| = 2\)`).

## Verify

1. `richText.test.js` stays green (the parser is untouched).
2. New tests: a question with a table renders a `<table>`; a question without one renders exactly
   what it renders today; `P(A | B)` does not become a table.
3. In the browser: the Statistics frequency-distribution question on Question Stats, and the same
   question in a student's exam review.
