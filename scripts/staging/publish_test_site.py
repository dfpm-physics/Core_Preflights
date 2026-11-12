#!/usr/bin/env python3
"""Build the PUBLIC TEST COPY of the PREP site, and optionally publish it. Standard library only.

WHAT THE TEST SITE IS
  A second GitHub repository, dfpm-physics/iPREP-staging, served by GitHub Pages at
  https://dfpm-physics.github.io/iPREP-staging/site/ . It is a copy of site/ that can only reach the
  STAGING database, so people can try the pages with invented data before anything goes live.
  Read docs/operations/TEST-SITE.md first.

WHY A BUILD STEP, WHEN THE SITE HAS NONE
  site/js/config.js already sends that address to staging. But about 80 generated lesson pages under
  site/gemini/ and site/genai/ do not load config.js: they carry the production Supabase URL, key,
  error-log endpoint and proxy address, and link to the published submit page. scripts/staging/
  serve_local.py rewrites those while serving. Pages is static, so the same rewrite is done ONCE here,
  at publish time. The shipped site gains no build step: this runs on a maintainer's machine and its
  output is a separate repository.

WHAT THE BUILD DOES (changes nothing under this repository)
  1. Copies site/ (only site/) to <out>/site/, byte for byte, keeping line endings.
  2. Rewrites every text file with serve_local's own rule: production URL and key become staging's, and
     the published address https://dfpm-physics.github.io/Core_Preflights/ becomes the test site's.
  3. Narrows every Content-Security-Policy source https://*.supabase.co and wss://*.supabase.co to the
     staging host alone, so the browser itself refuses production.
  4. Writes <out>/index.html (redirect to site/), <out>/.nojekyll and <out>/README.md.
  5. VERIFIES: no output file may hold the production project ref, the production key, or
     github.io/Core_Preflights. Any hit lists file names (never contents) and exits non-zero.

  The output directory must be outside this repository, and must be empty or absent.

PUBLISHING (--repo <clone of dfpm-physics/iPREP-staging>)
  Dry run by default: builds to a temporary directory and counts what would be added, changed and
  removed in the clone. With --commit it replaces the clone's working files with the build (keeping
  .git), stages everything INSIDE THAT CLONE ONLY, commits, and pushes origin main. It never
  force-pushes. The clone is a generated, disposable copy of the test site: never edit it by hand.
  A dry run runs only `git fetch origin` and read-only status checks; it never resets or checks out.
  Under --commit it first aborts if the clone has uncommitted changes or commits not on origin/main,
  then runs `git reset --hard origin/main` (an empty remote: an unborn main), so it is never behind. It
  refuses a clone whose fetch or push URL is not dfpm-physics/iPREP-staging, a clone with fewer than
  three path parts, a clone that is not on main, and (unless --allow-dirty) uncommitted changes under site/ here, because the copy
  would then not match any commit.

CAN IT REACH PRODUCTION?  It reads no credential and opens no connection. The keys it handles are
  the public ones already in site/js/config.js.

USAGE
  python scripts/staging/publish_test_site.py --out <dir>                  # build and verify
  python scripts/staging/publish_test_site.py --repo <clone>               # what would change
  python scripts/staging/publish_test_site.py --repo <clone> --commit      # publish
"""

import argparse
import hashlib
import io
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import serve_local  # noqa: E402

REPO = serve_local.REPO
SITE = REPO / "site"
TEST_PUBLISHED = "https://dfpm-physics.github.io/iPREP-staging/"
TEST_REPO = "dfpm-physics/iPREP-staging"
LIVE_ADDRESS = "github.io/Core_Preflights"
README = (
    "Generated test copy of PREP. Staging database only, invented data only. Do not edit; regenerate with "
    "scripts/staging/publish_test_site.py in dfpm-physics/Core_Preflights.\n"
)
INDEX = (
    '<!doctype html>\n<meta charset="utf-8">\n<title>PREP test site</title>\n'
    '<meta http-equiv="refresh" content="0; url=site/">\n<a href="site/">Continue to the PREP test site</a>\n'
)


def refuse(why):
    sys.exit(f"REFUSED  {why}")


def inside(path, root):
    path, root = Path(path).resolve(), Path(root).resolve()
    return path == root or root in path.parents


def check_out_dir(out, repo=REPO):
    out = Path(out)
    if inside(out, repo):
        refuse(f"{out} is inside this repository; build the test copy somewhere else.")
    if out.exists() and (not out.is_dir() or any(out.iterdir())):
        refuse(f"{out} exists and is not empty; give an empty or new directory.")


def rewrites_for(prod, staging):
    """(old, new) byte pairs: serve_local's rule, with the published address pointed at the test site."""
    return [
        (prod["url"].encode(), staging["url"].encode()),
        (prod["anon"].encode(), staging["anon"].encode()),
        (serve_local.PUBLISHED.encode(), TEST_PUBLISHED.encode()),
    ]


def csp_rewrites(staging):
    host = urlsplit(staging["url"]).hostname
    return [(b"https://*.supabase.co", f"https://{host}".encode()), (b"wss://*.supabase.co", f"wss://{host}".encode())]


