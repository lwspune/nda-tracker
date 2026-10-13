# Grading homework

Teachers set homework on the **Homework** page (a question paper, or just a
description such as "RD Sharma Ex 3.2, Q1–10, as announced in class"). Students
hand in photos or a PDF from the portal before the deadline. A grade is shown to
the student **the moment it is saved** — there is no review step, so the check in
this file is the review. The one exception is a **handwriting mismatch** (below):
that grade is saved *held*, and the student sees it only when their teacher
releases it.

Read this file in full at the start of every grading session. Every new rule or
learning goes in the ledger at the bottom, so the 50th submission is graded the
same way as the 5th.

## The routine

1. `npm run grading:pull` fetches every waiting submission into
   `grading-inbox/<id>/` (git-ignored): `brief.md`, `paper/`, `key/`, `scans/`,
   `reference/` (the student's handwriting reference, if any) and `grade.json`.
   Oldest first.
2. **Two or more submissions for one homework?** First run
   `npm run grading:hand-compare -- --assignment=<homework id>` and, in a
   session that does not grade, look through `grading-inbox/_hand/<id>/` for the
   same hand under two submission ids. Note the pairs; they become `mismatch`
   when those submissions are graded.
3. **One submission per fresh session.** Say: "Grade grading-inbox/<id> by
   scripts/grading/GRADING.md". Never grade two in one session: one student's
   answers must not colour another's grade.
4. Read `brief.md`, then the question paper (if any), the answer key (if any),
   then every page in `scans/` in order. Images with Read. A PDF cannot be read
   directly on this machine (no poppler): first run
   `python -E -P scripts/grading/pdf2png.py grading-inbox/<id>/scans/01.pdf`,
   which writes `01-p01.png`, `01-p02.png`, … beside it, then read those. **Before marking**, compare `scans/` with `reference/` and decide the
   handwriting check (see "Handwriting check" below).
5. Work out each answer yourself before marking. An answer key is the teacher's,
   and keys are sometimes wrong — if yours and the key disagree, re-derive, and
   note it in the ledger if the key was wrong. **No key?** Look the question up
   in PYQ Vault: `npm run grading:vault -- "phrase from the question" ["another"]`
   prints matching board questions with their stored solutions (plain words work
   best; maths is stored as LaTeX). Treat a vault solution like a teacher's key:
   it shows the steps and conditions a board answer is expected to state, but it
   can be wrong, and any correct method still gets full marks.
6. Fill `grade.json`.
7. `npm run grading:commit -- <id> --dry` until the check passes, then
   `npm run grading:commit -- <id>`. The student sees it immediately — or, on a
   handwriting mismatch, it is saved HELD for their teacher (the script says so).
8. Anything new learned: add it to the ledger below, in general terms.
9. Weekly: `npm run grading:purge -- --apply` (pages go 30 days after grading;
   the grade stays; handwriting references are never purged).

## grade.json

```json
{
  "submissionId": "…",
  "wentWell": "One or two specific things.",
  "nextSteps": "One or two concrete actions.",
  "handwriting": { "check": "match", "note": "" },
  "grades": [
    { "label": "Q1", "max": 5, "outcome": "scored", "awarded": 5, "earned": "Correct factorisation and answer.", "missing": "" },
    { "label": "Q2", "max": 5, "outcome": "scored", "awarded": 2.5, "earned": "Right method.", "missing": "Sign slip in the last line; no final value." },
    { "label": "Q3", "max": 5, "outcome": "not_attempted", "awarded": null, "earned": "", "missing": "" }
  ]
}
```

- **Labels** are the question numbers as the homework uses them (`Q1`, `3(b)`,
  `Ex 3.2 Q7`). If the teacher set a breakdown, `grade.json` already has those
  rows: keep the labels and maximums exactly. If not, write one row per
  question; the maximums must add up to the homework's total (equal shares
  unless some questions are clearly bigger — say how you split it in `nextSteps`
  only if it matters to the student).
- `outcome`: `scored` (answered; 0 allowed) or `not_attempted` (nothing
  written for it).
- `awarded`: halves only (0, 0.5, 1, …), never above `max`, `null` unless scored.
- Marks lost → `missing` is required. Marks given → `earned` is required. Full
  marks → `missing` must be empty.
