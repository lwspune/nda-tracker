import { useState, useEffect } from 'react'
import { INDEX_URL, STUDENT_FILE_URL, SESSION_KEY, SESSION_DAYS, APP_NAME, APP_SUB } from '../../config'

// SHA-256 hash using Web Crypto API
async function hashMobile(mobile) {
  const m = mobile.trim().replace(/\s|-/g, '')
    .replace(/^\+91/, '').replace(/^91(?=\d{10}$)/, '')
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(m))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Session helpers
function saveSession(lwsId, name, file) {
  const expiry = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000
  localStorage.setItem(SESSION_KEY, JSON.stringify({ lwsId, name, file, expiry }))
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw)
    if (Date.now() > s.expiry) { localStorage.removeItem(SESSION_KEY); return null }
    return s
  } catch { return null }
}

// eslint-disable-next-line react-refresh/only-export-components
export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
}

export default function StudentLogin({ onLogin }) {
  const [mobile, setMobile]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [checking, setChecking] = useState(true)

  // Check for existing valid session on mount
  useEffect(() => {
    const session = loadSession()
    if (session) {
      fetchStudentData(session.file, session.name, session.lwsId, false)
    } else {
      setChecking(false)
    }
  }, [])

  async function fetchStudentData(file, name, lwsId, saveIt = true) {
    try {
      const res = await fetch(STUDENT_FILE_URL(file))
      if (!res.ok) throw new Error('Could not load your data. Please try again.')
      const data = await res.json()
      if (saveIt) saveSession(lwsId, name, file)
      onLogin(data)
    } catch (e) {
      setError(e.message)
      setChecking(false)
      setLoading(false)
    }
  }

  async function handleSubmit() {
    const digits = mobile.replace(/\D/g, '')
    if (digits.length < 10) {
      setError('Please enter a valid 10-digit mobile number.')
      return
    }

    setError(null)
    setLoading(true)

    try {
      // Hash the mobile
      const hash = await hashMobile(digits)

      // Fetch index
      const indexRes = await fetch(INDEX_URL)
      if (!indexRes.ok) throw new Error('Could not connect. Please try again.')
      const index = await indexRes.json()

      // Find match
      const entry = index.find(e => e.mobileHash === hash)
      if (!entry) {
        setError('Mobile number not found. Please check your number or contact LWS Pune.')
        setLoading(false)
        return
      }

      // Fetch student file
      await fetchStudentData(entry.file, entry.name, entry.lwsId, true)

    } catch (e) {
      setError(e.message || 'Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  // While checking existing session
  if (checking) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-ink-3 text-[13px] font-mono">Loading…</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-4">
      {/* Card */}
      <div className="w-full max-w-[360px]">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-[36px] mb-3">🎯</div>
          <div className="text-[22px] font-extrabold text-ink tracking-tight">{APP_NAME}</div>
          <div className="text-[11px] font-mono text-ink-3 tracking-[2px] uppercase mt-1">{APP_SUB}</div>
        </div>

        {/* Login card */}
        <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
          <div className="text-[15px] font-bold text-ink mb-1">Welcome back</div>
          <div className="text-[13px] text-ink-3 mb-5">
            Enter your registered mobile number to view your results.
          </div>

          {/* Mobile input */}
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
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                placeholder="98765 43210"
                className="flex-1 bg-transparent outline-none text-[15px] font-mono text-ink
                           placeholder:text-ink-3/50"
                autoFocus
              />
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200
                            rounded-xl text-[12px] text-danger mb-4">
              <span className="flex-shrink-0">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={loading || mobile.length < 10}
            className={`w-full py-3 rounded-xl font-bold text-[14px] transition-all
              ${loading || mobile.length < 10
                ? 'bg-surface-3 text-ink-3 cursor-not-allowed'
                : 'bg-accent text-white hover:bg-accent-hover active:scale-[0.98]'
              }`}
          >
            {loading ? 'Checking…' : 'View My Results →'}
          </button>
        </div>

        {/* Footer */}
        <div className="text-center mt-6 text-[11px] text-ink-3">
          Having trouble? Contact your LWS Pune faculty.
        </div>
      </div>
    </div>
  )
}
