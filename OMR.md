# Building our own OMR — assessment

Proposal (2026-09-13): the bank pushes a paper into the tracker → the tracker
emits a **scannable answer sheet** → the institute scans the filled sheets in the
app → results land as a normal exam. Removes the Evalbee dependency, which
institute #2 (Modulus) does not have. Issue #3 in
[`INSTITUTE_ONBOARDING.md`](./INSTITUTE_ONBOARDING.md).

**Nothing here is built. This is a plan and a go/no-go gate.**

## Decisions taken 2026-09-13

| Question | Answer | Consequence |
|---|---|---|
| Build ours, or have Modulus buy Evalbee? | **Build ours.** "Why sell someone else's product when we can sell ours" | Strategic build, not a rushed onboarding fix — **Modulus is willing to wait** |
| Keep Evalbee working? | **Yes — optionality.** Both paths supported | Costs nothing structurally; see *Optionality is free* below |
| Sheet type | **Generic.** Student bubbles their own ID; sheets are printed once and photocopied | No roster binding, no reprints — but identity is now *read*, not *printed* |
| Capture | **Phone** | The single largest risk. No flatbed, no ADF |
| Max questions | **150** | ~~Needs 2 pages~~ — **wrong, corrected below: Evalbee fits 150 on one portrait page** |

**Phone capture is the one hard constraint.** The other two turned out easier
than assumed once real sheets were examined (below). The design has to earn its
accuracy rather than inherit it from good hardware — fine given there is no
deadline pressure, but it should be a known, chosen position.

---

## Ground truth: two real sheets + two real exports (2026-09-13)

Examined: a 30-question and a 150-question Evalbee sheet image, plus
`Chemistry-Basic Concept l_2026-07-24.xlsx` (30 q · 24 rows) and
`NDA GAT LWS MOCK 7_2026-09-10.xlsx` (150 q · 73 rows). **This replaced three
assumptions with measurements.**

**1. 150 questions fit ONE portrait page.** Four question columns plus the roll
block, `A B C D` re-headed every ~5 rows. **No second page, no sides, no
collation problem** — that risk is deleted outright, and Phase A gets simpler.

**2. Registration marks are a GRID, not four corners.** Black squares run down
both outer edges *and* between every question column, at ~4–5 row intervals.
That is a better design than the corner fiducials I sketched: edge marks give
*per-row* registration, so the reader stays accurate under vertical stretch and
local distortion instead of relying on one global transform. Adopt it.

**3. Identity is a 5-digit roll-number bubble block — and it works.**
`Roll No` came back `"00001"`, `"00048"`, zero-padded, with **0 blanks across all
94 sheets in the two files**. So a bubbled ID is a solved, proven pattern, not the
liability I flagged for generic sheets. Better still: the tracker's own `lws_id`
already carries a numeric suffix (`LWS-048` → `00048`), so the ID block maps onto
existing identity with no new scheme. Combined with closed-set roster validation,
identity risk drops a lot.

**4. Double marks are real, and Evalbee scores them WRONG.** The cell holds
`"A, C"` / `"B, D"`, and the mark is negative **even when one of the marked
options is the key** (a student who bubbled `A, C` on a question keyed `C` still
scored −0.83). Rates are low but nonzero: 5 of 630 cells, 3 of 1,950.

> **Trap for a future re-grade:** `parseExcelFull` tests `/^[A-Z]$/`, so `"A, C"`
> yields `choices = null` — *indistinguishable from a blank*. `responses` is still
> `-1`, so grading is correct today. But a re-grade built on `choices` would read
> a double-mark as a skip and silently turn a wrong answer into a 0. Our reader
> must emit multi-mark as its own state.

**5. An absent student still gets a row** — name present, `Q N Key`, `Q N Marks`
and `Total Marks` all blank. `parseExcelFull` skips on blank Total, which is
correct. The four cell states our reader must reproduce: `absent` (not scanned) ·
`skipped` (scanned, blank) · `single` · `multi`.

**6. Both invariants behind the Save gate hold on real data.** Exactly one
positive and one negative mark value per file, and `Σ(Q N Marks) == Total Marks`
for **34 of 34** scanned students. Marking differs per exam (`+4/−0.83` and
`+4/−1.33`) and the negatives are non-round decimals — which is exactly why
`parseExcelFull` rounds before comparing.

