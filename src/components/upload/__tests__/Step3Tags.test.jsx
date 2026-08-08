import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Step3Tags from '../Step3Tags'

// The store is only read for `ndaFreqBySubject`. Deliberately seeded with the
// accreted junk list that caused the 2026-08-08 data loss, so these tests prove
// the taxonomy — not the config — now drives the control.
//
// STATE MUST BE HOISTED, not rebuilt inside the selector. Step3Tags' re-seed
// effect depends on `ndaFreqBySubject` by identity, so returning a fresh object
// per call re-fires it every render and hangs the run.
vi.mock('../../../store/useStore', () => {
  const state = {
    ndaFreqBySubject: {
      Physics: [{ chapter: 'Optics', pct: 5 }, { chapter: 'Nuclear Physics', pct: 4 }],
      English: [{ chapter: 'Grammar', pct: 5 }, { chapter: 'Articles', pct: 4 }],
    },
  }
  return { default: sel => sel(state) }
})

// Verbatim rows from Tags_NDA_GAT_Mock_W2.xlsx / _G1.xlsx — every one of these
// chapters was absent from the configured list and read as "needs tagging".
const GAT_TAGS = [
  { q: 1, subject: 'English', chapter: 'Cloze Test', subtopic: 'Word Selection in Passage' },
  { q: 2, subject: 'Physics', chapter: 'Light and Optics', subtopic: 'Prisms and Dispersion' },
  { q: 3, subject: 'Physics', chapter: 'Electricity and Magnetism', subtopic: 'Combination of Resistors' },
]

function renderGat(overrides = {}) {
  const onChange = vi.fn()
  const onNext = vi.fn()
  render(
    <Step3Tags
      state={{
        tags: GAT_TAGS, tagsSource: 'Tags file loaded',
        totalQs: 3, subject: 'GAT', answerKeys: null,
        ...overrides,
      }}
      onChange={onChange} onNext={onNext} onBack={vi.fn()}
    />
  )
  return { onChange, onNext }
}

const chapterInputs = () => screen.getAllByLabelText(/chapter for Q/i)
const subtopicInputs = () => screen.getAllByLabelText(/subtopic for Q/i)

describe('Step3Tags — a chapter outside the list stays visible', () => {
  it('renders every file chapter as its actual value, not blank', () => {
    // THE REGRESSION. A <select> whose value has no matching <option> displays
    // empty, so correct tags looked missing and were overwritten by hand.
    renderGat()
    expect(chapterInputs().map(i => i.value))
      .toEqual(['Cloze Test', 'Light and Optics', 'Electricity and Magnetism'])
  })

  it('passes the untouched file chapters straight through on confirm', () => {
    const { onChange } = renderGat()
    fireEvent.click(screen.getByRole('button', { name: /confirm tags/i }))
    expect(onChange).toHaveBeenCalledWith({
      tags: expect.arrayContaining([
        expect.objectContaining({ q: 1, chapter: 'Cloze Test' }),
        expect.objectContaining({ q: 2, chapter: 'Light and Optics' }),
        expect.objectContaining({ q: 3, chapter: 'Electricity and Magnetism' }),
      ]),
    })
  })

  it('reports the taxonomy-valid rows as tagged, not as needing attention', () => {
    renderGat()
    expect(screen.getByText(/all tagged/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /untagged/i })).not.toBeInTheDocument()
  })

  it('still shows a chapter that is in neither taxonomy nor config', () => {
    renderGat({
      tags: [{ q: 1, subject: 'Physics', chapter: 'Totally Made Up', subtopic: 'Whatever' }],
      totalQs: 1,
    })
    expect(chapterInputs()[0].value).toBe('Totally Made Up')
  })
})

describe('Step3Tags — the pickers offer the taxonomy', () => {
  it('offers the real chapters for the row subject', () => {
    renderGat()
    const listId = chapterInputs()[1].getAttribute('list')
    const opts = [...document.getElementById(listId).querySelectorAll('option')].map(o => o.value)
    expect(opts).toContain('Light and Optics')
    expect(opts).toContain('Electricity and Magnetism')
    expect(opts).not.toContain('Nuclear Physics') // accreted junk, not in taxonomy
  })

  it('scopes subtopic suggestions to the row chapter', () => {
    renderGat()
    const listId = subtopicInputs()[2].getAttribute('list')
    const opts = [...document.getElementById(listId).querySelectorAll('option')].map(o => o.value)
    expect(opts).toContain('Combination of Resistors')
    expect(opts).not.toContain('Prisms and Dispersion') // that's Light and Optics
  })

  it('accepts a subtopic that is not in the taxonomy — never forces a wrong pick', () => {
    // The whole defect in one sentence: being unable to enter the right value
    // is what makes someone enter a wrong one.
    const { onChange } = renderGat()
    fireEvent.change(subtopicInputs()[0], { target: { value: 'Brand New Subtopic' } })
    fireEvent.click(screen.getByRole('button', { name: /confirm tags/i }))
    expect(onChange).toHaveBeenCalledWith({
      tags: expect.arrayContaining([
        expect.objectContaining({ q: 1, subtopic: 'Brand New Subtopic' }),
      ]),
    })
  })
})

describe('Step3Tags — editing still works', () => {
  it('writes an edited chapter back', () => {
    const { onChange } = renderGat()
    fireEvent.change(chapterInputs()[0], { target: { value: 'Reading Comprehension' } })
    fireEvent.click(screen.getByRole('button', { name: /confirm tags/i }))
    expect(onChange).toHaveBeenCalledWith({
      tags: expect.arrayContaining([
        expect.objectContaining({ q: 1, chapter: 'Reading Comprehension' }),
      ]),
    })
  })

  it('clears the chapter when the row subject changes', () => {
    renderGat()
    const subjects = screen.getAllByLabelText(/subject for Q/i)
    fireEvent.change(subjects[0], { target: { value: 'Biology' } })
    expect(chapterInputs()[0].value).toBe('')
  })
})
