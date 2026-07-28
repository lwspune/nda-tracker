import { describe, it, expect } from 'vitest'
import {
  homeworkTypeLabel, formatHomeworkItem, homeworkItemKey, homeworkNotifyKey, deriveHomeworkType,
} from '../homework'

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
