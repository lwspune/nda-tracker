import { Fragment, useMemo, useState } from 'react'
import useStore from '../../store/useStore'
import { PageHeader, EmptyState, Card } from '../../components/ui'
import { RichText } from '../../components/ui/RichText'
import QuestionCard from '../../components/ui/QuestionCard'
import { computeItemStats } from '../../lib/itemStats'
import {
  getBatchOptions, getExamsForBranch, getBatchMemberNames, getBranchMemberNames,
} from '../../lib/analytics'

// What the answer sheets say about each BANK question, pooled across every
// sitting of the same paper. Admin-only instrumentation for faculty and the
// content team — deliberately NOT shown to students, who can do nothing with
// "88% of your batch missed this".
//
// Everything here is computed from the store: the client already loads
// responses and choices for every exam, so opening this page fetches nothing.
// Spec + the measurements behind it: ITEM_STATS.md

const SORTS = [
  { id: 'distractorRatio', label: 'Review queue (distractor vs key)' },
  { id: 'pCorrect',        label: '% correct (hardest first)' },
  { id: 'skipRate',        label: 'Skip rate (most avoided first)' },
  { id: 'attempted',       label: 'Attempts (most evidence first)' },
  { id: 'discrimination',  label: 'Discrimination (worst first)' },
]

// Ascending sorts put the worst case first; the rest are descending.
const ASCENDING = new Set(['pCorrect', 'discrimination'])
const LABELS = ['A', 'B', 'C', 'D']

