"""Offline tests for db_target.py: the one reader every staging tool uses. Nothing connects."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db_target as d  # noqa: E402

S = d.STAGING_REF
E = d.PRODUCTION_REF
E_ENC = E[:-2] + "%" + "77" + E[-1]  # the last two characters written with a percent escape
POOL = "aws-0-example.pooler.supabase.com"


def pooler(ref, tail="", pw="pw"):
    return f"postgresql://postgres.{ref}:{pw}@{POOL}:5432/postgres{tail}"  # allowlist-secret: invented test URL


def direct(ref, tail=""):
    return f"postgresql://postgres:pw@db.{ref}.supabase.co:5432/postgres{tail}"  # allowlist-secret: invented test URL


class Parse(unittest.TestCase):
    def test_accepts_staging_forms(self):
        self.assertEqual(d.parse(pooler(S)).ref, S)
        self.assertEqual(d.parse(direct(S)).ref, S)
        self.assertEqual(d.parse(pooler(S, "?sslmode=require")).ref, S)
        self.assertEqual(d.parse(pooler(S, pw="p%40ss%2Fword")).ref, S)  # escapes in a password are fine
        self.assertEqual(d.parse(f"postgresql://postgres.{S}:pw@db.{S}.supabase.co/postgres").ref, S)  # allowlist-secret: invented test URL

    def refused(self, url):
        """Not accepted as staging, by whatever route."""
        with self.assertRaises(d.DbTargetError, msg=url):
            d.require_staging(url)

    def unreadable(self, url):
        """The reader itself refuses: no ref comes out at all."""
        with self.assertRaises(d.DbTargetError, msg=url):
            d.parse(url)
        self.assertIsNone(d.ref_of(url))

    def test_probes_that_try_to_move_the_target(self):
        for tail in (f"?user=postgres.{E}", f"?host=db.{E}.supabase.co", "?hostaddr=10.0.0.1",
                     "?dbname=other", "?service=x", "?options=-csearch_path%3Dx",
                     "?sslmode=require&host=elsewhere", "?%73ervice=x"):
            self.unreadable(pooler(S, tail))

    def test_production_in_every_form(self):
        self.refused(direct(E))
        self.refused(pooler(E))
        self.unreadable(pooler(E_ENC))
        self.unreadable(direct(E_ENC))
        self.unreadable(f"postgresql://postgres:pw@db.{E_ENC}.supabase.co/postgres")  # allowlist-secret: invented test URL
        self.unreadable(f"postgresql://postgres.{S}:pw@db.{E_ENC}.supabase.co/postgres")  # allowlist-secret: invented test URL

    def test_production_is_not_staging(self):
        for url in (direct(E), pooler(E)):
            self.assertEqual(d.parse(url).ref, E)
            with self.assertRaises(d.DbTargetError):
                d.require_staging(url)

    def test_wrong_case(self):
        self.unreadable(pooler(S.upper()))
        self.unreadable(pooler(S[:3].upper() + S[3:]))

    def test_host_allow_list(self):
        for host in (f"db.{E}.supabase.co.", f"db.{S}.supabase.co.", f"DB.{E.upper()}.SUPABASE.CO",
                     f"db.{E}.supabase.com", "aws-0-example.pooler.supabase.com.", "pooler.supabase.com",
                     "evil.example", f"x.pooler.supabase.com.evil.example", "Aws-0.pooler.supabase.com",
                     f"db.{E}.supabase.co.evil.example", "localhost", "127.0.0.1"):
            self.unreadable(f"postgresql://postgres.{S}:pw@{host}:5432/postgres")  # allowlist-secret: invented test URL
            self.unreadable(f"postgresql://postgres:pw@{host}:5432/postgres")  # allowlist-secret: invented test URL
        # the trailing-dot form of a production host with a staging user
        self.unreadable(f"postgresql://postgres.{S}:pw@db.{E}.supabase.co.:5432/postgres")  # allowlist-secret: invented test URL
        self.assertEqual(d.parse(f"postgresql://postgres:pw@db.{S}.supabase.co:5432/postgres").ref, S)  # allowlist-secret: invented test URL

    def test_port_is_ascii_digits_only(self):
        self.assertEqual(d.parse(f"postgresql://postgres.{S}:pw@{POOL}:5432/postgres").ref, S)  # allowlist-secret: invented test URL
        for port in ("٥٤٣٢", "54 32", "543210", "-1", "5e3"):
            self.unreadable(f"postgresql://postgres.{S}:pw@{POOL}:{port}/postgres")  # allowlist-secret: invented test URL

    def test_user_and_host_disagree(self):
        self.unreadable(f"postgresql://postgres.{S}:pw@db.{E}.supabase.co:5432/postgres")  # allowlist-secret: invented test URL
        self.unreadable(f"postgresql://postgres.{E}:pw@db.{S}.supabase.co:5432/postgres")  # allowlist-secret: invented test URL

    def test_two_at_signs_and_escapes(self):
        self.unreadable(f"postgresql://postgres.{S}:p@w@{POOL}:5432/postgres")  # allowlist-secret: invented test URL
        self.unreadable(f"postgresql://postgres.{S}@x:pw@{POOL}:5432/postgres")  # allowlist-secret: invented test URL
        self.unreadable(f"postgresql://postgres%2e{S}:pw@{POOL}/postgres")  # allowlist-secret: invented test URL
        self.unreadable(f"postgresql://postgres.{S}:pw@aws%2d0-example.pooler.supabase.com/postgres")  # allowlist-secret: invented test URL

    def test_shapes(self):
        for url in ("", None, 42, "host=example dbname=postgres", f"https://postgres.{S}:pw@{POOL}/postgres",
                    f"postgresql://postgres.{S}:pw@/postgres", f"postgresql://postgres.{S}:pw@h1,h2/postgres",  # allowlist-secret: invented test URL
                    f"postgresql://postgres.{S}:pw@[::1]/postgres", "postgresql://postgres:pw@host.example/postgres",  # allowlist-secret: invented test URL
                    f"postgresql://postgres.{S}:pw@{POOL}:5432/postgres#frag",  # allowlist-secret: invented test URL
                    f"postgresql://postgres.x{S}:pw@{POOL}:5432/postgres"):  # allowlist-secret: invented test URL
            self.refused(url)

    def test_expect_ref_never_widens(self):
        self.assertEqual(d.require_staging(pooler(S), S).ref, S)
        for expect in (E, "abcdefghijklmnopqrst", ""):
            with self.assertRaises(d.DbTargetError):
                d.require_staging(pooler(S), expect)
        with self.assertRaises(d.DbTargetError):
            d.require_staging(pooler(E), E)

    def test_with_dbname(self):
        self.assertEqual(d.with_dbname(pooler(S, "?sslmode=require"), "drill_x"),
                         f"postgresql://postgres.{S}:pw@{POOL}:5432/drill_x?sslmode=require")  # allowlist-secret: invented test URL
        with self.assertRaises(d.DbTargetError):
            d.with_dbname(pooler(S), "x/../y")


if __name__ == "__main__":
    unittest.main()
