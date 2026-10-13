// npm run grading:vault -- "phrase" ["another phrase" …] [--limit=N]
//
// Look a homework question up in PYQ Vault and print its stored solution. Every
// phrase must appear in the question text; plain words from the question work
// best (stored maths is LaTeX). Read-only.
//
// PYQ Vault is a separate Supabase project. Its keys stay in its own repo and
// are read from there at run time, never copied here: PYQ_VAULT_DIR, else the
// sibling folder ../Question_Bank.
import { join } from 'node:path'
import { readEnvLocal } from '../../api/_env.js'
import { vaultSearchPath, formatVaultHit } from '../../src/lib/assignments/vaultLookup.js'
import { arg, fail } from './_client.js'

async function main() {
  const dir = process.env.PYQ_VAULT_DIR || join(process.cwd(), '..', 'Question_Bank')
  const env = readEnvLocal(join(dir, '.env.local'))
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error(`PYQ Vault keys not found in ${join(dir, '.env.local')} (set PYQ_VAULT_DIR to its repo).`)

  const terms = process.argv.slice(2).filter(a => !a.startsWith('--'))
  const limit = Number(arg('limit')) || 5
  const r = await fetch(`${url}/rest/v1/${vaultSearchPath(terms, { limit })}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  const body = await r.json()
  if (!r.ok) throw new Error(`PYQ Vault search failed (${r.status}): ${body?.message ?? 'unknown error'}`)
  if (!body.length) {
    console.log('No match. Try fewer or plainer phrases: maths is stored as LaTeX, e.g. ax^{2} + 2hxy.')
    return
  }
  console.log(`${body.length} match(es). A reference, not the mark scheme: work the answer out yourself.\n`)
  console.log(body.map(formatVaultHit).join('\n\n'))
}

main().catch(fail)
