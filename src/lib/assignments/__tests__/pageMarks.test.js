import { describe, it, expect } from 'vitest'
import {
  validateMarks, scoreText, drawingPayload, MARK_KINDS, MAX_NOTE_CHARS, MAX_MARKS,
} from '../pageMarks'

// Rows as validateGrade returns them.
const rows = [
  { position: 1, label: 'Q1', maxMarks: 1, outcome: 'scored', awarded: 1 },
  { position: 2, label: 'Q2', maxMarks: 3, outcome: 'scored', awarded: 2.5 },
  { position: 3, label: 'Q3', maxMarks: 5, outcome: 'not_attempted', awarded: null },
]

const score = (label, page = 1, x = 80, y = 20) => ({ page, label, kind: 'score', x, y })
const sound = () => [
  { page: 1, label: 'Q1', kind: 'tick', x: 60, y: 18 },
  score('Q1'),
  { page: 2, label: 'Q2', kind: 'note', x: 70, y: 40, text: 'Should be 5', to: { x: 50, y: 42 } },
  { page: 2, label: 'Q2', kind: 'circle', x: 48, y: 42, w: 10, h: 4 },
  score('Q2', 2),
]
const check = (marks, over = {}) => validateMarks({ marks, pageCount: 3, rows, ...over })
const errorsOf = (marks, over) => check(marks, over).errors.join(' | ')

describe('validateMarks — a sound set of marks', () => {
  it('passes and numbers the marks in file order', () => {
    const r = check(sound())
    expect(r.ok).toBe(true)
    expect(r.marks.map(m => [m.position, m.label, m.kind])).toEqual([
      [1, 'Q1', 'tick'], [2, 'Q1', 'score'], [3, 'Q2', 'note'], [4, 'Q2', 'circle'], [5, 'Q2', 'score'],
    ])
  })

  it('keeps only the fields each kind uses, with coordinates rounded to 0.1', () => {
    const r = check([
      { page: 1, label: 'Q1', kind: 'tick', x: 60.04, y: 18.06 },
      score('Q1'),
      { page: 2, label: 'Q2', kind: 'note', x: 70, y: 40, text: '  Should be 5 ', to: { x: 50.26, y: 42 } },
      { page: 2, label: 'Q2', kind: 'circle', x: 48, y: 42, w: 10.04, h: 4 },
      score('Q2', 2),
    ])
    expect(r.marks[0]).toEqual({ position: 1, page: 1, label: 'Q1', kind: 'tick', x: 60, y: 18.1, w: null, h: null, text: null, toX: null, toY: null })
    expect(r.marks[2]).toMatchObject({ text: 'Should be 5', toX: 50.3, toY: 42 })
    expect(r.marks[3]).toMatchObject({ w: 10, h: 4 })
  })

  it('needs no marks for a question not attempted', () => {
    expect(check(sound()).marks.some(m => m.label === 'Q3')).toBe(false)
  })
})

describe('validateMarks — every question is accounted for on the page', () => {
  it('needs exactly one score mark per scored question', () => {
    const none = sound().filter(m => !(m.label === 'Q1' && m.kind === 'score'))
    expect(errorsOf(none)).toMatch(/Q1: place one score mark/)
    expect(errorsOf([...sound(), score('Q2', 3)])).toMatch(/Q2 has 2 score marks/)
  })

  it('needs a cross, circle or note on a question that lost marks', () => {
    const bare = sound().filter(m => !(m.label === 'Q2' && (m.kind === 'note' || m.kind === 'circle')))
    expect(errorsOf(bare)).toMatch(/Q2: marks were lost, so show where/)
    for (const kind of ['cross', 'circle', 'note']) {
      const one = { page: 2, label: 'Q2', kind, x: 40, y: 40, ...(kind === 'circle' ? { w: 5, h: 5 } : {}), ...(kind === 'note' ? { text: 'x' } : {}) }
      expect(check([...bare, one]).ok, kind).toBe(true)
    }
  })

  // A red cross or red note beside full marks reads as a lost mark, the same
  // reason the grade checker refuses `missing` on full marks.
  it('allows only ticks and the score on a full-marks question', () => {
    for (const extra of [
      { page: 1, label: 'Q1', kind: 'cross', x: 1, y: 1 },
      { page: 1, label: 'Q1', kind: 'note', x: 1, y: 1, text: 'Neat' },
      { page: 1, label: 'Q1', kind: 'circle', x: 5, y: 5, w: 2, h: 2 },
    ]) {
      expect(errorsOf([...sound(), extra]), extra.kind).toMatch(/Q1: full marks, so only ticks and the score/)
    }
  })

  it('gives a question not attempted no score mark', () => {
    expect(errorsOf([...sound(), score('Q3')])).toMatch(/Q3: not attempted, so it gets no score mark/)
  })

  it('refuses a mark for a question that is not graded', () => {
    expect(errorsOf([...sound(), score('Q9')])).toMatch(/Mark 6: there is no question "Q9"/)
  })
})

