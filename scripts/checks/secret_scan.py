#!/usr/bin/env python3
"""secret_scan.py -- block credential-shaped content in tracked files.

Read-only. Standard library plus `git`. Scans every file `git ls-files` lists, so it checks
what a push would publish and nothing else (an ignored local config file is out of scope on
purpose: it is never committed).

Two checks:
  1. FILENAME  a tracked file whose name is a credential container (.env, .pem, .p8 ...).
               Templates and examples (*.template, *.example) and Markdown are exempt.
  2. CONTENT   a line holding a credential-shaped string (cloud and AI-provider keys, git
               host tokens, private-key headers, database URLs with a password, a signed
               JWT, a quoted assignment to a PASSWORD/SECRET/TOKEN/API_KEY style name).

It NEVER prints a matched value. A hit is reported as `path:line  rule-name` only.

Allowed on purpose:
  * Supabase PUBLISHABLE keys (`sb_publishable_...`) and anon-role JWTs. They ship to every
    browser by design and are protected by row-level security (site/js/config.js says so). The
    allowance is per RULE and per decoded role, not per file: a service-role JWT in
    config.js would still be a hit.
  * Any line carrying the marker `allowlist-secret` (a known false positive, such as a test
    fixture). Never put the marker on a real value.

Exit status: 0 clean, 1 at least one hit, 2 could not run (not a git repo).

Usage:
    python scripts/checks/secret_scan.py           # scan tracked files
    python scripts/checks/secret_scan.py --list    # print the rule names and exit
"""

import base64
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

MARKER = "allowlist-secret"

# Files over this size are skipped (generated bundles, data dumps). Reported, not hidden.
MAX_BYTES = 5 * 1024 * 1024

FILENAME_RULES = [
    ("credential-filename", re.compile(
        r"(^|/)(\.env(\..+)?|[^/]*\.env|[^/]*\.(p8|pem|key|p12|pfx|keystore|jks|mobileprovision)"
        r"|id_rsa|id_ed25519|[^/]*credentials\.json|config\.json)$")),
]
FILENAME_EXEMPT = re.compile(r"\.(template|example|md)$|\.env\.template$")

# (rule name, compiled regex). Order does not matter; each line reports each rule at most once.
CONTENT_RULES = [
    ("aws-access-key-id", re.compile(r"\b(AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("anthropic-api-key", re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}")),
    ("openai-style-key", re.compile(r"\bsk-[A-Za-z0-9]{32,}")),
    ("github-token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}")),
    ("github-fine-grained-token", re.compile(r"github_pat_[A-Za-z0-9_]{30,}")),
    ("slack-token", re.compile(r"xox[baprs]-[0-9A-Za-z]{8,}-[0-9A-Za-z-]{8,}")),
    ("google-api-key", re.compile(r"AIza[0-9A-Za-z_-]{35}")),
    ("private-key-block", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("supabase-secret-key", re.compile(r"\bsb_secret_[A-Za-z0-9_-]{16,}")),
    ("database-url-with-password", re.compile(r"postgres(ql)?://[^:/\s]+:[^@\s]+@")),
    ("quoted-secret-assignment", re.compile(
        r"(PASSWORD|SECRET_KEY|AUTH_TOKEN|ACCESS_TOKEN|API_KEY|PRIVATE_KEY|SERVICE_KEY)[A-Z_]*"
        r"\s*[=:]\s*[\"'][^\"'\s]{12,}[\"']")),
]
# SHA-256 of exact matched values known to be synthetic test fixtures (stored as hashes so the
# fixture value is not repeated here). Add a hash only for a value proven fake.
KNOWN_SYNTHETIC_SHA256 = {
    # the invented API-key placeholder used by tests/browser-harness (documented in docs/ROADMAP.md)
    "7068e481ca88f0928e145af60d83ccfb89214b0e8145160f5a8ced9b1e6a8437",
}
JWT = re.compile(r"eyJ[A-Za-z0-9_-]{15,}\.([A-Za-z0-9_-]{15,})\.[A-Za-z0-9_-]{10,}")
# Note: `sb_publishable_...` keys match no rule above, by design -- the allowance is the
# absence of a rule for that shape, not a skip of the file that holds it.


def jwt_role(payload_b64: str):
    """Decoded `role` claim of a JWT payload, or None if it will not decode."""
    try:
        pad = "=" * (-len(payload_b64) % 4)
        return json.loads(base64.urlsafe_b64decode(payload_b64 + pad)).get("role")
    except Exception:
        return None


def scan_line(line: str):
    """Rule names that fire on one line. Pure, so the tests can drive it directly."""
    if MARKER in line:
        return []
    hits = []
    for name, rx in CONTENT_RULES:
        for m in rx.finditer(line):
            if hashlib.sha256(m.group(0).encode()).hexdigest() in KNOWN_SYNTHETIC_SHA256:
                continue
            hits.append(name)
            break
    for m in JWT.finditer(line):
        if jwt_role(m.group(1)) != "anon":   # an anon-role JWT is the public client key
            hits.append("jwt-non-anon")
            break
    return hits


def scan_name(path: str):
    if FILENAME_EXEMPT.search(path):
        return []
    return [name for name, rx in FILENAME_RULES if rx.search(path)]


def tracked_files(root: Path):
    r = subprocess.run(["git", "ls-files", "-z"], cwd=root, capture_output=True)
    if r.returncode != 0:
        return None
    return [p for p in r.stdout.decode("utf-8", "surrogateescape").split("\0") if p]


def scan_tree(root: Path):
    """Return (hits, skipped). hits is a list of (path, line_or_0, rule)."""
    files = tracked_files(root)
    if files is None:
        return None, []
    hits, skipped = [], []
    for rel in files:
        for rule in scan_name(rel):
            hits.append((rel, 0, rule))
        p = root / rel
        try:
            if not p.is_file():
                continue
            if p.stat().st_size > MAX_BYTES:
                skipped.append(rel)
                continue
            data = p.read_bytes()
        except OSError:
            continue
        if b"\0" in data[:8192]:
            continue  # binary
        text = data.decode("utf-8", "replace")
        for n, line in enumerate(text.splitlines(), 1):
            for rule in scan_line(line):
                hits.append((rel, n, rule))
    return hits, skipped


def main(argv):
    if "--list" in argv:
        for name, _ in FILENAME_RULES + CONTENT_RULES:
            print(name)
        print("jwt-non-anon")
        return 0
    root = Path(__file__).resolve().parents[2]
    hits, skipped = scan_tree(root)
    if hits is None:
        print("secret_scan: not a git work tree; cannot list tracked files", file=sys.stderr)
        return 2
    for rel, n, rule in hits:
        where = f"{rel}:{n}" if n else rel
        print(f"HIT  {where}  {rule}")
    for rel in skipped:
        print(f"NOTE {rel}  skipped (over {MAX_BYTES // (1024 * 1024)} MB)")
    if hits:
        print(f"\nsecret_scan: {len(hits)} hit(s). Values are never printed. Remove the value, or "
              f"mark a known false positive with '{MARKER}' on its line.")
        return 1
    print("secret_scan: clean")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
