/**
 * The help centre's review-staleness warning (help/DOC-STATUS.json -> help.js).
 *
 * A browser cannot run git, so the warning is driven by a snapshot committed into the tree. Two
 * things about that are easy to break and silent when broken, which is why they are tested here
 * rather than left to the browser pass:
 *
 *   1. GRACEFUL DEGRADATION. If the generator never ran, or wrote something unparseable, the help
 *      centre must still render. Help is what a locked-out or confused person reaches for; it
 *      failing closed because a developer tool did not run would be a far worse bug than the
 *      staleness it is trying to report.
 *   2. THE TWO VOICES. Staff get the source filenames because they can act on them. A cadet gets
 *      told to trust the screen and ask an instructor. Leaking `.ai/instructions/CORE.md` onto a
 *      student page reads as a malfunction, and the tier check that prevents it is one `===`.
 *
 * Each scenario imports help.js under a fresh query string: `manifestCache` and `statusCache` are
 * module-level and would otherwise carry the previous scenario's fetches into the next one.
 */
import { check, eq, section, summary } from './harness.mjs';

const MANIFEST = {
  schema: 1,
  docs: [
    { id: 'getting-started', tier: 'student', title: 'Getting started', file: 'a.md' },
    { id: 'fresh', tier: 'student', title: 'A current topic', file: 'fresh.md' },
    { id: 'grading', tier: 'instructor', title: 'Grading in PREP', file: 'g.md' },
  ],
};

const STATUS = {
  schema: 1,
  generated: '2026-07-22',
  stale: {
    'a.md': { reviewed: '2026-07-21', tier: 'student',
              sources: ['.ai/instructions/CORE.md', 'site/js/auth.js'] },
    'g.md': { reviewed: '2026-07-21', tier: 'instructor',
              sources: ['.ai/instructions/PROJECT.md'] },
  },
};

/** Minimal DOM: help.js only sets innerHTML, queries for wiring, and scrolls. */
function fakeRoot() {
  const child = { innerHTML: '' };
  return {
    innerHTML: '',
    querySelector: () => child,
    querySelectorAll: () => [],
    _child: child,
  };
}

function installDom() {
  globalThis.window = globalThis.window || {};
  globalThis.window.addEventListener = () => {};
  globalThis.window.scrollTo = () => {};
  globalThis.history = { pushState: () => {} };
  globalThis.DOMPurify = { sanitize: (s) => s };
  globalThis.marked = { parse: (s) => s };
}

/**
 * @param {object|string|null} status  object -> served as JSON · string -> served as raw body
 *                                     (to simulate corruption) · null -> 404
 */
function installFetch(status) {
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('MANIFEST.json')) {
      return { ok: true, json: async () => MANIFEST };
    }
    if (String(url).endsWith('DOC-STATUS.json')) {
      if (status === null) return { ok: false, status: 404 };
      if (typeof status === 'string') {
        return { ok: true, json: async () => JSON.parse(status) };   // throws on bad JSON
      }
      return { ok: true, json: async () => status };
    }
    return { ok: true, text: async () => '# body' };                 // a topic's markdown
  };
}

const student = { role: 'student' };
const instructor = { role: 'faculty', instructorRow: {}, isDirectorForCurrent: () => false };

let n = 0;
async function mount(ctx, { status = STATUS, search = '' } = {}) {
  installDom();
  installFetch(status);
  globalThis.location.search = search;
  globalThis.window.location.search = search;
  const mod = await import(`../../site/js/help.js?case=${++n}`);
  const root = fakeRoot();
  await mod.mountHelp(ctx, root);
  return root;
}

// installBrowser() is not used: it stubs a location whose `search` is fixed at construction, and
// these cases need to vary it per mount.
globalThis.location = { pathname: '/site/student/help.html', search: '', hash: '' };
globalThis.window = { location: globalThis.location };

/* ── The index ─────────────────────────────────────────────────────────────── */
section('help index — flagged topics are marked before you open them');

const idx = await mount(student);
check('a flagged topic carries a chip', idx.innerHTML.includes('may be out of date'));
eq('exactly one chip per flagged topic the viewer can see',
   (idx.innerHTML.match(/help-stale-chip/g) || []).length, 1);
check('an unflagged topic carries none',
      !idx.innerHTML.split('A current topic')[1]?.startsWith('<span class="help-stale-chip"'));
check('the summary banner counts them', idx.innerHTML.includes('1 of these topic is'));

// A student sees one flagged topic; an instructor sees both (their tier includes student docs).
const idxI = await mount(instructor);
eq('the count follows what THIS viewer can see, not the whole file',
   (idxI.innerHTML.match(/help-stale-chip/g) || []).length, 2);
check('…and pluralises', idxI.innerHTML.includes('2 of these topics are'));

/* ── The topic page ────────────────────────────────────────────────────────── */
section('help topic — the warning speaks to its reader');

const staffDoc = await mount(instructor, { search: '?doc=grading' });
check('staff are told the page may be out of date',
      staffDoc.innerHTML.includes('read it with caution'));
check('…and which source moved, by basename', staffDoc.innerHTML.includes('PROJECT.md'));
check('…without the full internal path in the body text',
      !staffDoc.innerHTML.includes('>.ai/instructions/PROJECT.md<'));
check('…and when the check itself last ran',
      staffDoc.innerHTML.includes('Staleness last checked 2026-07-22'));

const studentDoc = await mount(student, { search: '?doc=getting-started' });
check('a cadet is told the page may be out of date',
      studentDoc.innerHTML.includes('This page may be out of date'));
check('…and what to do instead', studentDoc.innerHTML.includes('trust\n      the screen'));
// The tier split exists for exactly this: a source path on a student page reads as a fault.
check('NO internal source path reaches a student page',
      !studentDoc.innerHTML.includes('CORE.md') && !studentDoc.innerHTML.includes('auth.js'));
check('…and no source-list markup either', !studentDoc.innerHTML.includes('<code'));

const freshDoc = await mount(student, { search: '?doc=fresh' });
check('a topic that is NOT flagged gets no warning',
      !freshDoc.innerHTML.includes('may be out of date'));

/* ── Degradation ───────────────────────────────────────────────────────────── */
section('help still works when the status file does not');

const noFile = await mount(student, { status: null });
check('a missing DOC-STATUS.json renders the index normally',
      noFile.innerHTML.includes('Getting started'));
check('…with no warning anywhere', !noFile.innerHTML.includes('may be out of date'));

const broken = await mount(student, { status: '{ not json' });
check('a corrupt DOC-STATUS.json renders the index normally',
      broken.innerHTML.includes('Getting started'));
check('…with no warning anywhere', !broken.innerHTML.includes('may be out of date'));

const brokenDoc = await mount(student, { status: '{ not json', search: '?doc=getting-started' });
check('…and a topic page still opens', brokenDoc.innerHTML.includes('Getting started'));

// The shape is generated, so a future field rename must not throw — it must just stop warning.
const wrongShape = await mount(student, { status: { schema: 1, stale: 'not-an-object' } });
check('an unexpected `stale` shape degrades to no warning',
      !wrongShape.innerHTML.includes('may be out of date'));
const nullEntry = await mount(student, { status: { schema: 1, stale: { 'a.md': null } } });
check('a null entry degrades to no warning',
      !nullEntry.innerHTML.includes('may be out of date'));

process.exitCode = summary() ? 0 : 1;
