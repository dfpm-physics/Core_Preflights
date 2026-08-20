#!/usr/bin/env python3
"""Port a published Claude preflight artifact to a Gemini-API backup build hosted on our site.

WHY THIS EXISTS
    Cadets on free Claude accounts get HTTP 429 when demand is high, and a cadet who cannot
    reach the tutor cannot do the preflight at all. The backup build is the same lesson --
    same tutor prompt, same grounding, same report, same submit contract -- running against
    Google's Generative Language API with the CADET'S OWN free-tier key.

    It is a fallback, not an alternative. The Claude artifact stays the desired path; the
    backup is reached only from a failed connection check, and it says so on its face.

WHAT IS AND IS NOT ALLOWED TO CHANGE
    Everything the cohort rollup depends on is byte-identical to the published build:
    the four String.raw grounding blocks, REPORT_FORMAT, the schema:1 payload shape,
    INTERACTION_ID and SUBMIT_ENDPOINT. Only the TRANSPORT changes. The script asserts
    each of those before it writes, and refuses rather than warns.

    INTERACTION_ID especially: the backup submits to the SAME slug as the Claude build, so
    a cadet who falls back is indistinguishable downstream from one who did not. That is
    the entire point -- contract section 3.2 mints a slug per OFFERING, not per transport,
    and a second slug here would split one lesson's cohort into two.

BYTES ONLY
    PROJECT.md's sharp-edge table records what a Python text-mode read costs on this tree:
    universal newlines silently rewrote every line of three artifacts (6,327 insertions,
    6,327 deletions) and hid the three real changes inside it. phys-215 sources are CRLF
    and phys-310 sources are LF; this script detects and preserves whichever it finds.

ENCODING, WHICH DIFFERS BY CONTEXT AND IS THE OTHER WAY THIS BREAKS
    * JSX text and JSX attribute strings do NOT process JS escapes -> HTML entities
      (&mdash; &rarr;) or plain ASCII. A "\\u2014" written into JSX text renders literally.
    * Real JS string literals DO -> \\u escapes are correct there.
    * Comments are literal -> ASCII only.

USE
    python scripts/artifacts/to_gemini.py --course phys-215 --slug lesson-04-...   # dry run
    python scripts/artifacts/to_gemini.py --course phys-215 --lesson 5 --commit
    python scripts/artifacts/to_gemini.py --course phys-215 --all --commit
    python scripts/artifacts/to_gemini.py --all-courses --commit

    Standard library only (CORE.md section 2). Dry-run by default, idempotent: a build whose
    bytes already match is reported as unchanged and not rewritten.

INPUT / OUTPUT
    in   _builder/courses/<course>/artifacts/<file>.jsx   (gitignored local cache;
                                                           populate with sync_artifacts.py pull)
         _builder/courses/<course>/index.json             (slug -> file, lesson_no, title)
    out  site/gemini/<course>/<slug>.html                 (public, self-contained, committed)
         site/data/backup-builds.json                     (the slug -> build map the router reads)

THE OUTPUT IS PUBLIC, DELIBERATELY
    A cadet reaches it when Claude has already failed, so it cannot require a PREP login --
    there is no session to check yet. That exposes the tutor prompt and the extension
    problems to anyone with the URL, which is the SAME exposure the published Claude
    artifact already carries (PROJECT.md: "the source is not secret -- claude.ai shows an
    artifact's formatted code behind a Code button"). What stays private is the build
    RECORD -- grounding page numbers, BUILD-LOG.md, REVIEW-NOTES.json -- which is why the
    artifact-sources bucket is private and none of it is copied here.

    Each page is noindex'd anyway: worked extension problems being Google-searchable is a
    real change even when the exposure is not, and "reachable by URL" and "the first hit for
    the problem text" are different things -- only the second is a teaching problem. The
    meta tag is not a security control and is not claimed as one.

    It has to be the META TAG and cannot be robots.txt. This is a GitHub Pages PROJECT site,
    so the repository root serves at /Core_Preflights/, and a robots.txt there lands at
    /Core_Preflights/robots.txt. Crawlers only ever read /robots.txt at the host root, which
    belongs to the dfpm-physics.github.io repository and not to this one. A robots.txt
    committed here would be silently inert while looking exactly like a working control --
    which is worse than not having one. (Tried, then deleted, 2026-08-14.)
"""

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
COURSES = REPO / "_builder" / "courses"
OUT_ROOT = REPO / "site" / "gemini"
MANIFEST = REPO / "site" / "data" / "backup-builds.json"

# lz-string is contract-pinned to 1.5.0 (INTERACTION-DATA-CONTRACT section 3). The published
# artifact pulls it from cdnjs at runtime; the backup serves the identical file from our own
# origin instead. Same codec, one less third party able to see a cadet's API key.
VENDOR_LZ = "../../vendor/lz-string.min.js"


# ══════════════════════════════════════════════════════════════════════════════
# Newline-aware pattern helpers
# ══════════════════════════════════════════════════════════════════════════════

def detect_nl(b: bytes) -> bytes:
    """CRLF only if EVERY LF is preceded by CR. A mixed file is a corrupted file here."""
    lf = b.count(b"\n")
    crlf = b.count(b"\r\n")
    if crlf == lf:
        return b"\r\n"
    if crlf == 0:
        return b"\n"
    raise SystemExit(f"mixed line endings ({crlf} CRLF of {lf} LF) - refusing to guess")


def adapt(pattern: bytes, nl: bytes) -> bytes:
    r"""Patterns below are written CRLF. For an LF file, rewrite the literal `\r\n` in the
    regex SOURCE (backslash-r backslash-n, four bytes) down to `\n`."""
    return pattern if nl == b"\r\n" else pattern.replace(rb"\r\n", rb"\n")


class Porter:
    def __init__(self, src: bytes, slug: str):
        self.src = src
        self.slug = slug
        self.nl = detect_nl(src)
        self.log = []

    def sub1(self, pattern: bytes, repl: bytes, why: str, count: int = 1):
        """Replace exactly `count` occurrences or abort. A lambda, never a template string:
        the replacement is JS source full of regex literals, and re would otherwise eat
        \\d, \\u and \\1 in it."""
        literal = repl.replace(b"\n", self.nl)
        new, n = re.subn(adapt(pattern, self.nl), lambda m: literal, self.src, flags=re.S)
        if n != count:
            raise SystemExit(f"  FAILED [{why}]: matched {n}, expected {count}")
        self.src = new
        self.log.append(why)

    def strip_optional(self, pattern: bytes, repl: bytes, why: str):
        """Remove something that may or may not be there. Zero or one match, never more."""
        literal = repl.replace(b"\n", self.nl)
        new, n = re.subn(adapt(pattern, self.nl), lambda m: literal, self.src, flags=re.S)
        if n > 1:
            raise SystemExit(f"  FAILED [{why}]: matched {n}, expected 0 or 1")
        self.src = new
        self.log.append(f"{why} ({'removed' if n else 'not present'})")

    def grab(self, name: bytes, blob: bytes = None) -> bytes:
        r"""One grounding constant's body, from either declaration form.

        TWO FORMS EXIST IN THIS PROJECT, and they are not always interchangeable.
        The preflight-kit emits String.raw`...`, which processes no escapes. PHYS 110's five
        artifacts were built outside the kit and use a plain template literal `...`, which DOES
        process `\n`, `\u`, and `${...}` -- so the same bytes can mean two different things
        depending on which keyword precedes them.

        For content carrying neither escapes nor interpolation the two are byte-identical, and
        all four PHYS 110 grounding blocks are of that kind (verified 2026-08-19: 0 and 0 across
        all five artifacts). That is the ONLY case this accepts.

        When a plain literal does carry either, the forms genuinely differ and copying the source
        text into a build that treats it as raw would silently change the tutor's grounding. This
        REFUSES there rather than warning, which is the rule the whole port is written to
        (see the module header): everything the cohort rollup depends on is byte-identical to the
        published build, or nothing is written at all.
        """
        src = self.src if blob is None else blob
        m = re.search(rb"const " + name + rb" = String\.raw`(.*?)`;", src, re.S)
        if m:
            return m.group(1)

        m = re.search(rb"const " + name + rb" = `(.*?)`;", src, re.S)
        if not m:
            raise SystemExit(f"could not locate {name.decode()}")
        body = m.group(1)
        if b"${" in body:
            raise SystemExit(
                f"{name.decode()} is a plain template literal containing ${{...}} interpolation. "
                "Its text is computed at runtime, so it cannot be copied as raw grounding.")
        if re.search(rb"\\[nrtu\\]", body):
            raise SystemExit(
                f"{name.decode()} is a plain template literal containing backslash escapes. "
                "String.raw would not process them and this literal does, so the two forms are "
                "not equivalent here -- porting it would change the grounding.")
        return body


