#!/usr/bin/env python3
"""End-of-deadline load test through the real check-answer function, on STAGING only.

WHAT IT DOES (with --commit)
  1. Builds a made-up course "ZZ load" with one item, one numeric question, a limit of 3 attempts, and N made-up
     cadets ("Load Cadet 1" ...) with invented ids and sign-in accounts. Every row is marked so it can be found.
  2. Signs the cadets in with real sessions through the project's own sign-in endpoint, spaced and backed off to
     respect its rate limit. Cadets that cannot be reached before the budget runs out are left out and counted.
  3. Sets the deadline about 100 seconds ahead. In the last 60 seconds before it, and for 30 seconds after, sends real
     HTTP requests to the deployed function from several threads: right answers, wrong answers, retries past the
     limit, two answers at once from one cadet, requests carrying forged fields, unreadable answers, and a few
     requests with no or damaged credentials. A short burst follows around the end of the 120 second grace.
  4. Reports cold start, median and p95 latency, outcomes by status, and database connection use sampled during the run.
  5. Checks the database: attempt limit, deadline plus grace, every grade recomputed from its attempts, every stored
     attempt equal to what the function reported, forged fields without effect, no key in any reply.
  6. Deletes everything it made and compares row counts with those taken before it started.

SAFETY
  Dry run by default: it builds a three-cadet fixture, runs the delete route, and rolls back. No request is sent.
  --commit sends the traffic. It refuses any project but staging (db_target.py, the host in config.js, --expect-ref).
  It never forges a token and never prints a secret.

ENVIRONMENT  STAGING_DB_URL (owner connection). SUPABASE_ACCESS_TOKEN and STAGING_PROJECT_REF are used only to try
             reading function logs; if they are absent or refused that check is reported as not done.

USAGE
  python scripts/staging/load_check_answer.py --expect-ref <staging_ref>
  python scripts/staging/load_check_answer.py --expect-ref <staging_ref> --commit --cadets 10 --threads 8
  python scripts/staging/load_check_answer.py --expect-ref <staging_ref> --commit --cleanup-only
"""
import argparse
import heapq
import http.client
import json
import os
import random
import re
import secrets
import sys
import threading
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
from serve_local import read_targets  # noqa: E402

COURSE_CODE = "zz-load"
TERM_CODE = "zz-load"
ID_BASE = 3000950000          # cadet i is ID_BASE + i
EMAIL_FMT = "zzload{n}@prep-staging.example"
EMAIL_LIKE = "zzload%@prep-staging.example"
KEY_VALUE = 3.7   # not 9.8: the function's own help text for an unreadable number quotes 9.8 as an example
LIMIT = 3
GRACE = 120
LEAD = 100                    # seconds from deadline being set to the deadline
BEFORE = 60                   # the busy window before the deadline
AFTER = 30                    # and after it


# ---------------------------------------------------------------------------------------------------------------
# database: fixture, counts, teardown
# ---------------------------------------------------------------------------------------------------------------
def table_counts(cur):
    """Row count of every app table and the four auth tables the fixture touches."""
    cur.execute("SELECT table_schema, table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE' "
                "AND (table_schema = 'app' OR (table_schema = 'auth' AND table_name IN "
                "('users', 'identities', 'sessions', 'refresh_tokens'))) ORDER BY 1, 2")
    out = {}
    for schema, name in cur.fetchall():
        cur.execute(f'SELECT count(*) FROM "{schema}"."{name}"')  # noqa: S608
        out[f"{schema}.{name}"] = cur.fetchone()[0]
    return out


def leftovers(cur):
    cur.execute("SELECT (SELECT count(*) FROM app.courses WHERE code = %s), (SELECT count(*) FROM app.terms WHERE code = %s), "
                "(SELECT count(*) FROM app.students WHERE student_id BETWEEN %s AND %s), "
                "(SELECT count(*) FROM auth.users WHERE email LIKE %s)",
                (COURSE_CODE, TERM_CODE, ID_BASE, ID_BASE + 9999, EMAIL_LIKE))
    c, t, s, u = cur.fetchone()
    return {"courses": c, "terms": t, "students": s, "auth_users": u}


