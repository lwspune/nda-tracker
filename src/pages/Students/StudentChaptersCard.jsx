import { useId, useState } from 'react'
import { Card, CardTitle } from '../../components/ui'
import ChapterAccordion from './ChapterAccordion'
import WrongAnswerAudit from './WrongAnswerAudit'
import UnattemptedAudit from './UnattemptedAudit'

// "Your chapters" — the student portal's one card for "where am I weak".
// Chapter Performance plus the two audits, which used to be three separate
// cards each calling itself the priority. The audits are tabs here, rendered
// `embedded`; faculty still see them as their own cards (2026-11-05).
//
// A tab is offered only when it has rows: an empty "Most wrong" tab is a
// control that cannot do anything.
export default function StudentChaptersCard({ chapterSummary, name, exams, wrongAudit, skippedAudit, allOffline }) {
  const [tab, setTab] = useState('chapters')
  const baseId = useId()

  const tabs = [
    { key: 'chapters', label: 'By chapter' },
    wrongAudit.length > 0   && { key: 'wrong',   label: 'Most wrong' },
    skippedAudit.length > 0 && { key: 'skipped', label: 'Most skipped' },
  ].filter(Boolean)
  const active = tabs.some(t => t.key === tab) ? tab : 'chapters'

  return (
    <Card>
      <CardTitle>📚 Your chapters</CardTitle>
      <p className="text-[13px] text-ink-2 mb-3 leading-snug">
        Your accuracy in each chapter — recent tests count more. Tap a chapter to see its subtopics
        and the questions you got wrong or skipped.
      </p>

      {tabs.length > 1 && (
        <div role="tablist" aria-label="Chapter view" className="flex gap-2 mb-3 flex-wrap">
          {tabs.map(t => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`${baseId}-tab-${t.key}`}
              aria-selected={active === t.key}
              aria-controls={`${baseId}-panel`}
              onClick={() => setTab(t.key)}
              className={`px-3 min-h-[36px] rounded-full text-[13px] font-semibold border transition-colors
                          focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                active === t.key ? 'bg-ink text-surface border-ink' : 'border-border text-ink-2 hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div id={`${baseId}-panel`} role={tabs.length > 1 ? 'tabpanel' : undefined}
           aria-labelledby={tabs.length > 1 ? `${baseId}-tab-${active}` : undefined}>
        {active === 'wrong' && (
          <WrongAnswerAudit wrongAudit={wrongAudit} name={name} exams={exams} embedded />
        )}
        {active === 'skipped' && (
          <UnattemptedAudit skippedAudit={skippedAudit} name={name} exams={exams} embedded />
        )}
        {active === 'chapters' && (allOffline ? (
          <p className="text-[12.5px] text-ink-3 px-1 py-2">
            Chapter-level analysis isn't available — your tests here are marks-only, with no per-question data.
          </p>
        ) : (
          <ChapterAccordion chapterSummary={chapterSummary} name={name} exams={exams} />
        ))}
      </div>
    </Card>
  )
}
