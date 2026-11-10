// test-tutorials.mjs -- the tutorial catalog and the off-switch rules (js/tutorials.js, js/tutorials-catalog.js).
//
// OFFLINE: pure logic and a read of the site files. No page, no network, no database.
//
// What is pinned here, and why:
//   - the automatic-start rule (on/off, `since` against `offAt`, seen versions), because it is the promise made to a
//     person who turned tutorials off: nothing starts by itself, except a tour for a feature newer than that moment;
//   - one automatic tour per page load, and none while a task runs;
//   - the catalog's shape (unique ids, every step has a page, a target and a way forward, tours may auto-start and tasks
//     may not), so a bad entry fails here and not in front of a user;
//   - that every selector a step names still exists in the page it is about. A tutorial that points at a renamed control
//     goes quiet and then says "I can't find it", so the rename is what this catches.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, eq, section, summary } from './mini-assert.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, '..', '..', 'site');

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.location = { pathname: '/site/faculty/dashboard.html', search: '', hash: '', href: 'http://localhost/site/faculty/dashboard.html' };   // util.js reads it at import

const C = await import('../../site/js/tutorials-catalog.js');
const T = await import('../../site/js/tutorials.js');

const tour = (over = {}) => ({ id: 't', kind: 'tour', tier: 'instructor', since: '2026-11-10', version: 1, auto: { page: 'faculty/dashboard.html' }, title: 'T', summary: 's', steps: [], ...over });
const prefs = (over = {}) => ({ auto: true, offAt: null, seen: [], ...over });

/* ──────────────────────────────────────────────────────────────────────────── */
section('the automatic-start rule');

check('on, not seen: shows', T.shouldShowAuto(tour(), prefs()));
check('on, seen at this version: does not show', !T.shouldShowAuto(tour(), prefs({ seen: ['t@1'] })));
check('on, seen at an OLDER version: shows again', T.shouldShowAuto(tour({ version: 2 }), prefs({ seen: ['t@1'] })));
check('off: a tour that is not newer than the switch does not show', !T.shouldShowAuto(tour({ since: '2026-11-10' }), prefs({ auto: false, offAt: '2026-11-10' })));
check('off: an OLDER tour does not show', !T.shouldShowAuto(tour({ since: '2026-10-01' }), prefs({ auto: false, offAt: '2026-11-10' })));
check('off: a tour for a NEWER feature shows once', T.shouldShowAuto(tour({ since: '2026-12-01' }), prefs({ auto: false, offAt: '2026-11-10' })));
check('off: that newer tour does not show a second time once seen', !T.shouldShowAuto(tour({ since: '2026-12-01' }), prefs({ auto: false, offAt: '2026-11-10', seen: ['t@1'] })));
check('off with no recorded moment: nothing shows', !T.shouldShowAuto(tour({ since: '2099-01-01' }), prefs({ auto: false, offAt: null })));
check('a task never shows by itself', !T.shouldShowAuto(tour({ kind: 'task' }), prefs()));
check('a tour with no auto page never shows by itself', !T.shouldShowAuto(tour({ auto: undefined }), prefs()));
check('the "New feature" label is for the off-and-newer case only',
  T.isNewFeatureShow(tour({ since: '2026-12-01' }), prefs({ auto: false, offAt: '2026-11-10' }))
  && !T.isNewFeatureShow(tour(), prefs()) && !T.isNewFeatureShow(tour({ since: '2026-12-01' }), prefs()));

section('the preference value');
eq('absent gives the default', T.parsePrefs(null), { auto: true, offAt: null, seen: [] });
eq('garbage gives the default', T.parsePrefs('{not json'), { auto: true, offAt: null, seen: [] });
eq('a stored object round-trips', T.parsePrefs(JSON.stringify({ auto: false, offAt: '2026-11-10', seen: ['a@1'] })), { auto: false, offAt: '2026-11-10', seen: ['a@1'] });
eq('wrong types are dropped', T.parsePrefs({ auto: 'no', offAt: 5, seen: ['a@1', 7, null] }), { auto: true, offAt: null, seen: ['a@1'] });
eq('turning off records the current release', T.withAutoOff(prefs()), { auto: false, offAt: C.TUTORIAL_RELEASE, seen: [] });
eq('turning on clears the moment', T.withAutoOn(prefs({ auto: false, offAt: '2026-11-10' })), { auto: true, offAt: null, seen: [] });
eq('marking seen records id@version once', T.withSeen(T.withSeen(prefs(), tour()), tour()).seen, ['t@1']);
eq('show tours again clears seen and keeps the switch', T.withSeenCleared(prefs({ auto: false, offAt: 'x', seen: ['a@1'] })), { auto: false, offAt: 'x', seen: [] });
T.savePrefs(T.withAutoOff(prefs()));
eq('saving writes the synced key as JSON and loading reads it back', T.loadPrefs(), { auto: false, offAt: C.TUTORIAL_RELEASE, seen: [] });
check('the key is the synced one', (await import('../../site/js/prefs.js')).SYNCED_KEYS.includes(T.PREF_KEY));

