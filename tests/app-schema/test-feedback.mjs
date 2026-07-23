// test-feedback.mjs — the feedback widget's pure logic (js/feedback.js).
//
// The DOM widget and the live insert are covered elsewhere: app_rls_test.py proves a user can only
// file feedback as themselves and that non-admins cannot read it, and the P0.5-style signed-in pass
// proves the box mounts and a submission lands in app.feedback. What is left, and what this suite
// pins, is the pure part that decides WHAT gets written and WHETHER the form is allowed to send —
// because a validation rule that drifts from the migration-012 CHECKs would let the UI accept a row
// the database then rejects, and the person would see a Postgres error instead of a sentence.

import { check, eq, section, summary, installBrowser, makeClient } from './harness.mjs';

// feedback.js imports util.js only at module scope, but nav.js (which this mirrors) pulls the
// supabase-touching chain; install the browser + a client so the import graph is happy under Node.
installBrowser({ pathname: '/site/app/faculty/gradebook.html' });
globalThis.window.db = makeClient();

const F = await import('../../site/app/js/feedback.js');

/* ══════════════════════════════════════════════════════════════════════════ */
section('categories — the six the migration CHECK allows, and no more');

const KEYS = F.FEEDBACK_CATEGORIES.map((c) => c.key);
eq('exactly the six categories, in order', KEYS,
   ['like', 'dislike', 'feature', 'add', 'remove', 'other']);
check('every category has a label and an icon',
      F.FEEDBACK_CATEGORIES.every((c) => c.label && c.icon));

/* ══════════════════════════════════════════════════════════════════════════ */
section('validateFeedback — mirrors the migration-012 constraints');

eq('a valid submission passes', F.validateFeedback({ category: 'feature', message: 'Add CSV export' }), null);
check('no category is rejected', !!F.validateFeedback({ category: null, message: 'hi' }));
check('a category outside the six is rejected',
      !!F.validateFeedback({ category: 'rave', message: 'hi' }));
check('an empty message is rejected', !!F.validateFeedback({ category: 'like', message: '' }));
check('a whitespace-only message is rejected (matches the btrim CHECK)',
      !!F.validateFeedback({ category: 'like', message: '   ' }));
check('a message over 4000 chars is rejected (matches the length CHECK)',
      !!F.validateFeedback({ category: 'like', message: 'x'.repeat(4001) }));
eq('exactly 4000 chars is allowed', F.validateFeedback({ category: 'like', message: 'x'.repeat(4000) }), null);
check('every rejection returns a human sentence, not a boolean',
      typeof F.validateFeedback({ category: 'like', message: '' }) === 'string');

/* ══════════════════════════════════════════════════════════════════════════ */
section('feedbackRow — identity, page, and trimming');

const ctx = {
  user: { id: '11111111-1111-1111-1111-111111111111' },
  role: 'faculty',
  instructorRow: { name: 'Dr. Ada Byron' },
};

{
  const row = F.feedbackRow(ctx, {
    category: 'add', message: '  please add a dark-mode chart  ',
    page: '/site/app/faculty/gradebook.html', pageTitle: 'Gradebook · PREP',
    userAgent: 'Mozilla/5.0 test',
  });
  eq('submitted_by is the auth uid — identity the DB will re-check', row.submitted_by, ctx.user.id);
  eq('the readable name is captured as a hint', row.submitter_name, 'Dr. Ada Byron');
  eq('role rides along', row.role, 'faculty');
  eq('the page path is recorded', row.page, '/site/app/faculty/gradebook.html');
  eq('the page title is recorded', row.page_title, 'Gradebook · PREP');
  eq('category passes through', row.category, 'add');
  eq('the message is trimmed', row.message, 'please add a dark-mode chart');
  check('user agent is captured (and bounded)', row.user_agent === 'Mozilla/5.0 test');
}

{
  // A student submitter: the name comes from studentRow, role is student.
  const srow = F.feedbackRow(
    { user: { id: 'abc' }, role: 'student', studentRow: { name: 'Cadet Reyes' } },
    { category: 'like', message: 'clear', page: '/x', pageTitle: 'X' });
  eq('a student name is read from studentRow', srow.submitter_name, 'Cadet Reyes');
  eq('student role rides along', srow.role, 'student');
}

{
  // Degradation: an anonymous/unknown ctx must not throw — the mount guard blocks this in practice,
  // but the builder should still be total.
  const bare = F.feedbackRow(null, { category: 'other', message: 'hi', page: '/p' });
  eq('a null ctx yields a null submitter rather than throwing', bare.submitted_by, null);
  eq('and a null name', bare.submitter_name, null);
  eq('a very long user agent is capped at 500 chars',
     F.feedbackRow(ctx, { category: 'like', message: 'x', page: '/p', userAgent: 'u'.repeat(900) })
       .user_agent.length, 500);
}

summary();