**7. The extra export rows are the class roster, not missing scans.** GAT Mock 7
carries 73 rows with 13 scanned; Mock 6 carries 34 with 10 — and the sheet folder
holds **exactly 10 images**, one per scanned student. So Evalbee exports its whole
class list and fills in whoever sat the paper. Nothing wrong here; noted because
the first reading looked like 60 lost sheets.

---

## Second sample: 10 scanned sheets + their matching export (2026-09-13)

`omr_scanned_sheets/` (10 × PNG) against `NDA GAT_ LWS Mock 6_2026-09-07.xlsx`.
**They are the same exam** — the roll blocks read `00001` and `00013`, and the
export has `00001 = Swarup Karle`, `00013 = Mangesh Pawar`. Every overlaid mark
matches that student's per-question row.

**These are Evalbee's ANNOTATED output, not raw captures.** Decoding the overlay
against the export data gives the legend exactly:

| Mark | Meaning |
|---|---|
| **Green** filled bubble | the student's answer, and it is correct |
| **Red** filled bubble | the student's answer, and it is wrong |
| **Yellow** filled bubble | the **key** — drawn whenever the student skipped or answered wrong |
| **Yellow** in the roll block | a digit Evalbee read (no key exists there) |
| **Blue dot** on the four corner squares | the anchors it locked onto |

Confirmed cell by cell: roll `00001` Q3 is blank with key `C` → yellow on C; Q10
is `C` against key `B` → red on C, yellow on B; Q2 is `B` on key `B` → green. The
legend is not a guess.

**What this gives us, and what it does not.**

- **Geometry, for free.** The overlay is drawn on true bubble centres, so these
  images can be measured to recover the real grid — column positions, bubble
  pitch, margins, registration-square placement — instead of deriving it from A4
  proportions. That de-risks Phase A considerably.
- **A 1,500-cell oracle.** 10 students × 150 questions of known-correct answers.
- **But they cannot be fed to our reader.** The coloured overlays sit exactly
  where marks are; any threshold would read them as filled. **Phase B still needs
  raw, un-annotated photographs.**

**Capture conditions are realistic and Evalbee copes.** Visible perspective skew
(the page is not flat or square to the lens), uneven lighting with shadow down one
side, a coloured desk mat behind, and the page edge cropped. That is real-world
phone capture, and it read all 150 rows.

**Resolution: 1080 × 1440, 4:3, ~1.2 MB.** Not a high-resolution scan — this is
what a phone pipeline actually delivers, and it is enough. A useful target: our
reader should not require more, and the capture step should downscale to about
this rather than shipping 12 MP frames around.

## Paper: A4, and it must print 2-up

Confirmed 2026-09-13: **A4**, everything else proportionate. Evalbee also offers
**two sheets per A4** — halving paper cost, which matters at 300 students per
exam. The generator must support N-up from the start; each half must carry its own
registration grid and roll block so a cut sheet is independently readable. That is
a layout requirement, not an afterthought — retrofitting it would mean redoing the
geometry.

## A correction to the vocabulary

The bank already says "OMR sheet" — e.g. *"`build-tags` emitted the 30-row OMR
sheet"*. That is the **tagged `Tags_*.xlsx`**: questions in printed order plus the
answer key, which is what *configures Evalbee*. "OMR parity" in those logs means
Q-number parity with the printed paper. **No printable bubble sheet exists
anywhere in either app today.**

## Optionality is free — structurally

`parseExcelFull` ([`src/lib/excel.js`](./src/lib/excel.js)) is already just *one
producer* writing a normalised contract that ~26 consumers read:

```
students[] = { name, rollNo, totalMarks, correct, incorrect, notAttempted,
               responses{qn: 1|-1|0}, choices{qn: 'A'|null} }
```

A scanner is a **second producer** of the same shape. Evalbee keeps working
untouched; nothing downstream knows the difference. Supporting both costs a
source picker at three call sites, not a fork.

## Identity, now that the sheet is generic

Pre-printed identity is off the table, so the student bubbles an ID and we read
it. That reintroduces the failure mode a pre-printed sheet would have removed —
and the dangerous case is not an unreadable ID, it is a **misread that lands on a
different valid student**, which swaps two students' marks silently.

**The roster is a closed set, and that is the whole defence.** Four checks
together, none of them clever:

1. **Roster validation** — the ID read must match a student in the exam's batch.
   Anything else goes to review. This alone kills most misreads.
2. **A printed name box** the student also fills in by hand. The reviewer sees it
   in the crop, so a questionable ID has an independent cross-check on the same
   sheet.
