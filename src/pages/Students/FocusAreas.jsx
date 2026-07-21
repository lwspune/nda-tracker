import { Card, CardTitle } from '../../components/ui'

// "Where to focus" — the actionable head of the diagnosis cluster. Turns the
// concept-graph analysis into two lists a student acts on:
//   • Start here      — weak chapters traced to their deepest weak prerequisite,
//                       each with a chapter-level Learn link (fix the foundation
//                       first) and, for Maths, a Practice link.
//   • Ready to learn  — the unlockable frontier (prereqs mastered).
// Shown to students (their own view) and faculty (viewing a student). Renders
// nothing when there's no signal, so callers can mount it unconditionally.
export default function FocusAreas({ startHere = [], readyToLearn = [] }) {
  if (!startHere.length && !readyToLearn.length) return null

  return (
    <Card>
      <CardTitle>📍 Where to focus</CardTitle>
      <p className="text-[11px] text-ink-3 mb-3">
        Your weak chapters traced back to the concepts they build on — fix the foundation first.
      </p>

      {startHere.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] font-bold uppercase tracking-[1px] text-ink-3 mb-1.5">Start here</p>
          <ul className="space-y-1.5">
            {startHere.map(s => (
              <li key={s.chapter} className="text-[12px] text-ink">
                <span className="font-semibold text-accent">{s.chapter}</span>
                {s.from.length > 0 && (
                  <span className="text-ink-3"> — your gaps in {s.from.join(', ')} trace back here</span>
                )}
                {s.learnUrl && (
                  <a
                    href={s.learnUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Learn ${s.chapter}`}
                    className="ml-1.5 text-accent underline underline-offset-2 whitespace-nowrap
                               focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                  >
                    Learn →
                  </a>
                )}
                {s.practiceUrl && (
                  <a
                    href={s.practiceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Practice ${s.chapter}`}
                    className="ml-1.5 text-accent underline underline-offset-2 whitespace-nowrap
                               focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                  >
                    Practice →
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {readyToLearn.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[1px] text-ink-3 mb-1.5">Ready to learn next</p>
          <p className="text-[12px] text-ink-2">{readyToLearn.slice(0, 6).join(' · ')}</p>
        </div>
      )}
    </Card>
  )
}
