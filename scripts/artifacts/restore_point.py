#!/usr/bin/env python3
"""Capture — and later prove — the exact state this repo and its Supabase project were in
before the Socratic-Artifact-Builder import.

WHY THIS EXISTS
    The import moves ~7.9 MB of artifact source out of a second repository and into Supabase
    Storage, lands a new tree under `_builder/`, and adds a faculty page. Every one of those is
    reversible, but only if somebody wrote down what "before" was. This is that file.

    The reversal levers themselves live elsewhere (`sync_artifacts.py purge`, the migration's
    _ROLLBACK.sql, `git revert`). What this script owns is the *answer key*: the SHAs, the
    bucket list, and the byte-for-byte content of every source file, so that after any reversal
    somebody can run `verify` and get a yes or a no rather than an opinion.

    THE SNAPSHOT IS NOT THE SAFETY NET BY ITSELF. It is the safety net *plus* the physical
    copies under `sources/`, which is why this writes ~8 MB rather than a manifest alone. At the
    moment the import runs, the ONLY copies of the 46 artifacts are the other repository's
    working tree and (for 29 of them) `_inbox/`. Both are scheduled for deletion. A manifest of
    hashes for files that no longer exist restores nothing.

WHAT IT CAPTURES
    git      — origin/main, HEAD, the whole tree, and `HEAD:site` specifically. The site tree
               is called out on its own because most steps of the import must leave the live
               site untouched, and comparing one SHA is a cheaper proof than reading a diff.
               `dirty` records `git status --porcelain` verbatim: "exactly as it is now"
               includes whatever was uncommitted at the time, and sweeping that away silently
               would be its own incident.
    supabase — the bucket list, and the asserted fact that `artifact-sources` is absent. If it
               is already present, something else made it and this import must not proceed
               (see CORE.md section 0 — one production project, several agents).
    sources  — {path, bytes, sha256} plus a physical copy of every artifact source, build log
               and review sidecar the import consumes.

USE
    python scripts/artifacts/restore_point.py capture              # print the plan, write nothing
    python scripts/artifacts/restore_point.py capture --commit     # write the snapshot
    python scripts/artifacts/restore_point.py verify               # compare live state, exit 1 on drift
    python scripts/artifacts/restore_point.py verify --json

    Read-only against Supabase (GET /storage/v1/bucket). Standard library only. Dry-run by
    default, per CORE.md section 4.

A NOTE ON BYTES
    Every read and write here is binary. A Python text-mode read applies universal newlines and
    silently turns CRLF into LF, which on a hash-checked payload is not a formatting difference
    but a different file. The builder repo has already paid for this twice — once when a fresh
    clone failed 6 of 7 manifest hashes, and once when a three-string edit landed as a 6,327-line
    rewrite. Do not "simplify" these to text mode.
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

# Both streams — the "cannot check" messages go to stderr and carry em dashes, and a cp1252
# console turns those into replacement characters that read as corruption rather than as text.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

REPO = Path(__file__).resolve().parents[2]
CONFIG_PATH = Path(os.path.expanduser("~/.claude/skills/preflight-analyze/config.json"))
DEFAULT_BUILDER = REPO.parent / "Socratic-Artifact-Builder"
SNAPSHOT_ROOT = REPO / "_snapshots"
SNAPSHOT_NAME = "builder-import"
BUCKET = "artifact-sources"

EXIT_OK, EXIT_DRIFT, EXIT_UNUSABLE = 0, 1, 2

# Paths the import itself creates. They are filtered out of the working-tree comparison, and
# the reason is not convenience: this script is part of the import, so by the time it can run,
# it is already sitting in the tree as an untracked file. Comparing raw `git status` against a
# raw `git status` taken later would then be asking "is my own existence a change?", which has
# no useful answer and would make Step 7's proof permanently red.
#
# So the working-tree check answers the question that matters — "is anything OUTSIDE the
# import's footprint different?" — and a separate check reports what of the footprint survives.
# Under --full-reversal that second one becomes a failure, because a complete reversal means
# these are gone too.
IMPORT_FOOTPRINT = (
    ".gitattributes",
    "_builder/",
    ".ai/patterns/",
    ".ai/skills/safe-change/",
    ".ai/skills/skill-author/",
    ".ai/skills/integration-package/",
    "docs/operations/MACHINE-SETUP.md",
    "docs/operations/PUBLISH-ARTIFACT.md",
    "docs/operations/PREFILL-LINK.md",
    "docs/decisions/MULTI-COURSE-LAYOUT.md",
    "docs/decisions/PHYS310-MURRAY-GROUNDING.md",
    "docs/decisions/BUILDER-MERGE.md",
    "scripts/artifacts/",
    "scripts/review/",
    "site/faculty/artifacts.html",
    "site/js/faculty-artifacts.js",
    "supabase/migrations/023_artifact_sources_storage.sql",
    "supabase/migrations/023_artifact_sources_storage_ROLLBACK.sql",
)


def split_footprint(porcelain):
    """Partition `git status --porcelain` into (outside, inside) the import's footprint.

    Only UNTRACKED entries ('??') are ever treated as footprint. A modification to a tracked
    file inside one of these paths is a real change to pre-existing content and must show up
    in the comparison — otherwise editing, say, `docs/operations/` would become invisible.
    """
    outside, inside = [], []
    for line in porcelain.splitlines():
        path = line[3:].strip().strip('"')
        untracked = line.startswith("??")
        (inside if untracked and path.startswith(IMPORT_FOOTPRINT) else outside).append(line)
    return "\n".join(outside), "\n".join(inside)


class Unusable(Exception):
    """The check could not be performed at all — distinct from performing it and failing."""


# ── git ──────────────────────────────────────────────────────────────────────


def git(*args, repo=REPO):
    out = subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if out.returncode != 0:
        raise Unusable(f"git {' '.join(args)} failed in {repo}: {out.stderr.strip()}")
    return out.stdout.rstrip("\n")


def git_facts(builder_root):
    porcelain = git("status", "--porcelain")
    outside, inside = split_footprint(porcelain)
    facts = {
        "branch": git("branch", "--show-current"),
        "origin_main_sha": git("rev-parse", "origin/main"),
        "head_sha": git("rev-parse", "HEAD"),
        "head_tree_sha": git("rev-parse", "HEAD^{tree}"),
        "site_tree_sha": git("rev-parse", "HEAD:site"),
        # Verbatim, including the empty string for a clean tree — "clean" is itself a fact
        # worth being able to prove later.
        "dirty": porcelain,
        # What the comparison actually runs on. See IMPORT_FOOTPRINT for why they differ.
        "dirty_outside_footprint": outside,
        "footprint_present": inside,
    }
    # The other repository's identity, so provenance survives even if it is archived.
    if builder_root.exists():
        try:
            facts["builder"] = {
                "path": str(builder_root),
                "head_sha": git("rev-parse", "HEAD", repo=builder_root),
                "remote": git("remote", "get-url", "origin", repo=builder_root),
                "dirty": git("status", "--porcelain", repo=builder_root),
            }
        except Unusable as exc:
            facts["builder"] = {"path": str(builder_root), "error": str(exc)}
    return facts


# ── supabase ─────────────────────────────────────────────────────────────────


def supabase_facts():
    if not CONFIG_PATH.exists():
        raise Unusable(
            f"no config at {CONFIG_PATH} — run /setup-preflight, or see CORE.md section 3"
        )
    cfg = json.loads(CONFIG_PATH.read_bytes().decode("utf-8"))
    url = cfg["supabase_url"].rstrip("/")
    key = cfg["supabase_service_key"]
    req = urllib.request.Request(
        f"{url}/storage/v1/bucket",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            buckets = json.load(resp)
    except Exception as exc:  # noqa: BLE001 — any failure here is "cannot check", not "drift"
        raise Unusable(
            f"could not list Storage buckets: {exc}\n"
            "  The free tier pauses after ~1 week idle — unpause in the Supabase dashboard."
        ) from exc
    names = sorted(b["id"] for b in buckets)
    return {
        # The project ref is the subdomain; recorded so a snapshot can never be replayed
        # against the wrong project.
        "project_ref": url.split("//", 1)[-1].split(".", 1)[0],
        "url": url,
        "buckets": names,
        "artifact_sources_present": BUCKET in names,
    }


# ── the source files the import consumes ─────────────────────────────────────


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:                      # bytes — see the module docstring
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def collect_sources(builder_root):
    """Every file the import reads and then stops being the only copy of.

    Returns [{key, origin, bytes, sha256}] where `key` is the path inside the snapshot's
    sources/ directory — flattened per course, because the two repositories' layouts should
    not be reconstructable requirements of the restore.
    """
    if not builder_root.exists():
        raise Unusable(f"builder repo not found at {builder_root} (pass --builder)")

    items = []
    for course in ("phys-215", "phys-310"):
        art_dir = builder_root / "courses" / course / "artifacts"
        if not art_dir.is_dir():
            raise Unusable(f"missing {art_dir}")
        for path in sorted(art_dir.iterdir()):
            if path.is_file() and path.suffix in (".jsx", ".md", ".json"):
                items.append((f"{course}/{path.name}", path))

    # PREP's own committed example artifact — it leaves the repo in Step 3, so it belongs to
    # the same restore set even though it comes from a different tree.
    example = REPO / ".ai" / "artifacts" / "examples" / "lesson02_artifact.jsx"
    if example.exists():
        items.append((f"_prep/{example.name}", example))

    return [
        {
            "key": key,
            "origin": str(path),
            "bytes": path.stat().st_size,
            "sha256": sha256_of(path),
        }
        for key, path in items
    ]


def doc_status_sha():
    p = REPO / "site" / "help" / "DOC-STATUS.json"
    return sha256_of(p) if p.exists() else None


# ── capture ──────────────────────────────────────────────────────────────────


def snapshot_dir(stamp=None):
    return SNAPSHOT_ROOT / f"{SNAPSHOT_NAME}-{stamp or date.today().isoformat()}"


def cmd_capture(args):
    target = snapshot_dir(args.stamp)
    builder_root = Path(args.builder).resolve()

    sources = collect_sources(builder_root)
    payload = {
        "schema": 1,
        "purpose": "Pre-import state of Core_Preflights + its Supabase project, for the "
                   "Socratic-Artifact-Builder merge. See scripts/artifacts/restore_point.py.",
        "taken_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "git": git_facts(builder_root),
        "supabase": supabase_facts(),
        "doc_status_sha256": doc_status_sha(),
        "sources": sources,
    }

    total = sum(s["bytes"] for s in sources)
    print(f"Restore point → {target}")
    print(f"  git    HEAD {payload['git']['head_sha'][:12]} · origin/main "
          f"{payload['git']['origin_main_sha'][:12]} · site tree "
          f"{payload['git']['site_tree_sha'][:12]}")
    outside = payload["git"]["dirty_outside_footprint"]
    inside = payload["git"]["footprint_present"]
    print(f"         working tree outside the import: "
          f"{'clean' if not outside else str(len(outside.splitlines())) + ' change(s) — READ THESE'}")
    if inside:
        print(f"         import footprint already on disk: {len(inside.splitlines())} path(s)")
    sb = payload["supabase"]
    print(f"  supa   project {sb['project_ref']} · {len(sb['buckets'])} bucket(s): "
          f"{', '.join(sb['buckets']) or '(none)'}")
    print(f"         '{BUCKET}' present: {sb['artifact_sources_present']}")
    print(f"  files  {len(sources)} source file(s), {total / 1e6:.1f} MB, copied verbatim")

    if sb["artifact_sources_present"]:
        print()
        print(f"  !! MAJOR — the '{BUCKET}' bucket already exists. This import asserts it does")
        print("     not. Something else created it; stop and find out what before proceeding.")

    if not args.commit:
        print("\nDry run — nothing written. Re-run with --commit.")
        return EXIT_OK

    (target / "sources").mkdir(parents=True, exist_ok=True)
    for s in sources:
        dest = target / "sources" / s["key"]
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(s["origin"], dest)             # copy2 is a binary copy; metadata preserved

    (target / "RESTORE-POINT.json").write_bytes(
        (json.dumps(payload, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    )

    # Re-hash what we just wrote. A snapshot nobody verified is a snapshot nobody can trust,
    # and the cost of finding out now versus after a delete is the whole point.
    bad = [s["key"] for s in sources
           if sha256_of(target / "sources" / s["key"]) != s["sha256"]]
    if bad:
        print(f"\n  !! MAJOR — {len(bad)} copied file(s) do not match their source hash:")
        for k in bad[:5]:
            print(f"       {k}")
        return EXIT_UNUSABLE

    print(f"\nWrote {target / 'RESTORE-POINT.json'} and {len(sources)} verified copies.")
    return EXIT_OK


# ── verify ───────────────────────────────────────────────────────────────────


def load_point(args):
    target = snapshot_dir(args.stamp)
    path = target / "RESTORE-POINT.json"
    if not path.exists():
        raise Unusable(f"no restore point at {path} — run `capture --commit` first")
    return target, json.loads(path.read_bytes().decode("utf-8"))


def cmd_verify(args):
    target, point = load_point(args)
    checks = []

    def check(name, expected, actual, note=""):
        checks.append({"check": name, "ok": expected == actual,
                       "expected": expected, "actual": actual, "note": note})

    g = point["git"]
    now = git_facts(Path(g.get("builder", {}).get("path", DEFAULT_BUILDER)))
    check("git origin/main", g["origin_main_sha"], now["origin_main_sha"],
          "reverts move HEAD forward; origin/main returning here means the revert landed")
    check("git HEAD tree", g["head_tree_sha"], now["head_tree_sha"],
          "the whole repo content, ignoring history")
    check("git site/ tree", g["site_tree_sha"], now["site_tree_sha"],
          "the live site's content specifically")
    check("working tree (outside import footprint)",
          g["dirty_outside_footprint"], now["dirty_outside_footprint"],
          "anything here is a change the import did not intend to make")

    # The import's own files. Informational normally — after Step 3 they SHOULD be present —
    # and a hard check only when the claim being tested is "we reverted all of it".
    surviving = now["footprint_present"]
    if args.full_reversal:
        check("import footprint removed", "", surviving,
              "a full reversal deletes the import's untracked files too")
    else:
        checks.append({"check": "import footprint (informational)", "ok": True,
                       "expected": "n/a",
                       "actual": f"{len(surviving.splitlines())} untracked path(s)",
                       "note": "expected to be present mid-import; use --full-reversal to require none"})

    try:
        sb_now = supabase_facts()
        check("Storage buckets", point["supabase"]["buckets"], sb_now["buckets"])
        check(f"bucket '{BUCKET}' absent",
              point["supabase"]["artifact_sources_present"],
              sb_now["artifact_sources_present"])
    except Unusable as exc:
        checks.append({"check": "Storage buckets", "ok": False,
                       "expected": point["supabase"]["buckets"], "actual": f"UNCHECKED: {exc}",
                       "note": "could not reach Supabase"})

    check("site/help/DOC-STATUS.json", point["doc_status_sha256"], doc_status_sha())

    # The physical copies are the part that must still be intact, not merely recorded.
    missing, corrupt = [], []
    for s in point["sources"]:
        p = target / "sources" / s["key"]
        if not p.exists():
            missing.append(s["key"])
        elif sha256_of(p) != s["sha256"]:
            corrupt.append(s["key"])
    checks.append({"check": f"snapshot copies ({len(point['sources'])})",
                   "ok": not missing and not corrupt,
                   "expected": "all present and matching",
                   "actual": f"{len(missing)} missing, {len(corrupt)} corrupt",
                   "note": ", ".join((missing + corrupt)[:3])})

    if args.json:
        print(json.dumps({"restore_point": str(target), "checks": checks}, indent=2))
    else:
        print(f"Verifying against {target / 'RESTORE-POINT.json'}\n")
        for c in checks:
            mark = "  ok  " if c["ok"] else " DRIFT"
            print(f"[{mark}] {c['check']}")
            if not c["ok"]:
                print(f"           expected: {c['expected']}")
                print(f"           actual:   {c['actual']}")
                if c["note"]:
                    print(f"           ({c['note']})")
        bad = sum(1 for c in checks if not c["ok"])
        print()
        print("Identical to the restore point." if not bad
              else f"{bad} of {len(checks)} checks drifted — NOT back to the recorded state.")

    return EXIT_OK if all(c["ok"] for c in checks) else EXIT_DRIFT


# ── cli ──────────────────────────────────────────────────────────────────────


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Capture or verify the pre-import state of the repo and its Supabase project.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("USE\n", 1)[-1],
    )
    ap.add_argument("--stamp", default=None,
                    help="snapshot date suffix (default: today), e.g. 2026-08-07")
    ap.add_argument("--builder", default=str(DEFAULT_BUILDER),
                    help="path to the Socratic-Artifact-Builder repo")
    sub = ap.add_subparsers(dest="cmd", required=True)

    cap = sub.add_parser("capture", help="record the current state (dry-run by default)")
    cap.add_argument("--commit", action="store_true", help="actually write the snapshot")
    cap.set_defaults(func=cmd_capture)

    ver = sub.add_parser("verify", help="compare live state against the snapshot; exit 1 on drift")
    ver.add_argument("--json", action="store_true", help="machine-readable output")
    ver.add_argument("--full-reversal", action="store_true",
                     help="also require the import's own untracked files to be gone "
                          "(the Step 7 claim: back to exactly the recorded state)")
    ver.set_defaults(func=cmd_verify)

    args = ap.parse_args(argv)
    try:
        return args.func(args)
    except Unusable as exc:
        print(f"cannot check: {exc}", file=sys.stderr)
        return EXIT_UNUSABLE


if __name__ == "__main__":
    sys.exit(main())
