#!/usr/bin/env python3
"""
Part C — Create the 37 Physics 215 Fall 2026 preflight assignments.

Parses the JiTT questions from Physics215_Preflight_Questions_v12.docx, pairs each in-scope
lesson with its M/T due dates from the Fall 2026 syllabus schedule, and upserts one written
preflight `assignments` row per lesson (course_id='phys-215'), mirroring the 3-question
structure of the original preflight-1 (reading-time 0 pts + confusing/interesting 1 pt +
JiTT concept question w/ expected_response 1 pt = 2 pts). Lab lessons use lab-instruction
wording for the first two reflection questions. Embedded DOCX figures are exported separately
to `site/img/assignments/` and attached to the matching Q3 as public GitHub Pages URLs.

Scope: the 31 regular (PF=Y) lessons + the 6 labs = 37. Excludes Lesson 1 and GRs (12/23/35).

Usage:
    python3 build_fall_preflights.py            # dry run: parse + print, write nothing
    python3 build_fall_preflights.py --commit   # upsert the 37 rows to Supabase

Idempotent: upsert on `id` (on_conflict), so re-running updates rows in place.
"""

import argparse
import io
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from docx import Document

# ----------------------------------------------------------------------------
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
COURSE_ROOT = os.path.abspath(os.path.join(REPO_ROOT, ".."))  # Physics_215_Fall_2026/
RAG_DIR_REL = "Text_Book_PDFs/215 Sections"  # relative to textbook_base_path (the course root)
FIGURE_BASE_URL = "https://dfpm-physics.github.io/Core_Preflights/site/img/assignments"

CONFIG_PATH = os.path.expanduser("~/.claude/skills/preflight-analyze/config.json")


def _preflights_dir():
    """The PREP `Preflights/` folder. Prefer the config's textbook_base_path (points at the
    PREP course root on any machine); fall back to the repo-relative layout (repo inside PREP)."""
    try:
        with open(CONFIG_PATH) as f:
            base = json.load(f).get("textbook_base_path")
        if base and os.path.isdir(os.path.join(base, "Preflights")):
            return os.path.join(base, "Preflights")
    except Exception:
        pass
    return os.path.join(COURSE_ROOT, "Preflights")


DOCX_PATH = os.path.join(_preflights_dir(), "Physics215_Preflight_Questions_v12.docx")
DENVER = ZoneInfo("America/Denver")

