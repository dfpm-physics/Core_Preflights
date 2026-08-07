#!/usr/bin/env python3
"""Flag indexed documents whose sources have moved since they were last reviewed.

WHAT THIS IS FOR
----------------
`docs/DOC-SOURCES.json` is an attestation ledger. Every document in it that must
stay current lists the authoritative sources it was written from, plus a
`reviewed` date. That date is not an edit date: it attests that a person or
agent read the document against those sources on that day and found it correct.
Fixing a typo does not advance it. Re-checking the content against the sources
does.

This script is what turns that convention into a mechanism. A rule with no
mechanism is how documentation rots -- good intentions do not survive the third
quarter, and a stale document is worse than a missing one because a reader who
trusts it acts on it. The script compares each source's last change against the
document's `reviewed` date and prints the documents that are now suspect.

It never reads a document's own content or its own timestamp. It cannot know
whether a document is correct; it knows only that the ground under it moved and
that nobody has attested to it since.

WHAT IS DELIBERATELY NOT INDEXED
--------------------------------
`docs/decisions/` and `docs/contracts/` are point-in-time records and frozen
interfaces. They are superseded rather than refreshed, so a staleness flag on
them is permanent noise -- and a checker that always complains is a checker
everybody learns to ignore. Do not register them.

KNOWN LIMIT -- STATED HONESTLY
------------------------------
Comparison is by DATE, not by commit. A source committed later on the same day a
document was reviewed is not flagged, because both reduce to the same
`YYYY-MM-DD` string. This is a real hole and the tool does not pretend
otherwise; same-day edits after a review are the one case that slips through.

Uncommitted edits are flagged regardless of date, and that is the case that
matters most: it fires while the change is still in the working tree, before it
lands, when fixing the document is still part of the same piece of work rather
than a chore discovered weeks later.

EXIT CODES
----------
    0  nothing flagged
    1  one or more documents flagged as possibly stale
    2  the index is broken, a path in it no longer exists, or the environment
       is unusable (no git, not a git repository, unreadable index)

Code 1 and code 2 mean genuinely different things. Code 1 is the tool working.
Code 2 is the tool unable to work, and must never be mistaken for a clean run.
"""

import argparse
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

SUPPORTED_SCHEMA = 1
DEFAULT_INDEX_RELATIVE = "docs/DOC-SOURCES.json"

EXIT_OK = 0
EXIT_STALE = 1
EXIT_UNUSABLE = 2

REQUIRED_ENTRY_KEYS = ("doc", "reviewed", "kind")
OPTIONAL_ENTRY_KEYS = ("sources", "tier", "note")
KNOWN_ENTRY_KEYS = frozenset(REQUIRED_ENTRY_KEYS + OPTIONAL_ENTRY_KEYS)

# Top level tolerates any key beginning with "_" as a free-text comment.
KNOWN_TOP_LEVEL_KEYS = frozenset(("schema", "updated", "docs"))

COMMANDS = ("check", "list", "validate", "status")


class Unusable(Exception):
    """Raised for every condition that must exit 2.

    Every error path routes here so that "the index is broken" can never be
    reported with the same exit code as "a document is stale".
    """


# ---------------------------------------------------------------------------
# environment
# ---------------------------------------------------------------------------


def configure_streams():
    """Make stdout/stderr able to carry the report's em-dashes and arrows.

    The default Windows console code page cannot encode them and would raise
    UnicodeEncodeError halfway through an otherwise successful report.
    """
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


