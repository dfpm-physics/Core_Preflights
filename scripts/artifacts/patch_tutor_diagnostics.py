#!/usr/bin/env python3
r"""
patch_tutor_diagnostics.py -- the 2026-08-25 diagnosability + thinking-budget fix set,
applied to every SHIPPED Gemini backup build under site/gemini/.

WHY THIS SCRIPT AND NOT to_gemini.py. Six of the 44 live builds have NO .jsx source:
phys-110 lessons 10, 12, 14, 15, 16 and 17 were authored as Gemini pages directly, so the
porter cannot regenerate them. All 44 nevertheless share one transport (verified: rawCall,
discoverModel, seatLadder, nextModel, errorMessage and the 404 branch are byte-identical
anchors in 44/44). So the fleet is patched here by byte anchor, and to_gemini.py is updated
in the same commit so the next port does not silently drop any of it.

WHAT IT CHANGES

  1  MODEL_LITE gains gemini-2.5-flash-lite as the new floor   -- 2.5-flash was the OLDEST
     model on the ladder and the last rung on every pool; ending there is fragile, and the
     2.0 line is already shut down.
  2  MAX_TOKENS 8192 -> 32768, plus a thinking budget          -- THE CADET-FACING BUG.
     Gemini 3.x and 2.5 think by default and thinking tokens are charged against
     maxOutputTokens. A long turn spends the whole 8192 on thoughts and returns a candidate
     with finishReason MAX_TOKENS and NO TEXT. callTutor read that as "the model is
     overloaded", marked it spent and walked the ladder. Nothing was overloaded. This is
     the documented signature the 2026-08-21 note recorded and misread: "real INPUT tokens
     and ZERO output tokens".
  3  nextModel() SKIPS spent rungs                             -- it advanced by exactly one
     and could seat a model already known dead, burning 3 retries and ~3.5s of backoff.
  4  resetLadder() -- one bounded re-try of the whole ladder   -- what a cadet discovered by
     hand: "I reloaded and it worked for another minute". A reload clears spentModels
     because it is module scope. Per-minute quota clears, capacity returns, and a model
     that returned one empty answer usually answers the next. Do it in the app instead of
     asking a cadet to find it.
  5  the 404 branch marks the model spent                      -- every other walking path
     did; this one did not, so a dead model was re-seated at every phase change.
  6  a 400 naming the thinking field strips it and retries     -- thinkingBudget is a 2.5-era
     parameter; a Gemini 3 model may reject it. Degrade to the raised token ceiling, which
     carries most of fix 2 on its own, rather than 400-ing every turn.
  7  per-model telemetry                                       -- calls, ok, fail, failure
     kinds, and prompt/thinking/output tokens read out of usageMetadata, which the builds
     received on every response and threw away.
  8  the running model is shown DURING the session             -- it existed only on the
     start screen, so a cadet who stepped down could not say what they were on.
  9  the error bar carries the full diagnostic + a Copy button -- so a screenshot is
     actionable and a cadet can paste the same text into an email.
 10  errors POST to the log-tutor-error edge function          -- fire-and-forget, best
     effort, never blocks the cadet. This is the half that reaches a cadet who gives up and
     never submits, which is exactly the population the course could not see.
 11  the extension turn gets a working Retry                   -- it had none, and it fires
     at the report stage where instructors reported being stuck.

WHAT IT DOES NOT CHANGE -- THE SLUG. `INTERACTION_ID` is load-bearing identity:
`activities.slug` is globally UNIQUE and every student report hangs off that row. This
script asserts byte-equality of the slug line before it writes.

WHAT IT DOES NOT SEND. No conversation text, ever. CORE.md section 3 permits a cadet ID and
bars free-text student writing paired with an identity, so the payload is counters, model
names, HTTP status and token totals -- and the builder of the payload is a whitelist, not a
redactor, so a future field cannot leak prose by being forgotten.

THE HARNESS BLOCK. tests/browser-harness/gemini-model-ladder.mjs lifts the bytes from
`const MODEL_LITE = [` to the end of `function nextModel(ref) {` and runs them under
`new Function`. Everything added inside that range must therefore be declarations only --
no top-level fetch/localStorage/document -- or the harness throws on evaluation.

USAGE
    python scripts/artifacts/patch_tutor_diagnostics.py                 # dry run, all 44
    python scripts/artifacts/patch_tutor_diagnostics.py --course phys-110
    python scripts/artifacts/patch_tutor_diagnostics.py --only lesson-13 --verbose
    python scripts/artifacts/patch_tutor_diagnostics.py --commit

Stdlib only, dry-run by default (CORE.md section 4).
"""

import argparse
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
BUILDS = ROOT / "site" / "gemini"

# Reuse the porter's newline machinery rather than copying it. If these two tools ever
# disagreed about what a line ending is they would corrupt each other's output.
sys.path.insert(0, str(HERE))
from to_gemini import detect_nl  # noqa: E402


LF = bytes([10])
CRLF = bytes([13, 10])


