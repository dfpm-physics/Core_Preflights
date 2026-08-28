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

// Set 9's ledger reads and writes localStorage, and every access there is wrapped in a
// try/catch -- so under bare Node it would silently degrade to "no memory at all" and the
// persistence tests below would pass against a no-op. Give it a real store instead: the
// point of those tests is that a day lock SURVIVES, which cannot be observed without one.
globalThis.localStorage = {
  _d: Object.create(null),
  getItem(k) { return k in this._d ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};

// The block is self-contained by construction: ladders, scorer, spent-set and both movers
// sit together precisely so they can be lifted out and reasoned about in one piece.
const S = new Function(block + `
  return { MODEL_LITE, MODEL_CHAT, MODEL_REPORT, MODEL_STUDY, MODEL_FALLBACKS, scoreModel,
           seatLadder, nextModel, spentModels, onModelSwitch,
           advance, resetLadder, waitedFor, diagState, modelStats, statFor, noteCall,
           noteOk, noteFail, genConfig, MAX_TOKENS, THINKING_BUDGET,
           freshTurn, reviveSpent, WALK_RETRIES, LADDER_RESET_LIMIT, noteQuota,
           QUOTA_WALK_RETRIES, LADDER_WAIT_MS, LADDER_WAIT_MIN_MS, LADDER_WAITS_PER_TURN,
           QUOTA_STORE, quotaDay, book, bookFor, saveBook, RPM_FLASH, RPM_LITE, rpmOf,
           sentSince, noteSend, quotaScope, lockDay, dayLocked, pacedOut, seedDayLocks,
           RPD_FLASH, RPD_LITE, rpdOf, DAILY_CONFIDENCE,
           PACE_WALK_LIMIT, QUIET_WAIT_MS,
           timing, noteTurn, noteApi, noteWait, timingSummary, SLOW_TURN_MS,
           freshTurn, reviveLadder,
           ladderWaitsNow: () => ladderWaits, spendLadderWait: () => { ladderWaits++; } };`)();
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
ok(/AbortError[\s\S]{0,400}spentModels\[activeModelRef\.current\] = "timeout"/.test(src),
   'a TIMED-OUT model is marked spent - otherwise Retry repeats the same two-minute wait');
ok(/res\.status >= 500[\s\S]{0,900}spentModels\[activeModelRef\.current\] = "capacity"[\s\S]{0,300}advance\(activeModelRef\)/
     .test(src),
   'a 5xx WALKS the ladder - a 503 is per-model, not per-project, so there is something to '
   + 'switch to');

// Both of those walking paths marked the model spent and RECORDED NOTHING. A rung burned by
// quota reached the error log as `calls: 12, ok: 0, fail: 0, kinds: {}` -- twelve requests
// and no account of one of them -- which is why the 2026-08-25 rows cannot say whether the
// cadets were rate-limited or Google was refusing capacity. Also in rawCall, so also textual.
ok(/res\.status === 429[\s\S]{0,3000}noteFail\(activeModelRef\.current, "quota"\)/.test(src),
   'a 429 records a failure kind - a rung burned by quota must not look untried in the log');
ok(/res\.status >= 500[\s\S]{0,400}noteFail\(activeModelRef\.current, "capacity"\)/.test(src),
   'a 5xx records a failure kind - same blind spot, same fix');

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


// --- the 2026-08-25 fix set -------------------------------------------------------------
// Every assertion below stands for a way a cadet ran out of models while their key still had
// thousands of requests left. None of them is about ORDERING; they are about the ladder
// refusing to declare itself dead while there was somewhere left to go.

// The floor moved AGAIN on 2026-08-25, hours after it moved to 2.5-flash-lite, and the
// second move undid the first. The error log's first 30 rows all end
// `kind=model http=404 model=gemini-2.5-flash-lite`, and gemini-2.5-flash 404s beside it:
// ListModels lists both for the cadets' keys and :generateContent refuses both, so
// discoverModel() cannot filter them. A rung that 404s is the WORST possible last rung,
// because the last rung's failure kind is the message the cadet is shown.
ok(!S.MODEL_LITE.some((m) => m.startsWith('gemini-2.5')),
   'no 2.5 rung survives - both 404 in production and neither can be filtered by discovery');
ok(S.MODEL_LITE[S.MODEL_LITE.length - 1] === 'gemini-3.1-flash-lite',
   'the floor is 3.1-flash-lite - a ladder must END on a model that answers');
ok(S.MODEL_CHAT[S.MODEL_CHAT.length - 1] === 'gemini-3.1-flash-lite' &&
   S.MODEL_REPORT[S.MODEL_REPORT.length - 1] === 'gemini-3.1-flash-lite' &&
   S.MODEL_STUDY[S.MODEL_STUDY.length - 1] === 'gemini-3.1-flash-lite',
   'every pool ends on the new floor - the last rung is what prints "No usable model"');

// nextModel used to advance by exactly one and could seat a model already known dead:
// three retries and ~3.5s of backoff spent proving it again, per phase change.
(() => {
  Object.keys(S.spentModels).forEach(k => delete S.spentModels[k]);
  const ref = {};
  S.seatLadder(ref, S.MODEL_CHAT);
  S.spentModels[S.MODEL_CHAT[1]] = true;
  S.spentModels[S.MODEL_CHAT[2]] = true;
  S.nextModel(ref);
  ok(ref.current === S.MODEL_CHAT[3],
     'nextModel SKIPS spent rungs rather than seating one it already knows is dead');
})();

// The bounded whole-ladder retry. This is the cadet's "I reloaded and it worked for another
// minute", done in the app: a reload cleared spentModels because it is module scope.
(() => {
  Object.keys(S.spentModels).forEach(k => delete S.spentModels[k]);
  S.diagState.resets = 0;
  const ref = {};
  S.seatLadder(ref, S.MODEL_CHAT);
  S.MODEL_CHAT.forEach(m => { S.spentModels[m] = true; });
  ok(S.nextModel(ref) === false, 'with every rung spent, nextModel alone gives up');
  ok(S.advance(ref) === true,
     'advance() takes the whole-ladder retry instead - per-minute quota clears, capacity returns');
  ok(Object.keys(S.spentModels).length === 0,
     'the retry actually clears the spent set, which is what a page reload used to do');
  ok(ref.current === S.MODEL_CHAT[0], 'and re-seats at the top of the pool');
})();

(() => {
  Object.keys(S.spentModels).forEach(k => delete S.spentModels[k]);
  S.diagState.resets = 0;
  const ref = {};
  S.seatLadder(ref, S.MODEL_CHAT);
  let resets = 0;
  for (let i = 0; i < 12; i++) {
    S.MODEL_CHAT.forEach(m => { S.spentModels[m] = true; });
    if (S.advance(ref)) resets++; else break;
  }
  ok(resets === 1, 'the retry is BOUNDED (1) - a genuinely dead key must still terminate, got ' + resets);
})();

// The 404 path was the only walking path that never marked the model spent, so a model that
// 404s was re-seated at the top of the next pool and 404d again, all session.
ok(/res\.status === 404[\s\S]{0,700}spentModels\[activeModelRef\.current\] = "model"/.test(src),
   'a 404 model is marked spent - every other walking path did this and this one did not');

// THE cadet-facing bug: thinking tokens are charged against maxOutputTokens, so a long turn
// spent the whole 8192 ceiling on thoughts and returned no text at all.
ok(S.MAX_TOKENS >= 32768, 'the output ceiling covers thinking AND an answer, got ' + S.MAX_TOKENS);
ok(S.genConfig().thinkingConfig &&
   S.genConfig().thinkingConfig.thinkingBudget === S.THINKING_BUDGET,
   'a thinking budget is actually sent - an uncapped model eats the whole ceiling');
ok(S.genConfig().maxOutputTokens === S.MAX_TOKENS, 'and the ceiling rides with it');
// callTutorInner, not callTutor. Set 13 wrapped callTutor to time a turn; recursing into the
// WRAPPER would end the turn's clock here and start a second, shorter one, so the retry would
// be reported as its own fast turn and the slow one it belongs to would vanish.
ok(/why === "MAX_TOKENS"[\s\S]{0,400}return callTutorInner\(/.test(src),
   'a MAX_TOKENS blank retries the SAME model with less thinking, instead of burning a rung');
ok(/thinkingSupported[\s\S]{0,300}delete body\.generationConfig\.thinkingConfig/.test(src),
   'a model that rejects thinkingConfig drops the field instead of 400ing every turn');

// Telemetry: the reason an error can now say what was tried and how often.
(() => {
  Object.keys(S.modelStats).forEach(k => delete S.modelStats[k]);
  S.noteCall('m1');
  S.noteOk('m1', { promptTokenCount: 100, thoughtsTokenCount: 8000, candidatesTokenCount: 0 });
  S.noteFail('m1', 'empty');
  const s1 = S.statFor('m1');
  ok(s1.calls === 1 && s1.ok === 1 && s1.fail === 1 && s1.kinds.empty === 1,
     'per-model counters record calls, outcomes and failure kinds');
  ok(s1.thoughtTok === 8000,
     'thinking tokens are captured - the number that proves the empty-answer bug');
  ok(S.diagState.model === 'm1', 'the running model is tracked for the error panel');
})();

ok(/usageMetadata/.test(src),
   'usageMetadata is read off the response - every build received it and threw it away');
ok(/app\.tutor_error_log|log-tutor-error/.test(src),
   'errors POST to the central log - the half that reaches a cadet who never submits');
ok(!/report_markdown|messages\.map|m\.content/.test(src.slice(src.indexOf('function diagSnapshot'),
                                                             src.indexOf('function diagText'))),
   'the logged payload is a whitelist of counters - no conversation text can reach it');

// --- SET 6: one failing turn must not cost the cadet the rest of the session ------------
//
// The bug this asserts against, measured from 75 logged sessions: `spentModels` is module
// scope and only resetLadder ever cleared it -- twice per page load, then never again.
// seatLadder walks past every spent rung to the LAST one, so after the first failing turn a
// cadet was seated on the bottom rung for good, while gemini-3.6-flash (284 successful
// answers across those sessions) sat unused at the top.
const clearSpent = () => Object.keys(S.spentModels).forEach(k => delete S.spentModels[k]);

clearSpent();
S.diagState.resets = 0;
S.MODEL_CHAT.forEach(m => { S.spentModels[m] = 'quota'; });
const revived = S.reviveSpent();
ok(revived === S.MODEL_CHAT.length,
   `reviveSpent gives back every transient rung, got ${revived}`);
ok(Object.keys(S.spentModels).length === 0,
   'and leaves nothing behind when every spend was transient');

clearSpent();
S.spentModels[S.MODEL_CHAT[0]] = 'quota';
S.spentModels[S.MODEL_CHAT[1]] = 'capacity';
S.spentModels[S.MODEL_CHAT[S.MODEL_CHAT.length - 1]] = 'model';
S.reviveSpent();
ok(!S.spentModels[S.MODEL_CHAT[0]] && !S.spentModels[S.MODEL_CHAT[1]],
   'quota and capacity are transient - they pass on their own clock');
ok(S.spentModels[S.MODEL_CHAT[S.MODEL_CHAT.length - 1]] === 'model',
   'a 404 is KEPT - re-seating a model Google says does not exist is pure waste');

// The pinned session, reproduced: walk to the bottom, then start a new turn.
clearSpent();
S.diagState.resets = 0;
const t = {};
S.seatLadder(t, S.MODEL_CHAT);
while (S.nextModel(t)) { S.spentModels[t.current] = 'quota'; }
S.spentModels[S.MODEL_CHAT[0]] = 'quota';
ok(t.current === S.MODEL_CHAT[S.MODEL_CHAT.length - 1],
   'a bad turn walks the cadet down to the bottom rung');
S.freshTurn(t);
ok(t.current === S.MODEL_CHAT[0],
   'freshTurn puts the NEXT turn back on the strongest model - the pinned-session fix');

// A key that can reach nothing must stop, not walk a ladder of 404s twice more to prove it.
clearSpent();
S.diagState.resets = 0;
S.MODEL_CHAT.forEach(m => { S.spentModels[m] = 'model'; });
const dead = {};
S.seatLadder(dead, S.MODEL_CHAT);
dead.i = S.MODEL_CHAT.length - 1;
ok(S.resetLadder(dead) === false,
   'resetLadder REFUSES when every rung is a 404 - the retry would be theatre');
ok(S.diagState.resets === 0,
   'and does not spend a reset doing it');

// freshTurn must not refill the bound that stops a dead key looping.
clearSpent();
S.diagState.resets = 2;
S.spentModels[S.MODEL_CHAT[0]] = 'quota';
S.freshTurn({});
ok(S.diagState.resets === 2,
   'freshTurn leaves diagState.resets alone - it removes the need to spend one, not the bound');

ok(S.WALK_RETRIES === 1,
   `a walkable failure retries ONCE, not 3x - 4 calls a rung is what burned 60 calls by turn 5, got ${S.WALK_RETRIES}`);
ok(/if \(attempt < retries\)/.test(src),
   'the NETWORK path keeps the full retry budget - a dropped connection does come back');
ok(/diagState\.turn\+\+;[\s\S]{0,400}freshTurn\(activeModelRef\)/.test(src),
   'freshTurn is wired to the turn boundary in runTurn - outside the block this file evaluates');

// --- set 7: measured, not reasoned ------------------------------------------------------
//
// Every constant below came out of tests/browser/test-gemini-rate-limits.html run against a
// live free-tier key on 2026-08-26, after two readings of the same failure had been overturned
// by arithmetic. What it measured:
//
//   quota id     GenerateRequestsPerMinutePerProjectPerModel-FreeTier
//   dimensions   {"model": "...", "location": "global"}      -> per project AND per model
//   blast radius gemini-3.1-flash-lite answered 200 while gemini-3.5-flash-lite refused
//   the wall     15 answered, the 16th refused                -> exactly the documented 15/min
//   recovery     20.6 seconds
//   RetryInfo    8s on a wall still standing 11s later; 57s on one that cleared in 10s
//
// The blast-radius result is why a 429 now WALKS instead of retrying: the neighbour has its own
// allowance. The RetryInfo result is why the wait is bounded by our own number and not Google's.

ok(S.QUOTA_WALK_RETRIES === 0,
   `a 429 does NOT retry its rung - measured: the neighbouring model answers 200 while this one refuses, and a per-minute window cannot clear in 500ms, got ${S.QUOTA_WALK_RETRIES}`);

ok(S.WALK_RETRIES === 1,
   `a 5xx still retries once - server capacity is a different failure from a rate limit, got ${S.WALK_RETRIES}`);

ok(S.LADDER_RESET_LIMIT === 1,
   `ONE whole-ladder lap per turn, not two, got ${S.LADDER_RESET_LIMIT}`);

// The arithmetic that broke the cadet's session, pinned so it cannot regress quietly.
// Worst case per model per turn: one call per lap, plus one more after the ladder wait.
ok((S.QUOTA_WALK_RETRIES + 1) * (S.LADDER_RESET_LIMIT + 1 + S.LADDER_WAITS_PER_TURN) <= 5,
   `worst-case requests per model per TURN must stay under the MEASURED Flash cap of 5/min, got ${(S.QUOTA_WALK_RETRIES + 1) * (S.LADDER_RESET_LIMIT + 1 + S.LADDER_WAITS_PER_TURN)}`);

// RAISED BY SET 12, and the old bound is why. 20.6s was measured on one wall; the wall this
// number exists to outlast was measured on 2026-08-26 at 41s, which the old ceiling of 40000
// actually FORBADE. A wait that expires before the wall clears is spent for nothing.
ok(S.LADDER_WAIT_MS >= 41000 && S.LADDER_WAIT_MS <= 60000,
   `the ladder wait outlasts the 41s measured recovery without becoming a freeze, got ${S.LADDER_WAIT_MS}`);
ok(S.LADDER_WAIT_MIN_MS >= 40000 && S.LADDER_WAIT_MIN_MS <= S.LADDER_WAIT_MS,
   `RetryInfo may shorten the wait, but never below the measured recovery, got ${S.LADDER_WAIT_MIN_MS}`);

ok(S.LADDER_WAITS_PER_TURN >= 1,
   `an exhausted ladder waits at least once before giving up - the walls are per-minute and they clear, got ${S.LADDER_WAITS_PER_TURN}`);

(() => {                       // the ladder-wait allowance is per TURN, not per session
  clearSpent();
  S.spendLadderWait();
  ok(S.ladderWaitsNow() === 1, 'a ladder wait is counted');
  // INVERTED ON 2026-08-28, and the old assertion is the bug it was asserting. reviveSpent is
  // called from THREE places and only one is a turn boundary -- the 429 branch calls it right
  // after spending the wait, and resetLadder calls it mid-walk. Clearing here refilled the
  // allowance that had just been spent, so `ladderWaits < LADDER_WAITS_PER_TURN` never became
  // false and the wait loop had no exit. Measured: 63 waits across 24 turns, 142 minutes.
  S.reviveSpent();
  ok(S.ladderWaitsNow() === 1,
     'reviveSpent does NOT refill the wait allowance - it is called mid-turn, and refilling it '
     + 'there is what made the countdown endless, got ' + S.ladderWaitsNow());
  S.freshTurn({ ladder: S.MODEL_CHAT, i: 0, current: S.MODEL_CHAT[0] });
  ok(S.ladderWaitsNow() === 0,
     'freshTurn DOES clear it - that is the turn boundary, and runTurn is its only caller, got '
     + S.ladderWaitsNow());
})();

// These live beside rawCall, outside the block this file evaluates, so they are read as text.
ok(!/waitMs <= 15000/.test(src) && !/RETRY_WAIT_CEILING_MS/.test(src),
   'the per-rung wait is GONE - waiting on a rung whose neighbour answers is wasted');
ok(/if \(attempt < QUOTA_WALK_RETRIES\)/.test(src),
   'the 429 branch reads the measured constant rather than sharing the 5xx one');
// Widened twice on 2026-08-26 -- 700 to 1400 for set 9's day-lock gate, then to 2200 for
// set 11's scope vote. The ORDER is what this asserts, not the distance between the two.
ok(/if \(advance\(activeModelRef\)\) \{ attempt = 0; continue; \}[\s\S]{0,2200}ladderWaits < LADDER_WAITS_PER_TURN/.test(src),
   'the wait comes AFTER the walk fails, which is the only moment it beats walking');
ok(/Math\.min\(Math\.max\(waitMs, LADDER_WAIT_MIN_MS\), LADDER_WAIT_MS\)/.test(src),
   "Google's RetryInfo may only SHORTEN the wait - measured at 57s for a wall that cleared in 10");
ok(/async function waitVisibly\(model, ms\)/.test(src) && /onModelSwitch\.fn\(n > 0\s*\?/.test(src),
   'the wait is SHOWN on the existing status strip, not hidden behind a spinner');
// reviveLadder since 2026-08-28, not freshTurn. Same revive, same re-seat, same purpose --
// what it no longer does is hand back the wait allowance this branch just spent. See set 14.
ok(/if \(reviveLadder\(activeModelRef\)\) \{ attempt = 0; continue; \}/.test(src),
   'after the wait the ladder is revived and re-seated, so the wait buys a whole fresh ladder');

// --- set 7, the logging half: record WHICH quota Google named ---------------------------
(() => {
  clearSpent();
  S.noteQuota('gemini-3.6-flash', 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier');
  S.noteQuota('gemini-3.6-flash', 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier');
  const s = S.statFor('gemini-3.6-flash');
  ok(s.quotaIds && s.quotaIds['GenerateRequestsPerMinutePerProjectPerModel-FreeTier'] === 2,
     'noteQuota counts the quota id Google named, so a repeat is visible as a count');
})();

ok(/QuotaFailure/.test(src),
   'the 429 body is read for its QuotaFailure violation - the name is what settled per-model vs per-project');
ok(/if \(quotaId\) noteQuota\(activeModelRef\.current, quotaId\)/.test(src),
   'the quota id is recorded against the model that was refused');
ok(/quota_ids: s\.quotaIds \|\| \{\}/.test(src),
   'the quota id reaches diagSnapshot, so it is in the block a cadet copies and in the central log');
ok(/lines\.push\("      quota: " \+ qids\.join\(", "\)\)/.test(src),
   'the quota id is PRINTED - the probe will not be re-run mid-term, so the error block must carry it');
ok(src.indexOf('let quotaId = ""') < src.indexOf('noteFail(activeModelRef.current, "quota")'),
   'the 429 body is parsed BEFORE the walk - res.json() can be called only once, so a guarded parse dropped it unread');

// --- set 8: the log's `detail` column was NULL in all 872 rows it ever held -------------
ok(/let quotaMsg = "";/.test(src),
   "Google's own 429 message is kept - `detail` was NULL in every row of the 2026-08-25 night");
ok(/if \(j\.error && j\.error\.message\) quotaMsg = String\(j\.error\.message\)\.slice\(0, 300\)/.test(src),
   'the message is read from the SAME body parse set 7 already does - no extra request');
// Set 11 replaced set 9's two-valued "[daily] " prefix with the scope's own name, so the
// log's `detail` says day, minute or unknown rather than daily-or-nothing.
ok(/detail: "\[" \+ scopeOut \+ "\] " \+ quotaMsg/.test(src),
   'and it rides out on the throw, which is what reaches log-tutor-error');
ok(!/throw \{ kind: "quota", status: 429 \};/.test(src),
   'the detail-less quota throw is gone - it was 774 of 872 rows');


// --- set 9: a per-DAY 429 and a per-MINUTE 429 are opposite problems --------------------
//
// The expensive half is the daily one. gemini-3.6-flash is 20 requests per DAY and a lesson
// is ~14, so a cadet's SECOND lesson of the day begins with the top rung already dead --
// and before this set, freshTurn() revived it at the top of every turn and spent one
// guaranteed refusal on it, and another beneath it, in front of everything the cadet typed.
clearSpent();
S.diagState.resets = 0;
globalThis.localStorage.removeItem(S.QUOTA_STORE);
S.book().m = {};            // and drop the in-memory copy the module is holding

// Google NAMES the quota, which is cheaper and stricter than any inference.
ok(S.quotaScope('gemini-3.6-flash',
                'GenerateRequestsPerDayPerProjectPerModel-FreeTier') === 'day',
   'a quota id naming PerDay is read as the DAILY cap - Google says so, we do not guess');
ok(S.quotaScope('gemini-3.6-flash',
                'GenerateRequestsPerMinutePerProjectPerModel-FreeTier') === 'minute',
   'the id measured on 2026-08-26 is read as the per-MINUTE cap');

// REVERSED BY SET 11, and this is the assertion that was wrong rather than the code.
// It read: fewer than 5 sends in the last minute cannot be a per-minute limit, therefore
// daily. True as far as it goes -- and useless, because a rung the ladder WALKS TO has had
// exactly one call, so every walked-to rung took that branch and every exhausted ladder was
// reported as "come back tomorrow". Google named the quota in 0 of 885 live rows, so this
// branch was not a fallback; it was the whole function.
ok(S.quotaScope('gemini-3.6-flash', '') === 'unknown',
   'no quota id and nothing sent today = UNKNOWN, not daily - ending a lesson needs evidence');
for (let i = 0; i < S.RPM_FLASH; i++) S.noteSend('gemini-3.6-flash');
ok(S.quotaScope('gemini-3.6-flash', '') === 'minute',
   'a full per-minute window IS claimable as minute - that is a fact about our own sending');
ok(S.quotaScope('gemini-3.6-flash',
                'GenerateRequestsPerDayPerProjectPerModel-FreeTier') === 'day',
   'and the NAME still wins over any arithmetic when the body carried one');

// The measured caps, and the pacer built on them.
ok(S.RPM_FLASH === 5 && S.RPM_LITE === 15,
   'the per-minute caps are the ones measured against a live key, not the ones published');
ok(S.rpmOf('gemini-3.5-flash-lite') === S.RPM_LITE && S.rpmOf('gemini-3.6-flash') === S.RPM_FLASH,
   'rpmOf tells a lite rung from a flash rung - they differ by 3x and share a ladder');
ok(S.pacedOut('gemini-3.6-flash'),
   'a flash rung with 5 sends in the last minute is paced out - the next request is a known 429');
ok(!S.pacedOut('gemini-3.5-flash-lite'),
   'a lite rung at the same count is NOT - the limit is per model, so it has its own allowance');
ok(S.sentSince('gemini-3.6-flash', 0) === 0,
   'sentSince honours its window rather than counting everything ever sent');

// A day lock is not a spend that comes back at the turn boundary.
S.lockDay('gemini-3.6-flash');
ok(S.dayLocked('gemini-3.6-flash') && !S.dayLocked('gemini-3.5-flash'),
   'a day lock is recorded against ONE model - the cap is per model and so is the lock');
S.spentModels['gemini-3.6-flash'] = 'day';
S.spentModels['gemini-3.5-flash'] = 'quota';
S.reviveSpent();
ok(S.spentModels['gemini-3.6-flash'] === 'day',
   'reviveSpent KEEPS a day lock - it cannot clear before midnight Pacific, so reviving it buys a guaranteed 429 every turn');
ok(!S.spentModels['gemini-3.5-flash'],
   'and still clears a per-minute one, which is the whole point of freshTurn');

// The lock survives a reload, which is why it is in localStorage at all. A cadet who reloads
// looked like a fresh session to counters that lived in module scope and died with the page.
ok(/gemini-3\.6-flash/.test(globalThis.localStorage.getItem(S.QUOTA_STORE) || ''),
   'the lock is written through to localStorage, so it outlives the page load');
clearSpent();
ok(S.seedDayLocks([['gemini-3.6-flash', 'gemini-3.5-flash-lite']]) === 1,
   'a new page load seeds today\'s locks back onto the ladder before the first turn is typed');
ok(S.spentModels['gemini-3.6-flash'] === 'day' && !S.spentModels['gemini-3.5-flash-lite'],
   'and seeds only what is actually locked');
ok(S.modelStats['gemini-3.6-flash'] && S.modelStats['gemini-3.6-flash'].kinds.daily_capped === 1,
   'a rung skipped before it was ever tried still appears in the error panel and the log');

// The expiry mechanism is the stored Pacific date failing to match. There is no timer.
ok(/^\d{4}-\d{2}-\d{2}$/.test(S.quotaDay()),
   'quotaDay is a sortable YYYY-MM-DD, and it is PACIFIC - Google resets RPD at midnight PT, which is 1am here');
S.book().day = '2000-01-01';
S.saveBook();
ok(!S.dayLocked('gemini-3.6-flash'),
   'a new Pacific day wipes every lock - nothing is scheduled, the stored day simply stops matching');

// Read as text: these live beside rawCall, outside the block this file evaluates.
ok(/if \(paced < PACE_WALK_LIMIT && pacedOut\(activeModelRef\.current\)\)/.test(src),
   'the pacer runs BEFORE the fetch - a predictable refusal is a round trip the cadet waits through');
ok(/paced\+\+;\s*\r?\n\s*if \(nextModel\(activeModelRef\)\) continue;/.test(src),
   'the pacer walks with nextModel, NOT advance - advance spends a whole-ladder lap, and pacing is routine, not failure');
ok(S.PACE_WALK_LIMIT >= S.MODEL_CHAT.length,
   'the pacer may step past every rung of the ladder it is on, and no further - it cannot spin');
ok(/const allDay = qs\.length > 0 && qs\.every\(\(s\) => s === "day"\)/.test(src)
   && /if \(!allDay && ladderWaits < LADDER_WAITS_PER_TURN\)/.test(src),
   'a fully day-locked ladder does NOT take the 25s wait - that wait cannot help before midnight');
ok(/scope: scopeOut/.test(src),
   'the throw says WHICH quota, so the cadet-facing message can stop hedging');
ok(/err\.scope === "day"/.test(src)
   && /resets at midnight Pacific time/.test(src)
   && /Google is asking us to slow down/.test(src),
   'and the cadet is told the one thing that is true for their case: wait a minute, or come back tomorrow');
ok(S.QUIET_WAIT_MS > 0 && S.QUIET_WAIT_MS <= 5000,
   'a short pause is taken silently - announcing a 2s wait as an error teaches a working page as broken');
ok(/if \(ms <= QUIET_WAIT_MS\) \{ await sleep\(ms\); return; \}/.test(src),
   'and waitVisibly is where that decision lives, so every caller inherits it');
ok(/noteSend\(name\);/.test(src) && /function noteCall\(name\) \{[\s\S]{0,200}noteSend\(name\)/.test(src),
   'every request the transport sends is counted, retries included - a retry costs quota whether or not it works');
ok(/seedDayLocks\(\[MODEL_CHAT, MODEL_REPORT, MODEL_STUDY\]\)/.test(src),
   'seeding happens after discovery filters the ladders, so it runs against the final lists');

clearSpent();
S.diagState.resets = 0;

// --- set 10: "it starts with AIza" was a GUESS, and it was usually wrong -----------------
//
// discoverModel threw one kind for 400, 401 AND 403, so a cadet whose key was perfect but
// whose Generative Language API was switched off was told to re-copy it -- with the Start
// button greyed out behind that advice, because connStatus was not "ok". Google names the
// real cause in error.message and all 44 builds discarded it.
//
// keyErrorKind is a pure function and lives outside the block this file evaluates, so lift
// it out on its own and run it against Google's ACTUAL wording rather than asserting that
// some regex is present.
const kekSrc = src.slice(src.indexOf('function keyErrorKind('));
const keyErrorKind = new Function(
  kekSrc.slice(0, kekSrc.indexOf('\n}') + 2) + '\nreturn keyErrorKind;')();

ok(keyErrorKind(403, 'Generative Language API has not been used in project 41 before or it '
   + 'is disabled. Enable it by visiting https://console.developers.google.com/apis/api/'
   + 'generativelanguage.googleapis.com/overview?project=41 then retry.') === 'apioff',
   'a switched-off API is NOT a mistyped key - this is the case that sent cadets to re-copy a perfect key');
ok(keyErrorKind(403, 'Requests from referer https://dfpm-physics.github.io/ are blocked.')
   === 'keyrestricted',
   'a referrer-restricted key is named as restricted, not as wrong');
ok(keyErrorKind(400, 'User location is not supported for the API use.') === 'region',
   'a region refusal is not a key problem and no amount of re-pasting fixes it');
ok(keyErrorKind(400, 'API key not valid. Please pass a valid API key.') === 'auth',
   'and a key that really IS invalid still reads as auth - the narrow case the old message fits');
ok(keyErrorKind(403, 'Permission denied on resource project.') === 'forbidden',
   'a 403 that never mentions the key is NOT about the key - it gets its own honest message');
ok(keyErrorKind(401, '') === 'auth',
   'a 401 with no body falls back to auth rather than inventing a cause');
ok(keyErrorKind(400, '') === 'auth',
   'so does a bare 400 - unrecognised at 400 is a key problem, unrecognised at 403 is not');

// Every kind the classifier can return must have a cadet-facing message. A kind with no case
// falls to the default "HTTP ?" text, which is exactly the uninformative answer this set removes.
['apioff', 'keyrestricted', 'region', 'forbidden', 'auth'].forEach((k) => {
  ok(new RegExp('case "' + k + '":').test(src), 'kind `' + k + '` has its own cadet-facing message');
});
ok(!/it starts with \\u201CAIza\\u201D/.test(src),
   'the old one-size message is GONE - it was the answer to three different problems');
ok(/aistudio\.google\.com/.test(src),
   'and the new ones name where to actually get a key');

// The door reads the sentence.
ok(/kind: keyErrorKind\(res\.status, msg\), status: res\.status, detail: msg\.slice\(0, 300\)/.test(src),
   'discoverModel classifies from Google\'s message and keeps it as detail');
ok(!/if \(res\.status === 400 \|\| res\.status === 401 \|\| res\.status === 403\) \{\s*\r?\n\s*throw \{ kind: "auth"/.test(src),
   'the lumped three-code throw is gone');

// The door LOGS. All 878 rows carried phase chat/opening/report because this catch did not.
ok(/diagState\.phase = "start";/.test(src) && /logError\(diagSnapshot\(err\)\.obj\)/.test(src),
   'a cadet stopped at the start screen now reaches the central log - 0 of 878 rows ever did');
ok(/loggedKeyErrors\[sig\]/.test(src),
   'and it is deduped per kind+status, because the check is debounced on every keystroke');
ok(/const \[connDetail, setConnDetail\] = useState\(""\)/.test(src)
   && /Google said: \{connDetail\}/.test(src) && /\.conn-detail \{/.test(src),
   "Google's own words are shown under our advice - our advice is a classification and can still be wrong");

// A mid-session 403 is a per-model failure, like the 404 and 429 that already walk.
ok(/if \(res\.status === 403 && akind === "forbidden"\) \{[\s\S]{0,300}if \(advance\(activeModelRef\)\) \{ attempt = 0; continue; \}/.test(src),
   'a 403 that is not about the key WALKS THE LADDER - one cadet took this at turn 9 and was told their key was bad');
ok(/spentModels\[activeModelRef\.current\] = "model";[\s\S]{0,120}if \(res\.status === 403/.test(src)
   || /akind === "forbidden"\) \{[\s\S]{0,200}spentModels\[activeModelRef\.current\] = "model"/.test(src),
   'and it is marked permanent for the session - an entitlement does not appear mid-lesson');
ok(/throw \{ kind: akind, status: res\.status, detail: amsg\.slice\(0, 300\) \}/.test(src),
   'when every rung refuses, the throw still carries what Google said');
ok(/throw \{ kind: k400, status: 400, detail: msg\.slice\(0, 300\) \}/.test(src),
   'the mid-session 400 now attaches detail too - all seven auth rows of 2026-08-25 stored NULL there');

// --- set 11: "come back tomorrow" was being said on no evidence at all -------------------
//
// Within hours of set 9 shipping, the live log said its primary test never runs: across all
// 885 rows of 2026-08-26 Google named the quota ZERO times. Every 429 carried the bare
// sentence "Resource has been exhausted (e.g. check quota)." So every classification fell to
// the tiebreaker, and the tiebreaker said "day" for any rung with fewer than 5 sends in the
// last minute -- which is every rung the ladder walks to, because a walked-to rung has had
// exactly one call. One cadet was told to come back tomorrow, reloaded, and was told it again
// four seconds into the new session.
clearSpent();
globalThis.localStorage.removeItem(S.QUOTA_STORE);
S.book().m = {};

ok(S.RPD_FLASH === 20 && S.RPD_LITE === 500,
   'the DAILY caps are known to the classifier at last - set 9 had them in a comment only');
ok(S.rpdOf('gemini-3.5-flash-lite') === S.RPD_LITE && S.rpdOf('gemini-3.6-flash') === S.RPD_FLASH,
   'rpdOf tells a 20-a-day rung from a 500-a-day one - they differ by 25x and share a ladder');
ok(S.DAILY_CONFIDENCE > 0 && S.DAILY_CONFIDENCE <= 1,
   'the daily threshold is a fraction of the cap, not the cap - the ledger is per browser and undercounts');

// The whole point: a lite rung refused on its FIRST call is not a 500-a-day cap.
ok(S.quotaScope('gemini-3.5-flash-lite', '') === 'unknown',
   'a lite rung refused with nothing sent today is UNKNOWN - nobody reaches 500 requests by turn 5');
S.bookFor('gemini-3.5-flash-lite').sent = Math.round(S.RPD_LITE * S.DAILY_CONFIDENCE);
ok(S.quotaScope('gemini-3.5-flash-lite', '') === 'day',
   'and it becomes DAILY once our own ledger can show the requests - "come back tomorrow" needs receipts');

// A flash rung is the case that actually happens: 20 a day is four turns of a second lesson.
S.bookFor('gemini-3.5-flash').sent = Math.round(S.RPD_FLASH * S.DAILY_CONFIDENCE);
ok(S.quotaScope('gemini-3.5-flash', '') === 'day',
   'a flash rung at 80% of 20 IS claimable as daily - this is the one a real cadet hits');
S.bookFor('gemini-3.5-flash').sent = 1;
ok(S.quotaScope('gemini-3.5-flash', '') === 'unknown',
   'and one send is not - the same rung, the same 429, and the honest answer changes');

// Undercounting must fail SAFE. A cadet who started the day on a phone begins the laptop
// session at zero, and the wrong direction there is the one that ends the lesson.
ok(S.quotaScope('gemini-3.6-flash', '') !== 'day',
   'an empty ledger never yields "day" - undercounting costs a wait, overcounting costs the lesson');

// Read as text.
ok(/spentModels\[activeModelRef\.current\] = scope;/.test(src),
   'the real scope is stored, not flattened to "quota" - the throw has to tell confident from unexplained');
ok(/const scopeOut = allDay \? "day"/.test(src) && /qs\.indexOf\("unknown"\) > -1/.test(src),
   'one unexplained rung is enough to stop the ladder claiming the day is over');
ok(/\.filter\(\(s\) => s === "day" \|\| s === "minute" \|\| s === "unknown"\)/.test(src),
   'only rungs spent on QUOTA get a vote - a 404 says nothing about anyone\'s allowance');
ok(/err\.scope === "day"/.test(src) && /err\.scope === "minute"/.test(src)
   && /it did not say why/.test(src),
   'three cadet-facing answers, and the third one admits it does not know');
// Set 12 changed WHAT the third one says. It used to hedge across two actions because it was
// hedging across two causes; measurement removed one of the causes, so it now gives the one
// action that fits what is known, and does not send the cadet away for the night.
ok(/Wait a minute and press Retry\./.test(src)
   && /nothing is lost if you close the page/.test(src),
   'and the unknown one gives ONE action plus the reassurance that makes it safe to take');

clearSpent();
globalThis.localStorage.removeItem(S.QUOTA_STORE);
S.book().m = {};
S.diagState.resets = 0;

// --- set 12: the first fix set corrected by measurement rather than by the next incident --
//
// 107 recorded requests against a disposable key, plus a census of app.tutor_error_log.
// Everything below is asserted against a string or a number that was OBSERVED. Sets 9-11
// each shipped an inference and were corrected within a day by the cadets who met it.

// A real quota refusal is chatty. Both measured 429s named the metric, the limit, the model
// and a delay -- so when Google DOES name it, the name still decides, and these must not have
// been broken by set 12.
ok(S.quotaScope('gemini-3.1-flash-lite',
                'GenerateRequestsPerMinutePerProjectPerModel-FreeTier') === 'minute',
   'the MEASURED per-minute quota id still reads as minute');
ok(S.quotaScope('gemini-3.5-flash',
                'GenerateRequestsPerDayPerProjectPerModel-FreeTier') === 'day',
   'and the MEASURED per-day quota id still reads as day');

// The measured caps, which the run confirmed to the request.
ok(S.RPD_FLASH === 20, 'flash walled on request 20 exactly - measured, not documented');
ok(S.RPM_LITE === 15, 'lite walled on request 16 exactly - measured, not documented');

// THE ONE THAT MATTERS. 781 live refusals, every one bare, and this row settles it:
//     gemini-3.5-flash-lite   calls 1   ok 0   kinds {quota: 1}
// One request against caps of 15/minute and 500/day. Whatever refused it, it was not that
// key's allowance -- so the cadet must not be told their allowance is gone.
// Matched against the RETURN statement, not the file. The set-12 comment quotes both removed
// sentences deliberately -- that quotation is the record of what measurement disproved -- so a
// bare substring search here would fail on this fix's own documentation.
const RETURNED = (src.match(/return "[^"]*"/g) || []).join('\n');
ok(!/The usual cause is your Google project's free daily allowance/.test(RETURNED),
   'the unknown 429 no longer blames the cadet\'s daily allowance - measured false');
ok(!/come back after the reset/.test(RETURNED),
   'and it no longer sends them away for the night on a refusal that named nothing');
ok(/almost certainly Google being busy/.test(src)
   && /nowhere near your limits/.test(src),
   'it says what our own ledger actually knows, and names the likely cause without asserting it');
ok(/worst in the evening, when the whole class is working/.test(src),
   'and tells the cadet the one thing that makes the pattern make sense to them');

// The day and minute messages are untouched: those scopes only fire on Google's own name now,
// and both names were observed.
ok(/resets at midnight Pacific time/.test(src) && /Retrying now cannot work/.test(src),
   'a NAMED daily refusal still says come back tomorrow, because that one is evidenced');

// --- the two key failures cadets actually get --------------------------------------------
// Set 10's five patterns matched 0 live rows in four days. These two produced 13.
ok(keyErrorKind(403, "Permission denied: Consumer 'api_key:AQ.Ab8RN6K3ra' has been "
   + 'suspended.') === 'suspended',
   'a SUSPENDED project is named as suspended - 10 live rows, all told to re-copy a perfect key');
ok(keyErrorKind(401, 'The bound service account is deleted or disabled. The service account '
   + 'bound to the API key must be active.') === 'deadproject',
   'a dead service account is named too - 3 live rows, same wrong advice');
ok(/case "suspended":/.test(src) && /re-copying it will not help/.test(src),
   'and both messages say re-copying will not help, which is the whole content of the fix');
ok(/PERSONAL Google account/.test(src),
   'the suspended message gives the one action that has a chance of working');

// The suspended test must sit ABOVE `forbidden`, because that test excludes any message
// mentioning a key and this message contains the literal string "api_key:". That exclusion
// was a guess in set 10, and it swallowed a real case.
ok(src.indexOf('return "suspended"') < src.indexOf('return "forbidden"'),
   'suspended is tested before forbidden - forbidden\'s key-exclusion would swallow it');

// Google's REAL wording for a mangled key, captured at last. Both still land on auth, which
// is correct -- set 10 got these right by accident of its exclusions, and now they are pinned.
ok(keyErrorKind(401, 'Request had invalid authentication credentials. Expected OAuth 2 access '
   + 'token, login cookie or other valid authentication credential. See '
   + 'https://developers.google.com/identity/sign-in/web/devconsole-project.') === 'auth',
   'a key with trailing junk returns 401 with OAuth wording, and still reads as auth');
ok(keyErrorKind(403, "Method doesn't allow unregistered callers (callers without established "
   + 'identity). Please use API Key or other form of API consumer identity to call this '
   + 'API.') === 'auth',
   'an EMPTY key returns 403, and must not be mistaken for an entitlement problem');

// --- set 13: the countdown is not a fault, and a turn is finally measured -----------------
// Two separate claims. The first is about WORDS a cadet reads; the second is about whether
// anything in this build can answer "how long did that take", which until 2026-08-27 nothing
// could -- activeSec stops for `loading`, and a ladder wait that RECOVERS writes no error row,
// so both instruments were blind to exactly the seconds being complained about.

// The CONCATENATION, not the phrase. Set 13's own comment quotes the old wording verbatim --
// that is the record of what it used to say and is worth keeping -- so a bare phrase match
// fails on the explanation rather than on the behaviour. `" + n` only appears where the string
// is actually being built for the hook.
ok(!/rate limited, retrying in " \+ n/.test(src),
   'the countdown no longer says "rate limited" - it renders as `Tutor model: X - rate limited` '
   + 'under the chat, and cadets reported a working page as broken');
ok(/pausing " \+ n \+ "s to stay inside Google's free limit/.test(src),
   'it names what the pause is FOR - the page protecting an allowance they must make last a term');
ok(/This is normal/.test(src) && /carries on by itself/.test(src) && /work is saved/.test(src),
   'and answers the three things a cadet needs here: expected, self-clearing, nothing lost');

ok(typeof S.timingSummary === 'function' && typeof S.noteTurn === 'function',
   'a timing ledger exists at all - this is the whole of what set 13 adds');
S.noteTurn(4000); S.noteTurn(90000);
ok(S.timingSummary().turns === 2, 'turns are counted, got ' + S.timingSummary().turns);
ok(S.timingSummary().max_turn_sec === 90,
   'the WORST turn is kept, not just the mean - one 90s turn is the complaint, and an average '
   + 'buries it, got ' + S.timingSummary().max_turn_sec);
ok(S.timingSummary().slow_turns === 1,
   'turns over 30s are counted separately, got ' + S.timingSummary().slow_turns);
S.noteWait(45000); S.noteApi(3000);
ok(S.timingSummary().wait_sec === 45,
   'a deliberate wait is charged to waits, not to the model - the 45s ladder pause is OUR '
   + 'second, not Google being slow, got ' + S.timingSummary().wait_sec);
ok(S.timingSummary().api_sec === 3,
   'and time actually inside fetch is charged to the API, got ' + S.timingSummary().api_sec);

// The wall clock is the one that must NOT inherit activeSec's gates, which is the entire bug.
ok(/timing\.wallSec\+\+/.test(src), 'a wall clock ticks somewhere');
const wallEffect = src.slice(src.indexOf('timing.wallSec++') - 400,
                             src.indexOf('timing.wallSec++'));
ok(!/if \(loading\) return/.test(wallEffect),
   'the wall clock is NOT gated on `loading` - that gate is why duration_min could not see a '
   + '120s request deadline or a 45s ladder wait');
ok(!/IDLE_PAUSE_MS/.test(wallEffect),
   'nor on the cadet typing - activeSec stops 5s after the last keystroke, by design, and that '
   + 'design is what made it the wrong number to read as latency');

ok(/d\.timing = timingSummary\(\)/.test(src) && /d\.duration_min = /.test(src),
   'it is reported BESIDE duration_min, never instead of it - effort and pacing still read the '
   + 'active clock, and contract section 8 permits the added key');
ok(/timing: \{ \.\.\.timing \}/.test(src) && /Object\.assign\(timing, saved\.timing\)/.test(src),
   'and it survives a reload, or a cadet who reloads reports only the tail of their session');

// --- set 14: one wait per turn, actually --------------------------------------------------
// The 2026-08-28 loop. Cadets: "it just keeps restarting the timer without end", on keys over
// the DAILY cap on both flash rungs and nowhere near it on either lite rung. All one bug:
// reviveSpent() refilled `ladderWaits`, and the 429 branch calls reviveSpent() (via freshTurn)
// immediately after spending it. Set 13's payloads measured it -- 63 waits across 24 turns.

ok(/function reviveLadder\(/.test(src),
   'the mid-turn revive is its own function - one function serving both a turn boundary and a '
   + 'mid-turn caller is the whole defect');
ok(/if \(reviveLadder\(activeModelRef\)\) \{ attempt = 0; continue; \}/.test(src),
   'the 429 wait path calls reviveLadder, NOT freshTurn - freshTurn would hand back the wait '
   + 'allowance the branch has just spent');
ok(/function runTurn[\s\S]{0,600}freshTurn\(activeModelRef\)/.test(src),
   'runTurn still calls freshTurn - the turn boundary keeps its reset, so Retry gets a fresh '
   + 'wait and recovery is unchanged in kind');

// resetLadder is the SECOND caller, and it leaked the same counter. Bounded by
// LADDER_RESET_LIMIT and a diagState.resets that is never cleared, so it could only leak once
// per page load -- the same defect at a smaller size, and fixed by the same move.
{
  const rl = src.slice(src.indexOf('function resetLadder(ref) {'),
                       src.indexOf('function advance(ref)'));
  ok(/reviveSpent\(\)/.test(rl) && !/ladderWaits/.test(rl),
     'resetLadder revives without refilling the allowance either - it runs mid-walk, not at a '
     + 'turn boundary');
}

// THE LOOP, pinned shut. Two lite rungs spent as "unknown" is the reported configuration:
// allDay stays false so the wait is always offered, and both rungs revive every pass. The only
// thing that ever stopped it was the allowance, and the allowance was being refilled.
{
  const lad = ['a', 'b'];
  const ref = { ladder: lad, i: 0, current: 'a' };
  S.freshTurn(ref);                                   // turn boundary: allowance = 1
  let waits = 0;
  for (let i = 0; i < 50; i++) {                      // 50 passes of the 429 branch
    S.spentModels['a'] = 'unknown';
    S.spentModels['b'] = 'unknown';
    if (S.ladderWaitsNow() < S.LADDER_WAITS_PER_TURN) { S.spendLadderWait(); waits++; }
    else break;                                       // this is the exit that did not exist
    S.reviveLadder(ref);
  }
  ok(waits === 1,
     'a single turn can take the ladder wait exactly ONCE, however many times the ladder '
     + 'empties - before this it was unbounded, got ' + waits);
  delete S.spentModels['a']; delete S.spentModels['b'];
}

// ---- set 15: the pause writes a row ---------------------------------------------------
// A cadet who pauses and then SUCCEEDS throws nothing and submits normally, so before this
// they were invisible to both instruments at once: no error row, and only an aggregate inside
// a payload that only exists if they finished. Measured in app.tutor_error_log: 774 `quota`
// rows the night before the wait existed, 11 the next, and 0 on the night cadets reported
// endless countdowns.
ok(/kind: "pause", status: 429/.test(src),
   'a visible countdown logs a `pause` row, not only the quota error it may become');

// BOUNDED. The log call must sit inside the allowance guard, or one stuck turn writes a row
// per pass -- which is the loop set 14 closed, re-opened against the database instead of
// against the cadet.
ok(/ladderWaits < LADDER_WAITS_PER_TURN[\s\S]{0,1400}kind: "pause"/.test(src),
   'the pause row is written inside the per-turn allowance guard, so it is one row per turn');

// BEFORE THE SLEEP, and that is the whole point of it. logError posts with keepalive, so a row
// already in flight survives the tab closing -- and closing the tab DURING the countdown is
// exactly what the give-up population does. Logging after the sleep would miss them.
ok(/kind: "pause"[\s\S]{0,400}await waitVisibly\(activeModelRef\.current, pauseMs\)/.test(src),
   'the row is posted BEFORE the countdown starts, so a cadet who gives up mid-wait is still '
   + 'logged');

// One computation, used twice. The wait length used to be an inline expression evaluated only
// inside the waitVisibly call; logging it meant hoisting it, and the risk of hoisting is that
// the two drift and the row reports a duration the cadet never saw.
ok(/const pauseMs = waitMs > 0/.test(src)
   && (src.match(/pauseMs/g) || []).length >= 3,
   'the pause length is computed once and both logged and slept, so the row cannot report a '
   + 'duration different from the one shown');

// Same whitelist as every other row. diagSnapshot builds `obj` from a fixed key list and the
// edge function builds its INSERT from another, so a pause row cannot carry a field -- or a
// sentence the cadet typed -- that an error row could not.
ok(/logError\(diagSnapshot\(\{[\s\S]{0,300}\}\)\.obj\)/.test(src),
   'the pause row goes through diagSnapshot/logError like every other row, so it inherits the '
   + 'same whitelist and cannot carry conversation text');

console.log(`\n${pass} passed, ${fail} failed`);
console.log('NOTE: no live key is used — this checks selection logic, not a real tutor turn.');
process.exit(fail ? 1 : 0);
