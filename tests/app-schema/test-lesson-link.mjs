// test-lesson-link.mjs — the prefill link and the destination chooser mean the same on the Assignments page as on the
// older lesson editor.
//
// WHAT THIS DEFENDS
//   The prefill link is a FROZEN contract (docs/contracts/INTERACTION-PREFILL-LINK.md): AI tutor builds still hand out
//   links to faculty/lessons.html. This test takes the older page's OWN code out of site/faculty/lessons.html (the
//   functions that read the query, resolve the course, label the destination cards and overlay the link on the form),
//   runs it on a set of queries, runs the new module on the same queries, and compares what each one decides:
//     * whether the URL is a link at all, and every value the link carries;
//     * the offering the link names, and whether the course code was honoured;
//     * which offerings may be chosen as a destination;
//     * the badge each existing assignment gets (add, update in place, replace) and what choosing one carries;
//     * the title, description, number, assignment id, tutor id/link/title/description, the dates and the publish flag
//       that land in the form.
//   Both pages read the same query and must reach the same answer. If lessons.html is edited so they differ, this fails.
//
// WHAT THIS CANNOT PROVE
//   Offline, in Node. It runs the older page's functions with a fake document; it does not render either page, and it
//   cannot show a click. The dates are compared where the page places them (the due map the older page saves from, and
//   the schedule the new page saves from), not by driving either form.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { check, eq, section, summary, installBrowser, REPO } from './harness.mjs';

installBrowser({ pathname: '/site/faculty/items.html' });
globalThis.window.db = { from: () => { throw new Error('no database in this test'); } };

const LK = await import('../../site/js/lesson-link.js');
const L = await import('../../site/js/faculty-lessons.js');

const OLD = readFileSync(resolve(REPO, 'site/faculty/lessons.html'), 'utf8').split(String.fromCharCode(13) + String.fromCharCode(10)).join(String.fromCharCode(10));
const between = (from, to) => {
  const a = OLD.indexOf(from);
  const b = OLD.indexOf(to, a + from.length);
  if (a < 0 || b < 0) throw new Error(`could not find the older page's code between "${from}" and "${to}"`);
  return OLD.slice(a, b);
};

/* ── the older page's code, lifted out as text ─────────────────────────────────────────────── */
const READ_SRC = between('async function prefillFromQuery()', '// ── Destination chooser');
const CARDS_SRC = between('function renderDestLessons(prefill)', 'async function renderSwapNotice()');
const OVERLAY_SRC = between("if (prefill) {\n        if (['preflight'", '// Disarm the lesson-id mirror');
const FIELDS_SRC = between("const idField = document.getElementById('f-id');", "document.getElementById('f-pts')");

/* ── the pieces the older code leans on ────────────────────────────────────────────────────── */
const COURSES = [
  { offeringId: 'co-215-spring', courseCode: 'phys-215', courseTitle: 'Physics 215', termLabel: 'Spring 2027', role: 'director' },
  { offeringId: 'co-110-spring', courseCode: 'phys-110', courseTitle: 'Physics 110', termLabel: 'Spring 2027', role: 'instructor' },
  { offeringId: 'co-215-fall',   courseCode: 'phys-215', courseTitle: 'Physics 215', termLabel: 'Fall 2026',   role: 'director' },
  { offeringId: 'co-310-spring', courseCode: 'phys-310', courseTitle: 'Physics 310', termLabel: 'Spring 2027', role: 'director' },
];
const mkCtx = (current, admin = false) => ({
  courses: COURSES, currentOffering: current, instructorRow: { is_global_admin: admin },
  courseTitleOf: () => 'Physics', currentTermLabel: 'Spring 2027',
});

