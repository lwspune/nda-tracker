import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

const mockStore = {
  timetableTeachers: [],
  timetableMappings: [],
  addTimetableMapping: vi.fn(),
  updateTimetableMapping: vi.fn(),
  deleteTimetableMapping: vi.fn(),
}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

import ManageMappingsModal from '../ManageMappingsModal'

// Deliberately out of alphabetical order in the store
const TEACHERS = [
  { id: 't1', name: 'Mayur Sir', email: '' },
  { id: 't2', name: 'Akash Sir', email: '' },
  { id: 't3', name: 'vishal sir', email: '' }, // lower-case → case-insensitive sort
  { id: 't4', name: 'Deepak Sir', email: '' },
]

function teacherOptionTexts() {
  return Array.from(document.querySelectorAll('select option'))
    .map(o => o.textContent)
    .filter(t => t !== '— None —')
}

describe('ManageMappingsModal — teacher dropdown ordering', () => {
  it('renders teacher options alphabetically by name (case-insensitive)', () => {
    mockStore.timetableTeachers = TEACHERS
    mockStore.timetableMappings = []

    render(<ManageMappingsModal onClose={vi.fn()} />)

    expect(teacherOptionTexts()).toEqual([
      'Akash Sir',
      'Deepak Sir',
      'Mayur Sir',
      'vishal sir',
    ])
  })

  it('does not mutate the store teachers array while sorting', () => {
    const original = [...TEACHERS]
    mockStore.timetableTeachers = TEACHERS
    mockStore.timetableMappings = []

    render(<ManageMappingsModal onClose={vi.fn()} />)

    expect(TEACHERS).toEqual(original)
    expect(TEACHERS[0].id).toBe('t1') // Mayur Sir still first in store order
  })
})
