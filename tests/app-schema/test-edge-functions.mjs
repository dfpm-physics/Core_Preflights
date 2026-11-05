// test-edge-functions.mjs — the account edge functions, live, on staging.
//
// These functions answer HTTP 200 with { error } for a refusal, so each check reads the body and
// not the status. Every refusal check is non-destructive. The one positive case (a reset) is done
// on a seeded cadet nobody else uses, and it sets that cadet's forced-rotation flag; that cadet's
// REST sign-in still works, so nothing else in the suites depends on it.
//
// The two proxies (asksage-proxy, genai-mil-proxy) are not deployed to staging, and need external
// keys: they are reported SKIPPED, never as a pass.

import {
  check, section, skip, summary, signInAsStaff, signInAsTestStudent, installBrowser, makeClient,
  SUPABASE_URL, SUPABASE_ANON,
} from './harness.mjs';

installBrowser({});

async function call(client, fn, body) {
  const { data, error } = await client.functions.invoke(fn, { body });
  if (error) return { error: error.message };
  return data || {};
}
const staff = async (who) => (await signInAsStaff(who)).client;

// Find the seeded offerings without hardcoding ids.
const dir = await staff('director');
const { data: offs } = await dir.from('course_offerings').select('id, course:courses(code)');
const OFF215 = (offs || []).find(o => o.course?.code === 'phys-215')?.id;
check('found the seeded phys-215 offering', !!OFF215);
if (!OFF215) process.exit(1);

section('reset-student-password');
{
  const inst = await staff('instructor');
  const r = await call(inst, 'reset-student-password',
    { course_offering_id: OFF215, student_id: 3000000101, password: 'chosen-by-caller' });
  check('a request carrying a password is rejected', /does not accept a password/i.test(r.error || ''), JSON.stringify(r));

  const { client: stu } = await signInAsTestStudent();
  const s = await call(stu, 'reset-student-password', { course_offering_id: OFF215, student_id: 3000000101 });
  check('a cadet cannot reset anyone', !!s.error && !s.success, JSON.stringify(s));

  const other = await staff('otherDirector');
  const o = await call(other, 'reset-student-password', { course_offering_id: OFF215, student_id: 3000000101 });
  check('a director of another course cannot reset this course\'s cadets',
        /not assigned to this course/i.test(o.error || ''), JSON.stringify(o));

  const good = await call(inst, 'reset-student-password', { course_offering_id: OFF215, student_id: 3000000106 });
  check('an instructor of the offering can reset a cadet to the default', good.success === true, JSON.stringify(good));
  const c = makeClient();
  const { error: signErr } = await c.auth.signInWithPassword({ email: 'cadet106@prep-staging.example', password: '000106' });
  check('…and that cadet signs in with the default', !signErr, signErr?.message);
}

section('reset-staff-password');
{
  const inst = await staff('instructor');
  const adminId = (await (await staff('admin')).from('instructors').select('id, name').eq('name', 'Pat Admin')).data?.[0]?.id;
  const r = await call(inst, 'reset-staff-password', { course_offering_id: OFF215, instructor_id: adminId });
  check('an instructor cannot reset a staff password', !!r.error && !r.success, JSON.stringify(r));
  const d = await call(dir, 'reset-staff-password',
    { course_offering_id: OFF215, instructor_id: adminId, password: 'chosen-by-caller' });
  check('a request carrying a password is rejected', /password/i.test(d.error || '') && !d.success, JSON.stringify(d));
  const d2 = await call(dir, 'reset-staff-password', { course_offering_id: OFF215, instructor_id: adminId });
  check('a director cannot reset a system admin', !!d2.error && !d2.success, JSON.stringify(d2));
}

section('create-instructor / remove-instructor');
{
  const inst = await staff('instructor');
  const r = await call(inst, 'create-instructor',
    { name: 'Nobody Madeup', email: 'nobody@prep-staging.example', role: 'instructor', course_offering_id: OFF215 });
  check('an instructor cannot create staff', !!r.error && !r.success, JSON.stringify(r));
  const o = await call(await staff('otherDirector'), 'create-instructor',
    { name: 'Nobody Madeup', email: 'nobody@prep-staging.example', role: 'director', course_offering_id: OFF215 });
  check('a director of another course cannot create staff here', !!o.error && !o.success, JSON.stringify(o));
  const g = await call(dir, 'create-instructor',
    { name: 'Nobody Madeup', email: 'nobody@prep-staging.example', role: 'grader', course_offering_id: OFF215 });
  check('the retired grader role is refused', /retired/i.test(g.error || ''), JSON.stringify(g));
  const rm = await call(inst, 'remove-instructor', { instructor_id: '00000000-0000-0000-0000-000000000000', course_offering_id: OFF215 });
  check('an instructor cannot remove staff', !!rm.error && !rm.success, JSON.stringify(rm));
}

section('provision-students');
{
  const { client: stu } = await signInAsTestStudent();
  const r = await call(stu, 'provision-students', { course_offering_id: OFF215 });
  check('a cadet cannot provision accounts', !!r.error && !r.success, JSON.stringify(r));
  const i = await call(await staff('instructor'), 'provision-students', { course_offering_id: OFF215 });
  check('an instructor cannot provision accounts', !!i.error && !i.success, JSON.stringify(i));
}

section('set-own-password');
{
  const { client: stu } = await signInAsTestStudent();
  const short = await call(stu, 'set-own-password', { current_password: '999999', new_password: 'short' });
  check('a too-short new password is refused', /at least/i.test(short.error || ''), JSON.stringify(short));
  const wrong = await call(stu, 'set-own-password', { current_password: 'not-the-password', new_password: 'longenough-but-unused' });
  check('a wrong current password is refused', /not your current password/i.test(wrong.error || ''), JSON.stringify(wrong));
  const none = await call(makeClient(), 'set-own-password', { new_password: 'longenough-but-unused' });
  check('an unauthenticated caller is refused', !!none.error && !none.success, JSON.stringify(none));
}

section('log-tutor-error');
{
  // Public by design (standalone backup lessons have no session). Only the refusal path is
  // exercised, so no row is written: an empty body must be rejected by validation.
  const res = await fetch(`${SUPABASE_URL}/functions/v1/log-tutor-error`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
    body: '{}',
  });
  const body = await res.json().catch(() => ({}));
  check('an empty report is not stored', !(body && body.success === true), `${res.status} ${JSON.stringify(body)}`);
}

section('proxies (not deployed to staging)');
skip('asksage-proxy', 'not deployed to staging; needs an external key');
skip('genai-mil-proxy', 'not deployed to staging; needs an external key');

process.exit(summary() ? 0 : 1);
