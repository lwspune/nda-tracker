import { useState, useEffect } from 'react'
import useStore from '../../store/useStore'
import { Card, CardTitle, StatCard, EmptyState } from '../../components/ui'
import { useMode } from '../../context/ModeContext'
import { supabase } from '../../lib/supabase'
import AttendanceRings from '../Attendance/AttendanceRings'
import {
  getStudentExams, filterValidExams,
  computeStudentChapterStats,
  computeAttemptQuality, computeConsistency,
  computeProjectedScore, computeWrongAudit, computeSkippedAudit,
} from '../../lib/analytics'
import { getFreqForSubject } from '../../lib/ndaFreq'
import ChapterAccordion from './ChapterAccordion'
import ProjectedScoreCard from './ProjectedScoreCard'
import WrongAnswerAudit from './WrongAnswerAudit'
import UnattemptedAudit from './UnattemptedAudit'
import { ProfileCard, ImprovementPlan } from './studentViewComponents'
import ExamHistoryTable from './ExamHistoryTable'


export default function StudentView({ name }) {
  const exams              = useStore(s => s.exams)
  const studentProfiles    = useStore(s => s.studentProfiles)
  const savedInsights      = useStore(s => s.savedInsights)
  const ndaFreqBySubject   = useStore(s => s.ndaFreqBySubject)
  const ndaMarksBySubject  = useStore(s => s.ndaMarksBySubject)
  const mode               = useMode()

  const [subjectFilter, setSubjectFilter] = useState('Maths')

  // Profile lookup — done first so regDate is available for exam filtering
  const profile = studentProfiles[name] ||
    Object.values(studentProfiles).find(p => p.name?.toLowerCase() === name.toLowerCase())

  // Normalize variant names to canonical name so all analytics use a single key.
  // Exam records store the name as uploaded; variants are linked later via addNameVariant.
  const allNames = new Set([name, ...(profile?.nameVariants || [])])
  const normalizedExams = allNames.size > 1
    ? exams.map(exam => ({
        ...exam,
        students: exam.students.map(s =>
          allNames.has(s.name) && s.name !== name ? { ...s, name } : s
        ),
      }))
    : exams

  // Attendance — fetched from Supabase by lwsId; must be before early returns
  const [attendance, setAttendance] = useState([])
  useEffect(() => {
    if (!supabase || !profile?.lwsId) { setAttendance([]); return }
    let cancelled = false
    supabase.from('student_attendance')
      .select('date, status')
      .eq('lws_id', profile.lwsId)
      .then(({ data }) => { if (!cancelled) setAttendance(data || []) })
    return () => { cancelled = true }
  }, [profile?.lwsId])

  // All exam appearances for this student
  const allExamData = getStudentExams(name, normalizedExams)

  // Filter to exams on/after the student's registration date (no-op when regDate absent)
  const validExamData  = filterValidExams(allExamData, profile?.regDate)
  const excludedCount  = allExamData.length - validExamData.length

  if (!allExamData.length) {
    return (
      <>
        {profile && <ProfileCard name={name} profile={profile} />}
        <EmptyState icon="📋" title="No exam records" sub={`${name} is registered but hasn't sat any exams yet`} />
      </>
    )
  }

  // Subjects derived from valid exams only — pre-registration subjects don't appear.
  // For GAT combined exams, include per-question subjects (English, Physics, etc.)
  // rather than the exam-level 'GAT' label, so students can filter to each subject.
  const nonGATSubjects = validExamData
    .filter(({ exam }) => exam.subject !== 'GAT')
    .map(({ exam }) => exam.subject || 'Maths')
  const gatQuestionSubjects = validExamData
    .filter(({ exam }) => exam.subject === 'GAT')
    .flatMap(({ exam }) => (exam.questions || []).map(q => q.subject).filter(Boolean))
  // Fall back to 'GAT' label when a GAT exam has no per-question subjects (old data)
  const hasGATQSubjects = gatQuestionSubjects.length > 0
  const hasAnyGATExam   = validExamData.some(({ exam }) => exam.subject === 'GAT')
  const gatFallback     = hasAnyGATExam && !hasGATQSubjects ? ['GAT'] : []
  const studentSubjects = [...new Set([...nonGATSubjects, ...gatQuestionSubjects, ...gatFallback])].sort()
  const isMultiSubject  = studentSubjects.length > 1

  // Apply subject filter to valid exams.
  // When a specific subject is chosen, include both same-subject exams AND GAT exams
  // (whose questions will be filtered to that subject in analytics).
  const examData = subjectFilter === 'all'
    ? validExamData
    : validExamData.filter(({ exam }) => {
        if ((exam.subject || 'Maths') === subjectFilter) return true
        // Include GAT exams when filtering by a per-question subject
        if (exam.subject === 'GAT' && subjectFilter !== 'GAT') {
          return (exam.questions || []).some(q => q.subject === subjectFilter)
        }
        return false
      })

  // qSubject: passed to analytics so only matching questions are counted from GAT exams.
  // null when 'all' or 'GAT' (no question-level filter needed).
  const qSubject = (subjectFilter !== 'all' && subjectFilter !== 'GAT') ? subjectFilter : null

  // When a subject is explicitly selected use it directly;
  // otherwise infer from whichever subject the student has taken most valid exams in.
  const primarySubject = subjectFilter !== 'all'
    ? subjectFilter
    : (() => {
        const counts = {}
        validExamData.forEach(({ exam }) => {
          const s = exam.subject || 'Maths'
          counts[s] = (counts[s] || 0) + 1
        })
        return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Maths'
      })()

  const ndaFreq       = getFreqForSubject(ndaFreqBySubject, primarySubject)
  const hasFreqData   = ndaFreq.length > 0
  const subjectMaxScore = ndaMarksBySubject?.[primarySubject] ?? 300

  // All analytics operate on the subject-filtered valid exam set.
  // qSubject scopes chapter/audit stats to the selected subject's questions in GAT exams.
  const filteredExams = examData.map(({ exam }) => exam)
  const chapterStats  = computeStudentChapterStats(name, filteredExams, qSubject)
  const aq            = computeAttemptQuality(name, filteredExams)
  const consistency   = computeConsistency(name, filteredExams)
  const projected     = computeProjectedScore(name, filteredExams, ndaFreq, subjectMaxScore)
  const wrongAudit    = computeWrongAudit(name, filteredExams, qSubject)
  const skippedAudit  = computeSkippedAudit(name, filteredExams, qSubject)

  const scores = examData.map(({ exam, student }) => ({
    name: exam.name, date: exam.date,
    score: student.totalMarks,
    max: exam.questions.length * exam.marking.correct,
    pct: exam.questions.length * exam.marking.correct > 0
      ? student.totalMarks / (exam.questions.length * exam.marking.correct)
      : 0,
    correct: student.correct, wrong: student.incorrect, na: student.notAttempted,
    exam,    // full exam object — needed for per-exam question breakdown
    student, // full student object — needed for responses
  }))

  const latest = scores[scores.length - 1]
  const prev   = scores.length >= 2 ? scores[scores.length - 2] : null
  const delta  = prev ? latest.score - prev.score : null

  // Chapter summary for accordion
  const chapterSummary = Object.entries(chapterStats).map(([ch, subs]) => {
    const vals = Object.values(subs)
    const avg = vals.reduce((s, v) => s + v.weightedScore, 0) / vals.length
    const trends = vals.map(v => v.trend)
    const dominant = [...trends].sort((a, b) =>
      trends.filter(t => t === b).length - trends.filter(t => t === a).length
    )[0]
    return { ch, avg, trend: dominant, subs }
  }).sort((a, b) => a.avg - b.avg)

  const savedPlan = savedInsights.studentPlans?.[name]

  // All valid exams excluded (e.g. student registered after all exams were held)
  if (!validExamData.length) {
    return (
      <>
        {profile && <ProfileCard name={name} profile={profile} />}
        <EmptyState
          icon="📅"
          title="No valid exams"
          sub={`All ${allExamData.length} exam${allExamData.length !== 1 ? 's' : ''} occurred before the registration date (${profile.regDate})`}
        />
      </>
    )
  }

  // After subject filtering, nothing to show for this subject
  if (!examData.length) {
    return <EmptyState icon="🔍" title="No data" sub={`No ${subjectFilter} exam records found for "${name}"`} />
  }

  return (
    <div className="space-y-4">
      {/* Profile card */}
      {profile && <ProfileCard name={name} profile={profile} />}

      {/* Attendance rings — directly below profile */}
      {attendance.length > 0 && (
        <Card>
          <CardTitle>Attendance</CardTitle>
          <AttendanceRings attendance={attendance} />
        </Card>
      )}

      {/* Pre-registration exclusion notice — faculty/teacher only */}
      {excludedCount > 0 && mode !== 'student' && (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200
                        text-[12px] text-amber-800">
          <span className="text-[14px] flex-shrink-0">📅</span>
          <span>
            <strong>{excludedCount} exam{excludedCount !== 1 ? 's' : ''}</strong> sat before
            registration ({profile.regDate}) {excludedCount !== 1 ? 'are' : 'is'} excluded from analytics.
          </span>
        </div>
      )}

      {/* Subject filter — only shown when student has 2+ subjects */}
      {isMultiSubject && (
        <div>
          <select
            aria-label="Subject filter"
            value={subjectFilter}
            onChange={e => setSubjectFilter(e.target.value)}
            className="form-input w-auto text-[13px] pr-8 cursor-pointer"
            style={{ minWidth: '160px' }}
          >
            <option value="all">All Subjects</option>
            {studentSubjects.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <StatCard
          label="Latest Score"
          value={latest.score}
          color={latest.pct >= 0.7 ? 'text-success' : latest.pct >= 0.45 ? 'text-warning' : 'text-danger'}
          delta={delta !== null ? `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)} from prev` : null}
          deltaUp={delta >= 0}
        />
        <StatCard
          label="Exams Taken"
          value={examData.length}
          color="text-accent"
        />
        <StatCard
          label="Attempt Quality"
          value={aq !== null ? `${(aq * 100).toFixed(0)}%` : '—'}
          color={aq === null ? 'text-ink-3' : aq >= 0.8 ? 'text-success' : aq >= 0.6 ? 'text-warning' : 'text-danger'}
          delta={aq !== null ? 'correct ÷ attempted' : null}
          deltaUp={null}
        />
        <StatCard
          label="Consistency"
          value={consistency ? consistency.label : examData.length < 2 ? 'Need 2+ exams' : '—'}
          color={
            !consistency ? 'text-ink-3' :
            consistency.color === 'success' ? 'text-success' :
            consistency.color === 'warning' ? 'text-warning' : 'text-danger'
          }
          delta={consistency ? `σ = ${(consistency.sd * 100).toFixed(0)}%` : null}
          deltaUp={null}
        />
      </div>

      {/* Projected NDA Score — faculty + teacher only, only when freq data is configured */}
      {mode !== 'student' && hasFreqData && projected.total > 0 && (
        <ProjectedScoreCard
          projected={projected}
          primarySubject={primarySubject}
          subjectMaxScore={subjectMaxScore}
        />
      )}

      {/* Chapter accordion */}
      <Card>
        <CardTitle>
          Chapter Performance (Recency-Weighted)
          <span className="ml-2 text-[9px] normal-case tracking-normal text-ink-3 font-normal">
            — click a chapter to expand subtopics
          </span>
        </CardTitle>
        <ChapterAccordion chapterSummary={chapterSummary} name={name} exams={filteredExams} />
      </Card>

      {/* Exam history */}
      <ExamHistoryTable scores={scores} />

      {/* Wrong Answer Audit — all modes */}
      {wrongAudit.length > 0 && (
        <WrongAnswerAudit wrongAudit={wrongAudit} name={name} exams={filteredExams} />
      )}

      {/* Unattempted Question Audit — all modes */}
      {skippedAudit.length > 0 && (
        <UnattemptedAudit skippedAudit={skippedAudit} name={name} exams={filteredExams} />
      )}

      {/* Improvement plan */}
      <ImprovementPlan savedPlan={savedPlan} />
    </div>
  )
}
