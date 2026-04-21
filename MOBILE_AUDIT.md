# Mobile Responsiveness Audit

## Summary

The application has a reasonable mobile-first foundation with a sidebar that adapts to a top bar + bottom navigation on small screens. However, there are several specific responsive gaps: fixed widths on chart/table display components that don't adapt to mobile viewports, large horizontal gaps that create overflow on narrow screens, and text sizes that become difficult to read on very small screens. The highest-impact fixes are in the Exams page card layout, Toppers card metrics display, and ApiBar padding on mobile.

---

## Issues by Priority

### 🔴 High — likely broken on mobile

**`src/pages/Exams.jsx:107`** — Min/Avg/Max stat block overflows on narrow screens
- `gap-6` between the three score columns uses `flex-shrink-0` with no responsive variant
- On screens <480px these three columns will be cramped or overflow the card
- Fix: `gap-2 md:gap-6`; consider `flex-col md:flex-row` for the right-side section

**`src/pages/Exams.jsx:87`** — Exam card right section doesn't adapt to narrow screens
- The card uses `flex items-center justify-between gap-4` with a `flex-shrink-0` right section
- Chapter badges can wrap, but the Min/Avg/Max metrics block is fixed width and won't
- Fix: wrap right section in `flex-col md:flex-row` on mobile

**`src/components/layout/ApiBar.jsx:65`** — Excessive horizontal padding on mobile
- `px-8` (32px each side) on a 375px phone leaves only ~311px for content, causing buttons to wrap
- Fix: `px-4 md:px-8`

**`src/pages/Toppers/index.jsx`** — TopperCard has four chained fixed-width sections
- `min-w-[140px]`, `min-w-[80px]`, `min-w-[90px]`, `min-w-[120px]` in sequence overflow <480px screens
- "Biggest Opportunity" section adds further width pressure
- Fix: `hidden md:flex` on optional sections; `flex-col md:flex-row` stacking on mobile

**`src/pages/Students/StudentView.jsx:174`** — Profile card flex layout wraps awkwardly
- Profile metadata section uses `flex flex-wrap gap-4` with `text-[12px]` items — may cause unexpected wrapping or feel cramped on mobile
- Fix: `flex-col md:flex-row` for profile card; `gap-2 md:gap-4`

---

### 🟡 Medium — degraded but functional

**`src/pages/Students/ChapterAccordion.jsx:67`** — Chapter name column is fixed width
- `w-[175px] min-w-[175px]` is ~47% of a 375px screen, leaving little room for the score bar
- Fix: `w-[120px] md:w-[175px] min-w-[120px] md:min-w-[175px]`

**`src/pages/Dashboard/FrequencyTableEditor.jsx:99`** — Inline grid uses hardcoded pixel column widths
- `gridTemplateColumns: '1fr 90px 90px'` — on mobile the 90px input columns are cramped
- Fix: reduce to `70px` on mobile via a responsive inline style or `sm:` variant

**`src/pages/Dashboard/index.jsx:175`** — "Hardest Questions" table has no column hiding on mobile
- Six-column table with fixed `text-[12px]` throughout — extremely cramped on <375px
- Fix: `hidden sm:table-cell` on lower-priority columns (Subtopic, Difficulty); `md:text-[12px] text-[10px]` on content

**`src/pages/Students/ProjectedScoreCard.jsx:45`** — Chapter list width vs score bar conflict
- Chapter column `w-[140px] md:w-[180px]` + score bar `min-w-[200px]` fight for space on mobile
- Fix: `w-[100px] md:w-[140px] lg:w-[180px]`; remove `min-w-[200px]` from score bar

**`src/pages/Toppers/index.jsx:288`** — Scale labels rendered at `text-[9px]`
- Five labels at 9px are unreadable on small or high-density screens
- Fix: `text-[7px] md:text-[9px]`; or hide alternate labels on mobile

**`src/components/layout/Sidebar.jsx:95`** — Mobile drawer fixed at `w-[260px]`
- On 320px phones the drawer leaves only 60px for the backdrop overlay
- Fix: `w-[min(85vw,260px)]`

---

### 🟢 Low — polish / nice-to-have

**`src/pages/Exams.jsx:90`** — Metadata row (`date · students · questions · marking`) may wrap unexpectedly
- Many inline `<span>` items with `gap-3` and no `flex-wrap`
- Fix: add `flex-wrap`; hide secondary metadata on mobile with `hidden sm:inline`

**`src/components/auth/LoginPage.jsx:212`** — Login card uses fixed `p-6` padding
- On <300px screens 24px padding on each side is excessive
- Fix: `p-4 md:p-6`

**`src/pages/Insights.jsx:55`** — Fixed `max-h-[600px]` / `max-h-[200px]` containers
- These heights consume most of the viewport on small phones
- Fix: `max-h-[50vh] md:max-h-[600px]` and `max-h-[30vh] md:max-h-[200px]`

**`src/components/ui/QuestionCard.jsx:143`** — Option text size not reduced on mobile
- Already uses `grid-cols-1` (good), but `text-[13px]` could be `text-[12px] md:text-[13px]`

---

## Components with good mobile support

- **`Sidebar.jsx`** — Excellent: hidden desktop sidebar + mobile top bar + bottom nav
- **`StatCard`** — `grid-cols-2 md:grid-cols-4` pattern used consistently throughout
- **`QuestionCard.jsx`** — Already `grid-cols-1`, single-column layout works on all screens
- **`LoginPage.jsx`** — Good `max-w-[380px]` centering and mobile-first inputs
- **`EmptyState` / `PageHeader`** — `flex-wrap` implementations work on mobile
- **Tables in Dashboard, StudentView, Costs** — correctly wrapped in `overflow-x-auto`
- **`Badge`, alert components** — inline display scales well across screen sizes
