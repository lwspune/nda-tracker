import { describe, it, expect } from 'vitest'
import { planScanSave, nameKey } from '../mergeResults'

const row = (name, marks, o = {}) => ({
  name, rollNo: '', totalMarks: marks, correct: 0, incorrect: 0,
  notAttempted: 0, responses: {}, choices: {}, ...o,
})

const exam = (o = {}) => ({
  id: 'e1', name: 'Mock 1', questions: [{ q: 1, answer: 'A' }],
  marking: { correct: 4, wrong: -1 }, students: [], ...o,
})

const roster = [
  { lwsId: 'LWS-001', name: 'Asha Rane', nameVariants: ['Asha Rane', 'Asha R'] },
  { lwsId: 'LWS-002', name: 'Bhavesh Patil', nameVariants: ['Bhavesh Patil'] },
]

describe('nameKey', () => {
  it('ignores case, padding and repeated spaces', () => {
    expect(nameKey('  Pooja  Harishchandra   Gaikwad ')).toBe(nameKey('pooja harishchandra gaikwad'))
  })

  it('is empty for nothing', () => {
    expect(nameKey(null)).toBe('')
    expect(nameKey('   ')).toBe('')
  })
})

describe('planScanSave', () => {
  it('files a first stack as-is', () => {
    const plan = planScanSave({ exam: exam(), scanned: [row('Asha Rane', 4)], roster })
    expect(plan.students.map(s => s.name)).toEqual(['Asha Rane'])
    expect(plan.added).toBe(1)
    expect(plan.replaced).toBe(0)
  })

  // The reason this module exists: scanning a second stack used to replace the
  // whole results array, silently discarding the first.
  it('keeps results that were filed before this stack', () => {
    const plan = planScanSave({
      exam: exam({ students: [row('Asha Rane', 4), row('Bhavesh Patil', 8)] }),
      scanned: [row('Chetan Rao', 12)],
      roster,
    })
    expect(plan.students.map(s => s.name)).toEqual(['Asha Rane', 'Bhavesh Patil', 'Chetan Rao'])
    expect(plan.added).toBe(1)
    expect(plan.kept).toBe(2)
  })

  it('re-scanning a student replaces that row rather than duplicating them', () => {
    const plan = planScanSave({
      exam: exam({ students: [row('Asha Rane', 4)] }),
      scanned: [row('Asha Rane', 16)],
      roster,
    })
    expect(plan.students).toHaveLength(1)
    expect(plan.students[0].totalMarks).toBe(16)
    expect(plan.replaced).toBe(1)
    expect(plan.added).toBe(0)
  })

  // Results are filed under whatever the sheet spelled. A scan files the
  // canonical name, so matching on the raw string alone would file the same
  // student twice — the trap `name_variants` exists to close everywhere else.
  it('matches a prior result filed under a name variant', () => {
    const plan = planScanSave({
      exam: exam({ students: [row('Asha R', 4)] }),
      scanned: [row('Asha Rane', 16)],
      roster,
    })
    expect(plan.students).toHaveLength(1)
    expect(plan.students[0].totalMarks).toBe(16)
    expect(plan.replaced).toBe(1)
  })

  it('holds a replaced row in its original position', () => {
    const plan = planScanSave({
      exam: exam({ students: [row('Asha Rane', 4), row('Bhavesh Patil', 8)] }),
      scanned: [row('Asha Rane', 16)],
      roster,
    })
    expect(plan.students.map(s => s.name)).toEqual(['Asha Rane', 'Bhavesh Patil'])
    expect(plan.students[0].totalMarks).toBe(16)
  })

  it('leaves a student it cannot place in the roster alone', () => {
    const plan = planScanSave({
      exam: exam({ students: [row('Someone Untagged', 4)] }),
      scanned: [row('Someone Untagged', 16)],
      roster,
    })
    expect(plan.students).toHaveLength(1)
    expect(plan.students[0].totalMarks).toBe(16)
  })

  it('does not mutate what it was given', () => {
    const students = [row('Asha Rane', 4)]
    const e = exam({ students })
    planScanSave({ exam: e, scanned: [row('Asha Rane', 16)], roster })
    expect(students[0].totalMarks).toBe(4)
    expect(e.students).toHaveLength(1)
  })
})

describe('planScanSave · provenance', () => {
  it('records the scanner as grader for an exam nobody had graded', () => {
    const plan = planScanSave({ exam: exam(), scanned: [row('Asha Rane', 4)], roster })
    expect(plan.gradedBy).toBe('scanner')
    expect(plan.mixesProvenance).toBe(false)
  })

  // `responses` on an Evalbee row is the machine's verdict and must never be
  // re-derived from a key. Relabelling the whole exam 'scanner' because two
  // sheets were scanned into it is what would make a later re-grade unsafe.
  it('keeps the vendor as grader while any vendor-graded row survives', () => {
    const plan = planScanSave({
      exam: exam({ gradedBy: 'evalbee', students: [row('Asha Rane', 4), row('Bhavesh Patil', 8)] }),
      scanned: [row('Asha Rane', 16)],
      roster,
    })
    expect(plan.gradedBy).toBe('evalbee')
    expect(plan.keptVendor).toBe(1)
  })

  it('hands grading to the scanner once every vendor row has been re-scanned', () => {
    const plan = planScanSave({
      exam: exam({ gradedBy: 'evalbee', students: [row('Asha Rane', 4)] }),
      scanned: [row('Asha Rane', 16), row('Bhavesh Patil', 8)],
      roster,
    })
    expect(plan.gradedBy).toBe('scanner')
    expect(plan.keptVendor).toBe(0)
  })

  it('flags that scanning into a vendor-graded exam mixes provenance', () => {
    const plan = planScanSave({
      exam: exam({ gradedBy: 'evalbee', students: [row('Asha Rane', 4)] }),
      scanned: [row('Bhavesh Patil', 8)],
      roster,
    })
    expect(plan.mixesProvenance).toBe(true)
  })

  it('does not flag a stack added to an exam this scanner already graded', () => {
    const plan = planScanSave({
      exam: exam({ gradedBy: 'scanner', students: [row('Asha Rane', 4)] }),
      scanned: [row('Bhavesh Patil', 8)],
      roster,
    })
    expect(plan.mixesProvenance).toBe(false)
    expect(plan.gradedBy).toBe('scanner')
  })
})
