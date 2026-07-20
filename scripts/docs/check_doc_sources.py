#!/usr/bin/env python3
"""Flag documents whose authoritative sources changed after the doc was last reviewed.

Read-only. Touches no database and writes no files — it only reads the index and asks git
when each file last changed.

The index is docs/DOC-SOURCES.json. Each entry names a document that MUST STAY CURRENT, the
sources it was derived from, and a 'reviewed' date attesting that someone checked it against
those sources. When a source has changed since that date, the document is flagged.

Usage:
    python scripts/docs/check_doc_sources.py            # flag stale docs (default)
    python scripts/docs/check_doc_sources.py check      # same
    python scripts/docs/check_doc_sources.py list       # print the whole index
    python scripts/docs/check_doc_sources.py check --json

Exit codes:
    0  nothing stale
    1  one or more documents flagged
    2  the index is broken, or a path in it no longer exists

Known limit: comparison is by date, not commit. A source edited later on the same day a doc
was reviewed is not flagged. Uncommitted edits ARE flagged regardless of date, which is the
case that matters most — it catches you before the change lands.
"""

import json
import subprocess
import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
INDEX = REPO / "docs" / "DOC-SOURCES.json"

# The index and its notes contain em dashes; the default Windows console code page mangles
# them. Force UTF-8 output, and never let an unencodable character crash a reporting tool.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def git(*args):
    """Run a git command in the repo and return raw stdout ('' on failure).

    Deliberately NOT stripped: `git status --porcelain` encodes state in the first two
    columns, so a leading space is significant and stripping it corrupts the path.
    """
    try:
        out = subprocess.run(
            ["git", *args],
            cwd=str(REPO),
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        sys.exit("git is not on PATH — this script needs it to read change dates.")
    return out.stdout if out.returncode == 0 else ""


def last_commit_date(relpath):
    """Date of the most recent commit touching relpath, or None if never committed."""
    iso = git("log", "-1", "--format=%cI", "--", relpath).strip()
    if not iso:
        return None
    return date.fromisoformat(iso[:10])


def dirty_paths():
    """Paths with uncommitted changes (staged, unstaged, or untracked).

    Untracked *directories* are reported by git as a single entry with a trailing slash
    (e.g. 'scripts/docs/'), so those are kept as prefixes and matched by is_dirty().
    """
    paths = set()
    for line in git("status", "--porcelain").splitlines():
        if len(line) < 4:
            continue
        # Columns 0-1 are the status code, column 2 is a space, the path starts at 3.
        # Renames read "R  old -> new"; the destination is what exists now.
        p = line[3:].split(" -> ")[-1].strip().strip('"')
        if p:
            paths.add(p)
    return paths


def is_dirty(relpath, dirty):
    """True if relpath is itself modified, or sits inside an untracked directory."""
    if relpath in dirty:
        return True
    return any(d.endswith("/") and relpath.startswith(d) for d in dirty)


def load_index():
    if not INDEX.exists():
        sys.exit(f"Index not found: {INDEX.relative_to(REPO)}")
    try:
        data = json.loads(INDEX.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err:
        sys.exit(f"{INDEX.relative_to(REPO)} is not valid JSON: {err}")
    if data.get("schema") != 1:
        sys.exit(f"Unsupported index schema: {data.get('schema')!r} (expected 1)")
    return data.get("docs", [])


def validate(entries):
    """Every path named in the index must exist. A rename that isn't reflected here is a bug."""
    missing = []
    for e in entries:
        for p in [e["doc"], *e.get("sources", [])]:
            if not (REPO / p).exists():
                missing.append((e["doc"], p))
    return missing


def evaluate(entries, dirty):
    """Return (stale, clean). A doc is stale if any source changed after it was reviewed."""
    stale, clean = [], []
    for e in entries:
        reviewed = date.fromisoformat(e["reviewed"])
        triggers = []
        for src in e.get("sources", []):
            if is_dirty(src, dirty):
                triggers.append((src, "uncommitted change"))
                continue
            changed = last_commit_date(src)
            if changed and changed > reviewed:
                triggers.append((src, f"changed {changed.isoformat()}"))
        (stale if triggers else clean).append({**e, "triggers": triggers})
    return stale, clean


def cmd_check(entries, as_json):
    dirty = dirty_paths()
    stale, clean = evaluate(entries, dirty)

    if as_json:
        print(json.dumps(
            {"stale": [{"doc": s["doc"], "reviewed": s["reviewed"],
                        "triggers": [{"source": a, "why": b} for a, b in s["triggers"]]}
                       for s in stale],
             "clean": [c["doc"] for c in clean]},
            indent=2))
        return 1 if stale else 0

    if not stale:
        print(f"All {len(clean)} indexed documents are current with their sources.")
        return 0

    print(f"{len(stale)} document(s) may be stale — a source changed after the last review:\n")
    for s in stale:
        tier = f" [{s['tier']}]" if s.get("tier") else ""
        print(f"  {s['doc']}{tier}")
        print(f"    last reviewed {s['reviewed']}")
        for src, why in s["triggers"]:
            print(f"      <- {src}  ({why})")
        if s.get("note"):
            print(f"    {s['note']}")
        print()
    print("Re-read each flagged document against its sources. If it is still correct, bump its")
    print("'reviewed' date in docs/DOC-SOURCES.json. If it is wrong, fix it — a help doc that")
    print("disagrees with the system is a bug, not a cosmetic issue.")
    return 1


def cmd_list(entries, as_json):
    if as_json:
        print(json.dumps(entries, indent=2))
        return 0
    print(f"{len(entries)} indexed document(s):\n")
    for e in sorted(entries, key=lambda x: (x["kind"], x["doc"])):
        tier = f" [{e['tier']}]" if e.get("tier") else ""
        print(f"  {e['doc']}  ({e['kind']}{tier}, reviewed {e['reviewed']})")
        for src in e.get("sources", []):
            print(f"      <- {src}")
        print()
    return 0


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("-")]
    as_json = "--json" in argv[1:]
    cmd = args[0] if args else "check"

    entries = load_index()

    missing = validate(entries)
    if missing:
        print("Index references paths that do not exist:\n")
        for doc, path in missing:
            print(f"  {doc}\n      missing: {path}")
        print("\nA renamed or deleted file must be updated in docs/DOC-SOURCES.json.")
        return 2

    if cmd == "check":
        return cmd_check(entries, as_json)
    if cmd == "list":
        return cmd_list(entries, as_json)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
