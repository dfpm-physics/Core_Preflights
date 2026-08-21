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

# ── the two conversation-ladder policies ─────────────────────────────────────
# TEACHING is the policy as of 2026-08-21 and the default. LEGACY reproduces the ordering the
# 38 live builds shipped with.
#
# This flag exists to DECOUPLE TWO CHANGES THAT LANDED IN ONE FILE, and it is meant to be
# short-lived. The freeze fix (request deadline + session restore) is a confirmed bug that has
# already cost a cadet real work, so it belongs on the live builds today. The ladder reorder is
# an improvement nobody is waiting on and is still out for faculty trial. Rebuilding the live
# set would otherwise ship both, because both are transforms in this one tool.
#
# The alternative -- hand-editing this file, porting, then putting it back -- would leave 38
# live builds matching NO committed state, which is precisely the provenance failure the rest
# of this repository is built to avoid. An explicit flag is reproducible; a temporary edit is
# not.
#
# DELETE `legacy` once the ladder ships to the live set. A flag kept past its occasion becomes
# a second supported configuration nobody is testing.
LADDER_TEACHING = b"""// Ordinary conversation turns: ~12 of the ~14 requests in a session. THIS IS THE TEACHING, and
// it now gets the strongest models the key can reach.
//
// It used to start on flash-lite to conserve quota, and on 2026-08-21 a cadet reported the
// result: "it would try to tutor me and then give me the answer instead of walking me through
// it." A lite model can open Socratically -- the prompt tells it to -- and then collapses into
// stating the answer, because holding that stance across ~12 turns under a ~70,000-char
// instruction is the reasoning-heavy part. The prompt was never the problem: every Socratic
// line survives the port at identical counts.
//
// The quota it was conserving was not under pressure. Peak use across the whole course was 22
// of flash-lite's 500 requests/day, while 3.7-flash sat at 23 of 20 -- over its cap -- because
// the REPORT was the only thing allowed to use it.
//
// A session is ~14 requests, so it fits inside ONE of these 20/day caps.
let MODEL_CHAT = [
  "gemini-3.7-flash",         //  5 RPM,  20 RPD -- a whole session fits inside one day's cap
  "gemini-3.6-flash",         //  5 RPM,  20 RPD
  "gemini-3.5-flash",         //  5 RPM,  20 RPD
].concat(MODEL_LITE);

// Study mode is UNGRADED practice a cadet may run as often as they like, and it produces no
// report and no grade. It must never spend the graded session's strong-model allowance, so it
// is pinned to the floor -- where 478 of 500 requests/day are going unused anyway.
let MODEL_STUDY = MODEL_LITE.slice();

// The report is ONE request per session and it is the graded artifact the cohort rollup reads,
// so it gets the strongest model the key has and can afford a 20/day cap. It falls through to
// the floor rather than failing: a report from a weaker model beats no report. Kept as its own
// array even though it now matches MODEL_CHAT -- seatLadder switches on array IDENTITY, and
// sharing one object would silently stop the report from re-seating.
let MODEL_REPORT = [
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
].concat(MODEL_LITE);"""

# Byte-for-byte the ordering the live builds shipped with -- written out in full rather than
# composed from MODEL_LITE, because MODEL_LITE ends on 2.5-flash and this list ends on it too:
# `MODEL_LITE.concat([...])` would put 2.5-flash THIRD and quietly reorder a live ladder while
# looking like a faithful reproduction.
LADDER_LEGACY = b"""// LEGACY ORDERING -- what the live builds shipped with, ordered by quota rather than by
// capability. Reproduced exactly so a rebuild carries the freeze fix and NOTHING else.
let MODEL_CHAT = [
  "gemini-3.5-flash-lite",    // 15 RPM, 500 RPD
  "gemini-3.1-flash-lite",    // 15 RPM, 500 RPD
  "gemini-3.5-flash",         //  5 RPM,  20 RPD -- from here down, one session's worth
  "gemini-3-flash",
  "gemini-2.5-flash",
];

// LEGACY: study shares the conversation pool, which is what the live builds do. Deliberately
// the SAME ARRAY, not a copy -- seatLadder switches on identity, so sharing the object is what
// makes a mode change a no-op, exactly as it behaved before MODEL_STUDY existed.
let MODEL_STUDY = MODEL_CHAT;

// The report is ONE request per session and it is the graded artifact the cohort rollup reads,
// so it gets the strongest model the key has and can afford a 20/day cap. It falls through
// into the chat pool rather than failing: a report from a weaker model beats no report.
let MODEL_REPORT = [
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
].concat(MODEL_CHAT);"""


