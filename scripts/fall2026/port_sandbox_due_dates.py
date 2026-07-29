#!/usr/bin/env python
"""Give the live phys-215 Fall 2026 offering the per-section due dates the sandbox already has.

WHY
    A deadline in this model is per SECTION, not per assignment: M-day sections and T-day sections
    meet on different days, so they answer the same preflight the night before their own class.
    `app.assignment_due_dates (assignment_offering_id, section_id, due_at)` is where that lives;
    `assignment_offerings.due_at` is only the fallback used when a section has no row.

    The live offering was built by `split_training_offering.py` (2026-07-27) and rebuilt by
    `isolate_offering_content.py` (2026-07-28), and its per-section rows did not survive the trip:
    they hang off `assignment_offering_id` with ON DELETE CASCADE, and at the moment they would
    have been copied the live offering's 17 sections were not yet in place to copy them ONTO. Only
    `preflight-02` and `preflight-03` were restored by hand afterwards. The other 35 assignments
    have no rows at all, so all 17 sections fall back to the single offering-level `due_at`.

    That fallback carries the M-DAY date. Every T-day section in Physics 215 — 9 of the 17, 185
    cadets — is therefore being held to a deadline one to four days before its own class. The
    sandbox never lost its rows and has the correct M/T split for all 37 assignments, so it is the
    source of truth this restores from.

WHAT IT DOES  (one transaction; --commit or it all rolls back)
    1. Pairs each live assignment offering with its sandbox twin by slug: `preflight-04` <->
       `preflight-04-training` (the suffix `isolate_offering_content.py` gave the sandbox).
    2. Reads the twin's per-section rows and collapses them to one date PER MEETING DAY. The two
       offerings do not share sections — the sandbox has 4, the live term 17 — so the port cannot
       go section-to-section. It goes M-date to every M section and T-date to every T section,
       which is the same rule `dueRowsFor()` in site/js/faculty-lessons.js applies when a director
       edits a lesson, so the result is exactly what the UI would have written.
    3. Upserts one row per live section on the (assignment_offering_id, section_id) primary key.

WHAT IT WILL NOT DO
    * It does not touch `assignment_offerings.due_at`. Live and sandbox already agree on it for all
       37 assignments (checked, and reported if they ever stop agreeing) — the fallback was never
       the wrong value, it was the wrong GRANULARITY.
    * It does not invent a date. A live section whose meeting day the sandbox has no date for is
      reported and skipped, never guessed.
    * It does not delete. A pre-existing row the plan does not cover is reported, not removed.
    * It refuses outright if two sandbox sections that meet on the same day disagree about a
      deadline, because then "the M date" is not a thing and the whole mapping is unsound.

PRECONDITIONS, CHECKED NOT ASSUMED
    * The live offering has ZERO submissions and ZERO grades. Moving a deadline under work that
      already exists silently re-decides who was late; `--even-with-work` is the deliberate
      override, and it is not the same operation.
    * Every live assignment offering has exactly one sandbox twin.

IDEMPOTENT. Re-running after a successful commit reports 37 assignments unchanged and writes
nothing. Runs as the DML tier — data only, no DDL, no unseal. Dry-run by default (CORE.md §4).

Usage:
  .venv/Scripts/python scripts/fall2026/port_sandbox_due_dates.py
  .venv/Scripts/python scripts/fall2026/port_sandbox_due_dates.py --commit
"""

import argparse
import sys
from collections import defaultdict
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

# Deadlines are read and reported in the timezone they were authored in. Storage stays UTC.
LOCAL_TZ = "America/Denver"


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


def sections_of(cur, course_offering_id):
    cur.execute("""
        SELECT id, code, meeting_days
          FROM app.sections
         WHERE course_offering_id = %s
         ORDER BY code
    """, (course_offering_id,))
    return cur.fetchall()


