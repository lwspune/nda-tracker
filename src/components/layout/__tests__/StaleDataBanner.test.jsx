import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import StaleDataBanner from '../StaleDataBanner'

const state = { saveConflict: false }
vi.mock('../../../store/useStore', () => ({
  default: selector => selector(state),
}))

describe('StaleDataBanner', () => {
  beforeEach(() => { state.saveConflict = false })

  it('renders nothing while saves are healthy', () => {
    const { container } = render(<StaleDataBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  it('announces the stale state and offers a reload when a save was rejected', () => {
    state.saveConflict = true
    render(<StaleDataBanner />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/out of date/i)
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument()
  })

  it('has no dismiss control — only a reload clears a stale tab', () => {
    state.saveConflict = true
    render(<StaleDataBanner />)

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveAccessibleName(/reload/i)
  })
})