def build_fixture(cur, n, password):
    """Course, term, offering, section, item with one numeric question, and n cadets. Returns a dict."""
    b = lib.Builder(cur)
    course = b.course(COURSE_CODE, "ZZ load")
    term = b.term(TERM_CODE, "ZZ load", starts="2026-08-01", ends="2099-12-31")
    co = b.offering(course, term, True)
    sec = b.section(co, "ZZL", ["M"])
    q_paths = [{"modality": "questions", "delivery": "online_questions", "grading": "auto_checked"}]
    due = datetime.now(timezone.utc) + timedelta(days=1)
    it = b.item(course, co, "zz-load", "ZZ load", 0, kind="homework", paths=q_paths, due=due, published=False,
                entered_on_new_page=True, attempt_limit=LIMIT, attempt_rule="best")
    q = b.question(it, "q1", "numeric", 2, key=[{"value": KEY_VALUE, "tol_pct": 2}], prompt="ZZ load: a made-up number.")
    b.publish(it)
    cadets = []
    for i in range(1, n + 1):
        cid = ID_BASE + i
        uid = b.id("user", cid)
        email = EMAIL_FMT.format(n=i)
        b.auth_user(uid, email, password)
        cur.execute("INSERT INTO students (student_id, name, email, auth_user_id) VALUES (%s, %s, %s, %s)",
                    (cid, f"Load Cadet {i}", email, uid))
        enr = b.id("enrollment", cid)
        cur.execute("INSERT INTO enrollments (id, student_id, section_id, status) VALUES (%s, %s, %s, 'active')",
                    (enr, cid, sec))
        cadets.append({"i": i, "student_id": cid, "uid": uid, "email": email, "enr": enr})
    cur.execute("SELECT id FROM question_keys WHERE question_id = %s AND superseded_at IS NULL", (q,))
    return {"course": course, "term": term, "co": co, "sec": sec, "ao": it["ao"], "q": q, "cadets": cadets,
            "key_id": cur.fetchone()[0]}


def teardown(cur):
    """Delete everything the fixture made, found by its markers, not by remembered ids. Returns rows deleted."""
    cur.execute("SET LOCAL search_path = app, public, extensions")
    done = {}

    def run(label, sql, params=()):
        cur.execute(sql, params)
        done[label] = cur.rowcount

    cur.execute("SELECT auth_user_id FROM students WHERE student_id BETWEEN %s AND %s AND email LIKE %s",
                (ID_BASE, ID_BASE + 9999, EMAIL_LIKE))
    uids = [r[0] for r in cur.fetchall() if r[0]]
    scope = ("SELECT ao.id FROM assignment_offerings ao JOIN course_offerings co ON co.id = ao.course_offering_id "
             "JOIN courses c ON c.id = co.course_id WHERE c.code = %s")
    run("question_attempts", f"DELETE FROM question_attempts WHERE assignment_offering_id IN ({scope})", (COURSE_CODE,))
    run("grades", f"DELETE FROM grades WHERE assignment_offering_id IN ({scope})", (COURSE_CODE,))
    run("assignment_offerings (cascades offering paths)",
        f"DELETE FROM assignment_offerings WHERE id IN ({scope})", (COURSE_CODE,))
    run("courses (cascades offering, section, enrollments, assignment, paths, question, key)",
        "DELETE FROM courses WHERE code = %s", (COURSE_CODE,))
    run("terms", "DELETE FROM terms WHERE code = %s", (TERM_CODE,))
    run("students", "DELETE FROM students WHERE student_id BETWEEN %s AND %s AND email LIKE %s",
        (ID_BASE, ID_BASE + 9999, EMAIL_LIKE))
    run("auth.users (cascades identities, sessions, refresh tokens)",
        "DELETE FROM auth.users WHERE id = ANY(%s::uuid[]) AND email LIKE %s", (uids, EMAIL_LIKE))
    return done


def diff_counts(before, after):
    return {k: (before.get(k, 0), after.get(k, 0)) for k in sorted(set(before) | set(after))
            if before.get(k, 0) != after.get(k, 0)}


# ---------------------------------------------------------------------------------------------------------------
# http
# ---------------------------------------------------------------------------------------------------------------
class Client:
    """One keep-alive HTTPS connection, as a browser holds one. Reconnects after any failure."""

    def __init__(self, host, anon):
        self.host, self.anon, self.conn = host, anon, None

    def _open(self):
        self.conn = http.client.HTTPSConnection(self.host, timeout=40)

    def post(self, path, body, token=None, extra_headers=None, raw=None, method="POST", send_apikey=True):
        """Returns (http_status or None, body text, seconds, error text or None, response headers dict)."""
        data = raw if raw is not None else json.dumps(body).encode()
        headers = {"Content-Type": "application/json"}
        if send_apikey:
            headers["apikey"] = self.anon
        if token:
            headers["Authorization"] = "Bearer " + token
        headers.update(extra_headers or {})
        t0 = time.time()
        for attempt in (0, 1):
            try:
                if self.conn is None:
                    self._open()
                self.conn.request(method, path, body=data if method == "POST" else None, headers=headers)
                r = self.conn.getresponse()
                text = r.read().decode("utf-8", "replace")
                return r.status, text, time.time() - t0, None, dict(r.getheaders())
            except Exception as e:  # noqa: BLE001
                try:
                    self.conn.close()
                except Exception:  # noqa: BLE001
                    pass
                self.conn = None
                if attempt == 1:
                    return None, "", time.time() - t0, type(e).__name__, {}
        return None, "", 0.0, "unreachable", {}


