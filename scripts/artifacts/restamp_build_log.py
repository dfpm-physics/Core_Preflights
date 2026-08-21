#!/usr/bin/env python3
r"""
restamp_build_log.py -- record a republish in BUILD-LOG.md, which is where it actually belongs.

WHY THIS EXISTS. `_builder/courses/<id>/index.json` looks like the library's catalogue, and it is
not the record -- it is DERIVED. `sync_artifacts.py push` rebuilds it from scratch on every run
(`build_payload`, which reads `published_url` out of `BUILD-LOG.md`) and uploads the rebuilt copy,
so anything written into `index.json` by hand is discarded the next time anyone pushes. It is also
gitignored, so it was never going to carry the fact to another clone.

That is not a hypothetical. On 2026-08-20 all 51 artifacts were republished and the new URLs were
stamped into `index.json`; the push that followed rebuilt the catalogue from a `BUILD-LOG.md` that
still named the OLD URLs, and the faculty Artifacts page went on offering the superseded builds.
The 51 `.jsx` sources uploaded in that same push were byte-perfect -- which is exactly why the
failure was quiet.

`sync_artifacts.py status` CANNOT DETECT THIS. It compares the rebuilt payload against the stored
copy, so a stale BUILD-LOG produces a stale catalogue that matches its own stale upload and reports
`identical`. The check and the bug share an input. Verify a republish by reading BUILD-LOG.md, or
by reading `published_url` back out of the bucket -- never by `status` alone.

WHAT IT DOES. For each republished slug, rewrite exactly one table row:

    | **Published** | 2026-08-14 - https://claude.ai/public/artifacts/<old uuid> |
    | **Published** | 2026-08-20 - https://claude.ai/public/artifacts/<new uuid> |

Sectioning and slug identification come from `artifact_parse.parse_build_log` -- the same parser
`sync_artifacts.py` uses to build the catalogue. Importing it rather than re-deriving it is what
keeps this tool from disagreeing with the thing it is trying to fix.

WHAT MAKES IT SAFE

  * It REFUSES on a surprise, and refuses the WHOLE run. A slug with no section, a section with
    zero or two `Published` rows, or a row whose current value is neither the expected old URL nor
    the expected "not published" -- any one of those stops everything. A half-restamped log is
    worse than an untouched one, because afterwards it is indistinguishable from a finished job.
  * LINE ENDINGS ARE PRESERVED PER FILE. phys-110 and phys-215 are CRLF; phys-310 is LF. A Python
    text-mode read silently rewrites all of them (PROJECT.md, "Sharp edges"), which turns a 51-line
    edit into a 6,000-line diff with the real change invisible inside it. Files are read and
    written as BYTES, each file's own ending is detected and restored, and a file with MIXED
    endings is refused rather than guessed at.
  * Dry run by default (CORE.md section 4). `--commit` writes.
  * Idempotent: a second run finds every row already at its new value and reports nothing to do.

AFTER RUNNING IT, PUSH. The log is the source; the bucket still holds the old catalogue until
`python scripts/artifacts/sync_artifacts.py push --as-staff --commit` rebuilds and uploads it.

USAGE
    python scripts/artifacts/restamp_build_log.py --csv republish.csv --published-on 2026-08-20
    python scripts/artifacts/restamp_build_log.py --csv republish.csv --published-on 2026-08-20 --commit

INPUT CSV -- header required, extra columns ignored:

    course,lesson,title,file,new_url,old_url,status

`file` is the staged filename from stage_for_upload.py (`<course>_L<NN>_<slug>.jsx`); the slug is
read out of it rather than typed. `status` is `replace` (an existing entry carrying the old URL) or
`first-publish` (an entry reading "not published"). Both are restamped; they differ only in what
the current value is required to be.

Standard library only. Touches no database and no network.
"""

import argparse
import csv
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import artifact_parse as ap  # noqa: E402

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parents[2]
BUILDER = ROOT / "_builder" / "courses"
SLUG_FROM_FILE = re.compile(r"^phys-\d+_L\d+_(.+)\.jsx$")
EM_DASH = "—"

# The one row this tool rewrites. Three groups so the cell's own padding survives verbatim: only
# the VALUE is replaced, never the table's shape.
RE_PUB_ROW = re.compile(r"^(\|\s*\*\*Published\*\*[^|]*\|\s*)(.*?)(\s*\|\s*)$", re.M)

# What an unpublished entry reads as today. Matched loosely (case, surrounding punctuation) but
# required to contain no URL -- the URL check is the one that actually matters.
RE_NOT_PUBLISHED = re.compile(r"not\s+published", re.I)


def read_bytes_and_newline(path):
    """Return (normalized_text, newline). Refuses a file with mixed endings.

    The text is CRLF-collapsed so it is byte-for-byte what `artifact_parse.read_text` produces,
    which is what every offset and every section chunk below is computed against. The newline is
    reapplied on write, so the file keeps the endings it arrived with.
    """
    raw = path.read_bytes()
    crlf, lf, cr = raw.count(b"\r\n"), raw.count(b"\n"), raw.count(b"\r")
    if cr - crlf:
        raise SystemExit(f"REFUSING: {path} contains a lone CR. Fix the file by hand.")
    if crlf and crlf != lf:
        raise SystemExit(
            f"REFUSING: {path} has MIXED line endings ({crlf} CRLF, {lf - crlf} bare LF).\n"
            "  Restamping it would rewrite every line and bury the real change. Normalize first."
        )
    return raw.decode("utf-8").replace("\r\n", "\n"), ("\r\n" if crlf else "\n")


