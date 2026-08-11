#!/usr/bin/env python
"""Put each lesson's ASSIGNED READING (syllabus section numbers) into its assignment description.

WHY
    `app.assignments.description` is the one line a cadet sees under an assignment's title on
    site/student/assignments.html and site/student/lessons.html. Until now every phys-215 row
    carried the same generic sentence and every phys-310 row carried NULL, so the site never told
    a cadet WHAT to read — the reading lived only in the syllabus and in the builder's schedule
    file. This writes it where the cadet already looks.

    SECTIONS, NOT PAGES. The reading is the syllabus's section numbering — `22.2-22.3` for
    phys-215 (Cengage, the book cadets hold) and `2.1, 2.5, 2.6` for phys-310 (Murray & Holbert,
    *Nuclear Energy* 8th ed.). It is NOT the `reference_pages` page range already sitting in
    `activities.content`: that is OpenStax page numbering used for RAG grounding, in a different
    book, and it is not what a cadet is assigned. Do not substitute one for the other.

SOURCE OF TRUTH — PARSED, NEVER TRANSCRIBED
    The `Reading` column of the two builder schedule files, read at run time:
      phys-215  _builder/courses/phys-215/phys215_fall2026_schedule.md
      phys-310  _builder/courses/phys-310/phys310_fall2026_schedule.md
    Both are themselves copies of the courses' syllabus schedules and both declare their column
    headers as a parsing contract ("Keep the column headers exactly as written").

    This script PARSES those tables rather than embedding a copy of them, deliberately. A hand
    transcription sitting between a source and a load-bearing string is what produced this repo's
    one published-artifact defect (phys-310 lesson 2's slug, minted from a dropped word). A
    schedule edit therefore reaches the site on the next run of this script, with nothing to
    re-transcribe and nothing to go stale.

phys-110 IS NOT COVERED, AND CANNOT BE FROM THIS REPO
    There is no `_builder/courses/phys-110/`, no phys-110 schedule file, and no phys-110 syllabus
    in the tree — so the repo holds no reading-section data for that course at all. Its 37
    assignments are left untouched. `scripts/fall2026/build_110_preflights.py` says so in its own
    header ("No reading links"), and the only reading-shaped data phys-110 has is the OpenStax
    `reference_pages` this script explicitly does not use. Adding phys-110 means adding its
    syllabus's reading column as a schedule file under `_builder/courses/phys-110/` with the same
    `Lsn` / `Topic` / `Reading` headers; this script then picks it up as a new COURSES entry and
    nothing else changes.

WHAT IT WRITES
    `app.assignments.description` only. One column, one table. No offering, deadline, question,
    grade or publication state is read for a write or touched in any way.

      "Reading: 22.2-22.3 . Complete before class. Full credit for a genuine, thoughtful effort."
      "Reading: 2.1, 2.5, 2.6"        (phys-310, whose descriptions were NULL)

    The existing sentence is PRESERVED, never replaced — the reading is prefixed to it. A row with
    no description gets the reading alone rather than inheriting phys-215's boilerplate.

    phys-215's TRAINING assignments (`preflight-NN-training`, the `training-fall-2026` sandbox
    offering) are included by default: they are separate rows since the 2026-07-28 content
    isolation split, so writing them changes nothing live, and a sandbox that disagrees with the
    real course is what the split exists to prevent. `--skip-training` opts out.

IDEMPOTENT
    The description is COMPOSED from (reading, base sentence) each run, and any existing
    `Reading: ... . ` prefix is stripped before composing, so a second run reports zero changes and
    an edited schedule corrects the row in place instead of stacking a second prefix.

GUARD
    Every row's DB title is checked against the schedule's topic for that lesson before it is
    written (punctuation/case/accent-insensitive, prefix match). A renumbered lesson or a
    mis-mapped slug therefore fails loudly instead of writing the wrong reading. `--force` is not
    offered; fix the mapping.

Runs as the DML tier - data only, no DDL. Dry-run by default (CORE.md sec 4).

Usage (Windows: .venv\\Scripts\\python):
  .venv/bin/python scripts/fall2026/set_reading_descriptions.py --course phys-215
  .venv/bin/python scripts/fall2026/set_reading_descriptions.py --course phys-215 --commit
  .venv/bin/python scripts/fall2026/set_reading_descriptions.py --course all --commit
"""

import argparse
import re
import sys
import unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "supabase" / "admin"))

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor, execute_values
except ImportError:  # pragma: no cover - environment guard
    sys.exit("psycopg2 not found - use the project .venv (pip install -r requirements.txt).")

from app_tier_check import read_env  # noqa: E402

ENV_FILE = REPO / "supabase" / "admin" / ".env"
SEP = " · "  # middle dot, matching the card-meta separator the site already uses