def build_site(site_dir, out, prod, staging):
    """Copy site_dir to out/site with the rewrites, add the three extra files. Returns (copied, rewritten)."""
    site_dir, out = Path(site_dir), Path(out)
    pairs = rewrites_for(prod, staging) + csp_rewrites(staging)
    copied = rewritten = 0
    for src in sorted(site_dir.rglob("*")):
        if not src.is_file():
            continue
        dest = out / "site" / src.relative_to(site_dir)
        dest.parent.mkdir(parents=True, exist_ok=True)
        data = src.read_bytes()
        if src.suffix.lower() in serve_local.TEXT_SUFFIXES:
            new = serve_local.rewrite(data, pairs)
            rewritten += new != data
            data = new
        dest.write_bytes(data)
        copied += 1
    (out / "index.html").write_bytes(INDEX.encode())
    (out / ".nojekyll").write_bytes(b"")
    (out / "README.md").write_bytes(README.encode())
    return copied, rewritten


def verify(out, prod):
    """Names of output files that still hold production. Never returns contents."""
    ref = urlsplit(prod["url"]).hostname.split(".")[0]
    pct = "".join(f"%{ord(c):02x}" for c in ref)          # the ref written as %xx escapes
    bad = [x.lower().encode() for x in (prod["anon"], LIVE_ADDRESS, ref, pct)]
    hits = []
    for path in sorted(Path(out).rglob("*")):
        if path.is_file():
            data = path.read_bytes().lower()
            if any(b in data for b in bad):
                hits.append(path.relative_to(out).as_posix())
    return hits


def build(out, prod, staging, site_dir=SITE):
    copied, rewritten = build_site(site_dir, out, prod, staging)
    hits = verify(out, prod)
    print(f"built    {out}")
    print(f"files    {copied} copied from site/, {rewritten} rewritten")
    if hits:
        print(f"VERIFY FAILED  {len(hits)} file(s) still name production:")
        for name in hits[:40]:
            print(f"  {name}")
        return 1, copied, rewritten
    print("verify   no output file holds the production ref, the production key, or github.io/Core_Preflights")
    return 0, copied, rewritten


def git(cwd, *args, check=True):
    r = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True)
    if check and r.returncode != 0:
        sys.exit(f"git {args[0]} failed in {cwd}: {(r.stderr or r.stdout).strip().splitlines()[-1:]}")
    return r.stdout.strip()


ORIGIN_RE = re.compile(
    rf"^(?:https?://(?:[^@/]+@)?github\.com/|git@github\.com:|ssh://git@github\.com/){re.escape(TEST_REPO)}(?:\.git)?/?$", re.I)


