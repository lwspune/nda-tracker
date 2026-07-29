import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = {
  studentProfiles: {},
  timetables: [],
  timetableMappings: [],
  setLectureAbsenteesForPeriod: vi.fn(),
  getLectureAbsencesForDate: vi.fn(),
  // FilingBoard (rendered at the top of the tab) reads these; omitting them
  // throws at effect time and takes the whole suite down.
  timetableTeachers: [],
  submitLecture: vi.fn(),
  getSubmissionsForDate: vi.fn(),
  deleteLectureSubmission: vi.fn(),
  getActiveLeaves: vi.fn(),
  endLeave: vi.fn(),
  lectureMissSendHistory: {},
}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

vi.mock('../../../context/ModeContext', () => ({
  useMode: () => 'admin',
}))

import LectureLogTab from '../LectureLogTab'

// ── fixtures ─────────────────────────────────────────────────

// 2026-05-21 = Thursday
const THURSDAY = '2026-05-21'

const TIMETABLE = {
  id: 'tt1',
  branch: 'LWS Pune',
  batchName: 'LWS_NDA_2Y_(25-27)_A',
  timeSlots: [
    { id: 's1', startTime: '9:00 AM',  endTime: '10:00 AM' },
    { id: 's2', startTime: '10:00 AM', endTime: '11:00 AM' },
  ],
  grid: {
    s1: { Thursday: { type: 'class', mappingId: 'm-maths' } },
    s2: { Thursday: { type: 'class', mappingId: 'm-phy'   } },
  },
}

const MAPPINGS = [
  { id: 'm-maths', label: 'Maths · Mr A', subject: 'Maths', teacherId: 't1' },
  { id: 'm-phy',   label: 'Physics · Mr B', subject: 'Physics', teacherId: 't2' },
]

const PROFILES = {
  'Arjun Sharma': { name: 'Arjun Sharma', lwsId: 'LWS-001', batches: ['LWS_NDA_2Y_(25-27)_A'] },
  'Ravi Kumar':   { name: 'Ravi Kumar',   lwsId: 'LWS-002', batches: ['LWS_NDA_2Y_(25-27)_A'] },
  'Karan Mehta':  { name: 'Karan Mehta',  lwsId: 'LWS-003', batches: ['LWS_NDA_2Y_(25-27)_B'] }, // different batch
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStore.studentProfiles = PROFILES
  mockStore.timetables = [TIMETABLE]
  mockStore.timetableMappings = MAPPINGS
  mockStore.lectureMissSendHistory = {}
  mockStore.getLectureAbsencesForDate.mockResolvedValue([])
  mockStore.getSubmissionsForDate.mockResolvedValue([])
  mockStore.submitLecture.mockResolvedValue(true)
  mockStore.deleteLectureSubmission.mockResolvedValue(true)
  mockStore.setLectureAbsenteesForPeriod.mockResolvedValue(true)
  mockStore.getActiveLeaves.mockResolvedValue([])   // no leaves by default (non-hostel)
  mockStore.endLeave.mockResolvedValue(true)
})

// ── tests ────────────────────────────────────────────────────

describe('LectureLogTab — pickers', () => {
  it('renders date input and batch dropdown', () => {
    render(<LectureLogTab initialDate={THURSDAY} onSend={vi.fn()} />)
    expect(screen.getByLabelText(/date/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/batch/i)).toBeInTheDocument()
  })

  it('lists batches sourced from timetables in the dropdown', () => {
    render(<LectureLogTab initialDate={THURSDAY} onSend={vi.fn()} />)
    const dropdown = screen.getByLabelText(/batch/i)
    expect(dropdown).toHaveTextContent('LWS_NDA_2Y_(25-27)_A')
  })
})

