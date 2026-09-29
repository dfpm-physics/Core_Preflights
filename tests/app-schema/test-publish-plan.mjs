// test-publish-plan.mjs — the rule both publish buttons run, and the writes they issue.
//
// WHY THIS EARNS ITS PLACE
//   On 2026-09-29 three faults were found behind one symptom — blank cells in every Blackboard
//   export — and one fault behind the opposite symptom:
//
//     - Finalize never published a no-submission zero on a lesson with an iPREP option (it sends
//       edited rows only from those cards), so 351 phys-110 and 212 phys-215 zeros sat unpublished.
//     - A cadet with no grade row at all stayed blank for good (all of Lesson 7, in both courses).
//     - Save draft re-sent every graded card with `is_finalized: false`, published ones included:
//       one press on "All sections" un-published 117 grades across six instructors' sections.
//     - A zero written before a cadet handed in under an extension was re-published over their work
//       by the next Finalize — six cadets across both courses.
//
//   planPublish() is the one rule both buttons now run. Every branch below is a way to publish the
//   wrong thing or zero the wrong cadet, so each is asserted on its own, and the negative cases —
//   what must NOT be published — matter more than the positive ones.
//
// Offline. window.db is a RECORDING stub (the pattern of test-grade-effort-write.mjs), so the write
// assertions are about the exact queries issued, not about a database's reply.

import { check, eq, section, summary, installBrowser } from './harness.mjs';

installBrowser({ pathname: '/site/faculty/admin.html' });

let CALLS = [];
const stubFrom = (table) => {
  const call = { table, verb: 'select', payload: null, opts: null, filters: [] };
  const c = {};
  for (const m of ['eq', 'in', 'is', 'not', 'neq', 'gt', 'lt', 'gte', 'lte', 'order', 'limit',
                   'filter', 'or', 'select', 'range', 'maybeSingle'])
    c[m] = (...args) => { if (m === 'eq' || m === 'in' || m === 'is') call.filters.push([m, ...args]); return c; };
  for (const verb of ['insert', 'update', 'upsert', 'delete'])
    c[verb] = (payload, opts) => {
      call.verb = verb; call.payload = payload; call.opts = opts || null; CALLS.push(call); return c;
    };
  // An update answers one row per id it was filtered to; an insert/upsert one per payload row; a
  // read answers nothing, which is the empty course the offline suite wants.
  c.then = (res) => {
    let data = [];
    if (call.verb === 'update') {
      const ids = call.filters.find(f => f[0] === 'in' && f[1] === 'id')?.[2] || [];
      data = ids.map(id => ({ id, assignment_offering_id: 'off-1' }));
    } else if (Array.isArray(call.payload)) {
      data = call.payload.map((r, i) => ({ id: `new-${table}-${i}`, assignment_offering_id: r.assignment_offering_id }));
    }
    return res({ data, error: null });
  };
  return c;
};
globalThis.window.db = { from: stubFrom };

const G = await import('../../site/js/faculty-grade.js');

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

// Lesson 17: the M-day sections were due 23 Sep 23:59:59 Denver, the T-day sections a day later.
const M_DUE = '2026-09-24T05:59:59.000Z';
const T_DUE = '2026-09-25T05:59:59.000Z';
const NOW = new Date('2026-09-29T18:00:00.000Z');
const FUTURE = '2026-10-02T05:59:59.000Z';

const OFF = {
  id: 'off-1', slug: 'preflight-17', title: 'Lesson 17 Preflight', position: 17,
  dueAt: M_DUE, dueBySection: { 'sec-M': M_DUE, 'sec-T': T_DUE },
  writtenActivityId: 'act-w',
  questions: [{ id: 'q1', points: 0 }, { id: 'q2', points: 1 }, { id: 'q3', points: 1 }],
  pointsPossible: 2,
};
const st = (n, sec = 'sec-M') => ({ student_id: 3000000000 + n, name: `Fixture, Cadet ${n}`,
                                    enrollment_id: `enr-${n}`, section_id: sec });
