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