def sync_clone(clone, commit=False):
    """Bring the clone to origin/main. A dry run (commit=False) only fetches and reads: it never resets, checks out
    or switches HEAD. Under commit it first refuses a dirty clone or one with local commits not on origin/main,
    then resets to origin/main. An empty remote leaves an unborn main."""
    git(clone, "fetch", "origin")
    has_remote_main = git(clone, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/main", check=False) != ""
    has_head = git(clone, "rev-parse", "--verify", "--quiet", "HEAD", check=False) != ""
    if not commit:
        if has_remote_main and has_head and git(clone, "rev-list", "HEAD..origin/main"):
            print("NOTE     the clone is behind origin/main; the plan below is against its current files. "
                  "--commit resets it first.")
        return
    if git(clone, "status", "--porcelain"):
        refuse(f"{clone} has uncommitted changes; the clone is a generated copy, so clean or re-clone it.")
    if has_remote_main and has_head and git(clone, "rev-list", "origin/main..HEAD"):
        refuse(f"{clone} has local commits that are not on origin/main; push or discard them first.")
    if not has_head:
        git(clone, "symbolic-ref", "HEAD", "refs/heads/main")      # unborn HEAD: make it main before any reset
    if has_remote_main:
        git(clone, "reset", "--hard", "origin/main")


def check_clone(clone, repo=REPO, sync=False, commit=False):
    clone = Path(clone)
    if len(clone.resolve().parts) < 3:
        refuse(f"{clone} is too close to the filesystem root to be a clone path.")
    if not (clone / ".git").exists():
        refuse(f"{clone} is not a git clone (no .git).")
    if inside(clone, repo) or inside(repo, clone):
        refuse("the clone must be a separate directory, not this repository or inside it.")
    for label, args in (("origin", ("get-url", "origin")), ("push URL", ("get-url", "--push", "origin"))):
        url = git(clone, "remote", *args, check=False)
        if not ORIGIN_RE.match(url):
            refuse(f"the clone's {label} is not {TEST_REPO}.")
    branch = git(clone, "symbolic-ref", "--short", "HEAD", check=False)
    unborn = git(clone, "rev-parse", "--verify", "--quiet", "HEAD", check=False) == ""
    if branch != "main" and not (sync and unborn):
        refuse(f"the clone is on '{branch}', not main.")
    if sync:
        sync_clone(clone, commit=commit)


def tree(root):
    """{relative path: sha256} of every working file, leaving .git out."""
    root, out = Path(root), {}
    for p in root.rglob("*"):
        rel = p.relative_to(root)
        if p.is_file() and rel.parts[0] != ".git":
            out[rel.as_posix()] = hashlib.sha256(p.read_bytes()).hexdigest()
    return out


def diff_trees(built, clone):
    a, b = tree(built), tree(clone)
    added = sorted(set(a) - set(b))
    removed = sorted(set(b) - set(a))
    changed = sorted(k for k in set(a) & set(b) if a[k] != b[k])
    return added, changed, removed


def extract_origin_main(clone, dest):
    """Read-only: unpack origin/main's tree into dest and return True, or False when there is no origin/main."""
    if git(clone, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/main", check=False) == "":
        return False
    r = subprocess.run(["git", "-C", str(clone), "archive", "--format=tar", "refs/remotes/origin/main"],
                       capture_output=True)
    if r.returncode != 0:
        sys.exit(f"git archive failed in {clone}")
    with tarfile.open(fileobj=io.BytesIO(r.stdout)) as tf:
        if hasattr(tarfile, "data_filter"):
            tf.extractall(dest, filter="data")
        else:
            root = Path(dest).resolve()
            safe = []
            for m in tf.getmembers():
                target = (root / m.name).resolve()
                if not (m.isfile() or m.isdir()):
                    continue                                    # skip links and special files
                if target != root and root not in target.parents:
                    sys.exit(f"git archive member escapes the target folder: {m.name}")
                safe.append(m)
            tf.extractall(dest, members=safe)
    return True


def replace_working_files(built, clone):
    clone = Path(clone)
    for p in list(clone.iterdir()):
        if p.name == ".git":
            continue
        shutil.rmtree(p) if p.is_dir() else p.unlink()
    for src in Path(built).rglob("*"):
        dest = clone / src.relative_to(built)
        if src.is_dir():
            dest.mkdir(parents=True, exist_ok=True)
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(src.read_bytes())


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", help="build into this new or empty directory (outside this repository)")
    ap.add_argument("--repo", help="a local clone of dfpm-physics/iPREP-staging to sync")
    ap.add_argument("--commit", action="store_true", help="with --repo: replace, commit and push origin main")
    ap.add_argument("--allow-dirty", action="store_true", help="allow uncommitted changes under site/ here")
    args = ap.parse_args(argv)
    if bool(args.out) == bool(args.repo):
        ap.error("give exactly one of --out or --repo")
    if args.commit and not args.repo:
        ap.error("--commit needs --repo")

    prod, staging = serve_local.read_targets()
    if staging["url"] == prod["url"] or urlsplit(prod["url"]).hostname in staging["url"]:
        refuse("the staging entry in config.js names the production project.")
    if not staging["anon"].startswith("sb_publishable_") or staging["anon"] == prod["anon"]:
        refuse("config.js has no staging publishable key (PREP_STAGING.anon).")

    if args.out:
        check_out_dir(args.out)
        return build(Path(args.out), prod, staging)[0]

    check_clone(args.repo, sync=True, commit=args.commit)
    dirty = git(REPO, "status", "--porcelain", "--", "site")
    if dirty:
        print(f"WARNING  uncommitted changes under site/ here ({len(dirty.splitlines())} path(s)); "
              "the copy would match no commit.")
        if args.commit and not args.allow_dirty:
            refuse("uncommitted changes under site/; commit them or pass --allow-dirty.")
    sha = git(REPO, "rev-parse", "--short", "HEAD")
    with tempfile.TemporaryDirectory() as td:
        built = Path(td) / "build"
        if inside(built, REPO):
            refuse("the temporary directory is inside this repository.")
        rc, _, _ = build(built, prod, staging)
        if rc:
            return rc
        compare = args.repo
        if not args.commit:
            # A dry run only fetches, so the clone's files can lag origin/main; count against origin/main itself.
            ref_dir = Path(td) / "origin-main"
            ref_dir.mkdir()
            if extract_origin_main(args.repo, ref_dir):
                compare = ref_dir
                behind = git(args.repo, "rev-list", "--count", "HEAD..origin/main", check=False) or "0"
                print(f"compare  against origin/main (the clone's HEAD is {behind} commit(s) behind it)")
            else:
                print("compare  against the clone's current files (no origin/main yet)")
        added, changed, removed = diff_trees(built, compare)
        print(f"clone    {len(added)} added, {len(changed)} changed, {len(removed)} removed")
        if not args.commit:
            print("dry run. Nothing written; add --commit to replace, commit and push.")
            return 0
        if not (added or changed or removed):
            print("nothing to publish.")
            return 0
        replace_working_files(built, args.repo)
        git(args.repo, "add", "--all", "--", ".")
        if not git(args.repo, "status", "--porcelain"):
            print("nothing to commit.")
            return 0
        git(args.repo, "commit", "-m", f"Publish test site from Core_Preflights {sha}")
        git(args.repo, "push", "origin", "main")
        print(f"pushed   origin main, from Core_Preflights {sha}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