# ══════════════════════════════════════════════════════════════════════════════
# The transform
# ══════════════════════════════════════════════════════════════════════════════

def port(src: bytes, slug: str, verbose: bool = False):
    p = Porter(src, slug)
    GROUNDING = (b"TEXTBOOK_REFERENCE", b"LESSON_CONFIG", b"EXTENSION_PROBLEMS", b"REPORT_FORMAT")
    before = {n: p.grab(n) for n in GROUNDING}

    m = re.search(rb"export default function (\w+)\(\)", src)
    if not m:
        raise SystemExit("no `export default function` - not a preflight artifact")
    component = m.group(1).decode()

    # Whitespace-tolerant. This was the THIRD copy of this pattern in scripts/artifacts/ and the
    # second one that required the value on the same line as the keyword -- so PHYS 110's builds,
    # which wrap it, failed here claiming the slug did not match when it did. artifact_parse.RE_ID
    # was always tolerant; check_artifact.py was fixed the same day. All three now agree, and any
    # fourth copy must too: this string is the lesson's identity and a false negative on it stops
    # a backup build that should exist.
    m = re.search(rb'^const INTERACTION_ID\s*=\s*"([^"]+)"', src, re.M)
    if not m or m.group(1).decode() != slug:
        raise SystemExit(f"INTERACTION_ID does not match slug {slug}")

    # ── 1. Model constants -> Gemini, discovered at runtime ───────────────────
    p.sub1(
        # Tolerant of both dialects. The kit puts a blank line after `];` and a `// CONSTANT`
        # marker on each of the next two lines; PHYS 110's builds do neither. Those are the only
        # differences, and both are cosmetic -- so the blank line is optional and the trailing
        # text is `[^\r\n]*` rather than a required comment. `[^\r\n]*` survives adapt(),
        # which rewrites the four-byte sequence \r\n and leaves the character class correct
        # for an LF file.
        rb"const MODEL_CANDIDATES = \[\r\n"
        rb'  "claude-.*?\r\n'
        rb'  "claude-.*?\r\n'
        rb"\];\r\n"
        rb"(?:\r\n)?"
        rb"const MAX_TOKENS = 4096;[^\r\n]*\r\n"
        rb'const ENDPOINT = "https://api\.anthropic\.com/v1/messages";[^\r\n]*',
        b"""// GEMINI BACKUP BUILD. Two things decide which model a turn uses, and they pull opposite ways.
//
//   1. Names churn. gemini-1.5-pro and gemini-1.5-flash were the obvious picks a year ago and
//      both 404 on a key issued today, so a hard-coded list can dead-end the whole build.
//   2. Free-tier QUOTA is per MODEL, not per key -- every row in AI Studio carries its own
//      RPM/TPM/RPD counter -- and the quotas differ by more than an order of magnitude.
//
// Measured on a real cadet key, 2026-08-20:
//
//      Gemini 3.7 / 3.6 / 3.5 / 3 Flash, 2.5 Flash, 2.5 Flash Lite     5-10 RPM     20 RPD
//      Gemini 3.5 Flash Lite, 3.1 Flash Lite                             15 RPM    500 RPD
//
// One tutor session is 10-14 requests. So a 20/day model gives a cadet ONE session and then
// locks them out until midnight Pacific -- which is what happened to a section on 2026-08-20,
// at 21 requests against a cap of 20.
//
// NEWER IS NOT BETTER HERE. A new Flash launches on the tight 20/day quota while the Lite
// models carry 25x that, so these ladders are ordered by QUOTA, not by capability. The old
// scorer added a bonus for any name containing "latest", which is how every cadet silently
// ended up on a 20/day model without anyone choosing it: Google hot-swaps gemini-flash-latest
// to whatever shipped most recently, and their own docs say it "can be a stable, preview or
// experimental release". It is now penalised rather than preferred.
//
// Not const: discoverModel() intersects both ladders with what the cadet's key can actually
// reach, and falls back to scoring the listing when it can reach none of them. That keeps the
// property runtime discovery existed for -- this build cannot dead-end on a retired name.

// Ordinary conversation turns: ~12 of the ~14 requests in a session. Quota is what matters.
let MODEL_CHAT = [
  "gemini-3.5-flash-lite",    // 15 RPM, 500 RPD
  "gemini-3.1-flash-lite",    // 15 RPM, 500 RPD
  "gemini-3.5-flash",         //  5 RPM,  20 RPD -- from here down, one session's worth
  "gemini-3-flash",
  "gemini-2.5-flash",
];

// The report is ONE request per session and it is the graded artifact the cohort rollup
// reads, so it gets the strongest model the key has and can afford a 20/day cap. It falls
// through into the chat ladder rather than failing: a session with no report is a lost
// session, and a report from a weaker model beats no report at all.
let MODEL_REPORT = [
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
].concat(MODEL_CHAT);

// Used only if the ListModels call itself fails, so it never gets filtered against a listing.
const MODEL_FALLBACKS = MODEL_CHAT;

const MAX_TOKENS = 4096;                                    // CONSTANT
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Reject anything that is not a text tutor (media/embedding/live/tts) and anything
// preview/experimental, which carry separate and much tighter free-tier limits.
const MODEL_REJECT = /embedding|aqa|imagen|veo|image|audio|tts|live|native|thinking|exp|preview/i;

// Last resort only: ranks a listing when the key reaches nothing on either ladder above.
// Ordered the same way the ladders are -- lite first, "latest" last.
function scoreModel(name) {
  if (MODEL_REJECT.test(name)) return -1;
  let s = 0;
  if (/flash/i.test(name)) s += 100;          // free-tier workhorse
  else if (/pro/i.test(name)) s += 60;
  else return -1;
  if (/lite/i.test(name)) s += 30;            // 25x the daily quota; see the table above
  if (/latest/i.test(name)) s -= 40;          // hot-swapped by Google -- never chosen on purpose
  const v = name.match(/gemini-(\\d+)\\.(\\d+)/);
  if (v) s += Math.min(20, parseInt(v[1], 10) * 4 + parseInt(v[2], 10));
  if (/-\\d{3,}$/.test(name)) s -= 10;          // dated snapshot: prefer the alias
  return s;
}

// Which pool a turn draws from, and where in it. Both live on the same ref the transport
// already threads through rawCall, so none of this reaches the five call sites.
//
// A model that has spent its quota stays spent for the rest of the session. Without that the
// extension phase would re-seat at the top of the chat ladder and burn a retry cycle on a
// model already known to be exhausted, on every remaining turn.
const spentModels = {};

function seatLadder(ref, ladder) {
  if (ref.ladder !== ladder) { ref.ladder = ladder; ref.i = 0; }
  while (ref.i < ladder.length - 1 && spentModels[ladder[ref.i]]) ref.i++;
  ref.current = ladder[ref.i];
}

// Set by the component so a mid-session switch reaches the connection light. Module scope
// for the same reason apiKeyRef is: rawCall is not inside the component.
const onModelSwitch = { fn: null };

function nextModel(ref) {
  const lad = ref.ladder || MODEL_FALLBACKS;
  if (ref.i === undefined) ref.i = Math.max(0, lad.indexOf(ref.current));
  if (ref.i >= lad.length - 1) return false;
  ref.i++;
  ref.current = lad[ref.i];
  if (onModelSwitch.fn) { try { onModelSwitch.fn(ref.current); } catch (e) {} }
  return true;
}

// Module-scope holder for the cadet's key. Threading it through rawCall/callTutor and
// their five call sites would mean five more edit points in a 2,000-line file; this is
// one. Written from the start screen, read only by rawCall -- never serialized, never
// logged, and never reachable from the report or the submit URL (asserted at build).
const apiKeyRef = { current: "" };

// localStorage key, namespaced like the site's other client-side state.
const KEY_STORE = "prep.gemini.apikey";""",
        "constants -> Gemini + runtime discovery")

    # ── 2. rawCall -> Gemini transport ────────────────────────────────────────
    p.sub1(
        rb"async function rawCall\(activeModelRef, body, \{ retries = 3 \} = \{\}\) \{.*?\r\n\}\r\n",
        b"""async function rawCall(activeModelRef, body, { retries = 3 } = {}) {
  let attempt = 0;
  while (true) {
    let res;
    try {
      // The key rides in a HEADER, not the "?key=" query parameter Google's quickstarts
      // use. A query string lands in browser history and in any Referer the page emits;
      // a header does neither. Same authentication, strictly less leakage.
      res = await fetch(
        GEMINI_BASE + "/models/" + activeModelRef.current + ":generateContent", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKeyRef.current,
          },
          body: JSON.stringify(body),
        });
    } catch (e) {
      if (attempt < retries) { await sleep(backoffMs(attempt)); attempt++; continue; }
      throw { kind: "network", status: 0 };
    }
    if (res.ok) return res;
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw { kind: "auth", status: res.status };   // bad, missing, or unauthorized key
    }
    if (res.status === 404) {                       // model unavailable -> next rung
      if (nextModel(activeModelRef)) { attempt = 0; continue; }
      throw { kind: "model", status: 404 };
    }
    // 429 is Gemini's rate-limit AND its daily-quota code, and the response does not say
    // which. Retry first: a per-MINUTE limit clears in about a minute and the same model is
    // still the right one. If it survives the retries it is the per-DAY cap, which will not
    // clear today -- so move DOWN THE LADDER instead of ending the cadet's session. Free-tier
    // quota is per model, so the next rung is a fresh allowance; only an exhausted ladder is
    // fatal. Before 2026-08-20 this retried the one model and then gave up, which stranded a
    // cadet at 20 requests while 500 sat unused one rung down.
    if (res.status === 429) {
      if (attempt < retries) { await sleep(backoffMs(attempt)); attempt++; continue; }
      spentModels[activeModelRef.current] = true;
      if (nextModel(activeModelRef)) { attempt = 0; continue; }
      throw { kind: "quota", status: 429 };
    }
    // Server capacity, not the cadet's quota. Nothing to switch to -- wait it out.
    if (res.status === 529 || res.status >= 500) {
      if (attempt < retries) { await sleep(backoffMs(attempt)); attempt++; continue; }
      throw { kind: "capacity", status: res.status };
    }
    throw { kind: "request", status: res.status };
  }
}

// Ask the cadet's own key which models it can actually reach. Doubles as the key check.
async function discoverModel(activeModelRef) {
  let res;
  try {
    res = await fetch(GEMINI_BASE + "/models?pageSize=200",
      { headers: { "x-goog-api-key": apiKeyRef.current } });
  } catch (e) {
    throw { kind: "network", status: 0 };
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw { kind: "auth", status: res.status };
  }
  if (!res.ok) throw { kind: "request", status: res.status };
  const data = await res.json();
  const reachable = (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).indexOf("generateContent") > -1)
    .map((m) => String(m.name || "").replace(/^models\\//, ""));
  const have = {};
  reachable.forEach((n) => { have[n] = true; });

  // Scored ordering of whatever this key CAN reach. Used only where a ladder comes back
  // empty -- i.e. Google renamed everything we know about. Without it a wholesale rename
  // dead-ends the build, which is the failure runtime discovery exists to prevent.
  const scored = reachable
    .map((n) => ({ n: n, s: scoreModel(n) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.n);

  const chat = MODEL_CHAT.filter((n) => have[n]);
  const report = MODEL_REPORT.filter((n) => have[n]);
  if (!chat.length && !scored.length) throw { kind: "model", status: 404 };
  MODEL_CHAT = chat.length ? chat : scored;
  MODEL_REPORT = report.length ? report : MODEL_CHAT;

  activeModelRef.ladder = null;             // force a re-seat onto the filtered list
  seatLadder(activeModelRef, MODEL_CHAT);
  return activeModelRef.current;
}
""",
        "rawCall -> Gemini + discoverModel")

    # ── 3. callTutor -> Gemini request/response shape ─────────────────────────
    p.sub1(
        # Whitespace-tolerant between tokens, because the two dialects wrap this block
        # differently: the kit puts the rawCall arguments and the whole .filter/.map/.join/.trim
        # chain each on ONE line, and PHYS 110's builds wrap both across several. `\s*` spans a
        # newline plus its indent, so one pattern covers both without a second copy. The tokens
        # themselves are still matched exactly -- this loosens the LAYOUT, never the CONTENT,
        # and the grounding-block assertion after the transforms still has to pass.
        rb"  const res = await rawCall\(activeModelRef, \{\s*max_tokens: MAX_TOKENS, system: sys, messages: sendHistory,?\s*\}\);\r\n"
        rb"  const data = await res\.json\(\);\r\n"
        rb'  const text = \(data\.content \|\| \[\]\)\s*\.filter\(\(b\) => b\.type === "text"\)\s*\.map\(\(b\) => b\.text\)\s*\.join\("\\n"\)\s*\.trim\(\);\r\n'
        rb"  if \(!text\) throw \{ kind: \"request\", status: 0 \};\r\n"
        rb"  return text;",
        b"""  // Gemini's shape: roles are user|model (not user|assistant), each turn's text nests
  // under parts[], and the system prompt is its own top-level object.
  const contents = sendHistory.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const res = await rawCall(activeModelRef, {
    systemInstruction: { parts: [{ text: sys }] },
    contents: contents,
    generationConfig: { maxOutputTokens: MAX_TOKENS },
  });
  const data = await res.json();
  const cand = (data.candidates || [])[0];
  const text = ((cand && cand.content && cand.content.parts) || [])
    .map((p) => p.text || "").join("").trim();
  if (!text) {
    // A blocked prompt or a MAX_TOKENS stop returns 200 with no usable text. Surface it
    // rather than showing the cadet an empty tutor turn.
    const why = (cand && cand.finishReason)
      || (data.promptFeedback && data.promptFeedback.blockReason);
    throw {
      kind: (why === "SAFETY" || why === "PROHIBITED_CONTENT") ? "blocked" : "request",
      status: 0,
    };
  }
  return text;""",
        "callTutor -> Gemini shape")

    # ── 4. Error messages (real JS string literals: \\u escapes are correct) ───
    p.sub1(
        rb'    case "model":\r\n'
        rb'      return "The tutor model isn\'t available to this account\. Try a different Claude account, or tell your instructor the preflight may need an updated model\.";',
        b"""    case "auth":
      return "That API key was rejected. Check you pasted the whole key from Google AI Studio (it starts with \\u201CAIza\\u201D), and that the Generative Language API is enabled for it.";
    case "quota":
      return "Your Gemini free-tier quota is used up for now. A per-minute limit clears in about a minute; the daily one resets on Google's clock. Wait and Retry.";
    case "blocked":
      return "Gemini declined to answer that turn. Rephrase and try again \\u2014 and tell your instructor if it keeps happening.";
    case "model":
      return "No usable Gemini model was found for this key. Tell your instructor \\u2014 the model list may have moved again.";""",
        "error messages -> Gemini")

    # -- 4b. The capacity message still named Claude --------------------------
    # Step 4 above replaced the `model` case but left `capacity`, which on the GEMINI
    # build told a cadet to blame "a free Claude account" and go use a different one.
    # Wrong twice over: `capacity` is thrown only for 529/5xx (a 429 becomes `quota`),
    # so it is Google's server rather than the cadet's account, and there is no second
    # account to move to -- the key is theirs. Its own sub1, so a reworded source fails
    # loudly here instead of quietly shipping the old text again.
    p.sub1(
        rb"        \? \"The tutor service is at capacity right now and didn't free up after several tries\. On a free Claude account this can be a usage/capacity limit that resets later \xe2\x80\x94 wait a bit and Retry, or use a different account\.\"",
        b'        ? "Google\'s tutor service is busy right now and didn\'t free up after several tries. That is Google\'s capacity, not your quota and not your key. Wait a few minutes and Retry."',
        "capacity message -> Gemini")

    # ── 5. Component state: the key, remembered on this device only ───────────
    # Asked for directly ("so they only have to enter it once"). localStorage keeps it on
    # the cadet's machine: the site never receives it, so PREP never becomes the custodian
    # of hundreds of third-party credentials. Cost: a new device means re-entering, and
    # Safari's ITP drops it after 7 days without a visit. "Forget" exists for shared machines.
    p.sub1(
        # Trailing comment optional: the kit writes "// holds the last name; do NOT rename"
        # here and PHYS 110's builds write nothing. `[^\r\n]*` covers both without a second
        # pattern, and the declaration itself is still matched exactly.
        rb'  const \[cadetId, setCadetId\] = useState\(""\);[^\r\n]*\r\n',
        b"""  const [cadetId, setCadetId] = useState("");      // holds the last name; do NOT rename

  // Leaves this device only as an x-goog-api-key header to Google, and is remembered only
  // in this browser's localStorage. Never sent to PREP, never written to the database,
  // never in the report or the submit URL.
  const [apiKey, setApiKey] = useState(() => {
    try { return localStorage.getItem(KEY_STORE) || ""; } catch (e) { return ""; }
  });
  const [keyRemembered, setKeyRemembered] = useState(() => {
    try { return !!localStorage.getItem(KEY_STORE); } catch (e) { return false; }
  });
  function forgetKey() {
    try { localStorage.removeItem(KEY_STORE); } catch (e) {}
    setKeyRemembered(false); setApiKey("");
  }
""",
        "apiKey state + localStorage")

    p.sub1(
        # Same difference, same fix — see the note on the cadetId anchor above.
        rb"  const activeModelRef = useRef\(MODEL_CANDIDATES\[0\]\);[^\r\n]*",
        b"""  const activeModelRef = useRef(MODEL_CHAT[0]);        // replaced by discoverModel()
  const [modelName, setModelName] = useState("");          // shown on the start screen
  useEffect(() => { apiKeyRef.current = apiKey.trim(); }, [apiKey]);""",
        "model ref + key wiring")

    # ── 6. checkConnection -> validate the key, then discover a model ─────────
    p.sub1(
        # `\s*` at every argument boundary. The kit writes `rawCall(activeModelRef,` and closes
        # with `{ retries: 0 });`; PHYS 110 puts activeModelRef on its own line and the closing
        # paren on another. Layout only -- the arguments themselves are still matched exactly,
        # so a build whose ping call differs in SUBSTANCE still fails here.
        rb"  async function checkConnection\(\) \{\r\n"
        rb'    setConnStatus\("checking"\); setConnMsg\(""\);\r\n'
        rb"    try \{\r\n"
        rb"      await rawCall\(\s*activeModelRef,\s*"
        rb'\{ max_tokens: 1, messages: \[\{ role: "user", content: "ping" \}\] \},\s*'
        rb"\{ retries: 0 \}\s*\);\r\n"
        rb'      setConnStatus\("ok"\); setConnMsg\(""\);\r\n'
        rb"    \} catch \(err\) \{\r\n"
        rb'      setConnStatus\("unavailable"\); setConnMsg\(errorMessage\(err, \{ afterRetries: true \}\)\);\r\n'
        rb"    \}\r\n"
        rb"  \}\r\n"
        rb"  useEffect\(\(\) => \{ checkConnection\(\); \}, \[\]\);[^\r\n]*",
        b"""  async function checkConnection() {
    if (!apiKey.trim()) {
      setConnStatus("unavailable"); setModelName("");
      setConnMsg("Paste your Gemini API key to check access.");
      return;
    }
    setConnStatus("checking"); setConnMsg("");
    try {
      apiKeyRef.current = apiKey.trim();
      const picked = await discoverModel(activeModelRef);
      setModelName(picked);
      // A mid-session ladder move updates the light too, so a cadet who is asked
      // what happened can read the model off the page instead of guessing.
      onModelSwitch.fn = setModelName;
      setConnStatus("ok"); setConnMsg("");
      // Only a key that actually worked is remembered -- never a typo.
      try { localStorage.setItem(KEY_STORE, apiKey.trim()); setKeyRemembered(true); } catch (e) {}
    } catch (err) {
      setConnStatus("unavailable"); setModelName("");
      setConnMsg(errorMessage(err, { afterRetries: true }));
    }
  }
  // Unlike the Claude build this cannot ping on mount -- there is no key yet. It runs when
  // the cadet stops typing one (debounced), and on demand from Re-check.
  useEffect(() => {
    const k = apiKey.trim();
    if (!k) {
      setConnStatus("unavailable"); setModelName("");
      setConnMsg("Paste your Gemini API key to check access.");
      return;
    }
    const t = setTimeout(() => { checkConnection(); }, 600);
    return () => clearTimeout(t);
  }, [apiKey]);""",
        "checkConnection -> key + discovery")

    # ── 7. Start screen: the API key field (JSX text/attrs -> entities, ASCII) ─
    p.sub1(
        rb'                onKeyDown=\{\(e\) => \{ if \(e\.key === "Enter" && cadetId\.trim\(\)\) begin\(\); \}\}\r\n'
        rb"              />\r\n"
        rb'              <button className="start-btn" onClick=\{begin\} disabled=\{!cadetId\.trim\(\)\}>\r\n'
        rb"                Start Preflight \xe2\x86\x92\r\n"
        rb"              </button>\r\n"
        rb'              <button className="study-btn" onClick=\{beginStudy\}>\r\n',
        b"""              />
              <label className="field-label" htmlFor="api-key" style={{ marginTop: "10px" }}>
                Gemini API key
              </label>
              <input
                id="api-key"
                className="field-input"
                type="password"
                placeholder="AIza..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
                spellCheck="false"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && cadetId.trim() && connStatus === "ok") begin();
                }}
              />
              <p className="study-hint" style={{ marginTop: "6px", marginBottom: "10px" }}>
                Get a free key at <strong>aistudio.google.com/apikey</strong>, on a project with
                <strong> no billing enabled</strong> &mdash; then the worst a lost key can cost you
                is quota. It is sent only to Google, as a request header, and is remembered only in
                this browser. PREP never receives it, and it is never part of your report or your
                submit link.
              </p>
              <button className="start-btn" onClick={begin}
                      disabled={!cadetId.trim() || connStatus !== "ok"}>
                Start Preflight &rarr;
              </button>
              <button className="study-btn" onClick={beginStudy} disabled={connStatus !== "ok"}>
""",
        "API key field")

    # ── 8. Connection light label (inside {} -> JS strings, \\u is correct) ────
    p.sub1(
        rb' *\{connStatus === "checking" \? "Checking tutor access\xe2\x80\xa6"\r\n'
        rb' *: connStatus === "ok" \? "Tutor model reachable"\r\n'
        rb' *: "Tutor unavailable"\}',
        b"""                {connStatus === "checking" ? "Checking your key\\u2026"
                  : connStatus === "ok" ? ("Ready \\u2014 " + modelName)
                  : "Not connected"}""",
        "connection light label")

    # A Forget control beside Re-check, shown only when a key is actually stored.
    p.sub1(
        rb" *Re-check\r\n"
        rb" *</button>\r\n",
        b"""                Re-check
              </button>
              {keyRemembered && (
                <button className="conn-recheck" onClick={forgetKey}
                        title="Remove the saved key from this browser">
                  Forget key
                </button>
              )}
""",
        "Forget key control")

    # ── 9. Defer the two tail blocks until the phase that needs them ──────────
    # The graded system prompt is ~63,000 chars resent EVERY turn -- 93-96% of all input
    # tokens in a session, which is what exhausts a free-tier key after two runs. Gemini
    # caching cannot help (explicit caching needs a paid account and a 32,768-token floor,
    # and rate limits count cached tokens either way), so the only lever is sending less.
    #
    # EXTENSION_PROBLEMS and REPORT_FORMAT are ~11,400 chars -- about 18% of every turn --
    # and neither is needed while the tutor is still probing topics. Both sit at the very
    # TAIL of the prompt, which is why they can be dropped without disturbing a line above.
    p.sub1(
        rb"function buildSystemPrompt\(cadetId, localTime\) \{",
        b"""// phase: "probe" (default) | "report" | "extension" -- see sysFor() in the component.
function buildSystemPrompt(cadetId, localTime, phase) {""",
        "buildSystemPrompt takes a phase")

    # The kit precedes ${REPORT_FORMAT} with a label line; PHYS 110's builds go straight to it.
    # That line is part of what the TUTOR reads, so it is carried through exactly as found --
    # never added to a build that did not have it, and never dropped from one that did.
    LABEL = b"OUTPUT_REPORT_FORMAT (produce exactly this structure):"
    has_label = LABEL in p.src
    label_pat = (rb"OUTPUT_REPORT_FORMAT \(produce exactly this structure\):\r\n"
                 if has_label else rb"")
    label_repl = (b'"\\nOUTPUT_REPORT_FORMAT (produce exactly this structure):\\n" + REPORT_FORMAT'
                  if has_label else b'"\\n" + REPORT_FORMAT')
    p.sub1(
        rb"\$\{TEXTBOOK_REFERENCE\}\r\n"
        rb"\r\n"
        rb"\$\{LESSON_CONFIG\}\r\n"
        rb"\r\n"
        rb"\$\{EXTENSION_PROBLEMS\}\r\n"
        rb"\r\n"
        + label_pat +
        rb"\$\{REPORT_FORMAT\}`;\r\n"
        rb"\}",
        b"""${TEXTBOOK_REFERENCE}

${LESSON_CONFIG}
${phase === "extension" ? "\\n" + EXTENSION_PROBLEMS + "\\n" : ""}\\
${phase === "probe" || !phase
    ? ""
    : """ + label_repl + b"""}`;
}""",
        "tail blocks made conditional")

    # WHERE to put INTEGRITY_ASKED depends on the dialect. The kit names the report marker as
    # a constant and this hangs off it; PHYS 110's builds inline the same literal inside
    # isReportMsg and define no such constant. Anchor on whichever exists, and re-emit that
    # line unchanged so nothing is lost either way.
    #
    # The INJECTED code must then not name REPORT_MARKER either, and did until 2026-08-19:
    # the detector below read `m.content.includes(REPORT_MARKER)`, which is a free variable in
    # the PHYS 110 dialect. All five PHYS 110 builds shipped and threw
    # `ReferenceError: REPORT_MARKER is not defined` on the first assistant turn, where the
    # page's window.onerror handler replaced the whole lesson with 'This backup build did not
    # load'. Nothing caught it because the reference is inside a useEffect that returns early
    # until a graded conversation is under way -- so the build parses, renders, and passes
    # every check this repo has, then dies in front of a cadet.
    #
    # It calls `isReportMsg(content)` instead. Every one of the 51 cached sources defines it as
    # a top-level function declaration, so it is hoisted and dialect-independent, and it is the
    # source's OWN answer to 'is this the report' rather than a second copy of that judgment.
    MARKER_CONST = b'const REPORT_MARKER = "# JiTT Conversation Report";'
    ISREPORT_FN = (b'function isReportMsg(content) '
                   b'{ return content.includes("# JiTT Conversation Report"); }')
    if MARKER_CONST in p.src:
        anchor, keep = re.escape(MARKER_CONST), MARKER_CONST
    elif ISREPORT_FN in p.src:
        anchor, keep = re.escape(ISREPORT_FN), ISREPORT_FN
    else:
        raise SystemExit("no report-marker anchor - cannot place INTEGRITY_ASKED")
    p.sub1(
        anchor,
        keep + b"""

// The close sequence is fixed by the tutor prompt: summary -> the integrity question, which
// it must ask VERBATIM and then WAIT for -> the report. So seeing that question means the
// report is at most one turn away, and the mandated wait is what guarantees the lead time
// needed to put REPORT_FORMAT back in context before it is used. Two alternates, because a
// model that lightly rewords the opener still says the rest.
const INTEGRITY_ASKED =
  /one last thing before I put together your report|did you receive any outside help during this conversation/i;""",
        "integrity-question fingerprint")

    p.sub1(
        # Alignment spaces and the trailing comment are both optional: the kit writes one
        # space and a comment, PHYS 110 pads to a column and writes none.
        rb'  const sysRef *= useRef\(""\);[^\r\n]*\r\n',
        b"""  const sysRef = useRef("");        // study mode's prompt, and the graded opener
  const sysArgsRef = useRef(null);  // { cadetId, localTime } -- graded only
  const reportPhaseRef = useRef(false);

  // Compose the system prompt for the CURRENT phase instead of reusing one built at start.
  // Study mode is untouched: it needs its practice problems from turn one and never
  // produces a report, so it keeps the prompt built in startSession.
  function sysFor() {
    const a = sysArgsRef.current;
    // Belt and braces on the primary trigger: once the report exists we are in the
    // extension, and once active time passes the whole planned budget the close can arrive
    // at any turn -- so stop deferring rather than risk a report with no format.
    const overBudget =
      activeSecRef.current >= PROBE_TOPIC_COUNT * PER_TOPIC_BUDGET_MIN * 60;
    const phase = hasReport ? "extension"
      : (reportPhaseRef.current || overBudget) ? "report"
      : "probe";
    // The phase picks the MODEL POOL as well as the prompt, because they are the same
    // decision: the report is one request and gets the strongest model, while the ~12
    // conversation turns get the high-quota pool. This is the one place every ongoing turn
    // already passes through, so deciding both here is what stops them drifting apart.
    // Study mode falls out below with no args, but is seated on the chat pool first.
    seatLadder(activeModelRef, phase === "report" ? MODEL_REPORT : MODEL_CHAT);
    if (!a) return sysRef.current;
    return buildSystemPrompt(a.cadetId, a.localTime, phase);
  }
""",
        "sysFor() phase composer")

    p.sub1(
        rb"    const sys = selectedMode === \"graded\"\r\n"
        rb"      \? buildSystemPrompt\(cadetId\.trim\(\), new Date\(\)\.toLocaleString\(\)\)\r\n"
        rb"      : buildStudySystemPrompt\(\);\r\n"
        rb"    sysRef\.current = sys;\r\n",
        b"""    const localTime = new Date().toLocaleString();
    const sys = selectedMode === "graded"
      ? buildSystemPrompt(cadetId.trim(), localTime, "probe")
      : buildStudySystemPrompt();
    sysRef.current = sys;
    sysArgsRef.current = selectedMode === "graded"
      ? { cadetId: cadetId.trim(), localTime: localTime }
      : null;
    reportPhaseRef.current = false;
""",
        "startSession records the prompt args")

    # Every ongoing turn composes for its phase. (The opener deliberately still uses `sys`.)
    p.sub1(rb"callTutor\(activeModelRef, history, sysRef\.current,",
           b"callTutor(activeModelRef, history, sysFor(),",
           "3 callTutor sites use sysFor()", count=3)

    p.sub1(
        rb"  useEffect\(\(\) => \{\r\n"
        rb"    if \(mode !== \"graded\" \|\| hasReport\) return;\r\n",
        b"""  // Phase trigger. Runs before the report-detection effect below and on the same
  // messages, so the format is restored one turn ahead of the report that needs it.
  useEffect(() => {
    if (mode !== "graded" || reportPhaseRef.current) return;
    const m = messages[messages.length - 1];
    if (!m || m.role !== "assistant") return;
    if (INTEGRITY_ASKED.test(m.content) || isReportMsg(m.content)) {
      reportPhaseRef.current = true;
    }
  }, [messages, mode]);

  useEffect(() => {
    if (mode !== "graded" || hasReport) return;
""",
        "integrity-question detector")

    # ── 10. lz-string from our own origin, same pinned 1.5.0 ──────────────────
    p.sub1(
        rb'const LZSTRING_JS = "https://cdnjs\.cloudflare\.com/ajax/libs/lz-string/1\.5\.0/lz-string\.min\.js";',
        b'const LZSTRING_JS = "' + VENDOR_LZ.encode() + b'";   // vendored 1.5.0, byte-identical',
        "lz-string served from our origin")

    # ── 11. Strip the backup button, if the source carries one ────────────────
    # A Claude artifact offers this button when ITS connection check fails. In a backup
    # build the same button would point the cadet at the router that sent them here, and
    # the router would send them straight back -- a loop offered to someone already stuck.
    # When Gemini fails here it is the cadet's own key or quota, and errorMessage already
    # says which and what to do about it.
    #
    # Optional rather than required, so this tool does not care whether it runs before or
    # after add_backup_button.py. Artifacts built by the factory from now on arrive with
    # the button already in them, which makes "after" the normal case.
    p.strip_optional(
        rb'            \{connStatus === "unavailable" && \(\r\n'
        rb'              <div className="backup-row">.*?\r\n'
        rb"            \)\}\r\n",
        b"", "backup button stripped")
    p.strip_optional(
        rb"\r\n"
        rb"  /\* Backup-version button\. Navy outline.*?\r\n"
        rb"  \.backup-hint \{[^\r\n]*\}",
        b"", "backup CSS stripped")
    p.strip_optional(
        rb"\r\n"
        rb"\r\n"
        rb"// Backup transport, offered only when the connection check fails\..*?\r\n"
        rb'  "https://dfpm-physics\.github\.io/Core_Preflights/site/student/backup\.html";',
        b"", "BACKUP_ENDPOINT stripped")

    # ── 11b. The claude-in-claude auth warning INVERTS under this port ─────────
    # In the Claude artifact this comment is correct and load-bearing: claude.ai injects the
    # cadet's own credentials, so ANY auth header breaks the pattern outright, and
    # check_artifact.py fails a build containing `x-api-key`, `Bearer` or `anthropic-version`.
    # Ported to Gemini the rule reverses — this build supplies the cadet's key on purpose — so
    # the inherited comment ends up sitting directly above a page that has the very API-key
    # field it forbids. It is inert, being a comment, but the generated page is PUBLIC and a
    # cadet reading source finds a line contradicting the code around it.
    #
    # strip_optional rather than sub1: this block is the Claude factory's wording, and an
    # older or hand-patched artifact that does not carry it verbatim should not abort a run
    # over a comment. A miss is logged as `not present` rather than passing silently.
    # The banner rules are box-drawing U+2550 and the title carries an em dash, so an ASCII
    # `=+` / `-` pattern matches nothing and strip_optional reports `not present` — a silent
    # miss, which is the failure mode this whole tool is written to avoid. Match the bytes.
    p.strip_optional(
        rb"// (?:\xe2\x95\x90)+\r\n"
        rb"// API PLUMBING[^\r\n]*\r\n"
        rb"//\r\n"
        rb"// Every call carries ONLY \"Content-Type: application/json\"\..*?"
        rb"// those breaks the claude-in-claude pattern outright\.\r\n"
        rb"// (?:\xe2\x95\x90)+",
        b"""// ===========================================================================
// API PLUMBING -- Gemini, with the cadet's own key
//
// THIS IS THE ONE RULE THE PORT REVERSES. The published Claude artifact carries the
// opposite instruction, and it is correct there: claude.ai injects the signed-in
// cadet's credentials, so adding any auth header breaks the claude-in-claude pattern
// outright. Do not carry that rule back here, and do not carry this one over there.
//
// Here the cadet supplies their own free-tier Gemini key. It rides in an
// x-goog-api-key HEADER, never the ?key= query string Google's quickstarts use --
// a query string lands in browser history and in any Referer the page emits.
//
// The key lives in a module-scope ref and in localStorage, and PREP never receives
// it: the generator asserts the key never appears on a line that builds the submit
// URL or the compressed payload, and refuses rather than warns.
// ===========================================================================""",
        "claude-in-claude auth comment -> Gemini")

    # ── 12. Header banner (a comment -> ASCII only) ───────────────────────────
    p.sub1(
        rb'import React, \{ useState, useRef, useEffect \} from "react";\r\n',
        b"""import React, { useState, useRef, useEffect } from "react";

// ========================== GEMINI BACKUP BUILD =============================
// Generated by scripts/artifacts/to_gemini.py from the published Claude artifact.
// DO NOT EDIT BY HAND -- regenerate instead, or the next run overwrites you.
//
// Every difference from the Claude build is in the TRANSPORT:
//   * calls Google's Generative Language API with the CADET'S OWN free-tier key
//   * the key rides in an x-goog-api-key header, never a query string
//   * the model is discovered at runtime from the key, not baked in
//   * 429 (Gemini's rate-limit AND daily-quota code) is retried, then reported
//   * the two tail prompt blocks are deferred until the phase that needs them
//
// The tutor prompt, the four grounding blocks, the report format, the schema:1
// payload, SUBMIT_ENDPOINT and INTERACTION_ID are byte-identical to the published
// build -- asserted by the generator, which refuses rather than warns.
// ============================================================================
""",
        "header banner")

    # ── Assertions. These refuse; they do not warn. ───────────────────────────
    for name, want in before.items():
        if p.grab(name) != want:
            raise SystemExit(f"grounding block {name.decode()} was altered - aborting")

    for m in re.finditer(rb"apiKey", p.src):
        ls = p.src.rfind(b"\n", 0, m.start()) + 1
        line = p.src[ls:p.src.find(b"\n", m.start())]
        if any(t in line for t in (b"compressToEncodedURIComponent", b"submitUrl",
                                   b"JSON.stringify(structured", b"SUBMIT_ENDPOINT")):
            raise SystemExit(f"API key reachable from the payload: {line!r}")

    # The fourth copy of this assumption in scripts/artifacts/, and the last. A substring test
    # for `const INTERACTION_ID = "<slug>";` requires the declaration on one line; PHYS 110's
    # builds wrap it, so this fired on five artifacts whose slug had not changed at all -- after
    # every transform had run correctly. The check itself still matters and is unchanged in
    # substance: the slug present in the OUTPUT must be the slug we were asked to port, because
    # a build that submits under a different one splits a lesson's cohort silently.
    if not re.search(rb'^const INTERACTION_ID\s*=\s*"' + re.escape(slug.encode()) + rb'"\s*;',
                     p.src, re.M):
        raise SystemExit("INTERACTION_ID changed")
    if b"https://dfpm-physics.github.io/Core_Preflights/site/student/interaction-submit.html" not in p.src:
        raise SystemExit("SUBMIT_ENDPOINT changed")
    if b"api.anthropic.com" in p.src or b"MODEL_CANDIDATES" in p.src:
        raise SystemExit("Anthropic transport still present")
    if b"BACKUP_ENDPOINT" in p.src or b"backup-btn" in p.src:
        raise SystemExit("backup button survived into a backup build - it would loop")

    # Every name the INJECTED code calls must be declared somewhere in the OUTPUT.
    #
    # REPORT_MARKER was not, in the PHYS 110 dialect, and all five builds shipped. The reference
    # sat inside a useEffect that returns early until a graded conversation is under way, so the
    # build parsed, rendered, and passed every assertion above before throwing
    # `ReferenceError: REPORT_MARKER is not defined` in front of a cadet on the first tutor turn
    # -- where the page's window.onerror handler replaces the whole lesson with "This backup
    # build did not load". Reported by the course director, 2026-08-19.
    #
    # Reading the injected code could never have caught it: the injected code is correct against
    # the dialect it was written for. Only the OUTPUT knows whether a name resolves. So the check
    # is here, it is by declaration rather than by mention (a mention is what the bug WAS), and it
    # refuses. Add a line whenever the injected code starts calling something new.
    INJECTED_CALLS = {
        "isReportMsg":            rb"function isReportMsg\s*\(",
        "buildSystemPrompt":      rb"function buildSystemPrompt\s*\(",
        "buildStudySystemPrompt": rb"function buildStudySystemPrompt\s*\(",
        "activeSecRef":           rb"const activeSecRef\s*=",
        "PROBE_TOPIC_COUNT":      rb"const PROBE_TOPIC_COUNT\s*=",
        "PER_TOPIC_BUDGET_MIN":   rb"const PER_TOPIC_BUDGET_MIN\s*=",
        "REPORT_FORMAT":          rb"const REPORT_FORMAT\s*=",
        "EXTENSION_PROBLEMS":     rb"const EXTENSION_PROBLEMS\s*=",
    }
    for nm, decl in INJECTED_CALLS.items():
        if not re.search(decl, p.src):
            raise SystemExit(
                f"injected code calls {nm} but this build never declares it - that is the "
                "REPORT_MARKER failure: it parses, renders, and throws mid-lesson")

    if verbose:
        for line in p.log:
            print(f"      ok  {line}")
    return p.src, component, p.nl


