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

summary();
