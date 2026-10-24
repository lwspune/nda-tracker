# Grading homework

Teachers set homework on the **Homework** page (a question paper, or just a
description such as "RD Sharma Ex 3.2, Q1–10, as announced in class"). Students
hand in photos or a PDF from the portal before the deadline. A grade is shown to
the student **the moment it is saved** — there is no review step, so the check in
this file is the review. The one exception is a **handwriting mismatch** (below):
that grade is saved *held*, and the student sees it only when their teacher
releases it.

Read this file in full at the start of every grading session. Every new rule or
learning goes into the rule it changes here and into [`LEDGER.md`](./LEDGER.md),
so the 50th submission is graded the same way as the 5th.

## The usual way: "grade homework"

Say "grade homework" (or `/grade`) in a Claude Code session and the `grade`
skill (`.claude/skills/grade/SKILL.md`) runs the whole routine below. The
session is a coordinator and never reads page photos itself:

- it pulls, and writes **one marking scheme per homework**
  (`grading-inbox/_scheme/<homework id>/scheme.md`, by a `marking-scheme-writer`
  agent: worked answers, the rule-2 split, the key checked);
- it grades each submission in a **fresh `homework-grader` agent** (at most 3
  at once), against that scheme and the rules here;
- it reviews every grade, saves it, clears the inbox and reports.

One student's hand-ins are graded in deadline order, never side by side
(`_queue.json` `after`): the first one saved becomes their handwriting
reference. The steps below are what each part does, and the way to grade by
hand.

## The routine

