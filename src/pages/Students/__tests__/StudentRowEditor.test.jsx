// Tests for StudentRowEditor — inline editor for branch + batches in the StudentsTable.
// Faculty-only UI; teacher mode never mounts this component.

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import StudentRowEditor from '../StudentRowEditor'

function makeProps(overrides = {}) {
  return {
    lwsId: 'LWS-001',
    name: 'Aarav Sharma',
    branch: 'LWS',
    batches: ['LWS_NDA_2Y_(25-27)'],
    availableBranches: ['LWS', 'APJSCH'],
    availableBatches: ['LWS_NDA_2Y_(25-27)', 'LWS_NDA_2Y_(26-28)', 'APJ_12th NDA (2026-27)'],
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('StudentRowEditor — initial render', () => {
  it('renders the branch select with the current branch selected', () => {
    render(<StudentRowEditor {...makeProps()} />)
    const branchSelect = screen.getByLabelText(/branch/i)
    expect(branchSelect).toHaveValue('LWS')
  })

  it('lists every available branch as an option', () => {
    render(<StudentRowEditor {...makeProps()} />)
    const branchSelect = screen.getByLabelText(/branch/i)
    const options = within(branchSelect).getAllByRole('option').map(o => o.value)
    expect(options).toContain('LWS')
    expect(options).toContain('APJSCH')
  })

  it('renders each batch as a removable chip', () => {
    render(<StudentRowEditor {...makeProps({ batches: ['A', 'B'] })} />)
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /remove/i })).toHaveLength(2)
  })

  it('renders Save and Cancel buttons', () => {
    render(<StudentRowEditor {...makeProps()} />)
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })
})

describe('StudentRowEditor — batch chip mutations', () => {
  it('removes a batch chip when its remove button is clicked', async () => {
    const user = userEvent.setup()
    render(<StudentRowEditor {...makeProps({ batches: ['A', 'B'] })} />)
    const removeButtons = screen.getAllByRole('button', { name: /remove/i })
    await user.click(removeButtons[0])
    expect(screen.queryByText('A')).not.toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
  })

  it('adds a batch from the dropdown', async () => {
    const user = userEvent.setup()
    render(<StudentRowEditor {...makeProps({ batches: [] })} />)
    const addSelect = screen.getByLabelText(/add batch/i)
    await user.selectOptions(addSelect, 'LWS_NDA_2Y_(25-27)')
    await user.click(screen.getByRole('button', { name: /^add$/i }))
    expect(screen.getByText('LWS_NDA_2Y_(25-27)')).toBeInTheDocument()
  })

  it('removes already-assigned batches from the Add dropdown to prevent duplicates', () => {
    render(<StudentRowEditor {...makeProps({ batches: ['LWS_NDA_2Y_(25-27)'] })} />)
    const addSelect = screen.getByLabelText(/add batch/i)
    const optionValues = within(addSelect).getAllByRole('option').map(o => o.value)
    expect(optionValues).not.toContain('LWS_NDA_2Y_(25-27)')
  })
})

describe('StudentRowEditor — Save', () => {
  it('calls onSave with current branch + batches', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<StudentRowEditor {...makeProps({ onSave })} />)
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(onSave).toHaveBeenCalledWith({
      branch: 'LWS',
      batches: ['LWS_NDA_2Y_(25-27)'],
    })
  })

  it('reflects branch changes in the Save payload', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<StudentRowEditor {...makeProps({ onSave })} />)
    await user.selectOptions(screen.getByLabelText(/branch/i), 'APJSCH')
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ branch: 'APJSCH' }))
  })

  it('reflects batch removals in the Save payload', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<StudentRowEditor {...makeProps({ batches: ['A', 'B'], onSave })} />)
    const removeButtons = screen.getAllByRole('button', { name: /remove/i })
    await user.click(removeButtons[0])
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ batches: ['B'] }))
  })
})

describe('StudentRowEditor — Cancel', () => {
  it('calls onCancel with no args', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<StudentRowEditor {...makeProps({ onCancel })} />)
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledWith()
  })

  it('does not call onSave on Cancel', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<StudentRowEditor {...makeProps({ onSave, onCancel: vi.fn() })} />)
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe('StudentRowEditor — Delete', () => {
  it('renders a Delete button when onDelete is provided', () => {
    render(<StudentRowEditor {...makeProps({ onDelete: vi.fn() })} />)
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
  })

  it('does NOT render a Delete button when onDelete is not provided', () => {
    render(<StudentRowEditor {...makeProps()} />)
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
  })

  it('calls onDelete with the lwsId when the user confirms', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<StudentRowEditor {...makeProps({ onDelete })} />)
    await user.click(screen.getByRole('button', { name: /delete/i }))
    expect(onDelete).toHaveBeenCalledWith('LWS-001')
  })

  it('does NOT call onDelete when the user cancels the confirm', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<StudentRowEditor {...makeProps({ onDelete })} />)
    await user.click(screen.getByRole('button', { name: /delete/i }))
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('confirm message mentions attendance and login history will be lost', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<StudentRowEditor {...makeProps({ name: 'Aarav Sharma', onDelete: vi.fn() })} />)
    await user.click(screen.getByRole('button', { name: /delete/i }))
    const message = confirmSpy.mock.calls[0][0]
    expect(message).toMatch(/Aarav Sharma/)
    expect(message).toMatch(/attendance/i)
    expect(message).toMatch(/login/i)
  })
})
