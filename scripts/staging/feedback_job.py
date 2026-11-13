#!/usr/bin/env python3
"""The tester-feedback job's two trusted stages, FETCH and PROPOSE. STAGING ONLY. Standard library plus psycopg2.

NOTHING LANDS UNATTENDED
  Every fix is a proposal that the operator approves one at a time before any commit. (Course director,
  2026-11-13.) This job never commits, pushes or publishes: it writes each passing fix into its own git
  worktree, uncommitted, and marks the feedback row proposed. The operator reviews the worktree, commits it and
  publishes it himself.

WHY THE JOB IS SPLIT
  An AI run that holds a shell, git and the staging key could run its own code with the key, or write a secret
  file. So the AI stage (FIX, see .ai/skills/feedback-triage/SKILL.md) holds none of those: it can only read and
  write files in a WORK checkout. Everything with authority runs here, from a separate, never-edited TOOLS
  checkout, pinned to a reviewed commit:

    FETCH   (this script)  reads the queue with the staging key, writes feedback.json
    FIX     (an AI)        edits files in WORK, writes WORK/.feedback-run/manifest.json
    PROPOSE (this script)  checks everything, writes one worktree per passing fix, marks the rows

  Both stages run with the TOOLS root as the working directory. TOOLS and WORK may be at different commits;
  WORK is origin/v2-test-fixes, and its HEAD at FETCH time is the "base". The launcher is not in this repo.

NO GIT RUNS IN WORK
  FIX can write WORK/.git, so any git command there could run code (fsmonitor, filters, sshCommand, a remote
  rewrite). PROPOSE therefore reads WORK as plain files and compares them, in Python, with the base commit read
  from TOOLS (git ls-tree and cat-file, no checkout). Every git command runs in TOOLS or in a worktree it made,
  through one helper with a scrubbed environment (no staging variables, no secrets, an empty hooks directory),
  and the helper refuses any directory inside WORK.

EACH PROPOSAL
  An applied row whose files pass every check gets a worktree <held-dir>/<id> on branch feedback-held-<id>, cut
  from the base: the row's files copied in, plus one CHANGELOG entry for that row, all uncommitted. The row is
  marked proposed ("Fix written; waiting for operator approval") and recorded in held.json with a risk hint,
  "text" when the old structural rules (html_hold, md_hold, css_hold, hold_reason) would have let it land
  unattended and "code" otherwise. The hint is advice for the reviewer and decides nothing.

REFUSED ROWS
  A rule broken by one row's files (path, extension, media, size, secret, auth code, parse, a taken slot) refuses
  that row only: it gets no worktree and is marked proposed with the note "Fix refused by checks: <rule>" (never
  the matched text); the other rows carry on. The whole run is refused (exit 2) only for a bad manifest, ids not
  in feedback.json, a changed file no row lists, a file listed by two rows, a failed staging guard, a base or
  feedback.json mismatch, or a bad run, held or summary path. Rows FIX marked proposed are marked proposed with
  its note; skipped rows are left alone.

USAGE
  python scripts/staging/feedback_job.py fetch   --work <WORK> --run-dir <dir> --held-dir <dir> [--dry-run]
  python scripts/staging/feedback_job.py propose --work <WORK> --base <sha> --run-dir <dir> --held-dir <dir>
                                                 --summary <path> [--dry-run]

EXIT CODES
  fetch    0 rows written   20 no rows (nothing written)   2 refused   1 unexpected error
  propose  0 nothing held   7 at least one worktree made   2 run refused before any write
           4 a git or worktree step failed   6 marking failed   1 unexpected error

ENVIRONMENT (never printed): STAGING_DB_URL, STAGING_APP_READ_PASSWORD, STAGING_APP_DML_PASSWORD. The URL goes
  through db_target.py, which refuses any project but staging. PROPOSE checks all three first, dry run included.
"""

import argparse
import contextlib
import datetime
import difflib
import hashlib
import html.parser
import importlib.util
import json
import os
import posixpath
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOOLS_ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
import db_target  # noqa: E402
import feedback_triage as ft  # noqa: E402
import scrubbed_git as sg  # noqa: E402

RUN_DIR = ".feedback-run"
BRANCH = "v2-test-fixes"
MAX_APPLIED = 3
SUMMARY_MAX = 160
LINE_MAX = 199
DECISIONS = ("applied", "proposed", "skipped")
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
SHA_RE = re.compile(r"[0-9a-f]{40}")
REMOTE_RE = re.compile(r"https://github\.com/dfpm-physics/Core_Preflights(?:\.git)?")
HELD_NOTE = "Fix written; waiting for operator approval"
REFUSED_NOTE = "Fix refused by checks: "
MAX_FILE_BYTES = 512 * 1024
STAGING_ENV = ("STAGING_DB_URL", "STAGING_APP_READ_PASSWORD", "STAGING_APP_DML_PASSWORD")

(EXIT_OK, EXIT_ERROR, EXIT_REFUSED, EXIT_GIT, EXIT_MARK, EXIT_HELD, EXIT_NO_ROWS) = 0, 1, 2, 4, 6, 7, 20

# Files whose every change, added or removed, is refused: sign-in, session, client and navigation code.
PROTECTED_PATHS = (
    "site/js/auth.js", "site/js/account.js", "site/js/supabase.js", "site/js/config.js",
    "site/js/safe-next.js", "site/login.html", "site/js/nav.js",
)
TEXT_EXTS = (".html", ".css", ".md", ".json", ".js")
MEDIA_EXTS = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".mp4", ".webm", ".pdf")
MEDIA_MAGIC = {
    ".png": lambda b: b.startswith(b"\x89PNG\r\n\x1a\n"),
    ".jpg": lambda b: b.startswith(b"\xff\xd8\xff"),
    ".jpeg": lambda b: b.startswith(b"\xff\xd8\xff"),
    ".gif": lambda b: b[:6] in (b"GIF87a", b"GIF89a"),
    ".webp": lambda b: b[:4] == b"RIFF" and b[8:12] == b"WEBP",
    ".ico": lambda b: b[:4] == b"\x00\x00\x01\x00",
    ".mp4": lambda b: b[4:8] == b"ftyp",
    ".webm": lambda b: b[:4] == b"\x1a\x45\xdf\xa3",
    ".pdf": lambda b: b.startswith(b"%PDF-"),
}
CDN_HOSTS = ("cdn.jsdelivr.net", "unpkg.com", "esm.sh", "cdnjs.cloudflare.com")


class Refuse(Exception):
    """A policy refusal or failed stage; carries the exit code."""

    def __init__(self, msg, code=EXIT_REFUSED):
        super().__init__(msg)
        self.code = code


# ---------------------------------------------------------------- the one git helper

HOOKS_DIR = None
FORBIDDEN = []


@contextlib.contextmanager
def git_session(forbid=()):
    """An empty temporary directory used as core.hooksPath for every git command, removed afterwards even on
    failure, and the list of trees git may never run in (WORK). Why: a checkout's own hooks and config are code
    the AI stage could have planted; PROPOSE's own scans stand in for hooks, and WORK is read as plain files."""
    global HOOKS_DIR, FORBIDDEN
    previous = (HOOKS_DIR, FORBIDDEN)
    with tempfile.TemporaryDirectory(prefix="feedback-nohooks-") as d:
        HOOKS_DIR, FORBIDDEN = Path(d), [Path(f).resolve() for f in forbid]
        try:
            yield HOOKS_DIR
        finally:
            HOOKS_DIR, FORBIDDEN = previous


def git_argv(cwd, *args):
    """The one place a git command line is built: scrubbed flags, then -C <cwd>. Refuses any cwd inside WORK."""
    if HOOKS_DIR is None:
        raise Refuse("internal: git called outside git_session()", EXIT_ERROR)
    where = Path(cwd).resolve()
    for f in FORBIDDEN:
        if where == f or f in where.parents:
            raise Refuse("internal: git must never run inside the work tree", EXIT_ERROR)
    return sg.argv(cwd, args, HOOKS_DIR)


