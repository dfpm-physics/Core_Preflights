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


# --- SET 4: the log could not name the cadet it was logging --------------------------------
# Own sentinel again; sets 1-3 had already shipped.
#
# The backup lesson page asks for a LAST NAME -- "Enter your last name so your instructor can
# match this report to you" -- and holds it in a state variable called `cadetId`, whose own
# comment reads "holds the last name; do NOT rename". Set 1 read that variable and sent it as
# `cadet_id`, which the edge function parses by stripping non-digits. A surname parses to NaN
# and stores as NULL.
#
# So every row logged since the feature shipped is anonymous, which is the single thing the
# feature existed to prevent. Nothing errored: `cadet_id` is nullable, NULL is what a genuine
# pre-sign-in error looks like, and the ON-SCREEN panel showed the name correctly the whole
# time -- so a cadet's screenshot was attributable while the server's copy of the same event
# was not. Found by reading a cadet's screenshot, not by any check.
#
# `cadet_ref` (migration app/022) keeps what was typed. The panel line is relabelled to match,
# because "cadet: Wierzbanowski" under a heading of `cadet_id` is what made this invisible.

CADETREF_MARKER = b"cadet_ref: diagState.cadet"

OLD_SENDID = rb"""    cadet_id: diagState.cadet || null,"""
NEW_SENDID = rb"""    // TWO CLAIMS, not one. This surface collects a last name; a numeric ID would go in
    // cadet_id, and sending the name there stored NULL for every row until 2026-08-25.
    cadet_id: null,
    cadet_ref: diagState.cadet || null,"""

OLD_PANELID = rb"""    "cadet   : " + (o.cadet_id || "-"),"""
NEW_PANELID = rb"""    "cadet   : " + (o.cadet_ref || o.cadet_id || "-"),"""


def apply_cadet_ref(raw):
    """Set 4. Separate sentinel: sets 1-3 shipped to all 44 before this existed."""
    if CADETREF_MARKER in raw:
        return raw, ["already"]
    p = Patcher(raw, None)
    p.sub("send-cadet-ref", OLD_SENDID, NEW_SENDID)
    p.sub("panel-cadet-ref", OLD_PANELID, NEW_PANELID)
    return p.buf, p.applied



# ═══════════════════════════════════════════════════════════════════════════════════════════
# SET 5 -- 2026-08-25 evening. The ladder ended on a model that does not exist, and the two
# branches that end most sessions recorded no failure at all.
#
# THE EVIDENCE, from the error log's first six minutes of life (30 rows, 01:06-01:12 UTC):
#
#   * ALL 30 terminal errors are `kind=model http=404 model=gemini-2.5-flash-lite`, each
#     after ladder_resets=2 -- i.e. the whole ladder walked three times over. `kind: model`
#     is thrown ONLY from the 404 branch, so that is a real HTTP 404 from Google, not an
#     exhaustion symptom. gemini-2.5-flash 404s beside it (kinds {model: 3} in the same row).
#   * Two of the 30 died at phase=report. One was turn 22, session_sec 1061 -- an eighteen
#     minute conversation the cadet finished and could not submit. That is the instructor
#     report ("they complete it and it never reaches PREP") in one row.
#   * Across the last 400 stored Gemini reports, `content->>'model'` shows gemini-3.6-flash
#     375, gemini-3.5-flash-lite 12, gemini-3.5-flash 6, gemini-3.1-flash-lite 4,
#     gemini-2.5-flash ONE, gemini-2.5-flash-lite ZERO. The 2.5 line has produced one usable
#     report in the fleet's life and 404s otherwise.
#
# discoverModel() does not save us here: the key's ListModels call HAPPILY LISTS these two
# with generateContent support, and :generateContent then answers 404. A listing is not an
# entitlement. That is why the names have to come out of the source list.
#
# 5a  DROP THE 2.5 LINE.  It cost nothing to carry while it merely never won; it costs a
#     cadet the whole session now that it 404s, because it is the LAST rung and therefore
#     the kind reported when the ladder ends.
#
# 5b/5c  429 AND 5xx NOW RECORD A FAILURE KIND.  Both branches marked the model spent and
#     walked without ever calling noteFail, so a rung burned by quota showed up in the log as
#     `calls: 12, ok: 0, fail: 0, kinds: {}` -- twelve requests and no account of any of them.
#     Every rung above the 2.5 line in those 30 rows looks exactly like that, so the log could
#     not say whether the cadets were rate-limited or whether Google was refusing capacity.
#     Two counters, and tonight's next thirty rows answer it.
#
# WHAT THIS FIXES AND WHAT IT DOES NOT.  It does not conjure a rung for a cadet whose key is
# out of quota. What it does is stop LYING to them: with the dead floor gone the ladder now
# ends on gemini-3.1-flash-lite, so an exhausted session throws `quota` and the cadet is told
# "wait and Retry" instead of "No usable Gemini model was found for this key. Tell your
# instructor" -- a dead end that sends a cadet with a working key to go find a person.

