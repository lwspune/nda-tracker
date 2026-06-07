import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LoginPage from '../LoginPage'

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
    },
  },
}))

// Silence session-restore fetch attempts in jsdom
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in tests'))))

import { supabase } from '../../../lib/supabase'

const MOCK_STUDENT_DATA = {
  name: 'Arjun Sharma',
  lwsId: 'LWS001',
  profile: { branch: 'Pune', batches: ['LWS_NDA_2Y_(25-27)'], regDate: '2025-01-01' },
  exams: [],
  ndaFreqBySubject: {},
}

function renderLoginPage(props = {}) {
  return render(
    <LoginPage
      onTeacherLogin={vi.fn()}
      onStudentLogin={vi.fn()}
      {...props}
    />
  )
}

function mockFetchSuccess(data) {
  return { ok: true, json: () => Promise.resolve(data) }
}

function mockFetchError(status = 404, error = 'Not found') {
  return { ok: false, status, json: () => Promise.resolve({ error }) }
}

describe('LoginPage — Admin / Teacher tab (unified)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    global.fetch.mockRejectedValue(new Error('no network in tests'))
  })

  async function openStaffTab() {
    renderLoginPage()
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /admin.*teacher/i }))
  }

  it('shows a single "Admin / Teacher" tab (no separate Faculty tab)', async () => {
    renderLoginPage()
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /admin.*teacher/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Faculty$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Teacher$/i })).not.toBeInTheDocument()
  })

  it('shows email and password inputs in the staff tab', async () => {
    await openStaffTab()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
  })

  it('submit button is disabled when email or password is empty', async () => {
    await openStaffTab()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled()
  })

  it('calls signInWithPassword with the entered credentials', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({ data: { session: {} }, error: null })
    await openStaffTab()
    fireEvent.change(screen.getByLabelText(/email/i),    { target: { value: 'someone@lwspune.com' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'pass123' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'someone@lwspune.com',
      password: 'pass123',
    }))
  })

  it('shows error message on login failure', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: 'Invalid login credentials' },
    })
    await openStaffTab()
    fireEvent.change(screen.getByLabelText(/email/i),    { target: { value: 'wrong@example.com' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrongpass' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => expect(screen.getByText('Invalid login credentials')).toBeInTheDocument())
  })
})

describe('LoginPage — Student tab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    // Default: session restore fails (no stored session or fetch rejection)
    global.fetch.mockRejectedValue(new Error('no network in tests'))
  })

  it('shows mobile input and submit button by default', async () => {
    renderLoginPage()
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())
    expect(screen.getByPlaceholderText('98765 43210')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /View My Results/i })).toBeInTheDocument()
  })

  it('calls POST /api/student-login with the entered mobile', async () => {
    // No stored session → restore makes no fetch call; only 1 mock needed for the login
    global.fetch.mockResolvedValueOnce(mockFetchSuccess(MOCK_STUDENT_DATA))

    const onStudentLogin = vi.fn()
    renderLoginPage({ onStudentLogin })
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('98765 43210'), { target: { value: '9876543210' } })
    fireEvent.click(screen.getByRole('button', { name: /View My Results/i }))

    await waitFor(() => expect(onStudentLogin).toHaveBeenCalledWith(MOCK_STUDENT_DATA))
    expect(global.fetch).toHaveBeenCalledWith('/api/student-login',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('9876543210') })
    )
  })

  it('shows error when mobile is not found (404)', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchError(404, 'Mobile number not found'))

    renderLoginPage()
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('98765 43210'), { target: { value: '9999999999' } })
    fireEvent.click(screen.getByRole('button', { name: /View My Results/i }))

    await waitFor(() =>
      expect(screen.getByText(/Mobile number not found/i)).toBeInTheDocument()
    )
  })

  it('shows error on network failure during login', async () => {
    global.fetch.mockRejectedValueOnce(new Error('Network error'))

    renderLoginPage()
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('98765 43210'), { target: { value: '9876543210' } })
    fireEvent.click(screen.getByRole('button', { name: /View My Results/i }))

    await waitFor(() =>
      expect(screen.getByText(/Could not connect/i)).toBeInTheDocument()
    )
  })

  it('restores student session from localStorage by calling /api/student-login', async () => {
    localStorage.setItem('nda_student_session', JSON.stringify({
      lwsId: 'LWS001',
      name: 'Arjun Sharma',
      mobile: '9876543210',
      expiry: Date.now() + 999_999,
    }))
    global.fetch.mockResolvedValueOnce(mockFetchSuccess(MOCK_STUDENT_DATA))

    const onStudentLogin = vi.fn()
    renderLoginPage({ onStudentLogin })

    await waitFor(() => expect(onStudentLogin).toHaveBeenCalledWith(MOCK_STUDENT_DATA))
    expect(global.fetch).toHaveBeenCalledWith('/api/student-login',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('9876543210') })
    )
  })

  it('does not restore session if it is expired', async () => {
    localStorage.setItem('nda_student_session', JSON.stringify({
      lwsId: 'LWS001',
      name: 'Arjun Sharma',
      mobile: '9876543210',
      expiry: Date.now() - 1000,
    }))

    const onStudentLogin = vi.fn()
    renderLoginPage({ onStudentLogin })
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())

    expect(onStudentLogin).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText('98765 43210')).toBeInTheDocument()
  })
})

