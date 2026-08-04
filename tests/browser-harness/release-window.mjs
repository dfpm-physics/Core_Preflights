// release-window.mjs — browser verification for the release window (CORE.md §2).
//
// Two things no Node-only check can see, and no signed-in walkthrough is available for on this
// machine (supabase/admin/.env carries no PREP_TEST_FACULTY_* here):
//
//   PART 1  Every page edited for this change still PARSES as a module. Four of the five edits are
//           inside `<script type="module">` blocks in HTML, where a syntax error is invisible to
//           `node --check` and takes the whole page down at runtime.
//
//   PART 2  The lesson editor's release control, driven against its REAL markup. The functions are
//           lifted out of lessons.html by name (as modal.mjs lifts from util.js) so there is no
//           second copy of the logic to drift, and the form HTML is lifted from the same file.
//
// Usage: node release-window.mjs [--chrome <path>]

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const PORT = 8731;

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const CHROME = [
  arg('chrome'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean).find((p) => existsSync(p));
if (!CHROME) { console.error('No Chrome/Edge found.'); process.exit(2); }

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`  [pass] ${name}`); }
  else { failed++; console.log(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`); }
};

const server = spawn('python', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });

/* ── PART 1 — every edited page parses and loads clean ────────────────────────────────── */
console.log('\n=== edited pages parse and load ===');

const PAGES = [
  'site/student/lessons.html',
  'site/student/dashboard.html',
  'site/student/assignments.html',
  'site/student/interaction-submit.html',
  'site/faculty/lessons.html',
];

for (const path of PAGES) {
  const page = await browser.newPage();
  const fatal = [];
  page.on('pageerror', (e) => {
    // Only PARSE/reference failures matter here. Without a session the pages redirect to login,
    // and auth noise is expected — a SyntaxError never is.
    const m = String(e);
    if (/SyntaxError|ReferenceError|TypeError: .* is not a function/.test(m)) fatal.push(m);
  });
  page.on('console', (m) => {
    if (m.type() === 'error' && /SyntaxError|is not defined/.test(m.text())) fatal.push(m.text());
  });
  await page.goto(`http://localhost:${PORT}/${path}`, { waitUntil: 'networkidle2', timeout: 30000 })
    .catch(() => {});
  await new Promise(r => setTimeout(r, 700));
  check(`${path} — no parse/reference error`, fatal.length === 0, fatal.join(' | '));
  await page.close();
}

/* ── PART 2 — the release control, in a real DOM ──────────────────────────────────────── */
console.log('\n=== lesson editor: release control ===');

const SRC = readFileSync(`${REPO}/site/faculty/lessons.html`, 'utf8');

/** Lift a top-level `function name(...) {...}` out of the page's inline module by brace matching. */
function lift(name) {
  const start = SRC.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`lessons.html no longer defines ${name}() — this test is out of date.`);
  let i = SRC.indexOf('(', start), parens = 0;
  for (; i < SRC.length; i++) {
    if (SRC[i] === '(') parens++;
    else if (SRC[i] === ')' && --parens === 0) break;
  }
  let depth = 0;
  for (let j = SRC.indexOf('{', i); j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}' && --depth === 0) return SRC.slice(start, j + 1);
  }
  throw new Error(`could not brace-match ${name}()`);
}

// The real form markup for the control, lifted from the page rather than retyped.
const formStart = SRC.indexOf('<div class="row wrap" style="gap:14px;margin-top:12px">');
const formEnd = SRC.indexOf('</div>', SRC.indexOf('id="f-release-hint"')) + 6;
if (formStart < 0 || formEnd < 6) throw new Error('release control markup not found in lessons.html');
const FORM = SRC.slice(formStart, formEnd);

const page = await browser.newPage();
page.on('pageerror', e => console.log('  !! page error:', String(e)));

await page.setContent(`<!doctype html><html><body>${FORM}</body></html>`);

