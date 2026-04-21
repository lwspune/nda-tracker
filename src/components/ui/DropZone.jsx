// Generic file drop zone used in upload steps.
// Props: file, dragging, accept, icon, hint, inputRef,
//        onDragOver, onDragLeave, onDrop, onChange
export default function DropZone({ file, dragging, accept, icon, hint, inputRef,
                                   onDragOver, onDragLeave, onDrop, onChange }) {
  const hasFile = !!file
  return (
    <div
      onClick={() => inputRef.current.click()}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`
        border-2 rounded-xl p-5 text-center cursor-pointer transition-all duration-200
        ${hasFile
          ? 'border-success bg-green-50 border-solid'
          : dragging
          ? 'border-accent bg-accent-soft border-dashed'
          : 'border-border-2 bg-surface-2 border-dashed hover:border-accent hover:bg-accent-soft'
        }
      `}
    >
      <div className="text-2xl mb-1.5">{hasFile ? '✅' : icon}</div>
      <div className="text-[13px] font-medium text-ink-2 truncate px-2">
        {hasFile ? file.name : 'Click or drag file here'}
      </div>
      <div className="text-[11px] text-ink-3 mt-1">
        {hasFile ? `${(file.size / 1024).toFixed(1)} KB` : hint}
      </div>
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={onChange} />
    </div>
  )
}