3. **Duplicate detection** — two sheets claiming one ID: both to review, never
   last-write-wins.
4. **Roster gap** — a student on the roster with no sheet is surfaced. The
   tracker already models exam absence, so this folds into an existing flow
   rather than inventing one.

Worth stating plainly: this is **weaker than pre-printed identity would have
been**, and it inherits some of the name-matching pain that `name_variants`,
`rollEnrichment` and the dedup work exist to manage. Accepted deliberately in
exchange for photocopiable sheets and no roster dependency at print time.

## Where the sheet is generated: the tracker

The vault's own contract settles it — *"what the vault cannot know it does not
send"*: no date, batch, branch or marking ([`CROSS_APP_SYNC.md`](./CROSS_APP_SYNC.md)).
A sheet needs the question count and the marking scheme; the tracker also holds
the roster it will be validated against, and a pushed paper already arrives there
as a draft exam with `questions[]`.

Because the sheet is now **generic**, this matters less than it did — a 150-question
blank is the same for everyone, so the bank could emit one too. The tracker stays
the home of the one that gets used, since that is where scanning and validation
happen.

## Design sketch

**The sheet** — follow Evalbee's proven layout rather than inventing one:
- A **grid of black registration squares** down both outer edges and between every
  question column, at ~4–5 row intervals (per the real sheets). Per-row
  registration, not one global corner-to-corner transform.
- A **5-digit roll-number bubble block**, fed by the numeric suffix of `lws_id`,
  plus the handwritten **NAME / EXAM / DATE** boxes the real sheets carry — the
  name box is the reviewer's independent cross-check when an ID looks doubtful.
- Up to 150 question rows × 4 bubbles on **one portrait page**, `A B C D`
  re-headed every ~5 rows, in printed Q-order (the parity rule the bank ingest
  already enforces).
- A printed scale reference so a wrongly-scaled print is **rejected loudly**
  rather than read wrongly.
- No exam identity on the sheet — the operator picks the exam in the app before
  scanning a batch. That is what makes bulk photocopying possible.

**The reader** — browser-side, no server: keeps the Vercel 12-function cap
untouched, keeps student PII on the device, and matches how this codebase already
does heavy work (`jszip`, `docx`, `html2canvas` are all dynamic-imported).
Pipeline: locate fiducials → perspective-transform to canonical geometry → sample
each bubble's mean darkness in its known cell → classify against a **per-sheet**
adaptive threshold calibrated from the sheet's own blank margin and darkest marks.

Phone capture makes perspective correction mandatory rather than optional, and
adds glare and uneven lighting. Try plain canvas first — with fiducials and a
known layout the maths is modest, and the project's rule is to prefer the existing
stack until a real gap shows. OpenCV.js (~8 MB wasm, dynamic-imported) is the
fallback if the spike says we need it.

**Capture UX matters as much as the algorithm here.** At ~300 sheets on a phone,
"upload a photo, wait, fix errors" is unusable. The shape that works is guided
in-app capture: live fiducial lock, auto-shutter when the frame is square and
sharp, immediate accept/reject, next sheet. Rejecting a bad frame *at capture
time* is worth more than any amount of cleverness afterwards.

## The non-negotiable rule: never guess

Double marks, faint marks, erasures, smudges, an unmatched ID — all go to a
**review queue** where a human sees the cropped row and decides. The reader
reports per-question confidence, and Save is gated on zero unresolved
ambiguities, mirroring `writtenQuizCompletion().complete`.

Same posture the codebase already takes: `findKeyMismatches` surfaces conflicts
for per-question resolution instead of overwriting, `assessMarking` refuses rather
than assumes, `findChapterForSubtopic` returns null rather than picking. A
silently misread bubble becomes a wrong mark in a parent's WhatsApp, which is far
worse than a slow manual pass.

## What it changes architecturally — and this part is good

Scanning makes **us** the grader. The scanner owns `choices` (the letters read),
and the tracker computes `responses` from `questions[].answer`. Coherent, and the
long-deferred **re-grade after a key correction** falls out for free — wanted
since 2026-06-10.

Two constraints:

- It **must not retroactively touch Evalbee-graded exams.** Two grading models
  coexist, so an exam records *how it was graded*.
- That stored column does **not** contradict the standing "do not add a `format`
  column" rule — format is derivable from `questions[]`, grading provenance is
  not. Stated so the rule isn't mis-applied here.

## Risks, in the order they kill projects

