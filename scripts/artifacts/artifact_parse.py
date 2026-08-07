#!/usr/bin/env python3
"""Read a generated preflight artifact and its build record. One parser, several callers.

WHY THIS IS A MODULE AND NOT INLINE IN ITS CALLERS
    Three things now need to read a `.jsx` artifact: the ingest that uploads it to Supabase
    Storage, the local review server, and `check_artifact.py`. The regexes below are not
    obvious — several encode a specific failure that was found the expensive way, and the
    comments explaining them are the valuable part. A second copy would lose the comments
    first and the correctness second.

    Most of this is lifted verbatim from `serve_artifact_review.py` in the
    Socratic-Artifact-Builder repository, which is where the scars were earned. What is new
    here is `parse_build_log`, which reads a course's BUILD-LOG.md into structured sections —
    the review server only ever pulled published URLs out of it.

WHAT AN ARTIFACT IS
    A self-contained React component published as a Claude artifact, which runs a ~10 minute
    Socratic conversation with a cadet and posts a report back to PREP. Its identity is
    `INTERACTION_ID`, a slug ending in 8 random hex minted once per build
    (docs/contracts/INTERACTION-DATA-CONTRACT.md section 3.2). That slug must equal the
    `activities.slug` a lesson row is registered under, or every cadet report is discarded with
    no error anywhere.

BYTES, ALWAYS
    Every read here is binary and the CRLF collapse happens in memory only. Nothing in this
    module writes, so the collapse cannot reach disk — but a caller who later adds a write
    would otherwise inherit a text-mode handle that had already destroyed the line endings of a
    hash-locked file. The builder repo paid for that lesson twice.
"""

import hashlib
import pathlib
import re
import urllib.parse

# ── artifact source ──────────────────────────────────────────────────────────

RE_ID = re.compile(r'^const INTERACTION_ID\s*=\s*"([^"]+)"', re.M)
RE_VERSION = re.compile(r'^const ARTIFACT_VERSION\s*=\s*"([^"]+)"', re.M)
RE_COUNT = re.compile(r"^const PROBE_TOPIC_COUNT\s*=\s*(\d+)", re.M)
RE_BUDGET = re.compile(r"^const PER_TOPIC_BUDGET_MIN\s*=\s*([\d.]+)", re.M)
RE_MODELS = re.compile(r"^const MODEL_CANDIDATES\s*=\s*\[(.*?)^\];", re.M | re.S)
RE_MODEL = re.compile(r'"([^"]+)"')
RE_SUBMIT = re.compile(r'^const SUBMIT_ENDPOINT\s*=\s*\n?\s*"([^"]+)"', re.M)
RE_OBJ_BLOCK = re.compile(r"^const OBJECTIVE_KEYS\s*=\s*\[(.*?)^\];", re.M | re.S)
RE_OBJ = re.compile(r'\{\s*key:\s*"([^"]+)"\s*,\s*label:\s*"([^"]*)"\s*\}')
RE_COMPONENT = re.compile(r"^function\s+([A-Za-z0-9_]+)\s*\(", re.M)
RE_LESSON_ID = re.compile(r"^lesson_id:\s*(.+)$", re.M)
RE_READING = re.compile(r"^reading_assignment:(.*?)(?=^\S|\Z)", re.M | re.S)

