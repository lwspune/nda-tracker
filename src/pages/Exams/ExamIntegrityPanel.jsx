import { useState, useMemo, useEffect } from 'react'
import QuestionCard from '../../components/ui/QuestionCard'
import useStore from '../../store/useStore'
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

// One-click "admitted" control for a single student in a flagged pair.
function AdmitButton({ student, counterpart, lwsId, logged, onAdmit }) {
  const first = (student.name || '').split(' ')[0] || student.name
  if (logged) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg
                       bg-green-50 text-green-700 border border-green-200">
        ✓ {first} — logged
      </span>
    )
  }
  if (!lwsId) {
    return (
      <span title="This student isn't linked to a profile — link them in Students before logging."
            className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg
                       bg-surface-2 text-ink-3 border border-border cursor-not-allowed">
        {first} — no profile
      </span>
    )
  }
  return (
    <button
      onClick={() => onAdmit(student, counterpart)}
      className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg border
                 bg-surface-2 text-ink-2 border-border hover:bg-red-50 hover:text-danger hover:border-red-300 transition-colors"
    >
      ✔ {first} admitted
    </button>
  )
}

function PairRow({ pair, exam, qIndex, maxMarks, nameToLws, loggedLws, onAdmit }) {
  const [open, setOpen] = useState(false)
  const pct = (v) => maxMarks > 0 ? `${Math.round((v / maxMarks) * 100)}%` : '—'
  const aLws = nameToLws.get((pair.a.name || '').toLowerCase()) || null
  const bLws = nameToLws.get((pair.b.name || '').toLowerCase()) || null

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

      {/* Admitted-incident action bar — one click per student (admin + teacher) */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-t border-border bg-surface-2/40">
        <span className="text-[10px] uppercase tracking-wide font-bold text-ink-3">Confronted &amp; admitted:</span>
        <AdmitButton student={pair.a} counterpart={{ ...pair.b, lwsId: bLws }} lwsId={aLws} logged={!!aLws && loggedLws.has(aLws)} onAdmit={(s, c) => onAdmit(s, c, pair)} />
        <AdmitButton student={pair.b} counterpart={{ ...pair.a, lwsId: aLws }} lwsId={bLws} logged={!!bLws && loggedLws.has(bLws)} onAdmit={(s, c) => onAdmit(s, c, pair)} />
      </div>
    </div>
  )
}

export default function ExamIntegrityPanel({ exam }) {
  const report = useMemo(() => buildExamIntegrityReport(exam), [exam])
  const maxMarks = examMaxMarks(exam)
  const studentProfiles = useStore(s => s.studentProfiles)
  const logIntegrityIncident = useStore(s => s.logIntegrityIncident)
  const getIntegrityIncidentsForExam = useStore(s => s.getIntegrityIncidentsForExam)

  // name (lowercased canonical OR variant) → lwsId, so a flagged exam-sheet name
  // resolves to the profile we attach the incident to.
  const nameToLws = useMemo(() => {
    const m = new Map()
    for (const [key, p] of Object.entries(studentProfiles || {})) {
      if (p?.lwsId) m.set(key.toLowerCase(), p.lwsId)
    }
    return m
  }, [studentProfiles])

  // Which students already have a logged incident for THIS exam (drives the badge).
  const [loggedLws, setLoggedLws] = useState(() => new Set())
  useEffect(() => {
    if (!report.available || typeof getIntegrityIncidentsForExam !== 'function' || !exam.id) return
    let cancelled = false
    getIntegrityIncidentsForExam(exam.id).then(rows => {
      if (!cancelled) setLoggedLws(new Set((rows || []).map(r => r.lws_id)))
    })
    return () => { cancelled = true }
  }, [report.available, exam.id, getIntegrityIncidentsForExam])

  async function handleAdmit(student, counterpart, pair) {
    const lwsId = nameToLws.get((student.name || '').toLowerCase())
    if (!lwsId || typeof logIntegrityIncident !== 'function') return
    const ok = window.confirm(
      `Record a confirmed copying incident for ${student.name} on "${exam.name}"?\n\n` +
      `This goes on the student's record and is visible to the student and parent. ` +
      `Only an admin can remove it.`
    )
    if (!ok) return
    const done = await logIntegrityIncident({
      lwsId,
      studentName:      student.name,
      examId:           exam.id,
      examName:         exam.name,
      examDate:         exam.date,
      counterpartName:  counterpart.name,
      counterpartLwsId: counterpart.lwsId || null,
      sharedWrong:      pair?.sameWrong,
      sameCorrect:      pair?.sameCorrect,
      diff:             pair?.diff,
      bothAnswered:     pair?.bothAnswered,
    })
    if (done) setLoggedLws(prev => new Set(prev).add(lwsId))
  }
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
              <PairRow key={i} pair={pair} exam={exam} qIndex={qIndex} maxMarks={maxMarks}
                       nameToLws={nameToLws} loggedLws={loggedLws} onAdmit={handleAdmit} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
