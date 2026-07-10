import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import MarkAbsenteesModal from '../MarkAbsenteesModal'

const STUDENTS = [
  { lwsId: 'LWS-001', name: 'Arjun Sharma' },
  { lwsId: 'LWS-002', name: 'Ravi Kumar' },
  { lwsId: 'LWS-003', name: 'Karan Mehta' },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MarkAbsenteesModal', () => {
  it('renders subject + date in the title', () => {
    render(
      <MarkAbsenteesModal
        open
        date="2026-05-21"
        subject="Maths"
        studentsInBatch={STUDENTS}
        initialAbsentees={[]}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    )
    // Title should mention Maths and the date in human form
    expect(screen.getByText(/Maths/)).toBeInTheDocument()
    expect(screen.getByText(/21 May 2026/)).toBeInTheDocument()
  })

  it('renders one checkbox per student in the batch', () => {
    render(
      <MarkAbsenteesModal
        open date="2026-05-21" subject="Maths"
        studentsInBatch={STUDENTS}
        initialAbsentees={[]}
        onSave={vi.fn()} onClose={vi.fn()}
      />
    )
    expect(screen.getByLabelText(/Arjun Sharma/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Ravi Kumar/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Karan Mehta/)).toBeInTheDocument()
  })

  it('pre-checks students in initialAbsentees', () => {
    render(
      <MarkAbsenteesModal
        open date="2026-05-21" subject="Maths"
        studentsInBatch={STUDENTS}
        initialAbsentees={['LWS-001', 'LWS-003']}
        onSave={vi.fn()} onClose={vi.fn()}
      />
    )
    expect(screen.getByLabelText(/Arjun Sharma/)).toBeChecked()
    expect(screen.getByLabelText(/Ravi Kumar/)).not.toBeChecked()
    expect(screen.getByLabelText(/Karan Mehta/)).toBeChecked()
  })

  it('toggling a checkbox updates draft state', () => {
    render(
      <MarkAbsenteesModal
        open date="2026-05-21" subject="Maths"
        studentsInBatch={STUDENTS}
        initialAbsentees={[]}
        onSave={vi.fn()} onClose={vi.fn()}
      />
    )
    const cb = screen.getByLabelText(/Ravi Kumar/)
    fireEvent.click(cb)
    expect(cb).toBeChecked()
    fireEvent.click(cb)
    expect(cb).not.toBeChecked()
  })

  it('save calls onSave with the current checked lws_ids and then onClose', () => {
    const onSave  = vi.fn()
    const onClose = vi.fn()
    render(
      <MarkAbsenteesModal
        open date="2026-05-21" subject="Maths"
        studentsInBatch={STUDENTS}
        initialAbsentees={['LWS-001']}
        onSave={onSave} onClose={onClose}
      />
    )
    fireEvent.click(screen.getByLabelText(/Karan Mehta/))
    fireEvent.click(screen.getByRole('button', { name: /^save/i }))
    expect(onSave).toHaveBeenCalledWith(['LWS-001', 'LWS-003'])
    expect(onClose).toHaveBeenCalled()
  })

  it('cancel calls onClose and does not call onSave', () => {
    const onSave  = vi.fn()
    const onClose = vi.fn()
    render(
      <MarkAbsenteesModal
        open date="2026-05-21" subject="Maths"
        studentsInBatch={STUDENTS}
        initialAbsentees={[]}
        onSave={onSave} onClose={onClose}
      />
    )
    fireEvent.click(screen.getByLabelText(/Arjun Sharma/))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('search filters the visible students by name', () => {
    render(
      <MarkAbsenteesModal
        open date="2026-05-21" subject="Maths"
        studentsInBatch={STUDENTS}
        initialAbsentees={[]}
        onSave={vi.fn()} onClose={vi.fn()}
      />
    )
    const search = screen.getByPlaceholderText(/search/i)
    fireEvent.change(search, { target: { value: 'arj' } })
    expect(screen.getByLabelText(/Arjun Sharma/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Ravi Kumar/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Karan Mehta/)).not.toBeInTheDocument()
  })

  it('filtering does not lose previously-checked students that scroll out of view', () => {
    // Check Ravi, then filter to "arj" (which hides Ravi), then save.
    // Ravi should remain in the saved list.
    const onSave = vi.fn()
    render(
      <MarkAbsenteesModal
        open date="2026-05-21" subject="Maths"
        studentsInBatch={STUDENTS}
        initialAbsentees={[]}
        onSave={onSave} onClose={vi.fn()}
      />
    )
    fireEvent.click(screen.getByLabelText(/Ravi Kumar/))
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'arj' } })
    fireEvent.click(screen.getByLabelText(/Arjun Sharma/))
    fireEvent.click(screen.getByRole('button', { name: /^save/i }))
    expect(onSave).toHaveBeenCalledWith(expect.arrayContaining(['LWS-001', 'LWS-002']))
  })

  it('returns null when open is false', () => {
    const { container } = render(
      <MarkAbsenteesModal
        open={false}
        date="2026-05-21" subject="Maths"
        studentsInBatch={STUDENTS}
        initialAbsentees={[]}
        onSave={vi.fn()} onClose={vi.fn()}
      />
    )
    expect(container.firstChild).toBeNull()
  })
})