/** Run the older page's read-the-link code for one query; report what it decided. */
async function oldRead(search, { current = 'co-215-spring', director = true, admin = false } = {}) {
  const ctx = mkCtx(current, admin);
  const calls = { chooser: null, switched: null, replaced: null };
  const loc = { search, pathname: '/site/faculty/lessons.html' };
  const hist = { replaceState: (_a, _b, url) => { calls.replaced = url; } };
  const factory = new Function('location', 'history', 'ctx', 'isDirector', 'switchOffering', 'openDestChooser',
    `${READ_SRC}\nreturn { prefillFromQuery, resolveOffering, authorableOfferings };`);
  const fns = factory(loc, hist, ctx, () => director, async (id) => { calls.switched = id; ctx.currentOffering = id; },
    (prefill) => { calls.chooser = JSON.parse(JSON.stringify(prefill)); });
  await fns.prefillFromQuery();
  return { ...calls, authorable: fns.authorableOfferings().map(c => c.offeringId) };
}

/** What the new module decides for the same query. */
function newRead(search, { current = 'co-215-spring', admin = false } = {}) {
  const prefill = LK.parsePrefill(search, { courses: COURSES, currentOffering: current });
  return { prefill, authorable: LK.authorableOfferings(COURSES, admin).map(c => c.offeringId) };
}

const QUERIES = {
  'full artifact link':
    '?new=1&id=lesson-04-circuits&course=phys-215&title=Circuits&desc=Series%20and%20parallel&policy=choice&num=4&due_m=2027-02-01&due_t=2027-02-02&url=https%3A%2F%2Fclaude.ai%2Fpublic%2Fartifacts%2Fabc&iid=phys215-circuits-1a2b3c4d&ititle=Circuits%20tutor&idesc=Ten%20minutes&pub=1',
  'tutor only': '?iid=phys215-x-00112233&url=https%3A%2F%2Fexample.test%2Fa',
  'title only': '?title=Only%20a%20title',
  'iurl spelling': '?id=lesson-05&iurl=https%3A%2F%2Fexample.test%2Fb',
  'new flag only': '?new=1',
  'other course the person only teaches': '?new=1&course=phys-110&title=T',
  'a course the person does not run': '?new=1&course=phys-999&title=T',
  'interaction policy, publish off': '?id=lesson-06&policy=interaction&pub=0&iid=lesson-06',
  'preflight policy, publish word yes': '?id=lesson-07&policy=preflight&pub=yes&due_m=2027-03-01',
  'unknown policy': '?id=lesson-08&policy=banana&title=T',
  'T date only': '?id=lesson-09&due_t=2027-03-02',
  'not a link': '?a=some-offering-id',
  'empty': '',
  'only unrelated words': '?foo=1&bar=2',
};

section('the older page and the new module agree on every query: is it a link, and what does it carry');
for (const [name, q] of Object.entries(QUERIES)) {
  const o = await oldRead(q);
  const n = newRead(q);
  const wasLink = o.chooser !== null;
  check(`${name}: link or not`, wasLink === (n.prefill !== null), `old ${wasLink} new ${n.prefill !== null}`);
  if (wasLink && n.prefill) {
    // The older page may have switched offering first (a link naming another course the person runs); its prefill
    // object is then built with the scope as resolved BEFORE the switch, which is what both sides read.
    const oldP = o.chooser, newP = n.prefill;
    eq(`${name}: every value the link carries`, newP, oldP);
    check(`${name}: the older page cleaned the address`, o.replaced === '/site/faculty/lessons.html');
  }
  eq(`${name}: the offerings that may be chosen`, n.authorable, o.authorable);
}
{
  const o = await oldRead('?new=1&course=phys-110&title=T', { director: false });
  check('a person who is not a director gets no chooser from the older page', o.chooser === null);
  const a = await oldRead('?new=1&course=phys-110&title=T', { admin: true });
  eq('a global admin may author in every offering (old)', a.authorable, COURSES.map(c => c.offeringId));
  eq('and so on the new module', newRead('?new=1', { admin: true }).authorable, COURSES.map(c => c.offeringId));
}

