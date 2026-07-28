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
  setHomeworkDefaultersForItem: vi.fn(),
  getHomeworkForDate: vi.fn(),
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
  mockStore.getHomeworkForDate.mockResolvedValue([])
  mockStore.setHomeworkDefaultersForItem.mockResolvedValue(true)
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

// An extra / substitute class has no timetable slot, so nothing else in the
// system knows it happened — the admin filing board is timetable-derived and
// will never list it. The teacher is the only person who can record it.
describe('SchoolAttendancePage — extra (impromptu) classes', () => {
  async function addExtra({ subject = 'Doubt session', start = '', end = '' } = {}) {
    fireEvent.click(await screen.findByRole('button', { name: /add an extra class/i }))
    fireEvent.change(await screen.findByLabelText(/^subject$/i), { target: { value: subject } })
    if (start) fireEvent.change(screen.getByLabelText(/start time/i), { target: { value: start } })
    if (end)   fireEvent.change(screen.getByLabelText(/end time/i),   { target: { value: end } })
    fireEvent.click(screen.getByRole('button', { name: /^add class$/i }))
  }

  it('adds an extra-class card for a batch the teacher actually teaches', async () => {
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)
    await addExtra()
    expect(await screen.findByText('Doubt session')).toBeInTheDocument()
    expect(screen.getByText(/^extra$/i)).toBeInTheDocument()
  })

  it('offers only the teacher\'s own batches, never the whole school', async () => {
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)
    fireEvent.click(await screen.findByRole('button', { name: /add an extra class/i }))
    const options = [...(await screen.findByLabelText(/^batch$/i)).querySelectorAll('option')]
    expect(options.map(o => o.value)).toEqual(['12th_A'])
  })

  it('files it with an adhoc_ slot id, the chosen batch, and the entered times', async () => {
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)
    await addExtra({ subject: 'Extra revision', start: '3:00 PM', end: '4:00 PM' })

    const markButtons = await screen.findAllByRole('button', { name: /mark attendance/i })
    fireEvent.click(markButtons[markButtons.length - 1])   // the extra card renders last
    fireEvent.click(await screen.findByLabelText(/Arjun Sharma/))
    fireEvent.click(screen.getByRole('button', { name: /^save/i }))

    await waitFor(() => expect(mockStore.setLectureAbsenteesForPeriod).toHaveBeenCalledWith(
      THURSDAY, expect.stringMatching(/^adhoc_/), 'Extra revision', ['LWS-001'],
      { startTime: '3:00 PM', endTime: '4:00 PM' },
    ))
    await waitFor(() => expect(mockStore.submitLecture).toHaveBeenCalledWith(expect.objectContaining({
      slotId: expect.stringMatching(/^adhoc_/),
      batchName: '12th_A',
      subject: 'Extra revision',
      teacherId: 't1',
      source: 'teacher',
    })))
  })

  it('rebuilds a previously filed extra class from the teacher\'s own submissions', async () => {
    // lecture_submissions is the right source: it carries batch_name and exists
    // even when nobody was absent, which the absence log cannot express.
    mockStore.getSubmissionsForDate.mockResolvedValue([
      { slot_id: 'adhoc_x1', batch_name: '12th_A', subject: 'Sunday revision', teacher_id: 't1', absent_count: 0, source: 'teacher' },
    ])
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)
    expect(await screen.findByText('Sunday revision')).toBeInTheDocument()
  })

  it('does not rebuild another teacher\'s extra class', async () => {
    mockStore.getSubmissionsForDate.mockResolvedValue([
      { slot_id: 'adhoc_x9', batch_name: '12th_A', subject: 'Someone elses class', teacher_id: 't2', absent_count: 0, source: 'teacher' },
    ])
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)
    await screen.findByText('Maths')
    expect(screen.queryByText('Someone elses class')).not.toBeInTheDocument()
  })

  it('is available on a day with nothing timetabled', async () => {
    // A Sunday revision class is exactly the case nothing else can record.
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate="2026-05-24" />)
    expect(await screen.findByText(/nothing timetabled/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add an extra class/i })).toBeEnabled()
  })

  it('disables the action for a login with no batches of its own', async () => {
    mockStore.timetableMappings = [{ id: 'm-x', subject: 'Maths', teacherId: 'nobody' }]
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)
    expect(await screen.findByRole('button', { name: /add an extra class/i })).toBeDisabled()
  })
})

