import { Card, CardTitle, Badge } from '../../components/ui'
import { scoreBg } from '../../lib/analytics'

// Weak × high-yield teaching priorities. `rows` is from getPriorityChapters,
// already sorted by priority desc. Each row crosses NDA chapter weightage with
// class accuracy so faculty can see what to teach next: high weight + low accuracy.
const TOP_N = 14

export default function PriorityChapters({ rows, subject, rootCauseByChapter = {} }) {
  const visible = (rows || []).slice(0, TOP_N)

  return (
    <Card>
      <CardTitle>🎯 Priority Chapters — Weak × High-Yield{subject ? ` · ${subject}` : ''}</CardTitle>
      <p className="text-[11px] text-ink-3 mb-3">
        Ranked by NDA weight × class weakness. The top rows are where teaching time buys the most marks.
      </p>
      {visible.length === 0 ? (
        <p className="text-[12px] text-ink-3 py-2">No weightage table for this subject — set one in Settings → NDA Weightage.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left border-b border-border">
                {['Chapter', 'NDA Weight', 'Class Accuracy', 'Priority'].map(h => (
                  <th key={h} className="text-[10px] font-bold uppercase tracking-[1px] text-ink-3 pb-2 pr-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(r => (
                <tr key={r.chapter} className="border-b border-border/50">
                  <td className="py-2 pr-4 font-medium text-ink">
                    {r.chapter}
                    {rootCauseByChapter[r.chapter] && (
                      <span className="block text-[10px] font-normal text-accent mt-0.5">
                        ↳ root cause: {rootCauseByChapter[r.chapter]}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 font-mono text-ink-2 whitespace-nowrap">
                    {r.weightPct.toFixed(1)}% <span className="text-ink-3">· {Math.round(r.marks)}m</span>
                  </td>
                  <td className="py-2 pr-4">
                    {r.tested ? (
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 bg-surface-3 rounded-full overflow-hidden">
                          <div className="h-full rounded-full"
                               style={{ width: `${(r.accuracy * 100).toFixed(0)}%`, background: scoreBg(r.accuracy) }} />
                        </div>
                        <span className="font-mono text-[10px] text-ink-2">{(r.accuracy * 100).toFixed(0)}%</span>
                        <span className="text-ink-3 text-[10px] font-mono">({r.correct}/{r.total})</span>
                      </div>
                    ) : (
                      <Badge variant="yellow">Not tested yet</Badge>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      <div className="w-12 h-1.5 bg-surface-3 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-danger"
                             style={{ width: `${Math.min(100, (r.priority / (visible[0].priority || 1)) * 100).toFixed(0)}%` }} />
                      </div>
                      <span className="font-mono text-[10px] text-ink-3">{r.priority.toFixed(1)}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > TOP_N && (
            <p className="text-[11px] text-ink-3 pt-2">+{rows.length - TOP_N} more weighted chapters</p>
          )}
        </div>
      )}
    </Card>
  )
}