def port(src: bytes, slug: str, verbose: bool = False, ladder: str = "teaching"):
    if ladder not in ("teaching", "legacy"):
        raise SystemExit(f"unknown ladder policy: {ladder}")
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

    # ── 0. The source must already carry the 2026-08-20 fix set ───────────────
    # Phase-deferred prompts and the 429 ladder walk were invented HERE, because for a while only
    # the Gemini builds needed them. On 2026-08-20 they moved into the Claude source itself
    # (scripts/artifacts/patch_artifacts.py) and this tool stopped performing them -- it now
    # INHERITS them and adds only what is genuinely Gemini-specific.
    #
    # So an unpatched source no longer ports. That is deliberate. Silently porting one would
    # produce a build with no phase deferral -- the exact token burn the deferral exists to
    # prevent -- and nothing downstream would report it. Failing here, with the remedy named, is
    # worth more than a build that looks fine and exhausts a cadet's key in two runs.
    if b"function buildSystemPrompt(cadetId, localTime, phase)" not in src:
        raise SystemExit(
            f"{slug}: source predates the 2026-08-20 fix set.\n"
            f"  Run: python scripts/artifacts/patch_artifacts.py --commit\n"
            f"  (re-pull from the artifact-sources bucket first if this cache is stale)")

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

// The high-quota floor. Nothing here is a good tutor; it is where a ladder ENDS, and until
// 2026-08-21 it was where the conversation ladder began.
const MODEL_LITE = [
  "gemini-3.5-flash-lite",    // 15 RPM, 500 RPD
  "gemini-3.1-flash-lite",    // 15 RPM, 500 RPD
  "gemini-2.5-flash",
];

__LADDER_BLOCK__

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

// One honoured retry-delay per model per session. Without the cap, a model whose per-minute
// window keeps closing would stall the cadet on a silent spinner over and over instead of
// dropping to a rung that has room.
const waitedFor = {};

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
const KEY_STORE = "prep.gemini.apikey";

// Every request gets a deadline. Until 2026-08-21 none of them did, and a cadet hit exactly
// the failure that implies: the tutor sat on "Tutor is typing..." at the report stage and
// never came back. `fetch` has no default timeout, so a connection Google accepts and never
// answers leaves the promise pending forever -- the `finally` that clears the spinner never
// runs, and the composer and Send button are both disabled while it is set. There was no way
// out but a reload, which erased the session.
//
// Two minutes, deliberately generous: a long report on a strong model genuinely can take a
// minute, and aborting a request that was about to succeed is worse than waiting. Not
// auto-retried either -- a silent second two-minute wait reads as the same freeze. It raises
// `timeout`, which the cadet sees with a Retry button and a transcript still intact.
const REQUEST_TIMEOUT_MS = 120000;

// Session persistence. The transcript used to live only in React state, so a reload -- the
// ONLY escape from the freeze above -- threw away the cadet's whole conversation, including
// one handed over from Claude. This keeps it in the same browser as the API key and nowhere
// else: never sent to PREP, never in the report, never in the submit URL.
// A FUNCTION, not a const. This block is emitted above `const INTERACTION_ID`, so building the
// key at module scope is a temporal dead zone -- "Cannot access 'INTERACTION_ID' before
// initialization", thrown before React mounts, which blanks the whole page. A function body
// runs after initialization, so the reference is only evaluated when a session is saved.
function sessionStore() { return "prep.gemini.session." + INTERACTION_ID; }

