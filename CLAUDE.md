# NDA Maths Tracker — CLAUDE.md

## Project overview

A React + Vite faculty tool for LWS Pune to track NDA Maths exam performance.
Three distinct runtime modes:

- **Faculty mode** (`localhost` / LAN): full read-write access — upload exams, tag questions, generate AI insights. Data stored in `data/faculty-data.json` via a Vite dev plugin.
- **Teacher portal** (GitHub Pages): read-only. Teachers log in with a shared password, which decrypts `db.json` client-side. Full view of all pages.
- **Student portal** (GitHub Pages): read-only. Students log in with their mobile number (hashed SHA-256). Each student sees only their own data from a per-student JSON file.
- **Demo mode** (GitHub Pages): public, no login. URL: `?demo=true`. NOT YET IMPLEMENTED — see below.

## Tech stack

| Layer | Choice |
|---|---|
| UI | React 19, Tailwind CSS 3 |
| State | Zustand 5 (`src/store/useStore.js`) |
| Build | Vite 8 |
| Testing | Vitest 4 + React Testing Library 16 + jsdom |
| Excel parsing | xlsx (`src/lib/excel.js`) |
| Math rendering | KaTeX |
| Deploy | GitHub Pages via `gh-pages` |
| Python crypto | `cryptography` package (`pip install cryptography`) |

## Key commands

```bash
npm run dev          # start dev server (faculty mode, data saved to disk)
npm run build        # production build
npm run test         # run test suite (Vitest)
npm run test:watch   # run tests in watch mode
npm run split        # python -X utf8 split_students.py (generates per-student JSON)
npm run deploy       # split + build + push to GitHub Pages
npm run lint         # ESLint
```

## Slash commands

| Command | File | Purpose |
|---|---|---|
| `/subtopic-analyse` | `.claude/commands/subtopic-analyse.md` | Scans `data/faculty-data.json` and reports near-duplicate subtopic names within each chapter. Read-only — run after bulk tag uploads. |

---

## Architecture decisions

### Data persistence
- **Dev**: `data/faculty-data.json` — written by the Vite `localDataPlugin` in `vite.config.js` via `POST /api/data`. Bypasses the 5 MB localStorage limit.
- **Prod (student)**: localStorage — session token only (`SESSION_KEY`), expires after `SESSION_DAYS` days.
- **Prod (teacher)**: sessionStorage — decrypted `db.json` stored under `TEACHER_SESSION_KEY`, cleared when tab closes. The plain-text password is never stored anywhere.
- `apiKey` is **never** persisted to disk or localStorage — memory only.

### Mode detection
`src/config.js` detects GitHub Pages by hostname. Any non-localhost hostname → `IS_READ_ONLY = true`.
Mode is propagated app-wide via `ModeContext` (`src/context/ModeContext.jsx`). Use `useMode()` in components. Default is `'faculty'` so tests work without a Provider.

```
'faculty'  — localhost / LAN, full read-write
'teacher'  — GitHub Pages, password-authenticated, all pages read-only
'student'  — GitHub Pages, mobile-authenticated, own data only
```

`IS_READ_ONLY` is used only for URL base-path calculation and top-level routing — not for component-level visibility.

### GitHub Pages login (`src/components/auth/LoginPage.jsx`)
**Teacher tab:** fetches encrypted `db.json` → derives key from password → decrypts via Web Crypto API. Wrong password fails decryption. Decrypted dataset stored in `sessionStorage` (`TEACHER_SESSION_KEY`).

**Student tab:** mobile → SHA-256 normalised → matched against `index.json` → per-student file fetched → session saved to `localStorage`.

### Teacher portal routing (`src/App.jsx`)
- `teacherData` → `<TeacherPortal>` (receives `data` prop, calls `loadRemoteData(data)` directly)
- `studentData` → `<StudentPortal>`
- Neither → `<LoginPage>`
- Each portal wraps its tree with `<ModeContext.Provider value="teacher|student">`
- **Hooks must be called before any early returns** — store starts empty in teacher mode; `loadRemoteData` fires after mount causing re-renders. All `useMemo` hooks in Dashboard/Toppers are placed before early returns to prevent React error #310.

### Student split script (`split_students.py`)
Requires `pip install cryptography` only when `teacher_password.txt` exists.

Reads `data/faculty-data.json` + `students_db.json`. Outputs:
- `public/data/index.json` — login index (lwsId, name, mobileHash, file)
- `public/data/students/<lws-id>.json` — per-student file with `profile`, `exams`, `ndaFreq`
- `public/data/db.json` — AES-256-GCM encrypted when `teacher_password.txt` exists, else plain JSON

