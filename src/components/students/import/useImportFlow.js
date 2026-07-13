import { useState, useRef, useMemo } from 'react'
import { parseStudentsExcel, parseExcelFull } from '../../../lib/excel'
import { mergeStudents, enrichWithRollNos, applyManualMatch } from '../../../lib/mergeStudents'
import { loadExistingStudents } from '../../../lib/students/loadExistingStudents'
import { dominantBranch } from '../../../lib/students/dominantBranch'
import useStore from '../../../store/useStore'

export default function useImportFlow() {
  const importStudentsFromExcel = useStore(s => s.importStudentsFromExcel)

  // ── Step 1 state ─────────────────────────────────────────────
  const [studentFile,     setStudentFile]     = useState(null)
  const [dragging,        setDragging]        = useState(false)
  const [loadingStudents, setLoadingStudents] = useState(false)
  const [studentError,    setStudentError]    = useState(null)
  const [mergeResult,     setMergeResult]     = useState(null)

  // Branch dropdown — admin can tag the import with a branch so new students
  // and existing students with blank branch get the value. Empty means
  // "don't set a default" (current behaviour). Cached inputs let us re-merge
  // without re-reading the file when the branch is changed.
  const [selectedBranch,  setSelectedBranchState] = useState('')
  const [parsedRows,      setParsedRows]      = useState(null)
  const [existingCache,   setExistingCache]   = useState(null)

  // ── Step 2 state ─────────────────────────────────────────────
  const [enrichedStudents, setEnrichedStudents] = useState([])
  const [examFiles,        setExamFiles]        = useState([])
  const [loadingExam,      setLoadingExam]      = useState(false)
  const [examError,        setExamError]        = useState(null)
  const [selections,       setSelections]       = useState({})

  // ── Shared state ──────────────────────────────────────────────
  const [step,   setStep]   = useState(1)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)
  const [done,   setDone]   = useState(null)

  // ── Refs ──────────────────────────────────────────────────────
  const studentFileRef = useRef()
  const examFileRef    = useRef()

  // ── Derived ───────────────────────────────────────────────────
  const allStudentNames = useMemo(
    () => enrichedStudents.map(s => s.canonical_name).filter(Boolean).sort(),
    [enrichedStudents]
  )

  const totalRollsAssigned = examFiles.reduce(
    (acc, ef) =>
      acc +
      ef.matched.length +
      ef.pending.filter(p => p.status === 'assigned').length,
    0
  )

  const addedStudents = mergeResult
    ? mergeResult.students.slice(mergeResult.students.length - mergeResult.added)
    : []

  // ── Step 1: parse Student Search List ────────────────────────
  async function handleStudentFile(f) {
    if (!f) return
    setStudentFile(f)
    setMergeResult(null)
    setStudentError(null)
    setLoadingStudents(true)

    try {
      const importedRows = await parseStudentsExcel(f)
      const existingStudents = await loadExistingStudents()
      setParsedRows(importedRows)
      setExistingCache(existingStudents)

      // Roster is effectively single-branch: if the user hasn't hand-picked a
      // branch yet, seed the default with the dominant one (≥80% of branched
      // students). Safe because the write is fill-only — a wrong guess can
      // never move an existing student, only fill blanks on new/blank rows.
      const effectiveBranch = selectedBranch || dominantBranch(existingStudents)
      if (effectiveBranch !== selectedBranch) setSelectedBranchState(effectiveBranch)

      const result = mergeStudents(existingStudents, importedRows, { defaultBranch: effectiveBranch })
      setMergeResult(result)
    } catch (e) {
      setStudentError('Error reading file: ' + e.message)
    }

    setLoadingStudents(false)
  }

  // Re-run the merge with a new defaultBranch using cached inputs (no
  // file re-read). Called from the modal's branch dropdown.
  function setSelectedBranch(branch) {
    setSelectedBranchState(branch)
    if (parsedRows && existingCache) {
      const result = mergeStudents(existingCache, parsedRows, { defaultBranch: branch })
      setMergeResult(result)
    }
  }

  function handleStudentNext() {
    if (!mergeResult) return
    setEnrichedStudents(mergeResult.students)
    setExamFiles([])
    setSelections({})
    setStep(2)
  }

  // ── Step 2: add exam files ────────────────────────────────────
  async function handleExamFile(f) {
    if (!f) return
    setLoadingExam(true)
    setExamError(null)

    try {
      const parsed = await parseExcelFull(f)
      const { students: updated, matched, unresolved } = enrichWithRollNos(
        enrichedStudents,
        parsed.students,
      )

      setEnrichedStudents(updated)

      const pending = unresolved.map(u => ({
        ...u,
        status:     'pending',
        assignedTo: null,
      }))

      setExamFiles(prev => [...prev, { name: f.name, matched, pending }])
    } catch (e) {
      setExamError('Error reading exam file: ' + e.message)
    }

    if (examFileRef.current) examFileRef.current.value = ''
    setLoadingExam(false)
  }

  function handleAssign(fileIdx, item, canonicalName) {
    const updated = applyManualMatch(
      enrichedStudents, canonicalName, item.examName, item.rollNo
    )
    setEnrichedStudents(updated)

    setExamFiles(prev => prev.map((ef, i) => {
      if (i !== fileIdx) return ef
      return {
        ...ef,
        pending: ef.pending.map(p =>
          p.examName === item.examName
            ? { ...p, status: 'assigned', assignedTo: canonicalName }
            : p
        ),
      }
    }))
  }

  function handleSkip(fileIdx, item) {
    setExamFiles(prev => prev.map((ef, i) => {
      if (i !== fileIdx) return ef
      return {
        ...ef,
        pending: ef.pending.map(p =>
          p.examName === item.examName ? { ...p, status: 'skipped' } : p
        ),
      }
    }))
  }

  function handleSelect(key, value) {
    setSelections(prev => ({ ...prev, [key]: value }))
  }

  // ── Step 3 → confirm import ───────────────────────────────────
  async function handleConfirm() {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        students:  enrichedStudents,
        added:     mergeResult.added,
        updated:   mergeResult.updated,
        unchanged: mergeResult.unchanged,
      }
      const result = await importStudentsFromExcel(payload)
      setDone({ ...result, rollsAssigned: totalRollsAssigned })
      setStep(4)
    } catch (e) {
      setError('Import failed: ' + e.message)
    }
    setSaving(false)
  }

  function goBackToStep1() {
    setStep(1)
    setExamFiles([])
    setEnrichedStudents([])
  }

  return {
    // state
    step, saving, error, done,
    studentFile, dragging, setDragging, loadingStudents, studentError, mergeResult,
    selectedBranch, setSelectedBranch,
    enrichedStudents, examFiles, loadingExam, examError, selections,
    // refs
    studentFileRef, examFileRef,
    // derived
    allStudentNames, totalRollsAssigned, addedStudents,
    // handlers
    handleStudentFile, handleStudentNext,
    handleExamFile, handleAssign, handleSkip, handleSelect,
    handleConfirm, goBackToStep1,
    setStep,
  }
}
