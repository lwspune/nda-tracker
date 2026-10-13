// The teacher side of homework assignments: who may set what, what each staff
// member sees, deadlines, file uploads and the row shape. PURE.
import { assignmentFilePath, validateUploadFiles } from './upload.js'
import { fmtDate } from '../dates.js'

const IST_OFFSET_MIN = 330

// A datetime-local value ('2026-10-13T18:00') read as a Pune wall-clock time,
// whatever timezone the browser that typed it is in. → ISO string, or null.
export function istLocalToIso(local) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(local ?? ''))
  if (!m) return null
  const [, y, mo, d, h, mi] = m.map(Number)
  const utc = Date.UTC(y, mo - 1, d, h, mi) - IST_OFFSET_MIN * 60000
  return Number.isFinite(utc) ? new Date(utc).toISOString() : null
}

// The inverse, for pre-filling the input. '' when there is nothing to show.
export function isoToIstLocal(iso) {
  const t = iso ? new Date(iso).getTime() : NaN
  if (!Number.isFinite(t)) return ''
  return new Date(t + IST_OFFSET_MIN * 60000).toISOString().slice(0, 16)
}

// '13 Oct 2026, 6:00 pm' — the app's date format (lib/dates.js fmtDate) plus
// the IST clock time. Read off the shifted ISO digits, never toLocaleString
// (ICU-dependent, and it would use the browser's timezone).
export function fmtDeadline(iso) {
  const local = isoToIstLocal(iso)
  if (!local) return ''
  const [h, mi] = local.slice(11).split(':').map(Number)
  const clock = `${h % 12 || 12}:${String(mi).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
  return `${fmtDate(local.slice(0, 10))}, ${clock}`
}

// { subject: [batchName, ...] } — what this person may set homework for.
// A teacher: their own (subject, batch) pairs from the timetable
// (getTeacherSubjectBatches), falling closed to {} like every other teacher
// scope. An admin: every subject with every batch.
export function homeworkTargets({ mode, subjectBatches = [], allSubjects = [], allBatches = [] }) {
  const out = {}
  if (mode === 'teacher') {
    for (const { subject, batchName } of subjectBatches) {
      if (!subject || !batchName) continue
      if (!out[subject]) out[subject] = []
      if (!out[subject].includes(batchName)) out[subject].push(batchName)
    }
    return out
  }
  for (const s of allSubjects) out[s] = [...allBatches]
  return out
}

// A teacher sees the homework they created; an admin sees all of it. The
// database enforces the write side (a teacher can only change their own rows);
// this is the read side, which RLS leaves open to staff.
export function visibleAssignments(assignments, { mode, email }) {
  if (mode !== 'teacher') return assignments ?? []
  const me = String(email ?? '').trim().toLowerCase()
  if (!me) return []
  return (assignments ?? []).filter(a => String(a.createdBy ?? '').toLowerCase() === me)
}

// Local File objects → where each goes in storage, numbered after the files
// already on the assignment. { ok, uploads: [{ file, path, meta }] } | { ok:false, error }
export function planFileUploads(assignmentId, kind, existingCount, files) {
  if (!files?.length) return { ok: true, uploads: [] }
  const check = validateUploadFiles(files.map(f => ({ type: f.type, size: f.size })))
  if (!check.ok) return check
  const uploads = files.map((file, i) => {
    const path = assignmentFilePath(assignmentId, kind, existingCount + i, check.files[i].ext)
    return { file, path, meta: { path, name: file.name, type: file.type, size: file.size } }
  })
  return { ok: true, uploads }
}

export function blankAssignment(createdBy) {
  return {
    id: null,
    title: '',
    subject: '',
    branch: '',
    batchNames: [],
    instructions: '',
    questionFiles: [],
    answerKeyFiles: [],
    questions: [],
    maxMarks: null,
    dueAt: null,
    status: 'draft',
    createdBy,
  }
}

const trimOrNull = v => {
  const t = String(v ?? '').trim()
  return t ? t : null
}

export function buildAssignmentRow(a) {
  return {
    id: a.id,
    title: String(a.title ?? '').trim(),
    subject: String(a.subject ?? '').trim(),
    branch: trimOrNull(a.branch),
    batch_names: a.batchNames ?? [],
    instructions: trimOrNull(a.instructions),
    question_files: a.questionFiles ?? [],
    answer_key_files: a.answerKeyFiles ?? [],
    questions: a.questions ?? [],
    max_marks: a.maxMarks,
    due_at: a.dueAt,
    status: a.status ?? 'draft',
    created_by: a.createdBy,
    updated_at: new Date().toISOString(),
  }
}

// PostgREST returns numeric columns as strings; every number read here goes
// through this so 7.5 never arrives as '7.5' and concatenates.
const num = v => (v === null || v === undefined ? null : Number(v))

export function mapAssignmentRow(r) {
  return {
    id: r.id,
    title: r.title,
    subject: r.subject,
    branch: r.branch ?? '',
    batchNames: r.batch_names ?? [],
    instructions: r.instructions ?? '',
    questionFiles: r.question_files ?? [],
    answerKeyFiles: r.answer_key_files ?? [],
    questions: (r.questions ?? []).map(q => ({ ...q, marks: num(q.marks) })),
    maxMarks: num(r.max_marks),
    dueAt: r.due_at,
    status: r.status,
    createdBy: r.created_by,
    createdAt: r.created_at ?? null,
    updatedAt: r.updated_at ?? null,
  }
}

export function mapSubmissionRow(r) {
  return {
    id: r.id,
    assignmentId: r.assignment_id,
    lwsId: r.lws_id,
    studentName: r.student_name,
    status: r.status,
    files: r.files ?? [],
    submittedAt: r.submitted_at ?? null,
    gradedAt: r.graded_at ?? null,
    regradedAt: r.regraded_at ?? null,
    grader: r.grader ?? null,
    totalAwarded: num(r.total_awarded),
    totalMax: num(r.total_max),
    wentWell: r.went_well ?? null,
    nextSteps: r.next_steps ?? null,
    rejectedReason: r.rejected_reason ?? null,
    scansDeletedAt: r.scans_deleted_at ?? null,
    // Faculty only (2026-10-13) — the student shape (studentHomework.js) never carries these.
    handCheck: r.hand_check ?? null,
    handNote: r.hand_note ?? null,
    handReferenceId: r.hand_reference_id ?? null,
    resolvedAt: r.resolved_at ?? null,
    resolvedBy: r.resolved_by ?? null,
    grades: (r.homework_grades ?? [])
      .map(g => ({
        position: g.position,
        label: g.label,
        maxMarks: num(g.max_marks),
        outcome: g.outcome,
        awarded: num(g.awarded),
        earned: g.earned ?? null,
        missing: g.missing ?? null,
      }))
      .sort((a, b) => a.position - b.position),
  }
}
