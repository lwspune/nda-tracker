// Display-only Physics/Chemistry/Biology tagging for Maharashtra-board
// 9th & 10th Std "Science" chapters. The stored chapter names are never
// mutated (they are join keys for progress/timelines/exam tags) — this map
// drives a small badge in the Syllabus UI only. Biology covers the bio +
// health chapters; genuinely cross-cutting/general chapters (ICT, Disaster
// Management, Towards Green Energy) are intentionally left untagged.

const norm = name =>
  String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

// normalized chapter name -> 'P' | 'C' | 'B'
const STREAM_BY_CHAPTER = {}
const seed = (stream, names) => names.forEach(n => { STREAM_BY_CHAPTER[norm(n)] = stream })

seed('P', [
  // 9th
  'Laws of Motion', 'Work and Energy', 'Current Electricity',
  'Reflection of Light', 'Study of Sound', 'Observing Space : Telescopes',
  // 10th
  'Gravitation', 'Effects of electric current', 'Heat',
  'Refraction of light', 'Lenses', 'Space Missions',
])

seed('C', [
  // 9th
  'Measurement of Matter', 'Acids, Bases and Salts',
  'Carbon : An important element', 'Substances in Common Use',
  // 10th
  'Periodic Classification of Element', 'Chemical reactions and equations',
  'Metallurgy', 'Carbon compounds',
])

seed('B', [
  // 9th
  'Classification of Plants', 'Energy Flow in an Ecosystem',
  'Useful and Harmful Microbes', 'Environmental Management',
  'Life Processes in Living Organisms', 'Heredity and Variation',
  'Introduction to Biotechnology',
  // 10th
  'Heredity and Evolution', 'Life Processes in Living Organisms Part -1',
  'Life Processes in Living Organisms Part - 2', 'Animal Classification',
  'Introduction to Microbiology', 'Cell Biology and Biotechnology',
  'Social health',
])

/**
 * Physics/Chemistry/Biology tag for a syllabus chapter, or null.
 * Only the "Science" subject is tagged; every other subject returns null so
 * the badge never leaks into Maths/languages/social sciences.
 *
 * @returns {'P'|'C'|'B'|null}
 */
export function getScienceStream(subjectName, chapterName) {
  if (subjectName !== 'Science') return null
  return STREAM_BY_CHAPTER[norm(chapterName)] ?? null
}

export const STREAM_LABELS = { P: 'Physics', C: 'Chemistry', B: 'Biology' }
