#!/usr/bin/env python3
"""extract_prompts.py - pull the REAL tutor system prompts out of a Gemini backup build.

WHY THIS EXISTS
---------------
The AskSage token trial has to answer one question: how many tokens does a real iPREP
session cost? The dominant term is the system prompt, which is re-sent on EVERY turn. A
guess at its size is worthless, because the arithmetic IS the trial.

The prompt is not stored anywhere as text. It is assembled at runtime inside each
`site/gemini/<course>/<slug>.html` build from four `String.raw` blocks and one template
literal. This script does the same assembly OFFLINE, in Python, and writes the result to
`tests/browser/data/asksage-prompts/<slug>.json` for the meter page to load.

WHY NOT LET THE BROWSER DO IT
-----------------------------
The meter page could fetch the build and regex it itself. It would then be a second,
invisible copy of this parser, drifting against the builds with nothing checking it - and a
wrong prompt produces a confident wrong token count, which is the exact failure this trial
cannot afford. One parser, in one place, whose output is a reviewable file.

WHAT IT ASSUMES ABOUT A BUILD (and checks, rather than hopes)
------------------------------------------------------------
Each of the four blocks opens with `const NAME = String.raw` + backtick on its own line and
closes with a line that is exactly backtick + semicolon. `buildSystemPrompt` opens with a
known signature and its template literal closes with backtick-semicolon-newline-brace.
Every one of these is asserted; a build that does not match is REFUSED, never guessed at.
Same posture as `scripts/artifacts/to_gemini.py`.

Stdlib only (CORE.md section 2). Dry-run by default; `--commit` writes.

    python scripts/asksage/extract_prompts.py --course phys-215 --lesson 02
    python scripts/asksage/extract_prompts.py --all --commit
"""

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
GEMINI = REPO / "site" / "gemini"
OUT_DIR = REPO / "tests" / "browser" / "data" / "asksage-prompts"

BLOCKS = ["TEXTBOOK_REFERENCE", "LESSON_CONFIG", "EXTENSION_PROBLEMS", "REPORT_FORMAT"]

# REPORT_FORMAT breaks its own raw string once, to get a literal backtick into the text:
#   ... from ` + "`LESSON_CONFIG.probe_topics`" + String.raw`, report:
# That is real source, not a typo, so the extractor folds it back to what the model sees
# rather than refusing the file over it.
_CONCAT = re.compile(r'` \+ "(`[^"]*`)" \+ String\.raw`')

SIG = "function buildSystemPrompt(cadetId, localTime, phase) {"

# The prompt also inlines the lesson's fixed objective list, built from OBJECTIVE_KEYS. It is
# short, but it is the list the tutor must report against, so it is assembled here rather than
# dropped - a prompt missing it is not the prompt the cadet's session uses.
_OBJ_DECL = re.compile(r"const OBJECTIVE_KEYS = \[(.*?)\n\];", re.S)
_OBJ_ROW = re.compile(r'\{\s*key:\s*"([^"]+)",\s*label:\s*"([^"]*)"\s*\}')
_OBJ_INTERP = re.compile(r'\$\{OBJECTIVE_KEYS\.map\(.*?\.join\("\\n"\)\}', re.S)


def read_build(path):
    """Read BYTES, decode explicitly, then normalize CRLF to LF ON PURPOSE.

    PROJECT.md records what an ACCIDENTAL text-mode read costs in this repo: universal
    newlines silently rewrite CRLF and a downstream write reports every line as changed.
    This one is deliberate and it is required for the measurement to be right.

    The builds are stored CRLF (4,358 of them in phys-215 lesson 2 alone). The ECMAScript
    spec normalizes CRLF and lone CR to LF when it computes a template literal's VALUE, so
    the string the tutor model actually receives has LF endings. Measuring the file's own
    bytes instead would add one character per line - about 4.3 KB, roughly 1,100 tokens
    per turn - to a number whose entire purpose is to be accurate.
    """
    return path.read_bytes().decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")


