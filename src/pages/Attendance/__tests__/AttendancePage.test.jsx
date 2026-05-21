// Tests for AttendancePage — student row click navigation.
// The page is faculty/teacher only; both modes should send users to the
// Students page when a profile-backed name is clicked.

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: vi.fn() },
}))

const mockStore = {
  studentProfiles: {},
  importAttendance: vi.fn(),
  setActiveStudent: vi.fn(),
  // Late-marking widget deps (admin only, rendered on Class metrics tab)
  markLate: vi.fn().mockResolvedValue(true),
  unmarkLate: vi.fn().mockResolvedValue(true),
  getLateStudentsForDate: vi.fn().mockResolvedValue([]),
  lateSendHistory: {},
  setLateSendHistory: vi.fn(),
  // LectureLogTab deps (rendered only when that tab is active)
  timetables: [],
  timetableMappings: [],
  setLectureAbsenteesForPeriod: vi.fn().mockResolvedValue(true),
  getLectureAbsencesForDate: vi.fn().mockResolvedValue([]),
}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

vi.mock('../../../context/ModeContext', () => ({
  useMode: () => 'admin',
}))

import { supabase } from '../../../lib/supabase'
import AttendancePage from '../index'

// ── Supabase paginated fetch helper ──────────────────────────────
// First .range() call returns the records, subsequent calls return [] so
// the while-loop in fetchAll() exits.
function mockAttendanceRecords(records) {
  let called = false
  const range = vi.fn().mockImplementation(() => {
    if (called) return Promise.resolve({ data: [], error: null })
    called = true
    return Promise.resolve({ data: records, error: null })
  })
  const select = vi.fn().mockReturnValue({ range })
  supabase.from.mockReturnValue({ select })
}

// ── Fixtures ─────────────────────────────────────────────────────

const PROFILE_ARJUN = {
  name: 'Arjun Sharma', lwsId: 'LWS-001', nameVariants: [],
  branch: '', batches: [], mobile: '', parentMobiles: [],
  regDate: '', accountStatus: '', comingStatus: '',
}

const RECORDS = [
  { lws_id: 'LWS-001', date: '2026-05-01', status: 'P' },
  { lws_id: 'LWS-001', date: '2026-05-02', status: 'A' },
  // Orphan record — no matching profile, name falls back to the lws_id
  { lws_id: 'LWS-999', date: '2026-05-01', status: 'P' },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockStore.studentProfiles = { 'Arjun Sharma': PROFILE_ARJUN }
})

// ── Tests ────────────────────────────────────────────────────────

describe('AttendancePage — student row navigation', () => {
  it('renders the student name as a button when a matching profile exists', async () => {
    mockAttendanceRecords(RECORDS)
    render(<AttendancePage />)

    const button = await screen.findByRole('button', { name: 'Arjun Sharma' })
    expect(button).toBeInTheDocument()
  })

  it('clicking the student name calls setActiveStudent with the canonical name', async () => {
    mockAttendanceRecords(RECORDS)
    render(<AttendancePage />)

    const button = await screen.findByRole('button', { name: 'Arjun Sharma' })
    fireEvent.click(button)
    expect(mockStore.setActiveStudent).toHaveBeenCalledWith('Arjun Sharma')
  })

  it('renders orphan lwsId rows as plain text (no profile match → no button)', async () => {
    mockAttendanceRecords(RECORDS)
    render(<AttendancePage />)

    await screen.findByRole('button', { name: 'Arjun Sharma' })
    expect(screen.queryByRole('button', { name: 'LWS-999' })).not.toBeInTheDocument()
    expect(screen.getByText('LWS-999')).toBeInTheDocument()
  })
})
