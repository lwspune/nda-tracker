import { scoreBg } from '../../lib/analytics'

// ── Card ─────────────────────────────────────────────────────
export function Card({ children, className = '', ...props }) {
  return (
    <div className={`card ${className}`} {...props}>
      {children}
    </div>
  )
}

export function CardTitle({ children }) {
  return <div className="card-title">{children}</div>
}

// ── Stat Card ────────────────────────────────────────────────
export function StatCard({ label, value, delta, deltaUp, color = 'text-accent' }) {
  return (
    <div className="stat-card">
      <div className="text-[10.5px] text-ink-3 uppercase tracking-[1px] font-bold">{label}</div>
      <div className={`font-extrabold text-[30px] tracking-tight leading-none my-1.5 ${color}`}>
        {value}
      </div>
      {delta && (
        <div className={`text-[11px] font-mono ${deltaUp ? 'text-success' : 'text-danger'}`}>
          {deltaUp ? '▲' : '▼'} {delta}
        </div>
      )}
    </div>
  )
}

// ── Badge ────────────────────────────────────────────────────
export function Badge({ children, variant = 'gray' }) {
  const styles = {
    green:  'bg-green-50 text-success',
    red:    'bg-red-50 text-danger',
    yellow: 'bg-yellow-50 text-warning',
    blue:   'bg-accent-soft text-accent',
    gray:   'bg-surface-2 text-ink-2',
  }
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono ${styles[variant] || styles.gray}`}>
      {children}
    </span>
  )
}

// ── HeatBar ──────────────────────────────────────────────────
export function HeatBar({ pct, label, count, onClick, chevron }) {
  const bg = scoreBg(pct)
  return (
    <div
      className={`flex items-center gap-2.5 py-1 ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      <div className="w-[175px] min-w-[175px] text-[12px] text-ink-2 font-medium truncate flex items-center gap-1.5">
        {chevron !== undefined && (
          <span
            className="text-[10px] text-ink-3 transition-transform duration-200 inline-block"
            style={{ transform: chevron ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >▶</span>
        )}
        {label}
      </div>
      <div className="flex-1 bg-surface-2 rounded-full h-6 overflow-hidden">
        <div
          className="h-full rounded-full flex items-center px-2.5 transition-all duration-500"
          style={{ width: `${pct * 100}%`, background: bg }}
        >
          <span className="text-[10px] font-mono font-bold text-white drop-shadow">
            {(pct * 100).toFixed(0)}%
          </span>
        </div>
      </div>
      {count !== undefined && (
        <span className="text-[10px] text-ink-3 font-mono w-12 text-right">{count}</span>
      )}
    </div>
  )
}

// ── Spinner ──────────────────────────────────────────────────
export function Spinner({ size = 'md' }) {
  const s = size === 'sm' ? 'w-4 h-4 border' : 'w-5 h-5 border-2'
  return (
    <div className={`${s} border-border-2 border-t-accent rounded-full animate-spin inline-block`} />
  )
}

// ── Empty State ──────────────────────────────────────────────
export function EmptyState({ icon, title, sub }) {
  return (
    <div className="text-center py-16 px-6">
      <div className="text-4xl mb-3 opacity-25">{icon}</div>
      <div className="text-[16px] font-bold mb-1.5">{title}</div>
      <div className="text-[13px] text-ink-3 leading-relaxed">{sub}</div>
    </div>
  )
}

// ── Alert ────────────────────────────────────────────────────
export function Alert({ type = 'info', children }) {
  const styles = {
    info:    'bg-accent-soft border-accent/20 text-indigo-800',
    success: 'bg-green-50 border-green-200 text-green-900',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-900',
    error:   'bg-red-50 border-red-200 text-red-900',
  }
  return (
    <div className={`flex items-start gap-2.5 px-4 py-3 rounded-lg border text-[12.5px] leading-relaxed ${styles[type]}`}>
      {children}
    </div>
  )
}

// ── Drop Zone ────────────────────────────────────────────────
export { default as DropZone } from './DropZone'

// ── Page Header ──────────────────────────────────────────────
export function PageHeader({ title, sub, actions }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5 md:mb-7">
      <div>
        <h1 className="text-[24px] font-extrabold text-ink tracking-tight leading-tight">{title}</h1>
        {sub && <p className="text-[13px] text-ink-2 mt-1">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  )
}
