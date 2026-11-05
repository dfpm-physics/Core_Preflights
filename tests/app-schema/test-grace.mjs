// test-grace.mjs — the 120-second acceptance window on every deadline (GRACE_MS).
//
// WHY THIS EARNS ITS PLACE
//   Until now nothing refused a late submission at all: commitSubmission() checked gradability and
//   the switch lock and never the clock, and the MISSED state a student sees is computed at page
//   load, so a tab open across 2359 kept a live Submit button. The cutoff is therefore new
//   behaviour on the one path that tells a cadet "no" — and the two ways it can be wrong are both
//   silent.
//
//   TOO TIGHT and a cadet who pressed Submit at 2359:30 is refused for a deadline the site told
//   them was 2359. TOO LOOSE and `zero_non_submitters.py` writes a `no_submission` zero over work
//   the site accepted — indistinguishable, afterwards, from a real one.
//
//   Three properties are pinned here, and only the first is obvious:
//     1. the boundary — 119s in, 121s out, and the exact instant of GRACE_MS still in;
//     2. THE SOURCE DOES NOT MATTER. The grace lives in ONE comparison inside effectiveDue(), so
//        it applies to whichever of the four deadline sources won the precedence. An extension is
//        the case that would hurt: a per-student date arriving through a different branch with no
//        tolerance would refuse exactly the students a director had already made an exception for;
//     3. `due` IS UNTOUCHED. Every date on the site comes from that field. A grace that leaked
//        into it would advertise itself, and an advertised grace period is just a later deadline.
//
//   The last check is the one that connects the two halves: a submission the acceptance window
//   let through must never be badged late in the grader's queue. Those were separate constants
//   (60s vs 120s), which is a two-minute window in which the site accepts work and then reports
//   it as late.
//
//   THE SECOND HALF IS THE WRITE PATH, and it is not a restatement of the first. A rule in
//   schema.js refuses nobody; commitSubmission() has to consult it, from the DATABASE rather than
//   from the page's copy of it, or the tab open across 2359 submits exactly as it always did. The
//   stub below is a recording client, so those assertions are about the queries and writes that
//   actually leave the module — including the ones that must NOT (a refusal that still wrote a row
//   would be worse than no check at all) and the `revoked_at IS NULL` filter, which is invisible
//   in a result and wrong in the direction that refuses a student a director excused.
//
// Offline. schema.js imports nothing; student-data.js needs window.db, which is stubbed here, so
// nothing reaches the network.

import { check, eq, section, summary, installBrowser } from './harness.mjs';
import {
  GRACE_MS, shapeOffering, withResolvedDue, effectiveDue, submissionLateness,
} from '../../site/js/schema.js';

installBrowser({ pathname: '/site/student/assignments.html' });

/* Four distinct deadlines, one per source, so a check can never pass by reading the wrong one. */
const EXTENSION_DUE = '2026-09-04T05:59:59Z';
const SECTION_DUE   = '2026-09-03T05:59:59Z';
const DAY_DUE       = '2026-09-02T05:59:59Z';
const OFFERING_DUE  = '2026-09-01T05:59:59Z';

const raw = {
  id: 'off-1',
  course_offering_id: 'co-1',
  points_possible: 2,
  grading_mode: 'points',
  switch_policy: 'lock_on_commit',
  opens_at: null,
  due_at: OFFERING_DUE,
  due_by_day: { M: DAY_DUE },
  is_published: true,
  position: 5,
  assignments: { id: 'asg-1', slug: 'preflight-05', title: 'Lesson 05', course_id: 'crs-1' },
  offering_activities: [],
  assignment_due_dates: [{ section_id: 'sec-override', due_at: SECTION_DUE }],
};

// sec-override meets on M too, so its explicit row is genuinely outranking the per-day schedule
// rather than being the only date available to it.
const SECTIONS = [
  { id: 'sec-override', meeting_days: ['M'] },
  { id: 'sec-day', meeting_days: ['M'] },
  { id: 'sec-plain', meeting_days: [] },
];

const off = withResolvedDue(shapeOffering(raw), SECTIONS);

