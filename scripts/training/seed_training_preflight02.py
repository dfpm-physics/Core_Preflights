#!/usr/bin/env python3
"""
Instructor-training data seeder — fake students + fake responses for preflight-02.

Creates a small, realistic training roster so instructors can practice the admin +
grading workflow before the real Fall 2026 roster is uploaded. TEMPORARY DATA:
delete it with `--clean --commit` when the real roster goes in.

Scope (all clearly-fake, easy to remove):
  * 4 sections: M1A + T1A (Casey Pellizzari), M3A + T3A (Tyler Jones), course phys-215.
  * ~72 students in the dedicated training id block 3000990000-3000990071
    (the "99" block; the students CHECK constraint requires 3000000000-3009999999,
    so range alone can't distinguish real vs. training rows — the clean step targets
    exactly this id block + these section codes).
  * Responses to preflight-02 only, with a realistic spread: ~11% miss the assignment,
    and Q3 answers split across correct / vague-but-credited / wrong-misconception so
    /preflight-analyze has something meaningful to grade.

Raw submissions only — no scores are written. Trainees run /preflight-analyze live.

Usage:
  python3 seed_training_preflight02.py            # dry run: print the plan
  python3 seed_training_preflight02.py --commit    # create the data
  python3 seed_training_preflight02.py --clean --commit   # remove the data
"""

import argparse
import json
import os
import random
import urllib.request
from datetime import datetime, timedelta, timezone

CONFIG_PATH = os.path.expanduser("~/.claude/skills/preflight-analyze/config.json")
with open(CONFIG_PATH) as f:
    _cfg = json.load(f)
SUPA_URL = _cfg["supabase_url"].rstrip("/")
SUPA_KEY = _cfg["supabase_service_key"]
H = {"apikey": SUPA_KEY, "Authorization": f"Bearer {SUPA_KEY}"}

COURSE_ID = "phys-215"
ASSIGNMENT_ID = "preflight-02"
ID_BASE = 3_000_990_000          # training block start (distinct "99" marker)
PER_SECTION = 18
MISS_PER_SECTION = 2             # students who don't submit (shows "missing" in admin)

CASEY = "6ad3ad7e-0a5b-4512-b9be-24673cbb0160"
TYLER = "008a8c38-ee0f-4396-ac3a-f4fc9f1fd870"
SECTIONS = [("M1A", CASEY), ("T1A", CASEY), ("M3A", TYLER), ("T3A", TYLER)]

random.seed(215)  # deterministic — re-running produces the same roster/answers

# ── Names ─────────────────────────────────────────────────────
FIRST = ["Jordan", "Avery", "Riley", "Casey", "Morgan", "Taylor", "Cameron", "Devon",
         "Hayden", "Peyton", "Quinn", "Reese", "Skyler", "Emerson", "Rowan", "Sawyer",
         "Dakota", "Finley", "Harper", "Kendall", "Logan", "Marlowe", "Nolan", "Parker",
         "Sydney", "Blake", "Chandler", "Ellis", "Grayson", "Micah", "Elena", "Priya",
         "Diego", "Amara", "Wei", "Ibrahim", "Sofia", "Mateo", "Naomi", "Isaac"]
LAST = ["Bennett", "Carter", "Diaz", "Foster", "Nguyen", "Patel", "Ramirez", "Okafor",
        "Sullivan", "Torres", "Wallace", "Yamamoto", "Fischer", "Hughes", "Kim", "Larsen",
        "Mercer", "Novak", "Osei", "Petrov", "Reyes", "Shah", "Vance", "Whitaker",
        "Abbott", "Brooks", "Cho", "Delgado", "Ellison", "Freeman", "Gupta", "Holt",
        "Iverson", "Jansen", "Khan", "Lindqvist", "Morales", "Ndiaye", "Ortega", "Pearson"]