// Old enough to be a different sitting rather than a recovery. A cadet coming back the next
// day wants a fresh run, not yesterday's half-finished one silently resurrected.
const SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function saveSession(snap) {
  try { localStorage.setItem(sessionStore(), JSON.stringify(snap)); } catch (e) {}
}
function clearSession() {
  try { localStorage.removeItem(sessionStore()); } catch (e) {}
}
// Returns a snapshot only when it is unambiguously THIS cadet resuming THIS lesson in THIS
// mode. Anything else is discarded rather than repaired -- a partly-restored graded session
// would be submitted as though it were whole.
function loadSession(mode, cadetId) {
  try {
    const s = JSON.parse(localStorage.getItem(sessionStore()) || "null");
    if (!s || s.v !== 1 || s.id !== INTERACTION_ID) return null;
    if (s.mode !== mode) return null;
    if (mode === "graded" && String(s.cadetId || "") !== String(cadetId || "")) return null;
    if (!Array.isArray(s.msgs) || !s.msgs.length) return null;
    if (!s.ts || (Date.now() - s.ts) > SESSION_MAX_AGE_MS) { clearSession(); return null; }
    return s;
  } catch (e) { return null; }
}""",
        "constants -> Gemini + runtime discovery")

    # Substituted AFTER the constants block lands, so both policies go through exactly the
    # same emission path and cannot drift in anything but the ladders themselves.
    p.sub1(rb"__LADDER_BLOCK__",
           LADDER_TEACHING if ladder == "teaching" else LADDER_LEGACY,
           f"ladder policy: {ladder}")

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
      const ctl = new AbortController();
      const deadline = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
      try {
        res = await fetch(
          GEMINI_BASE + "/models/" + activeModelRef.current + ":generateContent", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKeyRef.current,
            },
            body: JSON.stringify(body),
            signal: ctl.signal,
          });
      } finally { clearTimeout(deadline); }
    } catch (e) {
      // An abort is the deadline, not a flaky network. Raised straight away rather than
      // retried: the cadet has already waited two minutes and a silent second wait reads as
      // the same freeze they are trying to escape.
      if (e && e.name === "AbortError") throw { kind: "timeout", status: 0 };
      if (attempt < retries) { await sleep(backoffMs(attempt)); attempt++; continue; }
      throw { kind: "network", status: 0 };
    }
    if (res.ok) return res;
    if (res.status === 401 || res.status === 403) {
      throw { kind: "auth", status: res.status };   // missing or unauthorized key
    }
    // 400 is AMBIGUOUS on generateContent and used to be lumped in with the two above, so a
    // request that was merely too large told the cadet their API key was invalid -- sending
    // them off to regenerate a key that was fine. It is a bad key only when Google says so;
    // otherwise it is this request, and the likeliest cause is length, which a conversation
    // carried over from Claude reaches sooner than a fresh one.
    if (res.status === 400) {
      let msg = "";
      try { msg = String((((await res.json()) || {}).error || {}).message || ""); } catch (e) {}
      throw /api[\\s_-]?key|credential|unregistered/i.test(msg)
        ? { kind: "auth", status: 400 }
        : { kind: "badrequest", status: 400, detail: msg.slice(0, 300) };
    }
    if (res.status === 404) {                       // model unavailable -> next rung
      if (nextModel(activeModelRef)) { attempt = 0; continue; }
      throw { kind: "model", status: 404 };
    }
    // 429 is Gemini's rate-limit AND its daily-quota code. The BODY says which: a per-minute
    // burst comes back with a RetryInfo naming a few seconds, and the per-day cap names a long
    // delay or none at all. Honour a short one and keep the model we are on; a rung on this
    // ladder is worth far more than the wait, and burning 3.7-flash after 3.5 seconds throws
    // away 19 of its 20 daily requests over a window that would have cleared on its own.
    //
    // Bounded at 15s and taken once per model per session, because the cadet is staring at a
    // spinner with no explanation for the whole wait. A longer delay is treated as the daily
    // cap: move DOWN THE LADDER rather than ending the session, since free-tier quota is per
    // model and the next rung is a fresh allowance. Only an exhausted ladder is fatal.
    //
    // (This comment previously said the response "does not say which". It does.)
    if (res.status === 429) {
      if (!waitedFor[activeModelRef.current]) {
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
      }
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
  const study = MODEL_STUDY.filter((n) => have[n]);
  if (!chat.length && !scored.length) throw { kind: "model", status: 404 };
  MODEL_CHAT = chat.length ? chat : scored;
  MODEL_REPORT = report.length ? report : MODEL_CHAT;
  // Study falls back to the CHAT ladder, not to `scored`: if this key cannot reach any lite
  // model, practice has to run somewhere, and the alternative is a study session that cannot
  // start at all. It still costs graded quota in that case -- which is why it is the fallback
  // and not the default.
  MODEL_STUDY = study.length ? study : MODEL_CHAT;

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
        # REPLACES the source's own quota+model cases -- it does not insert beside them.
        # patch_artifacts.py gives the Claude artifact a `quota` case of its own, and a second
        # `case "quota"` here would be legal JS in which the FIRST wins: every Gemini build
        # would answer a Gemini quota failure with Claude's wording, telling the cadet their
        # "Claude account" is capped and to continue on Gemini -- the page they are already on.
        rb'    case "quota":\r\n'
        rb'      return "This Claude account has reached its usage limit.*?\r\n'
        rb'    case "model":\r\n'
        rb'      return "No tutor model is available to this account.*?" model\.";',
        b"""    case "auth":
      return "That API key was rejected. Check you pasted the whole key from Google AI Studio (it starts with \\u201CAIza\\u201D), and that the Generative Language API is enabled for it.";
    case "quota":
      return "Your Gemini free-tier quota is used up for now. A per-minute limit clears in about a minute; the daily one resets on Google's clock. Wait and Retry.";
    case "blocked":
      return "Gemini declined to answer that turn. Rephrase and try again \\u2014 and tell your instructor if it keeps happening.";
    case "model":
      return "No usable Gemini model was found for this key. Tell your instructor \\u2014 the model list may have moved again.";
    case "timeout":
      return "Google did not answer within two minutes. Your conversation is saved \\u2014 press Retry. If it happens twice, reload the page: the session is restored from this browser and you will not lose your work.";
    case "badrequest":
      return "Google rejected that request \\u2014 most likely the conversation has grown too long, which happens sooner when it was carried over from Claude. Your key is fine. Press Retry, and tell your instructor if it keeps happening.";""",
        "error messages -> Gemini")

    # -- 4b. The capacity message still named Claude --------------------------
    # Step 4 above replaced the `model` case but left `capacity`, which on the GEMINI
    # build told a cadet to blame "a free Claude account" and go use a different one.
    # Wrong twice over: `capacity` is thrown only for 529/5xx (a 429 becomes `quota`),
    # so it is Google's server rather than the cadet's account, and there is no second
    # account to move to -- the key is theirs. Its own sub1, so a reworded source fails
    # loudly here instead of quietly shipping the old text again.
    p.sub1(
        rb"        \? \"The tutor service is at capacity right now and didn't free up after several\"\r\n"
        rb"          \+ \" tries\. On a free Claude account this can be a usage or capacity limit that\"\r\n"
        rb"          \+ \" resets later\. Retry in a few minutes, or continue on Gemini below \" \+ \"\xe2\x80\x94\" \+ \" it\"\r\n"
        rb"          \+ \" runs the same lesson and keeps what you have done so far\.\"\r\n",
        b'        ? "Google\'s tutor service is busy right now and didn\'t free up after several'
        b' tries. That is Google\'s capacity, not your quota and not your key. Wait a few'
        b' minutes and Retry."\n',
        "capacity message -> Gemini")

    # -- 4c. Mark the transport, so a submission can be told apart afterwards --
    # The receiver stores this as `submission_activities.content.transport`. A published
    # Claude artifact sends no `v` at all, and the receiver reads that absence as "claude" --
    # sound HERE and only here, because the only builds that send the key are the ones this
    # script writes, and it writes it into every one of them.
    #
    # Contract section 8 permits new OPTIONAL keys within v1 and requires consumers to ignore
    # unknown ones, so this is additive in both directions: an older receiver drops it, and a
    # newer receiver reads its absence correctly from an older artifact. The four frozen keys
    # (t/i/r/d) are untouched.
    p.sub1(
        rb'        \+ "#t=interaction"\r\n',
        b"""        + "#t=interaction"
        + "&v=gemini"          // transport marker -- optional, additive, contract section 8
