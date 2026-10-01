import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = {
  whatsappFlows: {},
  timetableTeachers: [],
  studentProfiles: {},
  fetchMentorAssignments: vi.fn(),
  setMentorAssignment: vi.fn(),
  removeMentorAssignment: vi.fn(),
}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: null }))

import MentorshipTab from '../MentorshipTab'

beforeEach(() => {
  vi.clearAllMocks()
  mockStore.whatsappFlows = {}
  mockStore.fetchMentorAssignments.mockResolvedValue([])
})

// The nudge runs from a cron, so nothing on this page sends it — the switch in
// Settings → WhatsApp is what stops it. Preview and test send stay usable while
// it is off (they message no mentor and never advance the rotation), so they
// are left enabled and the page says the daily run is paused instead.
describe('MentorshipTab — WhatsApp switch', () => {
  it('says nothing about the switch while the nudge is on', async () => {
    render(<MentorshipTab />)
    await screen.findByText(/mentorship nudges/i)
    expect(screen.queryByText(/switched off/i)).toBeNull()
  })

  it('says the daily run is paused when the nudge is switched off', async () => {
    mockStore.whatsappFlows = { mentorNudge: { enabled: false } }
    render(<MentorshipTab />)
    expect(await screen.findByText(/mentorship nudge is switched off in settings/i)).toBeInTheDocument()
    expect(screen.getByText(/the daily run will skip until it is switched back on/i)).toBeInTheDocument()
  })

  it('keeps preview and test send usable while switched off', async () => {
    mockStore.whatsappFlows = { mentorNudge: { enabled: false } }
    render(<MentorshipTab />)
    expect(await screen.findByRole('button', { name: /preview today/i })).toBeEnabled()
  })
})