- The checker refuses an unfilled template, a breakdown that does not add up to
  the total, a missing handwriting check, and a submission with nothing scored
  (that is a rejection).

## Handwriting check

Catches someone else writing a student's homework. Each student's **reference**
is their first graded homework (`reference/` in the inbox folder). Compare the
pages *before* marking, and record one of:

| `check` | When | What happens |
|---|---|---|
| `match` | Same hand as the reference | Released as usual |
| `unclear` | Can't tell: blurry, angled, too little writing | Released; the teacher sees your note |
| `mismatch` | A different hand from the reference, or the same hand as another student's submission (step 2) | **Held**: the student sees "waiting to be graded" until their teacher releases it or sends it back |
| `no_reference` | No `reference/` folder (their first graded homework) | Released; this one becomes their reference |

- **Never let the check change the marks.** Grade the work as written either way.
- **Compare letter shapes, not neatness**: how `a`, `g`, `y`, `t`, `f` and the
  digits `4`, `7`, `9` are formed, slant, joins, how `=` and fractions are
  drawn. Rushed and neat writing by the same person still share these.
  Pen colour, paper and page layout prove nothing.
- `mismatch` and `unclear` need a `note` (300 characters at most) the teacher
  can check in a minute: name what differs ("g and y have closed loops here,
  open tails in the reference; digits slant the other way").
- It is a lead, never proof — the teacher decides. Mark `mismatch` only for a
  clear difference; when unsure, `unclear`.
- Without a reference the only finding possible is the class-wide one
  (`mismatch`, "Same handwriting as another submission for this homework").

## Homework with no question paper

The description names the questions ("Ex 3.2, Q1–10"). Students usually copy the
question before answering; take the wording from their pages. If a question
cannot be identified from the description and the pages, grade what was written
and say in `missing` that the question could not be matched. Work every answer
out yourself — without a paper there is often no key either.

## Marking rules

1. **Mark what is written, not what was meant.** Never fill in a skipped step
   because the next line implies it.
2. **Steps carry the marks.** A 1-mark question or an MCQ is right or wrong.
   Every other question is split the same way, so two sessions give the same
   answer the same mark. A 5-mark question (the default since 2026-10-13):

   | Question | Split |
   |---|---|
   | Calculation | method 1 · working 2 · condition or check 1 · final answer with units 1 |
   | Proof | setup (what is given, the right definition or formula) 1 · key steps 2 · the condition that makes a step legal 1 · conclusion 1 |
   | Prove …, hence find … | proof 3 (setup 1, steps 1, condition 1) · hence 2 (working 1, answer 1) |

   A "condition or check" is what makes the answer valid: dx/dt ≠ 0, δx → 0 as
   δt → 0, "AR and RB point the same way", the second-derivative test for a
   maximum. Where a question has none, its mark goes to working. A 2-mark
   question: method and working 1 · condition or check 0.5 · final answer 0.5.
   Any other maximum: keep these proportions, in halves.
3. **A correct answer with no working**, on a question worth 2+ marks, gets the
   final-answer share only (1 of 5, 0.5 of 2), unless the question asks only for
   a value.
4. **Any correct method gets full marks**, even if it differs from the key.
5. **Carry-forward:** a later step done correctly on an earlier wrong value gets
   its marks; the wrong step loses its own.
6. **MCQ:** the option letter or its text is enough. Two options marked, or a
   letter contradicting the text written: 0.
7. **Question numbers:** match an answer to its question by content when the
   student numbered it wrongly. This costs no marks, so say so in `nextSteps`,
   never in `missing`: the portal prints `missing` as a red ✗, and the checker
   refuses it on a full-marks question.
8. **A page that cannot be read:** mark what can be read; for questions on that
   page write "Page N could not be read" in `missing`. If a third or more is
   unreadable, reject instead (see below).
9. **Units and labels:** a final answer with missing or wrong units ("9 m" for
   9 cm) loses 0.5 from the final-answer share. A wrong label in the working (the
   area written f′(x) instead of f(x)) costs nothing; mention it in `nextSteps`.
10. **A condition left out costs the same as a condition written wrong.** The
    condition or check is its own share (rule 2); leaving it out, or getting it
    wrong ("dx/dt = 0", "δx = 0", dividing one vector by another), loses that
    share even when the algebra reaches the right result.

## Feedback style

- Plain English, short sentences, at most two per field. The students are
  15–19 and preparing for NDA; write so a parent reading over their shoulder
  understands it too.
- Name the exact step: "d/dx of sec x is sec x tan x, not tan x", not "check
  your calculus".
- `wentWell` is specific and true. Never empty praise.
- `nextSteps` is one or two actions for this week, tied to what lost the most
  marks.
- Never judge the student ("careless", "weak"). Describe the answer.

## Rejecting a submission

`npm run grading:commit -- <id> --reject="…"` when a third or more is unreadable,
it is blank, or it is not the student's answers (a textbook photo, the question
paper itself). The reason must tell the student what to do: "Pages 2 and 3 are
too dark to read. Retake them in daylight, flat, one page per photo."

