#!/usr/bin/env python
"""Signed-in checks of the v2 functions and tables on STAGING, on the gate seed (seed_v2_gate.py).

Three parts.

  1. REAL sign-ins over the same REST API the site uses (gate staff, a gate cadet, and a cadet in neither
     gate course). At step 1 the total, deadline and release functions are granted to NO browser role, so every
     signed-in caller must be refused; the functions that ARE granted (scale_change_preview, set_prog_flag,
     current_letter_scale, default_letter_scale) must answer by role; a student must read 0 rows of every
     staff-only table, above all question_keys; staff must read what their role allows (so the zero is not
     just an empty table).
  2. The same functions with the STEP 2 grant simulated: inside a transaction that is rolled back, EXECUTE is
     granted to `authenticated`, the session switches to that role with the caller's id in the token, and the
     functions are called as staff and as students. That is the only way to call them as a signed-in user
     before step 2, and it leaves nothing behind. The seed must be present (run seed_v2_gate.py first).
  3. Agreement: for three cadets, my_course_total, course_totals and the internal total return the same
     earned, possible, percent and exact-key strings.

Reads STAGING_DB_URL (refuses anything but staging) and the staging REST address from site/js/config.js.
Prints one line per check and "N passed, M failed". Exits non-zero on a failure.
"""
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "scripts" / "staging"))
from staging_guard import require_staging  # noqa: E402
from seed_staging import rest  # noqa: E402
from serve_local import read_targets  # noqa: E402
import uuid  # noqa: E402

DOMAIN = "prep-staging.example"
GATE_NS = uuid.UUID("0b4f6a52-91d3-4c57-8e0a-5c3f2d9b7a41")   # the seed's namespace
passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"PASS {name}")
    else:
        failed += 1
        print(f"FAIL {name}" + (f"  [{detail}]" if detail else ""))


def uid(kind, key):
    return str(uuid.uuid5(GATE_NS, f"{kind}:{key}"))


STAFF_ONLY_TABLES = ["part_sets", "questions", "question_keys", "question_attempts", "submission_receipts",
                     "key_remark_runs", "letter_scales", "grade_excusals", "grade_excusal_events", "column_closures",
                     "course_offering_settings", "course_grade_history", "student_groups", "student_group_members",
                     "student_group_snapshots", "student_group_grades", "grade_checkpoint_runs",
                     "grade_checkpoint_rows", "checkpoint_tie_choices"]
WRAPPERS = {   # function -> body, granted to nobody at step 1
    "gradebook_cells": lambda co: {"p_course_offering": co, "p_scope": "final"},
    "course_totals": lambda co: {"p_course_offering": co, "p_scope": "final"},
    "my_course_total": lambda co: {"p_course_offering": co, "p_scope": "final"},
    "scheduled_deadline": lambda co: {"p_assignment_offering": co, "p_section": co},
    "effective_deadline": lambda co: {"p_enrollment": co, "p_assignment_offering": co},
    "release_at": lambda co: {"p_assignment_offering": co, "p_section": co},
    "_cells_at": lambda co: {"p_course_offering": co, "p_scope": "final", "p_now": "2026-11-04T12:00:00Z"},
    "_totals_at": lambda co: {"p_course_offering": co, "p_scope": "final", "p_now": "2026-11-04T12:00:00Z"},
    "deadline_rows": lambda co: {"p_course_offering": co},
}


def signin(url, key, email, password):
    status, session = rest(url, key, "/auth/v1/token?grant_type=password", method="POST",
                           body={"email": email, "password": password})
    return session["access_token"] if status == 200 and session else None


