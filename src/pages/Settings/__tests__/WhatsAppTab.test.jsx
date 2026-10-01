import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = {
  whatsappFlows: {},
  setWhatsappFlowEnabled: vi.fn(),
}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

import WhatsAppTab from '../WhatsAppTab'
import { WHATSAPP_FLOWS } from '../../../lib/whatsappFlows'

beforeEach(() => {
  vi.clearAllMocks()
  mockStore.whatsappFlows = {}
})

const card = label => screen.getByRole('region', { name: label })

describe('WhatsAppTab', () => {
  it('lists every send flow as its own labelled section', () => {
    render(<WhatsAppTab />)
    for (const f of WHATSAPP_FLOWS) {
      expect(card(f.label)).toBeInTheDocument()
    }
    expect(screen.getAllByRole('switch')).toHaveLength(WHATSAPP_FLOWS.length)
  })

  it('shows every flow as on when nothing has been switched (absent = on)', () => {
    render(<WhatsAppTab />)
    for (const sw of screen.getAllByRole('switch')) {
      expect(sw).toHaveAttribute('aria-checked', 'true')
    }
  })

  it('renders what each flow sends, who gets it, and the template variable order', () => {
    render(<WhatsAppTab />)
    const late = within(card('Late to first lecture'))
    expect(late.getByText('Student and parents')).toBeInTheDocument()
    expect(late.getByText('Attendance page, Late widget')).toBeInTheDocument()
    expect(late.getByText('{{1}} name · {{2}} date')).toBeInTheDocument()
  })

  // The value is a secret held in Vercel; only its NAME belongs on screen.
  it('shows the env var name to set, never a value', () => {
    render(<WhatsAppTab />)
    expect(within(card('Late to first lecture')).getByText('WABRIDGE_LATE_TEMPLATE_ID')).toBeInTheDocument()
  })

  it('switches a flow off', () => {
    render(<WhatsAppTab />)
    fireEvent.click(within(card('Late to first lecture')).getByRole('switch'))
    expect(mockStore.setWhatsappFlowEnabled).toHaveBeenCalledWith('late', false)
  })

  it('switches an off flow back on', () => {
    mockStore.whatsappFlows = { homework: { enabled: false } }
    render(<WhatsAppTab />)
    const sw = within(card('Homework / notes pending')).getByRole('switch')
    expect(sw).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(sw)
    expect(mockStore.setWhatsappFlowEnabled).toHaveBeenCalledWith('homework', true)
  })

  it('says what "off" means on a switched-off card, and only there', () => {
    mockStore.whatsappFlows = { homework: { enabled: false } }
    render(<WhatsAppTab />)
    expect(within(card('Homework / notes pending')).getByText(/every send path refuses/i)).toBeInTheDocument()
    expect(within(card('Late to first lecture')).queryByText(/every send path refuses/i)).toBeNull()
  })

  it('flags the mentorship nudge as running on a live schedule', () => {
    render(<WhatsAppTab />)
    expect(within(card('Mentorship nudge')).getByText('Runs automatically')).toBeInTheDocument()
    expect(within(card('Hostel warden alert')).getByText('Schedule ready, not running')).toBeInTheDocument()
  })

  it('names each switch for screen readers', () => {
    render(<WhatsAppTab />)
    expect(screen.getByRole('switch', { name: 'Exam results WhatsApp messages' })).toBeInTheDocument()
  })

  it('jumps to the related Settings tab when one is given', () => {
    const onSwitchTab = vi.fn()
    render(<WhatsAppTab onSwitchTab={onSwitchTab} />)
    fireEvent.click(within(card('Mentorship nudge')).getByRole('button', { name: /mentorship tab/i }))
    expect(onSwitchTab).toHaveBeenCalledWith('mentorship')
  })
})
