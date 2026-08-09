#!/usr/bin/env python
"""Set every Fall 2026 preflight's real M-day AND T-day deadline, for one course.

One mechanism, one schedule table per course (`SCHEDULES` below). A course is added by
transcribing its syllabus into a new entry — never by forking this file.

WHY, phys-110 (repaired 2026-08-09)
    36 of the 37 phys-110 offerings carried an EMPTY `due_by_day` (`{}`), so they had no per-day
    schedule at all. Precedence is  extension > assignment_due_dates > due_by_day > due_at
    (site/js/db-schema.js), and `{}` means "due_at applies to everyone" — so all twelve T-day
    sections inherited the M-day deadline and were due one to four days early. `preflight-02` was
    the single exception: it had been saved through the lesson editor and had both the per-day map
    and its 21 materialized per-section rows. The M-day dates were already correct, so that run
    moved no deadline earlier — it only added the T track that was never written.

WHY, phys-215 (repaired 2026-08-09)
    A different fault with the same repair. Every phys-215 offering already had a populated
    `due_by_day` and its 17 per-section rows, but FIVE of them — preflight-02, 03, 04, 05 and 07 —
    sat exactly ONE DAY LATE on both tracks, in all three storage locations. The other 32 were
    correct, so this was never a systematic build error; it looks like hand editing.

    One day late is not a cosmetic error here: an M-day preflight due the night before the T-day
    meeting is due AFTER its own M-day lesson has been taught, which is the one thing a preflight
    must not be. Unlike the phys-110 run, this one moves deadlines EARLIER — see the guard on
    `--only` and read the plan before committing.

SOURCE OF TRUTH
    Each course's own syllabus schedule table, naming each lesson's M-day and T-day MEETING date:
      phys-110  Table 1, pp. 9-10, `Physics_110_Fall_2026_Syllabus (4Aug2026)_8639.pdf`
      phys-215  the schedule table, p. 11, `Physics_215__Fall_2026__Syllabus (2).pdf`
    A preflight is due 2359 the night before ("completed/submitted by 2359 the night before the
    lesson is taught to your section"), so every deadline below is `meeting date - 1 day` at
    23:59:59 America/Denver.

    Both transcriptions are verified against `site/data/academic-calendar.json` (the USAFA academic
    calendar feed, an independent source) — every meeting date is a real teaching day of the
    declared track. Graded Reviews are absent from both tables: they carry no preflight and the
    syllabus gives them no T-day meeting. For phys-110 those are lessons 13/24/36 and they are the
    term's only three disagreements with the academy grid; for phys-215 they are 12/23/35 and they
    sit ON the grid, which is why phys-215's lesson numbers equal the academy's M/T numbers exactly
    and phys-110's do not.

WHAT IT WRITES  (three places, and all three or none)
    A deadline is stored in three places that must agree, or the UI silently undoes the change:
      1. `assignment_offerings.due_by_day`  — the per-day map; the DEFAULT source for a section,
                                              resolved as due_by_day[day] for each of that
                                              section's `meeting_days`. This is the one that is
                                              missing, and the one that makes a section added
                                              later correct with no lesson re-save.
      2. `assignment_due_dates.due_at`      — the materialized per-section row the editor writes
                                              alongside it (faculty-lessons.js `dueDateRows`).
      3. `assignment_offerings.due_at`      — the fallback. Set to the EARLIEST per-day value, as
                                              `defaultDueFrom` does. For this course M is always
                                              earlier than T, so no due_at should change; the run
                                              reports it loudly if one would.

    Timestamps are built in Postgres (`(date + time) AT TIME ZONE 'America/Denver'`) so the term's
    November DST change is handled without depending on a local tz database. The jsonb values are
    rendered in the exact shape the editor writes (`2026-08-10T05:59:59.000Z`, JS toISOString), so
    a lesson opened in the editor afterwards round-trips unchanged.

IDEMPOTENT: a deadline already at its target is not rewritten, and a second run reports zero
changes. Runs as the DML tier — data only, no DDL. Dry-run by default (CORE.md §4).

Usage (Windows: .venv\\Scripts\\python):
  .venv/bin/python scripts/fall2026/set_due_dates.py --course phys-215
  .venv/bin/python scripts/fall2026/set_due_dates.py --course phys-215 --commit
  .venv/bin/python scripts/fall2026/set_due_dates.py --course phys-215 --only preflight-03,preflight-04
"""