def git(cwd, *args, check=True, input=None):
    r = subprocess.run(git_argv(cwd, *args), capture_output=True, input=input, env=sg.env())
    if check and r.returncode != 0:
        msg = (r.stderr or r.stdout).decode("utf-8", "replace").strip().splitlines()
        raise Refuse(f"git {args[0]} failed: {msg[-1] if msg else 'no output'}", EXIT_GIT)
    return r


def out_of(r):
    return r.stdout.decode("utf-8", "replace").strip()


def expected_remote(tools):
    """remote.origin.url of TOOLS, accepted only when it is exactly the https GitHub URL of this repository. It is
    used only to fetch a missing base commit, so a rewritten remote cannot send the job anywhere else."""
    url = out_of(git(tools, "config", "--get", "remote.origin.url", check=False))
    if not REMOTE_RE.fullmatch(url):
        raise Refuse("TOOLS remote.origin.url is not the https GitHub URL of this repository")
    return url


def ensure_base_object(tools, base, url, fetch=True):
    """The base commit must be in TOOLS. A real run may fetch it once; a dry run never touches the network."""
    if not SHA_RE.fullmatch(base):
        raise Refuse("--base must be a full 40-character sha")
    if git(tools, "cat-file", "-e", f"{base}^{{commit}}", check=False).returncode != 0:
        if not fetch:
            raise Refuse("the base commit is not in the trusted checkout (a dry run does not fetch it)")
        git(tools, "fetch", url, f"refs/heads/{BRANCH}", check=False)
        if git(tools, "cat-file", "-e", f"{base}^{{commit}}", check=False).returncode != 0:
            raise Refuse("the base commit is not in the trusted checkout")


def _retry_rw(func, path, _exc):
    os.chmod(path, stat.S_IWRITE)
    func(path)


# ---------------------------------------------------------------- guards on arguments

def staging_guard():
    """All three staging variables must exist and the URL must name the staging project. Why: nothing may be
    written, even by a dry run, unless the job is plainly aimed at staging."""
    for name in STAGING_ENV:
        if not os.environ.get(name, "").strip():
            raise Refuse(f"{name} is not set")
    try:
        db_target.require_staging(os.environ["STAGING_DB_URL"])
    except db_target.DbTargetError as exc:
        raise Refuse(str(exc))


def _inside(path, other):
    path, other = Path(path).resolve(), Path(other).resolve()
    return path == other or other in path.parents


def check_trees(work, tools):
    if Path(work).resolve() == Path(tools).resolve():
        raise Refuse("--work is the tools checkout; they must be two separate checkouts")
    if not Path(work).is_dir() or not (Path(tools) / ".git").exists():
        raise Refuse("--work or the tools checkout is not a directory")


def check_run_dir(run_dir, work, tools):
    """The run directory must resolve outside WORK and TOOLS, and neither may sit inside it. Why: fetch clears it,
    and the AI stage can write anywhere in WORK."""
    for other in (work, tools):
        if _inside(run_dir, other) or _inside(other, run_dir):
            raise Refuse("--run-dir overlaps the work or tools checkout")
    return Path(run_dir).resolve()


def check_summary_path(summary, work):
    """Refuse a summary path inside WORK. Why: the AI stage can forge files there before the launcher reads them."""
    if _inside(summary, work):
        raise Refuse("--summary is inside the work tree")
    return Path(summary).resolve()


def check_held_dir(held_dir, work, tools, run_dir):
    """The held folder is persistent: outside WORK, TOOLS and the run directory, and none of them inside it."""
    for other in (work, tools, run_dir):
        if _inside(held_dir, other) or _inside(other, held_dir):
            raise Refuse("--held-dir overlaps the work, tools or run directory")
    return Path(held_dir).resolve()


# ---------------------------------------------------------------- path rules

WIN_DEVICES = {"con", "prn", "aux", "nul", "conin$", "conout$"} | {f"com{i}" for i in range(10)} \
    | {f"lpt{i}" for i in range(10)}


def odd_segment(seg):
    """A path segment Windows would read as another file: an 8.3 short name (~1), a trailing dot or space (dropped
    by Windows), or a device name (con, nul, com1 ...) with any extension."""
    return bool(re.search(r"~\d", seg)) or seg.endswith((".", " ")) or seg.split(".")[0].lower() in WIN_DEVICES


def is_allowed(path):
    """True only for a path the FIX stage may change: anything under site/ except site/js/config.js. (CHANGELOG.md
    is not on the list: PROPOSE writes the entry itself.) The path must be a clean repo-relative POSIX path (no '..', no leading '/', no backslash or
    drive colon, no segment starting with .git). Everything else, tests, scripts, .ai, .github, supabase, SQL,
    instruction files, ignore files, package files, is refused."""
    if not path or path.startswith("/") or "\\" in path or ":" in path or "\0" in path:
        return False
    parts = path.split("/")
    if any(p in ("", ".", "..") or p.lower().startswith(".git") or odd_segment(p) for p in parts):
        return False
    return parts[0] == "site" and len(parts) > 1 and path.lower() != "site/js/config.js"


def ext_of(path):
    return posixpath.splitext(path.lower())[1]


def check_extensions(paths):
    """Only .html .css .md .json .js and the media types may change. Why: .svg, .xhtml, .shtml, .mht, .wasm and
    .webmanifest can all carry or start code, and an unknown type cannot be scanned."""
    for p in paths:
        if ext_of(p) not in TEXT_EXTS + MEDIA_EXTS:
            raise Refuse(f"{p}: this file type is not allowed")


def check_git_names(paths):
    """Refuse a path with any segment that starts with .git. Why: those files steer git itself."""
    for p in paths:
        if any(seg.lower().startswith(".git") for seg in p.split("/")):
            raise Refuse(f"{p}: a path starting with .git is not allowed")


def check_real_paths(work, paths):
    """Refuse a changed path whose real location is outside WORK. Why: a link could make a read or copy land
    somewhere else; this runs before the allowlist."""
    root = os.path.realpath(work)
    for p in paths:
        real = os.path.realpath(os.path.join(work, p))
        if real != root and not real.startswith(root + os.sep):
            raise Refuse(f"{p}: resolves outside the work tree")


def check_protected(paths):
    """Refuse any change to the auth, session, client and navigation files."""
    for p in paths:
        if p.lower() in PROTECTED_PATHS:
            raise Refuse(f"{p}: auth, session or client code; changes go to the director")


def check_media(changes):
    """Media only under site/media/, only the listed extensions, and the first bytes must match the extension."""
    for p, c in changes.items():
        ext = ext_of(p)
        if ext in MEDIA_EXTS:
            if not p.startswith("site/media/"):
                raise Refuse(f"{p}: media is allowed only under site/media/")
            if not MEDIA_MAGIC[ext](c.new_bytes):
                raise Refuse(f"{p}: the file's first bytes do not match its extension")


# ---------------------------------------------------------------- comparing WORK to CLEAN as plain files

def _link_like(root_real, root, rel_parts, full):
    expected = os.path.join(root_real, *rel_parts)
    return os.path.islink(full) or os.path.normcase(os.path.realpath(full)) != os.path.normcase(expected)


def walk_tree(root, skip_root=()):
    """Yield (relative posix path, full path, kind) with kind 'file', 'link' or 'other'. Does not follow links;
    skips the named entries at the root only. Reads names and metadata, never file contents."""
    root = str(root)
    root_real = os.path.realpath(root)
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root)
        parts = [] if rel_dir == "." else rel_dir.split(os.sep)
        if not parts:
            dirnames[:] = [d for d in dirnames if d not in skip_root]
            filenames = [f for f in filenames if f not in skip_root]
        for d in list(dirnames):
            full = os.path.join(dirpath, d)
            if _link_like(root_real, root, parts + [d], full):
                dirnames.remove(d)
                yield "/".join(parts + [d]), full, "link"
        for f in filenames:
            full = os.path.join(dirpath, f)
            rp = parts + [f]
            if _link_like(root_real, root, rp, full):
                yield "/".join(rp), full, "link"
            elif os.path.isfile(full):
                yield "/".join(rp), full, "file"
            else:
                yield "/".join(rp), full, "other"