describe('LectureLogTab — period cards', () => {
  it('renders a card per lecture for the selected (date, batch)', async () => {
    render(<LectureLogTab initialDate={THURSDAY} initialBatch="LWS_NDA_2Y_(25-27)_A" onSend={vi.fn()} />)
    await waitFor(() => expect(mockStore.getLectureAbsencesForDate).toHaveBeenCalledWith(THURSDAY))
    expect(screen.getByText('Maths')).toBeInTheDocument()
    expect(screen.getByText('Physics')).toBeInTheDocument()
    expect(screen.getByText('9:00 AM – 10:00 AM')).toBeInTheDocument()
    expect(screen.getByText('10:00 AM – 11:00 AM')).toBeInTheDocument()
  })

  it('shows the count of absentees per period (filtered to batch students)', async () => {
    mockStore.getLectureAbsencesForDate.mockResolvedValue([
      { lws_id: 'LWS-001', date: THURSDAY, slot_id: 's1', subject: 'Maths'   },
      { lws_id: 'LWS-002', date: THURSDAY, slot_id: 's1', subject: 'Maths'   },
      { lws_id: 'LWS-003', date: THURSDAY, slot_id: 's1', subject: 'Maths'   }, // out-of-batch, ignored
    ])
    render(<LectureLogTab initialDate={THURSDAY} initialBatch="LWS_NDA_2Y_(25-27)_A" onSend={vi.fn()} />)
    await waitFor(() => expect(mockStore.getLectureAbsencesForDate).toHaveBeenCalled())
    // 2 of the 3 absences are in this batch
    expect(await screen.findByText(/2 absent/i)).toBeInTheDocument()
    // Physics has none
    expect(screen.getByText(/^0 absent/i)).toBeInTheDocument()
  })

  it('two same-subject periods on the same day stay independent', async () => {
    // Regression test for the slot_id schema fix. Mock a timetable that has
    // Maths twice (two slots, same subject, same day) and verify each card
    // reports its own count, NOT the combined sum.
    const TWO_MATHS_TIMETABLE = {
      ...TIMETABLE,
      timeSlots: [
        { id: 's1', startTime: '9:00 AM',  endTime: '10:00 AM' },
        { id: 's2', startTime: '2:00 PM',  endTime: '3:00 PM'  },
      ],
      grid: {
        s1: { Thursday: { type: 'class', mappingId: 'm-maths' } },
        s2: { Thursday: { type: 'class', mappingId: 'm-maths' } },
      },
    }
    mockStore.timetables = [TWO_MATHS_TIMETABLE]
    mockStore.getLectureAbsencesForDate.mockResolvedValue([
      // Only the morning Maths (s1) has absences
      { lws_id: 'LWS-001', date: THURSDAY, slot_id: 's1', subject: 'Maths' },
      { lws_id: 'LWS-002', date: THURSDAY, slot_id: 's1', subject: 'Maths' },
    ])
    render(<LectureLogTab initialDate={THURSDAY} initialBatch="LWS_NDA_2Y_(25-27)_A" onSend={vi.fn()} />)
    await waitFor(() => expect(mockStore.getLectureAbsencesForDate).toHaveBeenCalled())
    // First Maths card → 2 absent; second Maths card → 0 absent
    expect(await screen.findByText(/2 absent/i)).toBeInTheDocument()
    expect(screen.getByText(/^0 absent/i)).toBeInTheDocument()
  })

  it('shows an empty-state when the batch has no timetable', () => {
    render(<LectureLogTab initialDate={THURSDAY} initialBatch="UNKNOWN_BATCH" onSend={vi.fn()} />)
    expect(screen.getByText(/no timetable/i)).toBeInTheDocument()
  })

  it('shows an empty-state when no batch is selected', () => {
    render(<LectureLogTab initialDate={THURSDAY} onSend={vi.fn()} />)
    expect(screen.getByText(/select a batch/i)).toBeInTheDocument()
  })

  it('shows an empty-state when there are no lectures today (e.g. Sunday)', async () => {
    render(<LectureLogTab initialDate={'2026-05-24'} initialBatch="LWS_NDA_2Y_(25-27)_A" onSend={vi.fn()} />)
    expect(await screen.findByText(/no lectures scheduled/i)).toBeInTheDocument()
  })
})

