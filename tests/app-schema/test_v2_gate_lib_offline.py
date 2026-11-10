"""Offline test of the test-cadet email in scripts/staging/v2_gate_lib.py. No database, no network.

WHAT THIS DEFENDS
  * Two different cadet ids that share their last four digits never get the same sign-in address, so
    inserting the second cannot fail on a unique email.
  * An address that already exists is never reused for a different cadet, whatever order they arrive in.
  * The seeded cadets keep the short address their logins use (cadet0501@ and so on) when it is free,
    and a cadet that is created twice keeps its own address.

WHAT THIS CANNOT PROVE
  That the database accepts the rows. A fake cursor stands in for it and enforces one rule: an email
  is held by one cadet only, as the unique columns do.

Run:  python tests/app-schema/test_v2_gate_lib_offline.py
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, "..", "..", "scripts", "staging")))
import v2_gate_lib as lib  # noqa: E402

failures = []


def check(label, ok):
    print(("ok   " if ok else "FAIL ") + label)
    if not ok:
        failures.append(label)


class FakeCursor:
    """Knows two tables: students (student_id -> email) and auth.users (id -> email). Unique emails."""

    def __init__(self):
        self.students, self.users, self._rows = {}, {}, []

    def execute(self, sql, params=()):
        s = " ".join(sql.split())
        if s.startswith("SET LOCAL"):
            self._rows = []
        elif "information_schema.columns" in s:
            self._rows = [(1,)]          # auth.users has an email column, as on the real project
        elif s.startswith("SELECT 1 FROM students"):
            email, sid, _e2, uid = params
            hit = any(e.lower() == email.lower() and k != sid for k, e in self.students.items()) or \
                any(e.lower() == email.lower() and k != uid for k, e in self.users.items())
            self._rows = [(1,)] if hit else []
        elif s.startswith("INSERT INTO auth.users"):
            uid, email = params[0], params[1]
            if any(e.lower() == email.lower() for k, e in self.users.items() if k != uid):
                raise RuntimeError("duplicate auth email")
            self.users.setdefault(uid, email)
        elif s.startswith("INSERT INTO students"):
            sid, _name, email, _uid = params
            if any(e.lower() == email.lower() for k, e in self.students.items() if k != sid):
                raise RuntimeError("duplicate student email")
            self.students.setdefault(sid, email)
        else:
            self._rows = []

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return list(self._rows)


def make():
    cur = FakeCursor()
    return cur, lib.Builder(cur, ns=None)


def user_insert_params_ok():
    return True


# Two cadets whose ids end in the same four digits, with sign-in and without.
cur, b = make()
try:
    b.cadet(3000000501, "Trial One", "sec", with_auth=False)
    b.cadet(3000010501, "Trial Two", "sec", with_auth=False)
    check("two cadets sharing their last four digits both insert", True)
except RuntimeError as e:
    check(f"two cadets sharing their last four digits both insert ({e})", False)
check("their addresses differ", len(set(cur.students.values())) == len(cur.students) == 2)

cur, b = make()
try:
    b.cadet(3000000501, "Trial One", "sec", password="x", with_auth=True)
    b.cadet(3000010501, "Trial Two", "sec", password="x", with_auth=True)
    check("the same with sign-in accounts", True)
except RuntimeError as e:
    check(f"the same with sign-in accounts ({e})", False)

# The free short address is kept, so existing logins still work.
cur, b = make()
b.cadet(3000000501, "Trial One", "sec", with_auth=False)
check("a free short address is kept", cur.students[3000000501] == f"cadet0501@{lib.DOMAIN}")

# An address taken by another cadet beforehand is not reused, whichever way round.
cur, b = make()
cur.students[3999990501] = f"cadet0501@{lib.DOMAIN}"
b.cadet(3000000501, "Trial One", "sec", with_auth=False)
check("an address already held by another cadet is not reused",
      cur.students[3000000501] != cur.students[3999990501])

# The same cadet created twice keeps its own address and does not raise.
cur, b = make()
b.cadet(3000000501, "Trial One", "sec", with_auth=False)
first = cur.students[3000000501]
b.cadet(3000000501, "Trial One", "sec", with_auth=False)
check("creating the same cadet again keeps its address", cur.students[3000000501] == first)

# Many cadets that all share a suffix.
cur, b = make()
for i in range(25):
    b.cadet(3000000000 + i * 10000 + 77, f"Trial {i}", "sec", with_auth=False)
check("25 cadets sharing a suffix all get different addresses", len(set(cur.students.values())) == 25)

check("every address is a plain lowercase address",
      all(re.fullmatch(r"cadet\d+@[a-z.\-]+", e) for e in cur.students.values()))

if failures:
    print(f"\n{len(failures)} failed")
    sys.exit(1)
print("\nall passed")
