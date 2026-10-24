// What a grading run works through, and what it may clear away. PURE.
// Imported by Node scripts (scripts/grading/pull.js, scheme.js), so relative
// imports carry their .js extension.
//
// The queue names no student, as the brief does not: one student's hand-ins
// are linked by an opaque key (a hash of their id, made by the caller), which
// is all the ordering below needs.

const time = v => {
  const t = Date.parse(v ?? '')
  return Number.isFinite(t) ? t : Infinity
}

// entries: one per waiting submission, as pull.js finds it.
// Returns { homeworks, submissions }:
//   homeworks   — earliest deadline first, each with its submissions oldest
//                 hand-in first. `fingerprintConflict` when two pulled folders
//                 of the homework hold a different paper, key or marks (the
//                 2026-10-22 mix-up); its `fingerprint` is then null.
//   submissions — `after` is the same student's previous submission in this
//                 run: a first graded homework becomes the student's
//                 handwriting reference the moment it is saved, so two of
//                 theirs graded side by side would both record no_reference.
//                 `repullFirst` when it was pulled with no reference after one
//                 that will become it.
export function buildGradingQueue(entries) {
  const sorted = [...(entries ?? [])].sort((a, b) =>
    time(a.dueAt) - time(b.dueAt) || time(a.submittedAt) - time(b.submittedAt))

  const homeworks = new Map()
  const lastByStudent = new Map()
  const submissions = []
  for (const e of sorted) {
    let h = homeworks.get(e.homeworkId)
    if (!h) {
      h = {
        homeworkId: e.homeworkId, title: e.title, maxMarks: e.maxMarks ?? null,
        breakdown: e.breakdown ?? [], fingerprint: e.fingerprint ?? null,
        fingerprintConflict: false, submissions: [],
      }
      homeworks.set(e.homeworkId, h)
    } else if (!h.fingerprintConflict && h.fingerprint !== (e.fingerprint ?? null)) {
      h.fingerprintConflict = true
      h.fingerprint = null
    }
    h.submissions.push(e.submissionId)

    const before = lastByStudent.get(e.studentKey) ?? null
    submissions.push({
      submissionId: e.submissionId, homeworkId: e.homeworkId, pages: e.pages ?? 0,
      hasReference: !!e.hasReference, after: before, repullFirst: !!before && !e.hasReference,
    })
    lastByStudent.set(e.studentKey, e.submissionId)
  }

  // Within a homework, oldest hand-in first (the deadline sort already holds).
  for (const h of homeworks.values()) {
    const at = new Map(sorted.map(e => [e.submissionId, time(e.submittedAt)]))
    h.submissions.sort((a, b) => at.get(a) - at.get(b))
  }
  return { homeworks: [...homeworks.values()], submissions }
}

// Statuses whose inbox folder is no longer needed: the grade (or the rejection)
// is in the database, and a re-mark pulls afresh. `submitted` is waiting and
// `uploading` may still become so; neither is ever removed.
const DONE = new Set(['graded', 'held', 'rejected', 'replaced'])

// folders: names in grading-inbox/. Names starting with `_` are the run's own
// (_hand, _scheme, _queue.json) and are never touched here. A folder the
// database does not know is reported, never removed.
// handFolders: homework ids under grading-inbox/_hand/; removed once that
// homework has nothing waiting.
export function planTidy({ folders, statusById, handFolders, waitingHomeworks }) {
  const plan = { remove: [], keep: [], unknown: [], removeHand: [] }
  for (const f of folders ?? []) {
    if (f.startsWith('_')) continue
    const status = statusById?.[f]
    if (!status) plan.unknown.push(f)
    else if (DONE.has(status)) plan.remove.push(f)
    else plan.keep.push(f)
  }
  const waiting = new Set(waitingHomeworks ?? [])
  plan.removeHand = (handFolders ?? []).filter(h => !waiting.has(h))
  return plan
}

