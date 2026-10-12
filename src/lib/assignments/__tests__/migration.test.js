import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  ALLOWED_TYPES, MAX_FILE_BYTES, ASSIGNMENT_FILES_BUCKET, SUBMISSIONS_BUCKET,
} from '../upload'
import { OUTCOMES, GRADERS, MAX_FEEDBACK_CHARS, MAX_SUMMARY_CHARS } from '../grade'

// The database repeats the rules the JS checks, and is the actual boundary.
// These tests keep the two copies from drifting apart.
const dir = join(process.cwd(), 'supabase', 'migrations')
const file = readdirSync(dir).find(f => f.endsWith('_create_homework_assignments.sql'))
const sql = file ? readFileSync(join(dir, file), 'utf8') : ''
const flat = sql.replace(/\s+/g, ' ')

describe('homework assignments migration', () => {
  it('exists', () => {
    expect(file).toBeTruthy()
  })

  it('creates both buckets private, with the JS size and type limits', () => {
    const types = Object.keys(ALLOWED_TYPES).map(t => `'${t}'`).join(', ')
    for (const bucket of [ASSIGNMENT_FILES_BUCKET, SUBMISSIONS_BUCKET]) {
      expect(flat).toContain(`('${bucket}', '${bucket}', false, ${MAX_FILE_BYTES}, ARRAY[${types}])`)
    }
  })

  it('allows exactly the JS outcomes and graders', () => {
    expect(flat).toContain(`outcome IN (${OUTCOMES.map(o => `'${o}'`).join(', ')})`)
    expect(flat).toContain(`grader IN (${GRADERS.map(g => `'${g}'`).join(', ')})`)
  })

  it('caps feedback and summaries at the JS limits', () => {
    expect(flat).toContain(`BETWEEN 1 AND ${MAX_FEEDBACK_CHARS}`)
    expect(flat).toContain(`BETWEEN 1 AND ${MAX_SUMMARY_CHARS}`)
  })

  it('enables RLS on all three tables', () => {
    for (const t of ['homework_assignments', 'homework_submissions', 'homework_grades']) {
      expect(flat).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`)
    }
  })

  // Students have no Supabase session: every submission write is the service
  // role's (the student endpoint, and the grading scripts). A write policy here
  // would let any signed-in staff account forge or rewrite a grade.
  it('gives submissions and grades read policies only', () => {
    for (const t of ['homework_submissions', 'homework_grades']) {
      const policies = [...flat.matchAll(new RegExp(`CREATE POLICY \\w+ ON public\\.${t} FOR (\\w+)`, 'g'))]
      expect(policies.length, t).toBeGreaterThan(0)
      for (const p of policies) expect(p[1], t).toBe('SELECT')
    }
  })

  it('lets only the service role run the submission and grade functions', () => {
    const declared = [...flat.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map(m => m[1])
    expect(declared.sort()).toEqual([
      'homework_grade_commit', 'homework_submission_reject', 'homework_submission_start', 'homework_submission_submit',
    ])
    for (const fn of declared) {
      expect(flat).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated`))
      expect(flat).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role`))
      expect(flat).not.toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO authenticated`))
    }
  })

  it('sums the total in the database, never from the caller', () => {
    expect(flat).toMatch(/SELECT COALESCE\(sum\(awarded\), 0\)/)
    expect(flat).not.toMatch(/p_total/)
  })

  it('pins search_path on every function', () => {
    const fns = flat.match(/CREATE OR REPLACE FUNCTION/g) ?? []
    const pinned = flat.match(/SET search_path = ''/g) ?? []
    expect(fns.length).toBeGreaterThan(0)
    expect(pinned.length).toBe(fns.length)
  })

  it('gives the submissions bucket no write policy (uploads go through signed links)', () => {
    const writes = [...flat.matchAll(/CREATE POLICY \w+ ON storage\.objects FOR (INSERT|UPDATE|DELETE)[^;]*;/g)]
    for (const w of writes) expect(w[0]).not.toContain(SUBMISSIONS_BUCKET)
  })
})

// 2026-10-12: homework may be a description alone (an announcement in class).
// The database relaxes the publish rule to match validateAssignmentForPublish,
// without dropping it: a published homework still needs batches, and a
// question paper OR a non-blank description.
describe('publish-with-description migration', () => {
  const descFile = readdirSync(dir).find(f => f.endsWith('_homework_publish_with_description.sql'))
  const desc = descFile ? readFileSync(join(dir, descFile), 'utf8').replace(/\s+/g, ' ') : ''

  it('exists and sorts after the table migration', () => {
    expect(descFile).toBeTruthy()
    expect(descFile > file).toBe(true)
  })

  it('re-creates the publish check with a description as the alternative', () => {
    expect(desc).toContain('DROP CONSTRAINT homework_assignments_publishable')
    expect(desc).toContain('ADD CONSTRAINT homework_assignments_publishable CHECK')
    expect(desc).toContain("status = 'draft'")
    expect(desc).toContain('cardinality(batch_names) >= 1')
    expect(desc).toMatch(/jsonb_array_length\(question_files\) >= 1 OR length\(btrim\(coalesce\(instructions, ''\)\)\) > 0/)
  })
})
