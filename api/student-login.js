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
  const supabaseUrl  = env.VITE_SUPABASE_URL          || process.env.VITE_SUPABASE_URL          || ''
  const serviceKey   = env.SUPABASE_SERVICE_ROLE_KEY   || process.env.SUPABASE_SERVICE_ROLE_KEY   || ''

  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: 'Supabase not configured on server' })
    return
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  // Load all students (285 rows — fast enough for a direct JS scan)
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
  const allNames = new Set([
    canonicalName.toLowerCase(),
    ...(student.name_variants || []).map(v => v.toLowerCase()),
  ])

  // Load exam data from faculty_state
  const { data: stateRow, error: stateErr } = await supabase
    .from('faculty_state')
    .select('data')
    .eq('id', 1)
    .single()

  if (stateErr || !stateRow) {
    res.status(500).json({ error: 'Could not load exam data' })
    return
  }

  // Filter exams to only this student's records
  const exams = (stateRow.data?.exams || [])
    .map(exam => ({
      ...exam,
      students: (exam.students || []).filter(s => allNames.has((s.name || '').toLowerCase())),
    }))
    .filter(exam => exam.students.length > 0)

  const profile = {
    lwsId:         student.lws_id,
    name:          canonicalName,
    mobile:        student.mobile,
    dob:           student.dob || '',
    gender:        student.gender || '',
    branch:        student.branch || '',
    batches:       (student.student_batches || []).map(b => b.batch_name),
    parentMobiles: student.parent_mobiles || [],
    accountStatus: student.account_status || '',
    comingStatus:  student.coming_status || '',
    regDate:       student.registration_date || '',
    nameVariants:  student.name_variants || [],
  }

  res.status(200).json({
    name:             canonicalName,
    lwsId:            student.lws_id,
    profile,
    exams,
    ndaFreqBySubject: stateRow.data?.ndaFreqBySubject || {},
  })
}
