#!/usr/bin/env python
"""Give the real phys-215 Fall 2026 offering its OWN content, so no term shares a lesson.

WHY
    `activities` (the content) hangs off `assignments` (the term-free container), not off one
    term's `assignment_offerings`. So when split_training_offering.py created the clean Fall 2026
    offering on 2026-07-27 it copied 37 assignment_offerings and 42 offering_activities pointing at
    the SAME shared activities -- deliberately, and its header says so.

    Three consequences, all live until this runs:
      * editing a lesson in Fall 2026 silently rewrites the training sandbox's questions
      * replacing an interaction deletes the other term's student reports (211 of them hang off
        shared rows) -- or, since the guard landed, is refused, so the lesson cannot be fixed at all
      * `activities_write` is scoped by COURSE, so a director of either term can write both

    Full record, including what was rejected: docs/decisions/PER-OFFERING-CONTENT-ISOLATION.md.

WHAT IT DOES  (one transaction; --commit or it all rolls back)
    1. Renames the SANDBOX's shared containers, `preflight-NN` -> `preflight-NN-training`. The
       disposable training data gets the ugly slugs and the real term keeps the clean ones, which
       is the right way round -- `/preflight-analyze phys-215 preflight-02 M` is typed by humans
       against the real term. This is what makes the copy possible without DDL:
       `assignments_slug_unique (course_id, slug)` forbids two `preflight-02` rows in phys-215.
    2. Deep-copies each container for the real offering: a new `assignments` row carrying the clean
       slug, and a new `activities` row carrying the WRITTEN content with a freshly minted slug.
    3. Recreates the real offering's assignment_offerings against the copies, preserving points,
       deadline, per-day schedule, publish state and position exactly -- and restoring the
       per-section due dates, which cascade with the rows they hang off.

WHAT IT DELIBERATELY DOES NOT DO
    * It does not copy INTERACTIVE activities. An artifact posts to one `#i=` slug, that slug is
      globally unique and frozen, and the deployed artifacts post to the ones the sandbox now owns.
      Each interactive lesson the real term wants needs a REBUILT artifact with a fresh contract
      §3.2 slug, added by the director afterwards. Where the interaction was the lesson's only
      GRADED activity, the written activity is promoted to `graded` so the lesson is still worth
      points -- otherwise dropping it would leave a published lesson nothing could score.
    * It does not touch the sandbox's offering, sections, enrolments, submissions, grades or
      reports. Its 211 submissions keep pointing at the activities they were made against, which
      is why the REAL offering is the side that moves: it is the one with no student work.
    * It does not touch the real offering's sections, enrolments or staff. Deleting and re-creating
      the course offering would have cost 17 sections, 375 enrolments and 27 staff rows to
      accomplish exactly the same content change.

PRECONDITIONS, CHECKED NOT ASSUMED
    * the real offering has ZERO submissions and ZERO grades (the whole approach rests on it)
    * every lesson being processed has a written activity (or dropping the interaction would
      empty it)

Runs as the DML tier -- data only, no DDL, and no unseal needed. Dry-run by default (CORE.md §4):
it does the whole thing, verifies it, prints what happened, and rolls back unless --commit.

Usage:
  .venv/Scripts/python scripts/fall2026/isolate_offering_content.py
  .venv/Scripts/python scripts/fall2026/isolate_offering_content.py --commit
"""

import argparse
import json
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "supabase" / "admin"))
import psycopg2  # noqa: E402
from psycopg2.extras import RealDictCursor, Json  # noqa: E402
from app_tier_check import read_env  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
ENV = REPO / "supabase" / "admin" / ".env"

COURSE_CODE = "phys-215"
REAL_TERM = "fall-2026"
SANDBOX_TERM = "training-fall-2026"
SANDBOX_SUFFIX = "-training"

# Columns carried verbatim from the old assignment_offering to its replacement. `assignment_id`
# is the ONE that changes -- that is the entire point of the run.
AO_CARRY = ["points_possible", "grading_mode", "switch_policy", "opens_at", "due_at",
            "due_by_day", "is_published", "content_snapshot", "position"]


