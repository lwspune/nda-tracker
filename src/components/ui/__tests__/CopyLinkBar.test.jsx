import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import CopyLinkBar from '../CopyLinkBar'

const URL_ = 'https://nda-tracker.vercel.app/school-attendance'

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { vi.useRealTimers() })

describe('CopyLinkBar', () => {
  it('shows the label and the full url', () => {
    render(<CopyLinkBar label="Teacher link" url={URL_} />)
    expect(screen.getByText('Teacher link')).toBeInTheDocument()
    expect(screen.getByText(URL_)).toBeInTheDocument()
  })

  it('writes the url to the clipboard and confirms', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(<CopyLinkBar label="Teacher link" url={URL_} />)

    fireEvent.click(screen.getByRole('button', { name: /copy teacher link/i }))
    expect(writeText).toHaveBeenCalledWith(URL_)
    expect(await screen.findByText(/copied/i)).toBeInTheDocument()
  })

  it('falls back to a prompt when the clipboard is unavailable or blocked', async () => {
    // navigator.clipboard is undefined outside a secure context, and writeText
    // rejects when permission is denied. Neither may leave the user stuck with
    // no way to get the link.
    const prompt = vi.fn()
    vi.stubGlobal('prompt', prompt)
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    render(<CopyLinkBar label="Teacher link" url={URL_} />)

    fireEvent.click(screen.getByRole('button', { name: /copy teacher link/i }))
    await waitFor(() => expect(prompt).toHaveBeenCalledWith(expect.any(String), URL_))
  })

  it('opens the link in a new tab safely', () => {
    render(<CopyLinkBar label="Teacher link" url={URL_} />)
    const open = screen.getByRole('link', { name: /open teacher link/i })
    expect(open).toHaveAttribute('href', URL_)
    expect(open).toHaveAttribute('target', '_blank')
    expect(open).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('renders an optional hint', () => {
    render(<CopyLinkBar label="Teacher link" url={URL_} hint="Teachers file their own periods here." />)
    expect(screen.getByText(/teachers file their own periods here/i)).toBeInTheDocument()
  })
})
