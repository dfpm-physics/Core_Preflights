#!/usr/bin/env python3
"""Offline checks for the nightly worklist's eligibility text (supabase/admin/lesson_aggregate.py).

No database, no credential, no network. The module itself needs a database driver to import, so this reads its source,
pulls out the three small builders with `ast`, and runs those. The behaviour over real rows is shown by the scratch
proof (scripts/staging/test_ai_drafted_scratch.py).

Usage:  python scripts/checks/worklist_eligibility_test.py
"""
import ast
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parents[2] / "supabase" / "admin" / "lesson_aggregate.py"
WANT = {"_old_shape_sql", "eligible_path_sql", "ineligible_typed_sql"}
passed = failed = 0


def check(name, ok):
    global passed, failed
    passed += bool(ok)
    failed += not ok
    print(f"  [{'pass' if ok else 'FAIL'}] {name}")


tree = ast.parse(SRC.read_text(encoding="utf-8"))
ns = {}
code = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in WANT], type_ignores=[])
exec(compile(code, str(SRC), "exec"), ns)  # noqa: S102  (our own source, three pure functions)
elig, inelig, old = ns["eligible_path_sql"], ns["ineligible_typed_sql"], ns["_old_shape_sql"]

print("with the marker column (the normal case)")
check("Fall's human_graded typed response is kept by 'not entered on a newer page'",
      "not ao.entered_on_new_page" in elig("oa", "ao", True, True))
check("an ai_drafted typed response and a tutor path are eligible",
      "oa.grading = 'ai_drafted'" in elig("oa", "ao", True, True) and "oa.delivery = 'interactive_tutor'" in elig("oa", "ao", True, True))
check("the ineligible test is the typed response a person marks",
      inelig("ob", "ao", True, True) == "(ob.delivery = 'typed_response' and not (ob.grading = 'ai_drafted' or not ao.entered_on_new_page))")

print("with no marker column")
check("a database older than the ai_drafted option: every typed response is the Fall shape", old("ao", False, False) == "true")
check("a database that has the ai_drafted option and no marker (the marker dropped later): none is, so it does not widen",
      old("ao", False, True) == "false")
check("that case offers no human_graded typed response",
      "or false)" in elig("oa", "ao", False, True) and "or true)" not in elig("oa", "ao", False, True))
check("that case treats a human_graded typed response as one to skip", "or false))" in inelig("ob", "ao", False, True))

print("wiring")
src = SRC.read_text(encoding="utf-8")
check("the worklist leaves out an offering with a typed path a person marks", "/*INELIGIBLE*/" in src and "ineligible_typed_sql(\"ob\"" in src)
check("both pull queries withhold the written side of such a path", src.count("and not /*SKIP*/") >= 4)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
