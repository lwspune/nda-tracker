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

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockStoreState = { studentProfiles: {}, syllabusBatches: [] }
vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStoreState),
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

function renderWith(stateOverrides, storeOverrides = {}) {
  mockStoreState = { studentProfiles: {}, syllabusBatches: [], ...storeOverrides }
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

// ── Branch auto-seed (dominant-branch default) ──────────────────────────────

const dominantProfiles = {
  ...Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [`s${i}`, { branch: 'LWS Pune' }])
  ),
  x: { branch: 'APJ' }, // 9/10 = 90% → LWS Pune dominates
}

const mixedProfiles = {
  a: { branch: 'LWS Pune' }, b: { branch: 'LWS Pune' }, c: { branch: 'LWS Pune' },
  d: { branch: 'APJ' }, e: { branch: 'APJ' },              // 3/5 = 60%, no dominant
}

function branchLabel() {
  return screen.getByText(
    (_content, el) =>
      el?.tagName === 'LABEL' &&
      el.className.includes('form-label') &&
      el.textContent.startsWith('Branch')
  )
}

describe('Step2Review — branch auto-seed', () => {
  it('seeds the dominant branch when state.branch is undefined', () => {
    const { onChange } = renderWith({ branch: undefined }, { studentProfiles: dominantProfiles })
    expect(onChange).toHaveBeenCalledWith({ branch: 'LWS Pune' })
  })

  it('does NOT seed when the roster has no ≥80% dominant branch', () => {
    const { onChange } = renderWith({ branch: undefined }, { studentProfiles: mixedProfiles })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does NOT seed when branch is "" (user explicitly cleared it)', () => {
    const { onChange } = renderWith({ branch: '' }, { studentProfiles: dominantProfiles })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does NOT seed when branch is already set to a value', () => {
    const { onChange } = renderWith({ branch: 'APJ' }, { studentProfiles: dominantProfiles })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does NOT seed when there are no student profiles', () => {
    const { onChange } = renderWith({ branch: undefined }, { studentProfiles: {} })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows the auto-filled badge when the branch equals the dominant', () => {
    renderWith({ branch: 'LWS Pune' }, { studentProfiles: dominantProfiles })
    expect(within(branchLabel()).getByText('auto-filled')).toBeInTheDocument()
  })

  it('does not show the auto-filled badge for a non-dominant branch', () => {
    renderWith({ branch: 'APJ' }, { studentProfiles: dominantProfiles })
    expect(within(branchLabel()).queryByText('auto-filled')).not.toBeInTheDocument()
  })
})

// ── Batch multi-select (central-only, comma-joined) ─────────────────────────

describe('Step2Review — batch multi-select', () => {
  it('renders one checkbox per central syllabus batch', () => {
    renderWith({}, { syllabusBatches: ['APJ_NDA_2Y_(26-28)', 'LWS_NDA_2Y_(26-28)_A'] })
    const group = screen.getByRole('group', { name: /batch/i })
    expect(within(group).getByLabelText('APJ_NDA_2Y_(26-28)')).toBeInTheDocument()
    expect(within(group).getByLabelText('LWS_NDA_2Y_(26-28)_A')).toBeInTheDocument()
  })

  it('does NOT source batches from studentProfiles (central list is the only source)', () => {
    renderWith({}, {
      syllabusBatches: ['APJ_NDA_2Y_(26-28)'],
      studentProfiles: { 'A': { name: 'A', batches: ['HR_Batch_Old'] } },
    })
    expect(screen.queryByLabelText('HR_Batch_Old')).not.toBeInTheDocument()
  })

  it('checking a single batch writes the bare name to state.batch (no comma)', async () => {
    const user = userEvent.setup()
    const { onChange } = renderWith({}, { syllabusBatches: ['APJ_NDA_2Y_(26-28)', 'LWS_X'] })
    await user.click(screen.getByLabelText('APJ_NDA_2Y_(26-28)'))
    expect(onChange).toHaveBeenLastCalledWith({ batch: 'APJ_NDA_2Y_(26-28)' })
  })

  it('checking two batches joins them with ", " in state.batch', async () => {
    const user = userEvent.setup()
    const { onChange } = renderWith(
      { batch: 'APJ_NDA_2Y_(26-28)' },
      { syllabusBatches: ['APJ_NDA_2Y_(26-28)', 'LWS_NDA_2Y_(26-28)_A'] },
    )
    await user.click(screen.getByLabelText('LWS_NDA_2Y_(26-28)_A'))
    expect(onChange).toHaveBeenLastCalledWith({ batch: 'APJ_NDA_2Y_(26-28), LWS_NDA_2Y_(26-28)_A' })
  })

  it('unchecking a batch removes it from the comma-joined string', async () => {
    const user = userEvent.setup()
    const { onChange } = renderWith(
      { batch: 'APJ_NDA_2Y_(26-28), LWS_NDA_2Y_(26-28)_A' },
      { syllabusBatches: ['APJ_NDA_2Y_(26-28)', 'LWS_NDA_2Y_(26-28)_A'] },
    )
    await user.click(screen.getByLabelText('APJ_NDA_2Y_(26-28)'))
    expect(onChange).toHaveBeenLastCalledWith({ batch: 'LWS_NDA_2Y_(26-28)_A' })
  })

  it('unchecking the last selected batch leaves state.batch empty', async () => {
    const user = userEvent.setup()
    const { onChange } = renderWith(
      { batch: 'APJ_NDA_2Y_(26-28)' },
      { syllabusBatches: ['APJ_NDA_2Y_(26-28)'] },
    )
    await user.click(screen.getByLabelText('APJ_NDA_2Y_(26-28)'))
    expect(onChange).toHaveBeenLastCalledWith({ batch: '' })
  })

  it('pre-selects checkboxes from existing comma-joined state.batch', () => {
    renderWith(
      { batch: 'APJ_NDA_2Y_(26-28), LWS_NDA_2Y_(26-28)_A' },
      { syllabusBatches: ['APJ_NDA_2Y_(26-28)', 'LWS_NDA_2Y_(26-28)_A', 'LWS_NDA_2Y_(25-27)_A'] },
    )
    expect(screen.getByLabelText('APJ_NDA_2Y_(26-28)')).toBeChecked()
    expect(screen.getByLabelText('LWS_NDA_2Y_(26-28)_A')).toBeChecked()
    expect(screen.getByLabelText('LWS_NDA_2Y_(25-27)_A')).not.toBeChecked()
  })

  it('shows empty-state when no central batches exist (no free-text fallback)', () => {
    renderWith({}, { syllabusBatches: [] })
    expect(screen.queryByRole('group', { name: /batch/i })).not.toBeInTheDocument()
    expect(screen.getByText(/Settings → Batches/i)).toBeInTheDocument()
  })
})
