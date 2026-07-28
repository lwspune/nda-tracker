// Shared display helpers for the homework / notes "incomplete work" flow.
// The WhatsApp wire format lives in api/send-homework-pending.js (ASCII-only);
// these are for in-app UI labels (parens / unicode fine here).

export function homeworkTypeLabel(type) {
  if (type === 'both')  return 'homework + notes'
  if (type === 'notes') return 'notes'
  return 'homework'
}

// "Maths · Trigonometry (homework + notes)" for cards/lists.
export function formatHomeworkItem(item) {
  const head = [item.subject, item.chapter].filter(Boolean).join(' · ')
  return `${head} (${homeworkTypeLabel(item.type)})`
}

// Stable grouping key for one homework item within a (date) scope.
export function homeworkItemKey(subject, chapter, type) {
  return `${subject}|||${chapter}|||${type}`
}

// The distinct classes a teacher could set homework for on a given day.
//
// Homework is keyed (date, subject, chapter, type) — there is NO slot_id, unlike
// lecture_absences. So it is a per-(subject, batch) concept, not a per-period
// one: a teacher with three Eng/GS periods for one batch on a Monday sets ONE
// homework item, not three. Collapsing the day's lectures here is what stops
// the UI offering the same item several times over.
//
// Returns [{ key, subject, batchName }] sorted by batch then subject.
export function getHomeworkTargets(lectures) {
  const byKey = new Map()
  for (const lec of lectures ?? []) {
    if (!lec?.subject || !lec?.batchName) continue
    const key = `${lec.subject}|${lec.batchName}`
    if (!byKey.has(key)) byKey.set(key, { key, subject: lec.subject, batchName: lec.batchName })
  }
  return [...byKey.values()].sort(
    (a, b) => String(a.batchName).localeCompare(String(b.batchName))
      || String(a.subject).localeCompare(String(b.subject))
  )
}

// The two checkboxes ("homework" / "notes") collapse to the single `type`
// column, which is CHECK-constrained to homework | notes | both. Returns null
// when neither is ticked — there is no item to file, and the caller must treat
// that as "not ready to save" rather than defaulting to homework.
export function deriveHomeworkType(hw, notes) {
  if (hw && notes) return 'both'
  if (notes) return 'notes'
  if (hw) return 'homework'
  return null
}

// Per-(student, item) key used to track which homework notifications have already
// been sent — homework is item-level (one message per student per item), so the
// "pending" set is computed at this granularity, not per student.
export function homeworkNotifyKey(lwsId, subject, chapter, type) {
  return `${lwsId}|||${subject}|||${chapter}|||${type}`
}
