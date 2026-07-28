import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ModalShell from '../ModalShell'

describe('ModalShell — footer slot', () => {
  // The reason this slot exists: with actions inside the scrolling body, a long
  // list pushes Save below the fold. Every hand-rolled modal in this codebase
  // already puts its footer outside the scroll area; this brings ModalShell in
  // line so its 11 consumers get it too.
  it('renders footer content outside the scrolling body', () => {
    const { container } = render(
      <ModalShell title="T" onClose={vi.fn()} footer={<button>Save</button>}>
        <p>body</p>
      </ModalShell>
    )
    const save = screen.getByRole('button', { name: 'Save' })
    const scroller = container.querySelector('.overflow-y-auto')
    expect(scroller).toBeTruthy()
    expect(scroller.contains(save)).toBe(false)
    expect(scroller).toHaveTextContent('body')
  })

  it('keeps the footer from shrinking so it can never be scrolled away', () => {
    render(<ModalShell title="T" onClose={vi.fn()} footer={<button>Save</button>}>body</ModalShell>)
    const footer = screen.getByRole('button', { name: 'Save' }).closest('div')
    expect(footer.className).toContain('flex-shrink-0')
  })

  it('renders no footer element when none is passed', () => {
    // Additive: the consumers not yet migrated must render exactly as before.
    const { container } = render(<ModalShell title="T" onClose={vi.fn()}>body</ModalShell>)
    expect(container.querySelector('[data-modal-footer]')).toBeNull()
  })
})

describe('ModalShell — dialog semantics', () => {
  it('exposes itself as a modal dialog labelled by its title', () => {
    render(<ModalShell title="Mark attendance" onClose={vi.fn()}>body</ModalShell>)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('Mark attendance')
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<ModalShell title="T" onClose={onClose}>body</ModalShell>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores other keys', () => {
    const onClose = vi.fn()
    render(<ModalShell title="T" onClose={onClose}>body</ModalShell>)
    fireEvent.keyDown(document, { key: 'a' })
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('stops listening for Escape once unmounted', () => {
    const onClose = vi.fn()
    const { unmount } = render(<ModalShell title="T" onClose={onClose}>body</ModalShell>)
    unmount()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('still closes on backdrop click but not on a click inside the panel', () => {
    const onClose = vi.fn()
    render(<ModalShell title="T" onClose={onClose}><p>body</p></ModalShell>)
    fireEvent.click(screen.getByText('body'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('modal-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('moves focus into the dialog on open and restores it on close', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    expect(document.activeElement).toBe(opener)

    const { unmount } = render(<ModalShell title="T" onClose={vi.fn()}>body</ModalShell>)
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)

    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})
