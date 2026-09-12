# Exam report as Word (.docx) — design spec

> Status: **SPEC, not built — all five decisions ruled 2026-09-12, ready to implement.**
> Companion to the class PDF (`src/lib/examPdf.js`), which shipped KaTeX-typeset question cards on
> 2026-09-12. Rulings and their knock-on effects are in §11.

---

## 1. What this is

A **Word version of the class exam report** — the same document the `📄 PDF` button on the Exams
page produces, emitted as a `.docx` with real, editable Word equations instead of pictures of
equations.

It is an **addition, not a replacement.** The PDF keeps its button and its job: the one-click,
fixed-layout artefact you print or attach. Word answers a different need — a teacher who wants to
*take the questions out of the report* and put them in a worksheet, a WhatsApp message, or a slide.

### What it is explicitly NOT

- **Not an automated PDF converter.** The app cannot convert docx → pdf. Not client-side, and not
  server-side either: that needs headless LibreOffice, which does not run on a Vercel Hobby
  function, and we are at the 12-function cap. Whoever wants a PDF from the Word file opens Word
  and exports it. Anyone specifying "download Word, auto-convert, serve a PDF" is specifying a
  different product.
- **Not a reason to weaken the PDF.** The PDF's question cards were just fixed. Two exports of one
  report is the intended end state, the same as Monthly Reports (PDF + Word, both live).

---

## 2. Prerequisite — extract the shared OMML pipeline

**This is the first commit, before any exam-report code exists.**

The LaTeX → Word-equation pipeline is already written **twice**, verbatim:

| | `src/lib/practiceSetDocx.js` | `src/lib/gatErrorSetDocx.js` |
|---|---|---|
| `MARKER` / `MATH_PR_BLOCK` | ✅ | ✅ duplicated |
| `pickFn` interop guard | ✅ | ✅ duplicated |
| `latexToOmml` | ✅ | ✅ duplicated |
| `mathRuns` | ✅ | ✅ duplicated |
| `contentTable` (GFM tables) | ✅ | ✅ duplicated |
| post-pack marker swap + `settings.xml` patch | ✅ | ✅ duplicated |
| `prettifyMath` | ✅ **defined** | imported from `practiceSetDocx` |

Only `prettifyMath` was shared, with a comment explaining why. Everything else was copied.

**The evidence that this costs real money:** the single-pass marker swap. `practiceSetDocx`
measured the per-equation version at *675 s* on a 1.19 MB set with 1,740 equations against 441 ms
for one pass — a 1,500× fix — and the same fix then had to be re-applied by hand in
`gatErrorSetDocx`. The two copies agree today by diligence, not by construction. The exam report
would be **copy number three**, and the next fix would need applying three times.

### What to extract

A new `src/lib/docxMath.js`, pure except for the dynamic imports:

```js
// Resolves katex + mathml2omml (CJS interop is a trap — see pickFn), returns the
// builders every docx export needs. One call per document build.
export async function createMathRenderer()
//   -> { mathRuns, contentTable, blocksToParagraphs, ommlByIndex, MARKER }
export async function applyOmml(zip, ommlByIndex)   // marker swap + settings.xml <m:mathPr>
export { prettifyMath }                              // moved here from practiceSetDocx
```

**Three properties of the current code are load-bearing and must survive the move verbatim:**

1. **`pickFn` throws when it cannot resolve a function.** `mathml2omml` exports a named
   `mml2omml` and no default; Vite's browser interop can hand back the namespace object, which is
   not callable. A `||` chain yields an object and every equation silently degrades to stripped
   text — that is how `dfrac 1 16` reached a student. It must throw, not fall back.
2. **KaTeX, not temml.** temml's lexer breaks in the browser while working under Node, so the
   vitest suite stays green while the shipped file is wrong.
3. **`repairOmml` REFUSES markup Word would reject, and refusal degrades one zone to text.**
   Malformed OMML does not render badly — it makes Word decline to open the *whole file*.

### Migration rule

> **"Converge" means:** delete `gatErrorSetDocx`'s private copies of `MARKER`, `MATH_PR_BLOCK`,
> `pickFn`, `latexToOmml`, `mathRuns`, `contentTable` and the post-pack marker swap, and import
> them from `docxMath.js` instead. Identical behaviour, one implementation instead of two. A
> deletion, not a redesign.

**D1 — RULED (2026-09-12): converge both, as part of this work.** Sequencing, one reviewable
commit each:

1. **Extract `docxMath.js` by moving `practiceSetDocx`'s copy** — it is the original and carries
   the measurement comments. Repoint `practiceSetDocx`. Its suite is the guard.
2. **Repoint `gatErrorSetDocx`**, deleting its duplicates. Separate commit so it can be reverted
   without losing step 1.
