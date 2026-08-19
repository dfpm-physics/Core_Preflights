#!/usr/bin/env python3
"""Mechanical checks on a generated preflight .jsx artifact. Read-only.

WHAT THIS IS NOT: a syntax check. There is no JSX parser on this machine, and
adding one is a build step CORE.md §2 forbids. `node --check` reports exit 0 on a
.jsx artifact regardless of whether the JSX is valid, because Node auto-detects
any file containing `import`/`export` as ESM and does not reject JSX on that path
(PROJECT.md §9). A green `node --check` on an artifact means nothing.

So this checks only what is checkable without a parser, which PROJECT.md §9 lists:
raw NUL bytes, delimiter balance, frozen contract strings, forbidden strings, and
the per-course constants COURSE_PROFILE.md mandates. **The Claude session you
publish from is the actual parser** — a syntax error surfaces there, before any
cadet sees it.

Usage:
    python scripts/artifacts/check_artifact.py <artifact.jsx> [--forbid STR ...]

`--forbid` adds build-specific strings that must not survive — the usual case is
rebuilding an artifact against a new grounding source and wanting proof that no
reference to the old one is left. Exits non-zero if anything fails.
"""
import argparse
import re
import sys

# Frozen by contracts/INTERACTION-DATA-CONTRACT.md §2-§3 and the theme reference.
REQUIRED = [
    "https://dfpm-physics.github.io/Core_Preflights/site/student/interaction-submit.html",
    '"#t=interaction"',
    '"&i=" + INTERACTION_ID',
    '"&r=" + window.LZString.compressToEncodedURIComponent',
    '"&d=" + window.LZString.compressToEncodedURIComponent',
    "lz-string/1.5.0/lz-string.min.js",
    "jitt-data",
    "# JiTT Conversation Report",
    "Academic Integrity Self-Report",
    '"Content-Type": "application/json"',
    "https://api.anthropic.com/v1/messages",
]

FORBIDDEN = [
    ("x-api-key", "auth header breaks the claude-in-claude pattern"),
    ("Bearer ", "auth header breaks the claude-in-claude pattern"),
    ("anthropic-version", "auth header breaks the claude-in-claude pattern"),
    ("100vh", "viewport-relative height ratchets the auto-sizing embed"),
    ("100dvh", "viewport-relative height ratchets the auto-sizing embed"),
    ("scrollIntoView", "scrolls the outer document and feeds the growth loop"),
    ("artifact-submit.html", "retired endpoint; 404s and loses the cadet's work"),
    ("interactions-admin.html", "retired prefill base; 404s"),
    ("window.open", "scripted navigation is blocked in the artifact sandbox"),
    ('target="_blank"', "scripted navigation is blocked in the artifact sandbox"),
]


