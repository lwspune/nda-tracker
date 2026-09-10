// A lazily-imported chunk that no longer exists is not a fault in the feature
// the user clicked — it means their tab is running code from a build that has
// been replaced.
//
// Every heavy feature here (practice set, monthly reports, PDF/ZIP export) is
// behind a dynamic `import()`, and Vite names those chunks by content hash. A
// deploy changes the hash, and Vercel serves only the current build at the
// production alias — so a tab left open across a deploy asks for a filename
// that is gone. It does not even 404: `vercel.json` rewrites every unmatched
// path to `/index.html`, so the request returns HTTP 200 with
// `Content-Type: text/html`, the module loader refuses it, and the rejection
// lands in whatever try/catch wrapped the import.
//
// Confirmed against production 2026-09-10:
//   TypeError: Failed to fetch dynamically imported module:
//              https://nda-tracker.vercel.app/assets/practiceSetDocx-<old>.js
//
// The reason this needs its own message is that **retrying cannot work** — it
// re-requests the same dead URL. Only a reload can. "Try again" sends the user
// round a loop that has no exit.

// Browser wording differs; the shape does not.
const STALE_PATTERNS = [
  /failed to fetch dynamically imported module/i,  // Chrome / Edge
  /error loading dynamically imported module/i,    // Firefox
  /importing a module script failed/i,             // Safari
]

export const STALE_CHUNK_MESSAGE =
  'The app was updated in the background. Reload the page, then try again.'

/**
 * True when `err` is a failed dynamic-module load — i.e. a stale bundle.
 *
 * Deliberately narrow. The predicate exists to change the ADVICE we give, so a
 * false positive is worse than a miss: it would tell someone to reload when the
 * real fault is in the code or the data. Matching is on the loader's own
 * wording only — notably NOT on `SyntaxError: Unexpected token '<'`, which an
 * API returning an HTML error page also throws and which a reload will not fix.
 * Pure.
 */
export function isStaleChunkError(err) {
  if (!err) return false
  const msg = String(err.message ?? err)
  return STALE_PATTERNS.some(re => re.test(msg))
}
