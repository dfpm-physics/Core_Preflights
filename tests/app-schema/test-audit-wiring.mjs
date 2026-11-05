// test-audit-wiring.mjs — the grade audit and the reset log are written by the server, not by a page or a request.
//
// WHAT THIS DEFENDS
//   Migration 049 moves the writing of `grade_events` into the database and records password resets from the reset
//   functions. These checks read the shipped source and fail if a page starts writing the audit table again, or if a
//   reset function takes its actor from the request instead of from the caller it verified.
//
// WHAT THIS CANNOT PROVE
//   That the database rejects a page's write, or that the functions are deployed. The scratch proof
//   (scripts/staging/test_grade_audit_scratch.py) shows the database half.

import { check, section, summary, readRepoFile } from './harness.mjs';
import { readdirSync } from 'node:fs';
import { APP_JS } from './harness.mjs';

section('no page writes the audit table');
const writers = [];
for (const f of readdirSync(APP_JS).filter(n => n.endsWith('.js'))) {
  const src = readRepoFile(`site/js/${f}`);
  if (/from\(\s*['"]grade_events['"]\s*\)\s*\.\s*(insert|upsert|update|delete)/.test(src)) writers.push(f);
}
check('no module under site/js inserts, updates or deletes grade_events', writers.length === 0, writers.join(', '));

section('the reset functions record the verified caller');
for (const [fn, event, target] of [['reset-student-password', 'student_reset', 'target_student'],
                                   ['reset-staff-password', 'staff_reset', 'target_staff']]) {
  const src = readRepoFile(`supabase/functions/${fn}/index.ts`);
  check(`${fn}: writes credential_events with the actor taken from the verified caller`,
        /credential_events/.test(src) && /actor:\s*caller\.id/.test(src));
  check(`${fn}: never reads an actor from the request`, !/body\.actor|actor:\s*body/.test(src));
  check(`${fn}: records both the request and the completion`,
        src.includes(`"${event}_requested"`) && src.includes(`"${event}_done"`));
  check(`${fn}: records the target`, src.includes(target));
  const iReq = src.indexOf(`${event}_requested`), iUpd = src.indexOf('updateUserById(');
  check(`${fn}: the request is recorded before the password is changed, and a failed record stops the reset`,
        iReq > 0 && iReq < iUpd && /logErr\)\s*return ok/.test(src));
}

section('the migration closes the table to the API');
const mig = readRepoFile('supabase/migrations/app/049_grade_audit.sql');
check('049 drops the staff insert policy on grade_events', /DROP POLICY ge_staff_insert ON grade_events/.test(mig));
check('049 revokes write grants from the API roles', /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON grade_events FROM anon, authenticated/.test(mig));
check('049 reads the actor from the session helper, never a column of the row', /audit_actor\(\)/.test(mig) && !/NEW\.actor/.test(mig));
check('049 has a rollback', readRepoFile('supabase/migrations/app/rollback/049_grade_audit_ROLLBACK.sql').includes('DROP TABLE IF EXISTS credential_events'));

section('the log outlives its grade and cannot be rewritten');
check('049: an event has no foreign key to its grade or its actor',
      /DROP CONSTRAINT IF EXISTS grade_events_grade_id_fkey/.test(mig) && /DROP CONSTRAINT IF EXISTS grade_events_actor_fkey/.test(mig));
check('049: refuses UPDATE, DELETE and TRUNCATE on both audit tables by trigger',
      /BEFORE UPDATE OR DELETE ON grade_events/.test(mig) && /BEFORE TRUNCATE ON grade_events/.test(mig)
      && /BEFORE UPDATE OR DELETE ON credential_events/.test(mig) && /BEFORE TRUNCATE ON credential_events/.test(mig));
check('049: audits over_max_allowed, enrollment_id and graded_at',
      /NEW\.over_max_allowed IS DISTINCT FROM OLD\.over_max_allowed/.test(mig) && /NEW\.enrollment_id IS DISTINCT FROM OLD\.enrollment_id/.test(mig)
      && /NEW\.graded_at IS DISTINCT FROM OLD\.graded_at/.test(mig));
check('049: a removal keeps the grade, the enrolment and the offering, and staff of the offering read it',
      /'enrollment', OLD\.enrollment_id/.test(mig) && /event = 'removed' AND grade_events\.course_offering_id IN \(SELECT staff_offerings\(\)\)/.test(mig));
check('049: a write to an existing row keeps that row\'s grader', /keeps the grader that row already has/.test(mig));
const rbFull = readRepoFile('supabase/migrations/app/rollback/049_grade_audit_ROLLBACK.sql');
const rb = rbFull.split(/\r?\n/).filter(l => !l.startsWith('--')).join(' ');
check('049 rollback: never grants TRUNCATE or any right to the API roles beyond INSERT, UPDATE, DELETE',
      !/GRANT[^;]*TRUNCATE/i.test(rb) && !/GRANT\s+ALL/i.test(rb) && /GRANT INSERT, UPDATE, DELETE ON grade_events TO anon, authenticated;/.test(rb));
check('049 rollback: says to put the previous reset functions back first', /BEFORE running this file/.test(rbFull));
check('the test cleanup does not delete from the audit table', !/DELETE FROM app\.grade_events/.test(readRepoFile('tests/app-schema/cleanup.py')));

summary();
