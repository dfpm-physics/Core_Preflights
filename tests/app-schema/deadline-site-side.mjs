// deadline-site-side.mjs -- the shipped site's deadline rule, run over rows read from the database.
//
// Used by v2_deadline_proof.py, which compares this output to app.deadline_rows(). It reads one JSON document on
// stdin and writes one JSON array on stdout. It imports the SHIPPED functions and adds no rule of its own:
// shapeOffering -> withResolvedDue (resolveDueBySection) -> effectiveDue, exactly the order the pages use.
//
// The only thing this file decides is which extension rows reach effectiveDue: the pages pass only an ACTIVE
// extension (the query filters revoked_at IS NULL, see EXTENSION_SELECT in schema.js). A control can ask for a
// wrong version of that step with {"plant": "revoked_counts"}; the comparison must then find a difference.
//
// Input:  { now: <epoch ms>, plant: null|"revoked_counts", offerings: [{id, due_at, due_by_day, dues:[{section_id, due_at}]}],
//           sections: [{id, meeting_days}], enrollments: [{id, section_id}],
//           extensions: [{enrollment_id, assignment_offering_id, extended_due_at, revoked_at}] }
// Output: [{enrollment_id, assignment_offering_id, due: <epoch ms>|null, source, is_past}]
//
// Offline: no network, no database.

import { shapeOffering, withResolvedDue, effectiveDue } from '../../site/js/schema.js';

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const now = new Date(input.now);

const shaped = new Map(input.offerings.map(o => [o.id, withResolvedDue(shapeOffering({
  id: o.id, course_offering_id: null, points_possible: 1, grading_mode: 'points',
  due_at: o.due_at, due_by_day: o.due_by_day, is_published: true, assignments: {}, offering_activities: [],
  assignment_due_dates: o.dues,
}), input.sections)]));

const extFor = new Map();
for (const x of input.extensions) {
  if (x.revoked_at && input.plant !== 'revoked_counts') continue;      // the pages never pass a revoked row
  extFor.set(`${x.enrollment_id}|${x.assignment_offering_id}`, x.extended_due_at);
}

const out = [];
for (const e of input.enrollments) {
  for (const o of input.offerings) {
    const eff = effectiveDue(shaped.get(o.id), e.section_id, extFor.get(`${e.id}|${o.id}`) || null, now);
    out.push({ enrollment_id: e.id, assignment_offering_id: o.id,
               due: eff.due ? eff.due.getTime() : null, source: eff.source, is_past: eff.isPast });
  }
}
process.stdout.write(JSON.stringify(out));