import argparse
import json
import sys
from datetime import date, timedelta
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
DUE_TIME = "23:59:59"  # course policy, both courses as of 2026-08-06 (CORE.md §2)
YEAR = 2026

# ── Syllabus schedules: course -> lesson number -> (M-day meeting, T-day meeting) ──────────────
# MEETING dates, not deadlines. Lesson 1 has no preflight ("N" in the Pre-Flt column) and the
# Graded Reviews have neither a preflight nor a T-day meeting; both are absent from every table.
#
# The two courses share the academy's M/T teaching grid but slot their Graded Reviews at different
# lesson numbers, so the lesson -> date mapping diverges between them from lesson 12 to 13 and
# from 23 to 24, and re-converges at 14 and 25. Do not derive one from the other.
SCHEDULES = {}

SCHEDULES["phys-110"] = {  # Graded Reviews at 13 / 24 / 36
    2:  ("Aug 10", "Aug 11"),
    3:  ("Aug 12", "Aug 13"),
    4:  ("Aug 14", "Aug 17"),
    5:  ("Aug 18", "Aug 19"),
    6:  ("Aug 20", "Aug 21"),
    7:  ("Aug 24", "Aug 25"),
    8:  ("Aug 26", "Aug 27"),
    9:  ("Aug 28", "Aug 31"),
    10: ("Sep 1",  "Sep 2"),
    11: ("Sep 3",  "Sep 4"),
    12: ("Sep 8",  "Sep 9"),
    14: ("Sep 15", "Sep 16"),
    15: ("Sep 17", "Sep 21"),
    16: ("Sep 22", "Sep 23"),
    17: ("Sep 24", "Sep 25"),
    18: ("Sep 28", "Sep 29"),
    19: ("Sep 30", "Oct 1"),
    20: ("Oct 2",  "Oct 5"),
    21: ("Oct 6",  "Oct 7"),
    22: ("Oct 8",  "Oct 9"),
    23: ("Oct 13", "Oct 14"),
    25: ("Oct 19", "Oct 20"),
    26: ("Oct 21", "Oct 22"),
    27: ("Oct 23", "Oct 26"),
    28: ("Oct 27", "Oct 28"),
    29: ("Oct 29", "Oct 30"),
    30: ("Nov 2",  "Nov 3"),
    31: ("Nov 4",  "Nov 5"),
    32: ("Nov 6",  "Nov 9"),
    33: ("Nov 10", "Nov 12"),  # T skips Wed Nov 11 (Veterans Day)
    34: ("Nov 13", "Nov 16"),
    35: ("Nov 17", "Nov 18"),
    37: ("Nov 23", "Nov 24"),  # Thanksgiving break falls between L37 and L38
    38: ("Dec 1",  "Dec 2"),
    39: ("Dec 3",  "Dec 4"),
    40: ("Dec 7",  "Dec 8"),
    41: ("Dec 9",  "Dec 10"),
}

