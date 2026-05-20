import { useState } from 'react'
import { Math } from './Math'
import useStore from '../../store/useStore'
import { useMode } from '../../context/ModeContext'
import QuestionCardEditor from './QuestionCardEditor'

// q        — question object { q, chapter, subtopic, question, optionA..D, answer, solution, difficulty }
// examId   — parent exam id (needed for updateQuestion)
// studentAnswer — 'A'|'B'|'C'|'D'|null
// studentResult — 1 | -1 | 0

const DIFFICULTY_STYLE = {
  easy:   'bg-green-50 text-green-700 border-green-200',
  medium: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  hard:   'bg-red-50 text-red-700 border-red-200',
}

export default function QuestionCard({ q, examId, studentAnswer, studentResult }) {
  const [showSolution, setShowSolution] = useState(false)
  const [editing, setEditing]           = useState(false)
  const updateQuestion = useStore(s => s.updateQuestion)

  const mode       = useMode()
  const hasContent = q.question || q.optionA
  const canEdit    = mode === 'admin' && !!examId

  const OPTIONS    = ['A', 'B', 'C', 'D']
  const optionText = { A: q.optionA, B: q.optionB, C: q.optionC, D: q.optionD }

  function optionStyle(letter) {
    const isCorrect = letter === q.answer
    const isStudent = letter === studentAnswer
    if (isCorrect) return 'bg-green-50 border-green-300 text-green-900'
    if (isStudent && !isCorrect) return 'bg-red-50 border-red-300 text-red-900'
    return 'bg-surface-2 border-border text-ink-2'
  }

  function optionIcon(letter) {
    const isCorrect = letter === q.answer
    const isStudent = letter === studentAnswer
    if (isCorrect && isStudent) return '✅'
    if (isCorrect) return '✓'
    if (isStudent && !isCorrect) return '✗'
    return null
  }

  const resultLabel = {
    1:    { text: 'Correct',  color: 'bg-green-50 text-success' },
    '-1': { text: 'Wrong',    color: 'bg-red-50 text-danger' },
    0:    { text: 'Skipped',  color: 'bg-surface-2 text-ink-3' },
  }[studentResult] || { text: 'Unknown', color: 'bg-surface-2 text-ink-3' }

  function handleSave(patch) {
    updateQuestion(examId, q.q, patch)
    setEditing(false)
  }

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-surface shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-surface-2 border-b border-border">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="font-mono font-bold text-[12px] text-ink-2 flex-shrink-0">Q{q.q}</span>
          <span className="text-ink-3 text-[11px]">·</span>
          <span className="text-[11px] text-ink-2 truncate">{q.chapter}</span>
          <span className="text-ink-3 text-[11px]">›</span>
          <span className="text-[11px] text-ink-3 truncate">{q.subtopic}</span>
          {q.difficulty && (() => {
            const key = q.difficulty.toLowerCase()
            const cls = DIFFICULTY_STYLE[key] || 'bg-surface-3 text-ink-3 border-border'
            return (
              <span className={`flex-shrink-0 text-[9px] font-bold uppercase tracking-wide
                               px-2 py-0.5 rounded-full border font-mono ${cls}`}>
                {q.difficulty}
              </span>
            )
          })()}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full font-mono ${resultLabel.color}`}>
            {resultLabel.text}
          </span>
          {canEdit && (
            <button
              onClick={() => setEditing(e => !e)}
              className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border transition-colors
                ${editing
                  ? 'bg-warning/10 text-warning border-warning/30'
                  : 'bg-surface-3 text-ink-3 border-border hover:text-accent hover:border-accent/30 hover:bg-accent-soft'
                }`}
            >
              {editing ? '✕ Cancel' : '✏️ Edit'}
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-4">
        {editing ? (
          <QuestionCardEditor q={q} onSave={handleSave} onCancel={() => setEditing(false)} />
        ) : hasContent ? (
          <ViewMode
            q={q}
            optionText={optionText}
            OPTIONS={OPTIONS}
            optionStyle={optionStyle}
            optionIcon={optionIcon}
            studentResult={studentResult}
            studentAnswer={studentAnswer}
            showSolution={showSolution}
            setShowSolution={setShowSolution}
          />
        ) : (
          <div className="flex items-center gap-3 py-1">
            <span className="text-[12px] font-mono font-bold text-ink-3">Q{q.q}</span>
            <span className="text-[11px] text-ink-3">·</span>
            <span className="text-[11px] text-ink-3 italic">
              No question text — upload an enriched tags file or use ✏️ Edit to add manually.
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── View Mode ─────────────────────────────────────────────────
function ViewMode({ q, optionText, OPTIONS, optionStyle, optionIcon,
                    studentResult, studentAnswer, showSolution, setShowSolution }) {
  return (
    <>
      {q.question && (
        <div className="text-[13.5px] leading-relaxed text-ink mb-4 font-medium">
          <Math>{q.question}</Math>
        </div>
      )}

      {q.optionA && (
        <div className="grid grid-cols-1 gap-2 mb-4">
          {OPTIONS.filter(l => optionText[l]).map(letter => (
            <div
              key={letter}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors ${optionStyle(letter)}`}
            >
              <span className="font-mono font-bold text-[12px] w-5 flex-shrink-0">{letter}</span>
              <div className="flex-1 text-[12px] md:text-[13px] leading-snug">
                <Math>{optionText[letter]}</Math>
              </div>
              {optionIcon(letter) && (
                <span className="text-[12px] flex-shrink-0">{optionIcon(letter)}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {studentResult === -1 && studentAnswer && q.answer && (
        <div className="flex items-center gap-3 mb-3 text-[12px]">
          <span className="text-ink-3">Marked:</span>
          <span className="font-mono font-bold text-danger bg-red-50 px-2 py-0.5 rounded">{studentAnswer}</span>
          <span className="text-ink-3">·</span>
          <span className="text-ink-3">Correct:</span>
          <span className="font-mono font-bold text-success bg-green-50 px-2 py-0.5 rounded">{q.answer}</span>
        </div>
      )}

      {q.solution && (
        <div>
          <button
            onClick={() => setShowSolution(s => !s)}
            className="flex items-center gap-1.5 text-[12px] font-semibold text-accent
                       hover:text-accent-hover transition-colors"
          >
            <span className="text-[10px]">{showSolution ? '▼' : '▶'}</span>
            {showSolution ? 'Hide Solution' : '💡 Show Solution'}
          </button>
          {showSolution && (
            <div className="mt-3 p-3 bg-indigo-50/60 border border-indigo-100 rounded-lg
                            text-[12.5px] leading-relaxed text-ink">
              <Math>{q.solution}</Math>
            </div>
          )}
        </div>
      )}
    </>
  )
}
