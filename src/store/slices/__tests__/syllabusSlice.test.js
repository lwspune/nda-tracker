import { describe, it, expect, vi } from 'vitest'

// ── Mock the seed data so tests don't pull in the full 522-chapter JS file ──
vi.mock('../../../lib/syllabusSeed', () => ({
  SYLLABUS_SEED: [
    {
      id: 'prog_test',
      name: 'Test Program',
      trackingColumns: ['Lectures', 'Quiz'],
      subjects: [
        {
          id: 'subj_maths',
          name: 'Maths',
          chapters: [
            { id: 'ch_001', name: 'Algebra', group: null },
            { id: 'ch_002', name: 'Geometry', group: null },
          ],
        },
      ],
    },
  ],
}))

// ── Minimal store factory that only uses the syllabus slice ──────────────────
import { createSyllabusSlice, nextStatus, STATUS_CYCLE } from '../syllabusSlice'

function makeStore() {
  let state = {
    syllabusPrograms: [],
    syllabusBatches: [],
    syllabusBatchBranches: {},
    batchProgramAssignments: {},
    batchSyllabusProgress: {},
    batchChapterTimelines: {},
  }
  const saves = []
  let slice
  // Spread only function members from slice so state values in `state` are not shadowed
  const get = () => ({
    ...state,
    _save: () => saves.push('save'),
    ...Object.fromEntries(Object.entries(slice ?? {}).filter(([, v]) => typeof v === 'function')),
  })
  const set = (fn) => { state = { ...state, ...(typeof fn === 'function' ? fn(state) : fn) } }
  slice = createSyllabusSlice(set, get)
  return { get, slice, saves }
}

// ── nextStatus ────────────────────────────────────────────────────────────────
describe('nextStatus', () => {
  it('cycles null → In Progress → Done → null', () => {
    expect(nextStatus(null)).toBe('In Progress')
    expect(nextStatus('In Progress')).toBe('Done')
    expect(nextStatus('Done')).toBe(null)
  })
})

// ── seedSyllabusPrograms ──────────────────────────────────────────────────────
describe('seedSyllabusPrograms', () => {
  it('seeds when programs is empty', () => {
    const { get, slice } = makeStore()
    slice.seedSyllabusPrograms()
    expect(get().syllabusPrograms).toHaveLength(1)
    expect(get().syllabusPrograms[0].id).toBe('prog_test')
  })

  it('does not re-seed when programs already exist', () => {
    const { get, slice } = makeStore()
    slice.seedSyllabusPrograms()
    slice.addProgram('Another', ['Lectures'])
    const countBefore = get().syllabusPrograms.length
    slice.seedSyllabusPrograms()
    expect(get().syllabusPrograms.length).toBe(countBefore)
  })
})

// ── Program CRUD ──────────────────────────────────────────────────────────────
describe('addProgram / updateProgram / deleteProgram', () => {
  it('adds a program', () => {
    const { get, slice } = makeStore()
    const id = slice.addProgram('NDA Program', ['Lectures', 'Quiz'])
    expect(get().syllabusPrograms).toHaveLength(1)
    expect(get().syllabusPrograms[0].id).toBe(id)
    expect(get().syllabusPrograms[0].subjects).toEqual([])
  })

  it('updates program name', () => {
    const { get, slice } = makeStore()
    const id = slice.addProgram('Old Name', ['L'])
    slice.updateProgram(id, { name: 'New Name' })
    expect(get().syllabusPrograms[0].name).toBe('New Name')
  })

  it('deletes program and removes assignments + progress', () => {
    const { get, slice } = makeStore()
    const id = slice.addProgram('P', ['L'])
    slice.setAssignedPrograms('Batch A', [id])
    slice.addSubject(id, 'Science')
    const subjId = get().syllabusPrograms[0].subjects[0].id
    slice.addChapter(id, subjId, 'Ch1')
    const chId = get().syllabusPrograms[0].subjects[0].chapters[0].id
    slice.cycleChapterStatus('Batch A', id, subjId, chId, 'L')

    slice.deleteProgram(id)
    expect(get().syllabusPrograms).toHaveLength(0)
    expect(get().batchProgramAssignments['Batch A']).toHaveLength(0)
    expect(get().batchSyllabusProgress?.['Batch A']?.[id]).toBeUndefined()
  })
})