# ── Q1: reading time ──────────────────────────────────────────
READING_TIMES = [
    "About 30 minutes.", "Roughly 45 minutes.", "An hour, including re-reading.",
    "Around 25 minutes.", "About 40 minutes.", "Maybe 20 minutes, I skimmed it.",
    "Close to an hour.", "35 minutes or so.", "About half an hour.",
    "An hour and a quarter — this one was dense.", "15 minutes.", "About 50 minutes.",
]

# ── Q2: most confusing/interesting (Lesson 2 — charge & Coulomb's law) ─────────
Q2_POOL = [
    "Most interesting: that charged objects exert forces across empty space without touching — action at a distance still feels strange. Confusing: what the permittivity constant ε₀ physically represents beyond being a proportionality factor.",
    "I found charging by friction the most interesting part — that rubbing two materials can leave them oppositely charged just by moving electrons. Confusing: what determines which material grabs the electrons and which gives them up.",
    "The similarity between Coulomb's law and Newton's gravitation was interesting — both go as 1/r². What confused me was keeping track of the force direction for different sign combinations of the two charges.",
    "Most confusing: why some materials are conductors and others insulators at the microscopic level. Interesting: that charge is quantized — every charge is an integer multiple of the electron's charge.",
    "Interesting: that charge is conserved — rubbing doesn't create it, it only moves electrons from one object to another. Confusing: how to actually track where the electrons end up for a more complicated object.",
    "I found the inverse-square nature of Coulomb's law striking — doubling the distance cuts the force to a quarter. Confusing: whether the law still holds at very small, atomic separations.",
    "Most interesting: the sheer size of the Coulomb constant — two 1 C charges a meter apart would feel about 9×10⁹ N. Confusing: why we don't feel such huge forces in everyday life if charge is everywhere.",
    "The triboelectric series was interesting — it predicts which way electrons flow when two materials rub. Confusing: why the same material can be positive against one thing and negative against another.",
    "Interesting: that a neutral object can still be attracted to a charged one through polarization. Confusing: the difference between polarization and actually transferring net charge.",
    "Most confusing: the vector nature of the Coulomb force when there are three or more charges — I can do two but adding a third to get the net force got messy. Interesting: superposition lets you just add the pairwise forces.",
    "I found it interesting that protons are essentially locked in the nucleus, so only electrons move in everyday charging. Confusing: then how do we ever get a positively charged object if positive charge can't move?",
    "Interesting: how grounding neutralizes a charged conductor by giving electrons a path to or from the Earth. Confusing: why the Earth can act like an unlimited reservoir of charge.",
    "The idea that like charges repel and opposite charges attract is simple, but I was confused about how to reason about the force between an ion and a neutral atom.",
    "Most interesting: that everyday static shocks are just electrons transferred by friction and then discharged. Confusing: why humidity makes static electricity go away.",
    "I found Coulomb's torsion-balance experiment interesting — measuring tiny electric forces with a twisting fiber. Confusing: how he isolated the electric force from other effects.",
]
Q2_WEAK = [
    "It was fine, nothing really confusing.",
    "I didn't find anything confusing.",
    "The reading was interesting.",
    "Nothing stood out to me.",
]

