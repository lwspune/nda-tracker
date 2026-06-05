import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = {
  studentProfiles: {},
  timetables: [],
  timetableMappings: [],
  setLectureAbsenteesForPeriod: vi.fn(),
  getLectureAbsencesForDate: vi.fn(),
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
  mockStore.setLectureAbsenteesForPeriod.mockResolvedValue(true)
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
    expect(await screen.findByText(/Mark absentees — Maths/)).toBeInTheDocument()
  })

  it('saving the modal calls setLectureAbsenteesForPeriod with the right args', async () => {
    render(<LectureLogTab initialDate={THURSDAY} initialBatch="LWS_NDA_2Y_(25-27)_A" onSend={vi.fn()} />)
    await waitFor(() => expect(mockStore.getLectureAbsencesForDate).toHaveBeenCalled())

    fireEvent.click(screen.getAllByRole('button', { name: /mark absentees/i })[0]) // Maths card
    // Modal shows; check Arjun and Ravi
    fireEvent.click(await screen.findByLabelText(/Arjun Sharma/))
    fireEvent.click(screen.getByLabelText(/Ravi Kumar/))
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

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
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

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
