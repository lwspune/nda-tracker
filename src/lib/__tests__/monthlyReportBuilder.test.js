import { describe, it, expect } from 'vitest'
import { buildMonthlyReport, getMonthlyReportCohort } from '../monthlyReportBuilder'

// ── Minimal fixture factory ──────────────────────────────────────────────────

function profile(over = {}) {
  return {
    lwsId: 'LWS-001',
    name: 'Aksheet Patil',
    rollNo: '56',
    branch: 'LWS Pune',
    batches: ['LWS_NDA_2Y_(26-28)_A'],
    regDate: '2025-12-01',
    nameVariants: ['Aksheet Patil'],
    ...over,
  }
}

function exam(over = {}) {
  return {
    id: 'e1',
    name: 'Maths - Circle',
    date: '2026-01-09',
    subject: 'Maths',
    batch: 'LWS_NDA_2Y_(26-28)_A',
    branch: 'LWS Pune',
    marking: { correct: 4, wrong: -1 },
    questions: [],
    students: [],
    ...over,
  }
}

// One exam-student entry as it lives in memory (camelCase, post-loadExamsFromSupabase)
function entry(over = {}) {
  return {
    name: 'Aksheet Patil',
    rollNo: '56',
    totalMarks: 0,
    correct: 0,
    incorrect: 0,
    notAttempted: 0,
    responses: {},
    ...over,
  }
}

// ── meta ────────────────────────────────────────────────────────────────────

describe('buildMonthlyReport — meta section', () => {
  it('returns name, lws id, roll no, branch, batch, formatted month label', () => {
    const r = buildMonthlyReport({
      profile: profile(),
      month: '2026-01',
      exams: [],
      attendance: [],
      lectureAbsences: [],
      examAbsences: [],
      batchChapterTimelines: {},
      syllabusPrograms: [],
    })
    expect(r.meta.lwsId).toBe('LWS-001')
    expect(r.meta.name).toBe('Aksheet Patil')
    expect(r.meta.rollNo).toBe('56')
    expect(r.meta.branch).toBe('LWS Pune')
    expect(r.meta.batch).toBe('LWS_NDA_2Y_(26-28)_A')
    expect(r.meta.month).toBe('2026-01')
    expect(r.meta.monthLabel).toBe('Jan 2026')
  })
})

// ── examTable ───────────────────────────────────────────────────────────────

