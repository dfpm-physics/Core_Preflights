#!/usr/bin/env python
"""Read back the rows the old-page write walkthrough touches. STAGING only, read-only. Prints one JSON object.

Used by v2-old-writes.mjs, which drives the older pages in a browser and asks this script what the database
holds before and after each write. It reads STAGING_DB_URL and refuses anything but the staging project.
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
    out = {}

    def one(sql, args=()):
        cur.execute(sql, args)
        return cur.fetchone()

    r = one("""SELECT a.title, a.description, a.kind_id, ao.points_possible::text, ao.is_published, ao.entered_on_new_page,
                      (SELECT json_agg(json_build_array(x.modality, oa.grading_role, oa.delivery, oa.grading, oa.warn_earns_full)
                                       ORDER BY x.modality)
                         FROM offering_activities oa JOIN activities x ON x.id = oa.activity_id
                        WHERE oa.assignment_offering_id = ao.id)
                 FROM assignment_offerings ao JOIN assignments a ON a.id = ao.assignment_id WHERE a.slug = 'test-lesson-06'""")
    out["lesson6"] = {"title": r[0], "description": r[1], "kind": r[2], "points": r[3], "published": r[4],
                      "new_page": r[5], "paths": r[6]}
    r = one("""SELECT ao.is_published FROM assignment_offerings ao JOIN assignments a ON a.id = ao.assignment_id
                WHERE a.slug = 'test-lesson-04'""")
    out["lesson4"] = {"published": r[0]}
    r = one("""SELECT g.question_scores, g.is_finalized, g.points_earned::text, g.source
                 FROM grades g JOIN enrollments e ON e.id = g.enrollment_id
                 JOIN assignment_offerings ao ON ao.id = g.assignment_offering_id
                 JOIN assignments a ON a.id = ao.assignment_id
                WHERE e.student_id = 3000000104 AND a.slug = 'test-lesson-01'""")
    out["grade104"] = None if not r else {
        "status": {k: v.get("status") for k, v in (r[0] or {}).items()}, "finalized": r[1], "points": r[2], "source": r[3]}
    r = one("""SELECT sub.status, sub.committed_at IS NOT NULL,
                      (SELECT count(*) FROM submission_activities sa WHERE sa.submission_id = sub.id)
                 FROM submissions sub JOIN enrollments e ON e.id = sub.enrollment_id
                 JOIN assignment_offerings ao ON ao.id = sub.assignment_offering_id
                 JOIN assignments a ON a.id = ao.assignment_id
                WHERE e.student_id = 3009999999 AND a.slug = 'test-lesson-05'""")
    out["sub999"] = None if not r else {"status": r[0], "committed": r[1], "activities": r[2]}
    print(json.dumps(out))
    conn.rollback()


if __name__ == "__main__":
    main()