section('which tour starts, and how many');
const real = (over) => T.pickAuto({ prefs: prefs(), ...over });
eq('an instructor on the dashboard gets the staff welcome', real({ path: '/site/faculty/dashboard.html', tier: 'instructor' })?.id, 'welcome-staff');
eq('a student on All classes gets the student welcome', real({ path: '/site/student/summary.html', tier: 'student' })?.id, 'welcome-student');
eq('a student is never given a staff tour', real({ path: '/site/faculty/dashboard.html', tier: 'student' }), null);
eq('an instructor does not get the director admin tour', real({ path: '/site/faculty/admin.html', tier: 'instructor' }), null);
eq('a director does', real({ path: '/site/faculty/admin.html', tier: 'director' })?.id, 'tour-admin');
eq('a page with no tour starts nothing', real({ path: '/site/faculty/health.html', tier: 'admin' }), null);
eq('two tours on one page: only the first starts',
  T.pickAuto({ list: [tour({ id: 'a' }), tour({ id: 'b' })], path: '/x/faculty/dashboard.html', tier: 'instructor', prefs: prefs() })?.id, 'a');
eq('a seen tour is skipped and the next one starts',
  T.pickAuto({ list: [tour({ id: 'a' }), tour({ id: 'b' })], path: '/x/faculty/dashboard.html', tier: 'instructor', prefs: prefs({ seen: ['a@1'] }) })?.id, 'b');
check('the real catalog never has two automatic tours on one page and tier at once',
  C.TUTORIALS.filter(t => t.auto).every(t => C.TUTORIALS.filter(u => u.auto && u.auto.page === t.auto.page && u.tier === t.tier).length === 1));

section('mounting: resume first, one automatic tour per load, none during a task');
const onDash = { path: '/site/faculty/dashboard.html', tier: 'instructor', prefs: prefs() };
eq('nothing running: the tour starts', T.planMount({ ...onDash }).action, 'auto');
eq('a task running: it is resumed and nothing automatic starts', T.planMount({ ...onDash, run: { id: 'task-grade', step: 1 } }), { action: 'resume' });
eq('a tour running: it is resumed too', T.planMount({ ...onDash, run: { id: 'welcome-staff', step: 2 } }), { action: 'resume' });
eq('the second mount in one page load starts nothing', T.planMount({ ...onDash, autoDone: true }), { action: 'none', clear: false });
eq('a run for a tutorial that no longer exists is cleared, then the tour starts', T.planMount({ ...onDash, run: { id: 'gone', step: 0 } }), { action: 'auto', id: 'welcome-staff', clear: true });
eq('a run this person may not use is cleared', T.planMount({ path: '/site/student/summary.html', tier: 'student', prefs: prefs({ auto: false, offAt: '2026-11-10' }), run: { id: 'task-add-staff', step: 0 } }), { action: 'none', clear: true });
eq('off for good: no tour starts on a first visit', T.planMount({ ...onDash, prefs: prefs({ auto: false, offAt: C.TUTORIAL_RELEASE }) }), { action: 'none', clear: false });

section('paths');
check('a path ends with the catalog page', T.pathMatches('/site/faculty/terms.html', 'faculty/terms.html'));
check('Pages serves the site under a longer prefix', T.pathMatches('/Core_Preflights/site/faculty/terms.html', 'faculty/terms.html'));
check('a page that only ends the same way is not a match', !T.pathMatches('/site/xfaculty/terms.html', 'faculty/terms.html'));
check('a step with no page matches any page', T.pathMatches('/anything', null));

/* ──────────────────────────────────────────────────────────────────────────── */
section('the catalog');

