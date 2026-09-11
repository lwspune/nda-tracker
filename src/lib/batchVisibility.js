// Which batches a picker that assigns NEW work should OFFER.
//
// `archivedBatches` is a presentational flag only (see BATCH_RETIREMENT.md §2).
// Two rules are load-bearing and are why this is a shared helper rather than an
// inline filter repeated at three call sites:
//
//   1. It filters what is RENDERED, never the ordering source. Step2Review,
//      OfflineExamModal and QuizEditor all build an exam's comma-joined `batch`
//      tag as `syllabusBatches.filter(b => selected.has(b)).join(', ')`. Feeding
//      the filtered list into that expression would silently DROP an archived tag
//      the moment any other batch was toggled — pass the FULL list there.
//
//   2. An archived batch that is ALREADY selected stays visible. A control that
//      cannot display its own value destroys it, and the user cannot deselect
//      what they cannot see.
//
// Order is preserved from `all`.
export function visibleBatchOptions(all, archived, selected = null) {
  const list = all ?? []
  const archivedSet = new Set(archived ?? [])
  if (archivedSet.size === 0) return [...list]
  const isSelected = selected instanceof Set
    ? name => selected.has(name)
    : Array.isArray(selected)
      ? name => selected.includes(name)
      : () => false
  return list.filter(b => !archivedSet.has(b) || isSelected(b))
}

// True when `name` is archived. Call sites use it to flag an archived-but-selected
// option so it reads as deliberate rather than as a mistake.
export function isArchivedBatch(archived, name) {
  return (archived ?? []).includes(name)
}
