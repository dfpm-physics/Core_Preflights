#!/usr/bin/env python3
"""Offline checks for secret_scan.py -- NO NETWORK, NO CREDENTIALS, NO REAL VALUES.

Every credential-shaped string below is assembled at runtime from fragments, so this file does
not itself contain one and does not trip the scan it tests. The values are invented filler.

What is asserted:
  * each rule fires on a planted string (the failing path is exercised, not assumed)
  * the public Supabase client keys stay silent (publishable key; anon-role JWT)
  * a service-role JWT, which is the dangerous twin of the anon one, fires
  * the allowlist marker silences a line
  * hits print path, line and rule name -- never the value
  * a tracked credential-named file is caught and a template is not, over a throwaway git repo

Usage:  python scripts/checks/secret_scan_test.py
"""

import base64
import importlib.util
import io
import json
import subprocess
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("secret_scan", HERE / "secret_scan.py")
S = importlib.util.module_from_spec(spec)
spec.loader.exec_module(S)

PASSED = FAILED = 0


def check(desc, ok):
    global PASSED, FAILED
    if ok:
        PASSED += 1
        print(f"  [pass] {desc}")
    else:
        FAILED += 1
        print(f"  [FAIL] {desc}")


def b64(obj):
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")


def jwt(role):
    return "eyJ" + "hbGciOiJIUzI1NiJ9" + "." + b64({"role": role, "iss": "x"}) + "." + "A" * 20


FILL = "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"
planted = {
    "aws-access-key-id": "AK" + "IA" + "ABCDEFGHIJKLMNOP",
    "anthropic-api-key": "sk-" + "ant-" + FILL,
    "openai-style-key": "sk-" + FILL,
    "github-token": "gh" + "p_" + FILL,
    "github-fine-grained-token": "github" + "_pat_" + FILL,
    "slack-token": "xo" + "xb-12345678-abcdefgh1234",
    "google-api-key": "AI" + "za" + FILL[:35],
    "private-key-block": "-----BEGIN " + "RSA PRIVATE KEY-----",
    "supabase-secret-key": "sb_" + "secret_" + FILL,
    "database-url-with-password": "post" + "gres://admin:" + "hunter2hunter2" + "@db.example.test/x",
    "quoted-secret-assignment": "API" + "_KEY = '" + FILL + "'",
    "jwt-non-anon": "token = " + jwt("service_role"),
}

print("\n=== each rule fires on a planted value ===")
for rule, line in planted.items():
    check(f"{rule} fires", rule in S.scan_line(line))

print("\n=== public-by-design values stay silent ===")
check("publishable key is allowed", S.scan_line("const K = 'sb_" + "publishable_" + FILL + "';") == [])
check("anon-role JWT is allowed", S.scan_line("const K = '" + jwt("anon") + "';") == [])
check("service-role JWT is NOT allowed", S.scan_line("const K = '" + jwt("service_role") + "';") != [])
check("an undecodable JWT-shaped string is not waved through",
      "jwt-non-anon" in S.scan_line("eyJ" + "A" * 20 + "." + "B" * 20 + "." + "C" * 12))

print("\n=== the allowlist marker ===")
check("marker silences a hit", S.scan_line(planted["github-token"] + "  # allowlist-" + "secret") == [])
check("same line without marker still fires", S.scan_line(planted["github-token"]) != [])
check("ordinary prose is silent", S.scan_line("The key rotates every term; see the runbook.") == [])

print("\n=== filenames ===")
for bad in [".env", "supabase/admin/.env", "x/server.pem", "k.p8", "a/b/id_rsa",
            "supabase/admin/config.json", "creds/credentials.json"]:
    check(f"credential filename flagged: {bad}", S.scan_name(bad) != [])
for ok in ["supabase/admin/.env.template", "supabase/admin/config.json.template",
           "notes/keys.md", "site/js/config.js", "a/b/readme.txt"]:
    check(f"not flagged: {ok}", S.scan_name(ok) == [])

print("\n=== over a throwaway git repo: output never carries the value ===")
with tempfile.TemporaryDirectory() as td:
    root = Path(td)
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    secret = planted["github-token"]
    (root / "leak.txt").write_text("line one\nx = " + secret + "\n", encoding="utf-8")
    (root / "fine.txt").write_text("nothing here\n", encoding="utf-8")
    (root / ".env").write_text("A=1\n", encoding="utf-8")
    (root / "ok.env.template").write_text("A=\n", encoding="utf-8")
    subprocess.run(["git", "add", "-f", "."], cwd=root, check=True)
    hits, _ = S.scan_tree(root)
    got = {(p, n, r) for p, n, r in hits}
    check("content hit has path, line 2 and rule", ("leak.txt", 2, "github-token") in got)
    check("tracked .env is flagged", (".env", 0, "credential-filename") in got)
    check("template is not flagged", not any(p == "ok.env.template" for p, _, _ in hits))
    check("clean file is not flagged", not any(p == "fine.txt" for p, _, _ in hits))
    # an untracked file is out of scope
    (root / "untracked.txt").write_text(secret + "\n", encoding="utf-8")
    hits2, _ = S.scan_tree(root)
    check("untracked file is out of scope", not any(p == "untracked.txt" for p, _, _ in hits2))
    # main() output
    buf = io.StringIO()
    real_file = S.__file__
    S.__file__ = str(root / "scripts" / "checks" / "secret_scan.py")  # parents[2] == root
    try:
        with redirect_stdout(buf):
            code = S.main([])
    finally:
        S.__file__ = real_file
    out = buf.getvalue()
    check("main exits 1 on hits", code == 1)
    check("output names the path and rule", "leak.txt:2" in out and "github-token" in out)
    check("output never contains the value", secret not in out and FILL[:12] not in out)

print(f"\n{PASSED} passed, {FAILED} failed")
sys.exit(1 if FAILED else 0)
