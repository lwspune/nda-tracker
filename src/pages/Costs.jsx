import useStore from '../store/useStore'
import { PageHeader, EmptyState, Card, CardTitle, StatCard } from '../components/ui'

const PRICE_INPUT  = 3.00   // per million tokens
const PRICE_OUTPUT = 15.00  // per million tokens
const USD_TO_INR   = 84

export default function CostsPage() {
  const costLog = useStore(s => s.costLog)
  const clearCostLog = useStore(s => s.clearCostLog)

  if (!costLog.length) {
    return (
      <div>
        <PageHeader title="API Costs" sub="Track every Claude API call" />
        <EmptyState icon="💰" title="No API calls yet" sub="Costs appear after generating insights or plans with Claude API" />
      </div>
    )
  }

  const totalUSD = costLog.reduce((s, e) => s + (e.costUSD || 0), 0)
  const totalINR = totalUSD * USD_TO_INR
  const totalIn  = costLog.reduce((s, e) => s + (e.inputTokens || 0), 0)
  const totalOut = costLog.reduce((s, e) => s + (e.outputTokens || 0), 0)

  return (
    <div>
      <PageHeader
        title="API Costs"
        sub="Every Claude API call — tokens and cost"
        actions={
          <button onClick={() => confirm('Clear cost log?') && clearCostLog()} className="btn btn-danger btn-sm">
            🗑 Clear Log
          </button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-5 md:mb-6">
        <StatCard label="Total USD" value={`$${totalUSD.toFixed(4)}`} color="text-accent" />
        <StatCard label="Total INR" value={`₹${totalINR.toFixed(2)}`} color="text-warning" />
        <StatCard label="Input Tokens" value={totalIn.toLocaleString()} color="text-ink-2" />
        <StatCard label="Output Tokens" value={totalOut.toLocaleString()} color="text-ink-2" />
      </div>

      <Card>
        <CardTitle>Call Log</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left border-b border-border">
                {['Time', 'Action', 'Input Tokens', 'Output Tokens', 'Cost USD', 'Cost INR'].map(h => (
                  <th key={h} className="text-[10px] font-bold uppercase tracking-[1px] text-ink-3 pb-2 pr-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...costLog].reverse().map((entry, i) => (
                <tr key={i} className="border-b border-border/50 hover:bg-surface-2">
                  <td className="py-2 pr-4 font-mono text-ink-3 text-[11px]">
                    {new Date(entry.ts).toLocaleString('en-IN')}
                  </td>
                  <td className="py-2 pr-4 font-medium">{entry.action}</td>
                  <td className="py-2 pr-4 font-mono">{(entry.inputTokens || 0).toLocaleString()}</td>
                  <td className="py-2 pr-4 font-mono">{(entry.outputTokens || 0).toLocaleString()}</td>
                  <td className="py-2 pr-4 font-mono">${(entry.costUSD || 0).toFixed(4)}</td>
                  <td className="py-2 font-mono">₹{((entry.costUSD || 0) * USD_TO_INR).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
