// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The single reader of local dev env vars, extracted from eleven identical
// private copies on 2026-09-12.
//
// Semantics that must not drift: `.env.local` wins over process.env (a local
// dev override is the whole point of the file), a missing file is not an error
// (on Vercel there is none — everything comes from process.env), and a missing
// key reads as '' rather than undefined, because every call site tests it with
// a plain falsy check before failing closed with a 500 config error.

vi.mock('fs', () => ({ readFileSync: vi.fn() }))

const { readFileSync } = await import('fs')
const { readEnvLocal, envReader } = await import('../_env.js')

beforeEach(() => { vi.mocked(readFileSync).mockReset() })
afterEach(() => { vi.unstubAllEnvs() })

describe('readEnvLocal', () => {
  it('parses KEY=value lines', () => {
    vi.mocked(readFileSync).mockReturnValue('WABRIDGE_APP_KEY=abc\nWABRIDGE_DEVICE_ID=dev-1\n')
    expect(readEnvLocal()).toEqual({ WABRIDGE_APP_KEY: 'abc', WABRIDGE_DEVICE_ID: 'dev-1' })
  })

  it('trims trailing whitespace from values', () => {
    vi.mocked(readFileSync).mockReturnValue('WABRIDGE_APP_KEY=abc   \n')
    expect(readEnvLocal().WABRIDGE_APP_KEY).toBe('abc')
  })

  it('ignores comments, blank lines and lower-case keys', () => {
    vi.mocked(readFileSync).mockReturnValue('# a comment\n\nlower_case=x\nVITE_SUPABASE_URL=https://x.supabase.co\n')
    expect(readEnvLocal()).toEqual({ VITE_SUPABASE_URL: 'https://x.supabase.co' })
  })

  // The eleven private copies disagreed: eight matched [A-Z_], three allowed
  // digits. No key in use carries one today, so nothing was broken — but the
  // permissive pattern is the superset, and a narrow one can only ever drop a
  // key silently. Pinning the surviving behaviour.
  it('accepts a digit in the key name', () => {
    vi.mocked(readFileSync).mockReturnValue('WABRIDGE_TEMPLATE_ID_2=tpl-2\n')
    expect(readEnvLocal().WABRIDGE_TEMPLATE_ID_2).toBe('tpl-2')
  })

  it('keeps a value containing = (a JWT or a URL with a query)', () => {
    vi.mocked(readFileSync).mockReturnValue('SUPABASE_SERVICE_ROLE_KEY=aa.bb==\n')
    expect(readEnvLocal().SUPABASE_SERVICE_ROLE_KEY).toBe('aa.bb==')
  })

  // On Vercel there is no .env.local at all. This must be silent, not a throw:
  // it runs at the top of every handler.
  it('returns an empty object when the file is absent', () => {
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT') })
    expect(readEnvLocal()).toEqual({})
  })
})

describe('envReader', () => {
  it('prefers .env.local over process.env', () => {
    vi.mocked(readFileSync).mockReturnValue('WABRIDGE_APP_KEY=from-file\n')
    vi.stubEnv('WABRIDGE_APP_KEY', 'from-process')
    expect(envReader()('WABRIDGE_APP_KEY')).toBe('from-file')
  })

  it('falls back to process.env when the key is not in the file', () => {
    vi.mocked(readFileSync).mockReturnValue('')
    vi.stubEnv('WABRIDGE_APP_KEY', 'from-process')
    expect(envReader()('WABRIDGE_APP_KEY')).toBe('from-process')
  })

  // Every caller does `if (!appKey) return 500` — '' keeps that check working
  // and keeps a missing var out of a template variable as the string
  // "undefined".
  it('reads a missing key as an empty string, never undefined', () => {
    vi.mocked(readFileSync).mockReturnValue('')
    expect(envReader()('NOT_SET_ANYWHERE')).toBe('')
  })

  it('reads the file once per reader, not once per key', () => {
    vi.mocked(readFileSync).mockReturnValue('A=1\nB=2\n')
    const pick = envReader()
    pick('A'); pick('B'); pick('A')
    expect(vi.mocked(readFileSync)).toHaveBeenCalledTimes(1)
  })
})
