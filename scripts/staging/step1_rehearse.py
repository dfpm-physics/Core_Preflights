#!/usr/bin/env python3
"""Rehearse the step 1 day on a THROWAWAY database on the staging server, using the step 1 tools themselves.

It builds schema `app` through migration 025 and loads the Fall-shaped invented seed (as scratch_migration_proof.py
does), then drives, in the runbook's order and through the same commands:
  precheck (before) -> snapshot and verify -> compare save -> apply 024 -> ledger rows -> apply 025 -> precheck (after-025)
  -> the training UPDATE -> apply 026-029 -> NOTIFY -> apply 030-039 -> apply 040-043 -> ledger rows -> precheck
  (after-043) -> backfill (dry run, commit, commit again) with --dotenv -> compare diff with the recorded transaction
  numbers -> rollback 043 then apply 043 again -> snapshot verify.
It stops at the first step that exits with a code it did not expect, and drops the database whatever happened.

SAFETY  Staging project only (db_target.py refuses anything else). Touches only the database it creates. Never prints a
password or the connection string. Writes its temporary files to a folder it deletes.

  python scripts/staging/step1_rehearse.py --expect-ref <staging_ref>      (needs STAGING_DB_URL in the environment)
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
import db_target  # noqa: E402
import install_staging as ins  # noqa: E402
import scratch_build_check as sbc  # noqa: E402

PY = sys.executable


def sh(args, env, label, ok=(0,)):
    r = subprocess.run([PY] + [str(a) for a in args], capture_output=True, text=True, env=env, cwd=REPO, timeout=900)
    out = (r.stdout or "") + (r.stderr or "")
    good = r.returncode in ok
    print(f"--- {label} (exit {r.returncode}{'' if good else ', UNEXPECTED'})")
    lines = out.strip().splitlines()
    for line in lines[:6] + (["    ..."] if len(lines) > 12 else []) + (lines[-6:] if len(lines) > 6 else []):
        print("    " + line[:180])
    return good, out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expect-ref", required=True)
    args = ap.parse_args()
    url = os.environ.get("STAGING_DB_URL", "").strip()
    try:
        db_target.require_staging(url, args.expect_ref)
    except db_target.DbTargetError as exc:
        sbc.refuse(str(exc))

    import psycopg2
    name = "scratch_reh_" + os.urandom(4).hex()
    admin = psycopg2.connect(url, connect_timeout=15)
    admin.autocommit = True
    acur = admin.cursor()
    acur.execute(f'CREATE DATABASE "{name}"')
    print(f"created  scratch database {name}")
    tmp = Path(tempfile.mkdtemp(prefix="step1_reh_"))
    code = 1
    try:
        surl = db_target.with_dbname(url, name)
        db_target.require_staging(surl, args.expect_ref)
        c = psycopg2.connect(surl, connect_timeout=15)
        c.autocommit = True
        cur = c.cursor()

        def run(label, sql, owner=False):
            body = sql if ins.has_txn(sql) else f"BEGIN;\n{sql}\nCOMMIT;"
            try:
                if owner:
                    cur.execute("SET ROLE prep_app_owner;")
                    cur.execute("RESET search_path;")
                cur.execute(body)
            except Exception as exc:  # noqa: BLE001
                try:
                    cur.execute("ROLLBACK;")
                except Exception:  # noqa: BLE001
                    pass
                print(f"FAILED   {label}: {type(exc).__name__}: {str(exc).strip().splitlines()[0]}")
                return False
            finally:
                if owner:
                    try:
                        cur.execute("RESET ROLE;")
                    except Exception:  # noqa: BLE001
                        pass
            return True

        sql = ins.BOOTSTRAP.read_text(encoding="utf-8")
        sql = re.sub(r"^CREATE ROLE prep_app_\w+.*?;", "", sql, flags=re.S | re.M)
        sql = re.sub(r"^ALTER ROLE prep_app_\w+\s+BYPASSRLS;", "", sql, flags=re.M)
        files = ins.migration_files(None)
        early = [f for f in files if f.name[:3] <= "022"]      # the runbook's ledger-1 covers through 022; 023 stays out
        steps = [("auth stand-in", sbc.AUTH_STUB, False), ("bootstrap", sql, False)]
        steps += [(f.name, f.read_text(encoding="utf-8"), True) for f in early]
        steps += [("auth.users foreign keys", ins.AUTH_FKS, False), ("tutor_error_log grants", ins.TUTOR_LOG_GRANTS, False)]
        for label, text, owner in steps:
            if not run(label, text, owner):
                return 1
        print(f"built    schema app through {early[-1].name[:3]}")
        import seed_staging as seed
        seed.add_auth_user = lambda cc, user_id, email, password: cc.execute(
            "INSERT INTO auth.users (id) VALUES (%s) ON CONFLICT DO NOTHING", (user_id,))
        cur.execute("BEGIN")
        seed.seed(cur)
        cur.execute("COMMIT")
        print("seeded   the invented Fall-shaped seed")

        env = dict(os.environ, SCRATCH_DB_URL=surl)
        env.pop("STAGING_DB_URL", None)
        envf = tmp / "scratch.env"
        envf.write_text(f"STAGING_DB_URL={surl}\n", encoding="utf-8")
        ref = args.expect_ref
        xids = tmp / "xids.txt"
        snapdir = tmp / "snap"
        S = HERE
        U = ["--url-env", "SCRATCH_DB_URL"]
        A = lambda *a, **k: sh([S / "step1_apply.py", *a, *U, "--expect-ref", ref, "--set-role", "prep_app_owner"], env, **k)  # noqa: E731
        steps_ok = []

        def step(label, good):
            steps_ok.append((label, good))
            return good

        if not step("precheck before", sh([S / "step1_precheck_run.py", *U, "--stage", "before", "--expect-role", "postgres"], env,
                    label="precheck, stage before (a LOOK on training and modalities may be seed-specific; exit 0 or 1 both fine)", ok=(0, 1))[0]):
            return 1
        step("snapshot", sh([S / "step1_snapshot.py", *U, "--out", snapdir], env, label="snapshot to a folder outside the repo")[0])
        step("snapshot verify", sh([S / "step1_snapshot.py", *U, "--verify", snapdir], env, label="snapshot --verify")[0])
        step("compare save", sh([S / "step1_compare.py", "save", tmp / "cmp0.json", *U], env, label="compare save")[0])

        def ledger(name, *extra):
            good, out = sh([S / "migration_ledger.py", "sql", "--chain", "app", *extra], env, label=f"ledger SQL {name}")
            r = subprocess.run([PY, str(S / "migration_ledger.py"), "sql", "--chain", "app", *extra], capture_output=True,
                               text=True, env=env, cwd=REPO)
            (tmp / f"{name}.sql").write_text(r.stdout, encoding="ascii", errors="replace")
            return good

        step("apply 024", A("apply", "024_migration_ledger", "--commit", "--xid-file", xids, label="apply 024")[0])
        ledger("ledger-1", "--through", "022", "--method", "backfilled")
        step("ledger-1", A("sql", "--file", tmp / "ledger-1.sql", "--commit", label="run ledger-1")[0])
        step("apply 025", A("apply", "025", "--commit", "--xid-file", xids, label="apply 025")[0])
        ledger("ledger-2", "--only", "024_migration_ledger.sql", "025_pin_function_search_paths.sql", "--method", "applied")
        step("ledger-2", A("sql", "--file", tmp / "ledger-2.sql", "--commit", label="run ledger-2")[0])
        step("precheck after-025", sh([S / "step1_precheck_run.py", *U, "--stage", "after-025", "--expect-role", "postgres", "--only", "2", "3", "5", "6"],
                                      env, label="precheck checks 2,3,5,6 after 025 (all must be OK)")[0])
        step("training update", A("sql", "--command",
             "UPDATE app.course_offerings co SET is_active = false FROM app.courses c, app.terms t WHERE c.id = co.course_id AND t.id = co.term_id AND c.code = 'phys-215' AND t.code = 'training-fall-2026'",
             "--commit", label="the training UPDATE (0 rows here is fine: the seed has no training term)")[0])
        step("apply 026-029", A("apply", "026", "027", "028", "029", "--commit", "--xid-file", xids, label="apply 026-029")[0])
        step("notify", A("sql", "--command", "NOTIFY pgrst, 'reload schema'", "--commit", label="NOTIFY pgrst")[0])
        step("apply 030-039", A("apply", *[f"{n:03d}" for n in range(30, 40)], "--commit", "--xid-file", xids, label="apply 030-039")[0])
        step("apply 040-043", A("apply", "040", "041", "042", "043", "--commit", "--xid-file", xids, label="apply 040-043")[0])
        names = [f.name for f in files if "026" <= f.name[:3] <= "043"]
        ledger("ledger-3", "--only", *names, "--method", "applied")
        step("ledger-3", A("sql", "--file", tmp / "ledger-3.sql", "--commit", label="run ledger-3")[0])
        step("precheck after-043", sh([S / "step1_precheck_run.py", *U, "--stage", "after-043", "--expect-role", "postgres", "--only", "2", "3", "5", "6", "17", "18", "19"],
                                      env, label="precheck checks 2,3,5,6,17,18,19 after 043 (all must be OK)")[0])
        bf = REPO / "scripts" / "v2" / "backfill_paths.py"
        B = ["--dotenv", envf, "--expect-ref", ref]
        step("backfill dry", sh([bf, *B], env, label="backfill dry run, --dotenv")[0])
        step("backfill commit", sh([bf, *B, "--commit", "--xid-file", xids], env, label="backfill --commit")[0])
        step("backfill again", sh([bf, *B, "--commit", "--xid-file", xids], env, label="backfill --commit again (must write 0)")[0])
        step("compare diff", sh([S / "step1_compare.py", "diff", tmp / "cmp0.json", *U, "--xids", xids], env,
                                label="compare diff with recorded transaction numbers")[0])
        step("rollback 043", A("rollback", "043", "--commit", "--xid-file", xids, label="rollback 043")[0])
        step("reapply 043", A("apply", "043", "--commit", "--xid-file", xids, label="apply 043 again")[0])
        step("snapshot verify 2", sh([S / "step1_snapshot.py", *U, "--verify", snapdir], env,
                                     label="snapshot --verify after the day (growth is a NOTE, shrinkage a FAIL)")[0])
        print("\nSUMMARY")
        for label, good in steps_ok:
            print(f"  {'ok  ' if good else 'FAIL'} {label}")
        code = 0 if all(g for _l, g in steps_ok) else 1
        c.close()
    finally:
        if sbc.drop_database(acur, name):
            print(f"dropped  scratch database {name}")
        else:
            print(f'WARNING  could not drop {name}; drop it by hand: DROP DATABASE "{name}";', file=sys.stderr)
            code = code or 1
        admin.close()
        shutil.rmtree(tmp, ignore_errors=True)
    return code


if __name__ == "__main__":
    sys.exit(main())
