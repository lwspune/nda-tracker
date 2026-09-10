// Error Sets — per-student Word documents of every question a student got
// wrong or skipped over a range of exams, downloaded one at a time or as a
// batch ZIP. Faculty-facing (admin + teacher): students can already see their
// wrong/skipped questions in the app, so this exists to put paper in a hand.
//
// Two things drive the layout, both learned from the data:
//
// 1. A 30-day window on a senior batch is a MEDIAN OF ~1,000 questions per
//    student — a 100+ page document nobody works through. So the cap defaults
//    to 150, and every count is shown BEFORE the build, not after.
//
// 2. The range finds candidate exams but does not commit to them. Faculty
//    think in papers, so the matched exams are a checklist: a chapter test that
//    would skew the set is one untick away, and what feeds the document is
//    visible before anything is generated.

import { useMemo, useState } from 'react'
import useStore from '../../store/useStore'
import { getMonthlyReportCohort } from '../../lib/monthlyReportBuilder'
import { defaultErrorSetRange, selectErrorSetExams } from '../../lib/errorSetSelect'
import { buildGatErrorSet } from '../../lib/gatErrorSet'
import { findAbsentExams } from '../../lib/practiceSet'
import { buildGatErrorSetDocx, errorSetFilename } from '../../lib/gatErrorSetDocx'
import { downloadErrorSetsZip, errorSetsZipFilename } from '../../lib/errorSetZip'
import { isStaleChunkError, STALE_CHUNK_MESSAGE } from '../../lib/chunkError'
import ErrorSetRow from './ErrorSetRow'

const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Below this a document isn't worth printing — the student is told to revise
// four questions. Such rows are listed and counted, just unticked by default.
const MIN_QUESTIONS = 5

const SUBJECTS = ['Maths', 'GAT', 'English', 'Physics', 'Chemistry', 'Biology',
  'Geography', 'History', 'Polity', 'Economics']

// Presentation only — the ZIP name and the document header.
function rangeLabel(from, to) {
  if (!from || !to) return ''
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const left = fy === ty ? `${fd} ${SHORT_MONTHS[fm - 1]}` : `${fd} ${SHORT_MONTHS[fm - 1]} ${fy}`
  return `${left} - ${td} ${SHORT_MONTHS[tm - 1]} ${ty}`
}

