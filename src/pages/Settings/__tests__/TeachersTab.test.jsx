import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = {
  timetableTeachers:      [],
  addTimetableTeacher:    vi.fn(),
  updateTimetableTeacher: vi.fn(),
  deleteTimetableTeacher: vi.fn(),
  timetableMappings:      [],
  examSchedules:          [],
}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

const mockGetSession = vi.fn().mockResolvedValue({
  data: { session: { access_token: 'admin-jwt' } },
})

vi.mock('../../../lib/supabase', () => ({
  supabase: { auth: { getSession: () => mockGetSession() } },
}))

import TeachersTab from '../TeachersTab'

function makeFetch({ list = [], create, deleteResp, reset } = {}) {
  return vi.fn().mockImplementation(async (_url, init) => {
    const body = JSON.parse(init.body)
    if (body.action === 'list')   return jsonRes({ ok: true, emails: list })
    if (body.action === 'create') return jsonRes(create  ?? { ok: true, id: 'new-uid' })
    if (body.action === 'delete') return jsonRes(deleteResp ?? { ok: true })
    if (body.action === 'reset')  return jsonRes(reset   ?? { ok: true })
    return jsonRes({ ok: false, error: 'unhandled action' })
  })
}
function jsonRes(payload) { return { json: () => Promise.resolve(payload) } }

beforeEach(() => {
  vi.clearAllMocks()
  mockStore.timetableTeachers = []
  mockStore.timetableMappings = []
  mockStore.examSchedules     = []
  mockStore.addTimetableTeacher.mockReset()
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'admin-jwt' } } })
})

describe('TeachersTab — login badge', () => {
  it('fetches teacher auth emails on mount and shows "has login" badge for matching rows', async () => {
    mockStore.timetableTeachers = [
      { id: 't1', name: 'Navneet Sir', email: 'navneet@x.com' },
      { id: 't2', name: 'Akash Sir',   email: 'akash@x.com'   },
    ]
    vi.stubGlobal('fetch', makeFetch({ list: ['navneet@x.com'] }))
    render(<TeachersTab />)
    await waitFor(() => expect(screen.getByText(/has login/i)).toBeInTheDocument())
    // Only Navneet's row has the badge — Akash does not.
    const navneetRow = screen.getByText('Navneet Sir').closest('div')
    expect(navneetRow).toBeTruthy()
    expect(screen.queryAllByText(/has login/i)).toHaveLength(1)
  })

  it('matches emails case-insensitively', async () => {
    mockStore.timetableTeachers = [
      { id: 't1', name: 'Mixed Case Sir', email: 'Mixed@X.com' },
    ]
    vi.stubGlobal('fetch', makeFetch({ list: ['mixed@x.com'] }))
    render(<TeachersTab />)
    await waitFor(() => expect(screen.getByText(/has login/i)).toBeInTheDocument())
  })
})

describe('TeachersTab — per-row login controls', () => {
  it('shows Create login button when teacher has email but no auth account', async () => {
    mockStore.timetableTeachers = [{ id: 't1', name: 'New Sir', email: 'new@x.com' }]
    vi.stubGlobal('fetch', makeFetch({ list: [] }))
    render(<TeachersTab />)
    expect(await screen.findByRole('button', { name: /create login/i })).toBeInTheDocument()
  })

  it('shows Reset + Delete buttons when teacher has an auth account', async () => {
    mockStore.timetableTeachers = [{ id: 't1', name: 'Has Sir', email: 'has@x.com' }]
    vi.stubGlobal('fetch', makeFetch({ list: ['has@x.com'] }))
    render(<TeachersTab />)
    await waitFor(() => expect(screen.getByText(/has login/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /reset password/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete login/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^🔑 create login$/i })).not.toBeInTheDocument()
  })

  it('does NOT show any login controls when teacher has no email', async () => {
    mockStore.timetableTeachers = [{ id: 't1', name: 'No-email Sir', email: '' }]
    vi.stubGlobal('fetch', makeFetch({ list: [] }))
    render(<TeachersTab />)
    await waitFor(() => expect(screen.getByText(/Teachers \(1\)/)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /create login/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reset password/i })).not.toBeInTheDocument()
  })
})

