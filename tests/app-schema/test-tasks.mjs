// test-tasks.mjs — the due-out registry.  (Roadmap P1.6 / P1.15)
//
// WHY THIS EARNS ITS PLACE
//   The panel's whole value proposition is that it is TRUSTWORTHY: a director glances at it and
//   believes that an empty row means nothing is outstanding. Two bugs would quietly destroy
//   that, and neither is visible by looking at the page —
//
//     1. a source that throws and is swallowed, so its work silently stops being counted;
//     2. a source that returns count 0 and renders a box anyway, so the row fills with noise
//        and people stop reading it.
//
//   Both are behaviours of the registry rather than of any one query, which is exactly what can
//   be tested without a faculty login. The individual load() functions need a signed-in
//   director and are covered by the P0.5 browser pass instead — noted here so the gap is
//   deliberate rather than assumed away.
//
// Offline: renderTasks is pure, and loadTasks is driven with stub sources.

import { check, eq, section, summary, installBrowser, makeClient } from './harness.mjs';

installBrowser({ pathname: '/site/app/faculty/dashboard.html' });
// faculty-tasks.js imports supabase.js, which throws at import time when window.db is absent.
// An unauthenticated client is enough: nothing below reaches the network — the scope guards
// return early and every other case is driven with stub sources.
globalThis.window.db = makeClient();

const T = await import('../../site/app/js/faculty-tasks.js');

// The real esc, so the escaping check below is testing what ships rather than a stand-in.
const { esc } = await import('../../site/app/js/util.js');

/* ── 1. Registry invariants ──────────────────────────────────────────────── */

section('faculty-tasks.js — registry shape');

check('there is at least one source', T.SOURCES.length > 0);

const ids = T.SOURCES.map(s => s.id);
eq('source ids are unique', ids.length, new Set(ids).size);

const SEVERITIES = new Set(['alert', 'warn', 'info']);
const shapeProblems = T.SOURCES.filter(s =>
  !s.id || typeof s.load !== 'function' || !SEVERITIES.has(s.severity) || !s.icon);
eq('every source has an id, an icon, a known severity and a load()',
   shapeProblems.map(s => s.id), []);