""",
        "submit URL carries the transport marker")

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

    # ── 9. Seat the model pool from the phase the source already computes ─────
    # This step used to DO the phase deferral. It does not any more.
    #
    # The deferral was invented here, when only the Gemini builds needed it: the graded system
    # prompt is ~63,000 chars resent EVERY turn -- 93-96% of all input tokens in a session, which
    # is what exhausts a free-tier key after two runs. On 2026-08-20 the Claude artifacts wanted
    # the same saving, so it moved into the source itself (scripts/artifacts/patch_artifacts.py)
    # and step 0 above now REFUSES a source that lacks it. EXTENSION_PROBLEMS and REPORT_FORMAT
    # are already conditional by the time this tool sees the file.
    #
    # What is still Gemini-only is the MODEL POOL, because Claude has one ladder and Gemini has
    # two: the report is a single request and earns the strongest model, while the ~12
    # conversation turns want the high-quota pool. sysFor() is the one place every ongoing turn
    # already passes through, so deciding prompt and pool in the same breath is what stops them
    # drifting apart.
    p.sub1(
        rb"      : \"probe\";\r\n"
        rb"    if \(!a\) return sysRef\.current;\r\n",
        b"""      : "probe";
    // Study mode falls out here with no args. It is ungraded practice with no cap on how often
    // a cadet runs it, so it is pinned to the lite floor and must NOT be seated on the graded
    // ladder -- otherwise practice quietly spends the 20/day that the graded session needs.
    if (!a) { seatLadder(activeModelRef, MODEL_STUDY); return sysRef.current; }
    seatLadder(activeModelRef, phase === "report" ? MODEL_REPORT : MODEL_CHAT);
""",
        "sysFor() seats the model pool")

    # ── 9a. Seat the OPENING turn by mode too ────────────────────────────────
    # startSession calls callTutor directly rather than through sysFor(), so without this the
    # first turn of every session runs on whatever discoverModel happened to seat -- which is
    # MODEL_CHAT[0], the strongest model on the key. For a graded session that is right and
    # already what happens. For STUDY it is a silent leak: every practice run would spend one
    # of the 20 daily requests the graded session is being kept for, and a cadet practising
    # five times would arrive at their real lesson with a quarter of it gone.
    p.sub1(
        rb"    reportPhaseRef\.current = false;\r\n",
        b"""    reportPhaseRef.current = false;
    // The opener does not pass through sysFor(), so seat its pool here or study mode borrows
    // the graded ladder for exactly one request per session.
    seatLadder(activeModelRef, selectedMode === "graded" ? MODEL_CHAT : MODEL_STUDY);
