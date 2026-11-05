#!/usr/bin/env python
"""Read-only catalogue checks against the STAGING database, for the live suite.

Reads STAGING_DB_URL from the environment and refuses anything that is not exactly the staging
project (staging_guard.py). The session is read-only. Prints one line per check and exits non-zero
when any fails.

Checks
  pins   every function and procedure in schema app stores a search_path that starts with
         `search_path=app`. A function added without one fails here, the day it is added.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from staging_guard import require_staging  # noqa: E402

PINS = """
SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'app' AND p.prokind IN ('f', 'p')
   AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c
                    WHERE c LIKE 'search\_path=app%')
 ORDER BY 1
"""


def main():
    url = os.environ.get("STAGING_DB_URL", "").strip()
    require_staging(url)
    import psycopg2

    conn = psycopg2.connect(url, connect_timeout=15)
    conn.set_session(readonly=True, autocommit=True)
    cur = conn.cursor()
    cur.execute(PINS)
    unpinned = [r[0] for r in cur.fetchall()]
    conn.close()
    if unpinned:
        print("FAIL pins: functions in app without a search_path pinned to app: " + ", ".join(unpinned))
        return 1
    print("PASS pins: every function in app pins its search_path to app")
    return 0


if __name__ == "__main__":
    sys.exit(main())
