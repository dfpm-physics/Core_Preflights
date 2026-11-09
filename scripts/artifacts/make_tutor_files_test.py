#!/usr/bin/env python3
"""Offline test for make_tutor_files.py, on a small invented catalogue. No network, no database, no repository file is read or written.

Run:  python scripts/artifacts/make_tutor_files_test.py
"""

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_tutor_files as M  # noqa: E402

failed = 0


def check(name, ok):
    global failed
    print(("[pass] " if ok else "[FAIL] ") + name)
    if not ok:
        failed += 1


ROWS_A = {"artifacts": [
    {"slug": "lesson-02-demo-aaaa1111", "title": "Demo one", "lesson_no": 2, "published_url": "https://claude.ai/public/artifacts/x1",
     "objectives": [{"key": "k-one", "label": "First idea"}, {"key": "k-two", "label": ""}, {"key": "k-one", "label": "dup"}]},
    {"slug": "lesson-03-draft-bbbb2222", "title": "Draft, not published", "lesson_no": 3, "published_url": ""},
    {"slug": "Bad Slug", "title": "Refused id", "published_url": "https://claude.ai/public/artifacts/x2"},
    {"slug": "lesson-04-nolink-cccc3333", "title": "Link is not http", "published_url": "ftp://nope"},
    {"slug": "lesson-05-bare-dddd4444", "title": "No objectives", "published_url": "https://claude.ai/public/artifacts/x3"},
]}
ROWS_B = [{"slug": "other-1", "title": "A list catalogue", "published_url": "https://claude.ai/public/artifacts/y1", "lesson_no": 99999}]

with tempfile.TemporaryDirectory() as td:
    courses = Path(td) / "courses"
    for name, doc in (("phys-215", ROWS_A), ("phys-310", ROWS_B)):
        (courses / name).mkdir(parents=True)
        (courses / name / "index.json").write_text(json.dumps(doc), encoding="utf-8")
    (courses / "phys-999").mkdir()      # a course folder with no catalogue is skipped
    (courses / "notes.txt").write_text("x", encoding="utf-8")

    found = M.collect(courses)
    slugs = [s["slug"] for _, s in found]
    check("only published, usable tutors are listed", slugs == ["lesson-02-demo-aaaa1111", "lesson-05-bare-dddd4444", "other-1"])
    check("the course is the folder name", [c for c, _ in found] == ["phys-215", "phys-215", "phys-310"])
    first = found[0][1]
    check("the file carries the format, version and required fields",
          (first["format"], first["version"], first["course"], first["title"], first["url"]) ==
          ("prep-tutor", 1, "phys-215", "Demo one", "https://claude.ai/public/artifacts/x1"))
    check("objectives are kept once, labelled with the key when the label is empty",
          first["objectives"] == [{"key": "k-one", "label": "First idea"}, {"key": "k-two", "label": "k-two"}] and first["objective_keys"] == ["k-one", "k-two"])
    check("a tutor with no objectives has neither field", "objectives" not in found[1][1] and "objective_keys" not in found[1][1])
    check("a lesson number is kept when it is in range, left out when it is not", first["lesson_no"] == 2 and "lesson_no" not in found[2][1])
    check("one course only", [c for c, _ in M.collect(courses, "phys-310")] == ["phys-310"])

    # the reader the page uses must accept what this writes: the same rules, checked here by hand
    import re
    ok = True
    for _, s in found:
        ok &= bool(re.match(r"^[a-z0-9-]+$", s["slug"])) and s["url"].startswith("https://") and len(s["title"]) <= 200 and s["version"] == 1
    check("every file meets the rules the page applies", ok)

    out = Path(td) / "out"
    check("a dry run writes nothing", M.main(["--courses", str(courses)]) == 0 and not out.exists())
    check("--out writes one file per tutor", M.main(["--courses", str(courses), "--out", str(out)]) == 0 and len(list(out.glob("*.tutor.json"))) == 3)
    f = out / "phys-215_lesson-02-demo-aaaa1111.tutor.json"
    check("a written file is the JSON of the setup, with a trailing newline", f.is_file() and json.loads(f.read_text(encoding="utf-8")) == first and f.read_bytes().endswith(b"\n"))
    before = {p.name: p.read_bytes() for p in out.iterdir()}
    M.main(["--courses", str(courses), "--out", str(out)])
    check("running again leaves the same files", before == {p.name: p.read_bytes() for p in out.iterdir()})
    check("the catalogues are not changed", json.loads((courses / "phys-215" / "index.json").read_text(encoding="utf-8")) == ROWS_A)
    check("a missing courses folder is an error, not a crash", M.main(["--courses", str(Path(td) / "nope")]) == 2)
    (courses / "phys-310" / "index.json").write_text("{ broken", encoding="utf-8")
    check("a catalogue that is not JSON is reported", M.main(["--courses", str(courses)]) == 2)

print(f"{'FAILED' if failed else 'ok'}: {failed} failed")
sys.exit(1 if failed else 0)
