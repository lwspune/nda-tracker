import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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
  deleteLectureSubmission: vi.fn(),
  getActiveLeaves: vi.fn(),
  endLeave: vi.fn(),
  setHomeworkDefaultersForItem: vi.fn(),
  getHomeworkForDate: vi.fn(),
  exams: [],
  addExam: vi.fn(),
  replaceExam: vi.fn(),
  deleteExam: vi.fn(),
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
  mockStore.exams = []
  mockStore.deleteLectureSubmission.mockResolvedValue(true)
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

  // An extra class belongs to the day it was held on. Unsaved cards used to be
  // plain component state with no date on them, so one added on Thursday
  // followed the teacher to every other date they opened — badged NOT FILED,
  // inflating the filed counter, and one tap away from filing a class that
  // never happened.
  it('does not follow the teacher to another date', async () => {
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)
    await addExtra({ subject: 'Doubt session' })
    expect(await screen.findByText('Doubt session')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-05-22' } })  // Friday
    await waitFor(() => expect(screen.queryByText('Doubt session')).not.toBeInTheDocument())
  })

  // …but it is still there when they come back, so tapping the date field to
  // check tomorrow doesn't bin a card they'd half-filled in.
  it('is still there on its own date after looking at another one', async () => {
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)
    await addExtra({ subject: 'Doubt session' })
    await screen.findByText('Doubt session')

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-05-22' } })
    await waitFor(() => expect(screen.queryByText('Doubt session')).not.toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: THURSDAY } })
    expect(await screen.findByText('Doubt session')).toBeInTheDocument()
  })

  // The counter is what the teacher trusts to know they're done for the day.
  // A carried-over card sits in its denominator as permanently outstanding.
  it('leaves it out of the filed counter on another date', async () => {
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)
    await addExtra({ subject: 'Doubt session' })
    expect(await screen.findByText('0/2')).toBeInTheDocument()      // Maths + the extra

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-05-22' } })
    expect(await screen.findByText(/nothing timetabled/i)).toBeInTheDocument()
    expect(screen.queryByText('0/1')).not.toBeInTheDocument()
  })
})

// Added by mistake, wrong batch, class ended up not happening — nothing else
// in the system knows an extra class exists, so the teacher who created it is
// the only person who can take it back.
describe('SchoolAttendancePage — deleting an extra class', () => {
  async function addExtra({ subject = 'Doubt session' } = {}) {
    fireEvent.click(await screen.findByRole('button', { name: /add an extra class/i }))
    fireEvent.change(await screen.findByLabelText(/^subject$/i), { target: { value: subject } })
    fireEvent.click(screen.getByRole('button', { name: /^add class$/i }))
  }

  const FILED_EXTRA = [
    { slot_id: 'adhoc_x1', batch_name: '12th_A', subject: 'Sunday revision', teacher_id: 't1', absent_count: 1, source: 'teacher' },
  ]

  // The timetable is not the teacher's to edit from here.
  it('is offered on extra classes only, never on timetabled periods', async () => {
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)
    await screen.findByText('Maths')
    expect(screen.queryByRole('button', { name: /remove extra class/i })).not.toBeInTheDocument()

    await addExtra()
    expect(await screen.findByRole('button', { name: /remove extra class/i })).toBeInTheDocument()
  })

  it('drops an unfiled card without a prompt or a write', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)
    await addExtra()

    fireEvent.click(await screen.findByRole('button', { name: /remove extra class/i }))

    await waitFor(() => expect(screen.queryByText('Doubt session')).not.toBeInTheDocument())
    expect(confirmSpy).not.toHaveBeenCalled()                        // nothing was written to undo
    expect(mockStore.setLectureAbsenteesForPeriod).not.toHaveBeenCalled()
    expect(mockStore.deleteLectureSubmission).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  // Both writes, in that order. A filing outliving its absentees would claim
  // the period is accounted for when the data behind it is gone; absentees
  // outliving their filing would leave students marked absent from a class
  // the system no longer knows about.
  it('clears the absentees and then the filing row', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockStore.getSubmissionsForDate.mockResolvedValue(FILED_EXTRA)
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)

    fireEvent.click(await screen.findByRole('button', { name: /remove extra class/i }))

    await waitFor(() => expect(mockStore.setLectureAbsenteesForPeriod)
      .toHaveBeenCalledWith(THURSDAY, 'adhoc_x1', 'Sunday revision', []))
    await waitFor(() => expect(mockStore.deleteLectureSubmission)
      .toHaveBeenCalledWith(THURSDAY, 'adhoc_x1', '12th_A'))
    vi.mocked(window.confirm).mockRestore()
  })

  it('asks first, and does nothing if the teacher backs out', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    mockStore.getSubmissionsForDate.mockResolvedValue(FILED_EXTRA)
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)

    fireEvent.click(await screen.findByRole('button', { name: /remove extra class/i }))

    expect(window.confirm).toHaveBeenCalled()
    expect(mockStore.setLectureAbsenteesForPeriod).not.toHaveBeenCalled()
    expect(mockStore.deleteLectureSubmission).not.toHaveBeenCalled()
    expect(screen.getByText('Sunday revision')).toBeInTheDocument()
    vi.mocked(window.confirm).mockRestore()
  })

  it('keeps the filing row if clearing the absentees failed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockStore.setLectureAbsenteesForPeriod.mockResolvedValue(false)
    mockStore.getSubmissionsForDate.mockResolvedValue(FILED_EXTRA)
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)

    fireEvent.click(await screen.findByRole('button', { name: /remove extra class/i }))

    await waitFor(() => expect(mockStore.setLectureAbsenteesForPeriod).toHaveBeenCalled())
    expect(mockStore.deleteLectureSubmission).not.toHaveBeenCalled()
    vi.mocked(window.confirm).mockRestore()
  })
})