def find_repo_root(override=None):
    """Locate the repository root.

    Deliberately not derived from this file's own depth on disk. Hardcoding
    something like `Path(__file__).parents[2]` means moving or vendoring the
    script silently resolves every path in the index against the wrong
    directory -- and "wrong directory" reads, downstream, as "every source is
    missing" or worse as "nothing changed".
    """
    if override is not None:
        root = Path(override).expanduser().resolve()
        if not root.is_dir():
            raise Unusable("--repo is not a directory: {}".format(root))
        return root

    here = Path(__file__).resolve()

    completed = _try_run_git(["rev-parse", "--show-toplevel"], cwd=here.parent)
    if completed is not None and completed.returncode == 0:
        top = completed.stdout.strip()
        if top:
            return Path(top).resolve()

    # Fallback: walk up looking for .git. It may be a directory (normal clone)
    # or a file (worktree or submodule), so test for existence, not for a dir.
    for candidate in here.parents:
        if (candidate / ".git").exists():
            return candidate

    raise Unusable(
        "could not locate the repository root -- `git rev-parse --show-toplevel` "
        "failed and no .git was found above {}. Pass --repo explicitly.".format(here)
    )


def _try_run_git(args, cwd):
    """Run git, returning None if git is not installed rather than raising."""
    try:
        return subprocess.run(
            ["git"] + list(args),
            cwd=str(cwd),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True,
        )
    except FileNotFoundError:
        return None


def run_git(repo_root, args):
    completed = _try_run_git(args, cwd=repo_root)
    if completed is None:
        raise Unusable(
            "git was not found on PATH. This script compares commit dates and "
            "cannot produce a trustworthy answer without it."
        )
    return completed


def ensure_git_repo(repo_root):
    """Refuse to run outside a git repository.

    This guard is the whole point. A git wrapper that swallows non-zero exits
    and returns an empty string reports every source as never-committed, which
    renders as a clean bill of health -- the precise failure this tool exists
    to prevent, delivered with a green checkmark.
    """
    completed = run_git(repo_root, ["rev-parse", "--is-inside-work-tree"])
    if completed.returncode != 0 or completed.stdout.strip() != "true":
        raise Unusable(
            "{} is not a git repository, so source history cannot be read. "
            "Refusing to report anything as current.".format(repo_root)
        )


# ---------------------------------------------------------------------------
# index loading and validation
# ---------------------------------------------------------------------------


def load_index(index_path):
    if not index_path.is_file():
        raise Unusable("index not found: {}".format(index_path))
    try:
        text = index_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise Unusable("could not read {}: {}".format(index_path, exc))
    try:
        return json.loads(text)
    except ValueError as exc:
        raise Unusable("{} is not valid JSON: {}".format(index_path, exc))


