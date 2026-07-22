// test-run-banner.mjs — what the automated-run status strip decides to show.
//
// bannerFor() is pure and carries all the judgement: which run states are worth interrupting a
// director for, which are normal, and how "until corrected" resolves without an explicit clear.
// The DOM half is trivial by comparison and is not covered here.

import { eq, section, installBrowser, summary } from './harness.mjs';

// run-banner.js pulls esc() from util.js, which reads `location` at module scope. bannerFor
// itself touches neither the DOM nor a database — the stub is only to get the import through.
installBrowser();

const { bannerFor } = await import('../../site/app/js/run-banner.js');

const hoursAgo = h => new Date(Date.now() - h * 36e5).toISOString();

const run = (over = {}) => ({
  id: 'r1', skill: 'lesson-cycle', invoked_by: 'scheduled', status: 'success',
  started_at: hoursAgo(6), finished_at: hoursAgo(5),
  summary: 'Graded 32; wrote M1A, M3A.', error: null, ...over,
});

section('bannerFor — which run states are worth telling a director about');

eq('a recent success shows, with its own summary',
   bannerFor(run(), 'Physics 215')?.text, 'Graded 32; wrote M1A, M3A.');
eq('…at success level', bannerFor(run(), 'Physics 215')?.level, 'success');
eq('…labelled with the course, since a director may direct several',
   bannerFor(run(), 'Physics 215')?.course, 'Physics 215');

// A success is news for a day. Past that it is just history, and the rollup itself is the record.
eq('a success older than the window stops showing',
   bannerFor(run({ started_at: hoursAgo(40), finished_at: hoursAgo(39) }), 'P215'), null);

eq('a failure shows the error, not the summary',
   bannerFor(run({ status: 'failed', error: 'Deadline check failed: T3A still open.' }), 'P215')?.text,
   'Deadline check failed: T3A still open.');
eq('…at error level',
   bannerFor(run({ status: 'failed', error: 'x' }), 'P215')?.level, 'error');

// No upper age bound on the alert side: "until corrected" means exactly that. A three-week-old
// failure that nothing has superseded is still the truth about that course.
eq('an OLD failure still shows — it has not been corrected',
   bannerFor(run({ status: 'failed', error: 'boom', started_at: hoursAgo(500),
                   finished_at: hoursAgo(500) }), 'P215')?.level, 'error');

eq('a partial run warns rather than alarms',
   bannerFor(run({ status: 'partial', summary: "'__all__' deferred." }), 'P215')?.level, 'warn');

// The row is written BEFORE the work starts (migration 009) precisely so a crash is visible.
eq('a run still "running" long after it started is treated as a failure',
   bannerFor(run({ status: 'running', finished_at: null, started_at: hoursAgo(9) }), 'P215')?.level,
   'error');
eq('…but one inside its window is simply in progress, and says nothing',
   bannerFor(run({ status: 'running', finished_at: null, started_at: hoursAgo(0.2) }), 'P215'),
   null);

// 'skipped' is a CORRECT outcome — the deadline had not passed, or there was nothing to grade.
// Surfacing it would train directors to ignore the strip.
eq('a correctly-skipped run says nothing', bannerFor(run({ status: 'skipped' }), 'P215'), null);

eq('no run at all says nothing', bannerFor(null, 'P215'), null);

process.exitCode = summary() ? 0 : 1;
