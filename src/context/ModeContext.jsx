/**
 * ModeContext — propagates the current runtime mode throughout the tree.
 *
 * Three possible modes:
 *   'faculty'  — localhost / LAN dev server, full read-write access
 *   'teacher'  — GitHub Pages, authenticated with teacher password, all pages visible
 *   'student'  — GitHub Pages, authenticated with mobile number, own data only
 *
 * Usage:
 *   const mode = useMode()         // 'faculty' | 'teacher' | 'student'
 *   const isFaculty = useMode() === 'faculty'
 */

import { createContext, useContext } from 'react'

export const ModeContext = createContext('faculty')

/**
 * Returns the current mode string.
 * Must be used inside a <ModeContext.Provider>.
 */
export function useMode() {
  return useContext(ModeContext)
}
