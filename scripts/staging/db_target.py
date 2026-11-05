"""One reading of a Postgres connection URL, shared by every staging tool and the test suites.

The question every caller needs answered is "which project does this URL reach", and the answer
has to match what the client library does with the same text. A guard that reads the URL one way
while libpq reads it another way is a guard that can be walked around, so this parser is strict:
anything it does not fully understand is refused, never guessed at.

What it accepts
  postgres[ql]://[user[:password]@]host[:port][/dbname][?sslmode=...]

The project ref comes from the user (`postgres.<ref>`, the pooler form) or from the host
(`db.<ref>.supabase.co`, the direct form). When both name a ref they must agree.

What it refuses (DbTargetError, whose text starts with REFUSED)
  * a `%` in the user or the host (the library would decode it, and this reader would not);
  * more than one `@` in the authority (the library and this reader would split it differently);
  * a query key other than `sslmode`: `user`, `host`, `hostaddr`, `dbname`, `service`, `options`
    and anything else the library lets override the authority;
  * any host that is not `<name>.pooler.supabase.com` or exactly `db.<ref>.supabase.co`, in lower
    case and with no trailing dot (an allow-list; everything else is refused);
  * an empty host (the library would fall back to an environment variable);
  * a ref written with capitals, a list of hosts, brackets, whitespace, or a user and host that
    name different projects.
Passwords may hold percent escapes; they are never interpreted here.

The same rule is written in tests/app-schema/target.mjs and read by tests/app-schema/staging_guard.py.
"""
import re
import sys

STAGING_REF = "wkibeptktbnaddfynrwr"
PRODUCTION_REF = "shzvpmlnqfmzfmuxkowi"

_USER_REF = re.compile(r"postgres\.([A-Za-z0-9]+)")
_HOST_DIRECT = re.compile(r"db\.([a-z0-9]+)\.supabase\.co")
_HOST_POOLER = re.compile(r"[a-z0-9-]+(?:\.[a-z0-9-]+)*\.pooler\.supabase\.com")
_DBNAME = re.compile(r"[A-Za-z0-9_.\-]*")


class DbTargetError(ValueError):
    pass


def _refuse(why):
    raise DbTargetError(f"REFUSED: {why}")


class Target:
    """The parts of a URL the tools need. The password is deliberately not kept here."""

    def __init__(self, ref, user, host, port, dbname):
        self.ref, self.user, self.host, self.port, self.dbname = ref, user, host, port, dbname

    def __repr__(self):
        return f"Target(ref={self.ref!r}, host={self.host!r}, dbname={self.dbname!r})"


def parse(url):
    """Return a Target, or raise DbTargetError. Never returns a Target without a ref."""
    if not isinstance(url, str) or not url:
        _refuse("the database URL is empty")
    if re.search(r"\s", url) or "#" in url:
        _refuse("the database URL holds whitespace or a fragment")
    m = re.fullmatch(r"postgres(?:ql)?://([^/?]*)(/[^?]*)?(?:\?(.*))?", url)
    if not m:
        _refuse("the database URL is not a postgres:// URL")
    authority, path, query = m.group(1), m.group(2) or "", m.group(3)

    if query:
        for pair in query.split("&"):
            key = pair.split("=", 1)[0]
            if key != "sslmode":
                _refuse("the database URL carries a query key other than sslmode")

    if authority.count("@") > 1:
        _refuse("the database URL holds more than one '@' in its authority")
    userinfo, _, hostport = authority.rpartition("@") if "@" in authority else ("", "", authority)
    user = userinfo.split(":", 1)[0]
    if "%" in user or "%" in hostport:
        _refuse("the user or host holds a percent escape")
    if any(c in hostport for c in "[],") or hostport.count(":") > 1:
        _refuse("the host is a list or a bracketed address")
    host, _, port = hostport.partition(":")
    if not host:
        _refuse("the database URL names no host")
    if port and not re.fullmatch(r"[0-9]{1,5}", port):
        _refuse("the port is not a number")

    dbname = path[1:] if path else ""
    if not _DBNAME.fullmatch(dbname):
        _refuse("the database name holds characters this reader does not accept")

    refs = set()
    um = _USER_REF.fullmatch(user)
    if um:
        if um.group(1) != um.group(1).lower():
            _refuse("the project ref in the user is not lower case")
        refs.add(um.group(1))
    hm = _HOST_DIRECT.fullmatch(host)
    if hm:
        refs.add(hm.group(1))
    elif not _HOST_POOLER.fullmatch(host):
        _refuse("the host is neither a pooler address nor db.<ref>.supabase.co in lower case")
    if len(refs) > 1:
        _refuse("the user and the host name different projects")
    if not refs:
        _refuse("the database URL names no project ref")
    return Target(refs.pop(), user, host, port, dbname)


def ref_of(url):
    """The project ref, or None when the URL is refused."""
    try:
        return parse(url).ref
    except DbTargetError:
        return None


def require_staging(url, expect=None):
    """Return the Target only when its ref is exactly the staging ref. Anything else is refused.

    `expect` is the operator's --expect-ref. It is a second confirmation, never a widening: it
    must itself equal the staging ref.
    """
    t = parse(url)
    if t.ref != STAGING_REF:
        _refuse(f"the database URL does not name the staging project ({STAGING_REF})")
    if expect is not None and expect != STAGING_REF:
        _refuse(f"--expect-ref is not the staging project ({STAGING_REF})")
    return t


def exit_unless_staging(url, expect=None):
    """For scripts: the Target, or exit with the refusal text."""
    try:
        return require_staging(url, expect)
    except DbTargetError as exc:
        sys.exit(str(exc))


def with_dbname(url, dbname):
    """The same URL pointed at another database on the same server."""
    t = parse(url)
    if not re.fullmatch(r"[A-Za-z0-9_]+", dbname):
        _refuse("database name must be letters, digits and underscores")
    m = re.fullmatch(r"(postgres(?:ql)?://[^/?]*)(/[^?]*)?(\?.*)?", url)
    assert m and t
    return f"{m.group(1)}/{dbname}{m.group(3) or ''}"