export default function ErrorSetsPage() {
  const exams                 = useStore(s => s.exams)
  const studentProfiles       = useStore(s => s.studentProfiles)
  const syllabusBatches       = useStore(s => s.syllabusBatches)
  const syllabusBatchBranches = useStore(s => s.syllabusBatchBranches)
  const branches              = useStore(s => s.branches)

  const opening = useMemo(() => defaultErrorSetRange(), [])
  const [from, setFrom] = useState(opening.from)
  const [to, setTo] = useState(opening.to)
  const [branch, setBranch] = useState('')
  const [batch, setBatch] = useState('')
  const [subject, setSubject] = useState('Maths')

  // Tracked as the EXCLUSIONS rather than the selections, so an exam that
  // appears when the range widens is included by default without an effect
  // syncing two pieces of state.
  const [unticked, setUnticked] = useState(() => new Set())
  const [excluded, setExcluded] = useState(() => new Set())

  const [includeAbsent, setIncludeAbsent] = useState(false)
  const [includeSolutions, setIncludeSolutions] = useState(false)
  const [cap, setCap] = useState('150')

  const [generated, setGenerated] = useState(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')

  const batchOptions = useMemo(() => {
    const all = syllabusBatches || []
    const map = syllabusBatchBranches || {}
    return branch ? all.filter(b => map[b] === branch) : all
  }, [syllabusBatches, syllabusBatchBranches, branch])

  const rangeInvalid = !from || !to || from > to

  // Live: the checklist tracks the scope controls with no extra button.
  const examRows = useMemo(() =>
    batch && !rangeInvalid
      ? selectErrorSetExams({ exams, from, to, subject, batch })
      : []
  , [exams, from, to, subject, batch, rangeInvalid])

  const chosenExams = useMemo(() =>
    examRows.filter(r => r.eligible && !unticked.has(r.id)).map(r => r.exam)
  , [examRows, unticked])

  const cohort = useMemo(() =>
    batch && !rangeInvalid ? getMonthlyReportCohort(studentProfiles, batch, to) : []
  , [studentProfiles, batch, to, rangeInvalid])

  function clearResults() {
    setGenerated(null)
    setError('')
  }

  function toggleExam(id) {
    setUnticked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
    clearResults()
  }

  function handleGenerate() {
    if (!batch || rangeInvalid || chosenExams.length === 0) return
    setError('')
    const limit = Number(cap) > 0 ? Number(cap) : 0
    const rows = cohort.map(profile => {
      const names = [profile.name, ...(profile.nameVariants || [])].filter(Boolean)
      const absentExams = includeAbsent
        ? findAbsentExams({ exams: chosenExams, names, batches: profile.batches || [] })
        : []
      const set = buildGatErrorSet({
        exams: chosenExams,
        names,
        absentExams,
        // Only a combined paper carries several subjects at question level; on a
        // single-subject paper every question already matches, so this is a
        // no-op rather than a second filter to keep in step.
        qSubject: '',
        cap: limit,
      })
      return {
        profile,
        subjects: set.subjects,
        totals: set.totals,
        thin: set.totals.questions < MIN_QUESTIONS,
      }
    })
    setGenerated(rows)
    setExcluded(new Set(rows.filter(r => r.thin).map(r => r.profile.lwsId)))
  }

  function toggleStudent(lwsId) {
    setExcluded(prev => {
      const next = new Set(prev)
      if (next.has(lwsId)) next.delete(lwsId); else next.add(lwsId)
      return next
    })
  }

  const label = rangeLabel(from, to)
  const included = (generated || []).filter(r => !excluded.has(r.profile.lwsId))

  const itemFor = row => ({
    studentName: row.profile.name,
    subject,
    subjects: row.subjects,
    totals: row.totals,
    meta: { batch, rangeLabel: label, exams: chosenExams.length },
    filename: errorSetFilename(row.profile.name, label),
  })

  async function handleDownloadOne(row) {
    setBusy(true)
    setError('')
    try {
      const item = itemFor(row)
      const blob = await buildGatErrorSetDocx({ ...item, includeSolutions })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = item.filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error(e)
      setError(isStaleChunkError(e) ? STALE_CHUNK_MESSAGE : 'Failed to build the document. Try again.')
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  async function handleBulkZip() {
    if (included.length === 0) return
    setBusy(true)
    setError('')
    try {
      await downloadErrorSetsZip(
        included.map(itemFor),
        errorSetsZipFilename(batch, label),
        {
          includeSolutions,
          onProgress: ({ done, total, studentName, label: stage }) =>
            setProgress(`Building ${Math.min(done + 1, total)} of ${total} — ${studentName}${stage ? ` · ${stage}` : ''}`),
        },
      )
    } catch (e) {
      console.error(e)
      setError(isStaleChunkError(e) ? STALE_CHUNK_MESSAGE : 'Failed to build the ZIP archive. Try again.')
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  const counts = included.map(r => r.totals.questions)
  const spread = counts.length
    ? (Math.min(...counts) === Math.max(...counts)
      ? `${counts[0]} questions each`
      : `${Math.min(...counts)}–${Math.max(...counts)} questions each`)
    : ''

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-[20px] font-extrabold text-ink mb-1">Error Sets</h1>
        <p className="text-[12px] text-ink-3">
          Per-student Word documents of every question a student got wrong or skipped,
          over the exams you pick. Hand them out on paper, then test them on it.
        </p>
      </div>

      {/* ── Scope ─────────────────────────────────────────────── */}
      <div className="card p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[140px]">
            <label htmlFor="es-from" className="form-label mb-1.5">From</label>
            <input id="es-from" type="date" value={from} max={to || undefined}
              onChange={e => { setFrom(e.target.value); clearResults() }}
              className="form-input text-[13px]" />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label htmlFor="es-to" className="form-label mb-1.5">To</label>
            <input id="es-to" type="date" value={to} min={from || undefined}
              onChange={e => { setTo(e.target.value); clearResults() }}
              className="form-input text-[13px]" />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label htmlFor="es-subject" className="form-label mb-1.5">Subject</label>
            <select id="es-subject" value={subject}
              onChange={e => { setSubject(e.target.value); clearResults() }}
              className="form-input text-[13px]">
              {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[150px]">
            <label htmlFor="es-branch" className="form-label mb-1.5">Branch</label>
            <select id="es-branch" value={branch}
              onChange={e => { setBranch(e.target.value); setBatch(''); clearResults() }}
              className="form-input text-[13px]">
              <option value="">All branches</option>
              {(branches || []).map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="es-batch" className="form-label mb-1.5">Batch</label>
            <select id="es-batch" value={batch}
              onChange={e => { setBatch(e.target.value); clearResults() }}
              className="form-input text-[13px]">
              <option value="">— select —</option>
              {batchOptions.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* ── Exams in range ────────────────────────────────────── */}
      {batch && (
        <div className="card p-4 mb-4">
          <div className="text-[12px] font-bold text-ink mb-2">
            Exams in range — {chosenExams.length} of {examRows.filter(r => r.eligible).length} selected
          </div>
          {examRows.length === 0 ? (
            <div className="text-[12px] text-ink-3">
              No {subject} exams for this batch between {from} and {to}.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {examRows.map(r => (
                <label key={r.id} data-testid="errorset-exam"
                  className={`flex flex-wrap items-center gap-3 py-2 text-[12px]
                             ${r.eligible ? 'cursor-pointer' : 'opacity-60'}`}>
                  <input
                    type="checkbox"
                    disabled={!r.eligible}
                    checked={r.eligible && !unticked.has(r.id)}
                    onChange={() => toggleExam(r.id)}
                    className="w-4 h-4 accent-accent flex-shrink-0
                               disabled:cursor-not-allowed"
                  />
                  <span data-testid="exam-name" className="font-semibold text-ink flex-1 min-w-[160px]">
                    {r.name}
                  </span>
                  <span className="text-ink-3 tabular-nums">{r.date}</span>
                  <span className="text-ink-3 tabular-nums min-w-[60px]">{r.questionCount} Q</span>
                  <span className="text-ink-3 tabular-nums min-w-[60px]">{r.satCount} sat</span>
                  {!r.eligible && <span className="text-amber-600">⚠ {r.reason}</span>}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Contents ──────────────────────────────────────────── */}
      <div className="card p-4 mb-4">
        <div className="text-[12px] font-bold text-ink mb-2">Contents</div>
        <div className="flex flex-wrap items-end gap-5">
          <label className="flex items-center gap-2 text-[12px] text-ink cursor-pointer">
            <input type="checkbox" checked={includeAbsent}
              onChange={e => { setIncludeAbsent(e.target.checked); clearResults() }}
              className="w-4 h-4 accent-accent" />
            Include exams they missed
          </label>
          <label className="flex items-center gap-2 text-[12px] text-ink cursor-pointer">
            <input type="checkbox" checked={includeSolutions}
              onChange={e => setIncludeSolutions(e.target.checked)}
              className="w-4 h-4 accent-accent" />
            Include solutions
          </label>
          <div className="min-w-[150px]">
            <label htmlFor="es-cap" className="form-label mb-1.5">Cap per student</label>
            <input id="es-cap" type="number" min="0" value={cap}
              onChange={e => { setCap(e.target.value); clearResults() }}
              className="form-input text-[13px]" />
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!batch || rangeInvalid || chosenExams.length === 0 || cohort.length === 0}
            className="btn btn-primary text-[13px] min-h-[44px] px-5
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Generate
          </button>
        </div>
        {includeSolutions && (
          <p className="text-[11px] text-ink-3 mt-2">
            Solutions print as a separate section at the back, so a student has to
            commit to an answer before turning to them.
          </p>
        )}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-[12px] text-red-800">
          {error}
        </div>
      )}

      {/* ── Results ───────────────────────────────────────────── */}
      {generated && (
        <div className="card p-0 overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 px-3 py-3 border-b border-border bg-surface-2">
            <div className="flex-1 min-w-[200px] text-[12px] font-bold text-ink">
              {included.length} of {generated.length} students{spread ? ` · ${spread}` : ''}
            </div>
            {progress && <div className="text-[11px] text-ink-3">{progress}</div>}
            <button
              type="button"
              onClick={handleBulkZip}
              disabled={busy || included.length === 0}
              className="btn btn-primary text-[12px] min-h-[38px] px-4
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? 'Building…' : 'Download ZIP'}
            </button>
          </div>
          {generated.map(row => (
            <ErrorSetRow
              key={row.profile.lwsId}
              row={row}
              included={!excluded.has(row.profile.lwsId)}
              onToggle={toggleStudent}
              onDownload={handleDownloadOne}
              busy={busy}
            />
          ))}
        </div>
      )}
    </div>
  )
}
