#!/usr/bin/env python
"""Stand up a course in schema `app`: the catalogue entry, one term's offering, and its director.

Three inserts that must happen together and in order, because each depends on the one before:

    courses              the catalogue entry — "Physics 310", independent of any semester
      -> course_offerings the term's run of it — "Physics 310, Fall 2026"
        -> staff_assignments  who runs that offering (section_id NULL = offering-wide)

Doing this by hand is three ad-hoc INSERTs against a live database shared by several agents, and
the failure mode is a half-built course: a catalogue row with no offering renders nowhere, and an
offering with no director locks everyone out of its own admin page. Hence one idempotent script.

DELIBERATELY NOT DONE HERE — sections, enrollments, and assignments. Those are the roster and
authoring workflows (`site/js/roster-import.js`, `site/faculty/lessons.html`), and folding them in
would make this a second, divergent path to the same tables. This script gets a course to the
point where those tools can see it.

IDEMPOTENT. Every step matches on the natural key first (`courses.code`,
`(course_offering_id, term_id)`, `(instructor_id, course_offering_id, section_id)`), so a re-run
reports "exists" and changes nothing. The one thing it will UPDATE is a staff role that disagrees
with `--role`, and it says so before doing it.

DRY-RUN BY DEFAULT (CORE.md §4). Prints the plan and rolls back; `--commit` writes.

Requires DDL on nothing — this is pure DML, so it runs as `prep_app_dml` and never needs
`prep_app_owner` unsealed. Credentials come from supabase/admin/.env (gitignored).

Usage, from the repo root via the project venv:

  .venv/Scripts/python scripts/app/create_course_offering.py \
      --course-code phys-310 --course-title "Physics 310" \
      --term fall-2026 --director "Matthew Recker"
  # ... review the plan, then re-run with --commit
"""
import argparse
import sys
from pathlib import Path

try:
    import psycopg2
except ImportError:
    sys.exit("psycopg2 not found — use the project .venv (pip install -r requirements.txt).")

REPO = Path(__file__).resolve().parents[2]
ENV_FILE = REPO / "supabase" / "admin" / ".env"

ADD, KEEP, CHANGE = "  [+]  ", "  [=]  ", "  [~]  "


def read_env(path):
    """Minimal KEY=VALUE parser — stdlib only, matching supabase/admin/app_tier_check.py."""
    out = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        out[key.strip()] = val
    return out


def connect():
    if not ENV_FILE.is_file():
        sys.exit(f"No credentials at {ENV_FILE} — see supabase/admin/app_schema_bootstrap.sql.")
    env = read_env(ENV_FILE)
    for key in ("PREP_DB_HOST", "PREP_PROJECT_REF", "PREP_APP_DML_ROLE", "PREP_APP_DML_PASSWORD"):
        if not env.get(key):
            sys.exit(f"{ENV_FILE} is missing {key}.")
    return psycopg2.connect(
        host=env["PREP_DB_HOST"],
        port=env.get("PREP_DB_PORT", "5432"),
        dbname=env.get("PREP_DB_NAME", "postgres"),
        user=f"{env['PREP_APP_DML_ROLE']}.{env['PREP_PROJECT_REF']}",
        password=env["PREP_APP_DML_PASSWORD"],
        sslmode=env.get("PREP_DB_SSLMODE", "require"),
        connect_timeout=20,
    )


