// The student's homework requests (2026-10-12), served from
// api/student-quizzes.js behind `body.kind` — we are at the 12-function Hobby
// cap, so this is an underscore helper, not a new endpoint.
//
//   homework-list   → the student's homework, with signed question-paper links
//   homework-start  → check, start the submission, one signed upload link per page
//                     (`replace: true` replaces a hand-in not yet marked, 2026-10-14)
//   homework-submit → check every page arrived, then send it for grading
//
// Identity is the quiz endpoints' (the student's own mobile from the portal
// session) plus the LWS ID, which must belong to that number. Students have no
// Supabase session: every read and write here is the service role, so THIS
// file is the boundary. The database functions re-check the deadline and
// one-per-student; the batch check lives only here.
import { randomUUID } from 'node:crypto'
import { normMobile } from './_mobile.js'
import { resolveStudent, studentHomeworkList, planSubmissionUploads, markedPaperPaths } from '../src/lib/assignments/studentHomework.js'
import { canStartSubmission, canReplaceSubmission } from '../src/lib/assignments/status.js'
import { ASSIGNMENT_FILES_BUCKET, SUBMISSIONS_BUCKET, isQuestionFilePath } from '../src/lib/assignments/upload.js'

export const HOMEWORK_KINDS = new Set(['homework-list', 'homework-start', 'homework-submit'])

// Question-paper links last an hour: long enough to read and write, short
// enough that a forwarded link stops working.
const LINK_TTL_SECONDS = 3600

const send = (res, status, payload) => res.status(status).json(payload)
const fail = (res, status, error) => send(res, status, { error })

// The database functions RAISE in plain words; the ones a student can trigger
// by timing (deadline, double tap) are conflicts, not server faults.
function rpcFailure(res, error, where) {
  const msg = error?.message ?? ''
  if (/deadline/i.test(msg)) return fail(res, 409, 'The deadline for this homework has passed.')
  if (/already submitted/i.test(msg)) return fail(res, 409, 'You have already submitted this homework.')
  if (/already been marked/i.test(msg)) return fail(res, 409, "This homework has already been marked, so it can't be replaced.")
  if (/no replacements left/i.test(msg)) return fail(res, 409, "You've already replaced this homework twice.")
  if (/not open|not an upload in progress/i.test(msg)) return fail(res, 409, 'This homework can no longer be submitted. Reload and try again.')
  console.error(`[student-homework] ${where} failed:`, msg)
  return fail(res, 500, 'Something went wrong. Please try again.')
}

export async function handleStudentHomework(supabase, body, res) {
  if (!HOMEWORK_KINDS.has(body.kind)) return fail(res, 400, 'Unknown request.')

  const { data: students, error: studentsErr } = await supabase
    .from('students')
    .select('canonical_name, lws_id, mobile, account_status, student_batches(batch_name)')
  if (studentsErr || !students) {
    console.error('[student-homework] students read failed:', studentsErr?.message)
    return fail(res, 500, 'Could not load student data')
  }
  const who = resolveStudent(students, body.mobile, body.lwsId, normMobile)
  if (!who.ok) return fail(res, who.status, who.error)

  if (body.kind === 'homework-list') return list(supabase, who, res)
  if (body.kind === 'homework-start') return start(supabase, who, body, res)
  return submit(supabase, who, body, res)
}

async function list(supabase, who, res) {
  const name = who.student.canonical_name
  if (who.batches.length === 0) return send(res, 200, { name, homework: [] })

  const { data: assignments, error: aErr } = await supabase
    .from('homework_assignments')
    .select('*')
    .eq('status', 'published')
    .overlaps('batch_names', who.batches)
  if (aErr) { console.error('[student-homework] assignments read failed:', aErr.message); return fail(res, 500, 'Could not load homework') }

  const { data: submissions, error: sErr } = await supabase
    .from('homework_submissions')
    .select('*, homework_grades(*)')
    .eq('lws_id', who.student.lws_id)
  if (sErr) { console.error('[student-homework] submissions read failed:', sErr.message); return fail(res, 500, 'Could not load homework') }

  // Sign question papers only — never anything in the key folder.
  const paths = (assignments ?? []).flatMap(a =>
    (a.question_files ?? []).map(f => f.path).filter(p => isQuestionFilePath(a.id, p)))
  const urls = {}
  if (paths.length > 0) {
    const { data, error } = await supabase.storage.from(ASSIGNMENT_FILES_BUCKET).createSignedUrls(paths, LINK_TTL_SECONDS)
    if (error) { console.error('[student-homework] signing failed:', error.message); return fail(res, 500, 'Could not load homework') }
    for (const d of data ?? []) if (d?.signedUrl) urls[d.path] = d.signedUrl
  }

  // The marked papers of released grades (2026-10-16): only the paths
  // markedPaperPaths names, so a held grade's pages are never signed. A failure
  // here costs the links, not the list: the student can still hand work in.
  const paperPaths = markedPaperPaths(submissions)
  if (paperPaths.length > 0) {
    const { data, error } = await supabase.storage.from(SUBMISSIONS_BUCKET).createSignedUrls(paperPaths, LINK_TTL_SECONDS)
    if (error) console.error('[student-homework] marked paper signing failed:', error.message)
    for (const d of data ?? []) if (d?.signedUrl) urls[d.path] = d.signedUrl
  }

  const homework = studentHomeworkList({ assignments, submissions, batches: who.batches, urls })
  return send(res, 200, { name, homework })
}