def nlfix(pattern: bytes, nl: bytes) -> bytes:
    """Re-end a LITERAL-TEXT pattern to the file's own line ending.

    NOT to_gemini.adapt(). That one rewrites the four-byte TEXT for CR LF inside a REGEX
    SOURCE and leaves real newlines alone -- right for the porter, and silently wrong
    here. Every anchor below is literal text authored with LF, and the shipped builds are
    CRLF, so adapt() returned each pattern unchanged and every anchor matched zero times.
    It did not corrupt anything; it refused everything, which is the good failure mode.

    detect_nl stays shared: the two tools must never disagree about what a line ending IS,
    only about what they are each rewriting.
    """
    flat = pattern.replace(CRLF, LF)
    return flat if nl == LF else flat.replace(LF, nl)

SUPABASE_URL = "https://shzvpmlnqfmzfmuxkowi.supabase.co"
SUPABASE_ANON = "sb_publishable_wHlVYRPryp7fgByHaDujZw_AXvonsru"


# --- The model block: floor, thinking budget, telemetry, ladder reset ---------------------
# Everything here lands between `const MODEL_LITE = [` and the end of `function nextModel`,
# which is the range gemini-model-ladder.mjs lifts out and runs under `new Function`.
# Declarations only -- no top-level fetch/localStorage/document, or the harness throws.

OLD_LITE = rb'''const MODEL_LITE = [
  "gemini-3.5-flash-lite",    // 15 RPM, 500 RPD
  "gemini-3.1-flash-lite",    // 15 RPM, 500 RPD
  "gemini-2.5-flash",
];'''

NEW_LITE = rb'''const MODEL_LITE = [
  "gemini-3.5-flash-lite",    // 15 RPM, 500 RPD
  "gemini-3.1-flash-lite",    // 15 RPM, 500 RPD
  "gemini-2.5-flash",
  // Added 2026-08-25 as the real floor. Until then every pool ended on gemini-2.5-flash --
  // the OLDEST model on the ladder, and Google has already shut the whole 2.0 line down.
  // Ending on the thing most likely to be retired next is how a ladder dead-ends, and a
  // dead-ended ladder is exactly the "No usable Gemini model was found" cadets reported.
  // flash-lite also carries the higher per-day allowance of the two, which is what a last
  // rung is for.
  "gemini-2.5-flash-lite",
];'''

OLD_MAXTOK = rb'''const MAX_TOKENS = 8192;'''

NEW_MAXTOK = rb'''const MAX_TOKENS = 32768;

// THE THINKING BUDGET -- the fix for the empty answers that emptied the ladder.
//
// Gemini 3.x and 2.5 think before they answer, and thinking tokens are charged against
// maxOutputTokens. At 8192 a long turn could spend the ENTIRE ceiling on thoughts and come
// back with finishReason MAX_TOKENS and no text. callTutor read that as a broken model,
// marked it spent, and stepped down -- so a cadet with thousands of requests still to spend
// walked off the bottom of the ladder in a few turns. The 2026-08-21 note recorded the
// signature exactly ("real INPUT tokens and ZERO output tokens") and read it as capacity.
//
// Capped rather than switched off: a budget of 0 is rejected outright by some models, and a
// little planning measurably helps the one big generation, the report.
const THINKING_BUDGET = 1024;

// thinkingConfig is a 2.5-era parameter and a newer model may reject it. A rejection must
// not 400 every turn for the rest of the session, so the first 400 naming the field clears
// this flag and the raised ceiling above carries most of the fix on its own.
let thinkingSupported = true;
let thinkingBudget = THINKING_BUDGET;

function genConfig() {
  const g = { maxOutputTokens: MAX_TOKENS };
  if (thinkingSupported) g.thinkingConfig = { thinkingBudget: thinkingBudget };
  return g;
}'''

OLD_NEXTMODEL = rb'''function nextModel(ref) {
  const lad = ref.ladder || MODEL_FALLBACKS;
  if (ref.i === undefined) ref.i = Math.max(0, lad.indexOf(ref.current));
  if (ref.i >= lad.length - 1) return false;
  ref.i++;
  ref.current = lad[ref.i];
  if (onModelSwitch.fn) { try { onModelSwitch.fn(ref.current); } catch (e) {} }
  return true;
}'''