const sub = (n, extra = {}) => ({ id: `sub-${n}`, enrollment_id: `enr-${n}`, assignment_offering_id: 'off-1',
                                  chosen_activity_id: 'act-w', status: 'committed',
                                  committed_at: '2026-09-23T20:00:00.000Z', ...extra });
const grade = (n, extra = {}) => ({ id: `g-${n}`, enrollment_id: `enr-${n}`, assignment_offering_id: 'off-1',
                                    is_finalized: false, points_earned: 2, source: 'ai_suggested',
                                    graded_at: '2026-09-24T07:18:00.000Z', nosub: false, ...extra });
const ANSWERS = { q1: 'About 20 minutes', q2: 'A question about the reading', q3: 'An answer' };
// Handed in under an extension, two days after the AI's zero was written.
const LATE_WORK = { committed_at: '2026-09-26T12:00:00.000Z' };

/** Plan one cadet in isolation and return the single item (or null). */
function one(data, now = NOW) {
  const items = G.planPublish({ offerings: [OFF], canZero: true, writtenContent: {}, siblings: [],
                                submissions: [], grades: [], extensions: [], ...data }, now);
  return items.length ? items[0] : null;
}
const kindOf = (it) => it ? (it.reason ? `${it.kind}:${it.reason}` : it.kind) : 'nothing';

/* ── The rule ──────────────────────────────────────────────────────────────── */

section('saved grades that are due are published');

eq('an AI draft on work handed in on time is published',
   kindOf(one({ students: [st(1)], submissions: [sub(1)], grades: [grade(1)] })), 'publish');
eq('an interactive grade left unpublished (reopened, never re-published) is published',
   kindOf(one({ students: [st(2)],
                submissions: [sub(2, { chosen_activity_id: 'act-i', committed_at: '2026-09-23T21:00:00.000Z' })],
                grades: [grade(2, { graded_at: '2026-09-23T21:00:01.000Z' })] })), 'publish');
eq('the AI zero for a cadet who handed in nothing is published',
   kindOf(one({ students: [st(3)], grades: [grade(3, { nosub: true, points_earned: 0 })] })), 'publish');
eq('an instructor draft for a cadet with no submission is published — their saved decision',
   kindOf(one({ students: [st(4)], grades: [grade(4, { points_earned: 2 })] })), 'publish');

section('what is already published is never touched');

eq('a published grade produces nothing',
   kindOf(one({ students: [st(5)], submissions: [sub(5)], grades: [grade(5, { is_finalized: true })] })), 'nothing');
eq('a published zero with no work behind it produces nothing',
   kindOf(one({ students: [st(6)], grades: [grade(6, { is_finalized: true, nosub: true, points_earned: 0 })] })), 'nothing');
eq('a published zero on work that came in AFTER it is REPORTED, not changed',
   kindOf(one({ students: [st(7)], submissions: [sub(7, LATE_WORK)], writtenContent: { 'sub-7': ANSWERS },
                grades: [grade(7, { is_finalized: true, nosub: true, points_earned: 0 })] })), 'wrong-published');
// The dry run against live data found 48 of these: the flag outlives a re-grade, because
// gradeRows() never sends `diagnostic`. Only the clock says whether anyone looked since.
eq('a no-submission grade an instructor re-graded AFTER the work came in is not reported',
   kindOf(one({ students: [st(8)], submissions: [sub(8, LATE_WORK)], writtenContent: { 'sub-8': ANSWERS },
                grades: [grade(8, { is_finalized: true, nosub: true, points_earned: 2,
                                    graded_at: '2026-09-27T09:00:00.000Z' })] })), 'nothing');

section('zeros: conditions 1-6 of zero_non_submitters.py');

eq('past due, nothing handed in, no grade row → a zero',
   kindOf(one({ students: [st(10)] })), 'zero');