describe('TeachersTab — create-login flow (per-row)', () => {
  it('opens inline password form, validates min length, then POSTs create with correct args', async () => {
    mockStore.timetableTeachers = [{ id: 't1', name: 'New Sir', email: 'new@x.com' }]
    const fetchMock = makeFetch({ list: [] })
    vi.stubGlobal('fetch', fetchMock)
    render(<TeachersTab />)

    const createBtn = await screen.findByRole('button', { name: /create login/i })
    fireEvent.click(createBtn)

    const pwInput = await screen.findByPlaceholderText(/password \(min 8/i)
    const submitBtn = screen.getByRole('button', { name: /^create$/i })
    expect(submitBtn).toBeDisabled()

    fireEvent.change(pwInput, { target: { value: 'short' } })
    expect(submitBtn).toBeDisabled() // < 8 chars

    fireEvent.change(pwInput, { target: { value: 'longenough1' } })
    expect(submitBtn).not.toBeDisabled()
    fireEvent.click(submitBtn)

    await waitFor(() => {
      // 1st call = list (mount), 2nd = create, 3rd = list (refresh)
      const createCalls = fetchMock.mock.calls.filter(([, init]) => JSON.parse(init.body).action === 'create')
      expect(createCalls).toHaveLength(1)
      expect(JSON.parse(createCalls[0][1].body)).toEqual({
        action: 'create', email: 'new@x.com', password: 'longenough1', name: 'New Sir',
      })
    })
    // After success: list is refreshed
    await waitFor(() => {
      const listCalls = fetchMock.mock.calls.filter(([, init]) => JSON.parse(init.body).action === 'list')
      expect(listCalls.length).toBeGreaterThanOrEqual(2)
    })
  })

  it('surfaces endpoint error inline and does not refresh on failure', async () => {
    mockStore.timetableTeachers = [{ id: 't1', name: 'Dup Sir', email: 'dup@x.com' }]
    const fetchMock = makeFetch({ list: [], create: { ok: false, error: 'User already registered' } })
    vi.stubGlobal('fetch', fetchMock)
    render(<TeachersTab />)

    fireEvent.click(await screen.findByRole('button', { name: /create login/i }))
    fireEvent.change(screen.getByPlaceholderText(/password \(min 8/i), { target: { value: 'longenough1' } })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    expect(await screen.findByText(/already registered/i)).toBeInTheDocument()
    // List was called once on mount only (no refresh on failure)
    const listCalls = fetchMock.mock.calls.filter(([, init]) => JSON.parse(init.body).action === 'list')
    expect(listCalls).toHaveLength(1)
  })
})

describe('TeachersTab — delete-login flow', () => {
  it('confirms then POSTs delete and refreshes the list', async () => {
    mockStore.timetableTeachers = [{ id: 't1', name: 'Bye Sir', email: 'bye@x.com' }]
    const fetchMock = makeFetch({ list: ['bye@x.com'] })
    vi.stubGlobal('fetch', fetchMock)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<TeachersTab />)

    fireEvent.click(await screen.findByRole('button', { name: /delete login/i }))
    expect(confirmSpy).toHaveBeenCalled()

    await waitFor(() => {
      const deleteCalls = fetchMock.mock.calls.filter(([, init]) => JSON.parse(init.body).action === 'delete')
      expect(deleteCalls).toHaveLength(1)
      expect(JSON.parse(deleteCalls[0][1].body)).toEqual({ action: 'delete', email: 'bye@x.com' })
    })
    confirmSpy.mockRestore()
  })

  it('aborts if user cancels confirm dialog', async () => {
    mockStore.timetableTeachers = [{ id: 't1', name: 'Bye Sir', email: 'bye@x.com' }]
    const fetchMock = makeFetch({ list: ['bye@x.com'] })
    vi.stubGlobal('fetch', fetchMock)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<TeachersTab />)

    fireEvent.click(await screen.findByRole('button', { name: /delete login/i }))
    expect(confirmSpy).toHaveBeenCalled()
    const deleteCalls = fetchMock.mock.calls.filter(([, init]) => JSON.parse(init.body).action === 'delete')
    expect(deleteCalls).toHaveLength(0)
    confirmSpy.mockRestore()
  })
})

