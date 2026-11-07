#!/usr/bin/env python3
"""Proves the Stage E "needs staging" items that were still open, through the REAL deployed functions, on STAGING only.

WHAT IT PROVES (with --commit; every item names the line of docs/decisions/V2-STAGE-E-ANSWERS.md it answers)
  2.  A student session reads no `question_keys` row, and sees only its own `question_attempts` and `grades`.
  4.  A token with a damaged signature, a string that is not a token, no credential, a staff session (instructor and director),
      and a token that has really expired (a made-up cadet's own session, kept until its expiry time has passed) cannot answer.
  5.  The server clock decides: an answer carrying a false client time after the grace is refused; one sent at the deadline
      second is stored; one after the grace by a cadet with an extension is stored; the same without one is refused.
  7.  A key corrected mid-session: the next answer is marked against the new key version, and the old attempt keeps its version.
  10. The total agrees for the student (my_course_total), the instructor (course_totals), and the source the export reads
      (course_totals, called as a director), before the deadline and after it.
  13. A director re-marks: the preview writes nothing, a wrong token is refused, the commit changes what the preview said, the
      same commit again changes 0. A non-director (an instructor, a student) is refused.
  9.  Function logs: tried through the management API with the access token; reported as not done if no route answers.

SAFETY
  Dry run by default: builds the fixture, runs the delete route, rolls back, sends no request.
  --commit refuses any project but staging (db_target.py, the host in config.js, --expect-ref). It never forges a token:
  the "damaged" one is a real token with its signature changed, which is a refusal test, not a credential. Everything it makes
  is made up ("ZZ proof", invented ids, accounts at the staging example domain) and is deleted at the end by marker.
  The append-only table `grade_events` keeps its rows (ids and points, no names).
  No secret is printed. The expiry check keeps one made-up cadet's session in this process's memory for about an hour.

ENVIRONMENT  STAGING_DB_URL (owner connection), STAGING_PROJECT_REF and SUPABASE_ACCESS_TOKEN (logs only), all from the launcher.

USAGE
  python scripts/staging/prove_stage_e_open_items.py --expect-ref <staging_ref>
  python scripts/staging/prove_stage_e_open_items.py --expect-ref <staging_ref> --commit
  python scripts/staging/prove_stage_e_open_items.py --expect-ref <staging_ref> --commit --skip-expiry     (no hour-long wait)
  python scripts/staging/prove_stage_e_open_items.py --expect-ref <staging_ref> --commit --cleanup-only
"""
import argparse
import base64
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import db_target  # noqa: E402
import v2_gate_lib as lib  # noqa: E402
import load_check_answer as L  # noqa: E402  (its Client, sign_in and count helpers; its main() is not run)
from serve_local import read_targets  # noqa: E402

COURSE_CODE = "zz-proof"
TERM_CODE = "zz-proof"
ID_BASE = 3000960000
EMAIL_FMT = "zzproof{n}@" + lib.DOMAIN
EMAIL_LIKE = "zzproof%@" + lib.DOMAIN
STAFF_KEYS = ("zzproofdirector", "zzproofteacher")
KEY_OLD, KEY_NEW = 4.0, 3.7        # the key as first written (wrong on purpose) and as corrected
GRACE = 120
LIMIT = 3
RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print(f"  [{'pass' if ok else 'FAIL'}] {name}" + (f" -- {detail}" if detail and not ok else ""))
    return bool(ok)


def note(text):
    print(f"  [note] {text}")


# ---------------------------------------------------------------------------------------------------------------
# database: fixture and teardown
# ---------------------------------------------------------------------------------------------------------------
def leftovers(cur):
    cur.execute("SELECT (SELECT count(*) FROM app.courses WHERE code = %s), (SELECT count(*) FROM app.terms WHERE code = %s), "
                "(SELECT count(*) FROM app.students WHERE student_id BETWEEN %s AND %s), "
                "(SELECT count(*) FROM auth.users WHERE email LIKE %s)",
                (COURSE_CODE, TERM_CODE, ID_BASE, ID_BASE + 9999, EMAIL_LIKE))
    c, t, s, u = cur.fetchone()
    return {"courses": c, "terms": t, "students": s, "auth_users": u}


