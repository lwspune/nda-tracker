// Tests for the answer-key mismatch resolver panel.
// Verifies each conflict is shown with both candidate keys, the current pick is
// marked, and choosing the other source fires onPick.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { it, expect, vi } from 'vitest'
import KeyMismatchPanel from '../KeyMismatchPanel'

const MISMATCHES = [
  { q: 17, storedAnswer: 'C', resultsAnswer: 'B' },
  { q: 33, storedAnswer: 'A', resultsAnswer: 'D' },
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

it('reflects an explicit choice of the stored key', () => {
  render(<KeyMismatchPanel mismatches={MISMATCHES} choices={{ 17: 'stored' }} onPick={vi.fn()} />)
  expect(screen.getByLabelText('Use Tags answer C for question 17')).toBeChecked()
  expect(screen.getByLabelText('Use Results answer B for question 17')).not.toBeChecked()
})

it('fires onPick with the chosen source when a candidate is selected', async () => {
  const onPick = vi.fn()
  render(<KeyMismatchPanel mismatches={MISMATCHES} choices={{}} onPick={onPick} />)
  await userEvent.click(screen.getByLabelText('Use Tags answer C for question 17'))
  expect(onPick).toHaveBeenCalledWith(17, 'stored')
})

it('renders nothing when there are no mismatches', () => {
  const { container } = render(<KeyMismatchPanel mismatches={[]} choices={{}} onPick={vi.fn()} />)
  expect(container).toBeEmptyDOMElement()
})

// The stored key's PROVENANCE differs by caller: a tags file on the upload wizard,
// but the PYQ Vault bank on a re-upload of a pushed paper. Defaulting to "Tags"
// keeps the wizard rendering exactly as before.
it('labels the stored key "Tags" by default', () => {
  render(<KeyMismatchPanel mismatches={MISMATCHES} choices={{}} onPick={vi.fn()} />)
  expect(screen.getByLabelText('Use Tags answer C for question 17')).toBeInTheDocument()
})

it('renames the stored chip via storedLabel, without touching the results chip', () => {
  render(<KeyMismatchPanel mismatches={MISMATCHES} choices={{}} onPick={vi.fn()} storedLabel="Bank" />)
  expect(screen.getByLabelText('Use Bank answer C for question 17')).toBeInTheDocument()
  expect(screen.getByLabelText('Use Results answer B for question 17')).toBeInTheDocument()
  expect(screen.queryByLabelText('Use Tags answer C for question 17')).not.toBeInTheDocument()
})

it('names both sources in the header so the conflict reads correctly on either path', () => {
  render(<KeyMismatchPanel mismatches={MISMATCHES} choices={{}} onPick={vi.fn()} storedLabel="Bank" />)
  expect(
    screen.getByText(/mismatches between the bank key and the results Excel/i)
  ).toBeInTheDocument()
})
