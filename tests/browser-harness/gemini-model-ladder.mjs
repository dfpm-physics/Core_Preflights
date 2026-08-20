// gemini-model-ladder.mjs — exercise a shipped backup build's model-selection logic.
//
// WHY THIS EXISTS. `gemini-build.mjs` proves a build parses and renders; it cannot prove the
// build picks a usable MODEL, because that needs a live free-tier key the harness does not
// have. The logic it cannot reach is exactly the logic that failed on 2026-08-20: the scorer
// gave a bonus to any name containing "latest", `gemini-flash-latest` therefore outranked
// every pinned name, Google hot-swapped that alias to a 20-requests-per-day model, and every
// cadet moved with it. Nothing in the repo could have caught that.
//
// So this pulls the model block straight out of a built .html and runs it. No browser, no
// key, no network — the shipped bytes are the thing under test, which is the point: the
// porter's own assertions check the code it INJECTS, and only the output knows what shipped.
//
//   node tests/browser-harness/gemini-model-ladder.mjs [path-to-build.html]
//
// Per CORE.md §2 a Node-only check is never the sole verification of a change. Pair it with
// gemini-build.mjs, and say in the CHANGELOG when a real tutor turn was not run.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
let target = process.argv[2];
if (!target) {                       // default: first phys-215 build, whatever it is called
  const dir = join(ROOT, 'site', 'gemini', 'phys-215');
  target = join('site', 'gemini', 'phys-215', readdirSync(dir).filter(n => n.endsWith('.html'))[0]);
}
console.log(`=== ${target} ===`);

const src = readFileSync(join(ROOT, target), 'utf8');
const a = src.indexOf('let MODEL_CHAT = [');
const zMark = src.indexOf('function nextModel(ref) {');
if (a < 0 || zMark < 0) {
  console.error('model block not found — did the porter stop emitting MODEL_CHAT / nextModel?');
  process.exit(2);
}
const block = src.slice(a, src.indexOf('\n}', zMark) + 2);

// The block is self-contained by construction: ladders, scorer, spent-set and both movers
// sit together precisely so they can be lifted out and reasoned about in one piece.
const S = new Function(block + `
  return { MODEL_CHAT, MODEL_REPORT, MODEL_FALLBACKS, scoreModel, seatLadder, nextModel,
           spentModels, onModelSwitch };`)();

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  [pass] ' + m); } else { fail++; console.log('  [FAIL] ' + m); } };

// --- the regression that put a section over quota -------------------------------------
ok(S.scoreModel('gemini-flash-latest') < S.scoreModel('gemini-2.5-flash'),
   'a "latest" alias no longer outranks a pinned model (the 2026-08-20 bug)');
ok(S.scoreModel('gemini-3.5-flash-lite') > S.scoreModel('gemini-3.7-flash'),
   'lite (500/day) outranks a newer plain Flash (20/day) — quota beats recency');

// --- the ladders are shaped the way the quota table requires ---------------------------
ok(S.MODEL_CHAT[0].includes('lite'),
   'chat ladder starts on a lite model — it carries ~12 of a session\u2019s ~14 requests');
ok(S.MODEL_REPORT[0] === 'gemini-3.7-flash',
   'report ladder starts on the strongest model — it is one request and it is the graded artifact');
ok(S.MODEL_REPORT.length > S.MODEL_CHAT.length,
   'report ladder falls through into the chat pool rather than failing');

// --- the 429 walk: every rung is tried before a cadet is told the quota is gone ---------
const ref = {};
S.seatLadder(ref, S.MODEL_CHAT);
ok(ref.current === S.MODEL_CHAT[0], 'seats at the top of the pool');
const walked = [ref.current];
while (S.nextModel(ref)) walked.push(ref.current);
ok(walked.length === S.MODEL_CHAT.length,
   `walks all ${S.MODEL_CHAT.length} rungs before giving up, got ${walked.length}`);
ok(S.nextModel(ref) === false, 'an exhausted ladder reports false, which becomes the quota error');

// --- a model burned earlier must not be re-seated later in the same session ------------
S.spentModels[S.MODEL_CHAT[0]] = true;
const ref2 = {};
S.seatLadder(ref2, S.MODEL_CHAT);
ok(ref2.current === S.MODEL_CHAT[1], 'a spent model is skipped when re-seating');

// --- switching pools mid-session re-seats rather than carrying a stale index -----------
const ref3 = {};
S.seatLadder(ref3, S.MODEL_CHAT);
S.nextModel(ref3);
S.seatLadder(ref3, S.MODEL_REPORT);
ok(ref3.current === S.MODEL_REPORT[0], 'moving to the report pool seats at its top');

// --- a switch is visible, so a cadet asked "what happened" can read it off the page ----
let seen = null;
S.onModelSwitch.fn = (n) => { seen = n; };
const ref4 = {};
S.seatLadder(ref4, S.MODEL_CHAT);
S.nextModel(ref4);
ok(seen === ref4.current, 'a model switch notifies the connection light');

console.log(`\n${pass} passed, ${fail} failed`);
console.log('NOTE: no live key is used — this checks selection logic, not a real tutor turn.');
process.exit(fail ? 1 : 0);
