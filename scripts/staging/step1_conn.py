"""One way for the step 1 tools to name a database. Standard library, plus psycopg2 only when connecting.

Every step 1 tool takes its connection from a file named on the command line, as
scripts/checks/name_scan.py does with --env-file. Nothing here ever prints a password, a URL, or a host.

THE THREE WAYS TO NAME A DATABASE (exactly one is required)
  --env-file PATH   (alias --dotenv)  a file of KEY=VALUE lines. Two shapes are read:
                      * the production shape: PREP_DB_HOST, PREP_DB_PORT, PREP_DB_NAME, PREP_DB_SSLMODE,
                        PREP_PROJECT_REF, and PREP_APP_<TIER>_ROLE / PREP_APP_<TIER>_PASSWORD, where <TIER>
                        is READ, DML or OWNER (picked by --tier);
                      * a single URL under --url-key (default STAGING_DB_URL).
  --url-env NAME    the NAME of an environment variable that holds a postgres:// URL (the launcher sets it).

WHICH PROJECT   Read the same way schema_fingerprint.py reads it: db_target.py for a URL, PREP_PROJECT_REF for the
                production shape, and a host that contains the live ref counts as the live project whatever the ref
                key says. The live project is refused unless the caller passes its own flag (a read flag for read
                tools, a write flag for tools that change data). Any other project is refused, so a scratch database
                on the staging server is accepted and a stranger's server is not.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db_target  # noqa: E402

TIERS = ("read", "dml", "owner")


def refuse(msg):
    sys.exit(f"REFUSED  {msg}")


def read_env_file(path):
    """KEY=VALUE lines. Blank lines and # comments are skipped; one pair of quotes is removed."""
    p = Path(path)
    if not p.is_file():
        refuse(f"the env file {p.name} does not exist.")
    out = {}
    for raw in p.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        out[key.strip()] = val
    return out


def add_args(ap, tier_default="read", tier_fixed=False):
    """Add the connection options to a parser. Returns nothing; read them back with resolve()."""
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--env-file", "--dotenv", dest="env_file", metavar="PATH",
                   help="a file of KEY=VALUE lines naming the database (see step1_conn.py)")
    g.add_argument("--url-env", metavar="NAME", help="NAME of an environment variable holding a postgres:// URL")
    ap.add_argument("--url-key", default="STAGING_DB_URL",
                    help="the key that holds a URL, when --env-file has that shape (default STAGING_DB_URL)")
    if not tier_fixed:
        ap.add_argument("--tier", choices=TIERS, default=tier_default,
                        help=f"which role of the production-shaped file to use (default {tier_default})")


class Spec:
    """What a tool needs to connect and to decide whether it may. The password lives only in `_kw`."""

    def __init__(self, ref, kind, kwargs=None, url=None):
        self.ref, self.kind, self._kw, self._url = ref, kind, kwargs, url

    def connect(self):
        import psycopg2
        if self.kind == "url":
            return psycopg2.connect(self._url, connect_timeout=15)
        return psycopg2.connect(connect_timeout=15, **self._kw)

    @property
    def url(self):
        """The URL when the connection was a URL; None for the production shape. Used to point at a scratch database."""
        return self._url


def from_env_dict(env, tier, url_key):
    """Pure: turn a parsed env file into a Spec or exit. No network."""
    if env.get("PREP_DB_HOST"):
        for need in ("PREP_PROJECT_REF", f"PREP_APP_{tier.upper()}_ROLE", f"PREP_APP_{tier.upper()}_PASSWORD"):
            if not env.get(need, "").strip():
                refuse(f"the env file has no {need} (needed for --tier {tier}).")
        ref = env["PREP_PROJECT_REF"].strip().lower()
        if db_target.PRODUCTION_REF in env["PREP_DB_HOST"].strip().lower():
            ref = db_target.PRODUCTION_REF
        role = env[f"PREP_APP_{tier.upper()}_ROLE"].strip()
        kw = dict(host=env["PREP_DB_HOST"].strip(), port=env.get("PREP_DB_PORT", "5432").strip() or "5432",
                  dbname=env.get("PREP_DB_NAME", "postgres").strip() or "postgres",
                  sslmode=env.get("PREP_DB_SSLMODE", "require").strip() or "require",
                  user=f"{role}.{env['PREP_PROJECT_REF'].strip()}",
                  password=env[f"PREP_APP_{tier.upper()}_PASSWORD"])
        return Spec(ref, "env", kwargs=kw)
    url = env.get(url_key, "").strip()
    if not url:
        refuse(f"the env file has neither PREP_DB_HOST nor {url_key}.")
    return from_url(url)


def from_url(url):
    try:
        t = db_target.parse(url)
    except db_target.DbTargetError as exc:
        sys.exit(str(exc))
    return Spec(t.ref, "url", url=url)


def resolve(args, allow_production, production_flag_name):
    """The Spec for these arguments, or exit. `allow_production` is the caller's flag value."""
    if args.env_file:
        env = read_env_file(args.env_file)
        spec = from_env_dict(env, getattr(args, "tier", "dml"), args.url_key)
    else:
        spec = from_url(os.environ.get(args.url_env, "").strip())
    if spec.ref == db_target.PRODUCTION_REF:
        if not allow_production:
            refuse(f"that connection names the live project. Pass {production_flag_name} only for the course "
                   "director's own run.")
    elif spec.ref != db_target.STAGING_REF:
        refuse(f"the connection names project {spec.ref}, which is neither the live project nor the staging "
               "project (a scratch database lives on the staging server).")
    return spec


def check_expect_ref(spec, expect_ref):
    if expect_ref != spec.ref:
        refuse(f"--expect-ref does not match the project the connection names ({spec.ref}).")


def label(spec):
    return "LIVE project" if spec.ref == db_target.PRODUCTION_REF else "staging project or a database on its server"
