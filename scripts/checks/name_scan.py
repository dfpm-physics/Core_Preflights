#!/usr/bin/env python3
"""Find a real cadet's NAME in a tracked file — READ-ONLY, and it never prints one.

WHAT IT LOOKS FOR
    A student's name written into a committed file where the cadet ID would have carried the same
    meaning. That is the standing rule as of 2026-08-17:

        name + cadet ID + score are NOT PII in this system, per institutional guidance received
        (grade storage is cleared with the registrar and the course director has no specific
        source to cite, per the 2026-11-04 note in the decision record) -- so IDs and scores may be committed. A
        NAME may not, wherever an ID says the same thing.

    Reasoning, what it supersedes, and the accept-as-is ruling on git history:
    docs/decisions/STUDENT-DATA-CLASSIFICATION.md. Operating rule: CORE.md section 3.

WHY IT READS THE ROSTER LIVE INSTEAD OF CARRYING A PATTERN
    There is no regex for "is a person's name". The only authority is app.students, and it changes
    every term. So the roster is fetched at runtime, held in memory, and never written anywhere --
    a committed name list would be the exact thing this check exists to prevent.

    Its predecessor finding (docs/findings/2026-08-13-...) searched by cadet-ID pattern and named
    that as its own blind spot in section 4: "Names appearing WITHOUT an ID were not swept for."
    That blind spot was real. The 2026-08-17 sweep found names on three files the ID-anchored
    search could not see, because nobody had written a number beside them.

WHAT IT WILL NOT FLAG, ON PURPOSE
    * Fabricated rosters. The retired POC block (30001000xx), the training sandbox (3000980000+
      and 3000990000-3000990071) and the deliberate test accounts (3008888888, 3009999999) are
      hard-excluded by ID, and every remaining row must ALSO be provisioned and carry a registrar
      email -- a fabricated <cadetID>@usafa.edu address does not count.
    * Synthetic placeholders that collide with a real cadet's name. `Smith John` in the
      SYSTEM_GUIDE CSV example is a made-up placeholder that happens to match a real roster row.
      Those live in ALLOW below, keyed on (path, student_id), so a DIFFERENT cadet's name in the
      same file still fires.

WHAT IT WILL MISS, SO NOBODY READS A ZERO AS AN ALL-CLEAR
    * A cadet referred to by first name alone, by a nickname, or by a surname with no given name
      anywhere near it. Two tokens of one roster row must land within PROXIMITY characters of each
      other on one line. A single common surname matches hundreds of ordinary English lines, and a
      check that cries wolf is a check nobody runs.
    * Anything in git history. History was accepted as-is; this check governs the working tree.
    * A former cadet whose row has left app.students.

EXIT CODES
    0  clean
    1  at least one real cadet's name is in a tracked file -- redact before committing
    2  could not run (no credentials, no network, not a git tree)

HASH MODE — SCANNING WITHOUT A DATABASE CREDENTIAL
    Whoever holds roster access runs, once a term:
        python scripts/checks/name_scan.py --write-hashes PATH     (reads the roster as above)
    which writes a local JSON file: format version, a fresh random salt, creation date, counts, and
    per cadet the cadet ID plus salted SHA-256 hashes of the surname and the given-name tokens the
    scan matches on. No plain name is written. The cadet ID IS written (permitted by CORE.md
    section 3): the ALLOW list is keyed on (path, cadet ID) and a hit reports the ID, so the hash
    scan needs it to behave like the live one. The write is refused for a path git tracks or does
    not ignore. Anyone can then run, with no database and no credential:
        python scripts/checks/name_scan.py --hash-file [PATH]
    PATH defaults to scripts/checks/name_scan_hashes.local.json (gitignored).

    Matching is token-for-token the live matching (same tokens, same ALLOW, same proximity window,
    same exit codes); only the comparison key differs. The one visible difference: a hash cannot
    be masked, so a hit prints the file, line and cadet ID but no masked name.

    HONEST LIMITS. The salt is stored beside the hashes, so anyone holding the file can test a
    guessed name against it. The file therefore stays local and is never committed. It is a
    snapshot: a cadet who joined the roster after it was written is NOT caught until it is
    refreshed (a warning is printed past 120 days; the output always states the file date and
    name count so a pass is never read as a live-roster pass). A missing or damaged file exits 2,
    never 0.

Usage:
  python scripts/checks/name_scan.py
  python scripts/checks/name_scan.py --json          # machine-readable, still no names
  python scripts/checks/name_scan.py --proximity 40  # tighten the two-token window
  python scripts/checks/name_scan.py --write-hashes PATH   # needs roster access
  python scripts/checks/name_scan.py --hash-file [PATH]    # needs nothing

PRIVACY: output is file:line + cadet ID + a MASKED name (first letter, then asterisks). The masked
form is there so an operator can tell two hits apart and find the string in the file; it is not
reversible on its own. This script prints no name in any mode, including --json, because a check
for committed names must not be the thing that commits one.

DEPENDENCIES: standard library only at import time (CORE.md section 2). psycopg2 is imported
lazily and only when the .env credential path is used; without it the script falls back to the
REST path, and with neither credential it exits 2 with instructions.
"""

