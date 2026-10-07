import { useMemo, useState } from 'react'
import useStore from '../../store/useStore'
import useHolidays from '../../store/useHolidays'
import { Card, CardTitle, Alert } from '../../components/ui'
import { splitHolidays } from '../../lib/holidays'
import { fmtDate } from '../../lib/dates'

// Attendance → Holidays (admin). Days marked here are left out of every
// attendance % for the branches/batches they cover — see src/lib/holidays.js.
// Sundays are off by rule and never entered.

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function rangeLabel(h) {
  return h.fromDate === h.toDate ? fmtDate(h.fromDate) : `${fmtDate(h.fromDate)} – ${fmtDate(h.toDate)}`
}

const EMPTY_FORM = { name: '', fromDate: '', toDate: '' }

function HolidayList({ title, items, onDelete, busyId }) {
  const headingId = `holidays-${title.toLowerCase()}`
  return (
    <section role="region" aria-labelledby={headingId} className="mb-5">
      <h3 id={headingId} className="text-[11px] font-mono uppercase tracking-widest text-ink-3 mb-2">
        {title} ({items.length})
      </h3>
      {items.length === 0 ? (
        <p className="text-[12px] text-ink-3">None.</p>
      ) : (
        <ul className="divide-y divide-border border border-border rounded-lg">
          {items.map(h => (
            <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              {/* Phone: name + dates get their own line; scope and Delete below. */}
              <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                <div className="text-[13px] font-semibold text-ink">{h.name}</div>
                <div className="text-[11.5px] font-mono text-ink-3">{rangeLabel(h)}</div>
              </div>
              <div className="text-[11.5px] text-ink-2 min-w-0 flex-1 sm:flex-none">
                <span className="font-semibold">{h.branch}</span>
                {' · '}
                {h.batchNames.length ? h.batchNames.join(', ') : 'All batches'}
              </div>
              <button
                type="button"
                onClick={() => onDelete(h)}
                disabled={busyId === h.id}
                aria-label={`Delete ${h.name} for ${h.branch}`}
                className="btn text-[12px] min-h-[44px] px-3 text-danger
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40
                           disabled:opacity-40"
              >
                {busyId === h.id ? 'Deleting…' : 'Delete'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function HolidaysTab({ today = todayIso() }) {
  const holidays              = useHolidays()
  const addHolidays           = useStore(s => s.addHolidays)
  const deleteHoliday         = useStore(s => s.deleteHoliday)
  const branches              = useStore(s => s.branches)
  const syllabusBatches       = useStore(s => s.syllabusBatches)
  const archivedBatches       = useStore(s => s.archivedBatches)
  const syllabusBatchBranches = useStore(s => s.syllabusBatchBranches)

  const [form, setForm]       = useState(EMPTY_FORM)
  // { [branch]: { mode: 'all' | 'some', batches: [] } } — present = ticked
  const [scopes, setScopes]   = useState({})
  const [error, setError]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [busyId, setBusyId]   = useState(null)

  // Active batches per branch — a retired cohort has no class to cancel.
  const batchesByBranch = useMemo(() => {
    const archived = new Set(archivedBatches || [])
    const map = {}
    for (const b of syllabusBatches || []) {
      if (archived.has(b)) continue
      const br = (syllabusBatchBranches || {})[b]
      if (!br) continue
      ;(map[br] = map[br] || []).push(b)
    }
    return map
  }, [syllabusBatches, archivedBatches, syllabusBatchBranches])

  const { upcoming, past } = useMemo(() => splitHolidays(holidays, today), [holidays, today])

  function toggleBranch(branch) {
    setScopes(prev => {
      const next = { ...prev }
      if (next[branch]) delete next[branch]
      else next[branch] = { mode: 'all', batches: [] }
      return next
    })
  }

  function setMode(branch, mode) {
    setScopes(prev => ({ ...prev, [branch]: { ...prev[branch], mode } }))
  }

  function toggleBatch(branch, batch) {
    setScopes(prev => {
      const cur = prev[branch].batches
      const batches = cur.includes(batch) ? cur.filter(b => b !== batch) : [...cur, batch]
      return { ...prev, [branch]: { ...prev[branch], batches } }
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    // Branch order follows the configured list, not tick order.
    const chosen = (branches || []).filter(b => scopes[b])
    const empty = chosen.find(b => scopes[b].mode === 'some' && scopes[b].batches.length === 0)
    if (empty) { setError(`Pick at least one ${empty} batch, or choose Whole branch.`); return }
    setSaving(true)
    const out = await addHolidays({
      name: form.name,
      fromDate: form.fromDate,
      toDate: form.toDate,
      scopes: chosen.map(b => ({
        branch: b,
        batchNames: scopes[b].mode === 'some'
          ? (batchesByBranch[b] || []).filter(x => scopes[b].batches.includes(x))
          : [],
      })),
    })
    setSaving(false)
    if (!out?.ok) { setError(out?.error || 'Could not save the holiday.'); return }
    setForm(EMPTY_FORM)
    setScopes({})
  }

  async function handleDelete(h) {
    if (!window.confirm(`Delete "${h.name}" for ${h.branch}? Attendance on these days will count again.`)) return
    setBusyId(h.id)
    const ok = await deleteHoliday(h.id)
    setBusyId(null)
    if (!ok) setError(`Could not delete "${h.name}". Try again.`)
  }

  return (
    <div>
      <Card className="mb-5">
        <CardTitle>Add a holiday</CardTitle>
        <p className="text-[12px] text-ink-3 mb-3">
          Days marked here are left out of attendance % for the branches and batches you pick.
          Sundays are always off — no need to add them.
        </p>
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr] mb-3">
            <label className="block text-[12px] text-ink-2">
              <span className="block mb-1 font-semibold">Holiday name</span>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Diwali"
                className="form-input w-full min-h-[44px] text-[13px]"
              />
            </label>
            <label className="block text-[12px] text-ink-2">
              <span className="block mb-1 font-semibold">From</span>
              <input
                type="date"
                value={form.fromDate}
                onChange={e => setForm(f => ({ ...f, fromDate: e.target.value }))}
                className="form-input w-full min-h-[44px] text-[13px]"
              />
            </label>
            <div className="text-[12px] text-ink-2">
              <label className="block">
                <span className="block mb-1 font-semibold">To</span>
                <input
                  type="date"
                  value={form.toDate}
                  min={form.fromDate || undefined}
                  onChange={e => setForm(f => ({ ...f, toDate: e.target.value }))}
                  aria-describedby="holiday-to-hint"
                  className="form-input w-full min-h-[44px] text-[13px]"
                />
              </label>
              <span id="holiday-to-hint" className="block mt-1 text-[11px] text-ink-3">Leave empty for one day</span>
            </div>
          </div>

          <fieldset className="mb-3">
            <legend className="text-[12px] font-semibold text-ink-2 mb-1.5">Applies to</legend>
            <div className="flex flex-col gap-2">
              {(branches || []).map(branch => {
                const scope = scopes[branch]
                const radioName = `holiday-scope-${branch}`
                return (
                  <div key={branch} className="border border-border rounded-lg px-3 py-2">
                    <label className="flex items-center gap-2 min-h-[36px] text-[13px] font-semibold text-ink cursor-pointer">
                      <input type="checkbox" checked={!!scope} onChange={() => toggleBranch(branch)} />
                      {branch}
                    </label>
                    {scope && (
                      <div className="pl-6 pb-1">
                        <div className="flex gap-4 flex-wrap text-[12.5px] text-ink-2">
                          <label className="flex items-center gap-1.5 min-h-[36px] cursor-pointer">
                            <input type="radio" name={radioName} checked={scope.mode === 'all'}
                                   onChange={() => setMode(branch, 'all')} />
                            Whole branch
                          </label>
                          <label className="flex items-center gap-1.5 min-h-[36px] cursor-pointer">
                            <input type="radio" name={radioName} checked={scope.mode === 'some'}
                                   onChange={() => setMode(branch, 'some')} />
                            Only some batches
                          </label>
                        </div>
                        {scope.mode === 'some' && (
                          (batchesByBranch[branch] || []).length === 0 ? (
                            <p className="text-[12px] text-ink-3">No active batches in {branch}.</p>
                          ) : (
                            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                              {batchesByBranch[branch].map(batch => (
                                <label key={batch} className="flex items-center gap-1.5 min-h-[36px] text-[12px] font-mono text-ink-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={scope.batches.includes(batch)}
                                    onChange={() => toggleBatch(branch, batch)}
                                  />
                                  {batch}
                                </label>
                              ))}
                            </div>
                          )
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </fieldset>

          {error && (
            <div role="alert" className="mb-3">
              <Alert type="error">{error}</Alert>
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="btn btn-primary min-h-[44px] px-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {saving ? 'Saving…' : 'Add holiday'}
          </button>
        </form>
      </Card>

      <HolidayList title="Upcoming" items={upcoming} onDelete={handleDelete} busyId={busyId} />
      <HolidayList title="Past" items={past} onDelete={handleDelete} busyId={busyId} />
    </div>
  )
}