1. **Phone capture** — skew, glare, shadow, crumple, motion blur, no uniform
   lighting. A certainty, not a possibility. Mitigated by the registration grid,
   per-sheet thresholding and guided capture; never eliminated. **This is the
   whole risk now.**
2. **Throughput.** ~300 students × 1 page = ~300 captures per exam (halved by the
   one-page finding). Still close to half an hour of someone's evening at 5s
   each. Guided auto-capture is a core requirement, not polish.
3. **Identity swap** on a generic sheet — reduced by the roll-block finding, but
   the four checks above still all apply.
4. **Print fidelity** — scaling, toner density, paper. Registration grid plus a
   loud rejection on a bad print.
5. **Pencil vs pen, erasures, double marks** — per-sheet thresholding plus the
   review queue. Double-mark rates in the real files are ~0.2–0.8% of answered
   cells, so this is a steady trickle into review, not an edge case.

~~Collation across pages~~ — deleted, 150 fits one page.

## Plan, with a real gate

| Phase | What | Size |
|---|---|---|
| ~~**A**~~ | ~~Sheet generator~~ — **BUILT 2026-09-13**, see below | ~4 days |
| **B** | **SPIKE / GO-NO-GO** — print ~20, fill them messily, photograph them badly on a real phone, measure read accuracy | 2–3 days |
| C | Reader MVP — guided capture, one sheet, overlay-confirm | 2 weeks |
| D | Batch flow, review queue, roster validation, write into exam results | 1–2 weeks |
| E | Hardening against real sheets | open-ended |

**Phase B now has a real oracle.** `NDA GAT LWS MOCK 7` gives 13 fully-scanned
150-question sheets with Evalbee's own per-question answer for every one. If we
can get those same physical sheets, our reader can be scored against 1,950 known
cells instead of against my eyeballing — which turns "looks right" into a number.

**Phase B is the decision point and must run on real paper photographed with a
real phone before C is funded** — the project's own rule is to measure a blocking
check against the real corpus before shipping it. If B goes badly we have lost
three days and still hold Phase A.

Total to something trustworthy: **~5–7 weeks**, risk concentrated in B and E.
Revised up from 4–6 because phone capture and the 2-page layout both landed on
the harder side.

## Phase A — built 2026-09-13

- **[`src/lib/omr/layout.js`](./src/lib/omr/layout.js)** — pure, deterministic
  geometry in millimetres. **This is the contract between the two halves**: the
  generator draws from it and the reader will sample bubbles from it after
  perspective-correcting a photo. If they ever compute geometry separately, a
  drifted reader misreads answers silently instead of failing.
- **[`src/lib/omr/sheetPdf.js`](./src/lib/omr/sheetPdf.js)** — ink only, jsPDF
  dynamic-imported exactly as `examPdf.js` does it. No new dependency.
- 27 tests across the two, plus the full suite green (206 files / 3224 tests).

> **CORRECTION (same day, after the printable PDF arrived).** The proportions
> above were measured off a *photograph* on the assumption the sheet was 210 mm
> across. It is not — it is a half-A4, so the scale was out by ~2×, and with it
> every derived constant. The claim that these numbers "reproduce Evalbee's own
> 31-question first column" was a coincidence of margins, not agreement. The
> exact geometry is in *Ground truth 3* below; the built module works and is
> sound, but its ink sizes are a guess that the PDF has now replaced.

**Ink size is DERIVED, not configured (revised 2026-09-13 after the PDF).** The
first cut hardcoded 4.2 mm bubbles, measured off a photo at the wrong scale.
Evalbee instead scales the ink to how full the sheet is, so the generator now
picks **the largest bubble that fits**, clamped:

- **pitch = 1.5 × diameter** — Evalbee's exact ratio (3.11 ÷ 2.08 from the PDF's
  vector data), so spacing scales with the ink and a sheet never reads as big
  bubbles crammed together or small ones adrift.
- **floor 2.0 mm** — their proven density; below it we are betting our reader
  beats theirs.
- **ceiling 3.8 mm** — **measured**, once the sparse printable arrived: 3.78 mm
  is the largest bubble Evalbee draws, on a 30-question one-up sheet with the
  whole page to spare. An earlier 5.0 mm here was a guess off a cropped render.

**Columns are packed and CENTRED, not stretched.** Evalbee's 30-question sheet is
a 62 mm block in the middle of a 210 mm page. Stretching columns to the margins
left a sparse sheet looking half-empty, and dropping to the measured ceiling made
that worse rather than better. The registration grid likewise frames the
**content**, not the page — running it to the page bottom left rows of squares
under an empty half-sheet, which reads as a misprint.