3. **Build the exam report on `docxMath.js`** — net-new.

Steps 1 and 2 are reworks of shipped, working code, authorised 2026-09-12. Blast radius, recorded
here so the build does not have to re-derive it:

| | |
|---|---|
| **Scope** | Two files, both docx builders. No store, no schema, no API, no persisted key |
| **Downstream** | `ProjectedScoreCard.jsx` (practice set) and `ErrorSets/index.jsx` (error sets) — both call only the top-level `build*` function; neither imports a maths internal. `prettifyMath` moves out of `practiceSetDocx`, so its one cross-import in `gatErrorSetDocx` must be repointed, not dropped |
| **Does it really apply** | Yes — identical code, and the same fix has already had to be applied twice by hand |
| **Risk** | Silent degradation, not a crash: the failure mode is equations rendering as `dfrac 1 16` while every test stays green. `pickFn`'s throw is the only thing standing between a bad interop and a shipped file — **it must move verbatim** |
| **Reversibility** | Full. Both steps are pure refactors behind unchanged public functions; `git revert` restores either |
| **Verification** | The existing suites, **plus** a real-Word open of one practice set and one error set. A repair prompt is invisible to vitest, and that is exactly the class of bug this touches |

---

## 3. Document structure

Section-by-section against what `downloadExamPdf` emits today. "Same" means the same numbers from
the same analytics functions — every aggregate is already a pure exported builder
(`buildStatBoxes`, `buildAllStudentsTable`, `getExamTopStudents`, `getExamWrongQuestions`,
`getExamToppers`, `getExamScoreSummary`), and the Word builder **calls those, never re-derives
them.** A second implementation of "median" is how two surfaces end up quoting different numbers
to the same parent.

| # | PDF section | Word |
|---|---|---|
| 1 | Blue header band: institute, exam name, date/subject/batch/branch, marking scheme | Title block — shaded full-width table row. **Exam name verbatim** (see §5) |
| 2 | Class Overview — 5 colour-coded stat tiles | 5-column table, one shaded header row + one value row. Same colour thresholds via `pctColor` |
| 3 | Median · Students above 50% | One paragraph, same string |
| 4 | Top 5 / Bottom 5 students, side by side | Two tables stacked (side-by-side tables in Word means a wrapper table; not worth it) |
| 5 | Top 5 Most Wrong — summary table | Same table |
| 6 | Top 5 Most Wrong — question detail cards | **The point of the whole exercise.** Real Word equations, GFM tables as Word tables, options with the key in bold green |
| 7 | Top 5 Most Skipped — table + cards | Same |
| 8 | Topper Analysis (top 25%) — wrong + skipped, tables + cards | Same |
| 9 | All Students table (rank/name/score/%/correct/wrong/skipped), on its own page | Same, after a page break |
| 10 | Footer on every page: "LWS Pune · NDA Tracker · Generated <date>" + page number | Word footer, same text, native page-number field |

### The question card in Word

```
Q50 · Functions · Composition and Inverse of Functions            Wrong: 33 (66%)
────────────────────────────────────────────────────────────────────────────────
Let 𝑓(𝑥) be a polynomial function such that 𝑓∘𝑓(𝑥) = 𝑥⁴. What is 𝑓′(1) equal to?

 A) 0                                    B) 1
 C) 2   ← bold, green                    D) 4

Answer: C                                              Difficulty: Moderate
```

One bordered, shaded single-cell table per card — that is how you get a card outline in Word.
Header row shaded `FEE2E2` (wrong) / `FEF3C7` (skipped), matching the PDF and the on-screen card.

---

## 4. The two format branches

`examFormat(exam)` already decides this and the PDF already branches on it. **49 of 213 exams are
written** (no `questions[]`), so this is not an edge case.

- **MCQ** — everything above.
- **Written** — sections 5–8 do not exist by construction. The document would be title block, stat
  tiles (with "Max Marks" instead of "Questions"), median line, top/bottom, all-students: a
  near-clone of its PDF with no maths in it.

**D2 — RULED (2026-09-12): no. The Word button is MCQ-only.** A written exam has no question text,
so the Word file would carry nothing the PDF does not already carry well. Gate the button on
`examFormat(exam) === 'mcq'`, the same predicate the Exams page already uses for Update Results /
Update Tags / Integrity / Reports — so this adds a case to an existing branch rather than a new one.

**Consequence, stated plainly:** the Devanagari argument in §5.3 is now **out of scope** — all 10
non-Latin exam titles belong to written exams, which will have no Word export. Those reports get
nothing from this work, and the `pdfSafeExamLabel` fix logged in `SUGGESTIONS.md` is therefore the
**only** remedy for them, not a nice-to-have alternative.

