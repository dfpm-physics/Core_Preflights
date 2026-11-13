#!/usr/bin/env python3
"""The overnight AI grader for PREP. STAGING ONLY.

    overnight_grade.py setup   [--commit] [--offline] [--course C ...] [--grounding-root P]
    overnight_grade.py doctor
    overnight_grade.py plan    [--course C ...] [--as-of TS] [--window-hours N]
    overnight_grade.py run     [--course C ...] [--track M|T] [--lesson SLUG] [--trial N]
                               [--commit --expect-ref REF] [--scheduled] [--max-tracks N]
                               [--window-hours N] [--regrade] [--no-aggregate]
    overnight_grade.py models  [--role grade|aggregate]

Dry run is the default: no model call, no write, no run record. `--trial N` makes real model calls
for N students per track and prints to the console only. `--commit` writes draft grades (never
finalized) and cohort prose, and requires `--expect-ref wkibeptktbnaddfynrwr`.

Exit codes: 0 clean; 10 finished with something owed; 20 refused by a safety gate; 30 config or
credential problem; 40 GenAI.mil unusable; 50 database error; 75 another run holds the lock; 1 crash.
Read docs/operations/OVERNIGHT-GRADER.md first.
"""
import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from overnight import (EXIT_CONFIG, EXIT_CRASH, EXIT_DB, EXIT_LLM, EXIT_LOCKED, EXIT_OK, EXIT_PARTIAL,  # noqa: E402
                       EXIT_REFUSED)
from overnight import config as cfgmod  # noqa: E402
from overnight import cycle, grade_run as gr, grounding, llm  # noqa: E402
from overnight.config import Stop  # noqa: E402

MANIFEST = cfgmod.REPO_ROOT / "textbook-pdfs" / "rag-manifest.txt"
log = logging.getLogger("overnight")


def setup_logging(cfg, name="overnight"):
    cfg.state_dir.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(cfg.state_dir, 0o700)
    except OSError:
        pass
    day = datetime.now().strftime("%Y-%m-%d")
    path = cfg.state_dir / f"{name}-{day}.log"
    fh = logging.FileHandler(path, encoding="utf-8")
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    fh.setFormatter(fmt)
    sh = logging.StreamHandler(sys.stderr)
    sh.setFormatter(fmt)
    log.handlers[:] = [fh, sh]
    log.setLevel(logging.INFO)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return day


