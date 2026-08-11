// test-run-banner.mjs — what the automated-run status strip decides to show.
//
// bannerFor() is pure and carries all the judgement: which run states are worth interrupting a
// director for, which are normal, and how "until corrected" resolves without an explicit clear.
// The DOM half is trivial by comparison and is not covered here.

import { eq, section, installBrowser, summary } from './harness.mjs';

// run-banner.js pulls esc() from util.js, which reads `location` at module scope. bannerFor
// itself touches neither the DOM nor a database — the stub is only to get the import through.
installBrowser();

const { bannerFor } = await import('../../site/js/run-banner.js');

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

// WHAT 'partial' HAS TO MEAN FOR THAT TO BE RIGHT (2026-08-11)
//   Yellow is only affordable when it means "somebody must do something". The writer therefore
//   splits the two ways the whole-course scope can be missing: a first-track run deferring it to
//   the second track is the two-run cycle working and records 'success'; a deferral nothing will
//   clear on its own records 'partial'. It recorded 'partial' for both until 2026-08-11, so about
//   half of all nightly runs raised a warning for a healthy state.
const firstTrack = run({
  status: 'success',
  summary: 'Aggregated 9 sections and 4 instructor summaries. The whole-course summary waits on '
         + 'the T-day track — normal until that deadline passes.',
});
eq('a first-track deferral arrives as success and shows green',
   bannerFor(firstTrack, 'Physics 110')?.level, 'success');
eq('…carrying the sentence the writer composed, unaltered',
   bannerFor(firstTrack, 'Physics 110')?.text, firstTrack.summary);

// The summary IS the banner text, so a scope key in it is a scope key on a director's screen.
// This is the regression the complaint was about: 12 section uuids resolved to codes, and 4
// instructor scopes that resolve to nothing, printed as 'instr:<uuid>'.
const actionable = run({
  status: 'partial',
  summary: 'Aggregated 12 sections and 4 instructor summaries. The whole-course summary is still '
         + 'owed: M1A was aggregated before that work changed, and must be re-run before the '
         + 'course can be summarized.',
});
eq('an actionable deferral still warns', bannerFor(actionable, 'Physics 110')?.level, 'warn');
eq('…and carries no scope key a person cannot read',
   /instr:|[0-9a-f]{8}-[0-9a-f]{4}/.test(bannerFor(actionable, 'Physics 110').text), false);

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