/** `ms` after a deadline, as a clock to hand effectiveDue(). */
const after = (iso, ms) => new Date(+new Date(iso) + ms);

/* ── The constant itself ──────────────────────────────────────────────────── */

section('GRACE_MS');

// Pinned as a literal, not derived: three copies outside this repo's JS agree with it by comment
// only (the deadline-enforcement migration, preflight-analyze Step 9, zero_non_submitters.py), so
// a change here has to be a deliberate edit that fails this line first.
eq('the acceptance window is 120 seconds', GRACE_MS, 120000);

/* ── The boundary, on every source of the deadline ────────────────────────── */

const CASES = [
  { name: 'extension',        sectionId: 'sec-day',      ext: EXTENSION_DUE, due: EXTENSION_DUE, source: 'extension' },
  { name: 'section override', sectionId: 'sec-override', ext: null,          due: SECTION_DUE,   source: 'section' },
  { name: 'day track',        sectionId: 'sec-day',      ext: null,          due: DAY_DUE,       source: 'day' },
  { name: 'offering default', sectionId: 'sec-plain',    ext: null,          due: OFFERING_DUE,  source: 'offering' },
];

section('effectiveDue — the grace applies to whichever source wins');

for (const c of CASES) {
  const at = (ms) => effectiveDue(off, c.sectionId, c.ext, after(c.due, ms));

  eq(`${c.name}: resolves the deadline it should`, at(0).due.toISOString(),
     new Date(c.due).toISOString());

  check(`${c.name}: not past one minute before the deadline`, at(-60000).isPast === false);
  check(`${c.name}: not past at the deadline itself`, at(0).isPast === false);
  check(`${c.name}: not past at due + 119s`, at(119000).isPast === false);
  check(`${c.name}: not past at exactly due + GRACE_MS`, at(GRACE_MS).isPast === false);
  check(`${c.name}: PAST at due + 121s`, at(121000).isPast === true);
  check(`${c.name}: PAST a day later`, at(86400000).isPast === true);
}

/* ── The displayed deadline never moves ───────────────────────────────────── */

section('effectiveDue — `due` is the real deadline, before and after the grace');

for (const c of CASES) {
  const inside = effectiveDue(off, c.sectionId, c.ext, after(c.due, 119000));
  const outside = effectiveDue(off, c.sectionId, c.ext, after(c.due, 121000));
  eq(`${c.name}: due unchanged inside the window`, inside.due.toISOString(),
     new Date(c.due).toISOString());
  eq(`${c.name}: due unchanged once refused`, outside.due.toISOString(),
     new Date(c.due).toISOString());
  eq(`${c.name}: source unchanged either side`, [inside.source, outside.source],
     [c.source, c.source]);
}

// The two states an offering with no deadline at all must never enter, whatever the tolerance is.
section('effectiveDue — no deadline is still never past');

check('no dates at all is not past',
      effectiveDue({ dueBySection: {}, dueAt: null }, null, null, new Date()).isPast === false);
check('an unparseable date is not past',
      effectiveDue({ dueBySection: {}, dueAt: 'not-a-date' }, null, null, new Date()).isPast === false);

/* ── The grader's late badge agrees with the acceptance window ─────────────── */

section('submissionLateness — the same window, by default');

const committed = (iso, ms) => after(iso, ms).toISOString();

eq('not late at due + 119s',
   submissionLateness(off, 'sec-plain', null, committed(OFFERING_DUE, 119000)).late, false);
eq('not late at exactly due + GRACE_MS',
   submissionLateness(off, 'sec-plain', null, committed(OFFERING_DUE, GRACE_MS)).late, false);
eq('late at due + 121s',
   submissionLateness(off, 'sec-plain', null, committed(OFFERING_DUE, 121000)).late, true);

// The regression this pairing exists for: the default was 60s while the site accepted 120s, so a
// submission at +90s was accepted and then badged late.
eq('a submission the window accepted is not badged late (was 60s, now GRACE_MS)',
   submissionLateness(off, 'sec-plain', null, committed(OFFERING_DUE, 90000)).late, false);

