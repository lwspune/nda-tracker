import useStore from '../../store/useStore'
// FrequencyTableEditor still lives under pages/Dashboard (its original home); the
// Dashboard no longer renders it — NDA chapter weightage is configuration, so it
// belongs in Settings alongside branches/batches/teachers.
import FrequencyTableEditor from '../Dashboard/FrequencyTableEditor'

export default function NdaWeightageTab() {
  const exams                = useStore(s => s.exams)
  const ndaFreqBySubject     = useStore(s => s.ndaFreqBySubject)
  const setNdaFreq           = useStore(s => s.setNdaFreq)
  const resetNdaFreq         = useStore(s => s.resetNdaFreq)
  const ndaMarksBySubject    = useStore(s => s.ndaMarksBySubject)
  const setSubjectTotalMarks = useStore(s => s.setSubjectTotalMarks)

  return (
    <FrequencyTableEditor
      exams={exams}
      ndaFreqBySubject={ndaFreqBySubject}
      setNdaFreq={setNdaFreq}
      resetNdaFreq={resetNdaFreq}
      ndaMarksBySubject={ndaMarksBySubject}
      setSubjectTotalMarks={setSubjectTotalMarks}
    />
  )
}
