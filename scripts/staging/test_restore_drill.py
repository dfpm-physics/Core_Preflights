"""Offline tests for restore_drill.py. Fake commands; nothing connects anywhere."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import restore_drill as r  # noqa: E402

SRC = "aaaaaaaaaa0000000001"
TGT = "bbbbbbbbbb0000000002"
ENV = {
    "DRILL_SOURCE_DB_URL": f"postgresql://postgres.{SRC}:pw-src-secret@aws-0-example.pooler.supabase.com:5432/postgres",  # allowlist-secret: invented test URL
    "DRILL_TARGET_DB_URL": f"postgresql://postgres.{TGT}:pw-tgt-secret@aws-0-example.pooler.supabase.com:5432/postgres",  # allowlist-secret: invented test URL
}
WHICH = lambda t: "/fake/" + t  # noqa: E731


class Runner:
    def __init__(self, dump_major="17", server=170002, counts_target=None, restore_rc=0):
        self.calls = []
        self.dump_major, self.server, self.restore_rc = dump_major, server, restore_rc
        self.counts_target = counts_target

    def __call__(self, cmd, env):
        self.calls.append((cmd, env))
        name = Path(cmd[0]).name
        if name == "pg_dump" and "--version" in cmd:
            return 0, f"pg_dump (PostgreSQL) {self.dump_major}.1\n", ""
        if name == "pg_dump":
            Path(cmd[cmd.index("-f") + 1]).write_bytes(b"x" * 100)
            return 0, "", ""
        if name == "pg_restore":
            return self.restore_rc, "", ""
        if name == "psql":
            sql = cmd[-1]
            if "CREATE SCHEMA" in sql or "INSERT INTO auth.users" in sql:
                return 0, "", ""
            if "server_version_num" in sql:
                return 0, f"{self.server}\n", ""
            is_target = env["PGUSER"].endswith(TGT) or env["PGDATABASE"].startswith("drill_")
            n = (self.counts_target if is_target and self.counts_target is not None else 5)
            return 0, f"app.students|{n}\napp.grades|7\n", ""
        return 1, "", "unexpected"


def run(extra, environ=ENV, runner=None, which=WHICH):
    lines = []
    runner = runner or Runner()
    td = tempfile.mkdtemp()
    res = str(Path(td) / "res.json")
    rc = r.main(["--source-ref", SRC, "--target-ref", TGT, "--target-is-scratch", "--result", res,
                 "--work-dir", td, *extra], environ=environ, runner=runner, which=which, out=lines.append)
    return rc, lines, runner, res


class T(unittest.TestCase):
    def refuse(self, args, environ=ENV):
        lines, rn = [], Runner()
        rc = r.main(args, environ=environ, runner=rn, which=WHICH, out=lines.append)
        self.assertEqual(rc, 2, lines)
        self.assertEqual(rn.calls, [])

    def test_refusals(self):
        base = ["--source-ref", SRC, "--target-ref", TGT, "--commit"]
        self.refuse(base)  # no --target-is-scratch
        self.refuse(["--source-ref", SRC, "--target-ref", r.PRODUCTION_REF, "--target-is-scratch", "--commit"])
        self.refuse(["--source-ref", SRC, "--target-ref", SRC, "--target-is-scratch", "--commit"])
        self.refuse(["--source-ref", r.PRODUCTION_REF, "--target-ref", r.STAGING_REF, "--target-is-scratch", "--commit"])
        bad = dict(ENV, DRILL_TARGET_DB_URL="postgresql://postgres.zzzzzzzzzz0000000009:p@h/postgres")  # allowlist-secret: invented test URL
        self.refuse(base + ["--target-is-scratch"], environ=bad)

    def test_url_that_names_production_while_the_flag_does_not(self):
        base = ["--source-ref", SRC, "--target-ref", TGT, "--target-is-scratch", "--commit"]
        prod = r.PRODUCTION_REF
        self.refuse(base, environ=dict(ENV, DRILL_TARGET_DB_URL=f"postgresql://postgres.{prod}:p@aws-0-example.pooler.supabase.com/postgres"))  # allowlist-secret: invented test URL
        self.refuse(base, environ=dict(ENV, DRILL_TARGET_DB_URL=f"postgresql://postgres.{prod[:-2]}%77{prod[-1]}:p@aws-0-example.pooler.supabase.com/postgres"))  # allowlist-secret: invented test URL
        # a target that carries the declared ref only as a decoy in the query
        self.refuse(base, environ=dict(ENV, DRILL_TARGET_DB_URL=f"postgresql://postgres.{prod}:p@aws-0-example.pooler.supabase.com/postgres?options={TGT}"))  # allowlist-secret: invented test URL
        self.refuse(base, environ=dict(ENV, DRILL_TARGET_DB_URL=f"postgresql://postgres.{TGT}:p@aws-0-example.pooler.supabase.com/postgres?user=postgres.{prod}"))  # allowlist-secret: invented test URL
        # a source URL for production with a flag that says something else
        self.refuse(base, environ=dict(ENV, DRILL_SOURCE_DB_URL=f"postgresql://postgres.{prod}:p@aws-0-example.pooler.supabase.com/postgres"))  # allowlist-secret: invented test URL

    def test_missing_tools(self):
        rc, lines, rn, _ = run([], which=lambda t: None)
        self.assertEqual(rc, 3)
        self.assertIn("MISSING TOOLS", "\n".join(lines))

    def test_dry_run_connects_to_nothing(self):
        rc, lines, rn, res = run([])
        self.assertEqual(rc, 0)
        self.assertEqual(rn.calls, [])
        self.assertFalse(Path(res).exists())

    def test_commit_success_and_no_secrets(self):
        rc, lines, rn, res = run(["--commit", "--include-auth-users"])
        self.assertEqual(rc, 0, lines)
        data = json.loads(Path(res).read_text())
        self.assertEqual(data["mismatched_tables"], [])
        self.assertIn("dump_seconds", data)
        self.assertIn("restore_seconds", data)
        blob = "\n".join(lines) + json.dumps(data)
        self.assertNotIn("pw-src-secret", blob)
        self.assertNotIn("pw-tgt-secret", blob)
        for cmd, _ in rn.calls:  # credentials never in argv
            self.assertNotIn("pw-", " ".join(cmd))

    def test_count_mismatch_nonzero(self):
        rc, _, _, res = run(["--commit"], runner=Runner(counts_target=4))
        self.assertEqual(rc, 1)
        self.assertTrue(json.loads(Path(res).read_text())["mismatched_tables"])

    def test_old_client_refused(self):
        rc, lines, _, _ = run(["--commit"], runner=Runner(dump_major="15", server=170002))
        self.assertEqual(rc, 2)
        self.assertIn("older", "\n".join(lines))


S = r.STAGING_REF


class FakeScratch:
    instances = []

    def __init__(self, url, name):
        self.url, self.name, self.created, self.dropped = url, name, False, False
        FakeScratch.instances.append(self)

    def create(self):
        self.created = True

    def source_user_ids(self):
        return ["00000000-0000-0000-0000-000000000001"]

    def drop(self):
        self.dropped = True
        return True


class StagingRehearsal(unittest.TestCase):
    ENV = {"DRILL_SOURCE_DB_URL": f"postgresql://postgres.{S}:pw-stg-secret@aws-0-example.pooler.supabase.com:5432/postgres"}  # allowlist-secret: invented test URL

    def go(self, args, environ=None, runner=None):
        lines, td = [], tempfile.mkdtemp()
        rn = runner or Runner()
        rc = r.main(["--source-ref", S, "--target-ref", S, "--result", str(Path(td) / "res.json"),
                     "--work-dir", td, *args], environ=environ or self.ENV, runner=rn, which=WHICH,
                    out=lines.append, scratch_db=FakeScratch)
        return rc, lines, rn, str(Path(td) / "res.json")

    def setUp(self):
        FakeScratch.instances = []

    def test_runs_and_drops_only_its_own_database(self):
        rc, lines, rn, res = self.go(["--target-db", "drill_x", "--commit"])
        self.assertEqual(rc, 0, lines)
        (inst,) = FakeScratch.instances
        self.assertTrue(inst.created and inst.dropped)
        self.assertEqual(inst.name, "drill_x")
        data = json.loads(Path(res).read_text())
        self.assertEqual(data["mismatched_tables"], [])
        self.assertTrue(data["scratch_dropped"])
        # every restore went to the drill database, never to the source's database
        for cmd, env in rn.calls:
            if Path(cmd[0]).name == "pg_restore":
                self.assertEqual(cmd[cmd.index("-d") + 1], "drill_x")
        self.assertNotIn("pw-stg-secret", "\n".join(lines) + json.dumps(data))

    def test_dropped_even_when_the_restore_fails(self):
        rc, _, _, _ = self.go(["--target-db", "drill_x", "--commit"], runner=Runner(restore_rc=1))
        self.assertEqual(rc, 1)
        self.assertTrue(FakeScratch.instances[0].dropped)

    def test_dry_run_creates_nothing(self):
        rc, _, rn, _ = self.go(["--target-db", "drill_x"])
        self.assertEqual(rc, 0)
        self.assertEqual(FakeScratch.instances, [])
        self.assertEqual(rn.calls, [])

    def test_refusals(self):
        for args in (["--target-db", "scratch_x"], ["--target-db", "drill_X"], ["--target-db", "postgres"],
                     ["--target-db", "drill_x;drop"]):
            rc, _, rn, _ = self.go(args + ["--commit"])
            self.assertEqual(rc, 2, args)
            self.assertEqual(rn.calls, [])
            self.assertEqual(FakeScratch.instances, [])
        # staging source with a production target flag, and the reverse
        for src_ref, tgt_ref in ((S, r.PRODUCTION_REF), (r.PRODUCTION_REF, S), (SRC, S)):
            lines, rn = [], Runner()
            rc = r.main(["--source-ref", src_ref, "--target-ref", tgt_ref, "--target-db", "drill_x", "--commit"],
                        environ=self.ENV, runner=rn, which=WHICH, out=lines.append, scratch_db=FakeScratch)
            self.assertEqual(rc, 2, (src_ref, tgt_ref))
        # a source URL that is production, declared as staging
        prod_env = {"DRILL_SOURCE_DB_URL": f"postgresql://postgres.{r.PRODUCTION_REF}:p@aws-0-example.pooler.supabase.com:5432/postgres"}  # allowlist-secret: invented test URL
        rc, _, rn, _ = self.go(["--target-db", "drill_x", "--commit"], environ=prod_env)
        self.assertEqual(rc, 2)
        self.assertEqual(FakeScratch.instances, [])

    def test_staging_is_still_no_target_without_target_db(self):
        lines = []
        rc = r.main(["--source-ref", SRC, "--target-ref", S, "--target-is-scratch", "--commit"],
                    environ=dict(ENV, DRILL_TARGET_DB_URL=f"postgresql://postgres.{S}:p@aws-0-example.pooler.supabase.com/postgres"),  # allowlist-secret: invented test URL
                    runner=Runner(), which=WHICH, out=lines.append)
        self.assertEqual(rc, 2)


if __name__ == "__main__":
    unittest.main()
