#!/usr/bin/env python
"""Offer PREP alongside iPREP: set which activities carry credit, and how PREP is presented.

Fall 2026 lessons 7-11 shipped as iPREP-only — the interactive AI lesson was the only path that
carried credit. Some cadets cannot complete iPREP at all (age limits, age-verification failures,
technical faults no retry fixes), and for them there was no way to earn the points. This script
opens the written path back up. It supports two shapes:

    choice  Both paths carry credit and the cadet picks either one, freely.
            Written activity gets `content.access = 'open'`.
    gated   Both paths carry credit, but the interactive IS the assignment; the written
            preflight is offered underneath it and only with an instructor's permission.
            Written activity gets `content.access = 'by_permission'`.

UPDATED 2026-08-28: the gate is OFF. It applied to lessons 8-11, which shipped gated on
2026-08-24; the course director ended it four days later, so every lesson in PLAN below is
now `choice` and `gated` is machinery with no current user. See the note above PLAN.

Lesson 7 is deliberately untouched in both courses (course director, 2026-08-24): it stays
iPREP-only.

WHY THIS IS A SCRIPT AND NOT THE LESSONS PAGE
    For phys-110 lessons 8, 9 and 11 the written questions already exist in the library but are
    NOT attached to this term's offering. The faculty editor hydrates its written section from
    `offering_activities` (`pick()` in site/faculty/lessons.html), so a detached activity reads to
    it as ABSENT — ticking "Include" would start from blank default questions, and saveLesson()
    step 2 replaces `activities.content` wholesale. Saving would have destroyed the real Q3 on all
    three. This writes `offering_activities` directly and never rebuilds a question set.

WHAT IT WRITES  (two tables, and nothing else)
    1. `app.offering_activities` — inserts the missing (offering, activity) rows and sets
       `grading_role`. This is the table whose own COMMENT calls it "THE OPERATIONAL LEVER …
       without touching the library definition and without disturbing grades already earned".
    2. `app.activities.content -> 'access'` — one jsonb key on the WRITTEN activity, merged with
       `||` so every other key in that column (questions, reference_pdf, reference_pages,
       reading_link) is left exactly as it was. There is no column for this flag and DDL on `app`
       is coordinated (CORE.md section 0); `activities` rows have been per-offering since the
       2026-07-28 content isolation, so a flag there is already a per-term fact.

    It NEVER deletes an offering_activities row. Detaching an activity a student has committed to
    nulls their `chosen_activity_id` through the composite FK — this script only ever adds and
    re-roles, so no cadet's committed choice can be disturbed by it.

IDEMPOTENT: a role or flag already at its target is not rewritten, and a second run reports zero
changes. Runs as the DML tier — data only, no DDL. Dry-run by default (CORE.md section 4): every
write happens inside a transaction that is ROLLED BACK unless --commit is passed, so the read-back
below reflects real writes against real constraints either way.

Usage (Windows: .venv\\Scripts\\python):
  .venv/bin/python scripts/fall2026/set_activity_roles.py
  .venv/bin/python scripts/fall2026/set_activity_roles.py --course phys-110
  .venv/bin/python scripts/fall2026/set_activity_roles.py --commit
  .venv/bin/python scripts/fall2026/set_activity_roles.py --only preflight-08,preflight-09 --commit
"""

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "supabase" / "admin"))

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor, execute_values
except ImportError:  # pragma: no cover - environment guard
    sys.exit("psycopg2 not found — use the project .venv (pip install -r requirements.txt).")

from app_tier_check import read_env  # noqa: E402

ENV_FILE = REPO / "supabase" / "admin" / ".env"

GATED = "gated"     # both graded; written offered under the interactive, by permission
CHOICE = "choice"   # both graded; cadet picks freely

