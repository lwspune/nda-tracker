# Results re-upload — completing an exam from its Evalbee sheet

**Status:** **BUILT 2026-09-12.** Spec written the same day; this document was kept in step with
what shipped. Verified against real Evalbee exports and click-verified in a real browser (§7).
**Touches:** `src/components/upload/ReuploadResultsModal.jsx`, `src/lib/excel.js`,
`src/lib/answerKeyCheck.js`, `src/components/upload/KeyMismatchPanel.jsx`,
`src/components/upload/Step1Upload.jsx`, plus two new pure libs.
**Companion:** [`CROSS_APP_SYNC.md`](./CROSS_APP_SYNC.md) §2 — this builds the second of that
spec's two "prerequisites on the tracker side", the one that was not built when the push landed.

---

## 1. The problem

`📊 Update Results` is the only path by which an Evalbee sheet reaches an exam that already
exists. It currently reads **three** things out of that sheet — students, question count, and
answer keys — and throws away everything else, including two facts nothing else in the app can
supply.

That was survivable while every exam was born in the upload wizard, which collects date, marking,
batch and branch at Step 2. It stopped being survivable when **PYQ Vault paper push** shipped
(`api/quiz-import.js` → `handlePaperPush`). A pushed exam is created as a draft with:

| field | pushed value | why |
|---|---|---|
| `date` | **today** | `exams.date` is `NOT NULL` and the vault does not know the exam date |
| `marking` | **`{correct: 4, wrong: -1}`** | a placeholder |
| `batch` / `branch` | **`null`** | tracker-side facts the vault does not hold |

[`CROSS_APP_SYNC.md`](./CROSS_APP_SYNC.md) §2 says these are "tracker-side facts… faculty complete
by hand". **There is no surface on which to complete them by hand.** An MCQ exam's admin toolbar
offers Update Results, Update Tags, Refresh from bank and Delete; none edits exam metadata.
`OfflineExamModal`'s edit view is written-only. The upload wizard cannot adopt a draft either —
`Step4Confirm` matches duplicates on **name + date**, and a vault title (`NDA Geography — Cloud
Test 1 (50 Q)`) never equals an Evalbee `Exam` cell (`Cloud Test 1`), so re-running the wizard
mints a *second* exam and loses the bank `questionId`s and diagrams.

**Live state, 2026-09-12** — all 9 pushed exams: `date = 2026-09-12`, `batch = null`,
`marking = +4/−1`, zero results. Their real dates span February to August; `NDA Geography — Cloud
Test 1` was conducted **2026-02-05**, seven months from its stored date.