def build_fixture(cur, password):
    """Course, term, offering, one section, two items (P: key correction and reads; T: timing), five cadets, two staff."""
    b = lib.Builder(cur)
    course = b.course(COURSE_CODE, "ZZ proof")
    term = b.term(TERM_CODE, "ZZ proof", starts="2026-08-01", ends="2099-12-31")
    co = b.offering(course, term, True)
    sec = b.section(co, "ZZP", ["M"])
    director = b.staff(STAFF_KEYS[0], "Zed Zzproofdirector", password)
    b.assign(director, co, "director")
    teacher = b.staff(STAFF_KEYS[1], "Zed Zzproofteacher", password)
    b.assign(teacher, co, "instructor", sec)
    paths = [{"modality": "questions", "delivery": "online_questions", "grading": "auto_checked"}]
    due = datetime.now(timezone.utc) + timedelta(days=1)
    items = {}
    for slug, value in (("zz-proof-p", KEY_OLD), ("zz-proof-t", KEY_NEW)):
        it = b.item(course, co, slug, "ZZ proof " + slug[-1].upper(), 0, kind="homework", paths=paths, due=due, published=False,
                    entered_on_new_page=True, attempt_limit=LIMIT, attempt_rule="best")
        q = b.question(it, "q1", "numeric", 2, key=[{"value": value, "tol_pct": 2}], prompt="ZZ proof: a made-up number.")
        b.publish(it)
        cur.execute("SELECT id FROM question_keys WHERE question_id = %s AND superseded_at IS NULL", (q,))
        items[slug[-1]] = {"ao": it["ao"], "q": q, "key_id": cur.fetchone()[0]}
    cadets = {}
    for i in range(1, 6):
        cid = ID_BASE + i
        uid = b.id("user", cid)
        email = EMAIL_FMT.format(n=i)
        b.auth_user(uid, email, password)
        cur.execute("INSERT INTO students (student_id, name, email, auth_user_id) VALUES (%s, %s, %s, %s)",
                    (cid, f"Proof Cadet {i}", email, uid))
        enr = b.id("enrollment", cid)
        cur.execute("INSERT INTO enrollments (id, student_id, section_id, status) VALUES (%s, %s, %s, 'active')", (enr, cid, sec))
        cadets[i] = {"student_id": cid, "uid": uid, "email": email, "enr": enr}
    return {"co": co, "sec": sec, "items": items, "cadets": cadets, "director": director, "teacher": teacher,
            "staff_email": {"director": f"{STAFF_KEYS[0]}@{lib.DOMAIN}", "teacher": f"{STAFF_KEYS[1]}@{lib.DOMAIN}"}}


def teardown(cur):
    """Delete everything the fixture made, found by its markers. Returns rows deleted per step."""
    cur.execute("SET LOCAL search_path = app, public, extensions")
    done = {}

    def run(label, sql, params=()):
        cur.execute(sql, params)
        done[label] = cur.rowcount

    cur.execute("SELECT id FROM auth.users WHERE email LIKE %s", (EMAIL_LIKE,))
    uids = [r[0] for r in cur.fetchall()]
    scope = ("SELECT ao.id FROM assignment_offerings ao JOIN course_offerings co ON co.id = ao.course_offering_id "
             "JOIN courses c ON c.id = co.course_id WHERE c.code = %s")
    run("question_attempts", f"DELETE FROM question_attempts WHERE assignment_offering_id IN ({scope})", (COURSE_CODE,))
    run("grades", f"DELETE FROM grades WHERE assignment_offering_id IN ({scope})", (COURSE_CODE,))
    run("assignment_offerings", f"DELETE FROM assignment_offerings WHERE id IN ({scope})", (COURSE_CODE,))
    run("courses (cascades offering, section, enrollments, extensions, staff assignments, items, questions, keys, re-mark runs)",
        "DELETE FROM courses WHERE code = %s", (COURSE_CODE,))
    run("terms", "DELETE FROM terms WHERE code = %s", (TERM_CODE,))
    run("students", "DELETE FROM students WHERE student_id BETWEEN %s AND %s AND email LIKE %s", (ID_BASE, ID_BASE + 9999, EMAIL_LIKE))
    run("instructors", "DELETE FROM instructors WHERE id = ANY(%s::uuid[])", (uids,))
    run("auth.users", "DELETE FROM auth.users WHERE id = ANY(%s::uuid[]) AND email LIKE %s", (uids, EMAIL_LIKE))
    return done


# ---------------------------------------------------------------------------------------------------------------
# http
# ---------------------------------------------------------------------------------------------------------------
def jwt_exp(token):
    """The expiry time a token states (read, not changed)."""
    part = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))).get("exp")