eq('a committed but BLANK written submission is no work → a zero',
   kindOf(one({ students: [st(11)], submissions: [sub(11)], writtenContent: { 'sub-11': { q2: '  ', q3: '' } } })), 'zero');
eq('a live extension owes nothing yet (condition 3)',
   kindOf(one({ students: [st(12)],
                extensions: [{ enrollment_id: 'enr-12', assignment_offering_id: 'off-1', extended_due_at: FUTURE }] })), 'nothing');
eq('an extension that has run out owes the zero',
   kindOf(one({ students: [st(13)],
                extensions: [{ enrollment_id: 'enr-13', assignment_offering_id: 'off-1', extended_due_at: '2026-09-27T05:59:59.000Z' }] })), 'zero');
eq('answers left in a draft are work, not a zero (condition 4)',
   kindOf(one({ students: [st(14)], submissions: [sub(14, { status: 'draft', committed_at: null })],
                writtenContent: { 'sub-14': ANSWERS } })), 'hold:draft-answers');
eq('an interactive commit with no grade is for a person, not a zero (condition 4)',
   kindOf(one({ students: [st(15)], submissions: [sub(15, { chosen_activity_id: 'act-i' })] })), 'hold:submitted-ungraded');
eq('work on ANOTHER of the cadet\'s enrollments refuses the zero (condition 6)',
   kindOf(one({ students: [st(16)],
                siblings: [{ id: 'enr-16', student_id: 3000000016 }, { id: 'enr-16-old', student_id: 3000000016 }],
                submissions: [sub('16-old', { enrollment_id: 'enr-16-old' })] })), 'hold:stranded');
eq('a viewer who cannot see every section cannot check condition 6 → held',
   kindOf(one({ students: [st(17)], canZero: false })), 'hold:cannot-check');
eq('answers that were needed and not loaded are never read as blank',
   kindOf(one({ students: [st(18)], submissions: [sub(18)] /* no writtenContent entry */ })), 'hold:cannot-check');

section('deadlines: per section, and the 120-second grace');

const T_PLUS = (ms) => new Date(Date.parse(T_DUE) + ms);
eq('a T-day cadet is owed nothing while only the M-day deadline has passed',
   kindOf(one({ students: [st(20, 'sec-T')] }, new Date('2026-09-24T18:00:00.000Z'))), 'nothing');
eq('…while an M-day cadet at the same moment is owed the zero',
   kindOf(one({ students: [st(21, 'sec-M')] }, new Date('2026-09-24T18:00:00.000Z'))), 'zero');
eq('60 s after the deadline is inside the grace — nothing yet',
   kindOf(one({ students: [st(22, 'sec-T')] }, T_PLUS(60_000))), 'nothing');
eq('121 s after it, the zero is owed',
   kindOf(one({ students: [st(23, 'sec-T')] }, T_PLUS(121_000))), 'zero');

section('held back: a person must look first');

eq('a reopened zero with an extension still running is held — publishing would lock them out',
   kindOf(one({ students: [st(30)], grades: [grade(30, { nosub: true, points_earned: 0 })],
                extensions: [{ enrollment_id: 'enr-30', assignment_offering_id: 'off-1', extended_due_at: FUTURE }] })),
   'hold:still-open');
eq('a zero written before they handed in is held as stale — the six cadets',
   kindOf(one({ students: [st(31)], submissions: [sub(31, LATE_WORK)], writtenContent: { 'sub-31': ANSWERS },
                grades: [grade(31, { nosub: true, points_earned: 0 })] })), 'hold:stale-zero');
eq('…and stays held while their extension is still running',
   kindOf(one({ students: [st(32)], submissions: [sub(32, LATE_WORK)], writtenContent: { 'sub-32': ANSWERS },
                grades: [grade(32, { nosub: true, points_earned: 0 })],
                extensions: [{ enrollment_id: 'enr-32', assignment_offering_id: 'off-1', extended_due_at: FUTURE }] })),
   'hold:stale-zero');