def audit_writer(cfg, day):
    """One JSON line per model call, with no content: for the key holder's own accounting."""
    path = cfg.state_dir / f"genai-calls-{day}.jsonl"

    def write(rec):
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps({"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), **rec}) + "\n")
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    return write


class RunLock:
    """flock on the state dir's run.lock. A second run exits 75 and touches nothing."""

    def __init__(self, state_dir):
        self.path = Path(state_dir) / "run.lock"
        self.fh = None

    def __enter__(self):
        try:
            import fcntl
        except ImportError:
            return self                                  # no fcntl (Windows): --commit is refused earlier
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.fh = open(self.path, "a+")
        try:
            fcntl.flock(self.fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise Stop(EXIT_LOCKED, "another overnight run holds the lock")
        self.fh.seek(0)
        self.fh.truncate()
        self.fh.write(f"pid {os.getpid()} started {datetime.now(timezone.utc).isoformat(timespec='seconds')}\n")
        self.fh.flush()
        return self

    def __exit__(self, *exc):
        if self.fh:
            self.fh.close()


def warn_key_lock(cfg):
    at = (cfg.genai or {}).get("locks_at")
    if not at:
        return
    try:
        t = datetime.fromisoformat(at.replace("Z", "+00:00"))
        t = t if t.tzinfo else t.replace(tzinfo=timezone.utc)
    except ValueError:
        return
    hours = (t - datetime.now(timezone.utc)).total_seconds() / 3600
    if hours < 48:
        log.warning("WARN genai-key-locks-in-%dh", max(0, int(hours)))


# ── subcommands ───────────────────────────────────────────────────────────────────────────
def courses_for(args, cfg, store=None):
    if getattr(args, "course", None):
        return args.course
    if cfg.courses:
        return cfg.courses
    return store.active_courses() if store else []


def cmd_setup(args):
    try:
        cfg = cfgmod.load_config(need_db=not args.offline, need_genai=False)
    except Stop:
        if not args.offline:
            raise
        cfg = cfgmod.Config()                            # offline setup works before any config file exists
    root = Path(args.grounding_root).expanduser() if args.grounding_root else cfg.grounding_root
    manifest = grounding.read_manifest(MANIFEST)
    courses = list(args.course or cfg.courses)
    if not courses and not args.offline:
        from overnight.store import PgStore
        courses = PgStore(cfg.db).active_courses()
    if not courses:
        raise Stop(EXIT_CONFIG, "no courses: pass --course or list them in config.json")
    print(f"Grounding root: {root}")
    for d in grounding.plan_tree(root, courses, manifest):
        print(("  exists  " if d.exists() else "  would create  " if not args.commit else "  create  ") + str(d))
    if args.commit:
        made = grounding.make_tree(root, courses, manifest)
        readme = Path(root) / "README.txt"
        if not readme.exists():
            readme.write_text("Grounding documents for the overnight grader. Per course: Text_Book_PDFs/<NNN> Sections/ holds the "
                              "PDFs (exact manifest names), text/<NNN> Sections/ holds extracted text, digests/ holds curated "
                              "key results with equations. Nothing secret belongs here.\n", encoding="utf-8")
        print(f"Created {len(made)} folder(s).")
    elif not args.commit:
        print("Dry run: nothing created. Re-run with --commit.")
    missing = 0
    for c in courses:
        rep = grounding.scan_course(root, c, manifest)
        print(f"\n{c} (manifest folder: {rep['number'] or 'none, digests only'})")
        print(f"  PDFs present {len(rep['pdfs_present'])}, missing {len(rep['pdfs_missing'])}")
        print(f"  text sidecars present {len(rep['text_present'])}, missing {len(rep['text_missing'])}")
        print(f"  digests present {len(rep['digests_present'])}, missing {len(rep['digests_missing'])}")
        for stem, pages in rep["suspect"].items():
            print(f"  equations probably missing from {stem}: pages {pages[:10]}")
        for n in rep["pdfs_missing"][:8]:
            print(f"    missing PDF: {n}")
        missing += len(rep["pdfs_missing"]) + len(rep["text_missing"]) if rep["number"] else 0
    print("\nMachine checks")
    cdir = cfgmod.config_dir()
    for name in ("config.json", "staging.env", "genai-mil.env"):
        p = cdir / name
        try:
            cfgmod.check_file(p)
            print(f"  ok       {name}")
        except Stop as exc:
            print(f"  PROBLEM  {exc}")
            missing += 1
    try:
        import fcntl  # noqa: F401
        print("  ok       fcntl (locking)")
    except ImportError:
        print("  PROBLEM  fcntl unavailable: this job must run on Linux to commit")
        missing += 1
    return EXIT_OK if not missing else EXIT_PARTIAL


def build_store(cfg, invoked_by):
    from overnight.store import PgStore
    return PgStore(cfg.db, invoked_by)


def cmd_doctor(args):
    cfg = cfgmod.load_config()
    print("ok  config, secret file modes and the staging-only wall")
    warn_key_lock(cfg)
    store = build_store(cfg, "human")
    print("ok  connected to staging as the DML tier")
    manifest = grounding.read_manifest(MANIFEST)
    for c in courses_for(args, cfg, store):
        rep = grounding.scan_course(cfg.grounding_root, c, manifest)
        print(f"{c}: PDFs {len(rep['pdfs_present'])}/{len(rep['pdfs_present']) + len(rep['pdfs_missing'])}, "
              f"text {len(rep['text_present'])}, digests {len(rep['digests_present'])}")
    store.close()
    return EXIT_OK


def make_runtime(cfg, client, models, audit, now=None):
    budget = llm.TokenBudget(cfg.nightly_token_cap)
    return gr.Runtime(client=client, models=models, budget=budget, cfg=cfg, manifest=grounding.read_manifest(MANIFEST),
                      audit=audit, log=log.info, sleep=time.sleep, pace_s=1.0, now=now,
                      max_run_s=cfg.max_run_minutes * 60)


def run_night(args, cfg, store, rt, *, commit, trial):
    now = rt.clock()
    results, skipped = [], []
    for course in courses_for(args, cfg, store):
        rows = store.worklist(course, args.as_of if getattr(args, "as_of", None) else None)
        chosen, skip = gr.select_tracks(rows, now, window_hours=args.window_hours or cfg.window_hours,
                                        min_age_minutes=cfg.min_age_minutes, max_tracks=None,
                                        only_lesson=getattr(args, "lesson", None), only_track=getattr(args, "track", None))
        skipped += [{**s, "course": course} for s in skip]
        if not chosen and commit:
            store.course_skip(course, "No tracks were due for overnight grading.", {"runner": "overnight_grade.py", "skipped": skip[:20]})
        for row in chosen:
            limit = args.max_tracks or cfg.max_tracks
            if sum(1 for x in results if x["status"] != "skipped") >= limit:
                skipped.append({"slug": row["slug"], "track": row["track"], "course": course,
                                "reason": f"over the nightly limit of {limit} tracks"})
                continue                                   # tracks that were already finished do not use a slot
            if rt.stop_reason():
                skipped.append({"slug": row["slug"], "track": row["track"], "course": course,
                                "reason": rt.stop_reason(), "owed": True})
                continue
            log.info("track %s %s: starting", row["slug"], row["track"])
            r = cycle.run_track(rt, store, row, commit=commit, trial=trial or 0, no_aggregate=getattr(args, "no_aggregate", False))
            results.append(r)
            log.info("track %s %s: %s", row["slug"], row["track"], r["status"])
            if rt.stop_reason():
                log.warning("run stopped: %s (tokens %s of %s)", rt.stop_reason(), rt.budget.used, rt.budget.cap)
    return results, skipped


def exit_for(results, skipped, rt=None):
    owed = any(r["status"] in ("partial", "failed") or r.get("detail", {}).get("stopped") or r.get("owed")
               or (r.get("aggregation") or {}).get("status") in ("partial", "failed") for r in results)
    owed = owed or any(s.get("owed") for s in skipped) or any(r.get("owed") for r in results if r["status"] == "skipped")
    return EXIT_PARTIAL if owed else EXIT_OK


def print_report(results, skipped):
    for r in results:
        line = f"{r['slug']} day {r['track']}: {r['status']}"
        if r["status"] == "plan":
            line += (f"; would grade {r['to_grade']}, zero {r['to_zero']}, waiting {r['waiting']}, stranded {r['stranded']}"
                     f"; grounding {r['grounding']}; about {r['estimated_tokens']:,} tokens")
        elif r.get("reason"):
            line += f" ({r['reason']})"
        print(line)
    for s in skipped:
        print(f"skipped {s['slug']} day {s['track']}: {s['reason']}")
    if not results and not skipped:
        print("Nothing is due.")


def cmd_plan(args):
    cfg = cfgmod.load_config(need_genai=False)
    setup_logging(cfg, "plan")
    store = build_store(cfg, "human")
    rt = make_runtime(cfg, llm.FakeClient(), {"grade": [], "aggregate": []}, None)
    results, skipped = run_night(args, cfg, store, rt, commit=False, trial=0)
    print_report(results, skipped)
    store.close()
    return EXIT_OK


def cmd_run(args):
    if args.commit and args.as_of:
        raise Stop(EXIT_REFUSED, "--as-of is for rehearsal and is refused with --commit")
    if args.regrade and args.scheduled:
        raise Stop(EXIT_REFUSED, "--regrade is for a person and is refused with --scheduled")
    if args.trial and (args.scheduled or args.commit):
        raise Stop(EXIT_REFUSED, "--trial prints to the console and writes nothing; it cannot be combined with --commit or --scheduled")
    if args.commit:
        cfgmod.check_expect_ref(args.expect_ref)
        if os.name != "posix":
            raise Stop(EXIT_REFUSED, "--commit is refused where fcntl locking is unavailable (this must run on Linux)")
    cfg = cfgmod.load_config(need_genai=bool(args.commit or args.trial))
    day = setup_logging(cfg, "overnight")
    state = RunLock(cfg.state_dir) if args.commit else _Null()
    with state:
        warn_key_lock(cfg)
        store = build_store(cfg, "scheduled" if args.scheduled else "human")
        try:
            if args.commit or args.trial:
                client = llm.make_client("genai-mil", cfg)
                models = llm.pick_models(client, cfg)
                log.info("models: grade=%s aggregate=%s", models["grade"][:1], models["aggregate"][:1])
                rt = make_runtime(cfg, client, models, audit_writer(cfg, day))
            else:
                rt = make_runtime(cfg, llm.FakeClient(), {"grade": [], "aggregate": []}, None)
            rt.regrade = args.regrade
            results, skipped = run_night(args, cfg, store, rt, commit=bool(args.commit), trial=args.trial)
        finally:
            store.close()
    print_report(results, skipped)
    if not args.commit and not args.trial:
        print("\nDry run: nothing was graded or written. Add --trial N or --commit --expect-ref <ref>.")
    return exit_for(results, skipped)


class _Null:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        pass


def cmd_models(args):
    cfg = cfgmod.load_config(need_db=False)
    client = llm.make_client("genai-mil", cfg)
    avail = client.list_models()
    print("Available:", ", ".join(avail))
    for role in ([args.role] if args.role else ["grade", "aggregate"]):
        order, info = llm.select_models(avail, role, getattr(cfg, f"model_pin_{role}"), cfg.allow_preview)
        print(f"{role}: {order[:3] or 'NONE'}" + ("  (pinned model not in the list)" if info["pin_missing"] else ""))
    return EXIT_OK if avail else EXIT_LLM


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("setup")
    s.add_argument("--commit", action="store_true")
    s.add_argument("--offline", action="store_true")
    s.add_argument("--course", action="append")
    s.add_argument("--grounding-root")
    sub.add_parser("doctor")
    for name in ("plan", "run"):
        r = sub.add_parser(name)
        r.add_argument("--course", action="append")
        r.add_argument("--window-hours", type=int)
        r.add_argument("--max-tracks", type=int)
        r.add_argument("--as-of")
        r.add_argument("--lesson")
        r.add_argument("--track")
        if name == "run":
            r.add_argument("--trial", type=int, default=0)
            r.add_argument("--commit", action="store_true")
            r.add_argument("--expect-ref")
            r.add_argument("--scheduled", action="store_true")
            r.add_argument("--regrade", action="store_true")
            r.add_argument("--no-aggregate", action="store_true")
    m = sub.add_parser("models")
    m.add_argument("--role", choices=["grade", "aggregate"])
    args = p.parse_args(argv)
    try:
        return {"setup": cmd_setup, "doctor": cmd_doctor, "plan": cmd_plan, "run": cmd_run, "models": cmd_models}[args.cmd](args)
    except Stop as exc:
        print(f"STOP ({exc.code}): {exc}", file=sys.stderr)
        return exc.code
    except llm.LLMError as exc:
        extra = f" Unlock at {exc.unlock_url}" if exc.unlock_url else ""
        print(f"STOP ({EXIT_LLM}): {exc}.{extra}", file=sys.stderr)
        return EXIT_LLM


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:                                  # noqa: BLE001  the analysis_runs row stays 'running' on purpose
        print(f"CRASH: {type(exc).__name__}", file=sys.stderr)
        sys.exit(EXIT_CRASH)