NEW_NEXTMODEL = rb'''// --- Per-model telemetry ----------------------------------------------------------------
// Counters, and nothing but counters. They exist so an error can say WHAT was tried and HOW
// OFTEN instead of "something went wrong", and so the same facts can be logged centrally.
//
// There is deliberately nowhere in here to put a message. CORE.md section 3 permits a cadet
// ID and bars free-text student writing paired with an identity, and a fixed set of integers
// cannot leak prose by someone forgetting to redact it.
const modelStats = {};

function statFor(name) {
  return modelStats[name] || (modelStats[name] = {
    calls: 0, ok: 0, fail: 0, promptTok: 0, thoughtTok: 0, outTok: 0, kinds: {},
  });
}
function noteCall(name) { statFor(name).calls++; diagState.model = name; }
function noteOk(name, um) {
  const s = statFor(name);
  s.ok++;
  if (um) {
    s.promptTok  += um.promptTokenCount     || 0;
    s.thoughtTok += um.thoughtsTokenCount   || 0;
    s.outTok     += um.candidatesTokenCount || 0;
  }
}
function noteFail(name, kind) {
  const s = statFor(name);
  s.fail++;
  s.kinds[kind] = (s.kinds[kind] || 0) + 1;
}

// Everything the error panel and the central log need that is not a per-model counter.
// Module scope for the same reason apiKeyRef is: rawCall runs outside the component.
const diagState = { cadet: "", mode: "", phase: "start", turn: 0, startedAt: 0, resets: 0,
                    model: "" };

// A ladder whose every rung is spent is NOT permanently dead. Per-minute quota clears,
// capacity comes back, and a model that returned one empty answer usually answers the next.
// A cadet found this by hand and reported it -- "I reloaded and it worked for another
// minute" -- because a reload clears spentModels, which is module scope and which nothing
// else ever cleared. Do it in the app rather than leaving each cadet to rediscover it.
//
// Bounded, because a genuinely dead key must still terminate instead of looping forever.
const LADDER_RESET_LIMIT = 2;

function resetLadder(ref) {
  if (diagState.resets >= LADDER_RESET_LIMIT) return false;
  diagState.resets++;
  Object.keys(spentModels).forEach((k) => { delete spentModels[k]; });
  Object.keys(waitedFor).forEach((k) => { delete waitedFor[k]; });
  const lad = ref.ladder || MODEL_FALLBACKS;
  ref.i = 0;
  ref.current = lad[0];
  if (onModelSwitch.fn) { try { onModelSwitch.fn(ref.current); } catch (e) {} }
  return true;
}

// The one mover every failure path calls: step down, and when there is nothing below, take
// the bounded whole-ladder retry before declaring the session dead.
function advance(ref) { return nextModel(ref) || resetLadder(ref); }

function nextModel(ref) {
  const lad = ref.ladder || MODEL_FALLBACKS;
  if (ref.i === undefined) ref.i = Math.max(0, lad.indexOf(ref.current));
  // SKIPS SPENT RUNGS. It used to advance by exactly one, so it could seat a model already
  // known dead -- three retries and ~3.5s of backoff spent proving it again, while the cadet
  // watches a spinner. seatLadder always skipped them; this did not, and they disagreed.
  while (ref.i < lad.length - 1) {
    ref.i++;
    if (spentModels[lad[ref.i]]) continue;
    ref.current = lad[ref.i];
    if (onModelSwitch.fn) { try { onModelSwitch.fn(ref.current); } catch (e) {} }
    return true;
  }
  return false;
}'''


# --- Transport: count every call, walk on 404, survive a rejected thinking field -----------

OLD_COUNT = rb'''      const ctl = new AbortController();'''
NEW_COUNT = rb'''      const ctl = new AbortController();
      noteCall(activeModelRef.current);   // counts retries too -- "how many times" is the point'''

OLD_404 = rb'''    if (res.status === 404) {                       // model unavailable -> next rung
      if (nextModel(activeModelRef)) { attempt = 0; continue; }
      throw { kind: "model", status: 404 };
    }'''
NEW_404 = rb'''    if (res.status === 404) {                       // model unavailable -> next rung
      // MARKS IT SPENT, which every other walking path did and this one did not. Without it
      // a model that 404s is re-seated at the top of the next pool and 404s again, at every
      // phase change, for the whole session.
      spentModels[activeModelRef.current] = true;
      noteFail(activeModelRef.current, "model");
      if (advance(activeModelRef)) { attempt = 0; continue; }
      throw { kind: "model", status: 404 };
    }'''

# Must run AFTER the 404 step, which removes the first of the three identical lines.
OLD_ADVANCE = rb'''      if (nextModel(activeModelRef)) { attempt = 0; continue; }'''
NEW_ADVANCE = rb'''      if (advance(activeModelRef)) { attempt = 0; continue; }'''

OLD_TIMEOUT = rb'''        throw { kind: "timeout", status: 0, moved: nextModel(activeModelRef) };'''
NEW_TIMEOUT = rb'''        noteFail(activeModelRef.current, "timeout");
        throw { kind: "timeout", status: 0, moved: advance(activeModelRef) };'''

OLD_400 = rb'''      throw /api[\s_-]?key|credential|unregistered/i.test(msg)
        ? { kind: "auth", status: 400 }
        : { kind: "badrequest", status: 400, detail: msg.slice(0, 300) };'''
NEW_400 = rb'''      // A model that does not accept thinkingConfig must not 400 every turn for the rest of
      // the session. Drop the field from THIS body -- the same object the retry re-sends --
      // and try again; the raised MAX_TOKENS carries most of the thinking fix on its own.
      if (thinkingSupported && /thinking|thought/i.test(msg)) {
        thinkingSupported = false;
        noteFail(activeModelRef.current, "thinking-unsupported");
        if (body && body.generationConfig) delete body.generationConfig.thinkingConfig;
        attempt = 0;
        continue;
      }
      noteFail(activeModelRef.current,
               /api[\s_-]?key|credential|unregistered/i.test(msg) ? "auth" : "badrequest");
      throw /api[\s_-]?key|credential|unregistered/i.test(msg)
        ? { kind: "auth", status: 400 }
        : { kind: "badrequest", status: 400, detail: msg.slice(0, 300) };'''

OLD_AUTH = rb'''    if (res.status === 401 || res.status === 403) {
      throw { kind: "auth", status: res.status };   // missing or unauthorized key
    }'''
NEW_AUTH = rb'''    if (res.status === 401 || res.status === 403) {
      noteFail(activeModelRef.current, "auth");
      throw { kind: "auth", status: res.status };   // missing or unauthorized key
    }'''

# --- callTutor: read usageMetadata, and treat a MAX_TOKENS blank as the thinking bug -------

