// test-items-page.mjs — the structure of site/faculty/items.html, checked without a browser.
// Offline: it reads files and makes no network call.
//
// WHY THIS EXISTS
//   A page fault that shows only in a browser (an id the script reads that the markup does not have, an import that does
//   not resolve, a policy hash that no longer matches the script) is the known risk of a page with no build step. This
//   cannot run the page. It checks the things that make the page fail to start, and the rules the page must keep:
//   a new assignment still opens short, new fields live behind "More options", nothing names a kind, and the publish
//   control is on the form where the director sees it, set by a link and never acted on by one.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { check, eq, section, summary, installBrowser, REPO } from './harness.mjs';

installBrowser({ pathname: '/site/faculty/items.html' });
globalThis.window.db = { from: () => { throw new Error('no database in this test'); } };

const PAGE = 'site/faculty/items.html';
const html = readFileSync(resolve(REPO, PAGE), 'utf8').replace(/\r\n/g, '\n');
const script = (html.match(/<script type="module">([\s\S]*?)<\/script>/) || [])[1] || '';
const markup = html.replace(/<script[\s\S]*?<\/script>/g, '');

section('every id the script reads exists in the markup or in a template the script builds');
{
  const used = new Set();
  for (const m of script.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)) used.add(m[1]);
  for (const m of script.matchAll(/getElementById\('([A-Za-z0-9_-]+)'\)/g)) used.add(m[1]);
  const declared = new Set([...markup.matchAll(/\bid="([^"$]+)"/g)].map(m => m[1]));
  // ids the script writes into its own templates (the table, the load-time banner, per-day boxes)
  const templated = new Set([...script.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)].map(m => m[1]));
  check(`the script reads ${used.size} ids`, used.size > 40);
  for (const id of [...used].sort()) check(`#${id} exists`, declared.has(id) || templated.has(id));
  const ids = [...markup.matchAll(/\bid="([^"$]+)"/g)].map(m => m[1]);
  check('no id is declared twice', new Set(ids).size === ids.length);
}

section('every import resolves');
{
  const imports = [...script.matchAll(/from '(\.\.\/js\/[^']+)'/g)].map(m => m[1]);
  check('the page imports modules', imports.length >= 8);
  for (const rel of imports) {
    const file = resolve(REPO, 'site/faculty', rel);
    check(`${rel} exists`, existsSync(file));
  }
  // a name taken from a module must be exported by it
  for (const m of script.matchAll(/import \{([^}]+)\} from '(\.\.\/js\/[^']+)'/g)) {
    const src = readFileSync(resolve(REPO, 'site/faculty', m[2]), 'utf8');
    for (const name of m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
      check(`${m[2]} exports ${name}`, new RegExp(String.raw`export\s+(async\s+)?(function|const|let|class)\s+${name}\b|export\s*\{[^}]*\b${name}\b`).test(src));
    }
  }
  // every I.x / LK.x the script calls exists in its module
  for (const [ns, file] of [['I', 'site/js/faculty-items.js'], ['LK', 'site/js/lesson-link.js']]) {
    const src = readFileSync(resolve(REPO, file), 'utf8');
    const names = new Set([...script.matchAll(new RegExp(String.raw`\b${ns}\.([A-Za-z_][A-Za-z0-9_]*)`, 'g'))].map(m => m[1]));
    for (const name of [...names].sort()) {
      check(`${ns}.${name} is exported by ${file.split('/').pop()}`,
        new RegExp(String.raw`export\s+(async\s+)?(function|const|let|class)\s+${name}\b|export\s*\{[^}]*\b${name}\b`).test(src));
    }
  }
}

section('the policy hash matches the final script');
{
  const meta = (html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/) || [])[1] || '';
  const hash = 'sha256-' + createHash('sha256').update(script, 'utf8').digest('base64');
  check('the inline module script is allowed by hash', meta.includes(`'${hash}'`));
}

