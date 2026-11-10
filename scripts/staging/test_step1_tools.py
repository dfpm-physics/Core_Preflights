#!/usr/bin/env python3
"""Offline tests for the step 1 tools. No database, no network, standard library only.

  python scripts/staging/test_step1_tools.py

Covers the pure logic: how the connection is named and refused, how the 19 checks are read and judged, the snapshot
folder rule and its count comparison, the ported deadline rule against fixed vectors, the comparison of two reads, the
file lookup for apply and rollback, and the API probe's reading of the site's own select strings.
"""
import contextlib
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(REPO / "scripts" / "v2"))
import db_target  # noqa: E402
import step1_apply as ap_  # noqa: E402
import step1_cadet_api_check as api  # noqa: E402
import step1_compare as cmp_  # noqa: E402
import step1_conn as conn  # noqa: E402
import step1_precheck_run as pre  # noqa: E402
import step1_snapshot as snap  # noqa: E402

PROD, STG = db_target.PRODUCTION_REF, db_target.STAGING_REF
FAKE = "not-a-real-password"  # allowlist-secret: a made-up string, not a credential


def refused(fn, *a, **k):
    with contextlib.redirect_stderr(io.StringIO()):
        try:
            fn(*a, **k)
        except SystemExit as exc:
            return str(exc).startswith("REFUSED")
    return False


def prod_env(host="aws-0-us-east-1.pooler.supabase.com", ref=PROD, tier="READ"):
    return {"PREP_DB_HOST": host, "PREP_PROJECT_REF": ref, f"PREP_APP_{tier}_ROLE": f"prep_app_{tier.lower()}",
            f"PREP_APP_{tier}_PASSWORD": FAKE}


class Connection(unittest.TestCase):
    def test_production_shape_names_the_live_project(self):
        self.assertEqual(conn.from_env_dict(prod_env(), "read", "X").ref, PROD)

    def test_a_host_holding_the_live_ref_counts_as_live_whatever_the_ref_key_says(self):
        spec = conn.from_env_dict(prod_env(host=f"db.{PROD}.supabase.co", ref=STG), "read", "X")
        self.assertEqual(spec.ref, PROD)

    def test_a_missing_password_is_refused(self):
        env = prod_env()
        del env["PREP_APP_READ_PASSWORD"]
        self.assertTrue(refused(conn.from_env_dict, env, "read", "X"))

    def test_the_tier_picks_the_key(self):
        self.assertTrue(refused(conn.from_env_dict, prod_env(), "dml", "X"))
        self.assertEqual(conn.from_env_dict(prod_env(tier="DML"), "dml", "X").ref, PROD)

    def test_url_shape(self):
        url = f"postgresql://postgres.{STG}:{FAKE}@aws-0-x.pooler.supabase.com:5432/postgres"  # allowlist-secret: invented test value
        self.assertEqual(conn.from_env_dict({"STAGING_DB_URL": url}, "read", "STAGING_DB_URL").ref, STG)
        self.assertTrue(refused(conn.from_env_dict, {}, "read", "STAGING_DB_URL"))

    def test_the_password_is_not_in_the_spec_text(self):
        spec = conn.from_env_dict(prod_env(), "read", "X")
        self.assertNotIn(FAKE, repr(vars(spec).get("ref")) + str(spec.url))

    def test_resolve_refuses_the_live_project_without_the_flag(self):
        class A:
            env_file = None
            url_env = "STEP1_TEST_URL"
            url_key = "X"
        os.environ["STEP1_TEST_URL"] = f"postgresql://postgres.{PROD}:{FAKE}@aws-0-x.pooler.supabase.com:5432/postgres"  # allowlist-secret: invented test value
        try:
            self.assertTrue(refused(conn.resolve, A, False, "--allow-production-read"))
            self.assertEqual(conn.resolve(A, True, "--allow-production-read").ref, PROD)
        finally:
            del os.environ["STEP1_TEST_URL"]

    def test_a_third_project_is_refused_even_with_the_flag(self):
        class A:
            env_file = None
            url_env = "STEP1_TEST_URL"
            url_key = "X"
        os.environ["STEP1_TEST_URL"] = f"postgresql://postgres.abcdefghijklmnopqrst:{FAKE}@aws-0-x.pooler.supabase.com:5432/postgres"  # allowlist-secret: invented test value
        try:
            self.assertTrue(refused(conn.resolve, A, True, "--allow-production-read"))
        finally:
            del os.environ["STEP1_TEST_URL"]

    def test_expect_ref_must_match(self):
        spec = conn.from_env_dict(prod_env(), "read", "X")
        self.assertTrue(refused(conn.check_expect_ref, spec, STG))
        conn.check_expect_ref(spec, PROD)

    def test_env_file_reader_strips_quotes_and_comments(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d, "e.env")
            p.write_text('# c\nA="x y"\nB=z\n\nbad line\n', encoding="utf-8")
            self.assertEqual(conn.read_env_file(p), {"A": "x y", "B": "z"})
        self.assertTrue(refused(conn.read_env_file, "no-such-file.env"))


