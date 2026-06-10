// Supabase mutation helpers for exam data.
// Each function takes an authenticated supabase client and the relevant data.
// Exported so they can be unit-tested independently of the slice.

export function buildExamRow(exam) {
  return {
    id:         exam.id,
    name:       exam.name,
    date:       exam.date,
    subject:    exam.subject    || null,
    batch:      exam.batch      || null,
    branch:     exam.branch     || null,
    marking:    exam.marking    ?? { correct: 4, wrong: -1 },
    questions:  exam.questions  ?? [],
    // Explicit paper ceiling for offline exams (no questions[]); null for MCQ
    // exams whose max derives from questions.length × marking.correct.
    max_marks:  exam.maxMarks   ?? null,
    created_at: exam.createdAt  ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

// `studentProfiles` (the canonical+variant-keyed map) lets us snapshot each
// student's CURRENT batch/branch onto the result row at upload time — see
// `batch_at_exam`/`branch_at_exam` in DATABASE_SCHEMA. The snapshot is frozen
// (a later move doesn't rewrite it); null when the student has no matched profile.
export function buildResultRows(exam, studentProfiles = {}) {
  return (exam.students || []).map(s => {
    const p = studentProfiles[s.name]  // map is keyed by canonical name AND every variant
    return {
      exam_id:        exam.id,
      student_name:   s.name,
      roll_no:        s.rollNo        ?? '',
      total_marks:    s.totalMarks    ?? 0,
      correct:        s.correct       ?? 0,
      incorrect:      s.incorrect     ?? 0,
      not_attempted:  s.notAttempted  ?? 0,
      responses:      s.responses     ?? {},
      // Captured chosen letters ({qn: 'A'|null}) — additive, for re-grading a
      // corrected key later; {} for older uploads that predate capture.
      choices:        s.choices       ?? {},
      batch_at_exam:  p ? ((p.batches || []).join(', ') || null) : null,
      branch_at_exam: p ? (p.branch || null) : null,
    }
  })
}

// Upsert exam row + replace all result rows.
// Used by both addExam (no prior rows) and replaceExam (clears stale rows).
// `studentProfiles` is threaded through so each result row snapshots the
// student's current batch/branch at upload time (re-upload re-snapshots).
export async function upsertExam(supabase, exam, studentProfiles = {}) {
  const { error: examErr } = await supabase
    .from('exams')
    .upsert(buildExamRow(exam), { onConflict: 'id' })
  if (examErr) throw new Error(`exams upsert failed: ${examErr.message}`)

  const { error: delErr } = await supabase
    .from('exam_results')
    .delete()
    .eq('exam_id', exam.id)
  if (delErr) throw new Error(`exam_results delete failed: ${delErr.message}`)

  const resultRows = buildResultRows(exam, studentProfiles)
  if (resultRows.length > 0) {
    const { error: insErr } = await supabase.from('exam_results').insert(resultRows)
    if (insErr) throw new Error(`exam_results insert failed: ${insErr.message}`)
  }
}

// Delete exam row by id. ON DELETE CASCADE removes exam_results automatically.
export async function deleteExamById(supabase, id) {
  const { error } = await supabase.from('exams').delete().eq('id', id)
  if (error) throw new Error(`exams delete failed: ${error.message}`)
}

// Update only the questions JSONB column on an exam row.
export async function updateExamQuestions(supabase, examId, questions) {
  const { error } = await supabase
    .from('exams')
    .update({ questions, updated_at: new Date().toISOString() })
    .eq('id', examId)
  if (error) throw new Error(`exam questions update failed: ${error.message}`)
}
