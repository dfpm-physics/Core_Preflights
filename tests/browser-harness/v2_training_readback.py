#!/usr/bin/env python
"""Read back the rows the training-offering walkthrough touches. STAGING only, read-only. Prints one JSON object.

Used by v2-training-inactive.mjs. It reads STAGING_DB_URL and refuses anything but the staging project.
"""
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "app-schema"))
from staging_guard import require_staging  # noqa: E402


def main():
    url = os.environ.get("STAGING_DB_URL", "").strip()
    require_staging(url)
    import psycopg2
    conn = psycopg2.connect(url, connect_timeout=15)
    conn.set_session(readonly=True)
    cur = conn.cursor()
    cur.execute("SET search_path = app, public, extensions")

    def pub(slug):
        cur.execute("SELECT ao.is_published FROM assignment_offerings ao JOIN assignments a ON a.id = ao.assignment_id WHERE a.slug = %s", (slug,))
        return cur.fetchone()[0]
    cur.execute("SELECT description FROM assignments WHERE slug = 'gate-tr-1'")
    desc = cur.fetchone()[0]
    cur.execute("""SELECT (SELECT count(*) FROM submissions x JOIN assignment_offerings ao ON ao.id = x.assignment_offering_id
                            JOIN course_offerings co ON co.id = ao.course_offering_id JOIN courses c ON c.id = co.course_id WHERE c.code = 'gate-train'),
                          (SELECT count(*) FROM grades g JOIN assignment_offerings ao ON ao.id = g.assignment_offering_id
                            JOIN course_offerings co ON co.id = ao.course_offering_id JOIN courses c ON c.id = co.course_id WHERE c.code = 'gate-train'),
                          (SELECT count(*) FROM grades g JOIN assignment_offerings ao ON ao.id = g.assignment_offering_id
                            JOIN course_offerings co ON co.id = ao.course_offering_id JOIN courses c ON c.id = co.course_id
                           WHERE c.code = 'gate-train' AND g.is_finalized)""")
    counts = cur.fetchone()
    print(json.dumps({"tr1_description": desc, "tr1_published": pub("gate-tr-1"), "tr7_published": pub("gate-tr-7"),
                      "rl3_published": pub("gate-rl-3"), "counts": counts}))


if __name__ == "__main__":
    main()