def mint_written_slug(course_code, assignment_slug):
    """The same rule as mintWrittenSlug() in site/js/faculty-lessons.js.

    Two copies of one rule, in two languages, because a Python script and a browser module share
    no import path. The SHAPE is what matters and it is asserted on both sides:
    `<course>-<slug>-written-<8 hex>`.
    """
    return f"{course_code}-{assignment_slug}-written-{secrets.token_hex(4)}"


def connect(env, role="DML"):
    return psycopg2.connect(
        user=f'{env[f"PREP_APP_{role}_ROLE"]}.{env["PREP_PROJECT_REF"]}',
        password=env[f"PREP_APP_{role}_PASSWORD"],
        host=env["PREP_DB_HOST"], port=env.get("PREP_DB_PORT", "5432"),
        dbname=env.get("PREP_DB_NAME", "postgres"),
        sslmode=env.get("PREP_DB_SSLMODE", "require"),
        cursor_factory=RealDictCursor,
    )


def offering_of(cur, course_code, term_code):
    cur.execute("""
        SELECT co.id FROM app.course_offerings co
          JOIN app.courses c ON c.id = co.course_id
          JOIN app.terms   t ON t.id = co.term_id
         WHERE c.code = %s AND t.code = %s
    """, (course_code, term_code))
    row = cur.fetchone()
    return row["id"] if row else None


