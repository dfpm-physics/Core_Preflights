#!/usr/bin/env python3
"""Run the step 1 script guards against the STAGING database, on the gate seed. Nothing is left behind.

step1_script_guards_test.py checks the TEXT of each guard with no database. This runs the same guards
against real tables:

  * lesson_aggregate.py worklist: on the gate vector course it lists only published work with a typed or
    tutor graded path (not the online set, the exam, the project or the bonus); with a newer-due homework
    beside an older preflight, --latest still names the preflight; a path with no delivery stops it with a
    non-zero exit and says why.
  * lesson_aggregate.py _lesson_meta: an inactive offering's lesson is found only when --term names its term.
  * register_lesson.py find_course_offering: finds the offering of a named term whether or not it is active,
    and picks the right one of two terms of one course.
  * create_course_offering.py insert_offering: writes the flag it is given, and a second active offering of
    one course is refused by the database.

Every write happens inside a transaction that is rolled back. Reads STAGING_DB_URL and refuses anything that
is not exactly the staging project. Needs scripts/staging/seed_v2_gate.py to have been run.

Prints one line per check and "N passed, M failed".
"""
import contextlib
import importlib.util
import io
import json
import os
import sys
import uuid
from argparse import Namespace
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(REPO / "supabase" / "admin"))
import db_target  # noqa: E402
from v2_gate_lib import Builder, days  # noqa: E402

passed = failed = 0
_KEEP = []


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"PASS {name}")
    else:
        failed += 1
        print(f"FAIL {name}" + (f"  [{detail}]" if detail else ""))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    saved = sys.stdout, sys.stderr
    _KEEP.append(saved)                  # the module rewraps the streams; a dropped wrapper closes the buffer
    spec.loader.exec_module(mod)
    _KEEP.append((sys.stdout, sys.stderr))
    sys.stdout, sys.stderr = saved
    return mod


def worklist(la, conn, course, **kw):
    """Run cmd_worklist, return (exit code or None, stdout text)."""
    out = io.StringIO()
    code = None
    args = Namespace(course=course, day=kw.get("day"), latest=kw.get("latest", False), json=True, as_of=None)
    with contextlib.redirect_stdout(out):
        try:
            la.cmd_worklist(args, conn)
        except SystemExit as exc:
            code = exc.code if exc.code not in (None, 0) else 0
    return code, out.getvalue()