# ══════════════════════════════════════════════════════════════════════════════
# Browser wrapper
# ══════════════════════════════════════════════════════════════════════════════

PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="referrer" content="no-referrer">
<!-- Not a security control. The exposure here is the same one the published Claude artifact
     already carries; this only keeps worked extension problems out of a search index. -->
<meta name="robots" content="noindex, nofollow">
<title>__TITLE__ &mdash; backup &mdash; PREP</title>

<!-- React + in-browser JSX, served from OUR OWN ORIGIN rather than a CDN.
     Two reasons, and the second is the load-bearing one:
       1. CORE.md section 2 forbids a build step on the shipped site. Compiling the JSX in
          the browser keeps the generator stdlib-Python and adds no toolchain to the deploy.
       2. This page holds the cadet's Google API key in localStorage. A CDN that served a
          modified script could read it. Same-origin static files cannot be swapped by a
          third party, which is a stronger guarantee than an SRI hash and needs no pinning.
     Cost: ~3 MB on first visit, then cached, shared by every backup build. -->
<script src="../../vendor/react.production.min.js"></script>
<script src="../../vendor/react-dom.production.min.js"></script>
<script src="../../vendor/babel.min.js"></script>
<style>
  /* The artifact sizes .app to the full window.innerHeight inline, because on claude.ai it
     renders inside an auto-sizing embed where anything viewport-relative creates a
     measure->grow loop. Re-hosted on a normal page that assumption is wrong: a banner above
     it makes the document innerHeight + banner tall, so the PAGE scrolls and the app scrolls
     inside it, with the composer pushed below the fold.
     Fixed here, in the wrapper, without touching a line of the artifact: the page is a
     non-scrolling flex column and .app is forced to fill exactly what is left. The
     !important is what neutralises the artifact's inline height, which is the intent. */
  html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#eef1f5;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
  #page{display:flex;flex-direction:column;height:100vh;height:100dvh}
  #banner{flex:0 0 auto;background:#7c2d12;color:#fff;padding:7px 14px;
    font-size:12px;line-height:1.5}
  #banner strong{color:#fed7aa}
  #banner a{color:#fed7aa}
  #root{flex:1 1 auto;min-height:0;overflow:hidden}
  #root .app{height:100% !important;max-height:100% !important}
  #boot{padding:28px 20px;text-align:center;color:#64748b;font-size:13px}
  #boom{flex:0 0 auto;display:none;margin:14px;padding:14px;border-radius:10px;
        background:#fef2f2;border:1px solid #fecaca;color:#991b1b;font-size:13px;
        white-space:pre-wrap}
