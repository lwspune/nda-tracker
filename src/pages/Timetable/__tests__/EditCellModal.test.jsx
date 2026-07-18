import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

const mockStore = {
  timetableMappings: [],
  timetableTeachers: [],
  setTimetableCell: vi.fn(),
  clearTimetableCell: vi.fn(),
  setTimetableSpanCell: vi.fn(),
  clearTimetableSpanCell: vi.fn(),
}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

import EditCellModal from '../EditCellModal'

const TEACHERS = [
  { id: 't1', name: 'Navneet Sir' },
  { id: 't2', name: 'Akash Sir' },
]

// Deliberately out of alphabetical order in the store
const MAPPINGS = [
  { id: 'm1', label: 'Physics', subject: 'Physics', teacherId: 't1' }, // Physics (Navneet Sir)
  { id: 'm2', label: 'Chemistry', subject: null, teacherId: null },    // Chemistry
  { id: 'm3', label: 'Maths', subject: 'Maths', teacherId: 't2' },     // Maths (Akash Sir)
  { id: 'm4', label: 'Bio_NDA', subject: null, teacherId: null },      // Bio_NDA
  { id: 'm5', label: 'Chemistry', subject: null, teacherId: 't2' },    // Chemistry (Akash Sir)
]

function optionTexts() {
  // Every <option> except the leading "— Select —" placeholder
  return Array.from(document.querySelectorAll('option'))
    .map(o => o.textContent)
    .filter(t => t !== '— Select —')
}

describe('EditCellModal — mappings dropdown ordering', () => {
  it('renders the subject/teacher options in alphabetical order of the displayed label', () => {
    mockStore.timetableMappings = MAPPINGS
    mockStore.timetableTeachers = TEACHERS

    render(<EditCellModal timetableId="tt1" slotId="slot1" day="Monday" currentCell={null} onClose={vi.fn()} />)

    expect(optionTexts()).toEqual([
      'Bio_NDA',
      'Chemistry',
      'Chemistry (Akash Sir)',
      'Maths (Akash Sir)',
      'Physics (Navneet Sir)',
    ])
  })

  it('does not mutate the store mappings array while sorting', () => {
    const original = [...MAPPINGS]
    mockStore.timetableMappings = MAPPINGS
    mockStore.timetableTeachers = TEACHERS

    render(<EditCellModal timetableId="tt1" slotId="slot1" day="Monday" currentCell={null} onClose={vi.fn()} />)

    expect(MAPPINGS).toEqual(original)
    expect(MAPPINGS[0].id).toBe('m1') // Physics still first in the store order
  })
})
