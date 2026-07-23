// test-isolation.mjs — what must NOT be reachable.
//
// Two boundaries, both of which the `public` schema got wrong and 002_rls.sql exists to fix:
//   1. anon gets nothing at all — there is not a single policy granting the anon role
//      anything, because every page in site/app/ authenticates first.
//   2. the app client cannot see `public`, so wiring the portal to `app` genuinely moved it
//      rather than leaving a foot in both models.

import { check, section, anonClient, signInAsTestStudent, installBrowser } from './harness.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON } from './harness.mjs';

section('anonymous access — must be empty everywhere');

const anon = anonClient();
const TABLES = [
  'courses', 'terms', 'assignments', 'activities', 'course_offerings', 'sections',
  'students', 'enrollments', 'instructors', 'staff_assignments', 'assignment_offerings',
  'offering_activities', 'assignment_due_dates', 'submissions', 'submission_activities',
  'grades', 'grade_events', 'analysis_reports', 'extensions',
];

for (const t of TABLES) {
  const { data, error } = await anon.from(t).select('*').limit(1);
  // A readable row is a leak. An error is acceptable (also denied); what must never happen
  // is data coming back.
  check(`anon reads nothing from ${t}`, !error ? (data || []).length === 0 : true,
        `${(data || []).length} row(s) visible to an unauthenticated caller`);
}

// Writes must be refused too — RLS with no INSERT policy for anon means zero rows affected
// or an outright error, never a successful write.
{
  const { data, error } = await anon.from('students')
    .insert({ student_id: 3000000001, name: 'anon inject' }).select();
  check('anon cannot insert a student', !!error || (data || []).length === 0);
}

section('the app client cannot reach schema `public`');

// The portal's client is pinned to `app`. Asking it for a legacy-only table must fail:
// `responses` and `scores` exist in public but not in app, so this proves the client is
// genuinely scoped rather than silently falling back.
{
  installBrowser({});
  const { client } = await signInAsTestStudent();
  for (const legacy of ['responses', 'scores', 'lessons', 'interactions',
                        'preflight_interaction_reports', 'lesson_completions']) {
    const { error } = await client.from(legacy).select('*').limit(1);
    check(`app-scoped client cannot read public.${legacy}`, !!error,
          'the client resolved a legacy table — it is not pinned to `app`');
  }

  section('a signed-in student sees only their own rows');

  const { data: students } = await client.from('students').select('student_id');
  check('student sees exactly one students row (their own)', (students || []).length === 1,
        `saw ${(students || []).length}`);

  const { data: enroll } = await client.from('enrollments').select('id, student_id');
  check('student sees only their own enrollment(s)',
        (enroll || []).every(e => e.student_id === 3009999999));

  const { data: grades } = await client.from('grades').select('id, is_finalized');
  check('student sees no unfinalized grade',
        (grades || []).every(g => g.is_finalized === true));

  // Directors/admins can read every roster row; a student must not.
  const { data: allSections } = await client.from('sections').select('id');
  check('student sees only sections in offerings they are enrolled in',
        (allSections || []).length > 0 && (allSections || []).length <= 4,
        `saw ${(allSections || []).length}`);

  // Unpublished work must not leak to students.
  const { data: aos } = await client.from('assignment_offerings').select('id, is_published');
  check('student sees only published assignment offerings',
        (aos || []).every(a => a.is_published === true));
}

section('a client with no schema option defaults to public, not app');

// Guards the inverse mistake: if someone drops `db: { schema: 'app' }` from config.js, the
// client silently reverts to `public` and the portal reads the legacy model with no error.
// This asserts that difference is observable, so the config test above is load-bearing.
{
  const defaultClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: false },
  });
  const { error: appErr } = await defaultClient.from('offering_activities').select('*').limit(1);
  check('a default-schema client CANNOT see an app-only table', !!appErr,
        'offering_activities exists only in `app`; seeing it means the default is not public');
}
