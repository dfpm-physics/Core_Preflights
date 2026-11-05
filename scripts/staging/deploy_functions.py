#!/usr/bin/env python3
"""Deploy the edge functions to the STAGING Supabase project through the Management API.

No CLI and no container runtime are needed: the API bundles the source on the server.
Dry-run by default; --commit deploys. Standard library only.

    POST https://api.supabase.com/v1/projects/{ref}/functions/deploy?slug=<name>
         multipart/form-data: a `metadata` JSON part and one or more `file` parts
    GET  https://api.supabase.com/v1/projects/{ref}/functions        (used by --verify)

The public reference page for the deploy call does not document the metadata keys or the file
part naming. This script sends the shape the Supabase CLI sends (metadata: name, entrypoint_path,
verify_jwt; file parts named `file` whose filename is the path inside the function). That shape is
unproven until the first --commit; a rejection prints the server's status and body.

Environment (never printed):
    SUPABASE_ACCESS_TOKEN   personal access token, scope edge_functions:write
    STAGING_PROJECT_REF     the project ref being deployed to

Safety:
  * STAGING_PROJECT_REF must equal the staging ref constant in this file, and --expect-ref must
    equal it too. Any other project, including a well-formed ref of some unknown project, is refused.
  * The production ref is refused always, whatever else is passed.
  * Only the allow-listed functions deploy. The two AI proxy functions are refused by name.
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

API = "https://api.supabase.com"
PRODUCTION_REF = "shzvpmlnqfmzfmuxkowi"
STAGING_REF = "wkibeptktbnaddfynrwr"  # the only project this tool deploys to
FUNCTIONS_DIR = Path(__file__).resolve().parents[2] / "supabase" / "functions"

# slug -> verify_jwt. The pages that call log-tutor-error are standalone and send the public
# publishable key, which is not a JWT, so the gateway must not check one. The function validates
# and whitelists its own payload. Every other function needs a signed-in caller and checks it too.
DEPLOYABLE = {
    "create-instructor": True,
    "remove-instructor": True,
    "reset-staff-password": True,
    "reset-student-password": True,
    "set-own-password": True,
    "provision-students": True,
    "log-tutor-error": False,
    # Stage E: both take a signed-in caller's token and check it themselves. Deploy after migrations 070 to 075.
    "check-answer": True,
    "remark-question": True,
}
REFUSED = {"genai-mil-proxy", "asksage-proxy"}

IMPORT_RE = re.compile(r"""(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)""")


class Refusal(Exception):
    pass


def check_ref(ref, expect):
    if not ref or not re.fullmatch(r"[a-z0-9]{20}", ref):
        raise Refusal("STAGING_PROJECT_REF is missing or not a 20-character project ref")
    if ref == PRODUCTION_REF or expect == PRODUCTION_REF:
        raise Refusal("refusing: that is the production project")
    if not expect:
        raise Refusal("--expect-ref is required")
    if ref != expect:
        raise Refusal("refusing: STAGING_PROJECT_REF does not equal --expect-ref")
    if ref != STAGING_REF:
        raise Refusal("refusing: this tool deploys to the staging project only")


def choose(only):
    names = list(DEPLOYABLE) if not only else only
    for n in names:
        if n in REFUSED:
            raise Refusal(f"refusing {n}: the AI proxy functions are gated and never deployed by this tool")
        if n not in DEPLOYABLE:
            raise Refusal(f"refusing {n}: not in the deploy list")
    return names


def collect_files(slug, root=FUNCTIONS_DIR):
    """Return [(relative_name, bytes)]: index.ts plus local imports inside the function folder.
    A relative import that leaves the function folder is refused."""
    fdir = root / slug
    entry = fdir / "index.ts"
    if not entry.is_file():
        raise Refusal(f"{slug}: no index.ts")
    seen, queue, out = set(), [entry], []
    while queue:
        p = queue.pop()
        if p in seen:
            continue
        seen.add(p)
        data = p.read_bytes()
        out.append((p.relative_to(fdir).as_posix(), data))
        text = data.decode("utf-8", "replace")
        for m in IMPORT_RE.finditer(text):
            spec = m.group(1) or m.group(2)
            if spec.startswith("."):
                target = (p.parent / spec).resolve()
                try:
                    target.relative_to(fdir.resolve())
                except ValueError:
                    raise Refusal(f"{slug}: import '{spec}' leaves the function folder")
                if not target.is_file():
                    raise Refusal(f"{slug}: import '{spec}' not found")
                queue.append(target)
    out.sort(key=lambda t: (t[0] != "index.ts", t[0]))
    return out


def build_multipart(slug, verify_jwt, files, boundary=None):
    boundary = boundary or uuid.uuid4().hex
    meta = json.dumps({"name": slug, "entrypoint_path": "index.ts", "verify_jwt": verify_jwt})
    parts = [
        f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n'
        f"Content-Type: application/json\r\n\r\n{meta}\r\n".encode()
    ]
    for name, data in files:
        parts.append(
            (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n'
             f"Content-Type: application/octet-stream\r\n\r\n").encode() + data + b"\r\n"
        )
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def urllib_transport(method, url, headers, body):
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def main(argv=None, env=None, transport=None, out=print):
    env = os.environ if env is None else env
    transport = transport or urllib_transport
    ap = argparse.ArgumentParser(description="Deploy edge functions to staging (dry run by default)")
    ap.add_argument("--expect-ref", required=True, help="must equal STAGING_PROJECT_REF")
    ap.add_argument("--only", nargs="*", help="deploy a subset by slug")
    ap.add_argument("--commit", action="store_true", help="actually deploy (default is a dry run)")
    ap.add_argument("--verify", action="store_true", help="list deployed functions and compare")
    a = ap.parse_args(argv)
    try:
        ref = env.get("STAGING_PROJECT_REF", "")
        check_ref(ref, a.expect_ref)
        names = choose(a.only)
        plans = [(n, DEPLOYABLE[n], collect_files(n)) for n in names]
    except Refusal as e:
        out(f"REFUSED: {e}")
        return 2
    token = env.get("SUPABASE_ACCESS_TOKEN", "")
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    out(f"Target project: {ref} (staging). Mode: {'COMMIT' if a.commit else 'dry run'}")
    for n, vj, files in plans:
        out(f"  {n}: verify_jwt={str(vj).lower()} files={[f for f, _ in files]}")
    failures = 0
    if a.commit:
        if not token:
            out("FAILED: SUPABASE_ACCESS_TOKEN is not set")
            return 1
        for n, vj, files in plans:
            body, ctype = build_multipart(n, vj, files)
            h = dict(headers, **{"Content-Type": ctype})
            status, resp = transport("POST", f"{API}/v1/projects/{ref}/functions/deploy?slug={n}", h, body)
            if 200 <= status < 300:
                out(f"  deployed {n} (HTTP {status})")
            else:
                failures += 1
                out(f"  FAILED {n}: HTTP {status} {resp[:300].decode('utf-8', 'replace')}")
    if a.verify:
        if not token:
            out("FAILED: SUPABASE_ACCESS_TOKEN is not set")
            return 1
        status, resp = transport("GET", f"{API}/v1/projects/{ref}/functions", headers, None)
        if status != 200:
            out(f"  FAILED list: HTTP {status}")
            return 1
        live = {f["slug"]: f for f in json.loads(resp)}
        for n, vj, _ in plans:
            f = live.get(n)
            if not f:
                failures += 1
                out(f"  MISSING {n}")
            elif f.get("status") != "ACTIVE" or f.get("verify_jwt") != vj:
                failures += 1
                out(f"  MISMATCH {n}: status={f.get('status')} verify_jwt={f.get('verify_jwt')}")
            else:
                out(f"  ok {n} version={f.get('version')}")
        extra = sorted(set(live) & REFUSED)
        if extra:
            out(f"  note: gated proxies present on staging: {extra}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