# The two access values. Must match ACCESS_OPEN / ACCESS_BY_PERMISSION in site/js/schema.js —
# the student lesson page and the faculty editor both resolve this key through writtenAccessOf(),
# and an unrecognised value there deliberately reads as 'open'. A typo here therefore does not
# break a page; it silently fails to apply the gate, which is why the read-back checks the value
# that actually landed rather than the value this script intended.
ACCESS_OPEN = "open"
ACCESS_BY_PERMISSION = "by_permission"

# ── What each course wants, per lesson number ─────────────────────────────────────────────────
# Lessons absent from a course's map are NOT TOUCHED. Adding a course or a lesson is a new entry
# here and nothing else — never a fork of this file.
#
# phys-215 lessons 13+ are already `choice` in the database and are listed anyway: the script is
# idempotent, so naming them costs one comparison and makes the intended end state readable in
# one place instead of "these five, plus twenty-one others that happen to be right already".
PLAN = {}

# NOTHING IS GATED ANY MORE. The course director ended the permission gate on 2026-08-28:
# every remaining assignment in both courses is the cadet's own choice. Lessons 8-11 moved
# from GATED to CHOICE here on that date, and the student-facing sentence asking cadets to
# get permission first was removed from site/student/lessons.html, the submit confirm in
# site/student/assignments.html, and site/help/student-getting-started.md in the same change.
#
# GATED is kept above, wired and working, because it is a shape the model supports and a
# future term may want it again — but if you re-gate a lesson, those three student-facing
# texts have to come back with it, or the page will gate a path without ever saying so.
PLAN["phys-110"] = {
    **{n: CHOICE for n in (8, 9, 11, 12, 14, 15, 16, 17)},   # 10 is LAB 2 — see SKIPS
}

PLAN["phys-215"] = {
    # 11 is a lab with no artifact — see SKIPS
    **{n: CHOICE for n in (8, 9, 10, 13, 14, 15, 18, 19, 20, 21, 22, 24, 25, 26,
                           28, 29, 30, 31, 32, 33, 36, 37, 39, 41)},
}

# Lessons a reader will expect to find above, with the reason they are absent. Printed on every
# run: an unexplained gap in the map is indistinguishable from an oversight, and this range of
# lessons is exactly where someone will look next term and wonder.
SKIPS = {
    ("phys-110", 7):  "iPREP-only by the course director's decision (2026-08-24).",
    ("phys-110", 10): "LAB 2 — PREP is ALREADY the graded path here, with iPREP as practice. "
                      "Cadets who cannot run iPREP are already served; gating it would take away "
                      "a path they have today.",
    ("phys-215", 7):  "iPREP-only by the course director's decision (2026-08-24).",
    ("phys-215", 11): "LAB: Mapping Electric Potential — no interactive activity exists and no "
                      "artifact was ever built, so there is no iPREP to offer. Matches every "
                      "other phys-215 lab (6, 17, 27, 34, 38), which are all written-only.",
}


def connect(env, role="DML"):
    return psycopg2.connect(
        user=f'{env[f"PREP_APP_{role}_ROLE"]}.{env["PREP_PROJECT_REF"]}',
        password=env[f"PREP_APP_{role}_PASSWORD"],
        host=env["PREP_DB_HOST"], port=env.get("PREP_DB_PORT", "5432"),
        dbname=env.get("PREP_DB_NAME", "postgres"),
        sslmode=env.get("PREP_DB_SSLMODE", "require"),
        cursor_factory=RealDictCursor,
    )