eq('work committed after its grade was written is held',
   kindOf(one({ students: [st(33)], submissions: [sub(33, { committed_at: '2026-09-26T12:00:00.000Z' })],
                grades: [grade(33)] })), 'hold:after-grading');
eq('a saved draft with no score is held',
   kindOf(one({ students: [st(34)], grades: [grade(34, { points_earned: null })] })), 'hold:no-score');
eq('answers saved in a draft after the zero make it stale too (the draft\'s own clock)',
   kindOf(one({ students: [st(36)],
                submissions: [sub(36, { status: 'draft', committed_at: null, updated_at: '2026-09-26T12:00:00.000Z' })],
                writtenContent: { 'sub-36': ANSWERS }, grades: [grade(36, { nosub: true, points_earned: 0 })] })),
   'hold:stale-zero');
eq('an unpublished no-submission grade an instructor already re-scored is theirs — published',
   kindOf(one({ students: [st(37)], submissions: [sub(37, LATE_WORK)], writtenContent: { 'sub-37': ANSWERS },
                grades: [grade(37, { nosub: true, points_earned: 2, graded_at: '2026-09-27T09:00:00.000Z' })] })),
   'publish');
// Found by the dry run against live data: a writer that left graded_at null had it stamped with the
// publish time, so one phys-215 zero reads 6 Sep over work handed in on 20 Aug. The clock is not
// trusted for an AI row — nobody has touched it, so it cannot be anybody's decision.
eq('an AI zero is stale even when its graded_at was stamped AFTER the work',
   kindOf(one({ students: [st(38)], submissions: [sub(38)], writtenContent: { 'sub-38': ANSWERS },
                grades: [grade(38, { nosub: true, points_earned: 0, graded_at: '2026-09-28T13:49:00.000Z' })] })),
   'hold:stale-zero');
eq('…and reported when it is already published',
   kindOf(one({ students: [st(38)], submissions: [sub(38)], writtenContent: { 'sub-38': ANSWERS },
                grades: [grade(38, { is_finalized: true, nosub: true, points_earned: 0,
                                     graded_at: '2026-09-28T13:49:00.000Z' })] })), 'wrong-published');
eq('a PERSON\'s zero dated after the work came in is their decision — published',
   kindOf(one({ students: [st(39)], submissions: [sub(39, LATE_WORK)], writtenContent: { 'sub-39': ANSWERS },
                grades: [grade(39, { nosub: true, points_earned: 0, source: 'instructor',
                                     graded_at: '2026-09-27T09:00:00.000Z' })] })), 'publish');
eq('a person\'s zero dated BEFORE the work (e.g. one this page created, then an extension) is stale',
   kindOf(one({ students: [st(45)], submissions: [sub(45, LATE_WORK)], writtenContent: { 'sub-45': ANSWERS },
                grades: [grade(45, { nosub: true, points_earned: 0, source: 'instructor' })] })), 'hold:stale-zero');
eq('credit given before the work arrived is not a stale zero, whatever the flag says',
   kindOf(one({ students: [st(46)], submissions: [sub(46, LATE_WORK)], writtenContent: { 'sub-46': ANSWERS },
                grades: [grade(46, { is_finalized: true, nosub: true, points_earned: 2, source: 'instructor' })] })),
   'nothing');
eq('a no-submission zero whose answers were not loaded is held, not published',
   kindOf(one({ students: [st(35)], submissions: [sub(35)], grades: [grade(35, { nosub: true, points_earned: 0 })] })),
   'hold:cannot-check');

/* ── Supporting pieces ─────────────────────────────────────────────────────── */

section('staleZeroIds: a no-submission zero with work behind it');