// The teacher who set the work is the only person who knows who didn't do it —
// the same argument that moved attendance filing off the office's desk.
describe('SchoolAttendancePage — homework filing', () => {
  async function fileHomework({ chapter = 'Trigonometry', notes = false } = {}) {
    fireEvent.click(await screen.findByRole('button', { name: /file homework/i }))
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
    fireEvent.click(await screen.findByRole('button', { name: /file homework/i }))
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
    fireEvent.click(await screen.findByRole('button', { name: /file homework/i }))
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
    await waitFor(() => expect(screen.getByRole('button', { name: /file homework/i })).toHaveTextContent('2'))
  })
})

// Homework is keyed (date, subject, chapter, type) — no slot. Offering it per
// period card claimed a granularity the data doesn't have and duplicated the
// button for the many teachers with back-to-back periods.
describe('SchoolAttendancePage — homework is per class, not per period', () => {
  // Two Maths periods for one batch on the same Thursday.
  const TWO_PERIOD_TT = [{
    ...TIMETABLES[0],
    grid: {
      s1: { Thursday: { type: 'class', mappingId: 'm-maths' } },
      s2: { Thursday: { type: 'class', mappingId: 'm-maths' } },
    },
  }]

  it('shows exactly one Homework control however many periods the class took', async () => {
    mockStore.timetables = TWO_PERIOD_TT
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)

    // Two period cards …
    expect(await screen.findAllByRole('button', { name: /mark attendance for maths/i })).toHaveLength(2)
    // … but a single homework entry point.
    expect(screen.getAllByRole('button', { name: /file homework/i })).toHaveLength(1)
  })

  it('skips the class picker when there is only one class today', async () => {
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)
    fireEvent.click(await screen.findByRole('button', { name: /file homework/i }))

    expect(screen.queryByLabelText(/^class$/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/chapter or topic/i)).toBeInTheDocument()
  })

  it('offers a class picker when the teacher taught several, one entry per subject+batch', async () => {
    mockStore.timetables = [
      TWO_PERIOD_TT[0],                                        // 12th_A, Maths ×2
      { ...TIMETABLES[0], id: 'tt2', batchName: '11th_B',
        grid: { s1: { Thursday: { type: 'class', mappingId: 'm-maths' } } } },
    ]
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)
    fireEvent.click(await screen.findByRole('button', { name: /file homework/i }))

    const options = [...(await screen.findByLabelText(/^class$/i)).querySelectorAll('option')]
    expect(options).toHaveLength(2)                            // not 3, despite 3 periods
    expect(options.map(o => o.value)).toEqual(['Maths|11th_B', 'Maths|12th_A'])
  })

  it('files against the picked class', async () => {
    mockStore.timetables = [
      TWO_PERIOD_TT[0],
      { ...TIMETABLES[0], id: 'tt2', batchName: '11th_B',
        grid: { s1: { Thursday: { type: 'class', mappingId: 'm-maths' } } } },
    ]
    mockStore.studentProfiles = {
      ...PROFILES,
      'Neha Iyer': { name: 'Neha Iyer', lwsId: 'LWS-003', batches: ['11th_B'] },
    }
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)
    fireEvent.click(await screen.findByRole('button', { name: /file homework/i }))

    fireEvent.change(await screen.findByLabelText(/^class$/i), { target: { value: 'Maths|11th_B' } })
    fireEvent.change(screen.getByLabelText(/chapter or topic/i), { target: { value: 'Circles' } })
    fireEvent.click(screen.getByRole('button', { name: /who hasn't done it/i }))

    // Roster follows the picked batch, not the first one.
    fireEvent.click(await screen.findByLabelText(/Neha Iyer/))
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(mockStore.setHomeworkDefaultersForItem).toHaveBeenCalledWith(
      THURSDAY, 'Maths', 'Circles', 'homework', ['LWS-003'],
    ))
  })

  it('disables the control on a day with no classes', async () => {
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate="2026-05-24" />)  // Sunday
    expect(await screen.findByRole('button', { name: /file homework/i })).toBeDisabled()
  })
})