section('the course a link names becomes the same offering');
for (const [code, current] of [[null, 'co-215-spring'], ['phys-215', 'co-215-fall'], ['phys-215', 'co-110-spring'], ['phys-110', 'co-215-spring'],
                               ['phys-310', 'co-215-spring'], ['phys-999', 'co-215-spring']]) {
  const ctx = mkCtx(current);
  const fns = new Function('ctx', `${READ_SRC}\nreturn { resolveOffering };`)(ctx);
  eq(`course ${code} from ${current}`, LK.resolveOffering(COURSES, current, code), fns.resolveOffering(code));
}
check('a link for a course the person is in a different term of prefers the term in view',
  LK.resolveOffering(COURSES, 'co-215-fall', 'phys-215').offeringId === 'co-215-fall');
check('a course that is not theirs is reported, not swallowed',
  LK.resolveOffering(COURSES, 'co-215-spring', 'phys-999').matched === false);

section('each existing assignment gets the same label, and choosing it carries the same thing');
{
  const cases = [
    { n: 'no tutor yet', tutorSlug: null, num: 3, pub: true },
    { n: 'the same tutor id', tutorSlug: 'lesson-04', num: null, pub: false },
    { n: 'a different tutor id', tutorSlug: 'older-id', num: 7, pub: true },
  ];
  const iid = 'lesson-04';
  const prefill = LK.parsePrefill('?id=lesson-04&iurl=https%3A%2F%2Fx.test&ititle=Tit', { courses: COURSES, currentOffering: 'co-215-spring' });
  // The older page's cards, rendered with a fake document and read back.
  const lessons = cases.map((c, i) => ({
    offeringId: `off-${i}`, title: c.n, slug: `s${i}`, lessonNumber: c.num, isPublished: c.pub,
    interactive: c.tutorSlug ? { slug: c.tutorSlug, id: 'act-' + i } : null,
  }));
  const holder = { html: '' };
  const fakeDoc = { getElementById: (id) => id === 'dest-lessons'
    ? { set innerHTML(v) { holder.html = v; }, get innerHTML() { return holder.html; }, querySelectorAll: () => [] }
    : { innerHTML: '', style: {}, set textContent(_v) {} } };
  const opened = [];
  const fn = new Function('document', 'vm', 'ctx', 'esc', 'L', 'openEdit', 'closeDest', 'renderSwapNotice',
    `let pendingSwap = null;\n${CARDS_SRC}\nreturn { renderDestLessons, chooseDestLesson, get pending() { return pendingSwap; } };`)(
    fakeDoc, { lessons }, mkCtx('co-215-spring'), (s) => String(s ?? ''), { countActivityReports: async () => 0 },
    async (id, overlay) => { opened.push({ id, overlay }); }, () => {}, () => {});
  fn.renderDestLessons(prefill);
  const badges = [...holder.html.matchAll(/class="lb-orphan-badge">([^<]+)</g)].map(m => m[1]);
  const metas = [...holder.html.matchAll(/class="lb-orphan-meta">([^<]+)</g)].map(m => m[1]);
  for (let i = 0; i < cases.length; i++) {
    const card = LK.destinationCard({ tutorSlug: cases[i].tutorSlug, isNew: true, isPublished: cases[i].pub, lessonNumber: cases[i].num }, iid);
    eq(`${cases[i].n}: the badge`, card.badge, badges[i]);
    eq(`${cases[i].n}: the line under it (older text, saying tutor for interaction and artifact)`, card.meta,
      metas[i].replace(/interaction/g, 'tutor').replace('this artifact', 'this tutor'));
    await fn.chooseDestLesson(`off-${i}`, prefill);
    eq(`${cases[i].n}: what choosing it carries`, LK.overlayForExisting(prefill), opened[i].overlay);
    eq(`${cases[i].n}: a replacement is detected the same way`, card.swap, !!fn.pending && lessons[i].interactive?.slug !== iid && !!lessons[i].interactive);
  }
  check('an assignment from the older page is shown but cannot be chosen', LK.destinationCard({ tutorSlug: null, isNew: false }, iid).selectable === false);
  check('and says so', LK.destinationCard({ tutorSlug: null, isNew: false }, iid).badge === 'Older page');
}

