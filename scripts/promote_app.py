#!/usr/bin/env python3
"""promote_app.py — PREP v2 cutover, Phase 4 step 13: move site/app/ up to site/.

    python scripts/promote_app.py            # dry run: print the plan, touch nothing
    python scripts/promote_app.py --commit   # do it (working tree only — does NOT commit or push)

WHAT THIS IS
    The one-way step of docs/operations/PREP-V2-CUTOVER.md. Everything before Phase 4 is undone by
    dropping schema `app`; this changes the live site. It is written as a script rather than a list
    of git commands because the move has to be exact: two of the paths it overwrites are FROZEN
    CONTRACT URLs that deployed Claude artifacts post to, and a hand-run `git mv` that gets one of
    them wrong is not recoverable without rebuilding every artifact by hand.

WHAT IT DOES NOT DO
    It does not commit and it does not push. Pushing is the cutover (CORE.md §5), and that stays a
    deliberate human act. After a --commit run, review `git status`, then commit and push yourself.

WHY THE MOVE IS SAFE
    Verified 2026-07-22:
      * Relative paths inside the tree survive, because the whole tree moves together and keeps its
        internal shape: site/app/faculty/report.html -> ../css/styles.css resolves to site/app/css/
        before and site/css/ after.
      * legacyUrl() in js/util.js has ZERO live callers — nav.js says so in a comment. Nothing links
        to the legacy pages this deletes.
      * The only references into site/app/ from outside are the two forwarding stubs, which are
        exactly what gets overwritten.

WHY THE .md FILES GO TO docs/app/ INSTEAD OF site/
    site/app/*.md are internal design notes (plans, the legacy audit, the admin inventory). They are
    already world-readable at site/app/*.md, which was tolerable while that path was a staging area.
    Promoting them to site/*.md would put a document titled LEGACY-AUDIT next to the student login
    page. They move to docs/app/ instead — same repo, out of the published tree. Say so in the
    CHANGELOG, because their URLs change and DOC-SOURCES.json references some of them.
"""

import argparse
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
APP = REPO / "site" / "app"
SITE = REPO / "site"

# Deleted by the promotion. Each was verified unreferenced (LEGACY-AUDIT-2026-07-20.md §5).
LEGACY = [
    "site/admin.html",
    "site/interactions-admin.html",
    "site/interactions.html",
    # Credential-free student grade viewer. Orphaned and functionally dead; the audit's
    # recommendation is DELETE rather than port — it is "a re-enable away from a FERPA problem".
    "site/review.html",
]

# Overwritten, and that is the point: the real pages land on the frozen contract paths so the
# public URLs are identical before and after go-live.
FROZEN = [
    ("site/app/student/interaction-submit.html", "site/student/interaction-submit.html"),
    ("site/app/faculty/lessons.html", "site/faculty/lessons.html"),
]


def sh(*args, check=True):
    r = subprocess.run(args, cwd=REPO, capture_output=True, text=True)
    if check and r.returncode != 0:
        sys.exit(f"FAILED: {' '.join(args)}\n{r.stderr.strip()}")
    return r.stdout.strip()


def preflight():
    """Refuse on anything that would make the move unreviewable or unsafe."""
    problems = []
    if not APP.is_dir():
        problems.append("site/app/ does not exist — already promoted?")
    if sh("git", "status", "--porcelain"):
        problems.append("working tree is dirty — commit or stash first, so the move is the only "
                        "thing in the diff you review")
    branch = sh("git", "rev-parse", "--abbrev-ref", "HEAD")
    if branch != "main":
        problems.append(f"on branch '{branch}', not main")
    sh("git", "fetch", "-q", "origin", check=False)
    ahead_behind = sh("git", "rev-list", "--left-right", "--count", "origin/main...HEAD", check=False)
    if ahead_behind and ahead_behind.replace("\t", " ").split() != ["0", "0"]:
        problems.append(f"diverged from origin/main ({ahead_behind}) — reconcile first (CORE.md §0)")
    for src, _ in FROZEN:
        if not (REPO / src).is_file():
            problems.append(f"MISSING {src} — a frozen contract path would be left as a stub or a 404")
    return problems