# ----------------------------------------------------------------------------
# Syllabus schedule (p. 11). lesson_number -> (topic, M-day, T-day, is_lab).
# Dates are 2026; the preflight is due the night before the lesson at 2359 Denver.
# In-scope = these 37 (the 31 PF=Y regular lessons + the 6 labs). Lesson 1 and
# GRs (12/23/35) are intentionally absent.
SCHEDULE = {
    2:  ("Electric Charge, Coulombic Force",              "10 Aug", "11 Aug", False),
    3:  ("Coulomb's Law and Superposition",               "12 Aug", "13 Aug", False),
    4:  ("Electric Fields and Superposition",             "14 Aug", "17 Aug", False),
    5:  ("Charged Particles in Uniform Electric Fields",  "18 Aug", "19 Aug", False),
    6:  ("LAB: Quantized Charge",                         "20 Aug", "21 Aug", True),
    7:  ("Charge Distributions, Electric Flux",           "24 Aug", "25 Aug", False),
    8:  ("Gauss's Law and Its Applications",              "26 Aug", "27 Aug", False),
    9:  ("Electric Potential Difference",                 "28 Aug", "31 Aug", False),
    10: ("Electric Potential, Potential Energy",          "1 Sep",  "2 Sep",  False),
    11: ("LAB: Mapping Electric Potential",               "3 Sep",  "4 Sep",  True),
    13: ("Capacitance, Energy, and Dielectrics",          "10 Sep", "14 Sep", False),
    14: ("Current, Resistance, and Electrical Power",     "15 Sep", "16 Sep", False),
    15: ("DC Circuit Analysis, Kirchhoff's Rules",        "17 Sep", "21 Sep", False),
    16: ("RC Circuits",                                   "22 Sep", "23 Sep", False),
    17: ("LAB: Building DC Circuits",                     "24 Sep", "25 Sep", True),
    18: ("Moving Charged Particle in a Magnetic Field",   "28 Sep", "29 Sep", False),
    19: ("Magnetic Force on Current-carrying Wires",      "30 Sep", "1 Oct",  False),
    20: ("Magnetic Dipoles and Torque",                  "2 Oct",  "5 Oct",  False),
    21: ("Sources of Magnetic Fields",                   "6 Oct",  "7 Oct",  False),
    22: ("Ampere's Law, Gauss's Law in Magnetism",       "8 Oct",  "9 Oct",  False),
    24: ("Faraday's Law of Induction, Motional EMF",     "15 Oct", "16 Oct", False),
    25: ("Lenz's Law, Induced Electric Field",           "19 Oct", "20 Oct", False),
    26: ("Generators and Motors, AC, Transformers",      "21 Oct", "22 Oct", False),
    27: ("LAB: Building an Electric Motor",              "23 Oct", "26 Oct", True),
    28: ("Displacement Current",                         "27 Oct", "28 Oct", False),
    29: ("Maxwell's Equations",                          "29 Oct", "30 Oct", False),
    30: ("Electromagnetic Waves, EM Spectrum",           "2 Nov",  "3 Nov",  False),
    31: ("Light, Reflection, Refraction",                "4 Nov",  "5 Nov",  False),
    32: ("Image Formation from Mirrors",                 "6 Nov",  "9 Nov",  False),
    33: ("Image Formation from Lenses",                  "10 Nov", "12 Nov", False),
    34: ("LAB: Thin Lenses",                             "13 Nov", "16 Nov", True),
    36: ("Double-Slit Interference",                     "19 Nov", "20 Nov", False),
    37: ("Diffraction, Resolution",                      "23 Nov", "24 Nov", False),
    38: ("LAB: Single/Double-Slit Diffraction",         "1 Dec",  "2 Dec",  True),
    39: ("Intro to Nuclear (Planetarium)",              "3 Dec",  "4 Dec",  False),
    40: ("Polarization",                                "7 Dec",  "8 Dec",  False),
    41: ("Photoelectric Effect, Wave/Particle",         "9 Dec",  "10 Dec", False),
}
YEAR = 2026

# Standard reading-reflection questions (verbatim from the original preflight-1).
Q1_TEXT = "How much time did you spend reading the book in preparation for this lesson?"
Q2_TEXT = ("What did you find most confusing or most interesting about the reading? "
           "Be specific and thorough in your discussion.")
LAB_Q1_TEXT = "How much time did you spend reading the lab instructions in preparation for this lesson?"
LAB_Q2_TEXT = ("What did you find most confusing or most interesting about the lab instructions? "
               "Be specific and thorough in your discussion.")


# ----------------------------------------------------------------------------
def due_utc(date_str):
    """'10 Aug' -> ISO UTC for 2359 the night BEFORE, in America/Denver."""
    d = datetime.strptime(f"{date_str} {YEAR}", "%d %b %Y")
    night_before = datetime(d.year, d.month, d.day, 23, 59, tzinfo=DENVER) - timedelta(days=1)
    return night_before.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%S+00:00")


def norm(s):
    return re.sub(r"\s+", " ", (s or "")).strip()


