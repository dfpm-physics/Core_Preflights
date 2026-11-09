#!/usr/bin/env python3
"""Make a tutor setup file for every published tutor. Standard library only.

A tutor setup file (docs/contracts/TUTOR-SETUP-FILE.md) holds one tutor's id, title, link and objectives, so a director can drop it on
the Assignments page instead of typing them. This script builds those files for the tutors that already exist, from the course
catalogues under `_builder/courses/<course>/index.json`.

READ-ONLY on the repository, and dry-run by default: with no `--out` it only lists what it would write. With `--out <folder>` it writes
one file per published tutor into that folder (creating it), overwriting a file of the same name, so running it twice leaves the
same files. It never writes inside `_builder/` and never touches a database.

A catalogue row counts as a published tutor when it has a slug, a title and a `published_url`. The course in the file is the name of
the folder the catalogue sits in (for example `phys-215`).

Usage:
  python scripts/artifacts/make_tutor_files.py                      list what would be written
  python scripts/artifacts/make_tutor_files.py --out <folder>       write the files
  python scripts/artifacts/make_tutor_files.py --courses <folder>   read the catalogues from another `courses` folder
  python scripts/artifacts/make_tutor_files.py --course phys-215    one course only
"""

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_COURSES = ROOT / "_builder" / "courses"

SLUG_RE = re.compile(r"^[a-z0-9-]+$")
KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")


def setup_for(course, row):
    """The setup file for one catalogue row, or None when the row is not a usable published tutor."""
    slug = str(row.get("slug") or "").strip()
    title = str(row.get("title") or "").strip()
    url = str(row.get("published_url") or "").strip()
    if not (slug and title and url):
        return None
    if not SLUG_RE.match(slug) or not re.match(r"^https?://", url, re.I) or len(title) > 200:
        return None
    objectives, seen = [], set()
    for o in row.get("objectives") or []:
        key = str((o or {}).get("key") or "").strip()
        if not key or key in seen or not KEY_RE.match(key) or len(key) > 80:
            continue
        seen.add(key)
        objectives.append({"key": key, "label": str((o or {}).get("label") or "").strip() or key})
    out = {"format": "prep-tutor", "version": 1, "slug": slug, "course": course, "title": title, "url": url}
    if objectives:
        out["objective_keys"] = [o["key"] for o in objectives]
        out["objectives"] = objectives
    n = row.get("lesson_no")
    if isinstance(n, int) and not isinstance(n, bool) and 0 <= n <= 32767:
        out["lesson_no"] = n
    return out


def collect(courses_dir, only=None):
    """[(course, setup)] for every usable published tutor, in catalogue order. Raises ValueError on a catalogue that is not readable."""
    found = []
    for folder in sorted(p for p in Path(courses_dir).iterdir() if p.is_dir()):
        course = folder.name
        if only and course != only:
            continue
        index = folder / "index.json"
        if not index.is_file():
            continue
        try:
            doc = json.loads(index.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            raise ValueError(f"{index}: not readable ({e})")
        rows = doc.get("artifacts") if isinstance(doc, dict) else doc
        for row in rows or []:
            if isinstance(row, dict):
                s = setup_for(course, row)
                if s:
                    found.append((course, s))
    return found


def file_name(course, setup):
    return f"{course}_{setup['slug']}.tutor.json"


def render(setup):
    return json.dumps(setup, indent=2, ensure_ascii=False) + "\n"


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", help="folder to write the files into; without it nothing is written")
    ap.add_argument("--courses", default=str(DEFAULT_COURSES), help="the folder that holds one folder per course")
    ap.add_argument("--course", help="only this course, for example phys-215")
    a = ap.parse_args(argv)
    courses = Path(a.courses)
    if not courses.is_dir():
        print(f"No courses folder at {courses}.", file=sys.stderr)
        return 2
    try:
        found = collect(courses, a.course)
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 2
    if not found:
        print("No published tutors found. Nothing to write.")
        return 1
    per = {}
    for course, s in found:
        per[course] = per.get(course, 0) + 1
    for course, s in found:
        print(("write " if a.out else "would write ") + file_name(course, s))
    print(f"{len(found)} file(s): " + ", ".join(f"{c} {n}" for c, n in sorted(per.items())))
    if not a.out:
        print("Dry run. Add --out <folder> to write them.")
        return 0
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    for course, s in found:
        (out / file_name(course, s)).write_bytes(render(s).encode("utf-8"))
    print(f"Wrote {len(found)} file(s) to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