class Precheck(unittest.TestCase):
    def setUp(self):
        self.checks = pre.parse_checks(pre.SQL_FILE.read_text(encoding="utf-8"))

    def test_nineteen_checks_each_with_one_statement_and_an_expected_text(self):
        self.assertEqual([c["n"] for c in self.checks], list(range(1, 20)))
        for c in self.checks:
            self.assertTrue(c["sql"].upper().startswith(("SELECT", "SHOW")), c["n"])
            self.assertNotIn(";", c["sql"], c["n"])
            self.assertTrue(c["expected"], c["n"])

    def test_no_check_writes(self):
        for c in self.checks:
            self.assertFalse(any(w in c["sql"].upper().split() for w in ("INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE")), c["n"])

    def j(self, n, cols, rows, stage="before"):
        return pre.judge(n, cols, rows, stage, "prep_app_read")[0]

    def test_role_check(self):
        self.assertEqual(self.j(1, ["a", "b"], [("prep_app_read", "prep_app_read")]), "OK")
        self.assertEqual(self.j(1, ["a", "b"], [("postgres", "postgres")]), "LOOK")

    def test_training_case_is_expected_before_and_forbidden_after(self):
        self.assertEqual(self.j(10, ["c", "n"], [("phys-215", 2)]), "OK")
        self.assertEqual(self.j(10, ["c", "n"], [("phys-215", 2)], "after-training"), "LOOK")
        self.assertEqual(self.j(10, ["c", "n"], [], "after-training"), "OK")
        self.assertEqual(self.j(10, ["c", "n"], [("phys-110", 2)]), "LOOK")

    def test_check_16_flips_with_the_stage(self):
        self.assertEqual(self.j(16, ["n"], [(0,)]), "OK")
        self.assertEqual(self.j(16, ["n"], [(80,)]), "LOOK")
        self.assertEqual(self.j(16, ["n"], [(80,)], "after-training"), "OK")

    def test_023_must_stay_absent(self):
        self.assertEqual(self.j(5, ["f", "t"], [(False, False)], "after-043"), "OK")
        self.assertEqual(self.j(5, ["f", "t"], [(True, True)]), "LOOK")

    def test_ledger_follows_the_stage(self):
        self.assertEqual(self.j(6, ["l"], [(False,)]), "OK")
        self.assertEqual(self.j(6, ["l"], [(True,)], "after-025"), "OK")
        self.assertEqual(self.j(6, ["l"], [(False,)], "after-025"), "LOOK")

    def test_only_two_modalities_pass(self):
        self.assertEqual(self.j(12, ["m", "n"], [("interactive", 1), ("written", 2)]), "OK")
        self.assertEqual(self.j(12, ["m", "n"], [("written", 2), ("external", 1)]), "LOOK")

    def test_041_helpers_before_and_after(self):
        cols = ["proname", "owner", "sd", "path", "verdict"]
        self.assertEqual(self.j(18, cols, [("TOTAL", None, None, None, "LOOK: expected 7, found 0")]), "OK")
        rows = [("TOTAL", None, None, None, "ok")] + [(f"f{i}", "o", False, "p", "ok") for i in range(7)]
        self.assertEqual(self.j(18, cols, rows, "after-043"), "OK")
        rows[3] = ("f2", "o", True, "p", "LOOK")
        self.assertEqual(self.j(18, cols, rows, "after-043"), "LOOK")
        self.assertEqual(self.j(18, cols, rows[:4], "after-043"), "LOOK")

    def test_note_checks_never_look(self):
        self.assertEqual(self.j(14, ["n"], [(42,)]), "NOTE")
        self.assertEqual(self.j(15, ["a", "b"], [(False, 8), (True, 20)]), "NOTE")

    def test_guard_trigger_before_and_after(self):
        self.assertEqual(self.j(19, ["t", "e", "verdict"], []), "OK")
        self.assertEqual(self.j(19, ["t", "e", "verdict"], [], "after-043"), "LOOK")
        self.assertEqual(self.j(19, ["t", "e", "verdict"], [("g", "O", "ok")], "after-043"), "OK")

    def test_every_check_has_a_judgement(self):
        for n in range(1, 20):
            try:
                note = pre.judge(n, ["x"], [(0,)], "before", "prep_app_read")[1]
            except (IndexError, ValueError):
                continue   # it reached a real branch that wants more columns than this dummy row has
            self.assertNotIn("no judgement written", note, n)