def part1(cur):
    _, staging = read_targets()
    url, key = staging["url"], staging["anon"]
    cur.execute("SELECT co.id, c.code FROM course_offerings co JOIN courses c ON c.id = co.course_id WHERE c.code IN ('gate-vector', 'gate-entry')")
    ids = {code: i for i, code in cur.fetchall()}
    vec, ent = ids["gate-vector"], ids["gate-entry"]

    users = {
        "director": (f"gatedirector@{DOMAIN}", "gatedirector1234"),
        "instructor": (f"gateinstructor@{DOMAIN}", "gateinstructor1234"),
        "gate cadet": (f"cadet0501@{DOMAIN}", "000501"),
        "entry cadet": (f"cadet0401@{DOMAIN}", "000401"),
        "outside cadet": (f"cadet101@{DOMAIN}", "000101"),
    }
    tok = {}
    for who, (email, pw) in users.items():
        tok[who] = signin(url, key, email, pw)
        check(f"signed in as {who} over the real sign-in endpoint", tok[who] is not None)
    if not all(tok.values()):
        return None

    # the functions nobody may call yet
    for who in tok:
        refused = []
        for fn, body in WRAPPERS.items():
            status, data = rest(url, key, f"/rest/v1/rpc/{fn}", tok[who], method="POST", body=body(vec))
            if not (status in (401, 403, 404) and data is None):
                refused.append((fn, status))
        check(f"{who}: every total, deadline and release function is refused at step 1", not refused, str(refused))

    # the functions that are granted answer by role
    def call(who, fn, body):
        return rest(url, key, f"/rest/v1/rpc/{fn}", tok[who], method="POST", body=body)

    status, data = call("gate cadet", "default_letter_scale", {})
    check("a student may call the pure default_letter_scale", status == 200 and data and len(data[0]["lines"]) == 10, str(status))
    status, data = call("director", "current_letter_scale", {"p_course_offering": vec})
    check("a director reads the current letter scale of the vector course", status == 200 and data and data[0]["is_default"] is True, str(status))
    check("a student is refused current_letter_scale", call("gate cadet", "current_letter_scale", {"p_course_offering": vec})[0] >= 400)
    lines = [{"letter": "P", "cutoff": 50, "gpa": 1.0}, {"letter": "F", "cutoff": 0, "gpa": 0.0}]
    body = {"p_course_offering": vec, "p_lines": lines, "p_width": 0.1}
    status, data = call("director", "scale_change_preview", body)
    check("a director's scale_change_preview lists the students whose letter would move", status == 200 and data and len(data) > 0, f"{status} {data and len(data)}")
    check("an instructor is refused scale_change_preview", call("instructor", "scale_change_preview", body)[0] >= 400)
    check("a student is refused scale_change_preview", call("gate cadet", "scale_change_preview", body)[0] >= 400)
    cur.execute("SELECT id FROM assignment_offerings WHERE assignment_id IN (SELECT id FROM assignments WHERE slug = 'gate-v1')")
    v1 = cur.fetchone()[0]
    status, data = call("instructor", "set_prog_flag", {"p_assignment_offering": v1, "p_value": True})
    check("an instructor of the offering may call set_prog_flag (value unchanged, so it reports false)", status == 200 and data is False, f"{status} {data}")
    check("a student is refused set_prog_flag", call("gate cadet", "set_prog_flag", {"p_assignment_offering": v1, "p_value": True})[0] >= 400)

    # tables: students see nothing, staff see what their role allows
    def count(who, table):
        """Rows read, or 0 when the table is refused outright (401, 403, 404). Any other failure is retried
        and then reported as None, so a transient error can never pass as 'zero rows'."""
        import time
        for _ in range(4):
            try:
                status, data = rest(url, key, f"/rest/v1/{table}?select=*&limit=500", tok[who])
            except OSError:                       # a read timeout is not 'zero rows': retry, then None
                status, data = 0, None
            if status == 200 and data is not None:
                return len(data)
            if status in (401, 403, 404):
                return 0
            time.sleep(1.5)
        return None

    for who in ("gate cadet", "entry cadet", "outside cadet"):
        bad = {t: count(who, t) for t in STAFF_ONLY_TABLES if count(who, t) != 0}
        check(f"{who} reads 0 rows of every staff-only v2 table", not bad, str(bad))
        check(f"{who} sees 0 rows from question_keys", count(who, "question_keys") == 0)
        check(f"{who} sees 0 rows from questions", count(who, "questions") == 0)
    director_keys = count("director", "question_keys")
    check("the director sees the keys (so the student's zero is not an empty table)", (director_keys or 0) >= 6, str(director_keys))
    check("the instructor of the vector course sees only that course's 2 keys, none of the entry course's",
          count("instructor", "question_keys") == 2, str(count("instructor", "question_keys")))
    # migration 040 moved the question policies into helper functions: writes must still be refused for everyone
    # but a director, and the refusal must leave the row as it was
    cur.execute("""SELECT k.id, q.id, q.activity_id FROM question_keys k JOIN questions q ON q.id = k.question_id
                    WHERE k.superseded_at IS NULL AND q.activity_id IN (
                          SELECT oa.activity_id FROM offering_activities oa JOIN assignment_offerings ao
                            ON ao.id = oa.assignment_offering_id WHERE ao.course_offering_id = %s) LIMIT 1""", (vec,))
    key_id, question_id, activity_id = cur.fetchone()
    for who in ("gate cadet", "instructor"):
        rest(url, key, f"/rest/v1/question_keys?id=eq.{key_id}", tok[who], method="PATCH",
             body={"superseded_at": "2030-01-01T00:00:00Z"})
        cur.execute("SELECT superseded_at IS NULL FROM question_keys WHERE id = %s", (key_id,))
        check(f"{who}: an update to a key changes nothing", cur.fetchone()[0] is True)
        status, _ = rest(url, key, "/rest/v1/question_keys", tok[who], method="POST",
                         body={"question_id": question_id, "version": 99, "written_by": "human", "variant_key": "",
                               "select_rule": "all_or_nothing", "sig_fig_mode": "ignore", "unit_mode": "ignore",
                               "correct_choice_ids": ["a"]})
        check(f"{who}: adding a key is refused", status >= 400, str(status))
        status, _ = rest(url, key, "/rest/v1/questions", tok[who], method="POST",
                         body={"activity_id": activity_id, "qid": "zz99", "position": 99, "format": "numeric",
                               "prompt_md": "x", "points": 1})
        check(f"{who}: adding a question is refused", status >= 400, str(status))
    cur.execute("SELECT count(*) FROM question_keys WHERE question_id = %s AND version = 99", (question_id,))
    check("... and neither left a key behind", cur.fetchone()[0] == 0)
    check("a student may read the lookup assignment_kinds", (count("gate cadet", "assignment_kinds") or 0) >= 7)
    check("the director sees the vector course's excusal; the instructor of section VM sees it too",
          count("director", "grade_excusals") == 1 and count("instructor", "grade_excusals") == 1,
          str((count("director", "grade_excusals"), count("instructor", "grade_excusals"))))
    check("the closed column belongs to section VT, so the instructor of VM does not see it",
          count("director", "column_closures") == 1 and count("instructor", "column_closures") == 0)
    check("the director reads the groups (2) and the instructor reads them too", count("director", "student_groups") == 2)
    return {"vec": vec, "ent": ent}


