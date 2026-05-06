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
  SESSION_KEY, SESSION_DAYS,
  APP_NAME, APP_SUB,
} from '../../config'
import { supabase } from '../../lib/supabase'


// ── Session helpers — student ──────────────────────────────────────────────────

function saveStudentSession(lwsId, name, mobile) {
  const expiry = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000
  localStorage.setItem(SESSION_KEY, JSON.stringify({ lwsId, name, mobile, expiry }))
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

export default function LoginPage({ onStudentLogin }) {
  const [tab, setTab]         = useState('student') // 'student' | 'teacher' | 'faculty'
  const [checking, setChecking] = useState(true)

  // Teacher tab state
  const [teacherEmail, setTeacherEmail]       = useState('')
  const [teacherPassword, setTeacherPassword] = useState('')
  const [teacherLoading, setTeacherLoading]   = useState(false)
  const [teacherError, setTeacherError]       = useState(null)

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (param) setMobile(param.replace(/\D/g, '').slice(0, 10))
  }, [])

  // ── Auto-restore existing session on mount ──────────────────
  useEffect(() => {
    async function restore() {
      // Student session — re-fetch live data from Supabase via serverless endpoint
      const session = loadStudentSession()
      if (session?.mobile) {
        try {
          const res = await fetch('/api/student-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mobile: session.mobile }),
          })
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

  // ── Teacher login (Supabase) ────────────────────────────────
  async function handleTeacherLogin() {
    if (!teacherEmail || !teacherPassword) return
    setTeacherError(null)
    setTeacherLoading(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: teacherEmail.trim(),
      password: teacherPassword,
    })
    if (error) {
      setTeacherError(error.message)
      setTeacherLoading(false)
    }
    // On success: App.jsx onAuthStateChange fires → TeacherPortal renders (role check)
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
      const res = await fetch('/api/student-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile: digits }),
      })
      const data = await res.json()
      if (!res.ok) {
        setStudentError(data.error || 'Mobile number not found. Please check your number or contact LWS Pune.')
        setStudentLoading(false)
        return
      }
      saveStudentSession(data.lwsId, data.name, digits)
      onStudentLogin(data)
    } catch {
      setStudentError('Could not connect. Please try again.')
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
                Sign in with your teacher account to view student results.
              </div>

              <div className="mb-3">
                <label className="block text-[11px] font-bold uppercase tracking-wide text-ink-3 mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  value={teacherEmail}
                  onChange={e => setTeacherEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleTeacherLogin()}
                  placeholder="teacher@example.com"
                  className="w-full border border-border rounded-xl px-3 py-2.5 bg-surface-2
                             focus:border-accent outline-none transition-colors
                             text-[14px] text-ink placeholder:text-ink-3/50"
                  autoFocus={tab === 'teacher'}
                />
              </div>

              <div className="mb-4">
                <label className="block text-[11px] font-bold uppercase tracking-wide text-ink-3 mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  value={teacherPassword}
                  onChange={e => setTeacherPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleTeacherLogin()}
                  placeholder="••••••••"
                  className="w-full border border-border rounded-xl px-3 py-2.5 bg-surface-2
                             focus:border-accent outline-none transition-colors
                             text-[14px] text-ink placeholder:text-ink-3/50"
                />
              </div>

              {teacherError && <ErrorBox message={teacherError} />}

              <button
                onClick={handleTeacherLogin}
                disabled={teacherLoading || !teacherEmail || !teacherPassword}
                className={`w-full py-3 rounded-xl font-bold text-[14px] transition-all
                  ${teacherLoading || !teacherEmail || !teacherPassword
                    ? 'bg-surface-3 text-ink-3 cursor-not-allowed'
                    : 'bg-accent text-white hover:bg-accent-hover active:scale-[0.98]'
                  }`}
              >
                {teacherLoading ? 'Signing in…' : 'Teacher Login →'}
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
            ? 'Teachers only. Contact the faculty admin for your account.'
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