Key implementation notes:
- `lws_to_info` dict uses camelCase keys (`regDate`, `accountStatus`) — built from `students_db.json` snake_case fields (`registration_date`, `account_status`)
- `npm run split` uses `python -X utf8` to handle emoji in print statements on Windows
- PBKDF2 iteration count (`100_000`) must stay in sync with `LoginPage.jsx` (`decryptDb`)

### Store structure (`src/store/useStore.js`)
State keys: `exams`, `studentProfiles`, `savedInsights`, `ndaFreqBySubject`, `ndaMarksBySubject`, `costLog`, `apiKey`, `lastDeployedAt`, `hydrated`.
All mutations call `get()._save()` immediately. Store is split into slices under `src/store/slices/` — see module map below.

- `loadStudentData(data)` — loads a single student's JSON file (student portal)
- `loadRemoteData(data)` — loads the decrypted full dataset (teacher portal)

### Subject filtering
Every exam has a `subject` field (one of the 11 subjects in `src/lib/ndaFreq.js`). Filters are **local state per page** — not in the store.

- **Dashboard**: subject → branch → batch → exam filter chain. Changing subject resets downstream selectors.
- **Exams**: sort + subject → branch → batch filter chain in header. Subtitle shows `X of Y exams`. Branch/batch selects hidden when no data for current subject selection.
- **StudentView**: self-contained subject filter — works in all three modes without prop threading. Shown only when student has 2+ subjects. Scopes all analytics to the selected subject.
- Section order in StudentView: Stats → ProjectedScoreCard → Chapter Accordion → Exam History → Wrong Answer Audit → Unattempted Audit → Improvement Plan.

### Valid students & registration-date filtering
- **Valid student**: has a `studentProfiles` entry with a non-empty `regDate`
- **Valid exam** for a student: `exam.date >= profile.regDate`
- Students without a `regDate` are excluded from class-level analytics
- `accountStatus` is display-only — does not gate analytics

Key analytics API (in `src/lib/analytics/filters.js`):
```js
filterValidExams(studentExams, regDate)   // no-op when regDate is falsy
getValidStudentNames(exams, studentProfiles)  // → Set<string> of registered student names
```
All class-level functions accept optional `validNames` param (`null` = no filter): `getAllStudents`, `computeChapterStats`, `getAtRisk`, `getHardestQuestions`, `getToppers`.

Key analytics API for GAT subject routing (in `src/lib/analytics/chapterStats.js`, `performance.js`):
```js
computeStudentChapterStats(name, exams, qSubject?)  // qSubject filters to matching q.subject; null=all
computeWrongAudit(name, exams, qSubject?)           // pass-through to computeStudentChapterStats
computeSkippedAudit(name, exams, qSubject?)         // pass-through to computeStudentChapterStats
```
`qSubject` only filters questions where `q.subject` is set (GAT questions). Questions with `q.subject=null` (non-GAT exams) are always included.

Pre-registration exclusion banner in `StudentView` is hidden in student mode (`mode !== 'student'` guard).

### GAT & per-subject marks
`ndaMarksBySubject` (store) holds NDA paper marks per subject. GAT total (600) is always derived — never stored or edited independently. `CONFIGURABLE_SUBJECTS` in `src/lib/ndaFreq.js` excludes GAT from the freq table editor.

For combined GAT mock uploads, tags file **must** include a `Subject` column per question.

### Chapter accordion (`src/pages/Students/ChapterAccordion.jsx`)
Subtopics with no wrong answers and no skipped questions are hidden in all modes.

### Mode-conditional visibility
Use `useMode()` — not `IS_READ_ONLY` — for per-feature visibility in components.

| Feature | Faculty | Teacher | Student |
|---|---|---|---|
| Add / delete exams | ✓ | — | — |
| Re-upload results / tags | ✓ | — | — |
| Edit questions | ✓ | — | — |
| Edit student branch/batch (ProfileCard) | ✓ | — | — |
| ProjectedScoreCard | ✓ | ✓ | — |
| WrongAnswerAudit | ✓ | ✓ | ✓ |
| UnattemptedAudit | ✓ | ✓ | ✓ |
| Download exam PDF | ✓ | ✓ | — |
| Toppers page | ✓ | ✓ | — |
| Insights page | ✓ | — | — |
| API Costs page | ✓ | — | — |
| Sidebar | ✓ | ✓ | — |

---

## Demo mode — NOT YET IMPLEMENTED

