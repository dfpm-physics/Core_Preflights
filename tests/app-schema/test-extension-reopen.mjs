// test-extension-reopen.mjs — when granting an extension takes a published grade back down.
//
// WHY THIS EARNS ITS PLACE
//   A finalized grade outranks the deadline on every student surface: resolveState() reads
//   `is_finalized` before anything else, and the assignment page branches on that state before it
//   ever consults `isPast`. So the read-only lock an extension exists to lift sits in a branch a
//   graded student never reaches. Granting an extension to a graded cadet moved a date nothing
//   looked at — the chip rendered, the director's extensions report counted it, and the cadet
//   stayed locked out. The documented workaround was "reopen first, then extend": a two-step whose
//   first step, when forgotten, fails silently and looks exactly like success.
//
//   setExtension() now does the reopen itself. That is the easy half. The half worth pinning is
//   WHEN IT MUST NOT, because reopening does two things and only one of them is implied by
//   granting an extension:
//
//     it lets the student work again            — what the grader asked for
//     it removes their score from their view    — grades_own_finalized stops returning the row
//
//   The case that separates those is a cadet who handed work in late, was graded, and is granted
//   an extension afterwards so the record shows the lateness forgiven. Nothing is waiting to be
//   resubmitted there, and retracting a correct published grade over a bookkeeping fix is a
//   surprise the cadet meets before the grader does.
//
//   Two facts decide it — is the new deadline in the future, and is anything committed — and both
//   are asserted below in every combination rather than only in the two that motivated the rule.
//
// Offline and pure — no session, no network. faculty-grade.js needs window.db at import time;
// nothing here reaches it, because extensionReopensGrade() is the rule with the database removed.

import { check, eq, section, summary, installBrowser, makeClient } from './harness.mjs';

installBrowser({ pathname: '/site/faculty/grade.html' });
globalThis.window.db = makeClient();

const { extensionReopensGrade } = await import('../../site/js/faculty-grade.js');

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

const NOW = Date.parse('2026-08-12T18:00:00.000Z');
const future = '2026-08-19T05:59:00.000Z';
const past   = '2026-08-05T05:59:00.000Z';

const finalZero = { is_finalized: true };    // the /preflight-analyze non-submitter zero
const finalFull = { is_finalized: true };    // an instructor's full credit — same shape, same rule
const suggested = { is_finalized: false };   // written but not published

const committedSub = { status: 'committed' };
const draftSub     = { status: 'draft' };

const reopens = (facts) => extensionReopensGrade(facts, NOW);

/* ── The case the change exists for ────────────────────────────────────────── */

section('a future extension re-opens a published grade the cadet cannot work past');

check('finalized zero, nothing ever submitted — the lockout case',
      reopens({ iso: future, grade: finalZero, submission: null }));
check('finalized grade over an uncommitted draft — started, never handed in',
      reopens({ iso: future, grade: finalFull, submission: draftSub }));

/* ── The cases it must leave alone ─────────────────────────────────────────── */

section('a published grade stays published when the extension cannot mean "let them work"');

check('back-dated: forgiving lateness that already happened, not giving time',
      !reopens({ iso: past, grade: finalZero, submission: null }));
check('already committed: the work is in, so the extension is clearing a late flag',
      !reopens({ iso: future, grade: finalFull, submission: committedSub }));
check('back-dated AND committed — the retroactive med-clinic note, both guards agreeing',
      !reopens({ iso: past, grade: finalFull, submission: committedSub }));

section('nothing to take down is not the same as declining to');

check('no grade row at all', !reopens({ iso: future, grade: null, submission: null }));
check('a suggested grade is not published, so there is nothing to retract',
      !reopens({ iso: future, grade: suggested, submission: null }));
check('a suggested grade over a draft — the ordinary mid-term state',
      !reopens({ iso: future, grade: suggested, submission: draftSub }));

section('a date that is not a date never re-opens anything');

for (const iso of [null, undefined, '', 'next tuesday', 'NaN']) {
  check(`unparseable date (${JSON.stringify(iso)}) is refused`,
        !reopens({ iso, grade: finalZero, submission: null }));
}
check('the deadline instant itself does not count as future',
      !reopens({ iso: new Date(NOW).toISOString(), grade: finalZero, submission: null }));

/* ── The two call sites must agree ─────────────────────────────────────────── */
//
// reopenForExtension() asks this twice: once on `iso` alone to skip two reads when the date
// already settles it, then again with the rows. If the date-only probe ever answered `false`
// where the full call would answer `true`, the reopen would be skipped without either read
// happening and the failure would be invisible — the extension still lands, so nothing errors.

section('the date-only probe never rules out a case the full call would re-open');

let checked = 0; const disagreed = [];
for (const iso of [future, past, '', 'not-a-date']) {
  for (const grade of [null, suggested, finalZero, finalFull]) {
    for (const submission of [null, draftSub, committedSub]) {
      checked++;
      if (reopens({ iso, grade, submission }) && !reopens({ iso })) {
        disagreed.push({ iso, finalized: grade?.is_finalized ?? null, sub: submission?.status ?? null });
      }
    }
  }
}
check(`probe is never stricter than the full rule (${checked} combinations)`,
      disagreed.length === 0, JSON.stringify(disagreed.slice(0, 4)));

// And the probe is only ever a probe: on its own it must not be read as a decision to reopen a
// grade that is not published. A missing `grade` key means "not read yet"; an explicit null does
// not, and that distinction is what keeps the two calls safe to write in either order.
eq('a missing grade key passes the probe', reopens({ iso: future }), true);
eq('an explicit null grade does not', reopens({ iso: future, grade: null }), false);

process.exit(summary() ? 0 : 1);
