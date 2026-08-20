#!/usr/bin/env python3
r"""
preview_artifact.py -- wrap a CLAUDE artifact source in a browser-parseable page and check it.

WHY. PROJECT.md's sharp-edge table: "Publishing is the only JSX parser this project has."
`node --check` returns exit 0 on invalid JSX and `check_artifact.py` is explicitly not a syntax
check, so before this, the first thing that ever parsed a `.jsx` was claude.ai -- by hand, during
publishing, one artifact at a time. A hand-patched artifact that does not parse was therefore
discovered by a cadet.

`to_gemini.py` already proved a browser can parse these: it wraps the same JSX in a
Babel-in-browser page. But the PORTED build is not the artifact -- the porter rewrites the
transport and strips the backup button, the handoff anchor and `handoffUrl` on the way through.
So the code added on 2026-08-20 is precisely the code `gemini-build.mjs` cannot see. This wraps
the source WITHOUT porting it, and hands the result to `tests/browser-harness/claude-artifact.mjs`.

WHAT IT PROVES, AND WHAT IT DOES NOT. It proves the file parses, mounts, and lays out correctly.
It cannot run a tutor turn -- there is no claude.ai runtime here -- so the model ladder, sysFor()'s
phase switching and a real handoff payload are NOT covered. CORE.md section 2: a Node-only check is
never the sole verification of a change. Say so in the CHANGELOG when it is all that ran.

THE PREVIEW FILE IS TEMPORARY AND MUST NOT BE COMMITTED. The wrapper loads React and Babel from
`../../vendor/`, which only resolves from `site/gemini/<course>/`, so the preview has to be written
into a committed directory. It is removed in a `finally`, and `--keep` is the only way to leave one
behind. Check `git status` if a run is interrupted.

USAGE
    python scripts/artifacts/preview_artifact.py --course phys-215 --lesson 2
    python scripts/artifacts/preview_artifact.py --course phys-110 --all
    python scripts/artifacts/preview_artifact.py --all-courses --all
    python scripts/artifacts/preview_artifact.py --course phys-215 --lesson 2 --keep

Stdlib only. Requires Node + puppeteer-core for the browser step (optional dev tooling,
CORE.md section 2) -- without them it writes the page and tells you where it is.
"""

import argparse
import json
import pathlib
import re
import shutil
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
COURSES = ROOT / "_builder" / "courses"
HARNESS = ROOT / "tests" / "browser-harness" / "claude-artifact.mjs"

sys.path.insert(0, str(HERE))
from to_gemini import wrap, COURSE_LABELS  # noqa: E402

PREVIEW_NAME = "__preview__.html"


def previews_for(course: str, which: list) -> list:
    index = json.loads((COURSES / course / "index.json").read_text(encoding="utf-8"))
    entries = index if isinstance(index, list) else index.get("artifacts", [])
    out = []
    for e in entries:
        slug = e.get("slug") or e.get("id")
        if which and slug not in which and str(e.get("lesson_no")) not in which:
            continue
        src = COURSES / course / "artifacts" / e["file"]
        if not src.is_file():
            print(f"  {slug}: no cached .jsx - run sync_artifacts.py pull")
            continue
        out.append((slug, e, src))
    return out


def build_preview(course: str, entry: dict, src_path: pathlib.Path) -> pathlib.Path:
    src = src_path.read_bytes()
    m = re.search(rb"export default function (\w+)\(\)", src)
    if not m:
        raise SystemExit(f"{src_path.name}: no `export default function` - not an artifact")
    out_dir = ROOT / "site" / "gemini" / course
    out_dir.mkdir(parents=True, exist_ok=True)
    page = wrap(src, m.group(1).decode(),
                entry.get("title", entry.get("slug", "preview")),
                COURSE_LABELS.get(course, course),
                f"Lesson {entry.get('lesson_no', '?')} - PREVIEW, do not commit")
    dest = out_dir / PREVIEW_NAME
    dest.write_bytes(page)
    return dest


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--course")
    ap.add_argument("--all-courses", action="store_true")
    ap.add_argument("--lesson", action="append", default=[])
    ap.add_argument("--slug", action="append", default=[])
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--keep", action="store_true",
                    help="leave the preview page in place (it is gitignore-invisible - clean up)")
    args = ap.parse_args()

    courses = (["phys-110", "phys-215", "phys-310"] if args.all_courses
               else [args.course] if args.course else [])
    if not courses:
        raise SystemExit("need --course or --all-courses")
    which = [str(x) for x in (args.lesson + args.slug)]
    if not which and not args.all:
        raise SystemExit("need --lesson, --slug or --all")

    node = shutil.which("node") or r"C:\Program Files\nodejs\node.exe"
    have_node = pathlib.Path(node).exists() if node else False

    total = failed = 0
    for course in courses:
        targets = previews_for(course, which)
        if not targets:
            continue
        print(f"\n=== {course}: {len(targets)} artifact(s) ===")
        for slug, entry, src in targets:
            total += 1
            dest = build_preview(course, entry, src)
            rel = dest.relative_to(ROOT).as_posix()
            try:
                if not have_node:
                    print(f"  {slug}: wrote {rel} (no node - open it yourself)")
                    args.keep = True
                    continue
                r = subprocess.run([node, str(HARNESS), rel], cwd=ROOT)
                if r.returncode:
                    failed += 1
            finally:
                if not args.keep and dest.exists():
                    dest.unlink()

    print(f"\n{total} previewed | {failed} failed")
    if args.keep:
        print(f"PREVIEW PAGES LEFT IN PLACE. They are committed directories - "
              f"delete site/gemini/*/{PREVIEW_NAME} before staging.")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