eq('the real catalog has no problems', C.validateCatalog(), []);
const ids = C.TUTORIALS.map(t => t.id);
eq('ids are unique', new Set(ids).size, ids.length);
check('every tier is a real tier and every kind a real kind', C.TUTORIALS.every(t => C.TIERS.includes(t.tier) && C.KINDS.includes(t.kind)));
check('only tours start by themselves', C.TUTORIALS.every(t => !t.auto || t.kind === 'tour'));
check('no tutorial is newer than the release constant', C.TUTORIALS.every(t => t.since <= C.TUTORIAL_RELEASE));
check('there is a tour and a task for staff, and a tour and a task for cadets',
  ['instructor', 'director'].some(x => C.TUTORIALS.some(t => t.tier === x && t.kind === 'task'))
  && C.TUTORIALS.some(t => t.tier === 'student' && t.kind === 'tour') && C.TUTORIALS.some(t => t.tier === 'student' && t.kind === 'task'));
for (const id of ['welcome-staff', 'welcome-student', 'tour-assignments', 'tour-gradebook', 'tour-admin', 'tour-grade',
  'task-create-course', 'task-add-students', 'task-add-assignment', 'task-add-staff', 'task-grade', 'task-open-report', 'task-start-assignment']) {
  check(`the spec's tutorial ${id} exists`, ids.includes(id));
}
check('a destructive control is never a step (nothing targets a delete, remove or hold button)',
  C.catalogSelectors().every(s => !/remove|delete|rm-hold|hold-btn|data-reset|finalize-btn.*click/i.test(s.selector)));
check('the grade task stops before Finalize: it is an info step, not a click',
  C.tutorialById('task-grade').steps.filter(s => /finalize/.test(JSON.stringify(s.target))).every(s => s.advance === 'next'));
check('a director who opens "create a course" gets a path of their own, and it is valid',
  Array.isArray(C.tutorialById('task-create-course').stepsNonAdmin) && C.validateCatalog().length === 0);
eq('an admin runs the full path', C.stepsFor(C.tutorialById('task-create-course'), { instructorRow: { is_global_admin: true } }).length, C.tutorialById('task-create-course').steps.length);
eq('a director runs the shorter one', C.stepsFor(C.tutorialById('task-create-course'), { instructorRow: { is_global_admin: false } }).length, C.tutorialById('task-create-course').stepsNonAdmin.length);

section('the Help list is cumulative like the help topics');
const forTier = (tier) => C.tutorialsForTier(tier).map(t => t.id);
check('a student sees only student tutorials', C.tutorialsForTier('student').every(t => t.tier === 'student'));
check('staff are not offered cadet tutorials (cadet pages send staff away)', !forTier('instructor').includes('welcome-student') && !forTier('admin').includes('task-start-assignment') && forTier('instructor').includes('task-grade'));
check('an instructor does not see director tasks', !forTier('instructor').includes('task-add-students'));
check('a director sees the instructor and the director ones', forTier('director').includes('task-grade') && forTier('director').includes('task-add-students'));
check('an admin sees every staff tutorial', forTier('admin').length === C.TUTORIALS.filter(t => t.tier !== 'student').length);

section('the validator itself catches bad entries');
const bad = (t) => C.validateCatalog([t]).length > 0;
const goodStep = { page: 'faculty/dashboard.html', target: null, title: 'a', text: 'b', advance: 'next' };
const goodTour = { id: 'x', kind: 'tour', tier: 'student', title: 't', summary: 's', since: '2026-11-10', version: 1, steps: [goodStep] };
check('a sound entry passes', C.validateCatalog([goodTour]).length === 0);
check('a task that starts by itself fails', bad({ ...goodTour, kind: 'task', auto: { page: 'faculty/dashboard.html' }, steps: [{ ...goodStep }] }));
check('an unknown tier fails', bad({ ...goodTour, tier: 'king' }));
check('a step with no way forward fails', bad({ ...goodTour, steps: [{ ...goodStep, advance: {} }] }));
check('a step with no target key fails', bad({ ...goodTour, steps: [{ page: 'faculty/dashboard.html', title: 'a', text: 'b', advance: 'next' }] }));
check('a click step with nothing to show fails', bad({ ...goodTour, steps: [{ ...goodStep, advance: { click: '#x' } }] }));
check('a page with no name fails', bad({ ...goodTour, steps: [{ ...goodStep, page: 'faculty/nowhere.html' }] }));
check('a duplicate id fails', C.validateCatalog([goodTour, goodTour]).length > 0);
check('a tutorial from the future fails', bad({ ...goodTour, since: '2099-01-01' }));