def snapshot(cur, real_id, sandbox_id, out_dir):
    """Everything the run could disturb, as JSON, before it disturbs any of it.

    CORE.md §0 requires this before a destructive op, and the delete in step 3 qualifies: the
    assignment_offerings rows go, taking their offering_activities and assignment_due_dates with
    them. This file plus the mapping written beside it is what makes the change reversible without
    a database backup.
    """
    out = {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "real_offering": real_id,
        "sandbox_offering": sandbox_id,
    }
    for name, sql, arg in [
        ("real_assignment_offerings",
         "SELECT * FROM app.assignment_offerings WHERE course_offering_id=%s ORDER BY position", real_id),
        ("real_offering_activities",
         "SELECT oa.* FROM app.offering_activities oa "
         "JOIN app.assignment_offerings ao ON ao.id = oa.assignment_offering_id "
         "WHERE ao.course_offering_id=%s", real_id),
        ("real_due_dates",
         "SELECT d.* FROM app.assignment_due_dates d "
         "JOIN app.assignment_offerings ao ON ao.id = d.assignment_offering_id "
         "WHERE ao.course_offering_id=%s", real_id),
        ("shared_assignments",
         "SELECT a.* FROM app.assignments a WHERE a.id IN "
         "(SELECT assignment_id FROM app.assignment_offerings WHERE course_offering_id=%s)", real_id),
        ("shared_activities",
         "SELECT act.id, act.assignment_id, act.slug, act.modality, act.title, act.position "
         "FROM app.activities act WHERE act.assignment_id IN "
         "(SELECT assignment_id FROM app.assignment_offerings WHERE course_offering_id=%s)", real_id),
    ]:
        cur.execute(sql, (arg,))
        out[name] = [dict(r) for r in cur.fetchall()]

    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"isolate-content-snapshot-{real_id[:8]}.json"
    path.write_text(json.dumps(out, indent=2, default=str), encoding="utf-8")
    return path


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--commit", action="store_true", help="actually write; otherwise roll back")
    ap.add_argument("--snapshot-dir", default=None, help="default: repo _snapshots/")
    args = ap.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    env = read_env(ENV)
    conn = connect(env)
    conn.autocommit = False
    cur = conn.cursor()
    plan, warnings = [], []

    try:
        cur.execute("SELECT id, code FROM app.courses WHERE code=%s", (COURSE_CODE,))
        course = cur.fetchone()
        if not course:
            sys.exit(f"no course {COURSE_CODE}")
        course_id = course["id"]

        real_id = offering_of(cur, COURSE_CODE, REAL_TERM)
        sandbox_id = offering_of(cur, COURSE_CODE, SANDBOX_TERM)
        if not real_id:
            sys.exit(f"no {COURSE_CODE} offering in {REAL_TERM}")
        if not sandbox_id:
            sys.exit(f"no {COURSE_CODE} offering in {SANDBOX_TERM} — nothing is shared; stop.")
        plan.append(f"real offering    {real_id}  ({COURSE_CODE} x {REAL_TERM})")
        plan.append(f"sandbox offering {sandbox_id}  ({COURSE_CODE} x {SANDBOX_TERM})")

        # ── PRECONDITION: no student work in the real offering ───────────────────────────────
        # The whole approach rests on this. With submissions present, deleting the
        # assignment_offerings would cascade student work away and the lock trigger would refuse
        # the choice-clearing besides. Refuse loudly rather than half-run.
        cur.execute("""
            SELECT (SELECT count(*) FROM app.submissions s
                      JOIN app.assignment_offerings ao ON ao.id = s.assignment_offering_id
                     WHERE ao.course_offering_id=%s) AS submissions,
                   (SELECT count(*) FROM app.grades g
                      JOIN app.assignment_offerings ao ON ao.id = g.assignment_offering_id
                     WHERE ao.course_offering_id=%s) AS grades
        """, (real_id, real_id))
        work = cur.fetchone()
        if work["submissions"] or work["grades"]:
            sys.exit(f"REFUSED — the real offering holds {work['submissions']} submission(s) and "
                     f"{work['grades']} grade(s). This script may only run on an offering with no "
                     f"student work; see the decision doc before going further.")
        plan.append("precondition: real offering holds 0 submissions and 0 grades  [ok]")

        # ── What is actually shared? ─────────────────────────────────────────────────────────
        cur.execute("""
            SELECT ao.id AS ao_id, ao.assignment_id, a.slug, a.title, a.description, a.kind_id,
                   a.objectives, ao.position
              FROM app.assignment_offerings ao
              JOIN app.assignments a ON a.id = ao.assignment_id
             WHERE ao.course_offering_id = %s
               AND EXISTS (SELECT 1 FROM app.assignment_offerings other
                            WHERE other.assignment_id = ao.assignment_id
                              AND other.course_offering_id <> %s)
             ORDER BY ao.position NULLS LAST, a.slug
        """, (real_id, real_id))
        shared = cur.fetchall()
        if not shared:
            print("Already isolated — the real offering shares no container with another term.")
            return
        plan.append(f"{len(shared)} shared container(s) to copy")

        snap_dir = Path(args.snapshot_dir) if args.snapshot_dir else REPO / "_snapshots"
        snap_path = snapshot(cur, real_id, sandbox_id, snap_dir)
        plan.append(f"snapshot -> {snap_path}")

        # Capture what hangs off each shared assignment_offering BEFORE anything is deleted.
        ao_ids = [r["ao_id"] for r in shared]
        cur.execute(f"SELECT * FROM app.assignment_offerings WHERE id = ANY(%s::uuid[])", (ao_ids,))
        ao_rows = {r["id"]: dict(r) for r in cur.fetchall()}

        cur.execute("""
            SELECT oa.*, act.modality, act.slug AS activity_slug, act.title AS activity_title,
                   act.content, act.position AS activity_position
              FROM app.offering_activities oa
              JOIN app.activities act ON act.id = oa.activity_id
             WHERE oa.assignment_offering_id = ANY(%s::uuid[])
        """, (ao_ids,))
        oa_by_ao = {}
        for r in cur.fetchall():
            oa_by_ao.setdefault(r["assignment_offering_id"], []).append(dict(r))

        cur.execute("SELECT * FROM app.assignment_due_dates WHERE assignment_offering_id = ANY(%s::uuid[])",
                    (ao_ids,))
        due_by_ao = {}
        for r in cur.fetchall():
            due_by_ao.setdefault(r["assignment_offering_id"], []).append(dict(r))

        # ── PRECONDITION: nothing is left empty by dropping its interaction ──────────────────
        empty = [r["slug"] for r in shared
                 if not any(a["modality"] == "written" for a in oa_by_ao.get(r["ao_id"], []))]
        if empty:
            sys.exit("REFUSED — these lessons have no written activity, so dropping their "
                     "interaction would leave them with nothing at all: " + ", ".join(empty))
        plan.append("precondition: every shared lesson has a written activity  [ok]")

        # ── 1. rename the sandbox's containers, freeing the clean slugs ──────────────────────
        renamed = 0
        for r in shared:
            new_slug = r["slug"] + SANDBOX_SUFFIX
            cur.execute("UPDATE app.assignments SET slug=%s, updated_at=now() WHERE id=%s",
                        (new_slug, r["assignment_id"]))
            renamed += cur.rowcount
        plan.append(f"renamed {renamed} sandbox container(s): <slug> -> <slug>{SANDBOX_SUFFIX}")

        # ── 2. deep-copy each container + its written activity ───────────────────────────────
        mapping = []
        for r in shared:
            cur.execute("""
                INSERT INTO app.assignments (course_id, kind_id, slug, title, description, objectives)
                VALUES (%s, %s, %s, %s, %s, %s) RETURNING id
            """, (course_id, r["kind_id"], r["slug"], r["title"], r["description"],
                  Json(r["objectives"] or [])))
            new_assignment = cur.fetchone()["id"]

            written = next(a for a in oa_by_ao[r["ao_id"]] if a["modality"] == "written")
            new_activity_slug = mint_written_slug(COURSE_CODE, r["slug"])
            cur.execute("""
                INSERT INTO app.activities (assignment_id, modality, slug, title, content, position)
                VALUES (%s, 'written', %s, %s, %s, %s) RETURNING id
            """, (new_assignment, new_activity_slug, written["activity_title"],
                  Json(written["content"] or {}), written["activity_position"]))
            new_activity = cur.fetchone()["id"]

            dropped = [a for a in oa_by_ao[r["ao_id"]] if a["modality"] == "interactive"]
            # The interaction was carrying the credit, so the questions must now carry it, or the
            # lesson is published with nothing gradable on it.
            promoted = any(a["grading_role"] == "graded" for a in dropped)
            written_role = "graded" if promoted else written["grading_role"]

            mapping.append({
                "slug": r["slug"],
                "old_assignment_id": r["assignment_id"],
                "new_assignment_id": new_assignment,
                "sandbox_slug": r["slug"] + SANDBOX_SUFFIX,
                "old_written_activity": written["activity_id"],
                "new_written_activity": new_activity,
                "new_written_slug": new_activity_slug,
                "written_role": written_role,
                "written_role_promoted": promoted,
                "dropped_interactive": [{"slug": a["activity_slug"], "role": a["grading_role"]}
                                        for a in dropped],
                "old_ao_id": r["ao_id"],
            })
            if promoted:
                warnings.append(
                    f"{r['slug']}: its interaction was the GRADED activity — the written questions "
                    f"were promoted to graded so the lesson still scores")
            for a in dropped:
                warnings.append(f"{r['slug']}: dropped interaction '{a['activity_slug']}' "
                                f"({a['grading_role']}) — needs a rebuilt artifact + new slug")

        plan.append(f"copied {len(mapping)} container(s) + {len(mapping)} written activity(ies), "
                    f"each with a freshly minted slug")

        # ── 3. recreate the offering rows against the copies ─────────────────────────────────
        # Delete first: assignment_offerings_unique is (course_offering_id, assignment_id), and the
        # cascade takes offering_activities and assignment_due_dates with it — both captured above.
        cur.execute("DELETE FROM app.assignment_offerings WHERE id = ANY(%s::uuid[])", (ao_ids,))
        plan.append(f"deleted {cur.rowcount} old assignment_offering(s) "
                    f"(no student work — precondition above)")

        carried, oa_made, due_made = 0, 0, 0
        for m in mapping:
            old = ao_rows[m["old_ao_id"]]
            cols = ", ".join(AO_CARRY)
            placeholders = ", ".join(["%s"] * len(AO_CARRY))
            cur.execute(f"""
                INSERT INTO app.assignment_offerings (course_offering_id, assignment_id, {cols})
                VALUES (%s, %s, {placeholders}) RETURNING id
            """, (real_id, m["new_assignment_id"],
                  *[Json(old[c]) if c in ("due_by_day", "content_snapshot") and old[c] is not None
                    else old[c] for c in AO_CARRY]))
            new_ao = cur.fetchone()["id"]
            m["new_ao_id"] = new_ao
            carried += 1

            old_written = next(a for a in oa_by_ao[m["old_ao_id"]] if a["modality"] == "written")
            cur.execute("""
                INSERT INTO app.offering_activities
                    (assignment_offering_id, activity_id, grading_role, available_after,
                     is_visible, position)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (new_ao, m["new_written_activity"], m["written_role"],
                  old_written["available_after"], old_written["is_visible"],
                  old_written["position"]))
            oa_made += 1

            for d in due_by_ao.get(m["old_ao_id"], []):
                cur.execute("""
                    INSERT INTO app.assignment_due_dates (assignment_offering_id, section_id, due_at)
                    VALUES (%s, %s, %s)
                """, (new_ao, d["section_id"], d["due_at"]))
                due_made += 1

        plan.append(f"recreated {carried} assignment_offering(s), {oa_made} offering_activity(ies), "
                    f"{due_made} per-section due date(s)")

        # ── verification, inside the transaction, before deciding to keep it ─────────────────
        checks = []

        cur.execute("SELECT count(*) AS n FROM app.assignment_offerings WHERE course_offering_id=%s",
                    (real_id,))
        checks.append(("the real offering still schedules every lesson",
                       cur.fetchone()["n"] == len(ao_rows), "count changed"))

        cur.execute("""
            SELECT count(*) AS n FROM app.assignment_offerings
             WHERE course_offering_id=%s AND is_published
        """, (real_id,))
        was_published = sum(1 for r in ao_rows.values() if r["is_published"])
        checks.append(("publish state preserved", cur.fetchone()["n"] == was_published,
                       f"expected {was_published}"))

        cur.execute("""
            SELECT count(*) AS n FROM app.assignment_due_dates d
              JOIN app.assignment_offerings ao ON ao.id = d.assignment_offering_id
             WHERE ao.course_offering_id=%s
        """, (real_id,))
        want_due = sum(len(v) for v in due_by_ao.values())
        checks.append(("per-section due dates restored", cur.fetchone()["n"] == want_due,
                       f"expected {want_due}"))

        # THE INVARIANT this whole run exists for.
        cur.execute("""
            SELECT count(*) AS n FROM app.offering_activities oa
             WHERE oa.assignment_offering_id IN
                   (SELECT id FROM app.assignment_offerings WHERE course_offering_id=%s)
               AND oa.activity_id IN
                   (SELECT activity_id FROM app.offering_activities oa2
                      JOIN app.assignment_offerings ao2 ON ao2.id = oa2.assignment_offering_id
                     WHERE ao2.course_offering_id <> %s)
        """, (real_id, real_id))
        checks.append(("NO activity is shared with another offering", cur.fetchone()["n"] == 0,
                       "shared activities remain"))

        cur.execute("""
            SELECT count(*) AS n FROM app.assignment_offerings ao
             WHERE ao.course_offering_id=%s
               AND ao.assignment_id IN (SELECT assignment_id FROM app.assignment_offerings
                                         WHERE course_offering_id <> %s)
        """, (real_id, real_id))
        checks.append(("NO container is shared with another offering", cur.fetchone()["n"] == 0,
                       "shared containers remain"))

        cur.execute("""
            SELECT count(*) AS n FROM app.assignment_offerings ao
             WHERE ao.course_offering_id=%s
               AND NOT EXISTS (SELECT 1 FROM app.offering_activities oa
                                WHERE oa.assignment_offering_id = ao.id
                                  AND oa.grading_role = 'graded')
        """, (real_id,))
        checks.append(("every lesson still has something GRADED", cur.fetchone()["n"] == 0,
                       "a lesson lost its graded activity"))

        # The sandbox must be exactly as it was.
        cur.execute("""
            SELECT (SELECT count(*) FROM app.assignment_offerings WHERE course_offering_id=%s) AS aos,
                   (SELECT count(*) FROM app.submissions s
                      JOIN app.assignment_offerings ao ON ao.id=s.assignment_offering_id
                     WHERE ao.course_offering_id=%s) AS subs,
                   (SELECT count(*) FROM app.grades g
                      JOIN app.assignment_offerings ao ON ao.id=g.assignment_offering_id
                     WHERE ao.course_offering_id=%s) AS grades
        """, (sandbox_id, sandbox_id, sandbox_id))
        sb = cur.fetchone()
        checks.append(("sandbox keeps its 37 lessons", sb["aos"] == 37, f"found {sb['aos']}"))
        checks.append(("sandbox keeps its 211 submissions", sb["subs"] == 211, f"found {sb['subs']}"))
        checks.append(("sandbox keeps its 211 grades", sb["grades"] == 211, f"found {sb['grades']}"))

        cur.execute("""
            SELECT count(*) AS n FROM app.submission_activities sa
             WHERE sa.activity_id IN (SELECT id FROM app.activities)
        """)
        checks.append(("every student report still resolves to an activity",
                       cur.fetchone()["n"] == 211, "a report lost its activity"))

        # The real offering's sections, enrolments and staff were never in scope — prove it.
        cur.execute("""
            SELECT (SELECT count(*) FROM app.sections WHERE course_offering_id=%s) AS sections,
                   (SELECT count(*) FROM app.enrollments e JOIN app.sections s ON s.id=e.section_id
                     WHERE s.course_offering_id=%s) AS enrollments,
                   (SELECT count(*) FROM app.staff_assignments WHERE course_offering_id=%s) AS staff
        """, (real_id, real_id, real_id))
        keep = cur.fetchone()
        checks.append(("real offering keeps 17 sections", keep["sections"] == 17, str(keep)))
        checks.append(("real offering keeps 375 enrolments", keep["enrollments"] == 375, str(keep)))
        checks.append(("real offering keeps 27 staff rows", keep["staff"] == 27, str(keep)))

        # ── report ──────────────────────────────────────────────────────────────────────────
        print("\n".join(f"  - {p}" for p in plan))
        if warnings:
            print("\nconsequences the director must act on:")
            for w in sorted(set(warnings)):
                print(f"  ! {w}")

        print("\nverification:")
        ok = True
        for desc, passed, detail in checks:
            print(f"  {'[ok]  ' if passed else '[FAIL]'} {desc}" + ("" if passed else f" — {detail}"))
            ok = ok and passed

        if not ok:
            conn.rollback()
            sys.exit("\nVERIFICATION FAILED — rolled back, nothing written.")

        if args.commit:
            map_path = snap_path.with_name(snap_path.name.replace("snapshot", "mapping"))
            map_path.write_text(json.dumps(mapping, indent=2, default=str), encoding="utf-8")
            conn.commit()
            print(f"\nCOMMITTED. Lineage mapping -> {map_path}")
            print("Next: verify with supabase/admin/content_isolation_check.py, then re-add the "
                  "interactions as rebuilt artifacts with fresh contract §3.2 slugs.")
        else:
            conn.rollback()
            print("\nDRY RUN — everything above was executed, verified, and rolled back. "
                  "Re-run with --commit to keep it.")

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
