#!/usr/bin/env python
"""The deadline proof (V2-DATA-MODEL section 8) on STAGING: app.deadline_rows() against the shipped site.

For every course offering on the staging database (the base seed, the gate seed, and a made-up trial course built
inside the transaction and rolled back), this reads every row of app.deadline_rows() and compares it with what the
SHIPPED site computes from the same stored rows: site/js/schema.js shapeOffering -> resolveDueBySection ->
effectiveDue, run through Node (deadline-site-side.mjs). It reports any difference in due, source or is_past.

The trial course holds the edge cases: a section override, the first meeting day in array order, a JSON null and
an empty string that fall to the next day, an unparsable day value, `now` and an out-of-range date, a date-only
value, microsecond precision, a day value no meeting day reaches, no deadline at all, active extensions, a
revoked extension, and due dates on both sides of the 120 second grace.

CONTROLS (the proof must be able to fail). Each plant changes one input and the comparison must find it:
  A  the site side counts a revoked extension as active        -> differences in due and source
  B  the database side is changed by one millisecond after export -> differences in due
  C  the site side is given a clock one hour behind            -> differences in is_past

Known limit: the site parses a day value with no zone ("2026-12-01T10:00:00") in the browser's own zone and the
database in UTC; stored values carry an offset, so none is tried. The exact 120.000 s boundary is not tried: the
database clock has microseconds and JavaScript's has milliseconds.

Reads STAGING_DB_URL and refuses anything but the staging project. Everything written is rolled back.
Prints one line per check and "N passed, M failed".
"""
import json
import os
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "scripts" / "staging"))
from staging_guard import require_staging  # noqa: E402
from v2_gate_lib import Builder  # noqa: E402

DRIVER = HERE / "deadline-site-side.mjs"
WRITTEN = {"modality": "written", "delivery": "typed_response", "grading": "human_graded"}
passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"PASS {name}")
    else:
        failed += 1
        print(f"FAIL {name}" + (f"  [{detail}]" if detail else ""))


ISO = "YYYY-MM-DD\"T\"HH24:MI:SS.US\"+00:00\""    # the text PostgREST sends a timestamptz in a UTC session


def ts(col):
    return f"to_char({col} AT TIME ZONE 'UTC', '{ISO}')"


def export(cur, co):
    """The stored rows the site would have read for one course offering."""
    cur.execute(f"""SELECT id, {ts('due_at')}, due_by_day FROM assignment_offerings
                     WHERE course_offering_id = %s ORDER BY id""", (co,))
    offerings = [{"id": str(i), "due_at": d, "due_by_day": j, "dues": []} for i, d, j in cur.fetchall()]
    by_id = {o["id"]: o for o in offerings}
    cur.execute(f"""SELECT d.assignment_offering_id, d.section_id, {ts('d.due_at')} FROM assignment_due_dates d
                      JOIN assignment_offerings ao ON ao.id = d.assignment_offering_id
                     WHERE ao.course_offering_id = %s""", (co,))
    for ao, sec, due in cur.fetchall():
        by_id[str(ao)]["dues"].append({"section_id": str(sec), "due_at": due})
    cur.execute("SELECT id, meeting_days FROM sections WHERE course_offering_id = %s", (co,))
    sections = [{"id": str(i), "meeting_days": d} for i, d in cur.fetchall()]
    cur.execute("""SELECT e.id, e.section_id FROM enrollments e JOIN sections s ON s.id = e.section_id
                    WHERE s.course_offering_id = %s""", (co,))
    enrollments = [{"id": str(i), "section_id": str(s)} for i, s in cur.fetchall()]
    cur.execute(f"""SELECT x.enrollment_id, x.assignment_offering_id, {ts('x.extended_due_at')},
                           {ts('x.revoked_at')}
                      FROM extensions x JOIN assignment_offerings ao ON ao.id = x.assignment_offering_id
                     WHERE ao.course_offering_id = %s""", (co,))
    extensions = [{"enrollment_id": str(a), "assignment_offering_id": str(b), "extended_due_at": c, "revoked_at": d}
                  for a, b, c, d in cur.fetchall()]
    return {"offerings": offerings, "sections": sections, "enrollments": enrollments, "extensions": extensions}


def site_side(data, now_ms, plant=None):
    env = dict(os.environ, TZ="America/Denver")           # a browser's zone, not UTC: nothing may depend on it
    proc = subprocess.run(["node", str(DRIVER)], input=json.dumps({**data, "now": now_ms, "plant": plant}),
                          capture_output=True, text=True, env=env, timeout=120)
    if proc.returncode != 0:
        raise RuntimeError("site side failed: " + proc.stderr[-400:])
    return {(r["enrollment_id"], r["assignment_offering_id"]): r for r in json.loads(proc.stdout)}