</style>
</head>
<body>
<div id="page">
  <div id="banner">
    <strong>BACKUP VERSION</strong> &mdash; __COURSE_LABEL__ __LESSON_LABEL__. Use this only when the
    Claude version is unavailable; <strong>the Claude version is still the intended path</strong> and
    this one is less polished. It runs on <strong>your own free Google AI Studio key</strong>, sent
    only to Google and remembered only in this browser. Your work submits to PREP exactly as normal
    and counts the same.
  </div>
  <div id="boom"></div>
  <div id="root"><div id="boot">Loading the lesson&hellip;</div></div>
</div>

<script type="text/babel" data-presets="react">
__ARTIFACT__

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(React.createElement(__COMPONENT__));
</script>
<script>
  // Babel parse errors land on window.onerror, not in the page. Surface them: publishing on
  // claude.ai is the only JSX parser the Claude path has, and for a backup build this page
  // is that parser -- so a silent blank screen is the failure mode to prevent.
  window.addEventListener("error", function (e) {
    var b = document.getElementById("boom");
    b.style.display = "block";
    b.textContent = "This backup build did not load:\\n\\n" + (e.message || e.error || e) +
      "\\n\\nTell your instructor and include this message.";
  });
</script>
</body>
</html>
"""


def wrap(jsx: bytes, component: str, title: str, course_label: str, lesson_label: str) -> bytes:
    body = jsx.replace(b'import React, { useState, useRef, useEffect } from "react";',
                       b"const { useState, useRef, useEffect } = React;", 1)
    body = re.sub(rb"export default function (\w+)\(\)", rb"function \1()", body, count=1)
    if b"export default" in body or re.search(rb"(^|\n)import ", body):
        raise SystemExit("module syntax remains - a Babel classic script would fail")

    html = PAGE.encode("utf-8")
    for k, v in (("__ARTIFACT__", body), ("__COMPONENT__", component.encode()),
                 ("__TITLE__", title.encode("utf-8")),
                 ("__COURSE_LABEL__", course_label.encode("utf-8")),
                 ("__LESSON_LABEL__", lesson_label.encode("utf-8"))):
        html = html.replace(k.encode(), v)
    return html.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")


# ══════════════════════════════════════════════════════════════════════════════
# Driver
# ══════════════════════════════════════════════════════════════════════════════

COURSE_LABELS = {"phys-215": "PHYS 215", "phys-110": "PHYS 110", "phys-310": "PHYS 310"}


def load_index(course):
    p = COURSES / course / "index.json"
    if not p.exists():
        raise SystemExit(f"no index.json for {course} - run sync_artifacts.py pull first")
    return json.loads(p.read_text(encoding="utf-8"))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--course")
    ap.add_argument("--all-courses", action="store_true")
    ap.add_argument("--slug")
    ap.add_argument("--lesson", type=int)
    ap.add_argument("--all", action="store_true", help="every artifact in the course")
    ap.add_argument("--from-lesson", type=int, help="every artifact with lesson_no >= N")
    ap.add_argument("--include-unpublished", action="store_true",
                    help="also build artifacts that were never published on claude.ai. The "
                         "public-exposure argument for these pages is that they carry no more "
                         "than the published Claude artifact already does -- which is not true "
                         "of an artifact nobody published. Needs a human's decision.")
    ap.add_argument("--commit", action="store_true", help="write; otherwise dry run")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args()

    courses = sorted(COURSE_LABELS) if a.all_courses else ([a.course] if a.course else [])
    if not courses:
        ap.error("need --course or --all-courses")

    manifest = {"schema": 1, "builds": {}}
    if MANIFEST.exists():
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    manifest.setdefault("builds", {})

    total = written = unchanged = 0
    for course in courses:
        if not (COURSES / course / "index.json").exists():
            continue
        idx = load_index(course)
        arts = idx.get("artifacts", [])
        picked = [r for r in arts
                  if (not a.slug or r["slug"] == a.slug)
                  and (a.lesson is None or r.get("lesson_no") == a.lesson)
                  and (a.from_lesson is None or (r.get("lesson_no") or 0) >= a.from_lesson)]
        if not (a.all or a.slug or a.lesson is not None or a.from_lesson is not None):
            ap.error("need --slug, --lesson, --from-lesson or --all")
        if not picked:
            print(f"{course}: nothing matched")
            continue

        held = [r for r in picked if not r.get("published_url")]
        if held and not a.include_unpublished:
            picked = [r for r in picked if r.get("published_url")]
            print(f"\n{course}: HOLDING {len(held)} unpublished artifact(s) - "
                  f"--include-unpublished to build anyway")
            for r in held:
                print(f"      held  {r['slug']}")

        print(f"\n=== {course}: {len(picked)} artifact(s) ===")
        for row in picked:
            slug, fn = row["slug"], row["file"]
            src_path = COURSES / course / "artifacts" / fn
            if not src_path.exists():
                print(f"  SKIP {slug}: no local source ({fn})")
                continue
            total += 1
            lesson_no = row.get("lesson_no")
            title = row.get("title") or slug
            lesson_label = f"Lesson {lesson_no}" if lesson_no else title

            src = src_path.read_bytes()
            jsx, component, nl = port(src, slug, verbose=a.verbose)
            html = wrap(jsx, component, title, COURSE_LABELS.get(course, course), lesson_label)

            out = OUT_ROOT / course / f"{slug}.html"
            same = out.exists() and out.read_bytes() == html
            state = "unchanged" if same else ("write" if a.commit else "WOULD WRITE")
            if same:
                unchanged += 1
            print(f"  {str(lesson_no or '-'):>3}  {slug:<62} {len(html):>8,} B  {state}")

            if a.commit and not same:
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(html)
                written += 1

            manifest["builds"][slug] = {
                "course": course,
                "lesson_no": lesson_no,
                "title": title,
                "path": f"gemini/{course}/{slug}.html",
            }

    print(f"\n{total} ported | {written} written | {unchanged} already current")
    if a.commit:
        MANIFEST.parent.mkdir(parents=True, exist_ok=True)
        manifest["builds"] = dict(sorted(manifest["builds"].items()))
        MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
                            encoding="utf-8")
        print(f"manifest: {MANIFEST.relative_to(REPO)} ({len(manifest['builds'])} builds)")
    else:
        print("dry run - nothing written. Re-run with --commit.")


if __name__ == "__main__":
    main()
