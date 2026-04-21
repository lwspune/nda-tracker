import useStore from '../store/useStore'
import { PageHeader, EmptyState, Card, CardTitle, Badge } from '../components/ui'

export default function InsightsPage() {
  const exams = useStore(s => s.exams)
  const savedInsights = useStore(s => s.savedInsights)
  const clearClassReport = useStore(s => s.clearClassReport)

  if (!exams.length) {
    return (
      <div>
        <PageHeader title="Insights" sub="AI-generated analysis and improvement plans" />
        <EmptyState icon="🧠" title="No data yet" sub="Add exams first, then import insights via JSON" />
      </div>
    )
  }

  const cr = savedInsights.classReport
  const plans = Object.entries(savedInsights.studentPlans || {})

  return (
    <div>
      <PageHeader title="Insights" sub="AI-generated class report and student plans" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
        {/* Class report */}
        <Card>
          <CardTitle>📋 Class Report</CardTitle>
          {cr ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <Badge variant="green">✅ {new Date(cr.generatedAt).toLocaleDateString('en-IN')}</Badge>
                <button onClick={clearClassReport} className="text-[11px] text-ink-3 hover:text-danger">🗑 Clear</button>
              </div>
              <div className="bg-surface-2 border border-border rounded-xl p-4 text-[13px]
                              leading-relaxed whitespace-pre-wrap font-sans max-h-[500px] overflow-y-auto">
                {cr.text}
              </div>
            </>
          ) : (
            <p className="text-[12px] text-ink-3 leading-relaxed">
              No report saved. Export your data → upload to Claude → ask for a class report → import the enriched JSON.
            </p>
          )}
        </Card>

        {/* Student plans */}
        <Card>
          <CardTitle>🎯 Student Plans ({plans.length})</CardTitle>
          {plans.length === 0 ? (
            <p className="text-[12px] text-ink-3 leading-relaxed">
              No plans saved. Export your data → upload to Claude → ask for student plans → import the enriched JSON.
            </p>
          ) : (
            <div className="space-y-4 max-h-[50vh] md:max-h-[600px] overflow-y-auto pr-1">
              {plans.map(([name, data]) => (
                <div key={name}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-bold text-[13px] text-accent">{name}</span>
                    <span className="text-[10px] font-mono text-ink-3">
                      {new Date(data.generatedAt).toLocaleDateString('en-IN')}
                    </span>
                  </div>
                  <div className="bg-surface-2 border border-border rounded-xl p-3 text-[12px]
                                  leading-relaxed whitespace-pre-wrap max-h-[30vh] md:max-h-[200px] overflow-y-auto font-sans">
                    {data.text}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
