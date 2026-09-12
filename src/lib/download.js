// Handing a generated file to the browser, and naming it safely.
//
// Extracted 2026-09-12 from ten copies of the object-URL dance and seven of the
// filename sanitiser. Three of those sanitiser copies carried a comment saying
// "same rule as" another copy, which is the tell.
//
// Unlike the auth and blocked-contact gates, these encode a MECHANIC and a
// FORMAT rather than a rule: a wrong copy fails loudly — no download, or a name
// the OS refuses — rather than silently. That is why seventeen copies
// accumulated without an incident, and why this was the last thing on the
// refactor ledger rather than the first.

/**
 * Keep [A-Za-z0-9_-], collapse every other run to a single underscore.
 *
 * A title with a colon or a slash makes Windows refuse the save outright, and a
 * name written only in Devanagari — real in this roster — would otherwise
 * collapse to an empty string and produce a nameless file, hence the fallback.
 */
export function safeFilename(value, fallback = 'file') {
  const safe = String(value ?? '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return safe || fallback
}

/**
 * Trigger a download of `blob` as `filename`.
 *
 * The revoke is in a `finally`: an object URL pins its blob in memory until it
 * is revoked, and these are whole PDFs, .docx files and ZIPs. Every copy did
 * the revoke; doing it here means copy eleven cannot forget.
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  try {
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
  } finally {
    a.remove()
    URL.revokeObjectURL(url)
  }
}
