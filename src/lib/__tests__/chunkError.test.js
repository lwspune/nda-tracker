import { describe, it, expect } from 'vitest'
import { isStaleChunkError, STALE_CHUNK_MESSAGE } from '../chunkError'

// The real message, captured from Chrome against production on 2026-09-10 after
// a deploy changed the chunk hash under an open tab.
const CHROME = 'Failed to fetch dynamically imported module: '
  + 'https://nda-tracker.vercel.app/assets/practiceSetDocx-Ceu1nUqI.js'

describe('isStaleChunkError', () => {
  it('recognises the Chrome/Edge message', () => {
    expect(isStaleChunkError(new TypeError(CHROME))).toBe(true)
  })

  it('recognises the Firefox message', () => {
    expect(isStaleChunkError(new TypeError('error loading dynamically imported module'))).toBe(true)
  })

  it('recognises the Safari message', () => {
    expect(isStaleChunkError(new TypeError('Importing a module script failed.'))).toBe(true)
  })

  // The point of the predicate is to change the ADVICE. Telling someone to
  // reload when the real fault is in the build would send them in a circle, so
  // anything that is not unambiguously a module-load failure must not match.
  it('does not match an ordinary runtime error', () => {
    expect(isStaleChunkError(new TypeError("Cannot read properties of undefined (reading 'q')"))).toBe(false)
    expect(isStaleChunkError(new Error('practiceSetDocx: could not resolve mml2omml() from its module'))).toBe(false)
  })

  // An API returning an HTML error page throws "Unexpected token '<'" too, but a
  // reload does not fix that — it is a server problem, not a stale bundle.
  it('does not match an HTML-instead-of-JSON parse failure', () => {
    expect(isStaleChunkError(new SyntaxError("Unexpected token '<', \"<!doctype \"... is not valid JSON"))).toBe(false)
  })

  it('survives a non-Error value', () => {
    expect(isStaleChunkError(null)).toBe(false)
    expect(isStaleChunkError(undefined)).toBe(false)
    expect(isStaleChunkError(CHROME)).toBe(true)
  })

  // Retrying re-requests the same dead URL, so the reload has to come FIRST —
  // a message that leads with "try again" sends the user round a loop with no
  // exit, which is exactly the old behaviour this replaces.
  it('tells the user to reload before it mentions retrying', () => {
    expect(STALE_CHUNK_MESSAGE).toMatch(/reload/i)
    const reloadAt = STALE_CHUNK_MESSAGE.search(/reload/i)
    const retryAt = STALE_CHUNK_MESSAGE.search(/try again/i)
    if (retryAt !== -1) expect(reloadAt).toBeLessThan(retryAt)
  })
})