def same_bytes(a, b):
    """Equal bytes, or equal once CRLF is read as LF and nothing else: a lone CR is a real difference, and
    split_lines reads it the same way."""
    return a == b or a.replace(b"\r\n", b"\n") == b.replace(b"\r\n", b"\n")


def base_tree(tools, base):
    """{path: (mode, blob sha)} for every entry of the base commit, read with git in TOOLS. Why: WORK is compared
    to the base without checking the base out anywhere."""
    entries = {}
    for rec in git(tools, "ls-tree", "-r", "-z", "--full-tree", base).stdout.split(b"\0"):
        if rec:
            meta, _, path = rec.partition(b"\t")
            mode, _typ, sha = meta.decode("ascii").split()
            entries[path.decode("utf-8", "replace")] = (mode, sha)
    return entries


def base_blob(tools, sha):
    return git(tools, "cat-file", "blob", sha).stdout


def blob_sha(data):
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def diff_work(work, tools, tree):
    """Compare WORK to the base tree. Returns (changed {path: 'new'|'mod'}, refusals [text]). Skips .git and
    .feedback-run at the root of WORK. A delete, a link or a special file is a refusal. Files are compared as
    plain bytes (a blob hash first, then the base blob read from git when the hash differs)."""
    refusals, changed, seen = [], {}, set()
    for rel, full, kind in walk_tree(work, skip_root=(".git", RUN_DIR)):
        seen.add(rel)
        entry = tree.get(rel)
        if kind == "link":
            if not (entry and entry[0] == "120000" and os.path.islink(full)
                    and os.readlink(full).encode("utf-8", "replace") == base_blob(tools, entry[1])):
                refusals.append(f"{rel}: a symlink or junction is not allowed")
        elif kind == "other":
            refusals.append(f"{rel}: not a regular file")
        elif entry is None:
            changed[rel] = "new"
        elif entry[0] in ("120000", "160000"):
            refusals.append(f"{rel}: not a regular file")
        else:
            data = Path(full).read_bytes()
            if blob_sha(data) != entry[1] and not same_bytes(data, base_blob(tools, entry[1])):
                changed[rel] = "mod"
    for rel, (mode, _sha) in tree.items():
        if rel not in seen and mode != "160000" and rel.split("/")[0] not in (".git", RUN_DIR):
            refusals.append(f"{rel}: a delete or rename is not allowed")
    return changed, refusals


# ---------------------------------------------------------------- reading what changed

def split_lines(text):
    """Lines with their terminators kept. CRLF is read as LF (same_bytes does the same) and a lone CR is a
    line break of its own, so a change that only swaps a CR for an LF still shows up as a changed line."""
    return text.replace("\r\n", "\n").splitlines(keepends=True)


def line_diff(old, new):
    """(added [(line, text)], removed [(line, text)]) between two texts; old may be None (a new file)."""
    a = split_lines(old) if old is not None else []
    b = split_lines(new)
    added, removed = [], []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b).get_opcodes():
        if tag in ("replace", "delete"):
            removed += [(i + 1, a[i].rstrip("\r\n")) for i in range(i1, i2)]
        if tag in ("replace", "insert"):
            added += [(j + 1, b[j].rstrip("\r\n")) for j in range(j1, j2)]
    return added, removed


class Change:
    """One changed file: its bytes, its text, the baseline text, and which lines were added or removed."""

    def __init__(self, path, kind, new_bytes, old_bytes):
        self.path, self.kind, self.new_bytes, self.old_bytes = path, kind, new_bytes, old_bytes
        self.ext = ext_of(path)
        self.media = self.ext in MEDIA_EXTS
        self.new = "" if self.media else new_bytes.decode("utf-8", "replace")
        self.old = None if (self.media or old_bytes is None) else old_bytes.decode("utf-8", "replace")
        self.added, self.removed = ([], []) if self.media else line_diff(self.old, self.new)


def load_changes(work, tools, changed, tree):
    out = {}
    for path, kind in sorted(changed.items()):
        new = (Path(work) / path).read_bytes()
        old = base_blob(tools, tree[path][1]) if kind == "mod" else None
        out[path] = Change(path, kind, new, old)
    return out


def vet_paths(work, changed):
    """Every path rule, in order. Raises Refuse (2)."""
    paths = list(changed)
    check_real_paths(work, paths)
    check_git_names(paths)
    check_protected(paths)
    for p in paths:
        if not is_allowed(p):
            raise Refuse(f"{p}: not on the allowlist")
    check_extensions(paths)


# ---------------------------------------------------------------- manifest

def one_line(text):
    return isinstance(text, str) and "\n" not in text and "\r" not in text


def load_json(path, what):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise Refuse(f"{what} is missing or not valid JSON ({type(exc).__name__})")


def validate_manifest(manifest, feedback_ids):
    """Return the validated rows list, or raise Refuse."""
    if not isinstance(manifest, dict) or not isinstance(manifest.get("rows"), list):
        raise Refuse("manifest.json must be an object with a rows list")
    seen, applied = set(), 0
    for row in manifest["rows"]:
        if not isinstance(row, dict):
            raise Refuse("a manifest row is not an object")
        rid = row.get("id")
        if not isinstance(rid, str) or not UUID_RE.fullmatch(rid) or rid not in feedback_ids:
            raise Refuse("a manifest row names an id that is not in feedback.json")
        if rid in seen:
            raise Refuse(f"{rid}: the id appears twice in the manifest")
        seen.add(rid)
        dec = row.get("decision")
        if dec not in DECISIONS:
            raise Refuse(f"{rid}: decision must be applied, proposed or skipped")
        summary = row.get("summary")
        if summary is not None and (not one_line(summary) or len(summary) > SUMMARY_MAX):
            raise Refuse(f"{rid}: summary must be one line of at most {SUMMARY_MAX} characters")
        for key in ("note", "skeptic_note"):
            if row.get(key) is not None and not isinstance(row[key], str):
                raise Refuse(f"{rid}: {key} must be text")
        files = row.get("files", [])
        if not isinstance(files, list) or not all(isinstance(f, str) for f in files):
            raise Refuse(f"{rid}: files must be a list of paths")
        if "CHANGELOG.md" in files:
            raise Refuse(f"{rid}: CHANGELOG.md is written by PROPOSE, not listed by a row")
        if dec == "applied":
            applied += 1
            if row.get("skeptic") != "PASS":
                raise Refuse(f"{rid}: an applied row needs skeptic PASS")
            if not summary or not summary.strip():
                raise Refuse(f"{rid}: an applied row needs a summary")
            if not files:
                raise Refuse(f"{rid}: an applied row must list at least one file")
        else:
            if dec == "proposed" and not (row.get("note") or "").strip():
                raise Refuse(f"{rid}: a proposed row needs a note")
            if files:
                raise Refuse(f"{rid}: only an applied row may list files")
    if applied > MAX_APPLIED:
        raise Refuse(f"more than {MAX_APPLIED} applied rows")
    return manifest["rows"]


def check_files_match(rows, changed):
    """Every changed path is in the files of exactly one applied row, and every file an applied row lists is
    actually changed."""
    owners = {}
    for row in rows:
        if row["decision"] != "applied":
            continue
        for f in row.get("files", []):
            if f not in changed:
                raise Refuse(f"{f}: listed by a row but not changed")
            owners.setdefault(f, []).append(row["id"])
    for f, who in owners.items():
        if len(who) > 1:
            raise Refuse(f"{f}: listed by more than one applied row")
    for f in changed:
        if f not in owners:
            raise Refuse(f"{f}: changed but listed by no applied row")


