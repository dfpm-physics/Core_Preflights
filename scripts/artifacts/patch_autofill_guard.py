#!/usr/bin/env python3
"""Stop the browser autofilling the Gemini start screen, across every shipped backup build.

WHY THIS EXISTS
---------------
MEASURED 2026-08-27 in `app.tutor_error_log`: of the 99 cadets who reached a Gemini backup start
screen and failed, **52 typed an email address into the Last Name box** and 47 typed a name.
Those 52 produced **82 `API key not valid` refusals** -- a larger group than the 24 cadets whose
Google Cloud projects Google suspended, and unlike those, entirely ours to fix.

The mechanism, identified by the course director from one cadet: the browser autofilled BOTH
boxes -- the USAFA email into the first and **the saved PREP site password into the second**. The
key Google rejected had never been a key. The start screen is a text input followed by a
`type="password"` input, which is a LOGIN FORM to every browser and password manager, and the
`autoComplete="off"` already on both boxes has been ignored by Chrome for login-shaped forms for
years.

WHAT IT CHANGES, per build
--------------------------
1. `keyShapeProblem()` / `nameShapeProblem()` beside `KEY_STORE` -- guards that NAME the problem.
2. A guard at the top of `checkConnection()`, so a key that cannot be one never costs a request.
3. `nameIssue` / `keyIssue` / `keyLocked` derived state beside `forgetKey()`.
4. The markup: the key input stops being `type="password"`, the `id`/`name` pair moves off
   `cadet-id`/`api-key`, inline warnings render under each box, and a remembered key is greyed
   and read-only.
5. The Start button honours a blocking problem.

THE STRUCTURAL FIX IS (4). The guards are the safety net; removing the login signature is what
actually stops the autofill. Do not "simplify" this back to an attribute.

WHY THERE IS NO EXACT LENGTH TEST
---------------------------------
Two key shapes are both valid and both in cadets' hands: `AIza` + 35 = 39 characters, and `AQ.` +
50 = 53. All 29 keys Google has echoed back to us are the 53-character form -- but that sample
exists only because Google echoes a key when it SUSPENDS one, and every suspended key in the log
was newly minted, so it says nothing about the `AIza` keys still in use. Google changed the format
once in 2026 and has announced another change for September. A hard length rule is a lockout
waiting for that date. The `>= 30` test only has to separate a key from a PASSWORD, which is why
it warns rather than blocks.

HOW IT IS SAFE
--------------
* **Dry-run by default.** `--commit` writes. Idempotent: a build already carrying
  `keyShapeProblem` is skipped, so a re-run is a no-op.
* **All-or-nothing per file.** Every anchor must match exactly once or that build is left
  untouched and reported. A partial patch is never written.
* **Bytes in, bytes out.** These files are all-CRLF and a text-mode Python read applies universal
  newlines, which lands a three-line edit as a whole-file rewrite (PROJECT.md, "Sharp edges the
  builder already paid for"). The CRLF count is asserted before and after.
* **The slug is not touched.** `activities.slug` is globally UNIQUE and every student report hangs
  off that one row; this is a patch into the same offering, so the slug must not move.
* **It does not verify itself.** Run `node scripts/artifacts/check_jsx.js <file>` after, or the
  scratch equivalent -- `node --check` returns exit 0 on invalid JSX and proves nothing.

Usage:
    python scripts/artifacts/patch_autofill_guard.py            # dry run, prints the plan
    python scripts/artifacts/patch_autofill_guard.py --commit   # writes
"""

import argparse
import pathlib
import sys

BUILDS = pathlib.Path("site/gemini")
MARKER = "keyShapeProblem"          # presence means this build is already patched


