import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ExportMenu from '../ExportMenu'

const items = () => ([
  { key: 'pdf', label: '📄 PDF', hint: 'class report, fixed layout', onSelect: vi.fn() },
  { key: 'word', label: '📝 Word', hint: 'editable equations', onSelect: vi.fn() },
])

describe('ExportMenu', () => {
  it('keeps the menu closed until asked', () => {
    render(<ExportMenu items={items()} />)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens on click and lists every item', () => {
    render(<ExportMenu items={items()} />)
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /PDF/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Word/ })).toBeTruthy()
  })

  it('runs the item and closes', async () => {
    const list = items()
    render(<ExportMenu items={list} />)
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Word/ }))
    expect(list[1].onSelect).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  // An unavailable export is ABSENT, not disabled (EXAM_REPORT_DOCX.md D5): a
  // greyed-out row invites "why can't I?" and there is no answer worth a
  // tooltip. The caller filters; this pins that nothing re-adds it.
  it('renders exactly the items it is given', () => {
    render(<ExportMenu items={[items()[0]]} />)
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    expect(screen.getAllByRole('menuitem')).toHaveLength(1)
    expect(screen.queryByText(/Word/)).toBeNull()
  })

  it('renders nothing at all when there is nothing to export', () => {
    const { container } = render(<ExportMenu items={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    render(<ExportMenu items={items()} />)
    const trigger = screen.getByRole('button', { name: /export/i })
    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })

  it('closes when the click lands outside', async () => {
    render(<><ExportMenu items={items()} /><div data-testid="elsewhere" /></>)
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    fireEvent.mouseDown(screen.getByTestId('elsewhere'))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  // Busy is PER ITEM: the three exports have three separate generating flags,
  // and a trigger-level spinner would claim all of them are running.
  it('shows a busy item as busy and refuses to re-run it', () => {
    const list = items()
    list[1].busy = true
    render(<ExportMenu items={list} />)
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    const word = screen.getByRole('menuitem', { name: /Generating/ })
    fireEvent.click(word)
    expect(list[1].onSelect).not.toHaveBeenCalled()
  })

  // An absolutely-positioned menu adds nothing to the document height, so on
  // the LAST card a downward menu can hang below everything the user is able to
  // scroll to — the Word item simply cannot be reached.
  it('opens upward when there is no room below', () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ bottom: 760, top: 716, left: 0, right: 0, width: 90, height: 44 })
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800)
    render(<ExportMenu items={items()} />)
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    expect(screen.getByRole('menu').dataset.drop).toBe('up')
    spy.mockRestore()
  })

  it('opens downward when there is room', () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ bottom: 120, top: 76, left: 0, right: 0, width: 90, height: 44 })
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800)
    render(<ExportMenu items={items()} />)
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    expect(screen.getByRole('menu').dataset.drop).toBe('down')
    spy.mockRestore()
  })

  // The exam card is `overflow-hidden` (it clips its inner rows' rounded
  // corners), so a menu rendered inside it is cut off at the card edge and the
  // Word item cannot be reached. It has to be portalled out.
  it('renders the menu outside its own container', () => {
    const { container } = render(<ExportMenu items={items()} />)
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    const menu = screen.getByRole('menu')
    expect(container.contains(menu)).toBe(false)
    expect(document.body.contains(menu)).toBe(true)
  })

  it('does not close when the click lands inside the menu footer', () => {
    render(<ExportMenu items={items()} footer={<input type="checkbox" aria-label="solutions" />} />)
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    fireEvent.mouseDown(screen.getByLabelText('solutions'))
    expect(screen.queryByRole('menu')).toBeTruthy()
  })

  it('marks the trigger as a menu button for assistive tech', () => {
    render(<ExportMenu items={items()} />)
    const trigger = screen.getByRole('button', { name: /export/i })
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
  })
})
