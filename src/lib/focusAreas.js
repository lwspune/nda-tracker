// ── Student "Where to focus" view-model ──────────────────────────────────────
// Bridges the concept graph (chapter-level root-cause / sequencing) to the
// subtopic-level PYQ Vault practice links. Consumes what StudentView already
// computes — computeProjectedScore().breakdown (per-chapter accuracy) plus the
// wrong/skipped audits (per-subtopic weakness) — so it adds no new pipeline.
//
// startHere:    weak chapters grouped under their deepest weak prerequisite (the
//               root cause), weakest root first, each with a chapter-level Learn
//               link (the notes chapter index) and — for Maths — a chapter-level
//               Practice link. Both resolve PYQ-Vault-side, degrading gracefully
//               when a chapter has no notes/practice content yet.
// readyToLearn: the unlockable frontier — not-yet-mastered chapters whose every
//               prerequisite is mastered, closest-to-mastery first.
import { getRootCauseChain, getReadyToLearn, CHAPTER_PREREQS } from './conceptGraph'
import { chapterLearnUrl, chapterPracticeUrl, hasPracticeBank } from './remediation'

export function buildFocusAreas({
  breakdown = [],
  subject = 'Maths',
  weakThreshold = 0.5,
  masteredThreshold = 0.7,
  graph = CHAPTER_PREREQS,
} = {}) {
  const accByChapter = {}
  breakdown.forEach(r => { accByChapter[r.chapter] = r.accuracy ?? null })

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
    .map(({ chapter, from }) => ({
      chapter,
      from,
      learnUrl: chapterLearnUrl(chapter),
      practiceUrl: hasPracticeBank(subject) ? chapterPracticeUrl(chapter, subject) : null,
    }))

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