GUARDS = r'''const KEY_STORE = "prep.gemini.apikey";

// -- WHAT ACTUALLY WENT INTO THE TWO BOXES -------------------------------------
// MEASURED 2026-08-27 in app.tutor_error_log, not guessed: of the 99 cadets who reached this
// start screen and failed, 52 typed an EMAIL ADDRESS into the Last Name box and 47 typed a
// name. Those 52 produced 82 "API key not valid" refusals -- because the browser filled the
// pair as a LOGIN FORM: USAFA email into the first box, the saved PREP site password into the
// second. That was the largest failure group in the log, larger than the 24 cadets whose
// Google projects Google suspended.
//
// autoComplete="off" was already on both boxes and Chrome ignored it, which it has done for
// login-shaped forms for years. The structural fix is in the markup -- the key box is no
// longer type="password", so the pair no longer looks like a login. These guards catch what
// is left, and they NAME the problem instead of letting Google answer "API key not valid" to
// a password the cadet never knowingly typed.
//
// DO NOT ADD AN EXACT LENGTH TEST. Two key shapes are both valid and both in cadets' hands:
// AIza + 35 = 39 characters, and AQ. + 50 = 53. All 29 keys Google has echoed back to us are
// the 53-character form -- but that sample exists only because Google echoes a key when it
// SUSPENDS one, and every suspended key here was newly minted, so it says nothing about the
// AIza keys still in use. Google changed this format once already in 2026 and has announced
// another change for September. A hard length rule is a lockout waiting for that date; the
// >= 30 test below only has to separate a key from a PASSWORD, which is why it warns rather
// than blocks.
function keyShapeProblem(k) {
  const v = String(k || "").trim();
  if (!v) return null;                       // empty is "not yet", not "wrong"
  if (v.indexOf("@") >= 0) return { block: true,
    msg: "That looks like an email address, not an API key — your browser may have filled "
       + "it in for you. Clear the box and paste the key from aistudio.google.com/apikey." };
  if (/\s/.test(v)) return { block: true,
    msg: "That has a space in it, so it is not an API key. Clear the box and paste it again." };
  if (v.length < 30) return { block: false,
    msg: "That looks too short for a Gemini API key — a saved password often lands here. "
       + "Check it against aistudio.google.com/apikey before you start." };
  return null;
}

function nameShapeProblem(n) {
  const v = String(n || "").trim();
  if (!v) return null;
  if (v.indexOf("@") >= 0) return { block: true,
    msg: "That is your email address. Enter just your last name, so your instructor can match "
       + "this report to you." };
  return null;
}
'''


OLD_MARKUP = '''              <label className="field-label" htmlFor="cadet-id">Last Name</label>
              <input
                id="cadet-id"
                className="field-input"
                type="text"
                placeholder="Smith"
                value={cadetId}
                onChange={(e) => setCadetId(e.target.value)}
                autoComplete="off"
              />
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
'''

NEW_MARKUP = '''              <label className="field-label" htmlFor="prep-lastname">Last Name</label>
              <input
                id="prep-lastname"
                name="prep-lastname"
                className="field-input"
                type="text"
                placeholder="Smith"
                value={cadetId}
                onChange={(e) => setCadetId(e.target.value)}
                autoComplete="off"
              />
              {nameIssue && (
                <p className="conn-msg" style={{ marginTop: "6px" }}>{nameIssue.msg}</p>
              )}
              <label className="field-label" htmlFor="prep-gkey" style={{ marginTop: "10px" }}>
                Gemini API key
              </label>
              {/* type="text", NOT type="password". A text box followed by a password box IS a
                  login form to every browser and password manager, and no attribute reliably
                  says otherwise -- autoComplete="off" was already here and was ignored. The id
                  and name are off "cadet-id"/"api-key" too, so the pair no longer reads as a
                  credential. Showing the key is deliberate: it is the cadet's own free key on
                  their own screen, and a bad paste was invisible behind the dots. */}
              <input
                id="prep-gkey"
                name="prep-gkey"
                className="field-input"
                type="text"
                placeholder="AIza... or AQ...."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                readOnly={keyLocked}
                style={keyLocked ? { opacity: 0.6, cursor: "not-allowed" } : null}
                autoComplete="off"
                spellCheck="false"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && cadetId.trim() && connStatus === "ok") begin();
                }}
              />
              {keyLocked && (
                <p className="study-hint" style={{ marginTop: "6px" }}>
                  Saved in this browser. Use <strong>Forget key</strong> above to change it.
                </p>
              )}
              {keyIssue && (
                <p className="conn-msg" style={{ marginTop: "6px" }}>{keyIssue.msg}</p>
              )}
'''


