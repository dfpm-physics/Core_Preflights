#!/usr/bin/env python3
"""Flag documents whose authoritative sources changed after the doc was last reviewed.

Read-only by default. `status --write` is the ONE command that writes a file: it publishes the
staleness verdict for the in-app help centre (see below).

The index is docs/DOC-SOURCES.json. Each entry names a document that MUST STAY CURRENT, the
sources it was derived from, and a 'reviewed' date attesting that someone checked it against
those sources. When a source has changed since that date, the document is flagged.

Usage:
    python scripts/docs/check_doc_sources.py            # flag stale docs (default)
    python scripts/docs/check_doc_sources.py check      # same
    python scripts/docs/check_doc_sources.py list       # print the whole index
    python scripts/docs/check_doc_sources.py check --json
    python scripts/docs/check_doc_sources.py status     # preview the help-centre banner data
    python scripts/docs/check_doc_sources.py status --write   # write site/app/help/DOC-STATUS.json

Exit codes:
    0  nothing stale
    1  one or more documents flagged
    2  the index is broken, or a path in it no longer exists

Known limit: comparison is by date, not commit. A source edited later on the same day a doc
was reviewed is not flagged. Uncommitted edits ARE flagged regardless of date, which is the
case that matters most — it catches you before the change lands.

THE SNAPSHOT PROBLEM (read before trusting DOC-STATUS.json). A browser cannot run git, so the
help centre cannot compute staleness itself — it reads a file this script generates. That file
is a SNAPSHOT: edit a source and skip the regenerate, and the help centre goes on saying a
flagged page is fine. That is the same unearned green light this whole mechanism exists to
prevent, so the file stamps the date and commit it was generated at, and the help centre shows
that date to the reader rather than presenting the verdict as live. Regenerate whenever you
would run `check` — the `check` command prints a reminder when the two disagree.
"""

import json
import subprocess
import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
INDEX = REPO / "docs" / "DOC-SOURCES.json"

# Published beside the help content so the help centre can fetch it with the same relative base
# it already uses for MANIFEST.json. Generated — never hand-edit it.
STATUS = REPO / "site" / "app" / "help" / "DOC-STATUS.json"

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

    # The help centre warns readers off flagged topics, but only from the published snapshot.
    # If that snapshot disagrees with what was just computed, readers are being told the wrong
    # thing right now — either shown a banner that has been resolved, or worse, shown none.
    # Compared on the committed basis both sides, so an in-progress working tree does not nag
    # about a status file that is in fact correct for what is deployed.
    published = status_on_disk()
    want = build_status(entries)["stale"]
    have = (published or {}).get("stale")
    if published is None:
        print(f"\nNOTE: {STATUS.relative_to(REPO)} does not exist, so the in-app help centre is "
              f"showing\nno warning at all. Run: python scripts/docs/check_doc_sources.py status --write")
    elif have != want:
        print(f"\nNOTE: {STATUS.relative_to(REPO)} is out of step with the above "
              f"(generated {published.get('generated', 'unknown')}), so readers of the help centre\n"
              f"are being warned about the wrong set of topics. Run: "
              f"python scripts/docs/check_doc_sources.py status --write")
    return 1


def build_status(entries):
    """The help centre's view of staleness, keyed by the filename MANIFEST.json uses.

    Only `kind: help` entries are published. The rest of the index (design docs, skills, the
    cutover runbook) is not reachable from the help centre, and listing it would put paths on a
    public page for documents no reader there can open.

    Evaluated against COMMITTED history only — note the empty dirty set, which is the one place
    this deliberately diverges from `check`. The two commands answer different questions:

      check          "must I re-read something before I commit?"  -> dirty-sensitive, by design
      status --write "what should readers be warned about?"       -> committed state only

    Honouring the working tree here would publish a warning caused by whatever the operator
    happened to have open — non-deterministic between operators, and about a change no reader
    can see yet, since the site only serves what was pushed.
    """
    stale, _ = evaluate(entries, dirty=set())
    flagged = {}
    for s in stale:
        if s.get("kind") != "help":
            continue
        flagged[Path(s["doc"]).name] = {
            "reviewed": s["reviewed"],
            "tier": s.get("tier"),
            # Paths, not basenames: two different sources can share a basename, and staff
            # reading this need to know which file moved.
            "sources": [src for src, _why in s["triggers"]],
        }
    head = git("rev-parse", "--short", "HEAD").strip()
    return {
        "schema": 1,
        "generated": date.today().isoformat(),
        "commit": head or None,
        "note": ("Generated by scripts/docs/check_doc_sources.py status --write. Do not hand-edit. "
                 "This is a SNAPSHOT: if a source changed after 'generated', the help centre does "
                 "not know yet. Regenerate whenever you run the check."),
        "stale": flagged,
    }


def status_on_disk():
    """The published status file, or None if absent/unreadable. Never raises."""
    try:
        return json.loads(STATUS.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def cmd_status(entries, write):
    payload = build_status(entries)
    flagged = payload["stale"]

    if not write:
        print("Preview only — nothing written. Re-run with --write to publish.\n")
        print(json.dumps(payload, indent=2))
        print(f"\nWould write: {STATUS.relative_to(REPO)}")
        return 0

    STATUS.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    rel = STATUS.relative_to(REPO)
    if flagged:
        print(f"Wrote {rel} — {len(flagged)} help topic(s) flagged for readers:\n")
        for name, info in sorted(flagged.items()):
            print(f"  {name}  (reviewed {info['reviewed']}, {len(info['sources'])} source(s) moved)")
    else:
        print(f"Wrote {rel} — no help topic is flagged; the banner will not appear anywhere.")
    print("\nThe help centre reads this file. It is only true as of the 'generated' date, so "
          "commit it\nalongside whatever made it change — a stale status file is a silent "
          "all-clear.")
    return 0


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
    if cmd == "status":
        return cmd_status(entries, write="--write" in argv[1:])
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
