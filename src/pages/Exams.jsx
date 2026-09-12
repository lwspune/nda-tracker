import { useMemo, useState } from 'react'
import useStore from '../store/useStore'
import { supabase } from '../lib/supabase'
import { PageHeader, EmptyState, Card, Badge } from '../components/ui'
import { getBatchOptions, getExamsForBatch, examMaxMarks, examFormat, examFormatLabel } from '../lib/analytics'
import { useMode } from '../context/ModeContext'
import ReuploadTagsModal    from '../components/upload/ReuploadTagsModal'
import RefreshFromBankModal from '../components/upload/RefreshFromBankModal'
import { bankQuestionIds } from '../lib/bankFetch'
import ReuploadResultsModal from '../components/upload/ReuploadResultsModal'
import OfflineExamModal     from '../components/upload/OfflineExamModal'
import ExamInsightsPanel    from './Exams/ExamInsightsPanel'
import ExamIntegrityPanel   from './Exams/ExamIntegrityPanel'
import WhatsAppResultsModal  from './Exams/WhatsAppResultsModal'
import WhatsAppPreviewModal  from './Exams/WhatsAppPreviewModal'
import ExamAbsencePreviewModal from './Exams/ExamAbsencePreviewModal'
import { downloadExamPdf }         from '../lib/examPdf'
import { downloadStudentReportsPdf } from '../lib/studentReportPdf'
import ExportMenu from './Exams/ExportMenu'
import { isStaleChunkError, STALE_CHUNK_MESSAGE } from '../lib/chunkError'