describe('LectureLogTab — marking flow', () => {
  it('clicking "Mark absentees" opens the modal for that subject', async () => {
    render(<LectureLogTab initialDate={THURSDAY} initialBatch="LWS_NDA_2Y_(25-27)_A" onSend={vi.fn()} />)
    await waitFor(() => expect(mockStore.getLectureAbsencesForDate).toHaveBeenCalled())

    const markBtns = screen.getAllByRole('button', { name: /mark absentees/i })
    fireEvent.click(markBtns[0]) // Maths
    expect(await screen.findByText(/Mark attendance — Maths/)).toBeInTheDocument()
  })

  it('saving the modal calls setLectureAbsenteesForPeriod with the right args', async () => {
    render(<LectureLogTab initialDate={THURSDAY} initialBatch="LWS_NDA_2Y_(25-27)_A" onSend={vi.fn()} />)
    await waitFor(() => expect(mockStore.getLectureAbsencesForDate).toHaveBeenCalled())

    fireEvent.click(screen.getAllByRole('button', { name: /mark absentees/i })[0]) // Maths card
    // Modal shows; check Arjun and Ravi
    fireEvent.click(await screen.findByLabelText(/Arjun Sharma/))
    fireEvent.click(screen.getByLabelText(/Ravi Kumar/))
    fireEvent.click(screen.getByRole('button', { name: /^save/i }))

    await waitFor(() =>
      expect(mockStore.setLectureAbsenteesForPeriod).toHaveBeenCalledWith(
        THURSDAY, 's1', 'Maths', ['LWS-001', 'LWS-002']
      )
    )
  })

  it('updates the card count after save', async () => {
    render(<LectureLogTab initialDate={THURSDAY} initialBatch="LWS_NDA_2Y_(25-27)_A" onSend={vi.fn()} />)
    await waitFor(() => expect(mockStore.getLectureAbsencesForDate).toHaveBeenCalled())
    // Initially 0
    const beforeBadges = screen.getAllByText(/^0 absent/i)
    expect(beforeBadges.length).toBeGreaterThanOrEqual(1)

    // Save 1 absentee for Maths
    fireEvent.click(screen.getAllByRole('button', { name: /mark absentees/i })[0])
    fireEvent.click(await screen.findByLabelText(/Arjun Sharma/))
    fireEvent.click(screen.getByRole('button', { name: /^save/i }))

    await screen.findByText(/1 absent/i)
  })
})

describe('LectureLogTab — send button', () => {
  it('disabled when there are no absences logged for this date+batch', async () => {
    render(<LectureLogTab initialDate={THURSDAY} initialBatch="LWS_NDA_2Y_(25-27)_A" onSend={vi.fn()} />)
    await waitFor(() => expect(mockStore.getLectureAbsencesForDate).toHaveBeenCalled())
    const sendBtn = screen.getByRole('button', { name: /send lecture-miss notifications/i })
    expect(sendBtn).toBeDisabled()
  })

  it('enabled and calls onSend(absencesByLwsId, date, batchName) when clicked', async () => {
    mockStore.getLectureAbsencesForDate.mockResolvedValue([
      { lws_id: 'LWS-001', date: THURSDAY, slot_id: 's1', subject: 'Maths'   },
      { lws_id: 'LWS-001', date: THURSDAY, slot_id: 's2', subject: 'Physics' },
      { lws_id: 'LWS-002', date: THURSDAY, slot_id: 's1', subject: 'Maths'   },
    ])
    const onSend = vi.fn()
    render(<LectureLogTab initialDate={THURSDAY} initialBatch="LWS_NDA_2Y_(25-27)_A" onSend={onSend} />)
    await waitFor(() => expect(mockStore.getLectureAbsencesForDate).toHaveBeenCalled())
    await screen.findByText(/2 absent/i) // Maths shows 2

    const sendBtn = screen.getByRole('button', { name: /send lecture-miss notifications/i })
    expect(sendBtn).not.toBeDisabled()
    fireEvent.click(sendBtn)
    // onSend receives (absencesByLwsId, date, batchName). batchName threads
    // through so AttendancePage can key lectureMissSendHistory by
    // `${date}|${batchName}` (compound key keeps two batches independent
    // on the same day).
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({
        'LWS-001': expect.arrayContaining([
          expect.objectContaining({ subject: 'Maths',   startTime: '9:00 AM',  endTime: '10:00 AM' }),
          expect.objectContaining({ subject: 'Physics', startTime: '10:00 AM', endTime: '11:00 AM' }),
        ]),
        'LWS-002': [
          expect.objectContaining({ subject: 'Maths', startTime: '9:00 AM', endTime: '10:00 AM' }),
        ],
      }),
      THURSDAY,
      'LWS_NDA_2Y_(25-27)_A',
    )
  })
})

