#!/usr/bin/env python3
"""Check that the API still answers the queries the student pages send, with no sign-in and no password.

WHAT IT DOES   For each query a student page sends (the SELECT strings in site/js/schema.js and student-data.js), it
asks the project's public REST API, as an anonymous caller with the PUBLISHABLE key (which is in config.js and is public
by design), for one row. It never signs in, so it needs no cadet and no credential, and it reads nothing a stranger
could not read.

WHAT AN ANSWER MEANS
  * the API checks column names and embedded relationships before it checks who is asking, so "permission denied" or an
    empty list means every column in the query resolved, and "column does not exist" or "could not find a relationship"
    means a page would break. Each probe is therefore paired with a CONTROL: the same query with one invented column.
    The control must come back as a structural error. If it does not, the probe cannot see a missing column and is
    reported INCONCLUSIVE, never OK.
  * rows returned to an anonymous caller are counted and reported LOOK: a stranger should get none.

WHAT IT CANNOT SHOW
  * That a signed-in cadet sees the right rows. Row level security is decided per signed-in user and this tool is not
    one. It proves the shape (tables, columns, relationships, the schema cache after a migration), not the content.
    The short by-hand check in the runbook covers one real cadet's view.
  * Writes (insert, upsert) that the pages do. Only reads are probed.
  * That the page code is the code the tool read: it reads the files in the tree you point it at (--site), which must be
    the commit you ship.

EXIT 0 when every probe is OK; 1 when any is BROKEN, INCONCLUSIVE or returned rows to an anonymous caller.

  py -3.14 scripts/staging/step1_cadet_api_check.py --project staging
  py -3.14 scripts/staging/step1_cadet_api_check.py --project production --allow-production-read --site C:\\prep-step1\\repo\\site
"""
import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

# (table, constant in schema.js | literal select) -- what the student pages ask for.
# Placeholder for the grade source. A site from before the my_grades view reads the grades table; the v2 site reads the
# view. The name comes from the site folder you point the tool at, so the probe matches the commit you ship.
GRADE_TABLE = "<grade source>"

PROBES = [
    ("assignment_offerings", "OFFERING_SELECT"),
    ("submissions", "SUBMISSION_SELECT_STUDENT"),
    (GRADE_TABLE, "GRADE_SELECT_STUDENT"),   # the table name is read from the site folder: see grade_table()
    ("extensions", "EXTENSION_SELECT"),
    ("enrollments", "ENROLLMENT_SELECT"),
    ("submission_activities", "'submission_id,activity_id,content'"),
    ("offering_activities", "'grading_role'"),
]


def extract_constants(text):
    """{NAME: select string} for every `export const NAME = 'a' + 'b';` in schema.js. Pure."""
    out = {}
    for m in re.finditer(r"export const ([A-Z_]+)\s*=\s*((?:'(?:[^'\\]|\\.)*'\s*\+?\s*)+);", text):
        out[m.group(1)] = "".join(re.findall(r"'((?:[^'\\]|\\.)*)'", m.group(2)))
    return out


def grade_table(student_data_js):
    """'my_grades' if the student data module reads the view, else 'grades'. Pure."""
    return "my_grades" if re.search(r"from\(\s*'my_grades'\s*\)", student_data_js) else "grades"


def parse_config(text):
    """{'production': (url, key), 'staging': (url, key)} from the PREP_PROD and PREP_STAGING blocks of config.js. Pure."""
    out = {}
    for name, key in (("PREP_PROD", "production"), ("PREP_STAGING", "staging")):
        m = re.search(rf"const {name}\s*=\s*\{{\s*url:\s*'([^']+)'\s*,\s*anon:\s*'([^']*)'", text)
        if m:
            out[key] = (m.group(1), m.group(2))
    return out


def classify(status, body):
    """('ok' | 'permission' | 'structural' | 'rows' | 'other', code). Pure."""
    try:
        js = json.loads(body) if body else None
    except ValueError:
        js = None
    code = js.get("code") if isinstance(js, dict) else None
    if status == 200:
        return ("rows", None) if isinstance(js, list) and js else ("ok", None)
    if code in ("42703", "PGRST200", "PGRST100", "PGRST204") or (code or "").startswith("PGRST1"):
        return "structural", code
    if status in (401, 403) or code == "42501":
        return "permission", code
    return "other", code


def get(url, key, table, select):
    req = urllib.request.Request(
        f"{url}/rest/v1/{table}?select={urllib.parse.quote(select, safe=',()!:->*.')}&limit=1",
        headers={"apikey": key, "Accept-Profile": "app", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")


def verdict(real, control):
    """(label, note) from the two classifications. Pure."""
    rk, rc = real
    ck, _cc = control
    if rk == "rows":
        return "LOOK", "an anonymous caller received rows"
    if ck != "structural":
        return "INCONCLUSIVE", f"the control (an invented column) was not refused as a structural error ({ck}); this path cannot see a missing column"
    if rk == "structural":
        return "BROKEN", f"the API refuses the query ({rc})"
    if rk in ("ok", "permission"):
        return "OK", "columns and relationships resolve" + (" (anonymous: permission denied)" if rk == "permission" else " (anonymous: no rows)")
    return "BROKEN", f"unexpected answer ({rk}, {rc})"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", choices=("staging", "production"), required=True)
    ap.add_argument("--allow-production-read", action="store_true")
    ap.add_argument("--site", default=str(REPO / "site"), help="the site folder whose JS is read (default: this tree)")
    args = ap.parse_args(argv)
    if args.project == "production" and not args.allow_production_read:
        sys.exit("REFUSED  production needs --allow-production-read (a read of the public API, but a live project).")

    site = Path(args.site)
    consts = extract_constants((site / "js" / "schema.js").read_text(encoding="utf-8"))
    cfg = parse_config((site / "js" / "config.js").read_text(encoding="utf-8"))
    if args.project not in cfg or not cfg[args.project][1]:
        sys.exit(f"REFUSED  config.js has no {args.project} url and key.")
    url, key = cfg[args.project]
    print(f"project {args.project}; anonymous, read-only, one row per query; site folder {site.name}")

    gt = grade_table((site / "js" / "student-data.js").read_text(encoding="utf-8"))
    print(f"grade source read by this site: {gt}")
    bad = 0
    for table, src in PROBES:
        table = gt if table == GRADE_TABLE else table
        select = src.strip("'") if src.startswith("'") else consts.get(src)
        if not select:
            print(f"  {table:<24}BROKEN        could not read {src} from schema.js")
            bad += 1
            continue
        real = classify(*get(url, key, table, select))
        control = classify(*get(url, key, table, select + ",zz_not_a_column"))
        label, note = verdict(real, control)
        bad += label != "OK"
        print(f"  {table:<24}{label:<14}{note}")
    print(f"\n{bad} probe(s) not OK. This is the shape of the API only, not what a signed-in cadet sees.")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