def assignments_of(cur, course_offering_id):
    """One row per assignment offering: its id, slug, position and offering-level fallback."""
    cur.execute("""
        SELECT ao.id, asg.slug, ao.position, ao.due_at
          FROM app.assignment_offerings ao
          JOIN app.assignments asg ON asg.id = ao.assignment_id
         WHERE ao.course_offering_id = %s
         ORDER BY ao.position, asg.slug
    """, (course_offering_id,))
    return cur.fetchall()


def due_rows_of(cur, assignment_offering_ids):
    """Existing per-section rows, keyed by (assignment_offering_id, section_id)."""
    if not assignment_offering_ids:
        return {}
    # ::uuid[] because RealDictCursor hands uuids back as str, and `uuid = text` has no operator.
    cur.execute("""
        SELECT d.assignment_offering_id, d.section_id, d.due_at, s.code, s.meeting_days
          FROM app.assignment_due_dates d
          JOIN app.sections s ON s.id = d.section_id
         WHERE d.assignment_offering_id = ANY(%s::uuid[])
    """, ([str(x) for x in assignment_offering_ids],))
    return {(r["assignment_offering_id"], r["section_id"]): r for r in cur.fetchall()}


def by_meeting_day(rows, slug, problems):
    """Collapse a sandbox assignment's per-section rows to {meeting_day: due_at}.

    A section may list several meeting days; each one it lists inherits that section's date. Two
    sections meeting on the same day MUST agree — if they do not there is no such thing as "the M
    date", and the caller refuses rather than picking one.
    """
    seen = defaultdict(set)
    for r in rows:
        for day in (r["meeting_days"] or []):
            seen[day].add(r["due_at"])
    out = {}
    for day, dates in seen.items():
        if len(dates) > 1:
            problems.append(
                f"{slug}: sandbox sections meeting on {day} disagree — "
                + ", ".join(sorted(d.isoformat() for d in dates)))
            continue
        out[day] = next(iter(dates))
    return out