OLD_LITE5 = rb'''const MODEL_LITE = [
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

NEW_LITE5 = rb'''const MODEL_LITE = [
  "gemini-3.5-flash-lite",    // 15 RPM, 500 RPD
  "gemini-3.1-flash-lite",    // 15 RPM, 500 RPD
  // THE 2.5 LINE IS GONE -- removed 2026-08-25 on evidence, not on principle.
  //
  // gemini-2.5-flash-lite was added as "the real floor" that same morning and every one of
  // the error log's first 30 rows ends on it with HTTP 404. gemini-2.5-flash 404s beside it.
  // Both are LISTED by ListModels for the cadets' keys and both refuse :generateContent, so
  // discoverModel() cannot filter them out -- a listing is not an entitlement.
  //
  // They were also not earning their place. Over the last 400 stored reports the 2.5 line
  // produced exactly ONE, against 375 from gemini-3.6-flash. A rung that wins once in 400
  // and 404s the rest of the time is not a safety net; it is the kind the cadet is shown
  // when the ladder ends, and "No usable Gemini model was found for this key" sent cadets
  // with perfectly good keys to go find an instructor.
  //
  // The floor is now gemini-3.1-flash-lite, which answers. An exhausted ladder therefore
  // reports `quota` -- which is what is actually happening above it. Before adding any rung
  // back, check content->>'model' across recent reports: a model that has never produced one
  // is a liability at the bottom of the ladder, not insurance.
];'''

OLD_429TAIL = rb'''      if (attempt < retries) { await sleep(backoffMs(attempt)); attempt++; continue; }
      spentModels[activeModelRef.current] = true;
      if (advance(activeModelRef)) { attempt = 0; continue; }
      throw { kind: "quota", status: 429 };'''

NEW_429TAIL = rb'''      if (attempt < retries) { await sleep(backoffMs(attempt)); attempt++; continue; }
      // RECORD IT. This branch marked the model spent and walked without ever calling
      // noteFail, so a rung burned by quota reached the log as `calls: 12, ok: 0, fail: 0,
      // kinds: {}` -- twelve requests and no account of one of them. Every rung above the
      // floor in the 2026-08-25 rows looks like that, which is why those rows cannot say
      // whether the cadet was rate-limited or Google was refusing.
      noteFail(activeModelRef.current, "quota");
      spentModels[activeModelRef.current] = true;
      if (advance(activeModelRef)) { attempt = 0; continue; }
      throw { kind: "quota", status: 429 };'''

OLD_5XXTAIL = rb'''      if (attempt < retries) { await sleep(backoffMs(attempt)); attempt++; continue; }
      spentModels[activeModelRef.current] = true;
      if (advance(activeModelRef)) { attempt = 0; continue; }
      throw { kind: "capacity", status: res.status };'''

NEW_5XXTAIL = rb'''      if (attempt < retries) { await sleep(backoffMs(attempt)); attempt++; continue; }
      noteFail(activeModelRef.current, "capacity");   // see the note in the 429 branch
      spentModels[activeModelRef.current] = true;
      if (advance(activeModelRef)) { attempt = 0; continue; }
      throw { kind: "capacity", status: res.status };'''

# Sentinel. 5a rewrites its own anchor away, but 5b/5c do not, so this set needs one marker
# that only lands once all three have.
LADDER5_MARKER = b'THE 2.5 LINE IS GONE'


def apply_ladder_floor(raw):
    """Set 5. Drop the two 404ing 2.5 rungs; make 429 and 5xx record a failure kind."""
    if LADDER5_MARKER in raw:
        return raw, ["already"]
    p = Patcher(raw, None)
    p.sub("drop-2.5-line", OLD_LITE5, NEW_LITE5)
    p.sub("notefail-quota", OLD_429TAIL, NEW_429TAIL)
    p.sub("notefail-capacity", OLD_5XXTAIL, NEW_5XXTAIL)
    return p.buf, p.applied


# ═══════════════════════════════════════════════════════════════════════════════════════════
# SET 6 -- 2026-08-25, late. ONE FAILING TURN BURNED THE WHOLE LADDER IN TWENTY SECONDS.
#
# Set 5 removed a 404ing floor and read the rungs above it as "used up by quota". The course
# director rejected that on arithmetic -- the lite rungs carry ~500 requests/day and a session
# is 10-14 requests, so a cadet cannot reach them by spending. That objection is what found
# this, and set 5's reading of the rungs above the floor was wrong.
#
# WHAT THE 75 ERROR ROWS ACTUALLY SAY, summed per model across every row:
#
#     model                  calls     ok   fail   spent   kinds
#     gemini-3.6-flash        1269    284      0   75/75   {}
#     gemini-3.5-flash        1005     28      0   75/75   {}
#     gemini-3.5-flash-lite    948     46      0   75/75   {}
#     gemini-3.1-flash-lite    924      0      0   75/75   {}
#     gemini-2.5-flash-lite    471      0    471   75/75   {model: 471}
#     gemini-2.5-flash         225      0    225   75/75   {model: 225}
#
# gemini-3.6-flash ANSWERED 284 TIMES and was still marked spent in all 75 sessions. A model
# that is answering is not out of quota. The per-session call totals are the giveaway: 60, 61,
# 58, 61, 62 API calls -- to reach TURN 5. 81 calls by turn 22.
#
# THE ARITHMETIC. rawCall retried a 429 or a 5xx THREE times (0.5s / 1s / 2s) before walking,
# so one bad response cost 4 calls in ~3.5s on that rung. Six rungs = 24 calls in ~21 seconds,
# and resetLadder ran that twice more: 72. The observed 58-81 is exactly this, and all of it
# happens INSIDE A SINGLE TURN. Nothing about it is a daily budget.
#
# THE HALF THAT MADE IT PERMANENT. `spentModels` is module scope and only resetLadder ever
# cleared it -- twice per page load, then never again. seatLadder walks past every spent rung
# to the LAST one. So from the first failing turn onward the cadet was pinned to the bottom
# rung for the rest of the session, and until set 5 the bottom rung was a guaranteed 404. That
# is the whole reported symptom: a session that works, one bad turn, then "No usable Gemini
# model was found for this key" forever after -- with 284 good answers' worth of model sitting
# unused at the top of the ladder.
#
# 6a  A SPENT MODEL RECORDS WHY.  `spentModels[name]` becomes the failure kind instead of
#     `true`. Truthiness is unchanged, so every existing check and the diag snapshot keep
#     working, and the harness's `= true` fixtures still read as spent.
#
# 6b  TRANSIENT SPEND IS REVIVED AT THE START OF EVERY TURN (`freshTurn`).  quota, capacity,
#     timeout and empty all pass on their own; a 404 does not, and is deliberately KEPT --
#     re-seating a model Google says does not exist is pure waste. `resetLadder` now uses the
#     same rule and REFUSES when nothing is revivable, so a genuinely dead key stops instead
#     of walking a ladder of 404s twice more to prove it.
#
# 6c  THE BLIND RETRY ON A WALKABLE FAILURE DROPS FROM 3 TO 1 (`WALK_RETRIES`).  Retrying the
#     same model 0.5s after a per-minute 429 is close to useless -- that window is a minute --
#     and a 503 is per-model, so stepping down beats trying again. Two calls per rung instead
#     of four halves the storm. The NETWORK path keeps all three: a dropped connection really
#     does come back, and it neither marks spent nor walks.
#
# WHAT IS STILL UNKNOWN, and this set says so rather than implying otherwise: whether the
# trigger is a 429 or a 5xx. All 75 rows predate set 5's noteFail counters, carry no Google
# message and no per-model status. The next burst will say, and the two want opposite
# handling -- so this set reduces SELF-INFLICTED load rather than tuning a response to a cause
# nobody has confirmed.

OLD_SPENT_ABORT = rb"""      if (e && e.name === "AbortError") {
        spentModels[activeModelRef.current] = true;"""
NEW_SPENT_ABORT = rb"""      if (e && e.name === "AbortError") {
        spentModels[activeModelRef.current] = "timeout";"""

OLD_SPENT_404 = rb"""      spentModels[activeModelRef.current] = true;
      noteFail(activeModelRef.current, "model");"""
NEW_SPENT_404 = rb"""      // THE ONE PERMANENT SPEND. freshTurn() and resetLadder() revive every other kind and
      // deliberately keep this one: a model Google says does not exist will not exist next
      // turn either, and re-seating it costs the cadet a rung and a round trip every time.
      spentModels[activeModelRef.current] = "model";
      noteFail(activeModelRef.current, "model");"""

OLD_SPENT_QUOTA = rb"""      noteFail(activeModelRef.current, "quota");
      spentModels[activeModelRef.current] = true;"""
NEW_SPENT_QUOTA = rb"""      noteFail(activeModelRef.current, "quota");
      spentModels[activeModelRef.current] = "quota";"""

OLD_SPENT_CAP = rb"""      noteFail(activeModelRef.current, "capacity");   // see the note in the 429 branch
      spentModels[activeModelRef.current] = true;"""
NEW_SPENT_CAP = rb"""      noteFail(activeModelRef.current, "capacity");   // see the note in the 429 branch
      spentModels[activeModelRef.current] = "capacity";"""

OLD_SPENT_EMPTY = rb"""    spentModels[activeModelRef.current] = true;
    noteFail(activeModelRef.current, "empty");"""
NEW_SPENT_EMPTY = rb"""    spentModels[activeModelRef.current] = "empty";
    noteFail(activeModelRef.current, "empty");"""

OLD_RESET = rb"""function resetLadder(ref) {
  if (diagState.resets >= LADDER_RESET_LIMIT) return false;
  diagState.resets++;
  Object.keys(spentModels).forEach((k) => { delete spentModels[k]; });
  Object.keys(waitedFor).forEach((k) => { delete waitedFor[k]; });
  const lad = ref.ladder || MODEL_FALLBACKS;
  ref.i = 0;
  ref.current = lad[0];
  if (onModelSwitch.fn) { try { onModelSwitch.fn(ref.current); } catch (e) {} }
  return true;
}"""

NEW_RESET = rb"""// Clears every spend that is going to pass on its own and KEEPS the ones that are not.
// A 404 is the only permanent kind: quota clears on Google's clock, capacity comes back, a
// timeout was one slow request, and an empty answer is usually not repeated. Returns how many
// rungs came back, so a caller can tell "nothing to revive" from "revived nothing useful".
//
// `= true` still counts as revivable. The harness marks rungs that way and so did every build
// before 2026-08-25; treating an unlabelled spend as transient is the safe direction, because
// the cost of reviving a dead rung is one round trip and the cost of keeping a live one is
// the rest of the cadet's session.
function reviveSpent() {
  let revived = 0;
  Object.keys(spentModels).forEach((k) => {
    if (spentModels[k] !== "model") { delete spentModels[k]; revived++; }
  });
  Object.keys(waitedFor).forEach((k) => { delete waitedFor[k]; });
  return revived;
}

// Called once at the top of every turn. THIS IS THE FIX FOR THE PINNED SESSION.
//
// spentModels is module scope and only resetLadder ever cleared it -- twice per page load,
// then never again. seatLadder walks past every spent rung to the LAST one, so after the
// first failing turn a cadet was seated on the bottom rung for the rest of the session while
// gemini-3.6-flash -- which answered 284 times across the logged sessions -- sat unused at
// the top. A rung burned by a per-minute limit on turn 4 has no business still being burned
// on turn 12.
//
// It does NOT touch diagState.resets. That bound is what stops a genuinely dead key looping,
// and this function removes the need to spend it rather than refilling it.
function freshTurn(ref) {
  const revived = reviveSpent();
  if (!revived || !ref || !ref.ladder) return revived;
  // Clearing the set is not enough on its own: activeModelRef.current still points at the
  // rung the last turn walked down to, and nothing re-seats it until a phase change.
  ref.i = 0;
  seatLadder(ref, ref.ladder);
  if (onModelSwitch.fn) { try { onModelSwitch.fn(ref.current); } catch (e) {} }
  return revived;
}

function resetLadder(ref) {
  if (diagState.resets >= LADDER_RESET_LIMIT) return false;
  // REFUSES when every remaining rung is a 404. The old version deleted the whole set, so a
  // key that could reach nothing walked a ladder of 404s twice more to rediscover it, at a
  // round trip a rung, while the cadet watched a spinner.
  const revived = reviveSpent();
  if (!revived) return false;
  diagState.resets++;
  const lad = ref.ladder || MODEL_FALLBACKS;
  ref.i = 0;
  while (ref.i < lad.length - 1 && spentModels[lad[ref.i]]) ref.i++;
  ref.current = lad[ref.i];
  if (onModelSwitch.fn) { try { onModelSwitch.fn(ref.current); } catch (e) {} }
  return true;
}"""

OLD_RESETLIMIT = rb"""const LADDER_RESET_LIMIT = 2;"""
NEW_RESETLIMIT = rb"""const LADDER_RESET_LIMIT = 2;

// Blind retries before a WALKABLE failure gives up on its rung. This was the shared
// `retries = 3`, which meant one 429 cost four calls in ~3.5s on that model, six rungs cost
// 24 in ~21s, and resetLadder ran it twice more -- 72 calls, inside a single turn. That is
// what the logged sessions show: 60, 61, 58, 61, 62 calls to reach turn 5.
//
// Retrying half a second after a PER-MINUTE 429 cannot succeed; that window is a minute. A
// 5xx is per-model, so the next rung is a better bet than the same one. One retry still
// covers a genuinely flaky single response and halves the storm.
//
// The NETWORK path deliberately keeps all three: a dropped connection really does come back,
// and that path neither marks the model spent nor walks the ladder.
const WALK_RETRIES = 1;"""

OLD_429RETRY = rb"""      if (attempt < retries) { await sleep(backoffMs(attempt)); attempt++; continue; }
      // RECORD IT."""
NEW_429RETRY = rb"""      if (attempt < WALK_RETRIES) { await sleep(backoffMs(attempt)); attempt++; continue; }
      // RECORD IT."""

OLD_5XXRETRY = rb"""      if (attempt < retries) { await sleep(backoffMs(attempt)); attempt++; continue; }
      noteFail(activeModelRef.current, "capacity");"""
NEW_5XXRETRY = rb"""      if (attempt < WALK_RETRIES) { await sleep(backoffMs(attempt)); attempt++; continue; }
      noteFail(activeModelRef.current, "capacity");"""

OLD_RUNTURN = rb"""  async function runTurn(history) {
    diagState.turn++;"""
NEW_RUNTURN = rb"""  async function runTurn(history) {
    diagState.turn++;
    // Give back every rung that was spent on something transient. Without this, one bad turn
    // pinned the whole session to the bottom of the ladder -- see freshTurn().
    freshTurn(activeModelRef);"""

LADDER6_MARKER = b"function freshTurn(ref)"


def apply_turn_revive(raw):
    """Set 6. Spend records a reason; transient spends revive each turn; walk sooner."""
    if LADDER6_MARKER in raw:
        return raw, ["already"]
    p = Patcher(raw, None)
    p.sub("spent-reason-abort", OLD_SPENT_ABORT, NEW_SPENT_ABORT)
    p.sub("spent-reason-404", OLD_SPENT_404, NEW_SPENT_404)
    p.sub("spent-reason-quota", OLD_SPENT_QUOTA, NEW_SPENT_QUOTA)
    p.sub("spent-reason-capacity", OLD_SPENT_CAP, NEW_SPENT_CAP)
    p.sub("spent-reason-empty", OLD_SPENT_EMPTY, NEW_SPENT_EMPTY)
    p.sub("walk-retries-const", OLD_RESETLIMIT, NEW_RESETLIMIT)
    p.sub("revive-and-reset", OLD_RESET, NEW_RESET)
    p.sub("walk-retries-429", OLD_429RETRY, NEW_429RETRY)
    p.sub("walk-retries-5xx", OLD_5XXRETRY, NEW_5XXRETRY)
    p.sub("fresh-turn-hook", OLD_RUNTURN, NEW_RUNTURN)
    return p.buf, p.applied


# --- SET 7: a rate limit asks you to WAIT, and this transport answered by going faster ----
#
# THIS SET IS THE FIRST ONE IN THIS FILE BUILT ON MEASUREMENT RATHER THAN ON ARITHMETIC.
# Sets 4 and 5 each proposed a cause that the course director overturned by doing sums the
# build could have done for itself. Rather than propose a third, the failing evidence was used
# to write a probe -- tests/browser/test-gemini-rate-limits.html -- and it was run against a
# live free-tier key on 2026-08-26. Every number below is from that run.
#
# THE EVIDENCE THAT STARTED IT. A live-key tutor turn, one cadet, 29 seconds:
#
#   gemini-3.6-flash        calls 6   ok 0   fail 3   tok 0/0/0   SPENT  [quota x3]
#   gemini-3.5-flash        calls 6   ok 0   fail 3   tok 0/0/0   SPENT  [quota x3]
#   gemini-3.5-flash-lite   calls 6   ok 0   fail 3   tok 0/0/0   SPENT  [quota x3]
#   gemini-3.1-flash-lite   calls 6   ok 0   fail 3   tok 0/0/0   SPENT  [quota x3]
#   stage: graded/chat  turn 1  session 29s  ladder resets 2
#
# 4 rungs x (WALK_RETRIES + 1) calls x 3 passes = 24 requests on TURN ONE. `tok 0/0/0` says
# nothing was generated anywhere, so this is not set 5's thinking bug and not a token cap.
#
# WHAT THE PROBE MEASURED, and what each number overturned:
#
#   quota id     GenerateRequestsPerMinutePerProjectPerModel-FreeTier
#   dimensions   {"model": "gemini-3.5-flash-lite", "location": "global"}
#
#     Per PROJECT and per MODEL. Google's docs say rate limits are applied per project rather
#     than per API key, which is true and was read as "one shared ceiling across models". It
#     is not: the quota is scoped to a (project, model) pair. Both readings were half right.
#
#   blast radius   gemini-3.1-flash-lite answered HTTP 200 while gemini-3.5-flash-lite refused
#
#     THE DECISIVE RESULT, and it says the ladder is RIGHT. The next rung carries its own
#     allowance, so walking is the correct response to a 429 -- which kills the project-level
#     worry outright and with it the inter-rung gap an earlier draft of this set shipped.
#     What is wrong is retrying the SAME rung first.
#
#   the wall       15 requests answered, the 16th refused -- exactly the documented 15/min
#   recovery       20.6 seconds
#   RetryInfo      8s on a wall still standing 11s later; then 57s on one that cleared in 10s
#
#     So Google's own number is unreliable in BOTH directions and must not be waited out
#     literally. An earlier draft of this set raised the honoured ceiling to 65s on the
#     reasoning that a per-minute window is sixty seconds. Correct arithmetic, wrong answer:
#     it would hold a cadet 57 seconds to clear a ten-second wall.
#
# WHY THE CADET'S SESSION DIED, now that the caps are known:
#
#   Flash is 5/min. The old walk sent 6 per model per turn. ONE turn breaks Flash.
#   Lite is 15/min. The old walk sent 6 per model per turn -- fine once, and the error block
#   says the cadet "kept cycling", so three attempts inside a minute is 18 against a cap of
#   15. Both tiers were self-inflicted; only the arithmetic differed.
#
# 7a  A 429 DOES NOT RETRY ITS RUNG (`QUOTA_WALK_RETRIES = 0`).  It walks immediately. The
#     probe proved the neighbour answers, and a per-minute window cannot clear in the 500ms
#     the old backoff waited. This is the single biggest reduction: 2 calls a rung becomes 1.
#     The 5xx path keeps `WALK_RETRIES = 1` -- capacity is a different failure and a repeat
#     really can succeed -- and the network path keeps all three.
#
# 7b  ONE WHOLE-LADDER LAP PER TURN, NOT TWO (`LADDER_RESET_LIMIT` 2 -> 1).  With 7a this puts
#     worst case at 3 requests per model per turn, against a Flash cap of 5. Set 6's
#     freshTurn() already revives transient spends at every turn boundary, so the second
#     in-turn lap only bought early what the next turn gives free.
#
# 7c  THE WAIT MOVES TO THE END, WHERE IT IS THE ONLY MOVE LEFT.  Waiting per rung is wasted
#     when the neighbour answers; waiting once the WHOLE ladder is spent is not, because the
#     walls are per-minute and they clear. Bounded at 25s -- covering the 20.6s measured
#     recovery -- and Google's RetryInfo is used only to make it SHORTER, never longer.
#
# 7d  THE WAIT IS VISIBLE.  `waitVisibly()` counts down on the status strip that already
#     exists (`onModelSwitch`), then restores the model name. A 25-second silence and a
#     25-second countdown are the same delay and a completely different experience, and the
#     difference is why cadets reload out of a session instead of reporting it.
#
# 7e  RECORD WHICH QUOTA GOOGLE NAMED, and read the 429 body ONCE rather than only inside the
#     `waitedFor` guard.  `res.json()` can be called only once, so a guarded parse dropped the
#     body unread on every repeat. The quota id is what turned this from a fourth theory into
#     a measurement, and the probe is not going to be run again mid-term -- the next failing
#     cadet's error block should carry the answer by itself.
#
# WHAT THIS SET DOES NOT CLAIM. In the original evidence the first call of EVERY rung failed,
# including the first call of the turn, so that key was already throttled before the walk
# began. The walk is an AMPLIFIER, not the origin. Set 7 stops the amplification; it cannot
# un-throttle a key.

OLD_WALKRETRIES_TAIL = rb"""const WALK_RETRIES = 1;"""
NEW_WALKRETRIES_TAIL = rb"""const WALK_RETRIES = 1;

// MEASURED 2026-08-26 against a live free-tier key with
// tests/browser/test-gemini-rate-limits.html, after two readings of this failure had been
// overturned by arithmetic rather than by evidence. Google names the quota
// `GenerateRequestsPerMinutePerProjectPerModel-FreeTier`, dimensioned
// {"model": "...", "location": "global"} -- per PROJECT *and* per MODEL, which is why the
// per-key reading and the per-model reading were each half right.
//
// THE DECISIVE RESULT: asked every other model the instant one was walled,
// gemini-3.1-flash-lite answered HTTP 200 while gemini-3.5-flash-lite was still refusing. The
// next rung genuinely carries its own allowance, so WALKING IS THE CORRECT RESPONSE TO A 429.
// What was wrong was retrying the rung FIRST: a per-minute window cannot clear in the 500ms
// this transport waited, and measured recovery was 20.6 SECONDS.
//
// Zero, therefore. The 5xx path keeps WALK_RETRIES -- server capacity is a different failure
// and a repeat really can succeed -- and the network path keeps all three retries.
const QUOTA_WALK_RETRIES = 0;

// The wait taken once the WHOLE ladder is spent, which is the only moment waiting beats
// walking. NOT set from Google's own number: the probe showed RetryInfo is unreliable in both
// directions, naming 8s on a wall still standing 11 seconds later and then 57s on one that
// cleared in 10. Waiting it literally would hold a cadet 57 seconds to clear a ten-second
// wall. 25s covers the 20.6s recovery that was actually measured, and the RetryInfo value is
// used only to make this SHORTER.
const LADDER_WAIT_MS = 25000;
const LADDER_WAITS_PER_TURN = 1;
let ladderWaits = 0;"""

OLD_REVIVE_TAIL = rb"""  Object.keys(waitedFor).forEach((k) => { delete waitedFor[k]; });
  return revived;
}"""
NEW_REVIVE_TAIL = rb"""  Object.keys(waitedFor).forEach((k) => { delete waitedFor[k]; });
  ladderWaits = 0;    // the ladder-wait allowance is per TURN, like the revival it rides with
  return revived;
}"""

OLD_RESETLIMIT7 = rb"""// Bounded, because a genuinely dead key must still terminate instead of looping forever.
const LADDER_RESET_LIMIT = 2;"""
NEW_RESETLIMIT7 = rb"""// Bounded, because a genuinely dead key must still terminate instead of looping forever.
//
// ONE, not two, since 2026-08-26. Each extra lap is another request on every rung. With
// QUOTA_WALK_RETRIES at zero this puts the worst case at 3 requests per model per turn --
// one per lap, plus one more after the ladder wait -- against a measured Flash cap of 5 per
// minute. At the old settings it was 6, and an instructor's usage dashboard peaked at exactly
// 6 on both Flash models, which is that number's fingerprint seen from Google's side.
const LADDER_RESET_LIMIT = 1;"""

OLD_SLEEPDEF = rb"""function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }"""
NEW_SLEEPDEF = rb"""function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Waits out an exhausted ladder IN VIEW instead of behind a spinner. Measured recovery is ~20
// seconds, and twenty seconds of unexplained spinner is indistinguishable from the freeze this
// transport shipped on 2026-08-19 and again on 2026-08-21 -- the cadet's only signal that
// anything is wrong is that nothing is happening, so they reload and lose the session.
//
// Drives the status strip that already exists: onModelSwitch is the same hook that shows the
// running model, so this needs no new UI and cannot drift out of step with one. The plain name
// is restored on the way out, and every call is guarded because the hook is null until the
// component mounts.
async function waitVisibly(model, ms) {
  const tell = (n) => {
    if (!onModelSwitch.fn) return;
    try {
      onModelSwitch.fn(n > 0 ? (model + " \u2014 rate limited, retrying in " + n + "s") : model);
    } catch (e) {}
  };
  let left = Math.ceil(ms / 1000);
  tell(left);
  while (left > 0) { await sleep(1000); left--; tell(left); }
  await sleep(500);   // grace, so the retry lands just past the window rather than on it
}"""

OLD_429WAIT = rb"""      if (!waitedFor[activeModelRef.current]) {
        let waitMs = 0;
        try {
          const j = await res.json();
          const info = (((j.error || {}).details) || []).find(
            (d) => String(d["@type"] || "").indexOf("RetryInfo") > -1);
          const m = info && /^([0-9.]+)s$/.exec(String(info.retryDelay || ""));
          if (m) waitMs = Math.round(parseFloat(m[1]) * 1000);
        } catch (e) { /* no body, or not JSON -- fall through to the ladder */ }
        if (waitMs > 0 && waitMs <= 15000) {
          waitedFor[activeModelRef.current] = true;
          await sleep(waitMs + 500);
          attempt = 0;
          continue;
        }
      }"""
NEW_429WAIT = rb"""      // READ THE BODY ONCE, UNCONDITIONALLY. It carries the two facts that decide what to
      // do next, and this branch used to read neither reliably: RetryInfo says how long to
      // hold off, and QuotaFailure NAMES THE QUOTA that was exhausted. The parse sat inside
      // the `waitedFor` guard, so on a second 429 the body was dropped unread -- and
      // res.json() can be called only once, so there was no second chance at it.
      //
      // The quota id is what turned a fourth theory into a measurement. Keep it: the probe
      // that produced these constants is not going to be re-run mid-term, so the next failing
      // cadet's error block has to carry the answer by itself.
      let waitMs = 0;
      let quotaId = "";
      try {
        const j = await res.json();
        const det = ((j.error || {}).details) || [];
        const info = det.find((d) => String(d["@type"] || "").indexOf("RetryInfo") > -1);
        const m = info && /^([0-9.]+)s$/.exec(String(info.retryDelay || ""));
        if (m) waitMs = Math.round(parseFloat(m[1]) * 1000);
        const qf = det.find((d) => String(d["@type"] || "").indexOf("QuotaFailure") > -1);
        const v = qf && (qf.violations || [])[0];
        if (v) quotaId = String(v.quotaId || v.quotaMetric || "").slice(0, 120);
      } catch (e) { /* no body, or not JSON -- fall through to the ladder */ }
      if (quotaId) noteQuota(activeModelRef.current, quotaId);"""

OLD_429ADVANCE = rb"""      if (attempt < WALK_RETRIES) { await sleep(backoffMs(attempt)); attempt++; continue; }
      // RECORD IT. This branch marked the model spent and walked without ever calling
      // noteFail, so a rung burned by quota reached the log as `calls: 12, ok: 0, fail: 0,
      // kinds: {}` -- twelve requests and no account of one of them. Every rung above the
      // floor in the 2026-08-25 rows looks like that, which is why those rows cannot say
      // whether the cadet was rate-limited or Google was refusing.
      noteFail(activeModelRef.current, "quota");
      spentModels[activeModelRef.current] = "quota";
      if (advance(activeModelRef)) { attempt = 0; continue; }
      throw { kind: "quota", status: 429 };"""
NEW_429ADVANCE = rb"""      // WALK, AND DO NOT RETRY THIS RUNG. Zero, measured: the limit is per project PER
      // MODEL, and the probe watched a neighbouring model answer HTTP 200 while this one
      // refused -- so the next rung is a fresh allowance, and the 500ms backoff that used to
      // come first was spent against a window that takes ~20 seconds to clear.
      if (attempt < QUOTA_WALK_RETRIES) { await sleep(backoffMs(attempt)); attempt++; continue; }
      // RECORD IT. This branch marked the model spent and walked without ever calling
      // noteFail, so a rung burned by quota reached the log as `calls: 12, ok: 0, fail: 0,
      // kinds: {}` -- twelve requests and no account of one of them. Every rung above the
      // floor in the 2026-08-25 rows looks like that, which is why those rows cannot say
      // whether the cadet was rate-limited or Google was refusing.
      noteFail(activeModelRef.current, "quota");
      spentModels[activeModelRef.current] = "quota";
      if (advance(activeModelRef)) { attempt = 0; continue; }
      // EVERY RUNG IS SPENT, and only now is waiting better than walking. The walls are
      // per-minute and they do clear -- measured at 20.6s -- so one bounded wait buys a whole
      // fresh ladder for the price of a countdown the cadet can see. RetryInfo is allowed to
      // make this shorter and never longer, because the probe caught it naming 57s for a wall
      // that cleared in 10.
      if (ladderWaits < LADDER_WAITS_PER_TURN) {
        ladderWaits++;
        await waitVisibly(activeModelRef.current,
                          waitMs > 0 ? Math.min(waitMs, LADDER_WAIT_MS) : LADDER_WAIT_MS);
        if (freshTurn(activeModelRef)) { attempt = 0; continue; }
      }
      throw { kind: "quota", status: 429 };"""

OLD_NOTEQUOTA = rb"""function noteFail(name, kind) {"""
NEW_NOTEQUOTA = rb"""// Records WHICH quota Google said was exhausted, verbatim from the 429 body's QuotaFailure
// violation. On 2026-08-26 that name -- GenerateRequestsPerMinutePerProjectPerModel-FreeTier --
// settled a question two rounds of arithmetic could not: the ceiling is per project AND per
// model, so a neighbouring rung is a real fresh allowance and walking the ladder is sound.
// Counters only, and the id is a Google metric name, so it passes the same whitelist rule as
// every other field in diagSnapshot (CORE.md section 3).
function noteQuota(name, id) {
  const s = statFor(name);
  if (!s.quotaIds) s.quotaIds = {};
  s.quotaIds[id] = (s.quotaIds[id] || 0) + 1;
}

function noteFail(name, kind) {"""

OLD_DIAGQUOTA = rb"""      kinds: s.kinds, spent: !!spentModels[n],"""
NEW_DIAGQUOTA = rb"""      kinds: s.kinds, spent: !!spentModels[n], quota_ids: s.quotaIds || {},"""

OLD_RENDERQUOTA = rb"""      + (m.spent ? "  SPENT" : "") + (kinds ? "  [" + kinds + "]" : ""));
  });"""
NEW_RENDERQUOTA = rb"""      + (m.spent ? "  SPENT" : "") + (kinds ? "  [" + kinds + "]" : ""));
    // On its own line: a quota id is long, and it is the line to read FIRST. A name carrying
    // PerModel means the neighbouring rung still has an allowance and the walk was right; one
    // that does not means the whole project is capped and the walk was never going to help.
    const qids = Object.keys(m.quota_ids || {});
    if (qids.length) lines.push("      quota: " + qids.join(", "));
  });"""

SET7_MARKER = b"QUOTA_WALK_RETRIES"


def apply_rate_limit_backoff(raw):
    """Set 7. Walk on a 429 instead of retrying it, wait only once the ladder is spent, and
    record which quota Google named. Constants measured, not reasoned -- see the header."""
    if SET7_MARKER in raw:
        return raw, ["already"]
    p = Patcher(raw, None)
    p.sub("quota-walk-constants", OLD_WALKRETRIES_TAIL, NEW_WALKRETRIES_TAIL)
    p.sub("ladder-wait-per-turn", OLD_REVIVE_TAIL, NEW_REVIVE_TAIL)
    p.sub("one-ladder-lap", OLD_RESETLIMIT7, NEW_RESETLIMIT7)
    p.sub("wait-visibly", OLD_SLEEPDEF, NEW_SLEEPDEF)
    p.sub("read-429-body-once", OLD_429WAIT, NEW_429WAIT)
    p.sub("walk-then-wait", OLD_429ADVANCE, NEW_429ADVANCE)
    p.sub("note-quota-id", OLD_NOTEQUOTA, NEW_NOTEQUOTA)
    p.sub("diag-quota-id", OLD_DIAGQUOTA, NEW_DIAGQUOTA)
    p.sub("render-quota-id", OLD_RENDERQUOTA, NEW_RENDERQUOTA)
    return p.buf, p.applied


# --- SET 8: the log's `detail` column was NULL in every row it ever held -------------------
#
# 872 rows over the night of 2026-08-25, and `detail` -- the column that exists to hold
# GOOGLE's own error message -- was NULL in all 872. Not mostly. All.
#
# The cause is one branch. `detail` is attached only where a 400 is disambiguated, because
# that is the only place the body was ever parsed for its message. The three throws that
# actually fire in production carry none:
#
#     throw { kind: "quota",    status: 429 };            774 rows, 89% of the night
#     throw { kind: "capacity", status: res.status };
#     throw { kind: "model",    status: 404 };
#
# So an instructor opening the log to ask "what did Google say" got a column full of NULLs,
# and the answer had to be reconstructed from counters. Set 7 already reads the 429 body --
# it has to, for the RetryInfo delay and the QuotaFailure name -- so the message is sitting
# in a local variable one line away from being kept. This keeps it.
#
# SCOPED TO 429 ON PURPOSE. That is 774 of 872 rows, and it is the branch that already parses
# the body, so nothing new is read and no extra work is done on a failing path. The 404 class
# was closed by set 5 and the 5xx class is rare; both would need a fresh `res.text()` on a
# path that is trying to get out of the way, which is a worse trade for the remaining 11%.
#
# CORE.md section 3: `detail` is Google's message, capped at 300 characters by the client and
# again by the edge function. It is never anything the cadet typed -- the table has nowhere to
# put a sentence and the edge function builds its insert from a whitelist.

OLD_QUOTA_DECL = rb"""      let waitMs = 0;
      let quotaId = "";"""
NEW_QUOTA_DECL = rb"""      let waitMs = 0;
      let quotaId = "";
      let quotaMsg = "";"""

OLD_QUOTA_PARSE = rb"""        if (v) quotaId = String(v.quotaId || v.quotaMetric || "").slice(0, 120);
      } catch (e) { /* no body, or not JSON -- fall through to the ladder */ }"""
NEW_QUOTA_PARSE = rb"""        if (v) quotaId = String(v.quotaId || v.quotaMetric || "").slice(0, 120);
        // Google's own sentence, which the log's `detail` column exists for and which was
        // NULL in all 872 rows of the 2026-08-25 night because no throw below ever set it.
        if (j.error && j.error.message) quotaMsg = String(j.error.message).slice(0, 300);
      } catch (e) { /* no body, or not JSON -- fall through to the ladder */ }"""

OLD_QUOTA_THROW = rb"""      throw { kind: "quota", status: 429 };"""
NEW_QUOTA_THROW = rb"""      throw { kind: "quota", status: 429, detail: quotaMsg };"""

SET8_MARKER = b"let quotaMsg"


def apply_quota_detail(raw):
    """Set 8. Keep Google's 429 message, so the log's `detail` column stops being NULL."""
    if SET8_MARKER in raw:
        return raw, ["already"]
    p = Patcher(raw, None)
    p.sub("quota-msg-decl", OLD_QUOTA_DECL, NEW_QUOTA_DECL)
    p.sub("quota-msg-parse", OLD_QUOTA_PARSE, NEW_QUOTA_PARSE)
    p.sub("quota-msg-throw", OLD_QUOTA_THROW, NEW_QUOTA_THROW)
    return p.buf, p.applied


# --- SET 9: tell a per-MINUTE 429 from a per-DAY one, and stop paying for the difference --
#
# Set 7 made the ladder walk instead of thrash, and it was right to. What it still cannot do
# is tell the two 429s apart, and they are opposite problems:
#
#   per MINUTE  clears in ~20s. Waiting is correct, and a countdown is worth showing.
#   per DAY     does not clear until midnight PACIFIC. Waiting is worthless, retrying is
#               worthless, and every attempt spends a request against a cap already full.
#
# Treated as one thing, the daily case is the expensive one. gemini-3.6-flash is 20 requests
# per DAY, and a single lesson is ~14 -- so a cadet's SECOND lesson of the day starts with the
# top rung already dead. freshTurn() then revives it at the top of every turn, seats it, and
# spends one guaranteed 429 on it, and another on 3.5-flash beneath it. Over a 30-turn session
# that is ~60 requests whose only possible outcome is a refusal, plus two round trips of
# latency in front of every single thing the cadet types.
#
# THE COURSE DIRECTOR'S REASONING, 2026-08-26, and it is sound: if the first few requests of a
# session are refused, that cannot be a per-minute limit -- the smallest cap on this ladder is
# 5/min -- so it must be the daily one. One correction was needed. "The first few requests"
# has to mean the first few THIS KEY HAS SENT, not the first few THIS PAGE has sent, and until
# now the counters lived in module scope and died on every reload. A cadet who reloads, or who
# ran a lesson an hour ago, looked like a fresh session to code that had no memory. So the
# ledger below is in localStorage, keyed by the Pacific date.
#
# GOOGLE ALSO JUST SAYS SO, which is cheaper than any inference. Set 7 already parses the
# QuotaFailure violation out of the 429 body, and the name is literally
# `GenerateRequestsPerMinutePerProjectPerModel-FreeTier`. Matching /PerDay/ against it is the
# primary test; the director's send-count inference is the fallback for a body that carries no
# QuotaFailure at all. Both are kept -- the name is authoritative when present, and the
# arithmetic still answers when it is not.
#
# WHAT IS DELIBERATELY *NOT* BUILT:
#
#   A GLOBAL pacer across all models. The 2026-08-26 probe settled this: asked every other
#   model the instant one was walled, gemini-3.1-flash-lite answered HTTP 200 while
#   gemini-3.5-flash-lite was still refusing. The ceiling is per project AND PER MODEL, so a
#   project-wide pacer would slow every rung down to protect against a limit that does not
#   exist. The pacer here is per model, which is both correct and faster.
#
#   A token check. TPM on the free tier is 250,000/min and a turn is a few thousand, so it has
#   never been the binding limit -- the probe drew a 429 on a TWO-CHARACTER prompt. Tokens are
#   already counted and logged; gating on them would add a branch that never fires.

OLD_SEATLADDER = rb"""function seatLadder(ref, ladder) {"""
NEW_SEATLADDER = rb"""// --- The quota ledger: what THIS KEY has already spent today -----------------------------
//
// Survives reloads, because Google's counters do and ours did not. Everything above this line
// is module scope and resets on every page load, which is exactly the blind spot that made an
// early 429 unreadable: a cadet on their second lesson of the day looked identical to a cadet
// on their first request ever.
//
// Google resets requests-per-day at MIDNIGHT PACIFIC -- not the cadet's midnight, and not on a
// rolling 24 hours. Cadets here are Mountain, so that is 1am local, and a lock taken at 11pm
// has two hours left to run, not one minute. `en-CA` is used only because it formats as
// YYYY-MM-DD, which compares correctly as a plain string.
const QUOTA_STORE = "prep.gemini.quota";

function quotaDay() {
  try { return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }); }
  catch (e) { return new Date().toISOString().slice(0, 10); }   // no Intl tz data: UTC is close
}

let quotaBook = null;
function book() {
  const day = quotaDay();
  if (quotaBook && quotaBook.day === day) return quotaBook;
  let b = null;
  try { b = JSON.parse(localStorage.getItem(QUOTA_STORE) || "null"); } catch (e) {}
  // A NEW PACIFIC DAY WIPES EVERY LOCK, which is the whole expiry mechanism. There is no
  // timer and nothing to schedule: the stored day simply stops matching.
  if (!b || b.day !== day || !b.m) b = { day: day, m: {} };
  quotaBook = b;
  return b;
}
function bookFor(name) {
  const m = book().m;
  return m[name] || (m[name] = { sent: 0, t: [], day: 0 });
}
function saveBook() {
  try { localStorage.setItem(QUOTA_STORE, JSON.stringify(quotaBook)); } catch (e) {}
}

// MEASURED 2026-08-26, tests/browser/test-gemini-rate-limits.html. Not read from a doc page:
// the published tables disagreed with the live key twice.
const RPM_FLASH = 5;      // gemini-3.6-flash, gemini-3.5-flash -- also 20 requests per DAY
const RPM_LITE = 15;      // the lite floor -- 500 per day, which no session has come near
function rpmOf(name) { return /lite/i.test(name) ? RPM_LITE : RPM_FLASH; }

function sentSince(name, ms) {
  const cut = Date.now() - ms;
  return bookFor(name).t.filter((t) => t > cut).length;
}

// Called from noteCall, so it counts exactly what the transport actually sent -- retries
// included. A retry costs quota whether or not it succeeds, and the old counters hid that.
function noteSend(name) {
  const e = bookFor(name);
  e.sent++;
  e.t.push(Date.now());
  if (e.t.length > 30) e.t = e.t.slice(-30);   // one minute of history is all this is asked for
  saveBook();
}

// WHICH quota did Google mean? Its own name first; the director's arithmetic second.
//
// The fallback reads: we got a 429 having sent fewer than the SMALLEST per-minute cap on this
// ladder in the last minute. No per-minute limit on any rung can be full at that rate, so the
// refusal has to be the daily one. RPM_FLASH is the conservative choice here -- using the
// per-model rpmOf() would call a lite rung "daily" at 14 sends/min, which is a minute limit
// about to close, not a day one.
function quotaScope(name, quotaId) {
  if (/PerDay/i.test(quotaId)) return "day";
  if (/PerMinute/i.test(quotaId)) return "minute";
  return sentSince(name, 60000) < RPM_FLASH ? "day" : "minute";
}

function lockDay(name) { bookFor(name).day = 1; saveBook(); }
function dayLocked(name) { return !!bookFor(name).day; }

// True when this model has already used its per-minute allowance, so the next request to it
// is a refusal we can predict. Walking costs nothing and a refusal costs a round trip.
function pacedOut(name) { return sentSince(name, 60000) >= rpmOf(name); }

// Carries today's locks into a FRESH PAGE LOAD, which is the point of storing them. Without
// this the ledger would only help within one session, and the session that needs it most is
// the one that starts after the cap is already gone.
//
// statFor() is called deliberately: it puts the model in modelStats with calls 0, so a rung
// skipped before it was ever tried still appears in the cadet's error panel and in the log
// instead of silently vanishing from the list of what was attempted.
function seedDayLocks(ladders) {
  let n = 0;
  ladders.forEach((lad) => (lad || []).forEach((name) => {
    if (!dayLocked(name) || spentModels[name]) return;
    spentModels[name] = "day";
    statFor(name).kinds.daily_capped = 1;
    n++;
  }));
  return n;
}

function seatLadder(ref, ladder) {"""

OLD_NOTECALL = rb"""function noteCall(name) { statFor(name).calls++; diagState.model = name; }"""
NEW_NOTECALL = rb"""function noteCall(name) {
  statFor(name).calls++;
  diagState.model = name;
  noteSend(name);   // the persistent half: survives the reload the counters above do not
}"""

OLD_REVIVE9 = rb"""    if (spentModels[k] !== "model") { delete spentModels[k]; revived++; }"""
NEW_REVIVE9 = rb"""    // "day" JOINS "model" AS PERMANENT-FOR-NOW. A daily cap does not clear until midnight
    // Pacific, so reviving one buys a guaranteed 429 on that rung at the top of every
    // remaining turn -- ~60 of them across a long session, each one a round trip the cadet
    // waits through before the first model that can actually answer is even tried.
    if (spentModels[k] !== "model" && spentModels[k] !== "day") {
      delete spentModels[k];
      revived++;
    }"""

OLD_SEED = rb"""  activeModelRef.ladder = null;             // force a re-seat onto the filtered list
  seatLadder(activeModelRef, MODEL_CHAT);"""
NEW_SEED = rb"""  // Anything this key already exhausted TODAY is dead before the first turn is typed. Done
  // here rather than at module load because the ladders are only final once discovery has
  // filtered them against what this key can actually reach.
  seedDayLocks([MODEL_CHAT, MODEL_REPORT, MODEL_STUDY]);

  activeModelRef.ladder = null;             // force a re-seat onto the filtered list
  seatLadder(activeModelRef, MODEL_CHAT);"""

OLD_RAWCALL_HEAD = rb"""async function rawCall(activeModelRef, body, { retries = 3 } = {}) {
  let attempt = 0;
  while (true) {
    let res;"""
NEW_RAWCALL_HEAD = rb"""async function rawCall(activeModelRef, body, { retries = 3 } = {}) {
  let attempt = 0;
  let paced = 0;
  while (true) {
    // DON'T SEND A REQUEST WE CAN ALREADY PREDICT WILL BE REFUSED. If this rung has used its
    // measured per-minute allowance, step down instead -- the limit is per model, so the next
    // rung has its own, and walking is instant where a refusal is a round trip.
    //
    // nextModel, NOT advance: advance() falls through to resetLadder, which spends one of the
    // session's two whole-ladder laps. Pacing must never consume that budget; it is a routine
    // step, not a failure. Bounded so it can never spin, and when nothing is left to walk to
    // it simply falls through and sends -- the 429 path below still handles the wait.
    if (paced < PACE_WALK_LIMIT && pacedOut(activeModelRef.current)) {
      paced++;
      if (nextModel(activeModelRef)) continue;
    }
    let res;"""

OLD_PACELIMIT = rb"""const LADDER_WAIT_MS = 25000;
const LADDER_WAITS_PER_TURN = 1;
let ladderWaits = 0;"""
NEW_PACELIMIT = rb"""const LADDER_WAIT_MS = 25000;
const LADDER_WAITS_PER_TURN = 1;
let ladderWaits = 0;

// How many rungs the per-minute pacer may step down before it gives up and sends anyway.
// One per rung of the longest ladder; it exists only so a bug cannot turn into a spin.
const PACE_WALK_LIMIT = 6;

// A pause shorter than this is taken SILENTLY. Announcing a two-second wait as "rate limited"
// teaches a cadet that the page is broken when it is working exactly as designed -- and the
// message costs more attention than the wait it explains. Longer than this and the countdown
// is worth showing, because unexplained silence is what makes cadets reload and lose work.
const QUIET_WAIT_MS = 3000;"""

OLD_WAITVIS = rb"""async function waitVisibly(model, ms) {
  const tell = (n) => {"""
NEW_WAITVIS = rb"""async function waitVisibly(model, ms) {
  if (ms <= QUIET_WAIT_MS) { await sleep(ms); return; }   // too short to be worth alarming over
  const tell = (n) => {"""

OLD_429SPEND = rb"""      noteFail(activeModelRef.current, "quota");
      spentModels[activeModelRef.current] = "quota";
      if (advance(activeModelRef)) { attempt = 0; continue; }"""
NEW_429SPEND = rb"""      noteFail(activeModelRef.current, "quota");
      // MINUTE OR DAY. Google's own name decides it when the body carried one; otherwise our
      // own send history does. A day lock is written through to localStorage, so it outlives
      // this page load -- the cadet's next lesson starts with this rung already skipped
      // instead of rediscovering it at one wasted request per turn.
      const scope = quotaScope(activeModelRef.current, quotaId);
      if (scope === "day") lockDay(activeModelRef.current);
      spentModels[activeModelRef.current] = scope === "day" ? "day" : "quota";
      if (advance(activeModelRef)) { attempt = 0; continue; }"""

OLD_429WAITGATE = rb"""      if (ladderWaits < LADDER_WAITS_PER_TURN) {
        ladderWaits++;
        await waitVisibly(activeModelRef.current,
                          waitMs > 0 ? Math.min(waitMs, LADDER_WAIT_MS) : LADDER_WAIT_MS);
        if (freshTurn(activeModelRef)) { attempt = 0; continue; }
      }
      throw { kind: "quota", status: 429, detail: quotaMsg };"""
NEW_429WAITGATE = rb"""      //
      // BUT NOT IF EVERY RUNG IS DAY-LOCKED. Twenty-five seconds against a cap that resets at
      // midnight buys nothing at all, and it buys it while the cadet watches a countdown that
      // promises the opposite. That case is over; say so instead of stalling.
      const spentLadder = activeModelRef.ladder || MODEL_FALLBACKS;
      const allDay = spentLadder.every((n) => spentModels[n] === "day");
      if (!allDay && ladderWaits < LADDER_WAITS_PER_TURN) {
        ladderWaits++;
        await waitVisibly(activeModelRef.current,
                          waitMs > 0 ? Math.min(waitMs, LADDER_WAIT_MS) : LADDER_WAIT_MS);
        if (freshTurn(activeModelRef)) { attempt = 0; continue; }
      }
      throw { kind: "quota", status: 429, scope: allDay ? "day" : "minute",
              detail: (allDay ? "[daily] " : "") + quotaMsg };"""

OLD_QUOTAMSG = rb"""    case "quota":
      return "Your Gemini free-tier quota is used up for now. A per-minute limit clears in about a minute; the daily one resets on Google's clock. Wait and Retry.";"""
NEW_QUOTAMSG = rb"""    case "quota":
      // This hedged -- "a per-minute limit clears in about a minute; the daily one resets on
      // Google's clock" -- because the transport could not tell which had happened. It can
      // now, so the cadet gets the one instruction that is actually true for their case. The
      // difference matters: one of them is "wait a moment", the other is "come back tomorrow",
      // and telling a cadet to Retry against a daily cap is an hour of pressing a dead button.
      return err.scope === "day"
        ? "Your Gemini free-tier DAILY limit is used up on every model this lesson can use. It resets at midnight Pacific time \u2014 1am Mountain. Retrying now cannot work. Your conversation is saved in this browser, so you can come back and pick it up."
        : "Google is asking us to slow down \u2014 the per-minute limit on your key is full. It clears in about a minute. Wait, then press Retry.";"""

SET9_MARKER = b"QUOTA_STORE"


def apply_quota_ledger(raw):
    """Set 9. A per-day 429 and a per-minute 429 are opposite problems; tell them apart, and
    stop retrying the one that cannot clear until midnight Pacific."""
    if SET9_MARKER in raw:
        return raw, ["already"]
    p = Patcher(raw, None)
    p.sub("quota-ledger", OLD_SEATLADDER, NEW_SEATLADDER)
    p.sub("note-send", OLD_NOTECALL, NEW_NOTECALL)
    p.sub("keep-day-locks", OLD_REVIVE9, NEW_REVIVE9)
    p.sub("seed-day-locks", OLD_SEED, NEW_SEED)
    p.sub("pace-constants", OLD_PACELIMIT, NEW_PACELIMIT)
    p.sub("pace-before-send", OLD_RAWCALL_HEAD, NEW_RAWCALL_HEAD)
    p.sub("quiet-short-wait", OLD_WAITVIS, NEW_WAITVIS)
    p.sub("classify-429", OLD_429SPEND, NEW_429SPEND)
    p.sub("no-wait-when-daily", OLD_429WAITGATE, NEW_429WAITGATE)
    p.sub("quota-message-splits", OLD_QUOTAMSG, NEW_QUOTAMSG)
    return p.buf, p.applied


def patch_one(path, verbose=False):
    raw = path.read_bytes()
    buf, applied = apply_fixset(raw)
    buf, applied2 = apply_socratic(buf)
    buf, applied3 = apply_notation(buf)
    buf, applied4 = apply_cadet_ref(buf)
    buf, applied5 = apply_ladder_floor(buf)
    buf, applied6 = apply_turn_revive(buf)
    buf, applied7 = apply_rate_limit_backoff(buf)
    buf, applied8 = apply_quota_detail(buf)
    buf, applied9 = apply_quota_ledger(buf)
    applied = (applied + applied2 + applied3 + applied4 + applied5 + applied6
               + applied7 + applied8 + applied9)
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