describe('buildMonthlyReport — exam table', () => {
  it('includes the student row for each attended exam in the month', () => {
    const e = exam({
      id: 'e1', name: 'Maths - Circle', date: '2026-01-09', subject: 'Maths',
      questions: Array(30).fill({}),
      students: [entry({ totalMarks: 17, correct: 7, incorrect: 3, notAttempted: 20 })],
    })
    const r = buildMonthlyReport({
      profile: profile(),
      month: '2026-01',
      exams: [e],
      attendance: [], lectureAbsences: [], examAbsences: [],
      batchChapterTimelines: {}, syllabusPrograms: [],
    })
    expect(r.examTable).toHaveLength(1)
    const row = r.examTable[0]
    expect(row.examName).toBe('Maths - Circle')
    expect(row.subject).toBe('Maths')
    expect(row.date).toBe('2026-01-09')
    expect(row.marks).toBe(17)
    expect(row.percentage).toBe(14)            // 17 / 120 → 14.16 → 14
    expect(row.attended).toBe(true)
  })

  it('emits an ABSENT row for each exam_absences entry', () => {
    const e = exam({ id: 'e2', name: 'Maths - Circle', date: '2026-01-09', students: [] })
    const r = buildMonthlyReport({
      profile: profile(),
      month: '2026-01',
      exams: [e],
      attendance: [], lectureAbsences: [],
      examAbsences: [{ exam_id: 'e2', marked_at: '2026-01-09T10:00Z' }],
      batchChapterTimelines: {}, syllabusPrograms: [],
    })
    expect(r.examTable).toHaveLength(1)
    expect(r.examTable[0].attended).toBe(false)
    expect(r.examTable[0].examName).toBe('Maths - Circle')
    expect(r.examTable[0].marks).toBeNull()
    expect(r.examTable[0].percentage).toBeNull()
  })

  it('excludes exams outside the month window', () => {
    const dec = exam({ id: 'eA', date: '2025-12-30', students: [entry({ totalMarks: 10 })], questions: Array(30).fill({}) })
    const jan = exam({ id: 'eB', date: '2026-01-09', students: [entry({ totalMarks: 10 })], questions: Array(30).fill({}) })
    const feb = exam({ id: 'eC', date: '2026-02-01', students: [entry({ totalMarks: 10 })], questions: Array(30).fill({}) })
    const r = buildMonthlyReport({
      profile: profile(),
      month: '2026-01',
      exams: [dec, jan, feb],
      attendance: [], lectureAbsences: [], examAbsences: [],
      batchChapterTimelines: {}, syllabusPrograms: [],
    })
    expect(r.examTable.map(x => x.examName)).toEqual([jan.name])
  })

  it('excludes exams whose date is before the student regDate (joined mid-month)', () => {
    const early = exam({ id: 'eA', date: '2026-01-03', students: [entry({ totalMarks: 10 })], questions: Array(30).fill({}) })
    const late  = exam({ id: 'eB', date: '2026-01-20', students: [entry({ totalMarks: 10 })], questions: Array(30).fill({}) })
    const r = buildMonthlyReport({
      profile: profile({ regDate: '2026-01-10' }),
      month: '2026-01',
      exams: [early, late],
      attendance: [], lectureAbsences: [], examAbsences: [],
      batchChapterTimelines: {}, syllabusPrograms: [],
    })
    expect(r.examTable.map(x => x.examName)).toEqual([late.name])
  })

  it('resolves attended row via name_variants (canonical mismatch)', () => {
    const e = exam({
      date: '2026-01-09',
      questions: Array(30).fill({}),
      students: [entry({ name: 'Aksheet patil', totalMarks: 24 })], // lowercase p
    })
    const r = buildMonthlyReport({
      profile: profile({ nameVariants: ['Aksheet Patil', 'Aksheet patil'] }),
      month: '2026-01',
      exams: [e],
      attendance: [], lectureAbsences: [], examAbsences: [],
      batchChapterTimelines: {}, syllabusPrograms: [],
    })
    expect(r.examTable[0].attended).toBe(true)
    expect(r.examTable[0].marks).toBe(24)
  })

  it('sorts the table by exam date ascending', () => {
    const a = exam({ id: 'eA', date: '2026-01-22', students: [entry({ totalMarks: 5 })], questions: Array(30).fill({}) })
    const b = exam({ id: 'eB', date: '2026-01-09', students: [entry({ totalMarks: 5 })], questions: Array(30).fill({}) })
    const c = exam({ id: 'eC', date: '2026-01-16', students: [entry({ totalMarks: 5 })], questions: Array(30).fill({}) })
    const r = buildMonthlyReport({
      profile: profile(),
      month: '2026-01',
      exams: [a, b, c],
      attendance: [], lectureAbsences: [], examAbsences: [],
      batchChapterTimelines: {}, syllabusPrograms: [],
    })
    expect(r.examTable.map(x => x.date)).toEqual(['2026-01-09', '2026-01-16', '2026-01-22'])
  })
})

// ── attendance ──────────────────────────────────────────────────────────────

