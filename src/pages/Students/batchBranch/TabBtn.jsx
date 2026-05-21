export function TabBtn({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-5 py-2 text-[13px] font-semibold rounded-lg transition-colors
        ${active
          ? 'bg-accent text-white'
          : 'bg-surface-2 text-ink-2 hover:bg-accent-soft hover:text-accent'}`}
    >
      {label}
    </button>
  )
}