// ── Subject CRUD ──────────────────────────────────────────────────────────────
describe('addSubject / updateSubject / deleteSubject', () => {
  it('adds a subject to a program', () => {
    const { get, slice } = makeStore()
    const progId = slice.addProgram('P', ['L'])
    const subjId = slice.addSubject(progId, 'Maths')
    const prog = get().syllabusPrograms[0]
    expect(prog.subjects).toHaveLength(1)
    expect(prog.subjects[0].id).toBe(subjId)
    expect(prog.subjects[0].chapters).toEqual([])
  })

  it('renames a subject', () => {
    const { get, slice } = makeStore()
    const progId = slice.addProgram('P', ['L'])
    const subjId = slice.addSubject(progId, 'Old')
    slice.updateSubject(progId, subjId, { name: 'New' })
    expect(get().syllabusPrograms[0].subjects[0].name).toBe('New')
  })

  it('deletes subject and clears its progress', () => {
    const { get, slice } = makeStore()
    const progId = slice.addProgram('P', ['L'])
    const subjId = slice.addSubject(progId, 'S')
    const chId   = slice.addChapter(progId, subjId, 'Ch')
    slice.cycleChapterStatus('B', progId, subjId, chId, 'L')
    expect(get().batchSyllabusProgress?.B?.[progId]?.[subjId]).toBeDefined()

    slice.deleteSubject(progId, subjId)
    expect(get().syllabusPrograms[0].subjects).toHaveLength(0)
    expect(get().batchSyllabusProgress?.B?.[progId]?.[subjId]).toBeUndefined()
  })
})

// ── Chapter CRUD ──────────────────────────────────────────────────────────────
describe('addChapter / updateChapter / deleteChapter / reorderChapters', () => {
  it('adds a chapter with group', () => {
    const { get, slice } = makeStore()
    const progId = slice.addProgram('P', ['L'])
    const subjId = slice.addSubject(progId, 'S')
    slice.addChapter(progId, subjId, 'Motion', 'Physics')
    const ch = get().syllabusPrograms[0].subjects[0].chapters[0]
    expect(ch.name).toBe('Motion')
    expect(ch.group).toBe('Physics')
  })

  it('updates chapter name and group', () => {
    const { get, slice } = makeStore()
    const progId = slice.addProgram('P', ['L'])
    const subjId = slice.addSubject(progId, 'S')
    const chId   = slice.addChapter(progId, subjId, 'Old')
    slice.updateChapter(progId, subjId, chId, { name: 'New', group: 'G2' })
    const ch = get().syllabusPrograms[0].subjects[0].chapters[0]
    expect(ch.name).toBe('New')
    expect(ch.group).toBe('G2')
  })

  it('deletes chapter and removes its progress entries', () => {
    const { get, slice } = makeStore()
    const progId = slice.addProgram('P', ['L'])
    const subjId = slice.addSubject(progId, 'S')
    const chId   = slice.addChapter(progId, subjId, 'Ch')
    slice.cycleChapterStatus('B', progId, subjId, chId, 'L')

    slice.deleteChapter(progId, subjId, chId)
    expect(get().syllabusPrograms[0].subjects[0].chapters).toHaveLength(0)
    expect(get().batchSyllabusProgress?.B?.[progId]?.[subjId]?.[chId]).toBeUndefined()
  })

  it('reorders chapters', () => {
    const { get, slice } = makeStore()
    const progId = slice.addProgram('P', ['L'])
    const subjId = slice.addSubject(progId, 'S')
    const id1    = slice.addChapter(progId, subjId, 'A')
    const id2    = slice.addChapter(progId, subjId, 'B')
    slice.reorderChapters(progId, subjId, [id2, id1])
    const names = get().syllabusPrograms[0].subjects[0].chapters.map(c => c.name)
    expect(names).toEqual(['B', 'A'])
  })
})

