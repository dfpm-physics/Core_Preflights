// test-lesson-isolation.mjs — per-offering content isolation in the lesson builder.
// (2026-07-28 — docs/decisions/PER-OFFERING-CONTENT-ISOLATION.md)
//
// WHAT THIS DEFENDS
//   Two runs of the same course used to share ONE `assignments` row and ONE set of `activities`.
//   Every consequence of that was silent: editing Fall 2026's questions rewrote the training
//   sandbox's, deleting a lesson from one term destroyed the other term's student reports, and a
//   director of either term could write both because `activities_write` is scoped by COURSE.
//
//   Two things had to change, and both are the kind that look fine in review and fail in
//   production, so they are pinned here:
//
//   1. THE WRITTEN SLUG MUST BE RANDOM. It was `<course>-<slug>-written` — deterministic, so a
//      second copy of `preflight-02` could not exist at all (`activities.slug` is globally
//      UNIQUE). Sharing was not a choice the code made; it was the only arrangement the slug
//      permitted. A regression to a deterministic mint re-imposes sharing without erroring.
//
//   2. SCHEDULING A CONTAINER ANOTHER TERM RUNS MUST COPY IT — and must NOT copy in the two cases
//      where copying is wrong: editing a lesson already scheduled here (its submissions point at
//      the activity ids it has), and scheduling a container nobody else runs (that is a plain
//      re-attach, which is the documented way to put an unscheduled lesson back).
//
// Offline. `db` is a recording stub installed before the module is imported, so every assertion
// is about the WRITES saveLesson() issues — which is the behaviour, rather than a proxy for it.

import { check, eq, section, summary, installBrowser } from './harness.mjs';

installBrowser({ pathname: '/site/faculty/lessons.html' });

/* ── A recording stub client ───────────────────────────────────────────────────
 * Methods are listed rather than proxied so an unstubbed one throws loudly: a silent `undefined`
 * would make a query that was never stubbed look like a query that returned nothing. */
let RESPONSES = {};
let CALLS = [];

const stubFrom = (table) => {
  const state = { table, verb: 'select', payload: null, filters: {}, cols: null };
  const c = {};
  for (const m of ['eq', 'in', 'is', 'not', 'neq', 'gt', 'lt', 'gte', 'lte',
                   'order', 'limit', 'filter', 'or'])
    c[m] = (col, val) => { state.filters[col] = val; return c; };
  c.select = (cols) => { state.cols = cols; return c; };
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
    const data = typeof r === 'function' ? r(state, mode) : r;
    if (data === undefined) return { data: mode === 'many' ? [] : null, error: null };
    return { data, error: null };
  };
  c.single = () => Promise.resolve(result('single'));
  c.maybeSingle = () => Promise.resolve(result('maybe'));
  c.then = (res) => res(result('many'));
  return c;
};

globalThis.window.db = { from: stubFrom };

const L = await import('../../site/js/faculty-lessons.js');

const ctx = { user: { id: 'staff-uuid' }, currentOffering: 'co-real', currentCourse: 'course-215' };

/** The model the page sends when a director schedules a library container into a term. */
const modelFor = (overrides = {}) => ({
  assignmentId: 'asg-shared',
  courseId: 'course-215',
  courseCode: 'phys-215',
  courseOfferingId: 'co-real',
  slug: 'preflight-02',
  title: 'Electric Charge',
  description: null,
  objectives: [],
  policy: 'preflight',
  pointsPossible: 2,
  gradingMode: 'points',
  switchPolicy: 'lock_on_commit',
  dueByDay: {},
  sections: [],
  written: { include: true, questions: [{ id: 'q1', text: 'why', points: 1 }] },
  interactive: { include: false },
  ...overrides,
});

/** Responses for a container ALREADY running in another term. */
function sharedContainer({ takenSlugs = ['preflight-02'], termCode = 'spring-2027' } = {}) {
  return {
    // offeringsUsingAssignment() — one row, in a DIFFERENT course offering.
    'assignment_offerings.select': [{
      id: 'ao-sandbox', course_offering_id: 'co-sandbox',
      course_offerings: { courses: { code: 'phys-215' }, terms: { label: 'TRAINING SANDBOX' } },
    }],
    'assignments.select': takenSlugs.map(slug => ({ slug })),
    'course_offerings.select': { terms: { code: termCode } },
    'assignments.insert': { id: 'asg-copy' },
    'activities.select': (state, mode) => (mode === 'maybe' ? null : []),
    'activities.insert': { id: 'act-copy' },
    'assignment_offerings.insert': { id: 'ao-new' },
    'offering_activities.select': [],
  };
}

const reset = (responses) => { RESPONSES = responses; CALLS = []; };
const callsTo = (table, verb) => CALLS.filter(c => c.table === table && c.verb === verb);

/* ── 1. The written slug is minted, not derived ────────────────────────────── */

section('mintWrittenSlug — a per-offering slug, not a deterministic one');

const s1 = L.mintWrittenSlug('phys-215', 'preflight-02');
const s2 = L.mintWrittenSlug('phys-215', 'preflight-02');

check('keeps the readable stem so the slug stays greppable',
      s1.startsWith('phys-215-preflight-02-written-'));
check('ends in 8 hex characters (contract §3.2 shape)', /-[0-9a-f]{8}$/.test(s1));
check('two mints of the SAME lesson differ — this is what lets two terms each hold a copy',
      s1 !== s2);
