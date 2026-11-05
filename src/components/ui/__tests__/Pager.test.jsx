import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import Pager, { pageCount, pageSlice } from '../Pager'

describe('Pager', () => {
  it('renders nothing when everything fits on one page', () => {
    const { container } = render(<Pager page={0} totalPages={1} onPage={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('says where you are and pages with Newer / Older', () => {
    const onPage = vi.fn()
    render(<Pager page={1} totalPages={3} onPage={onPage} />)
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /newer/i }))
    fireEvent.click(screen.getByRole('button', { name: /older/i }))
    expect(onPage.mock.calls).toEqual([[0], [2]])
  })

  it('disables Newer on the first page and Older on the last', () => {
    const { rerender } = render(<Pager page={0} totalPages={2} onPage={() => {}} />)
    expect(screen.getByRole('button', { name: /newer/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /older/i })).toBeEnabled()
    rerender(<Pager page={1} totalPages={2} onPage={() => {}} />)
    expect(screen.getByRole('button', { name: /older/i })).toBeDisabled()
  })

  it('is a labelled navigation landmark', () => {
    render(<Pager page={0} totalPages={2} onPage={() => {}} label="Homework pages" />)
    expect(screen.getByRole('navigation', { name: 'Homework pages' })).toBeInTheDocument()
  })
})

describe('pageCount / pageSlice', () => {
  const items = Array.from({ length: 12 }, (_, i) => i)

  it('counts pages, never fewer than one', () => {
    expect(pageCount(12, 5)).toBe(3)
    expect(pageCount(0, 5)).toBe(1)
  })

  it('returns one page of items, clamping a page that no longer exists', () => {
    expect(pageSlice(items, 0, 5)).toEqual({ page: 0, rows: [0, 1, 2, 3, 4] })
    expect(pageSlice(items, 2, 5)).toEqual({ page: 2, rows: [10, 11] })
    // The list shrank under the open page (e.g. a reload): snap to the last one.
    expect(pageSlice(items, 9, 5)).toEqual({ page: 2, rows: [10, 11] })
  })
})
