// test-course-days.mjs — the days a course meets (courses.meeting_days, migration 086) and the screens that read them.
//
// WHAT THIS DEFENDS
//   * The default is M and T. A course form left alone writes no meeting_days at all, so the database default applies
//     and a database that has not had migration 086 yet still accepts the insert.
//   * Only the five letters M, T, W, R, F are allowed, and at least one.
//   * The list belongs to the course, not the offering, so copying one term into the next never writes to `courses`.
//   * A section that already holds a day the course does not list is still offered that day, so a save never drops it.
//   * The roster import preview says so in one line when a new section's day is outside the list, and never blocks.
//   * Before the column exists the pages fall back to M and T; any other failed read is an error, not a quiet default.
//
// WHAT THIS CANNOT PROVE
//   Offline, with a recording stub: it shows what the shipped modules ask for, not that the database accepts it.
//   The column, its check and the default are proved on a scratch database by scripts/staging/test_course_days_scratch.py.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { check, eq, section, summary, installBrowser, REPO } from './harness.mjs';

installBrowser({ pathname: '/site/faculty/terms.html' });

let CALLS = [];
globalThis.window.db = {
  from: (table) => {
    const st = { table, verb: 'select', payload: null };
    const c = {};
    for (const m of ['eq', 'in', 'is', 'not', 'order', 'limit']) c[m] = () => c;
    c.select = () => c;
    c.insert = (payload) => { st.verb = 'insert'; st.payload = payload; CALLS.push({ table, verb: 'insert', payload }); return c; };
    c.single = () => Promise.resolve({ data: { id: 'course-new' }, error: null });
    return c;
  },
};
globalThis.fetch = async () => ({ ok: false, json: async () => null });

const CD = await import('../../site/js/course-days.js');
const RI = await import('../../site/js/roster-import.js');
const T = await import('../../site/js/faculty-terms.js');
const read = (rel) => readFileSync(resolve(REPO, rel), 'utf8');
const stubRead = (result) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(result) }) }) }) });

section('the list: allowed letters, order, plain words');
{
  eq('the default is M and T', CD.DEFAULT_DAYS, ['M', 'T']);
  eq('days come back once each, in week order', CD.cleanDays(['F', 'm', 'T', 'T']), ['M', 'T', 'F']);
  eq('a letter that is not a day is dropped by cleanDays', CD.cleanDays(['M', 'X', 'S']), ['M']);
  eq('M, T, W, R, F are all allowed', CD.daysProblem(['M', 'T', 'W', 'R', 'F']), '');
  check('an empty list is refused in plain words', /at least one day/.test(CD.daysProblem([])), CD.daysProblem([]));
  check('a letter outside the five is refused', /M, T, W, R/.test(CD.daysProblem(['M', 'S'])));
  eq('two days read as "M and T"', CD.describeDays(['T', 'M']), 'M and T');
  eq('three days read as "M, W and F"', CD.describeDays(['F', 'M', 'W']), 'M, W and F');
  check('same list in another order is the same list', CD.sameDays(['T', 'M'], CD.DEFAULT_DAYS));
}

section('reading a course: default, missing column, and a real failure');
{
  const ok = await CD.loadCourseDays(stubRead({ data: { meeting_days: ['W', 'F'] }, error: null }), 'c1');
  eq('a stored list is returned', ok.days, ['W', 'F']);
  const none = await CD.loadCourseDays(stubRead({ data: null, error: null }), 'c1');
  check('a course id with no row returned is an error, not an assumed M and T', !!none.error && !none.assumed, JSON.stringify(none));
  check('no course id at all still reads as the default', (await CD.loadCourseDays(stubRead({ data: null, error: null }), null)).assumed);
  const missing = await CD.loadCourseDays(stubRead({ data: null, error: { code: '42703', message: 'column courses.meeting_days does not exist' } }), 'c1');
  check('before migration 086 the answer is M and T, assumed, with no error', missing.assumed && !missing.error && CD.sameDays(missing.days, ['M', 'T']));
  const cache = await CD.loadCourseDays(stubRead({ data: null, error: { code: 'PGRST204', message: "Could not find the 'meeting_days' column of 'courses' in the schema cache" } }), 'c1');
  check('the REST cache wording for a missing column is recognised too', cache.assumed && !cache.error);
  const bad = await CD.loadCourseDays(stubRead({ data: null, error: { code: '42501', message: 'permission denied' } }), 'c1');
  const adminHtml = (await import('node:fs')).readFileSync(new URL('../../site/faculty/admin.html', import.meta.url), 'utf8');
  check('all three screens that read the days show a failed read (import preview, Sections tab, add a section)',
    /id="imp-days-error"/.test(adminHtml) && /id="sec-days-error"/.test(adminHtml) && /id="ns-days-error"/.test(adminHtml));
  check('any other failed read is an error, never a quiet default', !!bad.error && !bad.assumed, JSON.stringify(bad));
}

