#!/usr/bin/env python3
"""Find cadets whose ROSTER email no longer matches the address they actually sign in with.

WHY THIS EXISTS
    A cadet's sign-in address lives in Supabase Auth. `app.students.email` is a copy of it, and
    the two are only ever written together at provisioning time (`provision-students`). A later
    roster import updates `students.email` alone — Auth is a different service and no trigger
    reaches it — so the two silently diverge.

    Nothing reports the divergence, and the failure it produces points at the wrong thing:
    Supabase returns the same "Invalid login credentials" for an unknown address as for a wrong
    password. So the cadet reports a PASSWORD problem, a director resets the password, the reset
    works perfectly, and the cadet still cannot get in. On 2026-08-14 one phys-215 cadet had been
    locked out this way since provisioning and had been granted two deadline extensions for
    "access issues" — both of which expired while the real fault went unaddressed.

THE TWO CASES ARE OPPOSITE, WHICH IS WHY THIS DOES NOT BULK-FIX
    never signed in   The roster address is the one they will try, and the Auth address is a
                      credential nobody is using. Syncing Auth to the roster costs nothing.
    has signed in     They have FOUND the working address and are using it. Syncing Auth to the
                      roster LOCKS THEM OUT of an account that works today. That is a
                      notify-first change, not a repair, and --fix refuses it without --force.

    A sweep that "corrects" every mismatch would therefore break the working accounts to fix the
    broken ones. The scan reports both; only a human picks.

WHAT IT DOES NOT CHECK
    Whether the ROSTER address is the correct one. It assumes the newer registrar import is
    authoritative, which is the usual case but not a guaranteed one — a surname change can land
    in Auth first. Read the pair before fixing.

EXIT CODES
    0  every provisioned cadet's two addresses agree
    1  at least one mismatch — a human must decide per cadet
    2  could not run (credentials, network)

Usage:
  python scripts/checks/auth_email_mismatch.py                       # scan, read-only
  python scripts/checks/auth_email_mismatch.py --fix 3000127797      # dry run of one repair
  python scripts/checks/auth_email_mismatch.py --fix 3000127797 --commit

PRIVACY: this prints cadet names and email addresses to the CONSOLE so an operator can act on
them. Console output is not a committed file and must not become one — no name, cadet ID or
address from this script may be pasted into CHANGELOG.md or anything under docs/ (CORE.md §3).
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

CONFIG_PATH = os.path.expanduser("~/.claude/skills/preflight-analyze/config.json")
PAGE = 1000

SUPA_URL = None
HEADERS = {}


def load_config():
    global SUPA_URL, HEADERS
    try:
        with open(CONFIG_PATH) as f:
            cfg = json.load(f)
        SUPA_URL = cfg["supabase_url"].rstrip("/")
        key = cfg["supabase_service_key"]
    except (OSError, KeyError, ValueError) as exc:
        print(f"Could not read Supabase credentials from {CONFIG_PATH}: {exc}\n"
              "Run /setup-preflight, or copy "
              ".ai/skills/preflight-analyze/config.json.template.", file=sys.stderr)
        sys.exit(2)
    HEADERS = {"apikey": key, "Authorization": f"Bearer {key}"}


def call(url, method="GET", body=None, extra=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    for k, v in {**HEADERS, **(extra or {})}.items():
        req.add_header(k, v)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        print(f"HTTP {exc.code} on {method} {url}\n{exc.read().decode()}", file=sys.stderr)
        sys.exit(2)
    except urllib.error.URLError as exc:
        print(f"Could not reach Supabase: {exc}", file=sys.stderr)
        sys.exit(2)


def rest(path, params):
    """GET against schema `app`, PAGED. PostgREST caps a response at 1000 rows whatever
    `limit` says, and the roster is larger than that."""
    out, offset = [], 0
    while True:
        p = dict(params, limit=PAGE, offset=offset)
        batch = call(f"{SUPA_URL}/rest/v1/{path}?{urllib.parse.urlencode(p)}",
                     extra={"Accept-Profile": "app"})
        out += batch
        if len(batch) < PAGE:
            return out
        offset += PAGE


def auth_users():
    """Every Auth user, keyed by id. Also paged — this list is larger than the roster."""
    users, page = {}, 1
    while True:
        d = call(f"{SUPA_URL}/auth/v1/admin/users?page={page}&per_page={PAGE}")
        batch = d.get("users", [])
        for u in batch:
            users[u["id"]] = u
        if len(batch) < PAGE:
            return users
        page += 1


def norm(addr):
    return (addr or "").strip().lower()


def scan():
    users = auth_users()
    roster = rest("students", {"select": "student_id,name,email,auth_user_id"})
    rows = []
    for s in roster:
        u = users.get(s["auth_user_id"]) if s["auth_user_id"] else None
        if not u or not s["email"]:
            continue  # unprovisioned, or no roster address to compare against — a separate check
        if norm(s["email"]) != norm(u.get("email")):
            rows.append({
                "student_id": s["student_id"],
                "name": s["name"],
                "roster_email": s["email"],
                "auth_email": u.get("email"),
                "auth_user_id": u["id"],
                "last_sign_in_at": u.get("last_sign_in_at"),
            })
    taken = {norm(u.get("email")) for u in users.values()}
    return sorted(rows, key=lambda r: r["name"]), taken


def report(rows):
    if not rows:
        print("No mismatches — every provisioned cadet's roster address is their sign-in address.")
        return
    safe = [r for r in rows if not r["last_sign_in_at"]]
    live = [r for r in rows if r["last_sign_in_at"]]

    if safe:
        print(f"\n=== LOCKED OUT — never signed in ({len(safe)}) "
              "— syncing Auth to the roster is safe ===")
        for r in safe:
            print(f'  {r["student_id"]}  {r["name"]}')
            print(f'      roster : {r["roster_email"]}')
            print(f'      auth   : {r["auth_email"]}')
    if live:
        print(f"\n=== WORKING on the Auth address ({len(live)}) "
              "— syncing would LOCK THEM OUT; notify first ===")
        for r in live:
            print(f'  {r["student_id"]}  {r["name"]}   (last sign-in {r["last_sign_in_at"][:10]})')
            print(f'      roster : {r["roster_email"]}')
            print(f'      auth   : {r["auth_email"]}')
    print(f"\n{len(rows)} mismatch(es). Repair one with:  --fix <student_id> --commit")


def fix(rows, taken, student_id, commit, force):
    match = [r for r in rows if r["student_id"] == student_id]
    if not match:
        print(f"{student_id}: no mismatch — nothing to fix. (Already synced, unprovisioned, "
              "or not on the roster.)")
        return 0
    r = match[0]

    if norm(r["roster_email"]) in taken:
        print(f'REFUSING: another Auth account already holds {r["roster_email"]}. '
              "Two accounts cannot share an address — resolve the duplicate first.")
        return 1
    if r["last_sign_in_at"] and not force:
        print(f'REFUSING: {r["name"]} last signed in {r["last_sign_in_at"][:10]} using '
              f'{r["auth_email"]}. Changing it locks them out of an account that works today.\n'
              "Tell them the new address first, then re-run with --force.")
        return 1

    print(f'{r["student_id"]}  {r["name"]}')
    print(f'    {r["auth_email"]}  ->  {r["roster_email"]}')
    if not commit:
        print("\nDRY RUN — nothing written. Re-run with --commit to apply.")
        return 0

    # email_confirm marks the new address verified in the same call. PREP has no SMTP, so an
    # unconfirmed change would leave the account pending on a mail nobody can send or receive.
    call(f'{SUPA_URL}/auth/v1/admin/users/{r["auth_user_id"]}', method="PUT",
         body={"email": r["roster_email"], "email_confirm": True})

    # Read back from Auth rather than trusting the PUT response.
    after = call(f'{SUPA_URL}/auth/v1/admin/users/{r["auth_user_id"]}')
    if norm(after.get("email")) != norm(r["roster_email"]):
        print(f'  !! read-back says {after.get("email")} — the change did not take.',
              file=sys.stderr)
        return 2
    print(f'  written and verified: sign-in address is now {after.get("email")}')
    if after.get("app_metadata", {}).get("must_change_password"):
        print("  still flagged must_change_password — the password is unchanged (the "
              "provisioned default) and they will be asked to set their own on first sign-in.")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--fix", type=int, metavar="STUDENT_ID",
                    help="sync one cadet's Auth address to their roster address")
    ap.add_argument("--commit", action="store_true", help="actually write (default: dry run)")
    ap.add_argument("--force", action="store_true",
                    help="allow --fix on a cadet who HAS signed in (locks them out; notify first)")
    args = ap.parse_args()

    load_config()
    rows, taken = scan()

    if args.fix:
        sys.exit(fix(rows, taken, args.fix, args.commit, args.force))
    report(rows)
    sys.exit(1 if rows else 0)


if __name__ == "__main__":
    main()