def as_user(cur, user_id):
    cur.execute("RESET ROLE")
    cur.execute("SET LOCAL ROLE authenticated")
    cur.execute("SELECT set_config('request.jwt.claims', %s, true), set_config('request.jwt.claim.sub', %s, true)",
                (json.dumps({"sub": user_id, "role": "authenticated"}), user_id))


def as_owner(cur):
    cur.execute("RESET ROLE")


def denied(cur, sql, args=()):
    cur.execute("SAVEPOINT d")
    try:
        cur.execute(sql, args)
        cur.fetchall()
        cur.execute("RELEASE SAVEPOINT d")
        return None
    except Exception as exc:  # noqa: BLE001
        cur.execute("ROLLBACK TO SAVEPOINT d")
        return str(exc).strip().splitlines()[0]


def part2(conn, ids):
    cur = conn.cursor()
    cur.execute("SET search_path = app, public, extensions")
    vec, ent = ids["vec"], ids["ent"]
    director, instructor = uid("user", "gatedirector"), uid("user", "gateinstructor")
    s501, s509, s515 = uid("user", 3000000501), uid("user", 3000000509), uid("user", 3000000515)
    outside = uid("user", "x")   # replaced below by the real cadet101 auth id
    cur.execute("SELECT auth_user_id FROM students WHERE student_id = 3000000101")
    outside = str(cur.fetchone()[0])
    try:
        # ---- step 1 as it stands: authenticated has no EXECUTE on the wrappers ----------------------
        as_user(cur, director)
        err = denied(cur, "SELECT * FROM app.gradebook_cells(%s, 'final')", (vec,))
        check("step 1 as it stands: even a director session cannot execute gradebook_cells (no grant)",
              err is not None and "permission denied" in err, str(err))
        as_owner(cur)

        # ---- simulate the step 2 grant, rolled back at the end ---------------------------------------
        cur.execute("GRANT EXECUTE ON FUNCTION app.gradebook_cells(uuid, text), app.course_totals(uuid, text), "
                    "app.my_course_total(uuid, text), app.scheduled_deadline(uuid, uuid), "
                    "app.effective_deadline(uuid, uuid), app.release_at(uuid, uuid) TO authenticated")

        cur.execute("SELECT count(*) FROM app._cells_at(%s, 'final', now())", (vec,))
        n_cells = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM app._totals_at(%s, 'final', now())", (vec,))
        n_tot = cur.fetchone()[0]
        cur.execute("SELECT enrollment_id, earned_text, possible_text, percent_text, percent_key_text, letter, rank FROM app._totals_at(%s, 'final', now())", (vec,))
        truth = {r[0]: r[1:] for r in cur.fetchall()}
        cur.execute("""SELECT e.id FROM enrollments e WHERE e.student_id = %s AND e.section_id IN
                         (SELECT id FROM sections WHERE course_offering_id = %s)""", (3000000501, vec))
        enr501 = cur.fetchone()[0]

        # director: whole course
        as_user(cur, director)
        cur.execute("SELECT count(*) FROM app.gradebook_cells(%s, 'final')", (vec,))
        check("director: gradebook_cells returns every cell of the course", cur.fetchone()[0] == n_cells)
        cur.execute("SELECT enrollment_id, earned_text, possible_text, percent_text, percent_key_text, letter, rank FROM app.course_totals(%s, 'final')", (vec,))
        got = {r[0]: r[1:] for r in cur.fetchall()}
        check("director: course_totals returns every enrollment, equal to the internal total", got == truth and len(got) == n_tot == 16, f"{len(got)} vs {n_tot}")
        check("director: the dropped enrollment is not in course_totals", len(got) == 16)
        err = denied(cur, "SELECT * FROM app.gradebook_cells(%s, 'final')", (ent,))
        check("director: the entry course has no published item, so its cells are empty (not an error)", err is None)
        cur.execute("SELECT * FROM app.scale_change_preview(%s, %s::jsonb, 0.1)", (vec, json.dumps([{"letter": "P", "cutoff": 50, "gpa": 1.0}, {"letter": "F", "cutoff": 0, "gpa": 0.0}])))
        check("director: scale_change_preview as a signed-in session lists changes", len(cur.fetchall()) > 0)
        cur.execute("SELECT * FROM app.scheduled_deadline((SELECT id FROM app.assignment_offerings WHERE assignment_id = (SELECT id FROM app.assignments WHERE slug = 'gate-v1')), (SELECT id FROM app.sections WHERE code = 'VM' AND course_offering_id = %s))", (vec,))
        sched = cur.fetchall()
        check("director: scheduled_deadline answers for a section of the course (source day)", len(sched) == 1 and sched[0][1] == "day", str(sched))

        # instructor of VM: one section, but the rank stays course-wide
        as_user(cur, instructor)
        cur.execute("SELECT count(DISTINCT section_id), count(*) FROM app.gradebook_cells(%s, 'final')", (vec,))
        secs, n = cur.fetchone()
        check("instructor of VM: gradebook_cells holds one section's cells only", secs == 1 and n == 64, str((secs, n)))
        cur.execute("SELECT enrollment_id, rank FROM app.course_totals(%s, 'final')", (vec,))
        rows = cur.fetchall()
        check("instructor of VM: course_totals holds 8 enrollments, with the course-wide rank",
              len(rows) == 8 and all(truth[e][5] == r for e, r in rows), str(len(rows)))
        err = denied(cur, "SELECT * FROM app.scale_change_preview(%s, '[{\"letter\":\"F\",\"cutoff\":0,\"gpa\":0}]'::jsonb, 0.1)", (vec,))
        check("instructor: scale_change_preview is refused (Director only)", err is not None and "not permitted" in err, str(err))

        # student 501
        as_user(cur, s501)
        cur.execute("SELECT state, points_earned, assignment_offering_id FROM app.gradebook_cells(%s, 'final')", (vec,))
        cells = cur.fetchall()
        check("student 501: gradebook_cells returns only that student's 8 cells", len(cells) == 8, str(len(cells)))
        held = [c for c in cells if c[0] == "submitted_ungraded" and c[1] is None]
        check("student 501: the held score is shown as submitted_ungraded with no points", len(held) == 1, str([(c[0], c[1]) for c in cells]))
        check("student 501: a released score is shown (141 earned in all)", sum(float(c[1]) for c in cells if c[1] is not None) == 141.0)
        cur.execute("SELECT earned_text, possible_text, percent_text, percent_key_text FROM app.my_course_total(%s, 'final')", (vec,))
        mine = cur.fetchall()
        check("student 501: my_course_total returns exactly the four strings, one row", len(mine) == 1 and mine[0][:2] == ("141", "140"), str(mine))
        err = denied(cur, "SELECT * FROM app.course_totals(%s, 'final')", (vec,))
        check("student 501: course_totals is refused", err is not None and "not permitted" in err, str(err))
        err = denied(cur, "SELECT * FROM app.scale_change_preview(%s, '[{\"letter\":\"F\",\"cutoff\":0,\"gpa\":0}]'::jsonb, 0.1)", (vec,))
        check("student 501: scale_change_preview is refused", err is not None and "not permitted" in err, str(err))
        err = denied(cur, "SELECT * FROM app.gradebook_cells(%s, 'final')", (ent,))
        check("student 501: the entry course is not theirs, so gradebook_cells is refused", err is not None and "not permitted" in err, str(err))
        cur.execute("SELECT count(*) FROM app.effective_deadline(%s, (SELECT id FROM app.assignment_offerings WHERE assignment_id = (SELECT id FROM app.assignments WHERE slug = 'gate-v1')))", (enr501,))
        check("student 501: effective_deadline answers for their own enrollment", cur.fetchone()[0] == 1)
        other = [e for e in truth if e != enr501][0]
        cur.execute("SELECT count(*) FROM app.effective_deadline(%s, (SELECT id FROM app.assignment_offerings WHERE assignment_id = (SELECT id FROM app.assignments WHERE slug = 'gate-v1')))", (other,))
        check("student 501: effective_deadline for someone else's enrollment returns nothing", cur.fetchone()[0] == 0)
        cur.execute("SELECT * FROM app.my_course_total(%s, 'final')", (ids["ent"],))
        check("student 501: my_course_total for a course they are not in returns no rows", cur.fetchall() == [])

        # a cadet in neither gate course
        as_user(cur, outside)
        err = denied(cur, "SELECT * FROM app.gradebook_cells(%s, 'final')", (vec,))
        check("outside cadet: gradebook_cells of the vector course is refused", err is not None and "not permitted" in err, str(err))
        cur.execute("SELECT * FROM app.my_course_total(%s, 'final')", (vec,))
        check("outside cadet: my_course_total of the vector course returns no rows", cur.fetchall() == [])
        cur.execute("SELECT count(*) FROM app.question_keys")
        check("outside cadet: a signed-in session reads 0 rows from question_keys", cur.fetchone()[0] == 0)

        # ---- agreement ---------------------------------------------------------------------------------
        for label, user, cid in (("501", s501, 3000000501), ("509", s509, 3000000509), ("515", s515, 3000000515)):
            as_owner(cur)
            cur.execute("""SELECT e.id FROM enrollments e WHERE e.student_id = %s AND e.section_id IN
                             (SELECT id FROM sections WHERE course_offering_id = %s)""", (cid, vec))
            enr = cur.fetchone()[0]
            as_user(cur, user)
            cur.execute("SELECT earned_text, possible_text, percent_text, percent_key_text FROM app.my_course_total(%s, 'final')", (vec,))
            mine = cur.fetchone()
            as_user(cur, director)
            cur.execute("SELECT earned_text, possible_text, percent_text, percent_key_text, letter FROM app.course_totals(%s, 'final') WHERE enrollment_id = %s", (vec, enr))
            staff = cur.fetchone()
            check(f"agreement {label}: my_course_total, course_totals and the internal total return the same strings",
                  mine == staff[:4] == truth[enr][:4], str((mine, staff, truth[enr][:4])))
    finally:
        conn.rollback()