def parse_reviewed(value):
    """Parse a strict YYYY-MM-DD string, or return None.

    `date.fromisoformat` accepts extra formats on Python 3.11+ (basic form,
    week dates), so the shape is checked explicitly first. The index is meant
    to be readable by a person scanning it, and one entry written `20260722`
    while every other reads `2026-07-22` is exactly the kind of drift this
    validator exists to catch.
    """
    if not isinstance(value, str) or len(value) != 10:
        return None
    if value[4] != "-" or value[7] != "-":
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def validate_index(data, repo_root, index_path):
    """Validate schema, keys, dates and paths. Raise Unusable listing every problem.

    Strict by design. A previous version of this index carried one entry using
    `why` where every other used `note`; the key was silently ignored, so that
    entry's rationale never printed and nothing ever said so. Unknown keys are
    rejected for that reason: a typo'd key is indistinguishable from a missing
    one at read time, and the reader never learns which they are looking at.
    """
    problems = []
    warnings = []

    if not isinstance(data, dict):
        raise Unusable("{}: top level must be a JSON object.".format(index_path))

    unknown_top = sorted(
        key for key in data
        if key not in KNOWN_TOP_LEVEL_KEYS and not key.startswith("_")
    )
    for key in unknown_top:
        problems.append(
            "top level: unknown key {!r} (known: {}, or any key starting with '_')".format(
                key, ", ".join(sorted(KNOWN_TOP_LEVEL_KEYS))
            )
        )

    schema = data.get("schema")
    if "schema" not in data:
        problems.append("top level: missing required key 'schema'")
    elif isinstance(schema, bool) or not isinstance(schema, int):
        problems.append(
            "top level: 'schema' must be an integer, got {!r}".format(schema)
        )
    elif schema != SUPPORTED_SCHEMA:
        problems.append(
            "top level: unsupported schema {}; this script understands schema {}".format(
                schema, SUPPORTED_SCHEMA
            )
        )

    raw_entries = data.get("docs")
    if "docs" not in data:
        problems.append("top level: missing required key 'docs'")
        raw_entries = []
    elif not isinstance(raw_entries, list):
        problems.append("top level: 'docs' must be a list of entries")
        raw_entries = []

    today = date.today()
    entries = []
    seen_docs = {}

    for position, raw in enumerate(raw_entries):
        label = "docs[{}]".format(position)
        if not isinstance(raw, dict):
            problems.append("{}: entry must be an object".format(label))
            continue

        doc = raw.get("doc")
        if isinstance(doc, str) and doc:
            label = "{} ({})".format(label, doc)

        for key in sorted(raw):
            if key not in KNOWN_ENTRY_KEYS:
                problems.append(
                    "{}: unknown key {!r} -- did you mean one of: {}?".format(
                        label, key, ", ".join(sorted(KNOWN_ENTRY_KEYS))
                    )
                )

        if not isinstance(doc, str) or not doc:
            problems.append("{}: 'doc' is required and must be a non-empty string".format(label))
            doc = None
        elif doc in seen_docs:
            problems.append(
                "{}: duplicate 'doc' -- already declared at docs[{}]".format(label, seen_docs[doc])
            )
        else:
            seen_docs[doc] = position

        kind = raw.get("kind")
        if not isinstance(kind, str) or not kind:
            problems.append("{}: 'kind' is required and must be a non-empty string".format(label))
            kind = None

        reviewed_raw = raw.get("reviewed")
        reviewed_date = parse_reviewed(reviewed_raw)
        if "reviewed" not in raw:
            problems.append("{}: missing required key 'reviewed' (YYYY-MM-DD)".format(label))
        elif reviewed_date is None:
            problems.append(
                "{}: 'reviewed' must be a YYYY-MM-DD string, got {!r}".format(label, reviewed_raw)
            )
        elif reviewed_date > today:
            # A future date suppresses every trigger for this document until it
            # arrives, and nothing else in the toolchain would ever mention it.
            problems.append(
                "{}: 'reviewed' is in the future ({}); a future review date "
                "silently disables staleness checking for this document".format(label, reviewed_raw)
            )

        sources = raw.get("sources", [])
        if not isinstance(sources, list):
            problems.append("{}: 'sources' must be a list of path strings".format(label))
            sources = []
        else:
            bad = [s for s in sources if not isinstance(s, str) or not s]
            if bad:
                problems.append(
                    "{}: 'sources' must contain non-empty strings; got {!r}".format(label, bad[0])
                )
                sources = [s for s in sources if isinstance(s, str) and s]

        tier = raw.get("tier", None)
        if tier is not None and not isinstance(tier, str):
            problems.append("{}: 'tier' must be a string or null".format(label))

        note = raw.get("note")
        if note is not None and not isinstance(note, str):
            problems.append("{}: 'note' must be a string".format(label))
            note = None

        if doc is not None:
            _check_path(repo_root, doc, "{}: doc".format(label), problems)
        for source in sources:
            _check_path(repo_root, source, "{}: source".format(label), problems)

        if doc is not None and doc in sources:
            # Not fatal -- it merely makes the document permanently flag itself
            # the moment anyone touches it, which is noise rather than signal.
            warnings.append(
                "{}: lists itself as one of its own sources; remove it -- a "
                "document is never evidence for itself".format(label)
            )

        if doc is not None and kind is not None and reviewed_date is not None:
            entries.append({
                "doc": doc,
                "kind": kind,
                "reviewed": reviewed_raw,
                "sources": sources,
                "tier": tier,
                "note": note,
            })

    if problems:
        raise Unusable(
            "{} is invalid:\n  - {}".format(index_path, "\n  - ".join(problems))
        )

    return entries, warnings


