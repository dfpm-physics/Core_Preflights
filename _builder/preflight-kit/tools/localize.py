#!/usr/bin/env python3
"""
localize.py — bake a COURSE_PROFILE into course-specific copies of the kit.

    python3 tools/localize.py COURSE_PROFILE.md [-o build] [--check]

Reads the ```profile fenced block, applies an ORDERED substitution table to the skill,
the sources, the contracts, and the project instructions, and writes the result to the
output directory. Prints a per-file replacement count and a leftover scan.

Design rules, in order of importance:

1. CODE IDENTIFIERS ARE NEVER TOUCHED. `cadetId`, `setCadetId`, `cadet-id`, `--cadet-bg`,
   `--cadet-border` are masked before any replacement and restored after. They are internal,
   never rendered to a learner, and renaming them buys nothing while risking a broken build.
2. LONGEST MATCH FIRST. "USAFA Honor Code" is replaced before "USAFA"; the grounding-text
   phrases before the bare discipline word; the course name before "Physics". Order in
   RULES is significant — do not sort it.
3. THE CONTRACTS ARE ENDPOINT-ONLY. Substituting prose inside a frozen contract would
   fork it. Only the endpoint and prefill base are rewritten there, and only if the profile
   actually changes them.
4. IDEMPOTENT. Running twice produces the same bytes. Running against an already-localized
   tree is a no-op, not a double substitution.
"""

import argparse
import pathlib
import re
import shutil
import sys

# ── files that get full prose localization ────────────────────────────────────
PROSE_FILES = [
    "skill/preflight-factory-v2/SKILL.md",
    "skill/preflight-factory-v2/PORTABILITY_OVERLAY.md",
    "sources/02_TUTOR_SYSTEM_PROMPT.md",
    "sources/03_LESSON_CONFIG_SPEC.md",
    "sources/04_OUTPUT_REPORT_SPEC.md",
    "sources/THEME_REFERENCE.md",
    "PROJECT_INSTRUCTIONS.md",
    "KICKOFF_PROMPT.md",
]

# ── files where ONLY endpoints are rewritten (frozen contracts) ───────────────
ENDPOINT_ONLY_FILES = [
    "contracts/INTERACTION-DATA-CONTRACT.md",
    "contracts/INTERACTION-PREFILL-LINK.md",
]

MARKER = ".localized-output"

# ── identifiers masked before substitution, restored after ────────────────────
PROTECTED = [
    "setCadetId",
    "cadetId",
    "cadet-id",
    "--cadet-bg",
    "--cadet-border",
    "cadet_id",
]

# ── the reference values these files currently carry ──────────────────────────
BASELINE = {
    "institution_short": "USAFA",
    "institution_full": "United States Air Force Academy",
    "learner_singular": "cadet",
    "learner_plural": "cadets",
    "course_name": "Physics 215",
    "course_short": "PHYS 215",
    "course_id": "phys-215",
    "semester": "Fall 2026",
    "discipline": "physics",
    "grounding_text": "OpenStax University Physics Vol. 2",
    "grounding_text_short": "OpenStax",
    "integrity_code_name": "USAFA Honor Code",
    "submit_endpoint": (
        "https://dfpm-physics.github.io/Core_Preflights/"
        "site/student/interaction-submit.html"
    ),
    "prefill_base": (
        "https://dfpm-physics.github.io/Core_Preflights/site/faculty/lessons.html"
    ),
    # The backup router the artifact links to when its connection check fails (SKILL.md
    # rev 4). It MUST be listed here even though nothing about it varies per lesson:
    # without an entry, the generic `physics -> <discipline>` rule below rewrites its HOST
    # (dfpm-physics -> dfpm-chemistry) and a localized fork ships a dead URL. The two other
    # endpoints have been guarded this way since the kit was written; this one was added
    # after a review found it unguarded, and confirmed the mangling empirically.
    #
    # The leftover scan would not have caught it: that watches institution/learner/course/
    # grounding tokens, not endpoints.
    "backup_base": (
        "https://dfpm-physics.github.io/Core_Preflights/site/student/backup.html"
    ),
}


def read(path: pathlib.Path) -> str:
    """Read preserving line endings exactly. Path.read_text(newline=...) is 3.13+, and
    the default universal-newline translation silently rewrites the CRLF contract files
    to LF — which makes them undiffable against their canonical originals."""
    with path.open(encoding="utf-8", newline="") as fh:
        return fh.read()


def write(path: pathlib.Path, text: str) -> None:
    with path.open("w", encoding="utf-8", newline="") as fh:
        fh.write(text)


def parse_profile(path: pathlib.Path) -> dict:
    text = read(path)
    m = re.search(r"```profile\n(.*?)```", text, re.S)
    if not m:
        sys.exit(f"error: no ```profile fenced block found in {path}")
    profile = {}
    for line in m.group(1).splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        profile[key.strip()] = value.strip()
    missing = [k for k in BASELINE if k not in profile]
    if missing:
        sys.exit("error: COURSE_PROFILE is missing required keys: " + ", ".join(missing))
    return profile