# ---------------------------------------------------------------- scans over the changed content

def load_tool(tools, rel, name):
    spec = importlib.util.spec_from_file_location(name, Path(tools) / rel)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def hits_text(label, hits):
    return f"{label} (location and rule only):\n  " + "\n  ".join(sorted(set(hits))[:40])


SECRET_PATTERNS = [
    ("jwt-like", re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.")),
    ("supabase-key-prefix", re.compile(r"sb_(secret|publishable)_")),
    ("sk-key", re.compile(r"sk-[A-Za-z0-9]")),
    ("private-key-block", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("password-assignment", re.compile(r"""password\s*[=:]\s*["']?[^\s"'<]{6,}""", re.I)),
    ("project-ref", re.compile("wkibeptktbnaddfynrwr|shzvpmlnqfmzfmuxkowi")),
    ("long-base64", re.compile(r"[A-Za-z0-9+/=]{40,}")),
    ("long-hex", re.compile(r"[0-9a-fA-F]{32,}")),
]
CSP_HASH = re.compile(r"'sha(?:256|384|512)-[A-Za-z0-9+/]{43,}={0,2}'")
CSP_WORD = "content-security-policy"


def line_hits(line, scanner):
    if CSP_WORD in line.lower():              # a policy line legitimately holds hash tokens
        line = CSP_HASH.sub("", line)
    hits = [name for name, rx in SECRET_PATTERNS if rx.search(line)]
    if scanner is not None:
        hits += ["repo-scanner:" + h for h in scanner.scan_line(line)]
    return hits


def load_scanner(tools):
    if (Path(tools) / "scripts" / "checks" / "secret_scan.py").is_file():
        return load_tool(tools, "scripts/checks/secret_scan.py", "feedback_job_secret_scan")
    return None


def secret_scan(changes, scanner):
    """Refuse a credential-shaped string in any added line, by file and line, never the text. Every file that
    is not media is scanned as text, whatever bytes it holds. Only a policy line's hash tokens are exempt."""
    hits = []
    for p, c in changes.items():
        if scanner is not None and scanner.scan_name(p):
            hits.append(f"{p}:0 credential-filename")
        lines = c.added
        if c.media:                               # the same patterns over the file's bytes, read as latin-1
            lines = list(enumerate(c.new_bytes.decode("latin-1").splitlines(), 1))
        for n, text in lines:
            hits += [f"{p}:{n} {h}" for h in line_hits(text, scanner)]
    if hits:
        raise Refuse(hits_text("secret scan hit", hits))


def scan_manifest_text(rows, scanner):
    """Refuse the run when a manifest row's summary, note or reviewer note looks like a credential. Why: those
    strings are copied into the CHANGELOG, the row notes and the summary files."""
    hits = []
    for r in rows:
        for key in ("summary", "note", "skeptic_note"):
            for h in line_hits(str(r.get(key) or ""), scanner):
                hits.append(f"{r['id']}:{key} {h}")
    if hits:
        raise Refuse(hits_text("secret scan hit in the manifest", hits))


AUTH_PATTERN = re.compile(
    r"is_global_admin|isDirector|isAdmin\s*\(|\.auth\.|getSession|signIn|signOut|createClient"
    r"|\brole\b\s*[!=]==?|must_change_password|is_staff|app_metadata|\.rpc\(|staff_assignments")


def check_auth_lines(changes):
    """Refuse an added or removed line that touches sign-in, session, client, role or staff logic, in any file.
    Why: those lines decide who may see what; a feedback fix must never change them unattended."""
    hits = [f"{p}:{n} auth-code" for p, c in changes.items() for n, t in c.added + c.removed if AUTH_PATTERN.search(t)]
    if hits:
        raise Refuse(hits_text("auth, session or role code touched", hits))


# The checks below read raw text, so they run only on JavaScript, which is held for a person anyway: a backstop,
# not the gate. HTML, Markdown, CSS and JSON are decided by structure (see "classifying a row").
TAG_PATTERNS = [
    ("script-src", re.compile(r"<script\b[^>]*\bsrc\s*=", re.I | re.S)),
    ("link-href", re.compile(r"<link\b[^>]*\bhref\s*=", re.I | re.S)),
    ("embed-tag", re.compile(r"<(iframe|object|embed|base)\b", re.I)),
    ("meta-http-equiv", re.compile(r"<meta\b[^>]*\bhttp-equiv", re.I | re.S)),
    ("form-tag", re.compile(r"<form\b", re.I)),
]
SCHEME_URL = re.compile(r"\b(?:javascript|vbscript)\s*:", re.I)
CSS_URL = re.compile(r"""url\(\s*["']?\s*(?:[a-z][a-z0-9+.-]*:|//)""", re.I)
CSS_IMPORT = re.compile(r"""@import\s+(?:url\()?\s*["']?\s*(?:[a-z][a-z0-9+.-]*:|//)""", re.I)


def check_js_markup(changes):
    """Backstop for JavaScript rows (which are held): refuse new script src, link href, iframe, object, embed,
    base, meta http-equiv and form tags, javascript: and vbscript: addresses, and url() or @import to a
    non-relative address inside the code."""
    hits = []
    for p, c in changes.items():
        for n, t in c.added:
            hits += [f"{p}:{n} {name}" for name, rx in TAG_PATTERNS if rx.search(t)]
            if SCHEME_URL.search(t):
                hits.append(f"{p}:{n} script-url")
            if CSS_URL.search(t) or CSS_IMPORT.search(t):
                hits.append(f"{p}:{n} css-external-url")
        old = c.old or ""
        hits += [f"{p}:0 {name}" for name, rx in TAG_PATTERNS if len(rx.findall(c.new)) > len(rx.findall(old))]
    if hits:
        raise Refuse(hits_text("new markup refused", hits))


URL_BITS = re.compile(r"(?:https?:)?//[^\s\"'<>)\]]*", re.I)
SINGLE_SLASH = re.compile(r"https?:/(?!/)", re.I)


def host_baseline(tools, base):
    """The URL hosts already named anywhere in site/ at the base commit (read in TOOLS). Built once. Why: a host
    the site has never named is a new destination for traffic or data."""
    r = git(tools, "grep", "-h", "-I", "-o", "-i", "-E", r"//[A-Za-z0-9][A-Za-z0-9.-]*", base, "--", "site",
            check=False)
    hosts = set()
    for line in r.stdout.decode("utf-8", "replace").splitlines():
        m = re.search(r"//([A-Za-z0-9][A-Za-z0-9.-]*)", line)
        if m:
            hosts.add(m.group(1).lower().rstrip("."))
    return hosts


def cdn_prefix(path):
    """The part of a CDN path up to and including the package@version segment (else the whole path)."""
    segs = path.split("/")
    for i, s in enumerate(segs):
        if re.search(r".@.", s):
            return "/".join(segs[:i + 1])
    return path


def url_problems(text):
    """[(rule, host-or-None, path)] for every URL-like token on one line."""
    out = []
    if SINGLE_SLASH.search(text):
        out.append(("malformed-url", None, ""))
    for m in URL_BITS.finditer(text):
        tok = m.group(0)
        bare = tok.startswith("//")
        if bare and m.start() > 0 and text[m.start() - 1] not in " \t\"'(=,[{":
            continue
        if "\\" in tok:
            out.append(("backslash-in-url", None, ""))
            continue
        rest = tok.split("//", 1)[1]
        m2 = re.match(r"[^/?#]*", rest)
        authority, path = m2.group(0), rest[m2.end():]
        if "@" in authority or "%" in authority or any(ord(ch) > 127 for ch in authority):
            out.append(("odd-authority", None, ""))
            continue
        host = authority.lower().split(":")[0].rstrip(".")
        if not host or (bare and "." not in host):
            continue
        out.append(("host", host, path))
    return out


def check_new_hosts(changes, tools, base):
    """Refuse an added URL whose host the site at the base commit does not already name, one with an odd
    authority (user info, escapes, non-ASCII, a backslash, a single slash), and any shared-CDN URL whose
    package@version prefix is not already in the base. Why: a new host is a new place for traffic or data."""
    known, hits = None, []
    for p, c in changes.items():
        if c.media:
            continue
        for n, t in c.added:
            for rule, host, path in url_problems(t):
                if rule != "host":
                    hits.append(f"{p}:{n} {rule}")
                    continue
                known = host_baseline(tools, base) if known is None else known
                if host in CDN_HOSTS:
                    prefix = host + cdn_prefix(path) if path else None
                    if not prefix or git(tools, "grep", "-F", "-q", "-e", prefix, base, "--", "site",
                                         check=False).returncode != 0:
                        hits.append(f"{p}:{n} new-cdn-package")
                elif host not in known:
                    hits.append(f"{p}:{n} new-host")
    if hits:
        raise Refuse(hits_text("a URL host or form not already in the site", hits))


# ---------------------------------------------------------------- risk hint for a proposal: text or code, by structure

# Elements whose text is not plain text to a browser (script and style run or style the page; the rest are
# raw-text or fallback content that a page script can read and re-inject as markup).
RAW_TEXT_TAGS = frozenset(("script", "style", "textarea", "title", "noscript", "template", "xmp", "iframe",
                           "noembed", "noframes", "plaintext"))


class _Tokens(html.parser.HTMLParser):
    """A page as structure tokens plus the text between them. structure holds every tag (name and sorted
    attributes, with a class value blanked), comment, declaration and processing instruction in order. gaps[i]
    is the text before structure[i] (the last gap is the text after the final token); inert[i] says whether that
    text sits outside every RAW_TEXT_TAGS element. A self-closed raw-text tag is treated as opening, as a
    browser does."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.structure, self.gaps, self.inert, self.open, self.classes = [], [""], [True], [], []

    def _tok(self, tok):
        self.structure.append(tok)
        self.gaps.append("")
        self.inert.append(not self.open)

    def _start(self, kind, tag, attrs):
        if tag in RAW_TEXT_TAGS:
            self.open.append(tag)
        self.classes += [v or "" for k, v in attrs if k == "class"]
        norm = [(k, "" if k == "class" else v) for k, v in attrs]
        self._tok((kind, tag, tuple(sorted(norm, key=lambda kv: (kv[0], kv[1] is not None, kv[1] or "")))))

    def handle_starttag(self, tag, attrs):
        self._start("start", tag, attrs)

    def handle_startendtag(self, tag, attrs):
        self._start("startend", tag, attrs)

    def handle_endtag(self, tag):
        if tag in self.open:
            del self.open[len(self.open) - 1 - self.open[::-1].index(tag):]
        self._tok(("end", tag))

    def handle_data(self, data):
        self.gaps[-1] += data

    def handle_comment(self, data):
        self._tok(("comment", data))

    def handle_decl(self, decl):
        self._tok(("decl", decl))

    def handle_pi(self, data):
        self._tok(("pi", data))

    def unknown_decl(self, data):
        self._tok(("unknown-decl", data))


def html_tokens(text):
    p = _Tokens()
    p.feed(text)
    p.close()
    return p


# A browser may read as markup what html.parser calls text (`</script >`, `<!-->`, an unclosed comment, NUL in a
# tag name), so changed text may hold none of these, in either version.
ODD_TEXT = re.compile(r"[<>&\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
ODD_CLASS = re.compile(r"[\"'`=]")


def html_hold(old, new):
    """Only a risk hint for the reviewer now (nothing lands unattended): None when the page would once have been
    allowed to land unattended, else the reason it would have been held. It would have landed only if the token
    sequences of the base and the new page are identical, except that text may differ outside the raw-text
    elements and a class value may differ. Text between tokens is inert whatever it spells, since the parser
    would have made a tag token of anything that is markup: entity and tab tricks change nothing. A page with
    no base (a new file) or one the parser cannot read is held."""
    if old is None:
        return "new HTML file"
    if odd_chars(sum(line_diff(old, new), [])):
        return "a changed line holds an invisible or unusual character"
    try:                                  # CRLF read as LF, as same_bytes does; a lone CR stays a difference
        a, b = html_tokens(old.replace("\r\n", "\n")), html_tokens(new.replace("\r\n", "\n"))
    except Exception:  # noqa: BLE001
        return "HTML could not be compared"
    if a.structure != b.structure:
        return "HTML tag, attribute, comment or declaration changed"
    if old.count("<") != new.count("<"):          # parser-independent backstop
        return "the count of < characters changed"
    for i, (x, y) in enumerate(zip(a.gaps, b.gaps)):
        if x != y and not (a.inert[i] and b.inert[i]):
            return "text changed inside a script, style, textarea, title or similar element"
        if x != y and (ODD_TEXT.search(x) or ODD_TEXT.search(y)):
            return "changed text holds a markup, entity or control character"
    for x, y in zip(a.classes, b.classes):
        if x != y and (ODD_TEXT.search(x) or ODD_TEXT.search(y) or ODD_CLASS.search(x + y)):
            return "changed class value holds an unusual character"
    return None


# Markdown and CSS are decided by a CHARACTER ALLOWLIST over every added and every removed line (a removed line can
# change meaning too), not by looking for bad words: plain text and simple rules go live alone, and anything
# with a link, slash, quote or bracket is held. A new file has no base to compare with and is held.
TYPOGRAPHY = set("\u2018\u2019\u201c\u201d\u2013\u2014\u2026\u00a0")


def odd_chars(lines):
    """True when any line holds a control, format or line-separator character (tab excepted), or a non-ASCII
    character outside a small list of typographic punctuation. Why: invisible and bidirectional characters can
    make a line read differently from what it does."""
    for _, t in lines:
        for ch in t:
            if ch != "\t" and unicodedata.category(ch) in ("Cf", "Cc", "Zl", "Zp"):
                return True
            if ord(ch) > 127 and ch not in TYPOGRAPHY:
                return True
    return False


MD_BAD_CHARS = re.compile(r"[\[\]<>&\\/`|@]")
MD_BAD_WORDS = ("://", "www.", "javascript", "vbscript", "data:")
CSS_OK_LINE = re.compile(r"[A-Za-z0-9 \t#%.,:;{}()_\-!*>+~]*")
CSS_BAD_WORDS = ("url", "expression")


def md_hold(c):
    """Risk hint only (nothing lands unattended): None when the Markdown would once have landed: no added or removed line holds a bracket, angle bracket, ampersand,
    backslash, slash, backtick, pipe or at-sign (which blocks every link, image, definition and HTML form), or the
    words javascript, vbscript, data: , :// or www. , read with whitespace removed and case ignored."""
    if c.old is None:
        return "new Markdown file"
    if "<" in c.old:
        return "the Markdown file already holds a < character"
    if odd_chars(c.added + c.removed):
        return "a changed line holds an invisible or unusual character"
    for _, t in c.added + c.removed:
        s = re.sub(r"\s+", "", t).lower()
        if MD_BAD_CHARS.search(t) or any(w in s for w in MD_BAD_WORDS):
            return "Markdown line with a link, slash, bracket, markup or script word"
    return None


def css_hold(c):
    """Risk hint only (nothing lands unattended): None when the CSS would once have landed: every added and removed line uses only letters, digits, space, tab and
    #%.,:;{}()_-!*>+~ and names neither url nor expression. No slash (so no comment), backslash, quote, at-sign,
    bracket, equals sign, angle bracket, ampersand or backtick."""
    if c.old is None:
        return "new CSS file"
    for _, t in c.added + c.removed:
        if not CSS_OK_LINE.fullmatch(t) or any(w in t.lower() for w in CSS_BAD_WORDS):
            return "CSS line with characters or words beyond plain rules"
    return None


def hold_reason(c):
    """Risk hint only (nothing lands unattended): why one changed file counts as "code" rather than "text", or
    None for "text". Only .html, .css and .md files can be "text", and only when the structural rules below pass;
    any media file (image, PDF, video), JavaScript, JSON and any other type is "code"."""
    if c.media:
        return "PDF" if c.ext == ".pdf" else "media file"
    if c.ext == ".html":
        return html_hold(c.old, c.new)
    if c.ext == ".md":
        return md_hold(c)
    if c.ext == ".css":
        return css_hold(c)
    return "JavaScript" if c.ext == ".js" else "JSON" if c.ext == ".json" else "unreadable file type"


class RowRefuse(Exception):
    """One row broke a rule: that row is refused, the run goes on. rule is short and free of file text; where
    lists locations only, and goes to summary-detail.json."""

    def __init__(self, rule, where=""):
        super().__init__(rule)
        self.rule, self.where = rule, where


def gate(rule, func, *args):
    """Run a check that raises Refuse for the whole run, and turn its refusal into a row refusal. A git or
    other failure inside it still ends the run."""
    try:
        return func(*args)
    except Refuse as exc:
        if exc.code != EXIT_REFUSED:
            raise
        raise RowRefuse(rule, str(exc)) from None


def vet_row(row, work, tools, base, tree, changed, scanner):
    """Every per-row rule, in order. Returns (changes, risk hint, parse checks run); raises RowRefuse. The hint is
    "code" when any file fails the old land-unattended rules, else "text"."""
    mine = {f: changed[f] for f in row["files"]}
    gate("path rule", vet_paths, work, mine)
    for f in mine:
        if os.path.getsize(Path(work) / f) > MAX_FILE_BYTES:
            raise RowRefuse("file larger than 512 KB", f)
    changes = load_changes(work, tools, mine, tree)
    gate("media rule", check_media, changes)
    gate("secret scan", secret_scan, changes, scanner)
    gate("auth, session or role code", check_auth_lines, changes)
    js = {p: c for p, c in changes.items() if c.ext == ".js"}
    gate("new markup in script", check_js_markup, js)
    gate("new host", check_new_hosts, js, tools, base)
    hint = "code" if any(hold_reason(c) for c in changes.values()) else "text"
    return changes, hint, gate("parse check", run_parse_checks, changes)


# ---------------------------------------------------------------- parse-only checks

def run_parse_checks(changes):
    """In-process parsing only; nothing from WORK is imported or executed. Every text file must be valid UTF-8
    and a .json file must parse. (HTML is parsed by html_hold; a page's links and policy cannot change in a row
    that lands, because every attribute must be identical, and a held row is read by a person.)"""
    problems, ran = [], set()
    for path, c in sorted(changes.items()):
        if c.media:
            continue
        try:
            text = c.new_bytes.decode("utf-8")
        except UnicodeDecodeError:
            problems.append(f"{path}: not valid UTF-8")
            continue
        ran.add("utf-8 decode")
        if c.ext == ".json":
            ran.add("json parse")
            try:
                json.loads(text)
            except ValueError:
                problems.append(f"{path}: not valid JSON")
    if problems:
        raise Refuse("parse check failed:\n  " + "\n  ".join(problems[:40]))
    return sorted(ran)


# ---------------------------------------------------------------- summary text and files

def clean_text(text, limit):
    """One line, safe to post: control characters and U+2028/2029 turned to spaces; backticks, angle brackets,
    at-signs, ampersands, Markdown link and emphasis characters removed, and any word holding :// or starting
    with www. dropped."""
    text = re.sub(r"[\x00-\x1f\x7f  ]+", " ", str(text or ""))
    text = " ".join(w for w in text.split() if "://" not in w and not w.lower().startswith("www."))
    text = re.sub(r"[`<>@&\[\]()*#!_~|]", "", text)
    return re.sub(r"\s+", " ", text).strip()[:limit]


def summary_line(rid, title, text):
    lead = f"{clean_text(rid, 40)} | {clean_text(title, 60)} | "
    return (lead + clean_text(text, min(SUMMARY_MAX, max(0, LINE_MAX - len(lead)))))[:LINE_MAX]


def write_summary_json(path, marked):
    """Write the machine-read summary: exactly {"rows": [{id, status, commit, files}]}, nothing else. Status is
    held or proposed and commit is always null (the job never commits). A tool reads it automatically and posts
    no free text, so anything off-schema is refused rather than written."""
    for e in marked:
        if (set(e) != {"id", "status", "commit", "files"} or not UUID_RE.fullmatch(str(e["id"]))
                or e["status"] not in ("proposed", "held") or e["commit"] is not None
                or not isinstance(e["files"], int) or isinstance(e["files"], bool)):
            raise Refuse("summary.json row is off schema; not written")
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps({"rows": marked}, indent=2), encoding="utf-8")


# ---------------------------------------------------------------- effects (replaced in the tests)

def do_mark(row_id, status, note):
    """Mark one row proposed through feedback_triage's own mark command. True on success; a refusal, an exit or
    an error inside it is reported as False and never stops the loop."""
    argv = ["mark", row_id, "--to", "proposed", "--note=" + note, "--commit"]
    if status != "accepted":                        # an accepted row keeps its stored triage
        argv += ["--triage", "significant"]
    try:
        return ft.main(argv) == 0
    except SystemExit:
        return False
    except Exception:  # noqa: BLE001
        return False


# ---------------------------------------------------------------- writing files into a worktree

def adopt_bytes(c):
    """The bytes to write into a git tree: media as is; text with LF endings, or CRLF where the baseline used it."""
    if c.media:
        return c.new_bytes
    data = c.new_bytes.replace(b"\r\n", b"\n")
    if c.old_bytes is not None and b"\r\n" in c.old_bytes:
        data = data.replace(b"\n", b"\r\n")
    return data


def changelog_line(r):
    """Fixed words, the feedback id and the file paths only: no tester-written or FIX-written text."""
    files = ", ".join(clean_text(f, 200) for f in r["files"])
    return (f"- Feedback {clean_text(r['id'], 40)}: proposed fix to {files}. Written by the unattended feedback "
            f"job; held for operator approval before commit.")


def changelog_entry(r, today=None):
    """The fixed-template CHANGELOG entry for one proposal: a header, then one line."""
    today = today or datetime.date.today().isoformat()
    return [f"## {today} — Matthew Recker via Claude", "", changelog_line(r)]


def insert_changelog(text, entry_lines):
    """Insert the entry above the first existing '## ' entry (or at the end), in the line ending of the file's first line."""
    nl = "\r\n" if text.split("\n", 1)[0].endswith("\r") else "\n"       # the first line decides
    block = nl.join(entry_lines) + nl + nl
    m = re.search(r"^## ", text, re.M)
    if not m:
        return text.rstrip("\r\n") + nl + nl + block.rstrip("\r\n") + nl
    return text[:m.start()] + block + text[m.start():]


def write_changelog(worktree, row, today=None):
    """The row's own CHANGELOG entry, written (uncommitted) into the row's worktree."""
    path = Path(worktree) / "CHANGELOG.md"
    text = path.read_bytes().decode("utf-8")
    path.write_bytes(insert_changelog(text, changelog_entry(row, today)).encode("utf-8"))


def put_files(root, changes, paths):
    for p in paths:
        if not is_allowed(p):
            raise Refuse(f"{p}: not on the allowlist")
        dest = Path(root) / p
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(adopt_bytes(changes[p]))


# ---------------------------------------------------------------- propose

def trusted_feedback(run):
    return Path(run) / "feedback.json"


def propose(work, tools, base, summary, run_dir, held_dir, dry_run=False, out=print):
    with git_session(forbid=[work]):
        return _propose(work, tools, base, summary, run_dir, held_dir, dry_run, out)


def _propose(work, tools, base, summary, run_dir, held_dir, dry_run, out):
    staging_guard()
    work, tools = Path(work), Path(tools)
    check_trees(work, tools)
    summary = check_summary_path(summary, work)
    run = check_run_dir(run_dir, work, tools)
    held_root = check_held_dir(held_dir, work, tools, run)
    wrun = work / RUN_DIR
    trusted = trusted_feedback(run)
    if not trusted.exists() and not (wrun / "feedback.json").exists():
        out("nothing to propose: no feedback.json")
        return EXIT_OK
    if not trusted.exists():
        raise Refuse("the trusted copy of feedback.json (written by FETCH in the run directory) is missing")
    feedback = load_json(trusted, "the trusted feedback.json")
    if (wrun / "feedback.json").exists() and load_json(wrun / "feedback.json", "WORK feedback.json") != feedback:
        raise Refuse("WORK feedback.json differs from the one FETCH wrote")
    if feedback.get("base") != base:
        raise Refuse("feedback.json base is not --base")
    if read_head_plain(work) != base:
        raise Refuse("WORK's HEAD commit is not --base")
    by_id = {r["id"]: r for r in feedback["rows"]}
    rows = validate_manifest(load_json(wrun / "manifest.json", "manifest.json"), set(by_id))
    ensure_base_object(tools, base, expected_remote(tools), fetch=not dry_run)
    tree = base_tree(tools, base)

    changed, refusals = diff_work(work, tools, tree)
    if refusals:
        raise Refuse(hits_text("change refused", refusals))
    check_files_match(rows, set(changed))                 # whole run: an unlisted or doubly listed file
    scanner = load_scanner(tools)
    scan_manifest_text(rows, scanner)

    kinds, why, risk, changes, ran = {}, {}, {}, {}, set()
    for r in rows:
        if r["decision"] != "applied":
            kinds[r["id"]] = r["decision"]
            continue
        try:
            got, hazard, did = vet_row(r, work, tools, base, tree, changed, scanner)
            if line_hits("\n".join(changelog_entry(r)), scanner):
                raise RowRefuse("secret scan: changelog text")
            if (held_root / r["id"]).exists() and by_id[r["id"]]["status"] == "new" and branch_exists(tools, r["id"]):
                kinds[r["id"]] = "retry"            # already written by an earlier run: only the mark is retried
                ran.update(did)
                continue
            check_held_slot(tools, held_root, r["id"])
        except RowRefuse as exc:
            kinds[r["id"]], why[r["id"]] = "refused", (exc.rule, exc.where)
            continue
        kinds[r["id"]], risk[r["id"]] = "held", hazard
        changes.update(got)
        ran.update(did)
    ran = sorted(ran)

    held, refused, proposed, skipped, retried = ([r for r in rows if kinds[r["id"]] == k]
                                                 for k in ("held", "refused", "proposed", "skipped", "retry"))
    out(f"plan: {len(held)} proposal(s) to write, {len(refused)} refused, {len(proposed)} proposed, "
        f"{len(skipped)} skipped, {len(retried)} already written; {len(changes)} changed file(s) kept")
    for r in held:
        out(f"  worktree for {r['id']} [{risk[r['id']]}]: " + ", ".join(r["files"]))
    for r in refused:
        out(f"  refused {r['id']}: {why[r['id']][0]}")
    if dry_run:
        out("dry run: nothing written.")
        return EXIT_OK

    detail = {"proposed_unmarked": [], "mark_failed": [], "checks": ran,
              "risk": dict(risk),
              "refused": [{"id": r["id"], "rule": why[r["id"]][0], "where": why[r["id"]][1][:2000]} for r in refused]}
    plan = Plan(work=work, tools=tools, summary=summary, run=run, held_root=held_root, rows=rows, by_id=by_id,
                kinds=kinds, why=why, risk=risk, held=held, refused=refused, proposed=proposed, skipped=skipped, retried=retried,
                changes=changes, base=base, state={"rows": []}, detail=detail)
    try:
        return _propose_write(plan)
    except Refuse as exc:
        if exc.code in (EXIT_GIT, EXIT_MARK):
            write_summary_json(summary, plan.state["rows"])
        raise


def held_branch(rid):
    return "feedback-held-" + rid


def branch_exists(tools, rid):
    return git(tools, "show-ref", "--verify", "--quiet", f"refs/heads/{held_branch(rid)}", check=False).returncode == 0


def check_held_slot(tools, held_root, rid):
    """Refuse the one row when its held worktree path or branch is already taken. Checked before anything is
    written, so a refusal costs the other rows nothing."""
    if (held_root / rid).exists():
        raise RowRefuse("held worktree path already exists")
    if branch_exists(tools, rid):
        raise RowRefuse("held branch already exists")


class Plan:
    """What PROPOSE decided: a kind for every manifest row (held, refused, proposed or skipped), and what the
    write phase needs. Built by _propose, used by _propose_write."""

    def __init__(self, **kw):
        self.__dict__.update(kw)


def write_held_one(p, r):
    """One fresh worktree for one row, on its own branch, with the row's files and its CHANGELOG entry written but
    uncommitted. The row goes into held.json right after the worktree exists (the file is rewritten whole, so it
    is valid JSON after every row). If anything fails after the worktree exists, the worktree, its branch and its
    held.json entry are removed again and the run stops with exit 4, so no half-written proposal is left."""
    path = p.held_root / r["id"]
    branch = held_branch(r["id"])
    p.held_root.mkdir(parents=True, exist_ok=True)
    git(p.tools, "worktree", "add", "--no-track", "-b", branch, str(path), p.base)
    try:
        entry = {"id": r["id"], "worktree": str(path), "branch": branch, "files": list(r["files"]),
                 "risk": p.risk[r["id"]]}
        held_json = p.run / "held.json"
        existing = []
        if held_json.exists():
            with contextlib.suppress(Exception):
                existing = json.loads(held_json.read_text(encoding="utf-8")).get("held", [])
        held_json.write_text(json.dumps({"held": [e for e in existing if e.get("id") != r["id"]] + [entry]},
                                        indent=2), encoding="utf-8")
        put_files(path, p.changes, r["files"])
        write_changelog(path, r)
    except Exception as exc:  # noqa: BLE001
        git(p.tools, "worktree", "remove", "--force", str(path), check=False)
        if path.exists():
            shutil.rmtree(path, onerror=_retry_rw)
        git(p.tools, "worktree", "prune", check=False)
        git(p.tools, "branch", "-D", branch, check=False)
        with contextlib.suppress(Exception):
            held_json = p.run / "held.json"
            kept = [e for e in json.loads(held_json.read_text(encoding="utf-8")).get("held", [])
                    if e.get("id") != r["id"]]
            held_json.write_text(json.dumps({"held": kept}, indent=2), encoding="utf-8")
        raise Refuse(f"writing the worktree failed ({type(exc).__name__}); it was removed again", EXIT_GIT) from None


def write_outputs(p):
    """summary.json, summary.txt and summary-detail.json, all outside WORK, from the state so far."""
    write_summary_json(p.summary, p.state["rows"])
    failed = p.detail["mark_failed"]
    lines = [f"feedback: {len(p.held)} held, {len(p.refused)} refused, {len(p.proposed)} proposed, "
             f"{len(p.skipped)} skipped" + (f", {len(failed)} mark failed" if failed else "")]
    for r in p.rows:
        kind = p.kinds[r["id"]]
        text = p.why[r["id"]][0] if kind == "refused" else (r.get("summary") or r.get("note") or r["decision"])
        lines.append(summary_line(r["id"], p.by_id[r["id"]].get("page_title"), f"{kind}: {text}"))
    (Path(p.summary).parent / "summary.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    p.detail.update({"held": len(p.held), "refused_rows": len(p.refused), "proposed": len(p.proposed),
                     "skipped": len(p.skipped)})
    (Path(p.summary).parent / "summary-detail.json").write_text(json.dumps(p.detail, indent=2), encoding="utf-8")


