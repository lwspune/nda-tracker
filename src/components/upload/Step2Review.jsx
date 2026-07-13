import { useEffect } from 'react'
import { Alert } from '../ui'
import { SUBJECTS } from '../../lib/ndaFreq'
import { getExamBatches } from '../../lib/analytics'
import { dominantBranch } from '../../lib/students/dominantBranch'
import useStore from '../../store/useStore'

export default function Step2Review({ state, onChange, onNext, onBack }) {
  const {
    tagsSource, hasNegative, students, totalQs,
    examName, examDate, markCorrect, markWrong, subject,
    detectedBatch, batchConfidence, batchMatchedCount,
    batchTotalCount, batch, branch,
  } = state

  // Guard: if state.subject is set to something not in SUBJECTS (e.g. "2"
  // from a faulty Step1 detection), the <select> would render the first
  // option ("Maths") visually while the underlying state stayed wrong —
  // the user would see the right value and never trigger onChange.
  useEffect(() => {
    if (subject && !SUBJECTS.includes(subject)) {
      onChange({ subject: 'Maths' })
    }
  }, [subject, onChange])

  const studentProfiles  = useStore(s => s.studentProfiles)
  const syllabusBatches  = useStore(s => s.syllabusBatches) || []
  const hasProfiles      = Object.keys(studentProfiles).length > 0
  const hasCentralBatches = syllabusBatches.length > 0

  // Roster is effectively single-branch: seed the Branch field with the
  // dominant branch (≥80% of profiles) when it's untouched. `undefined` means
  // "never set"; an empty string means the user explicitly cleared it, so we
  // leave that alone. Same fill-only spirit as the Student-import default.
  const autoBranch = dominantBranch(Object.values(studentProfiles))
  useEffect(() => {
    if (branch === undefined && autoBranch) {
      onChange({ branch: autoBranch })
    }
  }, [branch, autoBranch, onChange])

  // Current selected batches — parsed from the comma-joined state.batch field.
  // Auto-detect is used as the initial pre-selection only when state.batch is unset.
  const initialBatch  = batch !== undefined ? batch : (detectedBatch || '')
  const selectedSet   = new Set(getExamBatches({ batch: initialBatch }))
  const currentBranch = branch || ''

  function toggleBatch(name) {
    const next = new Set(selectedSet)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    // Preserve syllabusBatches[] order so the joined string is stable.
    const joined = syllabusBatches.filter(b => next.has(b)).join(', ')
    onChange({ batch: joined })
  }

  // Unique branches from student profiles
  const allBranches = [...new Set(
    Object.values(studentProfiles).map(p => p.branch).filter(Boolean)
  )].sort()

  // Confidence display
  const confPct = batchConfidence ? Math.round(batchConfidence * 100) : 0
  const confColor = confPct >= 80 ? 'text-success' : confPct >= 50 ? 'text-warning' : 'text-danger'

  return (
    <div>
      {/* Banner */}
      <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-green-50 border border-green-200
                      text-[12.5px] text-green-900 mb-5 leading-relaxed">
        <span>✅</span>
        <span>
          <strong>{students?.length} students</strong> · <strong>{totalQs} questions</strong> ·
          marking <strong>+{markCorrect}/{markWrong}</strong>
          {tagsSource ? <> · ✅ {tagsSource}</> : ' · No tags file — edit manually in next step'}
        </span>
      </div>

      {/* Form */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="form-label">Exam Name <AutoBadge /></label>
          <input
            className="form-input"
            value={examName}
            onChange={e => onChange({ examName: e.target.value })}
            placeholder="e.g. Differentiation Quiz"
          />
        </div>
        <div>
          <label className="form-label">Date <AutoBadge /></label>
          <input
            type="date"
            className="form-input"
            value={examDate}
            onChange={e => onChange({ examDate: e.target.value })}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div>
          <label className="form-label">Marks — Correct <AutoBadge /></label>
          <input
            type="number" step="0.01"
            className="form-input"
            value={markCorrect}
            onChange={e => onChange({ markCorrect: parseFloat(e.target.value) || 1 })}
          />
        </div>
        <div>
          <label className="form-label">Marks — Wrong <AutoBadge /></label>
          <input
            type="number" step="0.01"
            className="form-input"
            value={markWrong}
            onChange={e => onChange({ markWrong: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <div>
          <label className="form-label">Total Questions <AutoBadge /></label>
          <input
            type="number" min="1"
            className="form-input"
            value={totalQs}
            onChange={e => onChange({ totalQs: parseInt(e.target.value) || 1 })}
          />
        </div>
      </div>

      <div className="mb-4">
        <label className="form-label">
          Subject
          <span className="ml-2 text-[10px] font-normal normal-case tracking-normal text-ink-3">
            default chapter if no tags file
          </span>
        </label>
        <select
          className="form-input"
          value={subject || 'Maths'}
          onChange={e => onChange({ subject: e.target.value })}
        >
          {SUBJECTS.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* ── Batch multi-select (central-only, comma-joined) ─ */}
      <div className="mb-5">
        <label className="form-label" id="batch-label">
          Batches
          {detectedBatch && (
            <span className={`ml-2 text-[10px] font-bold font-mono normal-case tracking-normal ${confColor}`}>
              auto-detected · {confPct}% confidence ({batchMatchedCount}/{batchTotalCount} students matched)
            </span>
          )}
          <span className="ml-2 text-[10px] font-normal normal-case tracking-normal text-ink-3">
            pick one or more — two batches can share the same exam
          </span>
        </label>

        {hasCentralBatches ? (
          <div
            role="group"
            aria-labelledby="batch-label"
            className="flex flex-wrap gap-2 p-2 border border-border rounded-lg bg-surface-2"
          >
            {syllabusBatches.map(b => {
              const checked = selectedSet.has(b)
              return (
                <label
                  key={b}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-mono border cursor-pointer transition-colors min-h-[36px]
                    ${checked
                      ? 'bg-accent text-white border-accent'
                      : 'bg-surface text-ink-2 border-border hover:border-accent hover:text-accent'
                    }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleBatch(b)}
                    className="accent-current"
                  />
                  <span>{b}</span>
                </label>
              )
            })}
          </div>
        ) : (
          <div className="text-[12px] text-ink-3 italic px-3 py-2 border border-dashed border-border rounded-lg">
            No central batches yet. Add one in Settings → Batches.
          </div>
        )}
      </div>

      {/* ── Branch ───────────────────────────────────────── */}
      <div className="mb-5">
        <label className="form-label">Branch
          {autoBranch && currentBranch === autoBranch && <AutoBadge />}
          {!hasProfiles && (
            <span className="ml-2 text-[10px] font-normal normal-case tracking-normal text-ink-3">
              import Students DB to enable dropdown
            </span>
          )}
        </label>
        {hasProfiles && allBranches.length > 0 ? (
          <select
            className="form-input"
            value={currentBranch}
            onChange={e => onChange({ branch: e.target.value })}
          >
            <option value="">— No branch assigned —</option>
            {allBranches.map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        ) : (
          <input
            className="form-input"
            value={currentBranch}
            onChange={e => onChange({ branch: e.target.value })}
            placeholder="e.g. Pune Main"
          />
        )}
      </div>

      {/* Negative marking warning */}
      {!hasNegative && (
        <Alert type="warning">
          <span>⚠️</span>
          <span>No negative marking detected — set to 0. Correct above if needed.</span>
        </Alert>
      )}

      <div className="flex justify-end gap-3 mt-2">
        <button onClick={onBack} className="btn btn-secondary">← Back</button>
        <button onClick={onNext} className="btn btn-primary">Next: Tag Questions →</button>
      </div>
    </div>
  )
}

function AutoBadge() {
  return (
    <span className="inline-block ml-1.5 text-[9px] font-bold bg-green-50 text-success
                     border border-green-200 rounded-full px-2 py-0.5 font-mono">
      auto-filled
    </span>
  )
}