def sign_in(host, anon, email, password):
    req = urllib.request.Request(
        f"https://{host}/auth/v1/token?grant_type=password",
        data=json.dumps({"email": email, "password": password}).encode(),
        headers={"apikey": anon, "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read()).get("access_token"), None
    except urllib.error.HTTPError as e:
        return e.code, None, e.headers.get("Retry-After")
    except Exception as e:  # noqa: BLE001
        return None, None, type(e).__name__


# ---------------------------------------------------------------------------------------------------------------
# the plan
# ---------------------------------------------------------------------------------------------------------------
def is_right(text):
    try:
        v = float(text.strip())
    except ValueError:
        return False
    return abs(v - KEY_VALUE) <= KEY_VALUE * 0.02


GROUP_ORDER = [0, 12, 15, 17, 19, 8, 1, 13, 16, 18, 2, 9, 3, 14, 4, 10, 5, 11, 6, 7]   # first eight cover every kind


def make_plan(active, late, rng, victim_ids):
    """Events as dicts {t (seconds from the deadline), cad (index into cadets), answers [(text, forged or None)],
    pair (bool)}. Answers inside one event are sent at once when pair is true."""
    ev = []

    def at(lo, hi, dense=False):
        """A moment between lo and hi seconds from the deadline; dense puts more of them near the end."""
        u = rng.random()
        return lo + (hi - lo) * (u ** 0.5 if dense else u)

    for k, c in enumerate(active):
        g = GROUP_ORDER[k % 20]
        victim = victim_ids[(k + 1) % len(victim_ids)]
        forged = {"is_correct": True, "points": 99, "points_awarded": 99, "score": 99, "attempt_no": 7,
                  "attempts_left": 50, "student_id": victim, "enrollment_id": "00000000-0000-4000-8000-000000000001",
                  "auth_user_id": "00000000-0000-4000-8000-000000000002"}
        if g < 8:             # wrong, then right, and maybe a third try after the deadline
            t1 = at(-BEFORE, -1, True)
            ev.append({"t": t1, "cad": c["i"], "answers": [("7.1", None)], "pair": False})
            ev.append({"t": min(t1 + rng.uniform(0.5, 8), -0.5), "cad": c["i"], "answers": [("3.7", None)], "pair": False})
            if rng.random() < 0.5:
                ev.append({"t": rng.uniform(1, AFTER), "cad": c["i"], "answers": [("3.7", None)], "pair": False})
        elif g < 12:          # right twice
            t1 = at(-BEFORE, -1, True)
            ev.append({"t": t1, "cad": c["i"], "answers": [("3.7", None)], "pair": False})
            ev.append({"t": min(t1 + rng.uniform(0.5, 8), -0.5), "cad": c["i"], "answers": [("3.71", None)], "pair": False})
            if rng.random() < 0.5:
                ev.append({"t": rng.uniform(1, AFTER), "cad": c["i"], "answers": [("3.3", None)], "pair": False})
        elif g < 15:          # five wrong answers: three stored, two past the limit
            t1 = at(-BEFORE, -10, True)
            for s in range(5):
                ev.append({"t": min(t1 + s * rng.uniform(0.3, 1.5), -0.5), "cad": c["i"], "answers": [(str(2 + s), None)], "pair": False})
        elif g < 17:          # two answers at once from one cadet, twice
            t1 = at(-BEFORE, -10, True)
            ev.append({"t": t1, "cad": c["i"], "answers": [("3.7", None), ("5", None)], "pair": True})
            ev.append({"t": min(t1 + rng.uniform(1, 6), -0.5), "cad": c["i"], "answers": [("3.7", None), ("5.5", None)], "pair": True})
        elif g < 19:          # forged fields on top of a real session
            t1 = at(-BEFORE, -10, True)
            ev.append({"t": t1, "cad": c["i"], "answers": [("6", forged)], "pair": False})
            ev.append({"t": min(t1 + rng.uniform(0.5, 6), -0.5), "cad": c["i"],
                       "answers": [("3.7", dict(forged, is_correct=False, points=0, points_awarded=0, score=0))], "pair": False})
        else:                 # unreadable answers cost nothing; then one real answer
            t1 = at(-BEFORE, -10, True)
            ev.append({"t": t1, "cad": c["i"], "answers": [("abc", None)], "pair": False})
            ev.append({"t": t1 + 0.5, "cad": c["i"], "answers": [("x" * 300, None)], "pair": False})
            ev.append({"t": min(t1 + rng.uniform(1, 6), -0.5), "cad": c["i"], "answers": [("3.70", None)], "pair": False})
    for c in late:            # the burst around the end of the grace (deadline + 120 s)
        ev.append({"t": rng.uniform(GRACE - 15, GRACE + 15), "cad": c["i"], "answers": [("8", None)], "pair": False})
        ev.append({"t": rng.uniform(GRACE - 15, GRACE + 15), "cad": c["i"], "answers": [("3.7", None)], "pair": False})
    ev.sort(key=lambda e: e["t"])
    return ev


def pct(vals, p):
    if not vals:
        return 0.0
    s = sorted(vals)
    return s[min(len(s) - 1, int(len(s) * p))]


# ---------------------------------------------------------------------------------------------------------------
# the run
# ---------------------------------------------------------------------------------------------------------------
class Run:
    def __init__(self, fx, host, anon, tokens, d_local, threads):
        self.fx, self.host, self.anon, self.tokens, self.d_local, self.nthreads = fx, host, anon, tokens, d_local, threads
        self.lock = threading.Lock()
        self.records = []     # legit traffic
        self.abuse = []       # deliberately bad requests
        self.lag = []
        self.path = "/functions/v1/check-answer"

    def body(self, text, forged):
        b = {"assignment_offering_id": self.fx["ao"], "question_id": self.fx["q"], "answer": text}
        if forged:
            b.update(forged)
        return b

    def one(self, client, cad_i, text, forged, sched_t, tag):
        tok = self.tokens[cad_i]
        status, body, dt, err, headers = client.post(self.path, self.body(text, forged), token=tok)
        code = None
        parsed = None
        if status == 200:
            try:
                parsed = json.loads(body)
                code = "ok" if parsed.get("ok") else parsed.get("code")
            except ValueError:
                code = "unparseable"
        rec = {"cad": cad_i, "text": text, "forged": bool(forged), "status": status, "code": code, "err": err,
               "dt": dt, "sched": sched_t, "sent": time.time(), "body": body, "parsed": parsed, "tag": tag,
               "hdrs": json.dumps(headers)}
        with self.lock:
            self.records.append(rec)

    def worker(self, events, cursor):
        client = Client(self.host, self.anon)
        first = True
        while True:
            with self.lock:
                if cursor[0] >= len(events):
                    return
                e = events[cursor[0]]
                cursor[0] += 1
            target = self.d_local + e["t"]
            wait = target - time.time()
            if wait > 0:
                time.sleep(wait)
            else:
                with self.lock:
                    self.lag.append(-wait)
            tag = "first" if first else ""
            first = False
            if e["pair"]:
                helper = threading.Thread(target=self.one, args=(Client(self.host, self.anon), e["cad"], e["answers"][1][0],
                                                                 e["answers"][1][1], e["t"], "pair"))
                helper.start()
                self.one(client, e["cad"], e["answers"][0][0], e["answers"][0][1], e["t"], "pair")
                helper.join()
            else:
                self.one(client, e["cad"], e["answers"][0][0], e["answers"][0][1], e["t"], tag)

    def go(self, events):
        cursor = [0]
        ts = [threading.Thread(target=self.worker, args=(events, cursor)) for _ in range(self.nthreads)]
        [t.start() for t in ts]
        [t.join() for t in ts]

    def abuse_requests(self, a_token):
        """Requests that must all be refused: no credential, a damaged one, wrong method, bad bodies."""
        c = Client(self.host, self.anon)
        good = self.body("3.7", None)
        damaged = a_token[:-6] + ("AAAAAA" if not a_token.endswith("AAAAAA") else "BBBBBB")
        cases = [
            ("no credential at all", dict(body=good, token=None, send_apikey=False)),
            ("key header only, no session", dict(body=good, token=None)),
            ("publishable key as the session", dict(body=good, token=self.anon)),
            ("session with damaged signature", dict(body=good, token=damaged)),
            ("session text that is not a token", dict(body=good, token="not-a-token")),
            ("GET instead of POST", dict(body=None, token=a_token, method="GET")),
            ("body that is not JSON", dict(body=None, raw=b"{not json", token=a_token)),
            ("body larger than the limit", dict(body=None, raw=json.dumps({**good, "pad": "x" * 3000}).encode(), token=a_token)),
            ("ids that are not ids", dict(body={"assignment_offering_id": "x", "question_id": "y", "answer": "3.7"}, token=a_token)),
            ("another question id", dict(body={**good, "question_id": "11111111-1111-4111-8111-111111111111"}, token=a_token)),
            ("another offering id", dict(body={**good, "assignment_offering_id": "11111111-1111-4111-8111-111111111111"}, token=a_token)),
            ("answer that is a list for a number", dict(body={**good, "answer": ["3.7"]}, token=a_token)),
        ]
        for name, kw in cases:
            status, body, dt, err, hdrs = c.post(self.path, kw.pop("body"), **kw)
            self.abuse.append({"name": name, "status": status, "body": body[:300], "dt": dt, "err": err, "hdrs": json.dumps(hdrs)})
            time.sleep(0.2)


def sample_pool(url, stop, out):
    """Connection use, read-only, every 2 seconds, from a separate connection."""
    import psycopg2
    try:
        conn = psycopg2.connect(url, connect_timeout=15)
        conn.set_session(readonly=True, autocommit=True)
        cur = conn.cursor()
        cur.execute("SHOW max_connections")
        out["max_connections"] = int(cur.fetchone()[0])
    except Exception as e:  # noqa: BLE001
        out["error"] = type(e).__name__ + ": " + str(e).strip().splitlines()[0][:100]
        return
    out["samples"] = []
    while not stop.is_set():
        try:
            cur.execute("SELECT count(*), count(*) FILTER (WHERE state = 'active'), "
                        "count(*) FILTER (WHERE usename = 'authenticator'), count(*) FILTER (WHERE usename = 'service_role' OR usename = 'supabase_auth_admin') "
                        "FROM pg_stat_activity WHERE datname = current_database()")
            out["samples"].append((time.time(),) + cur.fetchone())
        except Exception as e:  # noqa: BLE001
            out["error"] = type(e).__name__
            return
        stop.wait(2)
    conn.close()


# ---------------------------------------------------------------------------------------------------------------
# checks
# ---------------------------------------------------------------------------------------------------------------
RESULTS = []
# the key is 3.7; a number is not the key when a digit or a dot touches it (a timing header, a version string)
LEAK = re.compile(r"(?<![\d.])3\.7(?![\d])|tol_|correct_choice|key_version|eyJ[A-Za-z0-9_-]{20,}|sb_secret|service_role")


def check(name, ok, detail=""):
    RESULTS.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))