check('is a valid activity slug', L.isValidSlug(s1));
check('the retired deterministic mint is gone', L.writtenSlugFor === undefined);

/* ── 2. Scheduling a container another term runs COPIES it ─────────────────── */

section('saveLesson — scheduling a shared container copies it into this term');

reset(sharedContainer());
const copied = await L.saveLesson(ctx, modelFor(), null);

check('no error', !copied.error, copied.error?.message || '');
check('reports the copy back to the page so it can say so',
      !!copied.copiedFrom && copied.copiedFrom.assignmentId === 'asg-shared');
eq('names the term it was copied from', copied.copiedFrom?.terms?.[0], 'phys-215 · TRAINING SANDBOX');
eq('a NEW container is inserted', callsTo('assignments', 'insert').length, 1);
eq('the shared container is NOT updated', callsTo('assignments', 'update').length, 0);
eq('the offering is scheduled against the COPY, not the original',
   callsTo('assignment_offerings', 'insert')[0]?.payload?.assignment_id, 'asg-copy');

const copiedActivity = callsTo('activities', 'insert')[0]?.payload;
eq('the written activity is copied too', copiedActivity?.assignment_id, 'asg-copy');
check('…with its own freshly minted slug',
      /^phys-215-preflight-02-.*-written-[0-9a-f]{8}$/.test(copiedActivity?.slug || '')
      || /^phys-215-preflight-02-written-[0-9a-f]{8}$/.test(copiedActivity?.slug || ''));
eq('…carrying the questions verbatim', copiedActivity?.content?.questions?.[0]?.id, 'q1');

/* ── 3. The copy's container slug ──────────────────────────────────────────── */

section('saveLesson — the copy takes a slug the course does not already have');

eq('the clean slug is taken, so the term qualifies it',
   callsTo('assignments', 'insert')[0]?.payload?.slug, 'preflight-02-spring-2027');

reset(sharedContainer({ takenSlugs: ['preflight-41'] }));
await L.saveLesson(ctx, modelFor(), null);
eq('when the clean slug is FREE it is used unchanged — no gratuitous renaming',
   callsTo('assignments', 'insert')[0]?.payload?.slug, 'preflight-02');

/* ── 4. The two cases that must NOT copy ───────────────────────────────────── */

section('saveLesson — when copying would be wrong');

// Editing a lesson already scheduled HERE. Its submissions point at the activity ids it has;
// copying would strand every one of them.
reset({
  ...sharedContainer(),
  'activities.select': (state, mode) => (mode === 'maybe' ? null
    : [{ id: 'act-existing', slug: 'phys-215-preflight-02-written', modality: 'written',
         content: { questions: [{ id: 'q1', text: 'why', points: 1 }] }, position: 0 }]),
  'grades.select': [],
});
const edited = await L.saveLesson(ctx, modelFor(), 'ao-existing');
check('editing a scheduled lesson never copies', !edited.copiedFrom);
eq('…it updates the container in place', callsTo('assignments', 'update').length, 1);
eq('…and inserts no new container', callsTo('assignments', 'insert').length, 0);

// A container nobody else runs: the documented "unschedule now, re-attach later" path.
reset({ ...sharedContainer(), 'assignment_offerings.select': [] });
const reattached = await L.saveLesson(ctx, modelFor(), null);
check('re-attaching a container no other term runs does not copy it', !reattached.copiedFrom);
eq('…the original container is reused', callsTo('assignments', 'insert').length, 0);

// An offering row for the SAME course offering is not "another term" — a container already
// scheduled here that is being saved again must not fork itself.
reset({
  ...sharedContainer(),
  'assignment_offerings.select': [{
    id: 'ao-here', course_offering_id: 'co-real',
    course_offerings: { courses: { code: 'phys-215' }, terms: { label: 'Fall 2026' } },
  }],
});
const sameTerm = await L.saveLesson(ctx, modelFor(), null);
check('a row in the SAME offering is not another term', !sameTerm.copiedFrom);

/* ── 5. The interaction does not come with the copy ────────────────────────── */

section('saveLesson — an interaction cannot be copied into a second term');

reset({
  ...sharedContainer(),
  // The clash check finds the slug already in use — it belongs to the term already running it.
  'activities.select': (state, mode) =>
    (mode === 'maybe' ? (state.filters.slug ? { id: 'act-interactive-existing' } : null) : []),
});
const clash = await L.saveLesson(ctx, modelFor({
  interactive: { include: true, slug: 'lesson-02-charge', artifact_url: 'https://claude.ai/x' },
}), null);

check('refused rather than left to a unique violation', !!clash.error);
check('…and the message says what to do about it',
      /rebuild/i.test(clash.error?.message || '') && /new id/i.test(clash.error?.message || ''));

/* ── 6. offeringsUsingAssignment ───────────────────────────────────────────── */

section('offeringsUsingAssignment — the question the copy decision rests on');

reset(sharedContainer());
const others = await L.offeringsUsingAssignment('asg-shared', 'co-real');
eq('excludes the offering being saved into', others.length, 1);
eq('labels the term for the director', others[0].label, 'phys-215 · TRAINING SANDBOX');

const none = await L.offeringsUsingAssignment(null, 'co-real');
eq('a container with no id is nobody else\'s', none.length, 0);

summary();