def fmt(dt):
    return dt.strftime("%a %Y-%m-%d %H:%M") if dt else "—"


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--course", default="phys-215")
    ap.add_argument("--live-term", default="fall-2026")
    ap.add_argument("--sandbox-term", default="training-fall-2026")
    ap.add_argument("--suffix", default="-training",
                    help="what the sandbox's slugs carry that the live ones do not")
    ap.add_argument("--even-with-work", action="store_true",
                    help="proceed although the live offering already holds submissions or grades")
    ap.add_argument("--commit", action="store_true", help="write; otherwise everything rolls back")
    args = ap.parse_args()

    env = read_env(ENV_FILE)
    conn = connect(env)
    cur = conn.cursor()
    cur.execute("SET TIME ZONE %s", (LOCAL_TZ,))

    live_co = offering_of(cur, args.course, args.live_term)
    sand_co = offering_of(cur, args.course, args.sandbox_term)
    if not live_co:
        sys.exit(f"No course offering for {args.course} / {args.live_term}")
    if not sand_co:
        sys.exit(f"No course offering for {args.course} / {args.sandbox_term}")

    print(f"live    {args.course} / {args.live_term}      {live_co}")
    print(f"sandbox {args.course} / {args.sandbox_term}   {sand_co}\n")

    # ── Precondition: nothing has been submitted or graded against these deadlines ──────────
    cur.execute("""
        SELECT (SELECT count(*) FROM app.submissions sub
                  JOIN app.assignment_offerings ao ON ao.id = sub.assignment_offering_id
                 WHERE ao.course_offering_id = %(co)s) AS submissions,
               (SELECT count(*) FROM app.grades g
                  JOIN app.assignment_offerings ao ON ao.id = g.assignment_offering_id
                 WHERE ao.course_offering_id = %(co)s) AS grades
    """, {"co": live_co})
    work = cur.fetchone()
    print(f"live offering holds {work['submissions']} submissions, {work['grades']} grades")
    if (work["submissions"] or work["grades"]) and not args.even_with_work:
        sys.exit("\nREFUSING: work already exists against these deadlines. Moving them re-decides\n"
                 "who submitted late, which is a different operation from restoring a lost row.\n"
                 "Pass --even-with-work if that is genuinely what is wanted.")

    live_sections = sections_of(cur, live_co)
    print(f"live sections: {len(live_sections)} — "
          + ", ".join(f"{s['code']}({'/'.join(s['meeting_days'] or ['?'])})" for s in live_sections))

    live_asgn = assignments_of(cur, live_co)
    sand_asgn = {a["slug"]: a for a in assignments_of(cur, sand_co)}
    print(f"live assignments: {len(live_asgn)} · sandbox assignments: {len(sand_asgn)}\n")

    # ── Pair by slug, and refuse on any assignment we cannot pair ───────────────────────────
    problems, pairs = [], []
    for a in live_asgn:
        twin = sand_asgn.get(a["slug"] + args.suffix)
        if not twin:
            problems.append(f"{a['slug']}: no sandbox twin named {a['slug']}{args.suffix}")
            continue
        pairs.append((a, twin))

    sand_dues = due_rows_of(cur, [t["id"] for _, t in pairs])
    sand_by_ao = defaultdict(list)
    for (ao_id, _), r in sand_dues.items():
        sand_by_ao[ao_id].append(r)

    live_dues = due_rows_of(cur, [a["id"] for a, _ in pairs])

    # ── Build the plan ──────────────────────────────────────────────────────────────────────
    plan, unchanged, uncovered = [], [], []
    for live, twin in pairs:
        day_dates = by_meeting_day(sand_by_ao.get(twin["id"], []), live["slug"], problems)
        if not day_dates:
            problems.append(f"{live['slug']}: sandbox twin has no per-section due dates")
            continue
        if live["due_at"] != twin["due_at"]:
            problems.append(
                f"{live['slug']}: offering-level due_at differs from the sandbox "
                f"({fmt(live['due_at'])} vs {fmt(twin['due_at'])}) — not touched, but check it")
        for sec in live_sections:
            day = next((d for d in (sec["meeting_days"] or []) if d in day_dates), None)
            if day is None:
                uncovered.append((live["slug"], sec["code"], sec["meeting_days"]))
                continue
            want = day_dates[day]
            have = live_dues.get((live["id"], sec["id"]))
            if have and have["due_at"] == want:
                unchanged.append((live["id"], sec["id"]))
            else:
                plan.append({
                    "slug": live["slug"], "ao": live["id"], "section": sec["id"],
                    "code": sec["code"], "day": day, "due": want,
                    "was": have["due_at"] if have else None,
                })

    # A row that exists but the plan never revisits — reported, never deleted.
    touched = {(p["ao"], p["section"]) for p in plan} | set(unchanged)
    orphans = [r for k, r in live_dues.items() if k not in touched]

    # ── Report ──────────────────────────────────────────────────────────────────────────────
    print("=== plan ===")
    if not plan:
        print("  nothing to write — every live section already carries the sandbox's date")
    by_slug = defaultdict(list)
    for p in plan:
        by_slug[p["slug"]].append(p)
    for slug in sorted(by_slug, key=lambda s: (len(s), s)):
        ps = by_slug[slug]
        days = defaultdict(list)
        for p in ps:
            days[p["day"]].append(p["code"])
        shown = " | ".join(
            f"{d}: {fmt(next(x['due'] for x in ps if x['day'] == d))} -> {len(codes)} sections "
            f"({', '.join(sorted(codes))})" for d, codes in sorted(days.items()))
        verb = "insert" if all(p["was"] is None for p in ps) else "upsert"
        print(f"  {slug:22s} {verb} {len(ps):2d}  {shown}")
    for p in (p for p in plan if p["was"] is not None):
        print(f"    CHANGED {p['slug']} {p['code']}: {fmt(p['was'])} -> {fmt(p['due'])}")

    print(f"\nunchanged: {len(unchanged)} rows already correct")

    # A deadline that is not 2359 local is almost always a timezone slip at authoring time —
    # "2359" stored as 23:59 UTC lands at 17:59 in Denver, six hours early. Reported, never
    # corrected: this script's job is to copy the sandbox faithfully, and moving a published
    # deadline is the course director's call, not a side effect of restoring a lost row.
    odd = sorted({(p["slug"], p["due"].strftime("%H:%M")) for p in plan
                  if p["due"].strftime("%H:%M") != "23:59"})
    if odd:
        print(f"\nNOTE — {len(odd)} deadline(s) copied verbatim that are not 2359 local:")
        for slug, hhmm in odd:
            print(f"  {slug:22s} {hhmm}  (the sandbox's own value; unchanged by this run)")
    if uncovered:
        print(f"\nSKIPPED — no sandbox date for that meeting day ({len(uncovered)}):")
        for slug, code, days in uncovered[:20]:
            print(f"  {slug:22s} {code:6s} meets {days}")
    if orphans:
        print(f"\nPRE-EXISTING rows the plan does not cover ({len(orphans)}) — left alone:")
        for r in orphans[:20]:
            print(f"  {r['code']:6s} {fmt(r['due_at'])}")
    if problems:
        print(f"\n=== PROBLEMS ({len(problems)}) ===")
        for p in problems:
            print("  " + p)

    # A mapping problem means the plan is built on something untrue. Stop before writing.
    if problems and any("disagree" in p or "no sandbox twin" in p
                        or "no per-section due dates" in p for p in problems):
        conn.rollback()
        sys.exit("\nREFUSING to write: the pairing above is not sound.")

    if not plan:
        conn.rollback()
        print("\nNothing to do.")
        return

    # ── Write ───────────────────────────────────────────────────────────────────────────────
    execute_values(cur, """
        INSERT INTO app.assignment_due_dates (assignment_offering_id, section_id, due_at)
        VALUES %s
        ON CONFLICT (assignment_offering_id, section_id)
        DO UPDATE SET due_at = EXCLUDED.due_at
    """, [(p["ao"], p["section"], p["due"]) for p in plan])
    # NOT cur.rowcount — execute_values pages the VALUES list, so rowcount is the last page only.
    print(f"\nwrote {len(plan)} rows")

    # ── Verify inside the transaction, so a bad read-back rolls the whole thing back ─────────
    cur.execute("""
        SELECT asg.slug, s.code, d.due_at, s.meeting_days
          FROM app.assignment_due_dates d
          JOIN app.assignment_offerings ao ON ao.id = d.assignment_offering_id
          JOIN app.assignments asg ON asg.id = ao.assignment_id
          JOIN app.sections s ON s.id = d.section_id
         WHERE ao.course_offering_id = %s
    """, (live_co,))
    after = {(r["slug"], r["code"]): r["due_at"] for r in cur.fetchall()}
    want = {(p["slug"], p["code"]): p["due"] for p in plan}
    bad = [k for k, v in want.items() if after.get(k) != v]
    covered = len(after)
    expect_covered = len(live_asgn) * len(live_sections)
    print(f"read-back: {covered}/{expect_covered} (assignments x sections) rows present, "
          f"{len(bad)} mismatched")
    if bad:
        conn.rollback()
        sys.exit(f"REFUSING: read-back disagrees on {len(bad)} rows — rolled back.")

    if args.commit:
        conn.commit()
        print("\nCOMMITTED.")
        print("Rollback, if it is ever needed — these rows did not exist before this run:")
        print("  DELETE FROM app.assignment_due_dates d USING app.assignment_offerings ao")
        print(f"   WHERE ao.id = d.assignment_offering_id AND ao.course_offering_id = '{live_co}'")
        print("     AND (ao.id, d.section_id) IN (…the pairs listed above…);")
    else:
        conn.rollback()
        print("\nDRY RUN — rolled back. Re-run with --commit to keep it.")

    conn.close()


if __name__ == "__main__":
    main()