class SnapshotRules(unittest.TestCase):
    def test_the_default_folder_is_ignored_by_git(self):
        self.assertTrue(snap.git_ignores(snap.default_folder()))

    def test_a_tracked_folder_is_refused(self):
        self.assertFalse(snap.git_ignores(REPO / "scripts" / "not_ignored_snapshot_folder"))

    def test_a_folder_outside_every_work_tree_is_allowed(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertTrue(snap.git_ignores(Path(d) / "snap"))

    def test_check_folder_rules_exits_on_a_tracked_folder(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            snap.check_folder_rules(REPO / "docs" / "snapshot_here")

    def manifest(self, written=5, in_txn=5, sha="a"):
        return {"tables": {"grades": {"lines_written": written, "count_in_transaction": in_txn, "sha256": sha}}}

    def test_matching_counts_pass(self):
        f, w = snap.judge(self.manifest(), {"grades": (5, "a", 10)}, {"grades": 5})
        self.assertEqual((f, w), ([], []))

    def test_a_short_write_fails(self):
        f, _ = snap.judge(self.manifest(written=4), {"grades": (4, "a", 10)}, {"grades": 5})
        self.assertTrue(f)

    def test_a_file_that_changed_on_disk_fails(self):
        f, _ = snap.judge(self.manifest(), {"grades": (5, "b", 10)}, {"grades": 5})
        self.assertTrue(f)
        f, _ = snap.judge(self.manifest(), {}, {"grades": 5})
        self.assertTrue(f)

    def test_growth_warns_and_shrinkage_fails(self):
        f, w = snap.judge(self.manifest(), {"grades": (5, "a", 10)}, {"grades": 7})
        self.assertEqual((f, len(w)), ([], 1))
        f, _ = snap.judge(self.manifest(), {"grades": (5, "a", 10)}, {"grades": 4})
        self.assertTrue(f)

    def test_file_facts_counts_lines_and_hashes(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d, "t.jsonl")
            p.write_bytes(b'{"a":1}\n{"a":2}\n')
            n, sha, size = snap.file_facts(p)
            self.assertEqual((n, size), (2, 16))
            self.assertEqual(len(sha), 64)


class DeadlineRule(unittest.TestCase):
    MS_2026_09_01 = 1788220800000   # 2026-09-01T00:00:00Z

    def test_day_value_vectors(self):
        p = cmp_.parse_day_value
        self.assertEqual(p("2026-09-01"), self.MS_2026_09_01)
        self.assertEqual(p("2026-09-01T00:00:00Z"), self.MS_2026_09_01)
        self.assertEqual(p("2026-09-01T06:00:00-06:00"), self.MS_2026_09_01 + 12 * 3600 * 1000)
        self.assertEqual(p("2026-09-01T06:00:00-0600"), self.MS_2026_09_01 + 12 * 3600 * 1000)
        self.assertEqual(p("2026-09-01T00:00:00.123456789Z"), self.MS_2026_09_01 + 123)
        self.assertEqual(p("2026-09-01T00:00Z"), self.MS_2026_09_01)
        self.assertEqual(p("2026-09-01T07:00+07"), self.MS_2026_09_01)

    def test_unusable_values(self):
        p = cmp_.parse_day_value
        for bad in ("now", "today", "infinity", "2026-09-01T10:00:00", "2026-02-30", "2026-13-01",
                    "2026-09-01 10:00:00Z", "2026-09-01T25:00:00Z", "", "9/1/2026", "2026-09-01T10:00:00 BC"):
            self.assertIsNone(p(bad), bad)

    def test_tier_two_beats_everything(self):
        self.assertEqual(cmp_.scheduled(1, {"M": "2026-09-01"}, ["M"], 5), [5, "section", False])

    def test_tier_three_uses_the_first_meeting_day_with_a_value(self):
        by_day = {"T": "2026-09-02", "M": "2026-09-01"}
        self.assertEqual(cmp_.scheduled(1, by_day, ["M", "T"], None)[0], self.MS_2026_09_01)
        self.assertEqual(cmp_.scheduled(1, by_day, ["T", "M"], None)[0], self.MS_2026_09_01 + 86400000)
        self.assertEqual(cmp_.scheduled(1, {"M": None, "T": ""}, ["M", "T"], None), [1, "offering", False])

    def test_an_unusable_day_value_does_not_fall_through(self):
        self.assertEqual(cmp_.scheduled(1, {"M": "soon"}, ["M"], None), [None, "none", True])

    def test_offering_then_none(self):
        self.assertEqual(cmp_.scheduled(9, {}, [], None), [9, "offering", False])
        self.assertEqual(cmp_.scheduled(None, {}, ["M"], None), [None, "none", False])

    def test_a_stored_value_no_meeting_day_reaches_is_flagged(self):
        self.assertEqual(cmp_.scheduled(None, {"W": "2026-09-01"}, ["M"], None), [None, "none", True])

    def test_a_non_object_by_day_is_empty(self):
        self.assertEqual(cmp_.scheduled(9, ["x"], ["M"], None), [9, "offering", False])


class Comparison(unittest.TestCase):
    def extra(self, **kw):
        base = {"scheduled": {"o|s": [1, "offering", False]}, "extensions": {"o|e": 5}, "function_answers": {},
                "grade_cols": ["points_earned", "is_finalized"], "grade_values": {"g1": ["1", "t"], "g2": ["0", "f"]}}
        base.update(kw)
        return base

    def test_identical_reads_are_quiet(self):
        a = self.extra()
        self.assertEqual(cmp_.compare_deadlines(a, self.extra()), [])
        self.assertEqual(cmp_.compare_values(a, self.extra()), [])

    def test_a_moved_deadline_is_a_look(self):
        looks = cmp_.compare_deadlines(self.extra(), self.extra(scheduled={"o|s": [2, "offering", False]}))
        self.assertTrue(any("MOVED" in x for x in looks))

    def test_a_changed_source_alone_is_a_move(self):
        looks = cmp_.compare_deadlines(self.extra(), self.extra(scheduled={"o|s": [1, "day", False]}))
        self.assertTrue(looks)

    def test_gone_and_new_pairs_are_reported(self):
        looks = cmp_.compare_deadlines(self.extra(), self.extra(scheduled={"o|t": [1, "offering", False]}))
        self.assertEqual(len(looks), 2)

    def test_extension_changes_are_reported(self):
        self.assertTrue(cmp_.compare_deadlines(self.extra(), self.extra(extensions={})))

    def test_function_disagreement_is_a_look_and_absence_is_silent(self):
        ok = self.extra(function_answers={"o|s": [1, "offering", False]})
        self.assertEqual(cmp_.compare_function(ok), ([], 1))
        bad = self.extra(function_answers={"o|s": [2, "offering", False]})
        self.assertTrue(cmp_.compare_function(bad)[0])
        self.assertEqual(cmp_.compare_function(self.extra()), ([], 0))
        missing = self.extra(function_answers={"o|other": [1, "offering", False]})
        self.assertTrue(cmp_.compare_function(missing)[0])

    def test_a_changed_score_column_names_the_column(self):
        new = self.extra(grade_values={"g1": ["2", "t"], "g2": ["0", "f"]})
        looks = cmp_.compare_values(self.extra(), new)
        self.assertEqual(len(looks), 1)
        self.assertIn("points_earned x1", looks[0])
        self.assertNotIn("is_finalized", looks[0])

    def test_a_new_grade_is_not_a_changed_grade(self):
        new = self.extra(grade_values={"g1": ["1", "t"], "g2": ["0", "f"], "g3": ["1", "t"]})
        self.assertEqual(cmp_.compare_values(self.extra(), new), [])

    def test_the_output_says_what_it_cannot_detect(self):
        text = " ".join(cmp_.CANNOT).lower()
        for phrase in ("who changed", "undone", "policy", "page"):
            self.assertIn(phrase, text)


class ApplyLookup(unittest.TestCase):
    base = REPO / "supabase" / "migrations" / "app"

    def test_number_stem_and_file_name_find_the_same_file(self):
        a = ap_.find_file(self.base, "026", False)
        self.assertEqual(a, ap_.find_file(self.base, a.stem, False))
        self.assertEqual(a, ap_.find_file(self.base, a.name, False))

    def test_rollback_lookup_finds_only_rollback_files(self):
        r = ap_.find_file(self.base / "rollback", "043", True)
        self.assertIn("ROLLBACK", r.name)
        self.assertTrue(refused(ap_.find_file, self.base / "rollback", "9999", True))

    def test_an_unknown_name_is_refused(self):
        self.assertTrue(refused(ap_.find_file, self.base, "999", False))
        self.assertTrue(refused(ap_.find_file, self.base, "not_a_file", False))

    def test_the_whole_runbook_range_resolves(self):
        for n in range(24, 44):
            ap_.find_file(self.base, f"{n:03d}", False)
            ap_.find_file(self.base / "rollback", f"{n:03d}", True)

    def test_unlock_names_one_file_only(self):
        f37 = ap_.find_file(self.base / "rollback", "037", True)
        f36 = ap_.find_file(self.base / "rollback", "036", True)
        ap_.check_unlock([f37], "037")
        with contextlib.redirect_stderr(io.StringIO()):
            for files, n in (([f37], "036"), ([f37, f36], "037")):
                with self.assertRaises(SystemExit):
                    ap_.check_unlock(files, n)

    def test_checksum_ignores_line_endings(self):
        with tempfile.TemporaryDirectory() as d:
            a, b = Path(d, "a.sql"), Path(d, "b.sql")
            a.write_bytes(b"SELECT 1;\nSELECT 2;\n")
            b.write_bytes(b"SELECT 1;\r\nSELECT 2;\r\n")
            self.assertEqual(ap_.checksum(a), ap_.checksum(b))

    def test_xid_record_appends_a_labelled_range(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d, "x.txt")
            self.assertEqual(ap_.record(p, "026", 100, 103), 4)
            self.assertEqual(ap_.record(p, "027", 110, 110), 1)
            import grades_fingerprint as gf
            self.assertEqual(gf.read_xids(str(p)), {100, 101, 102, 103, 110})


class ApiProbe(unittest.TestCase):
    def test_the_sites_own_selects_are_read(self):
        consts = api.extract_constants((REPO / "site" / "js" / "schema.js").read_text(encoding="utf-8"))
        for _table, src in api.PROBES:
            if not src.startswith("'"):
                self.assertIn(src, consts)
                self.assertGreater(len(consts[src]), 10)
        self.assertIn("assignment_due_dates(section_id,due_at)", consts["OFFERING_SELECT"])
        # The student pages read the my_grades view, which exposes the note as its own column and no diagnostic.
        self.assertIn("instructor_note", consts["GRADE_SELECT_STUDENT"])
        self.assertNotIn("diagnostic", consts["GRADE_SELECT_STUDENT"].replace("instructor_note", ""))
        self.assertIn((api.GRADE_TABLE, "GRADE_SELECT_STUDENT"), api.PROBES)
        # The grade source follows the site folder: this tree reads the view, an older site reads the table.
        self.assertEqual(api.grade_table((REPO / "site" / "js" / "student-data.js").read_text(encoding="utf-8")), "my_grades")
        self.assertEqual(api.grade_table("db.from('grades').select(GRADE_SELECT_STUDENT)"), "grades")
        self.assertEqual(api.grade_table("db.from( 'my_grades' ).select(x)"), "my_grades")

    def test_config_gives_both_projects(self):
        cfg = api.parse_config((REPO / "site" / "js" / "config.js").read_text(encoding="utf-8"))
        self.assertIn(PROD, cfg["production"][0])
        self.assertIn(STG, cfg["staging"][0])

    def test_classification(self):
        self.assertEqual(api.classify(200, "[]"), ("ok", None))
        self.assertEqual(api.classify(200, '[{"id":1}]')[0], "rows")
        self.assertEqual(api.classify(400, '{"code":"42703"}')[0], "structural")
        self.assertEqual(api.classify(400, '{"code":"PGRST200"}')[0], "structural")
        self.assertEqual(api.classify(401, '{"code":"42501"}')[0], "permission")
        self.assertEqual(api.classify(500, "not json")[0], "other")

    def test_a_probe_without_a_working_control_is_inconclusive_never_ok(self):
        s = ("structural", "42703")
        self.assertEqual(api.verdict(("ok", None), s)[0], "OK")
        self.assertEqual(api.verdict(("permission", "42501"), s)[0], "OK")
        self.assertEqual(api.verdict(("ok", None), ("permission", "42501"))[0], "INCONCLUSIVE")
        self.assertEqual(api.verdict(("structural", "PGRST200"), s)[0], "BROKEN")
        self.assertEqual(api.verdict(("rows", None), s)[0], "LOOK")


class BackfillDotenv(unittest.TestCase):
    def test_check_ref_rules_match_check_target(self):
        import backfill_paths as bp
        bp.check_ref(STG, STG, False)
        bp.check_ref(PROD, PROD, True)
        self.assertTrue(refused(bp.check_ref, PROD, PROD, False))
        self.assertTrue(refused(bp.check_ref, PROD, STG, True))
        self.assertTrue(refused(bp.check_ref, "abcdefghijklmnopqrst", "abcdefghijklmnopqrst", True))

    def test_dotenv_over_the_live_project_needs_the_flag(self):
        import backfill_paths as bp
        with tempfile.TemporaryDirectory() as d:
            p = Path(d, "e.env")
            p.write_text("\n".join(f"{k}={v}" for k, v in prod_env(tier="DML").items()), encoding="utf-8")
            self.assertTrue(refused(bp.connect_dotenv, str(p), PROD, False))

    def test_both_connection_options_together_are_refused(self):
        import backfill_paths as bp
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            bp.main(["--dotenv", "x.env", "--url-env", "X", "--expect-ref", STG])


if __name__ == "__main__":
    unittest.main(verbosity=1)
