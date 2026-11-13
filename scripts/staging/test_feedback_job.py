"""Offline tests for feedback_job.py. Temporary git repos only: no database, no network, no push, no publish.

Strings that look like credentials or like forbidden code are built by concatenation, so this file's own diff
does not trip a scanner.
"""
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import feedback_job as fj  # noqa: E402
import scrubbed_git as sg  # noqa: E402

REPO = HERE.parents[1]
ORIG_MARK = fj.do_mark
ORIG_GUARD = fj.staging_guard
U = [None] + [f"00000000-0000-4000-8000-00000000000{i}" for i in range(1, 7)]
U1, U2, U3, U4, U5, U6 = U[1:]
GIT_ENV = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.org",
           "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.org"}
REMOTE = "https://github.com/dfpm-physics/Core_Preflights.git"
A_OK = "<p>Hello</p>\n<a href=\"b.html\">b</a>\n"             # a text-only fix of site/a.html
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 20
CSP_TOKEN = "'sha256-" + "A" * 43 + "='"
STAGING_URL = "postgresql://postgres." + "wkibept" + "ktbnaddfynrwr" + ":pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres"  # allowlist-secret: fake test URL, password is the literal 'pw'
PROD_URL = "postgresql://postgres." + "shzvpmlnq" + "fmzfmuxkowi" + ":pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres"  # allowlist-secret: fake test URL, password is the literal 'pw'


def sh(cwd, *args):
    r = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True, env={**os.environ, **GIT_ENV})
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


def write(root, rel, data):
    p = Path(root) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data if isinstance(data, bytes) else data.encode("utf-8"))


BASE_FILES = {
    "site/a.html": "<p>Helo</p>\n<a href=\"b.html\">b</a>\n",
    "site/b.html": "<p>b</p>\n",
    "site/host.html": "<a href=\"https://known.example.org/x\">k</a>\n",
    "site/cdn.html": "<a href=\"https://cdn.jsdelivr.net/npm/pkg@1.0.0/dist/a.js\">c</a>\n",
    "site/inline.html": ("<meta http-equiv=\"Content-Security-Policy\" content=\"script-src 'self' " + CSP_TOKEN + "\">\n"
                         "<p>text</p>\n<script>\nconst a = 1;\n</script>\n"),
    "site/form.html": "<textarea>old</textarea>\n<p>p</p>\n",
    "site/styled.html": "<div class=\"a b\">t</div>\n<p>q</p>\n",
    "site/help/h.md": "# Help\n\nA line.\n",
    "site/css/s.css": "a { color: red; }\n",
    "site/js/app.js": "const x = 1;\n",
    "site/js/auth.js": "const a = 1;\n",
    "site/js/config.js": "const c = 1;\n",
    "site/js/other.js": "const user = 1;\nif (role === 'x') {}\n",
    "site/data.json": "{}\n",
    "site/media/p.png": PNG,
    "CHANGELOG.md": "# Changelog\n",
    "tests/a.mjs": "1\n",
    "scripts/x.py": "1\n",
    ".gitignore": "a\n",
}


def row(rid, files, decision="applied", **kw):
    d = {"id": rid, "decision": decision, "files": files, "summary": f"fix {rid}", "skeptic": "PASS"}
    d.update(kw)
    return d


class Scenario(unittest.TestCase):
    """TOOLS is a git repo with a (fake) GitHub remote URL; WORK is a plain clone of it, at the same commit.
    The run, held and summary locations are outside both."""

    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.addCleanup(self._cleanup)
        root = Path(self._td.name)
        self.root = root
        self.tools, self.work = root / "tools", root / "work"
        self.run_dir, self.held_dir = root / "run", root / "held"
        self.summary = root / "out" / "summary.json"
        self.tools.mkdir()
        sh(self.tools, "init", "-q")
        sh(self.tools, "config", "user.name", "t")
        sh(self.tools, "config", "user.email", "t@example.org")
        sh(self.tools, "remote", "add", "origin", REMOTE)
        for name in ("secret_scan.py", "csp_pages.py"):
            (self.tools / "scripts" / "checks").mkdir(parents=True, exist_ok=True)
            shutil.copy(REPO / "scripts" / "checks" / name, self.tools / "scripts" / "checks" / name)
        for rel, data in BASE_FILES.items():
            write(self.tools, rel, data)
        sh(self.tools, "add", "-A")
        sh(self.tools, "commit", "-q", "-m", "base")
        subprocess.run(["git", "clone", "-q", str(self.tools), str(self.work)], check=True, capture_output=True)
        self.base = sh(self.work, "rev-parse", "HEAD")
        self.fb_rows = [{"id": U[i], "status": "new", "page_title": f"Page {i}"} for i in range(1, 6)]
        self.addCleanup(mock.patch.stopall)
        self.mark = mock.patch.object(fj, "do_mark", return_value=True).start()
        mock.patch.object(fj, "staging_guard").start()
        stack = contextlib.ExitStack()
        stack.enter_context(fj.git_session())
        self.addCleanup(stack.close)
        os.environ.update(GIT_ENV)

    def _cleanup(self):
        # held worktrees are registered in the tools repo; drop them so the temp folder can be removed
        sh_ok = subprocess.run(["git", "-C", str(self.tools), "worktree", "prune"], capture_output=True)
        del sh_ok
        shutil.rmtree(self._td.name, onerror=fj._retry_rw)
        self._td.cleanup()

    def propose(self, rows, dry=False, base=None, feedback_base=None, run=None, held=None, summary=None):
        run = Path(run or self.run_dir)
        run.mkdir(parents=True, exist_ok=True)
        (self.work / fj.RUN_DIR).mkdir(exist_ok=True)
        fb = json.dumps({"base": feedback_base or self.base, "rows": self.fb_rows})
        write(run, "feedback.json", fb)
        write(self.work, fj.RUN_DIR + "/feedback.json", fb)
        write(self.work, fj.RUN_DIR + "/manifest.json", json.dumps({"rows": rows}))
        out = io.StringIO()
        try:
            with redirect_stdout(out):
                code = fj.propose(self.work, self.tools, base or self.base, summary or self.summary,
                                  run, held or self.held_dir, dry_run=dry)
            return code, out.getvalue()
        except fj.Refuse as exc:
            return exc.code, str(exc)

    def refused(self, rows, code=2, **kw):
        """The whole run is refused before any write."""
        got, msg = self.propose(rows, **kw)
        self.assertEqual(got, code, msg)
        self.assertFalse(self.mark.called)
        self.assertFalse(self.summary.exists() or (self.summary.parent / "summary.txt").exists())
        self.assertFalse(self.held_dir.exists() and any(self.held_dir.iterdir()))
        return msg

    def edit(self, rel, data):
        write(self.work, rel, data)

    def one(self, rel, text, files=None):
        """Edit one allowed file and list it on one applied row."""
        self.edit(rel, text)
        return [row(U1, files or [rel])]

    def reset_work(self):
        sh(self.work, "reset", "-q", "--hard", self.base)
        sh(self.work, "clean", "-qfd", "-e", fj.RUN_DIR)

    def settle(self):
        """Put WORK, the mock and the output folders back, so one test can run several cases."""
        self.reset_work()
        self.mark.reset_mock()
        shutil.rmtree(self.summary.parent, ignore_errors=True)
        shutil.rmtree(self.held_dir, ignore_errors=True)
        (self.run_dir / "held.json").unlink(missing_ok=True)
        sh(self.tools, "worktree", "prune")
        for b in sh(self.tools, "branch", "--list", "feedback-held-*", "--format=%(refname:short)").split():
            sh(self.tools, "branch", "-D", b)

    def rowrefused(self, rows, rule=None, other_held=False):
        """The run goes on, but the first row is refused: no worktree, marked proposed with the refusal note.
        Returns the detail record of the refusal."""
        got, msg = self.propose(rows)
        self.assertEqual(got, 7 if other_held else 0, msg)
        calls = [c[0] for c in self.mark.call_args_list]
        refused = [c for c in calls if c[2].startswith(fj.REFUSED_NOTE)]
        self.assertEqual(len(refused), 1, calls)
        self.assertEqual(refused[0][:2], (rows[0]["id"], "new"))
        if rule:
            self.assertIn(rule, refused[0][2])
        self.assertFalse((self.held_dir / rows[0]["id"]).exists())
        detail = json.loads((self.summary.parent / "summary-detail.json").read_text())
        self.assertEqual([d["id"] for d in detail["refused"]], [rows[0]["id"]])
        return detail["refused"][0]

    def bad(self, rel, data, rule=None):
        """A change that breaks a per-row rule: the row is refused, not the run."""
        self.edit(rel, data)
        found = self.rowrefused([row(U1, [rel])], rule)
        self.settle()
        return found

    def ok(self, rel, data, expect=0):
        """A change that passes the checks and becomes a proposal. expect is the risk hint: 0 for "text" (it
        would once have landed unattended), 7 for "code"."""
        self.edit(rel, data)
        got, msg = self.propose([row(U1, [rel])])
        self.assertEqual(got, 7, msg)
        self.assertTrue((self.held_dir / U1).exists())
        held = json.loads((self.run_dir / "held.json").read_text())["held"]
        self.assertEqual(held[0]["risk"], "text" if expect == 0 else "code", msg)
        self.settle()
        return msg


