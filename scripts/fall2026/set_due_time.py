#!/usr/bin/env python
"""Move every deadline in one course to a single wall-clock time, keeping its local date.

WHY
    The deadline TIME is course policy, not a system constant. Physics 215's course directors set
    it to 1759 (2026-07-29) — before the duty day ends rather than late at night — and the term had
    a mix: 5 assignments at 1759 and 32 at 2359, which is the residue of a since-fixed editor bug
    that stored a naive "23:59:59" as UTC (faculty-lessons.js `endOfDay`, 2026-07-27). Whatever the
    provenance, one course now wants one time.

    Physics 110 is a different course with a different director and is NOT touched. That is why
    this takes --course rather than doing "all deadlines everywhere".

WHAT IT REWRITES  (three places, and all three or none)
    A deadline is stored in three places that must agree, or the UI silently undoes the change:
      1. `assignment_due_dates.due_at`      — the per-section deadline actually enforced
      2. `assignment_offerings.due_at`      — the fallback for a section with no row
      3. `assignment_offerings.due_by_day`  — the jsonb the LESSON EDITOR reloads into its date and
                                              time boxes. Leave this at 2359 and the next director
                                              to open the lesson sees 23:59 in the time box and
                                              writes it straight back on save.

THE RULE
    Keep the LOCAL date; set the local time. `x AT TIME ZONE tz` converts to that zone's wall
    clock, `date_trunc('day', …)` takes its date, and converting back is DST-aware — which matters
    here, because this term spans the November change and a fixed UTC offset would move the
    November and December deadlines by an hour.

IDEMPOTENT: a deadline already at the target time is not rewritten, and a second run reports zero
changes. Runs as the DML tier — data only, no DDL. Dry-run by default (CORE.md §4).

Usage:
  .venv/Scripts/python scripts/fall2026/set_due_time.py --course phys-215 --time 17:59:59
  .venv/Scripts/python scripts/fall2026/set_due_time.py --course phys-215 --time 17:59:59 --commit
"""

import argparse
import json
import re
import sys
from datetime import timezone
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
TZ = "America/Denver"


def connect(env, role="DML"):
    return psycopg2.connect(
        user=f'{env[f"PREP_APP_{role}_ROLE"]}.{env["PREP_PROJECT_REF"]}',
        password=env[f"PREP_APP_{role}_PASSWORD"],
        host=env["PREP_DB_HOST"], port=env.get("PREP_DB_PORT", "5432"),
        dbname=env.get("PREP_DB_NAME", "postgres"),
        sslmode=env.get("PREP_DB_SSLMODE", "require"),
        cursor_factory=RealDictCursor,
    )


# `x AT TIME ZONE tz` -> local wall clock; truncate to the day; add the target time; convert back.
# Written once and reused, because the two tables and the read-back must not drift apart.
RETIME = ("((date_trunc('day', {col} AT TIME ZONE %(tz)s) + %(off)s::interval) AT TIME ZONE %(tz)s)")


