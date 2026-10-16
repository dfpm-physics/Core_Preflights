#!/usr/bin/env python3
"""Make the GenAI.mil build of a lesson from its Gemini backup build.

    python scripts/artifacts/to_genai.py site/gemini/phys-215/<slug>.html [...]   # dry run
    python scripts/artifacts/to_genai.py --commit site/gemini/phys-215/<slug>.html [...]

Writes site/genai/<course>/<slug>.html. The source page is not changed.

WHAT CHANGES, AND WHAT DOES NOT
    Only the transport. The page calls the `genai-mil-proxy` edge function instead of Google,
    with the cadet's PREP sign-in instead of a Gemini key. The edge function holds the course
    key (a Supabase secret) and translates Google's request shape to GenAI.mil's OpenAI shape.
    The slug, grounding, report format and submit contract are byte-identical to the source, so a
    cadet who uses this build lands in the same cohort as one who used any other.

    The edits are the reference patch from the AI Hub local build
    (projects/socratic-interaction/docs/GENAI-MIL-BUILD.md, Lesson 2), with four differences
    that only matter once the page is served from PREP rather than localhost:
      - auth is the cadet's PREP session (supabase-js + js/config.js), not a local proxy;
      - the placeholder key is never saved, because site/gemini/ and site/genai/ share one
        origin and the save would overwrite the cadet's real Gemini key (prep.gemini.apikey);
      - 401/403/503 get GenAI messages instead of "your Google key is bad";
      - no X-Cadet-Id header: the function audits the signed-in user id from the JWT.

BYTES ONLY. Sources are CRLF or LF; this detects and keeps whichever it finds. Every anchor
must match exactly once or the script refuses and writes nothing for that page.
"""

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from to_gemini import detect_nl  # noqa: E402  (shared, so the two cannot drift)

ROOT = Path(__file__).resolve().parents[2]
# The staff library's list of GenAI.mil builds. A SEPARATE file from backup-builds.json on
# purpose: the student pages read that one, and must not learn these pages exist until the
# course director opens them.
MANIFEST = ROOT / "site" / "data" / "genai-builds.json"
BACKUPS = ROOT / "site" / "data" / "backup-builds.json"
PROXY = "https://shzvpmlnqfmzfmuxkowi.supabase.co/functions/v1/genai-mil-proxy"

HEAD_SCRIPTS = """<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="../../js/config.js"></script>
<script>window.GENAI_PROXY = "%s";</script>
""" % PROXY

GENAI_BLOCK = r"""// ── GENAI.MIL TRANSPORT (scripts/artifacts/to_genai.py) ─────────────────────────────────────
// This page holds NO credential. It calls the genai-mil-proxy edge function with the cadet's
// PREP sign-in; the function holds the course key and translates Google's request shape to
// GenAI.mil's OpenAI shape. The URL shape below is unchanged from the Google build, so the
// build's own fetch logic needed no edit beyond its headers.
const GENAI = {
  on:   true,      // false restores the stock Google behaviour and the cadet's own key
  base: window.GENAI_PROXY,
  // Send each block of instructions only in the phase that uses it (buildSystemPrompt). Every
  // GenAI.mil call resends the whole prompt, so a block sent in the wrong phase is paid for on
  // every turn. ?trim=0 turns it off, for a before/after measurement.
  trim: !(typeof location !== "undefined" && /[?&]trim=0\b/.test(location.search)),
};
if (typeof window !== "undefined" && window.GENAI_CONFIG) Object.assign(GENAI, window.GENAI_CONFIG);

// One model, chosen by the server (GENAI_MIL_MODEL). discoverModel() overwrites this with what
// /health reports, so the page always SHOWS the model that actually answers.
let PINNED_MODEL = "gemini-3.7-flash";

// The cadet's own PREP session token, refreshed by supabase-js when it is near expiry. No key.
async function authHeaders() {
  if (!GENAI.on) return { "x-goog-api-key": apiKeyRef.current };
  let token = "";
  try {
    const s = window.db ? await window.db.auth.getSession() : null;
    token = (s && s.data && s.data.session && s.data.session.access_token) || "";
  } catch (e) {}
  return token ? { Authorization: "Bearer " + token } : {};
}

// The inherited messages are about a cadet's own Google key, which this page does not have.
function genaiErrorMessage(err) {
  const s = (err && err.status) || 0, d = (err && err.detail) || "";
  if (s === 401) return "You are not signed in to PREP in this browser. Open the PREP site, sign in, then reload this page. Your conversation is saved in this browser.";
  if (s === 403) return d || "This GenAI.mil tutor is not open to you yet. Use one of the other options.";
  if (s === 503) return d || "The course GenAI.mil key needs attention, so the tutor cannot answer. Tell your instructor. Your conversation is saved in this browser.";
  if (err && (err.kind === "capacity" || err.kind === "quota")) return "GenAI.mil is busy right now. Wait a minute and press Retry. Your conversation is saved in this browser.";
  if (err && err.kind === "model") return "The GenAI.mil model is not available on the course key. Tell your instructor.";
  return null;
}

const GEMINI_BASE = GENAI.on ? GENAI.base : "https://generativelanguage.googleapis.com/v1beta";"""