// The teacher who set the work is the only person who knows who didn't do it —
// the same argument that moved attendance filing off the office's desk.
describe('SchoolAttendancePage — homework filing', () => {
  async function fileHomework({ chapter = 'Trigonometry', notes = false } = {}) {
    fireEvent.click(await screen.findByRole('button', { name: /homework for Maths/i }))
    fireEvent.change(await screen.findByLabelText(/chapter or topic/i), { target: { value: chapter } })
    if (notes) fireEvent.click(screen.getByLabelText(/^notes$/i))
    fireEvent.click(screen.getByRole('button', { name: /who hasn't done it/i }))
  }

  it('files defaulters against the period\'s own subject, batch and date', async () => {
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)
    await fileHomework()

    fireEvent.click(await screen.findByLabelText(/Arjun Sharma/))
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(mockStore.setHomeworkDefaultersForItem).toHaveBeenCalledWith(
      THURSDAY, 'Maths', 'Trigonometry', 'homework', ['LWS-001'],
    ))
  })

  it('records notes-only and homework+notes distinctly', async () => {
    const { unmount } = render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)
    fireEvent.click(await screen.findByRole('button', { name: /homework for Maths/i }))
    fireEvent.change(await screen.findByLabelText(/chapter or topic/i), { target: { value: 'Vectors' } })
    fireEvent.click(screen.getByLabelText(/^homework$/i))   // untick homework
    fireEvent.click(screen.getByLabelText(/^notes$/i))      // tick notes
    fireEvent.click(screen.getByRole('button', { name: /who hasn't done it/i }))
    fireEvent.click(await screen.findByLabelText(/Ravi Kumar/))
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(mockStore.setHomeworkDefaultersForItem).toHaveBeenCalledWith(
      THURSDAY, 'Maths', 'Vectors', 'notes', ['LWS-002'],
    ))
    unmount()
  })

  it('cannot proceed without a chapter or a type', async () => {
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)
    fireEvent.click(await screen.findByRole('button', { name: /homework for Maths/i }))
    const next = screen.getByRole('button', { name: /who hasn't done it/i })
    expect(next).toBeDisabled()                                        // no chapter

    fireEvent.change(screen.getByLabelText(/chapter or topic/i), { target: { value: 'Trig' } })
    expect(next).toBeEnabled()

    fireEvent.click(screen.getByLabelText(/^homework$/i))              // untick the only type
    expect(next).toBeDisabled()
  })

  it('pre-ticks students already flagged for that exact item', async () => {
    mockStore.getHomeworkForDate.mockResolvedValue([
      { id: 'h1', lws_id: 'LWS-002', date: THURSDAY, subject: 'Maths', chapter: 'Trigonometry', type: 'homework' },
    ])
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)
    await fileHomework()
    expect(await screen.findByLabelText(/Ravi Kumar/)).toBeChecked()
    expect(screen.getByLabelText(/Arjun Sharma/)).not.toBeChecked()
  })

  it('shows a count of open items on the period card', async () => {
    mockStore.getHomeworkForDate.mockResolvedValue([
      { id: 'h1', lws_id: 'LWS-001', date: THURSDAY, subject: 'Maths', chapter: 'Trig', type: 'homework' },
      { id: 'h2', lws_id: 'LWS-002', date: THURSDAY, subject: 'Maths', chapter: 'Trig', type: 'homework' },
    ])
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /homework for Maths/i })).toHaveTextContent('2'))
  })
})
