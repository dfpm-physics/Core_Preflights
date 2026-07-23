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
section('categories — the DB-valid set, and the two shown sentiments');

eq('the DB-parity set is exactly the migration-012 CHECK values', F.FEEDBACK_CATEGORIES,
   ['like', 'dislike', 'feature', 'add', 'remove', 'other']);
eq('the panel shows only the two sentiments', F.FEEDBACK_SENTIMENTS.map((s) => s.key),
   ['like', 'dislike']);
check('each sentiment has a label and an icon',
      F.FEEDBACK_SENTIMENTS.every((s) => s.label && s.icon));

/* ══════════════════════════════════════════════════════════════════════════ */
section('validateFeedback — the comment is the only required field');

// Sentiment is optional now, so validation is about the message alone — the category default is
// feedbackRow's job, tested below.
eq('a comment with no sentiment passes', F.validateFeedback({ message: 'Add CSV export' }), null);
check('an empty message is rejected', !!F.validateFeedback({ message: '' }));
check('a whitespace-only message is rejected (matches the btrim CHECK)',
      !!F.validateFeedback({ message: '   ' }));
check('a message over 4000 chars is rejected (matches the length CHECK)',
      !!F.validateFeedback({ message: 'x'.repeat(4001) }));
eq('exactly 4000 chars is allowed', F.validateFeedback({ message: 'x'.repeat(4000) }), null);
check('a rejection returns a human sentence, not a boolean',
      typeof F.validateFeedback({ message: '' }) === 'string');

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
  // Category defaulting — the NOT NULL + CHECK column must always get an accepted value even when
  // the person left the sentiment untouched.
  eq('no sentiment defaults the category to other',
     F.feedbackRow(ctx, { message: 'just a comment', page: '/p' }).category, 'other');
  eq('a null category defaults to other',
     F.feedbackRow(ctx, { category: null, message: 'x', page: '/p' }).category, 'other');
  eq('a stray category is coerced to other (never sent raw to the CHECK)',
     F.feedbackRow(ctx, { category: 'rave', message: 'x', page: '/p' }).category, 'other');
  eq('a real sentiment passes through', F.feedbackRow(ctx, { category: 'like', message: 'x', page: '/p' }).category, 'like');
  eq('the fuller set is still accepted for a future control',
     F.feedbackRow(ctx, { category: 'add', message: 'x', page: '/p' }).category, 'add');
}

{
  // Degradation: an anonymous/unknown ctx must not throw — the mount guard blocks this in practice,
  // but the builder should still be total.
  const bare = F.feedbackRow(null, { message: 'hi', page: '/p' });
  eq('a null ctx yields a null submitter rather than throwing', bare.submitted_by, null);
  eq('and a null name', bare.submitter_name, null);
  eq('a very long user agent is capped at 500 chars',
     F.feedbackRow(ctx, { message: 'x', page: '/p', userAgent: 'u'.repeat(900) })
       .user_agent.length, 500);
}

summary();