/* ──────────────────────────────────────────────────────────────────────────── */
section('every control the catalog names still exists in its page');

const walk = (dir) => readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? (n === 'gemini' || n === 'genai' ? [] : walk(p)) : [p]; });
const files = walk(SITE);
const read = (p) => readFileSync(p, 'utf8');
// The catalog and the engine are left out of the corpus: a selector must be found in the PAGE side, not in the list that names it.
const jsAll = files.filter(f => f.endsWith('.js') && f.includes(join('site', 'js')) && !/tutorials(-catalog)?\.js$/.test(f)).map(read).join('\n');
const htmlOf = (page) => page ? read(join(SITE, page)) : files.filter(f => /(faculty|student)[\\/][^\\/]+\.html$/.test(f)).map(read).join('\n');

const tokensOf = (selector) => {
  const out = [];
  for (const m of selector.matchAll(/#([A-Za-z][\w-]*)/g)) out.push({ kind: 'id', name: m[1] });
  for (const m of selector.matchAll(/\.([A-Za-z][\w-]*)/g)) out.push({ kind: 'class', name: m[1] });
  for (const m of selector.matchAll(/\[(data-[\w-]+)/g)) out.push({ kind: 'attr', name: m[1] });
  return out;
};
const has = (text, name) => new RegExp(`(?<![\\w-])${name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?![\\w-])`).test(text);
const missing = [];
let checked = 0;
for (const s of C.catalogSelectors()) {
  const corpus = htmlOf(s.page) + '\n' + jsAll;
  for (const tok of tokensOf(s.selector)) {
    // The tab and brand-level controls are drawn by shared chrome, and a few ids are drawn from a template string: the
    // token is found as a quoted name or an id attribute in either place.
    checked++;
    if (!has(corpus, tok.name)) missing.push(`${s.id} ${s.at}: ${tok.kind} "${tok.name}" (${s.selector})`);
  }
}
check(`${checked} selector tokens were looked for`, checked > 40);
check('every id, class and data attribute a step names is found in the page or a module', missing.length === 0, missing.slice(0, 6).join(' | '));
check('a step on a named page names a page that exists', C.TUTORIALS.every(t => [t.steps, t.stepsNonAdmin || []].flat().every(s => !s.page || files.some(f => f.endsWith(s.page.replace('/', '\\')) || f.endsWith(s.page)))));
check('the menu link to the courses page, which a task clicks, is in the user menu', /href: 'terms\.html'/.test(read(join(SITE, 'js', 'nav.js'))));

section('the menu and the pages');
const nav = await import('../../site/js/nav.js');
const menu = (ctx) => nav.userMenuLinks(ctx).map(l => l.key);
check('every role sees Tutorials in the user menu', menu({ role: 'student' }).includes('tutorials') && menu({ role: 'faculty', instructorRow: {}, isDirectorForCurrent: () => false }).includes('tutorials'));
eq('the menu entry goes to the section at the top of Help', nav.USER_MENU_LINKS.find(l => l.key === 'tutorials')?.href, 'help.html#tutorials');
check('nav mounts the guide', /mountTutorials\(ctx\)/.test(read(join(SITE, 'js', 'nav.js'))));
check('the Help page lists tutorials first, with the start buttons the tests and the engine use',
  /id="tutorials"/.test(read(join(SITE, 'js', 'help.js'))) && /data-tutorial-start/.test(read(join(SITE, 'js', 'help.js')))
  && read(join(SITE, 'js', 'help.js')).indexOf('${tutorialsHTML(ctx)}${html}') > 0);
check('the account page has the switch and the reset', /id="pf-tutorials"/.test(read(join(SITE, 'js', 'account.js'))) && /id="pf-tutorials-reset"/.test(read(join(SITE, 'js', 'account.js'))));
check('the engine binds no Escape key (modals use it) and never prevents a default',
  !/Escape/.test(read(join(SITE, 'js', 'tutorials.js'))) && !/preventDefault|stopPropagation/.test(read(join(SITE, 'js', 'tutorials.js')).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));
check('the engine writes nothing to the database itself: no database client is imported',
  !/supabase|from\('|\.from\(/.test(read(join(SITE, 'js', 'tutorials.js')).replace(/\/\/.*$/gm, '')));

process.exit(summary() ? 0 : 1);
