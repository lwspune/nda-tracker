import { describe, it, expect } from 'vitest'
import {
  homeworkTypeLabel, formatHomeworkItem, homeworkItemKey, homeworkNotifyKey, deriveHomeworkType,
  getHomeworkTargets,
} from '../homework'

// Homework has no slot dimension, so several periods of one subject+batch on a
// day are ONE item. Live timetable data has this everywhere — Akash Rathod Sir
// teaches Eng/GS to LWS_NDA_6M three times on a Monday.
describe('getHomeworkTargets', () => {
  it('collapses repeated periods of the same subject + batch into one target', () => {
    const targets = getHomeworkTargets([
      { subject: 'Eng/GS', batchName: '6M', slotId: 's1' },
      { subject: 'Eng/GS', batchName: '6M', slotId: 's2' },
      { subject: 'Eng/GS', batchName: '6M', slotId: 's3' },
    ])
    expect(targets).toEqual([{ key: 'Eng/GS|6M', subject: 'Eng/GS', batchName: '6M' }])
  })

  it('keeps the same subject taught to different batches apart', () => {
    const targets = getHomeworkTargets([
      { subject: 'Maths', batchName: '12th' },
      { subject: 'Maths', batchName: '11th' },
    ])
    expect(targets.map(t => t.batchName)).toEqual(['11th', '12th'])   // batch-sorted
  })

  it('keeps different subjects for one batch apart', () => {
    const targets = getHomeworkTargets([
      { subject: 'Physics', batchName: '12th' },
      { subject: 'Maths', batchName: '12th' },
    ])
    expect(targets.map(t => t.subject)).toEqual(['Maths', 'Physics'])
  })

  it('skips lectures missing a subject or batch, and tolerates no input', () => {
    // An unassigned mapping yields a null subject; it is not a homework target.
    expect(getHomeworkTargets([{ subject: null, batchName: '12th' }, { subject: 'Maths' }])).toEqual([])
    expect(getHomeworkTargets(null)).toEqual([])
  })
})

describe('deriveHomeworkType', () => {
  it('maps the two checkboxes onto the CHECK-constrained type column', () => {
    expect(deriveHomeworkType(true, true)).toBe('both')
    expect(deriveHomeworkType(false, true)).toBe('notes')
    expect(deriveHomeworkType(true, false)).toBe('homework')
  })

  it('returns null when neither is ticked — never a silent default', () => {
    // There is no item to file. A caller that defaulted to 'homework' would
    // log work the teacher never assigned.
    expect(deriveHomeworkType(false, false)).toBeNull()
    expect(deriveHomeworkType(undefined, undefined)).toBeNull()
  })
})

describe('homework display helpers', () => {
  it('labels each type for the UI', () => {
    expect(homeworkTypeLabel('both')).toBe('homework + notes')
    expect(homeworkTypeLabel('notes')).toBe('notes')
    expect(homeworkTypeLabel('homework')).toBe('homework')
  })

  it('formats an item, tolerating a missing chapter', () => {
    expect(formatHomeworkItem({ subject: 'Maths', chapter: 'Trigonometry', type: 'both' }))
      .toBe('Maths · Trigonometry (homework + notes)')
    expect(formatHomeworkItem({ subject: 'Maths', chapter: '', type: 'notes' }))
      .toBe('Maths (notes)')
  })

  it('keys items and notifications distinctly', () => {
    expect(homeworkItemKey('Maths', 'Trig', 'both')).toBe('Maths|||Trig|||both')
    expect(homeworkNotifyKey('LWS-1', 'Maths', 'Trig', 'both')).toBe('LWS-1|||Maths|||Trig|||both')
  })
})