# ---------------------------------------------------------------------------------------------
# Courses this script knows how to resolve.
#
#   schedule  - the markdown table to parse, relative to the repo root
#   slug_map  - DB assignment slug -> schedule lesson number
#
# phys-215 slugs ARE lesson numbers (`preflight-14`, plus the `-training` sandbox twin), so the
# map is derived. phys-310 slugs are not: three are `lesson-NN` and one is a minted artifact slug
# (`phys310-binding-energy-and-stability-e0ceabee`, lesson 3), because that course's slugs come
# from the topic and not the number by design - see its COURSE_PROFILE.md "Slug namespacing". The
# title guard below is what makes the hand-written half of that map safe.
# ---------------------------------------------------------------------------------------------


def _phys215_slug_map(lessons):
    out = {}
    for n in lessons:
        out[f"preflight-{n:02d}"] = n
        out[f"preflight-{n:02d}-training"] = n
    return out


COURSES = {
    "phys-215": {
        "schedule": "_builder/courses/phys-215/phys215_fall2026_schedule.md",
        "slug_map": _phys215_slug_map,           # callable: derived from the parsed lessons
    },
    "phys-310": {
        "schedule": "_builder/courses/phys-310/phys310_fall2026_schedule.md",
        "slug_map": {                            # literal: four rows, two naming schemes
            "lesson-01": 1,
            "lesson-02": 2,
            "phys310-binding-energy-and-stability-e0ceabee": 3,
            "lesson-04": 4,
        },
    },
}

# Courses that exist in the DB but have no reading-section source in this repo. Named here so the
# omission is reported on every run instead of being silently absent.
NO_SOURCE = {
    "phys-110": "no _builder/courses/phys-110/ and no syllabus schedule in the repo - the only "
                "reading-shaped data it has is OpenStax `reference_pages`, which is page numbers "
                "in the grounding text, not the syllabus's assigned sections",
}

EMPTY_READING = {"", "-", "—", "–", "n/a", "none"}


def norm(s):
    """Fold accents, punctuation and case so a topic comparison survives editorial drift.

    The DB and the schedule disagree cosmetically in ways that mean nothing: `Ampere's` vs
    `Ampere's` with a combining accent, `Elec. Fields` vs `Electric Fields`, `--` vs `-`. None of
    those should fail a guard whose job is to catch a WRONG LESSON.
    """
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower().replace("&", "and")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def strip_markup(s):
    """`**GRADED REVIEW 1**` / `*Lecture: ...*` -> plain text. Emphasis is the schedule's way of
    marking a non-lesson day; it is not part of the topic."""
    return re.sub(r"[*_`]", "", s or "").strip()


def parse_schedule(path):
    """-> {lesson number: {'topic': str, 'reading': str or None}} from a markdown table.

    Locates the table by its header row - the one pipe row carrying both `Lsn` and a column
    starting `Reading` - and reads columns BY NAME, so an added or reordered column does not
    silently shift the values. Both schedule files declare those headers as a parsing contract.
    """
    text = path.read_text(encoding="utf-8")
    idx = topic_i = reading_i = lsn_i = None
    rows = {}
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            if idx is not None and rows:
                break          # table ended; ignore any later table
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if idx is None:
            names = [norm(c) for c in cells]
            if "lsn" in names and any(n.startswith("reading") for n in names):
                lsn_i = names.index("lsn")
                topic_i = names.index("topic")
                reading_i = next(i for i, n in enumerate(names) if n.startswith("reading"))
                idx = True
            continue
        if set(cells[0]) <= set(":- "):
            continue           # the |---|---| separator row
        if len(cells) <= max(lsn_i, topic_i, reading_i):
            continue
        if not re.fullmatch(r"\d+", cells[lsn_i]):
            continue           # the final-exam row, whose Lsn is an em dash
        reading = strip_markup(cells[reading_i])
        rows[int(cells[lsn_i])] = {
            "topic": strip_markup(cells[topic_i]),
            "reading": None if norm(reading) in EMPTY_READING or not reading else reading,
        }
    if idx is None:
        sys.exit(f"no schedule table with `Lsn` + `Reading` headers found in {path}")
    return rows


def compose(reading, existing):
    """The description this row should hold. Idempotent: an existing `Reading: ... .` prefix is
    stripped first, so re-running is a no-op and an edited schedule corrects in place."""
    base = re.sub(r"^Reading:.*?" + re.escape(SEP), "", existing or "", count=1).strip()
    base = "" if base.startswith("Reading:") else base   # a bare prefix with no sentence after it
    return f"Reading: {reading}{SEP}{base}" if base else f"Reading: {reading}"


