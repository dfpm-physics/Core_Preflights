"""Grounding documents on disk: the folder layout, what is missing, and what a grader may read.

Layout (outside the repo; `check_grounding.py --base <root>/<course> --course <NNN>` accepts it):

    <root>/<course>/Text_Book_PDFs/<NNN> Sections/   PDFs, EXACT manifest filenames
    <root>/<course>/text/<NNN> Sections/<stem>.txt   extracted prose, pages split by form feed
    <root>/<course>/digests/<stem>.md                curated key results INCLUDING equations

THE EQUATION TRAP. A text extractor returns a textbook's prose and silently drops most displayed
equations, fractions and vectors (they are drawn as graphics or math-font glyph runs). So extracted
text is only vocabulary and framing: the physics authority is the question's expected response and
the optional curated digest. `equations_suspect` flags a page that looks like it lost its math, and
the prompt tells the grader not to mark a formula wrong because it is absent from an excerpt. This
module reads text files only; turning a PDF into text happens outside the job (see the operator doc).
"""
import os
import re
from pathlib import Path

DIR_MODE = 0o750
MAX_EXCERPT_CHARS = 24000          # about 6,000 tokens


def read_manifest(path):
    """Manifest entries: one reference per line; blanks and #-comments ignored."""
    return [ln.strip() for ln in Path(path).read_text(encoding="utf-8").splitlines()
            if ln.strip() and not ln.lstrip().startswith("#")]


def course_number(course_code, manifest):
    """The `<NNN>` of the manifest's `<NNN> Sections` folder whose digits appear in the course code."""
    digits = set(re.findall(r"\d+", course_code or ""))
    for entry in manifest:
        m = re.match(r"Text_Book_PDFs/(\d+) Sections/", entry)
        if m and m.group(1) in digits:
            return m.group(1)
    return None


def stem_of(reference_pdf):
    return Path(str(reference_pdf).replace("\\", "/")).stem


def paths(root, course, number):
    base = Path(root) / course
    out = {"base": base, "digests": base / "digests"}
    if number:
        out.update(pdfs=base / "Text_Book_PDFs" / f"{number} Sections", text=base / "text" / f"{number} Sections")
    return out


def plan_tree(root, courses, manifest):
    """The directories `setup` would create, as a list of Paths."""
    dirs = [Path(root)]
    for c in courses:
        p = paths(root, c, course_number(c, manifest))
        dirs += [p["base"]] + [p[k] for k in ("pdfs", "text", "digests") if k in p]
    return dirs


def make_tree(root, courses, manifest):
    """Create the tree (mode 0750), never overwriting or deleting. Returns the paths created."""
    made = []
    for d in plan_tree(root, courses, manifest):
        if not d.exists():
            d.mkdir(parents=True, exist_ok=True)
            try:
                os.chmod(d, DIR_MODE)
            except OSError:
                pass
            made.append(d)
    return made


def scan_course(root, course, manifest):
    """What is present and missing for one course, against the manifest. Read only."""
    number = course_number(course, manifest)
    p = paths(root, course, number)
    rep = {"course": course, "number": number, "pdfs_present": [], "pdfs_missing": [],
           "text_present": [], "text_missing": [], "digests_present": [], "digests_missing": [],
           "suspect": {}}
    entries = [e for e in manifest if number and e.startswith(f"Text_Book_PDFs/{number} Sections/")]
    for e in entries:
        name = Path(e).name
        stem = Path(e).stem
        (rep["pdfs_present"] if (p["pdfs"] / name).is_file() else rep["pdfs_missing"]).append(name)
        txt = p["text"] / (stem + ".txt")
        (rep["text_present"] if txt.is_file() else rep["text_missing"]).append(stem + ".txt")
        dg = p["digests"] / (stem + ".md")
        (rep["digests_present"] if dg.is_file() else rep["digests_missing"]).append(stem + ".md")
        if txt.is_file():
            bad = [i + 1 for i, pg in enumerate(split_pages(txt.read_text(encoding="utf-8", errors="replace")))
                   if equations_suspect(pg)]
            if bad:
                rep["suspect"][stem] = bad
    rep["complete"] = bool(entries) and not rep["pdfs_missing"] and not rep["text_missing"]
    return rep


def parse_pages(spec):
    """'45-52, 60' -> [45..52, 60]. Unparseable parts are ignored; an empty result means 'all'."""
    out = []
    for part in re.split(r"[,;]", str(spec or "")):
        m = re.fullmatch(r"\s*(\d+)\s*(?:-\s*(\d+))?\s*", part)
        if m:
            a, b = int(m.group(1)), int(m.group(2) or m.group(1))
            if 0 < a <= b <= a + 500:
                out += list(range(a, b + 1))
    return out


def split_pages(text):
    return text.split("\f")


_EQNUM = re.compile(r"^\s*\(?\d+\.\d+\)?\s*$")
_LEADIN = re.compile(r"(given by|is:|where|expressed as|can be written as)\s*$", re.I)


def equations_suspect(page_text):
    """True when a page looks as though extraction dropped its equations."""
    lines = page_text.splitlines()
    if sum(1 for ln in lines if _EQNUM.match(ln)) >= 1:
        return True
    for i, ln in enumerate(lines[:-1]):
        if _LEADIN.search(ln.strip()) and not lines[i + 1].strip():
            return True
    words = len(page_text.split())
    return words > 250 and page_text.count("=") == 0


def build_grounding(root, course, manifest, reference_pdf, reference_pages=None, cap=MAX_EXCERPT_CHARS):
    """What the grader may be shown for one lesson.

    {"state": "digest" | "text-only" | "none", "text": str, "pdf": str|None,
     "suspect_pages": [..], "in_manifest": bool}
    """
    out = {"state": "none", "text": "", "pdf": reference_pdf or None, "suspect_pages": [], "in_manifest": False}
    if not reference_pdf:
        return out
    out["in_manifest"] = str(reference_pdf).replace("\\", "/") in manifest
    number = course_number(course, manifest)
    p = paths(root, course, number)
    stem = stem_of(reference_pdf)
    parts = []
    dg = p["digests"] / (stem + ".md")
    if dg.is_file():
        parts.append("KEY RESULTS (curated, with equations):\n" + dg.read_text(encoding="utf-8", errors="replace").strip())
        out["state"] = "digest"
    if "text" in p:
        txt = p["text"] / (stem + ".txt")
        if txt.is_file():
            pages = split_pages(txt.read_text(encoding="utf-8", errors="replace"))
            want = [n for n in parse_pages(reference_pages) if n <= len(pages)]
            idx = [n - 1 for n in want] if want else list(range(len(pages)))
            out["suspect_pages"] = [i + 1 for i in idx if equations_suspect(pages[i])]
            parts.append("BACKGROUND EXCERPT (extracted text; equations may be missing):\n"
                         + "\n".join(pages[i].strip() for i in idx).strip())
            if out["state"] == "none":
                out["state"] = "text-only"
    text = "\n\n".join(parts)
    if len(text) > cap:
        text = text[:cap] + "\n[excerpt truncated]"
    out["text"] = text
    return out