# ── Q3: glass rod rubbed with silk — what's wrong / what moved / conservation ──
Q3_FULL = [
    "The statement is wrong: the glass didn't gain positive charge, it lost negative charge. Rubbing transfers electrons from the glass to the silk. With fewer electrons the glass is net positive; the silk, having gained those electrons, is net negative. No charge is created — the same electrons just moved, so total charge is conserved.",
    "It's incomplete because positive charge doesn't move — electrons do. Rubbing pulls electrons off the glass and onto the silk. The glass becomes positive because it has a deficit of electrons, not because it 'gained' positive charge. The silk becomes equally negative, and charge is conserved: it was redistributed, not produced.",
    "The error is treating positive charge as something that flows in. Actually the negative electrons move from the glass to the silk. Losing electrons leaves the glass positively charged and the silk negatively charged by the same amount. The net charge of the glass+silk system is unchanged, so charge is conserved.",
    "Charge isn't created by rubbing. Electrons transfer from the glass to the silk. The glass ends up positive because it lost negative charge; the silk ends up negative because it gained it. The total charge before and after is identical — conservation of charge, just redistributed between the two.",
    "Wrong part: 'gained positive charge.' Protons don't move; electrons do. The silk strips electrons off the glass, so the glass is positive from an electron deficit and the silk is negative from an electron surplus — equal and opposite. Charge is conserved because nothing is created, electrons just relocate.",
    "The glass became positive by losing electrons to the silk, not by gaining positive charge. Only electrons are free to move. The positive charge on the glass equals the negative charge on the silk, and the total change is zero — charge is conserved, only transferred.",
    "It's incomplete because it ignores what physically moves. Electrons go from glass to silk. The glass has a shortage of electrons and is therefore positive; the silk has extra electrons and is negative. The electrons were neither created nor destroyed, only moved, so total charge is conserved.",
    "Positive charges (protons) are bound in the nuclei and don't move. What happens is electrons leave the glass and land on the silk. The glass is positive because of the missing electrons; the silk is negative by the same amount. Total charge stays constant — conservation of charge.",
    "The mistake is thinking positive charge was added. Rubbing moves electrons out of the glass and into the silk. Fewer electrons → the glass reads positive; extra electrons → the silk reads negative. Same total charge as before, just split differently, so it's conserved.",
    "Nothing gains positive charge directly. Electrons are transferred from the glass to the silk during rubbing. The glass is left electron-deficient (positive) and the silk electron-rich (negative), with equal magnitudes. Charge is conserved because the electrons only changed location.",
]
Q3_WARN = [
    "The glass is positive because charge moved to the silk. It didn't really gain positive charge, the charge just transferred during rubbing.",
    "It's not that it gained positive charge — charge moved between the glass and silk. The glass ends up positive and the silk negative.",
    "Electrons moved, so the glass became positive. Rubbing transferred the charge from one to the other.",
    "The statement is wrong because charge is transferred, not created. The glass lost some charge to the silk and became positive.",
    "The glass didn't gain positive charge; some negative charge left it. So it's positive now and the silk is negative.",
    "Charge was conserved — it just moved from the glass to the silk when they were rubbed, making the glass positive.",
    "It's incomplete because it doesn't mention the silk. The charge separated between them, leaving the glass positive.",
]
Q3_ZERO = [
    "The student is basically right — rubbing gives the glass extra positive charge, and the silk stays neutral.",
    "Nothing is wrong with it. The glass gains positive charge from the friction of rubbing.",
    "The glass became positive because protons moved from the silk into the glass during rubbing.",
    "It's correct. Friction creates positive charge on the glass, which is why it can attract small pieces of paper.",
    "The rubbing adds energy that turns into positive charge on the glass. The silk isn't really involved.",
    "",
    "I'm not sure, but I think the glass just becomes charged somehow when you rub it.",
    "Positive charges flow from the silk to the glass, which is what makes the glass positive.",
]


def req(path, method="GET", body=None, extra=None):
    headers = {**H}
    if extra:
        headers.update(extra)
    data = json.dumps(body).encode() if body is not None else None
    if data:
        headers["Content-Type"] = "application/json"
    r = urllib.request.Request(f"{SUPA_URL}/rest/v1/{path}", data=data, method=method, headers=headers)
    with urllib.request.urlopen(r, timeout=60) as resp:
        raw = resp.read()
        return resp.status, (json.loads(raw) if raw else None)


