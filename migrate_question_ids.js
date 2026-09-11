// One-off backfill: attach PYQ Vault question ids to exams that predate the
// QuestionId column (2026-09-11). Dry-run by default; `--apply` writes.
//
// Matching is EXACT question text (whitespace-normalised), and a question is
// only claimed when it matches EXACTLY ONE bank row. A text appearing twice in
// the bank is skipped, never guessed: a wrong id would later hydrate another
// question's diagram into this paper, which is the one real harm here.
//
// Writes `questions[].questionId` and nothing else. Reversible by clearing it.
//
// NOTE: any admin tab open while this runs holds a stale copy of these exams
// and would write the old questions back on its next save. Reload open tabs.

import { readFileSync } from 'fs'
import { createHash } from 'crypto'

const APPLY = process.argv.includes('--apply')
const LIMIT = 10          // most recent Maths MCQ exams to consider
const SUBJECT = 'Maths'

function readEnv(path) {
  return Object.fromEntries(
    readFileSync(path, 'utf8').split('\n')
      .map(l => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean)
      .map(m => [m[1], m[2].trim()])
  )
}

const trk = readEnv('.env.local')
const vault = readEnv('../Question_Bank/.env.local')

const norm = s => String(s || '').replace(/\s+/g, ' ').trim()
const hash = s => createHash('md5').update(norm(s)).digest('hex')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const rest = (base, key) => async (path) => {
  const res = await fetch(`${base}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`)
  return res.json()
}
const trkGet = rest(trk.VITE_SUPABASE_URL, trk.SUPABASE_SERVICE_ROLE_KEY)
const vaultGet = rest(vault.NEXT_PUBLIC_SUPABASE_URL, vault.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  const exams = (await trkGet(
    `exams?select=id,name,questions&subject=eq.${SUBJECT}&order=date.desc&limit=${LIMIT}`
  )).filter(e => (e.questions || []).length > 0)

  // The bank's LWS Maths corpus, hashed on normalised text.
  const orgs = await vaultGet(`organizations?select=id&name=eq.LWS%20Pune`)
  if (orgs.length !== 1) throw new Error(`expected one LWS Pune org, got ${orgs.length}`)
  const subjects = await vaultGet(`subjects?select=id&name=in.(Mathematics,Maths)`)
  const subjIds = subjects.map(s => s.id).join(',')

  const byHash = new Map()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const page = await vaultGet(
      `questions?select=id,text&org_id=eq.${orgs[0].id}&subject_id=in.(${subjIds})` +
      `&offset=${from}&limit=${PAGE}`
    )
    for (const q of page) {
      const k = hash(q.text)
      if (!byHash.has(k)) byHash.set(k, [])
      byHash.get(k).push(q.id)
    }
    if (page.length < PAGE) break
  }
  console.log(`bank: ${byHash.size} distinct question texts`)

  let totalMapped = 0, totalSkipped = 0
  for (const exam of exams) {
    const next = exam.questions.map(q => {
      const hits = byHash.get(hash(q.question)) || []
      if (hits.length === 1 && UUID.test(hits[0])) return { ...q, questionId: hits[0] }
      return q
    })
    const mapped = next.filter(q => q.questionId).length
    const skipped = next.length - mapped
    totalMapped += mapped; totalSkipped += skipped
    console.log(`${exam.name.slice(0, 34).padEnd(34)} mapped ${String(mapped).padStart(3)}  skipped ${skipped}`)

    if (APPLY) {
      const res = await fetch(
        `${trk.VITE_SUPABASE_URL}/rest/v1/exams?id=eq.${encodeURIComponent(exam.id)}`,
        {
          method: 'PATCH',
          headers: {
            apikey: trk.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${trk.SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({ questions: next, updated_at: new Date().toISOString() }),
        }
      )
      if (!res.ok) throw new Error(`PATCH ${exam.id} -> ${res.status} ${await res.text()}`)
    }
  }

  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'} — mapped ${totalMapped}, skipped ${totalSkipped}, exams ${exams.length}`)
  if (!APPLY) console.log('re-run with --apply to write')
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
