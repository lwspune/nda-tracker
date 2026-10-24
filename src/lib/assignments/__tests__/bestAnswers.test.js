import { describe, it, expect } from 'vitest'
import {
  bestAnswersBlockers, shortlistBestAnswers, validateBestFile, bestFileTemplate, bestAnswersPdfPath,
} from '../bestAnswers'
import { isQuestionFilePath } from '../upload'

const DAY = 864e5
const NOW = new Date('2026-10-24T12:00:00Z')
const closed = { id: 'a1', dueAt: new Date(NOW - DAY).toISOString() }
const open = { id: 'a1', dueAt: new Date(NOW.getTime() + DAY).toISOString() }

const QUESTIONS = [{ label: 'Q1', marks: 5 }, { label: 'Q2', marks: 5 }, { label: 'Q3', marks: 5 }]

const g = (label, awarded, missing = null, outcome = 'scored') =>
  ({ position: Number(label.slice(1)), label, maxMarks: 5, outcome, awarded, missing, cause: null })

// A submission in the mapSubmissionRow shape (markedPages: storage paths).
const sub = (id, studentName, grades, over = {}) => ({
  id, lwsId: `L-${id}`, studentName, status: 'graded', handCheck: 'match', scansDeletedAt: null,
  markedPages: [`a1/L-${id}/${id}/marked/01.jpg`, `a1/L-${id}/${id}/marked/02.jpg`], grades, ...over,
})
const mark = (submissionId, label, page) => ({ submissionId, label, page })

describe('bestAnswersBlockers', () => {
  it('allows a closed homework with nothing waiting', () => {
    expect(bestAnswersBlockers(closed, [sub('s1', 'A', [])], NOW)).toEqual([])
  })

  it('refuses while the homework is open, or a hand-in waits to be graded', () => {
    expect(bestAnswersBlockers(open, [sub('s0', 'Z', [])], NOW)).toEqual([expect.stringMatching(/still open/i)])
    const waiting = [sub('s0', 'Z', []), sub('s1', 'A', [], { status: 'submitted' }), sub('s2', 'B', [], { status: 'submitted' })]
    expect(bestAnswersBlockers(closed, waiting, NOW)).toEqual([expect.stringMatching(/2 hand-ins are still waiting/i)])
  })

  it('refuses when nothing has been graded', () => {
    expect(bestAnswersBlockers(closed, [sub('s1', 'A', [], { status: 'rejected' })], NOW))
      .toEqual([expect.stringMatching(/nothing has been graded/i)])
  })
})

describe('shortlistBestAnswers', () => {
  const subs = [
    sub('s1', 'Chetan', [g('Q1', 5), g('Q2', 3, 'No final value.'), g('Q3', 0)]),
    sub('s2', 'Aarav', [g('Q1', 5), g('Q2', 4, 'Sign error.'), g('Q3', null, null, 'not_attempted')]),
    sub('s3', 'Bina', [g('Q1', 5, 'No units.'), g('Q2', 4, 'No reason given.'), g('Q3', 0)]),
  ]
  const marks = [
    mark('s1', 'Q1', 1), mark('s1', 'Q2', 2), mark('s1', 'Q3', 2),
    mark('s2', 'Q1', 1), mark('s2', 'Q1', 2), mark('s2', 'Q2', 2),
    mark('s3', 'Q1', 1), mark('s3', 'Q2', 1),
  ]
  const list = shortlistBestAnswers(QUESTIONS, subs, marks)

  it('shortlists full marks with nothing missing, in name order, with the pages each answer is on', () => {
    expect(list[0]).toEqual({
      label: 'Q1', max: 5, kind: 'full',
      candidates: [
        { submissionId: 's2', studentName: 'Aarav', awarded: 5, missing: null, pages: [1, 2], pageCount: 2 },
        { submissionId: 's1', studentName: 'Chetan', awarded: 5, missing: null, pages: [1], pageCount: 2 },
      ],
    })
  })

  it('falls back to the highest mark when nobody got full marks, keeping every tie', () => {
    expect(list[1].kind).toBe('best_attempt')
    expect(list[1].candidates.map(c => [c.studentName, c.awarded, c.missing])).toEqual([
      ['Aarav', 4, 'Sign error.'], ['Bina', 4, 'No reason given.'],
    ])
  })

  it('has no candidates when nobody scored on a question', () => {
    expect(list[2]).toEqual({ label: 'Q3', max: 5, kind: 'none', candidates: [] })
  })

  it('never shortlists a held grade, a flagged handwriting check, purged pages, or an answer with no marked page', () => {
    const risky = [
      sub('h', 'Held', [g('Q1', 5)], { status: 'held' }),
      sub('m', 'Mismatch', [g('Q1', 5)], { handCheck: 'mismatch' }),
      sub('u', 'Unclear', [g('Q1', 5)], { handCheck: 'unclear' }),
      sub('p', 'Purged', [g('Q1', 5)], { scansDeletedAt: '2026-10-01T00:00:00Z' }),
      sub('n', 'Unmarked', [g('Q1', 5)]),
      sub('ok', 'Fine', [g('Q1', 5)], { handCheck: 'no_reference' }),
    ]
    const ms = ['h', 'm', 'u', 'p', 'ok'].map(id => mark(id, 'Q1', 1))
    const [q1] = shortlistBestAnswers([{ label: 'Q1', marks: 5 }], risky, ms)
    expect(q1.candidates.map(c => c.studentName)).toEqual(['Fine'])
  })
})

