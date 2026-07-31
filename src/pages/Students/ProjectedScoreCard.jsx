import { useState } from 'react'
import { Card, CardTitle } from '../../components/ui'
import { scoreBg } from '../../lib/analytics'

const TOP_N = 10

// One opportunity row — a chapter or a subtopic. `label` is the headline, `sub`
// the muted qualifier under it (a subtopic's parent chapter; nothing for a
// chapter row). Untested rows carry the same italic marker at both levels, so
// "no data" never reads as "scored zero".
function OpportunityRow({ label, sub, projected, marksAtStake, accuracy }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-[100px] md:w-[140px] lg:w-[180px] flex-shrink-0 min-w-0">
        <div className="text-[11px] text-ink-2 truncate" title={label}>{label}</div>
        {sub && <div className="text-[9px] text-ink-3 truncate" title={sub}>{sub}</div>}
      </div>
      <div className="flex-1 bg-surface-2 rounded-full h-2 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${marksAtStake > 0 ? (projected / marksAtStake) * 100 : 0}%`,
            background: scoreBg(accuracy || 0)
          }}
        />
      </div>
      <div className="text-[11px] font-mono flex-shrink-0 text-right w-24">
        <span style={{ color: scoreBg(accuracy || 0) }} className="font-bold">
          {projected.toFixed(1)}
        </span>
        <span className="text-ink-3"> / {marksAtStake.toFixed(1)}</span>
      </div>
      {accuracy === null && (
        <span className="text-[10px] text-ink-3 italic flex-shrink-0">not tested</span>
      )}
    </div>
  )
}

// Props: projected, primarySubject, subjectMaxScore, showScore
// `projected.subtopicBreakdown` is present only when computeProjectedScore was
// called with { withSubtopics: true } AND the subject has a subtopic taxonomy
// (Maths only today) — its absence hides the toggle rather than disabling it.
//
// showScore=false is the STUDENT variant: the opportunity rows stay (including
// their per-row marks — "Statistics is worth 22 and you are weak there" is a
// diagnosis a student can act on) but the headline total and its SSB/merit/rank
// scale are withheld. That number is a prediction about the student's own exam
// and the weakest part of the model: a chapter's accuracy is extrapolated across
// subtopics they have never been tested on. Fine as faculty triage, not a fact
// to hand a candidate. The card is also retitled, since a card called
// "Projected NDA Score" that shows no score reads as a bug.
export default function ProjectedScoreCard({ projected, primarySubject, subjectMaxScore, showScore = true }) {
  const [view, setView]     = useState('chapters')
  const [showAll, setShowAll] = useState(false)

  const subtopics    = projected.subtopicBreakdown || []
  const hasSubtopics = subtopics.length > 0
  const bySubtopic   = hasSubtopics && view === 'subtopics'
  const rows         = bySubtopic ? subtopics : projected.breakdown
  const visible      = bySubtopic
    ? (showAll ? rows : rows.slice(0, TOP_N))
    : rows.slice(0, 6)
  const uncovered    = projected.subtopicsUncovered || []

  return (
    <Card>
      <CardTitle>
        {showScore
          ? `🎯 Projected NDA ${primarySubject} Score`
          : `🎯 NDA ${primarySubject} — Where Your Marks Are`}
      </CardTitle>
      {showScore && (
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
      )}

      {/* Top opportunities — chapters, or a flat cross-chapter subtopic ranking */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
          <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3">
            Biggest Opportunities — {bySubtopic ? 'subtopics' : 'chapters'} with highest marks at stake
          </div>
          {hasSubtopics && (
            <div className="flex gap-1 flex-shrink-0" role="group" aria-label="Breakdown level">
              {['chapters', 'subtopics'].map(v => (
                <button
                  key={v}
                  onClick={() => { setView(v); setShowAll(false) }}
                  aria-pressed={view === v}
                  className={`text-[10px] px-2 py-0.5 rounded-full border capitalize transition-colors ${
                    view === v
                      ? 'bg-ink text-surface border-ink'
                      : 'border-border text-ink-3 hover:text-ink-2'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          {visible.map(r => (
            <OpportunityRow
              key={bySubtopic ? r.subtopic : r.chapter}
              label={bySubtopic ? r.subtopic : r.chapter}
              sub={bySubtopic ? r.chapter : null}
              projected={r.projected}
              marksAtStake={r.marksAtStake}
              accuracy={r.accuracy}
            />
          ))}
        </div>

        {bySubtopic && rows.length > TOP_N && (
          <button
            onClick={() => setShowAll(s => !s)}
            className="mt-2 text-[10px] text-accent hover:underline"
          >
            {showAll ? `Show top ${TOP_N}` : `Show all ${rows.length}`}
          </button>
        )}

        <div className="mt-3 text-[10px] text-ink-3 leading-relaxed">
          {bySubtopic
            ? <>Ranked across every chapter by marks recoverable — your accuracy per subtopic × its share of the chapter × NDA weightage.</>
            : <>Based on your accuracy per chapter × NDA weightage.{showScore && <> Edit weightages in Settings → NDA Weightage.</>}</>}
          {bySubtopic && uncovered.length > 0 && (
            <> No subtopic weightage for {uncovered.join(', ')} — those chapters are scored but not listed here.</>
          )}
        </div>
      </div>
    </Card>
  )
}