// A pen-and-paper class test the teacher conducts and marks themselves. Stored
// as a normal offline exam but stamped source:'teacher' so parent-facing
// reports can label it "Written Quiz" rather than let it read like a mock.
describe('SchoolAttendancePage — Written Quiz', () => {
  async function openQuiz() {
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)
    fireEvent.click(await screen.findByRole('button', { name: /add a written quiz/i }))
    return screen.findByLabelText(/quiz name/i)
  }

  it('scopes the quiz to a class the teacher actually teaches', async () => {
    await openQuiz()
    // t1 teaches only Maths/12th_A, so it opens straight into that quiz.
    expect(screen.getByText(/Written Quiz — Maths · 12th_A/)).toBeInTheDocument()
  })

  it('keeps Save disabled until every student is marked or ticked absent', async () => {
    // Blank means "not entered yet" here, NOT "did not appear" — a half-marked
    // stack of papers must not save as a room full of no-shows.
    await openQuiz()
    fireEvent.change(screen.getByLabelText(/quiz name/i), { target: { value: 'Trig test' } })
    fireEvent.change(screen.getByLabelText(/max marks/i), { target: { value: '20' } })

    const save = screen.getByRole('button', { name: /save written quiz/i })
    expect(save).toBeDisabled()
    expect(screen.getByText(/2 not entered/i)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/marks for Arjun Sharma/i), { target: { value: '18' } })
    expect(save).toBeDisabled()                                    // Ravi still blank

    fireEvent.click(screen.getByRole('button', { name: /Ravi Kumar absent/i }))
    expect(save).toBeEnabled()
  })

  it('saves an offline exam stamped teacher-created, omitting the absentee', async () => {
    await openQuiz()
    fireEvent.change(screen.getByLabelText(/quiz name/i), { target: { value: 'Trig test' } })
    fireEvent.change(screen.getByLabelText(/max marks/i), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText(/marks for Arjun Sharma/i), { target: { value: '18' } })
    fireEvent.click(screen.getByRole('button', { name: /Ravi Kumar absent/i }))
    fireEvent.click(screen.getByRole('button', { name: /save written quiz/i }))

    await waitFor(() => expect(mockStore.addExam).toHaveBeenCalled())
    const [exam, opts] = mockStore.addExam.mock.calls[0]
    expect(exam).toMatchObject({
      name: 'Trig test', date: THURSDAY, subject: 'Maths', batch: '12th_A',
      maxMarks: 20, source: 'teacher', createdBy: 'akash@lwspune.com', questions: [],
    })
    expect(exam.students).toEqual([expect.objectContaining({ name: 'Arjun Sharma', totalMarks: 18 })])
    // Load-bearing: absence sync is passed explicitly false, never defaulted —
    // it is the one thing on this page that could reach a parent.
    expect(opts).toEqual({ syncAbsences: false })
  })

  it('warns when a quiz already exists for that class on that date', async () => {
    mockStore.exams = [
      { id: 'e1', date: THURSDAY, subject: 'Maths', batch: '12th_A', name: 'Earlier test', source: 'admin' },
    ]
    await openQuiz()
    expect(screen.getByText(/already exists on this date/i)).toBeInTheDocument()
    expect(screen.getByText('Earlier test')).toBeInTheDocument()
  })

  it('blocks marks above the paper ceiling', async () => {
    await openQuiz()
    fireEvent.change(screen.getByLabelText(/quiz name/i), { target: { value: 'Trig test' } })
    fireEvent.change(screen.getByLabelText(/max marks/i), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText(/marks for Arjun Sharma/i), { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: /Ravi Kumar absent/i }))

    expect(screen.getByText(/above 20/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save written quiz/i })).toBeDisabled()
  })

  it('lists the teacher\'s own quizzes for the day and lets them edit one', async () => {
    mockStore.exams = [{
      id: 'q1', date: THURSDAY, subject: 'Maths', batch: '12th_A', name: 'My quiz',
      source: 'teacher', createdBy: 'akash@lwspune.com', maxMarks: 20, questions: [],
      students: [{ name: 'Arjun Sharma', totalMarks: 12 }],
    }]
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)

    const strip = within(await screen.findByTestId('my-written-quizzes'))
    expect(strip.getByText('My quiz')).toBeInTheDocument()
    fireEvent.click(strip.getByRole('button', { name: /edit my quiz/i }))
    // Pre-filled from the stored exam.
    expect(await screen.findByLabelText(/quiz name/i)).toHaveValue('My quiz')
    expect(screen.getByLabelText(/marks for Arjun Sharma/i)).toHaveValue(12)
  })

  it('does not show another teacher\'s quiz', async () => {
    mockStore.exams = [{
      id: 'q2', date: THURSDAY, subject: 'Maths', batch: '12th_A', name: 'Not mine',
      source: 'teacher', createdBy: 'someone.else@lwspune.com', maxMarks: 20, questions: [], students: [],
    }]
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)
    await screen.findByText('Maths')
    expect(screen.queryByTestId('my-written-quizzes')).not.toBeInTheDocument()
  })

  it('is disabled for a login with no classes of its own', async () => {
    mockStore.timetableMappings = [{ id: 'm-x', subject: 'Maths', teacherId: 'nobody' }]
    render(<SchoolAttendancePage email="akash@lwspune.com" initialDate={THURSDAY} />)
    expect(await screen.findByRole('button', { name: /add a written quiz/i })).toBeDisabled()
  })
})
