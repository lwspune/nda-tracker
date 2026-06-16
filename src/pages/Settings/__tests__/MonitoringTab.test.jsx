import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = {
  monitorMobiles:    ['9021869427'],
  setMonitorMobiles: vi.fn(),
}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

import MonitoringTab from '../MonitoringTab'

beforeEach(() => {
  vi.clearAllMocks()
  mockStore.monitorMobiles = ['9021869427']
})

describe('MonitoringTab', () => {
  it('lists the configured monitoring numbers', () => {
    render(<MonitoringTab />)
    expect(screen.getByText('9021869427')).toBeInTheDocument()
    expect(screen.getByText(/Monitoring numbers \(1\)/)).toBeInTheDocument()
  })

  it('adds a normalised 10-digit number', () => {
    render(<MonitoringTab />)
    fireEvent.change(screen.getByPlaceholderText('10-digit mobile'), { target: { value: '+91 98765 43210' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(mockStore.setMonitorMobiles).toHaveBeenCalledWith(['9021869427', '9876543210'])
  })

  it('rejects a number that is not 10 digits', () => {
    render(<MonitoringTab />)
    fireEvent.change(screen.getByPlaceholderText('10-digit mobile'), { target: { value: '12345' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(mockStore.setMonitorMobiles).not.toHaveBeenCalled()
    expect(screen.getByText(/valid 10-digit/i)).toBeInTheDocument()
  })

  it('rejects a duplicate number already on the list', () => {
    render(<MonitoringTab />)
    fireEvent.change(screen.getByPlaceholderText('10-digit mobile'), { target: { value: '9021869427' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(mockStore.setMonitorMobiles).not.toHaveBeenCalled()
    expect(screen.getByText(/already on the list/i)).toBeInTheDocument()
  })

  it('removes a number', () => {
    render(<MonitoringTab />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove 9021869427' }))
    expect(mockStore.setMonitorMobiles).toHaveBeenCalledWith([])
  })

  it('shows an empty state when no numbers are configured', () => {
    mockStore.monitorMobiles = []
    render(<MonitoringTab />)
    expect(screen.getByText(/no monitoring copy/i)).toBeInTheDocument()
  })
})