""",
        "opening turn seats by mode")

    # ── 9b. Drop the Claude-only ladder helper this build cannot use ──────────
    # patch_artifacts.py adds stepModel() to the Claude source, where MODEL_CANDIDATES is the one
    # ladder. This build has TWO, both rewritten at runtime by discoverModel, and no
    # MODEL_CANDIDATES at all -- so the helper is not merely redundant, it is a ReferenceError
    # sitting inside a function that only runs once a cadet is deep in a conversation. That is the
    # same shape as the REPORT_MARKER bug that shipped five PHYS 110 builds. seatLadder() and
    # nextModel() already cover this ground for Gemini.
    p.sub1(
        rb"// Advance one rung down the ladder\. Returns false at the bottom\.\r\n"
        rb"// The ref NEVER climbs back, which is what makes `current !== MODEL_CANDIDATES\[0\]` at\r\n"
        rb"// report time an exact answer to \"was this session downgraded\", with no extra state to\r\n"
        rb"// keep in sync\. finalizePayload relies on that\.\r\n"
        rb"function stepModel\(activeModelRef\) \{\r\n"
        rb"  const i = MODEL_CANDIDATES\.indexOf\(activeModelRef\.current\);\r\n"
        rb"  if \(i > -1 && i < MODEL_CANDIDATES\.length - 1\) \{\r\n"
        rb"    activeModelRef\.current = MODEL_CANDIDATES\[i \+ 1\];\r\n"
        rb"    return true;\r\n"
        rb"  \}\r\n"
        rb"  return false;\r\n"
        rb"\}\r\n"
        rb"\r\n",
        b"",
        "Claude stepModel removed")

    # The same question, asked the way this build can answer it. "Not the first ladder entry" is
    # not a stable test here, because discoverModel REWRITES both ladders to whatever the cadet's
    # key can actually reach -- so the first entry after discovery may never have been the first
    # entry before it. spentModels is stable: a model lands in it only after it has 429'd out and
    # the walk has already moved past it.
    p.sub1(
        rb"  d\.model_downgraded = !!\(model && model !== MODEL_CANDIDATES\[0\]\);\r\n",
        b"  d.model_downgraded = Object.keys(spentModels).length > 0;\n",
        "model_downgraded -> spentModels")

    # And the comment that explains it, which names the constant this build does not have. The
    # final check is a SUBSTRING test and so catches comments as well as code -- correctly: this
    # page is public, and a comment describing machinery that is not here misleads whoever reads
    # the source next, which on a backup build is a cadet or the next porter.
    p.sub1(
        rb"// `model` is the model that produced the REPORT, not the one the session opened on\.\r\n"
        rb"// stepModel never climbs back, so a value other than MODEL_CANDIDATES\[0\] is proof the\r\n"
        rb"// session was downgraded at some point -- which is the question worth answering when a\r\n"
        rb"// cohort's reports come back thinner than usual\.\r\n",
        b"// `model` is the model that produced the REPORT, not the one the session opened on. On a\n"
        b"// free key those differ often, because the report is the one request that reaches for the\n"
        b"// strong pool. model_downgraded below answers the related question -- did this session\n"
        b"// burn through a model's quota on the way -- which is worth knowing when a cohort's\n"
        b"// reports come back thinner than usual.\n",
        "finalizePayload comment -> Gemini")

    # ── 10. lz-string from our own origin, same pinned 1.5.0 ──────────────────
    p.sub1(
        rb'const LZSTRING_JS = "https://cdnjs\.cloudflare\.com/ajax/libs/lz-string/1\.5\.0/lz-string\.min\.js";',
        b'const LZSTRING_JS = "' + VENDOR_LZ.encode() + b'";   // vendored 1.5.0, byte-identical',
        "lz-string served from our origin")

    # ── 11. Strip every route BACK to the backup, because this IS the backup ──
    # A Claude artifact offers these when its own tutor fails. In a backup build the same
    # controls would point the cadet at the router that sent them here, and the router would send
    # them straight back -- a loop offered to someone already stuck. When Gemini fails here it is
    # the cadet's own key or quota, and errorMessage already says which and what to do about it.
    #
    # There are now FOUR pieces, not one: the start-screen button, its CSS, the mid-lesson
    # "Continue on Gemini" anchor added 2026-08-20, and the handoffUrl memo behind it. Missing any
    # one leaves either a dead control or a ReferenceError on BACKUP_ENDPOINT after it is stripped
    # below -- so BACKUP_ENDPOINT goes LAST, after everything that names it is gone.
    #
    # strip_optional throughout, so this tool does not care whether it runs before or after the
    # source acquired these. A miss is logged as `not present` rather than passing silently.
    #
    # Indentation is ` +` rather than a fixed run: the kit dialect renders this block as a direct
    # child of .start (12 spaces) and PHYS 110 renders it inside a .start-card (14). Matching the
    # LAYOUT loosely here is safe -- the tag names and class names are still exact.
    p.strip_optional(
        rb' +\{handoffUrl && \(\r\n'
        rb' +<a className="error-transfer".*?\r\n'
        rb" +\)\}\r\n",
        b"", "mid-lesson handoff anchor stripped")
    # The dependency list is matched loosely on purpose. It gained `mode` the same afternoon it was
    # written, and this pattern still named the old four -- so the strip silently reported
    # `not present`, BACKUP_ENDPOINT survived into the build, and only the hard check at the end of
    # this function caught it. Keep that check: a strip_optional that misses says nothing.
    p.strip_optional(
        rb"\r\n"
        rb"  // Mid-lesson handoff to the Gemini backup\..*?\r\n"
        rb"  \}, \[error, messages, lzReady, cadetId[^\]]*\]\);\r\n",
        b"", "handoffUrl memo stripped")
    p.strip_optional(
        rb' +\{connStatus === "unavailable" && \(\r\n'
        rb' +<div className="backup-row">.*?\r\n'
        rb" +\)\}\r\n",
        b"", "backup button stripped")
    p.strip_optional(
        rb"\r\n"
        rb"  /\* Backup-version button\. Navy FILL.*?\r\n"
        rb"  \.backup-hint \{[^\r\n]*\}",
        b"", "backup CSS stripped")
    p.strip_optional(
        rb"\r\n"
        rb"  /\* Retry stays the quiet one.*?\r\n"
        rb"  \.error-transfer:hover \{[^\r\n]*\}",
        b"", "error-transfer CSS stripped")
    p.strip_optional(
        rb"\r\n"
        rb"\r\n"
        rb"// Backup transport, offered when the connection check fails.*?\r\n"
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

    # ── 12. Resume a conversation handed over from a failing Claude artifact ──
    # A cadet whose Claude tutor dies mid-lesson clicks "Continue on Gemini" and arrives here with
    # the conversation so far in the URL hash (`#h=<lz>`, written by patch_artifacts.py, forwarded
    # untouched by site/student/backup.html). Without this step that payload is simply ignored and
    # the cadet restarts from turn one -- which looks like a working handoff right up until they
    # notice their work is gone.
    #
    # The start screen is NOT skipped. They still have to supply their own Gemini key, so there is
    # a screen either way; what changes is that the name is already filled in and the screen says
    # what is about to be restored. Confirming beats teleporting when the previous tab just died.
    p.sub1(
        rb'  const \[cadetId, setCadetId\] = useState\(""\);[^\r\n]*\r\n',
        b"""  const [cadetId, setCadetId] = useState("");      // holds the last name; do NOT rename
  const [handoff, setHandoff] = useState(null);    // a conversation carried over from Claude
