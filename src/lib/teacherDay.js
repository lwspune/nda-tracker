import { getTodaysLectures, parseTimeToMinutes } from './timetable'

// Pure helpers behind the /school-attendance surface, where a teacher files
// attendance for their OWN periods instead of the office doing it centrally.
//
// The join is: Supabase session email → timetableTeachers[].email → teacher.id
// → timetableMappings[].teacherId → the grid cells that reference that mapping.
// There is no FK between auth users and teacher rows — email is the only link
// (see GUARDRAILS.md), so the match is deliberately forgiving about case and
// whitespace and strict about everything else.

// Case-insensitive email lookup. Returns the teacher record or null.
// A teacher row with no email must never match a blank lookup, so an empty
// needle short-circuits before the comparison.
export function findTeacherByEmail(teachers, email) {
  const needle = String(email ?? '').trim().toLowerCase()
  if (!needle) return null
  for (const t of teachers ?? []) {
    const candidate = String(t?.email ?? '').trim().toLowerCase()
    if (candidate && candidate === needle) return t
  }
  return null
}

// Whether the signed-in staff member may capture hostel/mess attendance.
//
// Access is a flag on the TEACHER RECORD, not a new auth role. That is
// deliberate: every permission gate in this codebase is written as a deny-list
// on role='teacher' (App.jsx routing, the send endpoints, api/teacher-account's
// admin gate, persist.js, the faculty_state RLS policies), so minting a new
// role would silently inherit ADMIN defaults at all of them. Reusing
// role='teacher' keeps every one of those restrictions correct for free.
//
// This is a VISIBILITY gate, not a database boundary — capture-table RLS is
// `authenticated`, the same posture as teacher quiz authoring (GUARDRAILS).
// Faculty cannot self-grant: `faculty_state` is teacher-readable but its write
// policies exclude role='teacher'.
//
// Falls closed on every unidentifiable case, and requires a real boolean so a
// stray truthy string in the JSONB can't grant access.
export function hasHostelAccess(teachers, email) {
  return findTeacherByEmail(teachers, email)?.hostelAccess === true
}

// Every period `teacherId` teaches on `date`, across all batches, ordered by
// clock time. Each entry: { batchName, slotId, subject, label, startTime,
// endTime, mappingId, teacherId }.
//
// Falls CLOSED on an unknown/blank teacherId — an unmatched session email gets
// an empty day, never the whole school's timetable. Sunday, a missing timetable
// and unassigned mappings all resolve to [] / skipped via getTodaysLectures.
export function getTeacherLecturesForDate({ teacherId, timetables, mappings, date }) {
  if (!teacherId) return []

  const ownMappingIds = new Set(
    (mappings ?? []).filter(m => m?.teacherId === teacherId).map(m => m.id)
  )
  if (ownMappingIds.size === 0) return []

  const out = []
  for (const timetable of timetables ?? []) {
    for (const lec of getTodaysLectures(timetable, date, mappings)) {
      if (!ownMappingIds.has(lec.mappingId)) continue
      out.push({ ...lec, batchName: timetable.batchName, teacherId })
    }
  }

  // Across batches, slot rows are independent — order by actual clock time.
  // A same-time double-booking keeps both entries so the clash stays visible.
  return out.sort(
    (a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime)
      || String(a.batchName).localeCompare(String(b.batchName))
  )
}

// Every batch `teacherId` teaches, across the whole timetable — the candidate
// list when they file an IMPROMPTU (substitute / extra) class, which has no
// timetable slot to derive a batch from.
//
// Deliberately day-independent, unlike getTeacherLecturesForDate: an extra
// class on Saturday is usually for a batch they normally have midweek. Falls
// CLOSED on a blank teacherId for the same reason as the day view — an
// unmatched session must never be offered the whole school.
export function getTeacherBatches({ teacherId, timetables, mappings }) {
  const batches = new Set(
    getTeacherSubjectBatches({ teacherId, timetables, mappings }).map(t => t.batchName)
  )
  return [...batches].sort((a, b) => String(a).localeCompare(String(b)))
}