class Allowlist(unittest.TestCase):
    def test_cases(self):
        for ok in ("site/x.html", "site/js/app.js", "site/a/b/c.css"):
            self.assertTrue(fj.is_allowed(ok), ok)
        for bad in ("CHANGELOG.md", "site/js/config.js", "SITE/JS/CONFIG.JS", "tests/a.mjs", "scripts/x.py", ".gitignore", "../x",
                    "site/../x", "/etc/x", "site/.github/x", ".github/x.yml", "CLAUDE.md", "AGENTS.md", "site",
                    "supabase/a.sql", "site\\x.html", "package.json", "site/x/../../y"):
            self.assertFalse(fj.is_allowed(bad), bad)

    def test_extensions(self):
        for ok in ("site/a.html", "site/a.CSS", "site/a.md", "site/a.json", "site/a.js", "site/media/a.png",
                   "site/media/a.pdf", "site/media/a.webm"):
            fj.check_extensions([ok])
        for bad in ("site/a.svg", "site/a.xhtml", "site/a.shtml", "site/a.mht", "site/a.wasm",
                    "site/a.webmanifest", "site/a", "site/a.txt", "site/a.htm", "site/a.mjs"):
            with self.assertRaises(fj.Refuse, msg=bad):
                fj.check_extensions([bad])

    def test_git_names(self):
        for p in (".gitignore", ".gitattributes", ".github/x", ".githooks/pre-commit", "site/.gitkeep"):
            with self.assertRaises(fj.Refuse):
                fj.check_git_names([p])
        fj.check_git_names(["site/a.html"])

    def test_protected(self):
        for p in fj.PROTECTED_PATHS:
            with self.assertRaises(fj.Refuse):
                fj.check_protected([p])
        fj.check_protected(["site/js/app.js"])

    def test_media_magic(self):
        good = {"site/media/a.png": PNG, "site/media/a.jpg": b"\xff\xd8\xff\xe0xx", "site/media/a.gif": b"GIF89a....",
                "site/media/a.webp": b"RIFF\0\0\0\0WEBPxx", "site/media/a.ico": b"\0\0\x01\0xx",
                "site/media/a.mp4": b"\0\0\0\x18ftypisom", "site/media/a.webm": b"\x1a\x45\xdf\xa3xx",
                "site/media/a.pdf": b"%PDF-1.4"}
        for p, b in good.items():
            fj.check_media({p: fj.Change(p, "new", b, None)})
            with self.assertRaises(fj.Refuse, msg=p):
                fj.check_media({p: fj.Change(p, "new", b"plain text", None)})
        with self.assertRaises(fj.Refuse):
            fj.check_media({"site/img/a.png": fj.Change("site/img/a.png", "new", PNG, None)})


class Guards(Scenario):
    def test_staging_guard(self):
        env = {n: "x" for n in fj.STAGING_ENV}
        with mock.patch.dict(os.environ, {**env, "STAGING_DB_URL": STAGING_URL}):
            ORIG_GUARD()
        for missing in fj.STAGING_ENV:
            with mock.patch.dict(os.environ, {**env, "STAGING_DB_URL": STAGING_URL}):
                os.environ.pop(missing)
                with self.assertRaises(fj.Refuse):
                    ORIG_GUARD()
        with mock.patch.dict(os.environ, {**env, "STAGING_DB_URL": PROD_URL}):
            with self.assertRaises(fj.Refuse):
                ORIG_GUARD()

    def test_propose_checks_the_guard_first_even_for_a_dry_run(self):
        with mock.patch.object(fj, "staging_guard", side_effect=fj.Refuse("no")):
            got, _ = self.propose(self.one("site/a.html", A_OK), dry=True)
        self.assertEqual(got, 2)
        self.assertFalse(self.held_dir.exists())

    def test_run_dir_overlaps(self):
        rows = self.one("site/a.html", A_OK)
        for bad in (self.work / "run", self.tools / "run", self.work, self.root):
            got, _ = self.propose(rows, run=bad)
            self.assertEqual(got, 2, bad)

    def test_held_dir_overlaps(self):
        rows = self.one("site/a.html", A_OK)
        for bad in (self.run_dir / "held", self.work / "held", self.tools / "held", self.run_dir, self.root):
            got, _ = self.propose(rows, held=bad)
            self.assertEqual(got, 2, bad)

    def test_summary_inside_work_refused(self):
        rows = self.one("site/a.html", A_OK)
        got, _ = self.propose(rows, summary=self.work / fj.RUN_DIR / "summary.json")
        self.assertEqual(got, 2)
        got, _ = self.propose(rows, summary=self.work / "site" / ".." / "s.json")
        self.assertEqual(got, 2)

    def test_remote_must_be_this_repository(self):
        sh(self.tools, "remote", "set-url", "origin", "https://github.com/someone/else.git")
        got, _ = self.propose(self.one("site/a.html", A_OK))
        self.assertEqual(got, 2)
        sh(self.tools, "remote", "set-url", "origin", "git@github.com:dfpm-physics/Core_Preflights.git")
        self.assertEqual(self.propose(self.one("site/a.html", A_OK))[0], 2)


class GitNeverRunsInWork(Scenario):
    def test_no_call_under_work_and_env_scrubbed(self):
        marker = self.root / "marker"
        with open(self.work / ".git" / "config", "a", encoding="utf-8") as f:
            f.write("[core]\n\tfsmonitor = python -c \"open(r'%s','w')\"\n" % marker)
        seen = []
        real = subprocess.run

        def spy(argv, **kw):
            seen.append((list(argv), kw))
            return real(argv, **kw)

        rows = self.one("site/a.html", A_OK)
        extra = {"STAGING_DB_URL": "x", "MY_PASSWORD": "x", "A_SECRET": "x", "B_TOKEN": "x", "API_KEY": "x",
                 "SAFE_VAR": "1"}
        with mock.patch.dict(os.environ, extra), mock.patch.object(fj.subprocess, "run", side_effect=spy):
            got, msg = self.propose(rows)
        self.assertEqual(got, 7, msg)
        self.assertGreater(len(seen), 5)
        wroot = self.work.resolve()
        for argv, kw in seen:
            self.assertEqual(argv[0], "git")
            i = argv.index("-C")
            for cwd in (Path(argv[i + 1]).resolve(), Path(kw.get("cwd") or argv[i + 1]).resolve()):
                self.assertFalse(cwd == wroot or wroot in cwd.parents, argv)
            self.assertIn("core.fsmonitor=false", argv)
            self.assertIn("core.attributesFile=", argv)
            self.assertIn("commit.gpgsign=false", argv)
            self.assertIn("core.pager=cat", argv)
            self.assertIn("--literal-pathspecs", argv)
            self.assertTrue(any(a.startswith("core.hooksPath=") for a in argv))
            self.assertNotIn("--no-verify", argv)
            env = kw["env"]
            for name in extra:
                if name != "SAFE_VAR":
                    self.assertNotIn(name, env)
            self.assertEqual(env["SAFE_VAR"], "1")
            self.assertEqual(env["GIT_TERMINAL_PROMPT"], "0")
        self.assertFalse(marker.exists())

    def test_helper_refuses_a_cwd_inside_work(self):
        with fj.git_session(forbid=[self.work]):
            with self.assertRaises(fj.Refuse):
                fj.git(self.work, "status")
            with self.assertRaises(fj.Refuse):
                fj.git(self.work / "site", "status")
            fj.git(self.tools, "status")

    def test_helper_needs_the_session(self):
        with mock.patch.object(fj, "HOOKS_DIR", None):
            with self.assertRaises(fj.Refuse):
                fj.git(self.tools, "status")

    def test_hooks_dir_is_empty_and_removed(self):
        with fj.git_session() as d:
            self.assertTrue(d.is_dir() and not any(d.iterdir()))
            kept = d
        self.assertFalse(kept.exists())
        with self.assertRaises(RuntimeError):
            with fj.git_session() as d:
                kept = d
                raise RuntimeError("boom")
        self.assertFalse(kept.exists())

    def test_no_git_outside_the_helper(self):
        src = (HERE / "feedback_job.py").read_text(encoding="utf-8")
        self.assertEqual(src.count("subprocess.run("), 1)         # git() only

    def test_scrubbed_env_unit(self):
        with mock.patch.dict(os.environ, {"STAGING_A": "1", "XPASSWORDX": "1", "mysecret": "1", "TOK_TOKEN": "1",
                                          "SOMEKEY": "1", "GIT_DIR": "/x", "GIT_CONFIG_COUNT": "1", "KEEP": "1",
                                          "GIT_CONFIG_GLOBAL": "user-global", "GIT_CONFIG_SYSTEM": "user-system"}):
            e = sg.env()
        for n in ("STAGING_A", "XPASSWORDX", "mysecret", "TOK_TOKEN", "SOMEKEY", "GIT_DIR", "GIT_CONFIG_COUNT"):
            self.assertNotIn(n, e)
        self.assertEqual(e["KEEP"], "1")
        self.assertEqual(e["GIT_TERMINAL_PROMPT"], "0")
        # global and system config are kept: user-owned, not writable by the AI stage
        self.assertEqual((e["GIT_CONFIG_GLOBAL"], e["GIT_CONFIG_SYSTEM"]), ("user-global", "user-system"))
        self.assertNotIn("GIT_CONFIG_NOSYSTEM", e)


