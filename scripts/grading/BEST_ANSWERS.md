# Best answers: the runbook

The best answer to each question of a homework, chosen from the class and saved as
a PDF staff download from the homework's **Submissions** screen (**⭐ Best answers
(PDF)**) and share with the batch. Asked for as *"best answers for <homework>"*.

Owner rulings (2026-10-24): Claude judges, in the session; the student is **named**;
staff share the PDF (the student portal never shows another student's work).

## The routine

1. **Pull.** `npm run grading:best -- <homework id or exact title>`
   - Refused while the homework is open or any hand-in still waits to be graded:
     an ungraded hand-in may hold the best answer.
   - Writes `grading-inbox/_best/<homework id>/`: each shortlisted hand-in's
     **marked** pages (`pages/<submission>/NN.jpg`), the same under a 0-100 grid
     (`grid/…`), `shortlist.md`, and `best.json` to fill (kept if it already exists).
2. **Judge each question.** Read `shortlist.md`, then every candidate's grid pages
   for that question (the pages marked `*` carry its marks; the answer may run onto
   the next page). Pick ONE answer, by these, in order:
   1. **Accuracy.** Already settled by the shortlist: full marks with nothing
      missing. Never pick against the grade; if the marking looks wrong, say so to
      the owner instead of choosing around it.
   2. **Thoroughness.** Every step and its reason written, the final answer stated,
      units where needed. Prefer the answer a classmate can follow without help.
   3. **Presentation.** Legible, set out in order top to bottom, working kept apart
      from rough work, the answer marked. Neat but incomplete loses to plain but
      complete.
   - Two equally good: the one that shows the standard method the class was taught,
     then the shorter.
   - `best_attempt` questions (nobody got full marks): the highest mark is
     shortlisted; pick the one that would teach most. The PDF prints what it was
     missing.
   - `none` (nobody scored): leave `submissionId` null. The PDF says so.
3. **Fill `best.json`.** Per question:
   ```json
   { "label": "Q2", "submissionId": "<from shortlist.md>",
     "crops": [{ "page": 1, "x": 4, "y": 38, "w": 92, "h": 30 }],
     "reason": "Every step is given a reason, and the condition x ≠ 0 is written before dividing." }
   ```
   - `x, y, w, h` are **percent of the page**, read off the grid. Take the whole
     answer (question number to final line) and none of the next question. An
     answer split over two pages is two crops, in order.
   - `reason` (10-200 characters) is printed for the class: say what to learn from
     the answer. Describe the answer, never the student; no "careless", no "weak".
4. **Preview and LOOK.** `npm run grading:best -- <homework> --preview` checks the
   file (it names every problem at once) and writes `preview/crops/*.jpg` and
   `preview/best-answers.pdf`. Open every crop: the whole answer, nothing cut off,
   no neighbouring question. Fix a box and preview again.
5. **Show the owner** the PDF before saving: it goes to the whole batch.
6. **Commit.** `npm run grading:best -- <homework> --commit` uploads the previewed
   PDF to `homework-files/<homework id>/best/best-answers.pdf`, replacing any older
   one. Refused if `best.json` or a grade changed since the preview.
7. **Clear** `grading-inbox/_best/<homework id>/` once committed: it holds
   students' pages.

## What the shortlist leaves out, and why

- **Held grades**: the student has not been shown them.
- **A handwriting check of `mismatch` or `unclear`**, even once released: work that
  may not be the student's own is never held up to the class as a model.
- **Purged pages** (30 days after grading): there is nothing to crop.
- **An answer with no mark on any page**: there is no way to find it.

## Notes

- The PDF is kept after the 30-day page purge: it is a teaching handout, not a
  grade record. A homework with hand-ins cannot be deleted (the database refuses),
  so the PDF never outlives its homework.
- Re-running after a regrade rebuilds the shortlist from the database; the old
  `best.json` is checked against it and refused where a pick no longer qualifies.
