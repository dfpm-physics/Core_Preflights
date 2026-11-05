"""Small builders for the v2 gate: the seed (seed_v2_gate.py) and the rolled-back trials share them.

Everything here writes with the OWNER connection on STAGING and invents all of its data. Nothing here
opens a connection or chooses a database; the caller does, through db_target.py.

Ids: with a namespace the ids are deterministic (uuid5), so the seed can run again and change nothing.
Without one they are random, for a trial that is rolled back.
"""
import json
import uuid
from datetime import datetime, timedelta, timezone

DOMAIN = "prep-staging.example"


class Builder:
    def __init__(self, cur, ns=None):
        self.cur, self.ns = cur, ns
        cur.execute("SET LOCAL search_path = app, public, extensions")

    # ---- ids ---------------------------------------------------------------------------------
    def id(self, kind, key):
        return str(uuid.uuid5(self.ns, f"{kind}:{key}")) if self.ns else str(uuid.uuid4())

    # ---- people ------------------------------------------------------------------------------
    def auth_user(self, user_id, email, password=None):
        c = self.cur
        pw = "extensions.crypt(%s, extensions.gen_salt('bf'))" if password else "%s"
        c.execute(f"""INSERT INTO auth.users
                 (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                  confirmation_token, recovery_token, email_change_token_new, email_change)
               VALUES (%s, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
                       %s, {pw}, now(), '{{"provider":"email","providers":["email"]}}', '{{}}', now(), now(),
                       '', '', '', '')
               ON CONFLICT (id) DO NOTHING""", (user_id, email, password or ""))
        c.execute("""INSERT INTO auth.identities
                 (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
               VALUES (%s, %s, %s, %s, 'email', now(), now(), now())
               ON CONFLICT (provider_id, provider) DO NOTHING""",
                  (self.id("identity", user_id), user_id, user_id,
                   json.dumps({"sub": user_id, "email": email, "email_verified": True})))

    def staff(self, key, name, password=None, admin=False):
        uid = self.id("user", key)
        self.auth_user(uid, f"{key}@{DOMAIN}", password)
        self.cur.execute("""INSERT INTO instructors (id, name, is_global_admin) VALUES (%s, %s, %s)
                            ON CONFLICT (id) DO NOTHING""", (uid, name, admin))
        return uid

    def assign(self, instructor_id, co, role, section=None):
        self.cur.execute("""INSERT INTO staff_assignments (id, instructor_id, course_offering_id, section_id, role)
                            VALUES (%s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING""",
                         (self.id("staff", f"{instructor_id}:{co}:{section}"), instructor_id, co, section, role))

    def cadet(self, cadet_id, name, section, password=None, status="active", with_auth=True):
        """A student and an enrollment. Returns (enrollment id, auth user id or None)."""
        uid = self.id("user", cadet_id) if with_auth else None
        email = f"cadet{str(cadet_id)[-4:]}@{DOMAIN}"
        if with_auth:
            self.auth_user(uid, email, password)
        self.cur.execute("""INSERT INTO students (student_id, name, email, auth_user_id) VALUES (%s, %s, %s, %s)
                            ON CONFLICT (student_id) DO NOTHING""", (cadet_id, name, email, uid))
        enr = self.id("enrollment", f"{cadet_id}:{section}")
        self.cur.execute("""INSERT INTO enrollments (id, student_id, section_id, status) VALUES (%s, %s, %s, %s)
                            ON CONFLICT (id) DO NOTHING""", (enr, cadet_id, section, status))
        return enr, uid

    # ---- structure ---------------------------------------------------------------------------
    def course(self, code, title):
        cid = self.id("course", code)
        self.cur.execute("""INSERT INTO courses (id, code, title, department) VALUES (%s, %s, %s, 'Physics')
                            ON CONFLICT (code) DO NOTHING""", (cid, code, title))
        self.cur.execute("SELECT id FROM courses WHERE code = %s", (code,))
        return self.cur.fetchone()[0]

    def term(self, code="fall-2026", label="Fall 2026", starts="2026-08-06", ends="2026-12-10"):
        self.cur.execute("""INSERT INTO terms (id, code, label, starts_on, ends_on) VALUES (%s, %s, %s, %s, %s)
                            ON CONFLICT (code) DO NOTHING""", (self.id("term", code), code, label, starts, ends))
        self.cur.execute("SELECT id FROM terms WHERE code = %s", (code,))
        return self.cur.fetchone()[0]

    def offering(self, course, term, active):
        co = self.id("offering", f"{course}:{term}")
        self.cur.execute("""INSERT INTO course_offerings (id, course_id, term_id, is_active) VALUES (%s, %s, %s, %s)
                            ON CONFLICT (id) DO NOTHING""", (co, course, term, active))
        return co

    def section(self, co, code, days, period=None):
        sid = self.id("section", f"{co}:{code}")
        self.cur.execute("""INSERT INTO sections (id, course_offering_id, code, meeting_days, period)
                            VALUES (%s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING""",
                         (sid, co, code, days, period))
        return sid

    # ---- items -------------------------------------------------------------------------------
    def item(self, course, co, slug, title, points, *, kind="homework", paths=None, due=None, due_by_day=None,
             published=True, entered_on_new_page=False, **policy):
        """One assignment, one offering, and its paths.

        paths: list of dicts {modality, delivery, grading, role='graded', warn=False, content={}}. A path
        with no entry for delivery lets the fill trigger decide (written and interactive only).
        policy: any assignment_offerings column (is_bonus, prog_included, grades_release_at, ...).
        Items are inserted unpublished and published last, after their paths and questions exist, because
        the publish rules look at them.
        """
        a_id, ao = self.id("assignment", slug), self.id("ao", slug)
        c = self.cur
        c.execute("""INSERT INTO assignments (id, course_id, kind_id, slug, title) VALUES (%s, %s, %s, %s, %s)
                     ON CONFLICT (id) DO NOTHING""", (a_id, course, kind, slug, title))
        cols = {"id": ao, "assignment_id": a_id, "course_offering_id": co, "due_at": due,
                "due_by_day": json.dumps(due_by_day or {}), "grading_mode": "points",
                "points_possible": points, "is_published": False, "entered_on_new_page": entered_on_new_page}
        cols.update(policy)
        names = ", ".join(cols)
        c.execute(f"INSERT INTO assignment_offerings ({names}) VALUES ({', '.join(['%s'] * len(cols))}) "  # noqa: S608
                  "ON CONFLICT (id) DO UPDATE SET due_at = EXCLUDED.due_at, due_by_day = EXCLUDED.due_by_day",
                  list(cols.values()))
        made = []
        for pos, p in enumerate(paths or [{"modality": "written"}]):
            act = self.id("activity", f"{slug}:{p['modality']}")
            c.execute("""INSERT INTO activities (id, assignment_id, modality, slug, title, content, position)
                         VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING""",
                      (act, a_id, p["modality"], f"{slug}-{p['modality']}", title,
                       json.dumps(p.get("content", {})), pos))
            c.execute("SELECT 1 FROM offering_activities WHERE assignment_offering_id = %s AND activity_id = %s",
                      (ao, act))
            if c.fetchone():
                made.append(act)      # a re-run: the BEFORE INSERT rules fire even when the row would conflict
                continue
            c.execute("""INSERT INTO offering_activities
                           (assignment_offering_id, activity_id, grading_role, available_after, is_visible, position,
                            delivery, grading, warn_earns_full)
                         VALUES (%s, %s, %s, 'always', true, %s, %s, %s, %s) ON CONFLICT DO NOTHING""",
                      (ao, act, p.get("role", "graded"), pos, p.get("delivery"), p.get("grading"), p.get("warn")))
            made.append(act)
        item = {"ao": ao, "assignment": a_id, "activities": made, "points": points, "slug": slug}
        return item

    def publish(self, item):
        """Publish an item. An item with a path only a new page produces (online questions, in person,
        elsewhere) is refused by the two *_new_paths_stay_unpublished rules at step 1, for every role. A
        seed or trial that must build one on staging turns those two triggers off for this one statement
        and back on straight after, inside its own transaction."""
        c = self.cur
        c.execute("SELECT EXISTS (SELECT 1 FROM offering_activities WHERE assignment_offering_id = %s "
                  "AND delivery IN ('online_questions', 'in_person', 'elsewhere'))", (item["ao"],))
        guarded = c.fetchone()[0]
        if guarded:         # migration 079 drops the rule; a database without it has nothing to switch off
            c.execute("SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'assignment_offerings_new_paths_stay_unpublished' "
                      "AND NOT tgisinternal)")
            guarded = c.fetchone()[0]
        if guarded:
            c.execute("ALTER TABLE assignment_offerings DISABLE TRIGGER assignment_offerings_new_paths_stay_unpublished")
        try:
            c.execute("UPDATE assignment_offerings SET is_published = true WHERE id = %s AND NOT is_published",
                      (item["ao"],))
        finally:
            if guarded:
                c.execute("ALTER TABLE assignment_offerings ENABLE TRIGGER assignment_offerings_new_paths_stay_unpublished")

    def question(self, item, qid, fmt, points, *, key=None, choices=None, prompt="Made-up question.", n=0):
        """A question on the item's first path, and optionally its current key. Returns the question id."""
        q = self.id("question", f"{item['slug']}:{qid}")
        self.cur.execute("""INSERT INTO questions (id, activity_id, qid, position, prompt_md, format, choices, points)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING""",
                         (q, item["activities"][0], qid, n, prompt, fmt,
                          json.dumps(choices) if choices is not None else None, points))
        keys = [key] if isinstance(key, dict) else (key or [])
        for version, k in enumerate(keys, start=1):
            cols = {"id": self.id("key", f"{q}:{version}"), "question_id": q, "version": version, **k}
            if version < len(keys):
                cols["superseded_at"] = datetime.now(timezone.utc)
            names = ", ".join(cols)
            self.cur.execute(f"INSERT INTO question_keys ({names}) VALUES ({', '.join(['%s'] * len(cols))}) "  # noqa: S608
                             "ON CONFLICT (id) DO NOTHING", list(cols.values()))
        return q

    # ---- work and grades ---------------------------------------------------------------------
    def work(self, enr, item, status, committed_at=None):
        """A submission. status: 'draft' or 'committed'."""
        sub = self.id("submission", f"{enr}:{item['ao']}")
        chosen = item["activities"][0] if status == "committed" else None
        self.cur.execute("""INSERT INTO submissions (id, enrollment_id, assignment_offering_id, chosen_activity_id,
                                                     status, committed_at)
                            VALUES (%s, %s, %s, %s, %s, %s)
                            ON CONFLICT (id) DO UPDATE SET committed_at = EXCLUDED.committed_at""",
                         (sub, enr, item["ao"], chosen, status, committed_at if status == "committed" else None))
        return sub

    def grade(self, enr, item, points, *, final=True, source=None, graded_at=None, submission=None, possible=None,
              **extra):
        """A grade row. extra: any other grades column (student_group_id, student_group_adjusted, ...)."""
        source = source or ("instructor" if final else "ai_suggested")
        gid = self.id("grade", f"{enr}:{item['ao']}")
        cols = {"id": gid, "enrollment_id": enr, "assignment_offering_id": item["ao"], "submission_id": submission,
                "points_earned": points, "points_possible": possible if possible is not None else item["points"],
                "source": source, "is_finalized": final, "graded_at": graded_at or datetime.now(timezone.utc), **extra}
        self.cur.execute(f"INSERT INTO grades ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))}) "  # noqa: S608
                         "ON CONFLICT (id) DO UPDATE SET graded_at = EXCLUDED.graded_at", list(cols.values()))
        return gid

    def excuse(self, enr, item, by, reason="Made-up reason."):
        eid = self.id("excusal", f"{enr}:{item['ao']}")
        self.cur.execute("""INSERT INTO grade_excusals (id, enrollment_id, assignment_offering_id, reason, set_by)
                            VALUES (%s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING""", (eid, enr, item["ao"], reason, by))
        return eid

    def close_column(self, item, section, by):
        self.cur.execute("""INSERT INTO column_closures (id, assignment_offering_id, section_id, closed_by)
                            VALUES (%s, %s, %s, %s) ON CONFLICT (id) DO NOTHING""",
                         (self.id("closure", f"{item['ao']}:{section}"), item["ao"], section, by))