def build_roster():
    """Return (sections, students, responses) fully materialized."""
    sections = [{"id": sid, "instructor_id": inst, "course_id": COURSE_ID} for sid, inst in SECTIONS]
    students, responses = [], []
    used_names = set()
    sid_counter = ID_BASE
    now = datetime.now(timezone.utc)

    for sect_id, _ in SECTIONS:
        # who submits vs. misses
        idxs = list(range(PER_SECTION))
        random.shuffle(idxs)
        missing = set(idxs[:MISS_PER_SECTION])
        # Q3 credit spread among the submitters (~62% full, ~25% vague, ~13% wrong)
        for i in range(PER_SECTION):
            # unique name
            while True:
                name = f"{random.choice(FIRST)} {random.choice(LAST)}"
                if name not in used_names:
                    used_names.add(name)
                    break
            student_id = sid_counter
            sid_counter += 1
            students.append({"student_id": student_id, "name": name,
                             "section_id": sect_id, "auth_user_id": None})
            if i in missing:
                continue
            roll = random.random()
            q3 = random.choice(Q3_FULL if roll < 0.62 else Q3_WARN if roll < 0.87 else Q3_ZERO)
            q2 = random.choice(Q2_WEAK) if random.random() < 0.12 else random.choice(Q2_POOL)
            submitted = now - timedelta(hours=random.uniform(2, 40))
            responses.append({
                "student_id": student_id,
                "assignment_id": ASSIGNMENT_ID,
                "answers": {"q1": random.choice(READING_TIMES), "q2": q2, "q3": q3},
                "submitted_at": submitted.strftime("%Y-%m-%dT%H:%M:%S+00:00"),
                "updated_at": submitted.strftime("%Y-%m-%dT%H:%M:%S+00:00"),
            })
    return sections, students, responses


def seed(commit):
    sections, students, responses = build_roster()
    print(f"Plan: {len(sections)} sections, {len(students)} students, {len(responses)} responses "
          f"({len(students) - len(responses)} intentionally missing).")
    for s in sections:
        n = sum(1 for st in students if st["section_id"] == s["id"])
        who = "Casey" if s["instructor_id"] == CASEY else "Tyler"
        print(f"  {s['id']} ({who}): {n} students")
    if not commit:
        print("\n[dry run] re-run with --commit to write.")
        return
    # Upsert parents first (sections), then students, then responses.
    req("sections?on_conflict=id", "POST", sections, {"Prefer": "resolution=merge-duplicates,return=minimal"})
    req("students?on_conflict=student_id", "POST", students, {"Prefer": "resolution=merge-duplicates,return=minimal"})
    req("responses?on_conflict=student_id,assignment_id", "POST", responses,
        {"Prefer": "resolution=merge-duplicates,return=minimal"})
    print(f"\nSeeded: {len(students)} training students, {len(responses)} responses for {ASSIGNMENT_ID}.")
    print("Raw submissions only — run /preflight-analyze phys-215 preflight-02 to grade.")


def clean(commit):
    lo, hi = ID_BASE, ID_BASE + len(SECTIONS) * PER_SECTION - 1
    sect_ids = ",".join(s for s, _ in SECTIONS)
    print(f"Will delete training data: student_id {lo}-{hi} and sections ({sect_ids}).")
    if not commit:
        print("[dry run] re-run with --clean --commit to delete.")
        return
    # responses + scores cascade on student delete, but delete responses explicitly for clarity.
    req(f"responses?student_id=gte.{lo}&student_id=lte.{hi}", "DELETE", None, {"Prefer": "return=minimal"})
    req(f"scores?student_id=gte.{lo}&student_id=lte.{hi}", "DELETE", None, {"Prefer": "return=minimal"})
    req(f"students?student_id=gte.{lo}&student_id=lte.{hi}", "DELETE", None, {"Prefer": "return=minimal"})
    # Only remove the sections we created (safe: real roster would use its own codes/owners).
    req(f"sections?id=in.({sect_ids})&course_id=eq.{COURSE_ID}", "DELETE", None, {"Prefer": "return=minimal"})
    print("Training data removed.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--clean", action="store_true")
    a = ap.parse_args()
    (clean if a.clean else seed)(a.commit)
