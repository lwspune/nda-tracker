// Uploading homework files: the teacher's question paper (and optional answer
// key), and a student's photographed or scanned answers. PURE.
//
// Files go straight from the browser to private Supabase Storage. A student's
// photos go through one signed upload link per file, issued by
// api/student-quizzes.js (kind 'homework-start'), because six phone photos are
// far over Vercel's 4.5 MB request limit. The buckets repeat the type and
// per-file size limits (supabase/migrations/*_create_homework_assignments.sql;
// a test pins the two together), so a link cannot store anything else.
//
// Adapted from PYQ Vault's src/lib/answerSheets/upload.ts.

export const ASSIGNMENT_FILES_BUCKET = 'homework-files'
export const SUBMISSIONS_BUCKET = 'homework-submissions'

export const MAX_FILES = 20
export const MAX_FILE_BYTES = 20 * 1024 * 1024
export const MAX_TOTAL_BYTES = 60 * 1024 * 1024

// What the grader can read. HEIC it cannot; the browser's file picker converts
// an iPhone photo to JPEG on upload, so refusing it costs nothing.
export const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

export const ACCEPT = Object.keys(ALLOWED_TYPES).join(',')
export const CAMERA_ACCEPT = Object.keys(ALLOWED_TYPES).filter(t => t.startsWith('image/')).join(',')

// [{ type, size }] → { ok: true, files: [{ type, size, ext }] } | { ok: false, error }
export function validateUploadFiles(files) {
  if (!Array.isArray(files) || files.length === 0) return { ok: false, error: 'Add at least one photo or PDF.' }
  if (files.length > MAX_FILES) return { ok: false, error: `Upload at most ${MAX_FILES} files.` }

  const out = []
  let total = 0
  for (const f of files) {
    const ext = typeof f?.type === 'string' ? ALLOWED_TYPES[f.type] : undefined
    if (!ext) return { ok: false, error: 'Each file must be a JPG, PNG, WEBP or PDF.' }
    if (typeof f.size !== 'number' || !Number.isInteger(f.size) || f.size <= 0) {
      return { ok: false, error: 'One of the files is empty.' }
    }
    if (f.size > MAX_FILE_BYTES) return { ok: false, error: 'Each file must be under 20 MB.' }
    total += f.size
    out.push({ type: f.type, size: f.size, ext })
  }
  if (total > MAX_TOTAL_BYTES) return { ok: false, error: 'The files add up to more than 60 MB. Use smaller photos.' }
  return { ok: true, files: out }
}

const pad = i => String(i + 1).padStart(2, '0')

const FOLDERS = { question: 'questions', key: 'key' }

// `<assignment>/questions/01.pdf` or `<assignment>/key/01.pdf`. The answer key
// has its own folder so that "is this a question file?" is a path check the
// student endpoint can make without trusting the row (isQuestionFilePath).
export function assignmentFilePath(assignmentId, kind, index, ext) {
  const folder = FOLDERS[kind]
  if (!folder) throw new Error(`Unknown assignment file kind "${kind}"`)
  return `${assignmentId}/${folder}/${pad(index)}.${ext}`
}

// `<assignment>/<lws_id>/<submission>/01.jpg`: files in upload order, which is
// the page order the grader reads.
export function submissionFilePath(assignmentId, lwsId, submissionId, index, ext) {
  return `${assignmentId}/${lwsId}/${submissionId}/${pad(index)}.${ext}`
}

// The marked pages (2026-10-16): the student's pages, upright and PDFs split,
// with the grader's marks drawn on, exactly as approved in grading:preview
// (scripts/grading/pages.py) and uploaded by grading:commit. The student, the
// PDF and the email all show these same images.
// `<assignment>/<lws_id>/<submission>/marked/01.jpg`. Purged with the hand-in
// files 30 days after grading.
export const MAX_MARKED_PAGES = 60

export function markedPagePath(assignmentId, lwsId, submissionId, index) {
  return `${assignmentId}/${lwsId}/${submissionId}/marked/${pad(index)}.jpg`
}

// The marked-paper report PDF, beside the marked pages (and purged with them).
export function reportPdfPath(assignmentId, lwsId, submissionId) {
  return `${assignmentId}/${lwsId}/${submissionId}/marked/report.pdf`
}

// Every marked page of a submission row (snake_case, as selected).
export function markedPagePaths(sub) {
  return Array.from({ length: sub.marked_pages ?? 0 }, (_, i) => markedPagePath(sub.assignment_id, sub.lws_id, sub.id, i))
}

const QUESTION_FILE = /^[^/]+\/questions\/\d{2}\.[a-z]+$/

// True only for a file directly inside this assignment's questions folder. The
// student endpoint signs a download link for nothing else, so an answer-key
// path that lands in question_files by mistake still never reaches a student.
export function isQuestionFilePath(assignmentId, path) {
  if (typeof path !== 'string' || !path.startsWith(`${assignmentId}/`)) return false
  return QUESTION_FILE.test(path)
}
