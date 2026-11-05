#!/usr/bin/env python3
"""Prove migrations 077, 078 and 079 (the AI-drafted grading option and the removal of the step 1 rules) on a
THROWAWAY database. The staging database itself is not touched.

Builds schema `app` through 076 in a database of its own, loads an invented course, then:

  BEFORE 077  the pair (typed_response, ai_drafted) is refused; the eight older pairs pass; a null-delivery write of a
              written activity still fills human_graded.
  APPLY 077   the new pair passes; warn_earns_full true passes with it and is refused with effort; the eight older pairs
              still pass; an unlisted pair is still refused; a null-delivery write still fills human_graded; the
              rollback refuses while a path uses ai_drafted and passes once none does; 077 re-applies.
  BEFORE 078  a service-role write finalizes a mark on an ai_drafted item (the gap).
  (the Choice item, a released mark and the path edit are also proved, see the MIXED / RELEASED / PATH lines)
  APPLY 078   service role and the data role are refused, a cadet is refused, a signed-in staff member passes, a draft
              (unfinalized) passes for the service role, an item without an ai_drafted path is unchanged, an update that
              changes nothing audited on a finalized row passes.
  BEFORE 079  all six step 1 triggers exist; a new-page item cannot be published and holds no finalized grade.
  APPLY 079   five of the six remain gone (the marker rule stays); a new-page item publishes (including one with an
              online-questions path); the marker still cannot be cleared; a staff member finalizes a mark on a new-page ai_drafted item; the service role is STILL
              refused there (078 holds without the old rule); on a new-page item without an ai_drafted path a finalize
              now passes.
  ROLLBACK    079 puts the five triggers back (a publish of a new-page item is refused again); 078 rolls back (the gap is
              open again); 077 rolls back once no path uses ai_drafted.

Sessions are simulated: the `authenticated` role plus `request.jwt.claims`. This cannot show the real REST path.
SAFETY  Staging server only (db_target.py refuses anything else). One database, dropped afterwards. Invented names; no id
is printed. Never prints a password or the connection string.

Usage:  python scripts/staging/test_ai_drafted_scratch.py --expect-ref <staging_ref>
Exit 0 only when every check passed.
"""
import argparse
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import v2_gate_lib as gl  # noqa: E402
from scratch_lib import Scratch, Tally  # noqa: E402

sys.path.insert(0, str(HERE.parents[1] / "supabase" / "admin"))
from lesson_aggregate import eligible_path_sql  # noqa: E402   the text the nightly worklist runs

M77, R77 = "077_ai_drafted_grading.sql", "077_ai_drafted_grading_ROLLBACK.sql"
M78, R78 = "078_ai_drafts_need_a_person.sql", "078_ai_drafts_need_a_person_ROLLBACK.sql"
M79, R79 = "079_drop_step1_rules.sql", "079_drop_step1_rules_ROLLBACK.sql"
SIX = ("assignment_offerings_new_stay_unpublished", "assignment_offerings_publish_needs_active",
       "grades_new_items_stay_unfinalized", "assignment_offerings_marker_one_way",
       "assignment_offerings_new_paths_stay_unpublished", "offering_activities_new_paths_stay_unpublished")
