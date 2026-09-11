// Item statistics export — the Question Stats evidence, in a shape PYQ Vault can
// ingest. READ-ONLY: writes to neither database.
//
//   node item_stats.js                  # summary only
//   node item_stats.js --out=item-stats.json
//
// THIS DOES NOT RE-IMPLEMENT THE ANALYSIS. It calls the SAME
// `computeItemStats` the Question Stats page uses, ONCE PER EXAM RECORD, and
// emits what comes back. Two implementations of "how hard is this question"
// would drift, and the scoring rule here is subtle enough that a second copy
// would certainly get it wrong — correctness is decided by the KEY, not by
// Evalbee's verdict, because difficulty asks "did they pick the right option"
// while the verdict answers "what mark did they get", and the two diverge
// exactly when a paper was mis-keyed or a question was dropped.
//
// WHY PER RECORD. The page pools, correctly, for a human reading one list. The
// export must not: the same paper runs for several batches, and a pooled figure
// cannot be un-pooled when one sitting turns out to be bad, an institute leaves,
// or a key is found wrong. So the export calls the pure core once per record and
// lets the bank pool — that is where these meet the vault's own /mock responses.
// See ITEM_STATS.md here and its counterpart in Question_Bank.
//
// Marks are untouched. Nothing here re-grades anything.

import { readFileSync, writeFileSync } from 'fs'
import { computeItemStats } from './src/lib/itemStats.js'

function readEnv(path) {
  return Object.fromEntries(
    readFileSync(path, 'utf8').split('\n')
      .map(l => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean)
      .map(m => [m[1], m[2].trim()])
  )
}

const trk = readEnv('.env.local')

const rest = (base, key) => async (path) => {
  const res = await fetch(`${base}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`)
  return res.json()
}
const get = rest(trk.VITE_SUPABASE_URL, trk.SUPABASE_SERVICE_ROLE_KEY)

// exam_results is 1636+ rows and Supabase defaults to 1000. Paginate, or the
// tail of the corpus silently does not exist.
const PAGE = 1000
async function getAll(table, select, extra = '') {
  const out = []
  for (let from = 0; ; from += PAGE) {
    const page = await get(`${table}?select=${select}${extra}&offset=${from}&limit=${PAGE}`)
    out.push(...page)
    if (page.length < PAGE) return out
  }
}

const outFlag = process.argv.find(a => a.startsWith('--out='))