def raw_block(src, name):
    """One grounding block's text, for either dialect the builds are written in.

    TWO DIALECTS, and both are live. phys-215 and phys-310 open with `String.raw` and put
    the first line of content on the NEXT line; phys-110 uses a plain template literal and
    may start content on the SAME line. Insisting on one shape refused eleven of the
    thirty-eight builds - every phys-110 lesson - so the opener is matched rather than
    assumed. The CLOSE is identical in both: a line that is exactly backtick-semicolon.

    The plain-template dialect would process escape sequences and `${...}` where String.raw
    would not. Nothing here tries to emulate that: the leftover-interpolation check in
    assemble() is what catches a block that smuggles one in, and it fails loudly.
    """
    m = re.search(r"\nconst " + re.escape(name) + r" = (String\.raw)?" + chr(96), src)
    if not m:
        raise SystemExit("REFUSED: %s is not declared as a template literal" % name)
    start = m.end()
    if src[start:start + 1] == "\n":
        start += 1
    close = "\n" + chr(96) + ";\n"
    j = src.find(close, start)
    if j < 0:
        raise SystemExit("REFUSED: %s is not closed by a bare backtick-semicolon line" % name)
    return _CONCAT.sub(lambda mm: mm.group(1), src[start:j])


def prompt_template(src):
    """The buildSystemPrompt template literal, interpolations left intact."""
    i = src.find("\n" + SIG + "\n")
    if i < 0:
        raise SystemExit("REFUSED: buildSystemPrompt signature not found verbatim")
    opener = "return " + chr(96)
    start = src.find(opener, i)
    if start < 0:
        raise SystemExit("REFUSED: buildSystemPrompt does not open with a template literal")
    start += len(opener)
    end = src.find(chr(96) + ";\n}", start)
    if end < 0:
        raise SystemExit("REFUSED: buildSystemPrompt template literal is not closed as expected")
    return src[start:end]


def objective_lines(src):
    """Render the `OBJECTIVE_KEYS.map(...)` line exactly as the build renders it."""
    m = _OBJ_DECL.search(src)
    if not m:
        raise SystemExit("REFUSED: OBJECTIVE_KEYS array not found")
    rows = _OBJ_ROW.findall(m.group(1))
    if not rows:
        raise SystemExit("REFUSED: OBJECTIVE_KEYS parsed to zero entries")
    return "\n".join("  %s — %s" % (k, lab) for k, lab in rows)


def assemble(tpl, blocks, objectives, cadet_id, local_time, phase):
    """Resolve exactly the interpolations the template uses - no general JS evaluation.

    Every substitution is listed below. Anything left over is reported, so a build that
    grows a new interpolation fails loudly here instead of quietly shipping a SHORT prompt
    to the meter and understating the cost.
    """
    out = tpl
    out = out.replace("${cadetId}", cadet_id)
    out = out.replace("${localTime}", local_time)
    out = out.replace("${TEXTBOOK_REFERENCE}", blocks["TEXTBOOK_REFERENCE"])
    out = out.replace("${LESSON_CONFIG}", blocks["LESSON_CONFIG"])
    out = _OBJ_INTERP.sub(lambda m: objectives, out, count=1)

    ext = "\n" + blocks["EXTENSION_PROBLEMS"] + "\n" if phase == "extension" else ""
    out = re.sub(r'\$\{phase === "extension" \? [^}]*\}\\?\n?', ext, out, count=1)

    rep = ("" if phase in ("probe", "")
           else "\nOUTPUT_REPORT_FORMAT (produce exactly this structure):\n"
                + blocks["REPORT_FORMAT"])
    out = re.sub(r'\$\{phase === "probe" \|\| !phase\n.*?REPORT_FORMAT\}', rep, out,
                 count=1, flags=re.S)

    left = re.findall(r"\$\{[^}]{0,60}", out)
    if left:
        raise SystemExit("REFUSED: unresolved interpolation(s) in the template: %r" % left[:3])
    return out


def approx_tokens(text):
    """A CHARACTER estimate, and it is labelled one everywhere it is shown.

    Nothing here tokenizes. No tokenizer for these models is installable under the
    stdlib-only rule, and a wrong one is worse than an honest ratio. The meter page
    replaces every one of these with the MEASURED `prompt_tokens` the moment a real call
    returns; this number exists only so the page can show a lesson's weight before the
    first call is made.
    """
    return round(len(text) / 4)