**URL:** `https://<user>.github.io/nda-tracker/?demo=true`
**Purpose:** Public demo — one student's full view, no login, no personal info.

### How it works
1. `IS_DEMO = IS_READ_ONLY && new URLSearchParams(window.location.search).has('demo')` in `config.js`
2. `App.jsx` checks `IS_DEMO` before the login gate — auto-fetches `DEMO_DATA_URL`, renders `DemoPortal`
3. `DemoPortal` — same as `StudentPortal` but top bar shows "Demo Mode", no logout button
4. `public/data/demo.json` — sanitized student JSON from `generate_demo.py`

### Personal info treatment
| Field | Treatment |
|---|---|
| Name | Replaced with `"Demo Student"` in all exam records |
| Profile (LWS ID, mobile, DOB, branch, batch) | Set to `null` — `ProfileCard` not rendered |
| Exam scores / responses | Kept |

### Files to create / change
1. `generate_demo.py` — `--student "Name"` arg or auto-picks topper; writes `public/data/demo.json`
2. `package.json` — add `"demo": "python generate_demo.py"`; add to deploy pipeline
3. `src/config.js` — add `IS_DEMO` and `DEMO_DATA_URL`
4. `src/App.jsx` — `IS_DEMO` branch before login gate; `DemoPortal` component

### Routing order in `App.jsx` (IS_READ_ONLY block)
```
IS_DEMO                      → <DemoPortal>      (no login)
!teacherData && !studentData → <LoginPage>
teacherData                  → <TeacherPortal>
studentData                  → <StudentPortal>
```

---

## Excel upload format

**Results file** (from Evalbee):
- Required: `Name`, `Total Marks`, `Correct Answers`, `Incorrect Answers`
- Per-question: `Q N Marks`, `Q N Options`
- Note: The results file has NO per-question subject info — the `Subject 1`, `Subject 2` columns are aggregate score totals, not per-question tags.

**Tags file:**
- Required: `Q` (or `Question#`), `Chapter`
- Optional: `Subtopic`, `Question`, `OptionA`–`OptionD`, `Answer`, `Solution`, `Difficulty`
- **GAT combined exams**: `Subject` column per question is **required**. Without it, all 150 questions are unroutable to their subjects.

---

## GAT combined exam upload — COMPLETE (April 2026)

GAT mocks (e.g. NDA GAT MOCK 1) contain 150 questions spanning English, Physics, Chemistry, Biology, Geography, History, Polity, Economics, Others. Questions must be routed to their respective subject pools for `ndaFreqBySubject`, chapter analytics, and StudentView subject filter.

### Phase 1 — Validation enforcement (DONE)
- `validateTags.js`: `validateGatSubjects(tags)` returns `{ valid, missingQs[] }`
- `Step1Upload.jsx`: blocks if tags file missing Subject column or any row has empty Subject for a GAT exam
- `detectSubjectFromTags` returns `'GAT'` when multiple distinct subjects found (not most-common)
- Exam names like "GAT  1" from filename-stripping normalised to `'GAT'` in `handleNext`