---

## 5. What Word gets that the PDF cannot

These are the reasons to build it, in order of how concrete they are.

1. **Vector, editable equations.** The PDF now embeds *pictures* of KaTeX output: not selectable,
   not searchable, not editable, and the report grew from ~200 KB to ~1.0 MB. Word gets real OMML
   the teacher can click into and change.

2. **Worked solutions become possible.** `13,404 of 13,568` stored questions (98.8%) carry a
   `solution`, and the PDF prints **none** of them — there is no room on an A4 card and jsPDF
   could not typeset them anyway. A Word report can carry the solution under each of the five
   wrong questions. This is the largest unused asset in the exam record.
   **D3 — RULED (2026-09-12): yes, include them.** A checkbox defaulting **on**, mirroring
   `gatErrorSetDocx`'s `includeSolutions`. Two rules that come with it: a question with no recorded
   solution renders the explicit "No worked solution recorded" line rather than an empty paragraph
   (164 of 13,568 questions have none), and the solution is a full `mathRuns` block — solutions
   carry more maths than the stems do, so they cannot be a plain `TextRun`.

3. ~~**Devanagari titles print correctly.**~~ **OUT OF SCOPE** under D2 — all 10 non-Latin titles
   are written exams, which get no Word export. Kept here because the finding still stands and the
   `SUGGESTIONS.md` fix is now the only remedy. `10 of 213` exams are Marathi/Hindi language papers
   (`३. बेटा मी ऐकतो आहे`, `२. लक्ष्मी`). jsPDF's Standard-14 fonts are WinAnsi — 256 single-byte
   slots, no Devanagari — and it has no shaping engine, so even an embedded Unicode font would
   reorder matras and break conjuncts. `monthlyReportDocx.js` already solved this for the report
   card by setting `cs: 'Nirmala UI'` and letting Word shape the text, and the Monthly Reports page
   already shows a "Word shows these correctly" hint. **The same pattern applies here verbatim.**

   ⚠️ **Separate live bug found while writing this spec:** `examPdf.js`'s `drawHeader` prints
   `exam.name` **raw** — it never calls `pdfSafeExamLabel`, which `monthlyReportPdf.js` does use.
   So the class PDF for those 10 exams has a garbled title in the header band today. Logged in
   `SUGGESTIONS.md` as a backfill candidate; **not** fixed as part of this spec.

4. **No page-count anxiety.** The PDF caps every list at 5 because A4 runs out. Word does not.
   **D4 — RULED (2026-09-12): keep the top-5 caps.** Changing the selection rule would make the two
   documents disagree about what "most challenging" means, which is a content decision, not a
   format one. The Word builder calls `getExamWrongQuestions(exam, names, 5)` with the same `5` the
   PDF passes — **do not parameterise it** until there is a reason; an unused knob is where the two
   surfaces start to drift.

---

## 6. The conversion story

State it plainly in the UI, because the alternative is a support question every week:

1. Click **`📝 Word`** on the exam card → `<Exam Name>_insights.docx` downloads.
2. Open in Word → **File → Save as → PDF** (or **Export**).
3. LibreOffice also works; Google Docs does **not** — it drops OMML equations.

**Font caveat:** equations are set in **Cambria Math** and Devanagari in **Nirmala UI**, both
standard on Windows and on Word for Mac. A machine without them substitutes and the maths looks
wrong — this is the same exposure `practiceSetDocx` already carries.

---

## 7. UI

**D5 — RULED (2026-09-12): an `Export ▾` menu**, replacing the separate `📄 PDF` and `📋 Reports`
buttons on the exam card rather than adding a tenth control beside them.

```
Export ▾
  📄 PDF                class report, fixed layout          (all exams with results)
  📝 Word               class report, editable equations    (MCQ only — D2)
  📋 Student Reports    per-student breakdown               (MCQ only, unchanged)
```

Rules for the menu itself, since it is replacing working buttons:

- **An unavailable item is absent, not disabled.** A written exam's menu holds PDF alone. A
  greyed-out row invites the question "why can't I?" and there is no answer worth a tooltip.
- **Keyboard + focus.** It is a real menu: focus ring on the trigger, Escape closes, focus returns
  to the trigger. Per the accessibility rule, not as a nicety.
- **The busy state stays per-item**, not on the trigger — `pdfGenerating` and `reportsGenerating`
  are already separate, and Word adds a third.

Inside the menu, the Word item behaves as:

