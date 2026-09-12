import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// The exam card's download menu — PDF, Word, Student Reports.
//
// A menu rather than three more buttons: the card already carries Insights,
// Integrity, WhatsApp, Absent Alert, Update Results, Update Tags and Refresh
// from bank, and adding the Word export as a tenth control would have been the
// straw. This replaces two buttons with one (EXAM_REPORT_DOCX.md D5).
//
// Three rules worth keeping:
//
// - An unavailable export is ABSENT, not disabled. A written paper has no
//   per-question data, so its menu holds PDF alone; a greyed-out "Word" row
//   would only invite "why can't I?", and there is no answer worth a tooltip.
//   The caller filters the list — this renders what it is given, and renders
//   nothing at all when the list is empty.
// - Busy is PER ITEM. The three exports have three separate generating flags,
//   so a spinner on the trigger would claim all three were running.
// - The menu is PORTALLED to the body. The exam card is `overflow-hidden` (it
//   clips the rounded corners of its inner rows), so an absolutely-positioned
//   menu is simply cut off at the card edge — the Word item was unreachable on
//   every card until this was a portal. Portalling also sidesteps the sibling
//   stacking order when the menu opens upward over the card above.
const MENU_WIDTH = 260
const MENU_HEIGHT = 220   // estimate: three items + the solutions toggle
const GAP = 4

export default function ExportMenu({ items = [], footer = null, label = 'Export' }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onKey = e => {
      if (e.key !== 'Escape') return
      setOpen(false)
      // Focus goes back where it came from, or the keyboard user is stranded
      // at the top of the document.
      triggerRef.current?.focus()
    }
    const onDown = e => {
      // The menu is in a portal, so "inside" means either the trigger or the
      // menu — not a single wrapper. Missing the menu here would close it the
      // moment someone ticked the solutions checkbox.
      if (triggerRef.current?.contains(e.target)) return
      if (menuRef.current?.contains(e.target)) return
      setOpen(false)
    }
    // A portalled menu is positioned in viewport coordinates, so it does not
    // travel with the page. Close on scroll rather than leave it stranded.
    const onScroll = () => setOpen(false)

    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  if (!items.length) return null

  function toggle() {
    if (open) { setOpen(false); return }
    const r = triggerRef.current?.getBoundingClientRect()
    const up = !!r && r.bottom + MENU_HEIGHT > window.innerHeight
    setPos(r
      ? {
        up,
        left: Math.max(GAP, r.right - MENU_WIDTH),
        top: up ? undefined : r.bottom + GAP,
        bottom: up ? window.innerHeight - r.top + GAP : undefined,
      }
      : { up: false, left: GAP, top: GAP })
    setOpen(true)
  }

  const menu = open && pos && createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      data-drop={pos.up ? 'up' : 'down'}
      style={{
        position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom,
        width: MENU_WIDTH, zIndex: 60,
      }}
      className="rounded-lg border border-border bg-surface shadow-lg py-1"
    >
      {items.map(item => (
        <button
          key={item.key}
          role="menuitem"
          type="button"
          onClick={() => {
            if (item.busy) return
            setOpen(false)
            item.onSelect?.()
          }}
          aria-disabled={item.busy || undefined}
          className={`w-full text-left px-3 py-2 min-h-[44px] text-[12px] transition-colors
                      focus:outline-none focus-visible:bg-accent-soft
                      ${item.busy
                        ? 'text-ink-3 cursor-wait'
                        : 'text-ink hover:bg-accent-soft hover:text-accent'}`}
        >
          <span className="font-semibold">
            {item.busy ? '⏳ Generating…' : item.label}
          </span>
          {item.hint && !item.busy && (
            <span className="block text-[11px] text-ink-3 font-normal">{item.hint}</span>
          )}
        </button>
      ))}
      {/* An option that CHANGES an export lives beside it, not on the card. */}
      {footer && <div className="border-t border-border mt-1 pt-1">{footer}</div>}
    </div>,
    document.body,
  )

  return (
    <div className="relative flex-shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className="flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] rounded-lg text-[12px]
                   font-semibold border transition-all flex-shrink-0
                   bg-surface-2 text-ink-2 border-border
                   hover:bg-green-50 hover:text-green-700 hover:border-green-300
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        📄 {label} {open ? '▲' : '▼'}
      </button>
      {menu}
    </div>
  )
}
