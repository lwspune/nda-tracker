import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = {
  studentProfiles: {},
  timetables: [],
  timetableMappings: [],
  timetableTeachers: [],
  setLectureAbsenteesForPeriod: vi.fn(),
  getLectureAbsencesForDate: vi.fn(),
  submitLecture: vi.fn(),
  getSubmissionsForDate: vi.fn(),
  getActiveLeaves: vi.fn(),
  endLeave: vi.fn(),
}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

import SchoolAttendancePage from '../index'

// 2026-05-21 = Thursday
const THURSDAY = '2026-05-21'

const TEACHERS = [
  { id: 't1', name: 'Akash Rathod Sir', email: 'akash@lwspune.com' },
  { id: 't2', name: 'Vilas Shinde Sir', email: 'vilas@lwspune.com' },
]

const MAPPINGS = [
  { id: 'm-maths', label: 'Maths_12th_NDA', subject: 'Maths',   teacherId: 't1' },
  { id: 'm-phy',   label: 'Physics_12th',   subject: 'Physics', teacherId: 't2' },
]

const TIMETABLES = [{
  id: 'tt1',
  branch: 'LWS Pune',
  batchName: '12th_A',
  timeSlots: [
    { id: 's1', startTime: '9:00 AM',  endTime: '10:00 AM' },
    { id: 's2', startTime: '10:00 AM', endTime: '11:00 AM' },
  ],
  grid: {
    s1: { Thursday: { type: 'class', mappingId: 'm-maths' } },   // t1
    s2: { Thursday: { type: 'class', mappingId: 'm-phy'   } },   // t2
  },
}]

const PROFILES = {
  'Arjun Sharma': { name: 'Arjun Sharma', lwsId: 'LWS-001', batches: ['12th_A'] },
  'Ravi Kumar':   { name: 'Ravi Kumar',   lwsId: 'LWS-002', batches: ['12th_A'] },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStore.studentProfiles   = PROFILES
  mockStore.timetables        = TIMETABLES
  mockStore.timetableMappings = MAPPINGS
  mockStore.timetableTeachers = TEACHERS
  mockStore.getLectureAbsencesForDate.mockResolvedValue([])
  mockStore.getSubmissionsForDate.mockResolvedValue([])
  mockStore.getActiveLeaves.mockResolvedValue([])
  mockStore.setLectureAbsenteesForPeriod.mockResolvedValue(true)
  mockStore.submitLecture.mockResolvedValue(true)
})

describe('SchoolAttendancePage — scoping', () => {
  it("shows only the signed-in teacher's own periods", async () => {
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)

    expect(await screen.findByText('Maths')).toBeInTheDocument()
    expect(screen.queryByText('Physics')).not.toBeInTheDocument()
  })

  // Shared staffroom device: a still-live session belonging to someone else
  // would silently stamp the wrong name on created_by and the filing board.
  // Identity has to be visible at the moment of entry.
  it('names the signed-in teacher and offers a way out', async () => {
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)

    expect(await screen.findByText(/Akash Rathod Sir/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /not you/i })).toBeInTheDocument()
  })

  // Falls closed: an email with no teacher record must see nothing rather than
  // the whole school's timetable.
  it('shows an actionable empty state for an unrecognised email, and no lectures', async () => {
    render(<SchoolAttendancePage email="stranger@lwspune.com" initialDate={THURSDAY} />)

    expect(await screen.findByText(/not linked to a teacher record/i)).toBeInTheDocument()
    expect(screen.queryByText('Maths')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /mark attendance/i })).not.toBeInTheDocument()
  })
})

describe('SchoolAttendancePage — filed vs not filed', () => {
  it('marks a period filed only when a submission row exists', async () => {
    mockStore.getSubmissionsForDate.mockResolvedValue([
      { slot_id: 's1', batch_name: '12th_A', absent_count: 0, submitted_at: '2026-05-21T04:30:00Z' },
    ])
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)

    expect(await screen.findByText(/^filed$/i)).toBeInTheDocument()
    expect(screen.queryByText(/not filed/i)).not.toBeInTheDocument()
  })

  it('a period with no absentees and no filing still reads as NOT filed', async () => {
    mockStore.getLectureAbsencesForDate.mockResolvedValue([])
    mockStore.getSubmissionsForDate.mockResolvedValue([])
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)

    expect(await screen.findByText(/not filed/i)).toBeInTheDocument()
  })
})

describe('SchoolAttendancePage — filing a period', () => {
  async function openModal() {
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)
    const btn = await screen.findByRole('button', { name: /mark attendance for maths/i })
    fireEvent.click(btn)
    return screen.findByRole('button', { name: /^save \(/i })
  }

  it('writes the absentee set and records the filing', async () => {
    const save = await openModal()
    fireEvent.click(screen.getByLabelText('Arjun Sharma'))
    fireEvent.click(save)

    await waitFor(() => expect(mockStore.setLectureAbsenteesForPeriod).toHaveBeenCalled())
    const [date, slotId, subject, lwsIds] = mockStore.setLectureAbsenteesForPeriod.mock.calls[0]
    expect({ date, slotId, subject, lwsIds }).toEqual({
      date: THURSDAY, slotId: 's1', subject: 'Maths', lwsIds: ['LWS-001'],
    })

    await waitFor(() => expect(mockStore.submitLecture).toHaveBeenCalled())
    expect(mockStore.submitLecture.mock.calls[0][0]).toMatchObject({
      date: THURSDAY, slotId: 's1', batchName: '12th_A', teacherId: 't1',
      absentCount: 1, source: 'teacher',
    })
  })

  // The whole reason lecture_submissions exists — an all-present period must
  // still record that it was accounted for.
  it('records a filing when the teacher reports nobody absent', async () => {
    const save = await openModal()
    fireEvent.click(save)

    await waitFor(() => expect(mockStore.submitLecture).toHaveBeenCalled())
    expect(mockStore.submitLecture.mock.calls[0][0]).toMatchObject({ absentCount: 0 })
  })

  it('does not record a filing if the absentee write failed', async () => {
    mockStore.setLectureAbsenteesForPeriod.mockResolvedValue(false)
    const save = await openModal()
    fireEvent.click(save)

    await waitFor(() => expect(mockStore.setLectureAbsenteesForPeriod).toHaveBeenCalled())
    expect(mockStore.submitLecture).not.toHaveBeenCalled()
  })
})
