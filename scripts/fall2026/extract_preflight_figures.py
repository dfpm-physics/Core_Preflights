#!/usr/bin/env python3
"""
Extract embedded JiTT question figures from Physics215_Preflight_Questions_v12.docx.

The Fall 2026 preflight builder assigns deterministic public URLs under
img/assignments/preflight-XX-q3.png. Run this whenever the source DOCX is refreshed:

    python3 scripts/fall2026/extract_preflight_figures.py
"""

import re
from pathlib import Path

from docx import Document

REPO_ROOT = Path(__file__).resolve().parents[2]
COURSE_ROOT = REPO_ROOT.parent
DOCX_PATH = COURSE_ROOT / "Preflights" / "Physics215_Preflight_Questions_v12.docx"
OUT_DIR = REPO_ROOT / "img" / "assignments"


def embedded_image_ids(paragraph):
    return paragraph._p.xpath(".//a:blip/@r:embed")


def main():
    doc = Document(DOCX_PATH)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    current_lesson = None
    counts = {}
    written = []

    for paragraph in doc.paragraphs:
        text = paragraph.text.strip()
        if paragraph.style.name == "Heading 2":
            m = re.match(r"Lesson\s+(\d+)", text)
            current_lesson = int(m.group(1)) if m else None
            continue

        if current_lesson is None:
            continue

        for rid in embedded_image_ids(paragraph):
            counts[current_lesson] = counts.get(current_lesson, 0) + 1
            suffix = "" if counts[current_lesson] == 1 else f"-{counts[current_lesson]}"
            out = OUT_DIR / f"preflight-{current_lesson:02d}-q3{suffix}.png"
            out.write_bytes(doc.part.related_parts[rid].blob)
            written.append(out)

    if not written:
        raise SystemExit(f"No embedded figures found in {DOCX_PATH}")

    for path in written:
        print(path.relative_to(REPO_ROOT))


if __name__ == "__main__":
    main()
