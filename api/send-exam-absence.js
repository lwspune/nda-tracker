import { createClient } from '@supabase/supabase-js'
import { isTeacherUser } from './_authRole.js'
import { bearerFrom, getUserOrNull } from './_auth.js'
import { partitionBlocked } from './_blockGate.js'
import { readEnvLocal } from './_env.js'
import { normMobile } from './_mobile.js'
import { sendWabridge } from './_wabridge.js'

// Meta drops messages containing en-dash, em-dash, newlines, or runs of whitespace.
// Replace common Unicode punctuation with ASCII and collapse whitespace.
function sanitiseExamName(name) {
  if (!name) return ''
  return String(name)
    .replace(/[–—]/g, '-')   // en-dash, em-dash → hyphen
    .replace(/[\r\n\t]+/g, ' ')        // newlines / tabs → space
    .replace(/\s+/g, ' ')              // collapse runs of whitespace
    .trim()
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' })
    return
  }

  const env = readEnvLocal()
  const supabaseUrl  = env.VITE_SUPABASE_URL      || process.env.VITE_SUPABASE_URL      || ''
  const supabaseAnon = env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
  const appKey     = env.WABRIDGE_APP_KEY                  || process.env.WABRIDGE_APP_KEY                  || ''
  const authKey    = env.WABRIDGE_AUTH_KEY                 || process.env.WABRIDGE_AUTH_KEY                 || ''
  const deviceId   = env.WABRIDGE_DEVICE_ID                || process.env.WABRIDGE_DEVICE_ID                || ''
  const templateId = env.WABRIDGE_EXAM_ABSENCE_TEMPLATE_ID || process.env.WABRIDGE_EXAM_ABSENCE_TEMPLATE_ID || ''

  if (!appKey || !authKey || !deviceId || !templateId) {
    res.status(500).json({ ok: false, error: 'Wabridge exam-absence template credentials not configured. Set WABRIDGE_EXAM_ABSENCE_TEMPLATE_ID (plus app/auth/device) in Vercel env.' })
    return
  }

  const jwt = bearerFrom(req)
  if (!jwt) { res.status(401).json({ ok: false, error: 'Unauthorized — no session token' }); return }
  const anonClient = createClient(supabaseUrl, supabaseAnon)
  const user = await getUserOrNull(anonClient, jwt)
  if (!user) { res.status(401).json({ ok: false, error: 'Unauthorized — invalid session' }); return }
  // Teachers hold real sessions and capture at /school-attendance, so a valid
  // session no longer implies admin. Parent-facing sends stay with the office
  // (mirrors api/send-attendance-alerts.js).
  if (isTeacherUser(user)) { res.status(403).json({ ok: false, error: 'Forbidden' }); return }

  const { examName, redirectTo, students } = req.body || {}
  if (!examName || !Array.isArray(students) || students.length === 0) {
    res.status(400).json({ ok: false, error: 'examName and students[] are required' })
    return
  }

  const cleanExamName = sanitiseExamName(examName)
  const redirectNorm  = redirectTo ? normMobile(redirectTo) : null

  const lines = []
  let sent = 0, skipped = 0

  // Server-side floor: never message a Block / Quit / Inactive contact. This is
  // the MINIMUM — ExamAbsencePreviewModal is deliberately stricter client-side
  // (it requires `=== 'Active'` and drops profile-less rows), and that policy
  // still applies on top. Read through a JWT-scoped client so RLS still applies.
  // A read failure refuses the whole send (see _blockGate).
  const db = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  let recipients, blockedRows
  try {
    ({ allowed: recipients, blocked: blockedRows } = await partitionBlocked(db, students))
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
    return
  }
  if (blockedRows.length) lines.push(`Excluded ${blockedRows.length} blocked/inactive student(s).`)

  for (const row of recipients) {
    const name = (row.name || '').trim()
    if (!name) continue

    // Positional variables — Meta-approved template body uses {{1}}, {{2}}.
    const variables = [name, cleanExamName]

    // Student leg — message goes to the student themselves as an accountability
    // signal ("your parents are being informed"). Template wording addresses the
    // parent ("Your ward was absent") but the student-copy is intentional.
    const destStudent = redirectNorm || normMobile(row.mobile)
    if (destStudent) {
      console.log(`[exam-absence] → ${name} student dest=${destStudent} redirect=${redirectNorm ?? 'none'} vars=${JSON.stringify(variables)}`)
      const { ok, detail } = await sendWabridge(appKey, authKey, deviceId, templateId, destStudent, variables)
      if (ok) { lines.push(`  SENT → ${name} (student → ${destStudent})`); sent++ }
      else    { lines.push(`  FAIL → ${name} (student → ${destStudent}): ${detail}`); skipped++ }
    } else {
      lines.push(`  SKIP ${name} — no mobile`); skipped++
    }

    // Parent leg
    const parents = row.parentMobiles || []
    if (parents.length === 0) {
      lines.push(`  SKIP ${name} — no parent mobile`); skipped++
    } else {
      for (const parentRaw of parents) {
        const destParent = redirectNorm || normMobile(parentRaw)
        if (!destParent) { lines.push(`  SKIP ${name} parent ${parentRaw} — unrecognised format`); skipped++; continue }
        console.log(`[exam-absence] → ${name} parent dest=${destParent} redirect=${redirectNorm ?? 'none'} vars=${JSON.stringify(variables)}`)
        const { ok, detail } = await sendWabridge(appKey, authKey, deviceId, templateId, destParent, variables)
        if (ok) { lines.push(`  SENT → ${name} (parent → ${destParent})`); sent++ }
        else    { lines.push(`  FAIL → ${name} (parent → ${destParent}): ${detail}`); skipped++ }
      }
    }
  }

  lines.push(`Done. Sent: ${sent}  Skipped: ${skipped}`)
  res.status(200).json({ ok: true, sent, skipped, blocked: blockedRows.length, lines })
}
