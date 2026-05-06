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

function renderLoginPage(props = {}) {
  return render(
    <LoginPage
      onTeacherLogin={vi.fn()}
      onStudentLogin={vi.fn()}
      {...props}
    />
  )
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
