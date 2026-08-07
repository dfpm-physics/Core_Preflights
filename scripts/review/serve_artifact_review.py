#!/usr/bin/env python3
"""serve_artifact_review.py — local review page for generated artifact parameters.

    python scripts/review/serve_artifact_review.py             # every course, both modes
    python scripts/review/serve_artifact_review.py --course phys-310 --port 8766 --no-open
    python scripts/review/serve_artifact_review.py --dump      # parse only, print, exit
    python scripts/review/serve_artifact_review.py --links     # registration links, print, exit
    python scripts/review/serve_artifact_review.py --grounding # corpus <-> artifact join, exit

**The page serves every course and two kinds of review.** `--course` picks which one it
opens on, not which one it loads -- PHYS 310's artifacts used to need a flag to be visible
at all, which is a poor way to hold sixteen unreviewed drafts.

The second mode is the **grounding corpus**. `courses/phys-310/texts/MURRAY-GROUNDING.md` is
reconstructed from model knowledge rather than extracted from a book, and sixteen artifacts
were built against sections that are still `STATUS: PENDING` after recker lifted the build
gate on 2026-08-05. Reviewing it is the outstanding work on this course, so it belongs on
the same page as the drafts it governs rather than behind a second command on a second port.

**The corpus half is imported from `serve_review.py`, never reimplemented.** Approving a
section *writes to the corpus* -- `STATUS: REVIEWED <date>`, the exact string the build gate
greps -- while an artifact decision only ever writes a sidecar. Two different writeback
rules on one page is a real hazard, so the dangerous half keeps its original implementation
with its re-read-before-write check, its atomic replace, and its rule that rejections never
touch the corpus. A copy of that logic here would be a second copy to drift.

**The two are joined.** Each artifact card lists the corpus sections it was built on with
their live status; each section lists the artifacts that rest on it. The join is parsed from
`BUILD-LOG.md`'s `Grounding` line and is exact for PHYS 310 -- 59 references, 59 distinct,
59 sections in the corpus, a bijection with no orphan on either side. Only the refs *before*
the em-dash count: the commentary after it names sections that were deliberately NOT used
("section 12.7 is not assigned"), and a whole-line scan would silently pull those in as
grounding.

Every `.jsx` under `courses/*/artifacts/` bakes in a set of decisions an agent made:
the slug, the grounding source, how many probe topics, how long each gets, and — the one
that shapes the whole cadet conversation — the objective keys and the probe-topic prose
behind each. `CORE.md` §6 says an artifact is a draft until recker approves it. This serves
those decisions one artifact at a time and records the verdict.

**This tool never writes a `.jsx`.** That is the whole difference from its sibling
`serve_review.py`, which writes STATUS lines into the corpus it serves. Here the review
output is a set of *instructions for a later edit*, not the edit — recker rejects an
objective or comments on a parameter, and an agent then works through the notes. Two
reasons it is built that way rather than editing in place:

1. **Rewriting a probe topic is prose work, not a field update.** There is no line to flip.
   A tool that tried would be a text editor with a worse editor in it.
2. **Twelve of these artifacts are already published** (`BUILD-LOG.md`). Editing one is not
   the end of the change — republishing mints a *new* 8-hex slug and therefore a *new*
   lesson row (contract §3.2), so an accepted rejection costs a republish and a
   re-registration. That is recker's call to make with the cost visible, and the page says
   so on every published artifact rather than letting a click imply it is free.

The page also carries each artifact's **DFPM registration link**, because the two values it is
built from — the slug and the published URL — are already parsed here and live nowhere else
together. **The link's `id` is the slug read out of the artifact, never re-derived**: contract
§3.2 ends every slug in 8 random hex minted once per build, and an `id` that does not equal the
artifact's `#i=` makes the receiver discard every cadet report with no error anywhere. The card
prints the two side by side for exactly that reason. `--links` prints them without a browser.

So the only file this process writes is the sidecar, one per course, beside `BUILD-LOG.md`:

    courses/<id>/artifacts/REVIEW-NOTES.json

Three rules the writeback obeys:

1. **Atomic** — temp file, then replace. A half-written sidecar loses every decision.
2. **Merge, never clobber.** Each save merges into what is on disk rather than replacing it,
   so a second browser tab, or a rerun after a crash, cannot silently drop earlier notes.
3. **Every note carries the `sha` of the text it was written against.** If an artifact is
   rebuilt, the note is still there and now visibly stale — `--stale` lists those. A note
   about prose that no longer exists is worse than no note, because it reads as current.

Standard library only (`CORE.md` §2). Binds to loopback. Reads artifacts in **bytes**
(`PROJECT.md` §9 — a text-mode read would be lossless here since nothing is written back,
but the habit is the point).
"""

import argparse
import datetime
import hashlib
import html
import json
import pathlib
import re
import sys
import threading
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# The corpus half of this page, imported rather than copied. `serve_review.py` owns every
# rule about writing to MURRAY-GROUNDING.md; this module only ever calls into it. Sibling
# import, so the directory has to be on the path when run as a script.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import serve_review as corpus_review  # noqa: E402

REPO = pathlib.Path(__file__).resolve().parent.parent.parent
# `_builder/courses`, not `courses`. This file came from the Socratic-Artifact-Builder
# repository, where the builder WAS the repository; here it is one tree inside PREP. The
# underscore is load-bearing and not a style choice: GitHub Pages serves this repo with default
# Jekyll processing, which excludes `_`-prefixed paths — verified 2026-08-07, when
# `…/docs/contracts/INTERACTION-PREFILL-LINK.md` served the real document and `…/_archive/…`
# returned 404. A `builder/` here would publish every BUILD-LOG.md, the tutor system prompt and
# the worked extension problems to the open web.
COURSES = REPO / "_builder" / "courses"

# ── the parameters that get their own comment slot ───────────────────────────
# A single free-text box per artifact would come back as a paragraph an agent has to
# guess the target of. One slot per decision means a note arrives already attached to
# the thing it changes.
PARAM_SLOTS = [
    ("slug", "Registration slug", "INTERACTION_ID — baked into every published URL"),
    ("lesson_id", "Lesson id", "the header line the cadet sees"),
    ("grounding", "Grounding source", "reading_assignment — instructor audit only"),
    ("topic_count", "Probe topics", "PROBE_TOPIC_COUNT"),
    ("budget", "Per-topic budget", "PER_TOPIC_BUDGET_MIN — five strings must agree"),
    ("models", "Model candidates", "baked in at publish time"),
    ("other", "Anything else", "structure, tone, report format, extensions"),
]

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


def say(msg: str = "") -> None:
    """print() that cannot raise on a Windows console.

    `PROJECT.md` §9's pipe-encoding edge in its other form: the titles and prose here are
    full of `§`, `—` and `μ`, and a bare print of those raises UnicodeEncodeError under
    cp1252. Inside a request handler that kills the connection mid-save, and the browser
    reports a network failure for a write that already landed.
    """
    enc = getattr(sys.stdout, "encoding", None) or "utf-8"
    sys.stdout.write(msg.encode(enc, "replace").decode(enc, "replace") + "\n")
    sys.stdout.flush()


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


# ── parsing ──────────────────────────────────────────────────────────────────

def read_text(path: pathlib.Path) -> str:
    """Decode an artifact for parsing. Bytes in, CRLF collapsed in memory only.

    Nothing here is ever written back, so the collapse cannot reach disk — but reading
    bytes is the habit `PROJECT.md` §9 asks for, and it means a caller who later adds a
    write does not inherit a text-mode handle that already destroyed the line endings.
    """
    raw = path.read_bytes()
    return raw.decode("utf-8", "replace").replace("\r\n", "\n")


def profile_values(course_dir: pathlib.Path) -> dict[str, str]:
    """Read `course_id` and `prefill_base` out of the course's fenced profile block.

    Only the fenced block counts — the prose around it quotes these keys in examples, and a
    whole-file scan picks the example up instead of the value.
    """
    prof = course_dir / "COURSE_PROFILE.md"
    if not prof.exists():
        return {}
    m = re.search(r"^```profile\n(.*?)^```", read_text(prof), re.M | re.S)
    if not m:
        return {}
    out = {}
    for line in m.group(1).splitlines():
        k, sep, v = line.partition(":")
        if sep and not k.startswith("#"):
            out[k.strip()] = v.strip()
    return out


def prefill_link(rec: dict, course_id: str, base: str) -> str:
    """Build the DFPM registration link for one PUBLISHED artifact.

    Contract: `preflight-kit/contracts/INTERACTION-PREFILL-LINK.md`.

    **`id` is the slug read out of the artifact, never re-derived.** Contract §3.2 ends every
    slug in 8 random hex minted once per build, so there is nothing to re-derive it from — and
    an `id` that does not equal the artifact's `#i=` makes the receiver reject every cadet
    report with no error anywhere. That is the failure this whole link exists around, which is
    why the page prints the two values side by side instead of only the finished URL.

    **Spaces are encoded `%20`, not `+`.** `urlencode`'s default and `URLSearchParams` both
    emit `+`, which only decodes back to a space under form-urlencoded rules — a receiver
    using `decodeURIComponent` renders the title with literal plus signs. `%20` is correct
    under both, and it is what the contract's own worked example shows.

    `pub=0` saves the row as a draft: the link fills the form in and writes nothing until
    recker clicks Save.
    """
    if not (rec.get("published") and course_id and base):
        return ""
    # "Physics 215, Fall 2026, Lesson 29 — Maxwell's Equations" → the part after the term.
    bits = [b.strip() for b in (rec.get("lesson_id") or "").split(",")]
    title = bits[2] if len(bits) > 2 else (rec.get("lesson_id") or rec["slug"])
    params = {
        "new": "1",
        "id": rec["slug"],
        "course": course_id,
        "title": title,
        "url": rec["published"],
        # Artifact-only lesson → `interaction`. No profile key carries this; both courses'
        # preflights are artifact-only, and the page shows the value so a course that ever
        # offers a written alternative (`choice`) is a visible correction rather than a
        # silent wrong default.
        "policy": "interaction",
        "pub": "0",
    }
    if rec.get("lesson_no") is not None:
        params["num"] = str(rec["lesson_no"])
    return f"{base}?{urllib.parse.urlencode(params, quote_via=urllib.parse.quote, safe='')}"


def published_urls(artifacts_dir: pathlib.Path) -> tuple[dict[str, str], bool]:
    """Map slug -> published URL from that course's BUILD-LOG.md.

    Returns (map, log_exists). **The second value is not a detail.** BUILD-LOG.md is the
    only machine-findable home for this pairing, and PHYS 310 has none — its publish record
    is a sentence in `PROJECT.md` where the URL comes *before* the slug, so no proximity
    scan reads it without guessing. Reporting that artifact as a draft would be the error
    in the expensive direction: the page's whole reason for flagging publication is that
    changing a published artifact costs a republish and a new lesson row. So a missing log
    is surfaced as unknown, never as draft.

    The log is per-lesson prose, so this tracks the most recent slug seen and attributes the
    next `Published` URL to it — both strings sit in the same small table, slug first.
    """
    log = artifacts_dir / "BUILD-LOG.md"
    if not log.exists():
        return {}, False
    found: dict[str, str] = {}
    current = ""
    for line in read_text(log).splitlines():
        m = re.search(r"`([a-z0-9-]+-[0-9a-f]{8})`", line)
        if m:
            current = m.group(1)
        u = RE_PUBLISHED.search(line)
        if u and current and current not in found:
            date = re.search(r"(\d{4}-\d{2}-\d{2})", line)
            found[current] = f"{u.group(0)}|{date.group(1) if date else ''}"
    return found, True


