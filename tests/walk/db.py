#!/usr/bin/env python
"""Read and write helper for the walk. STAGING only: it refuses any other project.

  python db.py sql "<select ...>"      read-only query, prints JSON rows
  python db.py exec <json-file>        runs the statements in the file (a list of [sql, params]) in one transaction
Reads STAGING_DB_URL from the environment. Never prints it.
"""
import datetime
import decimal
import json
import os
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "app-schema"))
from staging_guard import require_staging  # noqa: E402


def connect():
    url = os.environ.get("STAGING_DB_URL", "").strip()
    require_staging(url)
    import psycopg2
    conn = psycopg2.connect(url, connect_timeout=15)
    return conn


def jd(o):
    if isinstance(o, (datetime.datetime, datetime.date)):
        return o.isoformat()
    if isinstance(o, (decimal.Decimal, uuid.UUID)):
        return str(o)
    raise TypeError(type(o))


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    mode = sys.argv[1]
    conn = connect()
    if mode == "sql":
        conn.set_session(readonly=True)
    cur = conn.cursor()
    cur.execute("SET search_path = app, public, extensions")
    if mode == "sql":
        cur.execute(sys.argv[2])
        cols = [d[0] for d in cur.description]
        print(json.dumps([dict(zip(cols, r)) for r in cur.fetchall()], default=jd))
    elif mode == "exec":
        stmts = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
        out = []
        for sql, params in stmts:
            cur.execute(sql, params or None)
            if cur.description:
                cols = [d[0] for d in cur.description]
                out.append([dict(zip(cols, r)) for r in cur.fetchall()])
        conn.commit()
        print(json.dumps(out, default=jd))
    else:
        sys.exit(__doc__)


main()