describe('TeachersTab — reset-password flow', () => {
  it('POSTs reset with newPassword and refreshes', async () => {
    mockStore.timetableTeachers = [{ id: 't1', name: 'Reset Sir', email: 'reset@x.com' }]
    const fetchMock = makeFetch({ list: ['reset@x.com'] })
    vi.stubGlobal('fetch', fetchMock)
    render(<TeachersTab />)

    fireEvent.click(await screen.findByRole('button', { name: /reset password/i }))
    const pwInput = await screen.findByPlaceholderText(/password \(min 8/i)
    fireEvent.change(pwInput, { target: { value: 'brandnewpw1' } })
    fireEvent.click(screen.getByRole('button', { name: /^reset$/i }))

    await waitFor(() => {
      const resetCalls = fetchMock.mock.calls.filter(([, init]) => JSON.parse(init.body).action === 'reset')
      expect(resetCalls).toHaveLength(1)
      expect(JSON.parse(resetCalls[0][1].body)).toEqual({
        action: 'reset', email: 'reset@x.com', newPassword: 'brandnewpw1',
      })
    })
  })
})

describe('TeachersTab — Add Teacher with inline Create-login checkbox', () => {
  it('only adds local row when checkbox is unchecked', async () => {
    vi.stubGlobal('fetch', makeFetch({ list: [] }))
    render(<TeachersTab />)
    await waitFor(() => expect(screen.getByText(/Teachers \(0\)/)).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText(/^Name/), { target: { value: 'New Sir' } })
    fireEvent.change(screen.getByPlaceholderText(/Email address \(used/), { target: { value: 'new@x.com' } })
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }))

    expect(mockStore.addTimetableTeacher).toHaveBeenCalledWith('New Sir', 'new@x.com')
    const createCalls = fetch.mock.calls.filter(([, init]) => JSON.parse(init.body).action === 'create')
    expect(createCalls).toHaveLength(0)
  })

  it('adds local row AND calls create when checkbox is checked', async () => {
    vi.stubGlobal('fetch', makeFetch({ list: [] }))
    render(<TeachersTab />)
    await waitFor(() => expect(screen.getByText(/Teachers \(0\)/)).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText(/^Name/), { target: { value: 'New Sir' } })
    fireEvent.change(screen.getByPlaceholderText(/Email address \(used/), { target: { value: 'new@x.com' } })
    fireEvent.click(screen.getByLabelText(/Also create a login account/i))
    fireEvent.change(screen.getByPlaceholderText(/Password \(min 8/), { target: { value: 'longenough1' } })
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }))

    expect(mockStore.addTimetableTeacher).toHaveBeenCalledWith('New Sir', 'new@x.com')
    await waitFor(() => {
      const createCalls = fetch.mock.calls.filter(([, init]) => JSON.parse(init.body).action === 'create')
      expect(createCalls).toHaveLength(1)
      expect(JSON.parse(createCalls[0][1].body)).toEqual({
        action: 'create', email: 'new@x.com', password: 'longenough1', name: 'New Sir',
      })
    })
  })

  it('shows error when checkbox is checked but email is missing', async () => {
    vi.stubGlobal('fetch', makeFetch({ list: [] }))
    render(<TeachersTab />)
    await waitFor(() => expect(screen.getByText(/Teachers \(0\)/)).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText(/^Name/), { target: { value: 'New Sir' } })
    fireEvent.click(screen.getByLabelText(/Also create a login account/i))
    fireEvent.change(screen.getByPlaceholderText(/Password \(min 8/), { target: { value: 'longenough1' } })
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }))

    // Local teacher is still added, but the create call is skipped with an inline error.
    expect(mockStore.addTimetableTeacher).toHaveBeenCalled()
    expect(await screen.findByText(/email is required/i)).toBeInTheDocument()
    const createCalls = fetch.mock.calls.filter(([, init]) => JSON.parse(init.body).action === 'create')
    expect(createCalls).toHaveLength(0)
  })
})