describe('buildMonthlyReport — attendance', () => {
  it('counts P, A, L from attendance rows within the month', () => {
    const r = buildMonthlyReport({
      profile: profile(),
      month: '2026-01',
      exams: [],
      attendance: [
        { date: '2026-01-02', status: 'P' },
        { date: '2026-01-03', status: 'P' },
        { date: '2026-01-04', status: 'A' },
        { date: '2026-01-05', status: 'L' },
        { date: '2026-01-06', status: '-' },          // skip — not counted
      ],
      lectureAbsences: [], examAbsences: [],
      batchChapterTimelines: {}, syllabusPrograms: [],
    })
    expect(r.attendance.present).toBe(2)
    expect(r.attendance.absent).toBe(1)
    expect(r.attendance.late).toBe(1)
    expect(r.attendance.totalWorkingDays).toBe(4)  // P + A + L
  })

  it('computes attendancePercentage = (P + L) / (P + A + L) * 100, rounded', () => {
    const r = buildMonthlyReport({
      profile: profile(),
      month: '2026-01',
      exams: [],
      attendance: [
        ...Array(22).fill({ status: 'P' }).map((row, i) => ({ ...row, date: `2026-01-${String(i + 1).padStart(2, '0')}` })),
        { date: '2026-01-23', status: 'A' },
      ],
      lectureAbsences: [], examAbsences: [],
      batchChapterTimelines: {}, syllabusPrograms: [],
    })
    expect(r.attendance.attendancePercentage).toBe(96)   // 22 / 23 → 95.65 → 96
  })

  it('excludes attendance rows outside the month', () => {
    const r = buildMonthlyReport({
      profile: profile(),
      month: '2026-01',
      exams: [],
      attendance: [
        { date: '2025-12-30', status: 'P' },
        { date: '2026-01-15', status: 'P' },
        { date: '2026-02-01', status: 'A' },
      ],
      lectureAbsences: [], examAbsences: [],
      batchChapterTimelines: {}, syllabusPrograms: [],
    })
    expect(r.attendance.present).toBe(1)
    expect(r.attendance.absent).toBe(0)
  })

  it('lists late dates formatted (D Mon)', () => {
    const r = buildMonthlyReport({
      profile: profile(),
      month: '2026-01',
      exams: [],
      attendance: [
        { date: '2026-01-03', status: 'L' },
        { date: '2026-01-12', status: 'L' },
      ],
      lectureAbsences: [], examAbsences: [],
      batchChapterTimelines: {}, syllabusPrograms: [],
    })
    expect(r.attendance.lateDates).toEqual(['3 Jan', '12 Jan'])
  })

  it('counts missed lectures and includes detail (date + subject), within month', () => {
    const r = buildMonthlyReport({
      profile: profile(),
      month: '2026-01',
      exams: [],
      attendance: [],
      lectureAbsences: [
        { date: '2026-01-05', slot_id: 's1', subject: 'Physics' },
        { date: '2026-01-12', slot_id: 's2', subject: 'Maths' },
        { date: '2025-12-30', slot_id: 's3', subject: 'English' },  // out of month
      ],
      examAbsences: [],
      batchChapterTimelines: {}, syllabusPrograms: [],
    })
    expect(r.attendance.missedLectures).toBe(2)
    expect(r.attendance.missedLectureDetails).toEqual([
      { date: '5 Jan', subject: 'Physics' },
      { date: '12 Jan', subject: 'Maths' },
    ])
  })

  it('handles a month with zero attendance rows (totalWorkingDays = 0, percentage = 0)', () => {
    const r = buildMonthlyReport({
      profile: profile(),
      month: '2026-01',
      exams: [],
      attendance: [],
      lectureAbsences: [], examAbsences: [],
      batchChapterTimelines: {}, syllabusPrograms: [],
    })
    expect(r.attendance.totalWorkingDays).toBe(0)
    expect(r.attendance.attendancePercentage).toBe(0)
  })
})

// ── subject summary ─────────────────────────────────────────────────────────

