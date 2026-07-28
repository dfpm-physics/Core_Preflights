#!/usr/bin/env python
"""Report any lesson content shared between two course offerings. READ-ONLY.

THE INVARIANT
    No `activities` row — and no `assignments` container — may be scheduled in more than one
    course offering. One term's content belongs to that term.

WHY IT NEEDS A CHECKER RATHER THAN A CONSTRAINT
    The rule cannot be a database constraint without DDL, and DDL on `app` is sealed behind a
    human unsealing `prep_app_owner` (CORE.md §0). The browser enforces it going forward —
    `saveLesson()` copies a container rather than sharing it — but that enforcement is subject to
    RLS: `ao_read_staff` scopes `assignment_offerings` to offerings the caller staffs, so a term
    run entirely by somebody else is invisible to the page and the copy does not trigger. This
    script runs as the `read` tier, which is not subject to RLS, so it sees every offering and
    reports what the browser could not.

WHAT SHARING COSTS, WHEN IT EXISTS
    Editing a lesson in one term silently rewrites the other's questions; replacing an interaction
    deletes the other term's student reports (or, since the guard landed, is refused outright and
    the lesson cannot be fixed at all); and `activities_write` is scoped by COURSE, so a director
    of any offering of that course can write all of it. Full history:
    docs/decisions/PER-OFFERING-CONTENT-ISOLATION.md.

Exit status: 0 when nothing is shared, 1 when something is — so it can gate a migration or a
release step. Writes nothing, ever.

Usage (from the repo root, via the project venv):
  .venv/Scripts/python supabase/admin/content_isolation_check.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:  # pragma: no cover - environment guard
    sys.exit("psycopg2 not found — use the project .venv (pip install -r requirements.txt).")

from app_tier_check import read_env  # noqa: E402

ENV_FILE = Path(__file__).resolve().parent / ".env"

SHARED_ACTIVITIES = """
SELECT a.slug, a.modality,
       count(DISTINCT ao.course_offering_id)                        AS offerings,
       string_agg(DISTINCT c.code || ' / ' || t.label, '; ')        AS terms,
       (SELECT count(*) FROM app.submission_activities sa
         WHERE sa.activity_id = a.id)                               AS reports
  FROM app.activities a
  JOIN app.offering_activities oa   ON oa.activity_id = a.id
  JOIN app.assignment_offerings ao  ON ao.id = oa.assignment_offering_id
  JOIN app.course_offerings co      ON co.id = ao.course_offering_id
  JOIN app.courses c                ON c.id = co.course_id
  JOIN app.terms t                  ON t.id = co.term_id
 GROUP BY a.id, a.slug, a.modality
HAVING count(DISTINCT ao.course_offering_id) > 1
 ORDER BY a.modality, a.slug
"""

SHARED_ASSIGNMENTS = """
SELECT asg.slug,
       count(DISTINCT ao.course_offering_id)                        AS offerings,
       string_agg(DISTINCT c.code || ' / ' || t.label, '; ')        AS terms
  FROM app.assignments asg
  JOIN app.assignment_offerings ao ON ao.assignment_id = asg.id
  JOIN app.course_offerings co     ON co.id = ao.course_offering_id
  JOIN app.courses c               ON c.id = co.course_id
  JOIN app.terms t                 ON t.id = co.term_id
 GROUP BY asg.id, asg.slug
HAVING count(DISTINCT ao.course_offering_id) > 1
 ORDER BY asg.slug
"""


def connect_read(env):
    """The SELECT-only tier, over the session pooler (which wants role.project_ref as the user)."""
    missing = [k for k in ("PREP_DB_HOST", "PREP_PROJECT_REF",
                           "PREP_APP_READ_ROLE", "PREP_APP_READ_PASSWORD") if not env.get(k)]
    if missing:
        sys.exit(f"supabase/admin/.env is missing: {', '.join(missing)}")
    conn = psycopg2.connect(
        host=env["PREP_DB_HOST"], port=env.get("PREP_DB_PORT", "5432"),
        dbname=env.get("PREP_DB_NAME", "postgres"),
        user=f'{env["PREP_APP_READ_ROLE"]}.{env["PREP_PROJECT_REF"]}',
        password=env["PREP_APP_READ_PASSWORD"],
        sslmode=env.get("PREP_DB_SSLMODE", "require"),
    )
    # Belt and braces: the tier has no write grant, and the session refuses one anyway.
    conn.set_session(readonly=True, autocommit=True)
    return conn


def main():
    # Term labels carry an em dash ("TRAINING SANDBOX - Fall 2026" is written with one), and the
    # Windows console defaults to cp1252, which renders it as a replacement box.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # pragma: no cover - older/unusual stdout
        pass
    if not ENV_FILE.is_file():
        sys.exit("supabase/admin/.env not found — see CORE.md §3.")
    conn = connect_read(read_env(ENV_FILE))
    cur = conn.cursor(cursor_factory=RealDictCursor)

    cur.execute(SHARED_ACTIVITIES)
    activities = cur.fetchall()
    cur.execute(SHARED_ASSIGNMENTS)
    assignments = cur.fetchall()

    cur.close()
    conn.close()

    if not activities and not assignments:
        print("[ok] No content is shared between course offerings.")
        return 0

    if assignments:
        print(f"\n[SHARED] {len(assignments)} assignment container(s) scheduled in >1 offering:")
        for r in assignments:
            print(f"  {r['slug']:<28} {r['offerings']} offerings — {r['terms']}")

    if activities:
        print(f"\n[SHARED] {len(activities)} activity row(s) scheduled in >1 offering:")
        at_risk = 0
        for r in activities:
            at_risk += r["reports"]
            flag = f"  ** {r['reports']} student report(s) **" if r["reports"] else ""
            print(f"  {r['slug']:<52} {r['modality']:<12} {r['terms']}{flag}")
        print(f"\n  {at_risk} student report(s) hang off shared rows — a delete or an interaction")
        print("  swap in EITHER term reaches all of them.")

    print("\nFix: give each offering its own copy. See docs/decisions/PER-OFFERING-CONTENT-ISOLATION.md")
    return 1


if __name__ == "__main__":
    sys.exit(main())
