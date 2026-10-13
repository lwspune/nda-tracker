// The student side of homework assignments, as the server sees it. PURE.
// Used by api/student-quizzes.js (kinds 'homework-list' / 'homework-start' /
// 'homework-submit'), so every relative import carries its .js extension —
// Vercel's Node ESM loader needs it (api/__tests__/importGraph.test.js).
//
// What leaves the server is decided HERE: never the answer key (not even its
// name), never who set the homework, never another student's work.
import { isQuestionFilePath, submissionFilePath, validateUploadFiles } from './upload.js'
import { assignmentState, canStartSubmission, liveSubmission } from './status.js'
import { isBlockedStatus } from '../accountStatus.js'

// A closed homework the student never handed in stays visible this long, as
// "missed"; after that it drops off. Handed-in work is always kept.
export const KEEP_CLOSED_DAYS = 14

// Which student is asking. Same trust model as the quiz endpoints (their own
// mobile from the portal session), plus the LWS ID, which must belong to that
// number: siblings can share one, and an ID alone must never reach another
// student's homework. Blocked accounts are refused, as at login; a blank status
// is a legacy row and passes.
// `normalize` is api/_mobile.js normMobile, passed in so it stays the one copy.
export function resolveStudent(students, mobile, lwsId, normalize) {
  const wanted = normalize(String(mobile ?? ''))
  if (!wanted) return { ok: false, status: 400, error: 'Invalid mobile number.' }
  if (!lwsId) return { ok: false, status: 400, error: 'Student ID is required.' }
  const mine = (students ?? []).filter(s => normalize(s.mobile) === wanted)
  if (mine.length === 0) return { ok: false, status: 404, error: 'Mobile number not found. Please contact LWS Pune.' }
  const student = mine.find(s => s.lws_id === lwsId)
  if (!student) return { ok: false, status: 404, error: 'That student is not linked to this mobile number.' }
  if (isBlockedStatus(student.account_status)) {
    return { ok: false, status: 403, error: 'This account is not active. Please contact LWS Pune.' }
  }
  return { ok: true, student, batches: (student.student_batches ?? []).map(b => b.batch_name) }
}

const num = v => (v === null || v === undefined ? null : Number(v))

// Camel-case the DB row into the app shape status.js reasons about.
const asAssignment = r => ({ id: r.id, status: r.status, dueAt: r.due_at })

// The latest submission that matters to the student: the live one, else the
// latest rejection (so they can see why). Unfinished uploads never show.
function pickSubmission(rows) {
  const visible = rows.filter(s => s.status !== 'uploading')
  const live = liveSubmission(visible)
  if (live) return live
  return visible
    .filter(s => s.status === 'rejected')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] ?? null
}

// The ONLY student-facing shape of a submission: fields are listed, never
// spread, so nothing added to the row (the handwriting check) can reach a
// student by default. A `held` grade is shown exactly as one not yet graded —
// telling a student their grade is held is telling them they were suspected.
function shapeSubmission(s) {
  if (!s) return null
  if (s.status === 'held') {
    return shapeSubmission({
      id: s.id, status: 'submitted', files: s.files,
      submitted_at: s.submitted_at, homework_grades: [],
    })
  }
  return {
    id: s.id,
    status: s.status,
    pages: (s.files ?? []).length,
    submittedAt: s.submitted_at ?? null,
    gradedAt: s.graded_at ?? null,
    totalAwarded: num(s.total_awarded),
    totalMax: num(s.total_max),
    wentWell: s.went_well ?? null,
    nextSteps: s.next_steps ?? null,
    rejectedReason: s.rejected_reason ?? null,
    grades: (s.homework_grades ?? [])
      .map(g => ({
        position: g.position, label: g.label, maxMarks: num(g.max_marks), outcome: g.outcome,
        awarded: num(g.awarded), earned: g.earned ?? null, missing: g.missing ?? null,
      }))
      .sort((a, b) => a.position - b.position),
  }
}

// assignments: published rows (the endpoint filters by batch overlap in SQL;
// this re-checks). submissions: this student's rows with homework_grades.
// urls: { questionFilePath: signedUrl }.
export function studentHomeworkList({ assignments, submissions, batches, urls, now = new Date() }) {
  const mine = new Set(batches ?? [])
  const byAssignment = new Map()
  for (const s of submissions ?? []) {
    if (!byAssignment.has(s.assignment_id)) byAssignment.set(s.assignment_id, [])
    byAssignment.get(s.assignment_id).push(s)
  }

  const out = []
  for (const r of assignments ?? []) {
    if (r.status !== 'published') continue
    if (!(r.batch_names ?? []).some(b => mine.has(b))) continue
    const rows = byAssignment.get(r.id) ?? []
    const sub = pickSubmission(rows)
    const state = assignmentState(asAssignment(r), now)
    const handedIn = sub && (sub.status === 'submitted' || sub.status === 'graded')
    const ageDays = (now.getTime() - new Date(r.due_at).getTime()) / 864e5
    if (state === 'closed' && !handedIn && ageDays > KEEP_CLOSED_DAYS) continue

    out.push({
      id: r.id,
      title: r.title,
      subject: r.subject,
      instructions: r.instructions ?? '',
      dueAt: r.due_at,
      maxMarks: num(r.max_marks),
      state,
      canSubmit: canStartSubmission(asAssignment(r), rows, now).ok,
      questionFiles: (r.question_files ?? [])
        .filter(f => isQuestionFilePath(r.id, f.path) && urls?.[f.path])
        .map(f => ({ name: f.name || 'Question paper', type: f.type ?? null, url: urls[f.path] })),
      submission: shapeSubmission(sub),
    })
  }

  const due = h => new Date(h.dueAt).getTime()
  return out.sort((a, b) => {
    if (a.state !== b.state) return a.state === 'open' ? -1 : 1
    return a.state === 'open' ? due(a) - due(b) : due(b) - due(a)
  })
}

// Storage paths for a new submission's files, in page order.
export function planSubmissionUploads(assignmentId, lwsId, submissionId, files) {
  const check = validateUploadFiles(files)
  if (!check.ok) return check
  return { ok: true, paths: check.files.map((f, i) => submissionFilePath(assignmentId, lwsId, submissionId, i, f.ext)) }
}