class Api:
    def __init__(self, host, anon):
        self.host, self.anon = host, anon
        self.client = L.Client(host, anon)

    def answer(self, ao, q, text, token, extra=None, headers=None, send_apikey=True):
        body = {"assignment_offering_id": ao, "question_id": q, "answer": text}
        body.update(extra or {})
        status, text_, dt, err, hdrs = self.client.post("/functions/v1/check-answer", body, token=token, extra_headers=headers,
                                                        send_apikey=send_apikey)
        parsed = None
        try:
            parsed = json.loads(text_) if text_ else None
        except ValueError:
            pass
        return {"status": status, "body": parsed, "text": text_, "err": err}

    def remark(self, q, mode, token, preview_token=None):
        body = {"question_id": q, "mode": mode}
        if preview_token:
            body["preview_token"] = preview_token
        status, text_, dt, err, hdrs = self.client.post("/functions/v1/remark-question", body, token=token)
        try:
            parsed = json.loads(text_) if text_ else None
        except ValueError:
            parsed = None
        return {"status": status, "body": parsed, "text": text_}

    def rest(self, token, path, method="GET", body=None):
        """A PostgREST call in schema app. Returns (status, parsed json or None)."""
        headers = {"apikey": self.anon, "Authorization": "Bearer " + token, "Accept-Profile": "app", "Content-Profile": "app",
                   "Content-Type": "application/json"}
        req = urllib.request.Request(f"https://{self.host}/rest/v1/{path}", method=method, headers=headers,
                                     data=json.dumps(body).encode() if body is not None else None)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read().decode("utf-8", "replace")
                return r.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", "replace")
            try:
                return e.code, json.loads(raw)
            except ValueError:
                return e.code, None


def sign_all(host, anon, who, password, budget=300):
    """Sign each account in, spaced and backed off for the rate limit. who: {name: email}. Returns {name: token}."""
    tokens, t0, throttled = {}, time.time(), 0
    for name, email in who.items():
        while time.time() - t0 < budget:
            st, tok, extra = L.sign_in(host, anon, email, password)
            if st == 200 and tok:
                tokens[name] = tok
                break
            if st == 429:
                throttled += 1
                time.sleep(min(60, 10 + 5 * throttled))
                continue
            raise RuntimeError(f"sign-in refused for {name}: HTTP {st}")
        else:
            raise RuntimeError("sign-in budget used up")
        time.sleep(0.4)
    print(f"signed in {len(tokens)} made-up accounts in {time.time() - t0:.0f}s; rate-limit replies {throttled}")
    return tokens


# ---------------------------------------------------------------------------------------------------------------
# helpers on the owner connection
# ---------------------------------------------------------------------------------------------------------------
def set_deadline(conn, cur, ao, seconds=None, at=None):
    cur.execute("SET LOCAL search_path = app, public, extensions")
    live = lib.triggers_off(cur, "assignment_offerings", ("assignment_offerings_new_paths_stay_unpublished",
                                                          "assignment_offerings_new_stay_unpublished"))
    if at is not None:
        cur.execute("UPDATE app.assignment_offerings SET due_at = %s, due_by_day = '{}'::jsonb WHERE id = %s RETURNING due_at", (at, ao))
    else:
        cur.execute("UPDATE app.assignment_offerings SET due_at = now() + make_interval(secs => %s), due_by_day = '{}'::jsonb "
                    "WHERE id = %s RETURNING due_at", (seconds, ao))
    due = cur.fetchone()[0]
    lib.triggers_on(cur, "assignment_offerings", live)
    conn.commit()
    return due


def db_skew(cur):
    cur.execute("SELECT extract(epoch from now())")
    t_local = time.time()
    r = float(cur.fetchone()[0]) - t_local
    cur.connection.rollback()
    return r


def attempts_of(cur, ao, student_id):
    cur.execute("SELECT a.attempt_no, a.is_correct, a.key_version_id, a.answer ->> 'raw' FROM app.question_attempts a "
                "JOIN app.enrollments e ON e.id = a.enrollment_id WHERE a.assignment_offering_id = %s AND e.student_id = %s "
                "ORDER BY a.attempt_no", (ao, student_id))
    rows = cur.fetchall()
    cur.connection.rollback()
    return rows


def grade_of(cur, ao, student_id):
    cur.execute("SELECT g.points_earned FROM app.grades g JOIN app.enrollments e ON e.id = g.enrollment_id "
                "WHERE g.assignment_offering_id = %s AND e.student_id = %s", (ao, student_id))
    r = cur.fetchone()
    cur.connection.rollback()
    return None if r is None else float(r[0])