**After the deadline a rejected student cannot hand in again** — the upload is
closed. The commit script warns you. Then prefer grading what can be read over
rejecting.

## Privacy

Pages and grades are about a named student. `brief.md` deliberately names no
student; keep it that way. Never copy a student's answers, name or anything
identifying into the repo, this file or a commit. Ledger entries are general
("students often drop the constant of integration"), never about one submission.

## Ledger

Newest first. One line each: date, rule or learning, and why.

- 2026-10-13: A PDF hand-in could not be opened at all (the reader needs poppler,
  which is not installed). `scripts/grading/pdf2png.py` renders it with PyMuPDF;
  routine step 4. Run it with `-E -P`, not `-I`: isolated mode hides PyMuPDF.

- 2026-10-13: Homework with no answer key can be checked against PYQ Vault's stored
  board solutions (`npm run grading:vault`, routine step 5). Daily Homework #1's
  angle-between-lines proof is there as a 2023 board question, with the
  conditions a full answer states.

- 2026-10-13: Questions are worth 5 marks by default (the editor starts each row
  at 5), with a fixed split per question type (marking rule 2). At 2 marks the
  split was too coarse to tell answers apart, and two sessions left the
  final-answer share undefined. Daily Homework #1 was converted from 5 × 2 to
  5 × 5 and every submission regraded on the new split.
- 2026-10-13: Leaving out a condition costs the same as writing it wrong (marking
  rule 10). The first batch was marked both ways: an omitted dx/dt ≠ 0 lost marks
  on one question while an omitted "AR and RB point the same way" lost none on
  another.
- 2026-10-13: Units missing or wrong in a final answer cost 0.5; a wrong label in
  the working costs nothing (rule 9). One answer lost marks for both before
  there was a rule.
- 2026-10-13: A renumbered answer's note goes in `nextSteps`, never `missing`: the
  portal showed a student a red ✗ beside full marks. The checker now refuses
  `missing` on a full-marks question.
- 2026-10-13: In a proof, the condition that makes a step legal (dx/dt ≠ 0, δx → 0
  as δt → 0, "AR and RB are in the same direction") carries half a mark. A slip there
  ("dx/dt = 0", "δx = 0", or dividing one vector by another) loses that half, even
  when the algebra reaches the right result. (At 5 marks it carries 1; see rule 2.)
- 2026-10-13: Handwriting check added. Grades are no longer ALWAYS auto-released:
  a `mismatch` is saved held until the homework's teacher (or an admin) releases
  it or sends it back. References are each student's first graded homework, kept
  until faculty delete them by hand.

- 2026-10-13: An incomplete hand-in (some questions missing) before the deadline:
  reject it, naming what is missing. A waiting submission blocks a second upload,
  and a rejection reopens it until the deadline. After the deadline, grade what is
  there and mark the missing questions `not_attempted`.
- 2026-10-13: "Prove …, hence find …" questions: split the marks between the proof
  and the "hence" part, so a student who skips the second part keeps the proof marks.

- 2026-10-12: Playbook adapted from PYQ Vault's `scripts/grading/GRADING.md`
  (board answer sheets). Dropped its OR-choice and attempt-any-N rules (homework
  has neither); added description-only homework and auto-release (no teacher
  review before the student sees the grade).
