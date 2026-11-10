#!/usr/bin/env python3
"""Before-and-after comparison of deadlines and grades, for a database that recorded no transaction numbers.

READ ONLY. Two commands:
  save FILE            read the database and write FILE (outside the repository; it holds row hashes, deadlines and
                       score values, so treat it as real data)
  diff FILE [--xids X] read the database again and compare it to FILE

THREE LAYERS, all read in one REPEATABLE READ READ ONLY transaction:
  1. the grades fingerprint (grades_fingerprint.py): an md5 of every row of 15 tables, minus the columns step 1 adds.
  2. DEADLINES: for every item and every section of its course offering, the deadline the site rule gives (extension
     excluded: those are per enrollment and are compared on their own), as a millisecond instant and a source. The rule
     is ported here from the database function (038) and site/js/schema.js and is tested against fixed vectors. In
     diff, if the function _scheduled_core exists, its answer for every pair is compared with the port (a mismatch
     would mean the database rule and the site rule disagree). Active extensions are compared as (enrollment, item) to
     instant. Any deadline that MOVED, appeared or went missing is a LOOK.
  3. SCORE COLUMNS of grades: points_earned, points_possible, effort, is_finalized, source and the keys that tie a
     grade to its work. A row whose score columns changed is a LOOK, with the column names and a count. Fingerprint
     layer 1 alone would call such a row "Explained" whenever the table's touch trigger moved updated_at.

EXIT   1 when layer 1 has a DEFECT or layer 2 or 3 has a LOOK; 0 otherwise. A cadet committing inside your window is a
       LOOK: name the cause before you accept it. With no --xids the tool cannot name a cause for you.

WHAT THIS CANNOT DETECT (it prints this too)
  * WHO changed a row. Without transaction numbers, "our migration moved it" and "a cadet moved it" look the same.
    The only evidence is the quiet window: jobs paused, nobody editing. A change in a quiet window with no named cause
    is a finding.
  * A change that was undone before the second read, or a row changed and changed back to the same value.
  * Anything in a column left out of the hash (the columns step 1 adds), in a table outside the 15, or outside schema app.
  * Whether a function, policy, grant or index is right. That is schema_fingerprint.py and fingerprint_diff.py.
  * Whether a page renders the right thing. A deadline that did not move says the stored rule inputs and the rule's
    answer are the same; it does not prove the page shows them.
  * Reads. A migration that made a read return something else (a changed policy) moves no row.
  * Drift in the port. The tested vectors cover the rule as written on 2026-11-05; a later change to 038 or schema.js
    needs the vectors changed in the same commit.

  py -3.14 scripts/staging/step1_compare.py save C:\\prep-step1\\compare-before.json --env-file <file> --allow-production-read
  py -3.14 scripts/staging/step1_compare.py diff C:\\prep-step1\\compare-before.json --env-file <file> --allow-production-read
"""
import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import step1_conn as conn  # noqa: E402
import grades_fingerprint as gf  # noqa: E402

EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
DAY_SHAPE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}(?::?\d{2})?))?$")
SCORE_COLUMNS = ["points_earned", "points_possible", "effort", "is_finalized", "source",
                 "enrollment_id", "assignment_offering_id", "submission_id", "graded_at"]

CANNOT = [
    "WHO changed a row. With no transaction numbers, our migration and a cadet look the same; the quiet window is the only evidence.",
    "a change undone before the second read, or a row changed and changed back.",
    "a column left out of the hash (the columns step 1 adds), a table outside the 15, or anything outside schema app.",
    "whether a function, policy, grant or index is right (use schema_fingerprint.py and fingerprint_diff.py).",
    "whether a page shows the right thing. Unmoved inputs and an unmoved rule answer do not prove the page.",
    "reads: a changed policy changes what a read returns and moves no row.",
    "drift in the ported rule: the vectors cover the rule as written on 2026-11-05.",
]


# ---- the deadline rule, ported (pure) ------------------------------------------------------------------------

def parse_day_value(text):
    """Epoch milliseconds for a per-day value the way the database reads it, or None when it is unusable.

    Accepts a date, or a date and time WITH a zone (Z or an offset). A date and time with no zone is unusable on
    purpose: the site and the database would read it seven hours apart."""
    m = DAY_SHAPE.match(text)
    if not m:
        return None
    y, mo, d, hh, mi, ss, frac, tz = m.groups()
    try:
        if hh is None:
            dt = datetime(int(y), int(mo), int(d), tzinfo=timezone.utc)
        else:
            micro = int((frac or "0").ljust(9, "0")[:6])
            off = timedelta(0)
            if tz != "Z":
                digits = tz[1:].replace(":", "")
                off = timedelta(hours=int(digits[:2]), minutes=int(digits[2:] or 0))
                if tz[0] == "-":
                    off = -off
            dt = datetime(int(y), int(mo), int(d), int(hh), int(mi), int(ss or 0), micro, tzinfo=timezone(off))
    except ValueError:
        return None
    return (dt - EPOCH) // timedelta(milliseconds=1)


