import { describe, it, expect } from 'vitest'
import {
  FEEDBACK_DIMENSIONS,
  detectBlockStarts,
  parseFormTimestamp,
  reshapeFeedbackMatrix,
  aggregateFeedback,
  feedbackTrend,
} from '../teacherFeedback'

// A header with Timestamp + two 9-col teacher blocks
const DIMS = FEEDBACK_DIMENSIONS.map(d => d.label)
function blockHeader(n) {
  const block = [
    'Clarity: explains clearly', 'Engagement: interesting', 'Support: comfortable',
    'Feedback: timely', 'Pace: appropriate', 'Respect: inclusive',
    'Organization: prepared', 'Availability: accessible',
    'What is one specific thing the teacher could do to improve…',
  ]
  return ['Timestamp', ...Array.from({ length: n }, () => block).flat()]
}

describe('detectBlockStarts', () => {
  it('finds one start per teacher block (Clarity columns)', () => {
    expect(detectBlockStarts(blockHeader(3))).toEqual([1, 10, 19])
  })
  it('returns [] for a non-array', () => {
    expect(detectBlockStarts(null)).toEqual([])
  })
})

describe('parseFormTimestamp', () => {
  it('parses DD/MM/YYYY HH:MM:SS to IST ISO', () => {
    expect(parseFormTimestamp('30/05/2026 16:40:37')).toBe('2026-05-30T16:40:37+05:30')
  })
  it('pads single-digit day/month/hour', () => {
    expect(parseFormTimestamp('5/2/2026 9:05:00')).toBe('2026-02-05T09:05:00+05:30')
  })
  it('handles a date with no time', () => {
    expect(parseFormTimestamp('31/05/2026')).toBe('2026-05-31T00:00:00+05:30')
  })
  it('returns null for junk', () => {
    expect(parseFormTimestamp('not a date')).toBeNull()
    expect(parseFormTimestamp('')).toBeNull()
  })
})

describe('reshapeFeedbackMatrix', () => {
  const header = blockHeader(2)

  it('produces one row per (response, mapped teacher)', () => {
    const matrix = [
      header,
      ['30/05/2026 16:40:37', 4, 4, 4, 5, 4, 4, 4, 4, 'More practice', 3, 4, 4, 5, 4, 4, 4, 4, 'Explain more'],
    ]
    const rows = reshapeFeedbackMatrix(matrix, ['Akash Rathod Sir', 'Ishant Sir'], { cycle: 'C1', branch: 'LWS Pune' })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      cycle: 'C1', branch: 'LWS Pune', teacher_name: 'Akash Rathod Sir',
      clarity: 4, engagement: 4, support: 4, feedback: 5, pace: 4, respect: 4, organization: 4, availability: 4,
      comment: 'More practice', submitted_at: '2026-05-30T16:40:37+05:30',
    })
    expect(rows[1].teacher_name).toBe('Ishant Sir')
    expect(rows[1].clarity).toBe(3)
  })

  it('skips an unfilled block (all ratings blank + no comment)', () => {
    const matrix = [
      header,
      ['30/05/2026 17:00:00', 5, 5, 5, 5, 5, 5, 5, 5, 'Good', '', '', '', '', '', '', '', '', ''],
    ]
    const rows = reshapeFeedbackMatrix(matrix, ['Akash Rathod Sir', 'Ishant Sir'], { cycle: 'C1' })
    expect(rows).toHaveLength(1)
    expect(rows[0].teacher_name).toBe('Akash Rathod Sir')
  })

  it('skips a block whose teacher name is unmapped', () => {
    const matrix = [
      header,
      ['30/05/2026 17:00:00', 5, 5, 5, 5, 5, 5, 5, 5, 'Good', 4, 4, 4, 4, 4, 4, 4, 4, 'Ok'],
    ]
    const rows = reshapeFeedbackMatrix(matrix, ['Akash Rathod Sir', ''], { cycle: 'C1' })
    expect(rows).toHaveLength(1)
    expect(rows[0].teacher_name).toBe('Akash Rathod Sir')
  })

  it('coerces out-of-range / non-numeric ratings to null', () => {
    const matrix = [
      header,
      ['30/05/2026 17:00:00', 7, 'x', 0, 5, 4, 4, 4, 4, 'C', 1, 1, 1, 1, 1, 1, 1, 1, 'D'],
    ]
    const rows = reshapeFeedbackMatrix(matrix, ['A', 'B'], {})
    expect(rows[0].clarity).toBeNull()      // 7 > 5
    expect(rows[0].engagement).toBeNull()   // 'x'
    expect(rows[0].support).toBeNull()      // 0 < 1
    expect(rows[0].feedback).toBe(5)
  })

  it('returns [] for an empty / header-only matrix', () => {
    expect(reshapeFeedbackMatrix([header], ['A', 'B'], {})).toEqual([])
    expect(reshapeFeedbackMatrix([], ['A'], {})).toEqual([])
  })
})

describe('aggregateFeedback', () => {
  it('computes per-teacher n, overall and per-dimension means, collects comments', () => {
    const rows = [
      { teacher_name: 'A', clarity: 4, engagement: 4, support: 4, feedback: 4, pace: 4, respect: 4, organization: 4, availability: 4, comment: 'good', cycle: 'C1' },
      { teacher_name: 'A', clarity: 2, engagement: 2, support: 2, feedback: 2, pace: 2, respect: 2, organization: 2, availability: 2, comment: '', cycle: 'C1' },
      { teacher_name: 'B', clarity: 5, engagement: 5, support: 5, feedback: 5, pace: 5, respect: 5, organization: 5, availability: 5, comment: 'great', cycle: 'C1' },
    ]
    const agg = aggregateFeedback(rows)
    const A = agg.find(a => a.teacher === 'A')
    expect(A.n).toBe(2)
    expect(A.overall).toBe(3)            // all dims average (4+2)/2 = 3
    expect(A.dims.clarity).toBe(3)
    expect(A.comments).toHaveLength(1)   // blank comment dropped
    expect(A.comments[0].comment).toBe('good')
    const B = agg.find(a => a.teacher === 'B')
    expect(B.overall).toBe(5)
  })

  it('ignores null dimension values in the mean', () => {
    const rows = [
      { teacher_name: 'A', clarity: 4, engagement: null, support: null, feedback: null, pace: null, respect: null, organization: null, availability: null, comment: '' },
    ]
    const A = aggregateFeedback(rows)[0]
    expect(A.dims.clarity).toBe(4)
    expect(A.dims.engagement).toBeNull()
    expect(A.overall).toBe(4) // only the one non-null value
  })
})

describe('feedbackTrend', () => {
  it('produces per-teacher overall per cycle, sorted by cycle', () => {
    const rows = [
      { teacher_name: 'A', clarity: 4, engagement: 4, support: 4, feedback: 4, pace: 4, respect: 4, organization: 4, availability: 4, cycle: '02' },
      { teacher_name: 'A', clarity: 2, engagement: 2, support: 2, feedback: 2, pace: 2, respect: 2, organization: 2, availability: 2, cycle: '03' },
    ]
    const trend = feedbackTrend(rows)
    const A = trend.find(t => t.teacher === 'A')
    expect(A.cycles).toEqual([
      { cycle: '02', overall: 4, n: 1 },
      { cycle: '03', overall: 2, n: 1 },
    ])
  })
})