def parse_artifact(path: pathlib.Path) -> dict:
    """Extract the reviewable parameters from one generated `.jsx`.

    Raises ValueError naming the file and the missing marker — a silently half-parsed
    artifact would render as a card with no objectives, which reads as "nothing to review"
    rather than as a bug.
    """
    text = read_text(path)

    def need(rx: re.Pattern[str], what: str) -> re.Match[str]:
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

    models = RE_MODEL.findall(RE_MODELS.search(text).group(1)) if RE_MODELS.search(text) else []
    reading = RE_READING.search(text)
    lesson_no = RE_LESSON_NO.search(path.name)
    count = RE_COUNT.search(text)
    budget = RE_BUDGET.search(text)
    lesson_id = RE_LESSON_ID.search(text)
    component = RE_COMPONENT.search(text)
    version = RE_VERSION.search(text)

    return {
        "slug": slug,
        "file": path.name,
        "lesson_no": int(lesson_no.group(1)) if lesson_no else None,
        "lesson_id": lesson_id.group(1).strip() if lesson_id else "",
        "component": component.group(1) if component else "",
        "version": version.group(1) if version else "",
        "topic_count": int(count.group(1)) if count else len(keys),
        "budget": budget.group(1) if budget else "",
        "models": models,
        "grounding": (reading.group(1).strip() if reading else ""),
        "objectives": objectives,
        "objective_count": len(objectives),
        "missing_prose": [o["key"] for o in objectives if not o["text"]],
    }


def collect(course_dir: pathlib.Path) -> list[dict]:
    """Parse every artifact in one course, ordered by lesson number then filename."""
    art_dir = course_dir / "artifacts"
    if not art_dir.is_dir():
        return []
    pub, have_log = published_urls(art_dir)
    prof = profile_values(course_dir)
    out = []
    for path in sorted(art_dir.glob("*.jsx")):
        rec = parse_artifact(path)
        rec["course"] = course_dir.name
        url, _, when = pub.get(rec["slug"], "").partition("|")
        rec["published"] = url
        rec["published_on"] = when
        rec["pub_known"] = have_log
        rec["course_id"] = prof.get("course_id", "")
        rec["prefill"] = prefill_link(rec, prof.get("course_id", ""),
                                      prof.get("prefill_base", ""))
        out.append(rec)
    out.sort(key=lambda r: (r["lesson_no"] is None, r["lesson_no"] or 0, r["file"]))
    return out


# ── the corpus, and its join to the artifacts ────────────────────────────────

# A corpus section heading: "## §2.1 — Atomic Theory". The number is what the join keys on,
# because BUILD-LOG.md writes the same section as "**§2.1** Atomic Theory" and only the
# number survives both spellings.
RE_SEC_NUM = re.compile(r"§\s*(\d+\.\d+)")
RE_GROUND_LINE = re.compile(r"^\|\s*\*\*Grounding\*\*\s*\|(.*)$", re.M)
# "§5.1–§5.5" and "§15.1–§15.4" — a range written with an en dash, sometimes repeating the §.
RE_SEC_REF = re.compile(r"§\s*(\d+\.\d+)\s*(?:[\u2013\u2014-]\s*§?\s*(\d+\.\d+))?")


def corpus_path(course_dir: pathlib.Path) -> pathlib.Path | None:
    """The course's reconstructed grounding corpus, if it has one.

    Only PHYS 310 does. PHYS 215 grounds in real OpenStax PDFs that are attached to a Claude
    Project by hand, so there is nothing here to review and the mode is simply absent for it
    — which is the honest rendering, not a missing feature.
    """
    texts = course_dir / "texts"
    if not texts.is_dir():
        return None
    for path in sorted(texts.glob("*GROUNDING*.md")):
        return path
    return None


def expand_range(lo: str, hi: str) -> list[str]:
    """"§5.1"–"§5.5" → the five sections between. Cross-chapter ranges are left alone."""
    c_lo, _, n_lo = lo.partition(".")
    c_hi, _, n_hi = hi.partition(".")
    if c_lo != c_hi or int(n_hi) < int(n_lo):
        return [lo, hi]
    return ["%s.%d" % (c_lo, n) for n in range(int(n_lo), int(n_hi) + 1)]


def grounding_map(artifacts_dir: pathlib.Path) -> dict[str, list[str]]:
    """slug -> the corpus section numbers that artifact was built on, from BUILD-LOG.md.

    **Only the part of the line before the em dash counts, and that is not a stylistic
    choice.** The line reads `Murray corpus **§12.4** …, **§12.8** … — all four `STATUS:
    PENDING`. §12.7 is not assigned and is not in the reference`. Everything after the dash
    is commentary, and it names sections that were deliberately *excluded* along with
    carry-forward references borrowed from earlier lessons. A whole-line scan pulls those in
    as grounding, which is wrong in the direction that matters: it would show a section as
    reviewed-and-relied-upon when nothing relies on it.

    Verified against PHYS 310 at the time of writing: 59 references, 59 distinct, 59 sections
    in the corpus — a bijection, no orphan on either side.
    """
    log = artifacts_dir / "BUILD-LOG.md"
    if not log.exists():
        return {}
    out: dict[str, list[str]] = {}
    slug = ""
    for line in read_text(log).splitlines():
        m = re.search(r"`([a-z0-9-]+-[0-9a-f]{8})`", line)
        if m:
            slug = m.group(1)
        g = RE_GROUND_LINE.match(line)
        if not g or not slug:
            continue
        head = g.group(1).split("\u2014")[0]          # assigned list only
        refs: list[str] = []
        for lo, hi in RE_SEC_REF.findall(head):
            refs.extend(expand_range(lo, hi) if hi else [lo])
        seen: set[str] = set()
        out[slug] = [r for r in refs if not (r in seen or seen.add(r))]
    return out


def load_corpus(course_dir: pathlib.Path, artifacts: list[dict]) -> dict:
    """Parse the corpus and wire it to the artifacts in both directions.

    Returns {} for a course with no corpus. Section records come straight from
    `serve_review.parse_corpus` so the `id` and `sha` the page posts back are the ones that
    module expects — the wire format is its, not ours.
    """
    path = corpus_path(course_dir)
    if not path:
        return {}
    _, sections = corpus_review.parse_corpus(path)
    gmap = grounding_map(course_dir / "artifacts")

    by_num: dict[str, dict] = {}
    for sec in sections:
        m = RE_SEC_NUM.search(sec["title"])
        sec["num"] = m.group(1) if m else ""
        sec["used_by"] = []
        if sec["num"]:
            by_num.setdefault(sec["num"], sec)

    for art in artifacts:
        art["corpus"] = []
        for num in gmap.get(art["slug"], []):
            sec = by_num.get(num)
            if sec is None:
                # A build-log reference to a section the corpus does not contain. Surfaced,
                # never dropped — it means the two files disagree about what was read.
                art["corpus"].append({"num": num, "title": "", "reviewed": False,
                                      "status": "", "id": "", "missing": True})
                continue
            art["corpus"].append({"num": num, "title": sec["title"], "id": sec["id"],
                                  "reviewed": sec["reviewed"], "status": sec["status"],
                                  "missing": False})
            sec["used_by"].append({"slug": art["slug"], "file": art["file"],
                                   "lesson_no": art["lesson_no"],
                                   "lesson_id": art["lesson_id"],
                                   "published": bool(art["published"])})

    npath = corpus_review.notes_path(path)
    return {
        "path": str(path.relative_to(REPO)).replace("\\", "/"),
        "notes_path": str(npath.relative_to(REPO)).replace("\\", "/"),
        "sections": sections,
        "notes": corpus_review.load_notes(npath),
        "reviewed": sum(1 for s in sections if s["reviewed"]),
        "orphans": [s["num"] for s in sections if not s["used_by"]],
    }


def collect_courses(order_first: str = "") -> list[dict]:
    """Every course that has artifacts, each with its notes and its corpus if it has one."""
    out = []
    for course_dir in sorted(p for p in COURSES.iterdir() if p.is_dir()):
        artifacts = collect(course_dir)
        if not artifacts:
            continue
        npath = notes_path(course_dir)
        out.append({
            "id": course_dir.name,
            "artifacts": artifacts,
            "notes": load_notes(npath),
            "notes_path": str(npath.relative_to(REPO)).replace("\\", "/"),
            "corpus": load_corpus(course_dir, artifacts),
        })
    out.sort(key=lambda c: (c["id"] != order_first, c["id"]))
    return out


# ── sidecar ──────────────────────────────────────────────────────────────────

def notes_path(course_dir: pathlib.Path) -> pathlib.Path:
    return course_dir / "artifacts" / "REVIEW-NOTES.json"


def load_notes(path: pathlib.Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8")).get("artifacts", {})
    except (json.JSONDecodeError, OSError) as exc:
        sys.exit(f"error: {path.name} unreadable ({exc}). Move it aside rather than "
                 f"letting this overwrite it.")


def prune(rec: dict) -> dict:
    """Drop empty fields so an untouched artifact leaves no entry behind."""
    objs = {k: v for k, v in rec.get("objectives", {}).items()
            if v.get("decision") or v.get("comment", "").strip()}
    params = {k: v.strip() for k, v in rec.get("params", {}).items() if v.strip()}
    out = {}
    if objs:
        out["objectives"] = objs
    if params:
        out["params"] = params
    return out


def write_notes(path: pathlib.Path, course: str, merged: dict) -> dict:
    """Write the sidecar atomically. The only place the payload shape is spelled out —
    `save_notes` and `retire` both come through here, so the header cannot drift."""
    payload = {
        "schema": 1,
        "course": course,
        "updated": datetime.date.today().isoformat(),
        "note": "Review decisions from scripts/review/serve_artifact_review.py. NOTHING HERE "
                "HAS BEEN APPLIED — these are instructions for a later edit, and the .jsx "
                "artifacts are untouched. Each objective carries the `sha` of the probe-topic "
                "prose it was judged against; if the artifact is rebuilt the sha stops "
                "matching and the note is stale (run the server with --stale to list those). "
                "Rejecting anything in a PUBLISHED artifact costs a republish and a new "
                "8-hex slug per contract 3.2, which registers as a NEW lesson row.",
        "artifacts": dict(sorted(merged.items())),
    }
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
                   encoding="utf-8", newline="\n")
    tmp.replace(path)
    return merged


def save_notes(path: pathlib.Path, course: str, incoming: dict) -> dict:
    """Merge `incoming` into the sidecar on disk and write it atomically."""
    merged = load_notes(path)
    for slug, rec in incoming.items():
        kept = prune(rec)
        if not kept:
            merged.pop(slug, None)
            continue
        kept["file"] = rec.get("file", merged.get(slug, {}).get("file", ""))
        kept["reviewed"] = datetime.date.today().isoformat()
        merged[slug] = kept
    return write_notes(path, course, merged)


# ── page ─────────────────────────────────────────────────────────────────────