# 079 drops five of the six; the marker rule stays until the column is dropped
DROPPED = tuple(n for n in SIX if n != "assignment_offerings_marker_one_way")
KEPT = "assignment_offerings_marker_one_way"
OLD_PAIRS = [("questions", "online_questions", "auto_checked"), ("questions", "online_questions", "human_graded"),
             ("written", "typed_response", "human_graded"), ("interactive", "interactive_tutor", "effort"),
             ("external", "in_person", "hand_entered"), ("external", "in_person", "imported"),
             ("external", "elsewhere", "hand_entered"), ("external", "elsewhere", "imported")]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expect-ref", required=True)
    args = ap.parse_args()
    s = Scratch("scratch_aid", args.expect_ref, before="077", skip=())
    t = Tally()
    try:
        if not s.build():
            return 1
        cur, one = s.cur, s.one
        cur.execute("BEGIN")
        b = gl.Builder(cur, uuid.UUID("5b2f0c7e-91d4-4a6b-8c1e-3a7d2e9f1077"))
        b.auth_user = lambda uid, email, pw=None: cur.execute("INSERT INTO auth.users (id) VALUES (%s) ON CONFLICT DO NOTHING", (uid,))
        b.cadet_email = lambda cadet_id, uid=None: f"cadet{cadet_id}@{gl.DOMAIN}"   # the scratch auth.users stub has no email column
        director = b.staff("director", "Dee Director")
        course, term = b.course("aid-101", "AI draft course"), b.term()
        co = b.offering(course, term, True)
        course2 = b.course("aid-102", "Inactive course")
        co_off = b.offering(course2, term, False)
        sec = b.section(co, "A1", ["M"])
        b.assign(director, co, "director")
        enr1, stu1 = b.cadet(3000000771, "Ann Invented", sec)
        enr2, stu2 = b.cadet(3000000772, "Ben Invented", sec)
        enr3, stu3 = b.cadet(3000000773, "Cy Invented", sec)
        cur.execute("COMMIT")
        n_item = [0]

        def new_item(paths, **kw):
            n_item[0] += 1
            cur.execute("BEGIN")
            co_ = kw.pop("co", co)
            it = b.item(course2 if co_ == co_off else course, co_, f"aid-{n_item[0]}", f"Item {n_item[0]}", 2, paths=paths, **kw)
            cur.execute("COMMIT")
            return it

        def sql_try(sql, params=()):
            """Run one statement on the admin connection in a transaction that is rolled back. ('ok'|'error', first line)."""
            cur.execute("BEGIN")
            try:
                cur.execute(sql, params)
                res = ("ok", cur.rowcount)
            except s.psycopg2.Error as exc:
                res = ("error", (str(exc).strip().splitlines() or [""])[0])
            cur.execute("ROLLBACK")
            return res

        def sql_do(sql, params=()):
            cur.execute(sql, params)

        def pair_item(modality, delivery, grading, warn=None):
            return new_item([{"modality": modality, "delivery": delivery, "grading": grading, "warn": warn}])

        def written_item(grading=None, **kw):
            """A written-activity item. grading None lets the fill trigger decide (human_graded)."""
            return new_item([{"modality": "written", "delivery": "typed_response" if grading else None,
                              "grading": grading, "warn": True if grading == "ai_drafted" else None}], **kw)

        def refuses(res, word):
            return res[0] == "error" and word in res[-1]

        def draft_grade(it, enr, final=False, who=None, role="service_role", keep=True, src="ai_suggested"):
            return s.attempt(who, "INSERT INTO grades (enrollment_id, assignment_offering_id, points_earned, points_possible, source, is_finalized) "
                                  "VALUES (%s,%s,1,2,%s,%s)", (enr, it["ao"], src, final), keep=keep, role=role)

        def tutor_commit(enr, it, effort=4):
            """A cadet commits the tutor option of a mixed item: the 015/048 trigger then writes a finalized derived
            grade as definer. Run on the admin connection (the trigger runs as its owner whoever commits)."""
            tut_act = it["activities"][1]
            cur.execute("BEGIN")
            try:
                sub = b.work(enr, it, "draft")
                cur.execute("INSERT INTO submission_activities (submission_id, activity_id, content, report_markdown, payload_bytes) "
                            "VALUES (%s,%s,%s,%s,10)", (sub, tut_act, '{"effort": %d}' % effort, "Made-up report."))
                cur.execute("UPDATE submissions SET status='committed', chosen_activity_id=%s, committed_at=now() WHERE id=%s", (tut_act, sub))
                res = ("ok", 1)
            except s.psycopg2.Error as exc:
                res = ("error", (str(exc).strip().splitlines() or [""])[0])
            cur.execute("COMMIT" if res[0] == "ok" else "ROLLBACK")
            return res

        def trig_count():
            return one("SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname = ANY(%s)", (list(SIX),))

        # ============================ BEFORE 077 ===============================
        print("\n=== BEFORE 077 ===")
        ai0 = written_item()                                        # a written item on the default (human_graded)
        r = sql_try("UPDATE offering_activities SET grading = 'ai_drafted' WHERE activity_id = %s", (ai0["activities"][0],))
        t.chk("BEFORE: (typed_response, ai_drafted) is refused", refuses(r, "delivery_grading_ck"), r)
        base_ok = []
        for mod, dl, gr in OLD_PAIRS:
            try:
                pair_item(mod, dl, gr)
                base_ok.append(True)
            except Exception as exc:  # noqa: BLE001
                cur.execute("ROLLBACK")
                base_ok.append(False)
                print("   ", mod, dl, gr, str(exc).splitlines()[0])
        t.chk("BEFORE: the eight older pairs pass", all(base_ok) and len(base_ok) == 8, base_ok)
        t.chk("BEFORE: a null-delivery write of a written activity fills human_graded with warn_earns_full",
              one("SELECT grading || ':' || warn_earns_full FROM offering_activities WHERE activity_id = %s", (ai0["activities"][0],)) == "human_graded:true")

        # ============================== APPLY 077 ==============================
        if not s.apply_file(M77):
            return 1
        print(f"\napplied  {M77}")
        print("\n=== AFTER 077 ===")
        r = sql_try("UPDATE offering_activities SET grading = 'ai_drafted' WHERE activity_id = %s", (ai0["activities"][0],))
        t.chk("AFTER: (typed_response, ai_drafted) passes, with warn_earns_full true", r == ("ok", 1), r)
        ok = []
        for mod, dl, gr in OLD_PAIRS:
            try:
                pair_item(mod, dl, gr)
                ok.append(True)
            except Exception:  # noqa: BLE001
                cur.execute("ROLLBACK")
                ok.append(False)
        t.chk("AFTER: all eight older pairs still pass", all(ok), ok)
        r = sql_try("UPDATE offering_activities SET grading = 'ai_drafted', warn_earns_full = true WHERE activity_id = %s", (ai0["activities"][0],))
        t.chk("AFTER: warn_earns_full true is allowed with ai_drafted", r == ("ok", 1), r)
        tut = new_item([{"modality": "interactive"}])
        r = sql_try("UPDATE offering_activities SET warn_earns_full = true WHERE activity_id = %s", (tut["activities"][0],))
        t.chk("AFTER: warn_earns_full true is still refused with effort", refuses(r, "warn_needs_human_ck"), r)
        r = sql_try("UPDATE offering_activities SET grading = 'effort' WHERE activity_id = %s", (ai0["activities"][0],))
        t.chk("AFTER: (typed_response, effort) is still refused", refuses(r, "delivery_grading_ck"), r)
        qa = pair_item("questions", "online_questions", "human_graded")
        r = sql_try("UPDATE offering_activities SET grading = 'ai_drafted' WHERE activity_id = %s", (qa["activities"][0],))
        t.chk("AFTER: (online_questions, ai_drafted) is refused", refuses(r, "delivery_grading_ck"), r)
        r = sql_try("UPDATE offering_activities SET grading = 'ai_drafted' WHERE activity_id = %s", (tut["activities"][0],))
        t.chk("AFTER: (interactive_tutor, ai_drafted) is refused", refuses(r, "delivery_grading_ck"), r)
        old_writer = new_item([{"modality": "written"}])
        t.chk("AFTER: an older writer (null delivery) still fills human_graded with warn_earns_full",
              one("SELECT grading || ':' || warn_earns_full FROM offering_activities WHERE activity_id = %s", (old_writer["activities"][0],)) == "human_graded:true")
        # a real ai_drafted item for the rest
        AI = written_item("ai_drafted")
        t.chk("AFTER: an item made with the new pair keeps it",
              one("SELECT grading FROM offering_activities WHERE activity_id = %s", (AI["activities"][0],)) == "ai_drafted")

        # ---- which paths the nightly worklist may take (supabase/admin/lesson_aggregate.py) ------------------
        print("\n=== the worklist's eligibility rule, evaluated over real rows ===")
        fall_shape = written_item()                                          # human_graded, not entered on a newer page
        new_human = written_item("human_graded", entered_on_new_page=True)   # a person marks it: the job skips it
        new_ai = written_item("ai_drafted", entered_on_new_page=True)
        new_tutor = new_item([{"modality": "interactive"}], entered_on_new_page=True)
        new_q = new_item([{"modality": "questions", "delivery": "online_questions", "grading": "auto_checked"}],
                         entered_on_new_page=True)
        new_hand = new_item([{"modality": "external", "delivery": "in_person", "grading": "hand_entered"}],
                            entered_on_new_page=True)

        def eligible(it, has_marker=True):
            pred = eligible_path_sql("oa", "ao", has_marker)
            return one(f"SELECT bool_or({pred}) FROM offering_activities oa JOIN assignment_offerings ao "  # noqa: S608
                       "ON ao.id = oa.assignment_offering_id WHERE oa.assignment_offering_id = %s", (it["ao"],))
        t.chk("ELIGIBLE: a Fall-shaped typed response (human_graded, older page) is picked", eligible(fall_shape) is True)
        t.chk("ELIGIBLE: an ai_drafted typed response on a newer page is picked", eligible(new_ai) is True)
        t.chk("ELIGIBLE: a tutor path is picked", eligible(new_tutor) is True)
        t.chk("ELIGIBLE: a NEW human_graded typed response is not picked", eligible(new_human) is False)
        t.chk("ELIGIBLE: an online-questions item is not picked, so it cannot mask a preflight", eligible(new_q) is False)
        t.chk("ELIGIBLE: an in-person item is not picked", eligible(new_hand) is False)
        t.chk("ELIGIBLE: on a database without the marker column every typed response is picked (text only)",
              "entered_on_new_page" not in eligible_path_sql("oa", "ao", False))

        # ============================ ROLLBACK 077 =============================
        print("\n=== ROLLBACK 077 (with an ai_drafted path present) ===")
        ok = s.apply_file(R77, rollback=True, quiet=True)
        t.chk("ROLLBACK 077 refuses while a path uses ai_drafted", not ok)
        t.chk("ROLLBACK 077: the constraint is unchanged after the refusal",
              one("SELECT pg_get_constraintdef(oid) LIKE '%%ai_drafted%%' FROM pg_constraint WHERE conname = 'offering_activities_delivery_grading_ck'"))
        sql_do("UPDATE offering_activities SET grading = 'human_graded' WHERE grading = 'ai_drafted'")
        t.chk("ROLLBACK 077 passes once no path uses ai_drafted", s.apply_file(R77, rollback=True))
        r = sql_try("UPDATE offering_activities SET grading = 'ai_drafted' WHERE activity_id = %s", (ai0["activities"][0],))
        t.chk("ROLLBACK 077: the pair is refused again", refuses(r, "delivery_grading_ck"), r)
        t.chk("RE-APPLY 077", s.apply_file(M77))
        sql_do("UPDATE offering_activities SET grading = 'ai_drafted', warn_earns_full = true WHERE activity_id = %s", (AI["activities"][0],))

        # ============================ BEFORE 078 ===============================
        print("\n=== BEFORE 078 ===")
        # grades need a published item for the cadet; the item is unmarked (entered_on_new_page false) so only 078 is in play
        cur.execute("BEGIN")
        b.publish(AI)
        cur.execute("COMMIT")
        r = draft_grade(AI, enr1, final=True, role="service_role", keep=False)
        t.chk("BEFORE 078: the gap, a service-role write finalizes a mark on an ai_drafted item", r[0] == "ok", r)

        # ============================== APPLY 078 ==============================
        if not s.apply_file(M78):
            return 1
        print(f"\napplied  {M78}")
        print("\n=== AFTER 078 ===")
        r = draft_grade(AI, enr1, final=False, role="service_role", keep=True)
        t.chk("AFTER 078: a service-role DRAFT (unfinalized) is still written", r[0] == "ok", r)
        r = s.attempt(None, "UPDATE grades SET is_finalized = true WHERE enrollment_id = %s AND assignment_offering_id = %s", (enr1, AI["ao"]), role="service_role")
        t.chk("AFTER 078: a service-role finalize of that draft is refused", refuses(r, "grades_ai_drafts_need_a_person"), r)
        r = s.attempt(None, "UPDATE grades SET is_finalized = true WHERE enrollment_id = %s AND assignment_offering_id = %s", (enr1, AI["ao"]), role="prep_app_dml")
        t.chk("AFTER 078: a data-role finalize is refused", refuses(r, "grades_ai_drafts_need_a_person"), r)
        r = draft_grade(AI, enr2, final=True, role="service_role", keep=False)
        t.chk("AFTER 078: a service-role INSERT of a finalized mark is refused", refuses(r, "grades_ai_drafts_need_a_person"), r)
        r = s.attempt(stu1, "UPDATE grades SET is_finalized = true WHERE enrollment_id = %s AND assignment_offering_id = %s", (enr1, AI["ao"]))
        t.chk("AFTER 078: a cadet session cannot finalize it", r[0] == "error" or r[1] == 0, r)
        r = s.attempt(director, "UPDATE grades SET is_finalized = true WHERE enrollment_id = %s AND assignment_offering_id = %s", (enr1, AI["ao"]), keep=True)
        t.chk("AFTER 078: a signed-in staff member finalizes it", r == ("ok", 1), r)
        t.chk("AFTER 078: the mark is finalized", one("SELECT is_finalized FROM grades WHERE enrollment_id = %s AND assignment_offering_id = %s", (enr1, AI["ao"])) is True)
        r = s.attempt(None, "UPDATE grades SET is_finalized = true WHERE enrollment_id = %s AND assignment_offering_id = %s", (enr1, AI["ao"]), role="service_role")
        t.chk("AFTER 078: a no-change update of an already finalized mark passes for a script", r == ("ok", 1), r)
        r = s.attempt(None, "UPDATE grades SET points_earned = 2 WHERE enrollment_id = %s AND assignment_offering_id = %s", (enr1, AI["ao"]), role="service_role")
        t.chk("AFTER 078: a script cannot change the points of a finalized mark", refuses(r, "grades_ai_drafts_need_a_person"), r)
        plain = written_item()                                       # human_graded written item, unmarked
        cur.execute("BEGIN")
        b.publish(plain)
        cur.execute("COMMIT")
        r = draft_grade(plain, enr1, final=True, role="service_role", keep=True)
        t.chk("AFTER 078: an item with no ai_drafted path is unchanged (a script may finalize)", r[0] == "ok", r)
        t.chk("AFTER 078: nobody can run the function directly",
              one("SELECT count(*) FROM information_schema.routine_privileges WHERE specific_schema='app' AND routine_name='grades_ai_drafts_need_a_person' "
                  "AND grantee IN ('anon','authenticated','service_role','prep_app_dml','prep_app_read')") == 0)

        # ---- review fixes: a mixed Choice item, the released mark, and the path edit --------------------------
        print("\n=== AFTER 078: a Choice item (typed ai_drafted path + tutor path) ===")
        MIX = new_item([{"modality": "written", "delivery": "typed_response", "grading": "ai_drafted", "warn": True},
                        {"modality": "interactive"}])
        cur.execute("BEGIN")
        b.publish(MIX)
        cur.execute("COMMIT")
        r = tutor_commit(enr1, MIX)
        t.chk("MIXED: a cadet committing the tutor option is NOT refused (the derived grade is written)", r == ("ok", 1), r)
        cur.execute("SELECT is_finalized AND source = 'derived' FROM grades WHERE enrollment_id = %s AND assignment_offering_id = %s", (enr1, MIX["ao"]))
        row = cur.fetchone()
        t.chk("MIXED: and the tutor grade is finalized and derived", bool(row and row[0] is True))
        r = draft_grade(MIX, enr2, final=True, role="service_role", keep=False)
        t.chk("MIXED: a script still cannot finalize a typed-path mark on the same item", refuses(r, "grades_ai_drafts_need_a_person"), r)
        r = draft_grade(MIX, enr3, final=True, role="service_role", keep=False, src="derived")
        t.chk("MIXED: a derived mark with no tutor submission behind it is refused", refuses(r, "grades_ai_drafts_need_a_person"), r)

        print("\n=== AFTER 078: a released mark stays released ===")
        r = s.attempt(None, "UPDATE grades SET is_finalized = false, source = 'ai_suggested' WHERE enrollment_id = %s AND assignment_offering_id = %s",
                      (enr1, AI["ao"]), role="service_role")
        t.chk("RELEASED: a script cannot un-finalize a mark a person finalized", refuses(r, "grades_ai_drafts_need_a_person"), r)
        r = s.attempt(None, "INSERT INTO grades (enrollment_id, assignment_offering_id, points_earned, points_possible, source, is_finalized) "
                            "VALUES (%s,%s,0,2,'ai_suggested',false) ON CONFLICT (enrollment_id, assignment_offering_id) DO UPDATE "
                            "SET is_finalized = false, source = 'ai_suggested', points_earned = 0", (enr1, AI["ao"]), role="service_role")
        t.chk("RELEASED: the nightly upsert (is_finalized false over a finalized row) is refused", refuses(r, "grades_ai_drafts_need_a_person"), r)
        t.chk("RELEASED: the mark is still finalized after those attempts",
              one("SELECT is_finalized AND points_earned = 1 FROM grades WHERE enrollment_id = %s AND assignment_offering_id = %s", (enr1, AI["ao"])) is True)
        r = s.attempt(director, "UPDATE grades SET is_finalized = false WHERE enrollment_id = %s AND assignment_offering_id = %s", (enr1, AI["ao"]))
        t.chk("RELEASED: a signed-in staff member may reopen it", r == ("ok", 1), r)
        r = draft_grade(AI, enr3, final=False, role="service_role", keep=True)
        r = s.attempt(None, "UPDATE grades SET points_earned = 1, question_scores = '{\"q2\": {}}'::jsonb WHERE enrollment_id = %s AND assignment_offering_id = %s",
                      (enr3, AI["ao"]), role="service_role")
        t.chk("RELEASED: a script may still rewrite an unfinalized draft", r == ("ok", 1), r)

        print("\n=== AFTER 078: the path cannot be edited out from under a draft ===")
        r = s.attempt(None, "UPDATE offering_activities SET grading = 'human_graded' WHERE activity_id = %s AND assignment_offering_id = %s",
                      (AI["activities"][0], AI["ao"]), role="service_role")
        t.chk("PATH: a script cannot switch an ai_drafted path to human_graded while grades exist", refuses(r, "offering_activities_ai_drafted_stays"), r)
        r = s.attempt(None, "DELETE FROM offering_activities WHERE activity_id = %s AND assignment_offering_id = %s",
                      (AI["activities"][0], AI["ao"]), role="service_role")
        t.chk("PATH: a script cannot delete an ai_drafted path while grades exist", refuses(r, "offering_activities_ai_drafted_stays"), r)
        r = s.attempt(director, "UPDATE offering_activities SET grading = 'human_graded' WHERE activity_id = %s AND assignment_offering_id = %s",
                      (AI["activities"][0], AI["ao"]))
        t.chk("PATH: a signed-in staff member may change it", r == ("ok", 1), r)
        NOGR = written_item("ai_drafted")
        r = s.attempt(None, "UPDATE offering_activities SET grading = 'human_graded' WHERE activity_id = %s AND assignment_offering_id = %s",
                      (NOGR["activities"][0], NOGR["ao"]), role="service_role")
        t.chk("PATH: with no grades yet a script may still change it", r == ("ok", 1), r)

        # ============================ BEFORE 079 ===============================
        print("\n=== BEFORE 079 ===")
        t.chk("BEFORE 079: all six step 1 triggers exist", trig_count() == 6, trig_count())
        NP_AI = written_item("ai_drafted", entered_on_new_page=True)
        r = sql_try("UPDATE assignment_offerings SET is_published = true WHERE id = %s", (NP_AI["ao"],))
        t.chk("BEFORE 079: a new-page item cannot be published", refuses(r, "new_stay_unpublished"), r)
        NP_Q = new_item([{"modality": "questions", "delivery": "online_questions", "grading": "human_graded"}], entered_on_new_page=True)
        r = sql_try("UPDATE assignment_offerings SET is_published = true WHERE id = %s", (NP_Q["ao"],))
        t.chk("BEFORE 079: a new-page item with an online-questions path cannot be published", r[0] == "error", r)
        r = sql_try("UPDATE assignment_offerings SET entered_on_new_page = false WHERE id = %s", (NP_AI["ao"],))
        t.chk("BEFORE 079: the marker cannot be cleared", refuses(r, "marker_one_way"), r)
        off = written_item(co=co_off)
        r = sql_try("UPDATE assignment_offerings SET is_published = true WHERE id = %s", (off["ao"],))
        t.chk("BEFORE 079: publishing in an inactive course offering is refused", refuses(r, "publish_needs_active"), r)
        cur.execute("BEGIN")
        sql_do("ALTER TABLE assignment_offerings DISABLE TRIGGER assignment_offerings_new_stay_unpublished")
        sql_do("UPDATE assignment_offerings SET is_published = true WHERE id = %s", (NP_AI["ao"],))
        sql_do("ALTER TABLE assignment_offerings ENABLE TRIGGER assignment_offerings_new_stay_unpublished")
        cur.execute("COMMIT")                                        # a published new-page ai_drafted item, to test the grade rule
        r = s.attempt(director, "INSERT INTO grades (enrollment_id, assignment_offering_id, points_earned, points_possible, source, is_finalized) "
                                "VALUES (%s,%s,1,2,'ai_suggested',true)", (enr1, NP_AI["ao"]))
        t.chk("BEFORE 079: a staff member cannot finalize a mark on a new-page item (the step 1 rule)", refuses(r, "grades_new_items_stay_unfinalized"), r)

        # ============================== APPLY 079 ==============================
        if not s.apply_file(M79):
            return 1
        print(f"\napplied  {M79}")
        print("\n=== AFTER 079 ===")
        t.chk("AFTER 079: five of the six triggers are gone and the marker rule stays", trig_count() == 1 and one(
              "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname = %s", (KEPT,)) == 1, trig_count())
        t.chk("AFTER 079: the five functions are gone",
              one("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app' AND p.proname = ANY(%s)", (list(DROPPED),)) == 0)
        t.chk("AFTER 079: 078's rule is still in place",
              one("SELECT count(*) FROM pg_trigger WHERE tgrelid = 'app.grades'::regclass AND tgname = 'grades_ai_drafts_need_a_person' AND NOT tgisinternal") == 1)
        t.chk("AFTER 079: the one-active index stays",
              one("SELECT count(*) FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'course_offerings_one_active'") == 1)
        NP2 = written_item("ai_drafted", entered_on_new_page=True)
        r = sql_try("UPDATE assignment_offerings SET is_published = true WHERE id = %s", (NP2["ao"],))
        t.chk("AFTER 079: a new-page item publishes", r == ("ok", 1), r)
        NPQ2 = new_item([{"modality": "questions", "delivery": "online_questions", "grading": "auto_checked"}], entered_on_new_page=True)
        r = sql_try("UPDATE assignment_offerings SET is_published = true WHERE id = %s", (NPQ2["ao"],))
        t.chk("AFTER 079: a new-page item with an online-questions path publishes", r == ("ok", 1), r)
        r = sql_try("UPDATE assignment_offerings SET entered_on_new_page = false WHERE id = %s", (NP_AI["ao"],))
        t.chk("AFTER 079: the marker still cannot be cleared", refuses(r, "marker_one_way"), r)
        r = sql_try("UPDATE assignment_offerings SET is_published = true WHERE id = %s", (off["ao"],))
        t.chk("AFTER 079: publishing in an inactive course offering is no longer refused", r == ("ok", 1), r)
        r = s.attempt(director, "INSERT INTO grades (enrollment_id, assignment_offering_id, points_earned, points_possible, source, is_finalized) "
                                "VALUES (%s,%s,1,2,'ai_suggested',true)", (enr1, NP_AI["ao"]), keep=True)
        t.chk("AFTER 079: a staff member finalizes a mark on a new-page ai_drafted item", r == ("ok", 1), r)
        r = draft_grade(NP_AI, enr2, final=True, role="service_role", keep=False)
        t.chk("AFTER 079: the service role is STILL refused there (078 holds without the old rule)", refuses(r, "grades_ai_drafts_need_a_person"), r)
        r = draft_grade(NP_AI, enr2, final=False, role="service_role", keep=True)
        t.chk("AFTER 079: an AI draft (unfinalized) is written", r[0] == "ok", r)
        NP3 = written_item("human_graded", entered_on_new_page=True)
        cur.execute("BEGIN")
        b.publish(NP3)
        cur.execute("COMMIT")
        r = draft_grade(NP3, enr1, final=True, role="service_role", keep=False)
        t.chk("AFTER 079: a finalize on a new-page item without an ai_drafted path now passes", r[0] == "ok", r)

        # ===================== THE WORKLIST, END TO END (whole chain, 079 applied) =====================
        print("=== the nightly worklist query, run in full over the finished chain ===")
        import io
        import contextlib
        from argparse import Namespace
        from datetime import datetime, timedelta, timezone
        from psycopg2.extras import RealDictCursor  # noqa: F401  (the worklist asks for it itself)
        import lesson_aggregate as la
        past = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        wl = {}
        for key, paths, kw in [
            ("fall", [{"modality": "written"}], {}),
            ("ai", [{"modality": "written", "delivery": "typed_response", "grading": "ai_drafted", "warn": True}], {"entered_on_new_page": True}),
            ("human_new", [{"modality": "written", "delivery": "typed_response", "grading": "human_graded", "warn": True}], {"entered_on_new_page": True}),
            ("questions", [{"modality": "questions", "delivery": "online_questions", "grading": "auto_checked"}], {"entered_on_new_page": True}),
            ("inperson", [{"modality": "external", "delivery": "in_person", "grading": "hand_entered"}], {"entered_on_new_page": True}),
        ]:
            wl[key] = new_item(paths, due_by_day={"M": past}, **kw)
            cur.execute("BEGIN")
            b.publish(wl[key])
            cur.execute("COMMIT")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            la.cmd_worklist(Namespace(course="aid-101", day=None, as_of=None, latest=False, json=True), s.conn)
        listed = {i["slug"] for i in __import__("json").loads(out.getvalue())["items"]}
        t.chk("WORKLIST: the full query runs on the finished chain and lists the Fall-shaped item", wl["fall"]["slug"] in listed, sorted(listed))
        t.chk("WORKLIST: an ai_drafted item on a newer page is listed", wl["ai"]["slug"] in listed)
        t.chk("WORKLIST: a new human_graded typed response is not", wl["human_new"]["slug"] not in listed)
        t.chk("WORKLIST: an online-questions item and an in-person item are not",
              wl["questions"]["slug"] not in listed and wl["inperson"]["slug"] not in listed)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            la.cmd_worklist(Namespace(course="aid-101", day=None, as_of=None, latest=True, json=True), s.conn)
        t.chk("WORKLIST: --latest names one of the listed items", __import__("json").loads(out.getvalue()).get("slug") in listed, out.getvalue()[:120])

        # ============================ ROLLBACK 079/078 ==========================
        print("\n=== ROLLBACK ===")
        t.chk("ROLLBACK 079 applies", s.apply_file(R79, rollback=True))
        t.chk("ROLLBACK 079: all six triggers are back", trig_count() == 6, trig_count())
        NP4 = written_item("ai_drafted", entered_on_new_page=True)
        r = sql_try("UPDATE assignment_offerings SET is_published = true WHERE id = %s", (NP4["ao"],))
        t.chk("ROLLBACK 079: a new-page item cannot be published again", refuses(r, "new_stay_unpublished"), r)
        r = s.attempt(director, "INSERT INTO grades (enrollment_id, assignment_offering_id, points_earned, points_possible, source, is_finalized) "
                                "VALUES (%s,%s,1,2,'ai_suggested',true)", (enr3, NP3["ao"]))
        t.chk("ROLLBACK 079: a finalized grade on a new-page item is refused again", refuses(r, "grades_new_items_stay_unfinalized"), r)
        t.chk("ROLLBACK 079 can be applied over again (079 re-applies)", s.apply_file(M79))
        t.chk("ROLLBACK 078 refuses while an ai_drafted path exists and 079 is applied", not s.apply_file(R78, rollback=True, quiet=True))
        t.chk("ROLLBACK 079 applies once more", s.apply_file(R79, rollback=True))
        t.chk("ROLLBACK 078 applies once the step 1 grade rule is back", s.apply_file(R78, rollback=True))
        r = s.attempt(None, "UPDATE grades SET points_earned = 2 WHERE enrollment_id = %s AND assignment_offering_id = %s", (enr1, AI["ao"]), role="service_role")
        t.chk("ROLLBACK 078: the gap is open again", r == ("ok", 1), r)
        sql_do("UPDATE offering_activities SET grading = 'human_graded' WHERE grading = 'ai_drafted'")
        t.chk("ROLLBACK 077 applies at the end", s.apply_file(R77, rollback=True))
    finally:
        s.close()
    print(f"\n{t.p} passed, {t.f} failed")
    return 0 if t.f == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
