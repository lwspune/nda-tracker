import { useState } from 'react'
import { Card, CardTitle } from '../../components/ui'
import QuestionCard from '../../components/ui/QuestionCard'
import { scoreBg } from '../../lib/analytics'
import { getSubtopicQuestions, groupByExam, fmtDate } from './chapterAccordionHelpers'

const TOP_N = 10

// The three buckets behind a subtopic's number. Remediation ("Learn this") is
// offered on wrong and skipped only — a Learn link under a question the student
// answered correctly is noise.
const BUCKETS = [
  { key: 'wrong',   label: 'Wrong',   icon: '❌', remediate: true  },
  { key: 'skipped', label: 'Skipped', icon: '⬜', remediate: true  },
  { key: 'correct', label: 'Right',   icon: '✅', remediate: false },
]

// Questions behind one subtopic row, grouped by exam. Rendered only once the
// row is opened — there are up to 111 rows and each walks every exam.
function SubtopicQuestions({ chapter, subtopic, name, exams }) {
  const [open, setOpen] = useState(null)
  const buckets = getSubtopicQuestions(chapter, subtopic, name, exams)
  const total = BUCKETS.reduce((n, b) => n + buckets[b.key].length, 0)

  if (total === 0) {
    return (
      <div className="text-[10px] text-ink-3 italic py-1">
        No questions from this subtopic in the exams on record.
      </div>
    )
  }

  const active = open ? BUCKETS.find(b => b.key === open) : null

  return (
    <div className="py-1">
      <div className="flex gap-1.5 flex-wrap">
        {BUCKETS.filter(b => buckets[b.key].length > 0).map(b => (
          <button
            key={b.key}
            onClick={() => setOpen(o => (o === b.key ? null : b.key))}
            aria-expanded={open === b.key}
            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
              open === b.key ? 'bg-ink text-surface border-ink' : 'border-border text-ink-2 hover:text-ink'
            }`}
          >
            {b.icon} {buckets[b.key].length} {b.label} {open === b.key ? '▲' : '▼'}
          </button>
        ))}
      </div>

      {active && (
        <div className="mt-2 space-y-2">
          {groupByExam(buckets[active.key]).map(g => (
            <div key={`${g.examName}||${g.examDate}`}>
              <div className="text-[10px] text-ink-3 mb-1">
                {g.examName} · {fmtDate(g.examDate, true)}
              </div>
              <div className="space-y-2">
                {g.items.map(item => (
                  <QuestionCard
                    key={`${g.examId}-${item.qObj.q}`}
                    q={item.qObj}
                    examId={g.examId}
                    studentAnswer={item.studentAnswer}
                    studentResult={item.studentResult}
                    showRemediation={active.remediate}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

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
export default function ProjectedScoreCard({ projected, primarySubject, subjectMaxScore,
                                             showScore = true, name, exams, studentNames, absentExams = [] }) {
  const [view, setView]     = useState('chapters')
  const [showAll, setShowAll] = useState(false)
  const [openRow, setOpenRow] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const canDrill = Boolean(name && exams?.length)

  // The docx builder pulls in docx + mathml2omml — dynamic-imported so
  // only someone who clicks Download pays for them, matching monthlyReportZip.
  async function handleDownload() {
    setBusy(true); setError('')
    try {
      const [{ buildPracticeSet }, { downloadPracticeSet }] = await Promise.all([
        import('../../lib/practiceSet'),
        import('../../lib/practiceSetDocx'),
      ])
      const { rows: setRows, totals } = buildPracticeSet({
        subtopicBreakdown: subtopics,
        exams, name, names: studentNames, absentExams,
        topN: showAll ? subtopics.length : TOP_N,
      })
      await downloadPracticeSet(
        { studentName: name, subject: primarySubject, rows: setRows, totals },
        `${name.replace(/[^\w\s-]/g, '')} — NDA ${primarySubject} Practice Set.docx`,
      )
    } catch (e) {
      console.error('[practiceSet] build failed:', e)
      setError('Could not build the file. Try again.')
    } finally {
      setBusy(false)
    }
  }

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
                  onClick={() => { setView(v); setShowAll(false); setOpenRow(null) }}
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
          {visible.map(r => {
            const key = bySubtopic ? r.subtopic : r.chapter
            const row = (
              <OpportunityRow
                label={bySubtopic ? r.subtopic : r.chapter}
                sub={bySubtopic ? r.chapter : null}
                projected={r.projected}
                marksAtStake={r.marksAtStake}
                accuracy={r.accuracy}
              />
            )
            // Drill-down needs the exam data; without it the row is display-only
            // rather than a control that cannot do anything.
            if (!canDrill || !bySubtopic) return <div key={key}>{row}</div>

            const isOpen = openRow === key
            return (
              <div key={key}>
                <button
                  onClick={() => setOpenRow(o => (o === key ? null : key))}
                  aria-expanded={isOpen}
                  aria-label={r.subtopic}
                  className="w-full text-left rounded hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {row}
                </button>
                {isOpen && (
                  <div className="pl-2 ml-2 border-l-2 border-border">
                    <SubtopicQuestions
                      chapter={r.chapter}
                      subtopic={r.subtopic}
                      name={name}
                      exams={exams}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="mt-2 flex items-center gap-3 flex-wrap">
          {bySubtopic && rows.length > TOP_N && (
            <button
              onClick={() => setShowAll(s => !s)}
              className="text-[10px] text-accent hover:underline"
            >
              {showAll ? `Show top ${TOP_N}` : `Show all ${rows.length}`}
            </button>
          )}
          {bySubtopic && canDrill && (
            <button
              onClick={handleDownload}
              disabled={busy}
              className="text-[10px] text-accent hover:underline disabled:opacity-50 disabled:no-underline"
            >
              {busy ? 'Building…' : `⬇ Download these ${visible.length} as a practice set`}
            </button>
          )}
          {error && <span className="text-[10px] text-danger">{error}</span>}
        </div>

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