def _check_path(repo_root, rel_path, label, problems):
    """Confirm a path exists as a file and resolves inside the repository."""
    if "\\" in rel_path:
        problems.append(
            "{}: use forward slashes in index paths, got {!r} -- git reports "
            "paths with forward slashes on every platform".format(label, rel_path)
        )
        return
    candidate = Path(rel_path)
    if candidate.is_absolute():
        problems.append(
            "{}: paths must be relative to the repository root, got {!r}".format(label, rel_path)
        )
        return

    resolved = (repo_root / candidate).resolve()
    try:
        # Containment check: without it a `../` path escapes the repository
        # entirely and is then checked against a git history that does not
        # cover it, which produces confident nonsense.
        resolved.relative_to(repo_root)
    except ValueError:
        problems.append(
            "{}: path escapes the repository root: {!r}".format(label, rel_path)
        )
        return

    if not resolved.is_file():
        problems.append("{}: path does not exist: {}".format(label, rel_path))


# ---------------------------------------------------------------------------
# git state
# ---------------------------------------------------------------------------


def unquote_path(path):
    """Strip the surrounding quotes git adds to paths with unusual characters."""
    if len(path) >= 2 and path.startswith('"') and path.endswith('"'):
        return path[1:-1]
    return path


def collect_dirty_paths(repo_root):
    """Return (dirty_files, dirty_directories) from one `git status --porcelain`.

    One subprocess for the whole working tree, not one per path.
    """
    completed = run_git(repo_root, ["status", "--porcelain"])
    if completed.returncode != 0:
        raise Unusable(
            "`git status --porcelain` failed: {}".format(
                completed.stderr.strip() or "no error output"
            )
        )

    dirty_files = set()
    dirty_directories = set()

    for line in completed.stdout.splitlines():
        if len(line) < 4:
            continue
        # Columns 0 and 1 are the index and worktree status letters, column 2
        # is the separator, and the path begins at column 3. Do NOT lstrip the
        # line: a leading space is itself a status value (" M" means modified
        # but unstaged), so stripping shifts every path by one character and
        # silently mangles the first letter of every filename.
        path = line[3:]

        if " -> " in path:
            # Rename or copy: "XY ORIG -> DEST". Only DEST exists now, and the
            # index refers to files that exist.
            path = path.split(" -> ", 1)[1]

        path = unquote_path(path)
        if not path:
            continue

        if path.endswith("/"):
            # Porcelain collapses an untracked directory into a single entry,
            # so every file beneath it is dirty by prefix and never appears by
            # name in this output.
            dirty_directories.add(path)
        else:
            dirty_files.add(path)

    return dirty_files, dirty_directories


def path_is_dirty(rel_path, dirty_files, dirty_directories):
    if rel_path in dirty_files:
        return True
    return any(rel_path.startswith(prefix) for prefix in dirty_directories)


def last_commit_date(repo_root, rel_path, cache):
    """Return the YYYY-MM-DD of the last commit touching rel_path, or None.

    Cached per path. A source shared by N documents is one subprocess, not N --
    the uncached version ran one `git log` per (document, source) pair.
    """
    if rel_path in cache:
        return cache[rel_path]

    completed = run_git(repo_root, ["log", "-1", "--format=%cI", "--", rel_path])
    if completed.returncode != 0:
        raise Unusable(
            "`git log` failed for {}: {}".format(
                rel_path, completed.stderr.strip() or "no error output"
            )
        )

    stamp = completed.stdout.strip()
    # %cI is a full ISO-8601 timestamp; its first 10 characters are the date.
    result = stamp[:10] if stamp else None
    cache[rel_path] = result
    return result


# ---------------------------------------------------------------------------
# the staleness pass
# ---------------------------------------------------------------------------


