import { useEffect, useState } from 'react'
import { Alert } from '../ui'
import { getValidChapters } from '../../lib/validateTags'
import { SUBJECTS } from '../../lib/ndaFreq'

// Per-question subjects for GAT combined exams — everything except GAT itself
const QUESTION_SUBJECTS = SUBJECTS.filter(s => s !== 'GAT')

export default function Step3Tags({ state, onChange, onNext, onBack }) {
  const { tags, tagsSource, totalQs, subject, answerKeys } = state

  const isGAT = subject === 'GAT'

  // Chapter list for this subject — empty means no validation / free entry (non-GAT only)
  const validChapters = getValidChapters(subject || 'Maths')
  const hasChapterList = validChapters.length > 0

  // Build working tags list
  const [workingTags, setWorkingTags] = useState(() => buildTags(tags, totalQs, subject, answerKeys))
  const [filter, setFilter] = useState('all') // 'all' | 'untagged'

  useEffect(() => {
    setWorkingTags(buildTags(tags, totalQs, subject, answerKeys))
  }, [tags, totalQs, subject, answerKeys])

  function updateTag(i, field, value) {
    setWorkingTags(prev => {
      const next = [...prev]
      // For GAT exams: changing the subject invalidates the old chapter
      if (isGAT && field === 'subject') {
        next[i] = { ...next[i], subject: value, chapter: '' }
      } else {
        next[i] = { ...next[i], [field]: value }
      }
      return next
    })
  }

  function handleNext() {
    onChange({ tags: workingTags })
    onNext()
  }

  // A tag is "untagged" when:
  // - GAT: no subject assigned, OR chapter not in that subject's list
  // - Non-GAT: no chapter set, OR chapter not in the known list
  function isUntaggedRow(t) {
    if (isGAT) {
      if (!t.subject) return true
      const rowChapters = getValidChapters(t.subject)
      return !t.chapter || (rowChapters.length > 0 && !rowChapters.includes(t.chapter))
    }
    return !t.chapter || (hasChapterList && !validChapters.includes(t.chapter))
  }

  const untaggedCount = workingTags.filter(isUntaggedRow).length

  const displayed = filter === 'untagged'
    ? workingTags.map((t, i) => ({ ...t, _i: i })).filter(isUntaggedRow)
    : workingTags.map((t, i) => ({ ...t, _i: i }))

  return (
    <div>
      {/* Status banner */}
      {tagsSource ? (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-green-50 border
                        border-green-200 text-[12.5px] text-green-900 mb-4">
          <span>✅</span>
          <span>{tagsSource} — review below and edit if needed</span>
        </div>
      ) : (
        <Alert type="warning">
          <span>⚠️</span>
          <span>No tags file uploaded — default chapter shown. Edit each question's chapter and subtopic.</span>
        </Alert>
      )}

      {/* Controls */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-[12px] text-ink-2">
          <span className="font-semibold">{workingTags.length}</span> questions ·{' '}
          {untaggedCount > 0
            ? <span className="text-warning font-semibold">{untaggedCount} need tagging</span>
            : <span className="text-success font-semibold">all tagged ✓</span>
          }
        </div>
        {untaggedCount > 0 && (
          <div className="flex gap-1.5">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-colors
                ${filter === 'all' ? 'bg-accent text-white' : 'bg-surface-2 text-ink-2 hover:bg-surface-3'}`}
            >All</button>
            <button
              onClick={() => setFilter('untagged')}
              className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-colors
                ${filter === 'untagged' ? 'bg-warning text-white' : 'bg-surface-2 text-ink-2 hover:bg-surface-3'}`}
            >Untagged ({untaggedCount})</button>
          </div>
        )}
      </div>

      {/* Column headers */}
      <div className="grid gap-2 px-2 mb-1"
           style={{ gridTemplateColumns: isGAT ? '44px 110px 1fr 1fr' : '44px 1fr 1fr' }}>
        <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3">Q#</div>
        {isGAT && <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3">Subject</div>}
        <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3">Chapter</div>
        <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3">Subtopic</div>
      </div>

      {/* Tag rows */}
      <div className="max-h-[320px] overflow-y-auto border border-border rounded-xl overflow-hidden">
        {displayed.map((tag, rowIdx) => {
          const i = tag._i
          const isUntagged = isUntaggedRow(tag)

          // For GAT: chapter list scoped to this row's subject
          const rowChapters = isGAT ? getValidChapters(tag.subject || '') : validChapters
          const rowHasChapterList = rowChapters.length > 0

          return (
            <div
              key={i}
              className={`grid gap-2 px-3 py-1.5 border-b border-border/50 last:border-0 items-center
                          ${rowIdx % 2 === 0 ? 'bg-surface' : 'bg-surface-2/50'}`}
              style={{ gridTemplateColumns: isGAT ? '44px 110px 1fr 1fr' : '44px 1fr 1fr' }}
            >
              <span className={`font-mono text-[11px] font-bold ${isUntagged ? 'text-warning' : 'text-ink-3'}`}>
                Q{tag.q}
              </span>

              {/* Subject dropdown — GAT only */}
              {isGAT && (
                <select
                  className={`text-[11px] border rounded-md px-2 py-1 outline-none font-sans
                              transition-colors focus:border-accent bg-surface cursor-pointer
                              ${!tag.subject ? 'border-yellow-300 bg-yellow-50' : 'border-border'}`}
                  value={tag.subject || ''}
                  onChange={e => updateTag(i, 'subject', e.target.value)}
                >
                  <option value="">— subject —</option>
                  {QUESTION_SUBJECTS.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              )}

              {/* Chapter — scoped to row subject for GAT */}
              {rowHasChapterList ? (
                <select
                  className={`text-[11px] border rounded-md px-2 py-1 outline-none font-sans
                              transition-colors focus:border-accent bg-surface cursor-pointer
                              ${!rowChapters.includes(tag.chapter)
                                ? 'border-yellow-300 bg-yellow-50'
                                : 'border-border'}`}
                  value={tag.chapter || ''}
                  onChange={e => updateTag(i, 'chapter', e.target.value)}
                  disabled={isGAT && !tag.subject}
                >
                  <option value="">— select chapter —</option>
                  {rowChapters.map(ch => (
                    <option key={ch} value={ch}>{ch}</option>
                  ))}
                </select>
              ) : (
                <input
                  className="text-[11px] border border-border rounded-md px-2 py-1 outline-none
                             bg-surface font-sans transition-colors focus:border-accent
                             disabled:opacity-40 disabled:cursor-not-allowed"
                  value={tag.chapter || ''}
                  onChange={e => updateTag(i, 'chapter', e.target.value)}
                  placeholder={isGAT && !tag.subject ? 'pick subject first' : 'Chapter name'}
                  disabled={isGAT && !tag.subject}
                />
              )}

              <input
                className="text-[11px] border border-border rounded-md px-2 py-1 outline-none
                           bg-surface font-sans transition-colors focus:border-accent"
                value={tag.subtopic || ''}
                onChange={e => updateTag(i, 'subtopic', e.target.value)}
                placeholder="Subtopic"
              />
            </div>
          )
        })}
      </div>

      <div className="flex justify-end gap-3 mt-4">
        <button onClick={onBack} className="btn btn-secondary">← Back</button>
        <button onClick={handleNext} className="btn btn-primary">Confirm Tags →</button>
      </div>
    </div>
  )
}

// Build working tags — merges tags file data with defaults for missing questions.
// Results-Excel `answerKeys` (when provided) takes precedence: it overrides any
// existing tag.answer and pre-fills the default answer for untagged questions.
function buildTags(tags, totalQs, subject, answerKeys) {
  const isGAT = subject === 'GAT'
  // For GAT: no default chapter (user must assign subject first); for others use first chapter
  const subjectChapters = isGAT ? [] : getValidChapters(subject || 'Maths')
  const ch = isGAT ? '' : (subjectChapters[0] || subject || 'General')

  const tagMap = {}
  if (tags) tags.forEach(t => { tagMap[t.q] = t })

  return Array.from({ length: totalQs }, (_, i) => {
    const q = i + 1
    const base = tagMap[q] || {
      q,
      subject: null,
      chapter: ch,
      subtopic: 'General',
      question: null, optionA: null, optionB: null,
      optionC: null, optionD: null, answer: null, solution: null,
    }
    return answerKeys?.[q] ? { ...base, answer: answerKeys[q] } : base
  })
}
