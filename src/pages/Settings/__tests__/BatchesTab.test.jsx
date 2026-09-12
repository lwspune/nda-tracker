// Tests for Settings → Batches, the sole CRUD surface for batches.
// Focus here is the archive lifecycle (BATCH_RETIREMENT.md): a batch is retired by
// archiving, never by deleting — delete drops teaching progress and orphans
// student_batches. The archived row must also report what is STILL live on it, so
// the list doubles as the retirement checklist.

import { render, screen, within, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = {
  syllabusBatches: [],
  archivedBatches: [],
  syllabusBatchBranches: {},
  batchProgramAssignments: {},
  timetables: [],
  branches: ['APJ', 'LWS Pune'],
  addBatch: vi.fn(() => ({ ok: true })),
  renameBatch: vi.fn(),
  deleteBatch: vi.fn(() => ({ ok: true })),
  setBatchArchived: vi.fn(() => ({ ok: true })),
  bulkSetAccountStatus: vi.fn(),
  studentProfiles: {},
  batchInUseBy: vi.fn(() => ({ inSyllabus: true, timetableCount: 0, examScheduleCount: 0, memberCount: 0 })),
  setSyllabusBatchBranch: vi.fn(),
}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

import BatchesTab from '../BatchesTab'

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(mockStore, {
    syllabusBatches: ['Alpha', 'Retired'],
    archivedBatches: ['Retired'],
    syllabusBatchBranches: { Alpha: 'APJ', Retired: 'LWS Pune' },
    batchProgramAssignments: {},
    timetables: [],
    batchInUseBy: vi.fn(() => ({ inSyllabus: true, timetableCount: 0, examScheduleCount: 0, memberCount: 0 })),
    studentProfiles: {},
  })
})

const activeSection   = () => screen.getByTestId('active-batches')
const archivedSection = () => screen.getByTestId('archived-batches')

describe('BatchesTab — archive lifecycle', () => {
  it('separates archived batches from active ones', () => {
    render(<BatchesTab />)
    expect(within(activeSection()).getByText('Alpha')).toBeInTheDocument()
    expect(within(activeSection()).queryByText('Retired')).not.toBeInTheDocument()
    expect(within(archivedSection()).getByText('Retired')).toBeInTheDocument()
  })

  it('archives an active batch', () => {
    render(<BatchesTab />)
    fireEvent.click(within(activeSection()).getByRole('button', { name: /archive Alpha/i }))
    expect(mockStore.setBatchArchived).toHaveBeenCalledWith('Alpha', true)
  })

  it('unarchives an archived batch', () => {
    render(<BatchesTab />)
    fireEvent.click(within(archivedSection()).getByRole('button', { name: /unarchive Retired/i }))
    expect(mockStore.setBatchArchived).toHaveBeenCalledWith('Retired', false)
  })

  it('hides the archived section entirely when nothing is archived', () => {
    mockStore.archivedBatches = []
    render(<BatchesTab />)
    expect(screen.queryByTestId('archived-batches')).not.toBeInTheDocument()
  })

  it('still lists a timetable-only batch that has been archived', () => {
    mockStore.syllabusBatches = ['Alpha']
    mockStore.timetables = [{ id: 'tt1', branch: 'APJ', batchName: 'GhostBatch' }]
    mockStore.archivedBatches = ['GhostBatch']
    render(<BatchesTab />)
    expect(within(archivedSection()).getByText('GhostBatch')).toBeInTheDocument()
  })
})

// An archived batch with a live timetable still puts the class on teachers' screens
// and their Google Calendar. The row has to say so, or "archived" reads as "done".
describe('BatchesTab — residual attachments on an archived batch', () => {
  it('warns when an archived batch still has a timetable', () => {
    mockStore.timetables = [{ id: 'tt1', branch: 'LWS Pune', batchName: 'Retired' }]
    render(<BatchesTab />)
    expect(within(archivedSection()).getByTestId('batch-residue')).toHaveTextContent(/still has a timetable/i)
  })

  it('warns when an archived batch still has exam schedules', () => {
    mockStore.batchInUseBy = vi.fn(() => ({ inSyllabus: true, timetableCount: 0, examScheduleCount: 2, memberCount: 0 }))
    render(<BatchesTab />)
    expect(within(archivedSection()).getByTestId('batch-residue')).toHaveTextContent(/2 exam schedules/i)
  })

  it('shows no warning when an archived batch is fully detached', () => {
    render(<BatchesTab />)
    expect(within(archivedSection()).queryByTestId('batch-residue')).not.toBeInTheDocument()
  })
})