def _propose_write(p):
    """One worktree and one mark per held row, then the marks for rows FIX or the checks left as proposed.
    Nothing is committed, pushed or published: the operator approves each worktree and commits it himself."""
    marked, failed = p.state["rows"], []
    for r in p.held:
        write_held_one(p, r)
        status = p.by_id[r["id"]]["status"]
        if status == "accepted":                              # the agent may not propose on an accepted row
            p.detail["proposed_unmarked"].append(r["id"])
        elif do_mark(r["id"], status, HELD_NOTE):
            marked.append({"id": r["id"], "status": "held", "commit": None, "files": len(r["files"])})
        else:
            failed.append(r["id"])
    for r in p.rows:
        kind, status = p.kinds[r["id"]], p.by_id[r["id"]]["status"]
        if kind == "retry":
            if do_mark(r["id"], status, HELD_NOTE):
                marked.append({"id": r["id"], "status": "held", "commit": None, "files": len(r["files"])})
            else:
                failed.append(r["id"])
            continue
        if kind not in ("proposed", "refused"):
            continue
        if status != "new":
            p.detail["proposed_unmarked"].append(r["id"])
            continue
        note = r["note"][:ft.NOTE_MAX] if kind == "proposed" else REFUSED_NOTE + p.why[r["id"]][0]
        if do_mark(r["id"], status, note):
            marked.append({"id": r["id"], "status": "proposed", "commit": None, "files": 0})
        else:
            failed.append(r["id"])
    p.detail["mark_failed"] = failed
    write_outputs(p)
    if failed:
        raise Refuse("marking failed for " + ", ".join(failed), EXIT_MARK)
    return EXIT_HELD if p.held else EXIT_OK