Separately, and for **every** exam rather than just pushed ones:
[`ReuploadResultsModal.jsx:49-54`](src/components/upload/ReuploadResultsModal.jsx#L49-L54) lets the
sheet's `Q N Key` overwrite the stored answer **silently**. That also silently reverts a
`KeyMismatchPanel` decision faculty made at original upload.

---

## 2. What the Evalbee sheet actually carries

Measured against **210 real Evalbee exports** in `~/Downloads`, plus the workbook internals of two.

### 2.1 There is no date column

Columns are `Error? · Exam · Exam Set · Class? · Roll No · Name · Total Marks · Grade · Rank ·
Correct Answers · Incorrect Answers · Not attempted · <per-section subtotals> · Q N Options ·
Q N Key · Q N Marks`. No date cell, and `wb.Props` / `wb.Custprops` are empty.

**The date is in the filename**: `<Exam Name>_<YYYY-MM-DD>.xlsx`. It is the *conduct* date —
`Chemistry-Basic Concept l_2026-07-24.xlsx` matches the vault title's `(30 Q, 24-7-26)` exactly.
[`excel.js:77-78`](src/lib/excel.js#L77-L78) already parses it; the modal discards it.

### 2.2 The marking scheme is readable off the sheet, and verifiable

| check, over 210 files | result |
|---|---|
| exactly **one** distinct positive per-question mark value | **210 / 210** |
| **at most one** distinct negative value | **210 / 210** |
| `Σ(Q N Marks) == Total Marks`, every student | **210 / 210, zero exceptions** |

So `markCorrect = max(values)` / `markWrong = min(values, 0)` is not a heuristic on this data — it
is the scheme, read off directly, and the sum identity is an independent confirmation.

Observed schemes: `+4/0`, `+4/−1.33`, `+4/−0.83`, `+2.5/−0.83`, `+2/0`, `+1/0`, `+1/−0.33`.
**`+4/−1` — the value the push writes — did not occur once.**

### 2.3 What is NOT reliable: the count columns

`Chemistry-Basic Concept l_2026-07-24.xlsx`, Purva Jagdale: the row says `Correct Answers = 10`,
but her per-question marks sum to `88.68`, reachable only at **23** correct
(`23×4 − 4×0.83 = 88.68`). All 21 students in that file are affected, and all 17 in
`Chemistry - Mole Concept _2026-07-04.xlsx`.

`parseExcelFull` trusts those columns for `students[].correct/incorrect/notAttempted`, so
`exam_results.correct` disagrees with `exam_results.responses` on those exams. **Out of scope
here** — logged as a follow-up (§8). It matters to this spec only because it rules out the obvious
validator: any check of the form `correct × c + incorrect × w == Total Marks` inherits the bad
columns and **would have blocked a perfectly good file** (measured: 1 hard false-positive and 8
partial ones over the 210).

---

## 3. Scope

**In** — one new "Exam details" block on `ReuploadResultsModal`, applying to **every** MCQ results
re-upload, not only pushed drafts:

- **Date** — prefilled from the filename.
- **Marking** — prefilled from the sheet, verified, with a confirm when it moves an exam that
  already has results.
- **Batch + branch** — prefilled from `detectBatch` / `dominantBranch`, or from the stored values.
- **Subject** — a pushed GAT paper is currently mis-subjected (§8.5) and `subject` routes
  per-question analytics, so it is editable here too.
- **Answer-key conflict resolver** — reusing `KeyMismatchPanel`, resolved by the user per question.

**Out** — and deliberately:

- `name`, `maxMarks` — the vault title beats the Evalbee `Exam` cell, and `maxMarks` is MCQ-derived.
- The **re-grade action**. Choosing a stored key over Evalbee's asserts Evalbee graded that question
  wrongly, and the marks stay as graded. That remains unbuilt (`SUGGESTIONS.md`); this becomes its
  third trigger.
- The count-column bug (§2.3), `ReuploadTagsModal`'s symmetric silent `answer` overwrite, and
  clearing absence rows stranded by a batch change.

---

## 4. The rules (load-bearing)

1. **The fallback is the exam's stored value, never `today`.** When the filename carries no date,
   the field shows the exam's current date and says the file had none. A `today` fallback is
   indistinguishable from a real answer — [[feedback_silent_fallback_hides_edge_errors]].
2. **A marking change on an exam that has results must be acknowledged, not merely displayed.**
   `marking.correct` is the `examMaxMarks` denominator, so it moves every percentage on the
   Dashboard, Toppers, the projected score, the monthly report PDF and the WhatsApp result message.
3. **A scheme the two-number model cannot express is refused, not rounded.** More than one positive
   value, or more than one negative, means partial credit or a bonus question. Refuse and say so.
4. **A key conflict is resolved by the user, never swallowed.** Same mechanism as the wizard — the
   same component, the same default. This path does not get its own policy.
5. **Absence rows are a consequence of `batch`, and setting one has effects.** `syncExamAbsences`
   adds rows for the new batch's members and **never removes** rows stranded by the old one
   (it deletes only for students who now appear as attendees). Say so before saving.
6. **Nothing is applied that is not shown as `old → new`.** A field whose value is unchanged is not
   a change and gets no diff row.
7. **The batch picker must be able to display the batch this exam already carries.** Unlike the
   upload wizard, this surface edits exams that PREDATE the central batch namespace — live data
   holds `LWS_NDA_2Y_ (26-28)` while Settings offers `LWS_NDA_2Y_(26-28)_A`. Since the tag is
   rebuilt from the offered list on every toggle, a batch the list does not know is destroyed by the
   first click. Off-list selections are therefore appended to the list, rendered checked and flagged
   `off-list`, so they can be seen, kept, and deliberately removed
   ([[feedback_control_cannot_represent_value]]). **This was found by click-verifying, not by the
   47 unit tests** — see §7.

---

## 5. Design

### 5.1 `src/lib/excel.js` — additive only

`parseExcelFull` gains three fields. **`examDate` is unchanged** (it keeps its `today` fallback), so
`Step1Upload` / `Step2Review` / `useImportFlow` behave exactly as today and need no edit.

```js
examDateFromFile: '2026-02-05' | null,   // the filename date; null when the name carries none
markValues: [-0.83, 0, 4],               // distinct per-question mark values, ascending
totalsReconcile: {                       // Σ(Q N Marks) vs Total Marks, per student
  checked: 21, ok: 21,
  failed: [{ name, sheetTotal, sumOfMarks }]   // capped at 5 for display
}
```

The parser emits **facts**; it makes no judgement. `markValues` and `totalsReconcile` are computed
in the loop that already walks the `Q N Marks` columns. Neither is persisted — they live on the
parsed object, never on `exam.students[]`, so nothing reaches `buildResultRows` or the dev JSON.

### 5.2 `src/lib/markingCheck.js` — new, pure

```js
assessMarking({ markValues, totalsReconcile }) → {
  correct, wrong,
  status: 'verified' | 'warn' | 'refuse',
  detail: string
}
```

| condition | status | consequence |
|---|---|---|
| one positive, ≤ one negative, all totals reconcile | `verified` | green line: `+4/−1.33 · reconciles for 26 of 26 students` |
| totals fail for **some** students | `warn` | amber; Save allowed (dropped/bonus questions legitimately break individual rows) |
| totals fail for **all** students, or **>1** positive, or **>1** negative | `refuse` | red; **Save disabled**, marking fields explain why |

Measured false-positive rate of the `refuse` branch on 210 real files: **zero**.

### 5.3 `ReuploadResultsModal` — the "Exam details" block

Rendered once a file parses, above the existing student diff. Seeded with the
**seed-on-key-in-render** pattern `OfflineExamModal` already uses (keyed on `exam.id` + the parsed
file), *not* a `useEffect` — a re-render must not clobber what is being typed.

| field | control | default |
|---|---|---|
| Date | `<input type="date">` | `examDateFromFile ?? exam.date`; badge `from file` when the former, else the hint *"this file's name carries no date"* |
| Marks — Correct / Wrong | two `<input type="number" step="0.01">` | `assessMarking().correct / .wrong` |
| Batches | chips, `visibleBatchOptions` + the `syllabusBatches.filter(...).join(', ')` order rule | `exam.batch` when set, else `detectBatch(students, profiles).batch` |
| Branch | `<select>` of profile branches | `exam.branch` when set, else `dominantBranch(profiles)` |
| Subject | `<select>` over `SUBJECTS` | `exam.subject`, else `'Maths'`. Guarded the way `Step2Review` guards it — a value outside `SUBJECTS` must not render as a silently-wrong first option ([[feedback_control_cannot_represent_value]]) |

A **Changes** list renders every field where the new value differs from the stored one, as
`Date  2026-09-12 → 2026-02-05`. Three conditional riders:

- **Marking changed AND `exam.students.length > 0`** → a required checkbox:
  *"I understand this changes every percentage for this exam — Dashboard, Toppers, projected score,
  the monthly report PDF and the WhatsApp result message."* Save is disabled until it is ticked.
  A pushed draft has no results, so it never sees this.
- **Batch changed AND the exam already had a batch** → an amber note that absence rows filed under
  the previous batch are **not** removed (rule 5).
- **`assessMarking().status === 'refuse'`** → Save disabled, reason shown.

### 5.4 The answer-key resolver

`findKeyMismatches(exam.questions, answerKeys)` works **unchanged** — it reads only `.q` and
`.answer`, which is exactly the shape of `exam.questions[]`. The only edits are cosmetic, so the
panel can name the non-Evalbee side honestly:

- `answerKeyCheck.js` — rename the output field `tagsAnswer` → `storedAnswer`.
- `KeyMismatchPanel.jsx` — `source="tags"` → `source="stored"`, plus a `storedLabel` prop
  (default `'Tags'`, so the wizard renders identically).
- `Step1Upload.jsx` — follow the rename (`m.tagsAnswer`, `'tags'` choice value). The
  `keyMismatches` payload it passes to `onNext` has **no downstream consumer**, so the rename is
  contained to these three files and their two test files.

In the modal: the panel renders as soon as the file parses (no two-phase gate — parsing already
happens on file select, and Save is a separate button), with the **same default as the wizard**:
the results/Evalbee key. Non-conflicting keys keep today's behaviour — the sheet's key fills a blank
or confirms what is there.

`storedLabel` is **one panel-level label**: `'Bank'` when the exam carries any PYQ Vault ids, else
`'Stored'`. Per-row labelling was considered and rejected as more machinery than the case warrants —
exams are effectively all-or-nothing today (a pushed paper is 100% bank-linked; a tags-file exam is
0% or 100%). Revisit if partially-linked exams become common, e.g. after a partial
`ReuploadTagsModal` merge.

Where a **stored** key is chosen, a line under the panel states that the marks for those questions
were graded against the other key and are not corrected here.

### 5.5 Save

```js
replaceExam(exam.id, {
  ...exam,
  date, marking: { correct, wrong },
  batch: batch || null, branch: branch || null, subject: subject || 'Maths',
  students: newStudents,
  questions: resolvedQuestions,
}, { syncAbsences })
```

Spread-first, exactly as `OfflineExamModal.buildExam` does, so `source`, `createdBy`, `questionId`,
`imageUrl` and everything else this modal does not edit survive the round-trip.

`syncAbsences` becomes a checkbox **defaulted on** — today's behaviour exactly, plus an escape when
you are only correcting marks and don't want the absence set recomputed. Mirrors
`OfflineExamModal`'s "Flag absentees" control, so it is an established pattern rather than a new
one. Its label names the consequence, and when a batch change is pending it carries the stranded-row
note from rule 5.

---

## 6. Blast radius

| change | reaches |
|---|---|
| `exam.date` | `filterValidExams` (`exam.date >= regDate`), the `regDate` gate inside `getExamAbsentees` ([filters.js:98](src/lib/analytics/filters.js#L98)), recency weights in `chapterStats`, monthly-report windows, exam ordering, `exams.date` |
| `marking.correct` | `examMaxMarks` → **every %-of-max**: Dashboard, Toppers, `computeProjectedScore`, monthly report, `whatsappResultScore`, the student portal |
| `marking.wrong` | the positive/negative split in `studentReportPdf` + `ExamHistoryTable`, the scheme label on the Exams card and in `examPdf` |
| `batch` | `getExamAbsentees` (returns `[]` while it is null — the absence WhatsApp flow is **inert** for every pushed exam today), `getExamsForBatch` fallback, the Exams card |
| `branch` | `getExamsForBranch` fallback |
| `questions[].answer` | displayed correct answer, solution, per-question analytics. **Never marks** — those stay Evalbee's verdict |

Marks are untouched throughout. The grading invariant holds.

---

## 7. Test plan (test-first)

**`src/lib/__tests__/excel.test.js`**
- filename with a date → `examDateFromFile` is that date; without → `null`; `examDate` unchanged in both.
- `markValues` is distinct + ascending; `totalsReconcile` counts a deliberately broken total.

**`src/lib/__tests__/markingCheck.test.js`** (new)
- `verified` / `warn` / `refuse` for each branch in the §5.2 table.
- a two-positive-value sheet refuses rather than picking the larger.
- **regression fixture from the real data**: `{0, 4, −0.83}` with all totals reconciling must return
  `verified` — the case a count-column-based check wrongly rejected.

**`src/lib/__tests__/answerKeyCheck.test.js`** — the rename, and that `exam.questions[]` is accepted
as input unchanged.

**`src/components/upload/__tests__/KeyMismatchPanel.test.jsx`** — `storedLabel` defaults to `Tags`.

**`src/components/upload/__tests__/ReuploadResultsModal.test.jsx`**
- the date field prefills from the file; falls back to `exam.date`, **never today**, when absent.
- marking prefills from the sheet; `refuse` disables Save.
- marking differs + exam has results → Save disabled until the checkbox is ticked; with **no**
  results the checkbox is absent entirely.
- a key conflict renders the panel; the Evalbee key is preselected; picking `stored` keeps the
  stored letter in the saved `questions[]`.
- `replaceExam` is called with date, marking, batch, branch, subject **and** `source`/`createdBy`
  intact.
- unchanged fields produce no diff rows.
- a `subject` outside `SUBJECTS` does not render as a silently-wrong first option.
- the absence checkbox is on by default and its state reaches `replaceExam` as `{ syncAbsences }`.

**`src/components/upload/__tests__/Step1Upload.test.jsx`** — unchanged behaviour after the rename.

### What was actually verified (2026-09-12)

**Suite:** 193 files / 3027 tests green, serialized. `npm run lint` unchanged from baseline
(28 problems before and after, none in the touched files).

**Against the real exports**, via a throwaway vitest harness driving `parseExcelFull` +
`assessMarking` + `findKeyMismatches` over files on disk — synthetic fixtures can agree with a wrong
implementation, so this ran the real pipeline over real bytes:

| file | result |
|---|---|
| `Cloud Test 1_2026-02-05.xlsx` | date `2026-02-05`; scheme `+4/0` **verified 58/58 students**; the **Q19** bank-vs-Evalbee conflict found (`B` vs `A`) |
| `Chemistry-Basic Concept l_2026-07-24.xlsx` | **accepted** — sum identity holds at `+4/−0.83` although its count columns are wrong |
| 4 further exports | `+4/0`, `+4/−1.33`, `+2.5/−0.83`, `+2/0` each read and verified |

**In a real browser** (headless Chrome over CDP against `npm run dev`, admin mode): attached
`Cloud Test 1_2026-02-05.xlsx` to the `Maths Quiz 2` exam (`+1/0`, 13 results, 50 Q) and confirmed
end to end — date `2026-04-22 → 2026-02-05`, marking `+1/0 → +4/0`, the diff listing exactly those
two, `reconciles for 58 of 58 students`, **39** key conflicts surfaced rather than swallowed, Save
disabled until the marking tick, the "marks are not corrected" warning on choosing a stored key, and
the saved row on disk carrying the new date, marking and 58 students with `questions[]`, chapters
and the chosen `B` key intact.

**That browser pass is what caught rule 7** — the off-list batch bug was invisible to all 47 unit
tests because the test fixtures only ever used batches that were in the central list. Fixed, with
three regression tests, and re-verified in the browser.

---

## 8. Follow-ups — filed in `SUGGESTIONS.md` under 2026-09-12

1. **`students[].correct/incorrect/notAttempted` can contradict `responses`** (§2.3) — filed.
2. **`ReuploadTagsModal` has the same silent `answer` overwrite** in the other direction
   ([line 83](src/components/upload/ReuploadTagsModal.jsx#L83)) — filed; third instance of one hole.
3. **Batch chips are now a 4th copy** of the same JSX — filed, and sharpened by rule 7: three of the
   four copies carry the off-list data-loss path this one fixed.
4. **Stale absence rows after a batch change** are left in place by design; there is no surface that
   surfaces or clears them. Not filed — it is a consequence of `syncExamAbsences`, not of this work,
   and the modal now warns about it.
5. **`NDA GAT — Atmosphere & Parts of Speech P1` was pushed as `subject: 'English'`** though it spans
   Geography and English. Fixable in-app once this ships (§5.3); worth checking whether the vault's
   push should send `'GAT'` for a multi-subject paper rather than the first subject it sees.

---

## 9. Decisions taken

| question | decision | date |
|---|---|---|
| Which side does the key resolver preselect? | The results/Evalbee key — the same mechanism and the same default as the wizard. This path gets no policy of its own. | 2026-09-12 |
| Marking on an exam that already has results | Prefilled from the sheet, with a required acknowledgement when it differs. | 2026-09-12 |
| Batch + branch | In scope — the modal becomes the "complete the draft" surface. | 2026-09-12 |
| Verify the marking scheme? | Yes, and **refuse** Save on a scheme the model cannot express. Built on the sum identity + scheme shape, **not** on the count columns, which are unreliable (§2.3) and would have produced false positives. | 2026-09-12 |
| Subject | In scope. | 2026-09-12 |
| `syncAbsences` | Checkbox, defaulted on. | 2026-09-12 |
| `storedLabel` on a mixed exam | One panel-level label; `'Bank'` when the exam carries any vault ids. | 2026-09-12 |
