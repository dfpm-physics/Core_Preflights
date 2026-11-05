#!/usr/bin/env python3
"""Offline tests for migration_ledger.py and fingerprint_diff.py. No database, standard library only.

  python scripts/staging/test_migration_tools.py
"""

import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fingerprint_diff as fd  # noqa: E402
import migration_ledger as ml  # noqa: E402

A = "table | courses | r | true | false | prep_app_owner\nfunction | f() | abc | false | prep_app_owner\n"
GUARD = ("function | instructors_admin_flag_guard() | 123 | false | prep_app_owner\n"
         "trigger | instructors | instructors_admin_flag_guard | CREATE TRIGGER x\n")


class Checksum(unittest.TestCase):
    def test_line_endings_do_not_change_it(self):
        with tempfile.TemporaryDirectory() as d:
            lf, crlf, bom = Path(d, "a.sql"), Path(d, "b.sql"), Path(d, "c.sql")
            lf.write_bytes(b"SELECT 1;\nSELECT 2;\n")
            crlf.write_bytes(b"SELECT 1;\r\nSELECT 2;\r\n")
            bom.write_bytes(b"\xef\xbb\xbfSELECT 1;\r\nSELECT 2;\r\n")
            self.assertEqual(ml.checksum(lf), ml.checksum(crlf))
            self.assertEqual(ml.checksum(lf), ml.checksum(bom))

    def test_content_change_changes_it(self):
        with tempfile.TemporaryDirectory() as d:
            a, b = Path(d, "a.sql"), Path(d, "b.sql")
            a.write_bytes(b"SELECT 1;\n")
            b.write_bytes(b"SELECT 2;\n")
            self.assertNotEqual(ml.checksum(a), ml.checksum(b))


