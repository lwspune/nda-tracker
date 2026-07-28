import { useEffect, useId, useRef } from 'react'

// The shared dialog shell.
//
// Layout is header / scrolling body / OPTIONAL footer, and the footer is
// deliberately a slot rather than just the last child: with actions inside the
// scrolling body, a long list pushes Save below the fold and the only way to
// reach it is to scroll past a nested scroll container. Every hand-rolled modal
// in this codebase already separates its footer this way — this is that shape,
// shared. Consumers that pass no footer render exactly as before.
export default function ModalShell({ title, onClose, children, footer = null, wide = false }) {
  const titleId = useId()
  const panelRef = useRef(null)
  const returnFocusTo = useRef(null)

  // Escape closes. Bound to the document (not the panel) so it works before the
  // user has interacted with anything inside.
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Pull focus in on open, hand it back on close — otherwise focus stays on the
  // page behind the backdrop and a keyboard user is tabbing through content
  // they cannot see.
  useEffect(() => {
    returnFocusTo.current = document.activeElement
    panelRef.current?.focus()
    return () => {
      const el = returnFocusTo.current
      if (el && typeof el.focus === 'function' && document.contains(el)) el.focus()
    }
  }, [])

  return (
    <div
      data-testid="modal-backdrop"
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,18,45,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`bg-surface rounded-2xl shadow-xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} flex flex-col overflow-hidden focus:outline-none`}
        style={{ maxHeight: '85vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <h2 id={titleId} className="font-bold text-[15px]">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-ink-3 hover:text-ink text-lg leading-none rounded
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >✕</button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {children}
        </div>
        {footer && (
          <div data-modal-footer className="px-5 py-4 border-t border-border flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
