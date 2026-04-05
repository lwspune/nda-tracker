import { Alert } from '../ui'
import { getAllBatches } from '../../lib/matchStudents'
import useStore from '../../store/useStore'

export default function Step2Review({ state, onChange, onNext, onBack }) {
  const {
    tagsSource, hasNegative, students, totalQs,
    examName, examDate, markCorrect, markWrong, subject,
    detectedBatch, batchConfidence, batchMatchedCount,
    batchTotalCount, batchCounts, batch,
  } = state

  const studentProfiles = useStore(s => s.studentProfiles)
  const allBatches      = getAllBatches(studentProfiles)
  const hasProfiles     = Object.keys(studentProfiles).length > 0

  // Current selected batch — use manually set or detected
  const currentBatch = batch !== undefined ? batch : (detectedBatch || '')

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
          Subject / Chapter
          <span className="ml-2 text-[10px] font-normal normal-case tracking-normal text-ink-3">
            default chapter name if no tags file
          </span>
        </label>
        <input
          className="form-input"
          value={subject}
          onChange={e => onChange({ subject: e.target.value })}
          placeholder="e.g. Differentiation, Trigonometry"
        />
      </div>

      {/* ── Batch detection ──────────────────────────────── */}
      <div className="mb-5">
        <label className="form-label">
          Batch
          {detectedBatch && (
            <span className={`ml-2 text-[10px] font-bold font-mono normal-case tracking-normal ${confColor}`}>
              auto-detected · {confPct}% confidence ({batchMatchedCount}/{batchTotalCount} students matched)
            </span>
          )}
          {!hasProfiles && (
            <span className="ml-2 text-[10px] font-normal normal-case tracking-normal text-ink-3">
              import Students DB to enable auto-detection
            </span>
          )}
        </label>

        {hasProfiles ? (
          <div className="flex gap-2 items-start">
            <select
              className="form-input flex-1"
              value={currentBatch}
              onChange={e => onChange({ batch: e.target.value })}
            >
              <option value="">— No batch assigned —</option>
              {allBatches.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
              {/* Add detected batch if not in list */}
              {detectedBatch && !allBatches.includes(detectedBatch) && (
                <option value={detectedBatch}>{detectedBatch}</option>
              )}
            </select>
          </div>
        ) : (
          <input
            className="form-input"
            value={currentBatch}
            onChange={e => onChange({ batch: e.target.value })}
            placeholder="e.g. 11&12th Integrated 2-Year (25-27) - A"
          />
        )}

        {/* Show all detected batches if multiple */}
        {batchCounts && Object.keys(batchCounts).length > 1 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Object.entries(batchCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([b, count]) => (
                <button
                  key={b}
                  onClick={() => onChange({ batch: b })}
                  className={`text-[10px] font-mono px-2.5 py-1 rounded-full border transition-colors
                    ${currentBatch === b
                      ? 'bg-accent text-white border-accent'
                      : 'bg-surface-2 text-ink-2 border-border hover:border-accent hover:text-accent'
                    }`}
                >
                  {b} · {count} students
                </button>
              ))}
          </div>
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