def scheduled(offering_ms, by_day, meeting_days, section_ms):
    """[ms or None, source, invalid] for one item and one section. Tiers 2 to 5 of the rule; tier 1 (extension) is separate."""
    if section_ms is not None:
        return [section_ms, "section", False]
    by_day = by_day if isinstance(by_day, dict) else {}
    for day in meeting_days or []:
        raw = by_day.get(day)
        val = None if raw is None else str(raw)
        if val:
            ms = parse_day_value(val)
            return [ms, "day", False] if ms is not None else [None, "none", True]
    if offering_ms is not None:
        return [offering_ms, "offering", False]
    stored = any(v is not None and str(v) != "" for v in by_day.values())
    return [None, "none", stored]


# ---- reading the database ------------------------------------------------------------------------------------

MS = "floor(extract(epoch from {})*1000)::bigint"


def read_extra(cur):
    """Everything layers 2 and 3 need, from the same snapshot as the fingerprint."""
    cur.execute(f"SELECT id::text, course_offering_id::text, {MS.format('due_at')}, due_by_day FROM app.assignment_offerings")
    offerings = {r[0]: (r[1], r[2], r[3]) for r in cur.fetchall()}
    cur.execute("SELECT id::text, course_offering_id::text, meeting_days FROM app.sections")
    sections = {r[0]: (r[1], list(r[2] or [])) for r in cur.fetchall()}
    cur.execute(f"SELECT assignment_offering_id::text, section_id::text, {MS.format('due_at')} FROM app.assignment_due_dates")
    dd = {(r[0], r[1]): r[2] for r in cur.fetchall()}
    by_co = {}
    for sid, (co, _days) in sections.items():
        by_co.setdefault(co, []).append(sid)
    sched = {}
    for oid, (co, off_ms, by_day) in offerings.items():
        for sid in by_co.get(co, []):
            sched[f"{oid}|{sid}"] = scheduled(off_ms, by_day, sections[sid][1], dd.get((oid, sid)))
    cur.execute(f"SELECT enrollment_id::text, assignment_offering_id::text, {MS.format('extended_due_at')} "
                "FROM app.extensions WHERE revoked_at IS NULL")
    ext = {f"{r[1]}|{r[0]}": r[2] for r in cur.fetchall()}
    fn = {}
    cur.execute("SELECT to_regprocedure('app._scheduled_core(uuid,uuid)') IS NOT NULL")
    if cur.fetchone()[0]:
        cur.execute(f"""SELECT ao.id::text, s.id::text, {MS.format('c.due_at')}, c.source, c.invalid
                          FROM app.assignment_offerings ao
                          JOIN app.sections s ON s.course_offering_id = ao.course_offering_id
                         CROSS JOIN LATERAL app._scheduled_core(ao.id, s.id) c""")
        fn = {f"{r[0]}|{r[1]}": [r[2], r[3], bool(r[4])] for r in cur.fetchall()}
    cur.execute("SELECT column_name FROM information_schema.columns WHERE table_schema='app' AND table_name='grades'")
    have = {r[0] for r in cur.fetchall()}
    cols = [c for c in SCORE_COLUMNS if c in have]
    cur.execute("SELECT id::text, " + ", ".join(f'g."{c}"::text' for c in cols) + " FROM app.grades g")
    values = {r[0]: list(r[1:]) for r in cur.fetchall()}
    return {"scheduled": sched, "extensions": ext, "function_answers": fn, "grade_cols": cols, "grade_values": values}


# ---- comparing (pure) -----------------------------------------------------------------------------------------

def compare_deadlines(old, new):
    """LOOK lines for layer 2: moved, appeared, gone, extension changes."""
    looks = []
    for kind, o, n in (("deadline", old["scheduled"], new["scheduled"]), ("extension", old["extensions"], new["extensions"])):
        moved = sorted(k for k in o if k in n and o[k] != n[k])
        gone = sorted(k for k in o if k not in n)
        added = sorted(k for k in n if k not in o)
        if moved:
            looks.append(f"{len(moved)} {kind}(s) MOVED, e.g. {moved[0]}")
        if gone:
            looks.append(f"{len(gone)} {kind}(s) gone, e.g. {gone[0]}")
        if added:
            looks.append(f"{len(added)} {kind}(s) new (an item, section or extension created in the window), e.g. {added[0]}")
    return looks


