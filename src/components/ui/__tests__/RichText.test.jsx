import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { RichText } from '../RichText'
import { Math } from '../Math'

const LF = String.fromCharCode(10)
const lines = (...l) => l.join(LF)

describe('RichText — the fast path', () => {
  // ~12,600 of 13,548 stored questions have no table. They must render exactly
  // as they did before this component existed, or swapping it into QuestionCard
  // changes how every question in the app looks.
  it('renders table-free text identically to a bare Math', () => {
    const text = 'the value of \\(x^2\\) is **large**'
    const withRich = render(<RichText>{text}</RichText>).container.innerHTML
    const withMath = render(<Math>{text}</Math>).container.innerHTML
    expect(withRich).toBe(withMath)
  })

  it('renders nothing for empty input', () => {
    expect(render(<RichText>{''}</RichText>).container.innerHTML).toBe('')
  })
})

describe('RichText — pipe tables', () => {
  const table = lines(
    'Consider the distribution:',
    '| x | 1 | 2 | 3 |',
    '|---|---|---|---|',
    '| f | 3 | 15 | 45 |',
    'What is the median?'
  )

  it('renders a real table, not a wall of pipes', () => {
    render(<RichText>{table}</RichText>)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader')).toHaveLength(4)
    expect(screen.getAllByRole('row')).toHaveLength(2)   // header + one data row
  })

  it('keeps the prose either side of the table', () => {
    const { container } = render(<RichText>{table}</RichText>)
    expect(container.textContent).toContain('Consider the distribution')
    expect(container.textContent).toContain('What is the median?')
  })

  it('renders maths inside cells', () => {
    const t = lines('| \\(x_i\\) | f |', '|---|---|', '| 1 | 2 |')
    const { container } = render(<RichText>{t}</RichText>)
    expect(container.innerHTML).toContain('katex')
  })
})

describe('RichText — what must NOT become a table', () => {
  it('leaves conditional probability alone', () => {
    const { container } = render(<RichText>{'Find P(A | B) given P(B) = 0.4'}</RichText>)
    expect(container.querySelector('table')).toBeNull()
    expect(container.textContent).toContain('P(A | B)')
  })

  it('leaves an absolute value inside maths alone', () => {
    const { container } = render(<RichText>{'Given \\(|A| = 2\\), find \\(|2A|\\)'}</RichText>)
    expect(container.querySelector('table')).toBeNull()
  })

  it('needs a separator row — pipes alone are not a table', () => {
    const { container } = render(<RichText>{lines('| a | b |', '| c | d |')}</RichText>)
    expect(container.querySelector('table')).toBeNull()
  })
})