def total_triplet(api, fx, tokens, cad_i):
    """The student's own total, the instructor's row for that cadet, and the director's row (the export's source)."""
    enr = fx["cadets"][cad_i]["enr"]
    body = {"p_course_offering": fx["co"], "p_scope": "final"}
    s_st, s_rows = api.rest(tokens[f"s{cad_i}"], "rpc/my_course_total", "POST", body)
    t_st, t_rows = api.rest(tokens["teacher"], "rpc/course_totals", "POST", body)
    d_st, d_rows = api.rest(tokens["director"], "rpc/course_totals", "POST", body)
    pick = lambda rows: next((r for r in (rows or []) if r.get("enrollment_id") == enr), None)  # noqa: E731
    mine = (s_rows or [None])[0] if isinstance(s_rows, list) else None
    fields = ("earned_text", "possible_text", "percent_text", "percent_key_text")
    return (s_st, t_st, d_st), [{k: (r or {}).get(k) for k in fields} for r in (mine, pick(t_rows), pick(d_rows))]


# ---------------------------------------------------------------------------------------------------------------
# function logs
# ---------------------------------------------------------------------------------------------------------------
def try_logs(ref, started, ended):
    """Try every route the access token might allow. Returns (rows read, hits, text) or (None, None, why)."""
    token, env_ref = os.environ.get("SUPABASE_ACCESS_TOKEN", ""), os.environ.get("STAGING_PROJECT_REF", "")
    if not token or env_ref != ref:
        return None, None, "no access token for the staging project in this environment"
    stamp = "%Y-%m-%dT%H:%M:%SZ"
    tried = []
    for endpoint in ("logs.all", "logs"):
        for table in ("function_logs", "function_edge_logs"):
            sql = f"select timestamp, event_message from {table} order by timestamp desc limit 500"
            qs = urllib.parse.urlencode({"sql": sql, "iso_timestamp_start": started.strftime(stamp), "iso_timestamp_end": ended.strftime(stamp)})
            req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{ref}/analytics/endpoints/{endpoint}?{qs}",
                                         headers={"Authorization": "Bearer " + token, "User-Agent": "prep-stage-e-proof"})
            try:
                with urllib.request.urlopen(req, timeout=40) as r:
                    data = json.loads(r.read())
            except urllib.error.HTTPError as e:
                tried.append(f"{endpoint}/{table}: HTTP {e.code}")
                continue
            except Exception as e:  # noqa: BLE001
                tried.append(f"{endpoint}/{table}: {type(e).__name__}")
                continue
            if data.get("error"):
                tried.append(f"{endpoint}/{table}: {str(data['error'])[:60]}")
                continue
            rows = data.get("result") or []
            import re
            hits = sum(1 for row in rows if re.search(r"eyJ[A-Za-z0-9_-]{20,}|sb_secret|service_role_key|tol_pct|correct_choice_ids", json.dumps(row)))
            return len(rows), hits, f"{endpoint}/{table}"
    return None, None, "; ".join(tried)