def resolve_director(cur, who):
    """Accept an instructors.id uuid or an exact name; refuse an ambiguous match.

    Names are matched case-insensitively but exactly — no LIKE. Picking the wrong instructor
    hands course-director authority to a colleague, so a near-miss must fail loudly.
    """
    cur.execute("select id, name from instructors where id::text = %s", (who,))
    row = cur.fetchone()
    if row:
        return row
    cur.execute("select id, name from instructors where lower(name) = lower(%s)", (who,))
    rows = cur.fetchall()
    if not rows:
        sys.exit(f"No instructor matches '{who}'. Pass an exact name or an instructors.id uuid.")
    if len(rows) > 1:
        listing = ", ".join(f"{n} ({i})" for i, n in rows)
        sys.exit(f"'{who}' is ambiguous — {listing}. Pass the uuid.")
    return rows[0]


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--course-code", required=True, help="e.g. phys-310")
    ap.add_argument("--course-title", required=True, help='e.g. "Physics 310"')
    ap.add_argument("--department", default=None, help="optional; courses.department")
    ap.add_argument("--term", required=True, help="terms.code, e.g. fall-2026")
    ap.add_argument("--director", required=True,
                    help="instructors.name (exact) or instructors.id uuid")
    ap.add_argument("--role", default="director", choices=("director", "instructor"),
                    help="staff_assignments.role for --director (default: director)")
    ap.add_argument("--commit", action="store_true", help="write; otherwise roll back")
    args = ap.parse_args()

    conn = connect()
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("set search_path = app, public")
    cur.execute("select current_user")
    print(f"[connect] {cur.fetchone()[0]}")
    print(f"[mode]    {'COMMIT — this writes to the live database' if args.commit else 'DRY RUN — nothing persists'}\n")

    # The term must already exist. Creating one here would let a typo ('fall-26') silently
    # produce a second, near-identical term that splits a semester's data in two.
    cur.execute("select id, label from terms where code = %s", (args.term,))
    term = cur.fetchone()
    if not term:
        cur.execute("select code from terms order by code")
        sys.exit(f"No term '{args.term}'. Existing: {', '.join(c for (c,) in cur.fetchall())}")
    term_id, term_label = term
    print(f"{KEEP}term            {args.term} ({term_label})  {term_id}")

    director_id, director_name = resolve_director(cur, args.director)
    print(f"{KEEP}instructor      {director_name}  {director_id}")

    # 1 — courses
    cur.execute("select id, title, department from courses where code = %s", (args.course_code,))
    row = cur.fetchone()
    if row:
        course_id, title, dept = row
        print(f"{KEEP}course          {args.course_code} already exists — '{title}'  {course_id}")
        if title != args.course_title:
            print(f"       NOTE: existing title '{title}' differs from --course-title "
                  f"'{args.course_title}'; left as-is (rename is not this script's job).")
    else:
        cur.execute(
            "insert into courses (code, title, department) values (%s, %s, %s) returning id",
            (args.course_code, args.course_title, args.department),
        )
        course_id = cur.fetchone()[0]
        print(f"{ADD}course          {args.course_code} '{args.course_title}'"
              f"{' dept=' + args.department if args.department else ''}  {course_id}")

    # 2 — course_offerings
    cur.execute(
        "select id, is_active from course_offerings where course_id = %s and term_id = %s",
        (course_id, term_id),
    )
    row = cur.fetchone()
    if row:
        offering_id, is_active = row
        print(f"{KEEP}offering        {args.course_code} / {args.term} already exists "
              f"(is_active={is_active})  {offering_id}")
    else:
        cur.execute(
            "insert into course_offerings (course_id, term_id, is_active) "
            "values (%s, %s, true) returning id",
            (course_id, term_id),
        )
        offering_id = cur.fetchone()[0]
        print(f"{ADD}offering        {args.course_code} / {args.term}  {offering_id}")

    # 3 — staff_assignments, offering-wide (section_id NULL). The offering-wide row is what
    # grants access to the whole course; per-section rows are added later for what they teach.
    cur.execute(
        "select id, role from staff_assignments "
        " where instructor_id = %s and course_offering_id = %s and section_id is null",
        (director_id, offering_id),
    )
    row = cur.fetchone()
    if row:
        staff_id, role = row
        if role == args.role:
            print(f"{KEEP}staff           {director_name} is already {role} of this offering  {staff_id}")
        else:
            cur.execute("update staff_assignments set role = %s where id = %s", (args.role, staff_id))
            print(f"{CHANGE}staff           {director_name}: {role} -> {args.role}  {staff_id}")
    else:
        cur.execute(
            "insert into staff_assignments (instructor_id, course_offering_id, section_id, role) "
            "values (%s, %s, null, %s) returning id",
            (director_id, offering_id, args.role),
        )
        staff_id = cur.fetchone()[0]
        print(f"{ADD}staff           {director_name} as {args.role} (offering-wide)  {staff_id}")

    # Read the result back inside the same transaction, so the dry run shows the same rows the
    # commit would leave behind.
    print("\n-- read-back --")
    cur.execute("""
        select c.code, c.title, coalesce(c.department, ''), t.code, co.is_active,
               i.name, sa.role, co.id
          from course_offerings co
          join courses     c  on c.id = co.course_id
          join terms       t  on t.id = co.term_id
          left join staff_assignments sa
                 on sa.course_offering_id = co.id and sa.section_id is null
          left join instructors i on i.id = sa.instructor_id
         where co.id = %s
         order by i.name
    """, (offering_id,))
    for code, title, dept, tcode, active, name, role, oid in cur.fetchall():
        print(f"  {code} '{title}'{(' dept=' + dept) if dept else ''} / {tcode} "
              f"active={active} offering={oid}")
        print(f"    staff: {name or '(none)'} — {role or '-'}")

    cur.execute("select count(*) from sections where course_offering_id = %s", (offering_id,))
    n_sections = cur.fetchone()[0]
    cur.execute("select count(*) from assignment_offerings where course_offering_id = %s", (offering_id,))
    n_assignments = cur.fetchone()[0]
    print(f"    sections: {n_sections}   assignment offerings: {n_assignments}")

    if args.commit:
        conn.commit()
        print("\nCOMMITTED.")
    else:
        conn.rollback()
        print("\nROLLED BACK (dry run). Re-run with --commit to write.")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
