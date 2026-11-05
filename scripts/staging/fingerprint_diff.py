#!/usr/bin/env python3
"""Compare two schema fingerprints written by schema_fingerprint.py. Read-only, standard library.

Exit code 0: the two files describe the same schema, or differ only in ways you declared expected.
Exit code 1: an unexpected difference.   Exit code 2: a file could not be read or has no fingerprint.

The files may be UTF-8 or UTF-16, with or without a byte-order mark. Windows PowerShell 5.1 writes
UTF-16 when its output is redirected with `>`, so a fingerprint a person saved that way is read as
it is. Line endings (CRLF or LF) and line order do not matter. Lines that are not fingerprint
lines (for example a warning the shell mixed in) are counted and ignored.

Side A is the older or reference database, side B the newer one. Production is A, staging is B.

EXPECTED DIFFERENCES
  --expect held-back-023
      Migration 023 is built on staging and is held back from the live database until a later
      step. Until it is applied there, exactly two lines are expected to exist on side B and not on
      side A: the function and the trigger named instructors_admin_flag_guard. Anything else that
      differs is still reported as unexpected. Once 023 is applied on the live database, stop
      passing this option: the two files should then be identical.
  --allow-b-only REGEX / --allow-a-only REGEX
      Declare other expected lines, matched against the whole line. Repeatable.

USAGE
  python scripts/staging/schema_fingerprint.py --dotenv supabase/admin/.env > prod.txt
  python scripts/staging/schema_fingerprint.py --url-env STAGING_DB_URL     > staging.txt
  python scripts/staging/fingerprint_diff.py prod.txt staging.txt --expect held-back-023
"""

import argparse
import re
import sys
from collections import Counter

LINE = re.compile(r"^[a-z_]+ \| ")

PRESETS = {
    "held-back-023": {
        "b_only": [
            r"^function \| instructors_admin_flag_guard\(\) \| ",
            r"^trigger \| instructors \| instructors_admin_flag_guard \| ",
        ],
        "a_only": [],
    },
}


def decode(data):
    if data.startswith(b"\xff\xfe") or data.startswith(b"\xfe\xff"):
        return data.decode("utf-16")
    if data.startswith(b"\xef\xbb\xbf"):
        return data[3:].decode("utf-8")
    head = data[:400]
    if head and head.count(b"\x00") > len(head) // 4:
        # UTF-16 without a mark: the NULs sit on the odd bytes for little-endian text.
        return data.decode("utf-16-le" if head[1::2].count(b"\x00") >= head[0::2].count(b"\x00") else "utf-16-be")
    return data.decode("utf-8")


def load(path):
    try:
        with open(path, "rb") as fh:
            text = decode(fh.read())
    except (OSError, UnicodeDecodeError) as exc:
        print(f"cannot read {path}: {exc}", file=sys.stderr)
        sys.exit(2)
    lines, ignored = Counter(), 0
    for raw in text.splitlines():
        line = " ".join(raw.strip().split())
        if not line:
            continue
        if LINE.match(line):
            lines[line] += 1
        else:
            ignored += 1
    if not lines:
        print(f"{path} holds no fingerprint lines.", file=sys.stderr)
        sys.exit(2)
    return lines, ignored


def kind(line):
    return line.split(" | ", 1)[0]


def label(line, width=170):
    return line if len(line) <= width else line[: width - 3] + "..."


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("a", help="reference fingerprint (production)")
    ap.add_argument("b", help="newer fingerprint (staging)")
    ap.add_argument("--expect", choices=sorted(PRESETS), action="append", default=[])
    ap.add_argument("--allow-b-only", action="append", default=[], metavar="REGEX")
    ap.add_argument("--allow-a-only", action="append", default=[], metavar="REGEX")
    args = ap.parse_args(argv)

    a, ignored_a = load(args.a)
    b, ignored_b = load(args.b)
    b_pats = list(args.allow_b_only)
    a_pats = list(args.allow_a_only)
    for name in args.expect:
        b_pats += PRESETS[name]["b_only"]
        a_pats += PRESETS[name]["a_only"]

    only_a = sorted((a - b).elements())
    only_b = sorted((b - a).elements())

    def split(lines, pats):
        expected = [x for x in lines if any(re.search(p, x) for p in pats)]
        return expected, [x for x in lines if x not in expected]

    exp_a, bad_a = split(only_a, a_pats)
    exp_b, bad_b = split(only_b, b_pats)

    print(f"A  {args.a}: {sum(a.values())} lines ({ignored_a} non-fingerprint lines ignored)")
    print(f"B  {args.b}: {sum(b.values())} lines ({ignored_b} non-fingerprint lines ignored)")
    for title, rows in (("only in A, UNEXPECTED", bad_a), ("only in B, UNEXPECTED", bad_b)):
        if rows:
            print(f"\n{title} ({len(rows)})")
            for x in rows:
                print(f"  {label(x)}")
    for title, rows in (("only in A, expected", exp_a), ("only in B, expected", exp_b)):
        if rows:
            print(f"\n{title} ({len(rows)})")
            for x in rows:
                print(f"  {label(x)}")
    for pat in b_pats:
        if not any(re.search(pat, x) for x in exp_b):
            print(f"\nnote: expected difference did not occur (side B only): {pat}")
    for pat in a_pats:
        if not any(re.search(pat, x) for x in exp_a):
            print(f"\nnote: expected difference did not occur (side A only): {pat}")

    unexpected = bad_a + bad_b
    if unexpected:
        by_kind = Counter(kind(x) for x in unexpected)
        print("\nRESULT  DIFFERENT. Unexpected lines by kind: "
              + ", ".join(f"{k} {n}" for k, n in sorted(by_kind.items())))
        return 1
    if exp_a or exp_b:
        print("\nRESULT  same, apart from the expected differences above.")
    else:
        print("\nRESULT  identical.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