# ---------------------------------------------------------------------------------------------------------------
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expect-ref", required=True)
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--skip-expiry", action="store_true", help="do not wait for a real token to expire (reported as not done)")
    ap.add_argument("--cleanup-only", action="store_true")
    ap.add_argument("--out", help="write the results as JSON here (outside the repo)")
    args = ap.parse_args(argv)

    url = os.environ.get("STAGING_DB_URL", "").strip()
    if not url:
        sys.exit("REFUSED  STAGING_DB_URL is not set.")
    ref = db_target.exit_unless_staging(url, args.expect_ref).ref
    if ref != args.expect_ref or ref != db_target.STAGING_REF:
        sys.exit(f"REFUSED  STAGING_DB_URL names project {ref}, not {args.expect_ref}.")
    prod, staging = read_targets()
    host = urllib.parse.urlsplit(staging["url"]).hostname
    if host != f"{db_target.STAGING_REF}.supabase.co":
        sys.exit("REFUSED  the staging address in config.js is not the staging project.")
    anon = staging["anon"]

    import psycopg2
    conn = psycopg2.connect(url, connect_timeout=15)
    cur = conn.cursor()
    print(f"target   staging project {ref}")
    print(f"mode     {'COMMIT' if args.commit else 'dry run (rolled back; no request is sent; add --commit to run)'}")

    if args.cleanup_only:
        if not args.commit:
            print("cleanup plan:", leftovers(cur))
            conn.rollback()
            return 0
        print("deleted", teardown(cur))
        conn.commit()
        print("left over", leftovers(cur))
        return 0

    left = leftovers(cur)
    if any(left.values()):
        sys.exit(f"REFUSED  made-up rows from an earlier run are still there: {left}. Run with --cleanup-only --commit first.")
    base = L.table_counts(cur)
    conn.rollback()
    password = secrets.token_urlsafe(14)          # in memory only; the accounts are deleted at the end

    if not args.commit:
        fx = build_fixture(cur, password)
        print(f"built    {len(fx['cadets'])} made-up cadets, 2 staff, 2 items (not committed)")
        print("deleted ", teardown(cur))
        d = L.diff_counts(base, L.table_counts(cur))
        print("counts after the delete route differ from before in:", d or "nothing")
        conn.rollback()
        print("rolled back. Nothing written.")
        return 0 if not d else 1

    code, started = 0, datetime.now(timezone.utc)
    api = Api(host, anon)
    expiry_token = None
    try:
        fx = build_fixture(cur, password)
        conn.commit()
        print("built    5 made-up cadets, 2 staff, 2 items (key correction and timing); committed")
        who = {f"s{i}": c["email"] for i, c in fx["cadets"].items()}
        who.update({"director": fx["staff_email"]["director"], "teacher": fx["staff_email"]["teacher"]})
        tokens = sign_all(host, anon, who, password)
        P, T = fx["items"]["p"], fx["items"]["t"]
        s = lambda i: fx["cadets"][i]["student_id"]  # noqa: E731
        expiry_token = tokens["s5"]
        exp_at = jwt_exp(expiry_token)
        print(f"         one cadet's session is kept to prove an expired token is refused; it states expiry at {datetime.fromtimestamp(exp_at, timezone.utc):%H:%M:%S} UTC")

        # ---- 4. who may answer -------------------------------------------------------------------------------------
        print("\n== who may answer (item 4)")
        good = api.answer(P["ao"], P["q"], "4.0", tokens["s1"])
        # a real token with its signature changed: a refusal test, not a credential
        tok = tokens["s1"]
        damaged = tok[:-6] + ("AAAAAA" if not tok.endswith("AAAAAA") else "BBBBBB")
        r = api.answer(P["ao"], P["q"], "4.0", damaged)
        check("a token with a damaged signature is refused", r["status"] in (401, 403) or (r["body"] or {}).get("ok") is False, f"HTTP {r['status']}")
        r = api.answer(P["ao"], P["q"], "4.0", "not-a-token")
        check("a string that is not a token is refused", r["status"] in (401, 403) or (r["body"] or {}).get("ok") is False, f"HTTP {r['status']}")
        r = api.answer(P["ao"], P["q"], "4.0", None)
        check("no credential is refused", r["status"] in (401, 403) or (r["body"] or {}).get("ok") is False, f"HTTP {r['status']}")
        for who_ in ("teacher", "director"):
            r = api.answer(P["ao"], P["q"], "4.0", tokens[who_])
            b = r["body"] or {}
            check(f"a staff session ({who_}) cannot answer", b.get("ok") is False and b.get("code") in ("not_enrolled", "not_signed_in"), f"HTTP {r['status']} {b.get('code')}")
        cur.execute("SELECT count(*) FROM app.question_attempts WHERE assignment_offering_id = %s", (P["ao"],))
        n_att = cur.fetchone()[0]
        conn.rollback()
        check("none of those refusals stored an attempt (only the one real answer is there)", n_att == 1 and good["body"] and good["body"].get("ok") is True, f"{n_att} attempt rows")

        # ---- 7 and 13. a key corrected mid-session, then a re-mark ------------------------------------------------------
        print("\n== a key corrected mid-session (item 7)")
        r1 = api.answer(P["ao"], P["q"], "3.7", tokens["s3"])
        check("before the correction, 3.7 is marked wrong against the old key", (r1["body"] or {}).get("ok") is True and (r1["body"] or {}).get("correct") is False, json.dumps(r1["body"]))
        cur.execute("SET LOCAL search_path = app, public, extensions")
        cur.execute("UPDATE question_keys SET superseded_at = now() WHERE id = %s AND superseded_at IS NULL", (P["key_id"],))
        cur.execute("INSERT INTO question_keys (question_id, version, value, tol_pct, written_by) VALUES (%s, 2, %s, 2, 'human') RETURNING id",
                    (P["q"], KEY_NEW))
        new_key = cur.fetchone()[0]
        conn.commit()
        r2 = api.answer(P["ao"], P["q"], "3.7", tokens["s3"])
        check("after the correction, the same answer is marked right", (r2["body"] or {}).get("ok") is True and (r2["body"] or {}).get("correct") is True, json.dumps(r2["body"]))
        rows = attempts_of(cur, P["ao"], s(3))
        check("the first attempt keeps the old key version and the second carries the new one",
              len(rows) == 2 and str(rows[0][2]) == str(P["key_id"]) and str(rows[1][2]) == str(new_key), f"{len(rows)} attempts")
        check("the grade follows the best attempt", grade_of(cur, P["ao"], s(3)) == 2.0, str(grade_of(cur, P["ao"], s(3))))

        # ---- 2. what a student can read -----------------------------------------------------------------------------
        print("\n== what a student can read (item 2)")
        # cadet 4 answers the OLD key's value, so there is another cadet's work to be unable to read
        r4 = api.answer(P["ao"], P["q"], "4.0", tokens["s4"])
        # (that answer is marked against the new key: 4.0 is now wrong, which gives the re-mark nothing to change for cadet 4)
        st, keys = api.rest(tokens["s3"], "question_keys?select=*")
        check("a student reads no question_keys row", st in (200, 401, 403) and not (isinstance(keys, list) and keys), f"HTTP {st}, {len(keys) if isinstance(keys, list) else 'no list'}")
        st, atts = api.rest(tokens["s3"], "question_attempts?select=enrollment_id")
        mine = isinstance(atts, list) and atts and all(a["enrollment_id"] == fx["cadets"][3]["enr"] for a in atts)
        check("a student reads only their own question_attempts", st == 200 and mine, f"HTTP {st}, {len(atts) if isinstance(atts, list) else 'no list'} rows")
        st, other = api.rest(tokens["s3"], f"question_attempts?select=id&enrollment_id=eq.{fx['cadets'][4]['enr']}")
        check("asking for another cadet's attempts by id returns nothing", st == 200 and other == [], f"HTTP {st}, {other if not isinstance(other, list) else len(other)}")
        st, grades = api.rest(tokens["s3"], "grades?select=enrollment_id")
        mine = isinstance(grades, list) and all(g["enrollment_id"] == fx["cadets"][3]["enr"] for g in grades)
        check("a student reads no grade row that is not their own (the table itself may show none before release)", st == 200 and mine, f"HTTP {st}, {len(grades) if isinstance(grades, list) else 'no list'} rows")
        st, cells = api.rest(tokens["s3"], "rpc/gradebook_cells", "POST", {"p_course_offering": fx["co"], "p_scope": "final"})
        check("the student's gradebook read returns only their own cells, and some", st == 200 and isinstance(cells, list) and len(cells) > 0 and all(x["enrollment_id"] == fx["cadets"][3]["enr"] for x in cells), f"HTTP {st}, {len(cells) if isinstance(cells, list) else 'no list'} cells")
        st, other = api.rest(tokens["s3"], f"grades?select=id&enrollment_id=eq.{fx['cadets'][4]['enr']}")
        check("asking for another cadet's grade by id returns nothing", st == 200 and other == [], f"HTTP {st}")
        st, w = api.rest(tokens["s3"], "question_attempts", "POST", {"enrollment_id": fx["cadets"][3]["enr"], "assignment_offering_id": P["ao"],
                                                                      "question_id": P["q"], "attempt_no": 9, "answer": {"raw": "3.7"}, "is_correct": True})
        check("a student cannot write an attempt", st in (401, 403, 404), f"HTTP {st}")

        # ---- 13. a director re-marks -------------------------------------------------------------------------------
        print("\n== a director re-marks (item 13)")
        snap = lambda: attempts_of(cur, P["ao"], s(1)) + attempts_of(cur, P["ao"], s(3)) + attempts_of(cur, P["ao"], s(4))  # noqa: E731
        before = snap()
        for who_ in ("teacher", "s3"):
            r = api.remark(P["q"], "preview", tokens[who_])
            check(f"{'an instructor' if who_ == 'teacher' else 'a student'} is refused a preview", (r["body"] or {}).get("ok") is False, json.dumps(r["body"])[:120])
        pv = api.remark(P["q"], "preview", tokens["director"])
        b = pv["body"] or {}
        check("the director's preview answers with counts and a token", b.get("ok") is True and isinstance(b.get("preview_token"), str), json.dumps({k: b.get(k) for k in ("ok", "code", "error")}))
        check("the preview says two attempts would change (cadet 3's first becomes right, cadet 1's old-key answer becomes wrong)", b.get("attempts_changed") == 2, f"attempts_changed {b.get('attempts_changed')}, total {b.get('attempts_total')}")
        check("the preview wrote nothing", snap() == before)
        wrong = api.remark(P["q"], "commit", tokens["director"], "0" * 32)
        check("a commit with a wrong number is refused and writes nothing", (wrong["body"] or {}).get("ok") is False and snap() == before, json.dumps(wrong["body"])[:140])
        denied = api.remark(P["q"], "commit", tokens["teacher"], b.get("preview_token") or "0" * 32)
        check("an instructor cannot commit with the director's number", (denied["body"] or {}).get("ok") is False, json.dumps(denied["body"])[:120])
        cm = api.remark(P["q"], "commit", tokens["director"], b.get("preview_token"))
        cb = cm["body"] or {}
        check("the commit with the preview's number changes what the preview said", cb.get("ok") is True and cb.get("committed") is True and cb.get("attempts_changed") == b.get("attempts_changed"), json.dumps({k: cb.get(k) for k in ("ok", "code", "committed", "attempts_changed")}))
        rows = attempts_of(cur, P["ao"], s(3))
        check("cadet 3's first attempt now reads right", len(rows) == 2 and rows[0][1] is True, str([r[1] for r in rows]))
        check("cadet 1's old-key answer now reads wrong, and the grade follows (0 of 2)", attempts_of(cur, P["ao"], s(1))[0][1] is False and grade_of(cur, P["ao"], s(1)) == 0.0, str(grade_of(cur, P["ao"], s(1))))
        mid = snap()
        again = api.remark(P["q"], "commit", tokens["director"], b.get("preview_token"))
        ab = again["body"] or {}
        check("the same commit again changes 0 (refused or nothing to change) and the rows are the same",
              snap() == mid and (ab.get("ok") is False or ab.get("attempts_changed") == 0), json.dumps({k: ab.get(k) for k in ("ok", "code", "attempts_changed")}))

        # ---- 5 and 10. the deadline, the server clock, extensions, totals ---------------------------------------------
        print("\n== the deadline and the totals (items 5 and 10)")
        cur.execute("SET LOCAL search_path = app, public, extensions")
        cur.execute("INSERT INTO extensions (enrollment_id, assignment_offering_id, extended_due_at, reason, granted_by) VALUES (%s, %s, now() + interval '1 day', 'Made-up reason.', %s)",
                    (fx["cadets"][2]["enr"], T["ao"], fx["director"]))
        conn.commit()
        skew = db_skew(cur)
        due = set_deadline(conn, cur, T["ao"], seconds=40)
        d_local = due.timestamp() - skew
        print(f"         deadline set {d_local - time.time():.0f}s ahead; cadet 2 holds an extension of a day")

        def wait_until(t):
            while time.time() < t:
                time.sleep(0.2)

        wait_until(d_local - 6)
        a = api.answer(T["ao"], T["q"], "3.7", tokens["s1"])
        check("before the deadline an answer is stored", (a["body"] or {}).get("ok") is True and (a["body"] or {}).get("attempt_no") == 1, json.dumps(a["body"]))
        st, rows_before = total_triplet(api, fx, tokens, 1)
        check("totals before the deadline: the student, the instructor and the export's source agree", rows_before[0] == rows_before[1] == rows_before[2] and rows_before[0]["earned_text"] is not None, json.dumps(rows_before))
        check("totals before the deadline: all three reads answered", st == (200, 200, 200), str(st))
        wait_until(d_local + 0.4)
        a = api.answer(T["ao"], T["q"], "7", tokens["s1"])
        check("at the deadline second an answer is stored (inside the grace)", (a["body"] or {}).get("ok") is True and (a["body"] or {}).get("attempt_no") == 2, json.dumps(a["body"]))
        wait_until(d_local + GRACE + 6)
        fake = (datetime.now(timezone.utc) - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
        a = api.answer(T["ao"], T["q"], "3.7", tokens["s1"], extra={"client_time": fake, "answered_at": fake, "now": fake, "submitted_at": fake, "is_late": False},
                       headers={"X-Client-Time": fake, "Date": "Mon, 01 Jan 2024 00:00:00 GMT"})
        check("after the grace, an answer carrying a false client time two hours early is refused as closed", (a["body"] or {}).get("ok") is False and (a["body"] or {}).get("code") == "closed", json.dumps(a["body"]))
        check("and it stored nothing: cadet 1 still has two attempts", len(attempts_of(cur, T["ao"], s(1))) == 2)
        a = api.answer(T["ao"], T["q"], "3.7", tokens["s2"])
        check("after the grace, a cadet with an extension can still answer", (a["body"] or {}).get("ok") is True and (a["body"] or {}).get("attempt_no") == 1, json.dumps(a["body"]))
        a = api.answer(T["ao"], T["q"], "3.7", tokens["s4"])
        check("after the grace, a cadet with no extension is refused as closed", (a["body"] or {}).get("ok") is False and (a["body"] or {}).get("code") == "closed", json.dumps(a["body"]))
        for i in (1, 2):
            st, after = total_triplet(api, fx, tokens, i)
            check(f"totals after the deadline (cadet {i}): the student, the instructor and the export's source agree", after[0] == after[1] == after[2] and after[0]["earned_text"] is not None and st == (200, 200, 200), json.dumps(after))
        check("the grade rows hold what the replies said (cadet 1: the best of the two attempts is the right one, 2 points)", grade_of(cur, T["ao"], s(1)) == 2.0, str(grade_of(cur, T["ao"], s(1))))
        text = (HERE.parent.parent / "site" / "js" / "faculty-export.js").read_text(encoding="utf-8")
        check("the export module reads its totals only from course_totals rows", "course_totals" in text and "my_course_total" not in text)

        # ---- 9. function logs ----------------------------------------------------------------------------------------
        print("\n== function logs (item 9)")
        n_rows, hits, why = try_logs(ref, started - timedelta(minutes=2), datetime.now(timezone.utc) + timedelta(minutes=2))
        if n_rows is None:
            note(f"function logs were not readable by any route this access token allows: {why}. Item 9 stays open.")
        else:
            check("function logs hold no token, key text or tolerance", hits == 0, f"{n_rows} log rows read through {why}")

        # ---- 4 (last part). a token that has really expired ----------------------------------------------------------
        print("\n== an expired token (item 4)")
        if args.skip_expiry:
            note("--skip-expiry: no expired token was tried. Item 4 stays part done.")
        else:
            wait = exp_at + 45 - time.time()
            print(f"         waiting {max(0, wait) / 60:.0f} minutes for the kept session to pass its stated expiry")
            while time.time() < exp_at + 45:
                time.sleep(min(30, max(1, exp_at + 45 - time.time())))
            a = api.answer(P["ao"], P["q"], "3.7", expiry_token)
            check("an expired token is refused", a["status"] in (401, 403) or (a["body"] or {}).get("ok") is False, f"HTTP {a['status']} {(a['body'] or {}).get('code') or ''}")
            conn.close()
            conn = psycopg2.connect(url, connect_timeout=15)
            cur = conn.cursor()
            cur.execute("SELECT count(*) FROM app.question_attempts a JOIN app.enrollments e ON e.id = a.enrollment_id WHERE e.student_id = %s", (s(5),))
            check("and it stored nothing", cur.fetchone()[0] == 0)
            conn.rollback()
        if args.out:
            Path(args.out).write_text(json.dumps([(a, b, c) for a, b, c in RESULTS]), encoding="utf-8")
        code = 0 if all(r[1] for r in RESULTS) else 1
    except Exception as exc:  # noqa: BLE001
        print(f"STOPPED  {type(exc).__name__}: {str(exc).strip().splitlines()[0] if str(exc).strip() else ''}")
        code = 2
    finally:
        try:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass
            conn = psycopg2.connect(url, connect_timeout=15)
            cur = conn.cursor()
            print("\ndeleting what this run made")
            for k, v in teardown(cur).items():
                print(f"  deleted {v:>6}  {k}")
            conn.commit()
            after = L.table_counts(cur)
            conn.rollback()
            d = L.diff_counts(base, after)
            print("row counts against the start:", d or "identical")
            print("leftover markers:", leftovers(cur))
            conn.rollback()
        except Exception as exc:  # noqa: BLE001
            print(f"CLEANUP FAILED  {type(exc).__name__}: {str(exc).strip().splitlines()[0]}. Run --cleanup-only --commit.")
            code = code or 3
        conn.close()
    n_fail = sum(1 for r in RESULTS if not r[1])
    print(f"\n{len(RESULTS) - n_fail} passed, {n_fail} failed")
    return code


if __name__ == "__main__":
    sys.exit(main())