section('making a course: default is left to the database');
{
  eq('a form that never mentions days passes', T.checkCourse({ code: 'phys-310', title: 'Physics 310' }), []);
  check('a form with no day ticked is refused', T.checkCourse({ code: 'phys-310', title: 'x', meetingDays: [] }).some(m => /at least one day/.test(m)));
  check('a form with a bad letter is refused', T.checkCourse({ code: 'phys-310', title: 'x', meetingDays: ['M', 'Q'] }).length === 1);
  CALLS = [];
  await T.createCourse(window.db, { code: 'phys-310', title: 'Physics 310', department: '', meetingDays: ['T', 'M'] });
  check('M and T (in any order) writes no meeting_days, so the default applies', !('meeting_days' in CALLS[0].payload), JSON.stringify(CALLS[0].payload));
  CALLS = [];
  await T.createCourse(window.db, { code: 'phys-310', title: 'Physics 310', department: '' });
  check('no days given writes no meeting_days', !('meeting_days' in CALLS[0].payload));
  CALLS = [];
  await T.createCourse(window.db, { code: 'math-200', title: 'Math 200', department: '', meetingDays: ['F', 'M', 'W'] });
  eq('another list is written in week order', CALLS[0].payload.meeting_days, ['M', 'W', 'F']);
}

section('a term copy never writes the course');
{
  const src = read('site/js/faculty-terms.js');
  const start = src.indexOf('export async function runRollover');
  const end = src.indexOf('export async function offeringImpact');
  const body = src.slice(start, end);
  check('runRollover is found', start > 0 && end > start);
  check('runRollover never names the courses table', !/from\(\s*['"]courses['"]\s*\)/.test(body));
  check('the list is stored on the course, which a copy between two offerings of one course already shares',
    /same course/i.test(src) && /problems\.push\('Rollover copies between two terms of the same course/.test(src));
}

section('a section that holds a day the course does not list');
{
  const offered = CD.daysOffered(['M', 'T'], ['W']);
  eq('the held day is still offered, after the course days', offered.map(o => o.day), ['M', 'T', 'W']);
  eq('...and marked as outside the list', offered.map(o => o.outside), [false, false, true]);
  eq('a section on a listed day adds nothing', CD.daysOffered(['M', 'T'], ['T']).map(o => o.day), ['M', 'T']);
  eq('a section with no day adds nothing', CD.daysOffered(['M', 'T'], []).map(o => o.day), ['M', 'T']);
  eq('days outside the list are named, for a note and never a block', CD.daysOutsideList(['W', 'M'], ['M', 'T']), ['W']);
  // A save that offers the list and writes back what is ticked: the held day is ticked, so it survives.
  const ticked = CD.daysOffered(['M', 'T'], ['W']).map(o => o.day).filter(d => ['W'].includes(d));
  eq('writing back the ticked days keeps the held one', CD.cleanDays(ticked), ['W']);
  const html = read('site/faculty/admin.html');
  check('the section tile shows the held day and says when the course does not list it', /function dayLine\(sec\)/.test(html) && /not in the course's list/.test(html));
  check('Add a section offers only the course days and adds an unlisted day only when the code names it',
    /async function openAddSection/.test(html) && /CD\.loadCourseDays\(db, ctx\.currentCourse\)/.test(html) && /ns-day-extra/.test(html));
  check('a failed read of the list is shown, not hidden', /ns-days-error/.test(html) && /imp-days-error/.test(html));
}

section('the roster import preview line');
{
  const note = RI.outsideDaysNote(['W1A', 'M1A', 'LAB-3'], ['M', 'T']);
  check('a section on W in an M and T course gets a line', /W1A/.test(note) && /Wednesday/.test(note), note);
  check('...that names the course days', /M, T/.test(note));
  check('...and says the section is still created and imported', /still be created and imported/.test(note));
  check('a section on a listed day and a code with no day are not mentioned', !/M1A/.test(note) && !/LAB-3/.test(note));
  eq('nothing outside the list gives no line', RI.outsideDaysNote(['M1A', 'T3B'], ['M', 'T']), '');
  check('a W and F course flags an M section', /M1A/.test(RI.outsideDaysNote(['M1A', 'W2A'], ['W', 'F'])) && !/W2A/.test(RI.outsideDaysNote(['M1A', 'W2A'], ['W', 'F'])));
  eq('no new sections gives no line', RI.outsideDaysNote([], ['M', 'T']), '');
  const html = read('site/faculty/admin.html');
  check('the preview shows the line inside the create-sections card', /imp-days-note/.test(html) && /RI\.outsideDaysNote\(parsed\.unknownSections, courseDays\.days\)/.test(html));
  check('the line does not touch the count of rows waiting or the create button', /id="mk-sections"/.test(html) && !/outsideDaysNote[^\n]*blocked/.test(html));
}

section('the course forms');
{
  const html = read('site/faculty/terms.html');
  check('both course forms carry a More options box', /daysOptionsHtml\('su-c'/.test(html) && /daysOptionsHtml\('c'\)/.test(html));
  check('the box is closed unless the choice differs from M and T', /sameDays\(sel, CD\.DEFAULT_DAYS\) \? '' : ' open'/.test(html) || /CD\.sameDays\(sel, CD\.DEFAULT_DAYS\) \? '' : ' open'/.test(html));
  check('the hint says M and T is the split schedule', /M and T is the split schedule/.test(html));
  check('both forms send the ticked days', /meetingDays: readDays\('su-c'\)/.test(html) && /meetingDays: readDays\('c'\)/.test(html));
}

process.exit(summary() ? 0 : 1);
