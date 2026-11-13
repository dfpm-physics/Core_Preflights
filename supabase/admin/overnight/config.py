"""Configuration, secrets and the staging-only wall.

Everything secret lives in files OUTSIDE the repository, mode 0600, owned by the invoking user:

    <config dir>/config.json      non-secret settings
    <config dir>/staging.env      the staging database's DML-tier credential (nothing else)
    <config dir>/genai-mil.env    the GenAI.mil key and base URL

The config dir is `~/.config/prep-overnight/` unless `PREP_OVERNIGHT_CONFIG_DIR` names another
(a path, never a secret). This module NEVER reads `supabase/admin/.env`: on the machine this job
runs on that file may hold the production credential, and the aggregator's own `_connect()` reads
it by default. Making production reachable is a code change plus a decision record, never a flag.
"""
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

from . import EXIT_CONFIG, EXIT_REFUSED

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "staging"))
import db_target  # noqa: E402  (the one reading of "which project does this URL reach")

STAGING_REF = db_target.STAGING_REF
PRODUCTION_REF = db_target.PRODUCTION_REF
DML_ROLE = "prep_app_dml"


class Stop(Exception):
    """A deliberate stop with an exit code. The message never carries a secret."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class Secret:
    """Holds a value that must never be printed. str(), repr() and f-strings show a marker."""

    __slots__ = ("_v",)

    def __init__(self, value):
        self._v = value

    def reveal(self):
        return self._v

    def __repr__(self):
        return "<redacted>"

    __str__ = __repr__

    def __format__(self, spec):
        return "<redacted>"

    def __bool__(self):
        return bool(self._v)


def redact(text, *secrets):
    """Remove each secret value and any `Bearer <token>` from text headed for a log or exception."""
    out = str(text)
    for s in secrets:
        v = s.reveal() if isinstance(s, Secret) else s
        if v:
            out = out.replace(v, "<redacted>")
    return re.sub(r"(?i)bearer\s+\S+", "Bearer <redacted>", out)


def mode_problem(mode, owner_uid, my_uid):
    """Why a secret file is unacceptable, or None. Pure so it can be tested on any OS."""
    if mode & 0o077:
        return f"mode is {oct(mode & 0o777)}; it must be 0600 (no group or other access)"
    if owner_uid != my_uid:
        return "it is not owned by the user running this job"
    return None


def dir_problem(mode):
    """Why a config DIRECTORY is unacceptable: anyone but the owner able to write there can swap a file."""
    if mode & 0o022:
        return f"directory mode is {oct(mode & 0o777)}; it must not be group- or world-writable"
    return None


def check_file(path):
    """Refuse a secret file that other users could read. Modes are checked on POSIX only."""
    if not os.path.isfile(path):
        raise Stop(EXIT_CONFIG, f"missing file: {path}")
    if os.name != "posix":
        return
    st = os.stat(path)
    why = mode_problem(st.st_mode, st.st_uid, os.getuid())
    if why:
        raise Stop(EXIT_REFUSED, f"{path}: {why}")


def read_env(path):
    """KEY=VALUE lines, # comments, optional quotes. Stdlib only."""
    out = {}
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        out[k.strip()] = v
    return out


def config_dir():
    return Path(os.environ.get("PREP_OVERNIGHT_CONFIG_DIR") or Path.home() / ".config" / "prep-overnight")


@dataclass
class Config:
    target: str = "staging"
    expect_ref: str = STAGING_REF
    courses: list = field(default_factory=list)
    window_hours: int = 72
    max_tracks: int = 6
    min_age_minutes: int = 60
    grounding_root: Path = Path.home() / "prep-grounding"
    state_dir: Path = Path.home() / ".local" / "state" / "prep-overnight"
    nightly_token_cap: int = 8_000_000
    max_run_minutes: int = 180
    model_pin_grade: str = None
    model_pin_aggregate: str = None
    allow_preview: bool = False
    genai_mil_project_flag: str = ""
    db: dict = field(default_factory=dict)       # staging DML tier
    genai: dict = field(default_factory=dict)    # GenAI.mil endpoint and key


def _expand(p):
    return Path(os.path.expanduser(str(p)))


