---
name: grade
description: Grade every homework submission waiting in the queue, end to end. Use when the owner says "grade homework", "grade the homework", "grade submissions" or /grade. Pulls, writes one marking scheme per homework, runs one grader agent per submission (at most 3 at once), reviews each grade, saves it, clears the inbox and reports.
---

# Grade homework

You are the coordinator. You never read a student's page photos yourself, apart
from a cropped line when settling a dispute: that is what keeps this session
small, and the grader agents start fresh for every student. You alone save
grades, edit the ledger and delete folders. Grades are released to the student
the moment they are saved (held ones excepted), so your review is the review.

Owner rules this runs under (global CLAUDE.md, 2026-10-24): at most **3 agents
running at once**; agents draft, never save; every brief says "keep tool
output small".

## 1. Pull

1. Read `scripts/grading/GRADING.md` from "## grade.json" to "## Ledger" (the
   rules you review against). You do not need the routine or the ledger.
2. `npm run grading:pull`. It clears finished folders, pulls what is waiting
   and writes `grading-inbox/_queue.json`. Note the MB it says it freed.
   Nothing waiting: say so and stop.
3. Read `_queue.json`. For a homework with `fingerprintConflict: true`, re-pull
   each of its submissions with `npm run grading:pull -- --id=<id>`, then pull
   again. Still in conflict: leave that homework, and tell the owner.

## 2. One marking scheme per homework

For each homework in the queue:
1. `npm run grading:scheme -- <homework id> --check`. Passes: go to step 3.
2. Otherwise `npm run grading:scheme -- <homework id>`, then start a
   `marking-scheme-writer` agent with the homework id. Write schemes for
   different homeworks in parallel (within the cap of 3).
3. Read the scheme (text). For each line under "Key check", and anything the
   writer reported as unsure, re-derive the answer yourself. Correct the scheme
   if needed, then `--check` again. A homework whose scheme you cannot settle
   is left ungraded; tell the owner.

## 3. Handwriting across hand-ins

For a homework with 2 or more submissions:
`npm run grading:hand-compare -- --assignment=<homework id>`, then start a
`general-purpose` agent with this brief:

> Look through `grading-inbox/_hand/<homework id>/` (read its README first).
> Find any two submission ids written in the same hand. Compare letter shapes
> (how a, g, y, t, f and the digits 4, 7, 9 are formed, slant, joins, = and
> fraction bars), never neatness, pen or layout. The same steps word for word,
> or the same unusual slip, in clearly different hands is NOT a match. A PDF
> hand-in cannot be viewed there; read `grading-inbox/<id>/pages/01.jpg`
> instead. Do not grade. Keep tool output small. Final message only: one line
> per pair, `<id> <id> — what matches`, or `none`.

## 4. Grade

Start one `homework-grader` agent per submission, at most 3 running at once,
the oldest homework first. Each message gives the submission folder, the
scheme path and that submission's hand-compare finding (its pairs, `none`, or
`not run`).

Order within the queue: never start a submission while its `after` (the same
student's earlier hand-in) is unsaved. One with `repullFirst: true` is re-pulled
first, `npm run grading:pull -- --id=<id>`, because the earlier one has just
become the student's handwriting reference.

When a grader reports, review it (step 5) before starting the next one in its
place.

## 5. Review and save

For each report:
- `paper-mismatch` from two graders of one homework: stop that homework and
  tell the owner (the 2026-10-22 #4/#5 mix-up). From one: open that
  submission's page 1 and decide whether it is work handed in under the wrong
  homework, which is rejected naming the mix-up.
- `blocked`: read why. Fix what is yours to fix (re-pull, rotate) and start a
  new grader for it, or leave it for the owner.
- `ready`: read its `grade.json` (text, never the pages) against the scheme and
  the rules:
  - the rows match the breakdown, and every lost mark has `missing`, `cause`,
    and a `topic` where the cause needs one
  - each "departed from scheme" line holds up by the rules
  - the handwriting check agrees with the hand-compare pairs, and a `mismatch`
    or `unclear` has a note
  - "scheme looks wrong": re-derive it. If the scheme was wrong, correct it, and
    re-check every grade of that homework already reviewed in this run. Re-start
    the graders of any that are still unsaved.
  Anything that does not hold up: re-derive it yourself, cropping and
  enlarging only the line in question if you need to see it. Fix `grade.json`,
  run `npm run grading:preview -- <id>`, and look at the preview page you
  changed. Then `npm run grading:commit -- <id>`.
- `reject`: check the reason against GRADING.md "Rejecting a submission" (after
  the deadline, prefer grading what can be read). Then
  `npm run grading:commit -- <id> --reject="<reason>"`.

After each commit:
- "Saved", "held" or "Rejected": delete `grading-inbox/<id>/`.
- "was replaced": delete the folder and pull again.
- "fetch failed": check the submission's status in the database before treating
  it as refused.

## 6. Close

1. Delete `grading-inbox/_hand/<homework id>/` for every homework with nothing
   left waiting.
2. Learnings from the reports: generalise each one (never about one student),
   drop duplicates and anything already in the rules, and add the rest to
   `scripts/grading/LEDGER.md`, newest first. A learning that changes how
   marks are given also goes into the rule it changes in GRADING.md. Leave
   these edits uncommitted and list them for the owner.
3. Report to the owner:
   - one table row per submission: homework, total, handwriting result, saved /
     held / rejected / left
   - every key or scheme correction you made
   - anything left for them, and why
   - the MB freed

Keep schemes (`grading-inbox/_scheme/`) after the run: re-marks reuse them, and
a changed paper makes them stale on its own.