def plan():
    """(moves, deletes) — moves are (src, dst, overwrites) repo-relative, FILE BY FILE.

    Deliberately not a directory move. Four targets already exist in site/ and a `git mv` of a
    directory onto an existing directory NESTS it — site/app/student -> site/student/student —
    which would leave the frozen contract path still occupied by its stub and the real receiver
    one level too deep, i.e. a silent 404 on the URL every deployed artifact posts to.

    Colliding today (all four intentional overwrites):
        site/css/styles.css   legacy stylesheet, dies with the legacy pages
        site/js/config.js     legacy config, ditto
        site/student/interaction-submit.html   FROZEN contract path, currently a forwarding stub
        site/faculty/lessons.html              FROZEN contract path, currently a forwarding stub
    """
    moves, deletes = [], []
    for src in sorted(APP.rglob("*")):
        if src.is_dir():
            continue
        rel = src.relative_to(APP)
        dst = (f"docs/app/{rel.name}" if src.suffix == ".md" and rel.parent == Path(".")
               else f"site/{rel.as_posix()}")
        moves.append((src.relative_to(REPO).as_posix(), dst, (REPO / dst).exists()))
    for p in LEGACY:
        if (REPO / p).exists():
            deletes.append(p)
    return moves, deletes


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--commit", action="store_true",
                    help="perform the move (working tree only; still does not git-commit or push)")
    ap.add_argument("--verbose", action="store_true", help="list every file, not just collisions")
    args = ap.parse_args()

    problems = preflight()
    if problems:
        print("REFUSING TO RUN:")
        for p in problems:
            print(f"  - {p}")
        sys.exit(1)

    moves, deletes = plan()
    frozen_dsts = {d for _, d in FROZEN}
    clashes = [(s, d) for s, d, over in moves if over]

    print(f"{'PROMOTING' if args.commit else 'DRY RUN — plan only'}\n")
    print(f"Move {len(moves)} file(s) — {len(clashes)} overwrite something that already exists:\n")
    for src, dst, over in moves:
        if not over:
            continue
        tag = "FROZEN CONTRACT PATH — replaces the forwarding stub" if dst in frozen_dsts \
              else "overwrites the legacy file"
        print(f"  ! {src:46} -> {dst:44} {tag}")
    print(f"\n  …and {len(moves) - len(clashes)} more with no collision "
          f"(use --verbose to list them).")
    if args.verbose:
        for src, dst, over in moves:
            if not over:
                print(f"    {src:46} -> {dst}")

    print("\nDelete:")
    for p in deletes:
        print(f"  {p}")
    if not deletes:
        print("  (none)")

    # Every frozen path must be among the overwrites, or the promotion leaves a stub in place and
    # the URL every deployed artifact posts to keeps forwarding to a tree that no longer exists.
    missing_frozen = [d for d in frozen_dsts if d not in {dst for _, dst, _ in moves}]
    if missing_frozen:
        print("\nABORT — a frozen contract path is not covered by the plan:")
        for d in missing_frozen:
            print(f"  {d}")
        sys.exit(1)

    if not args.commit:
        print("\nNothing changed. Re-run with --commit to perform the move.")
        print("Then: review `git status`, run the checklist in "
              "docs/operations/PREP-V2-CUTOVER.md 'Verify the cutover', and only then commit+push.")
        return

    for src, dst, over in moves:
        dstp = REPO / dst
        # Remove the incumbent explicitly rather than letting `git mv -f` clobber it. Overwriting a
        # frozen contract path is correct here and must still be visible in the log.
        if dstp.exists():
            sh("git", "rm", "-q", "-f", dst)
            print(f"  replaced {dst}")
        # mkdir AFTER the git rm, never before: `git rm` of the last tracked file in a directory
        # deletes the directory too, so a mkdir beforehand is silently undone and the git mv then
        # fails with ENOENT. That is exactly what site/css/styles.css did on 2026-07-28 — it was
        # the sole file in site/css/, so removing the legacy stylesheet took site/css/ with it.
        dstp.parent.mkdir(parents=True, exist_ok=True)
        sh("git", "mv", src, dst)
    print(f"  moved {len(moves)} file(s)")

    for p in deletes:
        sh("git", "rm", "-q", "-r", p)
        print(f"  deleted {p}")

    # site/app/ should now be empty; remove the shell if git left it.
    if APP.exists() and not any(APP.iterdir()):
        APP.rmdir()
        print("  removed empty site/app/")

    print("\nMoved. NOT committed and NOT pushed — that is deliberate.\n")
    print("Before you commit, confirm by hand:")
    print("  1. site/student/interaction-submit.html is the REAL receiver, not a stub")
    print("  2. site/faculty/lessons.html is the REAL lesson manager, not a stub")
    print("  3. python -m http.server 8000, then open http://localhost:8000/site/ and sign in")
    print("  4. grep -rn \"app/\" site/ index.html 404.html   # should return nothing meaningful")
    print("  5. node tests/app-schema/run.mjs                # paths inside the tree still resolve")
    print("  6. Update docs/DOC-SOURCES.json for any site/app/*.md that moved to docs/app/")


if __name__ == "__main__":
    main()
