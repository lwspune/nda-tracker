import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { homeworkNotifyKey } from '../../../lib/homework'

const mockStore = {
  studentProfiles: {},
  timetableMappings: [],
  setHomeworkDefaultersForItem: vi.fn(),
  getHomeworkForDate: vi.fn(),
  getOpenHomeworkForBatch: vi.fn(),
  resolveHomeworkItem: vi.fn(),
  homeworkSendHistory: {},
}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

import HomeworkLogTab from '../HomeworkLogTab'

const DATE = '2026-06-05'
const BATCH = 'B1'
const KEY = `${DATE}|${BATCH}`

const PROFILES = {
  'Arjun Sharma': { name: 'Arjun Sharma', lwsId: 'LWS-001', batches: [BATCH] },
}
const ROW = { id: 'r1', lws_id: 'LWS-001', date: DATE, subject: 'Maths', chapter: 'Trig', type: 'homework', resolved_at: null }

beforeEach(() => {
  vi.clearAllMocks()
  mockStore.studentProfiles = PROFILES
  mockStore.timetableMappings = []
  mockStore.homeworkSendHistory = {}
  mockStore.whatsappFlows = {}
  mockStore.getHomeworkForDate.mockResolvedValue([ROW])
  mockStore.getOpenHomeworkForBatch.mockResolvedValue([ROW])
  mockStore.setHomeworkDefaultersForItem.mockResolvedValue(true)
  mockStore.resolveHomeworkItem.mockResolvedValue(true)
})

describe('HomeworkLogTab — pending-aware send states', () => {
  it('shows the first-send button when no history exists', async () => {
    render(<HomeworkLogTab initialDate={DATE} initialBatch={BATCH} onSend={vi.fn()} />)
    await waitFor(() => expect(mockStore.getHomeworkForDate).toHaveBeenCalled())
    expect(await screen.findByRole('button', { name: /send homework notifications/i })).toBeInTheDocument()
  })

  it('shows "Notify N pending" when an item is not yet notified', async () => {
    mockStore.homeworkSendHistory = {
      [KEY]: { sentAt: Date.now(), sent: 1, skipped: 1, failedNames: ['Arjun Sharma'], notifiedItemKeys: [] },
    }
    render(<HomeworkLogTab initialDate={DATE} initialBatch={BATCH} onSend={vi.fn()} />)
    await waitFor(() => expect(mockStore.getHomeworkForDate).toHaveBeenCalled())
    expect(await screen.findByRole('button', { name: /notify 1 pending/i })).toBeInTheDocument()
  })

  it('shows "All notified · Resend all" once every item has been notified', async () => {
    mockStore.homeworkSendHistory = {
      [KEY]: {
        sentAt: Date.now(), sent: 1, skipped: 0, failedNames: [],
        notifiedItemKeys: [homeworkNotifyKey('LWS-001', 'Maths', 'Trig', 'homework')],
      },
    }
    render(<HomeworkLogTab initialDate={DATE} initialBatch={BATCH} onSend={vi.fn()} />)
    await waitFor(() => expect(mockStore.getHomeworkForDate).toHaveBeenCalled())
    expect(await screen.findByRole('button', { name: /all notified · resend all/i })).toBeInTheDocument()
  })
})

// ── Per-flow switch (Settings → WhatsApp) ────────────────────────────────────
describe('HomeworkLogTab — WhatsApp switch', () => {
  it('is enabled with an open item while the flow is on', async () => {
    render(<HomeworkLogTab initialDate={DATE} initialBatch={BATCH} onSend={vi.fn()} />)
    const btn = await screen.findByRole('button', { name: /send homework notifications/i })
    await waitFor(() => expect(btn).not.toBeDisabled())
  })

  it('disables the send button and says why when the homework flow is off', async () => {
    mockStore.whatsappFlows = { homework: { enabled: false } }
    const onSend = vi.fn()
    render(<HomeworkLogTab initialDate={DATE} initialBatch={BATCH} onSend={onSend} />)
    await waitFor(() => expect(mockStore.getHomeworkForDate).toHaveBeenCalled())
    const btn = await screen.findByRole('button', { name: /send homework notifications/i })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('title', expect.stringMatching(/switched off in Settings/))
    expect(screen.getByText(/homework \/ notes pending is switched off in settings/i)).toBeInTheDocument()
    fireEvent.click(btn)
    expect(onSend).not.toHaveBeenCalled()
  })
})
