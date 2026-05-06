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

describe('LoginPage — Faculty tab', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows Faculty tab button', async () => {
    renderLoginPage()
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Faculty' })).toBeInTheDocument()
  })

  it('shows email and password inputs when Faculty tab is active', async () => {
    renderLoginPage()
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Faculty' }))

    expect(screen.getByPlaceholderText('official@example.com')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument()
  })

  it('calls signInWithPassword with entered credentials', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({ data: { session: {} }, error: null })

    renderLoginPage()
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Faculty' }))
    fireEvent.change(screen.getByPlaceholderText('official@example.com'), {
      target: { value: 'official.lwspune@gmail.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: 'LWSPune@123' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Faculty Login/i }))

    await waitFor(() =>
      expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'official.lwspune@gmail.com',
        password: 'LWSPune@123',
      })
    )
  })

  it('shows error message on login failure', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: 'Invalid login credentials' },
    })

    renderLoginPage()
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Faculty' }))
    fireEvent.change(screen.getByPlaceholderText('official@example.com'), {
      target: { value: 'wrong@example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: 'wrongpass' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Faculty Login/i }))

    await waitFor(() =>
      expect(screen.getByText('Invalid login credentials')).toBeInTheDocument()
    )
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
