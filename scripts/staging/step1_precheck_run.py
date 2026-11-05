#!/usr/bin/env python3
"""Run the 19 checks in step1_precheck.sql and print each beside what it should show, with OK or LOOK.

READ ONLY. Every query runs in its own read-only transaction that is rolled back. The checks return catalog facts,
counts, a version and course codes; no cadet id, name, score or answer is selected, and none is printed.

STAGES   What a check should show depends on how far step 1 has got. Name the stage with --stage:
  before          nothing of step 1 is applied (the day-before run, and the run at the start of the day)
  after-025       024 and 025 are applied, the training offering is still active
  after-training  the training offering is inactive (also correct through 026 to 040)
  after-043       040 to 043 are applied as well

EXIT   0 when no check says LOOK, 1 when any does, 2 when a query failed. NOTE means "a number to write down", not a fault.

CONNECTION   --env-file PATH (alias --dotenv) with the read tier, or --url-env NAME. The live project is refused
             unless --allow-production-read. --expect-role (default prep_app_read) is what check 1 must show; on a
             staging login that connects as another role, pass the role name or expect a LOOK on check 1.

  py -3.14 scripts/staging/step1_precheck_run.py --env-file <file> --allow-production-read --stage before
"""
import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import step1_conn as conn  # noqa: E402

SQL_FILE = Path(__file__).resolve().parent / "step1_precheck.sql"
STAGES = ("before", "after-025", "after-training", "after-043")
HEAD = re.compile(r"^--\s+(\d+)\.\s+(.*)$")


def parse_checks(text):
    """[{n, title, expected, sql}] in file order. A check is its heading comment, its notes, and one statement."""
    checks, cur = [], None
    for line in text.splitlines():
        m = HEAD.match(line)
        if m:
            cur = {"n": int(m.group(1)), "title": m.group(2).strip(), "notes": [], "sql": []}
            checks.append(cur)
            continue
        if cur is None:
            continue
        if line.startswith("--"):
            if not cur["sql"]:
                cur["notes"].append(line[2:].strip())
        elif line.strip():
            cur["sql"].append(line)
    out = []
    for c in checks:
        sql = "\n".join(c["sql"]).strip().rstrip(";").strip()
        notes = " ".join(n for n in c["notes"] if n)
        m = re.search(r"Expected[^:]*:\s*(.*)$", c["title"] + " " + notes)
        out.append({"n": c["n"], "title": c["title"], "expected": (m.group(1) if m else notes).strip(), "sql": sql})
    return out


# ---- judgement: each returns (status, note). status is "OK", "LOOK" or "NOTE" -------------------------------------

def _col(cols, rows, name):
    i = cols.index(name)
    return [r[i] for r in rows]


