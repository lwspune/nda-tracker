import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ModeContext } from '../../../context/ModeContext'

// What each audience can do on the Timetable page. A teacher with the
// "Edit timetable" permission gets the edits the save_timetable database
// function accepts — and none it refuses, so nothing she can click is silently
// thrown away. Sends, calendar sync and timetable create/rename/delete stay
// admin-only.

const TT = {
  id: 'tt1', branch: 'APJ', batchName: '11th A',
  timeSlots: [{ id: 's1', startTime: '9:00 AM', endTime: '10:00 AM' }],
  grid: { s1: { Monday: { type: 'class', mappingId: 'm1' } } },
}

const mockStore = {
  isSuperadmin: false,
  timetables: [TT],
  timetableTeachers: [{ id: 't1', name: 'Asha Bade Mam', email: 'asha@x.com' }],
  timetableMappings: [{ id: 'm1', label: 'Maths', subject: 'Maths', teacherId: 't1' }],
  examSchedules: [],
  updateTimetable: vi.fn(),
  moveTimetableWithinBranch: vi.fn(),
  cycleExamStatus: vi.fn(),
  setTimetableCell: vi.fn(),
  clearTimetableCell: vi.fn(),
  setTimetableSpanCell: vi.fn(),
  clearTimetableSpanCell: vi.fn(),
}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

import TimetablePage from '../TimetablePage'

function renderAs(mode, props = {}) {
  return render(
    <ModeContext.Provider value={mode}>
      <TimetablePage {...props} />
    </ModeContext.Provider>
  )
}

beforeEach(() => vi.clearAllMocks())

describe('TimetablePage — teacher with Edit timetable', () => {
  it('offers the edits the database accepts', () => {
    renderAs('teacher', { canEdit: true })
    expect(screen.getByRole('button', { name: 'Mappings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add time slot/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /move 11th a left/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add notes/i })).toBeInTheDocument()
  })

  it('opens the cell editor on a cell click', () => {
    renderAs('teacher', { canEdit: true })
    fireEvent.click(screen.getByText('Maths'))
    expect(screen.getByText('Edit Cell — Monday')).toBeInTheDocument()
  })

  // Retiming a slot rewrites every past absence's displayed time, and
  // deleting one orphans them; the database refuses both for a teacher.
  it('does not offer to edit or delete an existing time slot', () => {
    renderAs('teacher', { canEdit: true })
    expect(screen.queryByRole('button', { name: /edit 9:00 am/i })).not.toBeInTheDocument()
  })

  it('keeps create / rename / delete timetable admin-only', () => {
    renderAs('teacher', { canEdit: true })
    expect(screen.queryByRole('button', { name: '+ Timetable' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit 11th a timetable/i })).not.toBeInTheDocument()
  })

  it('keeps sends and calendar sync admin-only', () => {
    renderAs('teacher', { canEdit: true })
    fireEvent.click(screen.getByRole('button', { name: 'Teacher Schedule' }))
    expect(screen.queryByRole('button', { name: /sync calendars/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /send all schedules/i })).not.toBeInTheDocument()
  })

  it('can add and edit exam-schedule entries but not send reminders', () => {
    renderAs('teacher', { canEdit: true })
    fireEvent.click(screen.getByRole('button', { name: 'Exam Schedule' }))
    expect(screen.getByRole('button', { name: '+ Add Exam' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remind/i })).not.toBeInTheDocument()
  })
})

describe('TimetablePage — teacher without the permission', () => {
  it('is read-only, as before', () => {
    renderAs('teacher')
    expect(screen.queryByRole('button', { name: 'Mappings' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add time slot/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Maths'))
    expect(screen.queryByText('Edit Cell — Monday')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Exam Schedule' }))
    expect(screen.queryByRole('button', { name: '+ Add Exam' })).not.toBeInTheDocument()
  })
})

describe('TimetablePage — admin', () => {
  it('keeps every control, including slot editing and timetable management', () => {
    renderAs('admin')
    expect(screen.getByRole('button', { name: '+ Timetable' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /edit 9:00 am/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /edit 11th a timetable/i })).toBeInTheDocument()
  })
})
