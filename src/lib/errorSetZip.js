// Bulk-download every student's Error Set as one ZIP archive.
//
// Modelled on monthlyReportZip.js, with one deliberate difference: progress is
// reported per student. A monthly report is ~50-200 ms, so its bulk build is
// over before a spinner registers. An error set runs to hundreds of questions
// with rendered equations, so a 40-student cohort takes minutes — long enough
// that an unlabelled spinner reads as a hang and gets cancelled.
//
// Documents are built sequentially, not in parallel: each one packs a zip and
// runs KaTeX over every equation, and forty of those at once would lock the
// main thread rather than finish sooner.

import { buildGatErrorSetDocx } from './gatErrorSetDocx'
import { downloadBlob } from './download'
import { safeFilename } from './download'

// items: [{ studentName, subject, subjects, totals, meta, filename }]
export async function buildErrorSetsZipBlob(items, { includeSolutions = true, onProgress } = {}) {
  // Dynamic import — JSZip is only loaded when the bulk button is clicked.
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  const list = items || []
  const total = list.length
  const report = typeof onProgress === 'function' ? onProgress : () => {}

  let done = 0
  for (const item of list) {
    report({ done, total, studentName: item.studentName, pct: 0 })
    const file = await buildGatErrorSetDocx({
      studentName: item.studentName,
      subject: item.subject,
      subjects: item.subjects,
      totals: item.totals,
      meta: item.meta || {},
      includeSolutions,
      // Per-document progress folded into the cohort figure, so the caller can
      // show "12 of 43 · placing equations" without knowing either stage.
      onProgress: (pct, label) =>
        report({ done, total, studentName: item.studentName, pct, label }),
    })
    zip.file(item.filename, file)
    done += 1
    report({ done, total, studentName: item.studentName, pct: 100 })
  }
  return zip.generateAsync({ type: 'blob' })
}

export async function downloadErrorSetsZip(items, zipName, {
  save = true, includeSolutions = true, onProgress,
} = {}) {
  const blob = await buildErrorSetsZipBlob(items, { includeSolutions, onProgress })
  if (save) {
    downloadBlob(blob, zipName)
  }
  return zipName
}

const safeFile = s => safeFilename(s, '')

export function errorSetsZipFilename(batch, rangeLabel) {
  return `${safeFile(batch)}_${safeFile(rangeLabel)}_ErrorSets.zip`
}