// An extension moves the comparison, not the tolerance.
eq('an extended submission inside its own window is not late',
   submissionLateness(off, 'sec-day', EXTENSION_DUE, committed(EXTENSION_DUE, 119000)).late, false);
eq('…and is late past it',
   submissionLateness(off, 'sec-day', EXTENSION_DUE, committed(EXTENSION_DUE, 121000)).late, true);
eq('an explicit graceMs still overrides the default',
   submissionLateness(off, 'sec-plain', null, committed(OFFERING_DUE, 90000), 60000).late, true);

eq('a draft is never late', submissionLateness(off, 'sec-plain', null, null).late, false);

/* ── The two must not disagree ────────────────────────────────────────────── */

section('acceptance and lateness are one rule');

const offsets = [-86400000, -1000, 0, 60000, 119000, GRACE_MS, 121000, 3600000];
const disagreed = offsets.filter(ms => {
  const accepted = effectiveDue(off, 'sec-plain', null, after(OFFERING_DUE, ms)).isPast === false;
  const late = submissionLateness(off, 'sec-plain', null, committed(OFFERING_DUE, ms)).late;
  return accepted === late;          // accepted-and-late, or refused-and-punctual
});
check(`no offset is accepted and late at once (${offsets.length} checked)`,
      disagreed.length === 0, JSON.stringify(disagreed));

/* ══════════════════════════════════════════════════════════════════════════════
 * The write path — what the student's Submit button actually does
 * ════════════════════════════════════════════════════════════════════════════ */

/* A recording stub client. Methods are listed rather than proxied so an unstubbed one throws
 * loudly: a silent `undefined` would make a query nobody stubbed look like one that returned
 * nothing — which here would read as "no deadline", the answer that lets everything through. */
let RESPONSES = {};
let stubInsertError = false;
let created = false;
let CALLS = [];      // writes only: insert / update / upsert / delete
let READS = [];      // every select, with the filters it carried

const stubFrom = (table) => {
  const state = { table, verb: 'select', payload: null, filters: {}, cols: null };
  const c = {};
  for (const m of ['eq', 'in', 'is', 'not', 'neq', 'gt', 'lt', 'gte', 'lte',
                   'order', 'limit', 'filter', 'or'])
    c[m] = (col, val) => { state.filters[col] = val; return c; };
  c.select = (cols) => { state.cols = cols; READS.push(state); return c; };
  for (const verb of ['insert', 'update', 'upsert', 'delete'])
    c[verb] = (payload) => {
      state.verb = verb;
      state.payload = payload;
      CALLS.push({ table, verb, payload });
      return c;
    };
  const result = (mode) => {
    const key = `${table}.${state.verb}`;
    const r = RESPONSES[key];
    if (state.verb === 'insert' && table === 'submissions' && stubInsertError) { created = true; return { data: null, error: { code: '23505', message: 'duplicate key' } }; }
    const data = typeof r === 'function' ? r(state, mode) : r;
    if (data === undefined) return { data: mode === 'many' ? [] : null, error: null };
    return { data, error: null };
  };
  c.single = () => Promise.resolve(result('single'));
  c.maybeSingle = () => Promise.resolve(result('maybe'));
  c.then = (res) => res(result('many'));
  return c;
};

// Functions the page calls. The commit is a database function since migration 048: the clock, the grace and the
// late rule are the server's, so what this suite can pin is WHAT IS ASKED (and that no time is sent) and that the
// server's answer, a receipt or a sentence, is passed through unchanged.
let RPCS = [];
let RPC_RESULT = {};
const stubRpc = (name, args) => {
  RPCS.push({ name, args });
  const r = RPC_RESULT[name];
  if (r && r.error) return Promise.resolve({ data: null, error: r.error });
  return Promise.resolve({ data: r ? r.data : null, error: null });
};

globalThis.window.db = { from: stubFrom, rpc: stubRpc };

const { commitSubmission, submitInteractionReport, ensureSubmission } = await import('../../site/js/student-data.js');

const ctx = {
  currentOffering: 'co-1',
  enrollmentIds: ['enr-1'],
  sectionIds: ['sec-live'],
  sectionsById: { 'sec-live': { id: 'sec-live', code: 'M1A', meeting_days: ['M'] } },
};

