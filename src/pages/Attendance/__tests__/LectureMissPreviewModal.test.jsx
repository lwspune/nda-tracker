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
  // Each subject entry is now an object with time info derived from the timetable
  const ABSENCES = {
    'LWS-001': [
      { subject: 'Maths',   startTime: '9:00 AM',  endTime: '10:00 AM' },
      { subject: 'Physics', startTime: '10:00 AM', endTime: '11:00 AM' },
    ],
    'LWS-002': [{ subject: 'English', startTime: '11:00 AM', endTime: '12:00 PM' }],
  }

  it('renders one row per student with their missed subjects listed (formatted with time)', () => {
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
    // Comma-joined with time in parens, en-dash separator
    expect(screen.getByText(/Maths \(9:00 AM – 10:00 AM\).+Physics \(10:00 AM – 11:00 AM\)/)).toBeInTheDocument()
    expect(screen.getByText(/English \(11:00 AM – 12:00 PM\)/)).toBeInTheDocument()
  })

  it('confirm passes rows with the object-shaped subjects to onConfirm', () => {
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
          subjects: [
            expect.objectContaining({ subject: 'Maths',   startTime: '9:00 AM',  endTime: '10:00 AM' }),
            expect.objectContaining({ subject: 'Physics', startTime: '10:00 AM', endTime: '11:00 AM' }),
          ],
        }),
        expect.objectContaining({
          lwsId: 'LWS-002',
          name: 'Ravi Kumar',
          subjects: [expect.objectContaining({ subject: 'English' })],
        }),
      ]),
      ''
    )
  })

  it('accepts legacy string-only subjects without breaking display', () => {
    const legacy = { 'LWS-001': ['Maths', 'Physics'] }
    render(
      <LectureMissPreviewModal
        date="2026-05-21"
        absencesByLwsId={legacy}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />
    )
    // No times available → bare subjects joined
    expect(screen.getByText('Maths, Physics')).toBeInTheDocument()
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
