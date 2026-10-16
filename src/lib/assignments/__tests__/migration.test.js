import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  ALLOWED_TYPES, MAX_FILE_BYTES, ASSIGNMENT_FILES_BUCKET, SUBMISSIONS_BUCKET,
} from '../upload'
import { OUTCOMES, GRADERS, MAX_FEEDBACK_CHARS, MAX_SUMMARY_CHARS, CAUSES, TOPIC_CAUSES, MAX_TOPIC_CHARS } from '../grade'
import { HAND_CHECKS, MAX_HAND_NOTE_CHARS } from '../handwriting'
import { SUBMISSION_STATUSES, MAX_REPLACEMENTS } from '../status'
import { MARK_KINDS, MAX_NOTE_CHARS } from '../pageMarks'
import { MAX_MARKED_PAGES } from '../upload'

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

// 2026-10-13: the handwriting check. A grade whose handwriting does not match
// the student's reference (their first graded homework) is saved as `held` and
// reaches the student only when the homework's teacher or an admin releases it.
describe('handwriting-check migration', () => {
  // Three files: one large migration was declined by the Supabase connector's
  // confirmation step, so it was applied in parts. Read together, in order.
  const handFiles = readdirSync(dir).filter(f => /_homework_handwriting_check_\d_\w+\.sql$/.test(f)).sort()
  const hand = handFiles.map(f => readFileSync(join(dir, f), 'utf8')).join('\n').replace(/\s+/g, ' ')
  const list = xs => xs.map(x => `'${x}'`).join(', ')

  it('exists in three parts that sort after the earlier homework migrations, columns first', () => {
    expect(handFiles.map(f => f.replace(/^\d+_/, ''))).toEqual([
      'homework_handwriting_check_1_columns.sql',
      'homework_handwriting_check_2_references.sql',
      'homework_handwriting_check_3_functions.sql',
    ])
    expect(handFiles[0] > file).toBe(true)
  })

  it('allows the submission statuses of its day, and exactly the JS handwriting checks', () => {
    // `replaced` came later (the replace migration below re-states the list).
    expect(hand).toContain(`status IN (${list(['uploading', 'submitted', 'held', 'graded', 'rejected'])})`)
    expect(hand).toContain(`hand_check IN (${list(HAND_CHECKS)})`)
    expect(hand).toContain(`BETWEEN 1 AND ${MAX_HAND_NOTE_CHARS}`)
  })

  // The state check is the real boundary: a held row is a full grade that is
  // not released, and a released mismatch says who released it.
  it('defines held as an unreleased mismatch, and a graded mismatch as released', () => {
    expect(hand).toContain('DROP CONSTRAINT homework_submissions_state')
    expect(hand).toMatch(/status = 'held' AND [^;]*hand_check = 'mismatch'[^;]*resolved_at IS NULL/)
    expect(hand).toMatch(/hand_check IS DISTINCT FROM 'mismatch' OR resolved_at IS NOT NULL/)
  })

  it('replaces the grade function rather than leaving the old one callable', () => {
    expect(hand).toContain('DROP FUNCTION public.homework_grade_commit(uuid, jsonb, text, text, text)')
    expect(hand).toMatch(/REVOKE ALL ON FUNCTION public\.homework_grade_commit\([^)]*\) FROM PUBLIC, anon, authenticated/)
    expect(hand).toMatch(/GRANT EXECUTE ON FUNCTION public\.homework_grade_commit\([^)]*\) TO service_role/)
    // The reference is looked up in the database, never named by the caller.
    expect(hand).not.toMatch(/p_hand_reference/)
  })

  it('counts a held submission as handed in when a new upload starts', () => {
    expect(hand).toContain("status IN ('submitted', 'held', 'graded')")
  })

  // The one function staff call. It must check, inside the database, that a
  // teacher is acting on homework they set — the page hiding it is not enough.
  it('lets signed-in staff resolve a held grade, a teacher only on their own homework', () => {
    expect(hand).toMatch(/CREATE OR REPLACE FUNCTION public\.homework_held_resolve\([^)]*\) RETURNS \w+ LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''/)
    expect(hand).toMatch(/REVOKE ALL ON FUNCTION public\.homework_held_resolve\([^)]*\) FROM PUBLIC, anon/)
    expect(hand).toMatch(/GRANT EXECUTE ON FUNCTION public\.homework_held_resolve\([^)]*\) TO authenticated/)
    expect(hand).toContain("(auth.jwt() -> 'app_metadata') ->> 'role'")
    expect(hand).toMatch(/created_by\) <> lower\(v_email\)/)
    expect(hand).toMatch(/v_sub\.status <> 'held'/)
  })

  it('keeps references in a read-only table, seeded from each student\'s first graded homework', () => {
    expect(hand).toContain('CREATE TABLE public.homework_hand_references')
    expect(hand).toContain('ALTER TABLE public.homework_hand_references ENABLE ROW LEVEL SECURITY')
    const policies = [...hand.matchAll(/CREATE POLICY \w+ ON public\.homework_hand_references FOR (\w+)/g)]
    expect(policies.length).toBeGreaterThan(0)
    for (const p of policies) expect(p[1]).toBe('SELECT')
    expect(hand).toMatch(/INSERT INTO public\.homework_hand_references[^;]*DISTINCT ON \(lws_id\)[^;]*status = 'graded'[^;]*ORDER BY lws_id, graded_at/)
  })

  it('pins search_path on every function', () => {
    const fns = hand.match(/CREATE OR REPLACE FUNCTION/g) ?? []
    expect(fns.length).toBeGreaterThan(0)
    expect((hand.match(/SET search_path = ''/g) ?? []).length).toBe(fns.length)
  })
})