""",
        "handoff state")

    # The READER goes after `const lzReady = useLzString()`, not beside the state above.
    # `lzReady` is a const declared further down the component, so an effect placed up there
    # references it inside its own temporal dead zone: React evaluates the whole body on the first
    # render and throws `Cannot access 'lzReady' before initialization` before anything mounts.
    # That took every build to the "did not load" banner -- caught by gemini-build.mjs, which is
    # the only JSX parser these pages get.
    p.sub1(
        rb"    return buildSystemPrompt\(a\.cadetId, a\.localTime, phase\);\r\n"
        rb"  \}\r\n",
        b"""    return buildSystemPrompt(a.cadetId, a.localTime, phase);
  }

  // Read once, after lz-string is up. Anything malformed is DISCARDED rather than repaired: the
  // hash is fully under the cadet's control, and a half-restored conversation would be graded as
  // if it were whole. Starting clean is a visible loss; a silently truncated transcript is not.
  useEffect(() => {
    if (!lzReady || !window.LZString || handoff) return;
    const m = /[#&]h=([^&]+)/.exec(window.location.hash || "");
    if (!m) return;
    try {
      const raw = window.LZString.decompressFromEncodedURIComponent(m[1]);
      const d = raw ? JSON.parse(raw) : null;
      // GRADED ONLY, and this is not a formality. Study mode is untimed, ungraded practice; its
      // transcript restored into a graded session would become the cadet's graded conversation,
      // and the report written from it would describe work that was never graded work. A study
      // handoff therefore arrives as a plain link and the cadet simply restarts study mode, which
      // costs them nothing they were being assessed on.
      if (!d || d.v !== 1 || d.id !== INTERACTION_ID || d.mode !== "graded"
          || !Array.isArray(d.msgs) || !d.msgs.length) return;
      const msgs = d.msgs
        .filter((x) => x && (x.r === "user" || x.r === "assistant") && typeof x.c === "string")
        .map((x) => ({ role: x.r, content: x.c, hidden: !!x.h }));
      if (!msgs.length) return;
      setHandoff({ msgs: msgs, name: typeof d.name === "string" ? d.name : "" });
      if (typeof d.name === "string" && d.name.trim()) setCadetId(d.name.trim());
    } catch (e) { /* malformed hash -- start clean */ }
  }, [lzReady, handoff]);
""",
        "handoff hash reader")

    # ── 12b. Persist the session, so a reload is a recovery and not a loss ────
    # The escape from a hung request is a reload, and until 2026-08-21 that threw away the
    # whole conversation -- including one carried over from Claude, whose Claude half no
    # longer exists anywhere the cadet can reach. The freeze was survivable; that was not.
    #
    # Saved on every settled turn rather than on unload: `beforeunload` does not fire
    # reliably on mobile, and this page's own failure mode is a tab a cadet force-closes.
    # Nothing here leaves the browser -- same store as the API key, never sent to PREP.
    p.sub1(
        rb"  \}, \[lzReady, handoff\]\);\r\n",
        b"""  }, [lzReady, handoff]);

  // Snapshot the session. Skipped while `loading`, so a half-finished turn is never the
  // thing restored: the last SETTLED state is always what comes back.
  useEffect(() => {
    if (!mode || loading || !messages.length) return;
    saveSession({
      v: 1, id: INTERACTION_ID, mode: mode, cadetId: cadetId.trim(),
      msgs: messages, ts: Date.now(),
      activeSec: activeSecRef.current,
      reportSec: reportSecRef.current,
      reportPhase: reportPhaseRef.current,
      extSent: extSentRef.current,
      payloadTried: payloadTriedRef.current,
      hasReport: hasReport, reportText: reportText,
      structured: structured, payloadState: payloadState,
    });
  }, [mode, loading, messages, cadetId, hasReport, reportText, structured, payloadState]);