def evaluate(repo_root, entries, ignore_dirty=False):
    """Return (stale_records, clean_docs).

    A document's own file is never examined. Whether the document was edited
    yesterday says nothing about whether anybody checked it against its
    sources -- only `reviewed` says that, and only its sources can contradict it.

    `ignore_dirty` exists for one caller, `build_status`, and the divergence is
    deliberate. The two commands answer different questions:

      check          "must I re-read something before I commit?"  -> dirty-sensitive
      status --write "what should readers be warned about?"       -> committed only

    Honouring the working tree when publishing would put a warning on the help
    centre caused by whatever the operator happened to have open -- not
    reproducible between operators, and about a change no reader can see yet,
    since the site serves only what was pushed.
    """
    if ignore_dirty:
        dirty_files, dirty_directories = set(), set()
    else:
        dirty_files, dirty_directories = collect_dirty_paths(repo_root)
    commit_date_cache = {}

    stale = []
    clean = []

    for entry in entries:
        triggers = []
        for source in entry["sources"]:
            if path_is_dirty(source, dirty_files, dirty_directories):
                # Dirty-sensitive by design: the flag fires while the change is
                # still in the working tree, so the document gets fixed as part
                # of the same change rather than discovered stale later. No date
                # comparison can un-flag this, so skip it.
                triggers.append({"source": source, "why": "uncommitted change"})
                continue

            committed = last_commit_date(repo_root, source, commit_date_cache)
            if committed is None:
                # Never committed and not dirty: no history to compare against.
                continue

            if committed > entry["reviewed"]:
                triggers.append({"source": source, "why": "committed {}".format(committed)})

        if triggers:
            stale.append({
                "doc": entry["doc"],
                "reviewed": entry["reviewed"],
                "triggers": triggers,
                "note": entry["note"],
                # Carried through for `build_status`, which publishes only `kind: help`
                # entries and shows the reader which tier the topic belongs to.
                "kind": entry.get("kind"),
                "tier": entry.get("tier"),
            })
        else:
            clean.append(entry["doc"])

    return stale, clean


# ---------------------------------------------------------------------------
# reporting
# ---------------------------------------------------------------------------


ADVISORY = """
Re-read each flagged document against its sources.
  - If the document is still correct, bump its `reviewed` date in the index.
  - If it is wrong, fix the document -- a document that disagrees with the
    system is a bug, not a cosmetic issue.

`reviewed` attests that somebody checked the document against those sources on
that date. It is not an edit date, so do not bump it for a typo fix.
""".strip()


def print_warnings(warnings):
    for warning in warnings:
        print("warning: {}".format(warning), file=sys.stderr)


def report_check_human(stale, clean):
    if not stale:
        print("All {} indexed documents are current with their sources.".format(len(clean)))
        return

    total = len(stale) + len(clean)
    print("{} of {} indexed documents may be stale:".format(len(stale), total))
    print()

    for record in stale:
        print(record["doc"])
        print("  last reviewed {}".format(record["reviewed"]))
        for trigger in record["triggers"]:
            print("    <- {}  ({})".format(trigger["source"], trigger["why"]))
        if record["note"]:
            print("  note: {}".format(record["note"]))
        print()

    print(ADVISORY)


def report_check_json(stale, clean):
    payload = {
        "stale": [
            {
                "doc": record["doc"],
                "reviewed": record["reviewed"],
                "triggers": record["triggers"],
            }
            for record in stale
        ],
        "clean": clean,
    }
    print(json.dumps(payload, indent=2))


def report_list_human(entries):
    if not entries:
        print("The index contains no documents.")
        return

    current_kind = None
    for entry in entries:
        if entry["kind"] != current_kind:
            current_kind = entry["kind"]
            print(current_kind)
        print("  {}   reviewed {}".format(entry["doc"], entry["reviewed"]))
        for source in entry["sources"]:
            print("    <- {}".format(source))
        if entry["tier"]:
            print("    tier: {}".format(entry["tier"]))
        if entry["note"]:
            print("    note: {}".format(entry["note"]))

    print()
    print("{} indexed documents.".format(len(entries)))


# ---------------------------------------------------------------------------
# commands
# ---------------------------------------------------------------------------