describe('LectureLogTab — impromptu (ad-hoc) lectures', () => {
  async function ready(date = THURSDAY) {
    render(<LectureLogTab initialDate={date} initialBatch="LWS_NDA_2Y_(25-27)_A" onSend={vi.fn()} />)
    await waitFor(() => expect(mockStore.getLectureAbsencesForDate).toHaveBeenCalled())
  }

  it('shows an "Add impromptu lecture" button when a batch is selected', async () => {
    await ready()
    expect(screen.getByRole('button', { name: /add impromptu lecture/i })).toBeInTheDocument()
  })

  it('adds an impromptu lecture card with the entered subject', async () => {
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /add impromptu lecture/i }))
    fireEvent.change(screen.getByLabelText(/impromptu.*subject/i), { target: { value: 'Extra Maths Doubt' } })
    fireEvent.click(screen.getByRole('button', { name: /^add lecture$/i }))
    expect(await screen.findByText('Extra Maths Doubt')).toBeInTheDocument()
  })

  it('marking an impromptu lecture saves with an adhoc_ slot_id + the entered times', async () => {
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /add impromptu lecture/i }))
    fireEvent.change(screen.getByLabelText(/impromptu.*subject/i), { target: { value: 'Extra Maths Doubt' } })
    fireEvent.change(screen.getByLabelText(/start time/i), { target: { value: '3:00 PM' } })
    fireEvent.change(screen.getByLabelText(/end time/i), { target: { value: '4:00 PM' } })
    fireEvent.click(screen.getByRole('button', { name: /^add lecture$/i }))
    await screen.findByText('Extra Maths Doubt')

    const markBtns = screen.getAllByRole('button', { name: /mark absentees/i })
    fireEvent.click(markBtns[markBtns.length - 1]) // the ad-hoc card (rendered last)
    fireEvent.click(await screen.findByLabelText(/Arjun Sharma/))
    fireEvent.click(screen.getByRole('button', { name: /^save/i }))

    await waitFor(() => expect(mockStore.setLectureAbsenteesForPeriod).toHaveBeenCalledWith(
      THURSDAY, expect.stringMatching(/^adhoc_/), 'Extra Maths Doubt', ['LWS-001'],
      { startTime: '3:00 PM', endTime: '4:00 PM' },
    ))
  })

  it('reconstructs an impromptu card from a persisted adhoc_ row (subject + time)', async () => {
    mockStore.getLectureAbsencesForDate.mockResolvedValue([
      { lws_id: 'LWS-001', date: THURSDAY, slot_id: 'adhoc_abc', subject: 'Doubt Session', start_time: '3:00 PM', end_time: '4:00 PM' },
    ])
    await ready()
    // The subject now appears twice — once on the reconstructed card, once as a
    // chip in the "Absent today" roster — so assert on the card's own markers.
    expect(await screen.findAllByText('Doubt Session')).not.toHaveLength(0)
    expect(screen.getByText('3:00 PM – 4:00 PM')).toBeInTheDocument()
    expect(await screen.findByText(/1 absent/i)).toBeInTheDocument()
  })

  it('allows adding an impromptu lecture on a day with no timetabled lectures (Sunday)', async () => {
    await ready('2026-05-24') // Sunday
    expect(screen.getByText(/no lectures scheduled/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /add impromptu lecture/i }))
    fireEvent.change(screen.getByLabelText(/impromptu.*subject/i), { target: { value: 'Sunday Special' } })
    fireEvent.click(screen.getByRole('button', { name: /^add lecture$/i }))
    expect(await screen.findByText('Sunday Special')).toBeInTheDocument()
  })

  it('includes impromptu-lecture absences in the onSend payload', async () => {
    mockStore.getLectureAbsencesForDate.mockResolvedValue([
      { lws_id: 'LWS-001', date: THURSDAY, slot_id: 'adhoc_abc', subject: 'Doubt', start_time: '3:00 PM', end_time: '4:00 PM' },
    ])
    const onSend = vi.fn()
    render(<LectureLogTab initialDate={THURSDAY} initialBatch="LWS_NDA_2Y_(25-27)_A" onSend={onSend} />)
    await screen.findAllByText('Doubt') // card + absent-roster chip
    fireEvent.click(screen.getByRole('button', { name: /send lecture-miss notifications/i }))
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({
        'LWS-001': expect.arrayContaining([
          expect.objectContaining({ subject: 'Doubt', startTime: '3:00 PM', endTime: '4:00 PM' }),
        ]),
      }),
      THURSDAY,
      'LWS_NDA_2Y_(25-27)_A',
    )
  })

  it('removing an impromptu card clears its absentees', async () => {
    mockStore.getLectureAbsencesForDate.mockResolvedValue([
      { lws_id: 'LWS-001', date: THURSDAY, slot_id: 'adhoc_abc', subject: 'Doubt', start_time: null, end_time: null },
    ])
    await ready()
    await screen.findAllByText('Doubt') // card + absent-roster chip
    fireEvent.click(screen.getByRole('button', { name: /remove .*doubt/i }))
    await waitFor(() => expect(mockStore.setLectureAbsenteesForPeriod).toHaveBeenCalledWith(THURSDAY, 'adhoc_abc', 'Doubt', []))
    // The card is gone. (The roster chip is asserted separately — here the
    // mocked fetch keeps replaying the deleted row, so it can't disappear.)
    await waitFor(() => expect(screen.queryByRole('button', { name: /remove .*doubt/i })).not.toBeInTheDocument())
  })

  // …and its FILING row. This tab rebuilds ad-hoc cards from the absence log,
  // so clearing absentees alone makes the card vanish here — but the teacher's
  // /school-attendance page rebuilds them from lecture_submissions, where the
  // orphaned row would resurrect a class the office had deleted.
  it('removing an impromptu card also deletes its filing row', async () => {
    mockStore.getLectureAbsencesForDate.mockResolvedValue([
      { lws_id: 'LWS-001', date: THURSDAY, slot_id: 'adhoc_abc', subject: 'Doubt', start_time: null, end_time: null },
    ])
    await ready()
    await screen.findAllByText('Doubt')
    fireEvent.click(screen.getByRole('button', { name: /remove .*doubt/i }))

    await waitFor(() => expect(mockStore.deleteLectureSubmission).toHaveBeenCalledWith(
      THURSDAY, 'adhoc_abc', 'LWS_NDA_2Y_(25-27)_A',
    ))
  })
})

