# Grading ledger

Every rule or learning from grading homework, newest first: date, what, and why.
It is the history behind `GRADING.md`. Each lesson that changes how work is
marked is ALSO written into the rule it changes there, so a grader reads the
rules and never needs this file. Entries are general ("students often drop the
constant of integration"), never about one submission.

- 2026-10-24: Grading runs through the `/grade` skill: one marking scheme per
  homework, one fresh grader agent per submission, the main session reviewing
  and alone saving. A grader in a fresh context re-read ~7M tokens for one
  submission where the shared session averaged ~29M, and no student is graded
  in the shadow of the one before. The ledger moved here; every lesson in it
  that was not yet a rule was written into GRADING.md.
- 2026-10-24: A note wraps at the page's right edge (at least 30% wide), from
  its top-left `x`/`y`. On an answers-only MCQ page, notes placed among the
  answers ran over them; the blank column right of the scores holds them.

- 2026-10-22: Check the attached paper against what the pages answer before
  marking. Daily Homework #4 carried the #5 paper, while every student answered
  the real #4; the attachment was replaced in storage and the grades marked
  against the right paper.
- 2026-10-22: Before deducting for a slip (a sign, a digit, a limit), crop and
  enlarge that line. At page scale f(−x) read as f(x) and nearly cost a student
  half a mark.
- 2026-10-22: Grading a student's first homework makes it their reference at
  once, so any other folder of theirs pulled earlier goes stale: the preview
  then refuses `no_reference` with no `reference/` to look at. Compare against
  the pages just graded, or re-pull.
- 2026-10-22: Work handed in under the wrong homework (Homework #2 pages filed
  under #1) is rejected, and the reason names the mix-up (faculty decision). Do
  not move it between homeworks.
- 2026-10-22: After `grading:rotate`, look at the grid copy again: the first
  turn can go the wrong way. `grading:commit` can fail on a network blip
  ("fetch failed"); check the database before treating it as refused.

- 2026-10-21: The note font has no superscript letters: "(5/9)ˣ" and "⁴⁻ˣ" print
  as boxes. Write the values instead ("5/9 and 4/9"); superscript digits (x², m₁)
  are fine. Check every note in the preview.
- 2026-10-21: The one-submission-per-fresh-session rule is removed (faculty
  decision): a session may grade several in turn. Each is still marked against
  the paper, key and rules alone, not against the previous student.

- 2026-10-21: A re-mark starts from an empty template (`grading:pull -- --id=<id>
  --fresh`), not the saved grade: correcting a grade you can see anchors the
  new marks to the old ones. The 34 grades saved before marked papers existed
  (Daily Homework #1 and #2) are re-marked this way.

- 2026-10-16: Page-mark notes were drawn in PIL's built-in font, which has no
  Greek, minus sign or ≠: "Δu ≠ 0" printed as empty boxes. Notes now use Segoe
  UI Symbol, so write maths as maths (Δu ≠ 0, nπ, ⇒). Never write "du" for an
  increment (it reads as a derivative) or "!=" (programmer's notation).
- 2026-10-16: `pages/` is upright only when the photo carries a rotation tag; a
  phone photo without one stayed sideways and was marked that way. Routine
  step 4 now checks orientation and turns the page with `grading:rotate`.
- 2026-10-16: A slip in the working costs 0.5 once per question, however many
  there are (rule 9): a dropped sign and missing brackets in the same answer are
  one deduction. A step is earned only when written: a proof that stops at a
  product of limits without writing them as dy/du and du/dx loses that step.
- 2026-10-16: The hand-compare pack copies PDF hand-ins as `.pdf`, which cannot
  be viewed as images; the same page is already upright in the submission's
  `pages/01.jpg` (routine step 2). Content shared across hand-ins (the same
  proof steps, word for word) is not a match on its own: compare letter shapes.

- 2026-10-16: Graded pages carry marks (ticks, crosses, circles, notes, one
  score per question), placed off `grid/` and checked in `grading:preview`
  before commit. Students see where each mark went instead of asking. Read
  `pages/`, not `scans/`: positions are percent of the prepared pages.

- 2026-10-16: Every question that lost marks names a `cause` (concept, careless,
  incomplete, misread, mcq), and a `topic` for concept and incomplete. It feeds
  the student's report: where the marks went and what to fix first. Grades saved
  before this have no causes; a regrade must add them.

- 2026-10-14: Stricter marking from Daily Homework #2 on (faculty decision): an
  MCQ worth 2+ marks needs working (rule 6), a calculation must write the fact it
  rests on (rule 11), slips in the working cost 0.5 (rule 9), and numbering that
  differs from the paper costs 0.5 once (rule 7, superseding the 2026-10-13 entry
  that kept renumbering free). Earlier homeworks keep their grades.
- 2026-10-14: A question the class has not been taught yet is left out by setting
  the homework's breakdown to the remaining questions and its total to match
  (Daily Homework #2: Q1 dropped, 25 → 20). An answer to the dropped question is
  not marked.

- 2026-10-14: After changing a homework's marks, confirm the regrade in the
  database (`homework_submissions.total_max` equals the new total for every
  graded row), not by memory. The 5 × 2 → 5 × 5 change below was logged as done,
  but six grades were still out of 10 a day later.
- 2026-10-14: The same unusual slip in several hand-ins (the same wrong unit, the
  same mislabelled step) in clearly different hands points to a shared source,
  not to one writer. It is not a handwriting `mismatch`; mark the work as written.
- 2026-10-13: Reject only when a whole question is missing. A question with only
  its "hence" part missing is graded, and the hence part scores 0. A hence part
  worked on different functions from the ones asked also scores 0: the asked
  answer is not on the page.
- 2026-10-13: When a proof has two conditions (e.g. the modulus for an acute angle
  AND b ≠ 0 or a + b ≠ 0 for the slopes formula), each carries half of the
  condition share. Writing the hypothesis only as a restated given, never used
  as the reason for a step, does not earn it.
- 2026-10-13: A shorter valid route earns full marks (rule 4). Proving
  dy/dx = (dy/dt)/(dx/dt) by the chain rule and dividing by dx/dt ≠ 0 is
  complete; δx → 0 as δt → 0 is needed only in the first-principles proof.

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

- 2026-10-14: Students can replace a hand-in until it is graded (two replacements).
  Grading whatever is waiting is still right — the newest is the one in the queue,
  and committing a replaced one is refused. An incomplete hand-in is still rejected
  as below; the student may also fix it themselves before you get to it.
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
