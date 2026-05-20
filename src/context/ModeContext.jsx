/**
 * ModeContext — propagates the current runtime mode throughout the tree.
 *
 * Three possible modes:
 *   'admin'    — localhost dev OR online admin (Supabase session without role metadata).
 *                Full read-write access.
 *   'teacher'  — Supabase session with user_metadata.role === 'teacher'.
 *                All pages visible, no mutation UI.
 *   'student'  — Mobile-number login via /api/student-login. Own data only.
 *
 * Usage:
 *   const mode = useMode()         // 'admin' | 'teacher' | 'student'
 *   const isAdmin = useMode() === 'admin'
 */

import { createContext, useContext } from 'react'

export const ModeContext = createContext('admin')

/**
 * Returns the current mode string.
 * Must be used inside a <ModeContext.Provider>.
 */
export function useMode() {
  return useContext(ModeContext)
}