import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.request

# BOTH streams. Every instruction this script prints contains an em dash, and a cp1252 console
# renders those as a replacement character — which makes a precise instruction look like
# corruption. Reconfiguring one stream and not the other is the version of this bug that hides.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

REPO = pathlib.Path(__file__).resolve().parents[2]
ENV_FILE = REPO / "supabase" / "admin" / ".env"
CONFIG_PATH = pathlib.Path(os.path.expanduser("~/.claude/skills/preflight-analyze/config.json"))

EXIT_OK, EXIT_HIT, EXIT_UNUSABLE = 0, 1, 2

DEFAULT_HASH_FILE = pathlib.Path(__file__).resolve().parent / "name_scan_hashes.local.json"
HASH_FORMAT = 1
STALE_DAYS = 120

# Directories whose contents are not prose about cadets and would only add noise. textbook-pdfs is
# gitignored and so never reaches `git ls-files`; it is listed for the reader, not for the filter.
SKIP_DIRS = ("textbook-pdfs/", "node_modules/", ".venv/")
SKIP_EXT = (".png", ".jpg", ".jpeg", ".gif", ".svg", ".pdf", ".ico", ".woff", ".woff2", ".ttf",
            ".zip", ".xlsx", ".docx", ".pptx", ".pyc", ".lock")

# Every synthetic ID block, from the 2026-08-13 finding's section 3. A row inside one of these is
# fabricated data and its "name" is nobody's.
SYNTHETIC_BLOCKS = (
    (3000100000, 3000100099),   # retired POC roster -- Alex Carter, Jordan Blake, et al.
    (3000980000, 3000989999),   # training sandbox
    (3000990000, 3000990071),   # training sandbox, seeded fixtures
    (3008888888, 3008888888),   # deliberate test account
    (3009999999, 3009999999),   # deliberate test account
)

# Known-synthetic placeholders that happen to match a real roster row. Keyed on (path, student_id)
# rather than on the path alone: a different cadet's name in the same file still fires.
ALLOW = {
    ("site/gemini/phys-110/lesson-33-universal-gravitation-d247e5a7.html", 3000141965):
        "a physics history sentence that names two historical scientists, not a cadet",
    ("docs/operations/SYSTEM_GUIDE.md", 3000138988):
        "the CSV-format example's placeholder row -- the finding lists it so nobody 'fixes' it",
    ("tests/app-schema/test-roster-import.mjs", 3000138988):
        "the invented registrar CSV fixture (a 'Smith, John' advisor column)",
    ("scripts/checks/name_scan.py", 3000138988):
        "this checker's own docstring, in the sentence explaining the two entries above -- "
        "it quotes the placeholder in order to document why the placeholder is allow-listed, "
        "so the scanner flagged itself and exited 1 on every run",
}

SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v", "vi", "vii", "viii"}
MIN_TOKEN = 4          # a 3-letter token matches too much ordinary English
PROXIMITY = 60         # characters between the two tokens, on one line

# ── Roster ────────────────────────────────────────────────────────────────────────────────────


def read_env(path):
    """Minimal KEY=VALUE parser -- stdlib only, mirrors scripts/app/gen_db_schema.py."""
    out = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        out[key.strip()] = val
    return out


def roster_via_db():
    """prep_app_read over the session pooler. Returns None if unavailable rather than exiting."""
    if not ENV_FILE.is_file():
        return None
    env = read_env(ENV_FILE)
    role, password = env.get("PREP_APP_READ_ROLE"), env.get("PREP_APP_READ_PASSWORD")
    if not role or not password or not env.get("PREP_DB_HOST"):
        return None
    try:
        import psycopg2                                    # noqa: PLC0415 -- optional, see docstring
    except ImportError:
        return None
    ref = env.get("PREP_PROJECT_REF", "")
    user = f"{role}.{ref}" if ref and "." not in role else role
    try:
        conn = psycopg2.connect(
            host=env["PREP_DB_HOST"], port=env.get("PREP_DB_PORT", "5432"),
            dbname=env.get("PREP_DB_NAME", "postgres"),
            sslmode=env.get("PREP_DB_SSLMODE", "require"),
            user=user, password=password, connect_timeout=20)
    except Exception as exc:                                # noqa: BLE001 -- any driver error
        print(f"[warn] prep_app_read could not connect ({type(exc).__name__}); "
              f"trying the REST path.", file=sys.stderr)
        return None
    try:
        cur = conn.cursor()
        cur.execute("SELECT student_id, name, email, auth_user_id IS NOT NULL "
                    "FROM app.students")
        rows = [{"student_id": r[0], "name": r[1], "email": r[2], "provisioned": r[3]}
                for r in cur.fetchall()]
    finally:
        conn.close()
    return rows


def roster_via_rest():
    """Service-role key over PostgREST. Paged: app.students is under the 1000-row cap today and
    will not stay that way (957 rows on 2026-08-17), and a truncated read reports a false clean."""
    if not CONFIG_PATH.is_file():
        return None
    try:
        cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        base = cfg["supabase_url"].rstrip("/")
        key = cfg["supabase_service_key"]
    except (OSError, KeyError, ValueError):
        return None
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Accept-Profile": "app"}
    rows, offset, page_size = [], 0, 1000
    while True:
        url = (f"{base}/rest/v1/students?select=student_id,name,email,auth_user_id"
               f"&limit={page_size}&offset={offset}")
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers),
                                        timeout=60) as r:
                page = json.load(r)
        except (urllib.error.HTTPError, urllib.error.URLError) as exc:
            print(f"[warn] REST roster read failed: {exc}", file=sys.stderr)
            return None
        rows += [{"student_id": p["student_id"], "name": p.get("name"), "email": p.get("email"),
                  "provisioned": p.get("auth_user_id") is not None} for p in page]
        if len(page) < page_size:
            return rows
        offset += page_size


def is_synthetic(student_id, email):
    """True when this row is fabricated data whose 'name' belongs to nobody."""
    for low, high in SYNTHETIC_BLOCKS:
        if low <= student_id <= high:
            return True
    if not email:
        return True
    # The fabricated pre-registrar address. A real registrar email is a person's, not a number's.
    return bool(re.fullmatch(r"\d+@usafa\.edu", email, re.I))


def enrolled_names(rows):
    """-> [(student_id, surname, {given tokens}, masked)] for real, provisioned cadets only."""
    out = []
    for r in rows:
        sid, name = r["student_id"], (r.get("name") or "").strip()
        if not name or not r.get("provisioned") or is_synthetic(sid, r.get("email")):
            continue
        toks = [t for t in (re.sub(r"[^A-Za-z'\-]", "", p) for p in re.split(r"[\s,]+", name)) if t]
        core = [t for t in toks if t.lower() not in SUFFIXES]
        if len(core) < 2:
            continue                      # a one-token roster name cannot meet the two-token bar
        surname = core[-1].lower()
        given = {t.lower() for t in core[:-1] if len(t) >= MIN_TOKEN}
        if len(surname) < MIN_TOKEN or not given:
            continue
        masked = " ".join(t[0] + "*" * (len(t) - 1) for t in name.split())
        out.append((sid, surname, given, masked))
    return out


