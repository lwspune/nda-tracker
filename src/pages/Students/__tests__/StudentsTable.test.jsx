// Tests for StudentsTable — the filtered, paginated student browser at the top of the Students page.
// Click a name → onSelect(name). Click Edit → expands the row with StudentRowEditor.

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// StudentRowEditor is stubbed — it has its own test file and we don't want to test its internals here.
vi.mock('../StudentRowEditor', () => ({
  default: ({ branch, batches, availableBranches, availableBatches, batchBranches, onSave, onCancel }) => (
    <div data-testid="row-editor"
         data-branch={branch}
         data-batches={batches.join('|')}
         data-available-branches={(availableBranches || []).join('|')}
         data-available-batches={(availableBatches || []).join('|')}
         data-batch-branches={JSON.stringify(batchBranches || {})}>
      <button onClick={() => onSave({ branch: 'NEW', batches: ['X'] })}>EditorSave</button>
      <button onClick={() => onCancel()}>EditorCancel</button>
    </div>
  ),
}))

import StudentsTable from '../StudentsTable'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeStudent(overrides = {}) {
  return {
    lwsId:         'LWS-001',
    name:          'Aarav Sharma',
    branch:        'LWS',
    batches:       ['LWS_NDA_2Y_(25-27)'],
    mobile:        '9000000001',
    accountStatus: 'Active',
    nameVariants:  [],
    ...overrides,
  }
}

function makeProps(overrides = {}) {
  return {
    students: [
      makeStudent({ lwsId: 'LWS-001', name: 'Aarav Sharma',    branch: 'LWS',    batches: ['B1'], accountStatus: 'Active' }),
      makeStudent({ lwsId: 'LWS-002', name: 'Bina Patil',       branch: 'LWS',    batches: ['B1', 'B2'], accountStatus: 'Active' }),
      makeStudent({ lwsId: 'LWS-003', name: 'Chetan Kulkarni',  branch: 'APJSCH', batches: ['B2'], accountStatus: 'Quit' }),
    ],
    exams: [],
    activeStudent: null,
    onSelect: vi.fn(),
    onEdit:   vi.fn(),
    isAdmin: true,
    ...overrides,
  }
}

beforeEach(() => { vi.restoreAllMocks() })

// ── Render ────────────────────────────────────────────────────────────────────

describe('StudentsTable — rendering', () => {
  it('renders one row per student', () => {
    render(<StudentsTable {...makeProps()} />)
    expect(screen.getByText('Aarav Sharma')).toBeInTheDocument()
    expect(screen.getByText('Bina Patil')).toBeInTheDocument()
    expect(screen.getByText('Chetan Kulkarni')).toBeInTheDocument()
  })

  it('shows Edit button per row in faculty mode', () => {
    render(<StudentsTable {...makeProps()} />)
    expect(screen.getAllByRole('button', { name: /edit/i })).toHaveLength(3)
  })

  it('hides Edit button in teacher mode', () => {
    render(<StudentsTable {...makeProps({ isAdmin: false })} />)
    expect(screen.queryAllByRole('button', { name: /edit/i })).toHaveLength(0)
  })

  it('shows the total / filtered count', () => {
    render(<StudentsTable {...makeProps()} />)
    expect(screen.getByText(/3 of 3/i)).toBeInTheDocument()
  })
})

// ── Filters ───────────────────────────────────────────────────────────────────

