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
           seatLadder, nextModel, spentModels, onModelSwitch,
           advance, resetLadder, waitedFor, diagState, modelStats, statFor, noteCall,
           noteOk, noteFail, genConfig, MAX_TOKENS, THINKING_BUDGET,
           freshTurn, reviveSpent, WALK_RETRIES, LADDER_RESET_LIMIT, noteQuota,
           QUOTA_WALK_RETRIES, LADDER_WAIT_MS, LADDER_WAITS_PER_TURN,
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
ok(/why === "MAX_TOKENS"[\s\S]{0,400}return callTutor\(/.test(src),
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

ok(S.LADDER_WAIT_MS >= 20600 && S.LADDER_WAIT_MS <= 40000,
   `the ladder wait covers the 20.6s measured recovery without becoming a freeze, got ${S.LADDER_WAIT_MS}`);

ok(S.LADDER_WAITS_PER_TURN >= 1,
   `an exhausted ladder waits at least once before giving up - the walls are per-minute and they clear, got ${S.LADDER_WAITS_PER_TURN}`);

(() => {                       // the ladder-wait allowance is per TURN, not per session
  clearSpent();
  S.spendLadderWait();
  ok(S.ladderWaitsNow() === 1, 'a ladder wait is counted');
  S.reviveSpent();
  ok(S.ladderWaitsNow() === 0,
     'reviveSpent clears it - it rides with the turn boundary, got ' + S.ladderWaitsNow());
})();

// These live beside rawCall, outside the block this file evaluates, so they are read as text.
ok(!/waitMs <= 15000/.test(src) && !/RETRY_WAIT_CEILING_MS/.test(src),
   'the per-rung wait is GONE - waiting on a rung whose neighbour answers is wasted');
ok(/if \(attempt < QUOTA_WALK_RETRIES\)/.test(src),
   'the 429 branch reads the measured constant rather than sharing the 5xx one');
ok(/if \(advance\(activeModelRef\)\) \{ attempt = 0; continue; \}[\s\S]{0,700}ladderWaits < LADDER_WAITS_PER_TURN/.test(src),
   'the wait comes AFTER the walk fails, which is the only moment it beats walking');
ok(/Math\.min\(waitMs, LADDER_WAIT_MS\)/.test(src),
   "Google's RetryInfo may only SHORTEN the wait - measured at 57s for a wall that cleared in 10");
ok(/async function waitVisibly\(model, ms\)/.test(src) && /onModelSwitch\.fn\(n > 0 \?/.test(src),
   'the wait is SHOWN on the existing status strip, not hidden behind a spinner');
ok(/if \(freshTurn\(activeModelRef\)\) \{ attempt = 0; continue; \}/.test(src),
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

clearSpent();
S.diagState.resets = 0;

console.log(`\n${pass} passed, ${fail} failed`);
console.log('NOTE: no live key is used — this checks selection logic, not a real tutor turn.');
process.exit(fail ? 1 : 0);