OLD_GENCFG = rb'''    generationConfig: { maxOutputTokens: MAX_TOKENS },'''
NEW_GENCFG = rb'''    generationConfig: genConfig(),'''

OLD_USAGE = rb'''  const data = await res.json();
  const cand = (data.candidates || [])[0];
  const text = ((cand && cand.content && cand.content.parts) || [])
    .map((p) => p.text || "").join("").trim();
  if (!text) {'''
NEW_USAGE = rb'''  const data = await res.json();
  // usageMetadata rides on EVERY response and every build threw it away. thoughtsTokenCount
  // is the one that matters: it is how much of the output ceiling went on thinking, so a
  // turn near the ceiling with no text is the thinking bug rather than a broken model.
  noteOk(activeModelRef.current, data.usageMetadata);
  const cand = (data.candidates || [])[0];
  const text = ((cand && cand.content && cand.content.parts) || [])
    .map((p) => p.text || "").join("").trim();
  if (!text) {'''

OLD_EMPTY = rb'''    spentModels[activeModelRef.current] = true;
    throw { kind: "empty", status: 0, moved: nextModel(activeModelRef), why: why || "" };'''
NEW_EMPTY = rb'''    // MAX_TOKENS with no text is the THINKING bug, not a broken model: the whole ceiling
    // went on thoughts and there was nothing left to say with. Walking the ladder for a
    // fault every rung shares is what emptied it. Cut the budget and give the SAME model
    // another go -- it is the cheapest fix and it keeps the strong model the cadet is on.
    if (why === "MAX_TOKENS" && thinkingSupported && thinkingBudget > 0) {
      thinkingBudget = 0;
      noteFail(activeModelRef.current, "thinking-overrun");
      return callTutor(activeModelRef, history, sys, note);
    }
    spentModels[activeModelRef.current] = true;
    noteFail(activeModelRef.current, "empty");
    throw { kind: "empty", status: 0, moved: advance(activeModelRef), why: why || "" };'''


# --- Diagnostics snapshot, central log, and the error object every site now builds ---------
# Injected after errorMessage(), which is outside the harness block, so browser APIs are
# fine here as long as they stay inside function bodies.

ANCHOR_AFTER_ERRMSG = rb'''function pacingNote(activeSec, topicCount) {'''

DIAG_BLOCK = rb'''// --- Diagnostics -------------------------------------------------------------------------
// One snapshot of everything an instructor needs in order to act on a stuck cadet, in two
// forms: `text` for the screen, a screenshot and the clipboard, and `obj` for the central
// log. Both are built from the SAME whitelist, so what a cadet can read is exactly what
// gets stored -- there is no second, richer copy going somewhere they cannot see.
function diagSnapshot(err) {
  const models = [];
  Object.keys(modelStats).forEach((n) => {
    const s = modelStats[n];
    models.push({
      model: n, calls: s.calls, ok: s.ok, fail: s.fail,
      prompt_tokens: s.promptTok, thinking_tokens: s.thoughtTok, output_tokens: s.outTok,
      kinds: s.kinds, spent: !!spentModels[n],
    });
  });
  models.sort((a, b) => b.calls - a.calls);
  let ua = "";
  try { ua = String(navigator.userAgent || "").slice(0, 180); } catch (e) {}
  const obj = {
    v: 1,
    slug: INTERACTION_ID,
    cadet_id: diagState.cadet || null,
    at: new Date().toISOString(),
    kind: (err && err.kind) || "unknown",
    http_status: (err && err.status) || 0,
    finish_reason: (err && err.why) || "",
    detail: (err && err.detail) ? String(err.detail).slice(0, 300) : "",
    model: diagState.model || "",
    mode: diagState.mode || "",
    phase: diagState.phase || "",
    turn: diagState.turn || 0,
    session_sec: diagState.startedAt
      ? Math.round((Date.now() - diagState.startedAt) / 1000) : 0,
    ladder_resets: diagState.resets || 0,
    max_tokens: MAX_TOKENS,
    thinking_budget: thinkingSupported ? thinkingBudget : -1,
    models: models,
    ua: ua,
  };
  return { obj: obj, text: diagText(obj) };
}

// Fixed-width so it stays readable in a screenshot, which is how most of these will arrive.
function diagText(o) {
  const pad = (s, n) => (String(s) + "                          ").slice(0, n);
  const k = (v) => (v >= 1000 ? (v / 1000).toFixed(1) + "k" : String(v));
  const lines = [
    "PREP tutor error -- show this to your instructor",
    "lesson  : " + o.slug,
    "cadet   : " + (o.cadet_id || "-"),
    "when    : " + o.at,
    "error   : " + o.kind + "   HTTP " + o.http_status
      + (o.finish_reason ? "   finish=" + o.finish_reason : ""),
    "model   : " + (o.model || "-"),
    "stage   : " + (o.mode || "-") + "/" + (o.phase || "-") + "   turn " + o.turn
      + "   session " + o.session_sec + "s   ladder resets " + o.ladder_resets,
    "budget  : " + o.max_tokens + " tokens, thinking "
      + (o.thinking_budget < 0 ? "not supported" : o.thinking_budget),
  ];
  if (o.detail) lines.push("detail  : " + o.detail);
  lines.push("models tried:");
  if (!o.models.length) lines.push("  (none -- failed before the first request)");
  o.models.forEach((m) => {
    const kinds = Object.keys(m.kinds).map((x) => x + " x" + m.kinds[x]).join(", ");
    lines.push("  " + pad(m.model, 23)
      + " calls " + pad(m.calls, 3) + " ok " + pad(m.ok, 3) + " fail " + pad(m.fail, 3)
      + " tok in/think/out " + k(m.prompt_tokens) + "/" + k(m.thinking_tokens)
      + "/" + k(m.output_tokens)
      + (m.spent ? "  SPENT" : "") + (kinds ? "  [" + kinds + "]" : ""));
  });
  return lines.join("\n");
}

// The central log. Fire-and-forget in the strongest sense: the cadet is already looking at
// one error and a logging failure must never become a second, so every path here swallows.
//
// It reaches the cadets the course could not see before -- the ones who hit an error, give
// up, and never submit, so nothing about their session ever arrives. That population is
// most of the problem, which is why this posts at the moment of failure rather than riding
// home with the report.
//
// The anon key is public by design and protected by RLS, exactly as site/js/config.js is;
// the function it calls is the only writer of app.tutor_error_log.
const LOG_ENDPOINT = "__SUPABASE_URL__/functions/v1/log-tutor-error";
const LOG_ANON = "__SUPABASE_ANON__";
const LOG_STORE = "prep.gemini.errorlog";
const errorLog = [];

function logError(obj) {
  try {
    errorLog.push(obj);
    while (errorLog.length > 20) errorLog.shift();
    try { localStorage.setItem(LOG_STORE, JSON.stringify(errorLog)); } catch (e) {}
  } catch (e) {}
  try {
    fetch(LOG_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": LOG_ANON,
        "Authorization": "Bearer " + LOG_ANON,
      },
      body: JSON.stringify(obj),
      keepalive: true,           // survives the cadet closing the tab in disgust
    }).catch(() => {});
  } catch (e) {}
}

// Every setError site goes through here, so an error cannot reach the screen without also
// being snapshotted and logged. That is the point: the four sites drifted before, and one
// of them (the extension turn) shipped with no Retry at all.
function mkError(err, retryFn) {
  const d = diagSnapshot(err);
  logError(d.obj);
  return {
    kind: err && err.kind,
    text: errorMessage(err, { afterRetries: true }),
    diag: d,
    retry: retryFn || null,
  };
}

function pacingNote(activeSec, topicCount) {'''


