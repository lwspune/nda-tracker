import { Card } from '../../components/ui'
import { fmtDateShort } from '../../lib/dates'
import { isoToIstLocal } from '../../lib/assignments/editor'

const fmt = n => String(n)
// The deadline's calendar date in IST: dueAt is an instant, not a date.
const dueDay = iso => fmtDateShort(isoToIstLocal(iso).slice(0, 10))
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// Calculation errors across every graded homework (2026-10-24): the total, then
// one row per homework that had any, newest first. Tapping a row opens that
// homework's marks below. Numbers come from summariseCalculationErrors.
export default function CalculationErrorsCard({ summary, onOpen }) {
  if (!summary) return null
  const { lost, graded, withErrors, rows } = summary

  return (
    <section aria-label="Calculation errors across homeworks">
      <Card className="mb-3 flex flex-col gap-2">
        <div className="text-[14px] font-bold text-ink">Calculation errors across homeworks</div>
        {withErrors === 0 ? (
          <p className="text-[13px] text-ink-2">No calculation errors in your {plural(graded, 'graded homework', 'graded homeworks')}.</p>
        ) : (
          <>
            <p className="text-[13px] text-ink-2">
              <span className="font-bold font-mono text-ink">{fmt(lost)}</span> marks lost to calculation errors in{' '}
              {withErrors} of {plural(graded, 'graded homework', 'graded homeworks')}
            </p>
            <ul className="flex flex-col divide-y divide-border">
              {rows.map(r => (
                <li key={r.id}>
                  <button
                    className="w-full text-left py-2 flex flex-col gap-0.5 rounded hover:bg-accent-soft
                               focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                    onClick={() => onOpen(r.id)}
                  >
                    <span className="text-[13px] font-semibold text-ink">
                      {r.title} <span className="text-[11px] font-normal text-ink-3 font-mono">· {dueDay(r.dueAt)}</span>
                    </span>
                    <span className="text-[12px] text-ink-2">
                      {r.questions.join(', ')} · lost {fmt(r.lost)} ·{' '}
                      <span className="font-mono">{fmt(r.score)} / {fmt(r.max)}</span>, would be{' '}
                      <span className="font-mono font-semibold text-ink">{fmt(r.fixedScore)} / {fmt(r.max)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </section>
  )
}
