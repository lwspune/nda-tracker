import { describe, it, expect } from 'vitest'
import { getExamScoreSummary } from '../examInsights'

// A written exam: totals only, no questions[]. maxMarks is the paper ceiling.
function makeExam(marks, maxMarks = 20) {
  return {
    questions: [],
    maxMarks,
    students: marks.map((m, i) => ({ name: `S${i + 1}`, totalMarks: m, responses: {} })),
  }
}

describe('getExamScoreSummary', () => {
  it('reports the class size and paper ceiling', () => {
    const s = getExamScoreSummary(makeExam([10, 12, 14], 20))
    expect(s.count).toBe(3)
    expect(s.maxMarks).toBe(20)
  })

  it('computes min, max and mean in marks', () => {
    const s = getExamScoreSummary(makeExam([10, 12, 20], 20))
    expect(s.min).toBe(10)
    expect(s.max).toBe(20)
    expect(s.mean).toBe(14)
  })

  it('takes the middle value as median for an odd class', () => {
    expect(getExamScoreSummary(makeExam([4, 20, 12], 20)).median).toBe(12)
  })

  it('averages the two middle values as median for an even class', () => {
    expect(getExamScoreSummary(makeExam([4, 10, 14, 20], 20)).median).toBe(12)
  })

  // The median is the point of the panel: on a small paper one runaway score
  // drags the mean somewhere no student actually sat.
  it('resists an outlier that skews the mean', () => {
    const s = getExamScoreSummary(makeExam([1, 18, 19, 20, 20], 20))
    expect(s.median).toBe(19)
    expect(s.mean).toBeLessThan(s.median)
  })

  it('reports spread as the standard deviation of the marks', () => {
    expect(getExamScoreSummary(makeExam([10, 10, 10], 20)).spread).toBe(0)
    expect(getExamScoreSummary(makeExam([0, 20], 20)).spread).toBe(10)
  })

  // Bands reuse the app's existing score thresholds (scoreColor: >=70% strong,
  // >=45% fair, else weak) so a band means the same thing here as everywhere else.
  it('buckets students by the same thresholds the score colours use', () => {
    // 20/20 = 100%, 14/20 = 70%, 9/20 = 45%, 8/20 = 40%, 0/20 = 0%
    const s = getExamScoreSummary(makeExam([20, 14, 9, 8, 0], 20))
    expect(s.bands).toEqual({ strong: 2, fair: 1, weak: 2 })
  })

  it('counts a boundary score into the higher band', () => {
    expect(getExamScoreSummary(makeExam([14], 20)).bands.strong).toBe(1)
    expect(getExamScoreSummary(makeExam([9], 20)).bands.fair).toBe(1)
  })

  // examMaxMarks answers "can't compute" with 0; dividing by it would make every
  // student 0% and drop the whole class into the weak band, which reads as a
  // real result rather than a missing one.
  it('reports percentages as null when the paper ceiling is unusable', () => {
    const s = getExamScoreSummary({ questions: [], students: [{ name: 'A', totalMarks: 5 }] })
    expect(s.maxMarks).toBe(0)
    expect(s.meanPct).toBeNull()
    expect(s.bands).toBeNull()
  })

  it('handles an exam with no results at all', () => {
    const s = getExamScoreSummary(makeExam([], 20))
    expect(s.count).toBe(0)
    expect(s.median).toBeNull()
    expect(s.mean).toBeNull()
    expect(s.bands).toEqual({ strong: 0, fair: 0, weak: 0 })
  })

  it('tolerates a missing exam', () => {
    expect(getExamScoreSummary(null).count).toBe(0)
  })
})
