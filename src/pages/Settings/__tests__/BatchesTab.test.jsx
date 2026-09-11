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