const WRITTEN = { id: 'act-w', slug: 'p09-written', modality: 'written' };
const INTERACTIVE = { id: 'act-i', slug: 'lesson-09-x', modality: 'interactive' };

/** The offering row PostgREST returns, due `dueMs` from now, with the interactive path in
 *  whichever grading role the scenario is about. */
const liveOffering = (dueMs, interactiveRole) => ({
  id: 'off-live',
  course_offering_id: 'co-1',
  points_possible: 2,
  grading_mode: 'points',
  switch_policy: 'lock_on_commit',
  opens_at: null,
  due_at: new Date(Date.now() + dueMs).toISOString(),
  due_by_day: {},
  is_published: true,
  position: 9,
  assignments: { id: 'asg-live', slug: 'preflight-09', title: 'Lesson 09', course_id: 'crs-1' },
  offering_activities: [
    { grading_role: 'graded', available_after: 'always', is_visible: true, position: 0,
      activities: { ...WRITTEN, title: 'Written', content: { questions: [{ id: 'q1', points: 1 }] } } },
    { grading_role: interactiveRole, available_after: 'always', is_visible: true, position: 1,
      activities: { ...INTERACTIVE, title: 'Interactive',
                    content: { artifact_url: 'https://claude.ai/a' } } },
  ],
  assignment_due_dates: [],
});

/** Offsets are minutes, not milliseconds-from-a-boundary: a suite that fails when the machine is
 *  busy for two seconds is a suite people learn to ignore. */
const MIN = 60000;

function scenario({ dueMin, interactiveRole = 'practice', extension = null }) {
  const row = liveOffering(dueMin * MIN, interactiveRole);
  RESPONSES = {
    'assignment_offerings.select': row,
    'extensions.select': extension ? { extended_due_at: extension } : null,
    'grades.select': null,
    'submissions.select': { id: 'sub-1', enrollment_id: 'enr-1',
                            assignment_offering_id: 'off-live', status: 'draft',
                            chosen_activity_id: null, submission_activities: [] },
    'submissions.insert': { id: 'sub-1', status: 'draft' },
    'submissions.update': null,
    'offering_activities.select': { grading_role: 'graded' },
    'submission_activities.update': null,
    'submission_activities.upsert': null,
  };
  CALLS = [];
  READS = [];
  return row;
}

const wrote = (table, verb) => CALLS.some(c => c.table === table && c.verb === verb);

/** The deadline as the refusal should print it — a student who is told "too late" with no date
 *  has to ask their instructor which date it was, which is the conversation this avoids. */