class Selection(unittest.TestCase):
    def test_rollback_files_are_not_in_the_chain(self):
        for chain in ("app", "public"):
            for p in ml.chain_files(chain):
                self.assertNotIn("ROLLBACK", p.name.upper())
                self.assertEqual(p.parent, ml.CHAIN_DIRS[chain])

    def test_through_stops_at_the_number(self):
        names = [r[1] for r in ml.select_rows("app", through="003")]
        self.assertEqual([n[:3] for n in names], ["001", "002", "003"])

    def test_public_chain_needs_named_files(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            ml.select_rows("public")

    def test_unknown_file_is_refused(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            ml.select_rows("app", only=["999_nothing.sql"])

    def test_production_is_refused(self):
        class Args:
            url_env = "TEST_LEDGER_URL"
            expect_ref = ml.PROD_REF
        import os
        os.environ["TEST_LEDGER_URL"] = f"postgresql://postgres.{ml.PROD_REF}:x@aws-0-example.pooler.supabase.com:5432/postgres"  # allowlist-secret: invented test URL
        try:
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                ml.connect_staging(Args)
        finally:
            del os.environ["TEST_LEDGER_URL"]

    def test_sql_text_is_quoted(self):
        text = ml.insert_sql([("app", "001_a.sql", "0" * 64)], "backfilled", "o'brien", "note")
        self.assertIn("'o''brien'", text)
        self.assertIn("ON CONFLICT (chain, filename) DO NOTHING", text)


class EarlierText(unittest.TestCase):
    def test_backfill_of_009_records_the_earlier_text(self):
        rows = {r[1]: r[2] for r in ml.select_rows("app", through="009", method="backfilled")}
        plain = {r[1]: r[2] for r in ml.select_rows("app", through="009")}
        self.assertEqual(rows["008_student_identity.sql"], plain["008_student_identity.sql"])
        self.assertEqual(rows["009_analysis_runs.sql"], ml.earlier_checksum("009_analysis_runs.sql"))

    def test_the_note_is_attached_to_that_row_only(self):
        sql = ml.insert_sql([("app", "009_analysis_runs.sql", "0" * 64), ("app", "008_x.sql", "1" * 64)],
                            "backfilled", "me", "plain note")
        self.assertIn(ml.EARLIER_NOTE, sql)
        self.assertEqual(sql.count(ml.EARLIER_NOTE), 1)
        self.assertIn("'plain note'", sql)
        applied = ml.insert_sql([("app", "009_analysis_runs.sql", "0" * 64)], "applied", "me", "plain note")
        self.assertNotIn(ml.EARLIER_NOTE, applied)


class FingerprintRefusal(unittest.TestCase):
    def run_tool(self, url, *extra):
        import os
        import subprocess
        env = dict(os.environ, FP_TEST_URL=url)
        return subprocess.run([sys.executable, str(Path(__file__).resolve().parent / "schema_fingerprint.py"),
                               "--url-env", "FP_TEST_URL", *extra],
                              capture_output=True, text=True, env=env, timeout=60)

    def test_production_is_refused_without_the_flag(self):
        import db_target
        r = self.run_tool(f"postgresql://postgres.{db_target.PRODUCTION_REF}:x@x.pooler.supabase.com:5432/postgres")  # allowlist-secret: invented test URL
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("REFUSED", r.stdout + r.stderr)
        self.assertIn("--allow-production-read", r.stdout + r.stderr)

    def run_dotenv(self, text):
        import subprocess
        with tempfile.TemporaryDirectory() as d:
            f = Path(d, "e.env")
            f.write_text(text, encoding="utf-8")
            return subprocess.run([sys.executable, str(Path(__file__).resolve().parent / "schema_fingerprint.py"),
                                   "--dotenv", str(f)], capture_output=True, text=True, timeout=60)

    def test_dotenv_ref_is_normalised_and_host_is_checked(self):
        import db_target
        prod = db_target.PRODUCTION_REF
        nl = chr(10)
        for lines in ([f"PREP_PROJECT_REF={prod.upper()}", "PREP_DB_HOST=x.pooler.supabase.com"],
                      [f"PREP_PROJECT_REF= {prod} ", "PREP_DB_HOST=x.pooler.supabase.com"],
                      [f"PREP_PROJECT_REF={db_target.STAGING_REF}", f"PREP_DB_HOST=db.{prod}.supabase.co"]):
            text = nl.join(lines) + nl
            r = self.run_dotenv(text)
            self.assertNotEqual(r.returncode, 0, text)
            self.assertIn("--allow-production-read", r.stdout + r.stderr)

    def test_an_unreadable_url_is_refused(self):
        r = self.run_tool("postgresql://u:x@x.pooler.supabase.com:5432/postgres")  # allowlist-secret: invented test URL
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("REFUSED", r.stdout + r.stderr)


class Rebaseline(unittest.TestCase):
    NAME = "025_pin_function_search_paths.sql"
    OLD = "a" * 64

    class Cur:
        def __init__(self):
            self.calls = []

        def execute(self, sql, params=None):
            self.calls.append((sql, params))

    class Conn:
        autocommit = True

        def commit(self):
            pass

        def rollback(self):
            pass

    def run_it(self, method, **kw):
        import argparse
        cur = self.Cur()
        args = argparse.Namespace(
            chain="app", through=None, only=[self.NAME], method="applied", by="t", commit=True,
            rebaseline=True, reason="text edited", rebaseline_applied=False,
            url_env="X", expect_ref="x")
        for k, v in kw.items():
            setattr(args, k, v)
        conn = self.Conn()
        conn.cursor = lambda: cur
        saved = (ml.connect_staging, ml.ledger_rows)
        ml.connect_staging = lambda a: conn
        ml.ledger_rows = lambda c: {("app", self.NAME): (self.OLD, method, "orig note")}
        try:
            with contextlib.redirect_stdout(io.StringIO()) as out:
                code = ml.cmd_record(args)
        finally:
            ml.connect_staging, ml.ledger_rows = saved
        return cur, out.getvalue(), code

    def refused(self, method, **kw):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            self.run_it(method, **kw)

    def test_a_reason_is_required(self):
        self.refused("backfilled", reason=None)
        self.refused("backfilled", reason="  ")

    def test_an_applied_row_needs_the_second_flag(self):
        self.refused("applied")

    def test_keeps_the_evidence(self):
        cur, out, code = self.run_it("applied", rebaseline_applied=True)
        updates = [c for c in cur.calls if c[0].startswith("UPDATE")]
        self.assertEqual(len(updates), 1)
        note = updates[0][1][1]
        self.assertIn(self.OLD, note)
        self.assertIn("text edited", note)
        self.assertIn("orig note", note)
        self.assertIn(self.OLD, out)
        self.assertEqual(code, 0)

    def test_a_backfilled_row_needs_only_a_reason(self):
        cur, _, _ = self.run_it("backfilled")
        self.assertTrue(any(c[0].startswith("UPDATE") for c in cur.calls))

    def test_without_the_flag_nothing_is_updated(self):
        cur, _, code = self.run_it("backfilled", rebaseline=False, reason=None)
        self.assertFalse(any(c[0].startswith("UPDATE") for c in cur.calls))
        self.assertEqual(code, 1)


class Diff(unittest.TestCase):
    def run_diff(self, a_bytes, b_bytes, *extra):
        with tempfile.TemporaryDirectory() as d:
            pa, pb = Path(d, "a.txt"), Path(d, "b.txt")
            pa.write_bytes(a_bytes)
            pb.write_bytes(b_bytes)
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = fd.main([str(pa), str(pb), *extra])
            return code, out.getvalue()

    def test_identical_in_every_encoding(self):
        utf8 = A.encode("utf-8")
        for other in (A.encode("utf-16"), A.encode("utf-8-sig"), A.encode("utf-16-le"),
                      A.replace("\n", "\r\n").encode("utf-16")):
            code, _ = self.run_diff(utf8, other)
            self.assertEqual(code, 0)

    def test_order_does_not_matter(self):
        code, _ = self.run_diff(A.encode(), "".join(reversed(A.splitlines(True))).encode())
        self.assertEqual(code, 0)

    def test_difference_is_reported(self):
        code, out = self.run_diff(A.encode(), (A + "table | extra | r | true | false | o\n").encode())
        self.assertEqual(code, 1)
        self.assertIn("only in B, UNEXPECTED", out)

    def test_023_is_expected_only_one_way(self):
        code, _ = self.run_diff(A.encode(), (A + GUARD).encode("utf-16"), "--expect", "held-back-023")
        self.assertEqual(code, 0)
        code, _ = self.run_diff((A + GUARD).encode(), A.encode(), "--expect", "held-back-023")
        self.assertEqual(code, 1)
        code, _ = self.run_diff(A.encode(), (A + GUARD).encode())
        self.assertEqual(code, 1)

    def test_something_else_beside_023_still_fails(self):
        extra = "table | extra | r | true | false | o\n"
        code, _ = self.run_diff(A.encode(), (A + GUARD + extra).encode(), "--expect", "held-back-023")
        self.assertEqual(code, 1)

    def test_empty_file_is_an_error(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as cm:
            self.run_diff(b"", A.encode())
        self.assertEqual(cm.exception.code, 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
