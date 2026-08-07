#!/usr/bin/env python3
"""
Create the 37 Physics 110 Fall 2026 preflight assignments.

Parses the JiTT / Journal questions from Physics110_Preflight_Questions_v2.docx, pairs each
in-scope lesson with its M/T preflight due dates from the Fall 2026 syllabus (Table 2), and
upserts one written preflight `assignments` row per lesson (course_id='phys-110'), mirroring
the 3-question structure of the Physics 215 preflights (reading-time 0 pts + confusing/
interesting 1 pt + JiTT/Journal concept question w/ expected_response 1 pt = 2 pts). Lab
lessons use lab-instruction wording for the first two reflection questions. No reading links.

Scope: lessons 2–41 excluding Lesson 1 and the three GRs (13, 24, 36) = 37 preflights.
The v2 docx contains no embedded figures, so no figure extraction is needed.

Usage:
    python3 build_110_preflights.py            # dry run: parse + print, write nothing
    python3 build_110_preflights.py --commit   # upsert the 37 rows to Supabase

Idempotent: upsert on `id` (on_conflict), so re-running updates rows in place.

Assignment ids are course-prefixed (`phys-110-preflight-NN`). `assignments.id` is a single
globally-unique PK (not scoped by course), and Physics 215 owns the bare `preflight-NN` ids
(its lessons/responses/scores reference them). Prefixing keeps the two courses' preflight sets
disjoint so neither build clobbers the other. Any future course should likewise prefix its ids.
"""

import argparse
import json
import os
import re
import sys
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

from docx import Document

# ----------------------------------------------------------------------------
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
COURSE_ROOT = os.path.abspath(os.path.join(REPO_ROOT, ".."))  # the PREP course root
RAG_DIR_REL = "Text_Book_PDFs/110 Sections"  # relative to textbook_base_path (the PREP root)

CONFIG_PATH = os.path.expanduser("~/.claude/skills/preflight-analyze/config.json")

DOCX_NAME = "Physics110_Preflight_Questions_v2.docx"


def _preflights_dir():
    """The PREP `Preflights/` folder. Prefer the config's textbook_base_path (points at the
    PREP course root on any machine); fall back to the repo-relative layout (repo inside PREP).

    Until 2026-08-07 this file hardcoded an absolute macOS path into one operator's OneDrive,
    so the script could not run on any other machine — including the course director's. Its
    Physics 215 sibling already resolved the folder this way; the two now match.
    """
    try:
        with open(CONFIG_PATH) as f:
            base = json.load(f).get("textbook_base_path")
        if base and os.path.isdir(os.path.join(base, "Preflights")):
            return os.path.join(base, "Preflights")
    except Exception:
        pass
    return os.path.join(COURSE_ROOT, "Preflights")


DOCX_PATH = os.path.join(_preflights_dir(), DOCX_NAME)
DENVER = ZoneInfo("America/Denver")
UTC = ZoneInfo("UTC")
YEAR = 2026