TRIM_LINES = """  // Trimmed (GenAI.mil): the report-writing rules and the payload spec only in "report" (the
  // payload repair asks for "report" too); the extension rules in "report" and "extension";
  // REPORT_FORMAT only in "report". Untrimmed (?trim=0, or the Google path): the original build.
  const T = GENAI.on && GENAI.trim;
  const endRules = !T || phase === "report";
  const extRules = !T || phase === "report" || phase === "extension";
  const reportFmt = T ? phase === "report" : !(phase === "probe" || !phase);
"""

DISCOVER_BLOCK = """  // One pinned model and one course key: nothing to list, and no per-model daily quota to seed.
  // /health also checks the sign-in and the staff gate, so a cadet who cannot use this page is
  // told so on the start screen rather than on turn one.
  if (GENAI.on) {
    let res;
    try {
      res = await fetch(GENAI.base + "/health", { cache: "no-store", headers: await authHeaders() });
    } catch (e) {
      throw { kind: "network", status: 0 };
    }
    let h = {};
    try { h = (await res.json()) || {}; } catch (e) {}
    if (!res.ok) {
      const detail = String((h.error && h.error.message) || "");
      const kind = res.status === 401 ? "auth" : res.status === 403 ? "forbidden"
        : res.status >= 500 ? "capacity" : "request";
      throw { kind, status: res.status, detail };
    }
    if (h.model) PINNED_MODEL = h.model;
    MODEL_CHAT = [PINNED_MODEL];
    MODEL_REPORT = [PINNED_MODEL];
    MODEL_STUDY = [PINNED_MODEL];
    activeModelRef.ladder = null;
    seatLadder(activeModelRef, MODEL_CHAT);
    return activeModelRef.current;
  }
"""

BADGE = """<script>
// GenAI.mil status badge. Asks the edge function whether this browser's PREP sign-in may use it,
// rather than assuming -- a page that looks ready and fails on turn one is the thing to avoid.
(function () {
  var d = document.createElement("div");
  function paint(text, good) {
    d.textContent = text;
    d.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:99999;padding:4px 9px;" +
      "border-radius:5px;font:600 11px ui-monospace,monospace;letter-spacing:.03em;" +
      "background:" + (good ? "#1d3b2a" : "#3a1d22") + ";color:" + (good ? "#9ff0c4" : "#ffc9cf") +
      ";border:1px solid " + (good ? "#2f6347" : "#6b2b33") + ";pointer-events:none;opacity:.92";
  }
  paint("GenAI.mil \\u00b7 checking\\u2026", true);
  document.body.appendChild(d);
  var s = window.db ? window.db.auth.getSession() : Promise.resolve(null);
  s.then(function (r) {
    var t = r && r.data && r.data.session && r.data.session.access_token;
    if (!t) { paint("GenAI.mil \\u00b7 not signed in to PREP", false); return; }
    return fetch(window.GENAI_PROXY + "/health", { headers: { Authorization: "Bearer " + t } })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (h) {
          if (res.ok) paint("GenAI.mil \\u00b7 " + (h.model || "?"), true);
          else if (res.status === 403) paint("GenAI.mil \\u00b7 staff only for now", false);
          else if (res.status === 401) paint("GenAI.mil \\u00b7 not signed in to PREP", false);
          else paint("GenAI.mil \\u00b7 server HTTP " + res.status, false);
        });
      });
  }).catch(function () {
    paint("GenAI.mil \\u00b7 server not answering", false);
  });
})();
</script>
"""


class Refuse(Exception):
    pass