const result = await page.evaluate(`(() => {
  // Stubs for the page globals the lifted functions touch. toEditorDue/defaultDueFrom are the REAL
  // implementations, copied from faculty-lessons.js — the resolved date is the whole point.
  const esc = (s) => String(s);
  // LOCAL, like the real util.js fmtDate — a UTC slice reports a Denver evening as the next day.
  const fmtDate = (d) => { const x = new Date(d); const p2 = (n) => String(n).padStart(2,'0');
    return x.getFullYear() + '-' + p2(x.getMonth()+1) + '-' + p2(x.getDate()); };
  const endOfDay = (d) => {
    if (!d) return null;
    const s = String(d);
    const local = s.length <= 10 ? s + 'T23:59:59' : s.slice(0, 16) + ':59';
    const at = new Date(local);
    return isNaN(at) ? null : at.toISOString();
  };
  const L = {
    toEditorDue(iso) {
      if (!iso) return '';
      const d = new Date(iso); if (isNaN(d)) return '';
      const p = (n) => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
    },
    defaultDueFrom(dueByDay) {
      const all = Object.values(dueByDay || {}).filter(Boolean).map(endOfDay).sort();
      return all.length ? all[0] : null;
    },
  };
  let model = { opensAt: '', dueByDay: {} };

  ${lift('daysBeforeDue')}
  ${lift('releaseBaseDue')}
  ${lift('renderRelease')}
  ${lift('applyReleaseChoice')}
  ${lift('readRelease')}
  const releaseMode = () => (model.opensAt ? 'custom' : 'standard');
  const DAY_MS = 86400000;
  const nowEditorValue = () => L.toEditorDue(new Date().toISOString());

  const out = [];
  const sel = () => document.getElementById('f-release');
  const when = () => document.getElementById('f-release-when');
  const hint = () => document.getElementById('f-release-hint');
  const shown = () => when().style.display !== 'none';

  // An M-day deadline of 20 Aug and a T-day of 22 Aug: the preset must count back from the EARLIER.
  model.dueByDay = { M: '2026-08-20T23:59', T: '2026-08-22T23:59' };

  // 1 — default state
  renderRelease();
  out.push(['default is standard', sel().value === 'standard']);
  out.push(['default hides the date boxes', !shown()]);
  out.push(['default model carries no opens_at', model.opensAt === '']);
  out.push(['standard hint shows the resolved example date',
            hint().textContent.includes('2026-08-13')]);

  // 2 — a relative preset resolves against the EARLIEST deadline (20 Aug - 3 = 17 Aug)
  applyReleaseChoice('d3');
  out.push(['3-days preset resolves off the earliest deadline',
            model.opensAt.startsWith('2026-08-17'), model.opensAt]);
  out.push(['a resolved preset reveals the date boxes', shown()]);

  // Driven as the real page drives it: the select carries the choice BEFORE the handler runs, and
  // the label should then confirm what was just clicked rather than snapping to "a specific date".
  model = { opensAt: '', dueByDay: { M: '2026-08-20T23:59', T: '2026-08-22T23:59' } };
  renderRelease();
  sel().value = 'd3';
  applyReleaseChoice('d3');
  out.push(['picking a preset keeps its own label, confirming the click',
            sel().value === 'd3', sel().value]);
  out.push(['...and shows the date it resolved to underneath',
            document.getElementById('f-opens').value === '2026-08-17']);

  // Reopening the editor on ANOTHER lesson must not inherit that label — only two states are
  // stored, so outside the moment of clicking it can only honestly read standard/specific.
  model.opensAt = '2026-09-01T00:00';
  renderRelease();
  out.push(['a stale preset label does not survive into the next lesson',
            sel().value === 'custom', sel().value]);
  model.opensAt = '';
  renderRelease();
  out.push(['a lesson with no override reads as standard even after a preset was used',
            sel().value === 'standard', sel().value]);

  sel().value = 'standard';
  applyReleaseChoice('d3');
  out.push(['the date box holds the resolved date',
            document.getElementById('f-opens').value === '2026-08-17']);
  out.push(['a fixed date warns that it will not follow the deadline',
            hint().textContent.includes('does not follow')]);

  // 3 — 14 days back crosses the month boundary correctly (20 Aug - 14 = 6 Aug)
  applyReleaseChoice('d14');
  out.push(['14-days preset crosses the month boundary', model.opensAt.startsWith('2026-08-06'), model.opensAt]);

  // 4 — a release time is the START of its day, not 2359 like a deadline
  out.push(['a resolved release time is 00:00, not the deadline hour',
            model.opensAt.endsWith('T00:00'), model.opensAt]);
  out.push(['14 days before a 20 Aug deadline is the 6th, not the 6th-at-2359',
            model.opensAt === '2026-08-06T00:00', model.opensAt]);

  // 5 — back to standard clears the override
  applyReleaseChoice('standard');
  out.push(['choosing standard clears opens_at', model.opensAt === '']);
  out.push(['choosing standard hides the boxes again', !shown()]);

  // 6 — "as soon as it's published" resolves to a concrete instant, not a sentinel
  applyReleaseChoice('now');
  out.push(['"as soon as published" resolves to a real date', /^\\d{4}-\\d{2}-\\d{2}T/.test(model.opensAt), model.opensAt]);

  // 7 — clearing the DATE box returns to the standard window
  document.getElementById('f-opens').value = '';
  readRelease();
  out.push(['clearing the date returns to the standard window', model.opensAt === '']);

  // 8 — typing a date by hand is honoured verbatim
  applyReleaseChoice('custom');
  document.getElementById('f-opens').value = '2026-07-01';
  document.getElementById('f-openst').value = '08:30';
  readRelease();
  out.push(['a hand-typed date and time is stored verbatim', model.opensAt === '2026-07-01T08:30', model.opensAt]);

  // 9 — a preset with NO deadline set must refuse rather than invent one off today's clock
  model = { opensAt: '', dueByDay: {} };
  renderRelease();
  applyReleaseChoice('d3');
  out.push(['a preset with no deadline set writes nothing', model.opensAt === '']);
  out.push(['...and says why', hint().textContent.includes('Set a due date above first')]);

  return out;
})()`);

for (const [name, ok, detail] of result) check(name, ok, detail);

await browser.close();
server.kill();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