def part3(conn, ids):
    """Migration 041 on the staging database: the two atomic saves, the author stamp and the helper grants.
    Every write happens inside this transaction as a signed-in session and is rolled back."""
    cur = conn.cursor()
    cur.execute("SET search_path = app, public, extensions")
    vec = ids["vec"]
    director, instructor = uid("user", "gatedirector"), uid("user", "gateinstructor")
    s501 = uid("user", 3000000501)
    try:
        # the grants: the new functions answer to signed-in users only
        cur.execute("""SELECT p.proname, bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')),
                              bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE'))
                         FROM pg_proc p WHERE p.pronamespace = 'app'::regnamespace
                          AND p.proname IN ('save_letter_scale', 'save_question', 'directed_activity_ids',
                                            'staff_visible_activity_ids', 'directed_question_ids', 'staff_visible_question_ids')
                        GROUP BY 1 ORDER BY 1""")
        rows = cur.fetchall()
        check("041: six functions exist, none callable by anon, all by authenticated",
              len(rows) == 6 and not any(r[1] for r in rows) and all(r[2] for r in rows), str(rows))
        cur.execute("""SELECT c.relname, CASE WHEN pg_get_userbyid(c.relowner) = 'prep_app_owner' AND NOT c.relforcerowsecurity
                                               THEN 'ok' ELSE 'LOOK' END
                         FROM pg_class c WHERE c.relnamespace = 'app'::regnamespace
                          AND c.relname IN ('activities', 'assignments', 'offering_activities', 'assignment_offerings',
                                            'questions', 'question_keys', 'instructors', 'staff_assignments', 'courses', 'course_offerings')""")
        own = cur.fetchall()
        check("041: the ten tables the helpers read are owned by the schema owner with FORCE off (all ok)",
              len(own) == 10 and all(r[1] == "ok" for r in own), str([r for r in own if r[1] != "ok"]))

        # ---- save_letter_scale ------------------------------------------------------------------------
        as_owner(cur)
        cur.execute("SELECT lines FROM app.default_letter_scale()")
        lines = json.dumps(cur.fetchone()[0])
        as_user(cur, director)
        cur.execute("SELECT version, is_default FROM app.current_letter_scale(%s)", (vec,))
        ver, is_def = cur.fetchone()
        expect = 0 if is_def else ver
        for who, label in ((s501, "a cadet"), (instructor, "an instructor")):
            as_user(cur, who)
            err = denied(cur, "SELECT app.save_letter_scale(%s, %s::jsonb, 0.1, %s)", (vec, lines, expect))
            check(f"041: {label} is refused save_letter_scale", err is not None and "not permitted" in err, str(err))
        as_user(cur, director)
        err = denied(cur, "SELECT app.save_letter_scale(%s, %s::jsonb, 0.1, %s)", (vec, lines, expect + 5))
        check("041: a director holding an old version is refused, and told why", err is not None and "changed since you opened" in err, str(err))
        cur.execute("SELECT app.save_letter_scale(%s, %s::jsonb, 0.1, %s)", (vec, lines, expect))
        new_ver = cur.fetchone()[0]
        check("041: a director with the right version saves the next version", new_ver == expect + 1, str(new_ver))
        as_owner(cur)
        cur.execute("SELECT count(*) FROM letter_scales WHERE course_offering_id = %s AND retired_at IS NULL", (vec,))
        check("041: exactly one scale is current afterwards", cur.fetchone()[0] == 1)
        cur.execute("SELECT created_by::text FROM letter_scales WHERE course_offering_id = %s AND version = %s", (vec, new_ver))
        check("041: the author is stamped from the sign-in, not from the page", cur.fetchone()[0] == director)

        # ---- save_question ----------------------------------------------------------------------------
        cur.execute("""SELECT q.id, q.updated_at, q.prompt_md, q.points, q.choices::text, q.unit_hint
                         FROM questions q WHERE q.activity_id IN (
                              SELECT oa.activity_id FROM offering_activities oa JOIN assignment_offerings ao
                                ON ao.id = oa.assignment_offering_id WHERE ao.course_offering_id = %s)
                          AND EXISTS (SELECT 1 FROM question_keys k WHERE k.question_id = q.id AND k.superseded_at IS NULL)
                        ORDER BY q.qid LIMIT 1""", (vec,))
        qid, stamp, prompt, points, choices, hint = cur.fetchone()
        cols = json.dumps({"prompt_md": prompt, "points": str(points), "choices": json.loads(choices) if choices else None, "unit_hint": hint})
        cur.execute("SELECT version FROM question_keys WHERE question_id = %s AND superseded_at IS NULL", (qid,))
        kv = cur.fetchone()[0]
        for who, label in ((s501, "a cadet"), (instructor, "an instructor")):
            as_user(cur, who)
            err = denied(cur, "SELECT * FROM app.save_question(%s, %s, %s::jsonb, false, null, %s)", (qid, stamp, cols, kv))
            check(f"041: {label} is refused save_question", err is not None and "not permitted" in err, str(err))
        as_user(cur, director)
        err = denied(cur, "SELECT * FROM app.save_question(%s, %s - interval '1 second', %s::jsonb, false, null, %s)", (qid, stamp, cols, kv))
        check("041: a question changed since it was opened is refused, and told why", err is not None and "this question changed since you opened it" in err, str(err))
        err = denied(cur, "SELECT * FROM app.save_question(%s, %s, %s::jsonb, true, '{\"reference_text\": null}'::jsonb, %s)", (qid, stamp, cols, kv + 7))
        check("041: a key changed since it was opened is refused, and told why", err is not None and "answer key changed since you opened" in err, str(err))
        as_owner(cur)
        cur.execute("SELECT version, superseded_at IS NULL FROM question_keys WHERE question_id = %s ORDER BY version", (qid,))
        after_refusals = cur.fetchall()
        check("041: the refusals left the key history exactly as it was (the current key still current)",
              any(r[0] == kv and r[1] for r in after_refusals) and max(r[0] for r in after_refusals) == kv, str(after_refusals))
        as_user(cur, director)
        cur.execute("SELECT * FROM app.save_question(%s, %s, %s::jsonb, true, '{\"reference_text\": \"note\"}'::jsonb, %s)", (qid, stamp, cols, kv))
        got = cur.fetchone()
        check("041: the right stamps save the question and write the next key version in one call", got == (kv + 1, True), str(got))
        as_owner(cur)
        cur.execute("SELECT count(*) FROM question_keys WHERE question_id = %s AND superseded_at IS NULL", (qid,))
        check("041: exactly one key is current afterwards", cur.fetchone()[0] == 1)
    finally:
        conn.rollback()