### Phase 2 — Step3Tags UI for GAT exams (DONE)
- 4-column grid (Q# · Subject · Chapter · Subtopic) when `exam.subject === 'GAT'`, 3-column otherwise
- Subject dropdown per row (all subjects except GAT); Chapter dropdown scoped to that row's subject freq list
- Changing subject clears chapter; chapter disabled until subject selected

### Phase 3 — Analytics routing (DONE — was broken, now fixed)
- `computeStudentChapterStats(name, exams, qSubject?)`: `qSubject` param skips questions where `q.subject` is set and doesn't match; `q.subject=null` (non-GAT) always included
- `computeWrongAudit` / `computeSkippedAudit`: `qSubject` pass-through added
- `StudentView`: derives subject tabs from per-question subjects in GAT exams; includes GAT exams in subject-filtered `examData`; passes `qSubject` to analytics; `aq`/consistency still use full exam totals (acceptable)

**Key insight:** Evalbee results file has no subject info at all. Subject assignment is entirely the tags file's responsibility.

---

## Exam PDF export — COMPLETE (April 2026)

`src/lib/examPdf.js` — async `downloadExamPdf(exam)`, called from the 📄 PDF button on the Exams page. Available to faculty and teacher modes. Uses dynamic `import('jspdf')` + `import('jspdf-autotable')` so they split into separate chunks (~400 KB + 30 KB) and don't bloat the main bundle.

**PDF structure:**
1. **Page 1** — accent header band (exam name, date, subject, batch, branch, marking scheme); stat boxes (students, questions, min/avg/max); median + above-50% note; top 5 / bottom 5 students side by side; top-5 most-wrong and most-skipped question summary tables; question detail cards (see below); topper analysis section (cutoff info + wrong/skipped questions among top 25% — no student name list).
2. **Page 2+** — full ranked student table (rank, name, score, %, correct, wrong, skipped).

**Question detail cards** — rendered after each summary table for questions that have text (`q.question`). Each card shows: coloured header (Q# · chapter · subtopic · count/rate), question text (word-wrapped), options A–D in a 2×2 grid with correct answer in green bold, answer + difficulty footer. Questions without text are silently skipped.

**`stripLatex(text)`** — converts LaTeX markup to readable Unicode before rendering: superscripts (`x² y³`), subscripts, `\mathbb{N/R/Z/Q/C}` → `ℕ/ℝ/ℤ/ℚ/ℂ`, set symbols (∈ ∪ ∩), comparison (≤ ≥ ≠), arrows (⇒ → ↔), full Greek alphabet, `\frac{a}{b}` → `(a)/(b)`, `\sqrt{x}` → `√(x)`, `\text{}` unwrapped. Unknown commands stripped; braces removed.

---

## Chapter Frequency Table — Sync Chapters (April 2026)

`syncFreqChapters(savedFreq, exams, subject)` in `src/lib/ndaFreq.js` — computes the current chapter set from uploaded exams (matching both `exam.subject === subject` and `q.subject === subject` for GAT routing), then diffs against the saved freq rows. Returns `{ rows, added, removed }` where `rows` redistributes all chapters to equal weights (100/n with rounding correction on last row).

`FrequencyTableEditor` (`src/pages/Dashboard/FrequencyTableEditor.jsx`) has a 🔄 Sync Chapters button that calls this and shows a result banner: green = already up to date; amber = lists added/removed chapters with instruction to review weights and save.

---

## Student branch/batch inline editing (April 2026)

`ProfileCard` in `src/pages/Students/studentViewComponents.jsx` has an ✏️ button (faculty mode only, top-right of card) that switches to edit mode:
- Branch: free-text input with `<datalist>` suggestions from all known profiles
- Batches: removable pill tags + free-text input with `<datalist>` + Enter / + Add button
- 💾 Save calls `updateStudentBranchBatch(lwsId, name, { branch, batches })` in `studentSlice`

`updateStudentBranchBatch` in `src/store/slices/studentSlice.js` fetches `students_db.json`, mutates the matching record (matches by `lws_id` if present, else by canonical name), and persists via `persistStudentsDB`.

---

## Module map

Files have been modularized — facades keep all existing import paths working:

| Facade | Folder | Notes |
|---|---|---|
| `src/lib/analytics.js` | `src/lib/analytics/` | filters, chapterStats, performance, projection, classMetrics, examInsights |
| `src/lib/mergeStudents.js` | `src/lib/merge/` | lwsHelpers, mergeLogic, rollEnrichment, deduplication, recordMerge |
| `src/store/useStore.js` | `src/store/slices/` | defaults, examsSlice, studentSlice, insightsSlice, ndaSlice |
| `src/pages/Students/ManageBatchBranchModal.jsx` | `src/pages/Students/batchBranch/` | helpers, TabBtn, RenameTab, BulkAssignTab, FindDuplicatesTab |
| `src/components/students/ImportStudentsModal.jsx` | `src/components/students/import/` | Steps, UnresolvedRow, useImportFlow |

---

## Important files

| File | Purpose |
|---|---|
| `src/config.js` | Mode detection (`IS_READ_ONLY`), URL constants, session keys |
| `src/context/ModeContext.jsx` | `ModeContext` + `useMode()` hook |
| `src/store/useStore.js` | Zustand store assembler |
| `src/store/persist.js` | Disk (dev) / localStorage (prod) read-write |
| `src/components/auth/LoginPage.jsx` | Unified teacher + student login; AES-GCM decryption |
| `src/components/upload/UploadModal.jsx` | 4-step modal for adding a new exam |
| `src/components/upload/ReuploadResultsModal.jsx` | Replace student scores for an existing exam |
| `src/components/upload/ReuploadTagsModal.jsx` | Replace tag metadata for an existing exam |
| `src/lib/excel.js` | Excel parsing for results, tags, and student import files |
| `src/lib/mergeStudents.js` | Student import merge + roll-number enrichment (facade) |
| `src/lib/analytics.js` | Exam analytics calculations (facade) |
| `src/lib/ndaFreq.js` | NDA topic frequency data + `SUBJECTS` + `CONFIGURABLE_SUBJECTS` + `syncFreqChapters` |
| `src/lib/examPdf.js` | Client-side PDF export: `downloadExamPdf(exam)` — uses jsPDF + jspdf-autotable (dynamic import); renders header, stat boxes, top/bottom students, wrong/skipped questions with full question cards (LaTeX stripped to Unicode), topper analysis, full ranked student table |
| `src/lib/matchStudents.js` | Fuzzy name matching between exam names and student profiles |
| `src/lib/validateTags.js` | Tags file validation + `validateGatSubjects` for GAT combined exams |
| `src/lib/persistence.js` | `exportDB`, `importDB`, `migrateMarks` |
| `src/pages/Exams/ExamInsightsPanel.jsx` | Per-exam drill-down: top/bottom students, wrong/skipped Qs, toppers tab |
| `src/pages/Students/ExamHistoryTable.jsx` | Paginated exam history (5/page, newest first) + per-exam wrong/skipped breakdown |
| `src/pages/Students/ManageBatchBranchModal.jsx` | Rename/bulk-assign/dedup batches & branches (faculty only) |
| `src/components/students/ImportStudentsModal.jsx` | 4-step EIS Excel import modal |
| `split_students.py` | Pre-deploy: generates per-student files + encrypted db.json |
| `tests/test_split.py` | pytest tests for split_students.py |
| `vite.config.js` | Vite config + `localDataPlugin` + Vitest config |
| `data/faculty-data.json` | Primary data store in dev (gitignored) |
| `students_db.json` | Student roster with mobile numbers (gitignored — sensitive) |
| `teacher_password.txt` | Teacher password for db.json encryption (gitignored — sensitive) |
| `public/data/` | Generated output for GitHub Pages |

---

## Test structure

| Path | What it covers |
|---|---|
| `src/lib/__tests__/analytics.test.js` | `filterValidExams`, `getValidStudentNames` |
| `src/lib/__tests__/validateTags.test.js` | `validateTags`, `validateGatSubjects` |
| `src/lib/__tests__/gatRouting.test.js` | `computeStudentChapterStats` / `computeWrongAudit` / `computeSkippedAudit` with `qSubject` filtering |
| `src/lib/__tests__/dashboardFilter.test.js` | Filter chain, batch/exam scoping |
| `src/pages/Dashboard/__tests__/Dashboard.test.jsx` | Dashboard subject dropdown + filter behaviour |
| `src/pages/__tests__/Exams.test.jsx` | Exams page filtering, X-of-Y count, re-upload buttons |
| `src/pages/Students/__tests__/StudentsPage.test.jsx` | Student search and selection |
| `src/lib/__tests__/mergeStudents.test.js` | `nextLwsId`, `mergeStudents`, `parseStudentDate` |
| `src/pages/Students/__tests__/StudentView.test.jsx` | Self-contained subject filter, stats, accordion |
| `src/components/upload/__tests__/ReuploadTagsModal.test.jsx` | Tags re-upload flow |
| `src/components/upload/__tests__/ReuploadResultsModal.test.jsx` | Results re-upload flow |
| `tests/test_split.py` | Python: `build_db_payload`, `encrypt_db_payload`, `main()` |

Test setup: `src/test/setup.js`. `ModeContext` defaults to `'faculty'` — tests work without a Provider.

---

## Deployment workflow

1. Run `npm run dev`, add exams, tag questions.
2. Create `teacher_password.txt` with the shared teacher password (absent → plain JSON, teacher login disabled).
3. Run `npm run deploy`:
   - Runs `split_students.py` (generates `public/data/`, encrypts `db.json`)
   - Builds the Vite app
   - Pushes `dist/` to the `gh-pages` branch

`REPO_NAME` must match the GitHub repo name in both `vite.config.js` and `src/config.js`.

---

## What not to change

- Do not persist `apiKey` anywhere on disk or localStorage — memory only.
- Do not persist the teacher password or derived key — only the decrypted dataset goes to sessionStorage.
- Subject filter state is intentionally local per page — do not lift to Zustand.
- `StudentView` is intentionally self-contained for subject filtering — no prop threading needed.
- Use `useMode()` for mode-conditional visibility — do not add new `IS_READ_ONLY` imports to components.
- `ModeContext` default is `'faculty'` intentionally — changing it breaks tests.
- PBKDF2 iteration count (`100_000`) must match between `split_students.py` and `LoginPage.jsx`.
- All `useMemo` and other hooks must be called **before** any early returns in page components.
