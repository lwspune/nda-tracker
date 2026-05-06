/**
 * LoginPage — unified login for teacher and student portals on GitHub Pages.
 *
 * Teacher tab: password → SHA-256 verified against /data/teacher-auth.json
 *              → calls onTeacherLogin() on success
 * Student tab: mobile  → hashed and matched against /data/index.json
 *              → calls onStudentLogin(studentData) on success
 *
 * On mount, restores any valid existing session automatically.
 */

import { useState, useEffect } from 'react'
import {
  INDEX_URL, STUDENT_FILE_URL, REMOTE_DATA_URL,
  SESSION_KEY, TEACHER_SESSION_KEY, SESSION_DAYS,
  APP_NAME, APP_SUB,
} from '../../config'
import { supabase } from '../../lib/supabase'

// ── Crypto helpers ─────────────────────────────────────────────────────────────

function b64ToBytes(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

async function hashMobile(mobile) {
  const m = mobile.trim().replace(/\s|-/g, '')
    .replace(/^\+91/, '').replace(/^91(?=\d{10}$)/, '')
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(m))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Decrypt an AES-256-GCM payload produced by split_students.py.
 * Key is derived from the password using PBKDF2-SHA256 (100,000 iterations).
 * Throws DOMException if the password is wrong (authentication tag mismatch).
 */
async function decryptDb(encrypted, password) {
  const salt = b64ToBytes(encrypted.salt)
  const iv   = b64ToBytes(encrypted.iv)
  const data = b64ToBytes(encrypted.data)

  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password.trim()),
    'PBKDF2', false, ['deriveKey'],
  )
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false, ['decrypt'],
  )
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
  return JSON.parse(new TextDecoder().decode(decrypted))
}

// ── Session helpers — teacher ──────────────────────────────────────────────────
// Decrypted data is kept in sessionStorage (cleared when browser tab closes).
// The plain-text password is never stored.

function saveTeacherSession(data) {
  sessionStorage.setItem(TEACHER_SESSION_KEY, JSON.stringify(data))
}

function loadTeacherSession() {
  try {
    const raw = sessionStorage.getItem(TEACHER_SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch { return null }
}

// eslint-disable-next-line react-refresh/only-export-components
export function clearTeacherSession() {
  sessionStorage.removeItem(TEACHER_SESSION_KEY)
}

// ── Session helpers — student ──────────────────────────────────────────────────

function saveStudentSession(lwsId, name, file) {
  const expiry = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000
  localStorage.setItem(SESSION_KEY, JSON.stringify({ lwsId, name, file, expiry }))
}

function loadStudentSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw)
    if (Date.now() > s.expiry) { localStorage.removeItem(SESSION_KEY); return null }
    return s
  } catch { return null }
}