class Page:
    def __init__(self, b: bytes):
        self.b = b
        self.nl = detect_nl(b)

    def enc(self, s: str) -> bytes:
        return s.replace("\n", "\n" if self.nl == b"\n" else "\r\n").encode("utf-8")

    def once(self, old: str, new: str):
        o = self.enc(old)
        n = self.b.count(o)
        if n != 1:
            raise Refuse("anchor matched %d times, need 1: %r" % (n, old[:70]))
        self.b = self.b.replace(o, self.enc(new), 1)

    def after(self, start: str, old: str, new: str, within: int):
        """Replace the first `old` after the single `start`, which must be within `within` bytes."""
        s = self.enc(start)
        if self.b.count(s) != 1:
            raise Refuse("start anchor matched %d times: %r" % (self.b.count(s), start[:70]))
        p0 = self.b.index(s) + len(s)
        o = self.enc(old)
        p = self.b.find(o, p0)
        if p < 0 or p - p0 > within:
            raise Refuse("%r not found within %d bytes after %r" % (old[:50], within, start[:50]))
        self.b = self.b[:p] + self.enc(new) + self.b[p + len(o):]

    def rx(self, pattern: bytes, repl, count_must=1):
        found = re.findall(pattern, self.b)
        if len(found) != count_must:
            raise Refuse("pattern matched %d times, need %d: %r" % (len(found), count_must, pattern[:60]))
        self.b = re.sub(pattern, repl, self.b, count=1)


def port(src: bytes) -> bytes:
    p = Page(src)
    nl = p.nl
    p.once('<script src="../../vendor/babel.min.js"></script>\n',
           '<script src="../../vendor/babel.min.js"></script>\n' + HEAD_SCRIPTS)
    p.rx(rb"<title>([^<]*?) &mdash; PREP</title>", rb"<title>[GenAI.mil] \1</title>")
    p.once('const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";', GENAI_BLOCK)
    p.once("function rpmOf(name) { return /lite/i.test(name) ? RPM_LITE : RPM_FLASH; }",
           "function rpmOf(name) { return GENAI.on ? 1e9 : (/lite/i.test(name) ? RPM_LITE : RPM_FLASH); }")
    p.once("function rpdOf(name) { return /lite/i.test(name) ? RPD_LITE : RPD_FLASH; }",
           "function rpdOf(name) { return GENAI.on ? 1e9 : (/lite/i.test(name) ? RPD_LITE : RPD_FLASH); }")
    p.once("function keyShapeProblem(k) {\n",
           "function keyShapeProblem(k) {\n  if (GENAI.on) return null;        // nothing is typed here; the server holds the credential\n")
    p.once("function buildSystemPrompt(cadetId, localTime, phase) {\n  return `",
           "function buildSystemPrompt(cadetId, localTime, phase) {\n" + TRIM_LINES + "  return `")
    p.once("\n=== AT THE END ===\n", "\n${endRules ? `=== AT THE END ===\n")
    p.once("\n=== WHAT TO TELL THE CADET ABOUT SUBMITTING ===\n",
           '\n` : ""}=== WHAT TO TELL THE CADET ABOUT SUBMITTING ===\n')
    p.after("\n=== AFTER THE REPORT — EXTENSION (UNTIMED) ===\n", "\n${TEXTBOOK_REFERENCE}\n",
            '\n` : ""}${TEXTBOOK_REFERENCE}\n', within=6000)
    p.once("\n=== AFTER THE REPORT — EXTENSION (UNTIMED) ===\n",
           "\n${extRules ? `=== AFTER THE REPORT — EXTENSION (UNTIMED) ===\n")
    p.once('\n${phase === "probe" || !phase\n', "\n${!reportFmt\n")
    p.rx(rb'headers: \{\s*"Content-Type": "application/json",\s*"x-goog-api-key": apiKeyRef\.current,\s*\},',
         b'headers: Object.assign({ "Content-Type": "application/json" }, await authHeaders()),')
    p.once("async function discoverModel(activeModelRef) {\n",
           "async function discoverModel(activeModelRef) {\n" + DISCOVER_BLOCK)
    p.once('{ headers: { "x-goog-api-key": apiKeyRef.current } });', "{ headers: await authHeaders() });")
    p.once("const [apiKey, setApiKey] = useState(() => {\n",
           "const [apiKey, setApiKey] = useState(() => {\n"
           "    // Not a credential. It only satisfies the start-screen gates written for a typed key.\n"
           '    if (GENAI.on) return "served-by-genai-mil";\n')
    p.once("try { localStorage.setItem(KEY_STORE, apiKey.trim()); setKeyRemembered(true); } catch (e) {}",
           "// Never under GenAI: same origin as site/gemini/, so this would overwrite the cadet's real key.\n"
           "      if (!GENAI.on) try { localStorage.setItem(KEY_STORE, apiKey.trim()); setKeyRemembered(true); } catch (e) {}")
    p.once("  function sysFor() {\n",
           "  // forcePhase: the payload repair runs after the report exists (\"extension\"), but it needs the\n"
           "  // payload spec, which a trimmed prompt only carries in \"report\".\n"
           "  function sysFor(forcePhase) {\n")
    p.once('const phase = hasReport ? "extension"', 'const phase = forcePhase ? forcePhase : hasReport ? "extension"')
    p.after("setMessages((prev) => [...prev, repair]);",
            "const reply = await callTutor(activeModelRef, history, sysFor(), null);",
            'const reply = await callTutor(activeModelRef, history, sysFor("report"), null);', within=400)
    p.once("{keyRemembered && (", "{keyRemembered && !GENAI.on && (")
    p.rx(rb'\n( *)(<label className="field-label" htmlFor="prep-gkey")',
         lambda m: b"\n" + m.group(1) + b"{!GENAI.on && (<>" + nl + m.group(1) + m.group(2))
    p.after('{!GENAI.on && (<>', "submit link.\n              </p>\n",
            "submit link.\n              </p>\n              </>)}\n", within=4000)
    p.once("function errorMessage(err, { afterRetries = false } = {}) {\n",
           "function errorMessage(err, { afterRetries = false } = {}) {\n"
           "  if (GENAI.on) { const g = genaiErrorMessage(err); if (g) return g; }\n")
    # The badge goes after the LAST </script> (the load-error reporter).
    end = p.enc("</script>\n")
    i = p.b.rfind(end)
    if i < 0:
        raise Refuse("no closing </script>")
    p.b = p.b[:i + len(end)] + p.enc(BADGE) + p.b[i + len(end):]
    return p.b


