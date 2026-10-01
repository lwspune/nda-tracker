import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = {
  whatsappFlows: {},
  setWhatsappFlowEnabled: vi.fn(),
}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

// The configured badge asks the server (kind:'whatsapp-status'). `client` is
// swapped per test: null = no Supabase configured (local without env).
const supabaseMock = vi.hoisted(() => ({ client: null }))
vi.mock('../../../lib/supabase', () => ({
  get supabase() { return supabaseMock.client },
}))

import WhatsAppTab from '../WhatsAppTab'
import { WHATSAPP_FLOWS } from '../../../lib/whatsappFlows'

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  mockStore.whatsappFlows = {}
  supabaseMock.client = null
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

describe('WhatsAppTab — configured badge', () => {
  function signedIn() {
    supabaseMock.client = {
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) },
    }
  }
  function serverSays(body, ok = true) {
    const fetchSpy = vi.fn().mockResolvedValue({ ok, json: async () => body })
    vi.stubGlobal('fetch', fetchSpy)
    return fetchSpy
  }
  const ALL_OFF = {
    examResults: false, late: false, lectureMiss: false, examAbsence: false,
    homework: false, mentorNudge: false, hostelAlert: false,
  }

  it('asks the server with the admin session, and never for a value', async () => {
    signedIn()
    const fetchSpy = serverSays({ ok: true, shared: true, configured: ALL_OFF })
    render(<WhatsAppTab />)
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/send-attendance-alerts')
    expect(JSON.parse(init.body)).toEqual({ kind: 'whatsapp-status' })
    expect(init.headers.Authorization).toBe('Bearer tok')
  })

  it('marks a flow configured only when its template AND the shared credentials are set', async () => {
    signedIn()
    serverSays({ ok: true, shared: true, configured: { ...ALL_OFF, late: true } })
    render(<WhatsAppTab />)
    expect(await within(card('Late to first lecture')).findByText('Configured')).toBeInTheDocument()
    expect(within(card('Hostel warden alert')).getByText('Not configured')).toBeInTheDocument()
  })

  it('says credentials are missing when the template is set but the shared keys are not', async () => {
    signedIn()
    serverSays({ ok: true, shared: false, configured: { ...ALL_OFF, late: true } })
    render(<WhatsAppTab />)
    expect(await within(card('Late to first lecture')).findByText('Credentials missing')).toBeInTheDocument()
  })

  it('says status unknown, without asking, when there is no Supabase client', async () => {
    const fetchSpy = serverSays({})
    render(<WhatsAppTab />)
    expect(await within(card('Late to first lecture')).findByText('Status unknown')).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('says status unknown when the server refuses', async () => {
    signedIn()
    serverSays({ ok: false, error: 'Forbidden' }, false)
    render(<WhatsAppTab />)
    expect(await within(card('Late to first lecture')).findByText('Status unknown')).toBeInTheDocument()
  })

  it('says status unknown when the request throws', async () => {
    signedIn()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    render(<WhatsAppTab />)
    expect(await within(card('Late to first lecture')).findByText('Status unknown')).toBeInTheDocument()
  })
})