section('the link fills the same form: title, description, number, id, tutor, dates, publish flag');
{
  const sectionsFor = {
    'M and T sections': [{ id: 'm1', meeting_days: ['M'] }, { id: 't1', meeting_days: ['T'] }, { id: 'm2', meeting_days: ['M'] }],
    'one track (M)': [{ id: 'm1', meeting_days: ['M'] }, { id: 'm2', meeting_days: ['M'] }],
    'no meeting days': [{ id: 'x1', meeting_days: [] }],
    'other days (W, F)': [{ id: 'w1', meeting_days: ['W', 'F'] }],
  };
  const fieldSrc = `${OVERLAY_SRC}\n${FIELDS_SRC}`;
  const runOld = (prefill) => {
    const els = {};
    const doc = { getElementById: (id) => (els[id] ||= { id, value: '', checked: false, disabled: false, textContent: '' }) };
    const model = { policy: 'choice', interactive: { include: false, slug: '', title: '', artifact_url: '', description: '' }, dueByDay: {} };
    new Function('document', 'model', 'prefill', 'id', 'existing', 'ctx',
      `const pick = (pv, ev) => (pv != null && pv !== '' ? pv : (ev ?? ''));
${fieldSrc}`)(doc, model, prefill, null, null, { currentOffering: 'co-215-spring', courses: COURSES });
    return { model, els };
  };
  for (const [qname, q] of Object.entries(QUERIES)) {
    const prefill = LK.parsePrefill(q, { courses: COURSES, currentOffering: 'co-215-spring' });
    if (!prefill) continue;
    const old = runOld(prefill);
    for (const [sname, secs] of Object.entries(sectionsFor)) {
      const form = LK.formFromPrefill(prefill, secs);
      const tag = `${qname} / ${sname}`;
      eq(`${tag}: title`, form.title ?? '', old.els['f-title'].value);
      eq(`${tag}: description`, form.description ?? '', old.els['f-desc'].value);
      eq(`${tag}: number`, form.lessonNumber ?? '', String(old.els['f-num'].value));
      eq(`${tag}: assignment id`, form.slug ?? '', old.els['f-id'].value);
      eq(`${tag}: publish flag`, form.publishRequested ?? null, prefill.pub != null ? old.els['f-pub'].checked : null);
      const oldTutor = old.model.interactive.include;
      eq(`${tag}: tutor included`, !!form.withTutor, oldTutor);
      if (oldTutor) {
        eq(`${tag}: tutor id`, form.interactiveSlug ?? '', old.model.interactive.slug);
        eq(`${tag}: tutor link`, form.interactiveUrl ?? '', old.model.interactive.artifact_url);
        eq(`${tag}: tutor title`, form.interactiveTitle ?? '', old.model.interactive.title);
        eq(`${tag}: tutor description`, form.interactiveDesc ?? '', old.model.interactive.description);
      }
      eq(`${tag}: policy`, form.policy ?? 'choice', ({ preflight: 'typed', interaction: 'tutor', choice: 'choice' })[old.model.policy]);
      // Dates: the schedule each page SAVES. The older page turns its per-day map into section rows and a default;
      // the new page turns its boxes into the same. Compare those.
      const oldRows = L.dueRowsFor('o', old.model.dueByDay, secs);
      const oldDefault = L.defaultDueFrom(old.model.dueByDay);
      const I = await import('../../site/js/faculty-items.js');
      const sched = I.buildSchedule({ time: '23:59', allDate: form.allDate || '', dayDates: form.dayDates || {}, sameDate: false, sectionDates: {} }, secs, 'o');
      // The older page reads a bare date as 23:59:59 in the BROWSER zone; the new page reads it as 23:59 Mountain.
      // Compare calendar days (Mountain for the new page, the machine's own for the older one) so a machine zone cannot matter.
      const day = (iso) => (iso ? I.instantToZone(iso)?.date : null);
      const toDayOld = (iso) => {
        if (!iso) return null;
        const d = new Date(iso); const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      };
      eq(`${tag}: the default deadline's day`, day(sched.dueAt), toDayOld(oldDefault));
      // What each section is actually due: its own row when it has one, else the default (precedence: row, then default).
      const effOld = secs.map(s => `${s.id}=${toDayOld(oldRows.find(r => r.section_id === s.id)?.due_at || oldDefault)}`).join('|');
      const effNew = secs.map(s => `${s.id}=${day(sched.rows.find(r => r.section_id === s.id)?.due_at || sched.dueAt)}`).join('|');
      eq(`${tag}: the day each section is due`, effNew, effOld);
    }
  }
}