PAGE = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Review — Socratic Artifact Builder</title>
<style>
  :root{
    --navy:#16233f;--navy-2:#1e3054;--blue:#3b82f6;--blue-soft:#eff6ff;--blue-line:#bfdbfe;
    --line:#e6ebf2;--line-2:#f1f5f9;--text:#0f172a;--soft:#5b6b82;--muted:#93a1b5;
    --bg:#f4f6fa;--card:#fff;
    --ok:#15803d;--ok-bg:#f0fdf4;--ok-line:#bbf7d0;
    --no:#dc2626;--no-bg:#fef2f2;--no-line:#fecaca;
    --warn:#b45309;--warn-bg:#fffbeb;--warn-line:#fde68a;
    --shadow:0 1px 2px rgba(15,23,42,.04),0 4px 16px rgba(15,23,42,.05);
    --mono:"SF Mono","Cascadia Code","JetBrains Mono","Fira Mono",Consolas,monospace;
    --head:64px;--foot:56px;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);
       color:var(--text);line-height:1.6;-webkit-font-smoothing:antialiased}
  a{color:#1d4ed8}
  ::selection{background:var(--blue-line)}

  /* ── header ── */
  header{background:linear-gradient(180deg,var(--navy-2),var(--navy));color:#fff;
         padding:0 20px;height:var(--head);display:flex;align-items:center;gap:16px;
         position:sticky;top:0;z-index:30;box-shadow:0 1px 0 rgba(15,23,42,.18)}
  .brand{display:flex;align-items:center;gap:11px;min-width:0}
  .mark{width:30px;height:30px;border-radius:8px;flex:none;display:grid;place-items:center;
        background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.16);
        font-family:var(--mono);font-size:11px;font-weight:700;color:#bfdbfe}
  .eyebrow{font-family:var(--mono);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;
           color:#93b4e8;white-space:nowrap}
  h1{font-size:15.5px;font-weight:650;line-height:1.25;white-space:nowrap;overflow:hidden;
     text-overflow:ellipsis}
  .stats{display:flex;gap:6px;margin-left:8px}
  .pill{font-family:var(--mono);font-size:10.5px;padding:3px 9px;border-radius:99px;
        background:rgba(255,255,255,.1);color:#dbe6f5;white-space:nowrap}
  .pill.ok{background:rgba(34,197,94,.22);color:#bbf7d0}
  .pill.no{background:rgba(248,113,113,.22);color:#fecaca}
  .nav{margin-left:auto;display:flex;gap:5px;align-items:center;flex:none}
  .seg{display:flex;background:rgba(255,255,255,.08);border-radius:7px;padding:2px;
       border:1px solid rgba(255,255,255,.1)}
  .seg button{font-family:inherit;font-size:12px;padding:4px 12px;border-radius:5px;border:0;
              background:transparent;color:#c7d7ef;cursor:pointer;font-weight:550}
  .seg button.on{background:#fff;color:var(--navy)}
  .nav .step{font-family:var(--mono);font-size:13px;width:30px;height:28px;border-radius:6px;
             border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.05);
             color:#dbe6f5;cursor:pointer}
  .nav .step:hover{background:rgba(255,255,255,.15)}

  /* ── shell ── */
  .shell{display:grid;grid-template-columns:266px minmax(0,1fr);align-items:start;
         max-width:1360px;margin:0 auto}
  aside{position:sticky;top:var(--head);height:calc(100vh - var(--head) - var(--foot));
        overflow-y:auto;padding:14px 10px 14px 14px}
  .sidehead{font-family:var(--mono);font-size:9.5px;letter-spacing:.13em;text-transform:uppercase;
            color:var(--muted);padding:4px 10px 8px}
  .item{display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:8px;cursor:pointer;
        border:1px solid transparent;margin-bottom:1px}
  .item:hover{background:#eaeff7}
  .item.on{background:var(--card);border-color:var(--line);box-shadow:var(--shadow)}
  .item .n{font-family:var(--mono);font-size:11px;color:var(--muted);width:17px;flex:none}
  .item.on .n{color:var(--blue)}
  .item .t{font-size:12.5px;color:#334155;overflow:hidden;text-overflow:ellipsis;
           white-space:nowrap;flex:1}
  .item.on .t{color:var(--text);font-weight:600}
  .dot{width:7px;height:7px;border-radius:99px;flex:none;background:#cbd5e1}
  .dot.accepted{background:var(--ok)}
  .dot.rejected{background:var(--no)}
  .dot.partial{background:#f59e0b}
  main{padding:16px 18px 26px;min-width:0}

  /* ── cards ── */
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;margin-bottom:14px;
        overflow:hidden;box-shadow:var(--shadow)}
  .card>h2{font-size:11px;font-weight:700;padding:11px 18px;border-bottom:1px solid var(--line);
           letter-spacing:.09em;text-transform:uppercase;color:var(--soft);
           display:flex;gap:8px;align-items:center}
  .card>h2 .count{font-family:var(--mono);font-weight:600;color:var(--muted);
                  text-transform:none;letter-spacing:0}
  .banner{padding:12px 18px;font-size:13px;border-radius:10px;margin-bottom:14px;
          background:var(--warn-bg);color:#78350f;border:1px solid var(--warn-line)}
  .banner b{color:#7c2d12}
  .banner a{color:#7c2d12;word-break:break-all}
  .seeded{padding:12px 18px;font-size:12.5px;background:var(--ok-bg);color:#14532d;
          border:1px solid var(--ok-line);border-radius:10px;margin-bottom:14px}

  /* ── parameter table ── */
  table{width:100%;border-collapse:collapse;font-size:13px}
  tr:last-child td{border-bottom:0}
  td{padding:9px 18px;border-bottom:1px solid var(--line-2);vertical-align:top}
  td.k{width:172px;color:var(--soft);font-weight:600;white-space:nowrap;font-size:12.5px}
  td.v{font-family:var(--mono);font-size:12px;word-break:break-word}
  td.v .hint{font-family:system-ui,sans-serif;font-size:11.5px;color:var(--muted);
             display:block;margin-top:2px;line-height:1.45}
  td.n{width:60px;text-align:right;white-space:nowrap}
  .prose{font-family:system-ui,sans-serif;font-size:12.5px;white-space:pre-wrap;
         max-height:150px;overflow-y:auto;color:#334155}

  /* ── registration ── */
  .reg{padding:15px 18px}
  .reg .lead{font-size:12.5px;color:var(--soft);margin-bottom:11px}
  .linkbox{display:flex;gap:0;border:1px solid var(--line);border-radius:9px;overflow:hidden;
           background:#fbfcfe}
  .linkbox code{flex:1;min-width:0;font-family:var(--mono);font-size:11px;padding:10px 12px;
                color:#334155;word-break:break-all;line-height:1.55;max-height:88px;
                overflow-y:auto}
  .linkbox .side{display:flex;flex-direction:column;border-left:1px solid var(--line);flex:none}
  .linkbox .side button,.linkbox .side a{font-family:inherit;font-size:11.5px;font-weight:600;
        padding:0 15px;height:44px;display:grid;place-items:center;border:0;background:#fff;
        color:var(--soft);cursor:pointer;text-decoration:none;white-space:nowrap}
  .linkbox .side button:hover,.linkbox .side a:hover{background:var(--blue-soft);color:#1d4ed8}
  .linkbox .side button{border-bottom:1px solid var(--line)}
  .linkbox .side button.done{background:var(--ok-bg);color:var(--ok)}
  .match{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:12px}
  .match div{background:var(--blue-soft);border:1px solid var(--blue-line);border-radius:9px;
             padding:9px 12px}
  .match .lbl{font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;
              color:#1d4ed8;margin-bottom:2px}
  .match .val{font-family:var(--mono);font-size:11.5px;color:#1e3a8a;word-break:break-all}
  .warnline{margin-top:11px;font-size:12px;color:#78350f;background:var(--warn-bg);
            border:1px solid var(--warn-line);border-radius:8px;padding:9px 12px}
  .nolink{padding:15px 18px;font-size:12.5px;color:var(--soft)}

  /* ── objectives ── */
  .noteb{font-family:var(--mono);font-size:10.5px;padding:4px 10px;border-radius:6px;
         border:1px solid var(--line);background:#fff;color:var(--soft);cursor:pointer}
  .noteb:hover{border-color:var(--blue);color:var(--blue)}
  .noteb.has{background:var(--blue);border-color:var(--blue);color:#fff}
  .obj{border-bottom:1px solid var(--line)}
  .obj:last-child{border-bottom:0}
  .obj.accepted{background:linear-gradient(90deg,var(--ok-bg),transparent 60%);
                box-shadow:inset 3px 0 0 var(--ok)}
  .obj.rejected{background:linear-gradient(90deg,var(--no-bg),transparent 60%);
                box-shadow:inset 3px 0 0 var(--no)}
  .objhead{display:flex;gap:11px;align-items:baseline;padding:13px 18px 6px;flex-wrap:wrap}
  .objnum{font-family:var(--mono);font-size:10.5px;color:var(--muted)}
  .objkey{font-family:var(--mono);font-size:12px;font-weight:700}
  .objlabel{font-size:13px;color:var(--soft);flex:1;min-width:200px}
  .acts{display:flex;gap:6px;padding:0 18px 12px;align-items:center;flex-wrap:wrap}
  button.act{font-family:inherit;font-size:12.5px;font-weight:600;padding:5px 15px;
             border-radius:7px;cursor:pointer;border:1.5px solid var(--line);background:#fff;
             color:var(--soft)}
  button.act:hover{border-color:var(--muted)}
  button.act.yes.on{background:var(--ok);border-color:var(--ok);color:#fff}
  button.act.no.on{background:var(--no);border-color:var(--no);color:#fff}
  .meta{font-family:var(--mono);font-size:10.5px;color:var(--muted);margin-left:auto}
  pre.topic{font-family:system-ui,-apple-system,sans-serif;font-size:12.5px;line-height:1.65;
            padding:0 18px 12px;white-space:pre-wrap;overflow-wrap:break-word;color:#1e293b;
            max-height:400px;overflow-y:auto}
  .missing{padding:0 18px 12px;font-size:12.5px;color:var(--no)}
  textarea{width:100%;padding:9px 12px;border:1.5px solid #cfd8e3;border-radius:8px;
           font-family:inherit;font-size:13px;resize:vertical;min-height:34px;outline:none;
           background:#fff}
  textarea:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(59,130,246,.13)}
  .notewrap{padding:0 18px 13px;display:none}
  .notewrap.show{display:block}
  .notewrap label{font-size:11px;color:var(--soft);font-weight:600;display:block;margin-bottom:4px}
  .allbtn{padding:11px 18px;border-bottom:1px solid var(--line);background:#fbfcfe;display:flex;
          gap:8px;align-items:center;flex-wrap:wrap}
  .allbtn .hint{font-size:12px;color:var(--muted);margin-left:auto}
  .done{background:var(--card);border:1px solid var(--ok-line);border-radius:12px;padding:34px 22px;
        text-align:center;color:#14532d;box-shadow:var(--shadow)}
  .done h3{font-size:16px;margin-bottom:6px}
  .done p{font-size:13px;color:var(--soft)}

  /* ── footer ── */
  footer{position:sticky;bottom:0;background:rgba(255,255,255,.94);
         backdrop-filter:blur(8px);border-top:1px solid var(--line);height:var(--foot);
         padding:0 22px;display:flex;gap:13px;align-items:center;z-index:20}
  .save{background:var(--navy);color:#fff;border:0;padding:9px 20px;border-radius:8px;
        font-weight:600;font-size:13px;cursor:pointer;font-family:inherit}
  .save:hover{background:var(--navy-2)}
  .status{font-size:12.5px;color:var(--soft)}
  .status.good{color:var(--ok);font-weight:600}
  .status.bad{color:var(--no);font-weight:600}
  .kbd{font-family:var(--mono);font-size:10.5px;color:var(--muted);margin-left:auto}


  /* ── grounding ── */
  .badge{font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;
         padding:3px 9px;border-radius:99px;border:1px solid var(--line);color:var(--soft);
         background:#fff;white-space:nowrap}
  .badge.rev{background:var(--ok-bg);border-color:var(--ok-line);color:var(--ok)}
  .badge.pend{background:var(--warn-bg);border-color:var(--warn-line);color:var(--warn)}
  .chips{display:flex;gap:6px;flex-wrap:wrap;padding:12px 18px}
  .chip{font-size:12px;padding:4px 11px;border-radius:99px;border:1px solid var(--line);
        background:#fbfcfe;color:#334155;cursor:pointer;font-family:inherit;display:flex;
        gap:7px;align-items:center}
  .chip:hover{border-color:var(--blue);color:#1d4ed8;background:var(--blue-soft)}
  .chip .num{font-family:var(--mono);font-size:10.5px;color:var(--muted)}
  .chip.rev .num{color:var(--ok)}
  .chip.pend .num{color:var(--warn)}
  .chip.missing{border-color:var(--no-line);background:var(--no-bg);color:var(--no)}
  pre.section{font-family:system-ui,-apple-system,sans-serif;font-size:12.5px;line-height:1.7;
              padding:14px 18px;white-space:pre-wrap;overflow-wrap:break-word;color:#1e293b;
              max-height:min(56vh,620px);overflow-y:auto}
  .gnote{padding:0 18px 14px}
  .sidegroup{font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;color:var(--muted);
             padding:9px 10px 3px;text-transform:uppercase}
  .nocorpus{padding:26px 22px;text-align:center;color:var(--soft);font-size:13px}
  button.act:disabled{opacity:.45;cursor:default}
  button.act:disabled:hover{border-color:var(--line)}

  @media (max-width:1000px){
    .shell{grid-template-columns:minmax(0,1fr)}
    aside{display:none}
    .stats{display:none}
  }
</style></head><body>
<header>
  <div class="brand">
    <span class="mark">SAB</span>
    <div style="min-width:0">
      <div class="eyebrow" id="h-eyebrow"></div>
      <h1 id="h-title"></h1>
    </div>
  </div>
  <div class="stats">
    <span class="pill" id="p-pos"></span>
    <span class="pill ok" id="p-ok"></span>
    <span class="pill no" id="p-no"></span>
    <span class="pill" id="p-left"></span>
  </div>
  <div class="nav">
    <span class="seg" id="courseseg"></span>
    <span class="seg" id="modeseg"></span>
    <span class="seg">
      <button id="f-todo" class="on" onclick="setFilter('todo')">to review</button>
      <button id="f-all" onclick="setFilter('all')">all</button>
    </span>
    <button class="step" onclick="step(-1)" title="previous (k)">&#8249;</button>
    <button class="step" onclick="step(1)" title="next (j)">&#8250;</button>
  </div>
</header>
<div class="shell">
  <aside id="side"></aside>
  <main id="main"></main>
</div>
<footer>
  <button class="save" id="savebtn" onclick="save()">Save decisions</button>
  <span class="status" id="status">Autosaves a moment after each change.</span>
  <span class="kbd" id="kbd">j / k move · a accepts all · c copies the link</span>
</footer>
<script>
const COURSES = __COURSES__;
const SLOTS   = __SLOTS__;

// The course and the mode are the two axes of the page. Everything below reads the CURRENT
// course through these bindings, which loadCourse() reseats — so the artifact code is the
// same code it always was, pointed at a different course.
let ci = 0, mode = "artifacts";
let ARTIFACTS = [], NOTES = {}, SECTIONS = [], GNOTES = {}, CORPUS = null;
let state = {}, gstate = {};
let idx = 0, gidx = 0, timer = null, dirty = false, gdirty = false, filter = "todo";

function loadCourse(i){
  ci = i;
  const c = COURSES[i];
  ARTIFACTS = c.artifacts;
  NOTES     = c.notes;
  CORPUS    = c.corpus && c.corpus.sections ? c.corpus : null;
  SECTIONS  = CORPUS ? CORPUS.sections : [];
  GNOTES    = CORPUS ? CORPUS.notes : {};
  state = {}; gstate = {};

  ARTIFACTS.forEach(a => {
    const prev = NOTES[a.slug] || {};
    const objs = {};
    a.objectives.forEach(o => {
      const p = (prev.objectives || {})[o.key] || {};
      objs[o.key] = {decision: p.decision || "", comment: p.comment || "",
                     by: p.by || "", stale: !!(p.sha && p.sha !== o.sha)};
    });
    const params = {};
    SLOTS.forEach(s => { params[s[0]] = ((prev.params || {})[s[0]]) || ""; });
    state[a.slug] = {objectives: objs, params: params, open: {}};
  });

  // A section's approval lives in the CORPUS, not in the sidecar — `STATUS: REVIEWED` is
  // the string the build gate greps, and it is the only record that a human read the
  // physics. So `reviewed` from the file wins over anything the notes say.
  SECTIONS.forEach(s => {
    const p = GNOTES[s.id] || {};
    gstate[s.id] = {decision: s.reviewed ? "approved" : (p.decision || ""),
                    note: p.note || "",
                    stale: !!(p.sha && p.sha !== s.sha)};
  });

  // Open on the first thing that still needs a decision rather than on lesson 4, which is
  // long since reviewed. Falls back to the first artifact when nothing is outstanding.
  idx  = Math.max(0, ARTIFACTS.findIndex(a => !verdict(a)));
  gidx = Math.max(0, SECTIONS.findIndex(s => !s.reviewed));
  if (!CORPUS) mode = "artifacts";
}

function switchCourse(i){
  if (i === ci) return;
  flush();
  loadCourse(i);
  filter = "todo";
  document.getElementById("f-todo").className = "on";
  document.getElementById("f-all").className = "";
  render();
  window.scrollTo(0, 0);
}

function setMode(m){
  if (m === mode) return;
  if (m === "grounding" && !CORPUS) return;
  flush();
  mode = m;
  render();
  window.scrollTo(0, 0);
}

function esc(s){ const d=document.createElement("div"); d.textContent=s==null?"":s; return d.innerHTML; }

function verdict(a){
  const v = Object.values(state[a.slug].objectives).map(o => o.decision);
  if (v.length && v.every(d => d === "accepted")) return "accepted";
  if (v.some(d => d === "rejected")) return "rejected";
  if (v.some(d => d)) return "partial";
  return "";
}

// An artifact recorded as accepted because it was published, not because it was judged on
// this page. Shown as such — the two are different claims and must stay tellable apart.
function seededBy(a){
  const o = Object.values(state[a.slug].objectives).find(x => x.by);
  return o ? o.by : "";
}

// The navigation set. The CURRENT artifact stays reachable even once it drops out — you
// accept it, it is no longer "to review", and having the page jump away mid-click is worse
// than briefly showing something the filter excludes.
function visible(){
  return ARTIFACTS.map((a, i) => i).filter(i => filter === "all" || !verdict(ARTIFACTS[i]));
}

function setFilter(f){
  filter = f;
  document.getElementById("f-todo").className = f === "todo" ? "on" : "";
  document.getElementById("f-all").className = f === "all" ? "on" : "";
  if (mode === "grounding"){
    const gset = gvisible();
    if (gset.length && !gset.includes(gidx)) gidx = gset[0];
  } else {
    const set = visible();
    if (set.length && !set.includes(idx)) idx = set[0];
  }
  render();
}

// "Physics 215, Fall 2026, Lesson 29 — Maxwell's Equations" → "Maxwell's Equations", for the
// artifact chips shown on a corpus section.
function artTitle(lesson_id){
  const bits = (lesson_id || "").split(",");
  const tail = bits.length > 2 ? bits.slice(2).join(",").trim() : (lesson_id || "");
  const dash = tail.indexOf("—");
  return dash >= 0 ? tail.slice(dash + 1).trim() : tail;
}

// "Physics 215, Fall 2026, Lesson 29 — Maxwell's Equations" → "Maxwell's Equations".
// Falls back through the whole lesson_id and then the filename, because a hand-edited
// artifact with a differently shaped header should still be navigable rather than blank.
function shortTitle(a){
  const bits = (a.lesson_id || "").split(",");
  const tail = bits.length > 2 ? bits.slice(2).join(",").trim() : (a.lesson_id || a.file);
  const dash = tail.indexOf("—");
  return dash >= 0 ? tail.slice(dash + 1).trim() : tail;
}

// The sidebar always lists EVERY artifact, whatever the filter is. The filter governs where
// `next` goes, not what you are allowed to see — hiding reviewed lessons from the index would
// make the one you just accepted vanish from the page while you are still looking at it.
function renderSide(){
  const set = new Set(visible());
  document.getElementById("side").innerHTML =
    `<div class="sidehead">${ARTIFACTS.length} artifacts</div>` +
    ARTIFACTS.map((x, i) => {
      const v = verdict(x);
      const n = x.lesson_no != null ? String(x.lesson_no).padStart(2, "0") : "··";
      const dim = (filter === "todo" && !set.has(i) && i !== idx) ? "opacity:.5" : "";
      return `<div class="item${i===idx?" on":""}" style="${dim}" onclick="go(${i})"
                   title="${esc(x.slug)}">
        <span class="dot ${v}"></span><span class="n">${n}</span>
        <span class="t">${esc(shortTitle(x))}</span></div>`;
    }).join("");
}

// ── the two modes ────────────────────────────────────────────────────────────

function render(){
  renderChrome();
  if (mode === "grounding") renderGrounding(); else renderArtifacts();
}

// Header furniture that both modes share: the course switcher, the mode switcher, and the
// line that says which of the two writeback rules is currently in force. That line is not
// decoration — one mode writes a sidecar and the other writes the corpus, and the page
// should never leave you guessing which one a click just did.
function renderChrome(){
  document.getElementById("courseseg").innerHTML = COURSES.map((c, i) =>
    `<button class="${i===ci?"on":""}" onclick="switchCourse(${i})">${esc(c.id)}</button>`
  ).join("");
  document.getElementById("modeseg").innerHTML =
    `<button class="${mode==="artifacts"?"on":""}" onclick="setMode('artifacts')">artifacts</button>` +
    (CORPUS ? `<button class="${mode==="grounding"?"on":""}"
                       onclick="setMode('grounding')">grounding</button>` : "");
  document.getElementById("h-eyebrow").textContent = mode === "grounding"
    ? COURSES[ci].id + " · grounding corpus · approving WRITES to the corpus"
    : COURSES[ci].id + " · artifact review · nothing here is applied";
  document.getElementById("savebtn").textContent = mode === "grounding"
    ? "Save — approvals write REVIEWED into the corpus" : "Save decisions";
  document.getElementById("kbd").textContent = mode === "grounding"
    ? "j / k move · a approves this section"
    : "j / k move · a accepts all · c copies the link";
}

function renderArtifacts(){
  const set = visible();
  renderSide();
  if (filter === "todo" && !set.length){ renderDone(); return; }

  const a = ARTIFACTS[idx], st = state[a.slug];
  document.getElementById("h-title").textContent =
    (a.lesson_no != null ? "Lesson " + a.lesson_no + " — " : "") + shortTitle(a);

  const rows = SLOTS.map(([id, label, hint]) => {
    let val = "";
    if (id === "slug") val = a.slug;
    else if (id === "lesson_id") val = a.lesson_id;
    else if (id === "grounding") val = a.grounding;
    else if (id === "topic_count") val = a.topic_count + " probe topics · " +
                                        a.objective_count + " objective keys";
    else if (id === "budget") val = a.budget + " min each · " +
                                    (a.budget * a.topic_count).toFixed(0) + " min total";
    else if (id === "models") val = a.models.join(", ");
    else val = a.component + " · " + a.file + " · version " + a.version;
    const has = st.params[id].trim() ? " has" : "";
    const cls = id === "grounding" ? "v prose" : "v";
    return `<tr>
      <td class="k">${esc(label)}</td>
      <td class="${cls}">${esc(val)}<span class="hint">${esc(hint)}</span></td>
      <td class="n"><button class="noteb${has}" onclick="toggleParam('${id}')">note</button></td>
    </tr>
    <tr id="pn-${id}" style="display:${st.open["p:"+id] || st.params[id] ? "" : "none"}">
      <td colspan="3" style="padding-top:0">
        <label style="font-size:11px;color:#64748b;font-weight:600">Change to make to ${esc(label.toLowerCase())}</label>
        <textarea oninput="setParam('${id}', this.value)"
          placeholder="e.g. drop to 3 topics and widen the budget to 3 min">${esc(st.params[id])}</textarea>
      </td></tr>`;
  }).join("");

  const objs = a.objectives.map(o => {
    const s = st.objectives[o.key];
    const cls = s.decision ? " " + s.decision : "";
    const show = (s.decision === "rejected" || s.comment) ? " show" : "";
    const body = o.text
      ? `<pre class="topic">${esc(o.text)}</pre>`
      : `<div class="missing">No probe-topic prose found for this key in LESSON_CONFIG —
         the objective key and the probe topics may have drifted apart. Worth a look.</div>`;
    return `<div class="obj${cls}">
      <div class="objhead">
        <span class="objnum">${String(o.n).padStart(2,"0")}</span>
        <span class="objkey">${esc(o.key)}</span>
        <span class="objlabel">${esc(o.label)}</span>
        ${s.stale ? '<span class="objnum" style="color:#b45309">note predates a rebuild</span>' : ""}
      </div>
      ${body}
      <div class="acts">
        <button class="act yes${s.decision==="accepted"?" on":""}"
                onclick="mark('${o.key}','accepted')">Accept</button>
        <button class="act no${s.decision==="rejected"?" on":""}"
                onclick="mark('${o.key}','rejected')">Reject</button>
        <button class="noteb${s.comment.trim()?" has":""}" onclick="toggleObj('${o.key}')">note</button>
        <span class="meta">${o.words} words · ${o.sha}</span>
      </div>
      <div class="notewrap${show}" id="on-${o.key}">
        <label>What should change about this objective?</label>
        <textarea oninput="setComment('${o.key}', this.value)"
          placeholder="e.g. topic 3 duplicates topic 2 — replace it with the energy-density question">${esc(s.comment)}</textarea>
      </div>
    </div>`;
  }).join("");

  // The registration link. Shown only where it can be built honestly: it needs the published
  // URL, and that lives in BUILD-LOG.md and nowhere else a machine can read.
  const reg = a.prefill ? `<div class="reg">
      <div class="lead">Opens the DFPM <b>New lesson — review &amp; save</b> form with every field
        filled in. <b>Nothing is written until you click Save</b> — the link carries
        <code>pub=0</code>, so the row lands as a draft.</div>
      <div class="linkbox">
        <code id="pf">${esc(a.prefill)}</code>
        <span class="side">
          <button id="pfcopy" onclick="copyLink()">Copy</button>
          <a href="${esc(a.prefill)}" target="_blank" rel="noopener">Open&nbsp;&#8250;</a>
        </span>
      </div>
      <div class="match">
        <div><div class="lbl">id= in this link</div><div class="val">${esc(a.slug)}</div></div>
        <div><div class="lbl">INTERACTION_ID in the artifact</div>
             <div class="val">${esc(a.slug)}</div></div>
      </div>
      <div class="warnline"><b>These two must be identical, and that is the whole point of the
        card.</b> The <code>id</code> above was read out of the artifact source, never
        re-derived — contract §3.2 ends every slug in 8 random hex minted once per build, so
        there is nothing to re-derive it from. If a saved row's <code>id</code> ever differs
        from the artifact's <code>#i=</code>, every cadet report is discarded with no error
        anywhere: the cadet finishes, sees a success page, and the work reaches nothing.</div>
    </div>`
    : a.published ? `<div class="nolink">No registration link — this course's profile has no
        <code>prefill_base</code> or <code>course_id</code>.</div>`
    : !a.pub_known ? `<div class="nolink">No registration link, because the published URL cannot
        be found. It is the one value in the link that is not derivable from the artifact
        source, and this course has no <code>BUILD-LOG.md</code> to read it from.</div>`
    : `<div class="nolink">No registration link yet — this artifact is not published, and the
        link needs the public URL that publishing creates.</div>`;

  document.getElementById("main").innerHTML = `
    ${a.published ? `<div class="banner"><b>This artifact is published.</b> Any change here
      costs a republish, and republishing mints a new 8-hex slug — so it registers as a
      <b>new lesson row</b>, not an update to the live one (contract §3.2). Reject anyway if it
      is wrong; just know the price.<br><a href="${esc(a.published)}" target="_blank"
      rel="noopener">${esc(a.published)}</a></div>`
      : !a.pub_known ? `<div class="banner"><b>Publication status unknown.</b> This course has
      no <code>BUILD-LOG.md</code>, which is the only place a slug is paired with a published
      URL — so this page cannot tell a draft from a live artifact here. Check before assuming a
      change is free.</div>` : ""}
    ${seededBy(a) ? `<div class="seeded"><b>Already accepted</b> — recorded from
      <b>${esc(seededBy(a))}</b>, not judged on this page. Publishing follows your review, so
      this is a record of a decision you already made. Change anything here and it becomes a
      real verdict.</div>` : ""}
    ${groundingCard(a)}
    <div class="card"><h2>Registration <span class="count">prefill link · policy=interaction ·
      num=${a.lesson_no != null ? a.lesson_no : "—"}</span></h2>${reg}</div>
    <div class="card"><h2>Parameters</h2><table>${rows}</table></div>
    <div class="card">
      <h2>Objectives &amp; probe topics <span class="count">${a.objectives.length}</span></h2>
      <div class="allbtn">
        <button class="act yes" onclick="all('accepted')">Accept all objectives</button>
        <button class="act" onclick="all('')">Clear all</button>
        <span class="hint">Accept some and reject others by using the buttons on each.</span>
      </div>
      ${objs}
    </div>`;
  counts();
}

// Clipboard, with a fallback. `navigator.clipboard` needs a secure context; 127.0.0.1 counts
// as one, but a session reached over a forwarded port may not, and a Copy button that silently
// does nothing is worse than no button — so the fallback runs and the status line says which.
function copyLink(){
  const el = document.getElementById("pf");
  if (!el) return;
  const text = el.textContent;
  const done = () => {
    const b = document.getElementById("pfcopy");
    b.textContent = "Copied"; b.classList.add("done");
    setTimeout(() => { b.textContent = "Copy"; b.classList.remove("done"); }, 1400);
  };
  if (navigator.clipboard && window.isSecureContext){
    navigator.clipboard.writeText(text).then(done, fallback);
  } else fallback();
  function fallback(){
    const t = document.createElement("textarea");
    t.value = text; t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t); t.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(t);
    if (ok) done();
    else { const r = document.createRange(); r.selectNodeContents(el);
           const s = getSelection(); s.removeAllRanges(); s.addRange(r);
           setStatus("could not copy — the link is selected, press Ctrl+C", "bad"); }
  }
}

function renderDone(){
  const v = ARTIFACTS.map(verdict);
  document.getElementById("h-title").textContent = "Nothing left to review";
  renderSide();
  document.getElementById("main").innerHTML = `<div class="done">
    <h3>All ${ARTIFACTS.length} artifacts carry a decision.</h3>
    <p>${v.filter(x=>x==="accepted").length} accepted ·
       ${v.filter(x=>x==="rejected").length} with rejections ·
       ${v.filter(x=>x==="partial").length} partly decided.
       Switch to <b>all</b> to revisit any of them.</p></div>`;
  counts();
}

function counts(){
  if (mode === "grounding"){ gcounts(); return; }
  const v = ARTIFACTS.map(verdict);
  const left = v.filter(x=>!x).length;
  document.getElementById("p-pos").textContent =
    filter !== "todo" ? (idx+1) + " / " + ARTIFACTS.length
    : left === 0    ? "all reviewed"
                    : (visible().indexOf(idx) + 1 || 1) + " of " + left;
  document.getElementById("p-ok").textContent = v.filter(x=>x==="accepted").length + " accepted";
  document.getElementById("p-no").textContent =
    v.filter(x=>x==="rejected").length + " with rejections";
  document.getElementById("p-left").textContent = left + " to review";
}


// ── the join, rendered on an artifact ────────────────────────────────────────

// What this artifact was built on, and whether a human has read it. For PHYS 310 the answer
// is mostly "no": recker lifted the build gate on 2026-08-05 and sixteen artifacts were
// built against PENDING sections. Showing the status here is the point of merging the two
// pages — the objective prose below was written FROM this material, so judging the prose
// without knowing whether its source is attested is judging half the thing.
function groundingCard(a){
  const secs = a.corpus || [];
  if (!secs.length) return "";
  const pend = secs.filter(s => !s.reviewed && !s.missing).length;
  const gone = secs.filter(s => s.missing);
  const chips = secs.map(s => s.missing
    ? `<span class="chip missing" title="named in BUILD-LOG.md, absent from the corpus">
         <span class="num">§${esc(s.num)}</span> not in the corpus</span>`
    : `<button class="chip ${s.reviewed?"rev":"pend"}" onclick="jumpToSection('${s.id}')"
               title="${esc(s.status || "PENDING")}">
         <span class="num">§${esc(s.num)}</span>${esc(stripNum(s.title))}</button>`
  ).join("");
  return `<div class="card">
    <h2>Built on <span class="count">${secs.length} corpus section${secs.length===1?"":"s"} ·
      ${pend} still pending</span></h2>
    ${pend ? `<div class="banner" style="margin:12px 18px 0">
      <b>${pend} of these ${secs.length} section${secs.length===1?" is":"s are"} still
      <code>STATUS: PENDING</code>.</b> This artifact was built against grounding nobody has
      checked against the book — the gate was lifted deliberately, not skipped. Reviewing a
      section below is what makes this draft's physics attested.</div>` : ""}
    ${gone.length ? `<div class="banner" style="margin:12px 18px 0;background:var(--no-bg);
      border-color:var(--no-line);color:#7f1d1d"><b>BUILD-LOG.md names a section the corpus
      does not contain.</b> The two files disagree about what this artifact was built on.</div>` : ""}
    <div class="chips">${chips}</div></div>`;
}

function stripNum(title){
  const m = /^§\s*[\d.]+\s*[—–-]?\s*(.*)$/.exec(title || "");
  return m ? m[1] : (title || "");
}

function jumpToSection(id){
  const i = SECTIONS.findIndex(s => s.id === id);
  if (i < 0) return;
  flush();
  gidx = i; mode = "grounding"; filter = "all";
  document.getElementById("f-todo").className = "";
  document.getElementById("f-all").className = "on";
  render(); window.scrollTo(0, 0);
}

function jumpToArtifact(slug){
  const i = ARTIFACTS.findIndex(a => a.slug === slug);
  if (i < 0) return;
  flush();
  idx = i; mode = "artifacts"; filter = "all";
  document.getElementById("f-todo").className = "";
  document.getElementById("f-all").className = "on";
  render(); window.scrollTo(0, 0);
}


// ── grounding mode ───────────────────────────────────────────────────────────

// A rejection is a decision, so it leaves the "to review" set even though the section stays
// PENDING in the corpus. PENDING is the right state for "not approved" — it is not the same
// claim as "not yet read", and only the corpus needs to keep them identical.
function gdecided(s){ return s.reviewed || !!gstate[s.id].decision; }

function gvisible(){
  return SECTIONS.map((s, i) => i).filter(i => filter === "all" || !gdecided(SECTIONS[i]));
}

function chapterOf(s){ return (s.num || "").split(".")[0]; }

function renderGroundSide(){
  const set = new Set(gvisible());
  let html = `<div class="sidehead">${SECTIONS.length} sections · ${CORPUS.reviewed} reviewed</div>`;
  let chap = null;
  SECTIONS.forEach((s, i) => {
    if (chapterOf(s) !== chap){ chap = chapterOf(s); html += `<div class="sidegroup">chapter ${esc(chap)}</div>`; }
    const g = gstate[s.id];
    const v = s.reviewed ? "accepted" : g.decision === "rejected" ? "rejected"
            : g.note.trim() ? "partial" : "";
    const dim = (filter === "todo" && !set.has(i) && i !== gidx) ? "opacity:.5" : "";
    html += `<div class="item${i===gidx?" on":""}" style="${dim}" onclick="ggo(${i})"
                  title="${esc(s.title)}">
      <span class="dot ${v}"></span><span class="n">${esc(s.num)}</span>
      <span class="t">${esc(stripNum(s.title))}</span></div>`;
  });
  document.getElementById("side").innerHTML = html;
}

function renderGrounding(){
  renderGroundSide();
  const set = gvisible();
  if (filter === "todo" && !set.length){
    document.getElementById("h-title").textContent = "Every section reviewed";
    document.getElementById("main").innerHTML = `<div class="done">
      <h3>All ${SECTIONS.length} corpus sections are <code>STATUS: REVIEWED</code>.</h3>
      <p>Switch to <b>all</b> to revisit any of them.</p></div>`;
    gcounts(); return;
  }

  const s = SECTIONS[gidx], g = gstate[s.id];
  document.getElementById("h-title").textContent = s.title;

  const users = (s.used_by || []).map(u => `<button class="chip" onclick="jumpToArtifact('${u.slug}')">
      <span class="num">${u.lesson_no != null ? "L" + u.lesson_no : "—"}</span>
      ${esc(artTitle(u.lesson_id) || u.file)}${u.published ? " · published" : ""}</button>`).join("");

  document.getElementById("main").innerHTML = `
    <div class="banner"><b>Approving a section writes to the corpus.</b> It rewrites that
      section's line to <code>STATUS: REVIEWED ${new Date().toISOString().slice(0,10)}</code> —
      the exact string the build gate greps — and nothing else in the section is touched.
      <b>Rejecting writes nothing to the corpus</b>; it goes to
      <code>${esc(CORPUS.notes_path)}</code>, because <code>PENDING</code> is already the
      right state for "not approved".</div>
    ${s.reviewed ? `<div class="seeded"><b>Already reviewed</b> — <code>${esc(s.status)}</code>.
      Attested against the book. Re-approving does nothing; this page will not rewrite an
      existing REVIEWED line.</div>` : ""}
    ${g.stale ? `<div class="banner"><b>Your note predates a rewrite of this section.</b>
      The text below is not the text the note was written against.</div>` : ""}
    <div class="card">
      <h2>Grounds <span class="count">${(s.used_by||[]).length} artifact${(s.used_by||[]).length===1?"":"s"}</span></h2>
      ${users ? `<div class="chips">${users}</div>`
              : `<div class="nocorpus">No artifact in this course cites this section.</div>`}
    </div>
    <div class="card">
      <h2>${esc(s.title)}
        <span class="badge ${s.reviewed?"rev":"pend"}">${esc(s.reviewed ? s.status : "pending")}</span>
        <span class="count">${s.words} words · ${s.sha}</span></h2>
      <pre class="section">${esc(s.text)}</pre>
      <div class="acts" style="padding:0 18px 14px">
        <button class="act yes${g.decision==="approved"?" on":""}"
                onclick="gmark('approved')" ${s.reviewed?"disabled":""}>Approve</button>
        <button class="act no${g.decision==="rejected"?" on":""}"
                onclick="gmark('rejected')">Reject</button>
        <span class="meta">${esc(s.lesson || "")}</span>
      </div>
      <div class="gnote">
        <label style="font-size:11px;color:#64748b;font-weight:600;display:block;margin-bottom:4px">
          What is wrong with this section, or what did you check?</label>
        <textarea oninput="gsetNote(this.value)"
          placeholder="e.g. the energy table does not close — 207 vs 200 vs 193">${esc(g.note)}</textarea>
      </div>
    </div>`;
  gcounts();
}

function gcounts(){
  const left = SECTIONS.filter(s => !gdecided(s)).length;
  const rej  = SECTIONS.filter(s => gstate[s.id].decision === "rejected").length;
  document.getElementById("p-pos").textContent =
    filter !== "todo" ? (gidx+1) + " / " + SECTIONS.length
    : left === 0 ? "all reviewed" : (gvisible().indexOf(gidx) + 1 || 1) + " of " + left;
  document.getElementById("p-ok").textContent = CORPUS.reviewed + " reviewed";
  document.getElementById("p-no").textContent = rej + " rejected";
  document.getElementById("p-left").textContent = left + " pending";
}

function ggo(i){ if(i<0||i>=SECTIONS.length) return; flush(); gidx=i; render(); window.scrollTo(0,0); }
function gstep(d){
  const set = gvisible();
  if (!set.length) return;
  const here = set.indexOf(gidx);
  if (here === -1){
    const fwd = set.find(i => i > gidx), back = [...set].reverse().find(i => i < gidx);
    ggo(d > 0 ? (fwd !== undefined ? fwd : set[0]) : (back !== undefined ? back : set[set.length-1]));
    return;
  }
  const next = here + d;
  if (next >= 0 && next < set.length) ggo(set[next]);
}
function gmark(d){
  const s = SECTIONS[gidx];
  if (s.reviewed && d === "approved") return;
  const g = gstate[s.id];
  g.decision = g.decision === d ? "" : d;
  gtouch(); render();
}
function gsetNote(v){ gstate[SECTIONS[gidx].id].note = v; gtouch(); }

// Grounding does NOT autosave. An artifact decision costs nothing until an agent acts on
// it; an approval here rewrites a tracked source file the moment it lands. A 1.2-second
// debounce is the wrong contract for that, so this only marks the page dirty and the Save
// button does the write.
function gtouch(){ gdirty = true; setStatus("unsaved — click Save to write approvals to the corpus"); }

async function saveGrounding(){
  setStatus("saving…");
  const out = {};
  SECTIONS.forEach(s => {
    const g = gstate[s.id];
    if (!g.decision && !g.note.trim()) return;
    out[s.id] = {decision: g.decision, note: g.note, sha: s.sha, title: s.title};
  });
  try{
    const r = await fetch("/save-grounding", {method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({course: COURSES[ci].id, sections: out})});
    const j = await r.json();
    if(!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    gdirty = false;
    // The corpus changed under us, so re-read rather than trusting the page's own copy.
    if (j.approved){
      SECTIONS.forEach(s => { if (j.reviewed_titles.includes(s.title)){
        s.reviewed = true; s.status = "REVIEWED " + j.date; } });
      CORPUS.reviewed = SECTIONS.filter(s => s.reviewed).length;
    }
    setStatus(`saved · ${j.approved} approved into the corpus · ${j.rejected} rejected`
              + (j.stale.length ? ` · ${j.stale.length} skipped as stale` : ""), "good");
    render();
  }catch(e){ setStatus("save failed: " + e.message + " — your work is still on this page", "bad"); }
}

function go(i){ if(i<0||i>=ARTIFACTS.length) return; flush(); idx=i; render(); window.scrollTo(0,0); }
function step(d){
  const set = visible();
  if (!set.length) return;
  // Step within the filtered set. Once the current artifact has dropped out of it, "next"
  // means the first one after this position rather than an index arithmetic that skips.
  const here = set.indexOf(idx);
  if (here === -1){
    const fwd = set.find(i => i > idx), back = [...set].reverse().find(i => i < idx);
    go(d > 0 ? (fwd !== undefined ? fwd : set[0]) : (back !== undefined ? back : set[set.length-1]));
    return;
  }
  const next = here + d;
  if (next >= 0 && next < set.length) go(set[next]);
}
// A click is a judgment; a seeded record is not. Once you touch an objective the `by`
// provenance is dropped, because from that point the decision is yours.
function mark(key,d){ const s=state[ARTIFACTS[idx].slug].objectives[key];
  s.decision = s.decision===d ? "" : d; s.by = ""; touch(); render(); }
function all(d){ const st=state[ARTIFACTS[idx].slug];
  Object.values(st.objectives).forEach(o => { o.decision = d; o.by = ""; }); touch(); render(); }
function setComment(key,v){ state[ARTIFACTS[idx].slug].objectives[key].comment=v; touch(); }
function setParam(id,v){ state[ARTIFACTS[idx].slug].params[id]=v; touch(); }
function toggleObj(key){ const el=document.getElementById("on-"+key); el.classList.toggle("show");
  const t=el.querySelector("textarea"); if(el.classList.contains("show")) t.focus(); }
function toggleParam(id){ const el=document.getElementById("pn-"+id);
  const showing = el.style.display !== "none";
  el.style.display = showing ? "none" : "";
  state[ARTIFACTS[idx].slug].open["p:"+id] = !showing;
  if(!showing) el.querySelector("textarea").focus(); }

function touch(){ dirty=true; setStatus("unsaved changes"); clearTimeout(timer);
  timer=setTimeout(save, 1200); }
function flush(){ if(dirty){ clearTimeout(timer); save(); } if(gdirty){ saveGrounding(); } }
function setStatus(msg, cls){ const el=document.getElementById("status");
  el.className = "status" + (cls?" "+cls:""); el.textContent = msg; }

function payload(){
  const out = {};
  ARTIFACTS.forEach(a => {
    const st = state[a.slug];
    const objs = {};
    a.objectives.forEach(o => {
      const s = st.objectives[o.key];
      if (s.decision || s.comment.trim()){
        objs[o.key] = {decision: s.decision, comment: s.comment, sha: o.sha, label: o.label};
        if (s.by) objs[o.key].by = s.by;
      }
    });
    out[a.slug] = {file: a.file, objectives: objs, params: st.params};
  });
  return out;
}

async function save(){
  if (mode === "grounding"){ await saveGrounding(); return; }
  clearTimeout(timer);
  setStatus("saving…");
  try{
    const r = await fetch("/save", {method:"POST", headers:{"Content-Type":"application/json"},
                                    body: JSON.stringify({course: COURSES[ci].id,
                                                          artifacts: payload()})});
    const j = await r.json();
    if(!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    dirty = false;
    setStatus(`saved · ${j.artifacts} artifact(s) with notes → ${j.notes}`, "good");
  }catch(e){ setStatus("save failed: " + e.message + " — your work is still on this page",
                       "bad"); }
}

document.addEventListener("keydown", e => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const g = mode === "grounding";
  if (e.key === "j" || e.key === "ArrowRight") g ? gstep(1) : step(1);
  else if (e.key === "k" || e.key === "ArrowLeft") g ? gstep(-1) : step(-1);
  else if (e.key === "a") g ? gmark("approved") : all("accepted");
  else if (e.key === "c" && !g) copyLink();
});
window.addEventListener("beforeunload", e => {
  if(dirty || gdirty){ flush(); e.preventDefault(); }
});
loadCourse(0);
render();
</script></body></html>
"""


def build_page(courses: list[dict]) -> str:
    def js(o: object) -> str:
        return json.dumps(o, ensure_ascii=False).replace("<", "\\u003c")

    return (PAGE
            .replace("__COURSES__", js(courses))
            .replace("__SLOTS__", js(PARAM_SLOTS)))


# ── server ───────────────────────────────────────────────────────────────────

def make_handler(first: str, lock: threading.Lock):
    def course_dir(cid: str) -> pathlib.Path:
        """Resolve a posted course id to a directory, refusing anything else.

        The id arrives from the page, so it is untrusted input that gets joined onto a path
        and then written to. A bare join accepts `../../` and lands a sidecar outside the
        repository, so the name is required to be a single path component that already
        exists as a course. Loopback-only binding is not the control here — a browser tab on
        any origin can POST to 127.0.0.1.
        """
        if not cid or "/" in cid or "\\" in cid or cid in (".", ".."):
            raise KeyError(cid)
        path = COURSES / cid
        if not (path / "artifacts").is_dir():
            raise KeyError(cid)
        return path

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def _send(self, code: int, body: bytes, ctype: str) -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, code: int, obj: dict) -> None:
            self._send(code, json.dumps(obj).encode(), "application/json; charset=utf-8")

        def do_GET(self) -> None:
            if self.path.split("?")[0] not in ("/", "/index.html"):
                self._send(404, b"not found", "text/plain; charset=utf-8")
                return
            with lock:
                courses = collect_courses(first)     # re-read: never a cached copy
            self._send(200, build_page(courses).encode("utf-8"), "text/html; charset=utf-8")

        def _body(self) -> dict | None:
            try:
                n = int(self.headers.get("Content-Length", 0))
                return json.loads(self.rfile.read(n).decode("utf-8"))
            except (ValueError, json.JSONDecodeError) as exc:
                self._json(400, {"error": str(exc)})
                return None

        def do_POST(self) -> None:
            if self.path == "/save":
                self._save_artifacts()
            elif self.path == "/save-grounding":
                self._save_grounding()
            else:
                self._send(404, b"not found", "text/plain; charset=utf-8")

        def _save_artifacts(self) -> None:
            """Sidecar only. This route cannot reach a `.jsx` and never has."""
            body = self._body()
            if body is None:
                return
            try:
                cdir = course_dir(body.get("course", ""))
            except KeyError as exc:
                self._json(400, {"error": f"unknown course {exc}"})
                return
            npath = notes_path(cdir)
            with lock:
                merged = save_notes(npath, cdir.name, body.get("artifacts", {}))
            report(merged)
            self._json(200, {
                "artifacts": len(merged),
                "notes": str(npath.relative_to(REPO)).replace("\\", "/"),
            })

        def _save_grounding(self) -> None:
            """Approvals are written INTO the corpus; rejections are not.

            Every rule about that write belongs to `serve_review.py` and is called, not
            reproduced: re-read immediately before writing, refuse a section whose text
            changed since the page rendered it, atomic replace, rejections to the sidecar.
            """
            body = self._body()
            if body is None:
                return
            try:
                cdir = course_dir(body.get("course", ""))
            except KeyError as exc:
                self._json(400, {"error": f"unknown course {exc}"})
                return
            source = corpus_path(cdir)
            if not source:
                self._json(400, {"error": f"{cdir.name} has no grounding corpus"})
                return

            incoming = body.get("sections", {})
            npath = corpus_review.notes_path(source)
            today = datetime.date.today().isoformat()
            with lock:
                raw, sections = corpus_review.parse_corpus(source)
                by_id = {s["id"]: s for s in sections}
                approved, stale = [], []
                for sid, rec in incoming.items():
                    if rec.get("decision") != "approved":
                        continue
                    sec = by_id.get(sid)
                    if not sec:
                        continue
                    if rec.get("sha") and rec["sha"] != sec["sha"]:
                        stale.append(sec["title"])
                        continue
                    raw, changed = corpus_review.set_reviewed(raw, sec["title"], today)
                    if changed:
                        approved.append(sec["title"])
                if approved:
                    tmp = source.with_suffix(".md.tmp")
                    tmp.write_text(raw, encoding="utf-8", newline="")
                    tmp.replace(source)
                merged = corpus_review.save_notes(
                    npath, source, corpus_review.load_notes(npath), incoming)

            rejected = [v for v in merged.values() if v.get("decision") == "rejected"]
            say(f"\n  corpus  {len(approved)} section(s) marked REVIEWED {today}")
            for title in approved:
                say(f"    APPROVED  {title}")
            for sid, rec in sorted(merged.items()):
                if rec.get("decision") == "rejected":
                    say(f"    REJECTED  {rec.get('title', sid)[:44]:<44} "
                        f"{(rec.get('note') or '(no note)')[:58]}")
            for title in stale:
                say(f"    SKIPPED   {title} - text changed since you read it; re-review")

            self._json(200, {
                "approved": len(approved), "reviewed_titles": approved,
                "rejected": len(rejected), "stale": stale, "date": today,
                "notes": str(npath.relative_to(REPO)).replace("\\", "/"),
            })

        def log_message(self, *a: object) -> None:
            pass

    return Handler


def report(merged: dict) -> None:
    """Print the current state of the sidecar after a save."""
    say(f"\n  saved  {len(merged)} artifact(s) carry a decision or a note")
    for slug, rec in sorted(merged.items()):
        objs = rec.get("objectives", {})
        ok = sum(1 for v in objs.values() if v.get("decision") == "accepted")
        no = sum(1 for v in objs.values() if v.get("decision") == "rejected")
        params = len(rec.get("params", {}))
        say(f"    {slug[:52]:<52} {ok} accepted, {no} rejected, {params} param note(s)")
        for key, v in objs.items():
            if v.get("comment", "").strip():
                say(f"        {key[:34]:<34} {v['comment'].strip()[:60]}")


# ── entry points that do not serve ───────────────────────────────────────────

def dump(artifacts: list[dict]) -> None:
    """Parse-only mode: prove the extraction works without starting a server."""
    for a in artifacts:
        say(f"\n  {a['file']}")
        say(f"    slug        {a['slug']}")
        say(f"    lesson_id   {a['lesson_id'][:74]}")
        say(f"    shape       {a['topic_count']} topics x {a['budget']} min · "
            f"{a['objective_count']} keys · models {', '.join(a['models'])}")
        say(f"    published   {a['published'] or ('(draft)' if a['pub_known'] else '(UNKNOWN — no BUILD-LOG.md)')}")
        for o in a["objectives"]:
            flag = "  <-- NO PROSE" if not o["text"] else ""
            say(f"      {o['n']}. {o['key']:<34} {o['words']:>4} words  {o['sha']}{flag}")
    bad = [a for a in artifacts if a["missing_prose"]]
    words = [o["words"] for a in artifacts for o in a["objectives"]]
    say(f"\n  {len(artifacts)} artifact(s) parsed, {len(words)} objectives, "
        f"{len(bad)} with an unmatched objective key")
    say(f"  probe-topic length: {min(words)}-{max(words)} words")
    if bad:
        for a in bad:
            say(f"    {a['file']}: {', '.join(a['missing_prose'])}")

    # A topic several times longer than its neighbours is the signature of a block regex
    # that started outside the probe_topics region. It parses cleanly and shows the wrong
    # prose, so it has to be checked by proportion rather than by whether it matched.
    for a in artifacts:
        lens = sorted(o["words"] for o in a["objectives"])
        median = lens[len(lens) // 2]
        for o in a["objectives"]:
            if median and o["words"] > 4 * median:
                say(f"    SUSPECT  {a['file']} · {o['key']}: {o['words']} words vs a "
                    f"{median}-word median — is the block regex over-reaching?")


def seed(artifacts: list[dict], npath: pathlib.Path, course: str,
         want: list[str], published_only: bool, commit: bool, because: str = "") -> int:
    """Record an existing approval that was made outside this page.

    **This does not approve anything.** `CORE.md` §6 reserves approval for recker, and an
    agent may not mark an artifact ready. What this writes is a record of an approval that
    already happened and left evidence in the repository: publication. Publishing is a
    human act that follows review — twelve PHYS 215 artifacts were reviewed and published
    on 2026-08-04, and re-reading them in this page would be asking recker to redo work
    already done.

    So the seeded entry is deliberately distinguishable from a click: it carries
    `by: "published <date>"` rather than a bare decision, and the reason is that these two
    must never be confused when the notes are worked through later. A click is a judgment
    about the prose. This is an inference from the fact that the artifact went live.

    Skips any objective that already carries a decision or a comment — a real review always
    wins over an inference. Dry-run by default (`python.md` §8); `--commit` writes.
    """
    existing = load_notes(npath)
    by_slug = {a["slug"]: a for a in artifacts}

    if want:
        unknown = [s for s in want if s not in by_slug]
        if unknown:
            say(f"  error: no artifact with slug(s): {', '.join(unknown)}")
            return 1
        targets = [by_slug[s] for s in want]
    else:
        targets = [a for a in artifacts if a["published"]]

    if not targets:
        if published_only and artifacts and not artifacts[0]["pub_known"]:
            say(f"  courses/{course}/ has no BUILD-LOG.md, so no artifact here is known to be\n"
                f"  published and nothing can be seeded from publication. Name the slugs\n"
                f"  explicitly instead:  --accept <slug> [<slug> ...]")
        else:
            say("  nothing to seed — no published artifact found.")
        return 0

    planned: dict[str, dict] = {}
    skipped = 0
    for art in targets:
        prev_objs = existing.get(art["slug"], {}).get("objectives", {})
        objs = dict(prev_objs)
        added = 0
        for o in art["objectives"]:
            held = prev_objs.get(o["key"], {})
            if held.get("decision") or held.get("comment", "").strip():
                skipped += 1
                continue
            objs[o["key"]] = {
                "decision": "accepted",
                "comment": "",
                "sha": o["sha"],
                "label": o["label"],
                "by": because or (f"published {art['published_on']}".strip()
                                  if art["published"] else "recorded as already reviewed"),
            }
            added += 1
        planned[art["slug"]] = {
            "file": art["file"],
            "objectives": objs,
            "params": existing.get(art["slug"], {}).get("params", {}),
        }
        mark = art["published_on"] or "no date"
        say(f"    {art['slug'][:52]:<52} {added:>2} objective(s) accepted  ({mark})")

    say(f"\n  {len(planned)} artifact(s), "
        f"{sum(len(p['objectives']) for p in planned.values())} objective(s)"
        + (f", {skipped} left alone (already decided or commented)" if skipped else ""))

    if not commit:
        say("\n  DRY RUN — nothing written. Re-run with --commit to record these.")
        return 0

    merged = save_notes(npath, course, planned)
    say(f"\n  wrote {npath.relative_to(REPO)} — {len(merged)} artifact(s) now carry a record.")
    return 0


def links(artifacts: list[dict]) -> int:
    """Print every registration link, for handing over without opening the page.

    Each is printed with the slug above it, because the slug is the value that has to be
    checked and a bare wall of URLs is unreadable. Exits non-zero if any published artifact
    has no link — that means the profile is missing `prefill_base` or `course_id`, which is
    a real gap rather than a quiet blank.
    """
    missing = 0
    for a in artifacts:
        if a["prefill"]:
            say(f"\n  Lesson {a['lesson_no']} · {a['slug']}")
            say(f"  {a['prefill']}")
        elif a["published"]:
            say(f"\n  Lesson {a['lesson_no']} · {a['slug']}")
            say("  NO LINK — the course profile has no prefill_base or course_id")
            missing += 1
    n = sum(1 for a in artifacts if a["prefill"])
    say(f"\n  {n} link(s). Verify each id= against the artifact before saving the row — a "
        f"mismatch\n  discards every cadet report with no error anywhere.")
    return 1 if missing else 0


def grounding_report(course_dir: pathlib.Path) -> int:
    """Print the corpus <-> artifact join without serving anything.

    Proves the join before trusting the page's version of it. The failure this catches is a
    reference in BUILD-LOG.md to a section the corpus does not have, or a section no artifact
    cites — either means the two files disagree about what was read.
    """
    artifacts = collect(course_dir)
    data = load_corpus(course_dir, artifacts)
    if not data:
        say(f"\n  {course_dir.name} has no grounding corpus — nothing to join.")
        return 0

    say(f"\n  corpus    {data['path']}")
    say(f"  sections  {len(data['sections'])}  -  {data['reviewed']} reviewed, "
        f"{len(data['sections']) - data['reviewed']} pending\n")

    bad = 0
    for art in artifacts:
        secs = art.get("corpus", [])
        pend = sum(1 for s in secs if not s["reviewed"] and not s["missing"])
        gone = [s["num"] for s in secs if s["missing"]]
        bad += len(gone)
        lesson = f"L{art['lesson_no']}" if art["lesson_no"] is not None else "--"
        say(f"  {lesson:<4} {art['slug'][:56]:<56} {len(secs)} section(s), {pend} pending"
            + (f"   MISSING {', '.join(gone)}" if gone else ""))

    orphans = data["orphans"]
    say(f"\n  {sum(len(a.get('corpus', [])) for a in artifacts)} reference(s) across "
        f"{len(artifacts)} artifact(s)")
    if orphans:
        say(f"  {len(orphans)} corpus section(s) no artifact cites: {', '.join(orphans)}")
    else:
        say("  every corpus section is cited by an artifact")
    if bad:
        say(f"  {bad} reference(s) name a section the corpus does not contain")
    return 1 if bad else 0


def stale(artifacts: list[dict], notes: dict) -> int:
    """List notes whose artifact text changed since the note was written."""
    by_slug = {a["slug"]: a for a in artifacts}
    hits = 0
    for slug, rec in sorted(notes.items()):
        art = by_slug.get(slug)
        if art is None:
            say(f"  ORPHANED  {slug} — no artifact with this slug (rebuilt? renamed?)")
            hits += 1
            continue
        shas = {o["key"]: o["sha"] for o in art["objectives"]}
        for key, v in rec.get("objectives", {}).items():
            if key not in shas:
                say(f"  GONE      {slug} · {key} — objective key no longer in the artifact")
                hits += 1
            elif v.get("sha") and v["sha"] != shas[key]:
                say(f"  STALE     {slug} · {key} — prose changed since the note was written")
                hits += 1
    say(f"\n  {hits} stale or orphaned note(s)." if hits
        else "\n  every note still matches the artifact it was written against.")
    return hits


def retire(artifacts: list[dict], npath: pathlib.Path, course: str,
           targets: list[str], commit: bool) -> int:
    """Remove notes that have been APPLIED to the artifact.

    This is the other half of `--stale`, and it exists because a note nobody removes
    reads as outstanding forever. `PROJECT.md` §10 states the failure directly: *"a note
    whose objective is already fixed still reads as outstanding until it is removed."*
    Before this verb the only way to clear one was to hand-edit the JSON, which is the
    kind of step that gets skipped.

    **Each target is named explicitly, as `<slug>:<key>`.** There is deliberately no
    "retire everything --stale flagged" mode. `--stale` reports two different things and
    only one of them means *applied*: an objective key GONE from the artifact is
    unambiguous, but a changed `sha` only means the prose moved — a rebuild for an
    unrelated reason changes it too, and a blanket sweep would silently discard a note
    that was never acted on. Naming the target is the judgment, and it belongs to whoever
    applied the edit.

    **The guard that makes this safe to run: a note about prose that has NOT changed
    cannot have been applied**, so retiring it is refused. That catches the ordinary
    mistake of retiring a note you meant to act on and did not.

    Dry-run by default (`python.md` §8); `--commit` writes.
    """
    notes = load_notes(npath)
    by_slug = {a["slug"]: a for a in artifacts}
    plan: dict[str, list[str]] = {}
    bad = 0

    for target in targets:
        slug, sep, key = target.partition(":")
        if not sep or not key:
            say(f"  ERROR     {target!r} — expected <slug>:<objective-key>")
            bad += 1
            continue
        rec = notes.get(slug)
        if rec is None or key not in rec.get("objectives", {}):
            say(f"  ERROR     {slug} · {key} — no such note")
            bad += 1
            continue
        art = by_slug.get(slug)
        if art is not None:
            live = {o["key"]: o["sha"] for o in art["objectives"]}
            if key in live and live[key] == rec["objectives"][key].get("sha"):
                say(f"  REFUSED   {slug} · {key} — the objective is still in the artifact "
                    f"and its prose is unchanged, so this note has not been applied")
                bad += 1
                continue
        plan.setdefault(slug, []).append(key)

    if bad:
        say(f"\n  {bad} target(s) rejected — nothing written.")
        return 1

    for slug, keys in sorted(plan.items()):
        art = by_slug.get(slug)
        live = {o["key"] for o in art["objectives"]} if art else set()
        for key in keys:
            why = "objective dropped from the artifact" if key not in live else "prose rewritten"
            say(f"  retire    {slug} · {key} — {why}")
            del notes[slug]["objectives"][key]
        if not notes[slug].get("objectives") and not notes[slug].get("params"):
            say(f"  drop      {slug} — no notes left on this artifact")
            del notes[slug]

    total = sum(len(v) for v in plan.values())
    if not commit:
        say(f"\n  dry run: {total} note(s) in {len(plan)} artifact(s). Re-run with --commit.")
        return 0

    write_notes(npath, course, notes)
    say(f"\n  retired {total} note(s). {npath.name} written.")
    return 0


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--course", default="phys-215",
                    help="which course the page OPENS on, and the one the print-only modes "
                         "act on. Every course is loaded either way (default: phys-215)")
    ap.add_argument("--grounding", action="store_true",
                    help="print the corpus <-> artifact join for --course, then exit")
    ap.add_argument("--port", type=int, default=8766)
    ap.add_argument("--no-open", action="store_true")
    ap.add_argument("--dump", action="store_true", help="parse and print, do not serve")
    ap.add_argument("--stale", action="store_true",
                    help="list notes whose artifact changed since they were written, then exit")
    ap.add_argument("--links", action="store_true",
                    help="print the DFPM registration prefill link for every published "
                         "artifact, then exit")
    ap.add_argument("--accept-published", action="store_true",
                    help="record every PUBLISHED artifact as already accepted (dry run)")
    ap.add_argument("--accept", nargs="+", metavar="SLUG",
                    help="record these slugs as already accepted (dry run)")
    ap.add_argument("--as", dest="because", metavar="WHY", default="",
                    help="provenance for --accept, e.g. 'published 2026-07-31'")
    ap.add_argument("--retire", nargs="+", metavar="SLUG:KEY",
                    help="remove notes that have been APPLIED to the artifact (dry run). "
                         "Refuses any whose prose is unchanged — that note cannot have "
                         "been applied. Find candidates with --stale")
    ap.add_argument("--commit", action="store_true",
                    help="actually write what --accept/--accept-published/--retire planned")
    args = ap.parse_args()

    course_dir = COURSES / args.course
    if not (course_dir / "artifacts").is_dir():
        have = ", ".join(sorted(p.name for p in COURSES.iterdir()
                                if (p / "artifacts").is_dir()))
        sys.exit(f"error: no artifacts under courses/{args.course}/. Have: {have}")

    try:
        artifacts = collect(course_dir)
    except ValueError as exc:
        sys.exit(f"error: {exc}")
    if not artifacts:
        sys.exit(f"error: courses/{args.course}/artifacts/ holds no .jsx files")

    npath = notes_path(course_dir)

    if args.grounding:
        sys.exit(grounding_report(course_dir))
    if args.dump:
        dump(artifacts)
        return
    if args.links:
        sys.exit(links(artifacts))
    if args.stale:
        sys.exit(1 if stale(artifacts, load_notes(npath)) else 0)
    if args.retire:
        say("\n  clearing notes that have already been applied to the artifact:\n")
        sys.exit(retire(artifacts, npath, args.course, args.retire, args.commit))
    if args.accept or args.accept_published:
        say(f"\n  recording an approval made outside this page — nothing is being judged here:\n")
        sys.exit(seed(artifacts, npath, args.course, args.accept or [],
                      args.accept_published, args.commit, args.because))

    courses = collect_courses(args.course)
    url = f"http://127.0.0.1:{args.port}/"

    say("")
    for course in courses:
        arts = course["artifacts"]
        pub = sum(1 for a in arts if a["published"])
        known = arts[0]["pub_known"]
        opens = "  <- opens here" if course["id"] == courses[0]["id"] else ""
        say(f"  {course['id']:<10} {len(arts):>2} artifacts, "
            f"{sum(a['objective_count'] for a in arts):>3} objectives  -  " + (
                f"{pub} published, {len(arts)-pub} draft" if known
                else f"publication status UNKNOWN (no BUILD-LOG.md)") + opens)
        say(f"             notes  {course['notes_path']}  "
            f"({len(course['notes'])} artifact(s) already carry one)")
        corpus = course["corpus"]
        if corpus:
            secs = corpus["sections"]
            say(f"             corpus {corpus['path']}")
            say(f"                    {len(secs)} sections - {corpus['reviewed']} reviewed, "
                f"{len(secs) - corpus['reviewed']} PENDING")

    say("\n  ARTIFACTS ARE READ-ONLY. Those decisions land in a sidecar and nothing is")
    say("  applied until you ask an agent to work through it.")
    say("  APPROVING A GROUNDING SECTION WRITES TO THE CORPUS - 'STATUS: REVIEWED <date>',")
    say("  the string the build gate greps. Rejections do not touch it.")
    say(f"\n  -> {url}\n\n  Ctrl+C to stop. Decisions print here as they save.\n")

    server = ThreadingHTTPServer(("127.0.0.1", args.port),
                                 make_handler(args.course, threading.Lock()))
    if not args.no_open:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        say("\n  stopped.\n")
        server.shutdown()


if __name__ == "__main__":
    main()