def cap(s: str) -> str:
    return s[:1].upper() + s[1:] if s else s


GROUNDING_RE = (
    r"OpenStax University Physics"
    r"(?:\s*\((?:Vols?\.?)[^)]*\))?"      # "(Vols. 1–3)"
    r"(?:\s+Vols?\.?\s*\d+)?"             # "Vol. 2" / "Vol 2"
)


def build_rules(p: dict) -> list:
    """Ordered (pattern, replacement, mode) triples. ORDER IS SIGNIFICANT.

    mode: "lit" plain substring · "word" \b-bounded · "re" raw regex
    replacement None = pure guard: match it so nothing else can, change nothing.
    """
    # An unchanged value still needs its rule present as a guard, so a broader rule
    # later in the table cannot fire inside it.
    ident = p["grounding_text"] == BASELINE["grounding_text"]
    ground_full = None if ident else p["grounding_text"]
    ground_short = (
        None if p["grounding_text_short"] == BASELINE["grounding_text_short"]
        else p["grounding_text_short"]
    )
    learner = p["learner_singular"]
    learners = p["learner_plural"]
    disc = p["discipline"]
    rules = [
        # endpoints first — exact, unambiguous strings
        (BASELINE["submit_endpoint"], p["submit_endpoint"], "lit"),
        (BASELINE["prefill_base"], p["prefill_base"], "lit"),
        (BASELINE["backup_base"], p["backup_base"], "lit"),
        # integrity: longest phrase before the bare institution token
        (BASELINE["integrity_code_name"], p["integrity_code_name"], "lit"),
        # Grounding text, as ONE regex that swallows any trailing volume marker.
        # Written as a literal-prefix rule it mangles "…Physics Vol 2" into
        # "…Physics Vol. 2 Vol 2" — the prefix matches, the suffix survives. The regex
        # also acts as the guard that stops the discipline rule below from turning
        # "University Physics" into "University Chemistry".
        (GROUNDING_RE, ground_full, "re"),
        ("OpenStax", ground_short, "lit"),
        # course identity: name before the bare discipline word
        (BASELINE["course_name"], p["course_name"], "lit"),
        (BASELINE["course_short"], p["course_short"], "lit"),
        (BASELINE["course_id"], p["course_id"], "lit"),
        (BASELINE["semester"], p["semester"], "lit"),
        (BASELINE["institution_full"], p["institution_full"], "lit"),
        (BASELINE["institution_short"], p["institution_short"], "lit"),
        # learner vocabulary: all-caps first (section headers), then plural, then singular
        ("CADETS", learners.upper(), "word"),
        ("CADET", learner.upper(), "word"),
        ("Cadets", cap(learners), "word"),
        ("cadets", learners, "word"),
        ("Cadet", cap(learner), "word"),
        ("cadet", learner, "word"),
        # discipline last — the broadest, least specific token
        ("Physics", cap(disc), "word"),
        ("physics", disc, "word"),
    ]
    # Bare "Honor Code" needs rewriting only when the new integrity name isn't itself an
    # honor code. Adding it unconditionally would expand "the Honor Code" to "the USAFA
    # Honor Code" under an identity profile — harmless but no longer byte-identical to
    # the validated original, which is a property worth keeping.
    if "honor code" not in p["integrity_code_name"].lower():
        rules.insert(4, ("Honor Code", p["integrity_code_name"], False))

    # Keep no-op rules in the table. They look useless and are not: an identity rule
    # like ("USAFA Honor Code" -> "USAFA Honor Code") is what stops the shorter
    # ("Honor Code" -> ...) rule from firing inside it. Dropping them for tidiness
    # reintroduces exactly the nesting bug the single-pass matcher exists to prevent.
    # They are excluded from the replacement COUNT instead, in apply_rules.
    return rules


def mask(text: str) -> tuple:
    tokens = {}
    for i, ident in enumerate(PROTECTED):
        if ident in text:
            key = f"\x00PROT{i}\x00"
            tokens[key] = ident
            text = text.replace(ident, key)
    return text, tokens


def unmask(text: str, tokens: dict) -> str:
    for key, ident in tokens.items():
        text = text.replace(key, ident)
    return text


def apply_rules(text: str, rules: list) -> tuple:
    """Apply every rule in ONE pass, so replaced text is never re-scanned.

    Sequential replacement is wrong here and the bug is subtle: with an identity
    profile the ("USAFA Honor Code" -> same) rule looks droppable, and once dropped the
    bare "Honor Code" rule fires inside it and yields "USAFA USAFA Honor Code". The same
    nesting exists between the grounding text and the discipline word, and between the
    course name and the discipline word. One ordered alternation makes each character
    eligible for exactly one rule, which is the actual intent.
    """
    if not rules:
        return text, 0
    text, tokens = mask(text)
    parts = []
    for i, (needle, _, mode) in enumerate(rules):
        if mode == "re":
            body = needle
            lead = tail = ""
        else:
            body = re.escape(needle)
            # \b is meaningless against a non-word edge (e.g. "--cadet-bg")
            lead = r"\b" if mode == "word" and needle[:1].isalnum() else ""
            tail = r"\b" if mode == "word" and needle[-1:].isalnum() else ""
        parts.append(f"(?P<r{i}>{lead}{body}{tail})")
    pattern = re.compile("|".join(parts))
    count = 0

    def swap(m):
        nonlocal count
        repl = rules[int(m.lastgroup[1:])][1]
        if repl is None or repl == m.group():
            return m.group()          # guard rule: matched only to block other rules
        count += 1
        return repl

    return unmask(pattern.sub(swap, text), tokens), count