export default function ExamsPage() {
  const exams = useStore(s => s.exams)
  const studentProfiles = useStore(s => s.studentProfiles)
  const deleteExam = useStore(s => s.deleteExam)
  const openUploadModal = useStore(s => s.openUploadModal)
  const bulkUpdateStudentContacts  = useStore(s => s.bulkUpdateStudentContacts)
  const whatsappSendHistory        = useStore(s => s.whatsappSendHistory)
  const setWhatsappSendHistory     = useStore(s => s.setWhatsappSendHistory)
  const monitorMobiles             = useStore(s => s.monitorMobiles)
  const timetableTeachers          = useStore(s => s.timetableTeachers)

  // created_by stores the auth email (the only identity a session has); show
  // the teacher's name where one matches, falling back to the email itself.
  const examAuthorName = useMemo(() => {
    const byEmail = new Map(
      (timetableTeachers ?? [])
        .filter(t => t?.email)
        .map(t => [String(t.email).trim().toLowerCase(), t.name])
    )
    return email => byEmail.get(String(email ?? '').trim().toLowerCase()) || email
  }, [timetableTeachers])
  const examAbsenceSendHistory     = useStore(s => s.examAbsenceSendHistory)
  const setExamAbsenceSendHistory  = useStore(s => s.setExamAbsenceSendHistory)
  const markExamAbsencesNotified   = useStore(s => s.markExamAbsencesNotified)
  const mode = useMode()

  const [subjectFilter, setSubjectFilter] = useState('all')
  const [branchFilter, setBranchFilter]   = useState('all')
  const [batchFilter, setBatchFilter]     = useState('all')
  const [sortBy, setSortBy]               = useState('date-desc')
  const [page, setPage]                   = useState(0)

  const PAGE_SIZE = 10
  const [reuploadTagsExam, setReuploadTagsExam]       = useState(null)
  const [refreshBankExam, setRefreshBankExam]         = useState(null)
  const [reuploadResultsExam, setReuploadResultsExam] = useState(null)
  const [offlineModalOpen, setOfflineModalOpen]       = useState(false)
  const [editMarksExam, setEditMarksExam]             = useState(null)
  const [expandedExamId, setExpandedExamId]           = useState(null)
  const [integrityExamId, setIntegrityExamId]         = useState(null)
  const [pdfGenerating, setPdfGenerating]             = useState(null)
  const [reportsGenerating, setReportsGenerating]     = useState(null)
  const [wordGenerating, setWordGenerating]           = useState(null)
  const [wordSolutions, setWordSolutions]             = useState(true)
  const [exportError, setExportError]                 = useState('')
  const [whatsappPreviewExam, setWhatsappPreviewExam] = useState(null)
  const [whatsappSending, setWhatsappSending]         = useState(false)
  const [whatsappResult, setWhatsappResult]           = useState(null)
  const [examAbsencePreviewExam, setExamAbsencePreviewExam] = useState(null)
  const [examAbsenceSending, setExamAbsenceSending]         = useState(false)
  const [examAbsenceResult, setExamAbsenceResult]           = useState(null)

  // What this exam can actually be exported as. An export it cannot support is
  // left OUT of the list rather than shown disabled (EXAM_REPORT_DOCX.md D5).
  //
  // Word is MCQ-only (D2): a written paper records a total and nothing else, so
  // the document would carry nothing its PDF does not already carry well. Gated
  // on `examFormat`, the same predicate Update Results / Update Tags / Integrity
  // / Reports already use — not on `source`, which tags who entered the marks.
  function buildExportItems(exam) {
    if (!exam.students.length) return []
    const mcq = examFormat(exam) === 'mcq'
    const items = [{
      key: 'pdf',
      label: '📄 PDF',
      hint: 'class report · fixed layout',
      busy: pdfGenerating === exam.id,
      onSelect: () => runExport(setPdfGenerating, exam.id, () => downloadExamPdf(exam)),
    }]
    if (mcq) {
      items.push({
        key: 'word',
        label: '📝 Word',
        hint: 'class report · editable equations',
        busy: wordGenerating === exam.id,
        onSelect: () => runExport(setWordGenerating, exam.id, async () => {
          // Lazy: docx + jszip are large, and only a click should pay for them.
          const { downloadExamReportDocx } = await import('../lib/examReportDocx')
          await downloadExamReportDocx({ exam, includeSolutions: wordSolutions })
        }),
      })
      items.push({
        key: 'reports',
        label: '📋 Student Reports',
        hint: 'one per-question breakdown per student',
        busy: reportsGenerating === exam.id,
        onSelect: () => runExport(setReportsGenerating, exam.id,
          () => downloadStudentReportsPdf(exam)),
      })
    }
    return items
  }

  // The 50ms yield is what lets the busy label paint before the build seizes
  // the main thread; the finally is what stops a throw leaving it spinning.
  async function runExport(setBusy, id, run) {
    setBusy(id)
    setExportError('')
    await new Promise(r => setTimeout(r, 50))
    try {
      await run()
    } catch (e) {
      console.error('[exams] export failed:', e)
      setExportError(isStaleChunkError(e) ? STALE_CHUNK_MESSAGE : 'Could not build the file. Try again.')
    } finally {
      setBusy(null)
    }
  }

  function toggleInsights(id) {
    setExpandedExamId(prev => prev === id ? null : id)
  }

  function toggleIntegrity(id) {
    setIntegrityExamId(prev => prev === id ? null : id)
  }

  function parseFailedNames(lines) {
    const names = new Set()
    ;(lines || []).forEach(line => {
      const t = line.trim()
      const skip = t.match(/^SKIP (.+?) —/)
      if (skip) { names.add(skip[1]); return }
      const fail = t.match(/^FAIL → (.+?) \(student/)
      if (fail) names.add(fail[1])
    })
    return [...names]
  }

  // Absence flow log format mirrors late/lecture-miss — captures FAIL on either
  // leg (`(student` / `(parent`), SKIP for no-mobile (`— no mobile` / `— no parent mobile`),
  // and SKIP for malformed parent numbers (`parent NUMBER —`).
  function parseFailedNamesAbsence(lines) {
    const names = new Set()
    ;(lines || []).forEach(line => {
      const t = line.trim()
      const fail = t.match(/^FAIL → (.+?) \((student|parent)/)
      if (fail) { names.add(fail[1]); return }
      const skipParent = t.match(/^SKIP (.+?) parent /)
      if (skipParent) { names.add(skipParent[1]); return }
      const skip = t.match(/^SKIP (.+?) —/)
      if (skip) names.add(skip[1])
    })
    return [...names]
  }

  async function handleExamAbsenceConfirm(edits, redirectTo) {
    const exam = examAbsencePreviewExam
    setExamAbsenceSending(true)
    try {
      const body = { examName: exam.name, students: edits }
      if (redirectTo) body.redirectTo = redirectTo
      const session = supabase ? (await supabase.auth.getSession()).data.session : null
      const headers = { 'Content-Type': 'application/json' }
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
      const res = await fetch('/api/send-exam-absence', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const result = await res.json()
      if (result.ok) {
        const failedSet = new Set(parseFailedNamesAbsence(result.lines))
        setExamAbsenceSendHistory(exam.id, {
          sentAt:      new Date().toISOString(),
          sent:        result.sent,
          skipped:     result.skipped,
          failedNames: [...failedSet],
        })
        // Mark exam_absences.notified_at for students with no failed leg.
        const notifiedLwsIds = edits
          .filter(e => e.lwsId && !failedSet.has(e.name))
          .map(e => e.lwsId)
        if (notifiedLwsIds.length > 0 && typeof markExamAbsencesNotified === 'function') {
          markExamAbsencesNotified(exam.id, notifiedLwsIds)
        }
      }
      setExamAbsencePreviewExam(null)
      setExamAbsenceResult({ examName: exam.name, ...result })
    } catch (e) {
      setExamAbsencePreviewExam(null)
      setExamAbsenceResult({ examName: exam.name, ok: false, error: e.message })
    } finally {
      setExamAbsenceSending(false)
    }
  }

  async function handleWhatsAppConfirm(edits, redirectTo, studentNames) {
    const exam = whatsappPreviewExam
    setWhatsappSending(true)
    try {
      await bulkUpdateStudentContacts(edits)
      const body = { examName: exam.name }
      if (redirectTo)   body.redirectTo = redirectTo
      if (studentNames) body.students   = studentNames
      if (monitorMobiles?.length) body.monitorMobiles = monitorMobiles
      const session = supabase ? (await supabase.auth.getSession()).data.session : null
      const headers = { 'Content-Type': 'application/json' }
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
      const res = await fetch('/api/send-whatsapp', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const result = await res.json()
      if (result.ok) {
        setWhatsappSendHistory(exam.id, {
          sentAt:      new Date().toISOString(),
          sent:        result.sent,
          skipped:     result.skipped,
          failedNames: parseFailedNames(result.lines),
        })
      }
      setWhatsappPreviewExam(null)
      setWhatsappResult({ examName: exam.name, ...result })
    } catch (e) {
      setWhatsappPreviewExam(null)
      setWhatsappResult({ examName: exam.name, ok: false, error: e.message })
    } finally {
      setWhatsappSending(false)
    }
  }

  const availableSubjects = [...new Set(exams.map(e => e.subject || 'Maths'))].sort()

  const subjectFiltered = subjectFilter === 'all'
    ? exams
    : exams.filter(e => (e.subject || 'Maths') === subjectFilter)

  const availableBranches = [...new Set(subjectFiltered.map(e => e.branch).filter(Boolean))].sort()

  const branchFiltered = branchFilter === 'all'
    ? subjectFiltered
    : subjectFiltered.filter(e => e.branch === branchFilter)

  const availableBatches = getBatchOptions(branchFiltered, studentProfiles)

  const filteredExams = batchFilter === 'all'
    ? branchFiltered
    : getExamsForBatch(branchFiltered, studentProfiles, batchFilter)

  const sortedExams = [...filteredExams].sort((a, b) => {
    if (sortBy === 'date-desc') return b.date.localeCompare(a.date)
    if (sortBy === 'date-asc')  return a.date.localeCompare(b.date)
    if (sortBy === 'subject')   return (a.subject || 'Maths').localeCompare(b.subject || 'Maths')
    return 0
  })

  const totalPages  = Math.ceil(sortedExams.length / PAGE_SIZE)
  const visibleExams = sortedExams.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  function goToPage(p) {
    setPage(p)
    setExpandedExamId(null)
    setIntegrityExamId(null)
  }

  const isFiltered = subjectFilter !== 'all' || branchFilter !== 'all' || batchFilter !== 'all'
  const countLabel = isFiltered
    ? `${filteredExams.length} of ${exams.length} exams`
    : `${exams.length} exams`

  return (
    <div>
      <PageHeader
        title="Exams"
        sub={countLabel}
        actions={exams.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              aria-label="Sort exams"
              value={sortBy}
              onChange={e => { setSortBy(e.target.value); setPage(0) }}
              className="form-input w-auto text-[13px] pr-8 cursor-pointer"
              style={{ minWidth: '160px' }}
            >
              <option value="date-desc">Date (newest first)</option>
              <option value="date-asc">Date (oldest first)</option>
              <option value="subject">Subject (A–Z)</option>
            </select>
            <select
              aria-label="Subject filter"
              value={subjectFilter}
              onChange={e => { setSubjectFilter(e.target.value); setBranchFilter('all'); setBatchFilter('all'); setPage(0) }}
              className="form-input w-auto text-[13px] pr-8 cursor-pointer"
              style={{ minWidth: '160px' }}
            >
              <option value="all">All Subjects</option>
              {availableSubjects.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {availableBranches.length > 0 && (
              <select
                aria-label="Branch filter"
                value={branchFilter}
                onChange={e => { setBranchFilter(e.target.value); setBatchFilter('all'); setPage(0) }}
                className="form-input w-auto text-[13px] pr-8 cursor-pointer"
                style={{ minWidth: '140px' }}
              >
                <option value="all">All Branches</option>
                {availableBranches.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            )}
            {availableBatches.length > 0 && (
              <select
                aria-label="Batch filter"
                value={batchFilter}
                onChange={e => { setBatchFilter(e.target.value); setPage(0) }}
                className="form-input w-auto text-[13px] pr-8 cursor-pointer"
                style={{ minWidth: '140px' }}
              >
                <option value="all">All Batches</option>
                {availableBatches.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            )}
            {mode === 'admin' && (
              <>
                <button onClick={() => setOfflineModalOpen(true)} className="btn btn-secondary">
                  + Offline marks
                </button>
                <button onClick={openUploadModal} className="btn btn-primary">
                  + Add Exam
                </button>
              </>
            )}
          </div>
        )}
      />

      {/* A download that silently does nothing is indistinguishable from a slow
          one, so a failed build says so rather than just resetting the label. */}
      {exportError && (
        <div role="alert" className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-danger">
          {exportError}
        </div>
      )}

      {exams.length === 0 ? (
        <EmptyState icon="📝" title="No exams yet" sub="Upload your first results Excel to get started" />
      ) : (
        <div className="flex flex-col gap-3">
          {visibleExams.map(exam => {
            const maxMarks = examMaxMarks(exam)
            const scores   = exam.students.map(st => st.totalMarks)
            const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
            const minScore = scores.length ? Math.min(...scores) : 0
            const maxScore = scores.length ? Math.max(...scores) : 0
            const pct = v => maxMarks > 0 ? Math.round(v / maxMarks * 100) : 0
            const avgPct = pct(avgScore)
            const pctColor = p => p >= 70 ? 'text-success' : p >= 45 ? 'text-warning' : 'text-danger'

            const isExpanded = expandedExamId === exam.id
            const isIntegrityOpen = integrityExamId === exam.id
            const isMcq = examFormat(exam) === 'mcq'

            return (
              <Card key={exam.id} data-testid="exam-card" className="!p-0 overflow-hidden hover:border-accent/40 transition-colors">
                {/* ── Main exam row ── */}
                <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 xl:gap-4 px-4 py-3">
                  <div className="flex-1 min-w-0 xl:min-w-[240px]">
                    <div className="font-bold text-[14px] text-ink truncate flex items-center gap-2">
                      {exam.name}
                      {/* Was labelled "Offline", which every exam here is —
                          Evalbee grades a paper MCQ sheet. The real split is
                          per-question data vs a hand-graded total. */}
                      <span className="text-[9px] font-bold uppercase tracking-wide bg-surface-2 text-ink-3 border border-border rounded-full px-2 py-0.5">
                        {examFormatLabel(exam)}
                      </span>
                    </div>
                    <div className="flex items-center flex-wrap gap-3 mt-1 text-[11px] font-mono text-ink-3">
                      <span>{exam.date}</span>
                      {/* Review-after, not approve-before: teachers create their
                          own Written Quizzes, so the office needs to see whose. */}
                      {exam.createdBy && (
                        <>
                          <span>·</span>
                          <span title={exam.createdBy}>by {examAuthorName(exam.createdBy)}</span>
                        </>
                      )}
                      <span>·</span>
                      <span>{exam.students.length} students</span>
                      <span>·</span>
                      {exam.questions.length > 0 ? (
                        <>
                          <span>{exam.questions.length} questions</span>
                          <span>·</span>
                          <span>+{exam.marking.correct}/{exam.marking.wrong}</span>
                        </>
                      ) : (
                        <span>max {maxMarks} · total marks only</span>
                      )}
                      {exam.batch && <><span>·</span><span className="text-accent">{exam.batch}</span></>}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 xl:gap-4 flex-wrap xl:justify-end min-w-0">
                    {/* Min / Avg / Max */}
                    {scores.length > 0 && (
                      <div className="flex items-end gap-4">
                        <div className="text-center">
                          <div className="text-[10px] text-ink-3 uppercase tracking-wide font-bold mb-0.5">Min</div>
                          <div className={`text-[17px] font-extrabold font-mono ${pctColor(pct(minScore))}`}>
                            {pct(minScore)}%
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-[10px] text-ink-3 uppercase tracking-wide font-bold mb-0.5">Avg</div>
                          <div className={`text-[17px] font-extrabold font-mono ${pctColor(avgPct)}`}>
                            {avgPct}%
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-[10px] text-ink-3 uppercase tracking-wide font-bold mb-0.5">Max</div>
                          <div className={`text-[17px] font-extrabold font-mono ${pctColor(pct(maxScore))}`}>
                            {pct(maxScore)}%
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Insights toggle — written exams get a format-specific
                        view inside the panel, so this is gated on results only. */}
                    {exam.students.length > 0 && (
                      <button
                        onClick={() => toggleInsights(exam.id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] rounded-lg text-[12px]
                                    font-semibold border transition-all flex-shrink-0
                          ${isExpanded
                            ? 'bg-accent text-white border-accent'
                            : 'bg-surface-2 text-ink-2 border-border hover:bg-accent-soft hover:text-accent hover:border-accent/30'
                          }`}
                      >
                        📊 Insights {isExpanded ? '▲' : '▼'}
                      </button>
                    )}

                    {/* Integrity (copying detection) toggle — admin + teacher */}
                    {mode !== 'student' && exam.students.length > 0 && exam.questions.length > 0 && (
                      <button
                        onClick={() => toggleIntegrity(exam.id)}
                        title="Answer-similarity / copying analysis"
                        className={`flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] rounded-lg text-[12px]
                                    font-semibold border transition-all flex-shrink-0
                          ${isIntegrityOpen
                            ? 'bg-danger text-white border-danger'
                            : 'bg-surface-2 text-ink-2 border-border hover:bg-red-50 hover:text-danger hover:border-red-300'
                          }`}
                      >
                        🕵 Integrity {isIntegrityOpen ? '▲' : '▼'}
                      </button>
                    )}

                    {/* Downloads. A menu rather than three buttons — the card
                        was already carrying nine. An export the exam cannot
                        support is ABSENT from the list, never disabled. */}
                    <ExportMenu
                      items={buildExportItems(exam)}
                      footer={exam.students.length > 0 && exam.questions.length > 0 ? (
                        <label className="flex items-center gap-2 px-3 py-2 text-[11px] text-ink-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={wordSolutions}
                            onChange={e => setWordSolutions(e.target.checked)}
                            className="accent-accent"
                          />
                          Include worked solutions in Word
                        </label>
                      ) : null}
                    />

                    {mode === 'admin' && (
                      <div className="flex items-center gap-1 flex-shrink-0 flex-wrap">
                        {exam.students.length > 0 && (() => {
                          const history = whatsappSendHistory[exam.id]
                          return (
                            <button
                              onClick={() => setWhatsappPreviewExam(exam)}
                              className="btn btn-sm btn-secondary text-[11px] min-h-[44px]
                                         hover:bg-green-50 hover:text-green-700 hover:border-green-300"
                              title={history ? `Last sent: ${new Date(history.sentAt).toLocaleString()}` : 'WhatsApp results to students and parents'}
                            >
                              {history
                                ? `💬 Sent ${history.sent}✓ ${history.skipped}✗ · Resend`
                                : '💬 WhatsApp Results'}
                            </button>
                          )
                        })()}
                        {(() => {
                          const history = examAbsenceSendHistory[exam.id]
                          return (
                            <button
                              onClick={() => setExamAbsencePreviewExam(exam)}
                              className="btn btn-sm btn-secondary text-[11px] min-h-[44px]
                                         hover:bg-red-50 hover:text-red-700 hover:border-red-300"
                              title={history ? `Last sent: ${new Date(history.sentAt).toLocaleString()}` : 'WhatsApp absence alert to parents'}
                            >
                              {history
                                ? `📵 Sent ${history.sent}✓ ${history.skipped}✗ · Resend`
                                : '📵 Send Absent Alert'}
                            </button>
                          )
                        })()}
                        {/* Both re-upload paths are MCQ-only by construction:
                            the results modal parses an Evalbee sheet, which a
                            hand-graded paper has no equivalent of, and the tags
                            modal merges over exam.questions — [] for a written
                            exam, so it could only ever write back nothing.
                            Written exams correct their marks in the grid. */}
                        {isMcq ? (
                          <>
                            <button
                              onClick={() => setReuploadResultsExam(exam)}
                              className="btn btn-sm btn-secondary text-[11px] min-h-[44px]"
                              title="Re-upload results Excel"
                            >
                              📊 Update Results
                            </button>
                            <button
                              onClick={() => setReuploadTagsExam(exam)}
                              className="btn btn-sm btn-secondary text-[11px] min-h-[44px]"
                              title="Re-upload tags Excel"
                            >
                              🏷️ Update Tags
                            </button>
                            {/* Only for papers carrying PYQ Vault ids — there is
                                nothing to pull otherwise, and a button that cannot
                                work is worse than a missing one. */}
                            {bankQuestionIds(exam).length > 0 && (
                              <button
                                onClick={() => setRefreshBankExam(exam)}
                                className="btn btn-sm btn-secondary text-[11px] min-h-[44px]"
                                title="Pull question content (diagrams, solutions) from PYQ Vault"
                              >
                                🔄 Refresh from bank
                              </button>
                            )}
                          </>
                        ) : (
                          <button
                            onClick={() => setEditMarksExam(exam)}
                            className="btn btn-sm btn-secondary text-[11px] min-h-[44px]"
                            title="Edit the marks for this exam"
                          >
                            ✏️ Edit marks
                          </button>
                        )}
                        <button
                          onClick={() => confirm(`Delete "${exam.name}"?`) && deleteExam(exam.id)}
                          className="text-ink-3 hover:text-danger text-[18px] transition-colors
                                     min-h-[44px] w-[44px] flex items-center justify-center"
                          aria-label={`Delete exam ${exam.name}`}
                          title="Delete exam"
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Insights panel ── */}
                {isExpanded && <ExamInsightsPanel exam={exam} studentProfiles={studentProfiles} />}

                {/* ── Integrity panel ── */}
                {isIntegrityOpen && <ExamIntegrityPanel exam={exam} />}
              </Card>
            )
          })}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 pt-2 pb-1">
              <button
                aria-label="Previous page"
                onClick={() => goToPage(page - 1)}
                disabled={page === 0}
                className="btn btn-sm btn-secondary min-h-[44px] px-4 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ← Previous
              </button>
              <span className="text-[13px] text-ink-3 font-mono">
                Page {page + 1} of {totalPages}
              </span>
              <button
                aria-label="Next page"
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages - 1}
                className="btn btn-sm btn-secondary min-h-[44px] px-4 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Re-upload modals — faculty only */}
      {refreshBankExam && (
        <RefreshFromBankModal
          exam={refreshBankExam}
          onClose={() => setRefreshBankExam(null)}
        />
      )}

      {reuploadTagsExam && (
        <ReuploadTagsModal
          exam={reuploadTagsExam}
          onClose={() => setReuploadTagsExam(null)}
        />
      )}
      {reuploadResultsExam && (
        <ReuploadResultsModal
          exam={reuploadResultsExam}
          onClose={() => setReuploadResultsExam(null)}
        />
      )}
      {/* One grid, two entry points: "+ Offline marks" creates, "Edit marks"
          re-opens an existing exam pre-filled. */}
      {(offlineModalOpen || editMarksExam) && (
        <OfflineExamModal
          exam={editMarksExam}
          onClose={() => { setOfflineModalOpen(false); setEditMarksExam(null) }}
        />
      )}

      {whatsappPreviewExam && (
        <WhatsAppPreviewModal
          exam={whatsappPreviewExam}
          sending={whatsappSending}
          onClose={() => !whatsappSending && setWhatsappPreviewExam(null)}
          onConfirm={handleWhatsAppConfirm}
          failedNames={whatsappSendHistory[whatsappPreviewExam.id]?.failedNames ?? null}
        />
      )}
      {whatsappResult && (
        <WhatsAppResultsModal
          result={whatsappResult}
          onClose={() => setWhatsappResult(null)}
        />
      )}

      {examAbsencePreviewExam && (
        <ExamAbsencePreviewModal
          exam={examAbsencePreviewExam}
          sending={examAbsenceSending}
          onClose={() => !examAbsenceSending && setExamAbsencePreviewExam(null)}
          onConfirm={handleExamAbsenceConfirm}
          failedNames={examAbsenceSendHistory[examAbsencePreviewExam.id]?.failedNames ?? null}
        />
      )}
      {examAbsenceResult && (
        <WhatsAppResultsModal
          result={examAbsenceResult}
          onClose={() => setExamAbsenceResult(null)}
        />
      )}
    </div>
  )
}
