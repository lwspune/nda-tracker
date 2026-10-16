import { useMemo } from 'react'
import { buildPaperReport } from '../../lib/assignments/paperReport'

// A graded homework, as the student reads it (2026-10-16): the score, where
// the marks went, what to work on first, every question's comment, and their
// own pages with the grader's marks on them. Every number comes from
// buildPaperReport, the same builder the downloadable PDF is laid out from.
//
// The marked pages are the exact images the grader approved in
// grading:preview, so the page can never disagree with what was checked.

const fmt = n => String(Number(n))
const LINK_FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

function SectionTitle({ children }) {
  return <div className="text-[11px] font-bold uppercase tracking-wide text-ink-2">{children}</div>
}

function Summary({ r }) {
  const c = r.counts
  return (
    <div className="flex flex-col gap-1">
      <div className="text-ink-2">
        {r.pct}% · Full marks {c.full} · Part marks {c.partial} · No marks {c.zero} · Not attempted {c.notAttempted}
      </div>
      {r.potential.avoidable > 0 && (
        <p className="text-ink">
          Fix the slips in {r.potential.questions.join(', ')} and this is{' '}
          <span className="font-bold font-mono">{fmt(r.potential.marks)} / {fmt(r.max)}</span> ({r.potential.pct}%).
        </p>
      )}
    </div>
  )
}

// One series of magnitudes: a single hue, one bar per cause, the marks and
// questions written beside it, so no legend and no colour-only meaning.
function WhereMarksWent({ lost }) {
  const widest = Math.max(...lost.map(l => l.marks))
  return (
    <div className="flex flex-col gap-1.5">
      <SectionTitle>Where your marks went</SectionTitle>
      <ul aria-label="Where your marks went" className="flex flex-col gap-2">
        {lost.map(l => (
          <li key={l.key} className="flex flex-col gap-0.5" title={`${l.label}: ${fmt(l.marks)} mark${l.marks === 1 ? '' : 's'} (${l.questions.join(', ')})`}>
            <div className="flex items-baseline gap-2">
              <span className="font-semibold text-ink">{l.label}</span>
              <span className="ml-auto font-mono text-ink">−{fmt(l.marks)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-accent-soft" aria-hidden="true">
              <div className="h-1.5 rounded-full bg-accent" style={{ width: `${Math.max(3, (100 * l.marks) / widest)}%` }} />
            </div>
            <span className="text-[11.5px] text-ink-2">{l.questions.join(', ')}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Focus({ focus, smallerFixes }) {
  return (
    <div className="flex flex-col gap-1.5">
      {focus.length > 0 && (
        <>
          <SectionTitle>What to focus on</SectionTitle>
          <ul aria-label="What to focus on" className="flex flex-col gap-2">
            {focus.map(f => (
              <li key={f.label} className="rounded-lg border-l-[3px] border-accent bg-accent-soft px-3 py-2">
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold text-ink">{f.heading}</span>
                  <span className="ml-auto shrink-0 font-mono text-ink-2">{f.label} · −{fmt(f.lost)}</span>
                </div>
                {f.missing && <div className="text-ink-2">{f.missing}</div>}
              </li>
            ))}
          </ul>
        </>
      )}
      {smallerFixes.length > 0 && (
        <ul aria-label="Smaller fixes" className="flex flex-col divide-y divide-border">
          {smallerFixes.map(f => (
            <li key={f.cause} className="flex items-baseline gap-2 py-1.5">
              <span className="min-w-0">
                <span className="font-semibold text-ink">{f.heading}: </span>
                <span className="text-ink-2">{f.advice} {f.questions.join(', ')}</span>
              </span>
              <span className="ml-auto shrink-0 font-mono text-ink-2">−{fmt(f.marks)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Questions({ grades }) {
  return (
    <ul className="flex flex-col divide-y divide-border border border-border rounded-lg">
      {grades.map(g => (
        <li key={g.position} className="px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{g.label}</span>
            <span className="font-mono text-ink-2 ml-auto">
              {g.outcome === 'scored' ? `${g.awarded} / ${g.maxMarks}` : `— / ${g.maxMarks}`}
            </span>
          </div>
          {g.outcome !== 'scored' && <div className="text-ink-3">Not attempted</div>}
          {g.earned && (
            <div className="text-green-800">
              <span aria-hidden="true">✓ </span><span className="sr-only">Earned: </span><span>{g.earned}</span>
            </div>
          )}
          {g.missing && (
            <div className="text-red-800">
              <span aria-hidden="true">✗ </span><span className="sr-only">Missing: </span><span>{g.missing}</span>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

function MarkedPages({ pages, reportUrl }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SectionTitle>Your marked pages</SectionTitle>
        {reportUrl && (
          <a href={reportUrl} target="_blank" rel="noopener noreferrer" className={`btn btn-secondary btn-sm ml-auto ${LINK_FOCUS}`}>
            <span aria-hidden="true">⬇ </span>Download marked paper (PDF)
          </a>
        )}
      </div>
      <div className="flex flex-col gap-3">
        {pages.map((url, i) => (
          <a key={url} href={url} target="_blank" rel="noopener noreferrer" className={`block rounded-lg ${LINK_FOCUS}`}>
            <img src={url} alt={`Marked page ${i + 1} of ${pages.length}`} loading="lazy"
                 className="w-full rounded-lg border border-border" />
          </a>
        ))}
      </div>
      <p className="text-[11.5px] text-ink-3">Tap a page to open it full size.</p>
    </div>
  )
}

export default function MarkedPaperReport({ sub }) {
  const r = useMemo(() => buildPaperReport(sub.grades), [sub.grades])
  const pages = sub.markedPages ?? []
  return (
    <div className="flex flex-col gap-4 text-[12.5px]">
      <Summary r={r} />
      {r.lost.length > 0 && <WhereMarksWent lost={r.lost} />}
      {(r.focus.length > 0 || r.smallerFixes.length > 0) && <Focus focus={r.focus} smallerFixes={r.smallerFixes} />}
      <div className="flex flex-col gap-1">
        {sub.wentWell && <div><span className="font-semibold text-ink-2">What went well: </span>{sub.wentWell}</div>}
        {sub.nextSteps && <div><span className="font-semibold text-ink-2">What to work on: </span>{sub.nextSteps}</div>}
      </div>
      <Questions grades={sub.grades} />
      {pages.length > 0 && <MarkedPages pages={pages} reportUrl={sub.reportUrl} />}
      {sub.pagesRemoved && (
        <p className="text-ink-3">
          Your marked pages were removed 30 days after grading. The marks and comments above are kept.
        </p>
      )}
    </div>
  )
}
