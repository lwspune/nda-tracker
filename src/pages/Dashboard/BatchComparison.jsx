import { Card, CardTitle, Badge } from '../../components/ui'
import { scoreColor } from '../../lib/analytics'

// Side-by-side per-batch metrics. `rows` is from getBatchComparison, already
// sorted worst-avg-first so the batch needing attention is on top.
export default function BatchComparison({ rows }) {
  if (!rows || rows.length <= 1) return null // nothing to compare with 0–1 batches

  return (
    <Card>
      <CardTitle>🏫 Batch Comparison</CardTitle>
      <p className="text-[11px] text-ink-3 mb-3">Worst average first. Each metric is scoped to that batch's students.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left border-b border-border">
              {['Batch', 'Students', 'Avg %', 'Projected', 'At-Risk'].map(h => (
                <th key={h} className="text-[10px] font-bold uppercase tracking-[1px] text-ink-3 pb-2 pr-4">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.batch} className="border-b border-border/50">
                <td className="py-2 pr-4 font-medium text-ink">{r.batch}</td>
                <td className="py-2 pr-4 font-mono text-ink-2">{r.students}</td>
                <td className={`py-2 pr-4 font-mono font-bold ${scoreColor(r.avgPct)}`}>
                  {(r.avgPct * 100).toFixed(0)}%
                </td>
                <td className="py-2 pr-4 font-mono text-ink-2">{r.projected}</td>
                <td className="py-2 pr-4">
                  {r.atRisk > 0 ? <Badge variant="red">{r.atRisk}</Badge> : <span className="text-ink-3 font-mono">0</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