def load(cur, course, term):
    """One course's offerings, each with BOTH its activities — attached or not.

    The join to `activities` is on `assignment_id`, deliberately NOT through
    `offering_activities`: an activity that exists in the library but is not attached to this term
    is precisely the case this script exists to fix, and joining through the attachment table
    would make those three phys-110 lessons look like they have no questions at all.
    """
    cur.execute("""
        SELECT co.id FROM app.course_offerings co
          JOIN app.courses c ON c.id = co.course_id
          JOIN app.terms   t ON t.id = co.term_id
         WHERE c.code = %s AND t.code = %s
    """, (course, term))
    rows = cur.fetchall()
    if len(rows) != 1:
        sys.exit(f"expected 1 course offering for {course}/{term}, got {len(rows)}")
    co_id = rows[0]["id"]

    cur.execute("""
        SELECT ao.id AS offering_id, a.slug, ao.position,
               act.id AS activity_id, act.modality, act.slug AS activity_slug,
               act.content,
               oa.grading_role, oa.available_after, oa.is_visible, oa.position AS oa_position,
               jsonb_array_length(COALESCE(act.content -> 'questions', '[]'::jsonb)) AS n_questions
          FROM app.assignment_offerings ao
          JOIN app.assignments a   ON a.id = ao.assignment_id
          JOIN app.activities  act ON act.assignment_id = ao.assignment_id
     LEFT JOIN app.offering_activities oa
            ON oa.assignment_offering_id = ao.id AND oa.activity_id = act.id
         WHERE ao.course_offering_id = %s
         ORDER BY ao.position, act.modality
    """, (co_id,))

    out = {}
    for r in cur.fetchall():
        o = out.setdefault(r["slug"], {"offering_id": r["offering_id"],
                                       "position": r["position"], "written": None,
                                       "interactive": None})
        o[r["modality"]] = r
    return co_id, out


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--course", choices=sorted(PLAN), action="append",
                    help="course CODE; repeatable. Default: every course in PLAN.")
    ap.add_argument("--term", default="fall-2026", help="term CODE")
    ap.add_argument("--only", default="",
                    help="comma-separated assignment slugs; restrict the WRITE to these. "
                         "Everything else is still checked and reported, just not written.")
    ap.add_argument("--commit", action="store_true", help="write; otherwise everything rolls back")
    args = ap.parse_args()

    courses = args.course or sorted(PLAN)
    only = {s.strip() for s in args.only.split(",") if s.strip()}

    env = read_env(ENV_FILE)
    conn = connect(env)
    cur = conn.cursor()

    oa_rows, access_rows = [], []
    held, refused = [], []
    n_attach = n_role = n_access = 0

    for course in courses:
        co_id, offerings = load(cur, course, args.term)
        print(f"\n=== {course} · term {args.term} · offering {co_id} ===")
        print(f"{'slug':<15}{'want':<8}{'written':<24}{'interactive':<24}access")

        wanted = PLAN[course]
        by_position = {o["position"]: slug for slug, o in offerings.items()}
        for n in sorted(set(wanted) - set(by_position)):
            refused.append((course, f"lesson {n}", "no offering with that position exists"))

        for n in sorted(wanted):
            slug = by_position.get(n)
            if slug is None:
                continue
            mode = wanted[n]
            o = offerings[slug]
            w, i = o["written"], o["interactive"]

            # Both paths must EXIST before either can be offered. Refusing here rather than
            # writing half the change is the whole point: a lesson with one graded activity and a
            # permission gate on nothing is a lesson that silently lost its fallback.
            if w is None or i is None:
                missing = "written" if w is None else "interactive"
                refused.append((course, slug, f"no {missing} activity exists for this assignment"))
                continue

            want_access = ACCESS_BY_PERMISSION if mode == GATED else ACCESS_OPEN
            have_access = (w["content"] or {}).get("access") or ACCESS_OPEN
            skip = only and slug not in only
            acts = []

            for a, pos in ((w, 0), (i, 1)):
                if a["grading_role"] is None:
                    acts.append(f"{a['modality'][:5]} ATTACH")
                    if not skip:
                        n_attach += 1
                        oa_rows.append((o["offering_id"], a["activity_id"], "graded", pos))
                elif a["grading_role"] != "graded":
                    acts.append(f"{a['modality'][:5]} {a['grading_role']}→graded")
                    if not skip:
                        n_role += 1
                        oa_rows.append((o["offering_id"], a["activity_id"], "graded", pos))
                else:
                    acts.append(f"{a['modality'][:5]} ok")

            if have_access != want_access:
                acc = f"{have_access}→{want_access}"
                if not skip:
                    n_access += 1
                    access_rows.append((w["activity_id"], want_access))
            else:
                acc = f"{want_access} ok"

            if skip and (any("ok" not in x for x in acts) or "→" in acc):
                held.append(slug)
            print(f"{slug:<15}{mode:<8}{acts[0]:<24}{acts[1]:<24}{acc}"
                  f"{'   [held by --only]' if skip else ''}")

    print(f"\nplan: attach {n_attach} · re-role {n_role} · access flag {n_access}")
    if held:
        print(f"  --only is holding {len(held)} offering(s) that need a change: {sorted(held)}")

    print("\ndeliberately untouched:")
    for (course, n), why in sorted(SKIPS.items()):
        print(f"  {course} lesson {n:<3} {why}")
    if refused:
        print("\n  ⚠  REFUSED — asked for by the plan, not possible in the data:")
        for course, what, why in refused:
            print(f"       {course} {what}: {why}")

    # ── Write ───────────────────────────────────────────────────────────────────────────────
    # Roles first: `||` on the access flag is harmless on an unattached activity, but the read-back
    # is only meaningful once the attachment it describes exists.
    if oa_rows:
        execute_values(cur, """
            INSERT INTO app.offering_activities
                   (assignment_offering_id, activity_id, grading_role,
                    available_after, is_visible, position)
            VALUES %s
            ON CONFLICT (assignment_offering_id, activity_id)
              DO UPDATE SET grading_role = EXCLUDED.grading_role
               WHERE app.offering_activities.grading_role
                     IS DISTINCT FROM EXCLUDED.grading_role
        """, [(str(o), str(a), role, "always", True, pos) for o, a, role, pos in oa_rows])

    # `content || jsonb` MERGES: every other key in that column survives untouched. Building a new
    # object here instead would be the exact defect this script exists to avoid — see the header.
    if access_rows:
        execute_values(cur, """
            UPDATE app.activities act
               SET content = act.content || v.patch::jsonb, updated_at = now()
              FROM (VALUES %s) AS v(id, patch)
             WHERE act.id = v.id::uuid
        """, [(str(i), json.dumps({"access": val})) for i, val in access_rows])

    # ── Read back, from the DB and not from the plan ────────────────────────────────────────
    print("\n=== after ===")
    for course in courses:
        _co, offerings = load(cur, course, args.term)
        by_position = {o["position"]: slug for slug, o in offerings.items()}
        bad = []
        for n, mode in sorted(PLAN[course].items()):
            slug = by_position.get(n)
            if slug is None:
                continue
            o = offerings[slug]
            w, i = o["written"], o["interactive"]
            if w is None or i is None:
                continue
            want_access = ACCESS_BY_PERMISSION if mode == GATED else ACCESS_OPEN
            got_access = (w["content"] or {}).get("access") or ACCESS_OPEN
            # A written activity that lost its questions is the one failure that would be silent
            # and unrecoverable, so it is asserted rather than assumed.
            if w["n_questions"] == 0:
                bad.append(f"{slug}: written activity has NO questions")
            if w["grading_role"] != "graded" or i["grading_role"] != "graded":
                bad.append(f"{slug}: roles are w={w['grading_role']} i={i['grading_role']}")
            if got_access != want_access:
                bad.append(f"{slug}: access is {got_access}, wanted {want_access}")
        n = len([1 for k in PLAN[course] if by_position.get(k)])
        print(f"  {course}: {n - len(bad)}/{n} lessons at their target"
              + ("" if not bad else "\n    " + "\n    ".join(bad)))

    if args.commit:
        conn.commit()
        print("\nCOMMITTED.")
    else:
        conn.rollback()
        print("\nDRY RUN — rolled back. Re-run with --commit to keep it.")
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
