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

    def test_verify_case_and_encoding(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td)
            (out / "a.txt").write_bytes(b"x " + PROD["url"].upper().encode())              # upper case ref
            (out / "b.txt").write_bytes("%" .encode() + b"%".join(
                f"{ord(c):02X}".encode() for c in "fakeprodref00000000"))                  # %xx escapes
            (out / "c.txt").write_bytes(b"clean")
            self.assertEqual(pts.verify(out, PROD), ["a.txt", "b.txt"])

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

    def test_origin_must_be_anchored(self):
        with tempfile.TemporaryDirectory() as td:
            for url in ("https://evil.example/github.com/dfpm-physics/iPREP-staging.git",
                        "https://github.com/dfpm-physics/iPREP-staging.git/extra",
                        "https://github.com/other/dfpm-physics/iPREP-staging.git"):
                c = self._clone(td, url)
                with self.assertRaises(SystemExit, msg=url):
                    pts.check_clone(c, repo=Path(td) / "elsewhere")
                import shutil
                shutil.rmtree(c, ignore_errors=True)

    def test_push_url_checked(self):
        with tempfile.TemporaryDirectory() as td:
            c = self._clone(td, "https://github.com/dfpm-physics/iPREP-staging.git")
            subprocess.run(["git", "-C", str(c), "remote", "set-url", "--push", "origin",
                            "https://github.com/dfpm-physics/Core_Preflights.git"], check=True)
            with self.assertRaises(SystemExit):
                pts.check_clone(c, repo=Path(td) / "elsewhere")

    def test_shallow_clone_path_refused(self):
        with self.assertRaises(SystemExit):
            pts.check_clone(Path(Path.cwd().anchor) / "x", repo=Path.cwd())

    def test_sync_resets_to_origin_main(self):
        run = lambda cwd, *a: subprocess.run(["git", "-C", str(cwd), *a], check=True, capture_output=True)  # noqa: E731
        with tempfile.TemporaryDirectory() as td:
            remote = Path(td) / "remote.git"
            subprocess.run(["git", "init", "--bare", "-b", "main", str(remote)], check=True, capture_output=True)
            seed = Path(td) / "seed"
            subprocess.run(["git", "clone", str(remote), str(seed)], check=True, capture_output=True)
            for k, v in (("user.name", "t"), ("user.email", "t@example.com")):
                run(seed, "config", k, v)
            run(seed, "checkout", "-B", "main")
            (seed / "f.txt").write_text("1")
            run(seed, "add", "."); run(seed, "commit", "-m", "one"); run(seed, "push", "origin", "main")
            (seed / "f.txt").write_text("2")
            run(seed, "commit", "-am", "two"); run(seed, "push", "origin", "main")
            clone = Path(td) / "clone"
            subprocess.run(["git", "clone", str(remote), str(clone)], check=True, capture_output=True)
            run(clone, "reset", "--hard", "HEAD~1")                                       # behind origin
            self.assertEqual((clone / "f.txt").read_text(), "1")
            pts.sync_clone(clone, commit=True)
            self.assertEqual((clone / "f.txt").read_text(), "2")

    def test_extract_origin_main_is_read_only_and_ignores_a_lagging_head(self):
        run = lambda cwd, *a: subprocess.run(["git", "-C", str(cwd), *a], check=True, capture_output=True)  # noqa: E731
        with tempfile.TemporaryDirectory() as td:
            remote = Path(td) / "remote.git"
            subprocess.run(["git", "init", "--bare", "-b", "main", str(remote)], check=True, capture_output=True)
            seed = Path(td) / "seed"
            subprocess.run(["git", "clone", str(remote), str(seed)], check=True, capture_output=True)
            for k, v in (("user.name", "t"), ("user.email", "t@example.com")):
                run(seed, "config", k, v)
            run(seed, "checkout", "-B", "main")
            (seed / "f.txt").write_text("1")
            run(seed, "add", "."); run(seed, "commit", "-m", "one"); run(seed, "push", "origin", "main")
            (seed / "f.txt").write_text("2")
            run(seed, "commit", "-am", "two"); run(seed, "push", "origin", "main")
            clone = Path(td) / "clone"
            subprocess.run(["git", "clone", str(remote), str(clone)], check=True, capture_output=True)
            run(clone, "reset", "--hard", "HEAD~1")                                       # HEAD behind origin/main
            dest = Path(td) / "ref"
            dest.mkdir()
            self.assertTrue(pts.extract_origin_main(clone, dest))
            self.assertEqual((dest / "f.txt").read_text(), "2")                           # origin/main, not HEAD
            self.assertEqual((clone / "f.txt").read_text(), "1")                          # clone untouched
            b = Path(td) / "built"
            b.mkdir()
            (b / "f.txt").write_text("2")
            self.assertEqual(pts.diff_trees(b, dest), ([], [], []))                       # no false "changed"

    def test_sync_empty_remote_unborn_main(self):
        with tempfile.TemporaryDirectory() as td:
            remote = Path(td) / "remote.git"
            subprocess.run(["git", "init", "--bare", str(remote)], check=True, capture_output=True)
            clone = Path(td) / "clone"
            subprocess.run(["git", "clone", str(remote), str(clone)], check=True, capture_output=True)
            subprocess.run(["git", "-C", str(clone), "symbolic-ref", "HEAD", "refs/heads/trunk"], check=True)
            pts.sync_clone(clone, commit=True)
            out = subprocess.run(["git", "-C", str(clone), "symbolic-ref", "--short", "HEAD"],
                                 capture_output=True, text=True).stdout.strip()
            self.assertEqual(out, "main")

    def _remote_clone(self, td):
        run = lambda cwd, *a: subprocess.run(["git", "-C", str(cwd), *a], check=True, capture_output=True)  # noqa: E731
        remote = Path(td) / "remote.git"
        subprocess.run(["git", "init", "--bare", "-b", "main", str(remote)], check=True, capture_output=True)
        seed = Path(td) / "seed"
        subprocess.run(["git", "clone", str(remote), str(seed)], check=True, capture_output=True)
        for k, v in (("user.name", "t"), ("user.email", "t@example.com")):
            run(seed, "config", k, v)
        run(seed, "checkout", "-B", "main")
        (seed / "f.txt").write_text("1")
        run(seed, "add", "."); run(seed, "commit", "-m", "one"); run(seed, "push", "origin", "main")
        clone = Path(td) / "clone"
        subprocess.run(["git", "clone", str(remote), str(clone)], check=True, capture_output=True)
        return clone, run

    def test_dry_run_leaves_dirty_clone_untouched(self):
        with tempfile.TemporaryDirectory() as td:
            clone, run = self._remote_clone(td)
            (clone / "f.txt").write_text("edited")
            (clone / "extra.txt").write_text("x")
            pts.sync_clone(clone)                                   # dry run: fetch only
            self.assertEqual((clone / "f.txt").read_text(), "edited")
            self.assertTrue((clone / "extra.txt").exists())

    def test_commit_aborts_on_dirty_clone(self):
        with tempfile.TemporaryDirectory() as td:
            clone, run = self._remote_clone(td)
            (clone / "f.txt").write_text("edited")
            with self.assertRaises(SystemExit):
                pts.sync_clone(clone, commit=True)
            self.assertEqual((clone / "f.txt").read_text(), "edited")      # nothing reset

    def test_commit_aborts_on_local_commits(self):
        with tempfile.TemporaryDirectory() as td:
            clone, run = self._remote_clone(td)
            for k, v in (("user.name", "t"), ("user.email", "t@example.com")):
                run(clone, "config", k, v)
            (clone / "g.txt").write_text("local")
            run(clone, "add", "."); run(clone, "commit", "-m", "local")
            with self.assertRaises(SystemExit):
                pts.sync_clone(clone, commit=True)
            self.assertTrue((clone / "g.txt").exists())

    def test_unborn_head_on_master_becomes_main_before_reset(self):
        run = lambda cwd, *a: subprocess.run(["git", "-C", str(cwd), *a], check=True, capture_output=True)  # noqa: E731
        with tempfile.TemporaryDirectory() as td:
            remote = Path(td) / "remote.git"
            subprocess.run(["git", "init", "--bare", "-b", "main", str(remote)], check=True, capture_output=True)
            seed = Path(td) / "seed"
            subprocess.run(["git", "clone", str(remote), str(seed)], check=True, capture_output=True)
            for k, v in (("user.name", "t"), ("user.email", "t@example.com")):
                run(seed, "config", k, v)
            run(seed, "checkout", "-B", "main")
            (seed / "f.txt").write_text("1")
            run(seed, "add", "."); run(seed, "commit", "-m", "one"); run(seed, "push", "origin", "main")
            clone = Path(td) / "clone"
            clone.mkdir()
            run(clone, "init", "-b", "master")                      # unborn master, origin has main
            run(clone, "remote", "add", "origin", str(remote))
            pts.sync_clone(clone, commit=True)
            branch = subprocess.run(["git", "-C", str(clone), "symbolic-ref", "--short", "HEAD"],
                                    capture_output=True, text=True).stdout.strip()
            self.assertEqual(branch, "main")
            self.assertEqual((clone / "f.txt").read_text(), "1")

    def test_wrong_branch_refused(self):
        with tempfile.TemporaryDirectory() as td:
            c = self._clone(td, "https://github.com/dfpm-physics/iPREP-staging.git", branch="side")
            with self.assertRaises(SystemExit):
                pts.check_clone(c, repo=Path(td) / "elsewhere")


if __name__ == "__main__":
    unittest.main()
