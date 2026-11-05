// test-roles.mjs — a person's role is decided per course and term, never "anywhere".
// Offline: a stub stands in for the database and nothing touches the network.
//
// Cases: someone who directs one course and teaches another in the same term; someone who directed a past
// term and now only teaches. It runs the shipped bootstrap (site/js/auth.js), the shipped nav decisions
// (site/js/nav.js) and the shipped checklist selection (site/js/faculty-terms.js).
//
// WHAT IT CANNOT PROVE: that the database enforces the same per-offering rule. That is read from the
// migrations and reported separately; this suite only shows what the pages decide.

import { check, eq, section, summary, installBrowser, readRepoFile } from './harness.mjs';

installBrowser({ pathname: '/site/faculty/dashboard.html' });

const USER = { id: 'u-1', app_metadata: {}, user_metadata: {} };
let INSTRUCTOR = { id: 'u-1', name: 'Test Person', is_global_admin: false };
let STAFF = [];

const off = (id, code, term, label, active) => ({
  id, is_active: active, course_id: 'c-' + code, term_id: 't-' + term,
  courses: { id: 'c-' + code, code, title: code.toUpperCase() },
  terms: { id: 't-' + term, code: term, label, starts_on: null, ends_on: null },
});
const OFF = {
  a_now: off('o-a-now', 'phys-a', 'fall-2026', 'Fall 2026', true),
  b_now: off('o-b-now', 'phys-b', 'fall-2026', 'Fall 2026', true),
  a_past: off('o-a-past', 'phys-a', 'spring-2026', 'Spring 2026', false),
};
const row = (o, role, section_id = null) => ({ id: `${o.id}-${role}-${section_id}`, role, section_id, course_offering_id: o.id, course_offerings: o });

const chain = (table) => {
  const c = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'is', 'not', 'neq']) c[m] = () => c;
  const result = (mode) => {
    if (table === 'instructors') return { data: INSTRUCTOR, error: null };
    if (table === 'staff_assignments') return { data: STAFF, error: null };
    if (table === 'sections') return { data: [], error: null };
    return { data: mode === 'many' ? [] : null, error: null };
  };
  c.maybeSingle = () => Promise.resolve(result('maybe'));
  c.single = () => Promise.resolve(result('single'));
  c.then = (res, rej) => Promise.resolve(result('many')).then(res, rej);
  return c;
};
globalThis.window.db = {
  auth: { getSession: async () => ({ data: { session: { user: USER } } }), signOut: async () => {} },
  from: chain,
  rpc: async () => ({ data: null, error: null }),
};

const { bootstrap } = await import('../../site/js/auth.js');
const { visibleNavLinks, navRoleLabel } = await import('../../site/js/nav.js');
const T = await import('../../site/js/faculty-terms.js');

const signIn = async (staff, who = {}) => {
  globalThis.localStorage.clear();
  STAFF = staff; INSTRUCTOR = { id: 'u-1', name: 'Test Person', is_global_admin: false, ...who };
  return bootstrap({ require: 'faculty' });
};
const navKeys = (ctx) => visibleNavLinks(ctx).map(l => l.key);
const OFFERINGS = Object.values(OFF).map(o => ({ id: o.id, isActive: o.is_active }));

section('directs one course, teaches another, same term');
{
  const ctx = await signIn([row(OFF.a_now, 'director'), row(OFF.b_now, 'instructor', 'sec-1')]);
  await ctx.setCurrentOffering('o-a-now');
  check('on the course they direct: a director', ctx.isDirectorForCurrent() === true);
  check('on the course they direct: the bar offers director pages', navKeys(ctx).includes('items') && navKeys(ctx).includes('admin'));
  eq('on the course they direct: the role word', navRoleLabel(ctx), 'Director');

  await ctx.setCurrentOffering('o-b-now');
  check('switching to the course they teach: not a director', ctx.isDirectorForCurrent() === false);
  check('switching to the course they teach: director pages leave the bar', !navKeys(ctx).includes('items') && !navKeys(ctx).includes('admin') && !navKeys(ctx).includes('terms'));
  eq('switching to the course they teach: the role word', navRoleLabel(ctx), 'Instructor');

  await ctx.setCurrentOffering('o-a-now');
  check('switching back restores the director view', ctx.isDirectorForCurrent() === true && navKeys(ctx).includes('items'));
  check('the global admin page never appears for a director', !navKeys(ctx).includes('system'));
}

section('directed a past term, now only teaches');
{
  const ctx = await signIn([row(OFF.a_past, 'director'), row(OFF.a_now, 'instructor', 'sec-1')]);
  await ctx.setCurrentOffering('o-a-now');
  check('in the current term of the same course: not a director', ctx.isDirectorForCurrent() === false);
  check('no director pages on the bar for the current term', !navKeys(ctx).includes('items') && !navKeys(ctx).includes('admin'));
  eq('the role word is Instructor', navRoleLabel(ctx), 'Instructor');
  await ctx.setCurrentOffering('o-a-past');
  check('choosing the past term: a director of that term only', ctx.isDirectorForCurrent() === true);
}

section('the checklist lists only what the person directs');
{
  const ctx = await signIn([row(OFF.a_past, 'director'), row(OFF.a_now, 'instructor', 'sec-1'), row(OFF.b_now, 'director')]);
  const ids = (extra) => T.checklistTargets(OFFERINGS, ctx.courses, extra).map(o => o.id).sort();
  eq('only the two offerings they direct', ids({}), ['o-a-past', 'o-b-now']);
  check('teaching offering never appears', !ids({}).includes('o-a-now'));
  check('a focus on an offering they do not direct adds nothing', !ids({ focusId: 'o-a-now' }).includes('o-a-now'));
  eq('a focus on one they direct puts it first', T.checklistTargets(OFFERINGS, ctx.courses, { focusId: 'o-b-now' })[0].id, 'o-b-now');

  const teacher = await signIn([row(OFF.a_now, 'instructor', 'sec-1')]);
  eq('someone who directs nothing gets no checklist', T.checklistTargets(OFFERINGS, teacher.courses, {}), []);

  const admin = await signIn([], { is_global_admin: true });
  eq('an administrator gets the chosen course and the one just set up, not all',
    T.checklistTargets(OFFERINGS, admin.courses, { isAdmin: true, currentOffering: 'o-a-now', focusId: 'o-b-now' }).map(o => o.id), ['o-b-now', 'o-a-now']);

  const many = Array.from({ length: 9 }, (_, i) => ({ id: `x${i}` }));
  eq('at most six', T.checklistTargets(many, many.map(o => ({ offeringId: o.id, role: 'director' }))).length, 6);
}

section('no page decides by "a director somewhere" for what it writes');
{
  const items = readRepoFile('site/faculty/items.html'), qs = readRepoFile('site/faculty/questions.html'), sc = readRepoFile('site/faculty/scale.html');
  for (const [n, s] of [['items', items], ['questions', qs], ['scale', sc]])
    check(`${n}.html gates on the chosen course`, /isDirectorForCurrent\(\)/.test(s) && !/courses\s*\|\|\s*\[\]\)\.some\(c => c\.role === 'director'\)/.test(s));
  const terms = readRepoFile('site/faculty/terms.html');
  check('the Set up page builds its checklist from the shared per-offering selection', /T\.checklistTargets\(/.test(terms));
}

process.exit(summary() ? 0 : 1);
