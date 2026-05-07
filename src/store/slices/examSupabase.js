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
    created_at: exam.createdAt  ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

export function buildResultRows(exam) {
  return (exam.students || []).map(s => ({
    exam_id:       exam.id,
    student_name:  s.name,
    roll_no:       s.rollNo        ?? '',
    total_marks:   s.totalMarks    ?? 0,
    correct:       s.correct       ?? 0,
    incorrect:     s.incorrect     ?? 0,
    not_attempted: s.notAttempted  ?? 0,
    responses:     s.responses     ?? {},
  }))
}

// Upsert exam row + replace all result rows.
// Used by both addExam (no prior rows) and replaceExam (clears stale rows).
export async function upsertExam(supabase, exam) {
  const { error: examErr } = await supabase
    .from('exams')
    .upsert(buildExamRow(exam), { onConflict: 'id' })
  if (examErr) throw new Error(`exams upsert failed: ${examErr.message}`)

  const { error: delErr } = await supabase
    .from('exam_results')
    .delete()
    .eq('exam_id', exam.id)
  if (delErr) throw new Error(`exam_results delete failed: ${delErr.message}`)

  const resultRows = buildResultRows(exam)
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