describe('validateBestFile', () => {
  const subs = [
    sub('s1', 'Chetan', [g('Q1', 5), g('Q2', 3, 'No final value.')]),
    sub('s2', 'Aarav', [g('Q1', 5), g('Q2', 0)]),
  ]
  const marks = [mark('s1', 'Q1', 1), mark('s1', 'Q2', 2), mark('s2', 'Q1', 2)]
  const shortlist = shortlistBestAnswers(QUESTIONS.slice(0, 2), subs, marks)
  const good = () => ({
    assignmentId: 'a1',
    picks: [
      { label: 'Q1', submissionId: 's2', crops: [{ page: 2, x: 5, y: 10, w: 90, h: 40 }], reason: 'Every step stated, neatly set out.' },
      { label: 'Q2', submissionId: 's1', crops: [{ page: 2, x: 0, y: 50, w: 100, h: 50 }], reason: 'Right method; only the last line is missing.' },
    ],
  })

  it('resolves a complete file into what the PDF prints', () => {
    const r = validateBestFile(good(), { assignmentId: 'a1', shortlist })
    expect(r.ok).toBe(true)
    expect(r.picks[0]).toEqual({
      label: 'Q1', max: 5, kind: 'full', submissionId: 's2', studentName: 'Aarav', awarded: 5, missing: null,
      crops: [{ page: 2, x: 5, y: 10, w: 90, h: 40 }], reason: 'Every step stated, neatly set out.',
    })
    expect(r.picks[1]).toMatchObject({ kind: 'best_attempt', studentName: 'Chetan', awarded: 3, missing: 'No final value.' })
  })

  it('names every problem at once', () => {
    const f = good()
    f.picks[0].submissionId = 's9'
    f.picks[1].crops = [{ page: 3, x: 50, y: 50, w: 60, h: 0 }]
    f.picks[1].reason = ''
    const r = validateBestFile(f, { assignmentId: 'a1', shortlist })
    expect(r.ok).toBe(false)
    expect(r.errors).toEqual([
      expect.stringMatching(/Q1: .*not on the shortlist/),
      expect.stringMatching(/Q2: crop 1: page 3 .*1 to 2/),
      expect.stringMatching(/Q2: crop 1: .*inside the page/),
      expect.stringMatching(/Q2: .*reason/),
    ])
  })

  it('needs exactly one pick per question, in order, for this homework', () => {
    const f = good()
    f.assignmentId = 'a2'
    f.picks = [f.picks[1]]
    const r = validateBestFile(f, { assignmentId: 'a1', shortlist })
    expect(r.errors).toEqual([
      expect.stringMatching(/for homework a2, not a1/),
      expect.stringMatching(/one pick per question, in order: Q1, Q2/),
    ])
  })

  it('takes no pick for a question nobody scored on', () => {
    const none = shortlistBestAnswers([{ label: 'Q3', marks: 5 }], subs, marks)
    expect(validateBestFile({ assignmentId: 'a1', picks: [{ label: 'Q3', submissionId: null, crops: [], reason: '' }] }, { assignmentId: 'a1', shortlist: none }))
      .toEqual({ ok: true, picks: [{ label: 'Q3', max: 5, kind: 'none', submissionId: null, studentName: null, awarded: null, missing: null, crops: [], reason: '' }] })
    const r = validateBestFile({ assignmentId: 'a1', picks: [{ label: 'Q3', submissionId: 's1', crops: [], reason: 'x' }] }, { assignmentId: 'a1', shortlist: none })
    expect(r.errors).toEqual([expect.stringMatching(/Q3: nobody scored/)])
  })
})

describe('bestFileTemplate', () => {
  it('starts every pick empty, so nothing passes unjudged', () => {
    const shortlist = [{ label: 'Q1', max: 5, kind: 'full', candidates: [{ submissionId: 's1' }] }, { label: 'Q2', max: 5, kind: 'none', candidates: [] }]
    expect(bestFileTemplate('a1', shortlist)).toEqual({
      assignmentId: 'a1',
      picks: [
        { label: 'Q1', submissionId: null, crops: [], reason: '' },
        { label: 'Q2', submissionId: null, crops: [], reason: '' },
      ],
    })
  })
})

describe('storage path', () => {
  it('keeps the PDF in the homework\'s own best/ folder, which the student endpoint never signs', () => {
    expect(bestAnswersPdfPath('a1')).toBe('a1/best/best-answers.pdf')
    expect(isQuestionFilePath('a1', bestAnswersPdfPath('a1'))).toBe(false)
  })
})
