// stale-zero-site-side.mjs -- the shipped site's stale-zero question, run over rows read from the database.
//
// Used by v2_stale_zero_proof.py, which compares this output with app._cells_at(). It reads one JSON document on
// stdin and writes one JSON array on stdout. It imports the SHIPPED planPublish() from site/js/faculty-grade.js and
// adds no rule of its own. For a FINALIZED grade planPublish answers 'wrong-published' exactly when
// isStaleZero() holds and work is behind the zero (hasAnyAnswer on the written content, or a chosen activity other
// than the written one), reading the work time as committed_at when committed and updated_at otherwise.
//
// A control can ask for a wrong version of the input with {"plant": ...}; the comparison must then find a difference:
//   "all_answers"   every written answer is replaced by text, so a blank counts as work
//   "grade_later"   every graded_at is moved forward two days, so "saved before the work" flips
//
// Input:  { plant, offering: {id, writtenActivityId}, rows: [{enrollment_id, student_id, section_id,
//           sub: null | {id, chosen_activity_id, status, committed_at, updated_at, content},
//           grade: {id, points_earned, source, graded_at, nosub, is_finalized}}] }
// Output: [{enrollment_id, stale}]
//
// Offline: no network, no database. (The harness import below only supplies a browser stand-in.)

import { installBrowser } from './harness.mjs';

installBrowser({ pathname: '/site/faculty/grade.html' });
window.db = { from() { throw new Error('the stale-zero proof is offline: no query may be issued'); } };
const { planPublish } = await import('../../site/js/faculty-grade.js');

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const off = { id: input.offering.id, slug: 's', title: 't', position: 0,
              writtenActivityId: input.offering.writtenActivityId, written: { id: input.offering.writtenActivityId } };

const students = input.rows.map(r => ({ student_id: r.student_id, name: 'x', section_id: r.section_id, enrollment_id: r.enrollment_id }));
const submissions = [], grades = [], writtenContent = {};
for (const r of input.rows) {
  if (r.sub) {
    submissions.push({ id: r.sub.id, enrollment_id: r.enrollment_id, assignment_offering_id: off.id,
                       chosen_activity_id: r.sub.chosen_activity_id, status: r.sub.status,
                       committed_at: r.sub.committed_at, updated_at: r.sub.updated_at });
    let content = r.sub.content ?? {};
    if (input.plant === 'all_answers') content = { q1: 'x' };
    writtenContent[r.sub.id] = content;
  }
  let gradedAt = r.grade.graded_at;
  if (input.plant === 'grade_later' && gradedAt) gradedAt = new Date(Date.parse(gradedAt) + 2 * 86400e3).toISOString();
  grades.push({ id: r.grade.id, enrollment_id: r.enrollment_id, assignment_offering_id: off.id,
                is_finalized: r.grade.is_finalized, points_earned: r.grade.points_earned, source: r.grade.source,
                graded_at: gradedAt, nosub: r.grade.nosub });
}

const items = planPublish({ offerings: [off], students, submissions, grades, extensions: [], writtenContent },
                          new Date(input.now));
const stale = new Set(items.filter(i => i.kind === 'wrong-published').map(i => i.enrollmentId));
process.stdout.write(JSON.stringify(input.rows.map(r => ({ enrollment_id: r.enrollment_id, stale: stale.has(r.enrollment_id) }))));