def do_one(path, commit, with_text):
    src = read_build(path)
    blocks = dict((n, raw_block(src, n)) for n in BLOCKS)
    tpl = prompt_template(src)
    objectives = objective_lines(src)

    phases = {}
    for phase in ("probe", "report", "extension"):
        text = assemble(tpl, blocks, objectives, "Cadet", "2026-09-11 19:00 (America/Denver)", phase)
        phases[phase] = {"chars": len(text),
                         "approx_tokens": approx_tokens(text),
                         "text": text}

    rec = {
        "slug": path.stem,
        "course": path.parent.name,
        "source": str(path.relative_to(REPO)).replace("\\", "/"),
        "blocks": dict((n, len(b)) for n, b in blocks.items()),
        "phases": phases,
    }

    out = OUT_DIR / (path.stem + ".json")
    print("%-9s %-54s probe %6d chars (~%5d tok)"
          % (rec["course"], rec["slug"][:54], phases["probe"]["chars"],
             phases["probe"]["approx_tokens"]))

    # THE PROMPT TEXT IS ONLY WRITTEN WHEN ASKED FOR, and that is a size decision, not a
    # preference. Three phases of a large lesson is ~250 KB of JSON; all 47 builds would put
    # roughly 12 MB of duplicated prose into a repo whose whole point is that it has no build
    # step. The index carries every lesson's SIZE, which is what the projection needs; the
    # full text is committed only for the two or three lessons the trial actually runs.
    if not with_text:
        if commit:
            print("   sizes only (add --with-text to write the prompt itself)")
        return rec

    if commit:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        with open(out, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(rec, fh, indent=2)
        print("   wrote %s" % out.relative_to(REPO).as_posix())
    else:
        print("   would write %s" % out.relative_to(REPO).as_posix())
    return rec


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--course", help="phys-110 | phys-215 | phys-310")
    ap.add_argument("--lesson", help="lesson number, e.g. 02 - matches the slug prefix")
    ap.add_argument("--all", action="store_true", help="every build under site/gemini/")
    ap.add_argument("--with-text", action="store_true",
                    help="also write each lesson's full prompt text (large; default: sizes only "
                         "under --all, always on for a single named lesson)")
    ap.add_argument("--commit", action="store_true", help="write the JSON (default: dry run)")
    a = ap.parse_args()

    if a.all:
        paths = sorted(GEMINI.glob("*/*.html"))
    elif a.course:
        pat = ("lesson-%s-*.html" % a.lesson) if a.lesson else "*.html"
        paths = sorted((GEMINI / a.course).glob(pat))
    else:
        ap.error("give --all, or --course (optionally with --lesson)")

    if not paths:
        print("no builds matched", file=sys.stderr)
        return 1

    index = []
    for p in paths:
        rec = do_one(p, a.commit, a.with_text or not a.all)
        index.append({"slug": rec["slug"], "course": rec["course"],
                      "source": rec["source"],
                      "probe_chars": rec["phases"]["probe"]["chars"],
                      "probe_approx_tokens": rec["phases"]["probe"]["approx_tokens"]})

    # ONLY --all WRITES THE INDEX. A single-lesson run used to rewrite it too, which left a
    # 47-entry index replaced by a 1-entry one and the meter page offering a single lesson -
    # silently, because a 1-entry index is perfectly valid JSON. Rebuild the index with --all;
    # add a lesson's text with a named run.
    if not a.all:
        print("\n%s - 1 lesson. Index left alone; rebuild it with --all --commit."
              % ("WROTE" if a.commit else "DRY RUN"))
        return 0

    if a.commit:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        with open(OUT_DIR / "index.json", "w", encoding="utf-8", newline="\n") as fh:
            json.dump(index, fh, indent=2)
        print("\nindex: %d lesson(s) -> %s"
              % (len(index), (OUT_DIR / "index.json").relative_to(REPO).as_posix()))
    else:
        print("\nDRY RUN - %d lesson(s). Re-run with --commit to write." % len(index))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
