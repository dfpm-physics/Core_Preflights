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
// Starts at MODEL_LITE, not MODEL_CHAT: since 2026-08-21 both ladders are built by
// .concat(MODEL_LITE), so slicing from MODEL_CHAT lifts out a block that throws
// `ReferenceError: MODEL_LITE is not defined` the moment it is evaluated.
const a = src.indexOf('const MODEL_LITE = [');
const zMark = src.indexOf('function nextModel(ref) {');
if (a < 0 || zMark < 0) {
  console.error('model block not found — no MODEL_LITE / nextModel in this build.');
  console.error('A build ported BEFORE 2026-08-21 has no MODEL_LITE and cannot be checked by');
  console.error('this file: it encodes the new ladder policy. Re-port the build, or check out');
  console.error('the harness as it was when that build was made.');
  process.exit(2);
}
const block = src.slice(a, src.indexOf('\n}', zMark) + 2);

// The block is self-contained by construction: ladders, scorer, spent-set and both movers
// sit together precisely so they can be lifted out and reasoned about in one piece.
const S = new Function(block + `
  return { MODEL_LITE, MODEL_CHAT, MODEL_REPORT, MODEL_STUDY, MODEL_FALLBACKS, scoreModel,
           seatLadder, nextModel, spentModels, onModelSwitch };`)();
const isLite = (n) => S.MODEL_LITE.includes(n);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  [pass] ' + m); } else { fail++; console.log('  [FAIL] ' + m); } };

// --- the regression that put a section over quota -------------------------------------
ok(S.scoreModel('gemini-flash-latest') < S.scoreModel('gemini-2.5-flash'),
   'a "latest" alias no longer outranks a pinned model (the 2026-08-20 bug)');
ok(S.scoreModel('gemini-3.5-flash-lite') > S.scoreModel('gemini-3.7-flash'),
   'lite (500/day) outranks a newer plain Flash (20/day) — quota beats recency');

// --- the ladders are shaped the way the build's POLICY requires ------------------------
// TWO policies ship at once, on purpose and temporarily. `teaching` runs the conversation on
// the strongest models the key can reach; `legacy` reproduces the ordering the live builds
// shipped with, so those can be rebuilt to carry the 2026-08-21 freeze fix and NOTHING else
// while the reorder is still out for faculty trial (to_gemini.py --ladder).
//
// This file therefore asserts the invariants of whichever policy the build in front of it
// carries. It does NOT accept both shapes for the same build: that would make it a test of
// nothing. Delete the legacy branch when the reorder ships and --ladder goes.
const policy = isLite(S.MODEL_CHAT[0]) ? 'legacy' : 'teaching';
console.log(`  ladder policy: ${policy}`);

if (policy === 'teaching') {
  // Inverted on 2026-08-21. This used to assert `MODEL_CHAT[0].includes('lite')` -- the
  // conversation opening on the cheapest model -- and that shipped the behaviour a cadet
  // reported: "it would try to tutor me and then give me the answer instead of walking me
  // through it." A lite model opens Socratically and then collapses into answering.
  // 3.7-flash was the top rung for a few hours on 2026-08-21 and was dropped the same day:
  // its first reply took long enough that the page reads as broken, on every turn, for a
  // quality difference over 3.6 nobody could point to. Asserted as an ABSENCE, because that is
  // the decision -- a ladder that quietly regains it is the regression.
  ok(!S.MODEL_CHAT.includes('gemini-3.7-flash'),
     'teaching: 3.7-flash is absent from chat - too slow to wait on, every single turn');
  ok(S.MODEL_CHAT[0] === 'gemini-3.6-flash',
     'teaching: chat starts on 3.6 - the strongest model worth waiting for');

  // The first two tutor turns are dictated by the prompt -- an Honor Code reminder quoted in
  // it verbatim, then a question marked VERBATIM -- so the build delivers them itself and
  // spends no request on either. Checked against the raw source: the flag sits outside the
  // model block this file evaluates.
  ok(src.includes('const APP_OPENING = true'),
     'teaching: the app delivers the two scripted opening turns, costing no request');

  // A scripted turn costs no request, so it lands instantly unless something paces it --
  // and instant reads as broken, not as fast: the reply beats the cadet's own message onto
  // the screen, and the first REAL turn then pauses and looks like a fault. Extracted and
  // RUN rather than string-matched, because a change that leaves the function in place and
  // returns 0 would satisfy a substring check and ship the glitch.
  const dm = /const SCRIPTED_MS_PER_CHAR[\s\S]*?\nfunction scriptedDelay\(text\) \{[\s\S]*?\n\}/
    .exec(src);
  ok(!!dm, 'teaching: the scripted turns are paced - scriptedDelay is in the build');
  if (dm) {
    const delay = new Function(dm[0] + '\nreturn scriptedDelay;')();
    ok(delay('hi') >= 700,
       `teaching: even the SHORT scripted turn waits (floor ${delay('hi')}ms) - the opening `
       + 'question is one line and would otherwise appear before the cadet let go of Enter');
    ok(delay('x'.repeat(50000)) <= 3500,
       `teaching: the wait is capped (${delay('x'.repeat(50000))}ms) - pacing must not become a tax`);
    ok(delay('x'.repeat(400)) > delay('hi'),
       'teaching: a longer scripted line waits longer - it is reading time, not a fixed stall');
  }
  // Both call sites, because the helper existing proves nothing about its being used.
  ok(src.includes('await sleep(scriptedDelay(OPENING_HONOR))'),
     'teaching: the Honor Code turn is paced');
  ok(src.includes('scriptedDelay(OPENING_WELCOME + OPENING_QUESTION)'),
     'teaching: the greeting-plus-question turn is paced as one');
  // The prompt's instruction is "Greet the cadet briefly and set expectations. Then ask ...
  // VERBATIM". The scripted turn delivered only the second half until 2026-08-21, so a cadet met
  // a bare question with nothing saying which lesson they were in.
  ok(src.includes('const OPENING_WELCOME ='),
     'teaching: the scripted opening greets before it asks');
  ok(/content: OPENING_WELCOME \+[^\n]*\+ OPENING_QUESTION/.test(src),
     'teaching: the verbatim question is appended LAST, so openerStage still matches on it');
  ok(isLite(S.MODEL_CHAT[S.MODEL_CHAT.length - 1]),
     'chat still ENDS on the high-quota floor - lite is where it stops, not where it starts');

  // Study is ungraded practice with no cap on how often a cadet runs it. Before 2026-08-21 it
  // shared MODEL_CHAT, so practice quietly drew down the same 20/day the graded run needed.
  ok(S.MODEL_STUDY.length > 0 && S.MODEL_STUDY.every(isLite),
     'study pool is lite-only - practice never touches the graded allowance');
  ok(S.MODEL_STUDY !== S.MODEL_CHAT,
     'study and chat are distinct arrays - seatLadder switches on identity, so sharing one '
     + 'object would stop a mode change from re-seating');
} else {
  ok(isLite(S.MODEL_CHAT[0]),
     'legacy: chat starts on the high-quota floor - the ordering the live builds shipped with');
  ok(S.MODEL_STUDY === S.MODEL_CHAT,
     'legacy: study IS the chat pool, the same array - sharing the object is what makes a mode '
     + 'change a no-op, exactly as it behaved before MODEL_STUDY existed');
  ok(!src.includes('const APP_OPENING = true'),
     'legacy: the model still writes its own opening - what the live builds do');
}

