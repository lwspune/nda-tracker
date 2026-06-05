// Supabase mutation helpers for quiz data.
// Mirrors examSupabase.js — exported so they can be unit-tested independently
// of the slice. Quizzes live in their own `quizzes` table (NOT faculty_state).
import { DEFAULT_MARKING } from '../../lib/quiz'

export function buildQuizRow(quiz) {
  return {
    id:         quiz.id,
    title:      quiz.title,
    subject:    quiz.subject   || null,
    batch:      quiz.batch     || null,
    branch:     quiz.branch    || null,
    marking:    quiz.marking   ?? DEFAULT_MARKING,
    questions:  quiz.questions ?? [],
    opens_at:   quiz.opensAt   ?? null,
    closes_at:  quiz.closesAt  ?? null,
    status:     quiz.status    ?? 'draft',
    created_by: quiz.createdBy ?? null,
    created_at: quiz.createdAt ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

export async function upsertQuiz(supabase, quiz) {
  const { error } = await supabase
    .from('quizzes')
    .upsert(buildQuizRow(quiz), { onConflict: 'id' })
  if (error) throw new Error(`quizzes upsert failed: ${error.message}`)
}

export async function deleteQuizById(supabase, id) {
  const { error } = await supabase.from('quizzes').delete().eq('id', id)
  if (error) throw new Error(`quizzes delete failed: ${error.message}`)
}
