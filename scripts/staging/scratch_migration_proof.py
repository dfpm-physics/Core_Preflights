#!/usr/bin/env python3
"""Prove the v2 step 1 migrations leave Fall-shaped rows alone, on a THROWAWAY database on the staging server.

The staging database already holds migrations 026 onward, so a "before" taken there proves nothing about the
migrations. This builds the earlier state from the files, in a database of its own:

  1. create a database scratch_mig_<random> on the staging project's server (nothing else is touched)
  2. build schema `app` through migration 025 (the state before step 1), as scratch_build_check.py does
  3. load the Fall-shaped seed (scripts/staging/seed_staging.py, run as written): interactive commits that the
     grade trigger turns into effort grades, active and revoked extensions, a stored zero, AI-suggested grades,
     final grades, three courses and 27+ cadets, all invented
  4. take the grades fingerprint (scripts/staging/grades_fingerprint.py --save)
  5. apply 026 onward, one file at a time, as prep_app_owner. Nobody else is connected to this database, so
     every transaction number in the window belongs to the migrations; ALL of them are recorded
  6. fingerprint diff A: migrations only
  7. run scripts/v2/backfill_paths.py --commit, recording its transaction id
  8. fingerprint diff B: migrations plus the backfill
  9. run the fingerprint controls on this database (ordinary change = Explained; recorded transaction = Defect;
     change that skips the touch trigger = Defect)
 10. drop the scratch database, whatever happened

SAFETY  Staging project only (db_target.py refuses anything else, the live project included). It drops only the
database it created. The seed's sign-in rows are stood in for by plain auth.users ids, because a scratch database
has no real Auth schema; this changes no row of schema `app`. Never prints a password or the connection string.

Usage:  python scripts/staging/scratch_migration_proof.py --expect-ref <staging_ref>
Exit 0 only when diff A and diff B show no Defect, nothing Explained, and all three controls behave.
"""
import argparse
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse, urlunparse

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
import db_target  # noqa: E402
import install_staging as ins  # noqa: E402
import scratch_build_check as sbc  # noqa: E402

PY = sys.executable
DIFF_SUMMARY = re.compile(r"(DEFECT|EXPLAINED|NEW)", re.I)