section('the policy words and who earns credit');
{
  for (const [word, mine] of [['preflight', 'typed'], ['interaction', 'tutor'], ['choice', 'choice']]) {
    eq(`link word ${word}`, LK.POLICY_FROM_LINK[word], mine);
    const r = LK.rolesFor(mine);
    eq(`${word}: the typed path's role is the older editor's`, r.typed, L.roleFor(word, 'written'));
    eq(`${word}: the tutor path's role is the older editor's`, r.tutor, L.roleFor(word, 'interactive'));
    eq(`${word}: the stored roles read back as the same policy`, LK.policyFromRoles(r.typed, r.tutor), mine);
  }
  eq('two practice paths read back as no policy', LK.policyFromRoles('practice', 'practice'), null);
  eq('an unknown policy falls to the older default, choice', LK.rolesFor('x'), LK.rolesFor('choice'));
}

section('a link names a course: only a course the person directs counts as found (review 3, M1)');
{
  const authorable = LK.authorableOfferings(COURSES, false);
  const r = LK.resolveOffering(COURSES, 'co-215-spring', 'phys-110', authorable);
  check('a course the person only teaches is reported as not found', r.matched === false && r.offeringId === 'co-215-spring' && r.requestedCode === 'phys-110');
  const q = '?new=1&id=lesson-04-x&course=phys-110&title=T';
  const p = LK.parsePrefill(q, { courses: COURSES, currentOffering: 'co-215-spring', authorable });
  check('the link says it asked for phys-110 and did not get it', p.requestedCode === 'phys-110' && p.codeMatched === false);
  check('a course the person directs, in another term, is found', LK.resolveOffering(COURSES, 'co-215-spring', 'phys-215', authorable).offeringId === 'co-215-spring');
  check('a course in a term the person directs is found', LK.resolveOffering(COURSES, 'co-215-spring', 'phys-310', authorable).offeringId === 'co-310-spring');
  check('with no list given, the older behaviour holds (the parity test above)', LK.resolveOffering(COURSES, 'co-215-spring', 'phys-110').matched === true);
}

section('a hostile policy word is ignored, as the older page ignores it (review 3, m1)');
{
  for (const word of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', 'banana', '']) {
    const f = LK.formFromPrefill({ policy: word, title: 'T' }, []);
    check(`policy=${word || '(empty)'} puts nothing in the form`, !('policy' in f));
  }
  eq('a real word still translates', LK.formFromPrefill({ policy: 'interaction' }, []).policy, 'tutor');
}