# --- UI: the running model, and an error bar you can act on -------------------------------
# These carry non-ASCII (the warning glyph, em dashes), so they are str and encoded at use.

UI_SUBS = [
    # CSS for the status strip and the detail panel.
    ("""  .error-bar { background: #fef2f2; border: 1px solid #fecaca; border-radius: var(--radius-sm);""",
     """  .tutor-status { display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
                  margin: 0 16px 8px; font-size: 12px; color: var(--muted); }
  .tutor-status-model { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .tutor-status-btn { padding: 1px 8px; font-size: 11px; background: var(--white);
                      color: var(--muted); border: 1px solid var(--line);
                      border-radius: var(--radius-sm); cursor: pointer; }
  .error-diag { margin-top: 8px; }
  .error-diag summary { cursor: pointer; font-size: 12px; font-weight: 600; }
  .error-diag-pre { margin: 8px 16px; padding: 10px 12px; background: var(--white);
                    border: 1px solid var(--line); border-radius: var(--radius-sm);
                    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                    font-size: 11px; line-height: 1.5; color: var(--ink);
                    white-space: pre; overflow-x: auto; }
  .error-copy { margin-top: 8px; padding: 2px 10px; font-size: 12px; font-weight: 600;
                background: var(--white); color: #dc2626; border: 1px solid #fecaca;
                border-radius: var(--radius-sm); cursor: pointer; }
  .error-bar { background: #fef2f2; border: 1px solid #fecaca; border-radius: var(--radius-sm);"""),

    # One extra piece of state: whether the cadet has opened the detail panel.
    ("""  const [modelName, setModelName] = useState("");          // shown on the start screen""",
     """  const [modelName, setModelName] = useState("");          // start screen AND status strip
  const [showDiag, setShowDiag] = useState(false);         // connection details, on demand"""),

    # The error bar: same message, plus everything needed to act on it.
    ("""        {error && (
          <div className="error-bar">
            \u26a0 {error.text}
            {error.retry && <button className="error-retry" onClick={error.retry}>Retry</button>}
          </div>
        )}""",
     """        {started && (
          <div className="tutor-status">
            <span className="tutor-status-model">Tutor model: {modelName || "\u2014"}</span>
            <button className="tutor-status-btn" onClick={() => setShowDiag((v) => !v)}>
              {showDiag ? "Hide connection details" : "Connection details"}
            </button>
          </div>
        )}
        {started && showDiag && !error && (
          <pre className="error-diag-pre">{diagSnapshot(null).text}</pre>
        )}

        {error && (
          <div className="error-bar">
            <div>
              \u26a0 {error.text}
              {error.retry &&
                <button className="error-retry" onClick={error.retry}>Retry</button>}
            </div>
            {error.diag && (
              <details className="error-diag" open>
                <summary>Details \u2014 send these to your instructor</summary>
                <pre className="error-diag-pre">{error.diag.text}</pre>
                <button className="error-copy" onClick={() => {
                  try { navigator.clipboard.writeText(error.diag.text); } catch (e) {}
                }}>Copy details</button>
              </details>
            )}
          </div>
        )}"""),
]

