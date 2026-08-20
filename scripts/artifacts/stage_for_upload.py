#!/usr/bin/env python3
r"""
stage_for_upload.py -- flatten every artifact .jsx into _upload/ for bulk republishing.

WHY. The sources live three directories deep, one folder per course, under filenames that say
nothing about which lesson row they belong to. Republishing 51 of them by hand means matching each
file to its slug and its existing claude.ai URL 51 times. This flattens them into one directory,
names each file after the thing that identifies it, and writes the checklist beside them.

THE SLUG IS THE POINT. Republishing a patched artifact into the SAME course offering keeps its
slug -- contract 3.2's "never reuse a slug" governs a rebuild for a NEW OFFERING, which this is
not. `app.activities.slug` is globally UNIQUE and every student report hangs off that row, so a new
slug would orphan the work of every cadet who already finished. The slug is already baked into each
file; putting it in the FILENAME too means the person uploading can see at a glance which lesson
they are replacing, and the INDEX carries the URL to replace it at.

The output is gitignored and disposable. Delete _upload/ when the republish is done -- it is 8.5 MB
of derived source whose home is the private artifact-sources bucket.

USAGE
    python scripts/artifacts/stage_for_upload.py                 # every course
    python scripts/artifacts/stage_for_upload.py --course phys-215
    python scripts/artifacts/stage_for_upload.py --published     # only the ones already live

Stdlib only. Rewrites _upload/ from scratch on every run.
"""

import argparse
import json
import pathlib
import shutil

ROOT = pathlib.Path(__file__).resolve().parents[2]
COURSES = ROOT / "_builder" / "courses"
OUT = ROOT / "_upload"
ALL = ["phys-110", "phys-215", "phys-310"]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--course", action="append", default=[], help="repeatable; default all")
    ap.add_argument("--published", action="store_true",
                    help="skip artifacts that have never been published")
    args = ap.parse_args()
    courses = args.course or ALL

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    rows, staged, skipped = [], 0, 0
    for course in courses:
        idx_path = COURSES / course / "index.json"
        if not idx_path.is_file():
            print(f"{course}: no index.json - skipped")
            continue
        idx = json.loads(idx_path.read_text(encoding="utf-8"))
        for a in sorted(idx.get("artifacts", []), key=lambda x: x.get("lesson_no") or 0):
            src = COURSES / course / "artifacts" / a["file"]
            if not src.is_file():
                print(f"  {a['slug']}: no cached .jsx - run sync_artifacts.py pull")
                continue
            if args.published and not a.get("published_url"):
                skipped += 1
                continue
            # Course, then zero-padded lesson number, then the slug: sorts into teaching order
            # inside each course, and carries the identity that has to survive the republish.
            name = f"{course}_L{a.get('lesson_no') or 0:02d}_{a['slug']}.jsx"
            # Bytes, not text. A text-mode copy applies universal newlines and silently rewrites
            # every line -- the failure PROJECT.md's sharp-edge table already paid for once.
            (OUT / name).write_bytes(src.read_bytes())
            staged += 1
            rows.append((course, a.get("lesson_no") or 0, name, a.get("title", ""),
                         a["slug"], a.get("published_url") or "", a.get("published_on") or ""))

    lines = [
        "# Republish checklist",
        "",
        f"{staged} artifact source(s) staged in `_upload/`."
        + (f" {skipped} unpublished artifact(s) skipped." if skipped else ""),
        "",
        "**Keep each artifact's slug.** It is already baked into the file; do not let a rebuild",
        "mint a new one. `app.activities.slug` is globally UNIQUE and every student report hangs",
        "off that row, so a new slug orphans the work of every cadet who already finished.",
        "",
        "**Replace, do not create.** Open the existing artifact at the URL below and update it.",
        "If claude.ai issues a NEW share URL, the lesson row's `artifact_url` needs updating —",
        "that is the only database change a patched republish requires. No re-registration.",
        "",
        "A blank URL means this artifact has never been published; publishing it is a first",
        "publish and DOES need a lesson row created (see `docs/operations/PUBLISH-ARTIFACT.md`).",
        "",
        "| ✓ | Course | Lesson | File | Title | Currently published at |",
        "|---|---|---|---|---|---|",
    ]
    for course, no, name, title, slug, url, on in rows:
        cell = f"[{on or 'live'}]({url})" if url else "**never published**"
        lines.append(f"|   | {course} | {no} | `{name}` | {title} | {cell} |")
    lines += ["", "Delete `_upload/` when you are done — it is gitignored and disposable.", ""]
    (OUT / "INDEX.md").write_text("\n".join(lines), encoding="utf-8")

    published = sum(1 for r in rows if r[5])
    print(f"\n{staged} file(s) -> {OUT}")
    print(f"  {published} already published (replace in place, keep the slug)")
    print(f"  {staged - published} never published (first publish, needs a lesson row)")
    print(f"  checklist: {OUT / 'INDEX.md'}")


if __name__ == "__main__":
    main()
