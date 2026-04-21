import { useState } from 'react'
import { Math } from './Math'
import { VALID_CHAPTERS } from '../../lib/validateTags'

const DIFFICULTY_LEVELS = ['Easy', 'Medium', 'Hard']

// Props: q, onSave, onCancel
// Owns: draft state, preview state
export default function QuestionCardEditor({ q, onSave, onCancel }) {
  const [draft, setDraft] = useState({
    chapter:    q.chapter    || '',
    subtopic:   q.subtopic   || '',
    difficulty: q.difficulty || '',
    question:   q.question   || '',
    optionA:    q.optionA    || '',
    optionB:    q.optionB    || '',
    optionC:    q.optionC    || '',
    optionD:    q.optionD    || '',
    answer:     q.answer     || '',
    solution:   q.solution   || '',
  })
  const [preview, setPreview] = useState(null) // which field is previewing

  function update(field, val) {
    setDraft(d => ({ ...d, [field]: val }))
  }

  const OPTIONS = ['A', 'B', 'C', 'D']

  return (
    <div className="space-y-4">

      {/* Chapter + Subtopic + Difficulty */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="edit-label">Chapter</label>
          <select
            className="edit-input"
            value={draft.chapter}
            onChange={e => update('chapter', e.target.value)}
          >
            <option value="">— select —</option>
            {VALID_CHAPTERS.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="edit-label">Subtopic</label>
          <input
            className="edit-input"
            value={draft.subtopic}
            onChange={e => update('subtopic', e.target.value)}
            placeholder="e.g. Chain Rule"
          />
        </div>
      </div>
      <div className="w-40">
        <label className="edit-label">Difficulty</label>
        <select
          className="edit-input"
          value={draft.difficulty}
          onChange={e => update('difficulty', e.target.value)}
        >
          <option value="">— none —</option>
          {DIFFICULTY_LEVELS.map(d => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>

      {/* Question */}
      <LaTeXField
        label="Question"
        value={draft.question}
        onChange={v => update('question', v)}
        previewOpen={preview === 'question'}
        onTogglePreview={() => setPreview(p => p === 'question' ? null : 'question')}
        placeholder="Full question text. Use \(...\) for math."
        rows={3}
      />

      {/* Options */}
      <div>
        <label className="edit-label">Options</label>
        <div className="space-y-2">
          {OPTIONS.map(letter => (
            <div key={letter} className="flex items-start gap-2">
              <span className={`font-mono font-bold text-[12px] mt-2 w-5 flex-shrink-0
                ${draft.answer === letter ? 'text-success' : 'text-ink-3'}`}>
                {letter}
              </span>
              <input
                className={`edit-input flex-1 ${draft.answer === letter
                  ? 'border-success bg-green-50' : ''}`}
                value={draft[`option${letter}`]}
                onChange={e => update(`option${letter}`, e.target.value)}
                placeholder={`Option ${letter}`}
              />
              <button
                onClick={() => update('answer', letter)}
                title="Mark as correct answer"
                className={`mt-1 flex-shrink-0 text-[11px] font-bold px-2.5 py-1.5 rounded-lg
                            border transition-colors
                  ${draft.answer === letter
                    ? 'bg-green-50 text-success border-green-300'
                    : 'bg-surface-2 text-ink-3 border-border hover:bg-green-50 hover:text-success hover:border-green-200'
                  }`}
              >
                {draft.answer === letter ? '✓ Correct' : 'Mark correct'}
              </button>
            </div>
          ))}
        </div>
        {draft.answer && (
          <div className="mt-1.5 text-[11px] text-success font-semibold">
            ✓ Correct answer: Option {draft.answer}
          </div>
        )}
      </div>

      {/* Solution */}
      <LaTeXField
        label="Solution"
        value={draft.solution}
        onChange={v => update('solution', v)}
        previewOpen={preview === 'solution'}
        onTogglePreview={() => setPreview(p => p === 'solution' ? null : 'solution')}
        placeholder="Key formula, critical step, common mistake. Use \(...\) for math."
        rows={3}
      />

      {/* Actions */}
      <div className="flex items-center gap-3 pt-1 border-t border-border">
        <button
          onClick={() => onSave(draft)}
          className="btn btn-primary btn-sm"
        >
          💾 Save Changes
        </button>
        <button
          onClick={onCancel}
          className="btn btn-secondary btn-sm"
        >
          Cancel
        </button>
        <span className="text-[10px] text-ink-3 ml-auto">
          Changes save to this session's data · export JSON to persist
        </span>
      </div>
    </div>
  )
}

// ── LaTeX field with live preview ─────────────────────────────
function LaTeXField({ label, value, onChange, previewOpen, onTogglePreview, placeholder, rows = 2 }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="edit-label mb-0">{label}</label>
        {value && (
          <button
            onClick={onTogglePreview}
            className="text-[10px] font-semibold text-accent hover:text-accent-hover transition-colors"
          >
            {previewOpen ? '▼ Hide preview' : '▶ Preview LaTeX'}
          </button>
        )}
      </div>
      <textarea
        className="edit-input w-full font-mono text-[12px] resize-y"
        rows={rows}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {previewOpen && value && (
        <div className="mt-1.5 p-3 bg-surface-2 border border-border rounded-lg
                        text-[13px] leading-relaxed text-ink">
          <Math>{value}</Math>
        </div>
      )}
    </div>
  )
}