def existing_triggers(cur, table, names):
    """Those of `names` that exist on `table`. Migration 079 drops the step 1 rules, so a proof that switches them
    off for one statement switches off only what the database still has."""
    cur.execute("SELECT tgname FROM pg_trigger WHERE tgrelid = ('app.' || %s)::regclass AND NOT tgisinternal "
                "AND tgname = ANY(%s)", (table, list(names)))
    have = {r[0] for r in cur.fetchall()}
    return [n for n in names if n in have]


def triggers_off(cur, table, names):
    """Switch the named triggers off (those that exist) and return the list, for triggers_on."""
    live = existing_triggers(cur, table, names)
    for n in live:
        cur.execute(f"ALTER TABLE app.{table} DISABLE TRIGGER {n}")
    return live


def triggers_on(cur, table, live):
    for n in live:
        cur.execute(f"ALTER TABLE app.{table} ENABLE TRIGGER {n}")


def days(n, hour=23, minute=59, second=59):
    """2359:59 UTC on the day n days from now, as a UTC datetime."""
    d = datetime.now(timezone.utc).date() + timedelta(days=n)
    return datetime(d.year, d.month, d.day, hour, minute, second, tzinfo=timezone.utc)


def iso(moment):
    return moment.strftime("%Y-%m-%dT%H:%M:%S.000Z")