def sh(args, env, label):
    r = subprocess.run(args, capture_output=True, text=True, env=env, cwd=REPO, timeout=600)
    out = (r.stdout or "") + (r.stderr or "")
    print(f"--- {label} (exit {r.returncode})")
    for line in out.strip().splitlines():
        print("    " + line[:200])
    return r.returncode, out


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
    name = "scratch_mig_" + os.urandom(4).hex()
    admin = psycopg2.connect(url, connect_timeout=15)
    admin.autocommit = True
    acur = admin.cursor()
    acur.execute(f'CREATE DATABASE "{name}"')
    print(f"created  scratch database {name}")
    code = 1
    tmp = Path(tempfile.mkdtemp(prefix="scratch_mig_"))
    try:
        surl = db_target.with_dbname(url, name)
        db_target.require_staging(surl, args.expect_ref)         # the scratch URL must still name staging
        conn = psycopg2.connect(surl, connect_timeout=15)
        conn.autocommit = True
        cur = conn.cursor()

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
                        cur.execute("RESET search_path;")
                    except Exception:  # noqa: BLE001
                        pass
            return True

        # ---- 2. build through 025 ------------------------------------------------------------------------
        sql = ins.BOOTSTRAP.read_text(encoding="utf-8")
        sql = re.sub(r"^CREATE ROLE prep_app_\w+.*?;", "", sql, flags=re.S | re.M)
        sql = re.sub(r"^ALTER ROLE prep_app_\w+\s+BYPASSRLS;", "", sql, flags=re.M)
        steps = [("auth stand-in", sbc.AUTH_STUB, False), ("bootstrap", sql, False)]
        files = ins.migration_files(None)
        early = [f for f in files if f.name[:3] <= "025" and f.name[:3] != "023"]  # 023 is applied separately
        late = [f for f in files if "026" <= f.name[:3]]
        steps += [(f.name, f.read_text(encoding="utf-8"), True) for f in early]
        steps += [("auth.users foreign keys", ins.AUTH_FKS, False), ("tutor_error_log grants", ins.TUTOR_LOG_GRANTS, False)]
        for label, text, owner in steps:
            if not run(label, text, owner):
                return 1
        print(f"built    schema app through {early[-1].name[:3]} ({len(early)} migration files)")

        # ---- 3. the Fall-shaped seed -----------------------------------------------------------------------
        import seed_staging as seed
        seed.add_auth_user = lambda c, user_id, email, password: c.execute(
            "INSERT INTO auth.users (id) VALUES (%s) ON CONFLICT DO NOTHING", (user_id,))
        cur.execute("BEGIN")
        seed.seed(cur)
        cur.execute("COMMIT")
        print("seeded   the Fall-shaped base seed")
        for t in ("grades", "submissions", "submission_activities", "extensions", "offering_activities"):
            cur.execute(f"SELECT count(*) FROM app.{t}")  # noqa: S608 -- fixed names
            print(f"           {t:<24}{cur.fetchone()[0]}")
        cur.execute("""SELECT count(*) FILTER (WHERE source = 'instructor' AND points_earned = 0),
                              count(*) FILTER (WHERE source = 'ai_suggested'),
                              count(*) FILTER (WHERE effort IS NOT NULL)
                         FROM app.grades""")
        z, ai, eff = cur.fetchone()
        print(f"           stored zeros {z}, AI-suggested {ai}, effort grades {eff}")
        cur.execute("SELECT count(*) FILTER (WHERE revoked_at IS NULL), count(*) FILTER (WHERE revoked_at IS NOT NULL) FROM app.extensions")
        a, r = cur.fetchone()
        print(f"           extensions active {a}, revoked {r}")

        env = dict(os.environ, SCRATCH_DB_URL=surl)
        env.pop("STAGING_DB_URL", None)
        fp = str(HERE / "grades_fingerprint.py")

        # ---- 4. before ---------------------------------------------------------------------------------------
        before = tmp / "before.json"
        rc, _ = sh([PY, fp, "--url-env", "SCRATCH_DB_URL", "--save", str(before)], env, "grades fingerprint BEFORE (state at 025 + seed)")
        if rc:
            return 1

        # ---- 5. apply 026 onward, recording every transaction number in the window ----------------------------------
        cur.execute("SELECT txid_current()")
        x0 = cur.fetchone()[0]
        for f in late:
            if not run(f.name, f.read_text(encoding="utf-8"), True):
                return 1
        cur.execute("SELECT txid_current()")
        x1 = cur.fetchone()[0]
        xids = tmp / "xids.txt"
        xids.write_text("\n".join(str(i) for i in range(x0, x1 + 1)) + "\n", encoding="utf-8")
        print(f"applied  {len(late)} migration files ({late[0].name[:3]} to {late[-1].name[:3]}); "
              f"transaction numbers recorded: {x1 - x0 + 1}")

        # ---- 6. diff A ----------------------------------------------------------------------------------------------
        rc_a, out_a = sh([PY, fp, "--url-env", "SCRATCH_DB_URL", "--diff", str(before), "--xids", str(xids)], env,
                         "diff A: after the migrations, before the backfill")

        # ---- 7. backfill -----------------------------------------------------------------------------------------------
        bf = str(REPO / "scripts" / "v2" / "backfill_paths.py")
        rc_b0, _ = sh([PY, bf, "--expect-ref", args.expect_ref, "--url-env", "SCRATCH_DB_URL"], env, "backfill dry run")
        rc_b1, _ = sh([PY, bf, "--expect-ref", args.expect_ref, "--url-env", "SCRATCH_DB_URL", "--commit",
                       "--xid-file", str(xids)], env, "backfill --commit")
        rc_b2, out_b2 = sh([PY, bf, "--expect-ref", args.expect_ref, "--url-env", "SCRATCH_DB_URL", "--commit",
                            "--xid-file", str(xids)], env, "backfill --commit again (must write 0)")
        again_zero = bool(re.search(r"written\s+0 row|in scope.*\n.*total 0|nothing to do|0 row", out_b2))

        # ---- 8. diff B -----------------------------------------------------------------------------------------------------
        rc_c, out_c = sh([PY, fp, "--url-env", "SCRATCH_DB_URL", "--diff", str(before), "--xids", str(xids)], env,
                         "diff B: migrations plus the backfill")

        # ---- 9. controls -------------------------------------------------------------------------------------------------------
        rc_k, out_k = sh([PY, fp, "--url-env", "SCRATCH_DB_URL", "--controls"], env, "controls (on the scratch database)")

        print("\nSUMMARY")
        print(f"  diff A exit {rc_a}; backfill exits {rc_b0}/{rc_b1}/{rc_b2} (second commit wrote nothing: {again_zero}); "
              f"diff B exit {rc_c}; controls exit {rc_k}")
        code = 0 if (rc_a == 0 and rc_c == 0 and rc_k == 0 and rc_b1 == 0 and rc_b2 == 0) else 1
        conn.close()
    finally:
        if sbc.drop_database(acur, name):
            print(f"dropped  scratch database {name}")
        else:
            print(f'WARNING  could not drop {name}; drop it by hand: DROP DATABASE "{name}";', file=sys.stderr)
            code = code or 1
        admin.close()
    return code


if __name__ == "__main__":
    sys.exit(main())