def prepare(args):
    """Resolve the repo root, load the index, validate it. Shared by all commands."""
    repo_root = find_repo_root(args.repo)
    if args.index is not None:
        index_path = Path(args.index).expanduser()
        if not index_path.is_absolute():
            index_path = (repo_root / index_path)
    else:
        index_path = repo_root / DEFAULT_INDEX_RELATIVE
    index_path = index_path.resolve()

    data = load_index(index_path)
    entries, warnings = validate_index(data, repo_root, index_path)
    return repo_root, index_path, entries, warnings


def cmd_check(args):
    repo_root, _index_path, entries, warnings = prepare(args)
    ensure_git_repo(repo_root)
    print_warnings(warnings)

    stale, clean = evaluate(repo_root, entries)

    if args.json:
        report_check_json(stale, clean)
    else:
        report_check_human(stale, clean)
        # The published snapshot can disagree with what we just computed, and when it does the
        # help centre is warning readers about the wrong set of topics. Nothing else notices.
        published = status_on_disk(repo_root)
        if published is not None:
            fresh = build_status(repo_root, entries)
            if published.get("stale") != fresh["stale"]:
                print("\nNOTE: {} is out of step with the above (generated {}), so readers of "
                      "the help\ncentre are being warned about the wrong set of topics. Run: "
                      "python scripts/docs/check_doc_sources.py status --write".format(
                          STATUS_RELATIVE.as_posix(), published.get("generated", "unknown")))

    return EXIT_STALE if stale else EXIT_OK


# ---------------------------------------------------------------------------
# status -- the one command that writes a file
# ---------------------------------------------------------------------------
#
# A browser cannot run git, so the in-app help centre cannot compute staleness itself. It reads
# site/help/DOC-STATUS.json, which this command generates. That file is a SNAPSHOT: edit a source
# and skip the regenerate, and the help centre goes on saying a flagged page is fine -- the same
# unearned green light this whole mechanism exists to prevent. So it stamps the date and commit it
# was generated at, the help centre shows that date to the reader rather than presenting the
# verdict as live, and `check` prints a reminder when the two disagree.

STATUS_RELATIVE = Path("site") / "help" / "DOC-STATUS.json"


def status_path(repo_root):
    return repo_root / STATUS_RELATIVE


def build_status(repo_root, entries):
    """The help centre's view of staleness, keyed by the filename MANIFEST.json uses.

    Only `kind: help` entries are published. The rest of the index (design docs, skills, the
    cutover runbook) is not reachable from the help centre, and listing it would put paths on a
    public page for documents no reader there can open.
    """
    stale, _clean = evaluate(repo_root, entries, ignore_dirty=True)
    flagged = {}
    for record in stale:
        if record.get("kind") != "help":
            continue
        flagged[Path(record["doc"]).name] = {
            "reviewed": record["reviewed"],
            "tier": record.get("tier"),
            # Paths, not basenames: two different sources can share a basename, and staff
            # reading this need to know which file moved.
            "sources": [t["source"] for t in record["triggers"]],
        }
    # run_git returns a CompletedProcess, not a string. An empty repo has no HEAD, so a
    # non-zero return is a real state and not an error -- the field goes null.
    completed = run_git(repo_root, ["rev-parse", "--short", "HEAD"])
    head = completed.stdout.strip() if completed.returncode == 0 else ""
    return {
        "schema": 1,
        "generated": date.today().isoformat(),
        "commit": head or None,
        "note": ("Generated by scripts/docs/check_doc_sources.py status --write. Do not hand-edit. "
                 "This is a SNAPSHOT: if a source changed after 'generated', the help centre does "
                 "not know yet. Regenerate whenever you run the check."),
        "stale": flagged,
    }