section('runPrefill: a link for another course the person directs switches the page first, or refuses, and never opens on the course on screen (review 3, C1)');
{
  const mkIo = (over = {}) => {
    const log = [];
    let current = over.current || 'co-215-spring';
    let viewOk = over.viewOk !== undefined ? over.viewOk : true;
    const io = {
      log, courses: COURSES,
      authorable: () => LK.authorableOfferings(COURSES, !!over.admin),
      currentOffering: () => current,
      ready: () => viewOk,
      switchTo: async (id) => { log.push('switch:' + id); current = id; viewOk = over.switchFails ? false : true; return over.switchFails ? { error: { message: 'load failed' } } : { error: null }; },
      clearAddress: () => log.push('clear'),
      openChooser: async (prefill) => { log.push('chooser:' + prefill.offeringId + ':current=' + current); },
      refuse: (text) => log.push('refuse:' + text),
    };
    return io;
  };
  const link = '?new=1&id=lesson-04-x&course=phys-110&title=T&url=https%3A%2F%2Fclaude.ai%2Fpublic%2Fartifacts%2Fabc';
  {
    const io = mkIo({ admin: true });
    await LK.runPrefill(link, io);
    eq('director of both, page on 215: the page is switched to 110, then the chooser opens on 110',
      io.log.filter(x => !x.startsWith('clear')), ['switch:co-110-spring', 'chooser:co-110-spring:current=co-110-spring']);
  }
  {
    const io = mkIo({ admin: true, switchFails: true });
    await LK.runPrefill(link, io);
    check('a switch that fails refuses plainly and the chooser never opens', io.log.some(x => x.startsWith('refuse:')) && !io.log.some(x => x.startsWith('chooser')));
  }
  {
    const io = mkIo();
    await LK.runPrefill(link, io);
    check('a course the person only teaches: no switch, the chooser says so (codeMatched false), and it names the course on screen',
      !io.log.some(x => x.startsWith('switch')) && io.log.includes('chooser:co-215-spring:current=co-215-spring'));
  }
  {
    const io = mkIo();
    await LK.runPrefill('?new=1&id=lesson-04-x&title=T', io);
    check('no course in the link: no switch', !io.log.some(x => x.startsWith('switch')) && io.log.some(x => x.startsWith('chooser')));
  }
  {
    const io = mkIo({ viewOk: false });
    await LK.runPrefill('?new=1&id=lesson-04-x&title=T', io);
    check('a page with nothing loaded (not a director here) refuses, does not open the chooser, and keeps the link in the address',
      io.log.some(x => x.startsWith('refuse:')) && !io.log.some(x => x.startsWith('chooser')) && !io.log.includes('clear'));
  }
  {
    const io = mkIo();
    const r = await LK.runPrefill('?a=abc', io);
    check('a query that is not a prefill link is left alone', r.status === 'not-a-link' && io.log.length === 0);
  }
}

section('the chooser says when the link\'s assignment id is already used, and when an assignment cannot take a tutor (review 3, M2, M4)');
{
  const items = [{ slug: 'lesson-04-circuits', title: 'Circuits', offeringId: 'o-1' }, { slug: 'other', title: 'Other', offeringId: 'o-2' }];
  eq('an assignment with the link\'s id is found', LK.sameIdItem(items, { id: 'lesson-04-circuits' })?.offeringId, 'o-1');
  eq('no id in the link: nothing is found', LK.sameIdItem(items, { id: null }), null);
  eq('an id nobody uses: nothing is found', LK.sameIdItem(items, { id: 'new-one' }), null);
  const base = LK.destinationCard({ tutorSlug: null, isNew: true, isPublished: false, lessonNumber: 3 }, 'iid');
  eq('a card without the new fields is exactly what the older page shows', base, { swap: false, badge: 'Add to', meta: 'L3 · draft · no tutor yet', selectable: true });
  const no = LK.destinationCard({ tutorSlug: null, isNew: true, isPublished: false, lessonNumber: null, carriesTutor: false, tutorRefusal: 'It is delivered as questions on the site.' }, 'iid');
  check('an assignment that cannot take a tutor is not selectable and is not badged "Add to"', no.selectable === false && no.badge !== 'Add to', JSON.stringify(no));
  check('and the reason is on the card', /questions on the site/.test(no.meta), no.meta);
  const same = LK.destinationCard({ tutorSlug: null, isNew: true, isPublished: false, lessonNumber: null }, 'iid', { sameId: true });
  check('the assignment with the link\'s id is marked', /same id/i.test(same.meta) && same.selectable === true, same.meta);
}

process.exit(summary() ? 0 : 1);