describe('LectureLogTab — absent-today roster', () => {
  async function ready(batch = 'LWS_NDA_2Y_(25-27)_A') {
    render(<LectureLogTab initialDate={THURSDAY} initialBatch={batch} onSend={vi.fn()} />)
    await waitFor(() => expect(mockStore.getLectureAbsencesForDate).toHaveBeenCalled())
  }

  it('lists each absent student with the periods they missed', async () => {
    mockStore.getLectureAbsencesForDate.mockResolvedValue([
      { lws_id: 'LWS-001', date: THURSDAY, slot_id: 's1', subject: 'Maths' },
      { lws_id: 'LWS-001', date: THURSDAY, slot_id: 's2', subject: 'Physics' },
    ])
    await ready()
    const roster = within(await screen.findByTestId('absent-roster'))
    expect(roster.getByText('Arjun Sharma')).toBeInTheDocument()
    expect(roster.getByText('Maths')).toBeInTheDocument()
    expect(roster.getByText('Physics')).toBeInTheDocument()
    expect(screen.getByText(/1 student\b/)).toBeInTheDocument()
  })

  it('marks who has already been notified vs still pending', async () => {
    mockStore.lectureMissSendHistory = {
      [`${THURSDAY}|LWS_NDA_2Y_(25-27)_A`]: { sentAt: 1, sent: 1, notifiedLwsIds: ['LWS-001'] },
    }
    mockStore.getLectureAbsencesForDate.mockResolvedValue([
      { lws_id: 'LWS-001', date: THURSDAY, slot_id: 's1', subject: 'Maths' },
      { lws_id: 'LWS-002', date: THURSDAY, slot_id: 's1', subject: 'Maths' },
    ])
    await ready()
    const rows = within(await screen.findByTestId('absent-roster')).getAllByRole('row')
    expect(within(rows[1]).getByText(/sent/i)).toBeInTheDocument()     // Arjun Sharma — notified
    expect(within(rows[2]).getByText(/pending/i)).toBeInTheDocument()  // Ravi Kumar — not yet
  })

  it('falls back to every batch (with a Batch column) when no batch is picked', async () => {
    mockStore.getLectureAbsencesForDate.mockResolvedValue([
      { lws_id: 'LWS-001', date: THURSDAY, slot_id: 's1', subject: 'Maths' },
    ])
    render(<LectureLogTab initialDate={THURSDAY} />)
    const roster = within(await screen.findByTestId('absent-roster'))
    expect(screen.getByText(/absent today/i)).toBeInTheDocument()
    expect(roster.getByRole('columnheader', { name: /batch/i })).toBeInTheDocument()
    expect(roster.getByText('LWS_NDA_2Y_(25-27)_A')).toBeInTheDocument()
  })

  it('renders nothing when nobody was marked absent', async () => {
    mockStore.getLectureAbsencesForDate.mockResolvedValue([])
    await ready()
    expect(screen.queryByTestId('absent-roster')).not.toBeInTheDocument()
  })
})

