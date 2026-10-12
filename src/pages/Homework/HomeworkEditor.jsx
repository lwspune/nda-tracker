import { useMemo, useState } from 'react'
import useStore from '../../store/useStore'
import { useMode } from '../../context/ModeContext'
import { Card, Alert, PageHeader } from '../../components/ui'
import { SUBJECTS } from '../../lib/ndaFreq'
import { visibleBatchOptions } from '../../lib/batchVisibility'
import { findTeacherByEmail, getTeacherSubjectBatches } from '../../lib/teacherDay'
import { ACCEPT, validateUploadFiles } from '../../lib/assignments/upload'
import { validateAssignmentForPublish } from '../../lib/assignments/status'
import {
  blankAssignment, homeworkTargets, istLocalToIso, isoToIstLocal,
} from '../../lib/assignments/editor'

// Create or edit one homework assignment: the question paper (and an optional
// answer key the grader sees and students never do), the batches, a deadline
// and the marks.
//
// Once published, the marks and their breakdown are locked: a grade is checked
// against them (homework_grade_commit), so changing them under graded work
// would leave grades that no longer add up.
export default function HomeworkEditor({ assignment, email, onDone }) {
  const mode = useMode()
  const teachers        = useStore(s => s.timetableTeachers)
  const timetables      = useStore(s => s.timetables)
  const mappings        = useStore(s => s.timetableMappings)
  const syllabusBatches = useStore(s => s.syllabusBatches)
  const archivedBatches = useStore(s => s.archivedBatches)
  const saveHomework    = useStore(s => s.saveHomeworkAssignment)
  const removeFile      = useStore(s => s.removeHomeworkFile)

  const start = assignment ?? blankAssignment(email)
  const [current, setCurrent]   = useState(start)
  const [title, setTitle]       = useState(start.title)
  const [subject, setSubject]   = useState(start.subject)
  const [batchNames, setBatches] = useState(start.batchNames)
  const [instructions, setInstructions] = useState(start.instructions)
  const [maxMarks, setMaxMarks] = useState(start.maxMarks != null ? String(start.maxMarks) : '')
  const [dueLocal, setDueLocal] = useState(isoToIstLocal(start.dueAt))
  const [questions, setQuestions] = useState(start.questions ?? [])
  const [newQuestionFiles, setNewQuestionFiles] = useState([])
  const [newKeyFiles, setNewKeyFiles] = useState([])
  const [fileError, setFileError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)

  const published = current.status === 'published'
  const teacher = findTeacherByEmail(teachers, email)
  const targets = useMemo(() => homeworkTargets({
    mode,
    subjectBatches: getTeacherSubjectBatches({ teacherId: teacher?.id, timetables, mappings }),
    allSubjects: [...new Set([...SUBJECTS, ...(mappings ?? []).map(m => m.subject).filter(Boolean)])],
    allBatches: visibleBatchOptions(syllabusBatches ?? [], archivedBatches ?? [], batchNames),
  }), [mode, teacher?.id, timetables, mappings, syllabusBatches, archivedBatches, batchNames])

  // Keep a saved value visible even when it's no longer offered (a teacher's
  // timetable changed after they set this homework) — never blank it out.
  const subjectOptions = [...new Set([...Object.keys(targets), ...(start.subject ? [start.subject] : [])])]
  const batchOptions = [...new Set([...(targets[subject] ?? []), ...batchNames])]
  const noClasses = mode === 'teacher' && Object.keys(targets).length === 0

  const maxNum = maxMarks.trim() === '' ? null : Number(maxMarks)
  const draft = {
    ...current, title, subject, batchNames, instructions, questions,
    maxMarks: Number.isFinite(maxNum) ? maxNum : null,
    dueAt: istLocalToIso(dueLocal),
  }
  const publishCheck = validateAssignmentForPublish(
    { ...draft, questionFiles: [...current.questionFiles, ...newQuestionFiles] },
    new Date(),
  )
  // The database needs these even for a draft.
  const canSaveDraft = !!title.trim() && !!subject && draft.maxMarks > 0 && !!draft.dueAt

  function pick(setter, list) {
    return e => {
      const files = [...(e.target.files ?? [])]
      e.target.value = ''
      if (!files.length) return
      const check = validateUploadFiles([...list, ...files])
      if (!check.ok) { setFileError(check.error); return }
      setFileError('')
      setter([...list, ...files])
    }
  }

  function toggleBatch(b) {
    setBatches(cur => (cur.includes(b) ? cur.filter(x => x !== b) : [...cur, b]))
  }

  async function save(publish) {
    setSaving(true)
    setSaveError('')
    const r = await saveHomework(draft, { questionFiles: newQuestionFiles, keyFiles: newKeyFiles, publish })
    setSaving(false)
    if (r.ok) { onDone(); return }
    setSaveError(r.error || 'Could not save.')
    // A new assignment may now exist as a draft (files failed): keep editing it.
    if (r.assignment) { setCurrent(r.assignment); setNewQuestionFiles([]); setNewKeyFiles([]) }
  }

  async function dropSaved(kind, path) {
    const r = await removeFile(current, kind, path)
    if (r.ok) setCurrent(r.assignment)
    else setSaveError(r.error)
  }

  return (
    <div>
      <PageHeader
        title={assignment ? 'Edit homework' : 'New homework'}
        sub="Upload the question paper, pick the batches and set a deadline. Students upload photos or a PDF of their answers."
        actions={<button className="btn btn-secondary text-[13px]" onClick={onDone}>← Back</button>}
      />

      {noClasses && (
        <Alert type="warning">
          You have no classes in the timetable, so there is no batch you can set homework for. Ask the office to
          check that your timetable entries carry your name.
        </Alert>
      )}

      <Card className="flex flex-col gap-4 max-w-3xl">
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
          Title
          <input className="form-input" value={title} maxLength={200} onChange={e => setTitle(e.target.value)}
                 placeholder="e.g. Limits — exercise 2.3" />
        </label>

        <div className="grid sm:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
            Subject
            <select className="form-input" value={subject} disabled={published}
                    onChange={e => { setSubject(e.target.value); setBatches([]) }}>
              <option value="">Choose…</option>
              {subjectOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
            Deadline (IST)
            <input className="form-input" type="datetime-local" value={dueLocal} onChange={e => setDueLocal(e.target.value)} />
          </label>
        </div>

        <fieldset className="flex flex-col gap-1">
          <legend className="text-[12px] font-semibold text-ink-2 mb-1">Batches</legend>
          {!subject ? (
            <p className="text-[12px] text-ink-3">Choose a subject first.</p>
          ) : batchOptions.length === 0 ? (
            <p className="text-[12px] text-ink-3">No batches for this subject.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {batchOptions.map(b => (
                <label key={b} className="flex items-center gap-1.5 text-[13px] px-2 py-1 rounded-lg border border-border">
                  <input type="checkbox" checked={batchNames.includes(b)} onChange={() => toggleBatch(b)} />
                  {b}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <div className="flex flex-col gap-1">
          <label htmlFor="homework-description" className="text-[12px] font-semibold text-ink-2">Description</label>
          <p id="homework-description-hint" className="text-[11px] text-ink-3">
            What to do. Enough on its own for homework announced in class — the question paper below is then optional.
          </p>
          <textarea id="homework-description" aria-describedby="homework-description-hint"
                    className="form-input min-h-[70px]" maxLength={2000} value={instructions}
                    onChange={e => setInstructions(e.target.value)}
                    placeholder="e.g. RD Sharma Exercise 3.2, Q1–10, as announced in class. Show all working." />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
            Total marks
            <input className="form-input" type="number" min="0.5" step="0.5" value={maxMarks} disabled={published}
                   onChange={e => setMaxMarks(e.target.value)} />
          </label>
        </div>

        <QuestionBreakdown questions={questions} onChange={setQuestions} locked={published} />

        <FileField
          label="Question paper"
          hint="PDF or photos of the questions. Students can open these. Optional if the description says what to do."
          saved={current.questionFiles}
          picked={newQuestionFiles}
          onPick={pick(setNewQuestionFiles, newQuestionFiles)}
          onUnpick={i => setNewQuestionFiles(f => f.filter((_, j) => j !== i))}
          onRemoveSaved={path => dropSaved('question', path)}
        />
        <FileField
          label="Answer key (optional)"
          hint="Used for grading only. Students never see it."
          saved={current.answerKeyFiles}
          picked={newKeyFiles}
          onPick={pick(setNewKeyFiles, newKeyFiles)}
          onUnpick={i => setNewKeyFiles(f => f.filter((_, j) => j !== i))}
          onRemoveSaved={path => dropSaved('key', path)}
        />
        {fileError && <Alert type="error">{fileError}</Alert>}
        {/* Without a paper the grader has only the description and the student's
            pages; an answer key is what keeps the marking consistent. */}
        {current.questionFiles.length + newQuestionFiles.length === 0
          && current.answerKeyFiles.length + newKeyFiles.length === 0
          && instructions.trim() && (
          <Alert type="info">
            No question paper: upload an answer key (a photo of the worked solutions is enough) so every
            student is marked the same way.
          </Alert>
        )}

        {!publishCheck.ok && (
          <ul className="text-[12px] text-ink-3 list-disc pl-5" aria-label="Still needed before publishing">
            {publishCheck.errors.map(e => <li key={e}>{e}</li>)}
          </ul>
        )}
        {saveError && <Alert type="error">{saveError}</Alert>}

        <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
          {!published && (
            <button className="btn btn-secondary text-[13px]" disabled={!canSaveDraft || saving} onClick={() => save(false)}>
              Save draft
            </button>
          )}
          <button className="btn btn-primary text-[13px]" disabled={!publishCheck.ok || saving} onClick={() => save(true)}>
            {published ? 'Publish changes' : 'Publish'}
          </button>
          {saving && <span className="text-[12px] text-ink-3 self-center">Saving…</span>}
        </div>
      </Card>
    </div>
  )
}

function FileField({ label, hint, saved, picked, onPick, onUnpick, onRemoveSaved }) {
  const id = `file-${label.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12px] font-semibold text-ink-2">{label}</label>
      <p className="text-[11px] text-ink-3">{hint}</p>
      <input id={id} type="file" multiple accept={ACCEPT} onChange={onPick}
             className="text-[12px] file:mr-2 file:px-3 file:py-1 file:rounded-md file:border file:border-border file:bg-surface file:text-ink-2 file:font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" />
      {(saved.length > 0 || picked.length > 0) && (
        <ul className="text-[12px] flex flex-col gap-1 mt-1">
          {saved.map(f => (
            <li key={f.path} className="flex items-center gap-2">
              <span>📎 {f.name || f.path}</span>
              <button className="text-red-500 hover:underline" aria-label={`Remove ${f.name || f.path}`}
                      onClick={() => onRemoveSaved(f.path)}>Remove</button>
            </li>
          ))}
          {picked.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2">
              <span>⬆ {f.name} <span className="text-ink-3">(not uploaded yet)</span></span>
              <button className="text-red-500 hover:underline" aria-label={`Remove ${f.name}`}
                      onClick={() => onUnpick(i)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Optional per-question marks. Left empty, the grader splits the total as the
// paper's questions go; set, every grade must use exactly these questions.
function QuestionBreakdown({ questions, onChange, locked }) {
  const update = (i, patch) => onChange(questions.map((q, j) => (j === i ? { ...q, ...patch } : q)))
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[12px] font-semibold text-ink-2">Marks per question (optional)</div>
      {questions.length === 0 && (
        <p className="text-[11px] text-ink-3">Leave empty to let the grader split the total by the paper's questions.</p>
      )}
      {questions.map((q, i) => (
        <div key={i} className="flex items-center gap-2">
          <input className="form-input w-28" aria-label={`Question ${i + 1} label`} value={q.label} disabled={locked}
                 onChange={e => update(i, { label: e.target.value })} placeholder={`Q${i + 1}`} />
          <input className="form-input w-24" type="number" min="0.5" step="0.5" aria-label={`Question ${i + 1} marks`}
                 value={q.marks ?? ''} disabled={locked}
                 onChange={e => update(i, { marks: e.target.value === '' ? null : Number(e.target.value) })} />
          {!locked && (
            <button className="text-[12px] text-red-500 hover:underline" aria-label={`Remove question ${i + 1}`}
                    onClick={() => onChange(questions.filter((_, j) => j !== i))}>Remove</button>
          )}
        </div>
      ))}
      {!locked && (
        <button className="text-[12px] font-semibold text-accent hover:underline self-start"
                onClick={() => onChange([...questions, { label: `Q${questions.length + 1}`, marks: null }])}>
          + Add question
        </button>
      )}
    </div>
  )
}