def main():
    url = os.environ.get("STAGING_DB_URL", "").strip()
    db_target.exit_unless_staging(url)
    import psycopg2

    la = load("lesson_aggregate", REPO / "supabase" / "admin" / "lesson_aggregate.py")
    rl = load("register_lesson", REPO / "scripts" / "fall2026" / "register_lesson.py")
    cc = load("create_course_offering", REPO / "scripts" / "app" / "create_course_offering.py")
    out_stream = sys.stdout

    conn = psycopg2.connect(url, connect_timeout=15)
    cur = conn.cursor()
    cur.execute("SET search_path = app, public, extensions")
    cur.execute("SELECT count(*) FROM courses WHERE code IN ('gate-vector', 'gate-entry')")
    if cur.fetchone()[0] != 2:
        sys.exit("the gate seed is not present: run scripts/staging/seed_v2_gate.py --commit first")

    # ---- the worklist on the gate vector course ------------------------------------------------------
    code, text = worklist(la, conn, "gate-vector")
    sys.stdout = out_stream
    items = json.loads(text)["items"] if code is None else []
    slugs = {i["slug"] for i in items}
    check("worklist on gate-vector runs and lists typed-response work (gate-v1, gate-v2)",
          code is None and {"gate-v1", "gate-v2"} <= slugs, f"code={code} slugs={sorted(slugs)}")
    check("worklist leaves out the online set, the exam, the bonus, the project and the unfinished next item",
          not (slugs & {"gate-v3", "gate-v4", "gate-v5", "gate-v6", "gate-v7", "gate-v8"}), str(sorted(slugs)))
    code, text = worklist(la, conn, "gate-entry")
    check("worklist on the inactive entry course lists nothing (it is not an active offering)",
          code is None and json.loads(text)["items"] == [], text[:120])

    # ---- a newer-due homework must not mask an older preflight ----------------------------------------
    b = Builder(cur, None)
    tag = uuid.uuid4().hex[:8]
    course = b.course(f"wl-{tag}", "Worklist trial")
    term = b.term()
    co = b.offering(course, term, True)
    sec = b.section(co, "W1", ["M"])
    director = b.staff(f"wl-{tag}", "Trial Director")
    b.assign(director, co, "director")
    enr, _ = b.cadet(3004000000 + uuid.uuid4().int % 90000, "Trial Cadet", sec, with_auth=False)
    written = {"modality": "written", "delivery": "typed_response", "grading": "human_graded"}
    qpath = {"modality": "questions", "delivery": "online_questions", "grading": "auto_checked"}
    pre = b.item(course, co, f"wl-pre-{tag}", "older preflight", 2, kind="preflight", paths=[written],
                 due=days(-3), published=False)
    b.publish(pre)
    b.work(enr, pre, "committed", days(-4))
    hw = b.item(course, co, f"wl-hw-{tag}", "newer homework", 10, kind="homework", paths=[qpath],
                due=days(-1), published=False)
    b.question(hw, "q1", "numeric", 10, key={"value": 1, "tol_abs": 0.1})
    b.publish(hw)
    b.work(enr, hw, "committed", days(-2))
    code, text = worklist(la, conn, f"wl-{tag}", latest=True)
    sys.stdout = out_stream
    got = json.loads(text) if code is None and text.strip().startswith("{") else {}
    named = json.dumps(got)
    check("--latest names the older preflight, not the newer-due homework",
          code is None and f"wl-pre-{tag}" in named and f"wl-hw-{tag}" not in named, named[:200])

    # ---- a path with no delivery stops the worklist ----------------------------------------------------
    cur.execute("SET LOCAL session_replication_role = replica")        # the fill trigger would otherwise fill it
    cur.execute("UPDATE offering_activities SET delivery = NULL, grading = NULL, warn_earns_full = NULL "
                "WHERE assignment_offering_id = %s", (pre["ao"],))
    cur.execute("SET LOCAL session_replication_role = origin")
    code, text = worklist(la, conn, f"wl-{tag}")
    sys.stdout = out_stream
    check("a path with no delivery makes the worklist exit non-zero, naming the count",
          isinstance(code, str) and "no delivery recorded" in code and code.startswith("1 path"), str(code)[:160])
    conn.rollback()
    cur.execute("SET search_path = app, public, extensions")

    # ---- _lesson_meta and --term --------------------------------------------------------------------------
    m = la._lesson_meta(conn, "gate-v1")
    check("_lesson_meta finds a lesson of an active offering with no term named", m is not None and m["course_code"] == "gate-vector")
    check("_lesson_meta does not find a lesson of an inactive offering with no term named", la._lesson_meta(conn, "gate-pf-1") is None)
    m = la._lesson_meta(conn, "gate-pf-1", term="fall-2026")
    check("_lesson_meta finds it when --term names the term (the active test is dropped)",
          m is not None and m["course_code"] == "gate-entry", str(m and m["course_code"]))

    # ---- register_lesson.find_course_offering ----------------------------------------------------------------
    cur.execute("SELECT id FROM courses WHERE code = 'gate-entry'")
    entry_course = cur.fetchone()[0]
    row = rl.find_course_offering(cur, entry_course, "fall-2026")
    check("find_course_offering finds the offering of a named term although it is inactive", row is not None and row[1] is False, str(row))
    b = Builder(cur, None)
    cold = b.term("wl-cold", "Cold term", "2027-01-01", "2027-05-01")
    cold_co = b.offering(entry_course, cold, False)
    row = rl.find_course_offering(cur, entry_course, "wl-cold")
    check("with two terms of one course it picks the one named, not the first", row is not None and row[0] == cold_co, str(row))
    check("a term with no offering gives no row", rl.find_course_offering(cur, entry_course, "no-such-term") is None)
    conn.rollback()
    cur.execute("SET search_path = app, public, extensions")

    # ---- create_course_offering.insert_offering ---------------------------------------------------------------------
    b = Builder(cur, None)
    course = b.course(f"co-{uuid.uuid4().hex[:8]}", "Offering trial")
    t1, t2 = b.term(), b.term("co-t2", "Second term", "2027-01-01", "2027-05-01")
    oid = cc.insert_offering(cur, course, t1, False)
    cur.execute("SELECT is_active FROM course_offerings WHERE id = %s", (oid,))
    check("insert_offering(..., False) writes an inactive offering", cur.fetchone()[0] is False)
    oid2 = cc.insert_offering(cur, course, t2, True)
    cur.execute("SELECT is_active FROM course_offerings WHERE id = %s", (oid2,))
    check("insert_offering(..., True) writes an active offering", cur.fetchone()[0] is True)
    cur.execute("SAVEPOINT s")
    try:
        cc.insert_offering(cur, course, b.term("co-t3", "Third term", "2027-06-01", "2027-08-01"), True)
        cur.execute("RELEASE SAVEPOINT s")
        check("a second active offering of one course is refused by the database", False)
    except Exception as exc:  # noqa: BLE001
        cur.execute("ROLLBACK TO SAVEPOINT s")
        check("a second active offering of one course is refused by the database", "course_offerings_one_active" in str(exc), str(exc)[:100])
    try:
        cc.insert_offering(cur, course, t1, None)
        check("an unstated flag is refused before any SQL", False)
    except TypeError:
        check("an unstated flag is refused before any SQL", True)
    conn.rollback()
    conn.close()
    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