const STALE_STUDENTS = [st(40), st(41), st(42), st(43)];
const stale = G.staleZeroIds(
  { written: { id: 'act-w' } }, STALE_STUDENTS,
  { 3000000040: { diagnostic: { no_submission: true }, pointsEarned: 0, source: 'ai_suggested' },
    3000000041: { diagnostic: { no_submission: true }, pointsEarned: 0, source: 'ai_suggested' },
    3000000042: { diagnostic: { no_submission: true }, pointsEarned: 0, source: 'ai_suggested' },
    3000000043: { diagnostic: { schema: 1 }, pointsEarned: 0, source: 'ai_suggested' } },
  { 3000000042: { chosenActivityId: 'act-i' } },
  { 3000000040: ANSWERS, 3000000041: { q2: ' ', q3: '' }, 3000000043: ANSWERS });
eq('answers behind a no-submission zero → stale', stale.has(3000000040), true);
eq('blank answers behind it → not stale', stale.has(3000000041), false);
eq('an interactive commit behind it → stale', stale.has(3000000042), true);
eq('a grade that is not a no-submission zero → not stale', stale.has(3000000043), false);
const regraded = G.staleZeroIds({ written: { id: 'act-w' } }, [st(44)],
  { 3000000044: { diagnostic: { no_submission: true }, pointsEarned: 0, source: 'instructor',
                  gradedAt: '2026-09-27T09:00:00.000Z' } },
  { 3000000044: { chosenActivityId: 'act-w', status: 'committed', committedAt: '2026-09-26T12:00:00.000Z' } },
  { 3000000044: ANSWERS });
eq('a person\'s zero dated after the work → not stale', regraded.has(3000000044), false);

section('buildGradeData: an unpublished stale zero is not the card\'s starting point');

const CARD_OFF = { written: { id: 'act-w', content: { questions: [
  { id: 'q2', text: 'Reading reflection', points: 1 }, { id: 'q3', text: 'Free response', points: 1 }] } } };
const zeroQs = { q2: { score: 0, max: 1, feedback: 'No submission received.', status: 'zero' },
                 q3: { score: 0, max: 1, feedback: 'No submission received.', status: 'zero' } };
const CARD_STUDENTS = [st(50), st(51)];
const CARD_GRADES = {
  3000000050: { gradeId: 'g-50', qs: zeroQs, finalized: false, pointsEarned: 0, source: 'ai_suggested',
                diagnostic: { no_submission: true } },
  3000000051: { gradeId: 'g-51', qs: zeroQs, finalized: true, pointsEarned: 0, source: 'ai_suggested',
                diagnostic: { no_submission: true } },
};
const CARD_SUBS = { 3000000050: { chosenActivityId: 'act-w' }, 3000000051: { chosenActivityId: 'act-w' } };
const CARD_ANSWERS = { 3000000050: ANSWERS, 3000000051: ANSWERS };
const cardStale = G.staleZeroIds(CARD_OFF, CARD_STUDENTS, CARD_GRADES, CARD_SUBS, CARD_ANSWERS);
const gd = G.buildGradeData(CARD_OFF, CARD_STUDENTS, CARD_ANSWERS, CARD_GRADES, CARD_SUBS, cardStale);
eq('unpublished stale zero: chips start from the answers', gd[3000000050].q3.status, 'full');
eq('…and "No submission received." is not carried over', gd[3000000050].q3.feedback, '');
eq('published stale zero: the card still shows what the cadet sees', gd[3000000051].q3.status, 'zero');

section('Save draft: never un-publishes, never re-sends a stale zero (gradeRows rules 3 and 4)');

