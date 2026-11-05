// test-paging.mjs — that a whole-course read returns the WHOLE course.
//
// PostgREST caps a response at its `db-max-rows` and reports the cut only in a `Content-Range`
// header supabase-js does not surface, so a truncated read looks exactly like a complete one.
// On 2026-08-19 that cap was 1000, the faculty rollup asked for phys-215's submissions 300
// enrollments at a time, and the first chunk matched 1189 rows. The 189 that never arrived put
// 45 cadets who had submitted preflight-05 — and been graded 2/2 for it — on a "Did not submit"
// list. schema.js's fetchAll() is the fix; this suite is what keeps it fixed.
//
// Two assertions, and the second is the one worth having:
//   1. fetchAll returns every row the table holds for the scope.
//   2. it still does with pageSize forced FAR below the server cap. The cap was raised to 10000
//      the same day, so at the shipped default a course this size fits in one page and the
//      multi-page path — the only place a row can be dropped or repeated — would never execute.
//      A test that cannot fail is not a test.
//
// Runs against the seeded staging offering as the seeded director. Read-only.

import { check, section, summary, signInAsStaff } from './harness.mjs';
import { chunked, fetchAll, SUBMISSION_SELECT, GRADE_SELECT } from '../../site/js/schema.js';

section('whole-course reads are not silently truncated');

// Staging's seeded director directs the one seeded offering; nothing else is in scope for it.
const { client: db } = await signInAsStaff('director');
const { data: offs } = await db.from('course_offerings').select('id, course:courses(code)');
const OFFERING = (offs || []).find(o => o.course?.code === 'phys-215')?.id;
check('signed in as the staging director and found the seeded offering', !!OFFERING);
if (!OFFERING) process.exit(1);

const { data: secs } = await db.from('sections').select('id')
  .eq('course_offering_id', OFFERING).order('code');
const { data: enr } = await db.from('enrollments').select('id')
  .in('section_id', (secs || []).map(s => s.id)).eq('status', 'active');
check('the course has a roster to read', (enr || []).length > 0, `${enr?.length} enrollments`);

for (const [table, sel] of [['submissions', SUBMISSION_SELECT], ['grades', GRADE_SELECT]]) {
  for (const pageSize of [undefined, 250, 1]) {
    let got = 0, truth = 0, dupes = 0;
    for (const ids of chunked((enr || []).map(e => e.id))) {
      const { data, error } = await fetchAll(
        () => db.from(table).select(sel).in('enrollment_id', ids),
        pageSize ? { pageSize } : undefined);
      if (error) { check(`${table}: fetchAll errored`, false, error.message); break; }
      got += data.length;
      dupes += data.length - new Set(data.map(r => r.id)).size;
      const { count } = await db.from(table).select('id', { count: 'exact', head: true })
        .in('enrollment_id', ids);
      truth += count;
    }
    const how = pageSize ? `pageSize ${pageSize}` : 'shipped default';
    check(`${table} (${how}): every row arrives`, got === truth, `expected ${truth}, got ${got}`);
    // A row repeated across a page boundary is a row lost somewhere else — the count can look
    // right while the contents are wrong, so this is checked separately from the total.
    check(`${table} (${how}): no row repeated across pages`, dupes === 0, `${dupes} duplicate(s)`);
  }
}

process.exit(summary() ? 0 : 1);
