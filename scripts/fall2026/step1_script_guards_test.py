#!/usr/bin/env python3
"""Offline checks for the step 1 script guards (docs/decisions/V2-DATA-MODEL.md, section 22.2).

NO DATABASE, NO CREDENTIALS, NO NETWORK. The database driver is replaced by a stub when it is not
installed, and every cursor is a recording stub, so the assertions are about the SQL and the
parameters each script sends and about when it stops.

WHAT THIS PROVES
    * register_lesson.py will not run without --term, and finds the offering by course and term
      with no test on the active flag.
    * lesson_aggregate.py `_lesson_meta` keeps its active test when no term is named and drops it
      when one is.
    * the worklist stops (exit non-zero, with a message) when a path of an active offering has no
      delivery recorded, and otherwise sends a query limited to published work whose graded path
      is typed_response or interactive_tutor.
    * create_course_offering.py will not run without --active or --inactive, and inserts the flag
      it was given.

WHAT IT CANNOT PROVE
    That the SQL is accepted by a database that has the new columns. The columns do not exist yet
    where this runs. The text of each query is checked, not its execution.

Usage:  python scripts/fall2026/step1_script_guards_test.py
"""

import importlib.util
import io
import os
import sys
import types

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, OSError):  # pragma: no cover
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))

# Stand in for the driver only when it is absent, so a machine that has it still uses the real one.
try:
    import psycopg2  # noqa: F401
except ImportError:
    pg = types.ModuleType("psycopg2")
    extras = types.ModuleType("psycopg2.extras")
    extras.Json = lambda x: x
    extras.RealDictCursor = object
    pg.extras = extras
    pg.errors = types.ModuleType("psycopg2.errors")
    sys.modules.update({"psycopg2": pg, "psycopg2.extras": extras, "psycopg2.errors": pg.errors})

sys.path.insert(0, os.path.join(REPO, "supabase", "admin"))


_KEEP = []


def load(name, rel):
    spec = importlib.util.spec_from_file_location(name, os.path.join(REPO, rel))
    mod = importlib.util.module_from_spec(spec)
    saved = sys.stdout, sys.stderr
    spec.loader.exec_module(mod)
    # lesson_aggregate swaps the streams at import. Keep the replacements alive: a wrapper that is
    # collected closes the buffer underneath the original.
    _KEEP.extend([sys.stdout, sys.stderr])
    sys.stdout, sys.stderr = saved
    return mod


LA = load("lesson_aggregate", "supabase/admin/lesson_aggregate.py")
RL = load("register_lesson", "scripts/fall2026/register_lesson.py")
CC = load("create_course_offering", "scripts/app/create_course_offering.py")

PASSED = FAILED = 0


def eq(label, got, want):
    global PASSED, FAILED
    if got == want:
        PASSED += 1
        print(f"  [pass] {label}")
    else:
        FAILED += 1
        print(f"  [FAIL] {label}\n         got  {got!r}\n         want {want!r}")


def check(label, ok):
    eq(label, bool(ok), True)


def section(title):
    print(f"\n=== {title} ===")


class Cur:
    """A cursor that records every execute and answers from a script of canned rows."""

    def __init__(self, answers=None):
        self.calls = []
        self.answers = list(answers or [])
        self._last = None

    def execute(self, sql, params=None):
        self.calls.append((sql, params))
        self._last = self.answers.pop(0) if self.answers else []

    def fetchall(self):
        return list(self._last or [])

    def fetchone(self):
        rows = self._last or []
        return rows[0] if rows else None


class Conn:
    def __init__(self, cur):
        self.cur = cur

    def cursor(self, **_):
        return self.cur


def exits(fn):
    try:
        fn()
    except SystemExit as e:
        return e.code
    return None


def squash(sql):
    return " ".join(sql.split())


# ──────────────────────────────────────────────────────────────────────────────────────────────
section("register_lesson.py: --term is required, and the lookup ignores the active flag")
p = RL.build_parser()
check("without --term the parser exits non-zero",
      exits(lambda: p.parse_args(["--course", "phys-310", "--lesson", "13"])) not in (None, 0))
a = p.parse_args(["--course", "phys-310", "--term", "fall-2026", "--lesson", "13"])
eq("with --term it parses", a.term, "fall-2026")

cur = Cur([[{"id": "co-1", "is_active": False}]])
row = RL.find_course_offering(cur, "course-1", "spring-2027")
sql, params = cur.calls[0]
eq("it returns the offering even though it is inactive", row, {"id": "co-1", "is_active": False})
eq("it is looked up by course and term code", params, ("course-1", "spring-2027"))
check("the query joins terms on the code", "t.code = %s" in squash(sql))
check("the query has no test on the active flag", "where co.is_active" not in squash(sql)
      and " and co.is_active" not in squash(sql) and "is_active\n" not in sql.split("where")[-1])

