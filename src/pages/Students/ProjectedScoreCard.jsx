import { Card, CardTitle } from '../../components/ui'
import { scoreBg } from '../../lib/analytics'

// Props: projected, primarySubject, subjectMaxScore
export default function ProjectedScoreCard({ projected, primarySubject, subjectMaxScore }) {
  return (
    <Card>
      <CardTitle>🎯 Projected NDA {primarySubject} Score</CardTitle>
      <div className="flex items-end gap-4 mb-4 flex-wrap">
        <div>
          <div className="text-[42px] font-extrabold tracking-tight leading-none"
               style={{ color: projected.total >= subjectMaxScore * 0.67 ? '#16a34a' : projected.total >= subjectMaxScore * 0.5 ? '#d97706' : projected.total >= subjectMaxScore * 0.33 ? '#f59e0b' : '#e03e3e' }}>
            {projected.total}
          </div>
          <div className="text-[12px] text-ink-3 mt-1">out of {subjectMaxScore}</div>
        </div>
        <div className="flex-1 pb-1">
          <div className="bg-surface-2 rounded-full h-3 overflow-hidden mb-1">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${Math.min((projected.total / subjectMaxScore) * 100, 100)}%`,
                background: projected.total >= subjectMaxScore * 0.67 ? '#16a34a' : projected.total >= subjectMaxScore * 0.5 ? '#d97706' : projected.total >= subjectMaxScore * 0.33 ? '#f59e0b' : '#e03e3e'
              }}
            />
          </div>
          <div className="flex justify-between text-[10px] font-mono text-ink-3 mt-1">
            <span>0</span>
            <span className="text-orange-400">{Math.round(subjectMaxScore * 0.33)} SSB</span>
            <span className="text-warning">{Math.round(subjectMaxScore * 0.5)} merit</span>
            <span className="text-success">{Math.round(subjectMaxScore * 0.67)} rank</span>
            <span>{subjectMaxScore}</span>
          </div>
        </div>
      </div>

      {/* Chapter breakdown — top opportunities */}
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-2">
          Biggest Opportunities — chapters with highest marks at stake
        </div>
        <div className="space-y-1.5">
          {projected.breakdown.slice(0, 6).map(ch => (
            <div key={ch.chapter} className="flex items-center gap-3">
              <div className="w-[100px] md:w-[140px] lg:w-[180px] text-[11px] text-ink-2 truncate flex-shrink-0">
                {ch.chapter}
              </div>
              <div className="flex-1 bg-surface-2 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${ch.marksAtStake > 0 ? (ch.projected / ch.marksAtStake) * 100 : 0}%`,
                    background: scoreBg(ch.accuracy || 0)
                  }}
                />
              </div>
              <div className="text-[11px] font-mono flex-shrink-0 text-right w-24">
                <span style={{ color: scoreBg(ch.accuracy || 0) }} className="font-bold">
                  {ch.projected.toFixed(1)}
                </span>
                <span className="text-ink-3"> / {ch.marksAtStake.toFixed(1)}</span>
              </div>
              {ch.accuracy === null && (
                <span className="text-[10px] text-ink-3 italic flex-shrink-0">not tested</span>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 text-[10px] text-ink-3 leading-relaxed">
          Based on your accuracy per chapter × NDA weightage. Edit weightages in Dashboard → NDA Frequency Table.
        </div>
      </div>
    </Card>
  )
}