describe('buildMonthlyReport — subject summary', () => {
  function attended(subj, date, marks, total = 120) {
    const numQs = Math.round(total / 4)
    return exam({
      id: `${subj}-${date}`, subject: subj, date,
      marking: { correct: 4, wrong: -1 },
      questions: Array(numQs).fill({}),
      students: [entry({ totalMarks: marks })],
    })
  }

  it('computes this-month average % per subject', () => {
    const r = buildMonthlyReport({
      profile: profile(),
      month: '2026-01',
      exams: [
        attended('Maths', '2026-01-09', 60),    // 50%
        attended('Maths', '2026-01-16', 36),    // 30%
        attended('Physics', '2026-01-17', 48),  // 40%
      ],
      attendance: [], lectureAbsences: [], examAbsences: [],
      batchChapterTimelines: {}, syllabusPrograms: [],
    })
    const maths   = r.subjectSummary.find(s => s.subject === 'Maths')
    const physics = r.subjectSummary.find(s => s.subject === 'Physics')
    expect(maths.thisMonth).toBe(40)     // (50 + 30) / 2
    expect(physics.thisMonth).toBe(40)
  })

  it('includes last-month average and direction (up/down/flat/new)', () => {
    const r = buildMonthlyReport({
      profile: profile({ regDate: '2025-11-01' }),
      month: '2026-01',
      exams: [
        attended('Maths', '2025-12-10', 96),    // 80% — last month
        attended('Maths', '2026-01-09', 60),    // 50% — this month, ↓
        attended('Physics', '2025-12-15', 48),  // 40% — last month
        attended('Physics', '2026-01-17', 72),  // 60% — this month, ↑
        attended('English', '2026-01-09', 60),  // 50% — this month, new (no last)
      ],
      attendance: [], lectureAbsences: [], examAbsences: [],
      batchChapterTimelines: {}, syllabusPrograms: [],
    })
    const maths   = r.subjectSummary.find(s => s.subject === 'Maths')
    const physics = r.subjectSummary.find(s => s.subject === 'Physics')
    const english = r.subjectSummary.find(s => s.subject === 'English')
    expect(maths.lastMonth).toBe(80)
    expect(maths.direction).toBe('down')
    expect(physics.lastMonth).toBe(40)
    expect(physics.direction).toBe('up')
    expect(english.lastMonth).toBeNull()
    expect(english.direction).toBe('new')
  })

  it("'flat' when this month and last month percentages are equal", () => {
    const r = buildMonthlyReport({
      profile: profile({ regDate: '2025-11-01' }),
      month: '2026-01',
      exams: [
        attended('Maths', '2025-12-10', 60),    // 50%
        attended('Maths', '2026-01-09', 60),    // 50%
      ],
      attendance: [], lectureAbsences: [], examAbsences: [],
      batchChapterTimelines: {}, syllabusPrograms: [],
    })
    const maths = r.subjectSummary.find(s => s.subject === 'Maths')
    expect(maths.direction).toBe('flat')
  })

  it('returns empty subjectSummary when there are no attended exams', () => {
    const r = buildMonthlyReport({
      profile: profile(),
      month: '2026-01',
      exams: [],
      attendance: [], lectureAbsences: [], examAbsences: [],
      batchChapterTimelines: {}, syllabusPrograms: [],
    })
    expect(r.subjectSummary).toEqual([])
  })
})

// ── weakest chapter ─────────────────────────────────────────────────────────

describe('buildMonthlyReport — weakest chapter', () => {
  function examWithChapters(date, qList, responses) {
    return exam({
      id: 'e-' + date, date,
      marking: { correct: 4, wrong: -1 },
      questions: qList,    // [{ q, chapter, answer }]
      students: [entry({ responses })],
    })
  }

  it('returns the chapter with lowest accuracy across all student responses in the month', () => {
    const r = buildMonthlyReport({
      profile: profile(),
      month: '2026-01',
      exams: [
        examWithChapters('2026-01-09',
          [
            { q: 1, chapter: 'Circle',         answer: 'A' },
            { q: 2, chapter: 'Circle',         answer: 'A' },
            { q: 3, chapter: 'Circle',         answer: 'A' },
            { q: 4, chapter: 'Conic Sections', answer: 'B' },
            { q: 5, chapter: 'Conic Sections', answer: 'B' },
            { q: 6, chapter: 'Conic Sections', answer: 'B' },
          ],
          { 1: 'A', 2: 'A', 3: 'B', 4: 'C', 5: 'D', 6: 'A' },    // Circle 2/3 = 67%, Conic 0/3 = 0%
        ),
      ],
      attendance: [], lectureAbsences: [], examAbsences: [],
      batchChapterTimelines: {}, syllabusPrograms: [],
    })
    expect(r.weakestChapter).toEqual({
      chapter: 'Conic Sections',
      accuracy: 0,
      totalQuestions: 3,
    })
  })

  it('requires at least 3 questions in a chapter (noise floor)', () => {
    const r = buildMonthlyReport({
      profile: profile(),
      month: '2026-01',
      exams: [
        examWithChapters('2026-01-09',
          [
            { q: 1, chapter: 'Circle',  answer: 'A' },
            { q: 2, chapter: 'Circle',  answer: 'A' },
            { q: 3, chapter: 'Circle',  answer: 'A' },
            { q: 4, chapter: 'Conic',   answer: 'B' },                // only 1 q — too few
            { q: 5, chapter: 'Vectors', answer: 'C' },                // only 1 q
          ],
          { 1: 'B', 2: 'B', 3: 'A', 4: 'X', 5: 'X' },   // Circle 1/3 = 33%, others ineligible
        ),
      ],
      attendance: [], lectureAbsences: [], examAbsences: [],
      batchChapterTimelines: {}, syllabusPrograms: [],
    })
    expect(r.weakestChapter.chapter).toBe('Circle')
    expect(r.weakestChapter.totalQuestions).toBe(3)
  })

  it('returns null when no chapter has ≥3 questions in the month', () => {
    const r = buildMonthlyReport({
      profile: profile(),
      month: '2026-01',
      exams: [
        examWithChapters('2026-01-09',
          [
            { q: 1, chapter: 'A', answer: 'A' },
            { q: 2, chapter: 'B', answer: 'B' },
          ],
          { 1: 'A', 2: 'B' },
        ),
      ],
      attendance: [], lectureAbsences: [], examAbsences: [],
      batchChapterTimelines: {}, syllabusPrograms: [],
    })
    expect(r.weakestChapter).toBeNull()
  })

  it('returns null when the student attended no exams', () => {
    const r = buildMonthlyReport({
      profile: profile(),
      month: '2026-01',
      exams: [],
      attendance: [], lectureAbsences: [], examAbsences: [],
      batchChapterTimelines: {}, syllabusPrograms: [],
    })
    expect(r.weakestChapter).toBeNull()
  })
})