// ── Tracking columns ──────────────────────────────────────────────────────────
describe('tracking column operations', () => {
  it('adds a column', () => {
    const { get, slice } = makeStore()
    const id = slice.addProgram('P', ['Lectures'])
    slice.addTrackingColumn(id, 'Quiz')
    expect(get().syllabusPrograms[0].trackingColumns).toEqual(['Lectures', 'Quiz'])
  })

  it('renames a column and migrates progress keys', () => {
    const { get, slice } = makeStore()
    const progId = slice.addProgram('P', ['Lectures'])
    const subjId = slice.addSubject(progId, 'S')
    const chId   = slice.addChapter(progId, subjId, 'Ch')
    slice.cycleChapterStatus('B', progId, subjId, chId, 'Lectures')
    expect(get().batchSyllabusProgress.B[progId][subjId][chId].Lectures).toBe('In Progress')

    slice.renameTrackingColumn(progId, 'Lectures', 'Class')
    expect(get().syllabusPrograms[0].trackingColumns).toEqual(['Class'])
    expect(get().batchSyllabusProgress.B[progId][subjId][chId].Class).toBe('In Progress')
    expect(get().batchSyllabusProgress.B[progId][subjId][chId].Lectures).toBeUndefined()
  })

  it('deletes a column and removes its progress keys', () => {
    const { get, slice } = makeStore()
    const progId = slice.addProgram('P', ['Lectures', 'Quiz'])
    const subjId = slice.addSubject(progId, 'S')
    const chId   = slice.addChapter(progId, subjId, 'Ch')
    slice.cycleChapterStatus('B', progId, subjId, chId, 'Quiz')

    slice.deleteTrackingColumn(progId, 'Quiz')
    expect(get().syllabusPrograms[0].trackingColumns).toEqual(['Lectures'])
    expect(get().batchSyllabusProgress.B[progId][subjId][chId].Quiz).toBeUndefined()
  })
})

// ── Progress ──────────────────────────────────────────────────────────────────
describe('cycleChapterStatus / getChapterStatus / getSubjectProgress', () => {
  it('cycles status through null → In Progress → Done → null', () => {
    const { slice } = makeStore()
    const progId = slice.addProgram('P', ['Lectures'])
    const subjId = slice.addSubject(progId, 'S')
    const chId   = slice.addChapter(progId, subjId, 'Ch')

    expect(slice.getChapterStatus('B', progId, subjId, chId, 'Lectures')).toBeNull()
    slice.cycleChapterStatus('B', progId, subjId, chId, 'Lectures')
    expect(slice.getChapterStatus('B', progId, subjId, chId, 'Lectures')).toBe('In Progress')
    slice.cycleChapterStatus('B', progId, subjId, chId, 'Lectures')
    expect(slice.getChapterStatus('B', progId, subjId, chId, 'Lectures')).toBe('Done')
    slice.cycleChapterStatus('B', progId, subjId, chId, 'Lectures')
    expect(slice.getChapterStatus('B', progId, subjId, chId, 'Lectures')).toBeNull()
  })

  it('getSubjectProgress counts correctly', () => {
    const { slice } = makeStore()
    const progId = slice.addProgram('P', ['Lectures'])
    const subjId = slice.addSubject(progId, 'S')
    const ch1    = slice.addChapter(progId, subjId, 'Ch1')
    const ch2    = slice.addChapter(progId, subjId, 'Ch2')
    slice.addChapter(progId, subjId, 'Ch3')

    slice.cycleChapterStatus('B', progId, subjId, ch1, 'Lectures') // → In Progress
    slice.cycleChapterStatus('B', progId, subjId, ch1, 'Lectures') // → Done
    slice.cycleChapterStatus('B', progId, subjId, ch2, 'Lectures') // → In Progress

    const { done, inProgress, total } = slice.getSubjectProgress('B', progId, subjId)
    expect(total).toBe(3)
    expect(done).toBe(1)
    expect(inProgress).toBe(1)
  })

  it('progress is isolated per batch', () => {
    const { slice } = makeStore()
    const progId = slice.addProgram('P', ['Lectures'])
    const subjId = slice.addSubject(progId, 'S')
    const chId   = slice.addChapter(progId, subjId, 'Ch')

    slice.cycleChapterStatus('Batch A', progId, subjId, chId, 'Lectures')
    expect(slice.getChapterStatus('Batch A', progId, subjId, chId, 'Lectures')).toBe('In Progress')
    expect(slice.getChapterStatus('Batch B', progId, subjId, chId, 'Lectures')).toBeNull()
  })
})

// ── Syllabus batch management ─────────────────────────────────────────────────
describe('addSyllabusBatch', () => {
  it('adds a new batch name', () => {
    const { get, slice } = makeStore()
    slice.addSyllabusBatch('LWS 2Y 25-27')
    expect(get().syllabusBatches).toEqual(['LWS 2Y 25-27'])
  })

  it('trims whitespace', () => {
    const { get, slice } = makeStore()
    slice.addSyllabusBatch('  Batch A  ')
    expect(get().syllabusBatches).toEqual(['Batch A'])
  })

  it('ignores duplicate names', () => {
    const { get, slice } = makeStore()
    slice.addSyllabusBatch('Batch A')
    slice.addSyllabusBatch('Batch A')
    expect(get().syllabusBatches).toHaveLength(1)
  })

  it('ignores empty string', () => {
    const { get, slice } = makeStore()
    slice.addSyllabusBatch('   ')
    expect(get().syllabusBatches).toHaveLength(0)
  })
})