describe('validateMarks — each mark is well formed', () => {
  it('refuses a missing marks list', () => {
    expect(validateMarks({ marks: undefined, pageCount: 3, rows }).errors.join(' ')).toMatch(/needs a `marks` list/)
  })

  it('refuses an unknown kind', () => {
    expect(errorsOf([...sound(), { page: 1, label: 'Q2', kind: 'star', x: 1, y: 1 }])).toMatch(/kind must be one of/)
  })

  it('refuses a page that does not exist', () => {
    for (const page of [0, 4, 1.5, '1']) {
      expect(errorsOf([...sound(), { page, label: 'Q2', kind: 'cross', x: 1, y: 1 }]), String(page)).toMatch(/page must be a whole number from 1 to 3/)
    }
  })

  it('refuses coordinates off the page', () => {
    for (const [x, y] of [[-1, 5], [5, 101], [NaN, 5], ['5', 5]]) {
      expect(errorsOf([...sound(), { page: 1, label: 'Q2', kind: 'cross', x, y }]), `${x},${y}`).toMatch(/x and y must be numbers from 0 to 100/)
    }
  })

  it('needs a size on a circle and nowhere else', () => {
    expect(errorsOf([...sound(), { page: 1, label: 'Q2', kind: 'circle', x: 5, y: 5 }])).toMatch(/a circle needs w and h/)
    expect(errorsOf([...sound(), { page: 1, label: 'Q2', kind: 'circle', x: 5, y: 5, w: 0, h: 3 }])).toMatch(/a circle needs w and h/)
    expect(errorsOf([...sound(), { page: 1, label: 'Q2', kind: 'cross', x: 5, y: 5, w: 3, h: 3 }])).toMatch(/only a circle has w and h/)
  })

  it('needs text on a note, at most the limit, and on no other kind', () => {
    expect(errorsOf([...sound(), { page: 1, label: 'Q2', kind: 'note', x: 5, y: 5, text: ' ' }])).toMatch(/a note needs text/)
    expect(errorsOf([...sound(), { page: 1, label: 'Q2', kind: 'note', x: 5, y: 5, text: 'x'.repeat(MAX_NOTE_CHARS + 1) }]))
      .toMatch(new RegExp(`over ${MAX_NOTE_CHARS} characters`))
    // The score's text is worked out from the grade, never typed.
    expect(errorsOf([...sound(), { page: 1, label: 'Q2', kind: 'cross', x: 5, y: 5, text: '2/3' }])).toMatch(/only a note has text/)
  })

  it('lets only a note point somewhere, at a spot on the page', () => {
    expect(errorsOf([...sound(), { page: 1, label: 'Q2', kind: 'cross', x: 5, y: 5, to: { x: 1, y: 1 } }])).toMatch(/only a note has `to`/)
    expect(errorsOf([...sound(), { page: 1, label: 'Q2', kind: 'note', x: 5, y: 5, text: 'x', to: { x: 1, y: 140 } }])).toMatch(/`to` must be a point from 0 to 100/)
  })

  it('caps the number of marks', () => {
    const many = Array.from({ length: MAX_MARKS }, () => ({ page: 1, label: 'Q2', kind: 'cross', x: 1, y: 1 }))
    expect(errorsOf([...sound(), ...many])).toMatch(new RegExp(`at most ${MAX_MARKS} marks`))
  })

  it('names every problem at once', () => {
    const r = check([{ page: 9, label: 'Q2', kind: 'cross', x: 500, y: 1 }])
    expect(r.ok).toBe(false)
    expect(r.errors.length).toBeGreaterThanOrEqual(4) // page, coordinates, Q1 score, Q2 score
  })
})

describe('scoreText', () => {
  it('prints awarded over max without trailing zeros', () => {
    expect(scoreText({ outcome: 'scored', awarded: 2.5, maxMarks: 3 })).toBe('2.5/3')
    expect(scoreText({ outcome: 'scored', awarded: 0, maxMarks: 2 })).toBe('0/2')
    expect(scoreText({ outcome: 'scored', awarded: 5, maxMarks: 5 })).toBe('5/5')
  })
})

// What the drawing script receives. The score text comes from the grade row,
// so a mark can never show a number the grade does not hold.
describe('drawingPayload', () => {
  it('fills each score mark from its grade row and states each question\'s state', () => {
    const r = check(sound())
    const p = drawingPayload({ marks: r.marks, rows })
    const scores = p.marks.filter(m => m.kind === 'score')
    expect(scores.map(m => [m.label, m.text, m.state])).toEqual([['Q1', '1/1', 'full'], ['Q2', '2.5/3', 'partial']])
    expect(p.marks.find(m => m.kind === 'tick').text).toBeNull()
  })

  it('is deterministic, so the preview stamp can compare it', () => {
    const r = check(sound())
    expect(JSON.stringify(drawingPayload({ marks: r.marks, rows })))
      .toBe(JSON.stringify(drawingPayload({ marks: r.marks, rows: [...rows] })))
  })

  it('marks a zero as `zero`', () => {
    const zeroRows = [{ position: 1, label: 'Q1', maxMarks: 2, outcome: 'scored', awarded: 0 }]
    const r = validateMarks({
      marks: [{ page: 1, label: 'Q1', kind: 'cross', x: 5, y: 5 }, score('Q1')], pageCount: 1, rows: zeroRows,
    })
    expect(drawingPayload({ marks: r.marks, rows: zeroRows }).marks[1].state).toBe('zero')
  })
})

describe('constants', () => {
  it('has the five kinds', () => {
    expect(MARK_KINDS).toEqual(['tick', 'cross', 'circle', 'note', 'score'])
  })
})