def read_plan(csv_path):
    plan, skipped = [], []
    with open(csv_path, encoding="utf-8", newline="") as fh:
        for r in csv.DictReader(fh):
            m = SLUG_FROM_FILE.match(r.get("file", ""))
            if not m:
                skipped.append((r.get("file", "?"), "filename does not name a slug"))
                continue
            status = (r.get("status") or "").strip()
            if status not in ("replace", "first-publish"):
                skipped.append((m.group(1), f"status={status!r}"))
                continue
            plan.append({"slug": m.group(1), "course": (r.get("course") or "").strip(),
                         "old": (r.get("old_url") or "").strip(),
                         "new": (r.get("new_url") or "").strip(), "status": status})
    return plan, skipped


def plan_one_course(course, rows, published_on):
    """Work out every edit for one BUILD-LOG.md. Returns (path, newline, text, edits, problems)."""
    path = BUILDER / course / "artifacts" / "BUILD-LOG.md"
    if not path.is_file():
        return None, None, None, [], [(course, f"no BUILD-LOG.md at {path}")]

    text, nl = read_bytes_and_newline(path)
    sections = ap.parse_build_log(path)["sections"]

    edits, problems, already = [], [], []
    for r in rows:
        sec = sections.get(r["slug"])
        if sec is None:
            problems.append((r["slug"], "no section in BUILD-LOG.md with this slug"))
            continue

        chunk = sec["markdown"]
        occurrences = text.count(chunk)
        if occurrences != 1:
            problems.append((r["slug"], f"its section text appears {occurrences} times in the "
                                        f"file; cannot place the edit unambiguously"))
            continue

        found = list(RE_PUB_ROW.finditer(chunk))
        if len(found) != 1:
            problems.append((r["slug"], f"{len(found)} `Published` row(s) in its section, "
                                        f"expected exactly 1"))
            continue
        m = found[0]
        current = m.group(2)

        if r["new"] and r["new"] in current:
            already.append(r["slug"])
            continue

        # Refuse on anything the file was not expected to say. `status` decides which of the two
        # shapes is required; both are checked against the URL, not against the date or prose.
        if r["status"] == "replace":
            if not r["old"]:
                problems.append((r["slug"], "status=replace but the CSV names no old_url"))
                continue
            if r["old"] not in current:
                problems.append((r["slug"], f"the row does not name the expected old URL\n"
                                            f"      row      {current}\n"
                                            f"      expected {r['old']}"))
                continue
        else:  # first-publish
            if ap.RE_PUBLISHED.search(current):
                problems.append((r["slug"], f"status=first-publish but the row already names a "
                                            f"published URL\n      row      {current}"))
                continue
            if not RE_NOT_PUBLISHED.search(current):
                problems.append((r["slug"], f"status=first-publish but the row does not read "
                                            f"'not published'\n      row      {current}"))
                continue

        if not r["new"]:
            problems.append((r["slug"], "the CSV names no new_url"))
            continue

        value = f"{published_on} {EM_DASH} {r['new']}"
        new_chunk = chunk[:m.start(2)] + value + chunk[m.end(2):]
        edits.append({"slug": r["slug"], "old_chunk": chunk, "new_chunk": new_chunk,
                      "before": current, "after": value})

    return path, nl, text, edits, problems, already


def main():
    ap_ = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap_.add_argument("--csv", required=True, help="republish file (see INPUT CSV above)")
    ap_.add_argument("--published-on", required=True, help="date to stamp (YYYY-MM-DD)")
    ap_.add_argument("--commit", action="store_true", help="write (default: dry run)")
    args = ap_.parse_args()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.published_on):
        sys.exit("--published-on must be YYYY-MM-DD")

    plan, skipped = read_plan(args.csv)
    by_course = {}
    for r in plan:
        by_course.setdefault(r["course"], []).append(r)
    print(f"{len(plan)} row(s) to restamp across {len(by_course)} course(s); "
          f"{len(skipped)} skipped\n")

    all_problems, writes, n_edits, n_already = [], [], 0, 0
    for course in sorted(by_course):
        path, nl, text, edits, problems, already = plan_one_course(
            course, by_course[course], args.published_on)
        all_problems += [(course, s, w) for s, w in problems]
        n_already += len(already)
        n_edits += len(edits)
        ending = {"\r\n": "CRLF", "\n": "LF"}.get(nl, "?")
        print(f"  {course}: {len(edits)} to change, {len(already)} already current, "
              f"{len(problems)} problem(s)   [{ending}]")
        for e in edits[:80]:
            print(f"    {e['slug']}\n      -  {e['before']}\n      +  {e['after']}")
        if edits:
            new_text = text
            for e in edits:
                new_text = new_text.replace(e["old_chunk"], e["new_chunk"], 1)
            writes.append((path, nl, new_text, len(edits)))

    for course, slug, why in all_problems:
        print(f"\n  PROBLEM  {course}/{slug}\n      {why}")
    if all_problems:
        sys.exit(f"\nREFUSING: {len(all_problems)} row(s) did not match what the log says. "
                 f"Nothing written. Resolve them, then re-run.")

    print(f"\n{n_edits} row(s) to change; {n_already} already current.")
    if not n_edits:
        print("nothing to do.")
        return
    if not args.commit:
        print("dry run - nothing written. Re-run with --commit.")
        return

    for path, nl, new_text, n in writes:
        path.write_bytes(new_text.replace("\n", nl).encode("utf-8"))
        print(f"  wrote {n} row(s) to {path.relative_to(ROOT).as_posix()}")

    print("\nNow rebuild and upload the catalogue, or the library keeps serving the old URLs:")
    print("  python scripts/artifacts/sync_artifacts.py push --as-staff --commit")
    print("Then read `published_url` back OUT of the bucket. `status` cannot verify this "
          "(see the header).")


if __name__ == "__main__":
    main()