# The probe_topics region of LESSON_CONFIG, ending at the next top-level key
# (`common_misconceptions (`, `prerequisites (`, `time_budget (`, …).
#
# SCOPING THIS IS LOAD-BEARING, and getting it wrong is silent. `  1. ` also starts a
# numbered list inside TEXTBOOK_REFERENCE (the printed learning objectives, Gauss's law
# stated as a list) and inside common_misconceptions. Run the block regex over the whole
# file and topic 1 begins at the FIRST of those and swallows everything down to the first
# "Reports under objective key:" line — which still parses, still yields the right key,
# and produced a 4609-word "topic" beside three ~380-word ones on lessons 28 and 29, and
# an 11451-word one on lesson 13. Nothing errors; the review page just shows the wrong
# prose for the first objective of six artifacts.
RE_PROBE_REGION = re.compile(r"^probe_topics\b.*?(?=^[a-z_][a-z_0-9]*\s*[(:]|\Z)", re.M | re.S)
# One probe-topic block: "  1. …" through its own "Reports under objective key: <key>".
RE_TOPIC = re.compile(
    r"^  (\d+)\.\s(.*?)^\s*Reports under objective key:\s*(\S+)\s*$", re.M | re.S
)
RE_LESSON_NO = re.compile(r"lesson_(\d+)_", re.I)
RE_PUBLISHED = re.compile(r"https://claude\.ai/public/artifacts/[0-9a-f-]+")

# A slug is <stem>-<8 lowercase hex>, per contract section 3.2. Anchoring on the suffix is what
# lets the build-log scan tell a slug from any other backticked identifier on the same line.
RE_SLUG = re.compile(r"`([a-z0-9-]+-[0-9a-f]{8})`")


def read_text(path):
    """Decode a file for parsing. Bytes in, CRLF collapsed in memory only."""
    return pathlib.Path(path).read_bytes().decode("utf-8", "replace").replace("\r\n", "\n")


