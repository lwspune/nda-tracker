import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

function readEnvLocal() {
  try {
    return Object.fromEntries(
      readFileSync('.env.local', 'utf-8')
        .split('\n')
        .map(l => l.match(/^([A-Z_]+)=(.*)/))
        .filter(Boolean)
        .map(m => [m[1], m[2].trim()])
    )
  } catch { return {} }
}

function normMobile(m) {
  if (!m) return null
  let s = String(m).replace(/\D/g, '')
  if (s.startsWith('0') && s.length === 11) s = '91' + s.slice(1)
  if (s.length === 10) s = '91' + s
  if (s.startsWith('91') && s.length === 12) return s
  return null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' })
    return
  }

  const { mobile } = req.body || {}
  if (!mobile) {
    res.status(400).json({ error: 'mobile is required' })
    return
  }

  const normalized = normMobile(String(mobile))
  if (!normalized) {
    res.status(400).json({ error: 'Invalid mobile number — must be a 10-digit Indian number' })
    return
  }

  const env = readEnvLocal()
  const supabaseUrl = env.VITE_SUPABASE_URL         || process.env.VITE_SUPABASE_URL         || ''
  const serviceKey  = env.SUPABASE_SERVICE_ROLE_KEY  || process.env.SUPABASE_SERVICE_ROLE_KEY  || ''

  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: 'Supabase not configured on server' })
    return
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  // ── 1. Find student by mobile ────────────────────────────────────────────

  const { data: students, error: studentsErr } = await supabase
    .from('students')
    .select('canonical_name, lws_id, mobile, name_variants, parent_mobiles, branch, registration_date, account_status, coming_status, dob, gender, student_batches(batch_name)')

  if (studentsErr || !students) {
    res.status(500).json({ error: 'Could not load student data' })
    return
  }

  const student = students.find(s => normMobile(s.mobile) === normalized)
  if (!student) {
    res.status(404).json({ error: 'Mobile number not found. Please check your number or contact LWS Pune.' })
    return
  }

  const canonicalName = student.canonical_name
  const allNames = [
    canonicalName,
    ...(student.name_variants || []),
  ]
  const allNamesLower = new Set(allNames.map(n => n.toLowerCase()))

  // ── 2. Load this student's exam results from normalised table ────────────

  const { data: resultRows, error: resultsErr } = await supabase
    .from('exam_results')
    .select('*')
    .in('student_name', allNames)

  if (resultsErr) {
    res.status(500).json({ error: 'Could not load exam results' })
    return
  }

  // ── 3. Load exam metadata for those exam ids ─────────────────────────────

  const examIds = [...new Set((resultRows || []).map(r => r.exam_id))]
  let examRows = []

  if (examIds.length > 0) {
    const { data, error: examsErr } = await supabase
      .from('exams')
      .select('*')
      .in('id', examIds)

    if (examsErr) {
      res.status(500).json({ error: 'Could not load exams' })
      return
    }
    examRows = data || []
  }

  // ── 4. Reconstruct exam objects (merge metadata + student result) ─────────

  const resultByExamId = {}
  for (const r of (resultRows || [])) {
    // keep first match per exam (handles edge case of duplicate rows)
    if (!resultByExamId[r.exam_id]) resultByExamId[r.exam_id] = r
  }

  const exams = examRows
    .map(exam => {
      const r = resultByExamId[exam.id]
      return {
        ...exam,
        marking:   exam.marking   || { correct: 4, wrong: -1 },
        questions: exam.questions || [],
        students: r ? [{
          name:          r.student_name,
          rollNo:        r.roll_no       || '',
          totalMarks:    r.total_marks,
          correct:       r.correct,
          incorrect:     r.incorrect,
          notAttempted:  r.not_attempted,
          responses:     r.responses     || {},
        }] : [],
      }
    })
    .filter(exam => exam.students.length > 0)

  // ── 5. Load attendance for this student ─────────────────────────────────

  const { data: attendanceRows } = await supabase
    .from('student_attendance')
    .select('date, status')
    .eq('lws_id', student.lws_id)

  // ── 5a. Load lecture + exam absences for the last 12 months ──────────────
  // 12-month window matches AttendanceRings' monthly chips; RecentIncidents
  // narrows to 30 days client-side.
  const since = new Date()
  since.setMonth(since.getMonth() - 12)
  const sinceIso = `${since.getFullYear()}-${String(since.getMonth()+1).padStart(2,'0')}-${String(since.getDate()).padStart(2,'0')}`
  const { data: lectureRows } = await supabase
    .from('lecture_absences')
    .select('date, subject')
    .eq('lws_id', student.lws_id)
    .gte('date', sinceIso)
    .order('date', { ascending: false })

  const { data: examAbsenceRows } = await supabase
    .from('exam_absences')
    .select('exam_id, marked_at, notified_at')
    .eq('lws_id', student.lws_id)
    .gte('marked_at', sinceIso + 'T00:00:00.000Z')
    .order('marked_at', { ascending: false })

  // ── 5a-ii. Fetch metadata for ABSENT exams (the student didn't sit them,
  // so they're not in `exams` above). Without this, the student-portal join
  // in MissedExams / RecentIncidents / AttendanceRings would drop all rows.
  const absentExamIds = [...new Set((examAbsenceRows || []).map(r => r.exam_id))]
  let absentExamMetaById = new Map()
  if (absentExamIds.length > 0) {
    const { data: absentExamMeta } = await supabase
      .from('exams')
      .select('id, name, date, batch')
      .in('id', absentExamIds)
    absentExamMetaById = new Map((absentExamMeta || []).map(e => [e.id, e]))
  }

  // ── 5b. Record login event (fire-and-forget) ─────────────────────────────
  supabase.from('student_logins').insert({ lws_id: student.lws_id }).then(() => {})

  // ── 6. Load ndaFreqBySubject from faculty_state ──────────────────────────

  const { data: stateRow, error: stateErr } = await supabase
    .from('faculty_state')
    .select('data')
    .eq('id', 1)
    .single()

  if (stateErr || !stateRow) {
    res.status(500).json({ error: 'Could not load frequency data' })
    return
  }

  const profile = {
    lwsId:         student.lws_id,
    name:          canonicalName,
    mobile:        student.mobile,
    dob:           student.dob            || '',
    gender:        student.gender         || '',
    branch:        student.branch         || '',
    batches:       (student.student_batches || []).map(b => b.batch_name),
    parentMobiles: student.parent_mobiles || [],
    accountStatus: student.account_status || '',
    comingStatus:  student.coming_status  || '',
    regDate:       student.registration_date || '',
    nameVariants:  student.name_variants  || [],
  }

  res.status(200).json({
    name:             canonicalName,
    lwsId:            student.lws_id,
    profile,
    exams,
    attendance:       attendanceRows || [],
    lectureAbsences:  (lectureRows || []).map(r => ({ lws_id: student.lws_id, date: r.date, subject: r.subject })),
    examAbsences:     (examAbsenceRows || []).map(r => {
      const meta = absentExamMetaById.get(r.exam_id)
      return {
        lws_id:      student.lws_id,
        exam_id:     r.exam_id,
        marked_at:   r.marked_at,
        notified_at: r.notified_at,
        exam_name:   meta?.name  ?? null,
        exam_date:   meta?.date  ?? null,
        exam_batch:  meta?.batch ?? null,
      }
    }),
    ndaFreqBySubject: stateRow.data?.ndaFreqBySubject || {},
  })
}