def status_on_disk(repo_root):
    """The published status file, or None if absent/unreadable. Never raises."""
    try:
        return json.loads(status_path(repo_root).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def cmd_status(args):
    repo_root, _index_path, entries, warnings = prepare(args)
    ensure_git_repo(repo_root)
    print_warnings(warnings)

    payload = build_status(repo_root, entries)
    flagged = payload["stale"]
    target = status_path(repo_root)

    if not args.write:
        print("Preview only -- nothing written. Re-run with --write to publish.\n")
        print(json.dumps(payload, indent=2))
        print("\nWould write: {}".format(STATUS_RELATIVE.as_posix()))
        return EXIT_OK

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    if flagged:
        print("Wrote {} -- {} help topic(s) flagged for readers:\n".format(
            STATUS_RELATIVE.as_posix(), len(flagged)))
        for name, info in sorted(flagged.items()):
            print("  {}  (reviewed {}, {} source(s) moved)".format(
                name, info["reviewed"], len(info["sources"])))
    else:
        print("Wrote {} -- no help topic is flagged; the banner will not appear anywhere.".format(
            STATUS_RELATIVE.as_posix()))
    print("\nThe help centre reads this file. It is only true as of the 'generated' date, so "
          "commit it\nalongside whatever made it change -- a stale status file is a silent "
          "all-clear.")
    return EXIT_OK


def cmd_list(args):
    _repo_root, _index_path, entries, warnings = prepare(args)
    print_warnings(warnings)

    entries = sorted(entries, key=lambda entry: (entry["kind"], entry["doc"]))

    if args.json:
        print(json.dumps(entries, indent=2))
    else:
        report_list_human(entries)

    return EXIT_OK


def cmd_validate(args):
    """Schema and path validation only. Never touches git."""
    _repo_root, index_path, entries, warnings = prepare(args)
    print_warnings(warnings)
    print("{} is valid: schema {}, {} documents, {} distinct sources.".format(
        index_path,
        SUPPORTED_SCHEMA,
        len(entries),
        len({source for entry in entries for source in entry["sources"]}),
    ))
    return EXIT_OK


# ---------------------------------------------------------------------------
# entry point
# ---------------------------------------------------------------------------


def build_parser():
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument(
        "--repo",
        default=None,
        metavar="PATH",
        help="repository root; defaults to `git rev-parse --show-toplevel`",
    )
    common.add_argument(
        "--index",
        default=None,
        metavar="PATH",
        help="index file; defaults to {} under the repository root".format(
            DEFAULT_INDEX_RELATIVE
        ),
    )

    parser = argparse.ArgumentParser(
        prog="check_doc_sources.py",
        description=(
            "Flag indexed documents whose sources changed after they were last "
            "reviewed. Exit 0 = nothing flagged, 1 = something flagged, "
            "2 = index broken or environment unusable."
        ),
    )
    subparsers = parser.add_subparsers(dest="command")

    check = subparsers.add_parser(
        "check", parents=[common], help="report possibly stale documents (default)"
    )
    check.add_argument("--json", action="store_true", help="machine-readable output")
    check.set_defaults(handler=cmd_check)

    listing = subparsers.add_parser(
        "list", parents=[common], help="print the index, sorted by (kind, doc)"
    )
    listing.add_argument("--json", action="store_true", help="dump the raw entries")
    listing.set_defaults(handler=cmd_list)

    status = subparsers.add_parser(
        "status",
        parents=[common],
        help="publish the help centre's staleness snapshot (site/help/DOC-STATUS.json)",
    )
    status.add_argument("--write", action="store_true",
                        help="actually write the file; without it, preview only")
    status.set_defaults(handler=cmd_status)

    validate = subparsers.add_parser(
        "validate", parents=[common], help="schema and path validation only; no git"
    )
    validate.set_defaults(handler=cmd_validate)

    return parser


def insert_default_command(argv):
    """Make `check` the default when no subcommand is given."""
    if argv and (argv[0] in COMMANDS or argv[0] in ("-h", "--help")):
        return argv
    return ["check"] + argv


def main(argv=None):
    configure_streams()
    argv = list(sys.argv[1:] if argv is None else argv)
    parser = build_parser()
    args = parser.parse_args(insert_default_command(argv))

    try:
        return args.handler(args)
    except Unusable as exc:
        print("error: {}".format(exc), file=sys.stderr)
        return EXIT_UNUSABLE


if __name__ == "__main__":
    sys.exit(main())
