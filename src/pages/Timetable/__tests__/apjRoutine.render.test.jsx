import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import TimetableGrid from '../TimetableGrid'
import fixture from './fixtures.apjRoutine.json'

// Renders the ACTUAL migrated production timetables through the real grid
// component. The fixture was captured from Supabase after
// migrate_timetable_routine.js ran; teacher contact details are scrubbed from
// it (names only — those are what the grid renders).
//
// The migration was verified by SQL, but SQL cannot say whether the grid
// renders it — a malformed cell, a mapping id pointing at nothing, or a slot
// the time parser rejects would all pass a data check and still break the page.
// This is that check.

const { timetables, mappings, teachers } = fixture
const byBatch = Object.fromEntries(timetables.map(t => [t.batchName, t]))
const BATCHES = Object.keys(byBatch)

const renderGrid = (batchName) =>
  render(<TimetableGrid timetable={byBatch[batchName]} mappings={mappings} teachers={teachers} readOnly />)

describe('APJ routine grids render', () => {
  it.each(BATCHES)('%s renders all 18 rows without crashing', (batchName) => {
    const { container } = renderGrid(batchName)
    // header row + 18 slot rows
    expect(container.querySelectorAll('tbody tr')).toHaveLength(18)
  })

  it.each(BATCHES)('%s shows the new routine labels', (batchName) => {
    renderGrid(batchName)
    for (const label of ['Wake Up', 'Physical Training', 'Freshen Up', 'Breakfast', 'Lunch',
      'Rest', 'Tea Time', 'Dinner', 'Phone Call', 'Rounds', 'Lights Out & Sleep']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
  })

  it.each(BATCHES)('%s varies the 4:30 PM club row across the week', (batchName) => {
    renderGrid(batchName)
    // Parade is Wednesday-only; Personality Classes is Saturday.
    expect(screen.getAllByText('Parade')).toHaveLength(1)
    expect(screen.getAllByText('Games')).toHaveLength(2)      // Tue + Fri
    expect(screen.getAllByText('Clubs')).toHaveLength(2)      // Mon + Thu
  })

  it.each(BATCHES)('%s has no leftover teaching in the 4:00 PM Rest row', (batchName) => {
    renderGrid(batchName)
    const restCells = screen.getAllByText('Rest')
    expect(restCells).toHaveLength(6)   // cleared on every day, no subject survives
  })

  // A cell pointing at a deleted mapping renders blank — that would look like an
  // untaught period rather than an error, so assert every class cell resolves.
  it.each(BATCHES)('%s has no class cell pointing at a missing mapping', (batchName) => {
    const tt = byBatch[batchName]
    const known = new Set(mappings.map(m => m.id))
    const dangling = []
    for (const [slotId, row] of Object.entries(tt.grid)) {
      for (const [day, cell] of Object.entries(row)) {
        if (cell?.type === 'class' && !known.has(cell.mappingId)) dangling.push(`${slotId}/${day}`)
      }
    }
    expect(dangling).toEqual([])
  })

  it.each(BATCHES)('%s slot times all parse, so rows sort by clock', (batchName) => {
    const { container } = renderGrid(batchName)
    const firstCol = [...container.querySelectorAll('tbody tr')]
      .map(tr => within(tr).getAllByRole('cell')[0].textContent)
    // A time the parser rejects sorts to 0 and jumps to the top; Wake Up must lead.
    expect(firstCol[0]).toMatch(/6:30 AM/)
    expect(firstCol.at(-1)).toMatch(/11:30 PM/)
  })
})
