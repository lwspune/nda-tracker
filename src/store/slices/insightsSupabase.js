// Supabase mutation helpers for insights (class reports + student plans).
// Each function takes an authenticated supabase client.
// Inserts only — history is preserved by never updating in place.

export async function insertClassReport(supabase, { text, examId = null, generatedAt = null, generatedBy = null }) {
  const row = {
    text,
    exam_id: examId,
    generated_by: generatedBy,
    ...(generatedAt ? { generated_at: generatedAt } : {}),
  }
  const { error } = await supabase.from('class_reports').insert(row)
  if (error) throw new Error(`class_reports insert failed: ${error.message}`)
}

export async function insertStudentPlan(supabase, { studentName, text, lwsId = null, generatedAt = null, generatedBy = null }) {
  const row = {
    student_name: studentName,
    text,
    lws_id: lwsId,
    generated_by: generatedBy,
    ...(generatedAt ? { generated_at: generatedAt } : {}),
  }
  const { error } = await supabase.from('student_plans').insert(row)
  if (error) throw new Error(`student_plans insert failed: ${error.message}`)
}

// Delete every class_report row — used when the UI's "clear" action fires.
export async function deleteAllClassReports(supabase) {
  const { error } = await supabase.from('class_reports').delete().not('id', 'is', null)
  if (error) throw new Error(`class_reports delete failed: ${error.message}`)
}

// Delete every plan row for one student_name — used when the UI's per-student clear fires.
export async function deleteStudentPlansByName(supabase, studentName) {
  const { error } = await supabase.from('student_plans').delete().eq('student_name', studentName)
  if (error) throw new Error(`student_plans delete failed: ${error.message}`)
}
