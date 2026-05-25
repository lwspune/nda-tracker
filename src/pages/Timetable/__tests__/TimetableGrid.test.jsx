import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import TimetableGrid from '../TimetableGrid'

const SLOT = { id: 'slot1', startTime: '9:00 AM', endTime: '10:00 AM' }

const TEACHERS = [
  { id: 't1', name: 'Vilas Sir', email: '' },
  { id: 't2', name: 'Navneet Sir', email: '' },
]

const MAPPINGS = [
  { id: 'm1', label: 'Maths_12th_NDA', subject: 'Maths', teacherId: 't1' },
  { id: 'm2', label: 'Physics_12th', subject: 'Physics', teacherId: null },
  { id: 'm3', label: 'Eng/GS_NDA', subject: null, teacherId: 't2' },
  { id: 'm4', label: 'Chemistry_NDA', subject: null, teacherId: null },
]

function makeTimetable(cellsByDay) {
  return {
    id: 'tt1',
    branch: 'APJ',
    batchName: 'APJ_NDA_12th_(26-27)',
    timeSlots: [SLOT],
    grid: { slot1: cellsByDay },
  }
}

describe('TimetableGrid — teacher name below subject', () => {
  it('renders subject on line 1 and teacher name on line 2 when both are set', () => {
    const tt = makeTimetable({ Monday: { type: 'class', mappingId: 'm1' } })
    render(<TimetableGrid timetable={tt} mappings={MAPPINGS} teachers={TEACHERS} />)
    expect(screen.getByText('Maths')).toBeInTheDocument()
    expect(screen.getByText('Vilas Sir')).toBeInTheDocument()
  })

  it('renders only subject (no teacher line) when teacherId is missing', () => {
    const tt = makeTimetable({ Monday: { type: 'class', mappingId: 'm2' } })
    render(<TimetableGrid timetable={tt} mappings={MAPPINGS} teachers={TEACHERS} />)
    expect(screen.getByText('Physics')).toBeInTheDocument()
    expect(screen.queryByText('Vilas Sir')).not.toBeInTheDocument()
    expect(screen.queryByText('Navneet Sir')).not.toBeInTheDocument()
  })

  it('falls back to mapping.label when subject is null and shows teacher', () => {
    const tt = makeTimetable({ Monday: { type: 'class', mappingId: 'm3' } })
    render(<TimetableGrid timetable={tt} mappings={MAPPINGS} teachers={TEACHERS} />)
    expect(screen.getByText('Eng/GS_NDA')).toBeInTheDocument()
    expect(screen.getByText('Navneet Sir')).toBeInTheDocument()
  })

  it('renders only label when both subject and teacherId are null', () => {
    const tt = makeTimetable({ Monday: { type: 'class', mappingId: 'm4' } })
    render(<TimetableGrid timetable={tt} mappings={MAPPINGS} teachers={TEACHERS} />)
    expect(screen.getByText('Chemistry_NDA')).toBeInTheDocument()
    expect(screen.queryByText('Vilas Sir')).not.toBeInTheDocument()
    expect(screen.queryByText('Navneet Sir')).not.toBeInTheDocument()
  })

  it('handles missing teachers prop (renders subject only)', () => {
    const tt = makeTimetable({ Monday: { type: 'class', mappingId: 'm1' } })
    render(<TimetableGrid timetable={tt} mappings={MAPPINGS} />)
    expect(screen.getByText('Maths')).toBeInTheDocument()
    expect(screen.queryByText('Vilas Sir')).not.toBeInTheDocument()
  })

  it('renders break cells unchanged (no teacher line)', () => {
    const tt = makeTimetable({ Monday: { type: 'break', label: 'Recess' } })
    render(<TimetableGrid timetable={tt} mappings={MAPPINGS} teachers={TEACHERS} />)
    expect(screen.getByText('Recess')).toBeInTheDocument()
  })
})
