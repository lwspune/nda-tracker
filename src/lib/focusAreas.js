// ── Student "Where to focus" view-model ──────────────────────────────────────
// Bridges the concept graph (chapter-level root-cause / sequencing) to the
// subtopic-level PYQ Vault practice links. Consumes what StudentView already
// computes — computeProjectedScore().breakdown (per-chapter accuracy) plus the
// wrong/skipped audits (per-subtopic weakness) — so it adds no new pipeline.
//
// startHere:    weak chapters grouped under their deepest weak prerequisite (the
//               root cause), weakest root first, each with one bundled Practice
//               link built from the student's own wrong+skipped subtopics in that
//               root chapter (Maths only — the practice bank is Maths today).
// readyToLearn: the unlockable frontier — not-yet-mastered chapters whose every
//               prerequisite is mastered, closest-to-mastery first.
import { getRootCauseChain, getReadyToLearn, CHAPTER_PREREQS } from './conceptGraph'
import { buildPracticeUrl, hasPracticeBank } from './remediation'

export function buildFocusAreas({
  breakdown = [],
  wrongAudit = [],
  skippedAudit = [],
  subject = 'Maths',
  weakThreshold = 0.5,
  masteredThreshold = 0.7,
  graph = CHAPTER_PREREQS,
} = {}) {
  const accByChapter = {}
  breakdown.forEach(r => { accByChapter[r.chapter] = r.accuracy ?? null })

  // Distinct subtopic names the student got wrong or skipped, per chapter.
  const weakSubtopics = {}
  ;[...wrongAudit, ...skippedAudit].forEach(a => {
    if (!a || !a.chapter || !a.subtopic) return
    if (!weakSubtopics[a.chapter]) weakSubtopics[a.chapter] = new Set()
    weakSubtopics[a.chapter].add(a.subtopic)
  })

  // Group weak chapters under their root cause.
  const byRoot = new Map()
  getRootCauseChain(accByChapter, { threshold: weakThreshold, graph }).forEach(
    ({ chapter, root, rootAccuracy }) => {
      if (!byRoot.has(root)) byRoot.set(root, { chapter: root, rootAccuracy, from: [] })
      if (chapter !== root) byRoot.get(root).from.push(chapter)
    }
  )

  const startHere = [...byRoot.values()]
    .sort((x, y) => (x.rootAccuracy ?? 1) - (y.rootAccuracy ?? 1))
    .map(({ chapter, from }) => {
      const subs = [...(weakSubtopics[chapter] || [])]
      const practiceUrl = hasPracticeBank(subject) && subs.length ? buildPracticeUrl(subs) : null
      return { chapter, from, practiceUrl }
    })

  const readyToLearn = getReadyToLearn(accByChapter, { masteredThreshold, graph })
    .sort((a, b) => {
      // Tested-but-not-mastered (closest to mastery) first; untested last.
      if (a.accuracy == null && b.accuracy == null) return 0
      if (a.accuracy == null) return 1
      if (b.accuracy == null) return -1
      return b.accuracy - a.accuracy
    })
    .map(r => r.chapter)

  return { startHere, readyToLearn }
}
