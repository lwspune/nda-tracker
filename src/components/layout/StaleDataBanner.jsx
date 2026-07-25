import useStore from '../../store/useStore'

/**
 * Shown when persist.js rejected a save because `faculty_state` was written by
 * another session after this tab loaded. At that point this tab's copy is stale
 * and saving is hard-stopped (see persist.js `staleLock`), so the only recovery
 * is a reload — hence no dismiss control.
 *
 * Deliberately blunt: silently losing a colleague's work is worse than losing
 * your own uncommitted keystrokes, and the alternative (warn but keep saving)
 * defeats the guard entirely.
 */
export default function StaleDataBanner() {
  const saveConflict = useStore(s => s.saveConflict)
  if (!saveConflict) return null

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed top-0 left-0 right-0 z-[100] bg-red-700 text-white px-4 py-2.5 flex items-center justify-center gap-3 text-[13px] shadow-lg"
    >
      <span className="font-semibold">Your data is out of date.</span>
      <span className="hidden sm:inline text-red-100">
        Someone else saved changes after this tab loaded — editing here is paused so their work isn&apos;t overwritten.
      </span>
      <span className="sm:hidden text-red-100">Editing is paused.</span>
      <button
        onClick={() => window.location.reload()}
        className="ml-1 shrink-0 rounded bg-white px-3 py-1 font-semibold text-red-800 transition-colors hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-red-700"
      >
        Reload
      </button>
    </div>
  )
}