""",
        "session snapshot")

    # The notice needs to know a snapshot exists BEFORE a mode is chosen, which loadSession
    # cannot answer -- it is keyed on the mode the cadet has not picked yet. Read once on
    # mount, graded only: study mode is practice and restoring it unasked is noise.
    p.sub1(
        rb"  const \[handoff, setHandoff\] = useState\(null\);[^\r\n]*\r\n",
        b"""  const [handoff, setHandoff] = useState(null);    // a conversation carried over from Claude
  const [resumable, setResumable] = useState(null); // an unfinished session in this browser
  useEffect(() => {
    if (mode) return;                               // only on the start screen
    setResumable(loadSession("graded", cadetId.trim()));
  }, [mode, cadetId]);
""",
        "resumable probe")

    # Submitting ends the session, so the snapshot must not outlive it -- otherwise a cadet who
    # comes back to the lesson inside the six-hour window is offered their finished work as
    # "unfinished". Cleared on the click rather than on arrival at the receiver, because this
    # page never learns whether that navigation succeeded. Worst case the cadet abandons the
    # submit page and loses a restore they no longer need: the report is already in the URL
    # they just followed, and re-submitting a graded report is refused anyway once the grade
    # is finalized.
    p.sub1(
        rb'                \? <a className="submit-btn" href=\{submitUrl\} '
        rb'rel="noopener noreferrer">Submit report \xe2\x86\x92</a>\r\n',
        b"""                ? <a className="submit-btn" href={submitUrl} rel="noopener noreferrer"
                     onClick={() => clearSession()}>Submit report \xe2\x86\x92</a>
""",
        "clear the snapshot on submit")

    # Tell the cadet what is about to happen, above the button that does it.
    p.sub1(
        # Anchored on the button as step 7 leaves it, not as the source has it: that step
        # already rewrote this line to require a key as well as a name.
        rb'              <button className="start-btn" onClick=\{begin\}\r\n'
        rb'                      disabled=\{!cadetId\.trim\(\) \|\| connStatus !== "ok"\}>\r\n',
        b"""              {handoff && (
                <div className="honor-box" style={{ fontWeight: 600 }}>
                  Picking up where Claude left off &mdash; your conversation so far
                  ({handoff.msgs.filter((m) => !m.hidden).length} messages) will be restored.
                  Nothing has been lost, and you do not need to start again.
                </div>
              )}
              <button className="start-btn" onClick={begin}
                      disabled={!cadetId.trim() || connStatus !== "ok"}>
