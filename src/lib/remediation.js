// Pure helpers for "fix your mistakes" remediation links on the quiz review
// screen. A wrong/skipped daily-quiz question carries the PYQ Vault slugs it was
// pushed with — `subtopic` (a notes subtopic slug) and `conceptSlug` — so we can
// link the student straight to the lesson that teaches it ("Learn this") and to
// a practice set on the same topic ("Practice").
//
// Resolution of those slugs to real /notes and /browse URLs lives in PYQ Vault's
// /go/learn and /go/practice redirects — this side just builds the URL from the
// strings it already has. No UUIDs, no taxonomy knowledge here.

export const PYQVAULT_URL = 'https://www.pyqvault.com'

// Subjects that actually have a practice-question bank in PYQ Vault. Practice
// ingestion is NDA Maths only today; extend this list as it grows so we never
// show a "Practice" link that lands on an empty page.
export const PRACTICE_SUBJECTS = ['Maths']

export function hasPracticeBank(subject) {
  return PRACTICE_SUBJECTS.includes(String(subject || '').trim())
}

// "Learn this" → the /notes concept that teaches this question. Needs the notes
// subtopic slug (q.subtopic) and/or the concept anchor (q.conceptSlug). Returns
// null when the question carries neither (e.g. a hand-authored quiz with no
// notes provenance) so the caller can hide the link.
export function buildLearnUrl(question) {
  const subtopic = question && question.subtopic ? String(question.subtopic) : ''
  const concept = question && question.conceptSlug ? String(question.conceptSlug) : ''
  if (!subtopic && !concept) return null
  const p = new URLSearchParams()
  if (subtopic) p.set('subtopic', subtopic)
  if (concept) p.set('concept', concept)
  return `${PYQVAULT_URL}/go/learn?${p.toString()}`
}

// "Practice" → a practice-bank set on the same subtopic(s). Pass one or more
// notes subtopic slugs. Returns null when none are present.
export function buildPracticeUrl(subtopics) {
  const slugs = (subtopics || []).filter(Boolean).map(String)
  if (slugs.length === 0) return null
  const p = new URLSearchParams()
  for (const s of slugs) p.append('subtopic', s)
  return `${PYQVAULT_URL}/go/practice?${p.toString()}`
}

// The distinct subtopic slugs among a set of questions — for one bundled
// "Practice my mistakes" link rather than one per question.
export function distinctSubtopics(questions) {
  const seen = []
  const have = new Set()
  for (const q of questions || []) {
    const s = q && q.subtopic ? String(q.subtopic) : ''
    if (s && !have.has(s)) { have.add(s); seen.push(s) }
  }
  return seen
}

// Per-question remediation links for the review screen. "Learn this" is shown
// whenever the question has notes provenance; "Practice" only when the quiz's
// subject has a practice bank (otherwise it would land on an empty page).
export function remediationLinks(question, subject) {
  const learnUrl = buildLearnUrl(question)
  const practiceUrl =
    hasPracticeBank(subject) && question && question.subtopic
      ? buildPracticeUrl([question.subtopic])
      : null
  return { learnUrl, practiceUrl }
}

// One bundled "Practice my mistakes" link from the wrong/skipped questions.
// Maths-gated (returns null otherwise) so we never promise an empty set.
export function practiceMistakesUrl(questions, subject) {
  if (!hasPracticeBank(subject)) return null
  return buildPracticeUrl(distinctSubtopics(questions))
}

// ── Exam remediation ──────────────────────────────────────────────────────
// Exam questions carry DB NAMES (subject, chapter, subtopic) and — once the
// Tags export emits them — optional notes slugs (subtopicSlug, conceptSlug).
// We pass whatever the question has; PYQ Vault's /go routes resolve slug-first,
// then by name. Unlike quizzes, exams are multi-subject and the practice link
// works for every subject (PYQ bank covers non-Maths), so it isn't gated.

// "Learn this" → the /notes page (concept anchor when a conceptSlug is present).
export function examLearnUrl(q) {
  if (!q) return null
  const subtopic = q.subtopicSlug || q.subtopic
  if (!subtopic) return null
  const p = new URLSearchParams()
  p.set('subtopic', String(subtopic))
  if (q.conceptSlug) p.set('concept', String(q.conceptSlug))
  if (q.chapter) p.set('chapter', String(q.chapter))
  return `${PYQVAULT_URL}/go/learn?${p.toString()}`
}

// "Practice" → drill more on this subtopic. PYQ Vault picks the corpus by
// subject (Maths → practice bank, else → PYQ bank).
export function examPracticeUrl(q, exam = 'NDA') {
  if (!q) return null
  const subtopic = q.subtopicSlug || q.subtopic
  if (!subtopic) return null
  const p = new URLSearchParams()
  p.set('subtopic', String(subtopic))
  if (q.subject) p.set('subject', String(q.subject))
  if (q.chapter) p.set('chapter', String(q.chapter))
  p.set('exam', exam)
  return `${PYQVAULT_URL}/go/practice?${p.toString()}`
}

export function examRemediationLinks(q) {
  return { learnUrl: examLearnUrl(q), practiceUrl: examPracticeUrl(q) }
}