def verify(cur, fx, run, due_at):
    cur.execute("SET search_path = app, public, extensions")
    recs = run.records
    ok_recs = [r for r in recs if r["code"] == "ok"]
    # 1 attempts per cadet and per question
    cur.execute("SELECT coalesce(max(n), 0) FROM (SELECT count(*) n FROM question_attempts WHERE assignment_offering_id = %s "
                "GROUP BY enrollment_id, question_id) s", (fx["ao"],))
    check(f"no cadet has more than {LIMIT} attempts", cur.fetchone()[0] <= LIMIT)
    cur.execute("SELECT count(*) FROM (SELECT enrollment_id, max(attempt_no) m, count(*) c FROM question_attempts "
                "WHERE assignment_offering_id = %s GROUP BY 1) s WHERE m <> c", (fx["ao"],))
    check("attempt numbers have no gaps and no repeats", cur.fetchone()[0] == 0)
    # 2 deadline
    cur.execute("SELECT max(answered_at), count(*) FILTER (WHERE answered_at > %s), count(*) FILTER (WHERE answered_at > %s) "
                "FROM question_attempts WHERE assignment_offering_id = %s",
                (due_at, due_at + timedelta(seconds=GRACE), fx["ao"]))
    last, after_due, after_grace = cur.fetchone()
    check("no attempt stored later than the deadline plus the 120 second grace", after_grace == 0,
          f"{after_due} stored after the deadline and inside the grace")
    # 3 ledger: DB attempts = replies that said ok
    cur.execute("SELECT a.attempt_no, a.is_correct, a.points_awarded, a.answer ->> 'raw', e.student_id "
                "FROM question_attempts a JOIN enrollments e ON e.id = a.enrollment_id WHERE a.assignment_offering_id = %s", (fx["ao"],))
    db = {}
    for no, corr, pts, raw, sid in cur.fetchall():
        db[(sid, no)] = (corr, float(pts), raw)
    by_i = {c["i"]: c for c in fx["cadets"]}
    seen, bad = set(), []
    for r in ok_recs:
        sid = by_i[r["cad"]]["student_id"]
        no = r["parsed"].get("attempt_no")
        row = db.get((sid, no))
        want = is_right(r["text"])
        if (sid, no) in seen:
            bad.append("duplicate attempt number in replies")
        seen.add((sid, no))
        if row is None:
            bad.append("reply ok but no row")
        elif not (row[0] == want == (r["parsed"].get("correct") is True) and row[2] == r["text"] and row[1] == (2.0 if want else 0.0)):
            bad.append("row differs from reply or from the answer's own correctness")
    check("every reply that said ok matches one stored attempt (answer, verdict, points)", not bad, f"{len(bad)} differ, {len(ok_recs)} replies")
    check("every stored attempt was reported ok to its own cadet (count equal, none for anyone else)",
          len(db) == len(ok_recs) == len(seen), f"stored {len(db)}, ok replies {len(ok_recs)}")
    # 4 grades
    cur.execute("SELECT e.student_id, g.points_earned, g.points_possible, g.source, g.is_finalized FROM grades g "
                "JOIN enrollments e ON e.id = g.enrollment_id WHERE g.assignment_offering_id = %s", (fx["ao"],))
    grades = {r[0]: r for r in cur.fetchall()}
    cur.execute("SELECT e.student_id, coalesce(max(a.points_awarded), 0) FROM question_attempts a JOIN enrollments e ON e.id = a.enrollment_id "
                "WHERE a.assignment_offering_id = %s GROUP BY 1", (fx["ao"],))
    best = {r[0]: float(r[1]) for r in cur.fetchall()}
    wrong = [s for s, g in grades.items() if float(g[1]) != min(best.get(s, 0.0), float(g[2]))]
    check("each grade equals the best attempt, recomputed here", not wrong and set(grades) == set(best),
          f"{len(grades)} grades, {len(wrong)} differ, {len(set(best) ^ set(grades))} missing or extra")
    check("each grade is auto_checked and final, one per cadet", all(g[3] == "auto_checked" and g[4] for g in grades.values()))
    # 5 forged fields
    forged_ok = [r for r in ok_recs if r["forged"]]
    cur.execute("SELECT count(*) FROM question_attempts WHERE assignment_offering_id = %s AND attempt_no > %s", (fx["ao"], LIMIT))
    check("forged fields changed nothing: stored verdicts follow the answers, attempt numbers are the database's, nobody else was credited",
          not bad and cur.fetchone()[0] == 0 and all(r["parsed"]["correct"] == is_right(r["text"]) for r in forged_ok),
          f"{len(forged_ok)} forged requests accepted as ordinary answers")
    # 6 the key
    leaks = []
    allowed_ok = {"ok", "correct", "attempt_no", "attempts_left"}
    allowed_no = {"ok", "code", "error"}
    for r in recs:
        if r["status"] == 200 and r["parsed"] is not None:
            keys = set(r["parsed"])
            if not (keys <= allowed_ok if r["parsed"].get("ok") else keys <= allowed_no):
                leaks.append("extra field")
        for where, txt in (("body", r["body"]), ("headers", r["hdrs"])):
            m = LEAK.search(txt)
            if m:
                leaks.append(f"{where}: pattern {m.re.pattern[:20]!r}" + (f" in context {txt[max(0, m.start() - 25):m.end() + 10]!r}" if where == "headers" else ""))
    for a in run.abuse:
        for where, txt in (("body", a["body"]), ("headers", a["hdrs"])):
            m = LEAK.search(txt)
            if m:
                leaks.append(f"refusal {where}: pattern {m.re.pattern[:20]!r}" + (f" in context {txt[max(0, m.start() - 25):m.end() + 10]!r}" if where == "headers" else ""))
    check("no reply body or header held the key, a tolerance, or a token", not leaks,
          f"{len(recs) + len(run.abuse)} replies read" + (f"; {len(leaks)} matches, first: {leaks[0]}" if leaks else ""))
    return len(ok_recs), len(db)