def load_config(cdir=None, need_db=True, need_genai=True):
    """Read and validate every file. Raises Stop. Runs before any network or database call."""
    cdir = Path(cdir) if cdir else config_dir()
    cfg_path = cdir / "config.json"
    if os.name == "posix" and cdir.is_dir():
        why = dir_problem(os.stat(cdir).st_mode)
        if why:
            raise Stop(EXIT_REFUSED, f"{cdir}: {why}")
    check_file(cfg_path)
    texts = {"config.json": cfg_path.read_text(encoding="utf-8")}
    try:
        raw = json.loads(texts["config.json"])
    except ValueError as exc:
        raise Stop(EXIT_CONFIG, f"config.json is not valid JSON: {exc}")
    if raw.get("target") != "staging":
        raise Stop(EXIT_REFUSED, 'config.json "target" must be exactly "staging". '
                                 "Production is not reachable from this job.")
    cfg = Config()
    for key in ("expect_ref", "courses", "window_hours", "max_tracks", "min_age_minutes",
                "nightly_token_cap", "max_run_minutes", "model_pin_grade", "model_pin_aggregate", "allow_preview",
                "genai_mil_project_flag"):
        if key in raw:
            setattr(cfg, key, raw[key])
    if "grounding_root" in raw:
        cfg.grounding_root = _expand(raw["grounding_root"])
    if "state_dir" in raw:
        cfg.state_dir = _expand(raw["state_dir"])
    if not isinstance(cfg.courses, list) or not all(isinstance(c, str) for c in cfg.courses):
        raise Stop(EXIT_CONFIG, '"courses" must be a list of course codes')
    for key in ("window_hours", "max_tracks", "min_age_minutes"):
        if not isinstance(getattr(cfg, key), int) or isinstance(getattr(cfg, key), bool) or getattr(cfg, key) < 0:
            raise Stop(EXIT_CONFIG, f'"{key}" must be a non-negative integer')
    for key in ("nightly_token_cap", "max_run_minutes"):       # a zero or negative cap would mean "no cap" or "never start"
        if not isinstance(getattr(cfg, key), int) or isinstance(getattr(cfg, key), bool) or getattr(cfg, key) < 1:
            raise Stop(EXIT_CONFIG, f'"{key}" must be a positive integer')

    if need_db:
        p = cdir / "staging.env"
        check_file(p)
        texts["staging.env"] = p.read_text(encoding="utf-8")
        env = read_env(p)
        if any(k.startswith("PREP_APP_OWNER") or k.startswith("PREP_APP_READ") for k in env):
            raise Stop(EXIT_REFUSED, "staging.env carries a tier other than DML. Keep only the DML tier here.")
        missing = [k for k in ("PREP_DB_HOST", "PREP_PROJECT_REF", "PREP_APP_DML_ROLE",
                               "PREP_APP_DML_PASSWORD") if not env.get(k)]
        if missing:
            raise Stop(EXIT_CONFIG, "staging.env is missing: " + ", ".join(missing))
        cfg.db = {"host": env["PREP_DB_HOST"], "port": env.get("PREP_DB_PORT", "5432"),
                  "dbname": env.get("PREP_DB_NAME", "postgres"), "ref": env["PREP_PROJECT_REF"],
                  "role": env["PREP_APP_DML_ROLE"], "password": Secret(env["PREP_APP_DML_PASSWORD"])}
    if need_genai:
        p = cdir / "genai-mil.env"
        check_file(p)
        texts["genai-mil.env"] = p.read_text(encoding="utf-8")
        env = read_env(p)
        missing = [k for k in ("GENAI_MIL_API_KEY", "GENAI_MIL_BASE_URL") if not env.get(k)]
        if missing:
            raise Stop(EXIT_CONFIG, "genai-mil.env is missing: " + ", ".join(missing))
        cfg.genai = {"key": Secret(env["GENAI_MIL_API_KEY"]),
                     "base_url": env["GENAI_MIL_BASE_URL"].rstrip("/"),
                     "model": env.get("GENAI_MIL_MODEL") or None,
                     "locks_at": env.get("GENAI_MIL_KEY_LOCKS_AT") or None}
        if not cfg.genai["base_url"].startswith("https://"):
            raise Stop(EXIT_CONFIG, "GENAI_MIL_BASE_URL must be an https:// URL")
        if cfg.genai["model"] and not cfg.model_pin_grade:
            cfg.model_pin_grade = cfg.genai["model"]

    guard_target(cfg, texts)
    return cfg


def guard_target(cfg, texts):
    """The staging-only wall. Runs before any read. A failure is a REFUSAL, not a config error."""
    for name, text in texts.items():
        if PRODUCTION_REF in text:
            raise Stop(EXIT_REFUSED, f"{name} names the production project. This job reaches staging only.")
    if cfg.expect_ref != STAGING_REF:
        raise Stop(EXIT_REFUSED, f"expect_ref is not the staging project ({STAGING_REF}).")
    if cfg.db:
        if cfg.db["ref"] != STAGING_REF:
            raise Stop(EXIT_REFUSED, f"PREP_PROJECT_REF is not the staging project ({STAGING_REF}).")
        # db_target reads the pooler user form `postgres.<ref>`; the surrogate carries no password
        # and exists only so the shared parser judges the host and ref the way every tool does.
        url = f"postgresql://postgres.{cfg.db['ref']}@{cfg.db['host']}:{cfg.db['port']}/{cfg.db['dbname']}"
        try:
            db_target.require_staging(url, cfg.expect_ref)
        except db_target.DbTargetError as exc:
            raise Stop(EXIT_REFUSED, str(exc))
        if cfg.db["role"] != DML_ROLE:
            raise Stop(EXIT_REFUSED, f"the database role must be {DML_ROLE} (the DML tier).")


def check_expect_ref(expect_ref):
    """--expect-ref is required with --commit and must equal the staging ref. Never a widening."""
    if expect_ref != STAGING_REF:
        raise Stop(EXIT_REFUSED, f"--expect-ref must be {STAGING_REF} to write.")