describe('StudentsTable — filters', () => {
  it('search input filters by canonical name (case-insensitive substring)', async () => {
    const user = userEvent.setup()
    render(<StudentsTable {...makeProps()} />)
    await user.type(screen.getByPlaceholderText(/search name/i), 'bina')
    expect(screen.queryByText('Aarav Sharma')).not.toBeInTheDocument()
    expect(screen.getByText('Bina Patil')).toBeInTheDocument()
    expect(screen.queryByText('Chetan Kulkarni')).not.toBeInTheDocument()
  })

  it('search also matches lws_id', async () => {
    const user = userEvent.setup()
    render(<StudentsTable {...makeProps()} />)
    await user.type(screen.getByPlaceholderText(/search name/i), 'LWS-003')
    expect(screen.getByText('Chetan Kulkarni')).toBeInTheDocument()
    expect(screen.queryByText('Aarav Sharma')).not.toBeInTheDocument()
  })

  it('search also matches name_variants', async () => {
    const user = userEvent.setup()
    const props = makeProps({
      students: [
        makeStudent({ lwsId: 'LWS-001', name: 'Nirnit Hemraj Patil', nameVariants: ['Nirnit Patil'] }),
        makeStudent({ lwsId: 'LWS-002', name: 'Bina Patil', nameVariants: [] }),
      ],
    })
    render(<StudentsTable {...props} />)
    await user.type(screen.getByPlaceholderText(/search name/i), 'Nirnit Patil')
    expect(screen.getByText('Nirnit Hemraj Patil')).toBeInTheDocument()
    expect(screen.queryByText('Bina Patil')).not.toBeInTheDocument()
  })

  it('branch filter narrows the list', async () => {
    const user = userEvent.setup()
    render(<StudentsTable {...makeProps()} />)
    await user.selectOptions(screen.getByLabelText(/branch/i), 'APJSCH')
    expect(screen.queryByText('Aarav Sharma')).not.toBeInTheDocument()
    expect(screen.queryByText('Bina Patil')).not.toBeInTheDocument()
    expect(screen.getByText('Chetan Kulkarni')).toBeInTheDocument()
  })

  it('batch filter narrows the list', async () => {
    const user = userEvent.setup()
    render(<StudentsTable {...makeProps()} />)
    await user.selectOptions(screen.getByLabelText(/batch/i), 'B2')
    expect(screen.queryByText('Aarav Sharma')).not.toBeInTheDocument()
    expect(screen.getByText('Bina Patil')).toBeInTheDocument()
    expect(screen.getByText('Chetan Kulkarni')).toBeInTheDocument()
  })

  it('status filter narrows the list', async () => {
    const user = userEvent.setup()
    render(<StudentsTable {...makeProps()} />)
    await user.selectOptions(screen.getByLabelText(/status/i), 'Quit')
    expect(screen.queryByText('Aarav Sharma')).not.toBeInTheDocument()
    expect(screen.queryByText('Bina Patil')).not.toBeInTheDocument()
    expect(screen.getByText('Chetan Kulkarni')).toBeInTheDocument()
  })
})

// ── Pagination ────────────────────────────────────────────────────────────────

describe('StudentsTable — pagination', () => {
  function makeManyStudents(n) {
    return Array.from({ length: n }, (_, i) => makeStudent({
      lwsId: `LWS-${String(i + 1).padStart(3, '0')}`,
      name: `Student ${String(i + 1).padStart(3, '0')}`,
    }))
  }

  it('shows 25 students on the first page', () => {
    render(<StudentsTable {...makeProps({ students: makeManyStudents(30) })} />)
    expect(screen.getByText('Student 001')).toBeInTheDocument()
    expect(screen.getByText('Student 025')).toBeInTheDocument()
    expect(screen.queryByText('Student 026')).not.toBeInTheDocument()
  })

  it('Next button moves to page 2', async () => {
    const user = userEvent.setup()
    render(<StudentsTable {...makeProps({ students: makeManyStudents(30) })} />)
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.queryByText('Student 001')).not.toBeInTheDocument()
    expect(screen.getByText('Student 026')).toBeInTheDocument()
    expect(screen.getByText('Student 030')).toBeInTheDocument()
  })

  it('Previous button is disabled on page 1', () => {
    render(<StudentsTable {...makeProps({ students: makeManyStudents(30) })} />)
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()
  })

  it('Next button is disabled on the last page', async () => {
    const user = userEvent.setup()
    render(<StudentsTable {...makeProps({ students: makeManyStudents(30) })} />)
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
  })

  it('page resets to 1 when filter changes', async () => {
    const user = userEvent.setup()
    const students = makeManyStudents(60)
    students[55].name = 'Filtered Student' // page-3 by default
    render(<StudentsTable {...makeProps({ students })} />)
    await user.click(screen.getByRole('button', { name: /next/i })) // page 2
    await user.type(screen.getByPlaceholderText(/search name/i), 'Filtered Student')
    expect(screen.getByText('Filtered Student')).toBeInTheDocument()
  })
})

// ── Click behaviours ──────────────────────────────────────────────────────────

describe('StudentsTable — click handlers', () => {
  it('clicking a name calls onSelect with that name', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<StudentsTable {...makeProps({ onSelect })} />)
    await user.click(screen.getByText('Bina Patil'))
    expect(onSelect).toHaveBeenCalledWith('Bina Patil')
  })

  it('clicking Edit expands the row editor for that student', async () => {
    const user = userEvent.setup()
    render(<StudentsTable {...makeProps()} />)
    const editButtons = screen.getAllByRole('button', { name: /edit/i })
    await user.click(editButtons[1]) // Bina
    const editor = screen.getByTestId('row-editor')
    expect(editor).toHaveAttribute('data-branch', 'LWS')
    expect(editor).toHaveAttribute('data-batches', 'B1|B2')
  })

  it('editor Save calls onEdit with lwsId + name + new values, then collapses', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    render(<StudentsTable {...makeProps({ onEdit })} />)
    const editButtons = screen.getAllByRole('button', { name: /edit/i })
    await user.click(editButtons[1])
    await user.click(screen.getByText('EditorSave'))
    expect(onEdit).toHaveBeenCalledWith('LWS-002', 'Bina Patil', { branch: 'NEW', batches: ['X'] })
    expect(screen.queryByTestId('row-editor')).not.toBeInTheDocument()
  })

  it('editor Cancel collapses without calling onEdit', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    render(<StudentsTable {...makeProps({ onEdit })} />)
    await user.click(screen.getAllByRole('button', { name: /edit/i })[0])
    await user.click(screen.getByText('EditorCancel'))
    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.queryByTestId('row-editor')).not.toBeInTheDocument()
  })
})