# ----------------------------------------------------------------------------
# Syllabus Table 2 (p. 11): lesson_number -> ("M-day PF due", "T-day PF due").
# These are ALREADY the preflight due dates (2359 the night before the lesson), so we set
# 2359 America/Denver ON these dates directly (do NOT subtract a day). Lesson 1 and the GRs
# (13, 24, 36) are intentionally absent.
SCHEDULE = {
    2:  ("Aug 9",  "Aug 10"),
    3:  ("Aug 11", "Aug 12"),
    4:  ("Aug 13", "Aug 16"),
    5:  ("Aug 17", "Aug 18"),
    6:  ("Aug 19", "Aug 20"),
    7:  ("Aug 23", "Aug 24"),
    8:  ("Aug 25", "Aug 26"),
    9:  ("Aug 27", "Aug 30"),
    10: ("Aug 31", "Sep 1"),
    11: ("Sep 2",  "Sep 3"),
    12: ("Sep 7",  "Sep 8"),
    14: ("Sep 14", "Sep 15"),
    15: ("Sep 16", "Sep 20"),
    16: ("Sep 21", "Sep 22"),
    17: ("Sep 23", "Sep 24"),
    18: ("Sep 27", "Sep 28"),
    19: ("Sep 29", "Sep 30"),
    20: ("Oct 1",  "Oct 4"),
    21: ("Oct 5",  "Oct 6"),
    22: ("Oct 7",  "Oct 8"),
    23: ("Oct 12", "Oct 13"),
    25: ("Oct 18", "Oct 19"),
    26: ("Oct 20", "Oct 21"),
    27: ("Oct 22", "Oct 25"),
    28: ("Oct 26", "Oct 27"),
    29: ("Oct 28", "Oct 29"),
    30: ("Nov 1",  "Nov 2"),
    31: ("Nov 3",  "Nov 4"),
    32: ("Nov 5",  "Nov 8"),
    33: ("Nov 9",  "Nov 11"),
    34: ("Nov 12", "Nov 15"),
    35: ("Nov 16", "Nov 17"),
    37: ("Nov 22", "Nov 23"),
    38: ("Nov 30", "Dec 1"),
    39: ("Dec 2",  "Dec 3"),
    40: ("Dec 6",  "Dec 7"),
    41: ("Dec 8",  "Dec 9"),
}

# Standard reading-reflection questions (verbatim from the live Physics 215 preflights).
Q1_TEXT = "How much time did you spend reading the book in preparation for this lesson?"
Q2_TEXT = ("What did you find most confusing or most interesting about the reading? "
           "Be specific and thorough in your discussion.")
LAB_Q1_TEXT = "How much time did you spend reading the lab instructions in preparation for this lesson?"
LAB_Q2_TEXT = ("What did you find most confusing or most interesting about the lab instructions? "
               "Be specific and thorough in your discussion.")

# Lesson 11 lists two source PDFs; use the lesson-primary one for Q3 RAG grounding.
LESSON11_PDF = "Newton's Laws with Circular Motion.pdf"
LESSON11_PAGES = "276-283"


# ----------------------------------------------------------------------------
def due_utc(date_str):
    """'Aug 9' -> ISO UTC for 2359 America/Denver on that date (the PF is already due then).

    23:59:59, not 23:59:00 — the whole term (both courses) was normalized to :59 on 2026-08-06 so
    every deadline is one instant right before midnight; a rebuild must not reintroduce the :00 split.
    """
    d = datetime.strptime(f"{date_str} {YEAR}", "%b %d %Y")
    local = datetime(d.year, d.month, d.day, 23, 59, 59, tzinfo=DENVER)
    return local.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S+00:00")


def norm(s):
    return re.sub(r"\s+", " ", (s or "")).strip()


def normalize_fs(s):
    """Match the on-disk / DB convention: curly apostrophe -> straight, en/em dash -> hyphen."""
    return (s.replace("’", "'").replace("‘", "'")
             .replace("–", "-").replace("—", "-"))


def parse_rag(rag_line, lesson_num):
    """'RAG Source: <pdf>  |  Book pp. 170–179  |  ...' -> (pdf_path_or_None, pages_or_None).

    Labs and graded reviews reference a Lab Manual / Lab Handout / dash with no OpenStax PDF,
    so they return (None, None) -> flagged as labs by build_rows().
    """
    body = norm(rag_line).split("RAG Source:", 1)[-1].strip()

    # Lesson 11 lists two PDFs joined by '+'; pin the lesson-primary source.
    if lesson_num == 11:
        return f"{RAG_DIR_REL}/{LESSON11_PDF}", LESSON11_PAGES

    # PDF filename = everything up to the first ".pdf" in the first '|'-segment.
    # (Handles names with commas/apostrophes and trailing prose, e.g. L41's
    # "Wave Motion.pdf covers §16.1–16.3; ...".) Labs/GRs have no ".pdf" -> None.
    first_seg = body.split("|", 1)[0]
    m = re.match(r"\s*(.+?\.pdf)", first_seg, re.IGNORECASE)
    pdf = m.group(1).strip() if m else None

    # Full page spec, preserving comma-separated multi-ranges (e.g. "72–74, 316–327").
    pages = None
    mp = re.search(r"pp\.?\s*([0-9][0-9,\s–—-]*[0-9])", body)
    if mp:
        pages = re.sub(r"\s*,\s*", ", ", normalize_fs(mp.group(1)).replace(" ", " ")).strip()
        pages = re.sub(r"\s*-\s*", "-", pages)

    ref_pdf = f"{RAG_DIR_REL}/{normalize_fs(pdf)}" if pdf else None
    return ref_pdf, pages