def part4(conn, ids):
    """Migrations 042 and 043 on the staging database. 042: the two save functions refuse what the pages refuse,
    instead of rounding it or turning it into NULL. 043: only a global admin changes an offering's Active flag,
    creates one active, or deletes one. Every write is inside this transaction and is rolled back."""
    import seed_staging as base
    cur = conn.cursor()
    cur.execute("SET search_path = app, public, extensions")
    vec = ids["vec"]
    director = uid("user", "gatedirector")
    admin = base.uid("user", "admin")
    try:
        cur.execute("SELECT is_global_admin FROM instructors WHERE id = %s", (admin,))
        check("043: the staging administrator is a global admin", cur.fetchone()[0] is True)
        cur.execute("SELECT is_global_admin FROM instructors WHERE id = %s", (director,))
        check("043: ... and the gate director is not", cur.fetchone()[0] is False)

        # ---- 042: refusals, each leaving the row as it was ------------------------------------------------
        cur.execute("""SELECT q.id, q.updated_at, q.prompt_md, q.points, q.choices::text, q.unit_hint
                         FROM questions q WHERE q.choices IS NOT NULL AND q.activity_id IN (
                              SELECT oa.activity_id FROM offering_activities oa JOIN assignment_offerings ao
                                ON ao.id = oa.assignment_offering_id WHERE ao.course_offering_id = %s)
                        ORDER BY q.qid LIMIT 1""", (ids["ent"],))
        row = cur.fetchone()
        if row is None:
            check("042: a multiple-choice question exists in the entry course to test against", False)
            return
        qid, stamp, prompt, points, choices, hint = row
        good = {"prompt_md": prompt, "points": str(points), "choices": json.loads(choices), "unit_hint": hint}
        cur.execute("SELECT version FROM question_keys WHERE question_id = %s AND superseded_at IS NULL", (qid,))
        kr = cur.fetchone()
        kv = kr[0] if kr else None

        def save(cols, key=None, write_key=False):
            return denied(cur, "SELECT * FROM app.save_question(%s, %s, %s::jsonb, %s, %s::jsonb, %s)",
                          (qid, stamp, json.dumps(cols), write_key, json.dumps(key) if key is not None else None, kv))

        as_user(cur, director)
        err = save({**good, "choices": {"a": 1}})
        check("042: choices that are not a list are refused, never turned into NULL", err is not None and "choices must be a list" in err, str(err))
        err = save({**good, "points": 1.005})
        check("042: points with a third decimal are refused, never rounded", err is not None and "two decimal places" in err, str(err))
        err = save({**good, "points": "abc"})
        check("042: points that are not a number are refused in a sentence", err is not None and "must be a number" in err, str(err))
        err = save({**good, "points": 10000})
        check("042: points above 9999.99 are refused", err is not None and "between 0 and 9999.99" in err, str(err))
        err = save({k: v for k, v in good.items() if k != "points"})
        check("042: missing points are refused in a sentence", err is not None and "must be a number" in err, str(err))
        err = save(good, {"correct_choice_ids": {"a": 1}}, True)
        check("042: a key whose correct choices are not a list is refused", err is not None and "correct choices must be a list" in err, str(err))
        err = save(good, {"correct_choice_ids": [1, 2]}, True)
        check("042: a key whose correct choices are not text is refused", err is not None and "must be text" in err, str(err))
        err = save(good, {"value": "x"}, True)
        check("042: a key value that is not a number is refused in a sentence", err is not None and "must be numbers" in err, str(err))
        as_owner(cur)
        cur.execute("SELECT updated_at = %s, choices::text = %s, points = %s FROM questions WHERE id = %s", (stamp, choices, points, qid))
        check("042: ... and every refusal left the question exactly as it was", cur.fetchone() == (True, True, True))
        as_user(cur, director)
        err = save({**good, "extra": "ignored", "created_by": "x"})
        check("042: an unknown key in the question fields is ignored (the save goes through), as in 041", err is None, str(err))
        as_owner(cur)
        cur.execute("SELECT updated_at FROM questions WHERE id = %s", (qid,))
        stamp = cur.fetchone()[0]          # the good save above moved it; the next call must carry the new stamp
        as_user(cur, director)
        err = save({**good, "points": "2.50"}, {"reference_text": "kept", "created_by": "x", "version": 99}, True)
        check("042: a good save with a key still works, and ignores a forged author and version", err is None, str(err))
        as_owner(cur)
        cur.execute("SELECT version FROM question_keys WHERE question_id = %s AND superseded_at IS NULL", (qid,))
        r = cur.fetchone()
        check("042: ... the key written has the next version, not the forged 99", r is not None and r[0] == (kv or 0) + 1, str(r))

        cur.execute("SELECT lines FROM app.default_letter_scale()")
        lines = cur.fetchone()[0]
        as_user(cur, director)
        cur.execute("SELECT version, is_default FROM app.current_letter_scale(%s)", (vec,))
        ver, is_def = cur.fetchone()
        expect = 0 if is_def else ver

        def scale(ls, width=0.1):
            return denied(cur, "SELECT app.save_letter_scale(%s, %s::jsonb, %s, %s)", (vec, json.dumps(ls), width, expect))

        err = scale(lines, 0.1234)
        check("042: a near-line width with four decimals is refused", err is not None and "three decimal places" in err, str(err))
        err = scale([{**lines[0], "cutoff": 93.1234}] + lines[1:])
        check("042: a cutoff with four decimals is refused", err is not None and "cutoff can have three decimal places" in err, str(err))
        err = scale([{**lines[0], "gpa": 4.005}] + lines[1:])
        check("042: a GPA with three decimals is refused", err is not None and "GPA can have two decimal places" in err, str(err))
        err = scale([{**lines[0], "letter": "A" * 9}] + lines[1:])
        check("042: a letter of nine characters is refused", err is not None and "1 to 8 characters" in err, str(err))
        err = scale([{**lines[0], "letter": " A"}] + lines[1:])
        check("042: a letter with a space at its end is refused", err is not None and "1 to 8 characters" in err, str(err))
        err = scale([{**lines[0], "note": "x"}] + lines[1:])
        check("042: a line carrying a key nobody reads is refused", err is not None and "may carry only" in err, str(err))
        err = scale({"letter": "A"})
        check("042: lines that are not a list are refused", err is not None and "list of lines" in err, str(err))
        err = scale([{"letter": "L%d" % i, "cutoff": 100 - i, "gpa": 1.0} for i in range(31)])
        check("042: more than 30 lines are refused", err is not None and "30 lines at most" in err, str(err))
        err = scale(lines)
        check("042: the default scale still saves", err is None, str(err))

        # ---- 043 ------------------------------------------------------------------------------------------
        as_user(cur, director)
        err = denied(cur, "UPDATE app.course_offerings SET is_active = false WHERE id = %s RETURNING id", (vec,))
        check("043: a director cannot switch their offering inactive", err is not None and "site administrator" in err, str(err))
        err = denied(cur, "DELETE FROM app.course_offerings WHERE id = %s RETURNING id", (vec,))
        check("043: a director cannot delete their offering", err is not None and "site administrator" in err, str(err))
        err = denied(cur, "UPDATE app.course_offerings SET term_id = term_id WHERE id = %s RETURNING id", (vec,))
        check("043: a director's other edits of the offering still go through", err is None, str(err))
        as_owner(cur)
        cur.execute("SELECT course_id FROM course_offerings WHERE id = %s", (vec,))
        course = cur.fetchone()[0]
        cur.execute("INSERT INTO terms (code, label) VALUES ('t043-proof', 'Proof term') RETURNING id")
        term = cur.fetchone()[0]
        as_user(cur, director)
        err = denied(cur, "WITH x AS (INSERT INTO app.course_offerings (course_id, term_id, is_active) VALUES (%s, %s, true)) SELECT 1", (course, term))
        check("043: a director cannot create an offering already active", err is not None and "site administrator" in err, str(err))
        err = denied(cur, "WITH x AS (INSERT INTO app.course_offerings (course_id, term_id, is_active) VALUES (%s, %s, false)) SELECT 1", (course, term))
        check("043: a director may still create an inactive offering of their course", err is None, str(err))
        as_owner(cur)
        cur.execute("SELECT is_active FROM course_offerings WHERE id = %s", (vec,))
        check("043: ... and the vector offering is still active after the refusals", cur.fetchone()[0] is True)
        as_user(cur, admin)
        err = denied(cur, "UPDATE app.course_offerings SET is_active = false WHERE id = %s RETURNING id", (vec,))
        check("043: an administrator may switch an offering inactive", err is None, str(err))
        as_owner(cur)
        cur.execute("SELECT is_active FROM course_offerings WHERE id = %s", (vec,))
        check("043: ... and it is inactive", cur.fetchone()[0] is False)
        as_user(cur, admin)
        err = denied(cur, "DELETE FROM app.course_offerings WHERE course_id = %s AND term_id = %s RETURNING id", (course, term))
        check("043: an administrator may delete an offering (this one has no work)", err is None, str(err))
        as_owner(cur)
        err = denied(cur, "UPDATE app.course_offerings SET is_active = true WHERE id = %s RETURNING id", (vec,))
        check("043: the schema owner (the term builders and admin scripts) is not affected by the guard", err is None, str(err))
    finally:
        conn.rollback()


def main():
    url = os.environ.get("STAGING_DB_URL", "").strip()
    require_staging(url)
    import psycopg2

    conn = psycopg2.connect(url, connect_timeout=15)
    cur = conn.cursor()
    cur.execute("SET search_path = app, public, extensions")
    cur.execute("SELECT count(*) FROM courses WHERE code IN ('gate-vector', 'gate-entry')")
    if cur.fetchone()[0] != 2:
        sys.exit("the gate seed is not present: run scripts/staging/seed_v2_gate.py --commit first")
    ids = part1(cur)
    conn.rollback()
    if ids:
        part2(conn, ids)
        part3(conn, ids)
        part4(conn, ids)
    conn.close()
    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed or not ids else 0


if __name__ == "__main__":
    sys.exit(main())