describe('MarkAbsenteesModal — present/absent toggle + leave-awareness', () => {
  const ROSTER = [
    { lwsId: 'A', name: 'Aaron' },
    { lwsId: 'B', name: 'Bina' },
    { lwsId: 'C', name: 'Cyrus' },
  ]
  function renderModal(props = {}) {
    const onSave = vi.fn()
    const onMarkReturned = vi.fn()
    render(
      <MarkAbsenteesModal
        open date="2026-07-10" subject="Physics"
        studentsInBatch={ROSTER} initialAbsentees={[]}
        onLeaveIds={props.onLeaveIds ?? []}
        onMarkReturned={onMarkReturned}
        onSave={onSave} onClose={vi.fn()}
      />,
    )
    return { onSave, onMarkReturned }
  }

  it('absent mode (default): saves exactly the tapped students', () => {
    const { onSave } = renderModal()
    fireEvent.click(screen.getByLabelText('Aaron'))
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }))
    expect(onSave).toHaveBeenCalledWith(['A'])
  })

  it('present mode: absent = roster − present', () => {
    const { onSave } = renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Present list' }))
    fireEvent.click(screen.getByLabelText('Aaron'))    // Aaron present
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }))
    expect(onSave).toHaveBeenCalledWith(['B', 'C'])
  })

  it('an on-leave student is locked, tagged, and never logged absent', () => {
    const { onSave } = renderModal({ onLeaveIds: ['B'] })
    expect(screen.getByLabelText('Bina (on leave)')).toBeDisabled()
    expect(screen.getByText('on leave')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Present list' }))
    fireEvent.click(screen.getByLabelText('Aaron'))    // present → absent should be [C] only
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }))
    expect(onSave).toHaveBeenCalledWith(['C'])
  })

  it('the live preview reflects the derived absent + excluded-leave counts', () => {
    renderModal({ onLeaveIds: ['B'] })
    expect(screen.getByText('Will log absent').closest('span')).toHaveTextContent('0')
    expect(screen.getByText('On leave (excluded)').closest('span')).toHaveTextContent('1')
  })

  it('fires onMarkReturned for an on-leave student reported present', () => {
    const { onMarkReturned } = renderModal({ onLeaveIds: ['B'] })
    fireEvent.click(screen.getByRole('button', { name: /Bina returned/ }))
    expect(onMarkReturned).toHaveBeenCalledWith('B')
  })

  it('non-hostel branch (no leaves): plain present toggle, nothing locked', () => {
    const { onSave } = renderModal({ onLeaveIds: [] })
    expect(screen.queryByText('on leave')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Present list' }))
    fireEvent.click(screen.getByLabelText('Aaron'))
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }))
    expect(onSave).toHaveBeenCalledWith(['B', 'C'])
  })
})