// ── Alignment column + filter ─────────────────────────────────────────────────

describe('StudentsTable — alignment column', () => {
  it('shows aligned indicator when student batches are all in centralBatches', () => {
    render(<StudentsTable {...makeProps({
      students: [makeStudent({ lwsId: 'LWS-001', name: 'Aligned Stu', batches: ['CB1', 'CB2'] })],
      centralBatches: ['CB1', 'CB2', 'CB3'],
    })} />)
    const row = screen.getByText('Aligned Stu').closest('tr')
    expect(within(row).getByLabelText(/aligned/i)).toBeInTheDocument()
  })

  it('shows needs-review indicator when student batches contain a non-central batch', () => {
    render(<StudentsTable {...makeProps({
      students: [makeStudent({ lwsId: 'LWS-001', name: 'Unaligned Stu', batches: ['HR_Batch'] })],
      centralBatches: ['CB1'],
    })} />)
    const row = screen.getByText('Unaligned Stu').closest('tr')
    expect(within(row).getByLabelText(/needs review/i)).toBeInTheDocument()
  })

  it('shows needs-review indicator when student batches is empty', () => {
    render(<StudentsTable {...makeProps({
      students: [makeStudent({ lwsId: 'LWS-001', name: 'Empty Stu', batches: [] })],
      centralBatches: ['CB1'],
    })} />)
    const row = screen.getByText('Empty Stu').closest('tr')
    expect(within(row).getByLabelText(/needs review/i)).toBeInTheDocument()
  })

  it('alignment filter "needs review" shows only unaligned students', async () => {
    const user = userEvent.setup()
    render(<StudentsTable {...makeProps({
      students: [
        makeStudent({ lwsId: 'LWS-001', name: 'Aligned Stu',   batches: ['CB1'] }),
        makeStudent({ lwsId: 'LWS-002', name: 'Unaligned Stu', batches: ['HR_Batch'] }),
      ],
      centralBatches: ['CB1'],
    })} />)
    await user.selectOptions(screen.getByLabelText(/alignment/i), 'unaligned')
    expect(screen.queryByText('Aligned Stu')).not.toBeInTheDocument()
    expect(screen.getByText('Unaligned Stu')).toBeInTheDocument()
  })

  it('alignment filter "aligned" shows only aligned students', async () => {
    const user = userEvent.setup()
    render(<StudentsTable {...makeProps({
      students: [
        makeStudent({ lwsId: 'LWS-001', name: 'Aligned Stu',   batches: ['CB1'] }),
        makeStudent({ lwsId: 'LWS-002', name: 'Unaligned Stu', batches: ['HR_Batch'] }),
      ],
      centralBatches: ['CB1'],
    })} />)
    await user.selectOptions(screen.getByLabelText(/alignment/i), 'aligned')
    expect(screen.getByText('Aligned Stu')).toBeInTheDocument()
    expect(screen.queryByText('Unaligned Stu')).not.toBeInTheDocument()
  })

  it('without centralBatches prop, every student counts as aligned (no work-in-progress signal)', () => {
    render(<StudentsTable {...makeProps()} />)
    // No centralBatches passed; the alignment indicator stays off all rows
    expect(screen.queryByLabelText(/needs review/i)).not.toBeInTheDocument()
  })

  it('forwards centralBranches, centralBatches, and batchBranchMap to the row editor', async () => {
    const user = userEvent.setup()
    render(<StudentsTable {...makeProps({
      centralBranches: ['LWS Pune', 'APJ'],
      centralBatches:  ['CB1', 'CB2'],
      batchBranchMap:  { CB1: 'LWS Pune', CB2: 'APJ' },
    })} />)
    await user.click(screen.getAllByRole('button', { name: /edit/i })[0])
    const editor = screen.getByTestId('row-editor')
    expect(editor).toHaveAttribute('data-available-branches', 'LWS Pune|APJ')
    expect(editor).toHaveAttribute('data-available-batches',  'CB1|CB2')
    expect(JSON.parse(editor.getAttribute('data-batch-branches'))).toEqual({ CB1: 'LWS Pune', CB2: 'APJ' })
  })
})

// ── Highlight active row ──────────────────────────────────────────────────────

describe('StudentsTable — active row', () => {
  it('marks the active student row with aria-current', () => {
    render(<StudentsTable {...makeProps({ activeStudent: 'Bina Patil' })} />)
    const activeRow = screen.getByText('Bina Patil').closest('[aria-current]')
    expect(activeRow).toBeInTheDocument()
    expect(activeRow).toHaveAttribute('aria-current', 'true')
  })
})
