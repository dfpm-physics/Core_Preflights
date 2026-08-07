#!/usr/bin/env python3
"""Verify this machine can actually resolve the RAG grounding corpus. READ ONLY.

`/preflight-analyze` grounds its grading in textbook PDFs. It resolves each entry of the
committed manifest (`textbook-pdfs/rag-manifest.txt`) under `textbook_base_path` from
`~/.claude/skills/preflight-analyze/config.json`. When that resolution fails the skill
**warns and grades anyway**, which is the right call for one missing lesson and the wrong
thing to discover after a term of ungrounded grading. Nothing else checks it.

This is the check. It reads two files and stats some paths; it writes nothing, connects to
nothing, and never opens a PDF.

    python scripts/grounding/check_grounding.py            # summary + what is missing
    python scripts/grounding/check_grounding.py --verbose  # list every entry
    python scripts/grounding/check_grounding.py --base X   # test a candidate path

Exit codes:  0 = every manifest entry resolved.  1 = something is missing or misconfigured.

WHY THE LAYOUT NEEDS A BRIDGE. Manifest entries begin `Text_Book_PDFs/<NNN> Sections/`
because that is the literal string stored in the live `activities.content.reference_pdf`,
and changing it would mean a data migration across 111 activities. The repo stores the PDFs
at `textbook-pdfs/phys-110/` and `textbook-pdfs/phys-215/`. So `textbook_base_path` must
point at a directory containing a `Text_Book_PDFs/` tree with `110 Sections` and
`215 Sections` inside it — see textbook-pdfs/README.md for the two supported ways to get
one. This script exists because that mismatch is invisible until grading quality drops.
"""
import argparse
import json
import os
import sys

CONFIG_PATH = os.path.expanduser("~/.claude/skills/preflight-analyze/config.json")
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MANIFEST = os.path.join(REPO_ROOT, "textbook-pdfs", "rag-manifest.txt")


def read_manifest(path):
    """One reference per line; blank lines and #-comments ignored (the manifest's own rule)."""
    if not os.path.isfile(path):
        sys.exit(f"Manifest not found: {path}\nThis script must run from inside the repo.")
    with open(path, encoding="utf-8") as f:
        return [ln.strip() for ln in f if ln.strip() and not ln.lstrip().startswith("#")]


def configured_base():
    if not os.path.isfile(CONFIG_PATH):
        return None, f"No config at {CONFIG_PATH} — run /setup-preflight, or pass --base."
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            base = json.load(f).get("textbook_base_path")
    except (OSError, json.JSONDecodeError) as e:
        return None, f"Could not read {CONFIG_PATH}: {e}"
    if not base:
        return None, f"`textbook_base_path` is not set in {CONFIG_PATH}."
    return base, None


def main():
    ap = argparse.ArgumentParser(description="Verify the RAG grounding corpus resolves on this machine.")
    ap.add_argument("--base", help="Override textbook_base_path (test a candidate without editing config).")
    ap.add_argument("--verbose", action="store_true", help="List every entry, not just the failures.")
    args = ap.parse_args()

    entries = read_manifest(MANIFEST)

    if args.base:
        base, err = args.base, None
    else:
        base, err = configured_base()
    if err:
        print(f"FAIL  {err}")
        return 1

    print(f"manifest : {MANIFEST}  ({len(entries)} entries)")
    print(f"base     : {base}")
    if not os.path.isdir(base):
        print(f"\nFAIL  base path is not a directory.")
        return 1

    resolved, missing = [], []
    for e in entries:
        (resolved if os.path.isfile(os.path.join(base, e)) else missing).append(e)

    print(f"\nresolved : {len(resolved)} of {len(entries)}")
    if args.verbose:
        for e in resolved:
            print(f"    ok      {e}")
    for e in missing:
        print(f"    MISSING {e}")

    # Per-course, because one course grading blind while the other is fine is the common shape.
    by_course = {}
    for e in entries:
        head = e.split("/")[1] if e.count("/") >= 2 else "(other)"
        ok, tot = by_course.get(head, (0, 0))
        by_course[head] = (ok + (e in resolved), tot + 1)
    if len(by_course) > 1:
        print("\nby folder:")
        for k in sorted(by_course):
            ok, tot = by_course[k]
            print(f"    {k:<16} {ok}/{tot}" + ("" if ok == tot else "   <-- grading here is ungrounded"))

    if missing:
        print(
            "\nFAIL  Grading will proceed WITHOUT grounding for the entries above.\n"
            "      Usual causes, in order:\n"
            "        1. `textbook_base_path` points at the repo's textbook-pdfs/ folder. It must\n"
            "           point at a directory CONTAINING `Text_Book_PDFs/{110,215} Sections/`.\n"
            "        2. The PDFs were never downloaded (Teams -> Files -> Core_Preflights_PDFs).\n"
            "        3. A filename differs from the manifest by a character. The manifest is the\n"
            "           contract and matches the live database; rename the file, not the manifest.\n"
            "      See textbook-pdfs/README.md."
        )
        return 1

    print("\nOK    Every manifest entry resolves. RAG grounding is available on this machine.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