// eslint-disable-next-line react-refresh/only-export-components
export function clearStudentSession() {
  localStorage.removeItem(SESSION_KEY)
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function LoginPage({ onTeacherLogin, onStudentLogin }) {
  const [tab, setTab]         = useState('student') // 'student' | 'teacher'
  const [checking, setChecking] = useState(true)

  // Teacher tab state
  const [password, setPassword] = useState('')
  const [teacherLoading, setTeacherLoading] = useState(false)
  const [teacherError, setTeacherError]     = useState(null)

  // Student tab state
  const [mobile, setMobile]     = useState('')
  const [studentLoading, setStudentLoading] = useState(false)
  const [studentError, setStudentError]     = useState(null)

  // Faculty tab state
  const [facultyEmail, setFacultyEmail]       = useState('')
  const [facultyPassword, setFacultyPassword] = useState('')
  const [facultyLoading, setFacultyLoading]   = useState(false)
  const [facultyError, setFacultyError]       = useState(null)

  // ── Pre-fill mobile from ?mobile= URL param ────────────────
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('mobile')
    if (param) setMobile(param.replace(/\D/g, '').slice(0, 10))
  }, [])

  // ── Auto-restore existing session on mount ──────────────────
  useEffect(() => {
    async function restore() {
      // Teacher session takes priority (decrypted data in sessionStorage)
      const teacherData = loadTeacherSession()
      if (teacherData) {
        onTeacherLogin(teacherData)
        return
      }
      // Student session
      const session = loadStudentSession()
      if (session) {
        try {
          const res = await fetch(STUDENT_FILE_URL(session.file))
          if (res.ok) {
            const data = await res.json()
            onStudentLogin(data)
            return
          }
        } catch { /* fall through to login UI */ }
      }
      setChecking(false)
    }
    restore()
  }, [])

  // ── Teacher login ───────────────────────────────────────────
  async function handleTeacherLogin() {
    if (!password) return
    setTeacherError(null)
    setTeacherLoading(true)
    try {
      const res = await fetch(REMOTE_DATA_URL)
      if (!res.ok) throw new Error('Teacher data not found. Run npm run deploy first.')
      const json = await res.json()

      if (!json.encrypted) {
        throw new Error('Teacher login is not configured. Contact the faculty admin.')
      }

      let data
      try {
        data = await decryptDb(json, password)
      } catch {
        setTeacherError('Incorrect password. Please try again.')
        setTeacherLoading(false)
        return
      }

      saveTeacherSession(data)
      onTeacherLogin(data)
    } catch (e) {
      setTeacherError(e.message || 'Could not connect. Please try again.')
      setTeacherLoading(false)
    }
  }

  // ── Faculty login (Supabase) ────────────────────────────────
  async function handleFacultyLogin() {
    if (!facultyEmail || !facultyPassword) return
    setFacultyError(null)
    setFacultyLoading(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: facultyEmail.trim(),
      password: facultyPassword,
    })
    if (error) {
      setFacultyError(error.message)
      setFacultyLoading(false)
    }
    // On success: App.jsx onAuthStateChange fires → faculty portal renders
  }

  // ── Student login ───────────────────────────────────────────
  async function handleStudentLogin() {
    const digits = mobile.replace(/\D/g, '')
    if (digits.length < 10) {
      setStudentError('Please enter a valid 10-digit mobile number.')
      return
    }
    setStudentError(null)
    setStudentLoading(true)
    try {
      const hash     = await hashMobile(digits)
      const indexRes = await fetch(INDEX_URL)
      if (!indexRes.ok) throw new Error('Could not connect. Please try again.')
      const index  = await indexRes.json()
      const entry  = index.find(e => e.mobileHash === hash)
      if (!entry) {
        setStudentError('Mobile number not found. Please check your number or contact LWS Pune.')
        setStudentLoading(false)
        return
      }
      const dataRes = await fetch(STUDENT_FILE_URL(entry.file))
      if (!dataRes.ok) throw new Error('Could not load your data. Please try again.')
      const data = await dataRes.json()
      saveStudentSession(entry.lwsId, entry.name, entry.file)
      onStudentLogin(data)
    } catch (e) {
      setStudentError(e.message || 'Something went wrong. Please try again.')
      setStudentLoading(false)
    }
  }

  // ── Loading screen ──────────────────────────────────────────
  if (checking) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-ink-3 text-[13px] font-mono">Loading…</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-[380px]">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-[36px] mb-3">🎯</div>
          <div className="text-[22px] font-extrabold text-ink tracking-tight">{APP_NAME}</div>
          <div className="text-[11px] font-mono text-ink-3 tracking-[2px] uppercase mt-1">{APP_SUB}</div>
        </div>

        {/* Tab switcher */}
        <div className="flex rounded-xl bg-surface-2 border border-border p-1 mb-5 gap-1">
          {[['student', 'Student'], ['teacher', 'Teacher'], ['faculty', 'Faculty']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 py-2.5 rounded-lg text-[13px] font-semibold transition-all min-h-[44px] flex items-center justify-center
                ${tab === key
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-ink-3 hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Login card */}
        <div className="bg-surface border border-border rounded-2xl p-4 md:p-6 shadow-sm">

          {tab === 'student' ? (
            <> {/* ── Student ── */}
              <div className="text-[15px] font-bold text-ink mb-1">Welcome back</div>
              <div className="text-[13px] text-ink-3 mb-5">
                Enter your registered mobile number to view your results.
              </div>

              <div className="mb-4">
                <label className="block text-[11px] font-bold uppercase tracking-wide text-ink-3 mb-1.5">
                  Mobile Number
                </label>
                <div className="flex items-center gap-2 border border-border rounded-xl px-3 py-2.5
                                bg-surface-2 focus-within:border-accent transition-colors">
                  <span className="text-[13px] text-ink-3 font-mono flex-shrink-0">+91</span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    value={mobile}
                    onChange={e => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    onKeyDown={e => e.key === 'Enter' && handleStudentLogin()}
                    placeholder="98765 43210"
                    className="flex-1 bg-transparent outline-none text-[15px] font-mono text-ink
                               placeholder:text-ink-3/50"
                    autoFocus
                  />
                </div>
              </div>

              {studentError && <ErrorBox message={studentError} />}

              <button
                onClick={handleStudentLogin}
                disabled={studentLoading || mobile.length < 10}
                className={`w-full py-3 rounded-xl font-bold text-[14px] transition-all
                  ${studentLoading || mobile.length < 10
                    ? 'bg-surface-3 text-ink-3 cursor-not-allowed'
                    : 'bg-accent text-white hover:bg-accent-hover active:scale-[0.98]'
                  }`}
              >
                {studentLoading ? 'Checking…' : 'View My Results →'}
              </button>
            </>
          ) : tab === 'teacher' ? (
            <> {/* ── Teacher ── */}
              <div className="text-[15px] font-bold text-ink mb-1">Teacher Access</div>
              <div className="text-[13px] text-ink-3 mb-5">
                Enter the teacher password to view all student results.
              </div>

              <div className="mb-4">
                <label className="block text-[11px] font-bold uppercase tracking-wide text-ink-3 mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleTeacherLogin()}
                  placeholder="Enter teacher password"
                  className="w-full border border-border rounded-xl px-3 py-2.5 bg-surface-2
                             focus:border-accent outline-none transition-colors
                             text-[14px] text-ink placeholder:text-ink-3/50"
                  autoFocus={tab === 'teacher'}
                />
              </div>

              {teacherError && <ErrorBox message={teacherError} />}

              <button
                onClick={handleTeacherLogin}
                disabled={teacherLoading || !password}
                className={`w-full py-3 rounded-xl font-bold text-[14px] transition-all
                  ${teacherLoading || !password
                    ? 'bg-surface-3 text-ink-3 cursor-not-allowed'
                    : 'bg-accent text-white hover:bg-accent-hover active:scale-[0.98]'
                  }`}
              >
                {teacherLoading ? 'Verifying…' : 'Enter Teacher View →'}
              </button>
            </>
          ) : (
            <>
              <div className="text-[15px] font-bold text-ink mb-1">Faculty Access</div>
              <div className="text-[13px] text-ink-3 mb-5">
                Sign in with your faculty account to manage exams and students.
              </div>

              <div className="mb-3">
                <label className="block text-[11px] font-bold uppercase tracking-wide text-ink-3 mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  value={facultyEmail}
                  onChange={e => setFacultyEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleFacultyLogin()}
                  placeholder="official@example.com"
                  className="w-full border border-border rounded-xl px-3 py-2.5 bg-surface-2
                             focus:border-accent outline-none transition-colors
                             text-[14px] text-ink placeholder:text-ink-3/50"
                  autoFocus={tab === 'faculty'}
                />
              </div>

              <div className="mb-4">
                <label className="block text-[11px] font-bold uppercase tracking-wide text-ink-3 mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  value={facultyPassword}
                  onChange={e => setFacultyPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleFacultyLogin()}
                  placeholder="••••••••"
                  className="w-full border border-border rounded-xl px-3 py-2.5 bg-surface-2
                             focus:border-accent outline-none transition-colors
                             text-[14px] text-ink placeholder:text-ink-3/50"
                />
              </div>

              {facultyError && <ErrorBox message={facultyError} />}

              <button
                onClick={handleFacultyLogin}
                disabled={facultyLoading || !facultyEmail || !facultyPassword}
                className={`w-full py-3 rounded-xl font-bold text-[14px] transition-all
                  ${facultyLoading || !facultyEmail || !facultyPassword
                    ? 'bg-surface-3 text-ink-3 cursor-not-allowed'
                    : 'bg-accent text-white hover:bg-accent-hover active:scale-[0.98]'
                  }`}
              >
                {facultyLoading ? 'Signing in…' : 'Faculty Login →'}
              </button>
            </>
          )}
        </div>

        <div className="text-center mt-6 text-[11px] text-ink-3">
          {tab === 'student'
            ? 'Having trouble? Contact your LWS Pune faculty.'
            : tab === 'teacher'
            ? 'Teachers only. Contact faculty admin for the password.'
            : 'Faculty only. Contact the system admin for access.'}
        </div>
      </div>
    </div>
  )
}

function ErrorBox({ message }) {
  return (
    <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200
                    rounded-xl text-[12px] text-danger mb-4">
      <span className="flex-shrink-0">⚠️</span>
      <span>{message}</span>
    </div>
  )
}
