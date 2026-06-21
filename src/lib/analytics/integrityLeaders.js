// Dashboard "integrity incidents" rollup — groups the per-(student,exam)
// integrity_incidents log into a per-STUDENT view ranked by incident count, so a
// repeat offender (flagged/admitted across multiple exams) surfaces above a
// one-off. Pure: the slice fetches all rows; this aggregates them.
//
// Names/branches: rows already snapshot `student_name`, so this works even for
// deleted/inactive students. When a current profile exists for the lws_id we
// prefer its canonical name + branch; otherwise we fall back to the row snapshot.
// Deliberately NOT Active-only (a disciplinary record stands regardless of status).

function profileByLwsId(studentProfiles) {
  const map = new Map()
  for (const [key, p] of Object.entries(studentProfiles || {})) {
    if (!p || p.name !== key || !p.lwsId) continue   // skip variant-keyed duplicates
    if (!map.has(p.lwsId)) map.set(p.lwsId, { name: p.name, branch: p.branch || '' })
  }
  return map
}

/**
 * @param {Array}  rows            integrity_incidents rows ({ lws_id, student_name, exam_id, exam_name, exam_date, counterpart_name, status, created_at })
 * @param {Object} studentProfiles canonical+variant keyed profile map (optional enrichment)
 * @returns {Array} [{ lwsId, name, branch, incidentCount, examCount, exams: [{ examId, examName, examDate, counterpartName, status }] }]
 *                  sorted by incidentCount desc, then examCount desc, then name asc.
 */
export function buildIntegrityLeaders(rows, studentProfiles = {}) {
  const byLwsId = profileByLwsId(studentProfiles)
  const groups = new Map()

  for (const r of rows || []) {
    const id = r && r.lws_id
    if (!id) continue
    if (!groups.has(id)) groups.set(id, { lwsId: id, snapshotName: r.student_name || id, rows: [] })
    groups.get(id).rows.push(r)
  }

  const dateKey = (e) => e.examDate || e.createdAt || ''

  return [...groups.values()]
    .map(g => {
      const prof = byLwsId.get(g.lwsId)
      const exams = g.rows
        .map(r => ({
          examId: r.exam_id, examName: r.exam_name || r.exam_id || '—',
          examDate: r.exam_date || '', counterpartName: r.counterpart_name || '',
          status: r.status || 'admitted', createdAt: r.created_at || '',
        }))
        .sort((a, b) => dateKey(b).localeCompare(dateKey(a)))
      return {
        lwsId: g.lwsId,
        name: prof?.name || g.snapshotName,
        branch: prof?.branch || '',
        incidentCount: g.rows.length,
        examCount: new Set(g.rows.map(r => r.exam_id).filter(Boolean)).size,
        exams,
      }
    })
    .sort((a, b) =>
      b.incidentCount - a.incidentCount ||
      b.examCount - a.examCount ||
      a.name.localeCompare(b.name)
    )
}