describe('renameSyllabusBatch', () => {
  it('renames a batch in the list', () => {
    const { get, slice } = makeStore()
    slice.addSyllabusBatch('Old Name')
    slice.renameSyllabusBatch('Old Name', 'New Name')
    expect(get().syllabusBatches).toEqual(['New Name'])
  })

  it('cascades rename to batchProgramAssignments', () => {
    const { get, slice } = makeStore()
    const id = slice.addProgram('P', ['L'])
    slice.addSyllabusBatch('Old')
    slice.setAssignedPrograms('Old', [id])
    slice.renameSyllabusBatch('Old', 'New')
    expect(get().batchProgramAssignments['New']).toEqual([id])
    expect(get().batchProgramAssignments['Old']).toBeUndefined()
  })

  it('cascades rename to batchSyllabusProgress', () => {
    const { get, slice } = makeStore()
    const progId = slice.addProgram('P', ['L'])
    const subjId = slice.addSubject(progId, 'S')
    const chId   = slice.addChapter(progId, subjId, 'Ch')
    slice.addSyllabusBatch('Old')
    slice.cycleChapterStatus('Old', progId, subjId, chId, 'L')
    slice.renameSyllabusBatch('Old', 'New')
    expect(get().batchSyllabusProgress['New']).toBeDefined()
    expect(get().batchSyllabusProgress['Old']).toBeUndefined()
  })

  it('does not rename if new name already exists', () => {
    const { get, slice } = makeStore()
    slice.addSyllabusBatch('Alpha')
    slice.addSyllabusBatch('Beta')
    slice.renameSyllabusBatch('Alpha', 'Beta')
    expect(get().syllabusBatches).toEqual(['Alpha', 'Beta'])
  })

  it('does nothing if old name not in list', () => {
    const { get, slice } = makeStore()
    slice.addSyllabusBatch('Alpha')
    slice.renameSyllabusBatch('Ghost', 'New')
    expect(get().syllabusBatches).toEqual(['Alpha'])
  })
})

describe('deleteSyllabusBatch', () => {
  it('removes batch from list', () => {
    const { get, slice } = makeStore()
    slice.addSyllabusBatch('A')
    slice.addSyllabusBatch('B')
    slice.deleteSyllabusBatch('A')
    expect(get().syllabusBatches).toEqual(['B'])
  })

  it('removes batch assignments', () => {
    const { get, slice } = makeStore()
    const id = slice.addProgram('P', ['L'])
    slice.addSyllabusBatch('A')
    slice.setAssignedPrograms('A', [id])
    slice.deleteSyllabusBatch('A')
    expect(get().batchProgramAssignments['A']).toBeUndefined()
  })

  it('removes batch progress', () => {
    const { get, slice } = makeStore()
    const progId = slice.addProgram('P', ['L'])
    const subjId = slice.addSubject(progId, 'S')
    const chId   = slice.addChapter(progId, subjId, 'Ch')
    slice.addSyllabusBatch('A')
    slice.cycleChapterStatus('A', progId, subjId, chId, 'L')
    slice.deleteSyllabusBatch('A')
    expect(get().batchSyllabusProgress['A']).toBeUndefined()
  })

  it('is a no-op for a name not in the list', () => {
    const { get, slice } = makeStore()
    slice.addSyllabusBatch('A')
    slice.deleteSyllabusBatch('Ghost')
    expect(get().syllabusBatches).toEqual(['A'])
  })
})

// ── Batch assignments ─────────────────────────────────────────────────────────
describe('setAssignedPrograms', () => {
  it('assigns programs to a batch', () => {
    const { get, slice } = makeStore()
    const id1 = slice.addProgram('P1', ['L'])
    const id2 = slice.addProgram('P2', ['L'])
    slice.setAssignedPrograms('Batch A', [id1, id2])
    expect(get().batchProgramAssignments['Batch A']).toEqual([id1, id2])
  })

  it('replaces existing assignment', () => {
    const { get, slice } = makeStore()
    const id1 = slice.addProgram('P1', ['L'])
    const id2 = slice.addProgram('P2', ['L'])
    slice.setAssignedPrograms('Batch A', [id1, id2])
    slice.setAssignedPrograms('Batch A', [id2])
    expect(get().batchProgramAssignments['Batch A']).toEqual([id2])
  })
})
