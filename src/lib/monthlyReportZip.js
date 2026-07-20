import { buildMonthlyReportPdfBlob } from './monthlyReportPdf'

// Bulk-download all monthly report PDFs for a cohort as a single ZIP archive.
// Items are processed sequentially — each PDF render is ~50–200 ms and we
// don't want to hammer the main thread with all of them at once.

export async function buildMonthlyReportsZipBlob(items) {
  // Dynamic import — JSZip is only loaded when the bulk button is clicked.
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  for (const item of items || []) {
    const pdf = await buildMonthlyReportPdfBlob(item.report, { remark: item.remark || '' })
    zip.file(item.filename, pdf)
  }
  return zip.generateAsync({ type: 'blob' })
}

export async function downloadMonthlyReportsZip(items, zipName, { save = true } = {}) {
  const blob = await buildMonthlyReportsZipBlob(items)
  if (save) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = zipName
    a.click()
    URL.revokeObjectURL(url)
  }
  return zipName
}

// Sanitises a string for use as a path segment. Same rule as the per-student
// PDF filename helper — keep [A-Za-z0-9_-], collapse runs of other chars to _.
function safeFile(s) {
  return (s || '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')   // replace unsafe runs with single _
    .replace(/_+/g, '_')                // collapse adjacent underscores
    .replace(/^_+|_+$/g, '')            // trim leading/trailing _
}

export function zipFilename(batch, rangeLabel) {
  return `${safeFile(batch)}_${safeFile(rangeLabel)}_Reports.zip`
}
