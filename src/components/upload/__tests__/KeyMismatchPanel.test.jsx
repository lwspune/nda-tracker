// Tests for the answer-key mismatch resolver panel.
// Verifies each conflict is shown with both candidate keys, the current pick is
// marked, and choosing the other source fires onPick.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { it, expect, vi } from 'vitest'
import KeyMismatchPanel from '../KeyMismatchPanel'

const MISMATCHES = [
  { q: 17, tagsAnswer: 'C', resultsAnswer: 'B' },
  { q: 33, tagsAnswer: 'A', resultsAnswer: 'D' },
]

it('renders every mismatch with both candidate letters', () => {
  render(<KeyMismatchPanel mismatches={MISMATCHES} choices={{}} onPick={vi.fn()} />)
  expect(screen.getByText(/2 answer-key mismatches/i)).toBeInTheDocument()
  expect(screen.getByLabelText('Use Results answer B for question 17')).toBeInTheDocument()
  expect(screen.getByLabelText('Use Tags answer C for question 17')).toBeInTheDocument()
  expect(screen.getByLabelText('Use Tags answer A for question 33')).toBeInTheDocument()
})

it('defaults the results key to selected when no choice is set', () => {
  render(<KeyMismatchPanel mismatches={MISMATCHES} choices={{}} onPick={vi.fn()} />)
  expect(screen.getByLabelText('Use Results answer B for question 17')).toBeChecked()
  expect(screen.getByLabelText('Use Tags answer C for question 17')).not.toBeChecked()
})

it('reflects an explicit choice of the tags key', () => {
  render(<KeyMismatchPanel mismatches={MISMATCHES} choices={{ 17: 'tags' }} onPick={vi.fn()} />)
  expect(screen.getByLabelText('Use Tags answer C for question 17')).toBeChecked()
  expect(screen.getByLabelText('Use Results answer B for question 17')).not.toBeChecked()
})

it('fires onPick with the chosen source when a candidate is selected', async () => {
  const onPick = vi.fn()
  render(<KeyMismatchPanel mismatches={MISMATCHES} choices={{}} onPick={onPick} />)
  await userEvent.click(screen.getByLabelText('Use Tags answer C for question 17'))
  expect(onPick).toHaveBeenCalledWith(17, 'tags')
})

it('renders nothing when there are no mismatches', () => {
  const { container } = render(<KeyMismatchPanel mismatches={[]} choices={{}} onPick={vi.fn()} />)
  expect(container).toBeEmptyDOMElement()
})