class PathAndShape(Scenario):
    def test_an_unchanged_rewrite_is_not_a_change(self):
        self.edit("site/js/app.js", "const x = 1;\n")
        got, msg = self.propose([])
        self.assertEqual(got, 0, msg)

    def test_outside_allowlist(self):
        for rel in ("site/js/config.js", "tests/a.mjs", "scripts/x.py", ".gitignore"):
            with self.subTest(rel=rel):
                self.bad(rel, "changed\n")

    def test_untracked_outside_allowlist(self):
        self.edit("tests/new.py", "x\n")
        self.edit("site/a.html", A_OK)
        self.refused([row(U1, ["site/a.html"])])

    def test_untracked_in_site_ok_when_listed(self):
        self.edit("site/new.css", "a { color: blue; }\n")
        got, msg = self.propose([row(U1, ["site/new.css"])])
        self.assertEqual(got, 7, msg)                                  # a new CSS file has no base: held

    def test_rename_delete(self):
        os.rename(self.work / "site" / "b.html", self.work / "site" / "c.html")
        self.refused([row(U1, ["site/c.html"])])
        self.reset_work()
        os.remove(self.work / "site" / "b.html")
        self.refused([row(U1, ["site/b.html"])])

    def test_symlink(self):
        outside = self.root / "outside"
        outside.mkdir()
        try:
            os.symlink(outside, self.work / "site" / "link", target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest("symlinks unavailable")
        write(outside, "f.html", "<p>x</p>")
        with self.assertRaises(fj.Refuse):
            fj.check_real_paths(self.work, ["site/link/f.html"])
        self.refused([row(U1, ["site/link/f.html"])])

    def test_unlisted_changed_file(self):
        rows = self.one("site/a.html", A_OK)
        self.edit("site/b.html", "<p>other</p>\n")
        self.refused(rows)

    def test_listed_but_unchanged(self):
        rows = self.one("site/a.html", A_OK)
        rows[0]["files"].append("site/b.html")
        self.refused(rows)

    def test_more_than_three_applied(self):
        rows = []
        for i, (rel, text) in enumerate((("site/a.html", "<p>1</p>\n"), ("site/b.html", "<p>2</p>\n"),
                                         ("site/data.json", "{\"a\": 3}\n"), ("site/host.html", "<p>4</p>\n")), 1):
            self.edit(rel, text)
            rows.append(row(U[i], [rel]))
        self.refused(rows)

    def test_manifest_rules(self):
        rows = self.one("site/a.html", A_OK)
        for bad in (dict(skeptic="FAIL"), dict(summary="two\nlines"), dict(summary="x" * 161), dict(id="nope"),
                    dict(decision="deleted")):
            with self.subTest(bad=bad):
                self.refused([{**rows[0], **bad}])
        self.refused([rows[0], rows[0]])
        self.refused([row(U2, [], "proposed")])
        self.refused([rows[0], row(U2, [], "proposed", note="")])

    def test_manifest_id_must_be_uuid(self):
        self.fb_rows[0]["id"] = "not-a-uuid"
        self.edit("site/a.html", A_OK)
        self.refused([row("not-a-uuid", ["site/a.html"])])

    def test_base_must_match(self):
        rows = self.one("site/a.html", A_OK)
        self.refused(rows, base="0" * 40)
        self.refused(rows, feedback_base="1" * 40)

    def test_work_feedback_must_match_trusted(self):
        rows = self.one("site/a.html", A_OK)
        self.propose(rows, dry=True)
        write(self.work, fj.RUN_DIR + "/feedback.json", json.dumps({"base": self.base, "rows": []}))
        with self.assertRaises(fj.Refuse) as cm:
            fj.propose(self.work, self.tools, self.base, self.summary, self.run_dir, self.held_dir, dry_run=True)
        self.assertIn("differs", str(cm.exception))

    def test_tools_may_differ_from_work(self):
        write(self.tools, "scripts/other.py", "1\n")
        sh(self.tools, "add", "-A")
        sh(self.tools, "commit", "-q", "-m", "tools moves on")
        got, msg = self.propose(self.one("site/a.html", A_OK))
        self.assertEqual(got, 7, msg)

    def test_dry_run_writes_nothing(self):
        rows = self.one("site/a.html", A_OK)
        got, msg = self.propose(rows, dry=True)
        self.assertEqual(got, 0, msg)
        self.assertIn("dry run", msg)
        self.assertFalse(self.summary.parent.exists())
        self.assertFalse(self.held_dir.exists())
        self.assertEqual(sorted(p.name for p in self.run_dir.iterdir()), ["feedback.json"])
        self.assertEqual(sh(self.tools, "branch", "--list", "feedback-held-*"), "")
        self.assertEqual(sh(self.tools, "worktree", "list").count("\n"), 0)
        self.assertFalse(self.mark.called)

    def test_proposed_and_accepted_rows(self):
        self.fb_rows[1]["status"] = "accepted"
        rows = [row(U1, [], "proposed", note="a plan"), row(U2, [], "proposed", note="a plan"),
                row(U3, [], "skipped")]
        got, msg = self.propose(rows)
        self.assertEqual(got, 0, msg)
        self.assertEqual(self.mark.call_count, 1)
        self.assertEqual(self.mark.call_args[0], (U1, "new", "a plan"))
        self.assertFalse(self.held_dir.exists())
        self.assertEqual(json.loads((self.summary.parent / "summary-detail.json").read_text())["proposed_unmarked"], [U2])
        data = json.loads(self.summary.read_text())
        self.assertEqual(data["rows"], [{"id": U1, "status": "proposed", "commit": None, "files": 0}])

    def test_crlf_only_difference_is_not_a_change(self):
        self.edit("site/b.html", "<p>b</p>\r\n")
        got, msg = self.propose([])
        self.assertEqual(got, 0, msg)


class Marking(Scenario):
    def test_summary_json_refuses_off_schema(self):
        good = {"id": U1, "status": "held", "commit": None, "files": 1}
        for bad in ({**good, "extra": 1}, {**good, "id": "nope"}, {**good, "commit": "abc"},
                    {**good, "status": "skipped"}, {**good, "files": "1"}, {**good, "commit": "a" * 40},
                    {**good, "status": "applied"}):
            with self.assertRaises(fj.Refuse, msg=bad):
                fj.write_summary_json(self.root / "s.json", [bad])
        self.assertFalse((self.root / "s.json").exists())
        fj.write_summary_json(self.root / "s.json", [good, {**good, "status": "proposed", "files": 0}])

    def test_mark_system_exit_is_caught_per_row(self):
        with mock.patch.object(fj.ft, "main", side_effect=SystemExit("REFUSED")):
            self.assertFalse(ORIG_MARK(U1, "new", "n"))
        with mock.patch.object(fj.ft, "main", side_effect=ValueError("x")):
            self.assertFalse(ORIG_MARK(U1, "new", "n"))
        with mock.patch.object(fj.ft, "main", return_value=0) as m:
            self.assertTrue(ORIG_MARK(U1, "new", "n"))
            self.assertEqual(m.call_args[0][0][:4], ["mark", U1, "--to", "proposed"])
        # the loop goes on after a failed row
        self.mark.side_effect = [False, True]
        self.edit("site/a.html", A_OK)
        self.edit("site/b.html", "<p>bee</p>\n")
        got, _ = self.propose([row(U1, ["site/a.html"]), row(U2, ["site/b.html"])])
        self.assertEqual(got, 6)
        self.assertEqual(self.mark.call_count, 2)


class Secrets(Scenario):
    def test_each_pattern(self):
        samples = {
            "jwt": "eyJ" + "abcdefghijkl" + ".",
            "sbkey": "sb_" + "secret_x",
            "sk": "sk-" + "abc",
            "pem": "-----BEGIN " + "RSA PRIVATE KEY-----",
            "pw": "pass" + "word = abcdefg1",
            "ref-staging": "wkibept" + "ktbnaddfynrwr",
            "ref-prod": "shzvpmlnq" + "fmzfmuxkowi",
            "b64": "A" * 40,
            "hex": "a1" * 16,
        }
        for name, s in samples.items():
            with self.subTest(name=name):
                self.edit("site/new.md", "x " + s + " y\n")
                found = self.rowrefused([row(U1, ["site/new.md"])], "secret scan")
                self.assertNotIn(s, json.dumps(found))
                self.assertNotIn(s, json.dumps([c[0][2] for c in self.mark.call_args_list]))
                self.assertIn("site/new.md:1", found["where"])
                self.settle()

    def test_prose_password_label_is_fine(self):
        self.edit("site/new.md", "Pass" + "word: ask your instructor\n")
        got, msg = self.propose([row(U1, ["site/new.md"])])
        self.assertEqual(got, 7, msg)                                  # not refused; a new .md file is held

    def test_value_after_label_is_not(self):
        self.edit("site/new.md", "pass" + "word: hunter22x\n")
        self.rowrefused([row(U1, ["site/new.md"])], "secret scan")

    def test_tracked_diff_scanned(self):
        self.bad("site/a.html", "<p>sk-" + "abc</p>\n")

    def test_nul_bytes_do_not_hide_text(self):
        self.edit("site/new.css", b"\0\0\0 /* sk-" + b"abc */\n")
        self.rowrefused([row(U1, ["site/new.css"])], "secret scan")

    def test_csp_token_exemption_unit(self):
        line = "<meta http-equiv=\"Content-Security-Policy\" content=\"script-src " + CSP_TOKEN + "\">"
        self.assertEqual(fj.line_hits(line, None), [])
        self.assertTrue(fj.line_hits("x " + CSP_TOKEN, None))                   # not on a policy line
        self.assertTrue(fj.line_hits("Content-Security-Policy " + "A" * 40, None))  # only the hash token is exempt


class Holes(Scenario):
    """Rules that refuse ONE row: it is marked proposed, and the run goes on."""

    def test_extensions(self):
        for ext in (".svg", ".xhtml", ".shtml", ".mht", ".wasm", ".webmanifest", ".txt"):
            with self.subTest(ext=ext):
                self.bad("site/new" + ext, "x\n", "path rule")

    def test_media(self):
        self.ok("site/media/new.png", PNG, expect=7)
        self.bad("site/media/bad.png", b"not a png", "media rule")
        self.bad("site/other/new.png", PNG, "media rule")

    def test_size_cap(self):
        self.bad("site/big.css", "a{}\n" * (fj.MAX_FILE_BYTES // 4 + 10), "512 KB")
        self.ok("site/big.css", "a{}\n" * (fj.MAX_FILE_BYTES // 4 - 10), expect=7)

    def test_invalid_utf8_and_json_are_refused(self):
        self.bad("site/new.md", b"caf\xe9\n", "parse check")
        self.bad("site/data.json", "{not json\n", "parse check")

    def test_new_auth_patterns(self):
        for c in ("is_global" + "_admin", "isDirector" + "ForCurrent(x)", "isAdm" + "in ()", "client.a" + "uth.x",
                  "getSes" + "sion", "sign" + "In(a)", "sign" + "Out()", "create" + "Client(u)",
                  "if (role !" + "== 'x')", "must_change" + "_password", "isDirector" + "Of(x)", "is_" + "staff(x)",
                  "app_meta" + "data", "sb.r" + "pc('x')", "staff_assign" + "ments"):
            with self.subTest(c=c):
                self.bad("site/a.html", "<p>x</p>\n<!-- " + c + " -->\n", "auth")

    def test_auth_line_removed_is_refused(self):
        self.bad("site/js/other.js", "const user = 1;\n", "auth")

    def test_protected_files(self):
        for rel in ("site/js/auth.js", "site/js/config.js", "site/js/account.js"):
            with self.subTest(rel=rel):
                self.bad(rel, "const harmless = 1;\n", "path rule")

    def test_refused_accepted_row_is_left_unmarked(self):
        self.fb_rows[0]["status"] = "accepted"
        self.edit("scripts/x.py", "2\n")
        got, msg = self.propose([row(U1, ["scripts/x.py"])])
        self.assertEqual(got, 0, msg)
        self.assertFalse(self.mark.called)
        detail = json.loads((self.summary.parent / "summary-detail.json").read_text())
        self.assertEqual(detail["proposed_unmarked"], [U1])
        self.assertEqual(detail["refused"][0]["rule"], "path rule")

    def test_secret_in_the_manifest_text_refuses_the_run(self):
        self.edit("site/a.html", A_OK)
        for key in ("summary", "note", "skeptic_note"):
            with self.subTest(key=key):
                self.refused([row(U1, ["site/a.html"], **{key: "see sk-" + "abc"})])

    def test_secret_in_changelog_text_refuses_the_row(self):
        with mock.patch.object(fj, "changelog_line", return_value="- sk-" + "abc"):
            self.edit("site/a.html", A_OK)
            self.rowrefused([row(U1, ["site/a.html"])], "changelog")

    def test_lone_cr_is_a_difference(self):
        self.assertTrue(fj.line_diff("a\nb\n", "a\rb\n")[0])
        self.assertEqual(fj.split_lines("a\r\nb\rc\n"), ["a\n", "b\r", "c\n"])
        self.assertFalse(fj.same_bytes(b"a\nb\n", b"a\rb\n"))
        self.assertTrue(fj.same_bytes(b"a\nb\n", b"a\r\nb\n"))
        self.edit("site/help/h.md", "# Help\rA line.\n")
        got, msg = self.propose([row(U1, ["site/help/h.md"])])
        self.assertEqual(got, 7, msg)


class Structure(Scenario):
    """The risk hint of a proposal, decided by structure: expect 0 is "text", expect 7 is "code"."""

    def test_text_only_change_is_text(self):
        self.ok("site/a.html", A_OK)
        self.ok("site/a.html", "<p>Helo</p>\n\n\n<a href=\"b.html\">b</a>\ntail text\tmore\r\n")

    def test_class_change_is_text(self):
        self.ok("site/styled.html", "<div class=\"c\">t</div>\n<p>q</p>\n")

    def test_text_that_looks_like_code_is_inert_text(self):
        self.ok("site/a.html", "<p>javascript: onclick= x</p>\n<a href=\"b.html\">b</a>\n")
        self.ok("site/a.html", "<p>&lt;script&gt;x</p>\n<a href=\"b.html\">b</a>\n", expect=7)   # decodes to < and >

    def test_parser_differential_unit(self):
        base = "<p>a</p><div class=\"x\">b</div>"
        held = ["<p>a </script ></p><div class=\"x\">b</div>", "<p>a <!--></p><div class=\"x\">b</div>",
                "<p>a &amp; b</p><div class=\"x\">b</div>", "<p>a \x00 b</p><div class=\"x\">b</div>",
                "<p>a \x01</p><div class=\"x\">b</div>", "<p>a > b</p><div class=\"x\">b</div>",
                "<p>a < b</p><div class=\"x\">b</div>",
                "<p>a</p><div class=\"x\" >b</div><!--",
                "<p>a</p><div class=\"x&amp;y\">b</div>",
                "<p>a</p><div class='x\"y'>b</div>", "<p>a</p><div class=\"x=y\">b</div>",
                "<p>a</p><div class=\"x>y\">b</div>"]
        held[7] = "<p>a</p><div class=\"x\">b</div><"                       # a changed < count, nothing else
        for new in held:
            with self.subTest(new=new):
                self.assertIsNotNone(fj.html_hold(base, new))
        self.assertIsNone(fj.html_hold(base, "<p>a\tb\r\nc</p><div class=\"y z\">b</div>"))
        self.assertIsNotNone(fj.html_hold("<p>a < b</p>", "<p>a < c</p>"))         # odd character in the OLD text too

    def test_entity_and_tab_script_urls_are_held(self):
        for href in ("&#106;avascript:go()", "java\tscript:go()", "&#x6A;avascript:go()", "JaVa&Tab;Script:go()"):
            with self.subTest(href=href):
                self.ok("site/a.html", "<p>Helo</p>\n<a href=\"" + href + "\">b</a>\n", expect=7)

    def test_any_attribute_or_tag_change_is_held(self):
        for new in ("<p>Helo</p>\n<a href=\"c.html\">b</a>\n", "<p>Helo</p>\n<a href=\"b.html\" title=\"t\">b</a>\n",
                    "<p>Helo</p>\n<a href=\"b.html\"><b>b</b></a>\n", "<p>Helo</p>\n<a href=\"b.html\">b</a>\n<br>\n",
                    "<p>Helo</p>\n<!-- c -->\n<a href=\"b.html\">b</a>\n", "<p>Helo</p>\n"):
            with self.subTest(new=new):
                self.ok("site/a.html", new, expect=7)

    def test_gt_in_an_earlier_attribute_and_a_split_handler_are_held(self):
        h = "on" + "click"
        self.ok("site/a.html", "<p title=\"a>b\"\n   " + h + "=\"go()\">Helo</p>\n<a href=\"b.html\">b</a>\n", expect=7)

    def test_textarea_and_script_text_changes_are_held(self):
        self.ok("site/form.html", "<textarea>new</textarea>\n<p>p</p>\n", expect=7)
        self.ok("site/form.html", "<textarea>old</textarea>\n<p>fine</p>\n", expect=0)
        self.ok("site/inline.html", BASE_FILES["site/inline.html"].replace("const a = 1;", "const a = 2;"), expect=7)

    def test_csp_change_is_held(self):
        self.ok("site/inline.html", BASE_FILES["site/inline.html"].replace("'self'", "'self' 'unsafe-inline'"), expect=7)

    def test_json_and_js_are_always_held(self):
        self.ok("site/data.json", "{\"a\": 1}\n", expect=7)
        self.ok("site/js/app.js", "const x = 2;\n", expect=7)

    def test_new_html_file_is_held(self):
        self.ok("site/new.html", "<p>new</p>\n", expect=7)

    def test_markdown(self):
        self.ok("site/help/h.md", "# Help\n\nA line, with plain words: and more; (parens) fine!\n")
        for line in ("a <b>x</b>", "x &#106;avascript y", "[a](https://e.example.net/x)", "[a](b.md)", "![i](a.png)",
                     "- [b]: /\\evil.example", "[x][b]", "a/b", "a\\b", "a `code` b", "a | b", "a > b",
                     "mail me@example.net", "mailto:x@example.net", "see www.example.net", "plain JavaScript word", "Data: x", "vb script: x", "x ://y"):
            with self.subTest(line=line):
                self.ok("site/help/h.md", "# Help\n\n" + line + "\n", expect=7)

    def test_markdown_bypass_and_removed_lines_unit(self):
        old = b"# Help\n\n- [b]: /\\evil.example\nuse [x][b]\n"
        c = fj.Change("site/help/h.md", "mod", b"# Help\n\nuse [x][b]\n", old)     # only a removal
        self.assertIsNotNone(fj.md_hold(c))
        c = fj.Change("site/help/h.md", "mod", b"# Help\n\n- [b]: /\\evil.example\nuse [x][b]\nuse [y][b]\n", old)
        self.assertIsNotNone(fj.md_hold(c))
        c = fj.Change("site/help/h.md", "mod", b"# Help\n\nplain\n", b"# Help\n\nold\n")
        self.assertIsNone(fj.md_hold(c))
        self.assertIsNotNone(fj.md_hold(fj.Change("site/help/n.md", "new", b"plain\n", None)))

    def test_css(self):
        self.ok("site/css/s.css", "a { color: blue; margin: 0 }\nb > c + d ~ e { padding: 1.5em; width: 50%!important }\n")
        for line in ("a { background: ur" + "l(img/a.png); }", "a { background: ur" + "l (x); }", "A { B: UR" + "L(x) }",
                     "a { b: expres" + "sion(x) }", "a { b: \\75rl(x) }", "@font-" + "face { }", "@imp" + "ort 'a.css';",
                     "a { content: \"x\" }", "a { b: 'x' }", "a[b] { c: d }", "a { b=c }", "a { b: c } /* x */", "a { b: c } // x",
                     "a { b: ur/**/l(x) }", "a < b", "a & b", "a { b: `c` }", "a { b: c@d }"):
            with self.subTest(line=line):
                self.ok("site/css/s.css", line + "\n", expect=7)

    def test_css_string_comment_bypass_is_held(self):
        self.ok("site/css/s.css", "b{content:\"/*\";background:ur" + "l(//evil.example/x)}\nc{content:\"*/\"}\n", expect=7)

    def test_css_removed_line_is_checked_unit(self):
        old = b"a { color: red; }\n/* note */\nb { c: d }\n"
        self.assertIsNotNone(fj.css_hold(fj.Change("site/css/s.css", "mod", b"a { color: red; }\nb { c: d }\n", old)))
        self.assertIsNone(fj.css_hold(fj.Change("site/css/s.css", "mod", b"a { color: blue; }\n", b"a { color: red; }\n")))
        self.assertIsNotNone(fj.css_hold(fj.Change("site/css/n.css", "new", b"a { color: blue; }\n", None)))

    def test_new_css_and_markdown_files_are_held(self):
        self.ok("site/css/n.css", "a { color: blue; }\n", expect=7)
        self.ok("site/help/n.md", "plain words\n", expect=7)

    def test_pdf_is_held_and_media_bytes_are_secret_scanned(self):
        self.ok("site/media/a.pdf", b"%PDF-1.4\nplain\n", expect=7)
        self.ok("site/media/a.png", PNG + b"x", expect=7)
        for secret in (b"sk-" + b"abc", b"eyJ" + b"abcdefghijkl.", b"A" * 40):
            with self.subTest(secret=secret):
                self.bad("site/media/a.png", PNG + b"\n" + secret + b"\n", "secret scan")
        self.bad("site/media/a.pdf", b"%PDF-1.4\n" + b"sk-" + b"abc\n", "secret scan")

    def test_comment_deletion_is_held_unit(self):
        old = "<!--\n<script src=\"x.js\"></script>\n-->\n<p>t</p>\n"
        self.assertIsNotNone(fj.html_hold(old, "<script src=\"x.js\"></script>\n-->\n<p>t</p>\n"))
        self.assertIsNotNone(fj.html_hold(old, "<!--\n<script src=\"x.js\"></script>\n--><p>t</p>\n<!-- -->"))
        self.assertIsNone(fj.html_hold(old, old.replace("t</p>", "text</p>")))
        for tag in ("noscript", "template", "style", "title", "iframe", "xmp"):
            base = f"<{tag}>a</{tag}><p>x</p>"
            self.assertIsNotNone(fj.html_hold(base, base.replace(">a<", ">b<")), tag)
            self.assertIsNone(fj.html_hold(base, base.replace("<p>x", "<p>y")), tag)
        base = "<script/>a<p>x</p>"                                       # a self-closed script opens, as in a browser
        self.assertIsNotNone(fj.html_hold(base, base.replace("a<p", "b<p")))
        self.assertIsNone(fj.html_hold("<p class=a>x</p>", "<p class=\"b c\">x</p>"))
        self.assertIsNotNone(fj.html_hold("<p class=a>x</p>", "<p id=a>x</p>"))
        self.assertIsNotNone(fj.html_hold("<p>x</p>", "<p>x</p><!DOCTYPE html>"))


class Propose(Scenario):
    """The propose stage: one uncommitted worktree per passing fix, and nothing is ever committed, pushed or
    published."""

    def wt_paths(self, wt):
        return {ln.split()[-1] for ln in sh(wt, "status", "--short", "--untracked-files=all").splitlines()}

    def test_worktree_holds_the_files_and_its_own_changelog_entry_uncommitted(self):
        self.edit("site/a.html", A_OK)
        self.edit("site/b.html", "<p>bee</p>\n")
        self.edit("site/js/app.js", "const x = 1;\n")                 # unchanged: not a change
        got, msg = self.propose([row(U1, ["site/a.html"]), row(U2, ["site/b.html"])])
        self.assertEqual(got, 7, msg)
        for rid, rel, text, other in ((U1, "site/a.html", A_OK, U2), (U2, "site/b.html", "<p>bee</p>\n", U1)):
            wt = self.held_dir / rid
            self.assertEqual((wt / rel).read_bytes().replace(b"\r\n", b"\n"), text.encode())
            self.assertEqual(sh(wt, "rev-parse", "HEAD"), self.base)               # nothing committed
            self.assertEqual(sh(wt, "branch", "--show-current"), "feedback-held-" + rid)
            self.assertEqual(sh(self.tools, "rev-parse", "feedback-held-" + rid), self.base)
            self.assertEqual(self.wt_paths(wt), {"CHANGELOG.md", rel})
            log = (wt / "CHANGELOG.md").read_text(encoding="utf-8")
            self.assertIn("Matthew Recker via Claude", log)
            self.assertIn("- Feedback " + rid + ": proposed fix to " + rel + ". Written by the unattended "
                          "feedback job; held for operator approval before commit.", log)
            self.assertNotIn("fix " + rid, log)                       # the row's own summary text is not copied
            self.assertNotIn(other, log)
        self.assertEqual((self.held_dir / U1 / "site" / "b.html").read_text(), "<p>b</p>\n")
        self.assertEqual(sh(self.tools, "rev-list", "--all", "--count"), "1")      # no commit anywhere
        self.assertEqual(sh(self.tools, "worktree", "list").count("\n"), 2)
        self.assertEqual([c[0] for c in self.mark.call_args_list],
                         [(U1, "new", fj.HELD_NOTE), (U2, "new", fj.HELD_NOTE)])
        self.assertEqual(fj.HELD_NOTE, "Fix written; waiting for operator approval")
        self.assertEqual(fj.REFUSED_NOTE, "Fix refused by checks: ")

    def test_outputs_are_outside_work_and_exact(self):
        self.edit("site/a.html", A_OK)
        self.edit("site/js/app.js", "const x = 2;\nfetch('b.html');\n")
        rows = [row(U1, ["site/a.html"]), row(U2, ["site/js/app.js"]),
                row(U3, [], "proposed", note="a plan"), row(U4, [], "skipped")]
        got, msg = self.propose(rows)
        self.assertEqual(got, 7, msg)
        for name in ("summary.json", "summary.txt", "summary-detail.json"):
            self.assertFalse((self.work / fj.RUN_DIR / name).exists())
            self.assertTrue((self.summary.parent / name).exists())
        self.assertFalse((self.work / fj.RUN_DIR / "held.json").exists())
        data = json.loads(self.summary.read_text())
        self.assertEqual(data["rows"], [{"id": U1, "status": "held", "commit": None, "files": 1},
                                        {"id": U2, "status": "held", "commit": None, "files": 1},
                                        {"id": U3, "status": "proposed", "commit": None, "files": 0}])
        held = json.loads((self.run_dir / "held.json").read_text())["held"]
        self.assertEqual(held, [
            {"id": U1, "worktree": str(self.held_dir / U1), "branch": "feedback-held-" + U1,
             "files": ["site/a.html"], "risk": "text"},
            {"id": U2, "worktree": str(self.held_dir / U2), "branch": "feedback-held-" + U2,
             "files": ["site/js/app.js"], "risk": "code"}])
        detail = json.loads((self.summary.parent / "summary-detail.json").read_text())
        self.assertEqual(detail["risk"], {U1: "text", U2: "code"})
        self.assertIn("checks", detail)
        text = (self.summary.parent / "summary.txt").read_text()
        self.assertTrue(text.startswith("feedback: 2 held, 0 refused, 1 proposed, 1 skipped"))
        self.assertTrue(all(len(x) < 200 for x in text.splitlines()))
        self.assertEqual([c[0] for c in self.mark.call_args_list],
                         [(U1, "new", fj.HELD_NOTE), (U2, "new", fj.HELD_NOTE), (U3, "new", "a plan")])

    def test_risk_hint_by_file_type(self):
        self.edit("site/media/p.png", PNG + b"x")
        self.edit("site/js/app.js", "const x = 6;\n")
        self.edit("site/help/h.md", "# Help\n\nA better line.\n")
        got, msg = self.propose([row(U1, ["site/media/p.png"]), row(U2, ["site/js/app.js"]),
                                 row(U3, ["site/help/h.md"])])
        self.assertEqual(got, 7, msg)
        held = json.loads((self.run_dir / "held.json").read_text())["held"]
        self.assertEqual({h["id"]: h["risk"] for h in held}, {U1: "code", U2: "code", U3: "text"})

    def test_a_row_with_text_and_code_files_is_code_and_gets_every_file(self):
        self.edit("site/js/app.js", "const x = 3;\n")
        self.edit("site/a.html", A_OK)
        got, msg = self.propose([row(U1, ["site/js/app.js", "site/a.html"])])
        self.assertEqual(got, 7, msg)
        wt = self.held_dir / U1
        self.assertEqual(self.wt_paths(wt), {"CHANGELOG.md", "site/js/app.js", "site/a.html"})
        held = json.loads((self.run_dir / "held.json").read_text())["held"]
        self.assertEqual(held[0]["risk"], "code")

    def test_a_refused_row_gets_no_worktree_and_the_others_carry_on(self):
        self.edit("scripts/x.py", "2\n")                             # listed by a row, but off the allowlist
        self.edit("site/a.html", A_OK)
        got, msg = self.propose([row(U1, ["scripts/x.py"]), row(U2, ["site/a.html"])])
        self.assertEqual(got, 7, msg)
        by_id = {c[0][0]: c[0] for c in self.mark.call_args_list}
        self.assertEqual(by_id[U2][2], fj.HELD_NOTE)
        self.assertEqual(by_id[U1][2], fj.REFUSED_NOTE + "path rule")
        rows = json.loads(self.summary.read_text())["rows"]
        self.assertEqual({r["id"]: r["status"] for r in rows}, {U1: "proposed", U2: "held"})
        self.assertFalse((self.held_dir / U1).exists())
        self.assertEqual(sh(self.tools, "branch", "--list", "feedback-held-" + U1), "")
        self.assertEqual(sh(self.tools, "worktree", "list").count("\n"), 1)

    def test_an_accepted_row_gets_a_worktree_but_no_mark(self):
        self.fb_rows[0]["status"] = "accepted"
        self.edit("site/js/app.js", "const x = 4;\n")
        got, msg = self.propose([row(U1, ["site/js/app.js"])])
        self.assertEqual(got, 7, msg)
        self.assertFalse(self.mark.called)
        self.assertTrue((self.held_dir / U1).exists())
        detail = json.loads((self.summary.parent / "summary-detail.json").read_text())
        self.assertEqual(detail["proposed_unmarked"], [U1])

    def test_held_path_or_branch_exists_refuses_only_that_row(self):
        (self.held_dir / U1).mkdir(parents=True)
        self.edit("site/js/app.js", "const x = 4;\n")
        self.edit("site/a.html", A_OK)
        got, msg = self.propose([row(U1, ["site/js/app.js"]), row(U2, ["site/a.html"])])
        self.assertEqual(got, 7, msg)
        notes = {c[0][0]: c[0][2] for c in self.mark.call_args_list}
        self.assertEqual(notes[U1], fj.REFUSED_NOTE + "held worktree path already exists")
        self.assertEqual(notes[U2], fj.HELD_NOTE)
        self.settle()
        sh(self.tools, "branch", "feedback-held-" + U1, self.base)
        self.edit("site/js/app.js", "const x = 4;\n")
        got, msg = self.propose([row(U1, ["site/js/app.js"])])
        self.assertEqual(got, 0, msg)
        self.assertEqual(self.mark.call_args[0][2], fj.REFUSED_NOTE + "held branch already exists")
        self.assertFalse(self.held_dir.exists() and any(self.held_dir.iterdir()))

    def test_other_checks_still_apply_to_code_rows(self):
        for text in ("const s = '<scr" + "ipt src=\"x.js\">';\n", "const u = 'https://evil.example.net/x';\n",
                     "const a = 'java" + "script:x';\n", "// getSes" + "sion\n", "const k = 'sk-" + "abc';\n"):
            with self.subTest(text=text):
                self.bad("site/js/app.js", text)
        self.bad("site/js/auth.js", "const a = 2;\n")

    def test_js_exec_checks_are_not_applied_to_code_rows(self):
        self.edit("site/js/app.js", "ev" + "al('1');\nel.inner" + "HTML = a + b;\nfe" + "tch('b.html');\n")
        got, msg = self.propose([row(U1, ["site/js/app.js"])])
        self.assertEqual(got, 7, msg)

    def test_host_baseline_reads_the_base_not_tools(self):
        write(self.tools, "site/tools_only.html", "https://tools-only.example.net/\n")
        sh(self.tools, "add", "-A")
        sh(self.tools, "commit", "-q", "-m", "tools moves on")
        hosts = fj.host_baseline(self.tools, self.base)
        self.assertIn("known.example.org", hosts)
        self.assertNotIn("tools-only.example.net", hosts)

    def test_a_git_step_failure_exits_4_and_keeps_the_record(self):
        real = fj.git
        calls = []

        def flaky(cwd, *args, **kw):
            if args[:2] == ("worktree", "add") and "--no-track" in args:
                calls.append(1)
                if len(calls) == 2:
                    raise fj.Refuse("git worktree failed: boom", fj.EXIT_GIT)
            return real(cwd, *args, **kw)
        self.edit("site/js/app.js", "const x = 5;\n")
        self.edit("site/js/new.js", "const y = 1;\n")
        with mock.patch.object(fj, "git", side_effect=flaky):
            got, _ = self.propose([row(U1, ["site/js/app.js"]), row(U2, ["site/js/new.js"])])
        self.assertEqual(got, 4)
        held = json.loads((self.run_dir / "held.json").read_text())["held"]
        self.assertEqual([h["id"] for h in held], [U1])           # the first worktree is on record
        self.assertEqual(json.loads(self.summary.read_text())["rows"],
                         [{"id": U1, "status": "held", "commit": None, "files": 1}])
        self.assertEqual([c[0][0] for c in self.mark.call_args_list], [U1])

    def test_a_mark_failure_exits_6_and_keeps_the_worktree(self):
        self.mark.return_value = False
        self.edit("site/js/app.js", "const x = 5;\n")
        got, _ = self.propose([row(U1, ["site/js/app.js"])])
        self.assertEqual(got, 6)
        self.assertTrue((self.held_dir / U1).exists())
        self.assertEqual(json.loads(self.summary.read_text())["rows"], [])
        detail = json.loads((self.summary.parent / "summary-detail.json").read_text())
        self.assertEqual(detail["mark_failed"], [U1])

    def test_nothing_held_exits_0_and_makes_no_worktree(self):
        got, msg = self.propose([row(U1, [], "proposed", note="a plan"), row(U2, [], "skipped")])
        self.assertEqual(got, 0, msg)
        self.assertFalse(self.held_dir.exists())
        self.assertFalse((self.run_dir / "held.json").exists())
        self.assertEqual(sh(self.tools, "worktree", "list").count("\n"), 0)

    def test_no_push_commit_or_publish_is_ever_run(self):
        for name in ("do_push", "do_publish", "land", "CO_AUTHOR", "remove_worktree"):
            self.assertFalse(hasattr(fj, name), name)
        src = (HERE / "feedback_job.py").read_text(encoding="utf-8")
        self.assertNotIn("--publish-repo", src)
        self.assertNotIn("\"push\"", src)
        seen = []
        real = subprocess.run

        def spy(argv, **kw):
            seen.append(list(argv))
            return real(argv, **kw)
        self.edit("site/a.html", A_OK)
        self.edit("site/js/app.js", "const x = 5;\n")
        with mock.patch.object(fj.subprocess, "run", side_effect=spy):
            got, msg = self.propose([row(U1, ["site/a.html"]), row(U2, ["site/js/app.js"])])
        self.assertEqual(got, 7, msg)
        self.assertGreater(len(seen), 5)
        for argv in seen:
            self.assertEqual(argv[0], "git", argv)
            for word in ("push", "commit", "commit-tree", "send-pack", "publish", "merge", "reset"):
                self.assertNotIn(word, argv)
            self.assertFalse(any("publish_test_site" in a for a in argv), argv)
        self.assertEqual(sh(self.tools, "rev-list", "--all", "--count"), "1")


class Fetch(Scenario):
    def rows(self):
        base = {"submitter_name": "Some Name", "submitted_by": "uid-1", "page": "/p", "created_at": "t"}
        return [
            {**base, "id": "r1", "status": "new", "page_title": "T", "message": "m", "director_instructions": None},
            {**base, "id": "r2", "status": "accepted", "page_title": "T", "message": "m",
             "director_instructions": "do it", "decided_at": "t", "decided_by_global_admin": True},
            {**base, "id": "r3", "status": "accepted", "page_title": "T", "message": "m",
             "decided_at": "t", "decided_by_global_admin": False},
        ]

    def fetch(self, rows=None, **kw):
        with mock.patch.object(fj, "query_rows", return_value=(rows if rows is not None else self.rows(), None)):
            with redirect_stdout(io.StringIO()):
                return fj.fetch(self.work, self.tools, kw.pop("run", self.run_dir), kw.pop("held", self.held_dir), **kw)

    def test_writes_trusted_and_work_copies_and_no_names(self):
        self.run_dir.mkdir()
        write(self.run_dir, "stale.txt", "old")
        self.assertEqual(self.fetch(), 0)
        self.assertFalse((self.run_dir / "stale.txt").exists())
        a = (self.run_dir / "feedback.json").read_text()
        b = (self.work / fj.RUN_DIR / "feedback.json").read_text()
        self.assertEqual(a, b)
        data = json.loads(a)
        self.assertEqual(data["base"], self.base)
        self.assertEqual([r["id"] for r in data["rows"]], ["r1", "r2"])
        self.assertNotIn("Some Name", a)
        self.assertNotIn("uid-1", a)
        self.assertFalse((self.tools / fj.RUN_DIR).exists())

    def test_base_is_read_without_git(self):
        self.assertEqual(fj.read_head_plain(self.work), self.base)
        sh(self.work, "checkout", "-q", "--detach")
        self.assertEqual(fj.read_head_plain(self.work), self.base)
        sh(self.work, "pack-refs", "--all")
        sh(self.work, "checkout", "-q", "-")
        self.assertEqual(fj.read_head_plain(self.work), self.base)
        self.assertIsNone(fj.read_head_plain(self.root))

    def test_tools_at_other_sha_is_fine(self):
        sh(self.tools, "commit", "-q", "--allow-empty", "-m", "later")
        self.assertEqual(self.fetch(), 0)

    def test_no_rows_and_dry_run(self):
        self.assertEqual(self.fetch(rows=[]), 20)
        self.assertFalse((self.work / fj.RUN_DIR).exists() or self.run_dir.exists())
        self.assertEqual(self.fetch(dry_run=True), 0)
        self.assertFalse((self.work / fj.RUN_DIR).exists() or self.run_dir.exists())

    def test_run_dir_overlap_refused(self):
        for bad in (self.work / "run", self.tools / "run", self.root):
            with self.assertRaises(fj.Refuse):
                self.fetch(run=bad)

    def test_held_slot_is_skipped_only_for_an_accepted_row(self):
        a, b, c = ("00000000-0000-4000-8000-00000000000" + x for x in "abc")
        rows = [{**self.rows()[1], "id": a}, {**self.rows()[0], "id": b}, {**self.rows()[0], "id": c}]
        (self.held_dir / a).mkdir(parents=True)
        (self.held_dir / b).mkdir(parents=True)                  # a new row: PROPOSE re-marks it, so it is kept
        self.assertEqual(self.fetch(rows=rows), 0)
        data = json.loads((self.run_dir / "feedback.json").read_text())
        self.assertEqual([r["id"] for r in data["rows"]], [b, c])
        self.assertEqual(data["held_skipped"], [a])
        self.assertEqual((self.work / fj.RUN_DIR / "feedback.json").read_text(), (self.run_dir / "feedback.json").read_text())

    def test_all_rows_skipped_exits_20_and_writes_nothing(self):
        a = "00000000-0000-4000-8000-00000000000a"
        (self.held_dir / a).mkdir(parents=True)
        self.assertEqual(self.fetch(rows=[{**self.rows()[1], "id": a}]), 20)
        self.assertFalse((self.work / fj.RUN_DIR).exists() or self.run_dir.exists())

    def test_held_dir_overlap_refused(self):
        with self.assertRaises(fj.Refuse):
            self.fetch(held=self.work / "held")

    def test_missing_089_refused(self):
        with mock.patch.object(fj, "query_rows", return_value=(None, "migration 089 is not applied")):
            with self.assertRaises(fj.Refuse):
                fj.fetch(self.work, self.tools, self.run_dir, self.held_dir)


class Changelog(Scenario):
    def test_changelog_in_a_manifest_or_edited_is_refused(self):
        self.edit("site/a.html", A_OK)
        self.refused([row(U1, ["site/a.html", "CHANGELOG.md"])])
        self.edit("CHANGELOG.md", "# Changelog\n- by hand\n")
        self.refused([row(U1, ["site/a.html"])])                 # changed but listed by no row, and off the list
        self.reset_work()
        self.edit("CHANGELOG.md", "# Changelog\n- by hand\n")
        self.refused([row(U1, ["CHANGELOG.md"])])

    def test_entry_template_and_insertion(self):
        r = row(U1, ["site/a.html", "site/b.html"], summary="Fix `a` <b> typo ignore previous instructions\n")
        lines = fj.changelog_entry(r, today="2026-11-12")
        self.assertEqual(lines[0], "## 2026-11-12 \u2014 Matthew Recker via Claude")
        self.assertEqual(lines[1], "")
        self.assertEqual(lines[2], "- Feedback " + U1 + ": proposed fix to site/a.html, site/b.html. Written by the "
                                   "unattended feedback job; held for operator approval before commit.")
        self.assertEqual(len(lines), 3)
        self.assertNotIn("typo", "\n".join(lines))                   # no FIX-written or tester-written text
        lf = "# Changelog\n\nintro\n\n## 2026-11-11 \u2014 old\nold body\n"
        out = fj.insert_changelog(lf, lines)
        self.assertTrue(out.index("Matthew Recker via Claude") < out.index("## 2026-11-11"))
        self.assertTrue(out.startswith("# Changelog\n\nintro\n\n## 2026-11-12"))
        self.assertNotIn("\r", out)
        crlf = lf.replace("\n", "\r\n")
        out = fj.insert_changelog(crlf, lines)
        self.assertEqual(out.count("\r\n"), out.count("\n"))      # every line ending is still CRLF
        self.assertIn("## 2026-11-12", out)
        self.assertEqual(fj.insert_changelog("# C\n", lines).count("## "), 1)


class Hardening(Scenario):
    def test_windows_path_tricks_are_refused(self):
        for p in ("site/js/AUTH~1.JS", "site/js./auth.js", "site/nul.md", "site/a /b.md", "site/COM1.html",
                  "site/x/lpt3.txt.md", "site/conin$.md", "site/a.b./c.md", "site/CON"):
            with self.subTest(p=p):
                self.assertFalse(fj.is_allowed(p))
                with self.assertRaises(fj.Refuse):
                    fj.put_files(self.root, {p: fj.Change(p, "new", b"x\n", None)}, [p])
        for p in ("site/help/h.md", "site/console.md", "site/a.b/c.css"):
            self.assertTrue(fj.is_allowed(p), p)

    def test_invisible_and_unusual_characters_make_code(self):
        for ch in ("‮", "​", "⁦"):
            with self.subTest(ch=ch):
                self.ok("site/a.html", "<p>Hel" + ch + "o</p>\n<a href=\"b.html\">b</a>\n", expect=7)
                self.ok("site/help/h.md", "# Help\n\nA" + ch + " line.\n", expect=7)
        self.ok("site/a.html", "<p>café</p>\n<a href=\"b.html\">b</a>\n", expect=7)
        self.ok("site/a.html", "<p>“Hello” — ok… </p>\n<a href=\"b.html\">b</a>\n")
        self.ok("site/help/h.md", "# Help\n\nA ‘line’ – here\n")
        self.assertTrue(fj.odd_chars([(1, "a b")]))
        self.assertFalse(fj.odd_chars([(1, "a\tb")]))

    def test_markdown_with_an_angle_bracket_in_the_old_file_is_code(self):
        old = b"# Help\n\nkept <x\nold\n"
        self.assertIsNotNone(fj.md_hold(fj.Change("site/help/h.md", "mod", b"# Help\n\nkept <x\nnew\n", old)))
        self.assertIsNone(fj.md_hold(fj.Change("site/help/h.md", "mod", b"# Help\n\nkept x\nnew\n", b"# Help\n\nkept x\nold\n")))

    def test_a_leading_dash_note_cannot_break_the_mark_command(self):
        with mock.patch.object(fj.ft, "main", return_value=0) as m:
            self.assertTrue(ORIG_MARK(U1, "new", "-x --commit"))
        argv = m.call_args[0][0]
        self.assertIn("--note=-x --commit", argv)
        self.assertNotIn("--note", argv)
        self.assertNotIn("-x --commit", argv)

    def test_a_failed_worktree_write_is_undone_and_stops_the_run(self):
        real, calls = fj.put_files, []

        def flaky(root, changes, paths):
            calls.append(1)
            if len(calls) == 2:
                raise OSError("disk full")
            return real(root, changes, paths)
        self.edit("site/js/app.js", "const x = 5;\n")
        self.edit("site/js/new.js", "const y = 1;\n")
        with mock.patch.object(fj, "put_files", side_effect=flaky):
            got, _ = self.propose([row(U1, ["site/js/app.js"]), row(U2, ["site/js/new.js"])])
        self.assertEqual(got, 4)
        self.assertFalse((self.held_dir / U2).exists())
        self.assertEqual(sh(self.tools, "branch", "--list", "feedback-held-" + U2), "")
        self.assertEqual(sh(self.tools, "worktree", "list").count("\n"), 1)
        held = json.loads((self.run_dir / "held.json").read_text())["held"]
        self.assertEqual([h["id"] for h in held], [U1])
        self.assertEqual(json.loads(self.summary.read_text())["rows"],
                         [{"id": U1, "status": "held", "commit": None, "files": 1}])

    def test_a_new_row_with_a_written_worktree_is_remarked_not_refused(self):
        rows = self.one("site/js/app.js", "const x = 5;\n")
        self.assertEqual(self.propose(rows)[0], 7)
        self.mark.reset_mock()
        got, msg = self.propose(rows)
        self.assertEqual(got, 0, msg)
        self.assertEqual([c[0] for c in self.mark.call_args_list], [(U1, "new", fj.HELD_NOTE)])
        self.assertEqual(sh(self.tools, "worktree", "list").count("\n"), 1)
        self.mark.reset_mock()
        self.fb_rows[0]["status"] = "accepted"                    # an accepted row is refused, and left unmarked
        got, msg = self.propose(rows)
        self.assertEqual(got, 0, msg)
        self.assertFalse(self.mark.called)
        detail = json.loads((self.summary.parent / "summary-detail.json").read_text())
        self.assertEqual(detail["refused"][0]["rule"], "held worktree path already exists")

    def test_work_head_must_be_the_base(self):
        rows = self.one("site/a.html", A_OK)
        sh(self.work, "commit", "-q", "--allow-empty", "-m", "moved")
        msg = self.refused(rows)
        self.assertIn("HEAD", msg)

    def test_dry_run_does_not_fetch_a_missing_base(self):
        write(self.work, "site/z.html", "z\n")
        sh(self.work, "add", "-A")
        sh(self.work, "commit", "-q", "-m", "work only")
        nb = sh(self.work, "rev-parse", "HEAD")
        seen, real = [], fj.git

        def spy(cwd, *a, **kw):
            seen.append(a)
            return real(cwd, *a, **kw)
        with mock.patch.object(fj, "git", side_effect=spy):
            got, msg = self.propose([], dry=True, base=nb, feedback_base=nb)
        self.assertEqual(got, 2, msg)
        self.assertIn("dry run", msg)
        self.assertFalse(any(a and a[0] == "fetch" for a in seen))

    def test_changelog_line_ending_follows_the_first_line(self):
        lines = fj.changelog_entry(row(U1, ["site/a.html"]), today="2026-11-13")
        text = "# C\n\n## 2026-01-01 old\r\nbody\r\n"
        out = fj.insert_changelog(text, lines)
        self.assertEqual(out.count("\r\n"), text.count("\r\n"))      # the new block is LF, like the first line


class Sanitising(unittest.TestCase):
    def test_clean(self):
        self.assertEqual(fj.clean_text("a\nb\rc`d<e>f@g&h", 50), "a b cdefgh")
        self.assertEqual(len(fj.clean_text("x" * 500, 60)), 60)
        self.assertEqual(fj.clean_text("go to https://e.example.net/x or www.e.example.net now", 80), "go to or now")
        self.assertEqual(fj.clean_text("a*b#c!d_e~f>g|h", 80), "abcdefgh")
        self.assertEqual(fj.clean_text("see [a link](other) now and more", 80), "see a linkother now and more")

    def test_summary_line(self):
        line = fj.summary_line("i" * 36, "T`i<t>le\n" + "x" * 100, "s\nummary " + "y" * 300)
        self.assertLess(len(line), 200)
        for ch in "`<>\n\r":
            self.assertNotIn(ch, line)


if __name__ == "__main__":
    unittest.main()