# ── Tree ──────────────────────────────────────────────────────────────────────────────────────


def tracked_files():
    try:
        res = subprocess.run(["git", "ls-files", "-z"], cwd=REPO, capture_output=True, check=True)
    except (OSError, subprocess.CalledProcessError) as exc:
        print(f"Not a usable git tree at {REPO}: {exc}", file=sys.stderr)
        sys.exit(EXIT_UNUSABLE)
    for rel in res.stdout.decode("utf-8", "replace").split("\0"):
        if not rel or rel.startswith(SKIP_DIRS) or rel.lower().endswith(SKIP_EXT):
            continue
        yield rel


def scan(rel, roster, proximity, keyfn=None):
    """-> [(line_no, student_id, masked)] for one file. Binary files are skipped silently.

    keyfn maps a lowercase line token to the key the roster holds: identity for the live scan, a
    salted hash for hash mode. Everything else is shared, so the two cannot drift."""
    if keyfn is None:
        keyfn = _identity
    path = REPO / rel
    try:
        raw = path.read_bytes()
    except OSError:
        return []
    if b"\0" in raw[:8192]:
        return []
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return []

    hits = []
    for lineno, line in enumerate(text.splitlines(), 1):
        low = line.lower()
        # One cheap pass builds the token -> offsets map; the per-student loop then only does
        # dictionary lookups. Without this, 900 students x 400 files is minutes, not seconds.
        offsets = {}
        for m in re.finditer(r"[a-z][a-z'\-]{2,}", low):
            offsets.setdefault(keyfn(m.group(0)), []).append(m.start())
        if not offsets:
            continue
        for sid, surname, given, masked in roster:
            if (rel, sid) in ALLOW:
                continue
            sur_at = offsets.get(surname)
            if not sur_at:
                continue
            near = False
            for g in given & offsets.keys():
                for a in sur_at:
                    if any(abs(a - b) <= proximity for b in offsets[g]):
                        near = True
                        break
                if near:
                    break
            if near:
                hits.append((lineno, sid, masked))
    return hits


# ── Hash mode ─────────────────────────────────────────────────────────────────────────────────


def _identity(token):
    return token


def hash_token(salt_hex, token):
    """Salted SHA-256 of one lowercase token. The same function writes and reads the file."""
    return hashlib.sha256(bytes.fromhex(salt_hex) + b"\0" + token.encode("utf-8")).hexdigest()


def hashed_roster(roster, salt_hex):
    """Roster entries keyed by hash instead of by name. The masked slot is empty on purpose."""
    return [(sid, hash_token(salt_hex, sur), {hash_token(salt_hex, g) for g in given}, "")
            for sid, sur, given, _masked in roster]


def build_hash_payload(rows, roster, salt_hex=None, today=None):
    salt_hex = salt_hex or os.urandom(16).hex()
    today = today or datetime.date.today()
    cadets = [{"id": sid, "s": s, "g": sorted(g)} for sid, s, g, _ in hashed_roster(roster, salt_hex)]
    return {"format": HASH_FORMAT, "salt": salt_hex, "created": today.isoformat(),
            "student_rows": len(rows), "count": len(cadets), "cadets": cadets}