const ctx = { user: { id: 'instr-1' } };
const SAVE_OFF = { ...CARD_OFF, offeringId: 'off-1', slug: 'preflight-17', pointsPossible: 2 };
const SAVE_STUDENTS = [st(60), st(61), st(62)];
const SAVE_GRADES = {
  3000000060: { gradeId: 'g-60', qs: { q2: { score: 1, max: 1, feedback: '', status: 'full' },
                                       q3: { score: 1, max: 1, feedback: '', status: 'full' } },
                finalized: true, source: 'instructor' },
  3000000061: { gradeId: 'g-61', qs: zeroQs, finalized: false, source: 'ai_suggested', pointsEarned: 0,
                diagnostic: { no_submission: true } },
  3000000062: { gradeId: 'g-62', qs: { q2: { score: 1, max: 1, feedback: '', status: 'full' },
                                       q3: { score: 1, max: 1, feedback: '', status: 'full' } },
                finalized: false, source: 'ai_suggested' },
};
const SAVE_SUBS = Object.fromEntries(SAVE_STUDENTS.map(s => [s.student_id, { chosenActivityId: 'act-w' }]));
const SAVE_ANSWERS = Object.fromEntries(SAVE_STUDENTS.map(s => [s.student_id, ANSWERS]));
const saveStale = G.staleZeroIds(SAVE_OFF, SAVE_STUDENTS, SAVE_GRADES, SAVE_SUBS, SAVE_ANSWERS);
const saveGd = G.buildGradeData(SAVE_OFF, SAVE_STUDENTS, SAVE_ANSWERS, SAVE_GRADES, SAVE_SUBS, saveStale);

CALLS = [];
await G.saveScores(ctx, SAVE_OFF, SAVE_STUDENTS, saveGd, SAVE_GRADES, {}, { skipIds: saveStale });
const saved = CALLS.filter(c => c.table === 'grades' && c.verb === 'upsert').flatMap(c => c.payload);
eq('exactly one row is re-sent — the unpublished, ordinary draft', saved.map(r => r.enrollment_id), ['enr-62']);
check('the published grade is NOT in the save (it would have been un-published)',
      !saved.some(r => r.enrollment_id === 'enr-60'));
check('the stale zero is NOT in the save (its fresh defaults would overwrite it)',
      !saved.some(r => r.enrollment_id === 'enr-61'));

saveGd[3000000061].q3.modified = true;
CALLS = [];
await G.saveScores(ctx, SAVE_OFF, SAVE_STUDENTS, saveGd, SAVE_GRADES, {}, { skipIds: saveStale });
const saved2 = CALLS.filter(c => c.table === 'grades' && c.verb === 'upsert').flatMap(c => c.payload);
check('once the instructor changes the stale card, it IS saved — their decision',
      saved2.some(r => r.enrollment_id === 'enr-61' && r.source === 'instructor'));

section('finalizeExtras: who writes what on the Grade page');

const items = [
  { kind: 'publish', studentId: 70, gradeId: 'g-70' },   // written card → gradeRows re-sends it
  { kind: 'publish', studentId: 71, gradeId: 'g-71' },   // no-submission card → flag flip
  { kind: 'zero', studentId: 72, enrollmentId: 'enr-72', offeringId: 'off-1' },
  { kind: 'hold', reason: 'stale-zero', studentId: 73 }, // written card → skipIds
  { kind: 'hold', reason: 'still-open', studentId: 74 }, // no-submission card → nothing to skip
  { kind: 'hold', reason: 'still-open', studentId: 75 }, // edited → the instructor's call
];
const ex = G.finalizeExtras(items,
  { 70: { q2: {} }, 73: { q2: {} }, 75: { q2: { modified: true } } },
  { 71: { modified: false }, 72: { modified: false }, 74: { modified: false } }, new Set([99]));
eq('flag flips: only the untouched no-submission card', ex.flipItems.map(i => i.studentId), [71]);
eq('zeros: the cadet with no grade row', ex.zeroItems.map(i => i.studentId), [72]);
eq('held: everything held and untouched', ex.held.map(i => i.studentId), [73, 74]);
eq('skipIds: the stale set plus held WRITTEN cards only', [...ex.skipIds].sort(), [73, 99]);

section('zeroRow: zero_non_submitters.py\'s payload, written by a person');

