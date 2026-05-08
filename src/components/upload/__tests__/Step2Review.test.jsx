// Tests for Step2Review subject normalization.
//
// The bug: when state.subject is set to a value not in SUBJECTS (e.g. "2"
// from a faulty Step1 detection), the <select> falls back to displaying
// the first option ("Maths") visually but the underlying React state
// remains the invalid value. The user sees "Maths" selected, doesn't
// interact with the dropdown, and the bad value flows through to the DB.
//
// Fix: Step2Review must normalize an invalid subject to a known one
// (calling onChange) on mount.

import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector({ studentProfiles: {} }),
}))

import Step2Review from '../Step2Review'

const baseState = {
  examName: 'Test', examDate: '2026-01-01',
  markCorrect: 4, markWrong: -1, totalQs: 100,
  students: [], hasNegative: true,
  detectedBatch: null, batchConfidence: 0,
  batchMatchedCount: 0, batchTotalCount: 0, batchCounts: null,
  tagsSource: null, batch: '', branch: '',
}

function renderWith(stateOverrides) {
  const onChange = vi.fn()
  render(
    <Step2Review
      state={{ ...baseState, ...stateOverrides }}
      onChange={onChange}
      onNext={() => {}}
      onBack={() => {}}
    />
  )
  return { onChange }
}

beforeEach(() => vi.clearAllMocks())

describe('Step2Review — subject normalization', () => {
  it('auto-corrects an invalid subject ("2") to Maths via onChange', () => {
    const { onChange } = renderWith({ subject: '2' })
    expect(onChange).toHaveBeenCalledWith({ subject: 'Maths' })
  })

  it('does not call onChange when subject is already valid (Maths)', () => {
    const { onChange } = renderWith({ subject: 'Maths' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not call onChange when subject is GAT', () => {
    const { onChange } = renderWith({ subject: 'GAT' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not call onChange when subject is undefined (will be displayed as Maths)', () => {
    // Undefined falls through to the `value={subject || 'Maths'}` default;
    // no need to mutate state.
    const { onChange } = renderWith({ subject: undefined })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('auto-corrects another bogus subject ("5") to Maths', () => {
    const { onChange } = renderWith({ subject: '5' })
    expect(onChange).toHaveBeenCalledWith({ subject: 'Maths' })
  })
})