SCHEDULES["phys-215"] = {  # Graded Reviews at 12 / 23 / 35
    2:  ("Aug 10", "Aug 11"),
    3:  ("Aug 12", "Aug 13"),
    4:  ("Aug 14", "Aug 17"),
    5:  ("Aug 18", "Aug 19"),
    6:  ("Aug 20", "Aug 21"),
    7:  ("Aug 24", "Aug 25"),
    8:  ("Aug 26", "Aug 27"),
    9:  ("Aug 28", "Aug 31"),
    10: ("Sep 1",  "Sep 2"),
    11: ("Sep 3",  "Sep 4"),
    13: ("Sep 10", "Sep 14"),
    14: ("Sep 15", "Sep 16"),
    15: ("Sep 17", "Sep 21"),
    16: ("Sep 22", "Sep 23"),
    17: ("Sep 24", "Sep 25"),
    18: ("Sep 28", "Sep 29"),
    19: ("Sep 30", "Oct 1"),
    20: ("Oct 2",  "Oct 5"),
    21: ("Oct 6",  "Oct 7"),
    22: ("Oct 8",  "Oct 9"),
    24: ("Oct 15", "Oct 16"),
    25: ("Oct 19", "Oct 20"),
    26: ("Oct 21", "Oct 22"),
    27: ("Oct 23", "Oct 26"),
    28: ("Oct 27", "Oct 28"),
    29: ("Oct 29", "Oct 30"),
    30: ("Nov 2",  "Nov 3"),
    31: ("Nov 4",  "Nov 5"),
    32: ("Nov 6",  "Nov 9"),
    33: ("Nov 10", "Nov 12"),  # T skips Wed Nov 11 (Veterans Day)
    34: ("Nov 13", "Nov 16"),
    36: ("Nov 19", "Nov 20"),
    37: ("Nov 23", "Nov 24"),  # Thanksgiving break falls between L37 and L38
    38: ("Dec 1",  "Dec 2"),
    39: ("Dec 3",  "Dec 4"),
    40: ("Dec 7",  "Dec 8"),
    41: ("Dec 9",  "Dec 10"),
}