def path_refusal(target):
    """-> None when it is safe to write a hash file at target, else a plain reason.

    Safe means: outside the working tree (git cannot commit it), or inside it and git-ignored and
    not tracked. If git cannot answer, refuse."""
    target = pathlib.Path(target).resolve()
    try:
        rel = target.relative_to(REPO.resolve()).as_posix()
    except ValueError:
        return None
    try:
        tracked = subprocess.run(["git", "ls-files", "--error-unmatch", "--", rel], cwd=REPO,
                                 capture_output=True)
        if tracked.returncode == 0:
            return "git tracks that path"
        ignored = subprocess.run(["git", "check-ignore", "-q", "--", rel], cwd=REPO,
                                 capture_output=True)
    except OSError as exc:
        return f"git could not be run to check the path ({exc})"
    if ignored.returncode == 0:
        return None
    if ignored.returncode == 1:
        return "git does not ignore that path (it could be committed)"
    return "git could not decide whether that path is ignored"


def load_hash_file(path):
    """-> (roster, meta). Raises ValueError with a plain message for any missing or broken file."""
    path = pathlib.Path(path)
    if not path.is_file():
        raise ValueError(f"hash file not found: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data["format"] != HASH_FORMAT:
            raise ValueError(f"unsupported hash file format {data['format']!r}")
        salt = data["salt"]
        bytes.fromhex(salt)
        created = datetime.date.fromisoformat(data["created"])
        cadets = data["cadets"]
        if not isinstance(cadets, list) or data["count"] != len(cadets):
            raise ValueError("count does not match the cadet list")
        roster = [(int(c["id"]), str(c["s"]), {str(g) for g in c["g"]}, "") for c in cadets]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise ValueError(f"hash file is damaged or unreadable: {path} ({type(exc).__name__}: {exc})")
    if not roster:
        raise ValueError(f"hash file holds no cadets: {path}")
    age = (datetime.date.today() - created).days
    meta = {"path": str(path), "created": created.isoformat(), "age_days": age,
            "count": len(roster), "student_rows": data.get("student_rows"), "stale": age > STALE_DAYS}
    return roster, salt, meta


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", action="store_true",
                    help="machine-readable summary on stdout (masked names only)")
    ap.add_argument("--proximity", type=int, default=PROXIMITY,
                    help=f"characters allowed between the two matched tokens (default {PROXIMITY})")
    ap.add_argument("--env-file", default=None,
                    help="read the roster credential from this .env file; for a clone that holds none")
    ap.add_argument("--write-hashes", metavar="PATH", default=None,
                    help="read the roster, write a local salted-hash file at PATH, then stop")
    ap.add_argument("--hash-file", nargs="?", const=str(DEFAULT_HASH_FILE), default=None,
                    metavar="PATH",
                    help="scan against a hash file instead of the live roster (no credential); "
                         "default path scripts/checks/name_scan_hashes.local.json")
    args = ap.parse_args()

    if args.write_hashes and args.hash_file:
        print("Use --write-hashes or --hash-file, not both.", file=sys.stderr)
        return EXIT_UNUSABLE

    if args.env_file:
        global ENV_FILE
        ENV_FILE = pathlib.Path(args.env_file)

    keyfn, hash_meta, rows, roster = _identity, None, None, None
    if args.hash_file:
        try:
            roster, salt, hash_meta = load_hash_file(args.hash_file)
        except ValueError as exc:
            print(f"Cannot scan from a hash file, so this check cannot run -- and a check that\n"
                  f"cannot run must not report clean.\n  {exc}\n"
                  "Write one with --write-hashes PATH (needs roster access).", file=sys.stderr)
            return EXIT_UNUSABLE
        memo = {}

        def keyfn(token, _salt=salt, _memo=memo):
            h = _memo.get(token)
            if h is None:
                h = _memo[token] = hash_token(_salt, token)
            return h

        rows = [None] * (hash_meta["student_rows"] or 0)
        source = f"HASH FILE {hash_meta['path']} (written {hash_meta['created']}, " \
                 f"{hash_meta['count']} names) -- NOT the live roster"
        if hash_meta["stale"]:
            print(f"[warn] the hash file is {hash_meta['age_days']} days old (limit {STALE_DAYS}); "
                  "a cadet added since is not covered. Refresh it with --write-hashes.",
                  file=sys.stderr)

    if roster is None:
        rows = roster_via_db()
        source = "prep_app_read (session pooler)"
        if rows is None:
            rows = roster_via_rest()
            source = "service role (PostgREST)"
    if rows is None:
        print(
            "Cannot read the roster, so this check cannot run -- and a check that cannot run must\n"
            "not report clean.\n\n"
            f"  * {ENV_FILE}\n"
            "      needs PREP_APP_READ_ROLE / PREP_APP_READ_PASSWORD / PREP_DB_HOST, and psycopg2\n"
            "      importable (a project .venv -- see docs/operations/MACHINE-SETUP.md), or\n"
            f"  * {CONFIG_PATH}\n"
            "      needs supabase_url + supabase_service_key (run /setup-preflight).\n\n"
            "Both are gitignored and come from the course director out of band (CORE.md section 3).",
            file=sys.stderr)
        return EXIT_UNUSABLE

    if roster is None:
        roster = enrolled_names(rows)
    if args.write_hashes and roster:
        reason = path_refusal(args.write_hashes)
        if reason:
            print(f"Refusing to write the hash file: {reason}. Choose a git-ignored path or one "
                  "outside the repository.", file=sys.stderr)
            return EXIT_UNUSABLE
        payload = build_hash_payload(rows, roster)
        out_path = pathlib.Path(args.write_hashes)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(payload, indent=1) + "\n", encoding="utf-8", newline="\n")
        print(f"Wrote hash file: {out_path}\n{len(rows)} student rows · {payload['count']} "
              f"real enrolled cadets hashed (format {HASH_FORMAT}, {payload['created']}). "
              "Keep it local; never commit it.")
        return EXIT_OK
    if not roster:
        print(f"Read {len(rows)} student rows and none is an enrolled, provisioned cadet with a\n"
              "registrar email. That is not a clean tree, it is an empty roster -- refusing to\n"
              "report PASS.", file=sys.stderr)
        return EXIT_UNUSABLE

    findings, files_scanned = [], 0
    for rel in tracked_files():
        files_scanned += 1
        for lineno, sid, masked in scan(rel, roster, args.proximity, keyfn):
            findings.append({"file": rel, "line": lineno, "student_id": sid, "masked": masked})

    if args.json:
        print(json.dumps({
            "mode": "hash-file" if hash_meta else "live",
            "hash_file": hash_meta,
            "roster_rows": len(rows),
            "cadets_checked": len(roster),
            "files_scanned": files_scanned,
            "hits": findings,
            "distinct_cadets": len({f["student_id"] for f in findings}),
            "distinct_files": len({f["file"] for f in findings}),
            "ok": not findings,
        }, indent=2))
        return EXIT_HIT if findings else EXIT_OK

    print(f"\nName scan · roster from {source}")
    print(f"{len(rows)} student rows · {len(roster)} real enrolled cadets · "
          f"{files_scanned} tracked files\n")

    if not findings:
        if hash_meta:
            print(f"PASS (hash file of {hash_meta['created']}, {hash_meta['count']} names) -- no "
                  "cadet in that file is named in a tracked file. A cadet added since is not covered.")
        else:
            print("PASS — no enrolled cadet's name appears in a tracked file.")
        return EXIT_OK

    by_file = {}
    for f in findings:
        by_file.setdefault(f["file"], []).append(f)
    for rel in sorted(by_file):
        print(f"  {rel}")
        for f in sorted(by_file[rel], key=lambda x: x["line"]):
            print(f"      :{f['line']:<6} cadet {f['student_id']}   {f['masked']}")
        print()

    print(f"FAIL — {len(findings)} line(s) name {len({f['student_id'] for f in findings})} "
          f"real cadet(s) across {len(by_file)} file(s).")
    print("Replace each name with that cadet's ID, or — in a test or example fixture — with a")
    print("synthetic name. Keep the ID: it is permitted, it is the join key, and it does not go")
    print("stale. See docs/decisions/STUDENT-DATA-CLASSIFICATION.md and CORE.md section 3.")
    return EXIT_HIT


if __name__ == "__main__":
    sys.exit(main())
