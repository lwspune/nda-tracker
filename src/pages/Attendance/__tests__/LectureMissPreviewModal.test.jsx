import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = { studentProfiles: {} }

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

import LectureMissPreviewModal from '../LectureMissPreviewModal'

const PROFILES = {
  'Arjun Sharma': { name: 'Arjun Sharma', lwsId: 'LWS-001', mobile: '9876543210', parentMobiles: ['9876543211'] },
  'Ravi Kumar':   { name: 'Ravi Kumar',   lwsId: 'LWS-002', mobile: '9876543212', parentMobiles: [] },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStore.studentProfiles = PROFILES
})

describe('LectureMissPreviewModal', () => {
  const ABSENCES = {
    'LWS-001': ['Maths', 'Physics'],
    'LWS-002': ['English'],
  }

  it('renders one row per student with their missed subjects listed', () => {
    render(
      <LectureMissPreviewModal
        date="2026-05-21"
        absencesByLwsId={ABSENCES}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('Arjun Sharma')).toBeInTheDocument()
    expect(screen.getByText('Ravi Kumar')).toBeInTheDocument()
    expect(screen.getByText(/Maths, Physics/)).toBeInTheDocument()
    expect(screen.getByText('English')).toBeInTheDocument()
  })

  it('confirm passes rows with subjects to onConfirm', () => {
    const onConfirm = vi.fn()
    render(
      <LectureMissPreviewModal
        date="2026-05-21"
        absencesByLwsId={ABSENCES}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /confirm send/i }))
    expect(onConfirm).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          lwsId: 'LWS-001',
          name: 'Arjun Sharma',
          subjects: ['Maths', 'Physics'],
        }),
        expect.objectContaining({
          lwsId: 'LWS-002',
          name: 'Ravi Kumar',
          subjects: ['English'],
        }),
      ]),
      ''
    )
  })

  it('redirect-to field is forwarded', () => {
    const onConfirm = vi.fn()
    render(
      <LectureMissPreviewModal
        date="2026-05-21"
        absencesByLwsId={ABSENCES}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />
    )
    fireEvent.change(screen.getByLabelText(/redirect/i), { target: { value: '7777777777' } })
    fireEvent.click(screen.getByRole('button', { name: /confirm send/i }))
    expect(onConfirm).toHaveBeenCalledWith(expect.any(Array), '7777777777')
  })

  it('empty state disables confirm', () => {
    render(
      <LectureMissPreviewModal
        date="2026-05-21"
        absencesByLwsId={{}}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText(/no students/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm send/i })).toBeDisabled()
  })

  it('cancel does not call onConfirm', () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(
      <LectureMissPreviewModal
        date="2026-05-21"
        absencesByLwsId={ABSENCES}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(onClose).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
