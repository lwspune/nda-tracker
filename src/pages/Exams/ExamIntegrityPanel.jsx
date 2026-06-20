import { useState, useMemo } from 'react'
import QuestionCard from '../../components/ui/QuestionCard'
import { buildExamIntegrityReport, examMaxMarks } from '../../lib/analytics'

// ── Exam Integrity (copying-detection) panel ──────────────────
// Surfaces pairs/clusters of students whose answer sheets are anomalously
// similar — the same WRONG options on the same questions, and near-identical
// attempt/skip patterns. These are leads for a human to investigate, NOT proof.
// Logic lives in src/lib/analytics/examIntegrity.js (pure + tested).

function TierBadge({ tier }) {
  const isA = tier === 'A'
  return (
    <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border
      ${isA ? 'bg-red-50 text-danger border-red-200' : 'bg-amber-50 text-amber-800 border-amber-200'}`}>
      {isA ? 'Near-identical' : 'Outlier'}
    </span>
  )
}

function Metric({ label, value, title }) {
  return (
    <div className="text-center" title={title}>
      <div className="text-[9px] text-ink-3 uppercase tracking-wide font-bold">{label}</div>
      <div className="text-[13px] font-extrabold font-mono text-ink">{value}</div>
    </div>
  )
}

function PairRow({ pair, exam, qIndex, maxMarks }) {
  const [open, setOpen] = useState(false)
  const pct = (v) => maxMarks > 0 ? `${Math.round((v / maxMarks) * 100)}%` : '—'

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-surface">
      <div className="flex items-center gap-3 px-3 py-2.5 flex-wrap">
        <TierBadge tier={pair.tier} />

        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-semibold text-ink">
            {pair.a.name} <span className="text-ink-3 font-normal">↔</span> {pair.b.name}
          </div>
          <div className="text-[10px] font-mono text-ink-3 flex flex-wrap items-center gap-x-2">
            <span>roll {pair.a.rollNo || '?'} / {pair.b.rollNo || '?'}</span>
            <span>·</span>
            <span>score {pct(pair.a.score)} / {pct(pair.b.score)}</span>
            {pair.rollAdjacent && (
              <span className="text-[9px] font-bold uppercase tracking-wide bg-accent-soft text-accent
                               border border-accent/20 rounded-full px-1.5 py-0.5">adjacent seats</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 flex-shrink-0">
          <Metric label="Same wrong" value={pair.sameWrong} title="Questions both got wrong with the identical wrong option" />
          <Metric label="Diffs" value={pair.diff} title="Questions they answered differently" />
          <Metric label="Agree" value={`${Math.round(pair.agreeRate * 100)}%`} title="Identical answers among commonly-attempted questions" />
          {pair.z != null && <Metric label="z" value={pair.z} title="Std deviations above the exam's average shared-wrong count" />}
          <button
            onClick={() => setOpen(o => !o)}
            disabled={!pair.sharedWrongQ.length}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold border
                        transition-all disabled:opacity-40 disabled:cursor-not-allowed
              ${open ? 'bg-red-50 text-danger border-red-200'
                     : 'bg-surface-2 text-ink-2 border-border hover:bg-accent-soft hover:text-accent hover:border-accent/30'}`}
          >
            {open ? 'Hide ▲' : `Evidence (${pair.sharedWrongQ.length}) ▼`}
          </button>
        </div>
      </div>

      {open && (
        <div className="px-4 py-3 bg-red-50/40 border-t border-red-100">
          <p className="text-[11px] text-ink-2 mb-3">
            Questions where <strong>both</strong> picked the same wrong option:
          </p>
          <div className="space-y-2">
            {pair.sharedWrongQ.map(({ q, choice }) => {
              const question = qIndex.get(q)
              if (!question) {
                return (
                  <div key={q} className="text-[11px] font-mono text-ink-3">
                    Q{q} — both marked {choice} (no question text on file)
                  </div>
                )
              }
              return (
                <QuestionCard
                  key={q}
                  q={question}
                  examId={exam.id}
                  studentAnswer={choice}
                  studentResult={-1}
                  showRemediation={false}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ExamIntegrityPanel({ exam }) {
  const report = useMemo(() => buildExamIntegrityReport(exam), [exam])
  const maxMarks = examMaxMarks(exam)
  const qIndex = useMemo(() => {
    const m = new Map()
    ;(exam.questions || []).forEach(q => m.set(String(q.q), q))
    return m
  }, [exam])

  if (!report.available) {
    return (
      <div className="border-t border-border bg-surface-2/60 px-4 md:px-6 py-4">
        <p className="text-[12px] text-ink-3">{report.reason}</p>
      </div>
    )
  }

  const ringClusters = report.clusters.filter(c => c.members.length >= 3)

  return (
    <div className="border-t border-border bg-surface-2/60 px-4 md:px-6 py-4 space-y-4">
      {/* Header + disclaimer */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[13px] font-bold text-ink">🕵 Answer-similarity analysis</span>
        <span className="text-[11px] font-mono text-ink-3">
          {report.nStudents} students · avg shared-wrong {report.background.meanSharedWrong} (sd {report.background.sdSharedWrong})
        </span>
      </div>
      <p className="text-[11px] text-ink-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        ⚠ These are <strong>investigative leads, not proof</strong>. High answer-similarity is consistent with copying
        but can have other explanations — confirm against the seating chart and, where warranted, a re-test under observation.
      </p>

      {/* Clusters / rings */}
      {ringClusters.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-widest text-ink-3">Clusters</div>
          {ringClusters.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
              <span className="text-[12px] font-bold text-danger">⚠ {c.members.length}-student ring</span>
              <span className="text-[10px] font-mono text-ink-3">({c.pairCount} flagged pairs · up to {c.maxSameWrong} shared wrong)</span>
              <div className="flex flex-wrap gap-1.5 w-full mt-1">
                {c.members.map(m => (
                  <span key={m} className="text-[10px] font-mono bg-white border border-red-200 text-danger
                                           px-2 py-0.5 rounded-full truncate max-w-[160px]">{m}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Flagged pairs */}
      <div className="space-y-2">
        <div className="text-[11px] font-bold uppercase tracking-widest text-ink-3">
          Flagged pairs ({report.pairs.length})
        </div>
        {report.pairs.length === 0 ? (
          <p className="text-[12px] text-ink-3 py-2">
            No statistically anomalous answer-similarity found for this exam.
          </p>
        ) : (
          <div className="space-y-2">
            {report.pairs.map((pair, i) => (
              <PairRow key={i} pair={pair} exam={exam} qIndex={qIndex} maxMarks={maxMarks} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
