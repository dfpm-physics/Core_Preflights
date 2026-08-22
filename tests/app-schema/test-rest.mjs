// test-rest.mjs — every PostgREST projection the app ships is valid against the live schema.
//
// These import the SELECT constants from the real schema.js rather than restating them, so a
// projection cannot drift from what the browser sends without this suite noticing.
//
// PostgREST validates columns, embeds and filters BEFORE RLS filters rows, so an anonymous
// client is enough: a 400 means the query is malformed, and rows coming back empty is just
// RLS doing its job. That distinction is what makes this a shape test rather than a data test.

import { check, section, anonClient } from './harness.mjs';
import {
  OFFERING_SELECT, SUBMISSION_SELECT, GRADE_SELECT, ENROLLMENT_JOIN,
  SUBMISSION_SELECT_STUDENT, GRADE_SELECT_STUDENT,
  STAFF_SELECT, ENROLLMENT_SELECT,
} from '../../site/js/schema.js';

section('PostgREST projections (shape only — RLS empties the rows)');

const db = anonClient();
const NIL = '00000000-0000-0000-0000-000000000000';

/** A PostgREST error means a malformed query; empty data means RLS. Only the former fails. */
async function shapeOk(desc, run) {
  const { error } = await run();
  return check(desc, !error, error ? `${error.code} ${error.message}` : '');
}

await shapeOk('OFFERING_SELECT on assignment_offerings', () =>
  db.from('assignment_offerings').select(OFFERING_SELECT)
    .eq('course_offering_id', NIL).eq('is_published', true)
    .order('position', { ascending: true, nullsFirst: false }));

await shapeOk('SUBMISSION_SELECT on submissions', () =>
  db.from('submissions').select(SUBMISSION_SELECT).in('enrollment_id', [NIL]));

await shapeOk('GRADE_SELECT on grades', () =>
  db.from('grades').select(GRADE_SELECT).in('enrollment_id', [NIL]));

// The student pair, which must parse AND must not name the diagnostic columns. The second half is
// the whole point of them existing, and a projection test that only checked they parse would pass
// just as happily on the faculty strings.
await shapeOk('SUBMISSION_SELECT_STUDENT on submissions', () =>
  db.from('submissions').select(SUBMISSION_SELECT_STUDENT).in('enrollment_id', [NIL]));

await shapeOk('GRADE_SELECT_STUDENT on grades', () =>
  db.from('grades').select(GRADE_SELECT_STUDENT).in('enrollment_id', [NIL]));

await shapeOk('the written-answers fetch the student loader splits out', () =>
  db.from('submission_activities').select('submission_id,activity_id,content')
    .in('activity_id', [NIL]));

check('the student submission select asks for no report_markdown',
      !SUBMISSION_SELECT_STUDENT.includes('report_markdown'));
check('…and no submission_activities.content — the interactive `d`',
      !SUBMISSION_SELECT_STUDENT.includes('content'));
/* The student select must not ask for the `diagnostic` COLUMN — that is the whole schema:1
 * assessment: honor.status and its free text, needs_follow_up, per-objective understanding, the
 * misconceptions the rollup turns into "Integrity concern" pills. A cadet with devtools open
 * would be reading the finding about themselves.
 *
 * Since 2026-08-21 it does project one key OUT of that column, `instructor_note` — the reason a
 * human chose a score, on an interactive grade that has no question_scores to carry feedback in.
 * So a substring test for "diagnostic" no longer says what it means. Pin the two real properties
 * instead: the bare column is not selected, and the only jsonb path taken is that one key. */
check('the student grade select does not ask for the diagnostic column',
      !/(^|,)\s*diagnostic\s*(,|$)/.test(GRADE_SELECT_STUDENT));
check('…and the only key it projects out of it is instructor_note',
      (GRADE_SELECT_STUDENT.match(/diagnostic->>?[a-z_]+/g) || []).join() === 'diagnostic->instructor_note');
// …while the faculty ones still do. The rollup's flag pills are built from exactly these.
check('the faculty selects still carry them, or the rollup goes blank',
      SUBMISSION_SELECT.includes('content') && GRADE_SELECT.includes('diagnostic'));

await shapeOk('STAFF_SELECT on staff_assignments', () =>
  db.from('staff_assignments').select(STAFF_SELECT).eq('instructor_id', NIL));

await shapeOk('ENROLLMENT_SELECT on enrollments', () =>
  db.from('enrollments').select(ENROLLMENT_SELECT).eq('student_id', 3000000000));

await shapeOk('ENROLLMENT_JOIN on grades (faculty view)', () =>
  db.from('grades').select(`${GRADE_SELECT},${ENROLLMENT_JOIN}`).eq('assignment_offering_id', NIL));

await shapeOk('ENROLLMENT_JOIN on submissions (faculty view)', () =>
  db.from('submissions').select(`${SUBMISSION_SELECT},${ENROLLMENT_JOIN}`).eq('assignment_offering_id', NIL));

// Tables the wiring writes to, projected the way the write paths read them back.
await shapeOk('extensions (migration 005)', () =>
  db.from('extensions').select('id,enrollment_id,assignment_offering_id,extended_due_at,reason,granted_by')
    .in('enrollment_id', [NIL]));

await shapeOk('submission_activities upsert projection', () =>
  db.from('submission_activities').select('id,submission_id,activity_id,content,report_markdown,payload_bytes,is_final')
    .eq('submission_id', NIL));

await shapeOk('activity lookup by slug (interaction-submit receiver)', () =>
  db.from('activities').select(
    'id,slug,modality,title,content,assignment_id,' +
    'assignments!inner(id,slug,title,course_id),' +
    'offering_activities(grading_role,available_after,is_visible,' +
    'assignment_offerings(id,is_published,course_offering_id,points_possible,grading_mode,switch_policy))')
    .eq('slug', 'lesson-02-electric-charge-coulombs-law'));

await shapeOk('sections with enrollment counts (faculty roster)', () =>
  db.from('sections').select('id,code,meeting_days,period,enrollments(id,status,student_id)')
    .eq('course_offering_id', NIL).order('code'));

await shapeOk('analysis_reports by scope', () =>
  db.from('analysis_reports').select('id,scope,scope_id,audience_id,kind,payload,generated_at')
    .eq('scope', 'assignment_offering').eq('scope_id', NIL));

await shapeOk('grade_events append-only log', () =>
  db.from('grade_events').select('id,grade_id,event,actor,detail,occurred_at').eq('grade_id', NIL));

// A negative control: if a bad projection did NOT error, every check above would be vacuous.
{
  const { error } = await db.from('assignments').select('slug,definitely_not_a_column').limit(1);
  check('negative control — a bogus column really does error',
        !!error, 'without this, a passing shape test proves nothing');
}
