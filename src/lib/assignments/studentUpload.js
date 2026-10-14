// Handing in homework from the student portal: ask the server to start a
// submission, send each page straight to private storage through the signed
// link it issued (never through our API — six phone photos are far over
// Vercel's 4.5 MB request limit), then ask the server to submit. The server
// checks every page arrived before it accepts.
//
// `post(body)` → { ok, status, body } and `upload(path, token, file)` →
// { error } are injected so this stays testable; the portal passes fetch and
// supabase.storage.uploadToSignedUrl.
//
// `replace` (2026-10-14) asks to replace a hand-in not yet marked; it is sent
// only when true, so a plain hand-in can never replace anything.
export async function sendHomework({ mobile, lwsId, assignmentId, files, replace = false, post, upload, onProgress = () => {} }) {
  const start = await post({
    kind: 'homework-start', mobile, lwsId, assignmentId,
    files: files.map(f => ({ type: f.type, size: f.size })),
    ...(replace ? { replace: true } : {}),
  })
  if (!start.ok) return { ok: false, error: start.body?.error || 'Could not start the upload.' }

  const { submissionId, uploads } = start.body
  if (!Array.isArray(uploads) || uploads.length !== files.length) {
    return { ok: false, error: 'The upload could not be prepared. Please try again.' }
  }

  for (let i = 0; i < uploads.length; i++) {
    let error
    try {
      ({ error } = await upload(uploads[i].path, uploads[i].token, files[i]))
    } catch (e) {
      error = e
    }
    // Keep the real reason: "check your connection" hid a file the phone could
    // no longer read, and the student retried the same failure again and again.
    if (error) {
      return {
        ok: false,
        error: `Page ${i + 1} did not upload (${error.message || 'unknown error'}). Tap Remove on that page, add it again, then submit.`,
      }
    }
    onProgress(i + 1, uploads.length)
  }

  const done = await post({ kind: 'homework-submit', mobile, lwsId, submissionId })
  if (!done.ok) return { ok: false, error: done.body?.error || 'Could not submit. Please try again.' }
  return { ok: true }
}

// Read each picked file into memory the moment it is picked. A phone's picker
// hands back a link to the photo, and the upload only reads it at hand-in; by
// then the link can be stale and the browser sends nothing (LWS-092, 13 Oct:
// eleven attempts, no page ever left the phone). A copy in memory cannot go
// stale, and a file that cannot be read is refused now, while the student can
// still take it again.
// [File] → { ok: true, files: [File] } | { ok: false, error }
export async function readPickedFiles(picked) {
  const files = []
  for (const f of picked) {
    let bytes
    try {
      bytes = await f.arrayBuffer()
    } catch {
      return { ok: false, error: `${f.name} could not be read from your phone. Take or choose it again.` }
    }
    if (!bytes || bytes.byteLength === 0) {
      return { ok: false, error: `${f.name} came through empty. Take or choose it again.` }
    }
    files.push(new File([bytes], f.name, { type: f.type }))
  }
  return { ok: true, files }
}

// Handing in is final. One photo is the shape of "I thought Submit sent this
// page", the commonest incomplete hand-in on Daily Homework #1. One PDF is a
// whole scanned answer.
export function needsSinglePageConfirm(files) {
  return files.length === 1 && files[0].type !== 'application/pdf'
}