// 2026-10-14: a student may replace a hand-in that has not been marked, before
// the deadline, at most MAX_REPLACEMENTS times. The newest is the one marked.
describe('replace-submission migration', () => {
  // Applied in four parts (the connector declines DROP INDEX / DROP FUNCTION /
  // DELETE, so part 3 went through the SQL editor). Read together, in order.
  const repFiles = readdirSync(dir).filter(f => /_homework_replace_submission_\w+\.sql$/.test(f)).sort()
  const repFile = repFiles[0]
  const rep = repFiles.map(f => readFileSync(join(dir, f), 'utf8')).join('\n').replace(/\s+/g, ' ')
  const list = xs => xs.map(x => `'${x}'`).join(', ')

  it('exists in four parts that sort after the handwriting check, schema first', () => {
    expect(repFiles.map(f => f.replace(/^\d+_/, ''))).toEqual([
      'homework_replace_submission_1a_column.sql',
      'homework_replace_submission_1b_constraints.sql',
      'homework_replace_submission_2_submit.sql',
      'homework_replace_submission_3_index_and_start.sql',
    ])
    const lastHand = readdirSync(dir).filter(f => /_homework_handwriting_check_\d_\w+\.sql$/.test(f)).sort().pop()
    expect(repFile > lastHand).toBe(true)
  })

  it('allows exactly the JS submission statuses', () => {
    expect(rep).toContain(`status IN (${list(SUBMISSION_STATUSES)})`)
  })

  // The state check is the boundary: a replaced row was a real hand-in, and
  // only a replaced row carries replaced_at.
  it('defines replaced as a sent hand-in with a replacement time', () => {
    expect(rep).toContain('DROP CONSTRAINT homework_submissions_state')
    expect(rep).toMatch(/status = 'replaced' AND submitted_at IS NOT NULL AND replaced_at IS NOT NULL AND rejected_reason IS NULL/)
    expect(rep).toMatch(/\(status = 'replaced'\) = \(replaced_at IS NOT NULL\)/)
  })

  // One live hand-in and at most one upload in progress, side by side: the
  // replacement uploads while the old one still counts.
  it('keeps one live hand-in per student, beside at most one upload', () => {
    expect(rep).toContain('DROP INDEX public.homework_submissions_one_per_student')
    expect(rep).toMatch(/CREATE UNIQUE INDEX homework_submissions_one_per_student ON public\.homework_submissions \(assignment_id, lws_id\) WHERE status IN \('submitted', 'held', 'graded'\)/)
    expect(rep).toMatch(/CREATE UNIQUE INDEX homework_submissions_one_upload ON public\.homework_submissions \(assignment_id, lws_id\) WHERE status = 'uploading'/)
  })

  it('replaces the start function rather than leaving the old one callable', () => {
    expect(rep).toContain('DROP FUNCTION public.homework_submission_start(uuid, uuid, text, jsonb)')
    expect(rep).toMatch(/CREATE OR REPLACE FUNCTION public\.homework_submission_start\( p_id uuid, p_assignment uuid, p_lws_id text, p_files jsonb, p_replace boolean DEFAULT false \)/)
  })

  it('never replaces a marked hand-in, and caps replacements at the JS limit', () => {
    expect(rep).toMatch(/has already been marked/)
    expect((rep.match(new RegExp(`>= ${MAX_REPLACEMENTS} THEN RAISE EXCEPTION '[^']*no replacements left`, 'g')) ?? []).length).toBe(2)
  })

  // The swap happens when the new pages are sent, in one transaction: a
  // student who gives up half way still has their first hand-in.
  it('retires the old hand-in in the submit function, not at start', () => {
    // Each function's body runs from its CREATE to the next $$ that closes it.
    const body = fn => {
      const from = rep.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`)
      expect(from, fn).toBeGreaterThan(-1)
      const open = rep.indexOf('$$', from)
      return rep.slice(open, rep.indexOf('$$', open + 2))
    }
    expect(body('homework_submission_submit')).toMatch(/SET status = 'replaced', replaced_at = now\(\)/)
    expect(body('homework_submission_start')).toMatch(/p_replace/)
    expect(body('homework_submission_start')).not.toMatch(/status = 'replaced', replaced_at/)
  })

  it('lets only the service role run both functions, with search_path pinned', () => {
    for (const fn of ['homework_submission_start', 'homework_submission_submit']) {
      expect(rep).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated`))
      expect(rep).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role`))
    }
    const fns = rep.match(/CREATE OR REPLACE FUNCTION/g) ?? []
    expect(fns.length).toBe(2)
    expect((rep.match(/SET search_path = ''/g) ?? []).length).toBe(2)
  })
})

// 2026-10-16: every question that lost marks names why (cause) and, for a
// concept gap or work left out, what to relearn or show (topic). Two parts:
// columns + checks, then the grade function that writes them.
describe('grade-cause migration', () => {
  const causeFiles = readdirSync(dir).filter(f => /_homework_grade_cause_\d_\w+\.sql$/.test(f)).sort()
  const cause = causeFiles.map(f => readFileSync(join(dir, f), 'utf8')).join('\n').replace(/\s+/g, ' ')
  const list = xs => xs.map(x => `'${x}'`).join(', ')

  it('exists in two parts that sort after the replace-submission migration, columns first', () => {
    expect(causeFiles.map(f => f.replace(/^\d+_/, ''))).toEqual([
      'homework_grade_cause_1_columns.sql',
      'homework_grade_cause_2_commit.sql',
    ])
    const lastRep = readdirSync(dir).filter(f => /_homework_replace_submission_\w+\.sql$/.test(f)).sort().pop()
    expect(causeFiles[0] > lastRep).toBe(true)
  })

  it('allows exactly the JS causes, and topics up to the JS limit', () => {
    expect(cause).toContain(`cause IN (${list(CAUSES)})`)
    expect(cause).toContain(`BETWEEN 1 AND ${MAX_TOPIC_CHARS}`)
  })

  // Lost marks need a cause, and only lost marks may have one. NOT VALID: the
  // grades saved before causes existed keep theirs empty (a regrade replaces
  // the rows, and the new rows are checked).
  it('requires a cause exactly when marks were lost, for new rows only', () => {
    expect(cause).toMatch(/CONSTRAINT homework_grades_cause_needed CHECK \(\(outcome = 'scored' AND awarded < max_marks\) = \(cause IS NOT NULL\)\) NOT VALID/)
  })

  it('requires a topic for the JS topic causes, and no topic without a cause', () => {
    expect(cause).toContain(`cause NOT IN (${list(TOPIC_CAUSES)}) OR topic IS NOT NULL`)
    expect(cause).toContain('topic IS NULL OR cause IS NOT NULL')
  })

  it('writes cause and topic in the grade function, keeping its signature and service-role-only grant', () => {
    expect(cause).not.toMatch(/DROP FUNCTION/)
    expect(cause).toMatch(/CREATE OR REPLACE FUNCTION public\.homework_grade_commit\( p_submission uuid, p_grades jsonb, p_went_well text, p_next_steps text, p_grader text, p_hand_check text, p_hand_note text \)/)
    expect(cause).toMatch(/INSERT INTO public\.homework_grades \([^)]*cause, topic\)/)
    expect(cause).toContain("NULLIF(btrim(g->>'cause'), '')")
    expect(cause).toContain("NULLIF(btrim(g->>'topic'), '')")
    expect(cause).toMatch(/REVOKE ALL ON FUNCTION public\.homework_grade_commit\([^)]*\) FROM PUBLIC, anon, authenticated/)
    expect(cause).toMatch(/GRANT EXECUTE ON FUNCTION public\.homework_grade_commit\([^)]*\) TO service_role/)
    expect(cause).toMatch(/SELECT COALESCE\(sum\(awarded\), 0\)/)
  })

  it('pins search_path on every function', () => {
    const fns = cause.match(/CREATE OR REPLACE FUNCTION/g) ?? []
    expect(fns.length).toBe(1)
    expect((cause.match(/SET search_path = ''/g) ?? []).length).toBe(fns.length)
  })
})

// 2026-10-16: the grader's marks on the student's pages. Part 1: the table and
// the page count. Part 2: the grade function saves grade and marks together.
describe('page-marks migration', () => {
  const markFiles = readdirSync(dir).filter(f => /_homework_page_marks_\d_\w+\.sql$/.test(f)).sort()
  const marks = markFiles.map(f => readFileSync(join(dir, f), 'utf8')).join(' ').replace(/\s+/g, ' ')
  const list = xs => xs.map(x => `'${x}'`).join(', ')

  it('exists in two parts that sort after the grade-cause migration, table first', () => {
    expect(markFiles.map(f => f.replace(/^\d+_/, ''))).toEqual([
      'homework_page_marks_1_table.sql',
      'homework_page_marks_2_commit.sql',
    ])
    const lastCause = readdirSync(dir).filter(f => /_homework_grade_cause_\d_\w+\.sql$/.test(f)).sort().pop()
    expect(markFiles[0] > lastCause).toBe(true)
  })

  it('allows exactly the JS kinds, note length and page count', () => {
    expect(marks).toContain(`kind IN (${list(MARK_KINDS)})`)
    expect(marks).toContain(`BETWEEN 1 AND ${MAX_NOTE_CHARS}`)
    expect(marks).toContain(`marked_pages BETWEEN 1 AND ${MAX_MARKED_PAGES}`)
    expect(marks).toContain(`page BETWEEN 1 AND ${MAX_MARKED_PAGES}`)
  })

  // A mark belongs to a graded question; replacing the grade rows (every
  // regrade) takes their marks with them.
  it('ties each mark to its grade row, cascading on a regrade', () => {
    expect(marks).toMatch(/FOREIGN KEY \(submission_id, label\) REFERENCES public\.homework_grades \(submission_id, label\) ON DELETE CASCADE/)
    // grading:pull embeds marks in the submission, which needs a direct key.
    expect(marks).toMatch(/submission_id uuid NOT NULL REFERENCES public\.homework_submissions \(id\) ON DELETE CASCADE/)
  })

  // NULL passes a CHECK, so "a circle has a size" must not be written as a
  // bare comparison on w and h.
  it('gives each kind only its own fields, failing closed on NULL', () => {
    expect(marks).toMatch(/WHEN kind = 'circle' THEN coalesce\(/)
    expect(marks).toMatch(/WHEN kind = 'note' THEN coalesce\(/)
    expect(marks).toContain("to_x IS NULL OR kind = 'note'")
  })

  it('is read-only to staff, like the grades', () => {
    expect(marks).toContain('ALTER TABLE public.homework_page_marks ENABLE ROW LEVEL SECURITY')
    const policies = [...marks.matchAll(/CREATE POLICY \w+ ON public\.homework_page_marks FOR (\w+)/g)]
    expect(policies.length).toBe(1)
    expect(policies[0][1]).toBe('SELECT')
  })

  it('replaces the grade function with one that takes the marks, dropping the old one', () => {
    expect(marks).toContain('DROP FUNCTION public.homework_grade_commit(uuid, jsonb, text, text, text, text, text)')
    expect(marks).toMatch(/CREATE OR REPLACE FUNCTION public\.homework_grade_commit\( p_submission uuid, p_grades jsonb, p_went_well text, p_next_steps text, p_grader text, p_hand_check text, p_hand_note text, p_marked_pages smallint, p_marks jsonb \)/)
    expect(marks).toMatch(/INSERT INTO public\.homework_page_marks/)
    expect(marks).toContain('marked_pages = p_marked_pages')
    expect(marks).toMatch(/REVOKE ALL ON FUNCTION public\.homework_grade_commit\([^)]*smallint, jsonb\) FROM PUBLIC, anon, authenticated/)
    expect(marks).toMatch(/GRANT EXECUTE ON FUNCTION public\.homework_grade_commit\([^)]*smallint, jsonb\) TO service_role/)
    expect(marks).toMatch(/SELECT COALESCE\(sum\(awarded\), 0\)/)
  })

  // The database repeats the two rules that make the page agree with the grade.
  it('refuses a mark off the prepared pages, and a scored question without exactly one score', () => {
    expect(marks).toMatch(/page > p_marked_pages/)
    expect(marks).toMatch(/kind = 'score'[^;]*<> CASE WHEN g\.outcome = 'scored' THEN 1 ELSE 0 END/)
  })

  it('pins search_path on every function', () => {
    const fns = marks.match(/CREATE OR REPLACE FUNCTION/g) ?? []
    expect(fns.length).toBe(1)
    expect((marks.match(/SET search_path = ''/g) ?? []).length).toBe(fns.length)
  })
})

// 2026-10-16: staff email the marked-paper report from the local admin app.
// report_emailed_at records it; any change to the grade clears it, so a
// regraded paper shows as not sent.
describe('report-email migration', () => {
  const emailFiles = readdirSync(dir).filter(f => /_homework_report_email\.sql$/.test(f)).sort()
  const email = emailFiles.map(f => readFileSync(join(dir, f), 'utf8')).join(' ').replace(/\s+/g, ' ')

  it('exists once, after the page-marks migration', () => {
    expect(emailFiles).toHaveLength(1)
    const lastMarks = readdirSync(dir).filter(f => /_homework_page_marks_\d_\w+\.sql$/.test(f)).sort().pop()
    expect(emailFiles[0] > lastMarks).toBe(true)
  })

  it('records a send only on a released grade with a marked paper', () => {
    expect(email).toContain('ADD COLUMN report_emailed_at timestamptz')
    expect(email).toMatch(/CHECK \(report_emailed_at IS NULL OR \(status = 'graded' AND marked_pages IS NOT NULL\)\)/)
  })

  it('clears the record whenever the grade changes, before the row is written', () => {
    expect(email).toMatch(/BEFORE UPDATE ON public\.homework_submissions FOR EACH ROW/)
    expect(email).toMatch(/NEW\.regraded_at IS DISTINCT FROM OLD\.regraded_at OR NEW\.status IS DISTINCT FROM OLD\.status/)
    expect(email).toContain('NEW.report_emailed_at := NULL')
    expect(email).toMatch(/LANGUAGE plpgsql SET search_path = ''/)
  })
})