describe('LoginPage — Student tab sibling picker', () => {
  const PICKER_RESPONSE = {
    multiple: true,
    candidates: [
      { lwsId: 'LWS001', name: 'Arjun Sharma', branch: 'APJ', batches: ['APJ_NDA_12th_(26-27)'] },
      { lwsId: 'LWS002', name: 'Priya Sharma', branch: 'APJ', batches: ['APJ_NDA_11th_(26-27)_A'] },
    ],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    global.fetch.mockRejectedValue(new Error('no network in tests'))
  })

  it('shows a student picker when the number matches multiple students', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchSuccess(PICKER_RESPONSE))

    const onStudentLogin = vi.fn()
    renderLoginPage({ onStudentLogin })
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('98765 43210'), { target: { value: '9111111111' } })
    fireEvent.click(screen.getByRole('button', { name: /View My Results/i }))

    await waitFor(() => expect(screen.getByText('Arjun Sharma')).toBeInTheDocument())
    expect(screen.getByText('Priya Sharma')).toBeInTheDocument()
    // Did NOT log in yet — waiting for the user to choose
    expect(onStudentLogin).not.toHaveBeenCalled()
  })

  it('re-calls the endpoint with the chosen lwsId and logs in', async () => {
    global.fetch
      .mockResolvedValueOnce(mockFetchSuccess(PICKER_RESPONSE))
      .mockResolvedValueOnce(mockFetchSuccess({ ...MOCK_STUDENT_DATA, lwsId: 'LWS002', name: 'Priya Sharma' }))

    const onStudentLogin = vi.fn()
    renderLoginPage({ onStudentLogin })
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('98765 43210'), { target: { value: '9111111111' } })
    fireEvent.click(screen.getByRole('button', { name: /View My Results/i }))

    await waitFor(() => expect(screen.getByText('Priya Sharma')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Priya Sharma'))

    await waitFor(() => expect(onStudentLogin).toHaveBeenCalledWith(
      expect.objectContaining({ lwsId: 'LWS002' })
    ))
    // Second fetch carried the chosen lwsId
    expect(global.fetch).toHaveBeenLastCalledWith('/api/student-login',
      expect.objectContaining({ body: expect.stringContaining('LWS002') })
    )
  })

  it('lets the user go back to the number entry from the picker', async () => {
    global.fetch.mockResolvedValueOnce(mockFetchSuccess(PICKER_RESPONSE))

    renderLoginPage()
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('98765 43210'), { target: { value: '9111111111' } })
    fireEvent.click(screen.getByRole('button', { name: /View My Results/i }))

    await waitFor(() => expect(screen.getByText('Arjun Sharma')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /different number/i }))

    expect(screen.getByPlaceholderText('98765 43210')).toBeInTheDocument()
    expect(screen.queryByText('Arjun Sharma')).not.toBeInTheDocument()
  })
})
