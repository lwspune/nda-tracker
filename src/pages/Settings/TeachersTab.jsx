import { useState, useEffect } from 'react'
import useStore from '../../store/useStore'
import { Card } from '../../components/ui'
import { supabase } from '../../lib/supabase'

const MIN_PASSWORD = 8

// One small helper for all four actions on /api/teacher-account.
// Returns { ok, error, ...extras } shaped the same way as the endpoint.
async function callTeacherAccount(body) {
  if (!supabase) return { ok: false, error: 'Supabase not configured locally — deploy to Vercel.' }
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { ok: false, error: 'Sign in as admin to manage teacher accounts.' }
  try {
    const r = await fetch('/api/teacher-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    })
    return await r.json()
  } catch (e) {
    return { ok: false, error: String(e.message || e) }
  }
}

export default function TeachersTab() {
  const teachers               = useStore(s => s.timetableTeachers)
  const addTimetableTeacher    = useStore(s => s.addTimetableTeacher)
  const updateTimetableTeacher = useStore(s => s.updateTimetableTeacher)
  const deleteTimetableTeacher = useStore(s => s.deleteTimetableTeacher)
  const timetableMappings      = useStore(s => s.timetableMappings)
  const examSchedules          = useStore(s => s.examSchedules)

  // Add-teacher form state
  const [newName,        setNewName]        = useState('')
  const [newEmail,       setNewEmail]       = useState('')
  const [addCreateLogin, setAddCreateLogin] = useState(false)
  const [addPassword,    setAddPassword]    = useState('')
  const [addStatus,      setAddStatus]      = useState(null) // { kind, message }

  // Edit-row state (existing)
  const [editingId,    setEditingId]    = useState(null)
  const [editingName,  setEditingName]  = useState('')
  const [editingEmail, setEditingEmail] = useState('')

  // Login-management state
  const [authEmails,   setAuthEmails]   = useState(new Set()) // lowercase emails with login accounts
  const [authLoading,  setAuthLoading]  = useState(true)
  const [authError,    setAuthError]    = useState(null)
  // Inline password form for per-row Create/Reset actions:
  // { teacherId, action: 'create' | 'reset', password }
  const [loginForm,    setLoginForm]    = useState(null)
  // Per-row last action result: { teacherId, kind: 'ok' | 'error', message }
  const [actionStatus, setActionStatus] = useState(null)
  const [busy,         setBusy]         = useState(false)

  async function refreshAuthEmails() {
    setAuthLoading(true)
    setAuthError(null)
    const data = await callTeacherAccount({ action: 'list' })
    if (data.ok) {
      setAuthEmails(new Set(data.emails || []))
    } else {
      setAuthError(data.error || 'Failed to load login accounts')
    }
    setAuthLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshAuthEmails()
  }, [])

  async function handleAdd() {
    if (!newName.trim()) return
    addTimetableTeacher(newName.trim(), newEmail.trim())

    if (addCreateLogin) {
      if (!newEmail.trim()) {
        setAddStatus({ kind: 'error', message: 'Teacher added without login — email is required to create a login account.' })
      } else if (addPassword.length < MIN_PASSWORD) {
        setAddStatus({ kind: 'error', message: `Teacher added without login — password must be at least ${MIN_PASSWORD} characters.` })
      } else {
        setBusy(true)
        const data = await callTeacherAccount({
          action: 'create', email: newEmail.trim(), password: addPassword, name: newName.trim(),
        })
        setBusy(false)
        if (data.ok) {
          setAddStatus({ kind: 'ok', message: `Teacher and login created. Share the password with ${newEmail.trim()}.` })
          await refreshAuthEmails()
        } else {
          setAddStatus({ kind: 'error', message: `Teacher added — login creation failed: ${data.error}` })
        }
      }
    } else {
      setAddStatus(null)
    }

    setNewName('')
    setNewEmail('')
    setAddPassword('')
    setAddCreateLogin(false)
  }

  function startEdit(t) {
    setEditingId(t.id)
    setEditingName(t.name)
    setEditingEmail(t.email ?? '')
  }

  function handleSaveEdit(id) {
    updateTimetableTeacher(id, { name: editingName, email: editingEmail })
    setEditingId(null)
  }

  function usageFor(id) {
    const mappingCount = timetableMappings.filter(m => m.teacherId === id).length
    const examCount    = examSchedules.filter(e => e.teacherId === id).length
    return { mappingCount, examCount }
  }

  function handleDelete(t) {
    const usage = usageFor(t.id)
    const refs = []
    if (usage.mappingCount) refs.push(`${usage.mappingCount} timetable mapping${usage.mappingCount > 1 ? 's' : ''}`)
    if (usage.examCount)    refs.push(`${usage.examCount} exam schedule${usage.examCount > 1 ? 's' : ''}`)
    const refSummary = refs.length ? ` ${refs.join(' and ')} will be unlinked (teacher cleared).` : ''
    if (window.confirm(`Delete "${t.name}"?${refSummary}`)) deleteTimetableTeacher(t.id)
  }

  function openLoginForm(t, action) {
    setLoginForm({ teacherId: t.id, action, password: '' })
    setActionStatus(null)
  }

  async function submitLoginForm(t) {
    if (!loginForm || loginForm.teacherId !== t.id) return
    if (loginForm.password.length < MIN_PASSWORD) {
      setActionStatus({ teacherId: t.id, kind: 'error', message: `Password must be at least ${MIN_PASSWORD} characters.` })
      return
    }
    setBusy(true)
    const body = loginForm.action === 'create'
      ? { action: 'create', email: t.email, password: loginForm.password, name: t.name }
      : { action: 'reset',  email: t.email, newPassword: loginForm.password }
    const data = await callTeacherAccount(body)
    setBusy(false)
    if (data.ok) {
      const msg = loginForm.action === 'create'
        ? `Login created. Share the password with ${t.email}.`
        : `Password reset. Share the new password with ${t.email}.`
      setActionStatus({ teacherId: t.id, kind: 'ok', message: msg })
      setLoginForm(null)
      await refreshAuthEmails()
    } else {
      setActionStatus({ teacherId: t.id, kind: 'error', message: data.error || 'Action failed' })
    }
  }

  async function handleDeleteLogin(t) {
    if (!window.confirm(`Delete login account for ${t.name} (${t.email})?\n\nThey will no longer be able to log in. The teacher record itself stays.`)) return
    setBusy(true)
    const data = await callTeacherAccount({ action: 'delete', email: t.email })
    setBusy(false)
    if (data.ok) {
      setActionStatus({ teacherId: t.id, kind: 'ok', message: 'Login account deleted.' })
      await refreshAuthEmails()
    } else {
      setActionStatus({ teacherId: t.id, kind: 'error', message: data.error || 'Delete failed' })
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-2">Add teacher</div>
        <div className="flex gap-2 mb-2">
          <input
            className="input flex-1 text-[13px]"
            placeholder="Name  e.g. Navneet Sir"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
          />
          <button
            className="btn btn-primary px-4 text-[12px] min-h-[36px] disabled:opacity-40"
            onClick={handleAdd}
            disabled={!newName.trim() || busy}
          >Add</button>
        </div>
        <input
          className="input w-full text-[13px] mb-2"
          placeholder="Email address (used for schedule emails)"
          type="email"
          value={newEmail}
          onChange={e => setNewEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />

        <label className="flex items-center gap-2 text-[12px] text-ink-2 cursor-pointer select-none mb-2">
          <input
            type="checkbox"
            checked={addCreateLogin}
            onChange={e => setAddCreateLogin(e.target.checked)}
          />
          Also create a login account for the teacher portal
        </label>
        {addCreateLogin && (
          <input
            className="input w-full text-[13px]"
            placeholder={`Password (min ${MIN_PASSWORD} chars) — you'll share this with the teacher`}
            type="text"
            autoComplete="off"
            value={addPassword}
            onChange={e => setAddPassword(e.target.value)}
          />
        )}
        {addStatus && (
          <div className={`mt-2 text-[12px] ${addStatus.kind === 'ok' ? 'text-green-700' : 'text-red-600'}`}>
            {addStatus.message}
          </div>
        )}
      </Card>

      <Card>
        <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-3 flex items-center justify-between">
          <span>Teachers ({teachers.length})</span>
          {authLoading
            ? <span className="text-ink-3 normal-case font-normal italic">Loading login accounts…</span>
            : authError
              ? <span className="text-red-600 normal-case font-normal" title={authError}>⚠ Login info unavailable</span>
              : null}
        </div>
        {teachers.length === 0 ? (
          <p className="text-[13px] text-ink-3 italic">No teachers yet — add one above.</p>
        ) : (
          <div className="divide-y divide-border">
            {teachers.map(t => {
              const usage = usageFor(t.id)
              const hasLogin = !!t.email && authEmails.has(t.email.toLowerCase())
              const status = actionStatus?.teacherId === t.id ? actionStatus : null
              const form   = loginForm?.teacherId    === t.id ? loginForm    : null
              return (
                <div key={t.id} className="py-2.5 group">
                  {editingId === t.id ? (
                    <div className="flex items-center gap-3">
                      <div className="flex-1 space-y-1.5">
                        <input
                          autoFocus
                          className="input w-full text-[13px] py-1"
                          placeholder="Name"
                          value={editingName}
                          onChange={e => setEditingName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter')  handleSaveEdit(t.id)
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                        />
                        <input
                          className="input w-full text-[13px] py-1"
                          placeholder="Email address"
                          type="email"
                          value={editingEmail}
                          onChange={e => setEditingEmail(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter')  handleSaveEdit(t.id)
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                        />
                        <div className="flex gap-2">
                          <button className="text-[11px] px-2 py-1 rounded bg-accent text-white" onClick={() => handleSaveEdit(t.id)}>✓ Save</button>
                          <button className="text-[11px] px-2 py-1 rounded border border-border text-ink-3" onClick={() => setEditingId(null)}>✕ Cancel</button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-medium flex items-center gap-2">
                          {t.name}
                          {hasLogin && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
                              🔐 has login
                            </span>
                          )}
                        </div>
                        {t.email
                          ? <div className="text-[11px] text-ink-3 truncate">{t.email}</div>
                          : <div className="text-[11px] text-amber-500 italic">No email — won't receive schedule emails</div>}
                        <div className="text-[11px] text-ink-3 mt-0.5">
                          {usage.mappingCount} mapping{usage.mappingCount !== 1 ? 's' : ''} · {usage.examCount} exam schedule{usage.examCount !== 1 ? 's' : ''}
                        </div>
                      </div>
                      {t.email && !authLoading && !authError && (
                        hasLogin ? (
                          <>
                            <button
                              className="text-[12px] text-ink-2 px-2 py-1 rounded border border-border hover:bg-surface-2 disabled:opacity-40"
                              onClick={() => openLoginForm(t, 'reset')}
                              disabled={busy}
                            >🔄 Reset password</button>
                            <button
                              className="text-[12px] text-red-600 px-2 py-1 rounded border border-red-200 hover:bg-red-50 disabled:opacity-40"
                              onClick={() => handleDeleteLogin(t)}
                              disabled={busy}
                            >🗑 Delete login</button>
                          </>
                        ) : (
                          <button
                            className="text-[12px] text-accent px-2 py-1 rounded border border-accent/40 hover:bg-accent/5 disabled:opacity-40"
                            onClick={() => openLoginForm(t, 'create')}
                            disabled={busy}
                          >🔑 Create login</button>
                        )
                      )}
                      <button
                        className="text-[12px] text-ink-3 hover:text-ink opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 rounded hover:bg-surface-2"
                        onClick={() => startEdit(t)}
                      >Edit</button>
                      <button
                        className="text-[12px] text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 rounded hover:bg-red-50"
                        onClick={() => handleDelete(t)}
                      >Delete</button>
                    </div>
                  )}

                  {form && (
                    <div className="mt-2 pl-3 border-l-2 border-accent/40 space-y-2">
                      <div className="text-[11px] font-semibold text-ink-2">
                        {form.action === 'create' ? `Create login for ${t.email}` : `Reset password for ${t.email}`}
                      </div>
                      <div className="flex gap-2">
                        <input
                          autoFocus
                          type="text"
                          autoComplete="off"
                          className="input flex-1 text-[13px] py-1"
                          placeholder={`Password (min ${MIN_PASSWORD} chars)`}
                          value={form.password}
                          onChange={e => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                          onKeyDown={e => {
                            if (e.key === 'Enter')  submitLoginForm(t)
                            if (e.key === 'Escape') setLoginForm(null)
                          }}
                        />
                        <button
                          className="text-[11px] px-3 py-1 rounded bg-accent text-white disabled:opacity-40"
                          onClick={() => submitLoginForm(t)}
                          disabled={busy || form.password.length < MIN_PASSWORD}
                        >{form.action === 'create' ? 'Create' : 'Reset'}</button>
                        <button
                          className="text-[11px] px-2 py-1 rounded border border-border text-ink-3"
                          onClick={() => setLoginForm(null)}
                        >Cancel</button>
                      </div>
                    </div>
                  )}

                  {status && (
                    <div className={`mt-1.5 text-[11px] ${status.kind === 'ok' ? 'text-green-700' : 'text-red-600'}`}>
                      {status.message}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