describe('LectureLogTab — resend states (read lectureMissSendHistory)', () => {
  const HISTORY_KEY = `${THURSDAY}|LWS_NDA_2Y_(25-27)_A`

  it('renders the original button label when no history exists for (date, batch)', async () => {
    mockStore.getLectureAbsencesForDate.mockResolvedValue([
      { lws_id: 'LWS-001', date: THURSDAY, slot_id: 's1', subject: 'Maths' },
    ])
    render(<LectureLogTab initialDate={THURSDAY} initialBatch="LWS_NDA_2Y_(25-27)_A" onSend={vi.fn()} />)
    await waitFor(() => expect(mockStore.getLectureAbsencesForDate).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /send lecture-miss notifications/i })).toBeInTheDocument()
  })

  it('shows "Notify N pending" when an absentee is not yet notified', async () => {
    mockStore.lectureMissSendHistory = {
      [HISTORY_KEY]: { sentAt: Date.now(), sent: 1, skipped: 1, failedNames: ['Arjun Sharma'], notifiedLwsIds: [] },
    }
    mockStore.getLectureAbsencesForDate.mockResolvedValue([
      { lws_id: 'LWS-001', date: THURSDAY, slot_id: 's1', subject: 'Maths' },
    ])
    render(<LectureLogTab initialDate={THURSDAY} initialBatch="LWS_NDA_2Y_(25-27)_A" onSend={vi.fn()} />)
    await waitFor(() => expect(mockStore.getLectureAbsencesForDate).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /notify 1 pending/i })).toBeInTheDocument()
  })

  it('shows "All notified · Resend all" once every absentee has been notified', async () => {
    mockStore.lectureMissSendHistory = {
      [HISTORY_KEY]: { sentAt: Date.now(), sent: 2, skipped: 0, failedNames: [], notifiedLwsIds: ['LWS-001'] },
    }
    mockStore.getLectureAbsencesForDate.mockResolvedValue([
      { lws_id: 'LWS-001', date: THURSDAY, slot_id: 's1', subject: 'Maths' },
    ])
    render(<LectureLogTab initialDate={THURSDAY} initialBatch="LWS_NDA_2Y_(25-27)_A" onSend={vi.fn()} />)
    await waitFor(() => expect(mockStore.getLectureAbsencesForDate).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /all notified · resend all/i })).toBeInTheDocument()
  })
})