// The same walk, keeping the SUBJECT as well: every (subject, batch) pair the
// teacher teaches. This is the scope for anything they own per-class rather
// than per-batch — a Written Quiz is for "my Maths, 12th_A", not for the batch
// at large, and it is what stops a teacher creating an exam for a class or a
// subject that isn't theirs.
//
// Day-independent for the same reason as above, and then some: marks for
// Monday's quiz are often entered on Tuesday.
//
// Returns [{ key, subject, batchName }] sorted by batch then subject.
export function getTeacherSubjectBatches({ teacherId, timetables, mappings }) {
  if (!teacherId) return []

  const subjectByMappingId = new Map(
    (mappings ?? []).filter(m => m?.teacherId === teacherId).map(m => [m.id, m.subject ?? null])
  )
  if (subjectByMappingId.size === 0) return []

  const byKey = new Map()
  for (const timetable of timetables ?? []) {
    const grid = timetable?.grid ?? {}
    for (const row of Object.values(grid)) {
      if (!row || row.__span) continue
      for (const cell of Object.values(row)) {
        if (cell?.type !== 'class' || !subjectByMappingId.has(cell.mappingId)) continue
        const subject = subjectByMappingId.get(cell.mappingId)
        if (!subject || !timetable.batchName) continue
        const key = `${subject}|${timetable.batchName}`
        if (!byKey.has(key)) byKey.set(key, { key, subject, batchName: timetable.batchName })
      }
    }
  }
  return [...byKey.values()].sort(
    (a, b) => String(a.batchName).localeCompare(String(b.batchName))
      || String(a.subject).localeCompare(String(b.subject))
  )
}

// The admin counterpart of getTeacherLecturesForDate: every timetabled period
// for `date` (optionally one batch), each tagged with its teacher and whether
// it has been filed. This is how the office chases outstanding periods.
//
// Unlike the teacher view, periods whose mapping has NO teacher are kept — an
// unowned period is precisely the gap worth surfacing, and dropping it would
// make the day read as fully covered.
export function buildFilingBoard({ timetables, mappings, teachers, submissions, date, batchName = null }) {
  const teacherById = new Map((teachers ?? []).map(t => [t.id, t]))
  const mappingById = new Map((mappings ?? []).map(m => [m.id, m]))

  const lectures = []
  for (const timetable of timetables ?? []) {
    if (batchName && timetable.batchName !== batchName) continue
    for (const lec of getTodaysLectures(timetable, date, mappings)) {
      const teacherId = mappingById.get(lec.mappingId)?.teacherId ?? null
      lectures.push({
        ...lec,
        batchName: timetable.batchName,
        teacherId,
        teacherName: teacherId ? (teacherById.get(teacherId)?.name ?? null) : null,
      })
    }
  }

  const rows = withFilingStatus(lectures, submissions).sort(
    (a, b) => String(a.batchName).localeCompare(String(b.batchName))
      || parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime)
  )

  const filed = rows.filter(r => r.filed).length
  return { rows, filed, outstanding: rows.length - filed }
}

// Annotates lectures with whether they were actually FILED.
//
// Load-bearing distinction: with no submission row, "nobody was absent" and
// "the teacher never filed" are both zero lecture_absences rows. `filed` comes
// from the submission row alone — never from the absentee count — so an
// un-filed period can't masquerade as a clean one.
//
// Keyed on (slot_id, batch_name): slot ids are per-timetable, so two batches
// can legitimately share one.
export function withFilingStatus(lectures, submissions) {
  const bySlotBatch = new Map(
    (submissions ?? []).map(s => [`${s.slot_id}|${s.batch_name}`, s])
  )
  return (lectures ?? []).map(lec => {
    const row = bySlotBatch.get(`${lec.slotId}|${lec.batchName}`)
    return {
      ...lec,
      filed: Boolean(row),
      absentCount: row ? (row.absent_count ?? 0) : null,
      submittedAt: row?.submitted_at ?? null,
      submittedBy: row?.submitted_by ?? null,
    }
  })
}