// ── next month focus ────────────────────────────────────────────────────────

describe('buildMonthlyReport — next month focus', () => {
  it("lists chapters scheduled for the following month from batchChapterTimelines", () => {
    const r = buildMonthlyReport({
      profile: profile(),
      month: '2026-01',
      exams: [], attendance: [], lectureAbsences: [], examAbsences: [],
      batchChapterTimelines: {
        'LWS_NDA_2Y_(26-28)_A': {
          'prog1': {
            'subj1': { 'chap1': '2026-02', 'chap2': '2026-03' },  // chap1 scheduled Feb
            'subj2': { 'chap3': '2026-02' },                       // chap3 also Feb
          },
        },
      },
      syllabusPrograms: [{
        id: 'prog1',
        name: 'NDA',
        subjects: [
          { id: 'subj1', name: 'Maths',   chapters: [{ id: 'chap1', name: 'Limits' }, { id: 'chap2', name: 'Derivatives' }] },
          { id: 'subj2', name: 'Physics', chapters: [{ id: 'chap3', name: 'Optics' }] },
        ],
      }],
    })
    expect(r.nextMonthFocus.monthLabel).toBe('Feb 2026')
    // Sorted by subject then chapter
    expect(r.nextMonthFocus.chapters).toEqual([
      { subject: 'Maths',   chapter: 'Limits' },
      { subject: 'Physics', chapter: 'Optics' },
    ])
  })

  it('returns null when no chapters are scheduled for next month', () => {
    const r = buildMonthlyReport({
      profile: profile(),
      month: '2026-01',
      exams: [], attendance: [], lectureAbsences: [], examAbsences: [],
      batchChapterTimelines: {
        'LWS_NDA_2Y_(26-28)_A': { 'prog1': { 'subj1': { 'chap1': '2026-04' } } },
      },
      syllabusPrograms: [{ id: 'prog1', subjects: [{ id: 'subj1', name: 'Maths', chapters: [{ id: 'chap1', name: 'Limits' }] }] }],
    })
    expect(r.nextMonthFocus).toBeNull()
  })

  it('returns null when the student has no batch', () => {
    const r = buildMonthlyReport({
      profile: profile({ batches: [] }),
      month: '2026-01',
      exams: [], attendance: [], lectureAbsences: [], examAbsences: [],
      batchChapterTimelines: { 'X': { 'p': { 's': { 'c': '2026-02' } } } },
      syllabusPrograms: [],
    })
    expect(r.nextMonthFocus).toBeNull()
  })

  it('rolls over the year correctly when month is December', () => {
    const r = buildMonthlyReport({
      profile: profile(),
      month: '2026-12',
      exams: [], attendance: [], lectureAbsences: [], examAbsences: [],
      batchChapterTimelines: {
        'LWS_NDA_2Y_(26-28)_A': { 'prog1': { 'subj1': { 'chap1': '2027-01' } } },
      },
      syllabusPrograms: [{ id: 'prog1', subjects: [{ id: 'subj1', name: 'Maths', chapters: [{ id: 'chap1', name: 'Limits' }] }] }],
    })
    expect(r.nextMonthFocus.monthLabel).toBe('Jan 2027')
    expect(r.nextMonthFocus.chapters).toEqual([{ subject: 'Maths', chapter: 'Limits' }])
  })
})

