import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('xlsx', () => ({
  read: vi.fn(),
  utils: { sheet_to_json: vi.fn() },
}))

import * as XLSX from 'xlsx'
import { parseAttendanceExcel } from '../excel'

// Minimal fake file — arrayBuffer just needs to resolve
function makeFile() {
  return { arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }
}

// Build a raw sheet array matching the LWS attendance export format:
// row 0 = title, row 1 = headers, rows 2+ = data
function makeRaw(dataRows = []) {
  const headers = [
    'Sr. No.', 'Enquiry No.', 'Reg No.', 'Student Name', 'Mobile No.',
    'Guardian No.', 'Total P', 'Total A', 'Total L', 'Avg P (%)',
    '07-05-2026', '06-05-2026', '05-05-2026',
  ]
  return [
    ['11&12th Integrated 2-Year (25-27) - A Batch_Attendance_list07May2026'],
    headers,
    ...dataRows,
  ]
}

function setupMock(raw) {
  const ws = {}
  XLSX.read.mockReturnValue({ SheetNames: ['Sheet1'], Sheets: { Sheet1: ws } })
  XLSX.utils.sheet_to_json.mockReturnValue(raw)
}

describe('parseAttendanceExcel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns students with P/A dates converted to YYYY-MM-DD', async () => {
    setupMock(makeRaw([
      [1, 'ENQ001', 'REG001', 'Arjun Sharma', '9876543210', '', 2, 1, 0, '66.67', 'P', 'A', 'P'],
    ]))
    const result = await parseAttendanceExcel(makeFile())
    expect(result.students).toHaveLength(1)
    expect(result.students[0]).toEqual({
      name: 'Arjun Sharma',
      mobile: '9876543210',
      dates: {
        '2026-05-07': 'P',
        '2026-05-06': 'A',
        '2026-05-05': 'P',
      },
    })
  })

  it('skips dash values — no entry added for "-"', async () => {
    setupMock(makeRaw([
      [1, '', '', 'Ravi Kumar', '9123456780', '', 0, 0, 0, '', '-', '-', 'P'],
    ]))
    const { students } = await parseAttendanceExcel(makeFile())
    expect(students[0].dates).toEqual({ '2026-05-05': 'P' })
  })

  it('skips rows with empty Student Name', async () => {
    setupMock(makeRaw([
      [1, '', '', 'Arjun Sharma', '9876543210', '', 1, 0, 0, '100', 'P', '-', '-'],
      [2, '', '', '',              '',            '', 0, 0, 0, '',    '-', '-', '-'],
      [3, '', '', '   ',           '',            '', 0, 0, 0, '',    '-', '-', '-'],
    ]))
    const { students } = await parseAttendanceExcel(makeFile())
    expect(students).toHaveLength(1)
    expect(students[0].name).toBe('Arjun Sharma')
  })

  it('returns empty dates for a student with all dashes', async () => {
    setupMock(makeRaw([
      [1, '', '', 'Soham Deshmukh', '9000000001', '', 0, 0, 0, '', '-', '-', '-'],
    ]))
    const { students } = await parseAttendanceExcel(makeFile())
    expect(students[0].dates).toEqual({})
  })

  it('returns mobile as-is from the file', async () => {
    setupMock(makeRaw([
      [1, '', '', 'Test Student', '07890123456', '', 1, 0, 0, '100', 'P', '-', '-'],
    ]))
    const { students } = await parseAttendanceExcel(makeFile())
    expect(students[0].mobile).toBe('07890123456')
  })

  it('handles multiple students correctly', async () => {
    setupMock(makeRaw([
      [1, '', '', 'Alice', '9000000001', '', 2, 0, 0, '100', 'P', 'P', '-'],
      [2, '', '', 'Bob',   '9000000002', '', 0, 2, 0, '0',   'A', 'A', '-'],
    ]))
    const { students } = await parseAttendanceExcel(makeFile())
    expect(students).toHaveLength(2)
    expect(students[0].name).toBe('Alice')
    expect(students[1].name).toBe('Bob')
    expect(students[0].dates['2026-05-07']).toBe('P')
    expect(students[1].dates['2026-05-07']).toBe('A')
  })

  it('ignores non-date columns (Sr.No, Total P, Avg% etc)', async () => {
    setupMock(makeRaw([
      [1, '', '', 'Alice', '9000000001', '', 2, 0, 0, '100', 'P', '-', '-'],
    ]))
    const { students } = await parseAttendanceExcel(makeFile())
    // Only keys matching YYYY-MM-DD should be present
    const keys = Object.keys(students[0].dates)
    expect(keys.every(k => /^\d{4}-\d{2}-\d{2}$/.test(k))).toBe(true)
  })

  it('trims whitespace from student names', async () => {
    setupMock(makeRaw([
      [1, '', '', '  Arjun Sharma  ', '9876543210', '', 1, 0, 0, '', 'P', '-', '-'],
    ]))
    const { students } = await parseAttendanceExcel(makeFile())
    expect(students[0].name).toBe('Arjun Sharma')
  })
})