def parse_docx():
    """Return {lesson_num: {jitt_question, expected_response, ref_pdf, ref_pages}}."""
    if not os.path.isfile(DOCX_PATH):
        sys.exit(
            f"Source DOCX not found:\n  {DOCX_PATH}\n\n"
            f"The folder is resolved from `textbook_base_path` in {CONFIG_PATH},\n"
            f"falling back to {COURSE_ROOT}. Set that key to your PREP course root\n"
            f"(the folder containing `Preflights/` and `Text_Book_PDFs/`), or place\n"
            f"{DOCX_NAME} in the Preflights folder."
        )
    doc = Document(DOCX_PATH)
    lessons, cur = {}, None
    for p in doc.paragraphs:
        style = p.style.name
        text = p.text.strip()
        if style == "Heading 2":
            m = re.match(r"Lesson\s+(\d+)", text)
            cur = int(m.group(1)) if m else None
            if cur is not None:
                lessons[cur] = {"rag_line": None, "q_parts": [], "expected": None}
            continue
        if cur is None or cur not in lessons:
            continue
        L = lessons[cur]
        if style == "Normal" and text.startswith("RAG Source:"):
            if L["rag_line"] is None:  # keep the first RAG line (GRs repeat it)
                L["rag_line"] = text
        elif style == "JiTT Question Block":
            if text.startswith("JiTT Question:"):
                L["q_parts"].append(norm(text.split("JiTT Question:", 1)[1]))
            elif text.startswith("Journal Question"):
                # strip the "Journal Question (from ...):" label, keep the body
                body = re.sub(r"^Journal Question[^:]*:", "", text, count=1)
                L["q_parts"].append(norm(body))
            elif text.startswith("→") or "Maps to Obj" in text:
                pass  # objective mapping — not part of the student-facing question
            elif text and L["q_parts"]:
                L["q_parts"].append(norm(text))  # continuation line of the question
        elif style == "JiTT Instructor Hint":
            exp = text
            for pref in ("GRADER ONLY — Expected Response:", "GRADER ONLY - Expected Response:",
                         "Expected Response:"):
                if pref in exp:
                    exp = exp.split(pref, 1)[1]
                    break
            L["expected"] = norm(exp)

    out = {}
    for n, L in lessons.items():
        ref_pdf, ref_pages = parse_rag(L["rag_line"] or "", n)
        out[n] = {
            "jitt_question": " ".join(L["q_parts"]).strip(),
            "expected_response": L["expected"],
            "ref_pdf": ref_pdf,
            "ref_pages": ref_pages,
        }
    return out


def build_rows():
    parsed = parse_docx()
    rows = []
    for n in sorted(SCHEDULE):
        m_day, t_day = SCHEDULE[n]
        p = parsed.get(n)
        if not p or not p["jitt_question"]:
            print(f"  !! Lesson {n}: no JiTT/Journal question parsed from docx", file=sys.stderr)
            continue
        topic = TOPICS[n]
        is_lab = p["ref_pdf"] is None
        q1_text = LAB_Q1_TEXT if is_lab else Q1_TEXT
        q2_text = LAB_Q2_TEXT if is_lab else Q2_TEXT
        q3 = {"id": "q3", "type": "free_response", "text": p["jitt_question"], "points": 1}
        if p["expected_response"]:
            q3["expected_response"] = p["expected_response"]

        rows.append({
            "id": f"phys-110-preflight-{n:02d}",
            "course_id": "phys-110",
            "title": f"Lesson {n:02d} Preflight — {topic}",
            "description": "Complete before class. Full credit for a genuine, thoughtful effort.",
            "due_date": due_utc(m_day),          # legacy NOT NULL column; mirror the M-day date
            "due_date_m": due_utc(m_day),
            "due_date_t": due_utc(t_day),
            "reference_pdf": p["ref_pdf"],
            "reference_pages": p["ref_pages"],
            "reading_link": None,
            "is_published": True,
            "questions": [
                {"id": "q1", "type": "free_response", "text": q1_text, "points": 0},
                {"id": "q2", "type": "free_response", "text": q2_text, "points": 1},
                q3,
            ],
        })
    return rows


