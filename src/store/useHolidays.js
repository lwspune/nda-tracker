import { useEffect } from 'react'
import useStore from './useStore'
import { useMode } from '../context/ModeContext'

const NONE = []

// The holidays every attendance % skips, loaded on first use for admin and
// teacher sessions. The student portal never reads the table: student-login
// already drops a student's days off from the rows it sends.
export default function useHolidays() {
  const mode = useMode()
  const holidays = useStore(s => s.holidays) || NONE
  const loaded = useStore(s => s.holidaysLoaded)
  const load = useStore(s => s.loadHolidays)
  useEffect(() => {
    if (mode !== 'student' && !loaded && typeof load === 'function') load()
  }, [mode, loaded, load])
  return holidays
}
