import { supabase } from '../../lib/supabase'
import { getSession } from './session'
import { ASSIGNMENT_FILES_BUCKET } from '../../lib/assignments/upload'
import {
  planFileUploads, buildAssignmentRow, mapAssignmentRow, mapSubmissionRow,
} from '../../lib/assignments/editor'

// Homework assignments (2026-10-12): teacher-set homework with a question paper,
// a deadline and batches; students upload answers from the portal.
//
// SESSION-ONLY. Unlike the dual-path slices there is no dev-disk branch: the
// files live in Supabase Storage, which needs a signed-in session, so in local
// dev this feature is simply unavailable. Nothing here touches faculty_state —
// never call `_save()` (a teacher's save would round-trip the admin blob) and
// never add these keys to persist.js's allow-list.
//
// Writes are guarded by RLS (a teacher writes only rows they created) and the
// storage policy (a file only for an assignment that already exists, and only
// the creator's). Submissions and grades are read-only here; they are written
// by the student endpoint and the grading scripts — except a grade HELD for a
// handwriting check, which staff release or send back through the
// homework_held_resolve function (it checks who is asking).
export const createHomeworkAssignmentSlice = (set, _get) => ({
  homeworkAssignments: [],
  homeworkAssignmentsLoaded: false,

  async loadHomeworkAssignments() {
    const session = await getSession()
    if (!session) { set({ homeworkAssignments: [], homeworkAssignmentsLoaded: true }); return }
    const { data, error } = await supabase
      .from('homework_assignments')
      .select('*')
      .order('due_at', { ascending: false })
    if (error) { console.error('[homework] load failed:', error); set({ homeworkAssignmentsLoaded: true }); return }
    set({ homeworkAssignments: (data ?? []).map(mapAssignmentRow), homeworkAssignmentsLoaded: true })
  },

  // Save (and optionally publish) an assignment with any newly picked files.
  // A new assignment is written as a draft FIRST: the storage policy admits a
  // file only for an assignment row that exists. Then the files go up, then the
  // row is updated with the file list — and published, if asked. A failure
  // part-way leaves a draft, never a published assignment missing its paper.
  //
  // → { ok: true, assignment } | { ok: false, error, assignment? }
  async saveHomeworkAssignment(draft, { questionFiles = [], keyFiles = [], publish = false } = {}) {
    const session = await getSession()
    const email = session?.user?.email
    if (!email) return { ok: false, error: 'Sign in to the online app to set homework.' }

    const id = draft.id ?? crypto.randomUUID()
    const base = { ...draft, id, createdBy: draft.id ? draft.createdBy : email }

    const q = planFileUploads(id, 'question', base.questionFiles.length, questionFiles)
    if (!q.ok) return { ok: false, error: q.error }
    const k = planFileUploads(id, 'key', base.answerKeyFiles.length, keyFiles)
    if (!k.ok) return { ok: false, error: k.error }
    const uploads = [...q.uploads, ...k.uploads]

    const write = async a => {
      const { data, error } = await supabase
        .from('homework_assignments')
        .upsert(buildAssignmentRow(a), { onConflict: 'id' })
        .select()
        .single()
      if (error) throw new Error(error.message)
      return mapAssignmentRow(data)
    }
    const remember = a => set(s => ({
      homeworkAssignments: [a, ...s.homeworkAssignments.filter(x => x.id !== a.id)],
    }))

    let saved = null
    try {
      if (!draft.id && uploads.length > 0) {
        saved = await write({ ...base, status: 'draft' })
        remember(saved)
      }
      for (const u of uploads) {
        const { error } = await supabase.storage
          .from(ASSIGNMENT_FILES_BUCKET)
          .upload(u.path, u.file, { contentType: u.meta.type, upsert: false })
        if (error) throw new Error(`Could not upload ${u.meta.name}: ${error.message}`)
      }
      const final = await write({
        ...base,
        questionFiles: [...base.questionFiles, ...q.uploads.map(u => u.meta)],
        answerKeyFiles: [...base.answerKeyFiles, ...k.uploads.map(u => u.meta)],
        status: publish ? 'published' : base.status,
      })
      remember(final)
      return { ok: true, assignment: final }
    } catch (e) {
      console.error('[homework] save failed:', e)
      return { ok: false, error: e.message, assignment: saved }
    }
  },

  // Remove one question/key file from an assignment (wrong file picked).
  async removeHomeworkFile(assignment, kind, path) {
    const field = kind === 'key' ? 'answerKeyFiles' : 'questionFiles'
    const next = { ...assignment, [field]: assignment[field].filter(f => f.path !== path) }
    const { data, error } = await supabase
      .from('homework_assignments')
      .upsert(buildAssignmentRow(next), { onConflict: 'id' })
      .select()
      .single()
    if (error) { console.error('[homework] remove file failed:', error); return { ok: false, error: error.message } }
    const { error: rmErr } = await supabase.storage.from(ASSIGNMENT_FILES_BUCKET).remove([path])
    if (rmErr) console.error('[homework] storage remove failed:', rmErr)
    const saved = mapAssignmentRow(data)
    set(s => ({ homeworkAssignments: s.homeworkAssignments.map(a => (a.id === saved.id ? saved : a)) }))
    return { ok: true, assignment: saved }
  },

  // Row first: the database refuses to delete homework that has submissions
  // (ON DELETE RESTRICT), and then the question paper must stay with it.
  async deleteHomeworkAssignment(assignment) {
    const { error } = await supabase.from('homework_assignments').delete().eq('id', assignment.id)
    if (error) {
      console.error('[homework] delete failed:', error)
      const submitted = /foreign key/i.test(error.message ?? '')
      return {
        ok: false,
        error: submitted ? 'Students have already submitted this homework, so it cannot be deleted.' : error.message,
      }
    }
    const paths = [...(assignment.questionFiles ?? []), ...(assignment.answerKeyFiles ?? [])].map(f => f.path)
    if (paths.length) {
      const { error: rmErr } = await supabase.storage.from(ASSIGNMENT_FILES_BUCKET).remove(paths)
      if (rmErr) console.error('[homework] storage cleanup failed:', rmErr)
    }
    set(s => ({ homeworkAssignments: s.homeworkAssignments.filter(a => a.id !== assignment.id) }))
    return { ok: true }
  },

  // Every submission (with its grades) for one assignment.
  async getHomeworkSubmissions(assignmentId) {
    const { data, error } = await supabase
      .from('homework_submissions')
      .select('*, homework_grades(*)')
      .eq('assignment_id', assignmentId)
    if (error) { console.error('[homework] submissions read failed:', error); return null }
    return (data ?? []).map(mapSubmissionRow)
  },

  // Light status rows for the list's counts: { assignmentId, lwsId, status }.
  async getHomeworkSubmissionStatuses() {
    const { data, error } = await supabase
      .from('homework_submissions')
      .select('assignment_id, lws_id, status')
    if (error) { console.error('[homework] status read failed:', error); return null }
    return (data ?? []).map(r => ({ assignmentId: r.assignment_id, lwsId: r.lws_id, status: r.status }))
  },

  // A student's handwriting reference — their first graded homework — for
  // comparing beside a held one. null when there is none (or the read failed).
  async getHomeworkReferenceFiles(lwsId) {
    const { data, error } = await supabase
      .from('homework_hand_references')
      .select('submission_id, homework_submissions(files, scans_deleted_at)')
      .eq('lws_id', lwsId)
      .maybeSingle()
    if (error) { console.error('[homework] reference read failed:', error); return null }
    if (!data) return null
    return {
      submissionId: data.submission_id,
      files: data.homework_submissions?.files ?? [],
      scansDeletedAt: data.homework_submissions?.scans_deleted_at ?? null,
    }
  },

  // Release a grade held for a handwriting check, or send it back with a
  // reason. The database function checks who is asking (a teacher only on
  // homework they set) and passes its refusal back as the error.
  async resolveHeldHomework(submissionId, action, reason) {
    const { error } = await supabase.rpc('homework_held_resolve', {
      p_submission: submissionId,
      p_action: action,
      p_reason: reason?.trim() || null,
    })
    if (error) {
      console.error('[homework] resolve held grade failed:', error)
      return { ok: false, error: error.message || 'Could not save. Try again.' }
    }
    return { ok: true }
  },

  // A 10-minute link to a private file, for viewing in a new tab.
  async getHomeworkFileUrl(bucket, path) {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 600)
    if (error) { console.error('[homework] sign url failed:', error); return null }
    return data?.signedUrl ?? null
  },
})
