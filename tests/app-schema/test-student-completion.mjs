// test-student-completion.mjs — the completion invariant on the student lesson view.
//
// WHY THIS EARNS ITS PLACE
//   On 2026-08-10 six cadets reported that PREP would not load. The page showed
//   "Cannot read properties of null (reading 'path')" and nothing else — not a broken lesson
//   card, the WHOLE dashboard, because main() renders every row in one template literal with no
//   per-row try/catch. Thirty-nine cadets across phys-110 and phys-215 were affected.
//
//   The cause was two derivations of the same fact that could disagree:
//
//     resolveState()     said GRADED  from item.grade.is_finalized
//     the completion     said null    from item.submission.status === 'committed'
//
//   Those agree for every cadet who submits. They disagree for every cadet who does NOT:
//   /preflight-analyze zeroes each non-submitter once a deadline passes and finalizes that zero,
//   producing a finalized grade with no submission row at all. So the bug was dormant until the
//   first at-scale zeroing run — the 10:36 scheduled phys-110 close-out — and then hit every
//   cadet who had missed preflight-02 at once. Nothing was wrong with the data.
//
//   Both derivations are now exported, and what is pinned below is the RELATIONSHIP between
//   them, not either one alone. Testing deriveCompletion() against its own idea of the states
//   would have proved nothing here: each function was self-consistent and correct in isolation.
//
// Offline and pure — no session, no network. student-lessons.js imports schema.js and
// student-data.js, which need window.db present at import; nothing here reaches the network.

import { check, eq, section, summary, installBrowser, makeClient } from './harness.mjs';

installBrowser({ pathname: '/site/student/dashboard.html' });
globalThis.window.db = makeClient();

const L = await import('../../site/js/student-lessons.js');
const { STATE, resolveState, deriveCompletion } = L;

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

// Enough of a stitched item for both rules; `pointsPossible`/`gradingMode` feed displayPoints.
const item = (over = {}) => ({
  pointsPossible: 2, gradingMode: 'points', isPast: true, answered: 0,
  submission: null, chosenActivity: null, grade: null, ...over,
});

const finalZero = { is_finalized: true, points_earned: 0, diagnostic: { no_submission: true } };
const finalFull = { is_finalized: true, points_earned: 2, diagnostic: { overall_understanding: 4 } };
const suggested = { is_finalized: false, points_earned: 2 };

const committedSub = { status: 'committed', committedAt: '2026-08-09T05:58:00.000Z' };
const draftSub     = { status: 'draft', committedAt: null };

/* ── The invariant ─────────────────────────────────────────────────────────── */

section('STATE.GRADED implies a non-null completion');

// The exact shape that took the site down: deadline passed, cadet submitted nothing,
// /preflight-analyze wrote and finalized a zero.
// Read through `?.` throughout: when the invariant breaks, these assertions must REPORT it, not
// reproduce the production crash and abort the suite on the first line.
const noSubmission = item({ grade: finalZero });
const noSubC = deriveCompletion(noSubmission);
eq('a finalized zero with no submission is GRADED', resolveState(noSubmission), STATE.GRADED);
check('…and still yields a completion, which is what the renderers require', noSubC !== null);
eq('…worth zero points', noSubC?.points, 0);
eq('…naming no path, because no work was submitted to take one', noSubC?.path, null);

// The same disagreement one step less obvious: a draft that was never committed, graded anyway.
const draftGraded = item({ submission: draftSub, grade: finalFull });
const draftC = deriveCompletion(draftGraded);
eq('a finalized grade over an uncommitted draft is GRADED', resolveState(draftGraded), STATE.GRADED);
check('…also yields a completion', draftC !== null);
eq('…and names the written path, since there IS written work', draftC?.path, 'preflight');

// Swept, rather than enumerated by hand: the invariant must hold for every combination, not
// only for the two that happened to break. A future edit to either rule fails here.
section('the invariant holds across every submission x grade combination');
let checked = 0, broken = [];
for (const sub of [null, draftSub, committedSub]) {
  for (const grade of [null, suggested, finalZero, finalFull]) {
    for (const chosen of [null, { modality: 'written' }, { modality: 'interactive' }]) {
      for (const isPast of [true, false]) {
        const it = item({ submission: sub, grade, chosenActivity: chosen, isPast });
        checked++;
        if (resolveState(it) === STATE.GRADED && deriveCompletion(it) === null) {
          broken.push({ sub: sub?.status ?? null, finalized: grade?.is_finalized ?? null, isPast });
        }
      }
    }
  }
}
check(`GRADED never yields a null completion (${checked} combinations)`, broken.length === 0,
      JSON.stringify(broken.slice(0, 4)));

/* ── The behaviour the invariant must not have changed ─────────────────────── */

section('the ordinary paths are untouched');

const wrote = deriveCompletion(item({ submission: committedSub, chosenActivity: { modality: 'written' }, grade: finalFull }));
eq('a committed written submission still completes as preflight', wrote?.path, 'preflight');
eq('…carrying its points', wrote?.points, 2);
// The diagnostic is faculty-side and the student grade select stopped fetching it (2026-08-10),
// so completion must not carry a field derived from it — a null that looks like a real reading is
// worse than its absence. Asserted as absent, not as null, so re-adding it fails here.
check('…and NOT the understanding diagnostic, which students never see',
      !('understanding' in (wrote || {})));
eq('…and when it committed', wrote?.completed_at, '2026-08-09T05:58:00.000Z');

const played = deriveCompletion(item({ submission: committedSub, chosenActivity: { modality: 'interactive' }, grade: finalFull }));
eq('a committed interactive submission completes as interaction', played?.path, 'interaction');

// A committed submission with no chosen activity is the pre-2026-08-10 default and must stay
// 'preflight' — the null path is ONLY for the case where no submission exists at all.
const bare = deriveCompletion(item({ submission: committedSub, grade: finalFull }));
eq('a committed submission with no chosen activity is still preflight', bare?.path, 'preflight');

section('a lesson still in play has no completion');
eq('nothing submitted, still open', deriveCompletion(item({ isPast: false })), null);
eq('a draft with no grade', deriveCompletion(item({ submission: draftSub, isPast: false })), null);
eq('a SUGGESTED grade is not a completion — the student cannot see it yet',
   deriveCompletion(item({ submission: draftSub, grade: suggested })), null);
eq('…and the state agrees it is not graded',
   resolveState(item({ submission: draftSub, grade: suggested, isPast: true })), STATE.MISSED);

process.exit(summary() ? 0 : 1);