describe('LectureLogTab — pooled roster + leave-awareness', () => {
  it('pooling an "Also attending" batch unions its students into the modal roster', async () => {
    // Give batch B a timetable so it appears as a poolable chip; Karan is in B.
    mockStore.timetables = [TIMETABLE, { ...TIMETABLE, id: 'tt2', batchName: 'LWS_NDA_2Y_(25-27)_B', grid: {}, timeSlots: [] }]
    render(<LectureLogTab initialDate={THURSDAY} initialBatch="LWS_NDA_2Y_(25-27)_A" onSend={vi.fn()} />)
    await waitFor(() => expect(mockStore.getLectureAbsencesForDate).toHaveBeenCalled())

    // Karan (batch B) is not in the roster until pooled.
    fireEvent.click(screen.getAllByRole('button', { name: /mark absentees/i })[0])
    expect(screen.queryByLabelText(/Karan Mehta/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    // Pool batch B → Karan joins the roster.
    fireEvent.click(screen.getByRole('button', { name: 'LWS_NDA_2Y_(25-27)_B' }))
    fireEvent.click(screen.getAllByRole('button', { name: /mark absentees/i })[0])
    expect(await screen.findByLabelText(/Karan Mehta/)).toBeInTheDocument()
  })

  it('locks an on-leave student in the modal (leaves loaded for the date)', async () => {
    mockStore.getActiveLeaves.mockResolvedValue([
      { id: 'lv1', lws_id: 'LWS-001', from_ts: '2026-05-20T00:00:00+05:30', to_ts: null },
    ])
    render(<LectureLogTab initialDate={THURSDAY} initialBatch="LWS_NDA_2Y_(25-27)_A" onSend={vi.fn()} />)
    await waitFor(() => expect(mockStore.getActiveLeaves).toHaveBeenCalled())
    fireEvent.click(screen.getAllByRole('button', { name: /mark absentees/i })[0])
    expect(await screen.findByLabelText(/Arjun Sharma \(on leave\)/)).toBeDisabled()
  })

  it('marking an on-leave student "returned" closes the leave as of the previous day (THURSDAY itself becomes markable)', async () => {
    mockStore.getActiveLeaves.mockResolvedValue([
      { id: 'lv1', lws_id: 'LWS-001', from_ts: '2026-05-20T00:00:00+05:30', to_ts: null },
    ])
    render(<LectureLogTab initialDate={THURSDAY} initialBatch="LWS_NDA_2Y_(25-27)_A" onSend={vi.fn()} />)
    await waitFor(() => expect(mockStore.getActiveLeaves).toHaveBeenCalled())
    fireEvent.click(screen.getAllByRole('button', { name: /mark absentees/i })[0])
    fireEvent.click(await screen.findByRole('button', { name: /Arjun Sharma returned/ }))
    // THURSDAY = 2026-05-21 → leave closes end of 2026-05-20 (IST), i.e. the
    // day before, so the student is expected present on THURSDAY itself.
    await waitFor(() => expect(mockStore.endLeave).toHaveBeenCalledWith('lv1', expect.stringContaining('2026-05-20')))
  })
})
