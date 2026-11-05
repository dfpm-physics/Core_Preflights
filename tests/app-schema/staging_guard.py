"""Refuse any database that is not the staging project. Fail closed.

The check is "is this exactly staging", never "is this production": the second form has to list
every wrong answer, the first has one right one. The URL is read by scripts/staging/db_target.py,
the single parser every staging tool uses; target.mjs holds the same rule for the Node side.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts" / "staging"))
import db_target  # noqa: E402

STAGING_REF = db_target.STAGING_REF
PRODUCTION_REF = db_target.PRODUCTION_REF


def db_url_ref(url):
    """Project ref named by a Postgres URL, or None when the URL is refused."""
    return db_target.ref_of(url)


def check_staging_db_url(url):
    """Return the staging ref, or raise ValueError. Anything but exactly staging is refused."""
    return db_target.require_staging(url).ref


def require_staging(url):
    """Like check_staging_db_url but exits with the message, for scripts."""
    try:
        return check_staging_db_url(url)
    except ValueError as exc:
        sys.exit(str(exc))