def compare_function(new):
    """LOOK lines when the database function disagrees with the port. Nothing when the function does not exist yet."""
    fn, mine = new.get("function_answers") or {}, new["scheduled"]
    if not fn:
        return [], 0
    bad = sorted(k for k in fn if k in mine and fn[k] != mine[k])
    missing = sorted(k for k in mine if k not in fn)
    looks = []
    if bad:
        looks.append(f"{len(bad)} pair(s) where the database function and the ported rule DISAGREE, e.g. {bad[0]}")
    if missing:
        looks.append(f"{len(missing)} pair(s) the function did not answer, e.g. {missing[0]}")
    return looks, len(fn)


def compare_values(old, new):
    """LOOK lines for layer 3: a grade whose score columns changed."""
    if old["grade_cols"] != new["grade_cols"]:
        return ["the list of score columns differs between the two reads; compare by hand"]
    cols = old["grade_cols"]
    by_col, changed = {}, 0
    for k, ov in old["grade_values"].items():
        nv = new["grade_values"].get(k)
        if nv is None or nv == ov:
            continue
        changed += 1
        for c, a, b in zip(cols, ov, nv):
            if a != b:
                by_col[c] = by_col.get(c, 0) + 1
    if not changed:
        return []
    return [f"{changed} grade(s) changed a score column: " + ", ".join(f"{c} x{n}" for c, n in sorted(by_col.items()))]


# ---- commands -------------------------------------------------------------------------------------------------

def take(spec):
    c = spec.connect()
    snap = gf.snapshot(c, extra=read_extra)
    c.close()
    snap["project"] = spec.ref
    return snap


def cmd_save(args, spec):
    path = gf.outside_repo(args.file)
    snap = take(spec)
    path.write_text(json.dumps(snap), encoding="utf-8")
    ex = snap["extra"]
    print(f"saved {sum(len(t['rows']) for t in snap['tables'].values())} row hashes, {len(ex['scheduled'])} item-section "
          f"deadlines, {len(ex['extensions'])} active extensions, {len(ex['grade_values'])} grades' score columns; "
          f"project {snap['project']}, UTC")
    return 0


def cmd_diff(args, spec):
    old = json.loads(Path(args.file).read_text(encoding="utf-8"))
    if old.get("tz") != "UTC" or old.get("project") != spec.ref or "extra" not in old:
        sys.exit("REFUSED  the saved file is not a step1_compare file for this project.")
    new = take(spec)
    defects, explained, added, counts = gf.classify(old, new, gf.read_xids(args.xids))
    print("LAYER 1  row hashes (grades_fingerprint)")
    gf.report(defects, explained, added, counts)
    print(f"\nLAYER 2  deadlines ({len(new['extra']['scheduled'])} item-section pairs, {len(new['extra']['extensions'])} active extensions)")
    looks2 = compare_deadlines(old["extra"], new["extra"])
    fl, answered = compare_function(new["extra"])
    looks2 += fl
    print(f"    database function _scheduled_core answered {answered} pair(s)" if answered
          else "    the database function does not exist yet, so only the stored inputs and the ported rule were compared")
    for x in looks2 or ["none moved"]:
        print(("    LOOK  " if looks2 else "    ") + x)
    print("\nLAYER 3  score columns of grades")
    looks3 = compare_values(old["extra"], new["extra"])
    for x in looks3 or ["no grade changed a score column"]:
        print(("    LOOK  " if looks3 else "    ") + x)
    if not args.xids:
        print("\nNO TRANSACTION NUMBERS were given, so a changed row can only be 'by another session' (Explained) in layer 1.")
    print("\nTHIS COMPARISON CANNOT DETECT:")
    for x in CANNOT:
        print("  - " + x)
    bad = bool(defects or looks2 or looks3)
    print(f"\nRESULT   {'LOOK: read the lines above and name a cause for each' if bad else 'no defect, no moved deadline, no changed score column'}")
    return 1 if bad else 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("save", "diff"):
        p = sub.add_parser(name)
        p.add_argument("file")
        conn.add_args(p, tier_default="read")
        p.add_argument("--allow-production-read", action="store_true")
        if name == "diff":
            p.add_argument("--xids", help="a file of transaction numbers a tool recorded (step1_apply.py --xid-file)")
    args = ap.parse_args(argv)
    spec = conn.resolve(args, args.allow_production_read, "--allow-production-read")
    return {"save": cmd_save, "diff": cmd_diff}[args.cmd](args, spec)


if __name__ == "__main__":
    sys.exit(main())