# ---------------------------------------------------------------- fetch

def read_head_plain(work):
    """WORK's HEAD commit read from plain files (no git): .git/HEAD, then the loose ref or packed-refs. Returns
    a 40-hex sha or None. Run before FIX, when WORK is still the checkout the launcher made."""
    g = Path(work) / ".git"
    if g.is_file():
        m = re.match(r"gitdir:\s*(.+)", g.read_text(encoding="utf-8", errors="replace").strip())
        if not m:
            return None
        gitdir = (Path(work) / m.group(1)).resolve()
    elif g.is_dir():
        gitdir = g
    else:
        return None
    common = gitdir
    if (gitdir / "commondir").is_file():
        common = (gitdir / (gitdir / "commondir").read_text().strip()).resolve()
    head_txt = (gitdir / "HEAD").read_text(encoding="utf-8", errors="replace").strip()
    if SHA_RE.fullmatch(head_txt):
        return head_txt
    if not head_txt.startswith("ref: "):
        return None
    ref = head_txt[5:].strip()
    if not ref.startswith("refs/") or ".." in ref:
        return None
    for d in (gitdir, common):
        f = d / ref
        if f.is_file():
            v = f.read_text().strip()
            return v if SHA_RE.fullmatch(v) else None
    packed = common / "packed-refs"
    if packed.is_file():
        for line in packed.read_text().splitlines():
            parts = line.split(" ")
            if len(parts) == 2 and parts[1] == ref and SHA_RE.fullmatch(parts[0]):
                return parts[0]
    return None