// ── getMonthlyReportCohort ──────────────────────────────────────────────────

describe('getMonthlyReportCohort', () => {
  const month = '2026-01'
  const target = 'LWS_NDA_2Y_(26-28)_A'

  function p(over = {}) {
    return {
      lwsId: 'LWS-001', name: 'Alice', accountStatus: 'Active',
      batches: [target], regDate: '2025-11-01', nameVariants: ['Alice'],
      ...over,
    }
  }

  it('includes Active students whose batch matches and regDate is on or before month-end', () => {
    const profiles = {
      Alice: p({ lwsId: 'LWS-001', name: 'Alice' }),
      Bob:   p({ lwsId: 'LWS-002', name: 'Bob' }),
    }
    const cohort = getMonthlyReportCohort(profiles, target, month)
    expect(cohort.map(s => s.name)).toEqual(['Alice', 'Bob'])
  })

  it('excludes students whose accountStatus is not Active', () => {
    const profiles = {
      Alice: p({ name: 'Alice' }),
      Bob:   p({ lwsId: 'LWS-002', name: 'Bob', accountStatus: 'Block' }),
    }
    const cohort = getMonthlyReportCohort(profiles, target, month)
    expect(cohort.map(s => s.name)).toEqual(['Alice'])
  })

  it('excludes students whose batches[] does not include the target batch', () => {
    const profiles = {
      Alice: p({ name: 'Alice' }),
      Bob:   p({ lwsId: 'LWS-002', name: 'Bob', batches: ['APJ_NDA_2Y_(26-28)'] }),
    }
    const cohort = getMonthlyReportCohort(profiles, target, month)
    expect(cohort.map(s => s.name)).toEqual(['Alice'])
  })

  it('excludes students whose regDate is after the last day of the month', () => {
    const profiles = {
      Alice: p({ name: 'Alice' }),
      Bob:   p({ lwsId: 'LWS-002', name: 'Bob', regDate: '2026-02-15' }),
      Cara:  p({ lwsId: 'LWS-003', name: 'Cara', regDate: '2026-01-31' }),  // boundary — included
    }
    const cohort = getMonthlyReportCohort(profiles, target, month)
    expect(cohort.map(s => s.name).sort()).toEqual(['Alice', 'Cara'])
  })

  it('skips variant-keyed entries (only counts canonical p.name === key)', () => {
    const alice = p({ name: 'Alice', nameVariants: ['Alice', 'Alicia'] })
    const profiles = { Alice: alice, Alicia: alice }
    const cohort = getMonthlyReportCohort(profiles, target, month)
    expect(cohort.map(s => s.name)).toEqual(['Alice'])
  })

  it('returns an empty array when no batch is supplied', () => {
    const profiles = { Alice: p({ name: 'Alice' }) }
    expect(getMonthlyReportCohort(profiles, '', month)).toEqual([])
    expect(getMonthlyReportCohort(profiles, null, month)).toEqual([])
  })

  it('sorts the cohort by name', () => {
    const profiles = {
      Zara: p({ lwsId: 'LWS-099', name: 'Zara' }),
      Bob:  p({ lwsId: 'LWS-002', name: 'Bob' }),
      Alice: p({ name: 'Alice' }),
    }
    const cohort = getMonthlyReportCohort(profiles, target, month)
    expect(cohort.map(s => s.name)).toEqual(['Alice', 'Bob', 'Zara'])
  })
})
