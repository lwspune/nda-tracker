// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { dirname, resolve, join } from 'path'

// Serverless functions run under Node's ESM loader, which requires a file
// EXTENSION on every relative import. Vitest and Vite resolve extensionless
// specifiers via bundler resolution, so a missing ".js" passes every test and
// then crashes in production at module load — before the handler body runs.
//
// 2026-07-28: `src/lib/whatsappResultScore.js` imported './analyticsHelpers'.
// 2106 tests passed; the deployed /api/send-whatsapp returned a 500
// ERR_MODULE_NOT_FOUND HTML page, which the client failed to parse as JSON
// ("Unexpected token 'A'"). This walks the whole graph reachable from api/*.js
// so the next one is caught here instead of by a faculty member clicking Send.

const API_DIR  = resolve(__dirname, '..')
const RELATIVE = /(?:^|[\s;])(?:import|export)[\s\S]*?from\s*['"](\.[^'"]*)['"]/g

function relativeImports(file) {
  const src = readFileSync(file, 'utf-8')
  return [...src.matchAll(RELATIVE)].map(m => m[1])
}

// Entry points = what Vercel actually bundles: top-level api/*.js, including
// the "_"-prefixed helpers (not endpoints themselves, but imported by them).
function entryPoints() {
  return readdirSync(API_DIR)
    .filter(f => f.endsWith('.js'))
    .map(f => join(API_DIR, f))
}

// Walks every relative import transitively, collecting violations rather than
// throwing on the first, so one run reports the whole graph.
function walk() {
  const seen = new Set()
  const missingExtension = []
  const unresolvable = []
  const queue = entryPoints()

  while (queue.length) {
    const file = queue.shift()
    if (seen.has(file) || !existsSync(file)) continue
    seen.add(file)

    for (const spec of relativeImports(file)) {
      if (!/\.(js|jsx|json)$/.test(spec)) {
        missingExtension.push(`${file.replace(API_DIR, 'api')} → "${spec}"`)
        continue                            // can't resolve it reliably either
      }
      const target = resolve(dirname(file), spec)
      if (!existsSync(target)) {
        unresolvable.push(`${file.replace(API_DIR, 'api')} → "${spec}"`)
        continue
      }
      queue.push(target)
    }
  }
  return { missingExtension, unresolvable, visited: seen.size }
}

describe('api/ import graph — Node ESM resolution', () => {
  const result = walk()

  it('reaches more than just the entry points (the walk actually recurses)', () => {
    // Guards the guard: a broken regex would silently visit nothing and pass.
    expect(result.visited).toBeGreaterThan(entryPoints().length)
  })

  it('has no extensionless relative imports anywhere it can reach', () => {
    expect(result.missingExtension).toEqual([])
  })

  it('resolves every relative import to a file that exists', () => {
    expect(result.unresolvable).toEqual([])
  })
})
