import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = {
  studentProfiles: {},
}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

import LateNotificationPreviewModal from '../LateNotificationPreviewModal'

const PROFILES = {
  'Arjun Sharma': { name: 'Arjun Sharma', lwsId: 'LWS-001', mobile: '9876543210', parentMobiles: ['9876543211'] },
  'Ravi Kumar':   { name: 'Ravi Kumar',   lwsId: 'LWS-002', mobile: '9876543212', parentMobiles: [] },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStore.studentProfiles = PROFILES
})

describe('LateNotificationPreviewModal', () => {
  it('renders one row per late student with name, mobile, parent mobiles', () => {
    render(
      <LateNotificationPreviewModal
        date="2026-05-21"
        lateLwsIds={['LWS-001', 'LWS-002']}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('Arjun Sharma')).toBeInTheDocument()
    expect(screen.getByText('Ravi Kumar')).toBeInTheDocument()
    expect(screen.getByDisplayValue('9876543210')).toBeInTheDocument()
    expect(screen.getByDisplayValue('9876543211')).toBeInTheDocument()
  })

  it('shows the date in the header', () => {
    render(
      <LateNotificationPreviewModal
        date="2026-05-21"
        lateLwsIds={['LWS-001']}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText(/21 May 2026/)).toBeInTheDocument()
  })

  it('confirm passes edited rows to onConfirm', () => {
    const onConfirm = vi.fn()
    render(
      <LateNotificationPreviewModal
        date="2026-05-21"
        lateLwsIds={['LWS-001']}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />
    )
    // Edit mobile
    const mobile = screen.getByDisplayValue('9876543210')
    fireEvent.change(mobile, { target: { value: '8888888888' } })
    fireEvent.click(screen.getByRole('button', { name: /confirm send/i }))

    expect(onConfirm).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          lwsId: 'LWS-001',
          name: 'Arjun Sharma',
          mobile: '8888888888',
          parentMobiles: ['9876543211'],
        }),
      ]),
      '', // no redirect
    )
  })

  it('cancel calls onClose and does not call onConfirm', () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(
      <LateNotificationPreviewModal
        date="2026-05-21"
        lateLwsIds={['LWS-001']}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(onClose).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('redirect-to field overrides student mobiles in payload', () => {
    const onConfirm = vi.fn()
    render(
      <LateNotificationPreviewModal
        date="2026-05-21"
        lateLwsIds={['LWS-001']}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />
    )
    fireEvent.change(screen.getByLabelText(/redirect/i), { target: { value: '7777777777' } })
    fireEvent.click(screen.getByRole('button', { name: /confirm send/i }))
    expect(onConfirm).toHaveBeenCalledWith(expect.any(Array), '7777777777')
  })

  it('renders an empty state when lateLwsIds is empty', () => {
    render(
      <LateNotificationPreviewModal
        date="2026-05-21"
        lateLwsIds={[]}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText(/no students/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm send/i })).toBeDisabled()
  })
})