// Delete is for a batch created in error, never for retiring a finished one — it
// orphans every student_batches row and hides the result. Tier 3, BATCH_RETIREMENT.md.
describe('BatchesTab — delete is blocked while students hold the batch', () => {
  beforeEach(() => {
    mockStore.batchInUseBy = vi.fn(() => ({
      inSyllabus: true, timetableCount: 0, examScheduleCount: 0, memberCount: 8,
    }))
  })

  it('disables Delete', () => {
    render(<BatchesTab />)
    expect(within(activeSection()).getByRole('button', { name: /delete Alpha/i })).toBeDisabled()
  })

  it('leaves Archive available as the way out', () => {
    render(<BatchesTab />)
    expect(within(activeSection()).getByRole('button', { name: /archive Alpha/i })).toBeEnabled()
  })

  // The store is the real boundary, so the message must still be right if the button
  // is reached some other way (stale render, keyboard, a future caller).
  it('names the students in the blocked-delete message and points at Archive', () => {
    mockStore.batchInUseBy = vi.fn(() => ({ inSyllabus: true, timetableCount: 0, examScheduleCount: 0, memberCount: 0 }))
    mockStore.deleteBatch = vi.fn(() => ({
      ok: false,
      usage: { timetableCount: 0, examScheduleCount: 0, memberCount: 8 },
    }))
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    render(<BatchesTab />)
    fireEvent.click(within(activeSection()).getByRole('button', { name: /delete Alpha/i }))
    expect(alertSpy).toHaveBeenCalledWith(expect.stringMatching(/8 students/i))
    expect(alertSpy).toHaveBeenCalledWith(expect.stringMatching(/archive/i))
    alertSpy.mockRestore()
  })
})

// Archiving offers to block the batch's students in the same action. Doing it
// per-student is ~3 interactions each, so at batch scale that step of the
// retirement procedure would simply not get done. BATCH_RETIREMENT.md.
describe('BatchesTab — archive offers to block the students', () => {
  function withMembers(n, over = {}) {
    const profiles = {}
    for (let i = 0; i < n; i++) {
      const name = 'Student ' + i
      profiles[name] = { lwsId: 'LWS-' + i, name, batches: ['Alpha'], accountStatus: 'Active', nameVariants: [], ...over }
    }
    mockStore.studentProfiles = profiles
  }

  it('asks before archiving when the batch has students who can log in', () => {
    withMembers(3)
    render(<BatchesTab />)
    fireEvent.click(within(activeSection()).getByRole('button', { name: /archive Alpha/i }))
    expect(screen.getByTestId('archive-confirm')).toHaveTextContent(/3 active students/i)
    expect(mockStore.setBatchArchived).not.toHaveBeenCalled()
  })

  it('blocks by default when confirmed', () => {
    withMembers(2)
    render(<BatchesTab />)
    fireEvent.click(within(activeSection()).getByRole('button', { name: /archive Alpha/i }))
    fireEvent.click(within(screen.getByTestId('archive-confirm')).getByRole('button', { name: /^archive$/i }))
    expect(mockStore.setBatchArchived).toHaveBeenCalledWith('Alpha', true)
    expect(mockStore.bulkSetAccountStatus).toHaveBeenCalledWith(['LWS-0', 'LWS-1'], 'Block')
  })

  it('archives without blocking when the box is unticked', () => {
    withMembers(2)
    render(<BatchesTab />)
    fireEvent.click(within(activeSection()).getByRole('button', { name: /archive Alpha/i }))
    fireEvent.click(screen.getByLabelText(/also block portal access/i))
    fireEvent.click(within(screen.getByTestId('archive-confirm')).getByRole('button', { name: /^archive$/i }))
    expect(mockStore.setBatchArchived).toHaveBeenCalledWith('Alpha', true)
    expect(mockStore.bulkSetAccountStatus).not.toHaveBeenCalled()
  })

  it('cancels cleanly', () => {
    withMembers(2)
    render(<BatchesTab />)
    fireEvent.click(within(activeSection()).getByRole('button', { name: /archive Alpha/i }))
    fireEvent.click(within(screen.getByTestId('archive-confirm')).getByRole('button', { name: /cancel/i }))
    expect(mockStore.setBatchArchived).not.toHaveBeenCalled()
    expect(mockStore.bulkSetAccountStatus).not.toHaveBeenCalled()
  })

  // Nothing to decide, so nothing to ask.
  it('archives immediately when nobody in the batch can log in', () => {
    mockStore.studentProfiles = {}
    render(<BatchesTab />)
    fireEvent.click(within(activeSection()).getByRole('button', { name: /archive Alpha/i }))
    expect(screen.queryByTestId('archive-confirm')).not.toBeInTheDocument()
    expect(mockStore.setBatchArchived).toHaveBeenCalledWith('Alpha', true)
  })

  it('never asks on unarchive, and does not unblock', () => {
    mockStore.studentProfiles = {
      'Student 0': { lwsId: 'LWS-0', name: 'Student 0', batches: ['Retired'], accountStatus: 'Block', nameVariants: [] },
    }
    render(<BatchesTab />)
    fireEvent.click(within(archivedSection()).getByRole('button', { name: /unarchive Retired/i }))
    expect(mockStore.setBatchArchived).toHaveBeenCalledWith('Retired', false)
    expect(mockStore.bulkSetAccountStatus).not.toHaveBeenCalled()
  })

  // Because unarchive does not unblock, the count has to stay visible.
  it('shows how many of a batch are blocked', () => {
    mockStore.studentProfiles = {
      'A': { lwsId: 'LWS-0', name: 'A', batches: ['Alpha'], accountStatus: 'Block',  nameVariants: [] },
      'B': { lwsId: 'LWS-1', name: 'B', batches: ['Alpha'], accountStatus: 'Active', nameVariants: [] },
    }
    mockStore.batchInUseBy = vi.fn(() => ({ inSyllabus: true, timetableCount: 0, examScheduleCount: 0, memberCount: 2 }))
    render(<BatchesTab />)
    expect(within(activeSection()).getByText(/1 blocked/i)).toBeInTheDocument()
  })
})