// FNV-1a, 32-bit, twice with different seeds: a stable id, not a security hash
// (the inputs are already content hashes made by the caller).
function fnv(str, seed) {
  let h = seed >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

// Everything a marking scheme is written from: the paper, the key, the total,
// the per-question marks and the description. Any change makes the scheme stale.
export function homeworkFingerprint({ assignment: a, paperHashes, keyHashes }) {
  const canonical = JSON.stringify({
    max: a?.max_marks == null ? null : Number(a.max_marks),
    questions: (a?.questions ?? []).map(q => [q.label, Number(q.marks)]),
    instructions: (a?.instructions ?? '').trim(),
    paper: paperHashes ?? [],
    key: keyHashes ?? [],
  })
  return fnv(canonical, 0x811c9dc5) + fnv(canonical, 0x01234567)
}

const TODO = 'TODO'
// `Question` lets a grader recognise the question on a page without opening the
// paper: the givens exactly, since a wrong value copied is a `misread`.
const QUESTION_FIELDS = [
  'Question: TODO what it asks, with every given value exactly as printed',
  'Answer: TODO the final answer, with units',
  'Working: TODO the steps a full answer shows, in order',
  'Split: TODO each share of the marks by rule 2 (GRADING.md), named and in halves',
  'Condition or fact: TODO what the condition share is for (rule 10 / 11), or "none: its mark goes to working"',
  'Other valid methods: TODO routes that also earn full marks (rule 4)',
  'Watch for: TODO slips and wrong turns worth checking closely',
]

const questionSection = (heading) => [`## ${heading}`, '', ...QUESTION_FIELDS.map(f => `- ${f}`), '']
const FINGERPRINT = /^Fingerprint: (\S+)$/m

// The scheme every grader of one homework marks against, written once.
export function schemeTemplate({ homeworkId, title, fingerprint, maxMarks, breakdown }) {
  const out = [
    `# Marking scheme — ${title}`,
    '',
    `Homework: ${homeworkId}`,
    `Fingerprint: ${fingerprint}`,
    `Out of: ${maxMarks ?? '?'}`,
    '',
    'Written once from the paper, the key and scripts/grading/GRADING.md; every submission of this',
    'homework is graded against it. Work every answer out yourself. A grader still gives full marks',
    'to any correct method, and reports (does not follow) a scheme that looks wrong.',
    '',
    '## Key check',
    '',
    `- ${TODO} where the teacher's key and your own working disagree, and which is right; "agrees" if none`,
    '',
  ]
  if (breakdown?.length) {
    for (const q of breakdown) out.push(...questionSection(`${q.label} — ${q.marks} mark${Number(q.marks) === 1 ? '' : 's'}`))
  } else {
    out.push(
      `No per-question marks were set: write one section per question, splitting the ${maxMarks ?? '?'} marks`,
      'the way grade.json will (equal shares unless some questions are clearly bigger).',
      '',
      ...questionSection('Q1 — ? marks'),
    )
  }
  return `${out.join('\n')}\n`
}

export function schemeStatus(text, fingerprint) {
  if (text == null) return 'missing'
  return text.match(FINGERPRINT)?.[1] === fingerprint ? 'current' : 'stale'
}

// Is this scheme fit to grade from? Current, every question the teacher set has
// its section, and no blank left.
export function checkScheme(text, homework) {
  const problems = []
  if (text == null) return { ok: false, problems: ['No scheme written yet.'] }
  if (schemeStatus(text, homework.fingerprint) !== 'current') {
    problems.push('The paper, key or marks changed since this scheme was written: rewrite it.')
  }
  for (const q of homework.breakdown ?? []) {
    if (!new RegExp(`^## ${escape(q.label)} — `, 'm').test(text)) problems.push(`No section for ${q.label}.`)
  }
  const sections = text.split(/^## /m).slice(1)
  for (const s of sections) {
    if (s.includes(TODO)) problems.push(`"${s.split('\n')[0].trim()}" still has blanks (TODO).`)
  }
  return { ok: problems.length === 0, problems }
}

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
