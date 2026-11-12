"""Offline tests for publish_test_site.py. Temp directories and a fake site with a fake production ref only."""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import publish_test_site as pts  # noqa: E402

PROD = {"url": "https://fakeprodref00000000.supabase.co", "anon": "sb_publishable_FAKEPROD"}
STG = {"url": "https://fakestgref000000000.supabase.co", "anon": "sb_publishable_FAKESTG"}


def fake_site(root):
    s = Path(root) / "site"
    (s / "gemini").mkdir(parents=True)
    (s / "gemini" / "a.html").write_bytes(
        b"<script>const U='" + PROD["url"].encode() + b"';const K='" + PROD["anon"].encode() + b"';</script>\r\n"
        b"<a href=\"https://dfpm-physics.github.io/Core_Preflights/site/x.html\">x</a>\r\n"
        b"<meta http-equiv=\"Content-Security-Policy\" content=\"connect-src 'self' https://*.supabase.co "
        b"wss://*.supabase.co\">\r\n")
    (s / "plain.html").write_bytes(b"<p>nothing here</p>\n")
    (s / "pic.png").write_bytes(b"\x89PNG" + PROD["anon"].encode())   # binary: copied, never rewritten
    return s


class Publish(unittest.TestCase):
    def test_rewrite_and_csp(self):
        with tempfile.TemporaryDirectory() as td:
            site, out = fake_site(td), Path(td) / "out"
            copied, rewritten = pts.build_site(site, out, PROD, STG)
            self.assertEqual((copied, rewritten), (3, 1))
            got = (out / "site/gemini/a.html").read_bytes()
            self.assertIn(STG["url"].encode(), got)
            self.assertIn(STG["anon"].encode(), got)
            self.assertIn(b"https://dfpm-physics.github.io/iPREP-staging/site/x.html", got)
            self.assertNotIn(b"*.supabase.co", got)
            self.assertIn(b"connect-src 'self' https://fakestgref000000000.supabase.co "
                          b"wss://fakestgref000000000.supabase.co", got)
            self.assertIn(b"\r\n", got)                                  # line endings kept
            self.assertEqual((out / "site/plain.html").read_bytes(), b"<p>nothing here</p>\n")
            for extra in ("index.html", ".nojekyll", "README.md"):
                self.assertTrue((out / extra).exists())
            self.assertIn(b"invented data only", (out / "README.md").read_bytes())

    def test_verify_fails_on_leftover(self):
        with tempfile.TemporaryDirectory() as td:
            site, out = fake_site(td), Path(td) / "out"
            pts.build_site(site, out, PROD, STG)
            self.assertEqual(pts.verify(out, PROD), ["site/pic.png"])   # the binary still holds the key
            rc, _, _ = pts.build(Path(td) / "out2", PROD, STG, site_dir=site)
            self.assertEqual(rc, 1)

    def test_verify_clean(self):
        with tempfile.TemporaryDirectory() as td:
            site = fake_site(td)
            (site / "pic.png").unlink()
            rc, copied, rewritten = pts.build(Path(td) / "out", PROD, STG, site_dir=site)
            self.assertEqual((rc, copied, rewritten), (0, 2, 1))

    def test_out_inside_repo_refused(self):
        with self.assertRaises(SystemExit):
            pts.check_out_dir(pts.REPO / "scratch-out")
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(SystemExit):
                pts.check_out_dir(Path(td) / "in" / "deeper", repo=Path(td))
            (Path(td) / "full").mkdir()
            (Path(td) / "full" / "f").write_text("x")
            with self.assertRaises(SystemExit):
                pts.check_out_dir(Path(td) / "full", repo=Path(td) / "elsewhere")

    def _clone(self, td, origin, branch="main"):
        c = Path(td) / "clone"
        c.mkdir()
        run = lambda *a: subprocess.run(["git", "-C", str(c), *a], check=True, capture_output=True)  # noqa: E731
        run("init", "-b", branch)
        run("remote", "add", "origin", origin)
        return c

    def test_wrong_origin_refused(self):
        with tempfile.TemporaryDirectory() as td:
            c = self._clone(td, "https://github.com/dfpm-physics/Core_Preflights.git")
            with self.assertRaises(SystemExit):
                pts.check_clone(c, repo=Path(td) / "elsewhere")

    def test_right_origin_accepted_and_diff(self):
        with tempfile.TemporaryDirectory() as td:
            c = self._clone(td, "https://github.com/dfpm-physics/iPREP-staging.git")
            pts.check_clone(c, repo=Path(td) / "elsewhere")
            (c / "old.txt").write_text("old")
            (c / "same.txt").write_text("same")
            (c / "chg.txt").write_text("1")
            b = Path(td) / "built"
            b.mkdir()
            (b / "same.txt").write_text("same")
            (b / "chg.txt").write_text("2")
            (b / "new.txt").write_text("new")
            self.assertEqual(pts.diff_trees(b, c), (["new.txt"], ["chg.txt"], ["old.txt"]))
            pts.replace_working_files(b, c)
            self.assertTrue((c / ".git").exists())
            self.assertFalse((c / "old.txt").exists())
            self.assertEqual((c / "chg.txt").read_text(), "2")

    def test_wrong_branch_refused(self):
        with tempfile.TemporaryDirectory() as td:
            c = self._clone(td, "https://github.com/dfpm-physics/iPREP-staging.git", branch="side")
            with self.assertRaises(SystemExit):
                pts.check_clone(c, repo=Path(td) / "elsewhere")


if __name__ == "__main__":
    unittest.main()