def db_side(cur, co):
    cur.execute("""SELECT enrollment_id, assignment_offering_id,
                          (extract(epoch FROM due_at) * 1000)::bigint, source, is_past
                     FROM deadline_rows(%s)""", (co,))
    return {(str(e), str(a)): {"due": d, "source": s, "is_past": p} for e, a, d, s, p in cur.fetchall()}


def diff(site, db):
    """Differences by field, plus rows present on one side only."""
    out = {"due": [], "source": [], "is_past": [], "missing": []}
    for k in sorted(set(site) | set(db)):
        a, b = site.get(k), db.get(k)
        if a is None or b is None:
            out["missing"].append(k)
            continue
        for f in ("due", "source", "is_past"):
            if a[f] != b[f]:
                out[f].append((k, a[f], b[f]))
    return out


def build_trial(cur):
    """A made-up course holding the edge cases. Returns (course offering, number of items)."""
    b = Builder(cur, None)
    cur.execute("SELECT now()")
    t0 = cur.fetchone()[0].astimezone(timezone.utc)
    tag = uuid.uuid4().hex[:10]
    course = b.course(f"dl-{tag}", "Deadline trial")
    co = b.offering(course, b.term(), True)
    sec = {"M": b.section(co, "DM", ["M"]), "T": b.section(co, "DT", ["T"]), "TM": b.section(co, "DTM", ["T", "M"]),
           "NONE": b.section(co, "DX", []), "W": b.section(co, "DW", ["W"])}
    director = b.staff(f"dl-{tag}", "Trial Director")
    b.assign(director, co, "director")
    enr = {}
    for n, (key, s) in enumerate(sec.items()):
        enr[key], _ = b.cadet(3005000000 + uuid.uuid4().int % 90000 + n * 100000, f"Trial{key} Deadline", s, with_auth=False)
    dropped, _ = b.cadet(3005900000 + uuid.uuid4().int % 90000, "Trialdrop Deadline", sec["M"], with_auth=False, status="dropped")
    d = lambda days, hours=0: (t0 + timedelta(days=days, hours=hours)).isoformat()   # noqa: E731
    d1, d2 = d(5), d(6)
    cases = {                                         # slug -> (due_at, due_by_day)
        "plain": (d1, {"M": d1, "T": d2}),
        "null-day": (d1, {"M": None, "T": d2}),
        "empty-day": (d1, {"M": ""}),
        "bad-day": (d1, {"M": "garbage", "T": d2}),
        "bad-range": (d1, {"M": "2026-13-45"}),
        "word-now": (d1, {"M": "now"}),
        "date-only": (d1, {"M": "2026-12-01", "T": "2026-12-02"}),
        "micro": ("2026-12-01T10:00:00.123456+00:00", {}),
        "unreached": (None, {"F": d1}),
        "nothing": (None, {}),
        "override": (d1, {"M": d1, "T": d2}),
        "past-121": (d(0).replace("+00:00", "+00:00"), {}),
    }
    items = {}
    for slug, (due, by_day) in cases.items():
        items[slug] = b.item(course, co, f"dl-{slug}-{tag}", f"Deadline {slug}", 2, kind="homework",
                             paths=[WRITTEN], due=due, due_by_day=by_day, published=False)
    # the 120 second grace on both sides, and a long-past date
    for slug, secs in (("past-121", -121), ("past-119", -119), ("past-30m", -1800), ("future-1h", 3600)):
        due = (t0 + timedelta(seconds=secs)).isoformat()
        items[slug] = items.get(slug) or b.item(course, co, f"dl-{slug}-{tag}", f"Deadline {slug}", 2, kind="homework",
                                                 paths=[WRITTEN], due=due, due_by_day={}, published=False)
        cur.execute("UPDATE assignment_offerings SET due_at = %s WHERE id = %s", (due, items[slug]["ao"]))
    # a per-section override on one item, a section that also has a day value
    cur.execute("INSERT INTO assignment_due_dates (assignment_offering_id, section_id, due_at) VALUES (%s, %s, %s)",
                (items["override"]["ao"], sec["M"], d(3)))
    cur.execute("INSERT INTO assignment_due_dates (assignment_offering_id, section_id, due_at) VALUES (%s, %s, %s)",
                (items["plain"]["ao"], sec["W"], d(4)))
    # extensions: active (later), active (earlier than scheduled), active on an item with no deadline, revoked
    for key, slug, when, revoked in (("T", "plain", d(9), False), ("M", "override", d(1), False),
                                      ("NONE", "nothing", d(8), False), ("TM", "plain", d(10), True),
                                      ("M", "past-121", d(2), False), ("W", "past-30m", d(2), True)):
        cur.execute("""INSERT INTO extensions (enrollment_id, assignment_offering_id, extended_due_at, reason, granted_by,
                                               revoked_at, revoked_by, revoked_reason)
                       VALUES (%s, %s, %s, 'Made-up reason.', %s, %s, %s, %s)""",
                    (enr[key], items[slug]["ao"], when, director, d(0) if revoked else None,
                     director if revoked else None, "Made-up revoke reason." if revoked else None))
    return co, len(items)


