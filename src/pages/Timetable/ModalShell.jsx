export default function ModalShell({ title, onClose, children, wide = false }) {
  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,18,45,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className={`bg-surface rounded-2xl shadow-xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} flex flex-col overflow-hidden`}
        style={{ maxHeight: '85vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <h2 className="font-bold text-[15px]">{title}</h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink text-lg leading-none">✕</button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {children}
        </div>
      </div>
    </div>
  )
}
