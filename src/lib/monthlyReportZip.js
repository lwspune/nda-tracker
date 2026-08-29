import { buildMonthlyReportPdfBlob } from './monthlyReportPdf'
import { buildMonthlyReportDocxBlob } from './monthlyReportDocx'

// Bulk-download all monthly report cards for a cohort as a single ZIP archive.
// Items are processed sequentially — each render is ~50–200 ms and we don't
// want to hammer the main thread with all of them at once.
//
// `format` picks the renderer: 'pdf' (default, previews inline in WhatsApp) or
// 'docx' (renders Marathi/Hindi exam titles correctly). Both read the same
// report object; the caller supplies filenames with a matching extension.

export async function buildMonthlyReportsZipBlob(items, { format = 'pdf' } = {}) {
  // Dynamic import — JSZip is only loaded when the bulk button is clicked.
  const JSZip = (await import('jszip')).default
  const build = format === 'docx' ? buildMonthlyReportDocxBlob : buildMonthlyReportPdfBlob
  const zip = new JSZip()
  for (const item of items || []) {
    const file = await build(item.report, { remark: item.remark || '' })
    zip.file(item.filename, file)
  }
  return zip.generateAsync({ type: 'blob' })
}

export async function downloadMonthlyReportsZip(items, zipName, { save = true, format = 'pdf' } = {}) {
  const blob = await buildMonthlyReportsZipBlob(items, { format })
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