async function main() {
  const exams = await getAll('exams', 'id,name,date,subject,batch,branch,questions', '&order=date.desc')
  const results = await getAll('exam_results', 'exam_id,student_name,total_marks,responses,choices')
  console.log(`exams ${exams.length} | result rows ${results.length}`)

  const resultsByExam = new Map()
  for (const r of results) {
    const list = resultsByExam.get(r.exam_id) || []
    list.push(r)
    resultsByExam.set(r.exam_id, list)
  }

  const rows = []
  // A key that differs ACROSS records cannot be seen from inside one record, so
  // it is tracked here instead. The pure core's own keyConflicts can never fire
  // on a single-exam call, by construction.
  const keysByQuestion = new Map()
  let offlineExams = 0
  let examsWithoutResults = 0

  for (const exam of exams) {
    if (!(exam.questions || []).length) { offlineExams += 1; continue }
    const examResults = resultsByExam.get(exam.id) || []
    if (!examResults.length) { examsWithoutResults += 1; continue }

    // The store shape the pure core expects: students[] carrying responses and
    // choices, which the client already has joined and a script must build.
    const storeExam = {
      ...exam,
      students: examResults.map(r => ({
        name: r.student_name,
        totalMarks: typeof r.total_marks === 'number' ? r.total_marks : Number(r.total_marks) || 0,
        responses: r.responses || {},
        choices: r.choices || {},
      })),
    }

    // minAttempts: 1 — thresholds are a READ-time concern. A record with n=8 may
    // pool to 40, so filtering here would discard evidence the consumer needs.
    const { rows: examRows } = computeItemStats([storeExam], { minAttempts: 1 })

    for (const r of examRows) {
      rows.push({
        questionId: r.questionId,
        examId: exam.id,
        examName: exam.name || null,
        subject: r.subject || null,
        cohort: exam.batch || null,
        seen: r.seen,
        attempted: r.attempted,
        skipped: r.skipped,
        correct: r.correct,
        choiceCounts: r.choiceCounts,
        // Attempts where Evalbee's mark disagrees with the key. Non-zero means
        // the paper was mis-keyed or the question was dropped — the strongest
        // signal available and, unlike a winning distractor, unambiguous.
        verdictMismatch: r.verdictMismatch,
        // ALL FOUR OR NONE, gated on BOTH halves being non-empty — the same
        // condition the pure core uses for `discrimination`. Emitting them
        // independently yields a half-populated split (top present, bottom
        // null) whenever a sitting's bottom group never saw the question, and a
        // half split silently biases whatever pools it. The consumer's schema
        // rejects it outright, which is how this was caught.
        discTopCorrect: r.upperSeen && r.lowerSeen ? r.upperCorrect : null,
        discTopN: r.upperSeen && r.lowerSeen ? r.upperSeen : null,
        discBottomCorrect: r.upperSeen && r.lowerSeen ? r.lowerCorrect : null,
        discBottomN: r.upperSeen && r.lowerSeen ? r.lowerSeen : null,
        keyAtMeasurement: r.keyed || null,
        measuredAt: exam.date || null,
      })
      if (r.keyed) {
        const byAnswer = keysByQuestion.get(r.questionId) || new Map()
        byAnswer.set(r.keyed, [...(byAnswer.get(r.keyed) || []), exam.id])
        keysByQuestion.set(r.questionId, byAnswer)
      }
    }
  }

  const conflicts = []
  for (const [questionId, byAnswer] of keysByQuestion) {
    if (byAnswer.size < 2) continue
    conflicts.push({
      questionId,
      keys: [...byAnswer.entries()].map(([answer, examIds]) => ({ answer, examIds })),
    })
  }

  const questions = new Set(rows.map(r => r.questionId))
  const pooledSeen = new Map()
  const pooledAtt = new Map()
  const records = new Map()
  for (const r of rows) {
    pooledSeen.set(r.questionId, (pooledSeen.get(r.questionId) || 0) + r.seen)
    pooledAtt.set(r.questionId, (pooledAtt.get(r.questionId) || 0) + r.attempted)
    records.set(r.questionId, (records.get(r.questionId) || 0) + 1)
  }
  const atLeast = (m, n) => [...m.values()].filter(v => v >= n).length

  console.log([
    `rows (question x sitting)    ${rows.length}`,
    `distinct questions           ${questions.size}`,
    // BOTH BASES ON PURPOSE. ITEM_STATS.md quotes one of each without saying so:
    // its "1,259 with >= 20 attempts" is a SEEN count, while the "122 of 553"
    // denominator is an ATTEMPTED one. Attempted is the basis that matters, for
    // the same reason pCorrect is over attempted.
    `  pooled by ATTEMPTED n>=10  ${atLeast(pooledAtt, 10)}`,
    `  pooled by ATTEMPTED n>=20  ${atLeast(pooledAtt, 20)}`,
    `  pooled by SEEN      n>=20  ${atLeast(pooledSeen, 20)}   (NOT the usable count)`,
    `total attempts               ${rows.reduce((s, r) => s + r.attempted, 0)}`,
    `VERDICT MISMATCHES           ${rows.reduce((s, r) => s + r.verdictMismatch, 0)} attempts over ${rows.filter(r => r.verdictMismatch > 0).length} rows`,
    `questions in >1 record       ${[...records.values()].filter(v => v > 1).length}`,
    `KEY CONFLICTS across records ${conflicts.length}`,
    `skipped: offline exams ${offlineExams} | exams with no results ${examsWithoutResults}`,
  ].join('\n'))

  for (const c of conflicts) {
    console.log(`  CONFLICT ${c.questionId}: ${c.keys.map(k => `${k.answer}(${k.examIds.join(',')})`).join(' vs ')}`)
  }

  if (!outFlag) {
    console.log('\nNo --out= given; nothing written.')
    return
  }
  const path = outFlag.slice('--out='.length)
  writeFileSync(path, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: 'nda-tracker',
    // Per-record, never pooled. The consumer stores at this grain.
    grain: 'question-per-exam-record',
    rows,
    conflicts,
  }, null, 2))
  console.log(`\nwrote ${rows.length} rows -> ${path}`)
}

main().catch(e => { console.error(e); process.exit(1) })
