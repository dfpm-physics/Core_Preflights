"""Offline tests for deploy_functions.py. Fake transport; nothing touches the network."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deploy_functions as d  # noqa: E402

STG = d.STAGING_REF
ENV = {"STAGING_PROJECT_REF": STG, "SUPABASE_ACCESS_TOKEN": "tok-secret-value"}


class Fake:
    def __init__(self, status=201, listing=None):
        self.calls, self.status, self.listing = [], status, listing

    def __call__(self, method, url, headers, body):
        self.calls.append((method, url, headers, body))
        if method == "GET":
            return 200, json.dumps(self.listing or []).encode()
        return self.status, b"{}"


def run(args, env=ENV, t=None):
    lines = []
    t = t or Fake()
    rc = d.main(args, env=env, transport=t, out=lines.append)
    return rc, lines, t


class T(unittest.TestCase):
    def test_production_ref_refused(self):
        rc, _, t = run(["--expect-ref", d.PRODUCTION_REF, "--commit"],
                       env={"STAGING_PROJECT_REF": d.PRODUCTION_REF, "SUPABASE_ACCESS_TOKEN": "x"})
        self.assertEqual(rc, 2)
        self.assertEqual(t.calls, [])

    def test_production_expect_with_staging_env_refused(self):
        rc, _, t = run(["--expect-ref", d.PRODUCTION_REF, "--commit"])
        self.assertEqual(rc, 2)
        self.assertEqual(t.calls, [])

    def test_wrong_ref_refused(self):
        rc, _, t = run(["--expect-ref", "zzzzzzzzzz0123456789", "--commit"])
        self.assertEqual(rc, 2)
        self.assertEqual(t.calls, [])

    def test_unknown_project_refused_even_when_the_flag_agrees(self):
        other = "abcdefghij0123456789"
        rc, _, t = run(["--expect-ref", other, "--commit"],
                       env={"STAGING_PROJECT_REF": other, "SUPABASE_ACCESS_TOKEN": "x"})
        self.assertEqual(rc, 2)
        self.assertEqual(t.calls, [])

    def test_proxies_refused(self):
        for n in d.REFUSED:
            rc, _, t = run(["--expect-ref", STG, "--only", n, "--commit"])
            self.assertEqual(rc, 2)
            self.assertEqual(t.calls, [])
        rc, _, _ = run(["--expect-ref", STG, "--only", "nonsense"])
        self.assertEqual(rc, 2)

    def test_dry_run_sends_nothing_and_hides_token(self):
        rc, lines, t = run(["--expect-ref", STG])
        self.assertEqual(rc, 0)
        self.assertEqual(t.calls, [])
        self.assertNotIn("tok-secret-value", "\n".join(lines))
        self.assertEqual(len([l for l in lines if "verify_jwt=" in l]), 7)

    def test_commit_posts_each_and_multipart_well_formed(self):
        rc, lines, t = run(["--expect-ref", STG, "--commit"])
        self.assertEqual(rc, 0)
        self.assertEqual(len(t.calls), 7)
        m, url, h, body = t.calls[0]
        self.assertTrue(url.startswith(f"https://api.supabase.com/v1/projects/{STG}/functions/deploy?slug="))
        b = h["Content-Type"].split("boundary=")[1].encode()
        self.assertTrue(body.startswith(b"--" + b + b"\r\n"))
        self.assertTrue(body.endswith(b"--" + b + b"--\r\n"))
        self.assertEqual(body.count(b"--" + b + b"\r\n"), 2)  # metadata + one file
        self.assertIn(b'name="metadata"', body)
        self.assertIn(b'filename="index.ts"', body)
        self.assertNotIn("tok-secret-value", "\n".join(lines))
        slug = url.split("slug=")[1]
        meta = json.dumps({"name": slug, "entrypoint_path": "index.ts", "verify_jwt": d.DEPLOYABLE[slug]})
        self.assertIn(meta.encode(), body)

    def test_failure_exits_nonzero(self):
        rc, _, _ = run(["--expect-ref", STG, "--commit"], t=Fake(status=400))
        self.assertEqual(rc, 1)

    def test_verify(self):
        good = [{"slug": s, "status": "ACTIVE", "verify_jwt": v, "version": 1} for s, v in d.DEPLOYABLE.items()]
        rc, _, _ = run(["--expect-ref", STG, "--verify"], t=Fake(listing=good))
        self.assertEqual(rc, 0)
        rc, _, _ = run(["--expect-ref", STG, "--verify"], t=Fake(listing=good[:-1]))
        self.assertEqual(rc, 1)

    def test_import_escape_refused(self):
        with tempfile.TemporaryDirectory() as td:
            fd = Path(td) / "f"
            fd.mkdir()
            (fd / "index.ts").write_text('import x from "../_shared/a.ts";\n')
            with self.assertRaises(d.Refusal):
                d.collect_files("f", Path(td))
            (fd / "index.ts").write_text('import x from "./a.ts";\n')
            (fd / "a.ts").write_text("1")
            self.assertEqual([n for n, _ in d.collect_files("f", Path(td))], ["index.ts", "a.ts"])


if __name__ == "__main__":
    unittest.main()