async function start(supabase, who, body, res) {
  const { assignmentId, files } = body
  const replace = body.replace === true
  if (!assignmentId) return fail(res, 400, 'assignmentId is required')
  const lwsId = who.student.lws_id

  // Fail fast on the files before any database work.
  const submissionId = randomUUID()
  const plan = planSubmissionUploads(assignmentId, lwsId, submissionId, files)
  if (!plan.ok) return fail(res, 400, plan.error)

  const { data: a, error: aErr } = await supabase
    .from('homework_assignments')
    .select('id, status, due_at, batch_names')
    .eq('id', assignmentId)
    .maybeSingle()
  if (aErr) { console.error('[student-homework] assignment read failed:', aErr.message); return fail(res, 500, 'Could not load homework') }
  const forMe = a && a.status === 'published' && (a.batch_names ?? []).some(b => who.batches.includes(b))
  if (!forMe) return fail(res, 404, 'Homework not found.')

  const { data: mine, error: mErr } = await supabase
    .from('homework_submissions')
    .select('id, status')
    .eq('assignment_id', assignmentId)
    .eq('lws_id', lwsId)
  if (mErr) { console.error('[student-homework] submissions read failed:', mErr.message); return fail(res, 500, 'Could not load homework') }
  // A replacement is asked for explicitly and only used when there is a hand-in
  // to replace; a first hand-in goes the ordinary way.
  const asAssignment = { id: a.id, status: a.status, dueAt: a.due_at }
  const fresh = canStartSubmission(asAssignment, mine ?? [])
  const replacing = !fresh.ok && replace
  const allowed = replacing ? canReplaceSubmission(asAssignment, mine ?? []) : fresh
  if (!allowed.ok) return fail(res, 409, allowed.error)

  // p_replace is sent only on a replacement, so a first hand-in works against
  // the database functions as they were before the replace migration.
  const { error: rpcErr } = await supabase.rpc('homework_submission_start', {
    p_id: submissionId, p_assignment: assignmentId, p_lws_id: lwsId, p_files: plan.paths,
    ...(replacing ? { p_replace: true } : {}),
  })
  if (rpcErr) return rpcFailure(res, rpcErr, 'start')

  const uploads = []
  for (const path of plan.paths) {
    const { data, error } = await supabase.storage.from(SUBMISSIONS_BUCKET).createSignedUploadUrl(path)
    if (error || !data?.token) {
      console.error('[student-homework] upload link failed:', error?.message)
      return fail(res, 500, 'Could not prepare the upload. Please try again.')
    }
    uploads.push({ path, token: data.token })
  }
  return send(res, 200, { submissionId, uploads })
}

async function submit(supabase, who, body, res) {
  const { submissionId } = body
  if (!submissionId) return fail(res, 400, 'submissionId is required')
  const lwsId = who.student.lws_id

  // Scoped to this student: an ID alone never reaches someone else's upload.
  const { data: sub, error } = await supabase
    .from('homework_submissions')
    .select('id, assignment_id, lws_id, status, files')
    .eq('id', submissionId)
    .eq('lws_id', lwsId)
    .maybeSingle()
  if (error) { console.error('[student-homework] submission read failed:', error.message); return fail(res, 500, 'Could not load homework') }
  if (!sub) return fail(res, 404, 'Upload not found. Please start again.')
  if (sub.status !== 'uploading') return fail(res, 409, 'This homework has already been sent.')

  // Every page must be in storage, or the grader gets a half-sent set.
  const folder = `${sub.assignment_id}/${lwsId}/${sub.id}`
  const { data: stored, error: listErr } = await supabase.storage.from(SUBMISSIONS_BUCKET).list(folder, { limit: 100 })
  if (listErr) { console.error('[student-homework] storage list failed:', listErr.message); return fail(res, 500, 'Could not check the upload. Please try again.') }
  const have = new Set((stored ?? []).map(f => f.name))
  const missing = (sub.files ?? []).filter(p => !have.has(p.split('/').pop()))
  if (missing.length > 0) return fail(res, 409, 'Some pages did not finish uploading. Please upload them again.')

  const { error: rpcErr } = await supabase.rpc('homework_submission_submit', { p_id: sub.id, p_lws_id: lwsId })
  if (rpcErr) return rpcFailure(res, rpcErr, 'submit')
  return send(res, 200, { ok: true })
}