# Topics for the assignment title (from syllabus Table 1 / docx Heading 2, in-scope lessons).
TOPICS = {
    2:  "1-D Motion / Position, Velocity, Acceleration",
    3:  "Constant Acceleration and Freefall",
    4:  "Vectors and Coordinate Systems",
    5:  "2-D Motion / Projectile Motion",
    6:  "Laboratory Fundamentals",
    7:  "LAB 1: Projectile Motion",
    8:  "Intro to Newton's Laws",
    9:  "Application of Newton's Laws / Friction",
    10: "LAB 2: Newton's Laws",
    11: "Newton's Laws with Circular Motion",
    12: "Application of Newton's Laws",
    14: "Energy of a System / Work",
    15: "Varying Forces / Kinetic Energy",
    16: "Potential Energy / Nonconservative Forces",
    17: "Conservation of Energy",
    18: "Changes in Mechanical Energy / Power",
    19: "LAB 3: Conservation of Energy",
    20: "Linear Momentum & 1-D Collisions",
    21: "2-D Collisions",
    22: "Center of Mass / Systems of Particles",
    23: "LAB 4: Conservation of Momentum",
    25: "Angular Position, Velocity, Acceleration",
    26: "Vector Product / Torque / Moment of Inertia",
    27: "Moment of Inertia Applications",
    28: "Rotational Kinetic Energy / Rolling Motion",
    29: "Angular Momentum",
    30: "Conservation of Angular Momentum",
    31: "Rotational Motion Applications",
    32: "LAB 5: Angular Momentum",
    33: "Universal Gravitation",
    34: "Gravitational Potential Energy / Kepler's Laws",
    35: "Planetary and Satellite Motion",
    37: "Simple Harmonic Motion & Pendulums",
    38: "LAB 6: Simple Harmonic Motion",
    39: "Energy of SHO & Damped Oscillations",
    40: "Wave Fundamentals & Wave Equation",
    41: "Superposition, Standing Waves, & Applications",
}


def upsert(rows):
    with open(CONFIG_PATH) as f:
        cfg = json.load(f)
    url = cfg["supabase_url"].rstrip("/") + "/rest/v1/assignments?on_conflict=id"
    key = cfg["supabase_service_key"]
    body = json.dumps(rows).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "apikey": key, "Authorization": f"Bearer {key}",
        "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates",
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true", help="upsert to Supabase (default: dry run)")
    args = ap.parse_args()

    rows = build_rows()
    print(f"Built {len(rows)} preflight rows.\n")
    for r in rows:
        q3 = r["questions"][2]
        has_exp = "expected_response" in q3
        pts = sum(q["points"] for q in r["questions"])
        is_lab = r["reference_pdf"] is None
        print(f"  {r['id']}  due_m={r['due_date_m'][:10]} due_t={r['due_date_t'][:10]} "
              f"pts={pts:.1f} {'LAB' if is_lab else '   '} "
              f"pdf={'Y' if r['reference_pdf'] else '-'} pp={r['reference_pages'] or '-':<12} "
              f"exp={'Y' if has_exp else '-'}")
        print(f"        Q3: {q3['text'][:96]}")

    if not args.commit:
        print("\n[dry run] nothing written. Re-run with --commit to upsert.")
        return
    status = upsert(rows)
    print(f"\nUpserted {len(rows)} rows -> HTTP {status}")


if __name__ == "__main__":
    main()
