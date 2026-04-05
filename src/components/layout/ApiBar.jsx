import { useRef, useState } from 'react'
import useStore from '../../store/useStore'
import { IS_READ_ONLY } from '../../config'

export default function ApiBar() {
  const apiKey = useStore(s => s.apiKey)
  const setApiKey = useStore(s => s.setApiKey)
  const openUploadModal = useStore(s => s.openUploadModal)
  const exportDB = useStore(s => s.exportDB)
  const importDB = useStore(s => s.importDB)
  const importStudentsDB = useStore(s => s.importStudentsDB)
  const clearAll = useStore(s => s.clearAll)

  const [showKey, setShowKey] = useState(false)
  const [keyInput, setKeyInput] = useState(apiKey)
  const importRef = useRef()
  const studentsRef = useRef()

  function handleSaveKey() {
    setApiKey(keyInput.trim())
  }

  function handleImport(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const result = importDB(ev.target.result)
        alert(`✅ Imported ${result.exams} exams${result.plans ? ` + ${result.plans} insights` : ''}`)
      } catch (err) {
        alert(err.message)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function handleStudentsImport(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result)
        const list = Array.isArray(data) ? data : (data.students || [])
        const count = importStudentsDB(list)
        alert(`✅ Imported ${count} student profiles`)
      } catch (err) {
        alert('Import failed: ' + err.message)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function handleClearAll() {
    if (confirm('Clear ALL data? This cannot be undone.')) clearAll()
  }

  const connected = apiKey.startsWith('sk-ant-')

  if (IS_READ_ONLY) {
    return (
      <div className="bg-sidebar border-b border-white/[0.07] px-8 py-2 flex items-center gap-3">
        <span className="w-2 h-2 rounded-full bg-success flex-shrink-0" />
        <span className="text-[11px] font-mono text-indigo-300/50">
          Read-only view · Data updated by LWS Pune admin
        </span>
      </div>
    )
  }

  return (
    <div className="bg-sidebar border-b border-white/[0.07] px-8 py-2 flex items-center gap-3 flex-wrap">
      {/* API key */}
      <div className="flex items-center gap-2 mr-2">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${connected ? 'bg-success' : 'bg-danger'}`} />
        {showKey ? (
          <>
            <input
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              placeholder="sk-ant-..."
              className="text-[11px] font-mono bg-white/10 text-white/80 border border-white/20
                         rounded px-2 py-1 outline-none w-52 focus:border-indigo-400"
            />
            <button
              onClick={() => { handleSaveKey(); setShowKey(false) }}
              className="text-[10px] font-bold text-indigo-300 hover:text-white px-2 py-1"
            >
              Save
            </button>
            <button
              onClick={() => setShowKey(false)}
              className="text-[10px] text-white/30 hover:text-white/60 px-1"
            >
              ✕
            </button>
          </>
        ) : (
          <button
            onClick={() => setShowKey(true)}
            className="text-[11px] font-mono text-indigo-300/50 hover:text-indigo-300 transition-colors"
          >
            {connected ? `API: ${apiKey.slice(0, 14)}…` : 'Connect Claude API →'}
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 ml-auto flex-wrap">
        {/* Add exam */}
        <button onClick={openUploadModal} className="btn btn-primary btn-sm">
          + Add Exam
        </button>

        {/* Export */}
        <button onClick={exportDB} className="btn btn-secondary btn-sm">
          ⬇ Export
        </button>

        {/* Import data */}
        <button onClick={() => importRef.current.click()} className="btn btn-secondary btn-sm">
          ⬆ Import
        </button>
        <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />

        {/* Import students */}
        <button
          onClick={() => studentsRef.current.click()}
          className="btn btn-sm"
          style={{ background: '#eeeeff', color: '#5b5ef4', border: '1px solid #c5d0fc' }}
        >
          👥 Students DB
        </button>
        <input ref={studentsRef} type="file" accept=".json" className="hidden" onChange={handleStudentsImport} />

        {/* Clear */}
        <button onClick={handleClearAll} className="btn btn-danger btn-sm">
          🗑 Clear
        </button>
      </div>
    </div>
  )
}
