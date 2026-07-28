import { useEffect, useRef, useState } from 'react'

// A copyable capture link — the URL faculty hand to a teacher (/school-attendance)
// or the warden (/hostel-mess-attendance).
//
// Until now the only way to give someone that link was to know it by heart, so
// it sits on the tab that owns the flow. Copy behaviour mirrors the quiz-link
// button in pages/Quizzes: clipboard when it's available, a prompt when it
// isn't — navigator.clipboard is undefined outside a secure context and
// writeText rejects when permission is denied, and neither may leave faculty
// with no way to get the link out.
export default function CopyLinkBar({ label, url, hint = null }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])

  function handleCopy() {
    const fallback = () => window.prompt(`Copy this ${label.toLowerCase()}:`, url)
    const confirm = () => {
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1800)
    }
    const write = navigator.clipboard?.writeText(url)
    if (!write) return fallback()
    write.then(confirm, fallback)
  }

  return (
    <div className="card px-4 py-3 mb-4 flex items-center gap-3 flex-wrap">
      <span className="text-[11px] font-mono uppercase tracking-widest text-ink-3">{label}</span>
      <code className="text-[12px] font-mono text-ink-2 break-all">{url}</code>
      {hint && <span className="text-[11px] text-ink-3 italic basis-full">{hint}</span>}
      <div className="ml-auto flex items-center gap-1">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${label.toLowerCase()} in a new tab`}
          className="text-[12px] font-semibold text-ink-3 hover:text-accent min-h-[44px] px-2
                     inline-flex items-center rounded
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          Open
        </a>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={`Copy ${label.toLowerCase()}`}
          className="text-[12px] font-semibold text-accent hover:underline min-h-[44px] px-2 rounded
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {copied ? '✓ Copied' : '🔗 Copy'}
        </button>
      </div>
    </div>
  )
}