# --- Every error now carries its diagnostic, and the one with no Retry gets one ------------

ERROR_SITES = [
    ("""      setError({
        kind: err.kind,
        text: errorMessage(err, { afterRetries: true }),
        retry: () => startRetry(selectedMode, sys, resume || seed),
      });""",
     """      setError(mkError(err, () => startRetry(selectedMode, sys, resume || seed)));"""),

    ("""      setError({
        kind: err.kind,
        text: errorMessage(err, { afterRetries: true }),
        retry: () => startRetry(selectedMode, sys, seed),
      });""",
     """      setError(mkError(err, () => startRetry(selectedMode, sys, seed)));"""),

    ("""      setError({
        kind: err.kind,
        text: errorMessage(err, { afterRetries: true }),
        retry: () => runTurn(history),
      });""",
     """      setError(mkError(err, () => runTurn(history)));"""),

    # The extension turn. It shipped with NO Retry at all, and it fires at the report stage
    # -- which is precisely where instructors reported being stuck with no way forward.
    # extSentRef is cleared first, because the effect guards on it and a Retry that cannot
    # re-enter is a button that lies.
    ("""        setError({ kind: err.kind, text: errorMessage(err, { afterRetries: true }) });""",
     """        setError(mkError(err, () => {
          extSentRef.current = false;
          setError(null);
        }));"""),
]

# --- diagState wiring: who, which mode, which phase, which turn ---------------------------

STATE_SUBS = [
    ("""    if (selectedMode === "graded" && !cadetId.trim()) return;""",
     """    if (selectedMode === "graded" && !cadetId.trim()) return;
    // Identify the session for the error log. Cadet ID only -- never a name (CORE.md s3).
    diagState.cadet = cadetId.trim();
    diagState.mode = selectedMode;
    diagState.phase = "opening";
    diagState.startedAt = Date.now();"""),

    ("""  async function runTurn(history) {""",
     """  async function runTurn(history) {
    diagState.turn++;
    diagState.phase = reportPhaseRef.current ? "report" : "chat";"""),
]


# ------------------------------------------------------------------------------------------


class Refused(Exception):
    """An anchor did not match the expected number of times. Refuse; never guess."""


class Patcher:
    """Byte-level, newline-aware, count-asserting. Same contract as to_gemini.py."""

    def __init__(self, raw, path):
        self.buf = raw
        self.path = path
        self.nl = detect_nl(raw)
        self.applied = []

    def sub(self, label, old, new, count=1, optional=False):
        old_b = nlfix(old, self.nl)
        new_b = nlfix(new, self.nl)
        if new_b in self.buf and old_b not in self.buf:
            self.applied.append(label + " (already)")
            return
        found = self.buf.count(old_b)
        if found != count:
            if optional and found == 0:
                return
            raise Refused(
                "%s: anchor matched %d time(s), expected %d" % (label, found, count))
        self.buf = self.buf.replace(old_b, new_b)
        self.applied.append(label)

    def insert_before(self, label, anchor, block, count=1):
        self.sub(label, anchor, block, count=count)


def enc(s):
    return s.encode("utf-8")


# One step of this set inserts text that CONTAINS its own anchor (noteCall keeps the
# AbortController line; the diagnostics block ends on the pacingNote line it was inserted
# before). Re-running would therefore duplicate them. The whole set lands together, so a
# single sentinel is enough, and is safer than making twelve anchors self-excluding by hand.
FIXSET_MARKER = b"function diagSnapshot("


def apply_fixset(raw):
    """Apply the whole fix set to one build's BYTES and return (bytes, steps).

    Takes bytes rather than a path so to_gemini.py can call it on freshly generated HTML in
    the same operation as the port. That is deliberate: TUTOR-BEHAVIOR-PARITY.md exists
    because nine fixes landed on the shipped builds and none of them reached the generator,
    and a port that silently drops this set looks perfectly healthy while reintroducing the
    exact failure cadets reported.
    """
    if FIXSET_MARKER in raw:
        return raw, ["already"]

    slug_line_before = [l for l in raw.split(LF) if b"const INTERACTION_ID" in l]
    p = Patcher(raw, None)

    # 1-2  the model block
    p.sub("lite-floor", OLD_LITE, NEW_LITE)
    p.sub("thinking-budget", OLD_MAXTOK, NEW_MAXTOK)
    # 3-4  telemetry, ladder reset, spent-skipping nextModel
    p.sub("telemetry+reset+nextModel", OLD_NEXTMODEL, NEW_NEXTMODEL)
    # 5    transport
    p.sub("count-calls", OLD_COUNT, NEW_COUNT)
    p.sub("404-marks-spent", OLD_404, NEW_404)
    p.sub("advance-429-5xx", OLD_ADVANCE, NEW_ADVANCE, count=2)  # after the 404 step
    p.sub("timeout-advance", OLD_TIMEOUT, NEW_TIMEOUT)
    p.sub("400-thinking-strip", OLD_400, NEW_400)
    p.sub("auth-counted", OLD_AUTH, NEW_AUTH)
    # 6    callTutor
    p.sub("genConfig", OLD_GENCFG, NEW_GENCFG)
    p.sub("usage-metadata", OLD_USAGE, NEW_USAGE)
    p.sub("max-tokens-retry", OLD_EMPTY, NEW_EMPTY)
    # 7    diagnostics + central log
    diag = DIAG_BLOCK.replace(b"__SUPABASE_URL__", enc(SUPABASE_URL)) \
                     .replace(b"__SUPABASE_ANON__", enc(SUPABASE_ANON))
    p.insert_before("diagnostics+log", ANCHOR_AFTER_ERRMSG, diag)
    # 8    UI
    for i, (old, new) in enumerate(UI_SUBS):
        p.sub("ui-%d" % (i + 1), enc(old), enc(new))
    # 9    every error carries its diagnostic
    for i, (old, new) in enumerate(ERROR_SITES):
        p.sub("error-site-%d" % (i + 1), enc(old), enc(new))
    # 10   who / which mode / which phase / which turn
    for i, (old, new) in enumerate(STATE_SUBS):
        p.sub("diagstate-%d" % (i + 1), enc(old), enc(new))

    # THE SLUG IS IDENTITY. app.activities.slug is globally UNIQUE and every student report
    # hangs off that row, so a changed slug orphans the work of every cadet who has already
    # finished -- silently, because the new row looks perfectly healthy.
    slug_line_after = [l for l in p.buf.split(LF) if b"const INTERACTION_ID" in l]
    if slug_line_before != slug_line_after:
        raise Refused("INTERACTION_ID changed -- refusing to write")

    return p.buf, p.applied


