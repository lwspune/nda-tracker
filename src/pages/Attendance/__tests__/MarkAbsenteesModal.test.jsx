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
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
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
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
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