EDITS = [
    ("guards", 'const KEY_STORE = "prep.gemini.apikey";\n', GUARDS),

    ("checkConnection guard",
     '  async function checkConnection() {\n'
     '    if (!apiKey.trim()) {\n'
     '      setConnStatus("unavailable"); setModelName(""); setConnDetail("");\n'
     '      setConnMsg("Paste your Gemini API key to check access.");\n'
     '      return;\n'
     '    }\n',
     '  async function checkConnection() {\n'
     '    if (!apiKey.trim()) {\n'
     '      setConnStatus("unavailable"); setModelName(""); setConnDetail("");\n'
     '      setConnMsg("Paste your Gemini API key to check access.");\n'
     '      return;\n'
     '    }\n'
     '    // Before Google is asked. This check is debounced on every keystroke, so an autofilled\n'
     '    // password used to cost a request per edit AND came back as Google\'s "API key not\n'
     '    // valid" -- which tells a cadet to go and make another key, the one action that cannot\n'
     '    // help.\n'
     '    const shape = keyShapeProblem(apiKey);\n'
     '    if (shape && shape.block) {\n'
     '      setConnStatus("unavailable"); setModelName(""); setConnDetail("");\n'
     '      setConnMsg(shape.msg);\n'
     '      return;\n'
     '    }\n'),

    ("derived state",
     '  function forgetKey() {\n'
     '    try { localStorage.removeItem(KEY_STORE); } catch (e) {}\n'
     '    setKeyRemembered(false); setApiKey("");\n'
     '  }\n',
     '  function forgetKey() {\n'
     '    try { localStorage.removeItem(KEY_STORE); } catch (e) {}\n'
     '    setKeyRemembered(false); setApiKey("");\n'
     '  }\n'
     '  // Recomputed each render; both are null when the box is empty or fine.\n'
     '  const nameIssue = nameShapeProblem(cadetId);\n'
     '  const keyIssue = keyShapeProblem(apiKey);\n'
     '  // A remembered key is greyed rather than editable. It is the key that WORKED, and a\n'
     '  // read-only input is also skipped by browser autofill -- the failure this whole change\n'
     '  // is about. "Forget key", in the connection row above, is the way out.\n'
     '  const keyLocked = keyRemembered && !!apiKey;\n'),

    ("markup", OLD_MARKUP, NEW_MARKUP),

    ("start button",
     '              <button className="start-btn" onClick={begin}\n'
     '                      disabled={!cadetId.trim() || connStatus !== "ok"}>\n',
     '              <button className="start-btn" onClick={begin}\n'
     '                      disabled={Boolean(!cadetId.trim() || connStatus !== "ok"\n'
     '                                || (nameIssue && nameIssue.block)\n'
     '                                || (keyIssue && keyIssue.block))}>\n'),
]


def crlf(text):
    return text.replace("\n", "\r\n")


def patch_one(path):
    """Return (status, detail, new_bytes_or_None). Never writes."""
    raw = path.read_bytes()
    if raw.count(b"\n") != raw.count(b"\r\n"):
        return ("SKIP", "not an all-CRLF file", None)

    text = raw.decode("utf-8")
    if MARKER in text:
        return ("DONE", "already patched", None)

    for label, old, _new in EDITS:
        n = text.count(crlf(old))
        if n != 1:
            return ("MISS", "anchor %r matched %d times" % (label, n), None)

    for _label, old, new in EDITS:
        text = text.replace(crlf(old), crlf(new), 1)

    out = text.encode("utf-8")
    if b"\n" in out.replace(b"\r\n", b""):
        return ("SKIP", "a bare LF crept in", None)
    return ("PATCH", "+%d bytes" % (len(out) - len(raw)), out)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--commit", action="store_true", help="write the files (default: dry run)")
    ap.add_argument("--course", help="limit to one course directory, e.g. phys-215")
    args = ap.parse_args()

    if not BUILDS.is_dir():
        print("no %s -- run from the repo root" % BUILDS, file=sys.stderr)
        return 2

    courses = sorted(d for d in BUILDS.iterdir() if d.is_dir())
    if args.course:
        courses = [d for d in courses if d.name == args.course]
        if not courses:
            print("no such course directory: %s" % args.course, file=sys.stderr)
            return 2

    tally = {}
    misses = []
    writes = []
    for cdir in courses:
        for f in sorted(cdir.glob("*.html")):
            status, detail, out = patch_one(f)
            tally[status] = tally.get(status, 0) + 1
            if status == "MISS":
                misses.append((f, detail))
            if status == "PATCH":
                writes.append((f, out, detail))
            print("%-6s %-12s %s  %s" % (status, cdir.name, f.name, detail))

    print("\n" + ", ".join("%s=%d" % kv for kv in sorted(tally.items())))

    if misses:
        print("\n%d build(s) left UNTOUCHED because an anchor did not match exactly once."
              % len(misses))
        print("That is the safe outcome -- a partial patch is never written. Inspect each:")
        for f, why in misses:
            print("  %s  (%s)" % (f, why))

    if not args.commit:
        print("\nDRY RUN. Nothing written. Re-run with --commit to write %d file(s)." % len(writes))
        return 0

    for f, out, _d in writes:
        f.write_bytes(out)
    print("\nWROTE %d file(s)." % len(writes))
    print("Now parse each with the Babel the pages ship -- node --check passes invalid JSX.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