// `action` is what the box actually prints, and it only works if it stays SHORT — the row is
// sized to its words, so one wordy source stretches the whole thing back out.
const longActions = T.SOURCES
  .map(s => [s.id, String(s.load).match(/action:\s*'([^']+)'/)?.[1]])
  .filter(([, a]) => !a || a.length > 22);
eq('every source names a short imperative action', longActions.map(([id]) => id), []);

// The two director-only sources are a UI convention, not RLS — analysis_reports and
// analysis_runs both admit any staff member of the offering. If this flag is dropped, an
// instructor starts seeing work they cannot act on, and nothing in the database objects.
const directorOnly = T.SOURCES.filter(s => s.director).map(s => s.id).sort();
eq('the sources an instructor cannot act on stay director-only',
   directorOnly, ['analysis-runs', 'to-aggregate', 'unstaffed-sections']);

/* ── 2. loadTasks — scope guards and failure isolation ───────────────────── */

section('faculty-tasks.js — loadTasks');

eq('no offering → no queries, no tasks', await T.loadTasks({ sectionIds: ['x'] }), []);
eq('no sections → no queries, no tasks',
   await T.loadTasks({ currentOffering: 'o', sectionIds: [] }), []);

// Drive the registry with stubs rather than the live sources: this is a test of the harness
// around the queries, and using the real ones would need a director session.
const original = T.SOURCES.slice();
function withSources(stubs, fn) {
  T.SOURCES.length = 0;
  stubs.forEach(s => T.SOURCES.push(s));
  return fn().finally(() => { T.SOURCES.length = 0; original.forEach(s => T.SOURCES.push(s)); });
}

const ctx = { currentOffering: 'o1', sectionIds: ['s1'], isDirectorForCurrent: () => true };

/* ── Scope: the panel counts YOUR work, not the course's (2026-07-23) ────────
 * A director's staff row carries section_id NULL, which staff_sections() expands to every section
 * of the offering — so before this, "9 · Review grades" under a heading reading "Needs YOUR
 * attention" was counting nine other instructors' ungraded submissions. Nothing about the rendered
 * box distinguishes a right number from a wrong one, which is precisely why it needs a test.
 *
 * The director-only sources are NOT narrowed: they ask about the offering (unstaffed sections,
 * missing rollups, failed runs), where course-wide is the only correct scope. */
section('faculty-tasks.js — section scope');

const dirCtx = {
  currentOffering: 'o1',
  sectionIds: ['s1', 's2', 's3'],                    // what a director may SEE
  staff: [{ course_offering_id: 'o1', section_id: null, role: 'director' },
          { course_offering_id: 'o1', section_id: 's2', role: 'director' }],   // …and teaches
  isDirectorForCurrent: () => true,
};

let sawPerStudent = null, sawDirector = null;
await withSources([
  { id: 'per-student', severity: 'warn', icon: '⚑',
    load: async (c) => { sawPerStudent = c.sectionIds; return { count: 1, text: 't', link: 'a.html' }; } },
  { id: 'offering-wide', severity: 'warn', icon: '⚑', director: true,
    load: async (c) => { sawDirector = c.sectionIds; return { count: 1, text: 't', link: 'b.html' }; } },
], async () => {
  await T.loadTasks(dirCtx);
  eq('a per-student source is given only the sections the caller teaches', sawPerStudent, ['s2']);
  // Same narrowed ctx reaches both — a director source asks about ctx.currentOffering and never
  // reads sectionIds, so narrowing it costs nothing and one scope rule is easier to keep right.
  eq('…and the offering-wide sources do not read it anyway', sawDirector, ['s2']);
});

// The fallback, and it is the half that would otherwise fail silently: a director who teaches no
// section must still get the course-wide list rather than an empty panel.
let sawPure = null;
await withSources([
  { id: 'per-student', severity: 'warn', icon: '⚑',
    load: async (c) => { sawPure = c.sectionIds; return { count: 1, text: 't', link: 'a.html' }; } },
], async () => {
  await T.loadTasks({ ...dirCtx, staff: [{ course_offering_id: 'o1', section_id: null, role: 'director' }] });
  eq('a director who teaches nothing still sees everything they staff', sawPure, ['s1', 's2', 's3']);
});

await withSources([
  { id: 'ok', severity: 'warn', icon: '⚑', load: async () => ({ count: 3, text: 'three', link: 'a.html' }) },
  { id: 'boom', severity: 'alert', icon: '✖', load: async () => { throw new Error('query died'); } },
  { id: 'zero', severity: 'info', icon: '·', load: async () => ({ count: 0, text: 'none', link: 'b.html' }) },
  { id: 'null', severity: 'info', icon: '·', load: async () => null },
], async () => {
  const tasks = await T.loadTasks(ctx);
  eq('a source that throws is dropped, not fatal', tasks.map(t => t.id), ['ok']);
  eq('…and the surviving source keeps its count', tasks[0].count, 3);
  eq('…and carries its severity and icon through', [tasks[0].severity, tasks[0].icon], ['warn', '⚑']);
});

// Zero must never render. This is the difference between a panel people read and a panel of
// permanent zeroes people learn to skip.
await withSources([
  { id: 'zero', severity: 'info', icon: '·', load: async () => ({ count: 0, text: 'none', link: 'b.html' }) },
], async () => {
  eq('a source reporting zero contributes no box', await T.loadTasks(ctx), []);
});

// Director gating happens before the query runs, so an instructor does not even pay for it.
await withSources([
  { id: 'dir', severity: 'warn', icon: '⚑', director: true,
    load: async () => { throw new Error('should never run for an instructor'); } },
], async () => {
  const asInstructor = { ...ctx, isDirectorForCurrent: () => false };
  eq('a director-only source is not run for an instructor', await T.loadTasks(asInstructor), []);
});

/* ── 3. renderTasks ──────────────────────────────────────────────────────── */

section('faculty-tasks.js — renderTasks');

const empty = T.renderTasks([], { esc });
check('the empty state says so in words', /Nothing outstanding/.test(empty));
check('…and renders no boxes at all', !/duo-box/.test(empty));

/* The nav bar stopped listing Grade on 2026-07-23 (P1.14) on the grounds that these boxes are how
 * you get there. That is only true if a link survives when there are no boxes — otherwise the day
 * an instructor has nothing outstanding is the day the Grade page has no route to it at all. */
check('the EMPTY state still offers a way to the Grade page', empty.includes('href="grade.html"'));

const html = T.renderTasks([
  { id: 'to-grade', severity: 'alert', icon: '📝', count: 9, action: 'Review grades',
    text: '9 submissions past due and not finalized', link: 'grade.html' },
  { id: 'ai-unfinalized', severity: 'warn', icon: '🤖', count: 2, action: 'Review AI grades',
    text: '2 AI-suggested grades awaiting your review', link: 'grade.html' },
], { esc });

eq('one box per task', (html.match(/class="duo-box/g) || []).length, 2);
check('severity becomes a class', html.includes('sev-alert') && html.includes('sev-warn'));
check('the count is rendered', html.includes('>9<'));
check('each box links to the page that clears it', html.includes('href="grade.html"'));
check('the panel counts itself', html.includes('count-pill">2<'));

// The face of the box is the imperative, not the sentence — that is the whole point of the
// compact row. The sentence survives as the tooltip so nothing is actually lost.
check('the box shows the short action', html.includes('>Review AI grades<'));
check('…and the full sentence is the tooltip',
      html.includes('title="9 submissions past due and not finalized"'));

// A source written before `action` existed must still render rather than print "undefined".
const legacy = T.renderTasks([
  { id: 'x', severity: 'info', icon: '·', count: 1, text: 'something outstanding', link: 'a.html' },
], { esc });
check('a source with no action falls back to its text', legacy.includes('>something outstanding<'));

// A panel that silently shows a subset is worse than one that shows everything, so it says which.
check('the row says when it is narrowed to your own sections',
      T.renderTasks([{ id: 'x', severity: 'info', icon: '·', count: 1, text: 't', link: 'a.html' }],
                    { esc, scoped: true }).includes('your sections'));
check('…and says the wider thing when it is not',
      T.renderTasks([{ id: 'x', severity: 'info', icon: '·', count: 1, text: 't', link: 'a.html' }],
                    { esc, scoped: false }).includes('all sections you staff'));

// Source text is authored in JS today, but a future source could interpolate a section code or
// a lesson title that came from the database. Escaping is cheap now and unavailable later.
const nasty = T.renderTasks([
  { id: 'x', severity: 'info', icon: '·', count: 1,
    text: '<img src=x onerror=alert(1)>', link: 'javascript:alert(1)' },
], { esc });
check('task text is escaped', !nasty.includes('<img src=x'));

process.exitCode = summary() ? 0 : 1;