const pct = v => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`)
const num = (v, d = 2) => (v === null || v === undefined ? '—' : v.toFixed(d))

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function toCsv(rows) {
  const head = ['questionId', 'subject', 'chapter', 'subtopic', 'keyed', 'seen', 'attempted',
    'skipped', 'correct', 'pCorrect', 'skipRate', 'topDistractor', 'topDistractorN',
    'distractorRatio', 'discrimination', 'verdictMismatch']
  const esc = v => '"' + String(v ?? '').split('"').join('""') + '"'
  const lines = [head.join(',')]
  for (const r of rows) {
    lines.push([
      r.questionId, r.subject, r.chapter, r.subtopic, r.keyed, r.seen, r.attempted,
      r.skipped, r.correct, r.pCorrect, r.skipRate, r.topDistractor?.label ?? '',
      r.topDistractor?.n ?? '', r.distractorRatio, r.discrimination, r.verdictMismatch,
    ].map(esc).join(','))
  }
  return lines.join(String.fromCharCode(10))
}

const TH = 'text-left font-semibold text-ink-3 text-[11px] uppercase tracking-wide py-2 px-2'
const TD = 'py-2 px-2 align-top'

export default function ItemStatsPage() {
  const exams = useStore(s => s.exams)
  const studentProfiles = useStore(s => s.studentProfiles)
  const branches = useStore(s => s.branches)
  const [branch, setBranch] = useState('all')
  const [batch, setBatch] = useState('all')
  const [subject, setSubject] = useState('all')
  const [chapter, setChapter] = useState('all')
  const [sort, setSort] = useState('distractorRatio')
  const [minAttempts, setMinAttempts] = useState(20)
  const [open, setOpen] = useState(null)

  // The threshold is applied INSIDE the calculation only as a flag; the filter
  // below is what the "Min attempts" control actually promises. A row seen by
  // three students is not evidence, and letting it sort to the top of a review
  // queue buries the questions that are.
  // Current membership, not the exam roster and not batch_at_exam — the rule
  // Toppers and Dashboard already use. null means everyone.
  const validNames = useMemo(() => {
    if (batch !== 'all') return getBatchMemberNames(studentProfiles, batch)
    if (branch !== 'all') return getBranchMemberNames(studentProfiles, branch)
    return null
  }, [studentProfiles, branch, batch])

  const { rows } = useMemo(
    () => computeItemStats(exams, { minAttempts, validNames }),
    [exams, minAttempts, validNames]
  )

  // Conflicts are a property of the QUESTION — the same bank question keyed two
  // ways — so they are never cohort-filtered. Narrowing to a batch must not make
  // a wrong key disappear.
  const { keyConflicts } = useMemo(() => computeItemStats(exams), [exams])

  const batchOptions = useMemo(() => getBatchOptions(
    branch === 'all' ? exams : getExamsForBranch(exams, studentProfiles, branch),
    studentProfiles
  ), [exams, studentProfiles, branch])

  const subjects = useMemo(
    () => [...new Set(rows.map(r => r.subject).filter(Boolean))].sort(), [rows]
  )
  const chapters = useMemo(
    () => [...new Set(rows.filter(r => subject === 'all' || r.subject === subject)
      .map(r => r.chapter).filter(Boolean))].sort(), [rows, subject]
  )

  const inScope = useMemo(() => rows.filter(r =>
    (subject === 'all' || r.subject === subject) &&
    (chapter === 'all' || r.chapter === chapter)), [rows, subject, chapter])

  const thin = inScope.filter(r => r.insufficient).length
  // When a cohort has no question above the threshold, an empty table reads as
  // broken. Naming its biggest sample says what actually happened.
  const bestN = inScope.reduce((m, r) => window.Math.max(m, r.attempted), 0)

  const visible = useMemo(() => {
    // A missing value sorts LAST in every mode. "No ratio exists" is not an
    // extreme score, and floating it to the top would bury real evidence.
    return inScope.filter(r => !r.insufficient).slice().sort((a, b) => {
      const av = a[sort]
      const bv = b[sort]
      if (av === null || av === undefined) return 1
      if (bv === null || bv === undefined) return -1
      return ASCENDING.has(sort) ? av - bv : bv - av
    })
  }, [inScope, sort])

  if (rows.length === 0 && keyConflicts.length === 0) {
    return (
      <div>
        <PageHeader title="Question Stats" subtitle="What the answer sheets say about each bank question" />
        <EmptyState
          icon="🔬"
          title="No questions linked to the bank yet"
          message="This reads exams whose questions carry a PYQ Vault id. Upload a paper built in the bank, or re-upload its Tags sheet, and its questions appear here."
        />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Question Stats"
        subtitle="What the answer sheets say about each bank question — pooled across every batch that sat it"
      />

      {keyConflicts.length > 0 && (
        <Card className="mb-4 border-danger">
          <h3 className="text-[14px] font-bold text-danger">
            {keyConflicts.length} question{keyConflicts.length === 1 ? '' : 's'} keyed differently in two sittings
          </h3>
          <p className="text-[12px] text-ink-3 mt-0.5">
            The same bank question was marked with different correct answers. One of them is wrong,
            so nothing is pooled for these until it is settled.
          </p>
          <ul className="mt-2 space-y-1 text-[12px]">
            {keyConflicts.map(c => (
              <li key={c.questionId} className="border border-border rounded-md px-2 py-1.5">
                <div className="line-clamp-2"><RichText>{c.question || c.questionId}</RichText></div>
                <div className="mt-0.5">
                  <span className="text-ink-3">{c.chapter || '—'}</span>
                  {c.keys.map(k => (
                    <span key={k.examId} className="ml-3">
                      <strong className="text-danger">{k.answer}</strong>
                      <span className="text-ink-3"> in {k.examName}</span>
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mb-4">
        <div className="flex flex-wrap gap-4 items-end">
          <label className="text-[12px]">
            <span className="block text-ink-3 mb-1">Branch</span>
            <select
              aria-label="Branch"
              value={branch}
              onChange={e => { setBranch(e.target.value); setBatch('all') }}
              className="border border-border rounded-md px-2 py-1 bg-surface min-h-[36px]"
            >
              <option value="all">All branches</option>
              {(branches || []).map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>

          <label className="text-[12px]">
            <span className="block text-ink-3 mb-1">Batch</span>
            <select
              aria-label="Batch"
              value={batch}
              onChange={e => setBatch(e.target.value)}
              className="border border-border rounded-md px-2 py-1 bg-surface min-h-[36px] max-w-[220px]"
            >
              <option value="all">All batches</option>
              {batchOptions.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>

          <label className="text-[12px]">
            <span className="block text-ink-3 mb-1">Subject</span>
            <select
              aria-label="Subject"
              value={subject}
              onChange={e => { setSubject(e.target.value); setChapter('all') }}
              className="border border-border rounded-md px-2 py-1 bg-surface min-h-[36px]"
            >
              <option value="all">All subjects</option>
              {subjects.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>

          <label className="text-[12px]">
            <span className="block text-ink-3 mb-1">Chapter</span>
            <select
              aria-label="Chapter"
              value={chapter}
              onChange={e => setChapter(e.target.value)}
              className="border border-border rounded-md px-2 py-1 bg-surface min-h-[36px] max-w-[240px]"
            >
              <option value="all">All chapters</option>
              {chapters.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>

          <label className="text-[12px]">
            <span className="block text-ink-3 mb-1">Sort by</span>
            <select
              aria-label="Sort by"
              value={sort}
              onChange={e => setSort(e.target.value)}
              className="border border-border rounded-md px-2 py-1 bg-surface min-h-[36px]"
            >
              {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>

          <label className="text-[12px]">
            <span className="block text-ink-3 mb-1">Min attempts</span>
            <input
              aria-label="Min attempts"
              type="number"
              min="1"
              value={minAttempts}
              onChange={e => setMinAttempts(Number(e.target.value) || 1)}
              className="border border-border rounded-md px-2 py-1 bg-surface w-[90px] min-h-[36px]"
            />
          </label>

          <div className="ml-auto flex gap-2">
            <button
              onClick={() => download('item-stats.json',
                JSON.stringify({ generatedAt: new Date().toISOString(), rows: visible, keyConflicts }, null, 2),
                'application/json')}
              className="btn btn-sm btn-secondary"
            >⬇ JSON</button>
            <button
              onClick={() => download('item-stats.csv', toCsv(visible), 'text/csv')}
              className="btn btn-sm btn-secondary"
            >⬇ CSV</button>
          </div>
        </div>
        <p className="text-[11px] text-ink-3 mt-3">
          {visible.length} question{visible.length === 1 ? '' : 's'} shown
          {validNames && <> · <strong>{batch !== 'all' ? batch : branch} only</strong></>}
          {thin > 0 && <> · {thin} hidden below {minAttempts} attempts</>}
          {' '}· counts only, no student names leave this page. A high distractor ratio is a lead to
          review, not a verdict: an option outpulls the key when the key is wrong, and also when the
          question is hard and the trap is well built. Correct % counts who chose the KEY, which
          differs from the recorded mark only where a sitting was mis-keyed.
        </p>
      </Card>

      <Card className="!p-0 overflow-x-auto">
        <table className="w-full text-[12px] min-w-[860px]">
          <thead className="border-b border-border">
            <tr>
              <th scope="col" className={TH}>Question</th>
              <th scope="col" className={`${TH} text-right w-[80px]`}>Attempts</th>
              <th scope="col" className={`${TH} text-right w-[80px]`}>Correct</th>
              <th scope="col" className={`${TH} text-right w-[80px]`}>Skipped</th>
              <th scope="col" className={`${TH} text-center w-[56px]`}>Key</th>
              <th scope="col" className={`${TH} text-right w-[110px]`}>Vs key</th>
              <th scope="col" className={`${TH} text-right w-[80px]`}>Discrim</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(r => (
            <Fragment key={r.questionId}>
              <tr
                data-testid="item-row"
                onClick={() => setOpen(open === r.questionId ? null : r.questionId)}
                className="border-b border-border last:border-0 hover:bg-bg cursor-pointer align-top"
              >
                <td className={TD}>
                  <div className={open === r.questionId ? '' : 'line-clamp-2'}>
                    <RichText>{r.question || r.questionId}</RichText>
                  </div>
                  <div className="text-[11px] text-ink-3 mt-0.5">
                    {r.chapter || '—'}{r.subtopic ? ` · ${r.subtopic}` : ''}
                    {r.verdictMismatch > 0 && (
                      // Unambiguous, unlike a winning distractor: that sitting was
                      // mis-keyed, or the question was dropped and credited to all.
                      <span className="ml-2 text-danger font-semibold">
                        {`${r.verdictMismatch} marked against the key`}
                      </span>
                    )}
                  </div>
                </td>
                <td className={`${TD} text-right tabular-nums`}>{r.attempted}</td>
                <td className={`${TD} text-right tabular-nums`}>{pct(r.pCorrect)}</td>
                <td className={`${TD} text-right tabular-nums text-ink-2`}>{pct(r.skipRate)}</td>
                <td className={`${TD} text-center font-semibold`}>{r.keyed || '—'}</td>
                <td className={`${TD} text-right tabular-nums`}>
                  {r.topDistractor ? (
                    <span className={r.distractorRatio > 1 ? 'text-danger font-semibold' : 'text-ink-2'}>
                      {r.topDistractor.label} {num(r.distractorRatio, 1)}×
                    </span>
                  ) : '—'}
                </td>
                <td className={`${TD} text-right tabular-nums ${r.discrimination < 0 ? 'text-danger' : 'text-ink-2'}`}>
                  {num(r.discrimination)}
                </td>
              </tr>
              {open === r.questionId && (
                // Full width, not inside the question cell: a key cannot be
                // judged from the stem, so the reviewer gets the same card the
                // rest of the app uses — options, the key highlighted, and the
                // solution behind its toggle.
                <tr data-testid="item-detail" className="border-b border-border bg-bg">
                  <td colSpan={7} className="px-2 py-3">
                    <div className="flex flex-wrap gap-4 text-[12px] mb-2">
                      {LABELS.map(l => (
                        <span key={l} className={l === r.keyed ? 'font-semibold text-accent' : 'text-ink-2'}>
                          {l}: {r.choiceCounts[l]}{l === r.keyed ? ' (key)' : ''}
                        </span>
                      ))}
                      <span className="text-ink-3">
                        seen {r.seen} · attempted {r.attempted} · skipped {r.skipped} · in{' '}
                        {r.exams.map(e => e.name).join(', ')}
                      </span>
                      {r.verdictMismatch > 0 && (
                        <span className="text-danger">
                          {`${r.verdictMismatch} attempt(s) were marked against this key — that sitting was mis-keyed, or the question was dropped and credited to everyone. Correct % counts the KEY, not the mark.`}
                        </span>
                      )}
                    </div>
                    {/* No examId on purpose: editing writes to ONE exam record,
                        and a pooled question lives in several — fixing the key in
                        one would manufacture the very conflict this page reports. */}
                    {r.source && <QuestionCard q={r.source} />}
                  </td>
                </tr>
              )}
            </Fragment>
            ))}
          </tbody>
        </table>

        {visible.length === 0 && (
          <p className="text-[13px] text-ink-3 px-4 py-6 text-center">
            Nothing above {minAttempts} attempts in this scope
            {thin > 0 && <> — {thin} question{thin === 1 ? '' : 's'} are below it</>}.
            {bestN > 0 && (
              <> The largest sample here is <strong>{bestN}</strong>
                {validNames && <> — a single batch sits far fewer papers than the school does</>}.
              </>
            )}
          </p>
        )}
      </Card>
    </div>
  )
}
