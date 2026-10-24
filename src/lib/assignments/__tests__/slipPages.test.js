import { describe, it, expect } from 'vitest'
import { slipQuestions, countSlipStudents, planSlipPages, slipPageHeader } from '../slipPages'

// Grade rows in the mapSubmissionRow shape.
const g = (label, maxMarks, awarded, cause = null, missing = null) => ({
  position: Number(label.slice(1)), label, maxMarks,
  outcome: awarded === null ? 'not_attempted' : 'scored', awarded,
  earned: null, missing, cause, topic: null,
})

// A graded submission with `pages` marked pages, in the mapSubmissionRow shape.
const sub = (id, studentName, grades, { status = 'graded', pages = 3, scansDeletedAt = null } = {}) => ({
  id, assignmentId: 'a1', lwsId: `L-${id}`, studentName, status, grades, scansDeletedAt,
  markedPages: Array.from({ length: pages }, (_, i) => `a1/L-${id}/${id}/marked/${String(i + 1).padStart(2, '0')}.jpg`),
})

const mark = (submissionId, label, page) => ({ submissionId, label, page })

describe('slipQuestions', () => {
  it('keeps only scored questions that lost marks to a slip', () => {
    const s = sub('s1', 'Aarav', [
      g('Q1', 5, 5),
      g('Q2', 5, 2.5, 'careless', 'Sign slip.'),
      g('Q3', 5, 1, 'concept'),
      g('Q4', 5, null, 'careless'),
      g('Q5', 5, 5, 'careless'), // full marks: a stray cause loses nothing
    ])
    expect(slipQuestions(s).map(q => q.label)).toEqual(['Q2'])
  })
})

describe('countSlipStudents', () => {
  it('counts released grades with at least one slip, never a held one', () => {
    const subs = [
      sub('s1', 'Aarav', [g('Q1', 5, 3, 'careless')]),
      sub('s2', 'Bina', [g('Q1', 5, 5)]),
      sub('s3', 'Chetan', [g('Q1', 5, 3, 'careless')], { status: 'held' }),
      sub('s4', 'Dev', [g('Q1', 5, 3, 'careless')], { status: 'submitted' }),
    ]
    expect(countSlipStudents(subs)).toBe(1)
  })
})

describe('planSlipPages', () => {
  it('returns the marked page each slip sits on, with what the grader noted', () => {
    const subs = [sub('s1', 'Aarav', [g('Q1', 5, 5), g('Q2', 5, 2.5, 'careless', 'Sign slip in the last line.')])]
    const marks = [mark('s1', 'Q1', 1), mark('s1', 'Q2', 2), mark('s1', 'Q2', 2)]
    const { pages, missing } = planSlipPages(subs, marks)
    expect(pages).toEqual([{
      submissionId: 's1', studentName: 'Aarav', page: 2, path: 'a1/L-s1/s1/marked/02.jpg',
      slips: [{ label: 'Q2', lost: 2.5, max: 5, missing: 'Sign slip in the last line.' }],
    }])
    expect(missing).toEqual([])
  })

  it('puts a page with two slips in once, listing both in question order', () => {
    const subs = [sub('s1', 'Aarav', [g('Q3', 4, 3, 'careless', 'b'), g('Q2', 4, 2, 'careless', 'a')])]
    const { pages } = planSlipPages(subs, [mark('s1', 'Q3', 1), mark('s1', 'Q2', 1)])
    expect(pages).toHaveLength(1)
    expect(pages[0].slips.map(s => s.label)).toEqual(['Q2', 'Q3'])
  })

  it('includes every page a slip question runs across', () => {
    const subs = [sub('s1', 'Aarav', [g('Q1', 6, 4, 'careless')])]
    const { pages } = planSlipPages(subs, [mark('s1', 'Q1', 3), mark('s1', 'Q1', 2)])
    expect(pages.map(p => p.page)).toEqual([2, 3])
  })

  it('orders by student name, then page', () => {
    const subs = [
      sub('s1', 'chetan', [g('Q1', 5, 3, 'careless')]),
      sub('s2', 'Aarav', [g('Q1', 5, 3, 'careless')]),
      sub('s3', 'Bina', [g('Q1', 5, 3, 'careless')]),
    ]
    const marks = [mark('s1', 'Q1', 1), mark('s2', 'Q1', 3), mark('s2', 'Q1', 1), mark('s3', 'Q1', 2)]
    const { pages } = planSlipPages(subs, marks)
    expect(pages.map(p => `${p.studentName}:${p.page}`)).toEqual(['Aarav:1', 'Aarav:3', 'Bina:2', 'chetan:1'])
  })

  it('never includes a held grade — the student has not been shown it', () => {
    const subs = [sub('s1', 'Aarav', [g('Q1', 5, 3, 'careless')], { status: 'held' })]
    expect(planSlipPages(subs, [mark('s1', 'Q1', 1)])).toEqual({ pages: [], missing: [] })
  })

  it('names a student whose pages were deleted after grading, instead of dropping them silently', () => {
    const subs = [sub('s1', 'Aarav', [g('Q1', 5, 3, 'careless'), g('Q2', 5, 4, 'careless')], { scansDeletedAt: '2026-10-01T00:00:00Z' })]
    const { pages, missing } = planSlipPages(subs, [mark('s1', 'Q1', 1)])
    expect(pages).toEqual([])
    expect(missing).toEqual([{ studentName: 'Aarav', reason: 'deleted', questions: ['Q1', 'Q2'] }])
  })

  it('names a grade saved before marked pages existed', () => {
    const subs = [sub('s1', 'Aarav', [g('Q1', 5, 3, 'careless')], { pages: 0 })]
    const { missing } = planSlipPages(subs, [])
    expect(missing).toEqual([{ studentName: 'Aarav', reason: 'no_pages', questions: ['Q1'] }])
  })

  it('names a slip with no mark on any page, keeping the rest of that student', () => {
    const subs = [sub('s1', 'Aarav', [g('Q1', 5, 3, 'careless'), g('Q2', 5, 3, 'careless')])]
    const { pages, missing } = planSlipPages(subs, [mark('s1', 'Q1', 1)])
    expect(pages.map(p => p.page)).toEqual([1])
    expect(missing).toEqual([{ studentName: 'Aarav', reason: 'no_pages', questions: ['Q2'] }])
  })

  it('ignores marks belonging to other questions or other submissions', () => {
    const subs = [sub('s1', 'Aarav', [g('Q1', 5, 3, 'careless'), g('Q2', 5, 5)])]
    const { pages } = planSlipPages(subs, [mark('s1', 'Q2', 3), mark('s9', 'Q1', 2), mark('s1', 'Q1', 1)])
    expect(pages.map(p => p.page)).toEqual([1])
  })
})

describe('slipPageHeader', () => {
  it('names the student and page, then one line per slip', () => {
    const header = slipPageHeader({
      studentName: 'Aarav', page: 2,
      slips: [
        { label: 'Q2', lost: 2.5, max: 5, missing: '−6 + 14 − 10 is −2, not 2.' },
        { label: 'Q3', lost: 1, max: 4, missing: null },
      ],
    })
    expect(header.title).toBe('Aarav · page 2')
    expect(header.lines).toEqual(['Q2 (lost 2.5 of 5): −6 + 14 − 10 is −2, not 2.', 'Q3 (lost 1 of 4)'])
  })
})