def check(out: bytes, src: bytes):
    """Counts and invariants. Refuses rather than warns."""
    t = out.decode("utf-8")
    # generateContent fetch, /models list fetch, /health fetch.
    calls = len(re.findall(r"await authHeaders\(\)", t))
    if calls != 3:
        raise Refuse("expected 3 'await authHeaders()' calls, found %d" % calls)
    if t.count('sysFor("report")') != 1:
        raise Refuse('expected 1 sysFor("report")')
    # Every x-goog-api-key left must be a comment or the Google fallback inside authHeaders().
    for line in t.splitlines():
        if "x-goog-api-key" in line and not line.lstrip().startswith("//") \
                and 'if (!GENAI.on) return { "x-goog-api-key"' not in line \
                and "x-goog-api-key header" not in line:
            raise Refuse("x-goog-api-key outside a comment: %s" % line.strip()[:90])
    for inv in (rb'const INTERACTION_ID = "[^"]+"', rb"const SUBMIT_ENDPOINT =\s*[^\r\n]+"):
        a, b = re.findall(inv, src), re.findall(inv, out)
        if not a or a != b:
            raise Refuse("invariant changed or missing: %r" % inv)
    if out.count(b"\r\n") not in (0, out.count(b"\n")):
        raise Refuse("mixed line endings in output")


def write_manifest(done):
    """Merge the pages just written into site/data/genai-builds.json (same shape as the Gemini
    list, which supplies each lesson's number and title)."""
    import json
    man = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() \
        else {"schema": 1, "builds": {}}
    man.setdefault("builds", {})
    gem = json.loads(BACKUPS.read_text(encoding="utf-8")).get("builds", {})
    for slug, course in done:
        g = gem.get(slug, {})
        man["builds"][slug] = {
            "course": course,
            "lesson_no": g.get("lesson_no"),
            "title": g.get("title", ""),
            "path": "genai/%s/%s.html" % (course, slug),
        }
    # Drop entries whose page no longer exists, so the list never names a missing file.
    for slug in list(man["builds"]):
        if not (ROOT / "site" / man["builds"][slug]["path"]).exists():
            del man["builds"][slug]
    man["builds"] = dict(sorted(man["builds"].items()))
    MANIFEST.write_text(json.dumps(man, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("manifest: %s (%d builds)" % (MANIFEST.relative_to(ROOT), len(man["builds"])))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sources", nargs="+")
    ap.add_argument("--commit", action="store_true")
    a = ap.parse_args()
    bad = 0
    done = []
    for s in a.sources:
        src_path = Path(s).resolve()
        course = src_path.parent.name
        dst = ROOT / "site" / "genai" / course / src_path.name
        try:
            src = src_path.read_bytes()
            out = port(src)
            check(out, src)
        except (Refuse, SystemExit) as e:
            print("REFUSED  %s  %s" % (src_path.name, e))
            bad += 1
            continue
        done.append((src_path.stem, course))
        state = "same" if dst.exists() and dst.read_bytes() == out else "write"
        if a.commit and state == "write":
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(out)
        print("%s  %s/%s  (%d -> %d bytes)" % (
            ("WROTE " if a.commit and state == "write" else "same  " if state == "same" else "PLAN  "),
            course, src_path.name, len(src), len(out)))
    if a.commit and done:
        write_manifest(done)
    if not a.commit:
        print("\nDry run. Add --commit to write.")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