**A bug the first test suite missed.** Packing the columns put the last bubble's
edge exactly on the next registration square. The clearance test approximated a
square as a circle of radius `size/2`, but a square's *corner* reaches `size/√2`,
so a real overlap passed. The test now measures true box-to-circle distance, and
a gutter of 0.6 × diameter sits either side of every column.

**The column counts now match Evalbee on all three real samples** — 30 q → 2
columns, 71 q → 3, 150 q → 4, with registration columns always one more. Nothing
was tuned for that; it falls out of the sizing rule, which is the useful part.

| questions | ⌀ | columns | split | Evalbee's columns |
|---|---|---|---|---|
| 20 | 3.8 mm | 1 | 20 | — |
| 30 | 3.8 mm | 2 | 12/18 | **2** (⌀3.78 mm) |
| 71 | 3.8 mm | 3 | 17/27/27 | **3** |
| 150 | 3.45 mm | 4 | 30/40/40/40 | **4** (⌀2.08 mm two-up) |

**Two-up is rotated, like Evalbee's (done 2026-09-13).** Each half turns 90° so
its columns run along the page's 210 mm long edge rather than the 148.5 mm short
one. Portrait two-up topped out near 116 questions; turned, capacity is **~188**,
so a full 150-question mock prints two to a page and halves the paper for a
300-student sitting.

**Type scales with the ink, and is placed by its START point.** Font sizes derive
from the bubble diameter and live in the layout (a fixed 7pt reads well at 3.8 mm
and crowds itself at 2.4 mm). Text anchors are the *start* of the string, computed
from its measured width — **never jsPDF's `align` under rotation**, which does not
shift the anchor back along a rotated baseline: that shipped 82 collisions, every
one a three-digit number running forward into its own bubbles by 0.92 mm.

**Verify a sheet by parsing the emitted PDF, not by modelling it.** The bug above
survived a unit test *and* a visual preview, because both used my model of where
jsPDF puts rotated text and the model was wrong. Reading the text matrices out of
the generated file and testing them against the circles in that same file is what
found it — and what confirms the fix (0 collisions, 0 overlaps across 30q one-up,
150q one-up, 150q two-up). A useful corollary: an earlier version of that probe
only matched `Tm`-positioned text, so it silently checked *nothing* on one-up
sheets, which use `Td`.

**Decisions taken while building:**

- **Balanced columns, not fill-first.** Packing each column to capacity in turn
  gave splits like `8 / 19 / 3`, spending a third of the sheet's width on three
  questions. It now uses the fewest columns that fit and shares questions out in
  proportion to capacity: 150 → `30/40/40/40`, and a 30-question sheet stays in
  one column instead of being smeared across four.
- **It REFUSES rather than shrinks.** 150 questions at 2-up exceeds a half-A4
  (capacity 65), so it throws instead of scaling bubbles below what a 1080-px
  phone frame can resolve. Shrinking to fit would produce a sheet that prints
  and cannot be read — the worst failure available.
- **A version stamp (`OMR v1`) is printed on every sheet.** Paper outlives
  deployments; a stack printed under v1 geometry and read by a v2 reader would
  misread silently, and the stamp makes that diagnosable by eye.