# --- SET 2: the 2026-08-25 Socratic-quality + native-error fix set -------------------------
# Its own sentinel, because set 1 was already applied to all 44 builds before this existed.

SOCRATIC_MARKER = b"ONE QUESTION ONLY"

# 1. THE THINKING BUDGET WAS CUT TOO FAR.
#
# Set 1 capped thinking at 1024 to stop thoughts eating the whole answer. That fixed the blank
# answers and cost teaching quality: the course director read a real transcript the same day
# and the tutor had lectured, handed over the derivation the cadet should have produced, and
# closed with two stacked questions. The diagnostic panel showed ~800 thinking tokens across
# three turns -- about 270 a turn.
#
# Choosing the single best next question IS the reasoning-heavy part of Socratic tutoring; it
# is the thing the 2026-08-21 note identified when a lite model "would try to tutor me and
# then give me the answer instead". Starving it buys nothing here, because the ORIGINAL bug
# was a total ceiling of 8192, and that ceiling is now 32768. There is room for both.
OLD_THINK = rb"""const THINKING_BUDGET = 1024;"""
NEW_THINK = rb"""const THINKING_BUDGET = 8192;"""

# 2. THE ONE-QUESTION RULE IS 127,000 CHARACTERS INTO THE PROMPT AND NOTHING REPEATS IT.
#
# The system prompt says ASK ONE QUESTION AT A TIME, in those words, and says "do not lecture"
# ten thousand characters later. Both are real and both are buried. Meanwhile pacingNote is
# re-injected into the LAST USER TURN on every single turn -- so the model gets a fresh
# reminder about the clock every turn and a fresh reminder about how to teach never.
#
# Recency is doing the teaching. This puts the two rules that define the exercise where the
# reminder actually lands. Deliberately three short clauses: this rides on every turn, and a
# per-turn note that grows into a second prompt starts competing with the first one.
OLD_PACING = rb"""    + `back-and-forth and pauses about 5 seconds after typing stops.]`;"""
NEW_PACING = rb"""    + `back-and-forth and pauses about 5 seconds after typing stops.`
    + `

ONE QUESTION ONLY this turn. Ask a single question and stop; do not stack a second `
    + `one, and do not append "and what does that let you do with...". Do not explain, derive, `
    + `or state the result you are about to ask them for -- if you have written the answer, the `
    + `question is already spent. Their reply tells you the next question; a gap they show you `
    + `is worth more than a step you hand them.]`;"""

# 3. A NATIVE ERROR ARRIVED AS "unknown" WITH NOTHING ATTACHED.
#
# The same transcript logged `kind: unknown, HTTP 0` with fail 0 on every model -- an error
# that never came from Gemini, so nothing in the transport typed it. diagSnapshot then read
# `.kind`, `.status`, `.detail` off a native Error, found none of them, and stored "unknown".
#
# That is the diagnostic failing at its own job: the one error it could not explain is the one
# it discarded the evidence for. A native Error carries `name` and `message`; keep them.
OLD_DIAGKIND = rb"""    detail: (err && err.detail) ? String(err.detail).slice(0, 300) : "","""
NEW_DIAGKIND = rb"""    // A THROW FROM OUTSIDE THE TRANSPORT has no .kind and no .detail -- a JSON parse that
    // failed on a 200, a bug in our own post-processing. It logged as "unknown" with nothing
    // attached, which is the one case the panel most needed to explain. Keep what a native
    // Error does carry.
    detail: (err && err.detail) ? String(err.detail).slice(0, 300)
          : (err && (err.message || err.name))
            ? String((err.name || "Error") + ": " + (err.message || "")).slice(0, 300)
            : "","""


