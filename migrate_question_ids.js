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
// Window rather than a count, and every subject: the value of the ids is
// highest on GAT papers, where 7-11% of bank questions carry a figure against
// ~1% in Maths. Baked in rather than a flag so the permitted command string
// stays exactly `node migrate_question_ids.js [--apply]`.
const DAYS = 30

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
  const cutoff = new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10)
  const exams = (await trkGet(
    `exams?select=id,name,subject,questions&date=gte.${cutoff}&order=date.desc`
  )).filter(e => (e.questions || []).length > 0)
  console.log(`exams since ${cutoff}: ${exams.length}`)

  // The bank's LWS Maths corpus, hashed on normalised text.
  const orgs = await vaultGet(`organizations?select=id&name=eq.LWS%20Pune`)
  if (orgs.length !== 1) throw new Error(`expected one LWS Pune org, got ${orgs.length}`)
  // The bank holds the same PYQ under several exams (NDA, CDS, ...), so one text
  // can name more than one row. Prefer this paper's own corpus before calling it
  // ambiguous: a CDS copy of an NDA question is the same question, but the NDA
  // row is the one the paper was built from.
  const ndaExams = await vaultGet(`exams?select=id&name=eq.NDA`)
  const NDA = new Set(ndaExams.map(e => e.id))
  const byHash = new Map()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const page = await vaultGet(
      `questions?select=id,text,exam_id&org_id=eq.${orgs[0].id}&offset=${from}&limit=${PAGE}`
    )
    for (const q of page) {
      const k = hash(q.text)
      if (!byHash.has(k)) byHash.set(k, [])
      byHash.get(k).push(q)
    }
    if (page.length < PAGE) break
  }
  console.log(`bank: ${byHash.size} distinct question texts`)

  let totalMapped = 0, totalNone = 0, totalAmbig = 0
  for (const exam of exams) {
    let none = 0, ambig = 0
    const next = exam.questions.map(q => {
      if (q.questionId) return q                 // already carries one; never re-decide
      let hits = byHash.get(hash(q.question)) || []
      if (hits.length === 0) { none++; return q }
      if (hits.length > 1) {
        const nda = hits.filter(h => NDA.has(h.exam_id))
        if (nda.length === 1) hits = nda
      }
      if (hits.length === 1 && UUID.test(hits[0].id)) return { ...q, questionId: hits[0].id }
      ambig++
      return q
    })
    const mapped = next.filter(q => q.questionId).length
    totalMapped += mapped; totalNone += none; totalAmbig += ambig
    console.log(`${(exam.subject || '?').slice(0, 7).padEnd(7)} ${exam.name.slice(0, 30).padEnd(30)} mapped ${String(mapped).padStart(3)}  notInBank ${String(none).padStart(3)}  ambiguous ${String(ambig).padStart(3)}`)

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

  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'} — mapped ${totalMapped}, not in bank ${totalNone}, ambiguous ${totalAmbig}, exams ${exams.length}`)
  if (!APPLY) console.log('re-run with --apply to write')
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