def judge(n, cols, rows, stage, expect_role):
    after_025 = stage != "before"
    after_training = stage in ("after-training", "after-043")
    after_043 = stage == "after-043"
    if n == 1:
        names = set(rows[0])
        return ("OK", "") if names == {expect_role} else ("LOOK", f"expected only {expect_role}, got {sorted(names)}")
    if n == 2:
        return ("OK", "") if not rows else ("LOOK", f"{len(rows)} function(s) that 025 would not pin")
    if n == 3:
        if len(rows) != 7:
            return "LOOK", f"expected 7 rows, got {len(rows)}"
        bad_owner = [r for r in _col(cols, rows, "owner") if r != "prep_app_owner"]
        paths = _col(cols, rows, "stored_path")
        want = (lambda p: p == "search_path=app, pg_temp") if after_025 else (lambda p: not p)
        if bad_owner:
            return "LOOK", "an owner other than prep_app_owner"
        if not all(want(p) for p in paths):
            return "LOOK", ("expected the pinned path on all 7" if after_025 else "expected an empty stored path on all 7")
        return "OK", ""
    if n == 4:
        if len(rows) != 2:
            return "LOOK", f"expected 2 roles, got {len(rows)}"
        return ("OK", "") if all(_col(cols, rows, "bypasses_rls")) else ("LOOK", "a lower tier does not bypass row level security")
    if n == 5:
        return ("OK", "023 absent, as step 1 leaves it") if rows[0] == (False, False) else ("LOOK", "023 is present or half present")
    if n == 6:
        present = bool(rows[0][0])
        return ("OK", "") if present == after_025 else ("LOOK", f"ledger present is {present}, expected {after_025}")
    if n == 7:
        m = re.match(r"\s*(\d+)", str(rows[0][0]))
        return ("OK", "") if m and int(m.group(1)) >= 16 else ("LOOK", f"version {rows[0][0]}; 038 needs 16 or later")
    if n == 8:
        return ("OK", "") if rows[0][0] == 0 else ("LOOK", f"{rows[0][0]} grade(s) disagree with their offering")
    if n == 9:
        return ("OK", "0, as recorded") if rows[0][0] == 0 else ("LOOK", f"{rows[0][0]}; the record said 0, find out why")
    if n == 10:
        if after_training:
            return ("OK", "") if not rows else ("LOOK", f"{len(rows)} course(s) with two active offerings; 028 will refuse")
        known = [(r[0], r[1]) for r in rows] == [("phys-215", 2)]
        if known:
            return "OK", "the known training case; step 4 of the day clears it"
        if not rows:
            return "LOOK", "0 rows: the training offering is already inactive, or the record is stale"
        return "LOOK", "not the single known case (phys-215 with 2): " + ", ".join(f"{r[0]}:{r[1]}" for r in rows)
    if n == 11:
        return ("OK", "") if rows[0][0] == 0 else ("LOOK", f"{rows[0][0]} unpublished item(s) with submissions")
    if n == 12:
        mods = {r[0] for r in rows}
        extra = sorted(str(m) for m in mods - {"written", "interactive"})
        if extra:
            return "LOOK", "modality the backfill does not know: " + ", ".join(extra)
        return ("OK", "only written and interactive") if mods else ("LOOK", "no modality at all")
    if n == 13:
        return ("OK", "") if rows[0][0] == 0 else ("LOOK", f"{rows[0][0]} day value(s) that are not full timestamps")
    if n in (14, 15):
        return "NOTE", "write the number(s) down"
    if n == 16:
        v = rows[0][0]
        want = 80 if after_training else 0
        return ("OK", "") if v == want else ("LOOK", f"expected {want} at this stage, got {v}")
    if n == 17:
        verdicts = _col(cols, rows, "verdict")
        if len(rows) != 11:
            return "LOOK", f"expected 10 tables and a TOTAL row (11 rows), got {len(rows)}"
        return ("OK", "") if all(v == "ok" for v in verdicts) else ("LOOK", "a verdict that is not ok; 041 will refuse")
    if n == 18:
        verdicts = _col(cols, rows, "verdict")
        if after_043:
            if len(rows) != 8:
                return "LOOK", f"expected 7 functions and a TOTAL row (8 rows), got {len(rows)}"
            return ("OK", "") if all(v == "ok" for v in verdicts) else ("LOOK", "a function with the wrong owner, mode or path")
        only_total = len(rows) == 1 and str(verdicts[0]).startswith("LOOK")
        return ("OK", "TOTAL row only, with LOOK, as expected before 041") if only_total else ("LOOK", "expected the TOTAL row only before 041")
    if n == 19:
        if after_043:
            return ("OK", "") if len(rows) == 1 and rows[0][cols.index("verdict")] == "ok" else ("LOOK", "the guard trigger is missing or wrong")
        return ("OK", "no row, as expected before 043") if not rows else ("LOOK", "the guard exists already")
    return "LOOK", "no judgement written for this check"


def show_rows(cols, rows, limit=12):
    print("    result  " + " | ".join(cols))
    for r in rows[:limit]:
        print("            " + " | ".join("" if v is None else str(v) for v in r))
    if len(rows) > limit:
        print(f"            ... and {len(rows) - limit} more")
    if not rows:
        print("            (no rows)")


def run(spec, stage, expect_role, only=None):
    checks = parse_checks(SQL_FILE.read_text(encoding="utf-8"))
    if len(checks) != 19 and not only:
        print(f"LOOK  step1_precheck.sql holds {len(checks)} checks, not 19", file=sys.stderr)
        return 2
    c = spec.connect()
    c.set_session(readonly=True, autocommit=False)
    looks = errors = 0
    print(f"stage {stage}; read-only; project: {conn.label(spec)}")
    for chk in checks:
        if only and chk["n"] not in only:
            continue
        print(f"\n[{chk['n']:>2}] {chk['title']}")
        print(f"    expected  {chk['expected']}")
        cur = c.cursor()
        try:
            cur.execute(chk["sql"])
            cols = [d[0] for d in cur.description]
            rows = cur.fetchall()
        except Exception as exc:  # noqa: BLE001
            c.rollback()
            errors += 1
            print(f"    ERROR     {type(exc).__name__}: {str(exc).strip().splitlines()[0]}")
            continue
        c.rollback()
        show_rows(cols, rows)
        status, note = judge(chk["n"], cols, rows, stage, expect_role)
        looks += status == "LOOK"
        print(f"    {status:<4}      {note}".rstrip())
    c.close()
    print(f"\n{looks} LOOK, {errors} query error(s)")
    return 2 if errors else (1 if looks else 0)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    conn.add_args(ap, tier_default="read")
    ap.add_argument("--stage", choices=STAGES, default="before")
    ap.add_argument("--expect-role", default="prep_app_read")
    ap.add_argument("--only", type=int, nargs="*", help="run only these check numbers")
    ap.add_argument("--allow-production-read", action="store_true")
    args = ap.parse_args(argv)
    spec = conn.resolve(args, args.allow_production_read, "--allow-production-read")
    return run(spec, args.stage, args.expect_role, set(args.only) if args.only else None)


if __name__ == "__main__":
    sys.exit(main())
