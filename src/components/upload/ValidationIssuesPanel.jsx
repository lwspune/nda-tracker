import { getValidChapters } from '../../lib/validateTags'

// Props:
//   tagIssues   — array of { q, chapter, suggestion, type }
//   tagsSubject — string, e.g. 'Maths'
//   onAccept    — (q, suggestion) => void
//   onAcceptAll — () => void
export default function ValidationIssuesPanel({ tagIssues, tagsSubject, onAccept, onAcceptAll }) {
  const allSuggestable = tagIssues.length > 0 && tagIssues.every(i => i.suggestion)

  return (
    <div className="mb-4 border border-red-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-red-50 border-b border-red-200">
        <div className="flex items-center gap-2">
          <span className="text-danger font-bold text-[13px]">
            ❌ {tagIssues.length} chapter name issue{tagIssues.length > 1 ? 's' : ''} — fix to continue
          </span>
        </div>
        {allSuggestable && tagIssues.length > 1 && (
          <button
            onClick={onAcceptAll}
            className="text-[11px] font-bold text-accent bg-accent-soft border border-accent/25
                       px-3 py-1.5 rounded-lg hover:bg-accent hover:text-white transition-colors"
          >
            ✓ Accept All Suggestions
          </button>
        )}
      </div>

      {/* Issue rows */}
      <div className="divide-y divide-red-100">
        {tagIssues.map(issue => (
          <div key={issue.q} className="px-4 py-3 bg-white flex items-center gap-3 flex-wrap">
            <span className="font-mono font-bold text-[11px] text-ink-3 flex-shrink-0 w-8">
              Q{issue.q}
            </span>

            {/* Wrong name */}
            <span className="text-[12px] font-semibold text-danger bg-red-50
                             px-2 py-0.5 rounded border border-red-200">
              {issue.chapter || '(empty)'}
            </span>

            {issue.suggestion ? (
              <>
                <span className="text-ink-3 text-[11px]">→ Did you mean:</span>
                <span className="text-[12px] font-semibold text-success bg-green-50
                                 px-2 py-0.5 rounded border border-green-200">
                  {issue.suggestion}
                </span>
                <button
                  onClick={() => onAccept(issue.q, issue.suggestion)}
                  className="ml-auto text-[11px] font-bold text-accent bg-accent-soft
                             border border-accent/25 px-3 py-1 rounded-lg
                             hover:bg-accent hover:text-white transition-colors flex-shrink-0"
                >
                  Accept
                </button>
              </>
            ) : (
              <span className="text-[11px] text-ink-3 italic ml-1">
                No suggestion found — fix in Excel and re-upload
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Footer hint — only shown when the subject has a known chapter list */}
      {getValidChapters(tagsSubject).length > 0 && (
        <div className="px-4 py-2.5 bg-red-50 border-t border-red-100">
          <span className="text-[10.5px] text-danger/70">
            Valid chapters for <strong>{tagsSubject}</strong>: {getValidChapters(tagsSubject).join(' · ')}
          </span>
        </div>
      )}
    </div>
  )
}