def connect(env, role="DML"):
    return psycopg2.connect(
        user=f'{env[f"PREP_APP_{role}_ROLE"]}.{env["PREP_PROJECT_REF"]}',
        password=env[f"PREP_APP_{role}_PASSWORD"],
        host=env["PREP_DB_HOST"], port=env.get("PREP_DB_PORT", "5432"),
        dbname=env.get("PREP_DB_NAME", "postgres"),
        sslmode=env.get("PREP_DB_SSLMODE", "require"),
        cursor_factory=RealDictCursor, connect_timeout=20,
    )


def plan_course(cur, code, spec, skip_training):
    """-> (updates, unchanged, problems) for one course. Reads only; writes nothing."""
    sched = parse_schedule(REPO / spec["schedule"])
    slug_map = spec["slug_map"]
    if callable(slug_map):
        slug_map = slug_map(sorted(sched))

    cur.execute("""
        SELECT a.id, a.slug, a.title, a.description
          FROM app.assignments a JOIN app.courses c ON c.id = a.course_id
         WHERE c.code = %s ORDER BY a.slug
    """, (code,))
    rows = cur.fetchall()

    updates, unchanged, problems = [], [], []
    for r in rows:
        slug = r["slug"]
        if skip_training and slug.endswith("-training"):
            continue
        n = slug_map.get(slug)
        if n is None:
            problems.append((slug, "no lesson number mapped for this slug"))
            continue
        entry = sched.get(n)
        if entry is None:
            problems.append((slug, f"lesson {n} is not in the schedule table"))
            continue

        # Guard: does the DB row actually describe the lesson we mapped it to? The DB title is
        # `Lesson 14 Preflight - <topic>` or bare `<topic>`; either must END with the schedule's
        # topic, allowing for the abbreviations the two sources disagree on.
        db_t, sched_t = norm(r["title"]), norm(entry["topic"])
        if sched_t and not (db_t.endswith(sched_t) or sched_t.startswith(db_t)
                            or sched_t[:24] in db_t):
            problems.append((slug, f"title/topic mismatch: DB {r['title']!r} "
                                   f"vs schedule lesson {n} {entry['topic']!r}"))
            continue

        if not entry["reading"]:
            unchanged.append((slug, n, "-", "no reading in schedule"))
            continue
        want = compose(entry["reading"], r["description"])
        if want == (r["description"] or ""):
            unchanged.append((slug, n, entry["reading"], "already correct"))
        else:
            updates.append({"id": r["id"], "slug": slug, "n": n,
                            "reading": entry["reading"], "was": r["description"], "want": want})
    return updates, unchanged, problems


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--course", required=True, choices=sorted(COURSES) + ["all"],
                    help="course CODE - only this course is touched")
    ap.add_argument("--skip-training", action="store_true",
                    help="leave the phys-215 `-training` sandbox rows alone")
    ap.add_argument("--commit", action="store_true", help="write; otherwise everything rolls back")
    args = ap.parse_args()

    codes = sorted(COURSES) if args.course == "all" else [args.course]
    env = read_env(ENV_FILE)
    conn = connect(env)
    cur = conn.cursor()

    for code, why in sorted(NO_SOURCE.items()):
        print(f"NOT COVERED  {code}: {why}\n")

    all_updates, any_problem = [], False
    for code in codes:
        spec = COURSES[code]
        print(f"=== {code} · {spec['schedule']} ===")
        updates, unchanged, problems = plan_course(cur, code, spec, args.skip_training)
        all_updates += updates

        for slug, n, reading, note in unchanged:
            print(f"  ok    {slug:<48} L{n:<3} {reading:<22} ({note})")
        for u in updates:
            print(f"  SET   {u['slug']:<48} L{u['n']:<3} {u['reading']:<22}")
            print(f"        -> {u['want']}")
        for slug, msg in problems:
            print(f"  !!    {slug:<48} {msg}")
            any_problem = True
        print(f"  {len(updates)} to write, {len(unchanged)} already right, "
              f"{len(problems)} problem(s)\n")

    if any_problem:
        sys.exit("refusing to write: fix the slug mapping or the schedule first")

    if not all_updates:
        print("nothing to do.")
        return
    execute_values(cur, """
        UPDATE app.assignments a SET description = v.description, updated_at = now()
          FROM (VALUES %s) AS v(id, description)
         WHERE a.id = v.id::uuid
    """, [(str(u["id"]), u["want"]) for u in all_updates])
    print(f"{cur.rowcount} row(s) updated.")

    if args.commit:
        conn.commit()
        print("COMMITTED.")
    else:
        conn.rollback()
        print("[dry run] rolled back. Re-run with --commit to write.")


if __name__ == "__main__":
    main()