def endpoint_rules(p: dict) -> list:
    # prefill_base is a prefix of nothing here, but submit_endpoint and prefill_base
    # share a host, so order them longest-first for the same reason as build_rules.
    return [
        (BASELINE["submit_endpoint"], p["submit_endpoint"], "lit"),
        (BASELINE["prefill_base"], p["prefill_base"], "lit"),
        (BASELINE["backup_base"], p["backup_base"], "lit"),
        (BASELINE["course_id"], p["course_id"], "lit"),
    ]


def leftovers(root: pathlib.Path, p: dict) -> list:
    """Scan the DELIVERABLE files for baseline strings that should be gone.

    Scoped to PROSE_FILES on purpose. The kit's own documentation (README, docs/,
    examples/, the template) legitimately discusses the Physics 215 origin, and the
    contracts intentionally keep their prose byte-stable so they can be diffed against
    the canonical originals. Flagging those would bury the one hit that matters.
    """
    watch = [
        k
        for k in ("institution_short", "learner_singular", "course_name", "grounding_text_short")
        if p[k] != BASELINE[k]
    ]
    hits = []
    for rel in PROSE_FILES:
        path = root / rel
        if not path.exists():
            continue
        masked, _ = mask(read(path))
        for key in watch:
            n = len(re.findall(r"\b" + re.escape(BASELINE[key]) + r"\b", masked, re.I))
            if n:
                hits.append((rel, BASELINE[key], n))
    return hits


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("profile", help="path to the filled-in COURSE_PROFILE.md")
    ap.add_argument("-o", "--out", default="build", help="output directory (default: build)")
    ap.add_argument("--check", action="store_true", help="report only; write nothing")
    args = ap.parse_args()

    kit = pathlib.Path(__file__).resolve().parent.parent
    profile_path = pathlib.Path(args.profile)
    if not profile_path.is_absolute():
        profile_path = (kit / profile_path).resolve()
    p = parse_profile(profile_path)
    out = (kit / args.out).resolve()

    rules = build_rules(p)
    active = sum(1 for needle, repl, _ in rules if repl is not None and needle != repl)
    print(f"profile : {profile_path.name}")
    print(f"course  : {p['course_name']}  ({p['course_id']})  ·  learner = {p['learner_singular']}")
    print(f"rules   : {active} active substitutions ({len(rules)} incl. nesting guards)")
    print(f"output  : {out}\n")

    if args.check:
        for needle, repl, _ in rules:
            if repl is None or repl == needle:
                print(f"  {needle!r}   [guard — matched to block other rules, unchanged]")
            else:
                print(f"  {needle!r} -> {repl!r}")
        return

    if out.exists():
        shutil.rmtree(out)

    # Ignore prior output trees, or a second run nests the first inside it. Detected by
    # marker file rather than by directory name, so any -o name is safe.
    base = shutil.ignore_patterns("__pycache__", "*.zip", ".git", ".DS_Store")

    def ignore(directory, names):
        skip = set(base(directory, names))
        for name in names:
            if (pathlib.Path(directory) / name / MARKER).exists():
                skip.add(name)
        return skip

    shutil.copytree(kit, out, ignore=ignore)
    (out / MARKER).write_text(
        f"localized from {profile_path.name} for {p['course_id']}\n", encoding="utf-8"
    )

    for rel in PROSE_FILES:
        f = out / rel
        if not f.exists():
            print(f"  skip  {rel}  (not present)")
            continue
        body = read(f)
        body, n = apply_rules(body, rules)
        write(f, body)
        print(f"  {n:5d}  {rel}")

    erules = endpoint_rules(p)
    for rel in ENDPOINT_ONLY_FILES:
        f = out / rel
        body = read(f)
        body, n = apply_rules(body, erules)
        write(f, body)
        print(f"  {n:5d}  {rel}  (endpoints only — contract prose untouched)")

    shutil.copy(profile_path, out / "COURSE_PROFILE.md")

    print("\nleftover scan (deliverable files only):")
    hits = leftovers(out, p)
    if not hits:
        print("  clean — no baseline institution/learner/course strings remain")
    else:
        for rel, token, n in hits:
            print(f"  {n:4d}  {token!r} still in {rel}")
        print("\n  Review each. Some are legitimate (revision history, archived rationale).")
    print(
        "  Not scanned: contracts (prose kept byte-stable by design), kit docs,\n"
        "  examples, and the template — all legitimately reference the pilot course."
    )


if __name__ == "__main__":
    main()