def strip_comments(src):
    """Return code with comments removed.

    Required, not cosmetic: a well-written artifact DOCUMENTS the traps it avoids
    ("never use 100vh here, because..."), so a naive forbidden-string scan matches
    the warning and reports the very bug the warning prevents. Same failure shape
    as the anchored-grep trap in texts/MURRAY-GROUNDING.md — a checker that is
    wrong about its own subject is worse than no checker.
    """
    out = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return "\n".join(l for l in out.split("\n") if not l.lstrip().startswith("//"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("artifact")
    ap.add_argument("--forbid", action="append", default=[],
                    help="extra string that must not appear (repeatable)")
    args = ap.parse_args()

    raw = open(args.artifact, "rb").read()
    src = raw.decode("utf-8")
    code = strip_comments(src)
    ok, fail = [], []

    def check(cond, msg):
        (ok if cond else fail).append(msg)

    # PROJECT.md §9: a literal NUL makes git report "Binary files differ" and makes
    # grep skip the file entirely, while the artifact still runs identically.
    nuls = raw.count(b"\x00")
    check(nuls == 0, "no raw NUL bytes (found %d)" % nuls)

    for o, c in [("{", "}"), ("(", ")"), ("[", "]")]:
        check(src.count(o) == src.count(c),
              "%s%s balanced (%d/%d)" % (o, c, src.count(o), src.count(c)))
    check(src.count("`") % 2 == 0, "backticks paired (%d)" % src.count("`"))

    for m in re.finditer(r"String\.raw`(.*?)`", src, re.S):
        check("${" not in m.group(1),
              "no ${...} interpolation inside a String.raw content constant")

    for s in REQUIRED:
        check(s in src, "present: %s" % s[:64])
    for s, why in FORBIDDEN:
        check(s not in code, "absent from code: %s (%s)" % (s, why))
    check(not re.search(r"claude-[a-z0-9.-]*-20\d{6}", code),
          "no dated model snapshot pinned (a retired snapshot strands the artifact)")

    # COURSE_PROFILE.md "Session shape is advisory" — no tool reads these keys, so
    # the build has to apply them deliberately and this is what notices if it did not.
    m = re.search(r"const PROBE_TOPIC_COUNT = (\d+);", src)
    ntopics = int(m.group(1)) if m else -1
    keys = re.search(r"const OBJECTIVE_KEYS = \[(.*?)\];", src, re.S)
    nkeys = keys.group(1).count("{ key:") if keys else -1
    check(3 <= ntopics <= 5, "PROBE_TOPIC_COUNT in 3..5 (%d)" % ntopics)
    check(nkeys == ntopics,
          "OBJECTIVE_KEYS length == PROBE_TOPIC_COUNT (%d vs %d)" % (nkeys, ntopics))

    # INTERACTION-DATA-CONTRACT.md §3.2 — the slug is per OFFERING, not per lesson:
    # <readable-stem>-<8 random lowercase hex>, minted once per build. Without the
    # suffix every term that runs the lesson shares one globally-UNIQUE activities
    # row, and deleting a rebuilt lesson in one term can reach another term's
    # reports. **The skill's inline slug rule predates §3.2 and still says
    # "deterministic, so re-running yields the same slug" — building from the skill
    # instead of the contract produces a suffix-less slug that looks correct.**
    # That is why this is checked mechanically rather than left to whoever reads
    # which file first.
    # Whitespace-tolerant, and it has to be. A declaration wrapped onto its own line --
    #     const INTERACTION_ID =
    #       "lesson-08-intro-to-newtons-laws-9667eba1";
    # is how PHYS 110's builds write it, and the same-line-only pattern used here until
    # 2026-08-19 matched NOTHING there and reported the slug as '' on five artifacts whose
    # slugs were in fact correct and registered.
    #
    # A checker that reports the identity string as EMPTY when it is present is worse than one
    # that does not check it at all: the defect this line exists to catch is a suffix-less slug,
    # and a reader who has learned that this line cries wolf will not look at the next one.
    #
    # artifact_parse.RE_ID has always been the tolerant version, so the two disagreed about the
    # single most load-bearing string in the file -- one of them silently. They now agree, and
    # they must keep agreeing.
    m = re.search(r'^const INTERACTION_ID\s*=\s*"([^"]*)"', src, re.M)
    slug = m.group(1) if m else ""
    check(bool(re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{8}", slug)),
          "INTERACTION_ID is <stem>-<8 hex> per contract §3.2 (%r)" % slug)

    # The cardinal study-mode sin: a study session that can produce or submit a report.
    ngates = src.count('mode === "graded"')
    check(ngates >= 6, "study mode gated in >= 6 places (%d)" % ngates)
    if "function buildStudySystemPrompt" in src:
        tail = src.split("function buildStudySystemPrompt")[1]
        check("REPORT_FORMAT}" not in tail, "study prompt omits REPORT_FORMAT")
    else:
        check(False, "buildStudySystemPrompt present")

    for s in args.forbid:
        check(s not in src, "no leftover: %s" % s)

    for line in ok:
        print("  ok   %s" % line)
    for line in fail:
        print("  FAIL %s" % line)
    print("\n%d passed, %d failed" % (len(ok), len(fail)))
    print("NOTE: this is not a syntax check. Publishing is what parses the JSX.")
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