section('a new assignment opens short, and the new fields sit behind More options');
{
  const modal = markup.slice(markup.indexOf('id="item-modal"'), markup.indexOf('id="dest-modal"'));
  const more = modal.slice(modal.indexOf('<details'), modal.indexOf('</details>'));
  const before = modal.slice(0, modal.indexOf('<details'));
  for (const id of ['i-title', 'i-kind', 'i-points', 'i-alldate']) check(`#${id} is in the short form`, before.includes(`id="${id}"`));
  for (const id of ['i-num', 'i-release', 'i-opens', 'i-openst'])
    check(`#${id} is under More options`, more.includes(`id="${id}"`) && !before.includes(`id="${id}"`));
  // The tutor, credit and choice controls moved out of More options into the setup section (2026-11-06).
  const setup = modal.slice(modal.indexOf('id="i-setup"'), modal.indexOf('id="i-written"'));
  for (const id of ['i-policy', 'i-switch', 'i-islug', 'i-iurl', 'i-ititle', 'i-idesc', 'i-swap'])
    check(`#${id} is in the setup section, in view and not under More options`, setup.includes(`id="${id}"`) && !more.includes(`id="${id}"`));
  check('the "Also offer an interactive tutor" checkbox is gone', !/i-withtutor|Also offer an interactive tutor/.test(html));
  check('More options starts closed', /<details[^>]*id="i-more"(?![^>]*\bopen\b)/.test(modal));
  check('the setup section starts hidden and sits above More options', /id="i-setup" style="display:none/.test(modal) && modal.indexOf('id="i-setup"') < modal.indexOf('<details'));
  check('the tutor controls start hidden', /id="i-twopath"[^>]*display:none/.test(setup) && /id="i-interactive"[^>]*display:none/.test(setup));
  check('the release boxes start hidden', /id="i-opens-wrap" style="display:none/.test(more) && /id="i-openst-wrap" style="display:none/.test(more));
}

section('the rules the page keeps');
{
  const kinds = ['preflight', 'homework', 'case_study', 'group_project', 'quiz', 'exam', 'lab'];
  for (const k of kinds) check(`no kind id '${k}' is named`, !html.includes(`'${k}'`) && !html.includes(`"${k}"`));
  check('the page never writes a literal publish true', !/is_published:\s*true/.test(script));
  {
    const modal = markup.slice(markup.indexOf('id="item-modal"'), markup.indexOf('id="dest-modal"'));
    const before = modal.slice(0, modal.indexOf('<details'));
    const after = modal.slice(modal.indexOf('</details>'));
    check('the publish control is a checkbox outside More options, so it is always in view',
      /<input type="checkbox" id="i-publish">/.test(modal) && !modal.slice(modal.indexOf('<details'), modal.indexOf('</details>')).includes('id="i-publish"')
      && (before.includes('id="i-publish"') || after.includes('id="i-publish"')));
    check('it sits before the Save button', modal.indexOf('id="i-publish"') < modal.indexOf('id="im-save"'));
    check('the old line saying saving keeps it unpublished is gone', !/Saving keeps the assignment unpublished/.test(markup));
  }
  check('the form sends the control', /publish:\s*\$\('i-publish'\)\.checked/.test(script));
  check('a link publish flag only sets the control, for the director to review', /if \(f\.publishRequested != null\) \$\('i-publish'\)\.checked = f\.publishRequested/.test(script));
  check('an assignment opened for editing starts from its own state', /\$\('i-publish'\)\.checked = item \? item\.isPublished : false/.test(script));
  check('choosing an existing assignment for a link does not carry the flag', !/publishRequested/.test(script.slice(script.indexOf('function applyOverlay'), script.indexOf('function showNote'))));
  check('the note about the link no longer says the page saves unpublished', !/saves unpublished/.test(script));
  check('a publish refusal is shown with the older editor sentence and the save is reported done', /res\.publishError/.test(script) && /publishErrorText\(res\.publishError\)/.test(script));
  check('the list banner no longer says saving keeps assignments unpublished', !/stay unpublished/.test(script));
  check('no inline event handlers', !/\son[a-z]+="/i.test(markup));
  check('no javascript: link', !/javascript:/i.test(html));
  check('the new rows use form-grid', (markup.match(/class="form-grid"/g) || []).length >= 6);
  check('no field sized by hand', !/class="field[^"]*" style="[^"]*(min-width|flex:)/.test(markup));
  check('the chooser keeps the older ids', ['dest-sub', 'dest-offering', 'dest-offering-hint', 'dest-pick', 'dest-pick-note', 'dest-lessons']
    .every(id => markup.includes(`id="${id}"`)) && markup.includes('data-dest="new"') && markup.includes('data-dest="existing"'));
  check('the chooser asks the course and term before the assignment list', markup.indexOf('id="dest-offering"') < markup.indexOf('id="dest-lessons"'));
  check('a prefill link is read once and cleared from the address', /history\.replaceState\(null, '', location\.pathname\)/.test(script));
  check('an assignment from the older page is not selectable as a destination', /if \(!it \|\| !it\.isNew\) return;/.test(script));
  check('the confirmations stack into one acknowledgement', /needsTutorConfirm/.test(script) && /needsPointsConfirm/.test(script) && /ack\.points = true/.test(script));
}

section('the page\'s own link handler: a link for another course moves the page there first (review 3, C1)');
{
  // The real source of the page's link handling, lifted out of items.html and run against stand-ins. The chunk runs from
  // the authorable() helper to the chooser, so a change to any of it is what this runs.
  const a = script.indexOf('const authorable = ');
  const b = script.indexOf('async function openDestChooser');
  check('the page\'s link handling can be found', a > 0 && b > a);
  const chunk = script.slice(a, b);
  const LK = await import('../../site/js/lesson-link.js');
  const COURSES = [
    { offeringId: 'co-215', courseCode: 'phys-215', courseTitle: 'Physics 215', termLabel: 'Spring', role: 'director' },
    { offeringId: 'co-110', courseCode: 'phys-110', courseTitle: 'Physics 110', termLabel: 'Spring', role: 'director' },
    { offeringId: 'co-310', courseCode: 'phys-310', courseTitle: 'Physics 310', termLabel: 'Spring', role: 'instructor' },
  ];
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  async function drive(search, { current = 'co-215', loadFails = false, directorHere = true } = {}) {
    const log = [];
    const ctx = { courses: COURSES, instructorRow: { is_global_admin: false }, currentOffering: current,
      setCurrentOffering: async (id) => { log.push('setCurrentOffering:' + id); ctx.currentOffering = id; } };
    const viewOf = (offering) => ({ items: [], sections: [{ id: 'sec-of-' + offering }], kinds: [] });
    const run = new AsyncFunction('LK', 'ctx', 'location', 'history', 'initialVm', 'loadVm', 'chooserStub', 'renderNav', 'openFromQuery', '$', 'esc', 'onCourseChange',
      `let vm = initialVm;
       async function load() { vm = null; vm = await loadVm(); }
       async function openDestChooser(prefill) { return chooserStub(prefill, vm); }
       ${chunk}
       return handleQuery();`);
    const loadVm = async () => {
      log.push('load:' + ctx.currentOffering);
      if (!directorHere && ctx.currentOffering === current) return null;
      return loadFails ? { error: { message: 'boom' }, items: [], sections: [], kinds: [] } : viewOf(ctx.currentOffering);
    };
    const page = { notes: [] };
    const chooser = async (prefill, vm) => { log.push(`chooser:${prefill.offeringId}:page=${ctx.currentOffering}:sections=${vm?.sections?.[0]?.id}`); };
    await run(LK, ctx, { search, pathname: '/site/faculty/items.html' }, { replaceState: () => log.push('address cleared') },
      directorHere ? viewOf(current) : null, loadVm, chooser, () => log.push('nav'), () => log.push('openFromQuery'),
      () => ({ insertAdjacentHTML: (_w, h) => page.notes.push(h) }), (x) => String(x), () => {});
    return { log, page };
  }
  const link = '?new=1&id=lesson-04-x&course=phys-110&title=T&url=https%3A%2F%2Fclaude.ai%2Fpublic%2Fartifacts%2Fabc';
  {
    const r = await drive(link);
    eq('director of both, page on 215: the page loads 110 and the chooser opens on 110 with 110\'s sections',
      r.log.filter(x => x !== 'nav' && x !== 'address cleared'),
      ['setCurrentOffering:co-110', 'load:co-110', 'chooser:co-110:page=co-110:sections=sec-of-co-110']);
  }
  {
    const r = await drive(link, { loadFails: true });
    check('a load that fails after the switch refuses plainly, and no chooser opens', !r.log.some(x => x.startsWith('chooser')) && r.page.notes.length === 1);
  }
  {
    const r = await drive('?new=1&id=x&course=phys-310&title=T');
    check('a course the person only teaches does not move the page', !r.log.some(x => x.startsWith('setCurrentOffering')));
    check('and the chooser opens on the course on screen, where it will say the link\'s course is not one they run',
      r.log.some(x => x === 'chooser:co-215:page=co-215:sections=sec-of-co-215'));
  }
  {
    const r = await drive('?new=1&id=x&title=T', { directorHere: false });
    check('a page with nothing loaded refuses, keeps the link in the address, and opens nothing',
      !r.log.some(x => x.startsWith('chooser')) && !r.log.includes('address cleared') && r.page.notes.length === 1);
  }
  {
    const r = await drive('?a=abc');
    eq('an ?a= link goes to the older-page path', r.log, ['openFromQuery']);
  }
  check('the address is still cleared with the same call the contract test looks for', /history\.replaceState\(null, '', location\.pathname\)/.test(script));
}

section('the chooser: same-id flag, and assignments that cannot take a tutor (review 3, M2, M4)');
{
  const chooser = script.slice(script.indexOf('async function openDestChooser'), script.indexOf('/* A link from the older Assignments page'));
  check('the chooser looks for an assignment that already uses the link\'s id and says so', /LK\.sameIdItem\(vm\.items, prefill\)/.test(chooser) && /already uses the id/.test(chooser));
  check('a card for an assignment that cannot take a tutor gives the reason and is not selectable', /carriesTutor: I\.canCarryTutor\(it\)/.test(chooser) && /tutorRefusal: I\.tutorRefusal\(it\)/.test(chooser));
  check('clicking such a card says why instead of doing nothing', /I\.canCarryTutor\(it\)/.test(chooser.slice(chooser.indexOf("addEventListener('click'"))));
  const overlay = script.slice(script.indexOf('function applyOverlay'), script.indexOf('function showNote'));
  check('applying a tutor to an assignment that cannot take one is refused out loud', /I\.canCarryTutor\(item\)/.test(overlay) && /showNote\(I\.tutorRefusal\(item\)\)/.test(overlay));
  check('the overlay no longer promises a confirmation it does not always ask', !/You will be asked to confirm\./.test(overlay));
}

section('a save is built from the page context the way the page builds it (review 3, C2)');
{
  const I = await import('../../site/js/faculty-items.js');
  check('the page builds its save context with I.saveContext, not a literal', /I\.saveContext\(ctx, vm\.sections\)/.test(script));
  check('no hand-built context with courseOfferingId remains in the page', !/courseOfferingId:\s*ctx\.currentOffering/.test(script));
  check('a failure in the save is caught and shown, not swallowed', /catch \(e\)/.test(script.slice(script.indexOf('async function save()'), script.indexOf('async function doRemove'))));
  check('a form remembers the course it was opened on, and a save on another course is refused', /formOffering/.test(script) && /ctx\.currentOffering !== formOffering/.test(script));
}

section('staff read "assignment", not "item" (Matthew asked for Assignments), and the questions page no longer says it stays unpublished');
{
  const files = { 'site/faculty/questions.html': ['stays unpublished', 'This item cannot', 'the item can be', 'auto-checked item'],
    'site/js/faculty-questions.js': ['auto-checked item,'],
    'site/faculty/entry.html': ['>Item<', 'Fills item', 'This item', 'Publish the item', 'The item no longer', 'the item is worth', 'Items graded'],
    'site/js/faculty-entry.js': ['This item', 'Publish the item'],
    'site/js/faculty-entry-parse.js': ['this item is worth', 'matched to an item'],
    'site/faculty/backlog.html': ['<th>Item</th>', 'Two items are', 'An item is matched'],
    'site/js/faculty-backlog.js': ['the item cannot be judged'] };
  for (const [file, phrases] of Object.entries(files)) {
    const text = readFileSync(resolve(REPO, file), 'utf8');
    for (const ph of phrases) check(`${file.split('/').pop()}: no "${ph}"`, !text.includes(ph));
  }
  const q = readFileSync(resolve(REPO, 'site/faculty/questions.html'), 'utf8');
  check('the questions page says students see it once it is published', /until it is published/.test(q));
}

process.exit(summary() ? 0 : 1);
