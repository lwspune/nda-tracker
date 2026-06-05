import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { homeworkNotifyKey } from '../../../lib/homework'

const mockStore = {
  studentProfiles: {},
  bulkUpdateStudentContacts: vi.fn().mockResolvedValue({}),
}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

import HomeworkPreviewModal from '../HomeworkPreviewModal'

const PROFILES = {
  'Arjun Sharma': { name: 'Arjun Sharma', lwsId: 'LWS-001', mobile: '9876543210', parentMobiles: ['9876543211'] },
  'Ravi Kumar':   { name: 'Ravi Kumar',   lwsId: 'LWS-002', mobile: '9876543212', parentMobiles: [] },
}

const ITEMS = {
  'LWS-001': [{ subject: 'Maths', chapter: 'Trig', type: 'homework' }],
  'LWS-002': [{ subject: 'Physics', chapter: 'Laws', type: 'notes' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStore.studentProfiles = PROFILES
})

describe('HomeworkPreviewModal — pending-aware (item level)', () => {
  it('does not show the scope banner on a first send (notifiedItemKeys null)', () => {
    render(<HomeworkPreviewModal date="2026-06-05" itemsByLwsId={ITEMS} notifiedItemKeys={null} onConfirm={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByText(/pending only/i)).not.toBeInTheDocument()
    expect(screen.getByText('Arjun Sharma')).toBeInTheDocument()
    expect(screen.getByText('Ravi Kumar')).toBeInTheDocument()
  })

  it('defaults to pending-only and drops a fully-notified student', () => {
    const onConfirm = vi.fn()
    render(
      <HomeworkPreviewModal
        date="2026-06-05"
        itemsByLwsId={ITEMS}
        notifiedItemKeys={[homeworkNotifyKey('LWS-002', 'Physics', 'Laws', 'notes')]} // Ravi done
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByLabelText(/pending only.*1/i)).toBeChecked()
    expect(screen.getByText('Arjun Sharma')).toBeInTheDocument()
    expect(screen.queryByText('Ravi Kumar')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /confirm send/i }))
    const sent = onConfirm.mock.calls[0][0]
    expect(sent).toHaveLength(1)
    expect(sent[0].name).toBe('Arjun Sharma')
  })

  it('sends only the un-notified ITEMS of a partially-notified student', () => {
    const onConfirm = vi.fn()
    const items = {
      'LWS-001': [
        { subject: 'Maths', chapter: 'Trig', type: 'homework' },     // already notified
        { subject: 'Maths', chapter: 'Algebra', type: 'homework' },  // new → pending
      ],
    }
    render(
      <HomeworkPreviewModal
        date="2026-06-05"
        itemsByLwsId={items}
        notifiedItemKeys={[homeworkNotifyKey('LWS-001', 'Maths', 'Trig', 'homework')]}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /confirm send/i }))
    const sent = onConfirm.mock.calls[0][0]
    expect(sent).toHaveLength(1)
    expect(sent[0].items).toEqual([{ subject: 'Maths', chapter: 'Algebra', type: 'homework' }])
  })

  it('"All students" scope re-sends every item', () => {
    const onConfirm = vi.fn()
    render(
      <HomeworkPreviewModal
        date="2026-06-05"
        itemsByLwsId={ITEMS}
        notifiedItemKeys={[homeworkNotifyKey('LWS-002', 'Physics', 'Laws', 'notes')]}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />
    )
    fireEvent.click(screen.getByLabelText(/all students.*2/i))
    fireEvent.click(screen.getByRole('button', { name: /confirm send/i }))
    const sent = onConfirm.mock.calls[0][0]
    expect(sent).toHaveLength(2)
    expect(sent.find(r => r.name === 'Ravi Kumar').items).toHaveLength(1)
  })
})