def apply_socratic(raw):
    """Set 2. Separate sentinel because set 1 shipped to all 44 builds before this existed."""
    if SOCRATIC_MARKER in raw:
        return raw, ["already"]
    p = Patcher(raw, None)
    p.sub("thinking-budget-8192", OLD_THINK, NEW_THINK)
    p.sub("per-turn-one-question", OLD_PACING, NEW_PACING)
    p.sub("native-error-detail", OLD_DIAGKIND, NEW_DIAGKIND)
    return p.buf, p.applied


# --- SET 3: speak the cadet's notation, and never re-send the same question ----------------
# Its own sentinel again, because sets 1 and 2 had already shipped to all 44 builds.
#
# THE TRANSCRIPT THAT PROMPTED IT (phys-215 lesson 08, 2026-08-25). Set 2 worked -- one
# question a turn, no lecture, no handing over the derivation. Then the cadet spent FOUR
# consecutive turns correcting notation rather than answering:
#
#     tutor: ...inside the flux integral  E . nhat dA ?
#     cadet: what is n-hat?
#     cadet: our text uses r-hat
#     cadet: dA is a vector in our textbook
#     cadet: that is not how our text writes it. E.dA = EdA cos theta
#
# Two separate faults, and only the second one is the tutor's judgment.
#
# 1. NOTATION. The tutor was not hallucinating -- it was reading its grounding faithfully.
#    TEXTBOOK_REFERENCE for this lesson writes the flux integrand as `E . nhat dA`, and uses
#    `nhat` 19 times and `rhat` 21 times across 38,327 characters. It contains the string
#    `cos` ZERO times, and no vector dA and no closed-integral sign anywhere. So the
#    `E.dA = EdA cos theta` form the cadet actually reads cannot be produced from it. The
#    grounding is an ASCII paraphrase of the source (eps0, 4*pi*eps0), and the paraphrase
#    silently chose a notation.
#
#    Fixing the grounding is the real repair and it is 44 rebuilds and a decision about which
#    book is authoritative. This is the cheap half that works today on every lesson and every
#    course: when a cadet shows you their notation, switch to it. Their book outranks ours --
#    they are being graded on theirs.
#
# 2. THE LOOP. Having answered each correction in one line, the tutor re-sent the SAME
#    question VERBATIM five times. Nothing in the ~137,000-character prompt forbids that, and
#    set 2's note actively encouraged the shape of it: "their reply tells you the next
#    question" is true, and says nothing about a reply that is not an answer at all. A cadet
#    who asks "what is n-hat?" is not refusing the question; they are blocked before it.

NOTATION_MARKER = b"adopt their notation"

OLD_PACING2 = rb"""    + `is worth more than a step you hand them.]`;"""
NEW_PACING2 = rb"""    + `is worth more than a step you hand them. If their reply was a CORRECTION or a `
    + `QUESTION rather than an answer, answer it in one line, adopt their notation and symbols `
    + `for the rest of the session -- their textbook outranks the reference you were given, `
    + `because they are graded on theirs -- and then ask a DIFFERENT, smaller question. Never `
    + `re-send a question you have already asked; if they did not answer it, it was the wrong `
    + `question or they are blocked before it.]`;"""


def apply_notation(raw):
    """Set 3. Separate sentinel: sets 1 and 2 shipped to all 44 before this existed."""
    if NOTATION_MARKER in raw:
        return raw, ["already"]
    p = Patcher(raw, None)
    p.sub("notation-and-no-repeat", OLD_PACING2, NEW_PACING2)
    return p.buf, p.applied


def patch_one(path, verbose=False):
    raw = path.read_bytes()
    buf, applied = apply_fixset(raw)
    buf, applied2 = apply_socratic(buf)
    buf, applied3 = apply_notation(buf)
    applied = applied + applied2 + applied3
    if verbose:
        for a in applied:
            print("      . " + a)
    return buf, buf != raw, applied


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--course", help="phys-110 | phys-215 | phys-310")
    ap.add_argument("--only", help="substring of the build filename")
    ap.add_argument("--commit", action="store_true", help="write; otherwise dry run")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    courses = [args.course] if args.course else sorted(
        d.name for d in BUILDS.iterdir() if d.is_dir())

    total = written = refused = 0
    for course in courses:
        cdir = BUILDS / course
        if not cdir.is_dir():
            print("no such course dir: %s" % cdir)
            return 2
        builds = sorted(cdir.glob("*.html"))
        if args.only:
            builds = [b for b in builds if args.only in b.name]
        if not builds:
            continue
        print("\n=== %s: %d build(s) ===" % (course, len(builds)))
        for b in builds:
            total += 1
            try:
                buf, changed, applied = patch_one(b, verbose=args.verbose)
            except Refused as e:
                refused += 1
                print("  REFUSED  %-62s %s" % (b.name[:62], e))
                continue
            if not changed:
                print("  current  %s" % b.name[:70])
                continue
            if args.commit:
                b.write_bytes(buf)
                written += 1
                print("  write    %-62s %d step(s)" % (b.name[:62], len(applied)))
            else:
                print("  WOULD    %-62s %d step(s)" % (b.name[:62], len(applied)))

    print("\n%d build(s) | %d written | %d refused" % (total, written, refused))
    if refused:
        print("REFUSED builds were left untouched. Fix the anchor, do not force.")
        return 1
    if not args.commit:
        print("dry run - nothing written. Re-run with --commit.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