def main():
    url = os.environ.get("STAGING_DB_URL", "").strip()
    require_staging(url)
    import psycopg2
    conn = psycopg2.connect(url, connect_timeout=15)
    cur = conn.cursor()
    cur.execute("SET TIME ZONE 'UTC'")
    cur.execute("SET search_path = app, public, extensions")
    trial_co, n_items = build_trial(cur)

    cur.execute("SELECT now()")
    now = cur.fetchone()[0]
    now_ms = int(now.timestamp() * 1000)            # JavaScript holds milliseconds; the database holds more

    cur.execute("""SELECT co.id, c.code FROM course_offerings co JOIN courses c ON c.id = co.course_id
                    WHERE EXISTS (SELECT 1 FROM assignment_offerings ao WHERE ao.course_offering_id = co.id)
                    ORDER BY c.code""")
    courses = [(str(i), code) for i, code in cur.fetchall()]
    total = 0
    sources, ext_active, ext_revoked = {}, 0, 0
    exported = {}
    for co, code in courses:
        data = export(cur, co)
        site, db = site_side(data, now_ms), db_side(cur, co)
        d = diff(site, db)
        n = len(db)
        total += n
        for r in db.values():
            sources[r["source"]] = sources.get(r["source"], 0) + 1
        ext_active += sum(1 for x in data["extensions"] if not x["revoked_at"])
        ext_revoked += sum(1 for x in data["extensions"] if x["revoked_at"])
        label = "trial course" if co == trial_co else code
        # deadline_rows() answers per enrollment, so an offering with items and nobody enrolled (a copied-forward
        # term waiting for its roster) has no rows by design. Zero rows is only a failure when someone is enrolled.
        cur.execute("SELECT count(*) FROM enrollments e JOIN sections s ON s.id = e.section_id "
                    "WHERE s.course_offering_id = %s", (co,))
        enrolled = cur.fetchone()[0]
        check(f"{label}: {n} rows, 0 differences in due, source, is_past, and the same set of rows",
              (n > 0 or enrolled == 0) and not any(d.values()), json.dumps({k: v[:2] for k, v in d.items() if v})[:300])
        exported[co] = (data, site, db)

    # The per-offering rule above lets an offering with nobody enrolled have no rows. Without this line, a database
    # where nobody is enrolled anywhere would pass every check while comparing nothing.
    check("coverage: the total number of rows compared across all offerings is above 0", total > 0, f"total {total}")
    check("coverage: every source name appears (extension, section, day, offering, none)",
          {"extension", "section", "day", "offering", "none"} <= set(sources), str(sources))
    check("coverage: active and revoked extensions are both in the data", ext_active > 0 and ext_revoked > 0,
          f"active {ext_active} revoked {ext_revoked}")
    cur.execute("SELECT count(*) FROM courses WHERE code IN ('gate-vector', 'gate-entry')")
    check("coverage: the gate seed is among the courses compared", cur.fetchone()[0] == 2)
    print(f"  compared {total} rows over {len(courses)} course offerings; sources {sources}; "
          f"extensions active {ext_active}, revoked {ext_revoked}")

    # ---- controls: plant one difference, the comparison must find it ---------------------------------------
    data, site, db = exported[trial_co]
    d = diff(site_side(data, now_ms, plant="revoked_counts"), db)
    check("control A (revoked extension counted as active) is found in due and source", bool(d["due"]) and bool(d["source"]),
          str({k: len(v) for k, v in d.items()}))
    cur.execute("UPDATE assignment_offerings SET due_at = due_at + interval '1 millisecond' WHERE course_offering_id = %s "
                "AND due_at IS NOT NULL", (trial_co,))
    d = diff(site, db_side(cur, trial_co))
    check("control B (database changed by one millisecond) is found in due", bool(d["due"]), str({k: len(v) for k, v in d.items()}))
    d = diff(site_side(data, now_ms - 3600 * 1000), db)
    check("control C (site clock one hour behind) is found in is_past", bool(d["is_past"]), str({k: len(v) for k, v in d.items()}))
    d = diff(site_side(data, now_ms), db)
    check("after the controls, the unplanted comparison is still clean", not any(d.values()))

    conn.rollback()
    conn.close()
    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
