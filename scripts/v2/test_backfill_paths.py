#!/usr/bin/env python3
"""Offline checks for backfill_paths.py. No database, no credentials, no network.

It proves which targets the script will and will not write, and that its one write statement names one
table and touches only rows whose delivery is still NULL. The behaviour against a real database (dry run,
commit, commit again writes 0) is shown by running the script on the staging project.

Usage:  python scripts/v2/test_backfill_paths.py
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import backfill_paths as bp  # noqa: E402

STAGING = bp.db_target.STAGING_REF
LIVE = bp.db_target.PRODUCTION_REF
passed = failed = 0


def check(name, ok):
    global passed, failed
    passed += ok
    failed += not ok
    print(f"  [{'pass' if ok else 'FAIL'}] {name}")


def url(ref, host="aws-0-us-east-1.pooler.supabase.com"):
    return f"postgresql://postgres.{ref}:not-a-real-password@{host}:5432/postgres"  # allowlist-secret: a made-up string, not a credential


def refuses(fn):
    try:
        fn()
    except SystemExit as exc:
        return str(exc).startswith("REFUSED")
    return False


print("=== which target is accepted ===")
check("the staging project, with a matching --expect-ref, is accepted",
      bp.check_target(url(STAGING), STAGING, False).ref == STAGING)
check("a mismatched --expect-ref is refused", refuses(lambda: bp.check_target(url(STAGING), "someotherref", False)))
check("the live project is refused without --allow-production-write",
      refuses(lambda: bp.check_target(url(LIVE), LIVE, False)))
check("the live project is accepted only with the flag and a matching --expect-ref",
      bp.check_target(url(LIVE), LIVE, True).ref == LIVE)
check("the live project with the flag but the wrong --expect-ref is refused",
      refuses(lambda: bp.check_target(url(LIVE), STAGING, True)))
check("a third project is refused even with the flag", refuses(lambda: bp.check_target(url("abcdefghijklmnopqrst"), "abcdefghijklmnopqrst", True)))
check("a host the parser does not accept is refused", refuses(lambda: bp.check_target(url(STAGING, "evil.example.com"), STAGING, False)))
check("an empty URL is refused", refuses(lambda: bp.check_target("", STAGING, False)))

print("\n=== the write ===")
sql = re.sub(r"\s+", " ", bp.UPDATE_SQL)
check("one UPDATE, on offering_activities only", sql.count("UPDATE ") == 1 and "UPDATE app.offering_activities" in sql)
check("it touches only rows whose delivery is NULL", "oa.delivery IS NULL" in sql)
check("it knows two modalities and nothing else", "a.modality IN ('written', 'interactive')" in sql)
check("it fills delivery, grading and warn_earns_full", all(c in sql for c in ("delivery =", "grading =", "warn_earns_full =")))
check("it never names grades, submissions or assignment_offerings as a target",
      not re.search(r"UPDATE app\.(grades|submissions|assignment_offerings)", sql))
check("the scope query is limited to delivery IS NULL", "WHERE oa.delivery IS NULL" in re.sub(r"\s+", " ", bp.SCOPE_SQL))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
