import { useEffect, useState } from 'react'
import { Alert } from '../ui'
import { VALID_CHAPTERS } from '../../lib/validateTags'

export default function Step3Tags({ state, onChange, onNext, onBack }) {
  const { tags, tagsSource, totalQs, subject } = state

  // Build working tags list
  const [workingTags, setWorkingTags] = useState(() => buildTags(tags, totalQs, subject))
  const [filter, setFilter] = useState('all') // 'all' | 'untagged'

  useEffect(() => {
    setWorkingTags(buildTags(tags, totalQs, subject))
  }, [tags, totalQs, subject])

  function updateTag(i, field, value) {
    setWorkingTags(prev => {
      const next = [...prev]
      next[i] = { ...next[i], [field]: value }
      return next
    })
  }

  function handleNext() {
    onChange({ tags: workingTags })
    onNext()
  }

  const untaggedCount = workingTags.filter(t =>
    !t.chapter || !VALID_CHAPTERS.includes(t.chapter)
  ).length

  const displayed = filter === 'untagged'
    ? workingTags.map((t, i) => ({ ...t, _i: i })).filter(t =>
        !t.chapter || t.chapter === 'Unknown' || t.chapter === subject
      )
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
      <div className="grid gap-2 px-2 mb-1" style={{ gridTemplateColumns: '44px 1fr 1fr' }}>
        <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3">Q#</div>
        <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3">Chapter</div>
        <div className="text-[10px] font-bold uppercase tracking-wide text-ink-3">Subtopic</div>
      </div>

      {/* Tag rows */}
      <div className="max-h-[320px] overflow-y-auto border border-border rounded-xl overflow-hidden">
        {displayed.map((tag, rowIdx) => {
          const i = tag._i
          const isUntagged = !tag.chapter || !VALID_CHAPTERS.includes(tag.chapter)
          return (
            <div
              key={i}
              className={`grid gap-2 px-3 py-1.5 border-b border-border/50 last:border-0 items-center
                          ${rowIdx % 2 === 0 ? 'bg-surface' : 'bg-surface-2/50'}`}
              style={{ gridTemplateColumns: '44px 1fr 1fr' }}
            >
              <span className={`font-mono text-[11px] font-bold ${isUntagged ? 'text-warning' : 'text-ink-3'}`}>
                Q{tag.q}
              </span>
              <select
                className={`text-[11px] border rounded-md px-2 py-1 outline-none font-sans
                            transition-colors focus:border-accent bg-surface cursor-pointer
                            ${!VALID_CHAPTERS.includes(tag.chapter)
                              ? 'border-yellow-300 bg-yellow-50'
                              : 'border-border'}`}
                value={tag.chapter || ''}
                onChange={e => updateTag(i, 'chapter', e.target.value)}
              >
                <option value="">— select chapter —</option>
                {VALID_CHAPTERS.map(ch => (
                  <option key={ch} value={ch}>{ch}</option>
                ))}
              </select>
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

// Build working tags — merges tags file data with defaults for missing questions
function buildTags(tags, totalQs, subject) {
  const ch = subject || 'Mathematics'
  const tagMap = {}
  if (tags) tags.forEach(t => { tagMap[t.q] = t })

  return Array.from({ length: totalQs }, (_, i) => {
    const q = i + 1
    return tagMap[q] || {
      q,
      chapter: ch,
      subtopic: 'General',
      question: null, optionA: null, optionB: null,
      optionC: null, optionD: null, answer: null, solution: null,
    }
  })
}