// The report head is now the same under BOTH policies, and 3.7 is absent from both. It was the
// legacy head until 2026-08-21, when instructors were found stuck at the report stage: one
// instructor's usage dashboard, taken while hung and far under every limit, showed a 503 from
// gemini-3.7-flash and ZERO output tokens from it, while 3.5-flash-lite served the same session
// normally. It was called, billed for input, and produced nothing. Asserted as an ABSENCE,
// because that is the decision -- a pool that quietly regains it is the regression.
ok(!S.MODEL_REPORT.includes('gemini-3.7-flash'),
   'report pool does NOT contain 3.7-flash - it returned 503s and no output tokens');
ok(S.MODEL_REPORT[0] === 'gemini-3.6-flash',
   'report starts on 3.6 - one request, and it is the graded artifact');
ok(isLite(S.MODEL_REPORT[S.MODEL_REPORT.length - 1]),
   'report falls through to the floor rather than failing - a weak report beats none');

// The ladder head was never the whole bug. TWO failure paths threw without marking the model
// spent, so seatLadder put every Retry back on the rung that had just failed and the cadet
// looped on it forever. Checked against the raw source: both sit in rawCall, outside the model
// block this file evaluates. These are the assertions that keep the report stage un-hung; the
// ladder ordering only makes a hang less likely.
ok(/AbortError[\s\S]{0,400}spentModels\[activeModelRef\.current\] = true/.test(src),
   'a TIMED-OUT model is marked spent - otherwise Retry repeats the same two-minute wait');
ok(/res\.status >= 500[\s\S]{0,600}spentModels\[activeModelRef\.current\] = true[\s\S]{0,200}nextModel\(activeModelRef\)/
     .test(src),
   'a 5xx WALKS the ladder - a 503 is per-model, not per-project, so there is something to '
   + 'switch to');

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

// --- does a chat session spend the report's model? -------------------------------------
// The two policies differ here, and it is the difference worth writing down. Under `legacy`
// the pools start on different models (chat on lite, report on 3.7), so a conversation can
// never touch the report's allowance. Under `teaching` they share 3.7-flash, and a
// ~14-request conversation uses most of its 20/day -- so the report that follows usually runs
// one rung down. That is the trade `teaching` accepts: summarising is far easier than
// tutoring, so the strong model is worth more to the conversation. Asserted either way,
// because it is the consequence somebody would otherwise rediscover from a report that looks
// weaker than it used to.
const refR = {};
S.seatLadder(refR, S.MODEL_REPORT);
if (policy === 'legacy') {
  ok(refR.current === S.MODEL_REPORT[0],
     'legacy: spending the chat pool’s top model leaves the report untouched - the pools '
     + 'do not overlap at the top');
} else {
  ok(refR.current === S.MODEL_REPORT[1],
     'teaching: with the chat pool\'s top model spent, the report seats one rung down rather '
     + 'than retrying it');
}

// --- switching pools mid-session re-seats rather than carrying a stale index -----------
// spentModels is cleared first: it is module state shared by every check in this file, and
// the assertion below is about the INDEX being reset, not about skipping.
Object.keys(S.spentModels).forEach((k) => { delete S.spentModels[k]; });
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