def fetch_logs(ref, started, ended):
    token, env_ref = os.environ.get("SUPABASE_ACCESS_TOKEN", ""), os.environ.get("STAGING_PROJECT_REF", "")
    if not token or env_ref != ref:
        return None, "no access token for the staging project in this environment"
    found = {"rows": 0, "hits": 0}
    for table in ("function_logs", "function_edge_logs"):
        sql = f"select timestamp, event_message, metadata from {table} order by timestamp desc limit 1000"
        stamp = "%Y-%m-%dT%H:%M:%SZ"
        qs = urllib.parse.urlencode({"sql": sql, "iso_timestamp_start": started.strftime(stamp), "iso_timestamp_end": ended.strftime(stamp)})
        req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{ref}/analytics/endpoints/logs?{qs}",
                                     headers={"Authorization": "Bearer " + token, "User-Agent": "prep-load-check"})
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                data = json.loads(r.read())
        except urllib.error.HTTPError as e:
            return None, f"{table}: HTTP {e.code}"
        except Exception as e:  # noqa: BLE001
            return None, f"{table}: {type(e).__name__}"
        if data.get("error"):
            return None, f"{table}: {str(data['error'])[:80]}"
        rows = data.get("result") or []
        found["rows"] += len(rows)
        for row in rows:
            if re.search(r"eyJ[A-Za-z0-9_-]{20,}|sb_secret|service_role_key|tol_pct|correct_choice_ids|9\.8", json.dumps(row)):
                found["hits"] += 1
    return found, None


