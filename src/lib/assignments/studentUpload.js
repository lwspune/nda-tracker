// Handing in homework from the student portal: ask the server to start a
// submission, send each page straight to private storage through the signed
// link it issued (never through our API — six phone photos are far over
// Vercel's 4.5 MB request limit), then ask the server to submit. The server
// checks every page arrived before it accepts.
//
// `post(body)` → { ok, status, body } and `upload(path, token, file)` →
// { error } are injected so this stays testable; the portal passes fetch and
// supabase.storage.uploadToSignedUrl.
export async function sendHomework({ mobile, lwsId, assignmentId, files, post, upload, onProgress = () => {} }) {
  const start = await post({
    kind: 'homework-start', mobile, lwsId, assignmentId,
    files: files.map(f => ({ type: f.type, size: f.size })),
  })
  if (!start.ok) return { ok: false, error: start.body?.error || 'Could not start the upload.' }

  const { submissionId, uploads } = start.body
  if (!Array.isArray(uploads) || uploads.length !== files.length) {
    return { ok: false, error: 'The upload could not be prepared. Please try again.' }
  }

  for (let i = 0; i < uploads.length; i++) {
    const { error } = await upload(uploads[i].path, uploads[i].token, files[i])
    if (error) return { ok: false, error: `Page ${i + 1} did not upload. Check your connection and submit again.` }
    onProgress(i + 1, uploads.length)
  }

  const done = await post({ kind: 'homework-submit', mobile, lwsId, submissionId })
  if (!done.ok) return { ok: false, error: done.body?.error || 'Could not submit. Please try again.' }
  return { ok: true }
}