def offerings(cur, course, term=None):
    cur.execute("""
        SELECT co.id, t.code AS term
          FROM app.course_offerings co
          JOIN app.courses c ON c.id = co.course_id
          JOIN app.terms   t ON t.id = co.term_id
         WHERE c.code = %s AND (%s IS NULL OR t.code = %s)
         ORDER BY t.code
    """, (course, term, term))
    return cur.fetchall()


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--course", default="phys-215", help="course CODE — only this course is touched")
    ap.add_argument("--term", default=None, help="one term code; default is every term of the course")
    ap.add_argument("--time", default="17:59:59", help="local wall-clock deadline, HH:MM:SS")
    ap.add_argument("--commit", action="store_true", help="write; otherwise everything rolls back")
    args = ap.parse_args()

    if not re.fullmatch(r"\d{2}:\d{2}:\d{2}", args.time):
        sys.exit(f"--time must be HH:MM:SS, got {args.time!r}")
    P = {"tz": TZ, "off": args.time}

    env = read_env(ENV_FILE)
    conn = connect(env)
    cur = conn.cursor()
    cur.execute("SET TIME ZONE %s", (TZ,))

    offs = offerings(cur, args.course, args.term)
    if not offs:
        sys.exit(f"No course offering for {args.course}" + (f" / {args.term}" if args.term else ""))
    ids = [o["id"] for o in offs]
    print(f"course {args.course} · target {args.time} {TZ}")
    for o in offs:
        print(f"  offering {o['term']:22s} {o['id']}")

    # ── Before ──────────────────────────────────────────────────────────────────────────────
    print("\n=== before — local time-of-day ===")
    for label, sql in (
        ("assignment_due_dates", """
            SELECT to_char(d.due_at, 'HH24:MI:SS') AS t, count(*) AS n
              FROM app.assignment_due_dates d
              JOIN app.assignment_offerings ao ON ao.id = d.assignment_offering_id
             WHERE ao.course_offering_id = ANY(%(ids)s::uuid[]) GROUP BY 1 ORDER BY 1"""),
        ("assignment_offerings", """
            SELECT to_char(ao.due_at, 'HH24:MI:SS') AS t, count(*) AS n
              FROM app.assignment_offerings ao
             WHERE ao.course_offering_id = ANY(%(ids)s::uuid[]) AND ao.due_at IS NOT NULL
             GROUP BY 1 ORDER BY 1"""),
    ):
        cur.execute(sql, {"ids": [str(i) for i in ids]})
        print(f"  {label:22s} " + ", ".join(f"{r['t']}×{r['n']}" for r in cur.fetchall()))

    # A worked example, so the date-preservation is visible rather than asserted.
    cur.execute("""
        SELECT asg.slug, s.code, d.due_at AS before,
               """ + RETIME.format(col="d.due_at") + """ AS after
          FROM app.assignment_due_dates d
          JOIN app.assignment_offerings ao ON ao.id = d.assignment_offering_id
          JOIN app.assignments asg ON asg.id = ao.assignment_id
          JOIN app.sections s ON s.id = d.section_id
         WHERE ao.course_offering_id = ANY(%(ids)s::uuid[]) AND d.due_at <> """
         + RETIME.format(col="d.due_at") + """
         ORDER BY ao.position, s.code LIMIT 4
    """, {**P, "ids": [str(i) for i in ids]})
    print("\n=== worked examples (local) ===")
    for r in cur.fetchall():
        print(f"  {r['slug']:24s} {r['code']:5s} "
              f"{r['before'].strftime('%a %Y-%m-%d %H:%M:%S')} -> {r['after'].strftime('%a %Y-%m-%d %H:%M:%S')}")

    # ── Write 1 & 2: the two timestamptz columns ────────────────────────────────────────────
    # `WHERE due_at <> <retimed>` is what makes this idempotent — a row already on the target is
    # not written, so a second run reports 0 and touches nothing.
    cur.execute("""
        UPDATE app.assignment_due_dates d
           SET due_at = """ + RETIME.format(col="d.due_at") + """
          FROM app.assignment_offerings ao
         WHERE ao.id = d.assignment_offering_id
           AND ao.course_offering_id = ANY(%(ids)s::uuid[])
           AND d.due_at <> """ + RETIME.format(col="d.due_at"),
        {**P, "ids": [str(i) for i in ids]})
    n_sec = cur.rowcount

    cur.execute("""
        UPDATE app.assignment_offerings ao
           SET due_at = """ + RETIME.format(col="ao.due_at") + """
         WHERE ao.course_offering_id = ANY(%(ids)s::uuid[])
           AND ao.due_at IS NOT NULL
           AND ao.due_at <> """ + RETIME.format(col="ao.due_at"),
        {**P, "ids": [str(i) for i in ids]})
    n_off = cur.rowcount

    # ── Write 3: due_by_day, whose values are ISO strings inside jsonb ──────────────────────
    # Done in Python rather than SQL: the column is a free-shape jsonb map of day letter -> ISO
    # string, and rebuilding it here keeps the emitted format identical to what the editor writes
    # (`Date.toISOString()`, i.e. '…T23:59:59.000Z'), so a value this script produces and a value
    # the editor produces are byte-identical and neither looks like a foreign write.
    cur.execute("""
        SELECT ao.id, asg.slug, ao.due_by_day
          FROM app.assignment_offerings ao
          JOIN app.assignments asg ON asg.id = ao.assignment_id
         WHERE ao.course_offering_id = ANY(%(ids)s::uuid[])
           AND ao.due_by_day IS NOT NULL AND ao.due_by_day::text <> '{}'
    """, {"ids": [str(i) for i in ids]})
    dbd_rows = cur.fetchall()

    updates = []
    for r in dbd_rows:
        out, changed = {}, False
        for day, iso in (r["due_by_day"] or {}).items():
            if not iso:
                out[day] = iso
                continue
            # Ask the database to do the zone arithmetic — one authority for DST, not two, and the
            # same expression the two timestamptz columns just used.
            cur.execute(
                "SELECT (date_trunc('day', %(iso)s::timestamptz AT TIME ZONE %(tz)s)"
                "        + %(off)s::interval) AT TIME ZONE %(tz)s AS v",
                {"iso": iso, "tz": TZ, "off": args.time})
            iso_out = cur.fetchone()["v"].astimezone(timezone.utc) \
                         .strftime("%Y-%m-%dT%H:%M:%S.000Z")
            out[day] = iso_out
            if iso_out != iso:
                changed = True
        if changed:
            updates.append((r["id"], json.dumps(out)))

    if updates:
        execute_values(cur, """
            UPDATE app.assignment_offerings ao
               SET due_by_day = v.dbd::jsonb
              FROM (VALUES %s) AS v(id, dbd)
             WHERE ao.id = v.id::uuid
        """, updates)
    n_dbd = len(updates)

    print(f"\nrewrote: {n_sec} per-section rows · {n_off} offering fallbacks · {n_dbd} due_by_day maps")

    # ── Verify inside the transaction ───────────────────────────────────────────────────────
    cur.execute("""
        SELECT to_char(d.due_at, 'HH24:MI:SS') AS t, count(*) AS n
          FROM app.assignment_due_dates d
          JOIN app.assignment_offerings ao ON ao.id = d.assignment_offering_id
         WHERE ao.course_offering_id = ANY(%(ids)s::uuid[]) GROUP BY 1 ORDER BY 1
    """, {"ids": [str(i) for i in ids]})
    after_sec = {r["t"]: r["n"] for r in cur.fetchall()}
    cur.execute("""
        SELECT to_char(ao.due_at, 'HH24:MI:SS') AS t, count(*) AS n
          FROM app.assignment_offerings ao
         WHERE ao.course_offering_id = ANY(%(ids)s::uuid[]) AND ao.due_at IS NOT NULL
         GROUP BY 1 ORDER BY 1
    """, {"ids": [str(i) for i in ids]})
    after_off = {r["t"]: r["n"] for r in cur.fetchall()}

    cur.execute("""
        SELECT count(*) AS n FROM app.assignment_offerings ao,
               jsonb_each_text(ao.due_by_day) AS kv(day, iso)
         WHERE ao.course_offering_id = ANY(%(ids)s::uuid[])
           AND to_char(kv.iso::timestamptz, 'HH24:MI:SS') <> %(hhmmss)s
    """, {"ids": [str(i) for i in ids], "hhmmss": args.time})
    dbd_bad = cur.fetchone()["n"]

    print("\n=== after ===")
    print(f"  assignment_due_dates   " + ", ".join(f"{k}×{v}" for k, v in after_sec.items()))
    print(f"  assignment_offerings   " + ", ".join(f"{k}×{v}" for k, v in after_off.items()))
    print(f"  due_by_day entries off target: {dbd_bad}")

    off_target = ([k for k in after_sec if k != args.time]
                  + [k for k in after_off if k != args.time])
    if off_target or dbd_bad:
        conn.rollback()
        sys.exit(f"REFUSING: {off_target or ''} still off target, {dbd_bad} jsonb entries wrong "
                 "— rolled back.")

    if args.commit:
        conn.commit()
        print("\nCOMMITTED.")
    else:
        conn.rollback()
        print("\nDRY RUN — rolled back. Re-run with --commit to keep it.")
    conn.close()


if __name__ == "__main__":
    main()