**Verified by looking, not only by testing.** The unit tests mock jsPDF, so they
prove which calls happen — not that the sheet is sane. No PDF rasteriser exists
on this machine, so the layout was rendered to PNG directly and inspected, and
real PDFs were generated through actual jsPDF (bundled with esbuild, since Node's
ESM loader will not take `src/`'s extensionless imports).

**Not yet done:** nothing renders this in the app — there is no button. Wiring it
to an exam (question count, title) is UI work that belongs with Phase D, when
there is a scan flow for it to sit in.

## Ground truth 3: the printable PDF + a raw filled photo (2026-09-13, later)

`18545516_NDA GAT_ LWS Mock 6_Answersheet.pdf` is the **real printable**, and its
content streams are uncompressed vector data — so this is exact, not measured.

**The geometry, per sheet:**

| | Value |
|---|---|
| Bubble ⌀ | **2.08 mm** |
| Bubble pitch | **3.11 mm**, both axes |
| Registration square | **2.08 mm** (same size as a bubble) |
| Registration grid | **(question columns + 1) × rows** — 5 × 11 for a 150-q sheet |
| 150 questions occupy | **155.8 × 99.7 mm** |
| Column split | 31 / 42 / 43 / 34 |
| Group gap | one blank 3.11 mm slot per 5 questions (the `A B C D` caption) |

**Three things this overturned:**

1. **My constants were out by ~2×.** They were measured off a photo assuming the
   sheet was 210 mm across; it is a half-A4. The built module is sound but its
   ink sizes are a guess the PDF now replaces.
2. **The PDF authors the sheet rotated 90°** — in its own coordinates, questions
   run left-to-right in four horizontal bands with A/B/C/D stacked vertically.
   The printed sheet is used portrait; the photo and the blank sheet image both
   confirm it. Only the authored frame is transposed, so this changes nothing
   about our design, which already matches the *used* orientation.
3. **Evalbee scales bubble size to question count.** Across the three samples —
   30 q (large bubbles), 71 q (medium), 150 q (2.08 mm) — the ink shrinks as the
   paper fills. That is a better rule than fixed constants: **use the largest
   bubble that fits, with a floor at what a phone can still resolve.** Our
   generator should do the same rather than picking one size.

**A raw filled photo finally arrived** (`WhatsApp Image 2026-09-13 at 9.53.41 AM.jpeg`)
— Ayush Sekhar, roll `00057`, a 71-question Maths sheet in three columns
(18/30/23), blue pen, patterned cloth background, slight rotation, shadow across
the top, several marks overflowing their circle and Q71 left blank. **Un-annotated,
so it is usable as reader input** — the first sample that is.

## Phase B spike — first result (2026-09-13)

Run against **nine raw phone photos** of Evalbee sheets, deliberately: they are
denser than anything we generate, so passing there is the stronger signal. The
question was not "can we read the answers" (we lack their per-sheet geometry for
every layout) but the one the whole build rests on: **find the registration grid
in a real photo, pick the corners, rectify, and have the remaining squares land
on a clean lattice.**

**6 of 9 pass. Where the rectification anchors correctly it is excellent** —
residuals of **0.1–0.6 % of grid pitch**, far below a bubble radius. That
includes the 150-question sheet at Evalbee's tightest density (2.08 mm bubbles),
which recovered its **5 × 11** grid exactly.

**Two things the spike established:**

1. **Shape alone separates registration squares from filled answers.** A square
   fills its bounding box (~1.0); an inked bubble is a disc and fills π/4 ≈
   0.785. At a 0.82 threshold the heavy blue-pen answers were passing as
   registration marks and inventing phantom grid columns. **0.90 separates them
   with no size or position assumption.**
2. **Illumination correction is not optional.** One global threshold loses a
   whole corner to the shadow these photos all have; thresholding each pixel
   against a coarse local background estimate does not.

**The single failure mode, and it is the real finding.** All three failures share
one cause: a corner registration square lost to shadow, so the code anchors on
the *second* row and the whole transform skews — squares then map to negative y,
above their own "top-left". Picking four extremes by `min(x+y)` and hoping is
fragile. The fix is standard and bounded: fit the lattice **globally** over all
detected squares rather than trusting four points — estimate row and column lines
and take the homography from their intersections, so a missing square costs
nothing.

**A trap worth recording: the first verdict metric was circular.** It scored
residual against the *nearest* cluster, so when clustering over-split, every
square got its own row and the residual was trivially ~0 — three wrong
rectifications reported "OK". Density (does the grid actually fill?) is what
catches it. Requiring every row to hold an identical count then over-corrected,
failing two *correct* rectifications that were merely missing a square or two.

**Verdict: GO.** The hard part works, at the hardest density, on real phone
photos. The remaining risk is anchor robustness, which is a known problem with a
known fix rather than an open question.

## Still outstanding

1. **More raw captures.** Two have arrived and both are usable as reader input —
   Ayush Sekhar (71 q Maths, roll `00057`) and Tejas Jadhav (150 q GAT, the
   tightest density). Phase B wants ~20: pencil as well as pen, erasures,
   half-filled bubbles, poor light, sharper angles. **Any with a matching Evalbee
   export becomes ground truth** — that pair is what turns "looks right" into an
   accuracy number.
2. **Does Evalbee's sheet vary by question count,** or is it one 150-row master
   with surplus rows ignored? The 30-q and 150-q layouts differ, so there is at
   least a family. Ours is generated per exam regardless, but it is worth knowing
   what the institute is used to handling.

~~Sheet dimensions~~ — answered: A4, proportionate, with a 2-up option.