""",
        "handoff banner on the start screen")

    # A cadet returning to the start screen after a reload has to be told their work is still
    # here, or they assume it is gone and start again -- which is the loss this whole step
    # exists to prevent, arrived at voluntarily. Runs AFTER the banner step because it anchors
    # on what that step emits. The two answer the same question and must not both claim the
    # conversation, so the saved session is checked first and the handoff falls to `!resumable`
    # -- the same precedence startSession applies, for the same reason: the snapshot already
    # contains the handoff's messages plus everything since.
    p.sub1(
        rb"              \{handoff && \(\r\n",
        b"""              {resumable && (
                <div className="honor-box" style={{ fontWeight: 600 }}>
                  You have an unfinished session for this lesson in this browser
                  ({resumable.msgs.filter((m) => !m.hidden).length} messages). Enter the same
                  name and it will be restored &mdash; you do not need to start again.
                </div>
              )}
              {!resumable && handoff && (
""",
        "resume notice on the start screen")

    # Seed the restored turns instead of the hidden opener.
    #
    # WHOSE TURN IT IS decides whether the tutor is called at all, and getting that backwards is
    # the whole risk here. If the transcript ends with the TUTOR speaking, its question is already
    # on screen and the cadet simply answers it -- calling the tutor there would make it talk
    # twice in a row and re-ask what it just asked. If it ends with the CADET, their message never
    # got an answer, and that unanswered turn is precisely why they are here.
    # Layout-tolerant, content-exact. The kit writes the ternary on one line and comments the
    # callTutor call; PHYS 110 wraps the ternary across three lines and comments nothing. Both are
    # re-emitted in the kit's single-line form, which normalises the dialects rather than carrying
    # a second copy of this pattern forever.
    p.sub1(
        rb"    const seed = \{\r\n"
        rb'      role: "user", hidden: true,\r\n'
        rb'      content: selectedMode === "graded".*?\r\n'
        rb"    \};\r\n"
        rb"    setMessages\(\[seed\]\);\r\n"
        rb"    setLoading\(true\); setError\(null\);\r\n"
        rb"    try \{\r\n"
        rb"      const reply = await callTutor\(activeModelRef, \[seed\], sys, null\);[^\r\n]*\r\n"
        rb"      setMessages\(\(prev\) => \[\.\.\.prev, \{ role: \"assistant\", content: reply \}\]\);\r\n",
        b"""    // A session saved in THIS browser wins over a `#h=` handoff, and must: the saved
    // copy already contains the handoff's messages plus everything since, so preferring the
    // hash would silently roll the cadet back to the moment they arrived from Claude.
    const saved = loadSession(selectedMode, cadetId.trim());
    if (saved) {
      // Restored explicitly rather than re-derived. The effect that sets reportPhaseRef reads
      // only the LAST message, so a session that froze on the cadet's own reply to the
      // integrity question -- which is exactly when this failed -- would come back believing
      // it was still probing, and rebuild the prompt without REPORT_FORMAT.
      reportPhaseRef.current = !!saved.reportPhase;
      extSentRef.current = !!saved.extSent;
      payloadTriedRef.current = !!saved.payloadTried;
      if (typeof saved.activeSec === "number") activeSecRef.current = saved.activeSec;
      reportSecRef.current = (saved.reportSec == null) ? null : saved.reportSec;
      if (saved.hasReport) { setHasReport(true); setReportText(saved.reportText || ""); }
      if (saved.structured) setStructured(saved.structured);
      if (saved.payloadState) setPayloadState(saved.payloadState);
    }
    const resume = saved ? saved.msgs
                 : (selectedMode === "graded" && handoff ? handoff.msgs : null);
    const seed = resume ? null : {
      role: "user", hidden: true,
      content: selectedMode === "graded" ? "Begin the session now." : "I'd like to study this lesson.",
    };
    setMessages(resume || [seed]);
    setError(null);

    // The tutor's last word is already on screen. Hand control straight to the cadet.
    if (resume && resume[resume.length - 1].role !== "user") {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const history = resume || [seed];
      const reply = await callTutor(activeModelRef, history, sys, null); // no pacing note on the opener
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
""",
        "startSession resumes a handoff")

    # The retry path has to carry the same history, or a cadet who resumes and then hits one bad
    # turn is silently restarted by their own Retry click. Note this rewrites only the call site
    # inside startSession -- startRetry's own recursive retry already passes its `seed` through.
    p.sub1(
        rb"        retry: \(\) => startRetry\(selectedMode, sys, seed\),\r\n"
        rb"      \}\);\r\n"
        rb"    \} finally \{ setLoading\(false\); \}\r\n"
        rb"  \}\r\n"
        rb"  function begin\(\)",
        b"""        retry: () => startRetry(selectedMode, sys, resume || seed),
      });
    } finally { setLoading(false); }
  }
  function begin()""",
        "retry preserves the resumed history")

    # startRetry rebuilt the message list by DISCARDING every visible assistant turn -- correct
    # when the list is one hidden opener plus a failed reply, and destructive on a resume, where
    # those turns are the conversation the cadet came here to keep. Rebuilding from the history it
    # was handed is equivalent in the fresh case and correct in both.
    p.sub1(
        rb"  async function startRetry\(selectedMode, sys, seed\) \{\r\n"
        rb"    setLoading\(true\); setError\(null\);\r\n"
        rb"    try \{\r\n"
        rb"      const reply = await callTutor\(activeModelRef, \[seed\], sys, null\);\r\n"
        rb"      setMessages\(\(prev\) => \[\r\n"
        rb"        \.\.\.prev\.filter\(\(m\) => m\.role !== \"assistant\" \|\| m\.hidden\),\r\n"
        rb"        \{ role: \"assistant\", content: reply \},\r\n"
        rb"      \]\);\r\n",
        b"""  async function startRetry(selectedMode, sys, seed) {
    setLoading(true); setError(null);
    try {
      // `seed` is one hidden opener on a fresh start and the whole restored transcript on a
      // resumed one.
      const history = Array.isArray(seed) ? seed : [seed];
      const reply = await callTutor(activeModelRef, history, sys, null);
      setMessages([...history, { role: "assistant", content: reply }]);
""",
        "startRetry rebuilds from the history it was given")

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
    ap.add_argument("--ladder", choices=("teaching", "legacy"), default="teaching",
                    help="conversation-model policy. `teaching` (default) runs chat on the "
                         "strongest models the key can reach. `legacy` reproduces the "
                         "ordering the live builds shipped with, so a rebuild can carry the "
                         "freeze fix and NOTHING else while the reorder is still out for "
                         "faculty trial. TEMPORARY -- delete once the reorder ships.")
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
            jsx, component, nl = port(src, slug, verbose=a.verbose, ladder=a.ladder)
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