- same gating as the PDF (`exam.students.length > 0`) **plus** `examFormat(exam) === 'mcq'`, same
  disabled/spinner treatment, awaited (the PDF button's missing `await` was fixed on 2026-09-12).
- Progress: reuse the `onProgress(pct, label)` convention from `practiceSetDocx` — the build is one
  long synchronous CPU block (KaTeX per equation, then Packer, then the JSZip patch) and without
  awaited checkpoints the bar cannot repaint. For ~20 questions this is fast; with solutions on it
  is not free.
- ~~Non-Latin hint~~ — dropped with D2. It would only ever fire on written exams, which have no
  Word export.
- Error handling: `isStaleChunkError` / `STALE_CHUNK_MESSAGE`, as both other docx buttons do.

---

## 8. Test plan (test-first)

Pure, no docx package, no browser — the split the existing docx tests already use:

**`docxMath.test.js`** (the extraction)
- `prettifyMath` behaviour is unchanged — move the existing assertions across.
- `pickFn` **throws** when handed a module with no callable (pins the trap that shipped
  `dfrac 1 16`).
- `practiceSetDocx`'s existing suite is the real regression guard for the move; it must not change.

**`examReportDocx.test.js`** (pure shapers, mirroring `monthlyReportDocx`'s `docxExamRows` pattern)
- Aggregates come from the shared builders — assert the Word shaper *calls* `buildStatBoxes` /
  `buildAllStudentsTable` rather than re-deriving, so the two documents cannot diverge.
- The card shaper marks exactly one correct option, and none when the key is blank.
- A question with a GFM table yields a table block, not a wall of pipes.
- `examReportDocxFilename` sanitises to `[A-Za-z0-9_-]` — a title with an apostrophe, a slash or
  non-Latin characters must not produce a filename the browser rejects.
- Solutions present when the flag is on, absent when off; a question with no solution renders the
  "No worked solution recorded" line rather than an empty paragraph.

**The D2 gate needs its own test, in the page suite:** a written exam's `Export ▾` menu offers
**PDF only** — no Word item, and no *disabled* Word item either. Pin the absence, not the disabled
state; that is the difference the ruling turns on.

**Browser check (Definition of Done):** generate for one real MCQ exam, open it in Word, confirm
equations render as equations (not pictures, not `dfrac`), solutions appear under the wrong
questions, and the file opens **without a repair prompt**. The repair prompt is the failure mode
`repairOmml` exists to prevent, and it is invisible to every test. Then confirm a written exam's
menu has no Word item.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Word refuses to open the file (malformed OMML) | `repairOmml`'s refusal gate, already built and tested. Verify in real Word, not just by parsing the zip |
| The extraction breaks the practice set or error sets | One consumer per commit, each revertable; both suites are the guard; real-Word open of one of each before moving on. Full 360 in §2 |
| Two reports drift apart | Word calls the same exported builders. Do not re-implement an aggregate — that is the rule `whatsappResultScore.js` exists to enforce elsewhere |
| Nobody uses it and it rots | Cheap test: it replaces a step faculty already do by hand (retyping questions into worksheets). If that is not the actual need, **do not build it** — say so now |

---

## 10. Effort

| | |
|---|---|
| Extract `docxMath.js` + repoint `practiceSetDocx` | ~half a day, mostly verification |
| Repoint `gatErrorSetDocx` (D1) | ~2 hours + a real-Word check |
| `examReportDocx.js` + tests | ~1 day |
| UI (export menu, progress, hint, errors) | ~half a day |
| Browser verification in real Word, both formats | ~half a day |

Roughly **3 days**, with the two convergence steps as separately reviewable commits before any
exam-report code exists.

---

## 11. Decisions

| | Question | Ruling |
|---|---|---|
| **D1** | Converge `gatErrorSetDocx` onto `docxMath.js` in this work, or log it? | **In this work** (2026-09-12) — own commit, after the practice set. 360 in §2 |
| **D2** | Offer Word on written exams? | **No** (2026-09-12) — MCQ-only. Kills the Devanagari benefit; see §4 |
| **D3** | Include worked solutions? | **Yes** (2026-09-12) — checkbox, default on |
| **D4** | Keep the top-5 caps? | **Yes** (2026-09-12) — and do not parameterise the 5 |
| **D5** | New button, or an `Export ▾` menu? | **Menu** (2026-09-12) — replaces PDF + Reports, absent ≠ disabled |

### What D2 changed elsewhere in this spec

Worth reading as a set, because one "no" moved four things:

- §4 — the written branch is not built at all; the button is gated on `examFormat`.
- §5.3 — the Devanagari argument is struck through. **The `pdfSafeExamLabel` fix in
  `SUGGESTIONS.md` is now the only remedy for those 10 exams**, not one of two.
- §7 — the non-Latin hint is dropped; it could never fire.
- §8 — a new page-suite test pins that a written exam's menu has **no** Word item.
