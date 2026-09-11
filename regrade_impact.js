// What a mis-graded question actually cost, per student. READ-ONLY.
//
//   node regrade_impact.js --exam=<exam_id> --q=<question number>
//   node regrade_impact.js --finding=item-stats-2026-09-12     # the two known ones
//
// WRITES NOTHING, EVER. It recomputes what each student's verdict WOULD be from
// their recorded choice and the exam's own key, and reports the marks delta. The
// re-grade action is deliberately unbuilt (see CLAUDE.md); correcting marks is a
// human decision followed by a deliberate write, not a side effect of a report.
//
// WHY THIS EXISTS. PYQ Vault's item statistics surface `verdict_mismatch` --
// attempts where the recorded mark disagrees with the key, i.e. a mis-keyed or
// dropped question. That flag says a sitting is wrong; this says by how much and
// to whom, which is what a decision actually needs.
//
// It reads `choices`, so it can only speak for rows that have one (capture began
// 2026-06-10). A row with a verdict and no choice is REPORTED as unknowable
// rather than assumed either way.

import { readFileSync } from 'fs'

function readEnv(path) {
  return Object.fromEntries(
    readFileSync(path, 'utf8').split('\n')
      .map(l => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean)
      .map(m => [m[1], m[2].trim()])
  )
}
const env = readEnv('.env.local')
const get = async (path) => {
  const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  })
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`)
  return res.json()
}

// The two adjudicated on 2026-09-12. Both bank keys were verified CORRECT; the
// defect is in this repo's grading. Kept as data so the report is reproducible
// rather than a remembered command line.
const FINDINGS = {
  'item-stats-2026-09-12': [
    { q: 108, match: 'Blueprint mock 1', why: 'every attempter credited though nobody chose the key' },
    { q: 25, match: 'GAT MOCK W011', why: 'every attempter denied, including those who chose the key' },
  ],
}

const flag = (n) => {
  const hit = process.argv.find(a => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : null
}

function analyse(exam, results, qn) {
  const q = (exam.questions || []).find(z => String(z.q) === String(qn))
  const key = q && q.answer ? String(q.answer).toUpperCase() : null
  const correct = Number(exam.marking?.correct ?? 0)
  const wrong = Number(exam.marking?.wrong ?? 0)

  const affected = []
  let unknowable = 0
  for (const r of results) {
    const verdict = (r.responses || {})[String(qn)]
    if (verdict === undefined || verdict === null) continue
    if (verdict === 0) continue                       // did not attempt; nothing to regrade
    const chose = (r.choices || {})[String(qn)]
    if (!chose) { unknowable += 1; continue }         // pre-capture row: cannot say

    const should = String(chose).toUpperCase() === key ? 1 : -1
    if (should === verdict) continue
    const gave = verdict === 1 ? correct : wrong
    const owed = should === 1 ? correct : wrong
    affected.push({
      name: r.student_name,
      chose: String(chose).toUpperCase(),
      gotMarked: verdict === 1 ? 'correct' : 'wrong',
      shouldBe: should === 1 ? 'correct' : 'wrong',
      delta: Math.round((owed - gave) * 100) / 100,
      totalNow: Number(r.total_marks),
      totalCorrected: Math.round((Number(r.total_marks) + (owed - gave)) * 100) / 100,
    })
  }
  return { key, correct, wrong, affected, unknowable }
}

async function main() {
  const finding = flag('finding')
  const examFlag = flag('exam')
  const qFlag = flag('q')

  let targets = []
  if (finding) {
    const spec = FINDINGS[finding]
    if (!spec) throw new Error(`unknown finding "${finding}" (known: ${Object.keys(FINDINGS).join(', ')})`)
    const exams = await get('exams?select=id,name,date,batch,marking,questions')
    for (const s of spec) {
      for (const ex of exams) {
        if (!String(ex.name || '').includes(s.match)) continue
        if (!(ex.questions || []).some(z => String(z.q) === String(s.q))) continue
        targets.push({ exam: ex, qn: s.q, why: s.why })
      }
    }
  } else if (examFlag && qFlag) {
    const exams = await get(`exams?select=id,name,date,batch,marking,questions&id=eq.${examFlag}`)
    if (!exams.length) throw new Error(`no exam ${examFlag}`)
    targets = [{ exam: exams[0], qn: Number(qFlag), why: '' }]
  } else {
    throw new Error('pass --finding=<name> or --exam=<id> --q=<number>')
  }

  let grandTotal = 0
  let grandStudents = 0
  for (const { exam, qn, why } of targets) {
    const results = await get(`exam_results?select=student_name,total_marks,responses,choices&exam_id=eq.${exam.id}`)
    const { key, affected, unknowable } = analyse(exam, results, qn)
    console.log(`\n"${exam.name}"  q${qn}   ${exam.date}`)
    console.log(`  batches : ${exam.batch}`)
    console.log(`  key     : ${key}   marking ${JSON.stringify(exam.marking)}`)
    if (why) console.log(`  finding : ${why}`)
    if (unknowable) console.log(`  NOTE    : ${unknowable} attempt(s) have no recorded choice — cannot be regraded either way`)
    if (!affected.length) { console.log('  no student is mis-marked on this question.'); continue }

    const sum = affected.reduce((s, a) => s + a.delta, 0)
    grandTotal += sum
    grandStudents += affected.length
    console.log(`  MIS-MARKED: ${affected.length} student(s), net ${sum > 0 ? '+' : ''}${Math.round(sum * 100) / 100} marks`)
    for (const a of affected) {
      console.log(
        `    ${a.name.padEnd(28)} chose ${a.chose}  marked ${a.gotMarked.padEnd(7)} should be ${a.shouldBe.padEnd(7)}` +
        `  ${a.delta > 0 ? '+' : ''}${a.delta}   ${a.totalNow} -> ${a.totalCorrected}`
      )
    }
  }

  console.log(`\nTOTAL: ${grandStudents} student-question(s) mis-marked, net ${grandTotal > 0 ? '+' : ''}${Math.round(grandTotal * 100) / 100} marks`)
  console.log('NOTHING WAS WRITTEN. Correcting these is a deliberate, separate decision.')
}

main().catch(e => { console.error(e.message); process.exit(1) })
