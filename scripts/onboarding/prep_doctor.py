#!/usr/bin/env python
"""What can this machine actually do? A per-capability readiness report for a PREP operator.

Setup here is not one thing you either have or lack. It is several independent credentials on
different transports feeding different jobs, and the useful question on a new machine is never
"am I set up" but "can I close out tomorrow's lesson." Those have different answers: running the
cohort rollup needs one file and no downloads, while grading needs a service key and ~968 MB of
textbook PDFs. Somebody who only needs the first should not be reading a runbook about the second.

So this reports CAPABILITIES, each with the specific thing blocking it and the specific command
that fixes it — rather than a pass/fail on a setup checklist.

STDLIB ONLY, and it runs with plain `python` on a machine where nothing is installed yet. That is
the whole point: the report has to work BEFORE the venv exists, so it shells out to the venv
interpreter for anything needing psycopg2 rather than importing it here.

Read-only. Touches no table, writes no file, and never prints the value of any credential —
only whether one is present.

Usage:
  python scripts/onboarding/prep_doctor.py
  python scripts/onboarding/prep_doctor.py --json
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

try:                                    # cp1252 consoles are the norm on a fresh
    sys.stdout.reconfigure(encoding="utf-8")   # Windows machine, and this is the
except Exception:                       # first thing anyone runs on one.
    pass

REPO = Path(__file__).resolve().parents[2]
ANALYZE_CFG = Path(os.path.expanduser("~/.claude/skills/preflight-analyze/config.json"))
ADMIN_ENV = REPO / "supabase" / "admin" / ".env"
ADMIN_CFG = REPO / "supabase" / "admin" / "config.json"

OK, NO, MEH = "ok", "no", "warn"
MARK = {OK: "  OK  ", NO: "BLOCKED", MEH: " WARN "}


def venv_python():
    for rel in ("Scripts/python.exe", "bin/python"):
        p = REPO / ".venv" / rel
        if p.is_file():
            return p
    return None


def run(cmd, timeout=90):
    """Return (returncode, stdout+stderr). Never raises."""
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                           cwd=str(REPO), encoding="utf-8", errors="replace")
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except FileNotFoundError:
        return 127, "not found"
    except subprocess.TimeoutExpired:
        return 124, f"timed out after {timeout}s"
    except Exception as e:                                          # noqa: BLE001
        return 1, f"{type(e).__name__}: {e}"


def read_env(path):
    """Parse KEY=VALUE. Returns {key: bool(value)} — presence only, never the value."""
    out = {}
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip().strip('"').strip("'")
            out[k.strip()] = bool(v)
    except Exception:                                               # noqa: BLE001
        pass
    return out


# ── individual facts ───────────────────────────────────────────────────────────────────
def fact_python():
    v = sys.version_info
    ok = (v.major, v.minor) >= (3, 11)
    return (OK if ok else NO, f"Python {v.major}.{v.minor}.{v.micro}",
            "" if ok else "3.11+ needed (zoneinfo). Install a current Python.")


def fact_venv():
    p = venv_python()
    if not p:
        return NO, "no .venv", "python -m venv .venv && .venv\\Scripts\\python -m pip install -r requirements.txt"
    rc, out = run([str(p), "-c", "import psycopg2;print(psycopg2.__version__.split()[0])"])
    if rc != 0:
        return NO, ".venv present, psycopg2 missing", ".venv\\Scripts\\python -m pip install -r requirements.txt"
    return OK, f".venv + psycopg2 {out.strip()}", ""


def fact_admin_env():
    if not ADMIN_ENV.is_file():
        return NO, "supabase/admin/.env absent", \
            "Ask the course director for it. Template: supabase/admin/.env.template"
    env = read_env(ADMIN_ENV)
    need = ["PREP_DB_HOST", "PREP_PROJECT_REF", "PREP_APP_DML_ROLE", "PREP_APP_DML_PASSWORD"]
    missing = [k for k in need if not env.get(k)]
    if missing:
        return NO, f".env missing {', '.join(missing)}", "Ask the course director for a complete file."
    extra = "" if env.get("PREP_APP_READ_ROLE") else "  (no read tier — some tests will skip)"
    return OK, f".env has the dml tier{extra}", ""


def fact_db():
    p = venv_python()
    if not p or not ADMIN_ENV.is_file():
        return NO, "needs .venv and supabase/admin/.env", "Fix those two first."
    probe = (
        "import sys;sys.path.insert(0,r'%s')\n"
        "from app_tier_check import load, connect\n"
        "cfg,t=load()\n"
        "c=connect(cfg,t['dml']);cur=c.cursor()\n"
        "cur.execute(\"select count(*) from app.assignment_offerings\")\n"
        "print('rows',cur.fetchone()[0]);c.close()\n" % (REPO / "supabase" / "admin")
    )
    rc, out = run([str(p), "-c", probe])
    if rc != 0:
        hint = ("The Session pooler host is required — a direct db.<ref>.supabase.co host is "
                "IPv6-only and will not resolve." if "could not translate" in out or "resolve" in out
                else "If the project is paused, unpause it in the Supabase dashboard.")
        return NO, "cannot connect as prep_app_dml", hint
    return OK, f"connected as prep_app_dml ({out.strip()})", ""


def fact_analyze_cfg():
    if not ANALYZE_CFG.is_file():
        return NO, f"{ANALYZE_CFG} absent", "Run /setup-preflight, or copy .ai/skills/preflight-analyze/config.json.template"
    try:
        cfg = json.loads(ANALYZE_CFG.read_text(encoding="utf-8"))
    except Exception as e:                                          # noqa: BLE001
        return NO, f"config.json unreadable ({type(e).__name__})", "Fix the JSON syntax."
    missing = [k for k in ("supabase_url", "supabase_service_key", "textbook_base_path",
                           "default_course_id") if not cfg.get(k)]
    if missing:
        return NO, f"config.json missing {', '.join(missing)}", \
            "Service key: Supabase dashboard -> Project Settings -> API -> service_role."
    base = Path(cfg["textbook_base_path"])
    if not (base / "Text_Book_PDFs").is_dir():
        return MEH, "config present, textbook_base_path has no Text_Book_PDFs/", \
            "It must point at a folder CONTAINING Text_Book_PDFs/, not at the clone's textbook-pdfs/."
    return OK, "service-role config present", ""


def fact_grounding():
    script = REPO / "scripts" / "grounding" / "check_grounding.py"
    if not script.is_file():
        return MEH, "check_grounding.py absent", ""
    if not ANALYZE_CFG.is_file():
        return NO, "cannot check — no service-role config", "Set that up first."
    rc, out = run([sys.executable, str(script)])
    last = [ln for ln in out.strip().splitlines() if ln.strip()]
    summary = last[-1][:70] if last else "no output"
    if rc == 0:
        return OK, summary, ""
    return NO, summary, ("Grading will run WITHOUT textbook grounding and warn only once. "
                         "See textbook-pdfs/README.md.")


def fact_admin_cfg():
    if not ADMIN_CFG.is_file():
        return NO, "supabase/admin/config.json absent", \
            "Ask the course director. Template: supabase/admin/config.json.template"
    try:
        cfg = json.loads(ADMIN_CFG.read_text(encoding="utf-8"))
    except Exception:                                               # noqa: BLE001
        return NO, "config.json unreadable", "Fix the JSON syntax."
    missing = [k for k in ("host", "user", "password") if not cfg.get(k)]
    return (NO, f"config.json missing {', '.join(missing)}", "") if missing else \
           (OK, "claude_code_recker config present", "")


def fact_git():
    if not shutil.which("git"):
        return NO, "git not on PATH", "Install git."
    rc, branch = run(["git", "rev-parse", "--abbrev-ref", "HEAD"])
    rc2, dirty = run(["git", "status", "--porcelain"])
    branch = branch.strip()
    if dirty.strip():
        n = len(dirty.strip().splitlines())
        return MEH, f"on {branch}, {n} uncommitted change(s)", \
            "The lesson cycle refuses to run on a dirty tree (CORE.md coordination gate)."
    return OK, f"on {branch}, clean", ""


def fact_remote():
    if not shutil.which("git"):
        return NO, "git not on PATH", ""
    rc, out = run(["git", "ls-remote", "--exit-code", "origin", "HEAD"], timeout=45)
    if rc != 0:
        return NO, "cannot reach origin", "Check the GitHub credential helper; push access is needed to publish."
    rc2, counts = run(["git", "rev-list", "--left-right", "--count", "origin/main...HEAD"])
    behind, ahead = (counts.split() + ["?", "?"])[:2] if rc2 == 0 else ("?", "?")
    if behind not in ("0", "?") :
        return MEH, f"origin reachable; {behind} behind, {ahead} ahead", "git pull before doing anything."
    return OK, f"origin reachable; {behind} behind, {ahead} ahead", ""


def fact_node():
    exe = shutil.which("node") or (r"C:\Program Files\nodejs\node.exe"
                                   if Path(r"C:\Program Files\nodejs\node.exe").is_file() else None)
    if not exe:
        return MEH, "node absent (optional)", "Nothing on the deploy path needs it."
    rc, out = run([exe, "--version"])
    return OK, f"node {out.strip()} (optional harnesses)", ""


# ── capabilities, composed from those facts ────────────────────────────────────────────
FACTS = {
    "python": fact_python, "venv": fact_venv, "admin_env": fact_admin_env, "db": fact_db,
    "analyze_cfg": fact_analyze_cfg, "grounding": fact_grounding, "admin_cfg": fact_admin_cfg,
    "git": fact_git, "remote": fact_remote, "node": fact_node,
}

CAPABILITIES = [
    ("/lesson-aggregate  - cohort rollup", ["python", "venv", "admin_env", "db"],
     "The light path. No service key, no PDF download."),
    ("/preflight-analyze - grade written work", ["python", "analyze_cfg", "grounding"],
     "Needs the service key and the textbook corpus."),
    ("/lesson-cycle      - grade, then aggregate",
     ["python", "venv", "admin_env", "db", "analyze_cfg", "grounding", "git"],
     "Both of the above, plus a clean tree."),
    ("/interaction-backfill", ["python", "venv", "admin_cfg"], "Repairs interactive reports."),
    ("publish to the live site", ["git", "remote"], "Pushing main rebuilds Pages in 1-2 min."),
]


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--json", action="store_true", help="machine-readable")
    args = ap.parse_args()

    results = {}
    for name, fn in FACTS.items():
        try:
            results[name] = fn()
        except Exception as e:                                      # noqa: BLE001
            results[name] = (NO, f"check itself failed: {type(e).__name__}", "")

    caps = []
    for label, needs, note in CAPABILITIES:
        blockers = [n for n in needs if results[n][0] == NO]
        warns = [n for n in needs if results[n][0] == MEH]
        state = NO if blockers else (MEH if warns else OK)
        caps.append({"capability": label, "state": state, "note": note,
                     "blocked_by": blockers, "warnings": warns})

    if args.json:
        print(json.dumps({
            "facts": {k: {"state": v[0], "detail": v[1], "fix": v[2]} for k, v in results.items()},
            "capabilities": caps}, indent=2))
        return 0 if all(c["state"] != NO for c in caps) else 1

    print("\nPREP machine readiness\n" + "=" * 74)
    print("\nWHAT THIS MACHINE CAN DO")
    for c in caps:
        print(f"  [{MARK[c['state']]}]  {c['capability']}")
        if c["blocked_by"]:
            print(f"             blocked by: {', '.join(c['blocked_by'])}")
        elif c["state"] == MEH:
            print(f"             check: {', '.join(c['warnings'])}")

    print("\nDETAIL")
    for name, (state, detail, fix) in results.items():
        print(f"  [{MARK[state]}]  {name:12} {detail}")
        if fix and state != OK:
            print(f"             -> {fix}")

    todo = [(n, r) for n, r in results.items() if r[0] == NO and r[2]]
    if todo:
        print("\nNEXT STEPS, in order")
        for i, (name, (_, _, fix)) in enumerate(todo, 1):
            print(f"  {i}. ({name}) {fix}")
    else:
        print("\nNothing blocking. Read the SKILL.md before a first live run.")

    print("\nFull setup runbook: docs/operations/MACHINE-SETUP.md")
    print("Aggregation-only quickstart: docs/operations/ONBOARD-AGGREGATION.md\n")
    return 0 if all(c["state"] != NO for c in caps) else 1


if __name__ == "__main__":
    sys.exit(main())