1. `npm run grading:pull` fetches every waiting submission into
   `grading-inbox/<id>/` (git-ignored): `brief.md`, `paper/`, `key/`, `scans/`
   (the files as handed in), `pages/` (the same pages upright, PDFs split into
   pages), `grid/` (those pages under a labelled 0-100 grid), `reference/` (the
   student's handwriting reference, if any) and `grade.json`. Oldest first.
   It also clears folders already saved, rejected or replaced (step 9), and
   writes `grading-inbox/_queue.json`: the waiting submissions by homework, and
   whether two folders of one homework hold different papers (re-pull them).
   **A graded submission** is pulled by id: `-- --id=<id>` loads its saved
   grade into `grade.json` (to correct it), `-- --id=<id> --fresh` an empty
   template (to re-mark it without the old marks to lean on).
2. **Two or more submissions for one homework?** First run
   `npm run grading:hand-compare -- --assignment=<homework id>` and, in a
   session that does not grade, look through `grading-inbox/_hand/<id>/` for the
   same hand under two submission ids. Note the pairs; they become `mismatch`
   when those submissions are graded. A PDF hand-in lands there as a `.pdf`,
   which Read cannot show: look at that submission's `pages/01.jpg` instead.
3. Say: "Grade grading-inbox/<id> by scripts/grading/GRADING.md". One session
   may grade several submissions in turn. Mark each against the paper, the key
   and the rules here, never against the student graded before it.
4. Read `brief.md`, then the question paper (if any), the answer key (if any),
   then every page in `pages/` in order (upright, PDFs already split: there is
   no need for `pdf2png.py` any more). Images with Read. **A page still
   sideways?** `pages/` is turned upright only when the photo carries a rotation
   tag, and many phone photos have none. Turn it with
   `npm run grading:rotate -- <id> <page> left` before placing marks: `left`
   turns it anticlockwise (its right edge becomes the top), `right` clockwise.
   Any marks already on that page in `grade.json` move with it. Look at the
   grid copy again after turning: the first turn can go the wrong way.
   **Check the attached paper is the one the pages answer** before marking: a
   homework once carried the next homework's paper while every student
   answered the right one. **Before
   marking**, compare `pages/` with `reference/` and decide the handwriting
   check (see "Handwriting check" below).
5. Work out each answer yourself before marking. An answer key is the teacher's,
   and keys are sometimes wrong — if yours and the key disagree, re-derive, and
   note it in the ledger if the key was wrong. **No key?** Look the question up
   in PYQ Vault: `node scripts/grading/vault.js "phrase from the question"`
   prints matching board questions with their stored solutions (plain words work
   best; maths is stored as LaTeX). Run one phrase per call: through `npm run`
   on this machine the quoted phrases were joined into one search that matched
   nothing. Treat a vault solution like a teacher's key:
   it shows the steps and conditions a board answer is expected to state, but it
   can be wrong, and any correct method still gets full marks.
   **A marking scheme** (`npm run grading:scheme -- <homework id>` writes the
   template; `--check` says whether it is current and complete) does this work
   once per homework. Grade against it, but by the same terms as a key: any
   correct method earns full marks, and a scheme that looks wrong is reported,
   not followed.
6. Fill `grade.json`: the grades, then the `marks` on the pages (see "Marks on
   the pages" below), placed by reading positions off `grid/`.
7. `npm run grading:preview -- <id>` draws the marks onto `preview/NN.jpg` and
   builds `preview/report.pdf`, the report the student downloads (summary, then
   these pages). **Read every preview page.** These exact images are what the
   student sees. Any mark not where it belongs: fix its `x`/`y`
   and preview again. The commit refuses marks that were not previewed as they
   stand.
8. `npm run grading:commit -- <id> --dry` until the check passes, then
   `npm run grading:commit -- <id>`. The student sees it immediately — or, on a
   handwriting mismatch, it is saved HELD for their teacher (the script says so).
   A "fetch failed" is a network blip: check the submission's status in the
   database before treating it as refused.
9. **Delete the folder once it is saved** (faculty rule, 2026-10-22). When
   `grading:commit` says "Saved" or "Rejected", delete `grading-inbox/<id>/`:
   the grade, the marked pages and the report are in Supabase, and a re-mark
   pulls afresh (`-- --id=<id>`). Delete `grading-inbox/_hand/<homework id>/`
   once that homework has nothing left waiting. At the start of a session,
   delete any inbox folder whose submission is already graded, rejected or
   replaced in the database (`grading:pull` now does this itself). Never
   delete a folder still waiting to be graded.
   The machine's disk filled up twice (2026-10-17, 2026-10-22) partly from
   inbox folders that were never cleared.
10. Anything new learned: add it to the ledger below, in general terms.
11. Weekly: `npm run grading:purge -- --apply` (pages and marked pages go 30
    days after grading; the grade and its marks stay; handwriting references are
    never purged).

## grade.json

```json
{
  "submissionId": "…",
  "wentWell": "One or two specific things.",
  "nextSteps": "One or two concrete actions.",
  "handwriting": { "check": "match", "note": "" },
  "grades": [
    { "label": "Q1", "max": 5, "outcome": "scored", "awarded": 5, "earned": "Correct factorisation and answer.", "missing": "", "cause": "", "topic": "" },
    { "label": "Q2", "max": 5, "outcome": "scored", "awarded": 2.5, "earned": "Right method.", "missing": "Sign slip in the last line; no final value.", "cause": "careless", "topic": "" },
    { "label": "Q3", "max": 5, "outcome": "scored", "awarded": 1, "earned": "Correct final answer.", "missing": "No working: the product rule is not used.", "cause": "concept", "topic": "Product rule" },
    { "label": "Q4", "max": 5, "outcome": "not_attempted", "awarded": null, "earned": "", "missing": "", "cause": "", "topic": "" }
  ]
}
```

- **Labels** are the question numbers as the homework uses them (`Q1`, `3(b)`,
  `Ex 3.2 Q7`). If the teacher set a breakdown, `grade.json` already has those
  rows: keep the labels and maximums exactly. If not, write one row per
  question; the maximums must add up to the homework's total (equal shares
  unless some questions are clearly bigger — say how you split it in `nextSteps`
  only if it matters to the student). A question the teacher dropped from the
  breakdown (one the class has not been taught yet) is not marked, even if
  answered.
- `outcome`: `scored` (answered; 0 allowed) or `not_attempted` (nothing
  written for it).
- `cause` and `topic`: required on every question that lost marks, empty
  otherwise. See "Why marks were lost" below.
- `awarded`: halves only (0, 0.5, 1, …), never above `max`, `null` unless scored.
- Marks lost → `missing` is required. Marks given → `earned` is required. Full
  marks → `missing` must be empty.
- The checker refuses an unfilled template, a breakdown that does not add up to
  the total, a missing handwriting check, and a submission with nothing scored
  (that is a rejection).

## Marks on the pages (`marks`)

The student sees their own pages with your marks on them, as a teacher's red
pen would leave them, so they can see *where* each mark went without asking.
Each mark is one entry in `grade.json`'s `marks` list:

```json
"marks": [
  { "page": 1, "label": "Q1", "kind": "tick",   "x": 60, "y": 30 },
  { "page": 1, "label": "Q1", "kind": "score",  "x": 88, "y": 27 },
  { "page": 1, "label": "Q2", "kind": "circle", "x": 77.5, "y": 68, "w": 15, "h": 4 },
  { "page": 1, "label": "Q2", "kind": "note",   "x": 62, "y": 74, "text": "Say why you may divide: dx/dt is not 0", "to": { "x": 76, "y": 70 } },
  { "page": 1, "label": "Q2", "kind": "cross",  "x": 50, "y": 87 },
  { "page": 1, "label": "Q2", "kind": "score",  "x": 85, "y": 61 }
]
```

- `page` is the number of the file in `pages/` (`pages/02.jpg` is page 2).
  `x` and `y` are percent across and down that page: read them off `grid/`.
  For a circle, `x`/`y` is its centre and `w`/`h` its width and height.
- `label` is the question the mark belongs to, exactly as in `grades`.

| `kind` | Use it for | Rules |
|---|---|---|
| `score` | The question's marks, circled, beside its answer | **Exactly one** per scored question, none on one not attempted. No text: it prints the marks from the grade. |
| `tick` | A step that earned marks | Any question that was attempted. |
| `cross` | A wrong step or answer | Only on a question that lost marks. |
| `circle` | Around the exact place a mark was lost | Only on a question that lost marks. |
| `note` | What is wrong or missing, in at most 80 characters; `to` draws a line to the spot | Only on a question that lost marks. |

- **A question that lost marks needs a cross, circle or note at the step where
  they were lost.** Put it at the step itself, not at the question number.
- **Full marks: ticks and the score only.** Red crosses or notes beside full
  marks read as lost marks (the same reason `missing` must be empty there).
- Put notes and scores in **blank space** (margins, the gap after an answer),
  not over writing; use `to` to point from the note to the step. A note's
  `x`/`y` is its top-left corner and its text wraps at the page's right edge
  (never narrower than 30% of the page), so start it in a blank column wide
  enough for it. On an answers-only page, that is the column to the right of
  the scores; point `to` at the score so the line crosses no other answer.
- A note says the same as `missing`, shorter. It describes the answer, never
  the student.
- Notes print in Segoe UI Symbol, so write maths as maths (Δu ≠ 0, nπ, ⇒,
  x², m₁). It has **no superscript letters**: "(5/9)ˣ" or "⁴⁻ˣ" prints as boxes,
  so write the values instead ("5/9 and 4/9"). Never write "du" for an increment
  (it reads as a derivative) or "!=". Check every note in the preview.
- Place the score where the question's answer ends or in the margin beside it.

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
- Shared content is not a shared hand. The same proof word for word, or the
  same unusual slip (the same wrong unit, the same mislabelled step), in
  clearly different hands points to a shared source, not one writer: not a
  `mismatch`. Mark the work as written.
- A first graded homework becomes the student's reference **the moment it is
  saved**, so any other folder of theirs pulled before then has no
  `reference/` and the preview refuses `no_reference`. Re-pull it
  (`-- --id=<id>`) or compare against the pages just graded.
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
   final-answer share only (1 of 5, 0.5 of 2). This includes MCQs and questions
   that ask only for a value (rule 6).
4. **Any correct method gets full marks**, even if it differs from the key.
5. **Carry-forward:** a later step done correctly on an earlier wrong value gets
   its marks; the wrong step loses its own.
6. **MCQ:** a 1-mark MCQ is right or wrong; the option letter or its text is
   enough. An MCQ worth 2+ marks is marked as a calculation (rule 2): the letter
   or value alone earns the final-answer share only (rule 3). Two options marked,
   or a letter contradicting the text written: 0.
7. **Question numbers:** match an answer to its question by content when the
   student numbered it wrongly. Numbering that differs from the paper costs 0.5,
   **once per homework**, taken from the first renumbered question that has
   marks to lose; say which numbers were swapped in that row's `missing`.
8. **A page that cannot be read:** mark what can be read; for questions on that
   page write "Page N could not be read" in `missing`. If a third or more is
   unreadable, reject instead (see below).
9. **Units, labels and slips:** a final answer with missing or wrong units
   ("9 m" for 9 cm) loses 0.5 from the final-answer share. A wrong label or a
   slip in the working (the area written f′(x) instead of f(x), dy/dx written for
   dy/dt, 20/2 written for 20/9) loses 0.5 from the working share, **once per
   question**, even when the final answer is right. **Before deducting for a
   slip** (a sign, a digit, a limit), crop and enlarge that line and look again:
   at page scale f(−x) once read as f(x).
10. **A condition left out costs the same as a condition written wrong.** The
    condition or check is its own share (rule 2); leaving it out, or getting it
    wrong ("dx/dt = 0", "δx = 0", dividing one vector by another), loses that
    share even when the algebra reaches the right result. A hypothesis only
    restated as a given, never used as the reason for a step, does not earn it.
    A missing "hence" part scores 0 and the rest is graded; a "hence" worked on
    different functions from the ones asked also scores 0.
11. **A calculation states the fact it rests on before using it** (ΣP = 1,
    p + q = 1, E(X) = np, Var(X) = npq, m₁ + m₂ = −2h/b, F(x) = P(X ≤ x)). In a
    calculation that fact is the condition share (rule 2): using it without
    writing it ("np = 6" with no E(X) = np) loses that share as rule 10 does.
    When a question rests on several facts, the share is split between them in
    halves, as for a proof with two conditions.
12. **The deductions in rules 7, 9 and 11 stack**, but a question never goes
    below 0.

## Why marks were lost (`cause`, `topic`)

Every scored question that lost marks names **one** cause. The student's report
adds the lost marks up by cause ("−6 concept gaps, −2 careless") and builds its
"what to focus on" list from them, so the choice must be the same in every
session.

| `cause` | When | `topic` |
|---|---|---|
| `concept` | The idea is wrong: a wrong formula, property, rule or method, or a step that shows the idea is not understood. | **Required**: the idea to relearn, as a syllabus phrase ("Distributive property", "Angles in the same segment"). |
| `incomplete` | The approach is right but marks were lost for what is not written: steps, the reason or condition for a step (rules 10, 11), construction steps, the final statement. | **Required**: what to show ("Steps of construction", "The condition dx/dt ≠ 0"). |
| `careless` | The method is right and the student shows they know the step, but slipped: arithmetic, a sign, a copied number, units (rule 9), numbering (rule 7). They would catch it by rereading. | Optional. |
| `misread` | A different question was answered from the one set: a wrong value copied from the paper, the wrong quantity found. | Optional. |
| `mcq` | A 1-mark MCQ or one-value answer is wrong and there is no working to show why. If the working shows why, use that cause instead. | Optional. |

- **Two causes in one question:** choose the one that cost more marks. On a tie,
  the one to fix first: `concept`, then `misread`, then `incomplete`, then
  `careless`.
- **The same slip twice in one homework** is not careless: it is `concept`.
- **Full marks and `not_attempted`:** no cause, no topic. A question not
  attempted is counted separately in the report.
- `topic` is at most 60 characters, written for the student, with no question
  number and no judgement of the student.
- The cause is a category for the report. `missing` still describes the answer,
  never the student (see "Feedback style": no "careless" in the text).

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

- **Work handed in under the wrong homework** (Homework #2's pages filed under
  #1) is rejected, and the reason names the mix-up. Never move it between
  homeworks (faculty decision, 2026-10-22).
- **Incomplete before the deadline** (a whole question missing): reject,
  naming what is missing; the rejection reopens the upload. Only a whole
  missing question counts (a missing "hence" part is graded, rule 10).
  **After the deadline**, grade what is there and mark the missing questions
  `not_attempted`.

**After the deadline a rejected student cannot hand in again** — the upload is
closed. The commit script warns you. Then prefer grading what can be read over
rejecting.

## A replaced submission

A student can replace a hand-in until it is graded (2026-10-14). If
`grading:commit` says the submission **was replaced**, the student sent newer
pages after you pulled it: delete `grading-inbox/<id>/`, run `npm run grading:pull`
and grade the new one. Do not grade the old pages.

## Re-marking

A re-mark starts from an empty template (`grading:pull -- --id=<id> --fresh`),
never the saved grade: correcting a grade you can see anchors the new marks to
the old. After a homework's marks change, confirm the regrade in the database
(`homework_submissions.total_max` equals the new total for every graded row),
not by memory: one change was logged as done while six grades still had the
old total a day later.

## Privacy

Pages and grades are about a named student. `brief.md` deliberately names no
student; keep it that way. Never copy a student's answers, name or anything
identifying into the repo, this file or a commit. Ledger entries are general
("students often drop the constant of integration"), never about one submission.

## Ledger

The history of every rule and learning is in [`LEDGER.md`](./LEDGER.md), newest
first. Add each new one there, in general terms, AND write it into the rule above
that it changes: graders read this file, not the ledger.