const z = G.zeroRow(OFF, 'enr-80', 'dir-1', '2026-09-29T18:00:00.000Z');
eq('zero points, the offering\'s possible', [z.points_earned, z.points_possible], [0, 2]);
eq('Q1 carries no feedback (worth 0 — CORE.md §2)', z.question_scores.q1, { score: 0, max: 0, feedback: '', status: 'zero' });
eq('Q2 and Q3 say why', [z.question_scores.q2.feedback, z.question_scores.q3.feedback],
   ['No submission received.', 'No submission received.']);
eq('marked no_submission, so it is never mistaken for a graded blank', z.diagnostic.no_submission, true);
eq('published, by the person who pressed the button', [z.is_finalized, z.source, z.graded_by], [true, 'instructor', 'dir-1']);
eq('no submission linked, and no effort (migration 014 CHECK)', [z.submission_id, 'effort' in z], [null, false]);

section('applyPublishPlan: publishing is a flag, zeros never overwrite');

CALLS = [];
const flips = Array.from({ length: 250 }, (_, i) => ({ kind: 'publish', gradeId: `g-${i}`, offeringId: 'off-1' }));
const out = await G.applyPublishPlan({ user: { id: 'dir-1' } },
  [...flips, { kind: 'zero', enrollmentId: 'enr-90', offeringId: 'off-1' },
   { kind: 'hold', reason: 'stale-zero', gradeId: 'g-hold', offeringId: 'off-1' }],
  [OFF], { via: 'publish-all' });
const updates = CALLS.filter(c => c.table === 'grades' && c.verb === 'update');
eq('250 flips go out in chunks of 100', updates.map(u => u.filters.find(f => f[1] === 'id')[2].length), [100, 100, 50]);
check('every update sets is_finalized and nothing else — no score can move',
      updates.every(u => JSON.stringify(u.payload) === JSON.stringify({ is_finalized: true })));
check('every update is guarded by is_finalized = false, so a second press is a no-op',
      updates.every(u => u.filters.some(f => f[0] === 'eq' && f[1] === 'is_finalized' && f[2] === false)));
check('a held row is never written', !updates.some(u => u.filters.find(f => f[1] === 'id')[2].includes('g-hold')));
const ups = CALLS.filter(c => c.table === 'grades' && c.verb === 'upsert');
eq('one zero upsert', ups.length, 1);
eq('…that never overwrites a row written in the meantime', ups[0].opts,
   { onConflict: 'enrollment_id,assignment_offering_id', ignoreDuplicates: true });
eq('counts come back', [out.published, out.created, out.error], [250, 1, null]);
const evs = CALLS.filter(c => c.table === 'grade_events').flatMap(c => c.payload);
eq('audit: one created + 251 finalized', [evs.filter(e => e.event === 'created').length,
                                           evs.filter(e => e.event === 'finalized').length], [1, 251]);
check('audit says how it was published', evs.every(e => e.detail.via === 'publish-all' && e.detail.bulk === true));

section('viewPublishPlan: a viewer who cannot see the whole course never creates a zero');

CALLS = [];
const VIEW_OFF = { offeringId: 'off-1', slug: 'preflight-17', title: 'Lesson 17', position: 17, dueAt: M_DUE,
                   dueBySection: { 'sec-M': M_DUE }, written: { id: 'act-w', content: { questions: OFF.questions } },
                   pointsPossible: 2 };
const partial = await G.viewPublishPlan(
  { sectionsById: { 'sec-M': {}, 'sec-X': {} }, sectionIds: ['sec-M'] },
  { offering: VIEW_OFF, students: [st(95)] }, NOW);
eq('held as cannot-check', partial.items.map(kindOf), ['hold:cannot-check']);
eq('…and nothing was read to decide it', CALLS.length, 0);
const whole = await G.viewPublishPlan(
  { sectionsById: { 'sec-M': {} }, sectionIds: ['sec-M'] },
  { offering: VIEW_OFF, students: [st(96)] }, NOW);
eq('a viewer who sees every section gets the zero', whole.items.map(kindOf), ['zero']);

process.exit(summary() ? 0 : 1);