const dueText = (row) => new Date(row.due_at).toLocaleString(undefined,
  { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const RECEIPT = [{ out_submission_id: 'sub-1', out_receipt_id: 'rc-1', out_committed_at: '2026-11-05T12:00:00Z',
                   out_is_late: false, out_content_sha256: 'ab12', out_already: false }];
const TOO_LATE = 'The deadline for this assignment was Nov 5, 11:59 PM and it has passed. Your answers are saved.';

section('commitSubmission — one server operation, no client clock');

scenario({ dueMin: 60 });
RPCS = []; RPC_RESULT = { commit_work: { data: RECEIPT } };
const ok = await commitSubmission(ctx, 'off-live', WRITTEN.id);
eq('a submit succeeds', ok.error, null);
eq('...by calling commit_work once', RPCS.map(r => r.name), ['commit_work']);
eq('...with the offering and the activity', RPCS[0].args, { p_offering: 'off-live', p_activity: WRITTEN.id });
check('...and no time of any kind is sent', !Object.keys(RPCS[0].args).some(k => /time|_at|date|late/i.test(k)));
eq('...and the page writes nothing to a table itself', CALLS, []);
eq('...the receipt comes back in the page words',
   [ok.receipt.receiptId, ok.receipt.isLate, ok.receipt.already, ok.receipt.sha256], ['rc-1', false, false, 'ab12']);
check('...with a committed time as a date', ok.receipt.committedAt instanceof Date);

RPC_RESULT = { commit_work: { data: [{ ...RECEIPT[0], out_is_late: true }] } };
eq('a late-allowed commit is reported as late', (await commitSubmission(ctx, 'off-live', WRITTEN.id)).receipt.isLate, true);

RPC_RESULT = { commit_work: { data: [{ ...RECEIPT[0], out_already: true }] } };
eq('a repeated request is reported as already done', (await commitSubmission(ctx, 'off-live', WRITTEN.id)).receipt.already, true);

RPC_RESULT = { commit_work: { error: { message: TOO_LATE, code: '42501' } } };
const refused = await commitSubmission(ctx, 'off-live', WRITTEN.id);
check('a refusal comes back as an error', !!refused.error);
eq('...carrying the server own sentence', refused.error.message, TOO_LATE);
check('...and no receipt', !refused.receipt);
eq('...and the page wrote nothing', CALLS, []);

section('submitInteractionReport — graded goes through commit_work, practice does not');

scenario({ dueMin: 60, interactiveRole: 'graded' });
RPCS = []; RPC_RESULT = { commit_work: { data: RECEIPT } };
const gOk = await submitInteractionReport(ctx, {
  activity: INTERACTIVE, offering: shapeOffering(liveOffering(60 * MIN, 'graded')),
  markdown: '# report', data: { schema: 1, effort: 4 }, transport: 'gemini',
});
eq('a graded report commits', [gOk.error, gOk.committed, gOk.role], [null, true, 'graded']);
eq('...in one call', RPCS.map(r => r.name), ['commit_work']);
eq('...carrying the report, with the transport merged in', RPCS[0].args.p_content, { schema: 1, effort: 4, transport: 'gemini' });
eq('...and the markdown and its size', [RPCS[0].args.p_markdown, RPCS[0].args.p_bytes], ['# report', 8]);
check('...and no time is sent', !Object.keys(RPCS[0].args).some(k => /time|_at|date|late/i.test(k)));
check('...with no submission row made first by the page', !wrote('submissions', 'insert'));
eq('...and a receipt', gOk.receipt.receiptId, 'rc-1');

scenario({ dueMin: -5, interactiveRole: 'graded' });
RPCS = []; RPC_RESULT = { commit_work: { error: { message: TOO_LATE } } };
const gLate = await submitInteractionReport(ctx, {
  activity: INTERACTIVE, offering: shapeOffering(liveOffering(-5 * MIN, 'graded')),
  markdown: '# report', data: { schema: 1, effort: 4 },
});
check('a graded report past the deadline is refused', !!gLate.error);
check('...with a sentence that names the deadline (this one comes from the page check)', /\w/.test(gLate.error?.message || ''));
check('...and the report is never stored', !RPCS.some(r => r.name === 'save_interactive_work'));

// Practice carries no credit, so refusing it protects nothing and costs the revealed-preference
// signal the activity is stored for.
scenario({ dueMin: -5, interactiveRole: 'practice' });
RPCS = []; RPC_RESULT = {};
const iPractice = await submitInteractionReport(ctx, {
  activity: INTERACTIVE, offering: shapeOffering(liveOffering(-5 * MIN, 'practice')),
  markdown: '# report', data: { schema: 1, effort: 4 },
});
eq('a PRACTICE report is still accepted after the deadline', iPractice.error, null);
eq('...stored through the save function', RPCS.map(r => r.name), ['save_interactive_work']);
eq('...without committing anything', iPractice.committed, false);
check('...and without touching the submission row', !wrote('submissions', 'update'));

section('ensureSubmission — two tabs creating the row at once');
scenario({ dueMin: 60 });
RESPONSES['submissions.select'] = (st) => created ? { id: 'sub-won', enrollment_id: 'enr-1', assignment_offering_id: 'off-live', status: 'draft', chosen_activity_id: null, submission_activities: [] } : null;
stubInsertError = true;
const raced = await ensureSubmission(ctx, 'off-live');
check('the loser of a race gets the winner row, not an error', !raced.error && raced.data?.id === 'sub-won', JSON.stringify(raced.error));
stubInsertError = false;

process.exit(summary() ? 0 : 1);