def sha(text):
    """The short digest a review note is pinned to, so a rebuild makes the note visibly stale."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def parse_artifact(path):
    """Extract the reviewable parameters from one generated `.jsx`.

    Raises ValueError naming the file and the missing marker — a silently half-parsed artifact
    would render as a card with no objectives, which reads as "nothing to review" rather than
    as a bug.
    """
    path = pathlib.Path(path)
    text = read_text(path)

    def need(rx, what):
        m = rx.search(text)
        if not m:
            raise ValueError(f"{path.name}: no {what} found — has the artifact format changed?")
        return m

    slug = need(RE_ID, "INTERACTION_ID").group(1)
    obj_src = need(RE_OBJ_BLOCK, "OBJECTIVE_KEYS block").group(1)
    keys = RE_OBJ.findall(obj_src)
    if not keys:
        raise ValueError(f"{path.name}: OBJECTIVE_KEYS is present but parsed empty")

    region = need(RE_PROBE_REGION, "probe_topics region in LESSON_CONFIG").group(0)
    topics = {key: (num, body.rstrip()) for num, body, key in RE_TOPIC.findall(region)}

    objectives = []
    for n, (key, label) in enumerate(keys, 1):
        num, body = topics.get(key, ("", ""))
        objectives.append({
            "key": key,
            "label": label,
            "n": n,
            "order_in_config": num,
            "text": body,
            "sha": sha(body or key),
            "words": len(body.split()),
        })

    models_m = RE_MODELS.search(text)
    reading = RE_READING.search(text)
    lesson_no = RE_LESSON_NO.search(path.name)
    count = RE_COUNT.search(text)
    budget = RE_BUDGET.search(text)
    lesson_id = RE_LESSON_ID.search(text)
    component = RE_COMPONENT.search(text)
    version = RE_VERSION.search(text)
    submit = RE_SUBMIT.search(text)

    return {
        "slug": slug,
        "file": path.name,
        "bytes": path.stat().st_size,
        "lines": text.count("\n") + 1,
        "lesson_no": int(lesson_no.group(1)) if lesson_no else None,
        "lesson_id": lesson_id.group(1).strip() if lesson_id else "",
        "component": component.group(1) if component else "",
        "version": version.group(1) if version else "",
        "topic_count": int(count.group(1)) if count else len(keys),
        "budget": budget.group(1) if budget else "",
        "models": RE_MODEL.findall(models_m.group(1)) if models_m else [],
        "submit_endpoint": submit.group(1) if submit else "",
        "grounding": reading.group(1).strip() if reading else "",
        "objectives": objectives,
        "objective_count": len(objectives),
        "missing_prose": [o["key"] for o in objectives if not o["text"]],
    }


# ── the course profile ───────────────────────────────────────────────────────

def profile_values(course_dir):
    """Read the course's fenced profile block into a dict.

    Only the fenced block counts — the prose around it quotes these keys in examples, and a
    whole-file scan picks the example up instead of the value.
    """
    prof = pathlib.Path(course_dir) / "COURSE_PROFILE.md"
    if not prof.exists():
        return {}
    m = re.search(r"^```profile\n(.*?)^```", read_text(prof), re.M | re.S)
    if not m:
        return {}
    out = {}
    for line in m.group(1).splitlines():
        k, sep, v = line.partition(":")
        if sep and not k.strip().startswith("#"):
            out[k.strip()] = v.strip()
    return out


# ── BUILD-LOG.md ─────────────────────────────────────────────────────────────

RE_META_ROW = re.compile(r"^\|\s*\*\*(.+?)\*\*[^|]*\|\s*(.*?)\s*\|\s*$", re.M)
# An objectives row: the number cell may be struck through (~~4~~) to mark a dropped objective,
# and the key cell is backticked with or without the strikethrough wrapper.
RE_OBJ_ROW = re.compile(
    r"^\|\s*(~~)?(\d+)(?:~~)?\s*\|\s*~?~?`([a-z0-9-]+)`~?~?\s*\|\s*(.*?)\s*\|\s*$", re.M
)


def _split_sections(body):
    """Yield (heading, text) for each `### Lesson N — Title` block under `## Built`.

    A lesson's block runs to the NEXT LESSON heading or the next `## ` heading, not to the next
    `###`. PHYS 310's log interleaves non-lesson `###` commentary between entries — "The
    Chapter 6 / Chapter 16 boundary", "Six Flags blocks read, and not one of them disputes a
    fact" — and each of those discusses the lesson it follows. Cutting at every `###` would
    orphan that commentary from the only entry it makes sense against.
    """
    starts = [m for m in re.finditer(r"^### Lesson (\d+)\s*[—-]\s*(.+)$", body, re.M)]
    stops = [m.start() for m in re.finditer(r"^## ", body, re.M)]
    for i, m in enumerate(starts):
        nxt = starts[i + 1].start() if i + 1 < len(starts) else len(body)
        after = [s for s in stops if s > m.start()]
        end = min(nxt, after[0]) if after else nxt
        yield int(m.group(1)), m.group(2).strip(), body[m.start():end].rstrip()


def parse_build_log(path):
    """Read one course's BUILD-LOG.md into {slug: section}, plus the course-level preamble.

    The log is the only machine-findable home for a published artifact's URL, and it is prose
    with tables in it rather than a data file — so every section keeps its **raw markdown**
    alongside the parsed fields. Anything this parser does not understand is still rendered.

    Sections are keyed by SLUG, not lesson number: PHYS 310 renumbered five lessons on
    2026-08-05 without a single artifact changing, because numbers are deliberately absent from
    every build. The slug is the identity; the number is a label on the schedule.
    """
    path = pathlib.Path(path)
    if not path.exists():
        return {"exists": False, "sections": {}, "orphans": [], "preamble": "", "title": ""}

    text = read_text(path)
    title_m = re.search(r"^# (.+)$", text, re.M)
    built_m = re.search(r"^## Built\s*$", text, re.M)
    preamble = text[: built_m.start()] if built_m else ""
    body = text[built_m.start():] if built_m else text

    sections, orphans = {}, []
    for lesson_no, heading, chunk in _split_sections(body):
        meta = {k.strip(): v.strip() for k, v in RE_META_ROW.findall(chunk)}

        slug_m = RE_SLUG.search(meta.get("Registration slug", "")) or RE_SLUG.search(chunk)
        slug = slug_m.group(1) if slug_m else ""

        pub_line = meta.get("Published", "")
        pub_url = RE_PUBLISHED.search(pub_line)
        pub_date = re.search(r"(\d{4}-\d{2}-\d{2})", pub_line)

        objectives = []
        for struck, num, key, label in RE_OBJ_ROW.findall(chunk):
            note = ""
            clean = label
            if "~~" in label:
                # "~~Making, catching and timing the waves~~ — **dropped on review 2026-08-05**"
                inner = re.match(r"~~(.*?)~~\s*(.*)$", label)
                if inner:
                    clean = inner.group(1)
                    # The trailing note is written as a continuation of the struck label —
                    # "~~…~~ — **dropped on review**" — so the dash belongs to the sentence
                    # that was cut, not to the note. Rendered on its own it reads as a stray.
                    note = inner.group(2).strip().lstrip("—-").strip()
            objectives.append({
                "n": int(num),
                "key": key,
                "label": clean,
                "dropped": bool(struck) or "~~" in label,
                "note": note,
            })

        # Blockquote callouts — the "⚠ read this" prose. First bolded run is the title.
        callouts = []
        for block in re.findall(r"(?:^> ?.*(?:\n|$))+", chunk, re.M):
            plain = "\n".join(ln[2:] if ln.startswith("> ") else ln[1:]
                              for ln in block.rstrip().splitlines())
            head = re.match(r"\s*\*\*(.+?)\*\*", plain)
            callouts.append({"title": head.group(1).strip() if head else "", "body": plain})

        rec = {
            "lesson_no": lesson_no,
            "heading": heading,
            "slug": slug,
            "meta": meta,
            "published_url": pub_url.group(0) if pub_url else "",
            "published_on": pub_date.group(1) if pub_date else "",
            "objectives": objectives,
            "callouts": callouts,
            "markdown": chunk,
        }
        if slug:
            sections[slug] = rec
        else:
            orphans.append(rec)

    return {
        "exists": True,
        "title": title_m.group(1).strip() if title_m else path.name,
        "preamble": preamble.rstrip(),
        "sections": sections,
        "orphans": orphans,
    }


# ── the registration link ────────────────────────────────────────────────────

def prefill_link(rec, course_id, base, artifact_url=None):
    """Build the PREP registration link for one artifact.

    Contract: docs/contracts/INTERACTION-PREFILL-LINK.md.

    **`id` is the slug read out of the artifact, never re-derived.** Contract section 3.2 ends
    every slug in 8 random hex minted once per build, so there is nothing to re-derive it from —
    and an `id` that does not equal the artifact's `#i=` makes the receiver reject every cadet
    report with no error anywhere. That is the failure this whole link exists around, which is
    why callers print the two values side by side instead of only the finished URL.

    **Spaces are encoded `%20`, not `+`.** `urlencode`'s default and `URLSearchParams` both emit
    `+`, which only decodes back to a space under form-urlencoded rules — a receiver using
    `decodeURIComponent` renders the title with literal plus signs. `%20` is correct under both,
    and it is what the contract's own worked example shows.

    `pub=0` saves the row as a draft: the link fills the form in and writes nothing until a
    director clicks Save.
    """
    url = artifact_url or rec.get("published") or rec.get("published_url") or ""
    if not (url and course_id and base):
        return ""
    # "Physics 215, Fall 2026, Lesson 29 — Maxwell's Equations" -> the part after the term.
    bits = [b.strip() for b in (rec.get("lesson_id") or "").split(",")]
    title = bits[2] if len(bits) > 2 else (rec.get("lesson_id") or rec.get("heading") or rec["slug"])
    params = {
        "new": "1",
        "id": rec["slug"],
        "course": course_id,
        "title": title,
        "url": url,
        # Artifact-only lesson -> `interaction`. No profile key carries this; both courses'
        # preflights are artifact-only, and callers show the value so a course that ever offers
        # a written alternative (`choice`) is a visible correction rather than a silent default.
        "policy": "interaction",
        "pub": "0",
    }
    if rec.get("lesson_no") is not None:
        params["num"] = str(rec["lesson_no"])
    return f"{base}?{urllib.parse.urlencode(params, quote_via=urllib.parse.quote, safe='')}"