MONTHS = {"Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12}


def parse(s):
    mon, day = s.split()
    return date(YEAR, MONTHS[mon], int(day))


def schedule(course):
    """slug -> {'M': 'YYYY-MM-DD', 'T': 'YYYY-MM-DD'} — the night BEFORE each meeting."""
    out = {}
    for n, (m, t) in sorted(SCHEDULES[course].items()):
        out[f"preflight-{n:02d}"] = {
            "M": (parse(m) - timedelta(days=1)).isoformat(),
            "T": (parse(t) - timedelta(days=1)).isoformat(),
        }
    return out


def connect(env, role="DML"):
    return psycopg2.connect(
        user=f'{env[f"PREP_APP_{role}_ROLE"]}.{env["PREP_PROJECT_REF"]}',
        password=env[f"PREP_APP_{role}_PASSWORD"],
        host=env["PREP_DB_HOST"], port=env.get("PREP_DB_PORT", "5432"),
        dbname=env.get("PREP_DB_NAME", "postgres"),
        sslmode=env.get("PREP_DB_SSLMODE", "require"),
        cursor_factory=RealDictCursor,
    )


def resolve(cur, sched):
    """Turn the local dates into the two shapes the DB stores, in ONE round trip so the
    timestamptz and its jsonb string can never disagree about an instant.

    `iso` is rendered the way the lesson editor's `endOfDay` does (JS toISOString,
    '2026-08-10T05:59:59.000Z') so a lesson opened in the editor afterwards round-trips unchanged.
    """
    slugs, days, dates = zip(*[(slug, day, iso)
                               for slug, per in sorted(sched.items())
                               for day, iso in sorted(per.items())])
    cur.execute("""
        SELECT v.slug, v.day,
               (v.d + %(t)s::time) AT TIME ZONE %(tz)s AS ts,
               to_char(((v.d + %(t)s::time) AT TIME ZONE %(tz)s) AT TIME ZONE 'UTC',
                       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS iso
          FROM unnest(%(slugs)s::text[], %(days)s::text[], %(dates)s::date[])
               AS v(slug, day, d)
    """, {"t": DUE_TIME, "tz": TZ,
          "slugs": list(slugs), "days": list(days), "dates": list(dates)})
    out = {}
    for r in cur.fetchall():
        out.setdefault(r["slug"], {})[r["day"]] = (r["ts"], r["iso"])
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--course", required=True, choices=sorted(SCHEDULES),
                    help="course CODE — only this course is touched")
    ap.add_argument("--term", default="fall-2026", help="term CODE")
    ap.add_argument("--only", default="",
                    help="comma-separated slugs; restrict the write to these. Everything else is "
                         "still checked and reported, just not written.")
    ap.add_argument("--commit", action="store_true", help="write; otherwise everything rolls back")
    args = ap.parse_args()

    sched = schedule(args.course)
    only = {s.strip() for s in args.only.split(",") if s.strip()}
    unknown_only = sorted(only - set(sched))
    if unknown_only:
        sys.exit(f"--only names slug(s) not in the {args.course} schedule: {unknown_only}")
    env = read_env(ENV_FILE)
    conn = connect(env)
    cur = conn.cursor()
    cur.execute("SET TIME ZONE %s", (TZ,))

    cur.execute("""
        SELECT co.id FROM app.course_offerings co
          JOIN app.courses c ON c.id = co.course_id
          JOIN app.terms   t ON t.id = co.term_id
         WHERE c.code = %s AND t.code = %s
    """, (args.course, args.term))
    rows = cur.fetchall()
    if len(rows) != 1:
        sys.exit(f"expected 1 course offering for {args.course}/{args.term}, got {len(rows)}")
    co_id = rows[0]["id"]
    print(f"course {args.course} · term {args.term} · offering {co_id}")
    print(f"deadline {DUE_TIME} {TZ}, the night before each meeting · {len(sched)} preflights\n")

    # ── Sections, and the day each one meets ────────────────────────────────────────────────
    cur.execute("""SELECT id, code, meeting_days FROM app.sections
                    WHERE course_offering_id = %s ORDER BY code""", (co_id,))
    sections = cur.fetchall()
    days_used = sorted({d for s in sections for d in (s["meeting_days"] or [])})
    print(f"sections: {len(sections)} across days {days_used}")
    unknown = [d for d in days_used if d not in ("M", "T")]
    if unknown:
        sys.exit(f"sections declare day(s) {unknown} that the syllabus schedule has no dates for")
    for s in sections:
        if len(s["meeting_days"] or []) != 1:
            sys.exit(f"section {s['code']} declares {s['meeting_days']} — expected exactly one day")

    # ── Offerings, matched to the schedule by slug ──────────────────────────────────────────
    cur.execute("""
        SELECT ao.id, a.slug, ao.due_at, ao.due_by_day
          FROM app.assignment_offerings ao
          JOIN app.assignments a ON a.id = ao.assignment_id
         WHERE ao.course_offering_id = %s ORDER BY a.slug
    """, (co_id,))
    offerings = cur.fetchall()
    by_slug = {o["slug"]: o for o in offerings}

    missing = sorted(set(sched) - set(by_slug))
    extra = sorted(set(by_slug) - set(sched))
    if missing:
        sys.exit(f"schedule names {len(missing)} preflight(s) with no offering: {missing}")
    if extra:
        print(f"NOTE: {len(extra)} offering(s) not in the syllabus schedule, left untouched: {extra}")

    resolved = resolve(cur, sched)

    # ── Plan ────────────────────────────────────────────────────────────────────────────────
    print(f"\n{'slug':<15}{'M deadline':<22}{'T deadline':<22}{'due_by_day':<14}due_at")
    n_map = n_due = 0
    off_updates, dbd_updates, sec_rows = [], [], []
    earlier, held = [], []
    for slug in sorted(sched):
        o = by_slug[slug]
        m_ts, m_iso = resolved[slug]["M"]
        t_ts, t_iso = resolved[slug]["T"]
        want_dbd = {"M": m_iso, "T": t_iso}
        want_due = min(m_ts, t_ts)  # defaultDueFrom: the earliest, so nobody's default is late

        have_dbd = o["due_by_day"] or {}
        dbd_state = "ok" if have_dbd == want_dbd else ("ADD" if not have_dbd else "REWRITE")
        due_state = "ok" if o["due_at"] == want_due else f"MOVE {o['due_at']:%b %d}→{want_due:%b %d}"

        # A deadline that moves EARLIER takes time away from students who are working right now.
        # It is sometimes the correct repair — a preflight due after its own lesson is worse — but
        # it is never a detail, so it is counted separately and reported on its own line.
        for track, (ts, _iso) in sorted(resolved[slug].items()):
            was = (have_dbd or {}).get(track)
            if was and _iso < was:
                earlier.append((slug, track, was, _iso))

        skip = only and slug not in only
        if skip and (dbd_state != "ok" or due_state != "ok"):
            held.append(slug)
        if dbd_state != "ok" and not skip:
            n_map += 1
            dbd_updates.append((o["id"], want_dbd))
        if due_state != "ok" and not skip:
            n_due += 1
            off_updates.append((o["id"], want_due))
        if not skip:
            for s in sections:
                sec_rows.append((o["id"], s["id"], resolved[slug][s["meeting_days"][0]][0]))
        print(f"{slug:<15}{m_ts:%a %b %d %H:%M:%S}     {t_ts:%a %b %d %H:%M:%S}     "
              f"{dbd_state:<14}{due_state}{'   [held by --only]' if skip else ''}")

    cur.execute("""SELECT count(*) AS n FROM app.assignment_due_dates d
                     JOIN app.assignment_offerings ao ON ao.id = d.assignment_offering_id
                    WHERE ao.course_offering_id = %s""", (co_id,))
    before_sec = cur.fetchone()["n"]

    print(f"\nplan: due_by_day {n_map} to write · due_at {n_due} to move · "
          f"per-section rows touched {len(sec_rows)} (course holds {before_sec})")
    if held:
        print(f"  --only is holding {len(held)} offering(s) that need a change: {sorted(held)}")
    if earlier:
        print(f"\n  ⚠  {len(earlier)} deadline(s) move EARLIER. Students lose time on these:")
        for slug, track, was, now in earlier:
            mark = "" if (not only or slug in only) else "   [held]"
            print(f"       {slug} {track}: {was} → {now}{mark}")
        print("     Check submissions in flight before committing. A preflight due AFTER its own")
        print("     lesson is the worse error, but that is a judgement for the course director.")

    # ── Write ───────────────────────────────────────────────────────────────────────────────
    if dbd_updates:
        execute_values(cur, """
            UPDATE app.assignment_offerings ao SET due_by_day = v.dbd::jsonb
              FROM (VALUES %s) AS v(id, dbd)
             WHERE ao.id = v.id::uuid
        """, [(str(i), json.dumps(d)) for i, d in dbd_updates])
    if off_updates:
        execute_values(cur, """
            UPDATE app.assignment_offerings ao SET due_at = v.ts::timestamptz
              FROM (VALUES %s) AS v(id, ts)
             WHERE ao.id = v.id::uuid
        """, [(str(i), ts.isoformat()) for i, ts in off_updates])

    # Per-section rows: upsert, never delete-then-insert. A student extension lives in its own
    # table, but churning these rows needlessly is still a write against a row the gradebook reads.
    execute_values(cur, """
        INSERT INTO app.assignment_due_dates (assignment_offering_id, section_id, due_at)
        VALUES %s
        ON CONFLICT (assignment_offering_id, section_id)
          DO UPDATE SET due_at = EXCLUDED.due_at
         WHERE app.assignment_due_dates.due_at IS DISTINCT FROM EXCLUDED.due_at
    """, [(str(a), str(s), ts.isoformat()) for a, s, ts in sec_rows])

    # ── Read back, from the DB and not from the plan ────────────────────────────────────────
    cur.execute("""
        SELECT count(*) FILTER (WHERE ao.due_by_day ? 'M' AND ao.due_by_day ? 'T') AS both,
               count(*)                                                            AS total
          FROM app.assignment_offerings ao WHERE ao.course_offering_id = %s
    """, (co_id,))
    r = cur.fetchone()
    cur.execute("""
        SELECT s.meeting_days[1] AS day, count(*) AS n,
               count(*) FILTER (WHERE d.due_at = (ao.due_by_day ->> s.meeting_days[1])::timestamptz)
                 AS agrees
          FROM app.assignment_due_dates d
          JOIN app.assignment_offerings ao ON ao.id = d.assignment_offering_id
          JOIN app.sections s ON s.id = d.section_id
         WHERE ao.course_offering_id = %s GROUP BY 1 ORDER BY 1
    """, (co_id,))
    print(f"\n=== after ===\n  offerings with both M and T: {r['both']}/{r['total']}")
    for row in cur.fetchall():
        print(f"  {row['day']}-day per-section rows: {row['agrees']}/{row['n']} agree with due_by_day")

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