# ──────────────────────────────────────────────────────────────────────────────────────────────
section("lesson_aggregate.py: _lesson_meta and --term")
cur = Cur([[{"n": 1}], [{"n": 1}], []])
LA._lesson_meta(Conn(cur), "preflight-08", term=None)
sql, params = cur.calls[-1]
check("no term: the active test is still applied",
      "(%(term)s is not null or co.is_active)" in squash(sql))
eq("no term: the term parameter is null", params["term"], None)

cur = Cur([[{"n": 1}], [{"n": 1}], []])
LA._lesson_meta(Conn(cur), "lesson-02-x", term="training-fall-2026")
sql, params = cur.calls[-1]
eq("a named term is passed as the filter", params["term"], "training-fall-2026")
check("a named term still narrows by term code", "(%(term)s is null or t.code = %(term)s)" in squash(sql))
check("the active test is skipped when a term is named (the clause is true when the term is not null)",
      "(%(term)s is not null or co.is_active)" in squash(sql) and "where co.is_active" not in squash(sql))

# ──────────────────────────────────────────────────────────────────────────────────────────────
section("worklist: null delivery stops it, and the query is limited to graded online paths")


class Args:
    course = "phys-215"
    day = None
    latest = True
    json = True
    as_of = None


cur = Cur([[{"n": 3}]])
code = exits(lambda: LA.cmd_worklist(Args(), Conn(cur)))
check("a null delivery makes it exit with a message (non-zero)", isinstance(code, str) and code)
check("the message says how many and that nothing is listed", "3 path row" in code and "Nothing is listed" in code)
eq("it stopped after the check: the worklist query was never sent", len(cur.calls), 1)
check("the check reads delivery on active offerings of that course",
      "oa.delivery is null" in squash(cur.calls[0][0]) and "co.is_active" in squash(cur.calls[0][0])
      and cur.calls[0][1] == {"course": "phys-215"})

cur = Cur([[{"n": 0}], [{"n": 1}], [{"n": 1}], []])
out = io.StringIO()
saved = sys.stdout
sys.stdout = out
try:
    LA.cmd_worklist(Args(), Conn(cur))
finally:
    sys.stdout = saved
check("with no null delivery the marker column and the ai_drafted option are looked up, then the worklist query is sent", len(cur.calls) == 4)
wsql, wparams = cur.calls[3]
w = squash(wsql)
check("it keeps only published work", "and ao.is_published" in w)
check("it requires a graded path that is eligible: a tutor, or a typed response drafted by AI or entered the older way",
      "oa.grading_role = 'graded'" in w and "/*ELIGIBLE*/" not in w
      and "oa.delivery = 'interactive_tutor'" in w and "oa.grading = 'ai_drafted'" in w
      and "ao.entered_on_new_page" in w)
check("it does not read kind", "kind_id" not in w)
check("an empty answer still prints the existing message", "Nothing past due" in out.getvalue()
      or '"items": []' in out.getvalue())

# ──────────────────────────────────────────────────────────────────────────────────────────────
section("create_course_offering.py: the active flag is stated, never defaulted")
p = CC.build_parser()
base = ["--course-code", "phys-310", "--course-title", "Physics 310", "--term", "fall-2026",
        "--director", "Someone"]
check("without --active or --inactive the parser exits non-zero",
      exits(lambda: p.parse_args(base)) not in (None, 0))
check("both together is refused", exits(lambda: p.parse_args(base + ["--active", "--inactive"])) not in (None, 0))
eq("--active gives True", p.parse_args(base + ["--active"]).is_active, True)
eq("--inactive gives False", p.parse_args(base + ["--inactive"]).is_active, False)


class InsCur:
    def __init__(self):
        self.calls = []

    def execute(self, sql, params=None):
        self.calls.append((sql, params))

    def fetchone(self):
        return ("new-id",)


for flag in (True, False):
    ic = InsCur()
    CC.insert_offering(ic, "course-1", "term-1", flag)
    eq(f"insert_offering writes is_active={flag} as a parameter", ic.calls[0][1], ("course-1", "term-1", flag))
check("the insert statement no longer hard-codes true", "true" not in squash(ic.calls[0][0]).lower().split("values")[1])
try:
    CC.insert_offering(InsCur(), "c", "t", None)
    refused = False
except TypeError:
    refused = True
check("an unstated flag is refused", refused)

print(f"\n{PASSED} passed, {FAILED} failed")
sys.exit(1 if FAILED else 0)