def query_rows():
    """new rows, plus accepted rows. Returns (rows, None) or (None, reason)."""
    conn = ft.connect("STAGING_APP_READ_PASSWORD", "prep_app_read")
    try:
        cur = conn.cursor()
        if ft.columns_missing(cur):
            return None, "migration 089 is not applied on staging"
        cur.execute(f"SELECT {ft.LIST_COLS} FROM app.feedback WHERE status IN ('new', 'accepted') ORDER BY created_at")
        names = [d[0] for d in cur.description]
        return [dict(zip(names, r)) for r in cur.fetchall()], None
    finally:
        conn.close()


def shape_row(r):
    """The only fields the FIX stage sees. No name, no user id."""
    return {"id": str(r["id"]), "status": r["status"], "page_title": r.get("page_title"), "page_url": r.get("page"),
            "message": r.get("message"), "director_instructions": r.get("director_instructions")}


def clear_dir(path):
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True)
    for child in path.iterdir():
        if child.is_dir() and not child.is_symlink():
            shutil.rmtree(child, onerror=_retry_rw)
        else:
            child.unlink()


def fetch(work, tools, run_dir, held_dir, dry_run=False, out=print):
    work, tools = Path(work), Path(tools)
    check_trees(work, tools)
    run = check_run_dir(run_dir, work, tools)
    held_root = check_held_dir(held_dir, work, tools, run)
    base = read_head_plain(work)
    if not base:
        raise Refuse("cannot read WORK's HEAD commit")
    rows, why = query_rows()
    if rows is None:
        raise Refuse(why)
    keep = [shape_row(r) for r in rows
            if r["status"] == "new"
            or (r["status"] == "accepted" and r.get("decided_by_global_admin") and r.get("decided_at"))]
    # A row whose held slot exists is already written and waiting for the operator (an accepted row cannot be
    # marked proposed, so the queue still returns it). Skip it: FIX would redo it and PROPOSE would refuse it.
    # Only an accepted row: a new row with a slot is retried by PROPOSE (it re-marks the row).
    skipped = [r["id"] for r in keep if r["status"] == "accepted" and UUID_RE.fullmatch(r["id"])
               and (held_root / r["id"]).exists()]
    keep = [r for r in keep if r["id"] not in skipped]
    if skipped:
        out("feedback-job: held, skipped: " + ", ".join(skipped))
    if not keep:
        out("feedback-job: no new or approved items")
        return EXIT_NO_ROWS
    if dry_run:
        for r in keep:
            out(f"{r['id']} [{r['status']}] {r['page_title']!r}: {r['message']!r}")
        out(f"dry run: {len(keep)} row(s); nothing written.")
        return EXIT_OK
    payload = json.dumps({"base": base, "rows": keep, "held_skipped": skipped}, indent=2)
    clear_dir(run)
    (work / RUN_DIR).mkdir(exist_ok=True)
    for d in (run, work / RUN_DIR):
        (d / "feedback.json").write_text(payload, encoding="utf-8")
    out(f"feedback-job: {len(keep)} row(s) written")
    return EXIT_OK


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch")
    f.add_argument("--work", required=True)
    f.add_argument("--run-dir", required=True)
    f.add_argument("--held-dir", required=True, help="the persistent folder PROPOSE writes held worktrees to")
    f.add_argument("--dry-run", action="store_true")
    ln = sub.add_parser("propose")
    ln.add_argument("--work", required=True)
    ln.add_argument("--base", required=True)
    ln.add_argument("--summary", required=True, help="where to write summary.json; must be outside WORK")
    ln.add_argument("--run-dir", required=True, help="scratch folder outside WORK and TOOLS; fetch clears it")
    ln.add_argument("--held-dir", required=True, help="persistent folder for held worktrees; outside all others")
    ln.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    try:
        if args.cmd == "fetch":
            with git_session(forbid=[args.work]):
                return fetch(args.work, TOOLS_ROOT, args.run_dir, args.held_dir, args.dry_run)
        return propose(args.work, TOOLS_ROOT, args.base, args.summary, args.run_dir, args.held_dir, args.dry_run)
    except Refuse as exc:
        print(f"{'REFUSED' if exc.code == EXIT_REFUSED else 'FAILED'}  {exc}", file=sys.stderr)
        return exc.code
    except SystemExit as exc:                        # the staging guard exits with its own refusal text
        if isinstance(exc.code, str):
            print(exc.code, file=sys.stderr)
            return EXIT_REFUSED
        raise
    except Exception as exc:  # noqa: BLE001
        print(f"FAILED  unexpected {type(exc).__name__}", file=sys.stderr)
        return EXIT_ERROR


if __name__ == "__main__":
    sys.exit(main())