def parse_rag(rag_line):
    """'RAG Source: <pdf>  |  Book pp. 170–179  |  ...' -> (pdf_path_or_None, pages_or_None)."""
    body = norm(rag_line).split("RAG Source:", 1)[-1].strip()
    if "Lab Handout" in body or "no OpenStax" in body or "Full Text" in body:
        # Lab handouts and the one "full text" lesson have no per-lesson RAG PDF.
        pages = None
        m = re.search(r"[Bb]ook pp\.?\s*([0-9]+\s*[–-]\s*[0-9]+)", body)
        if m:
            pages = m.group(1).replace("–", "-").replace(" ", "")
        return None, pages
    parts = [p.strip() for p in body.split("|")]
    pdf = parts[0] if parts and parts[0].lower().endswith(".pdf") else None
    pages = None
    for p in parts:
        m = re.search(r"pp\.?\s*([0-9]+\s*[–-]\s*[0-9]+)", p)
        if m:
            pages = m.group(1).replace("–", "-").replace(" ", "")
            break
    ref_pdf = f"{RAG_DIR_REL}/{pdf}" if pdf else None
    return ref_pdf, pages


def embedded_image_ids(paragraph):
    return paragraph._p.xpath(".//a:blip/@r:embed")


def figure_url_for(lesson_num, figure_index=1):
    suffix = "" if figure_index == 1 else f"-{figure_index}"
    return f"{FIGURE_BASE_URL}/preflight-{lesson_num:02d}-q3{suffix}.png"


def parse_docx():
    """Return {lesson_num: {jitt_question, expected_response, ref_pdf, ref_pages}}."""
    doc = Document(DOCX_PATH)
    lessons, cur = {}, None
    for p in doc.paragraphs:
        style = p.style.name
        text = p.text.strip()
        if style == "Heading 2":
            m = re.match(r"Lesson\s+(\d+)", text)
            cur = int(m.group(1)) if m else None
            if cur is not None:
                lessons[cur] = {"rag_line": None, "q_parts": [], "expected": None, "figure_count": 0}
            continue
        if cur is None or cur not in lessons:
            continue
        L = lessons[cur]
        L["figure_count"] += len(embedded_image_ids(p))
        if style == "Normal" and text.startswith("RAG Source:"):
            L["rag_line"] = text
        elif style == "JiTT Question Block":
            if text.startswith("JiTT Question:"):
                L["q_parts"].append(norm(text.split("JiTT Question:", 1)[1]))
            elif text.startswith("→") or "Maps to Obj" in text:
                pass  # objective mapping — not part of the student-facing question
            elif text:
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
        ref_pdf, ref_pages = parse_rag(L["rag_line"] or "")
        out[n] = {
            "jitt_question": " ".join(L["q_parts"]).strip(),
            "expected_response": L["expected"],
            "ref_pdf": ref_pdf,
            "ref_pages": ref_pages,
            "figure_url": figure_url_for(n) if L["figure_count"] else None,
        }
    return out


def build_rows():
    parsed = parse_docx()
    rows = []
    for n in sorted(SCHEDULE):
        topic, m_day, t_day, is_lab = SCHEDULE[n]
        p = parsed.get(n)
        if not p or not p["jitt_question"]:
            print(f"  !! Lesson {n}: no JiTT question parsed from docx", file=sys.stderr)
            continue
        q1_text = LAB_Q1_TEXT if is_lab else Q1_TEXT
        q2_text = LAB_Q2_TEXT if is_lab else Q2_TEXT
        q3 = {"id": "q3", "type": "free_response", "text": p["jitt_question"], "points": 1}
        if p["expected_response"]:
            q3["expected_response"] = p["expected_response"]
        if p.get("figure_url"):
            q3["figure_url"] = p["figure_url"]

        rows.append({
            "id": f"preflight-{n:02d}",
            "course_id": "phys-215",
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
        print(f"  {r['id']}  due_m={r['due_date_m'][:10]} due_t={r['due_date_t'][:10]} "
              f"pts={pts:.1f} pdf={'Y' if r['reference_pdf'] else '-'} "
              f"pp={r['reference_pages'] or '-':<9} exp={'Y' if has_exp else '-'} "
              f"fig={'Y' if q3.get('figure_url') else '-'}")
        print(f"        Q3: {q3['text'][:96]}")

    if not args.commit:
        print("\n[dry run] nothing written. Re-run with --commit to upsert.")
        return
    status = upsert(rows)
    print(f"\nUpserted {len(rows)} rows -> HTTP {status}")


if __name__ == "__main__":
    main()