# ---------------------------------------------------------------------------------------------------------------
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expect-ref", required=True)
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--cadets", type=int, default=150)
    ap.add_argument("--threads", type=int, default=16)
    ap.add_argument("--signin-budget", type=int, default=900, help="seconds allowed for signing cadets in")
    ap.add_argument("--cleanup-only", action="store_true")
    ap.add_argument("--out", help="write the numbers as JSON here (outside the repo)")
    args = ap.parse_args(argv)
    if not 8 <= args.threads <= 16 and args.commit and not args.cleanup_only:
        sys.exit("REFUSED  use 8 to 16 threads.")

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
        before = table_counts(cur)
        print("deleted", teardown(cur))
        conn.commit()
        print("left over", leftovers(cur))
        return 0

    left = leftovers(cur)
    if any(left.values()):
        sys.exit(f"REFUSED  made-up rows from an earlier run are still there: {left}. Run with --cleanup-only --commit first.")
    base = table_counts(cur)
    conn.rollback()

    password = secrets.token_urlsafe(14)          # held in memory only; the accounts are deleted at the end

    # ---- dry run: build a small fixture, run the delete route, compare counts, roll back -------------------------
    if not args.commit:
        fx = build_fixture(cur, min(args.cadets, 3), password)
        mid = table_counts(cur)
        print(f"built    {len(fx['cadets'])} made-up cadets, 1 item, 1 question (not committed)")
        print("deleted ", teardown(cur))
        after = table_counts(cur)
        d = diff_counts(base, after)
        print("counts after the delete route differ from before in:", d or "nothing")
        conn.rollback()
        print("rolled back. Nothing written.")
        return 0 if not d else 1

    # ---- the real run --------------------------------------------------------------------------------------------
    n = args.cadets
    started = datetime.now(timezone.utc)
    code = 0
    fx = None
    try:
        fx = build_fixture(cur, n, password)
        conn.commit()
        print(f"built    {n} made-up cadets, 1 item (limit {LIMIT}), 1 numeric question; committed")

        # sign-in, spaced; stop at the budget
        tokens, t_start, gap, throttled, first_429 = {}, time.time(), 0.35, 0, None
        for c in fx["cadets"]:
            while time.time() - t_start < args.signin_budget:
                st, tok, extra = sign_in(host, anon, c["email"], password)
                if st == 200 and tok:
                    tokens[c["i"]] = tok
                    break
                if st == 429:
                    throttled += 1
                    first_429 = first_429 or len(tokens)
                    wait = float(extra) if extra and str(extra).replace(".", "").isdigit() else min(60, 10 + 5 * throttled)
                    time.sleep(min(wait, 60))
                    continue
                print(f"  sign-in refused for one cadet: HTTP {st} {extra or ''}")
                break
            else:
                break
            time.sleep(gap)
        reached = len(tokens)
        print(f"signed in {reached} of {n} cadets in {time.time() - t_start:.0f}s; rate-limit replies {throttled}"
              + (f" (first after {first_429} sign-ins)" if first_429 is not None else ""))
        if reached < 4:
            raise RuntimeError("fewer than 4 cadets could sign in; stopping")
        cadets = [c for c in fx["cadets"] if c["i"] in tokens]

        # the deadline, set now that nobody has to be signed in
        cur.execute("SELECT extract(epoch from now())")
        t_local = time.time()
        skew = float(cur.fetchone()[0]) - t_local
        cur.execute("SET LOCAL search_path = app, public, extensions")
        live = lib.triggers_off(cur, "assignment_offerings", ("assignment_offerings_new_paths_stay_unpublished", "assignment_offerings_new_stay_unpublished"))
        cur.execute("UPDATE app.assignment_offerings SET due_at = now() + make_interval(secs => %s), due_by_day = '{}'::jsonb "
                    "WHERE id = %s RETURNING due_at", (LEAD, fx["ao"]))
        due_at = cur.fetchone()[0]
        lib.triggers_on(cur, "assignment_offerings", live)
        conn.commit()
        d_local = due_at.timestamp() - skew
        print(f"deadline set {d_local - time.time():.0f}s ahead (database clock differs from this machine's by {skew * 1000:+.0f} ms)")

        rng = random.Random(20261106)
        n_late = max(2, reached // 12)
        late, active = cadets[-n_late:], cadets[:-n_late]
        events = make_plan(active, late, rng, [c["student_id"] for c in cadets])
        total_req = sum(len(e["answers"]) for e in events)
        run = Run(fx, host, anon, tokens, d_local, args.threads)
        print(f"plan     {len(events)} events, {total_req} requests from {args.threads} threads "
              f"({len(active)} cadets in the last minute and after, {len(late)} around the end of the grace)")

        pool, stop = {}, threading.Event()
        sampler = threading.Thread(target=sample_pool, args=(url, stop, pool))
        sampler.start()

        # cold start: the first request to the function in this run, an unreadable answer, which costs no attempt
        probe = Client(host, anon)
        run.one(probe, cadets[0]["i"], "abc", None, -99, "cold")
        cold = run.records.pop()
        print(f"cold start probe: HTTP {cold['status']} {cold['code']} in {cold['dt'] * 1000:.0f} ms")
        # abuse, spread before the busy minute
        while time.time() < d_local - BEFORE - 12:
            time.sleep(0.5)
        run.abuse_requests(tokens[cadets[0]["i"]])
        run.go(events)
        while time.time() < d_local + GRACE + 20:
            time.sleep(1)
        stop.set()
        sampler.join()
        ended = datetime.now(timezone.utc)

        # ---- report: traffic --------------------------------------------------------------------------------------
        recs = run.records
        lat = [r["dt"] for r in recs if r["status"] is not None]
        by_status, by_code = {}, {}
        for r in recs:
            by_status[str(r["status"] or r["err"])] = by_status.get(str(r["status"] or r["err"]), 0) + 1
            by_code[r["code"] or str(r["status"] or r["err"])] = by_code.get(r["code"] or str(r["status"] or r["err"]), 0) + 1
        bad = [r for r in recs if r["status"] != 200]
        firsts = [r["dt"] for r in recs if r["tag"] == "first"]
        pair_n = sum(1 for r in recs if r["tag"] == "pair")
        print(f"\ntraffic  {len(recs)} requests ({pair_n} in simultaneous pairs); abuse {len(run.abuse)} more")
        print(f"latency  median {pct(lat, .5) * 1000:.0f} ms, p95 {pct(lat, .95) * 1000:.0f} ms, p99 {pct(lat, .99) * 1000:.0f} ms, max {max(lat) * 1000:.0f} ms")
        print(f"         first request of each thread: median {pct(firsts, .5) * 1000:.0f} ms, max {max(firsts) * 1000:.0f} ms" if firsts else "")
        print(f"         cold probe {cold['dt'] * 1000:.0f} ms; sends later than planned: median {pct(run.lag, .5) * 1000:.0f} ms, max {max(run.lag or [0]) * 1000:.0f} ms")
        print(f"http     {by_status}")
        print(f"outcome  {by_code}")
        print(f"error rate: {len(bad)} of {len(recs)} legitimate requests were not HTTP 200 ({100 * len(bad) / max(1, len(recs)):.2f}%); "
              f"transport failures {sum(1 for r in recs if r['status'] is None)}")
        for a in run.abuse:
            try:
                what = json.loads(a["body"]).get("code") or json.loads(a["body"]).get("message") or "?"
            except ValueError:
                what = "?"
            a["what"] = what
        print("abuse    " + "; ".join(f"{a['name']}: HTTP {a['status'] or a['err']} {a['what']}" for a in run.abuse))
        refused = all((a["status"] in (400, 401, 403)) or (a["status"] == 200 and '"ok":false' in a["body"].replace(" ", "")) for a in run.abuse)
        samples = pool.get("samples") or []
        if samples:
            print(f"database connections (max_connections {pool.get('max_connections')}): total min {min(s[1] for s in samples)}, "
                  f"max {max(s[1] for s in samples)}; active max {max(s[2] for s in samples)}; "
                  f"authenticator max {max(s[3] for s in samples)}; {len(samples)} samples")
        else:
            print(f"database connections: not readable ({pool.get('error')})")

        # ---- report: database invariants -------------------------------------------------------------------------
        print()
        verify(cur, fx, run, due_at)
        limit_replies = by_code.get("limit_reached", 0)
        closed = by_code.get("closed", 0)
        check("every deliberately bad request was refused", refused)
        check("retries past the limit were refused", limit_replies > 0, f"limit_reached {limit_replies}")
        check("work after the end of the grace was refused", closed > 0, f"closed {closed}")
        odd = sorted(k for k in by_code if k in ("not_signed_in", "not_enrolled", "not_open", "key_fault", "not_found",
                                                  "bad_request", "unparseable", "None"))
        check("no legitimate request was refused as signed out, not enrolled, not open, faulty or not found", not odd, str(odd))
        logs, why = fetch_logs(ref, started - timedelta(minutes=2), ended + timedelta(minutes=2))
        if logs is None:
            print(f"NOTE  function logs not read: {why}")
        else:
            check("function logs hold no token, key text or tolerance", logs["hits"] == 0, f"{logs['rows']} log rows read")
        if args.out:
            Path(args.out).write_text(json.dumps({
                "cadets": n, "signed_in": reached, "requests": len(recs), "median_ms": pct(lat, .5) * 1000,
                "p95_ms": pct(lat, .95) * 1000, "cold_ms": cold["dt"] * 1000, "http": by_status, "outcome": by_code,
                "pool": {"max_connections": pool.get("max_connections"), "samples": samples},
                "results": [(a, b, c) for a, b, c in RESULTS]}, default=str), encoding="utf-8")
        code = 0 if all(r[1] for r in RESULTS) else 1
    except Exception as exc:  # noqa: BLE001
        print(f"STOPPED  {type(exc).__name__}: {str(exc).strip().splitlines()[0] if str(exc).strip() else ''}")
        code = 2
    finally:
        # ---- always: delete everything made -----------------------------------------------------------------------
        try:
            conn.rollback()
            cur = conn.cursor()
            print("\ndeleting what this run made")
            for k, v in teardown(cur).items():
                print(f"  deleted {v:>6}  {k}")
            conn.commit()
            after = table_counts(cur)
            conn.rollback()
            d = diff_counts(base, after)
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
