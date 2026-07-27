#!/usr/bin/env python
"""Instructor-training data seeder — fake student work for lessons 03 and 04 (schema `app`).

Companion to seed_training_preflight02.py, which seeded the LEGACY `public` schema. This one
targets the PREP v2 model in schema `app`, and specifically the **training sandbox offering**
(term `training-fall-2026`, labelled "TRAINING SANDBOX — Fall 2026"). TEMPORARY DATA: remove it
with `--clean --commit`.

WHY THE TWO LESSONS GET DIFFERENT DATA — this is the point of the exercise, not an accident.
The two lessons are wired to opposite graded paths in this offering, so seeding both exercises
both halves of the pipeline:

    preflight-03   written activity   = GRADED     interactive = practice
                   -> free-response answers; /preflight-analyze grades them and writes the
                      schema:1 assessment into grades.diagnostic.

    preflight-04   interactive        = GRADED     written     = practice
                   -> artifact reports (report_markdown + schema:1 content); the migration-015
                      trigger auto-grades each one the moment the submission commits. Nothing
                      here writes `grades` for lesson 04 — the database does.

WRITE ORDER IS LOAD-BEARING for lesson 04. `grade_interactive_on_commit()` reads
submission_activities.content when the submission flips to 'committed'. So every student is
written the way the browser writes them (student-data.js): insert the submission as a DRAFT,
insert the work, then commit. Committing first would fire the trigger against a missing report
and silently leave the student ungraded.

SAFETY
  * Refuses to touch any offering whose term label does not contain "TRAINING" (guard below).
    The clean Fall 2026 phys-215 offering shares this course; the guard is what keeps a
    mistyped id from seeding fake work into it.
  * Dry-run by default; --commit to write, and one explicit transaction per run.
  * Idempotent: a student who already has a submission for the offering is skipped, never
    overwritten, so a re-run cannot clobber grading that has already happened.
  * --clean snapshots every row it is about to delete to JSON first (CORE.md §0), and needs
    its own --commit.

Usage (from the repo root, via the project venv):
  .venv/Scripts/python scripts/training/seed_training_lessons_03_04.py                  # plan
  .venv/Scripts/python scripts/training/seed_training_lessons_03_04.py --commit
  .venv/Scripts/python scripts/training/seed_training_lessons_03_04.py --lesson 03 --commit
  .venv/Scripts/python scripts/training/seed_training_lessons_03_04.py --clean --out snap.json
  .venv/Scripts/python scripts/training/seed_training_lessons_03_04.py --clean --out snap.json --commit
"""

import argparse
import io
import json
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

try:
    import psycopg2
    from psycopg2.extras import Json, RealDictCursor
except ImportError:
    sys.exit("psycopg2 not found — use the project .venv (pip install -r requirements.txt).")

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "supabase" / "admin"))
from app_tier_check import load, connect  # noqa: E402

TRAINING_OFFERING = "ce946b19-b70c-4630-b5f4-af23a6582377"
LESSONS = ("preflight-03", "preflight-04")

# 2-3 non-submitters per section, per the director's spec. Fixed per (lesson, section) so a
# dry run and the commit that follows describe the same roster, and so the two lessons have
# genuinely different missing students rather than the same cadets missing everything.
MISSING_PER_SECTION = {
    "preflight-03": {"M1A": 3, "M3A": 2, "T1A": 3, "T3A": 2},
    "preflight-04": {"M1A": 2, "M3A": 3, "T1A": 2, "T3A": 3},
}

# The browser-walkthrough account. Left without a submission on purpose so a trainer can sign
# in and practise the submit flow end to end; it counts toward that section's missing quota.
RESERVED_NAMES = {"ZZ Test Cadet"}

SEED = 20260727


# ══════════════════════════════════════════════════════════════════════════════
# Lesson 03 — written free response
#   Q1 reading time (0 pts) · Q2 reading reflection (1 pt) · Q3 JiTT free response (1 pt)
#   Q3: three equal-magnitude charges on a line — can the net force on the middle one be zero?
#       Answer: yes, iff the two forces are opposite in direction and equal in magnitude.
# ══════════════════════════════════════════════════════════════════════════════

READING_TIMES = [
    "About 30 minutes.", "Roughly 45 minutes.", "An hour, including working the examples.",
    "Around 25 minutes.", "About 40 minutes.", "Maybe 20 minutes, I skimmed it.",
    "Close to an hour.", "35 minutes or so.", "About half an hour.",
    "An hour and a half — the vector notation slowed me down.", "15 minutes.",
    "About 50 minutes.", "Two hours, I had to reread the examples a few times.",
    "45 min", "Probably 20-30 minutes.", "A little over an hour.",
    "10 minutes, I ran out of time before practice.", "1.5 hrs",
]

L3_Q2 = [
    "Most interesting: that the unit vector r̂ is what carries the direction information, so the "
    "same formula handles attraction and repulsion without a separate case. Confusing: keeping "
    "straight whether r̂ points from the source charge to the field point or the other way.",
    "The superposition principle was the most interesting part — that you can just add the "
    "pairwise forces and ignore the presence of the other charges entirely. Confusing: why the "
    "presence of a third charge doesn't change the force between the first two.",
    "I found the vector form of Coulomb's law confusing at first because of all the subscripts. "
    "Once I saw that F₁₂ means 'force on 1 from 2' it clicked. Interesting: the symmetry with "
    "Newton's third law falls right out of the formula.",
    "Most confusing: setting up the components when the charges aren't on a single axis. I can do "
    "the magnitudes but I lose track of the signs of the x and y pieces. Interesting: that the "
    "1/r² dependence means position matters far more than charge size.",
    "Interesting: that superposition is an experimental fact, not something derived — the book "
    "was explicit about that and I hadn't thought about which parts of physics are assumptions.",
    "The examples with three charges in a triangle were the most useful part. Confusing: how to "
    "decide which angle to use when resolving each force into components.",
    "Most interesting: that a charge feels no force from itself, so you sum over every other "
    "charge but skip its own term. Confusing: what happens in the limit where two charges "
    "approach each other and the force blows up.",
    "I was confused by why we bother with the vector form when the scalar version plus a sketch "
    "seems to work. Interesting: it stops mattering once you have more than two charges and can't "
    "eyeball the directions anymore.",
    "Interesting: that the net force can be zero somewhere between two like charges — there's a "
    "specific null point. Confusing: how to actually solve for where that point is.",
    "Most confusing: the difference between the distance r and the position vector r⃗ in the "
    "formula. They use similar symbols and I kept mixing up which one gets cubed in the "
    "alternate form.",
    "The idea that forces add as vectors is straightforward, but I found it confusing that equal "
    "magnitude charges can produce a nonzero net force just because of geometry.",
    "Interesting: the book's point that you should always draw the free-body diagram before "
    "touching the algebra. That saved me on the practice problem where two forces partly "
    "cancelled.",
    "Most interesting: how much of this is really just vector addition from Physics 110 with a "
    "new formula for the magnitude. Confusing: the notation r̂₁₂ versus r⃗₁₂ — I still have to "
    "stop and think each time.",
    "Confusing: whether the 1/r² in the denominator is the distance between the two charges or "
    "the distance from the origin. Interesting: that the constant k is just 1/(4πε₀) rewritten.",
    "I found it interesting that superposition means you can break a hard problem into a pile of "
    "two-charge problems. Confusing: how you'd apply that to a continuous rod of charge rather "
    "than a few point charges.",
    "Most confusing: why the force from each charge is computed as if the others weren't there. "
    "That seems like it should be an approximation but the book presents it as exact.",
]
L3_Q2_WEAK = [
    "It was fine, nothing really confusing.",
    "Nothing stood out to me.",
    "It was pretty straightforward.",
    "I didn't find anything confusing.",
    "n/a",
]

# Q3 — full credit: says YES, and names BOTH conditions (opposite directions AND equal magnitudes).
L3_Q3_FULL = [
    "Yes, it is possible. By superposition you find the force from each outer charge separately "
    "and add them as vectors. Since the two forces act along the same line, the net force is zero "
    "only when they point in opposite directions and have equal magnitudes. Because the charges "
    "have equal magnitude, that means the middle charge has to be equidistant from both outer "
    "charges, and the two outer charges have to be arranged so their forces oppose.",
    "Yes. Each outer charge exerts a nonzero force, but force is a vector, so the net force is "
    "the vector sum, not the sum of the sizes. For that sum to vanish the two forces must be "
    "antiparallel — one pushing left, one pushing right — and equal in magnitude. Equal magnitude "
    "requires equal distance, since both outer charges have the same charge size.",
    "It is possible. Superposition says the total force is F_left + F_right added as vectors. On "
    "a line those are either the same direction or opposite. If they are the same direction they "
    "add and can never cancel. If they are opposite and the magnitudes match exactly, the net "
    "force is zero even though neither individual force is zero.",
    "Yes. The two forces have to be equal in magnitude and opposite in direction. Since the outer "
    "charges have the same magnitude of charge, the 1/r² dependence means equal magnitudes happen "
    "only when the middle charge sits exactly halfway between them. The signs of the outer charges "
    "then have to be such that one pulls and the other pushes in the same sense.",
    "Yes, because forces are vectors and vectors can cancel. Adding the magnitudes 'F + F' would "
    "be wrong — that only applies when they point the same way. The condition is that the two "
    "forces on the center charge are equal in magnitude and opposite in direction, which on this "
    "line means equal distances to the two outer charges.",
    "It can be zero. Compute each force with Coulomb's law and then vector-add them. Zero net "
    "force requires the leftward force to exactly cancel the rightward one: same magnitude, "
    "opposite direction. Neither force is zero on its own — they just annihilate in the sum.",
    "Yes. Superposition means I treat each outer charge independently, so the middle charge feels "
    "two nonzero forces. Those two forces point along the line, so they cancel only if they are "
    "in opposite directions with the same magnitude. Because |q| is the same for both outer "
    "charges, that reduces to the middle charge being the same distance from each.",
    "Yes it's possible. The key is that the net force is a vector sum. The two forces must be "
    "antiparallel and have equal magnitude. If the middle charge were closer to one outer charge, "
    "that force would be larger by 1/r² and the net force would point toward it, so equidistant "
    "placement is required.",
    "Yes. Each outer charge produces its own force on the middle charge, and by superposition "
    "these add as vectors. Zero net force means the two vectors are equal and opposite. On a "
    "straight line that is easy to picture: one force to the +x direction, one to the −x "
    "direction, same size, and they cancel.",
    "Definitely possible. Coulomb's law gives each force a magnitude kq²/r² and a direction along "
    "the line. For the sum to be zero the directions must be opposite and the magnitudes equal, "
    "so r must be the same on both sides. The individual forces stay nonzero the whole time.",
    "Yes. The two forces on the center charge must oppose each other and be equal in size. I "
    "think of it as a tug of war: both ropes are under tension (nonzero force) but the middle "
    "charge doesn't move because the pulls balance exactly.",
    "Yes, if the two forces are equal in magnitude and point in opposite directions. Superposition "
    "lets me add them like any other vectors. Equal magnitude requires the distances to be equal "
    "since the outer charges have the same magnitude of charge.",
]

# Q3 — warn: right answer / right idea, but a required piece is missing or vague. Full credit,
# flagged yellow, so the training cohort has something for an instructor to review.
L3_Q3_WARN = [
    "Yes, the forces can cancel out if they are balanced. The two outer charges push on the "
    "middle one and if everything is symmetric the net force ends up being zero.",
    "Yes it's possible. The forces would have to be opposite so they cancel each other out.",
    "Yes. If the middle charge is in the exact center the two forces will be the same size and "
    "the net force is zero.",
    "It's possible because the forces are in opposite directions and cancel. Each one is still "
    "nonzero by itself though.",
    "Yes — you have to add the two forces together and they can come out to zero if they oppose. "
    "That's the superposition principle.",
    "Yes, if the magnitudes are the same the net force will be zero. The middle charge feels both "
    "forces but they end up balancing.",
    "I think yes, because the forces are vectors and vectors can add to zero. As long as they are "
    "set up right the middle charge feels no net force.",
    "Yes. The distances have to be equal so that the two forces are the same strength, and then "
    "nothing happens to the middle charge.",
]

# Q3 — zero: wrong, blank, or a genuine misconception. Deliberately the smallest bucket.
L3_Q3_ZERO = [
    "No, it isn't possible. If both outer charges exert a nonzero force then the total force has "
    "to be nonzero too — you add them up and get something bigger than either one.",
    "No. Adding the two force magnitudes together always gives a positive number, so the net "
    "force can't be zero unless one of the charges is removed.",
    "",
    "No, because the middle charge is being pulled by both sides at once, so it would be ripped "
    "apart rather than sitting at zero net force.",
    "I'm not really sure. I think it depends on the signs of the charges but I couldn't work out "
    "the condition.",
    "Yes, because the two forces cancel since the charges are equal. The magnitudes always cancel "
    "when the charges are the same size, no matter where the middle charge sits.",
    "No — the forces would only cancel if both outer charges were zero, and the problem says they "
    "aren't.",
]


# ══════════════════════════════════════════════════════════════════════════════
# Lesson 04 — interactive artifact reports (schema 1 + short Markdown)
#   Topic: electric fields and field lines. Field exists everywhere, not just on the drawn
#   lines; closer spacing means a stronger field.
# ══════════════════════════════════════════════════════════════════════════════

L4_OBJECTIVES = [
    ("field-is-everywhere", "The field exists throughout the region, not only on the drawn lines"),
    ("line-spacing-strength", "Line spacing indicates field strength"),
    ("field-direction-tangent", "Field direction is tangent to the line at each point"),
    ("field-superposition", "Superposition of fields from multiple charges"),
]

L4_MISCONCEPTIONS = {
    "field-only-on-lines": (
        "Field exists only on the drawn lines",
        "Believes the electric field is present only where a field line has been drawn, and that "
        "the space between lines is field-free.",
    ),
    "lines-are-trajectories": (
        "Field lines are particle paths",
        "Treats field lines as tracks that a released charge would travel along, rather than a "
        "representation of the field's direction at each point.",
    ),
    "on-line-means-stronger": (
        "Being on a line means a stronger field",
        "Judges field strength by whether a point sits on a drawn line rather than by how closely "
        "spaced the surrounding lines are.",
    ),
    "field-needs-test-charge": (
        "No charge, no field",
        "Believes the electric field only exists once a test charge is placed in it, rather than "
        "being a property of the source charge's surroundings.",
    ),
    "more-lines-more-charge-only": (
        "Line count alone sets the strength",
        "Reads the total number of lines drawn as the field strength, ignoring that spacing at a "
        "given location is what carries the magnitude.",
    ),
}

L4_REFLECTIONS_GOOD = [
    "The most interesting part was that field lines are a drawing convention, not something "
    "physically there. I had been picturing them like wires.",
    "I found it confusing at first that the field exists at points where no line is drawn. Once I "
    "thought of the lines as a sampling of a continuous field it made more sense.",
    "What stuck with me was that the density of the lines is the information — I had been reading "
    "the number of lines as the strength instead of how tightly packed they are.",
    "Interesting: that field lines never cross, and the reason is that the field can only point "
    "one direction at each point. That's a nice argument.",
    "I liked the connection back to Coulomb's law — the field is just the force per unit charge, "
    "so all the 1/r² intuition carries over. Confusing: why we bother defining a field at all "
    "instead of just using forces.",
    "The confusing part was the arrows on the lines. I kept wanting them to show where a charge "
    "would go rather than which way the field points at that instant.",
    "Most interesting was the idea that the field is defined even where there's nothing to feel "
    "it. That felt strange but the book's point about the field being a property of space helped.",
    "I found the superposition sketches hard — adding two field patterns to get the combined one "
    "is not something I can do by eye yet.",
]
L4_REFLECTIONS_THIN = [
    "It was interesting. The field lines part made sense.",
    "Nothing was too confusing.",
    "I thought the diagrams were helpful.",
    "It was ok.",
]
L4_REFLECTIONS_NONE = [
    "I didn't get to the reading.",
    "didnt read",
    "n/a",
    "I skimmed it right before this.",
]

# Five profiles. Each fixes the shape of the report; the text pools vary the surface so 70-odd
# reports don't read as five copies. The distribution is deliberately not uniform — a real
# cohort is mostly solid with a tail at each end.
L4_PROFILES = [
    # (name, weight, effort, overall_understanding, obj_range, misconception ids, meaningful, engagement)
    ("strong",  0.22, 5, 5, (4, 5), [],                                        True,  5),
    ("solid",   0.34, 5, 4, (3, 5), ["field-only-on-lines"],                   True,  4),
    ("partial", 0.24, 4, 3, (2, 4), ["on-line-means-stronger",
                                     "field-only-on-lines"],                   True,  3),
    ("weak",    0.12, 3, 2, (1, 3), ["lines-are-trajectories",
                                     "field-needs-test-charge"],               True,  2),
    ("unread",  0.08, 2, 1, (0, 2), ["field-only-on-lines",
                                     "more-lines-more-charge-only"],           False, 0),
]

L4_SUMMARY = {
    "strong": "Fully engaged throughout; reasoned from the definition of the field rather than "
              "from the picture, and correctly separated the representation from the physics.",
    "solid":  "Engaged and complete; solid on line spacing as a strength indicator, with some "
              "residual confusion about whether the field exists between the drawn lines.",
    "partial": "Worked through most of the conversation. Reads the diagram as the physics — "
               "needed prompting to see that the field is continuous and that spacing, not "
               "membership of a line, sets the magnitude.",
    "weak":   "Short session with terse answers. Treats field lines as paths a charge follows and "
              "is not yet distinguishing the field from a force on a specific charge.",
    "unread": "Self-reported not having done the reading; the session stayed at definitions and "
              "little substantive understanding was demonstrated.",
}
L4_STRENGTHS = {
    "strong": "Clear, unprompted statement that the lines are a representation and the field is "
              "defined everywhere.",
    "solid":  "Correctly used line spacing to compare field strength at two locations.",
    "partial": "Recovered the tangent rule for field direction once reminded of it.",
    "weak":   "Stayed with the conversation and self-corrected once on the direction of the field.",
    "unread": "Answered direct questions when walked through them.",
}
L4_REVIEW = {
    "strong": "Nothing outstanding — could push further into superposition of two-charge patterns.",
    "solid":  "Re-read the passage on why the field exists between the lines, not just on them.",
    "partial": "Field-line spacing vs. field strength, and what the space between lines represents.",
    "weak":   "The distinction between a field line and a trajectory; revisit the whole field-line "
              "section before class.",
    "unread": "All of it — the reading itself, then field lines as a representation.",
}
L4_EFFORT_RATIONALE = {
    "strong": "Sustained engagement across the whole conversation with substantive answers and a "
              "genuine reading reflection.",
    "solid":  "Worked through every prompt and responded to follow-ups; reflection was real.",
    "partial": "Engaged but brief in places; answered all the main questions.",
    "weak":   "Short answers throughout and a couple of tangents, but stayed on task.",
    "unread": "Self-reported not having read; effort capped at 2 by the reflection gate.",
}


def clip(text, n):
    return text if len(text) <= n else text[: n - 1] + "…"


def l4_report(rng, profile, student_name, reflection):
    """One short artifact report — Markdown blob plus the schema:1 payload beside it."""
    name, _w, effort, understanding, obj_rng, misc_ids, meaningful, engagement = profile
    lo, hi = obj_rng
    objectives = [
        {"key": k, "label": lab, "understanding": rng.randint(lo, hi)}
        for k, lab in L4_OBJECTIVES
    ]
    # An unread session doesn't reach every objective — null, not 0 (contract §5.1).
    if name == "unread":
        for o in objectives[2:]:
            o["understanding"] = None

    # The FIRST id of a profile is always emitted; later ones are a coin flip. That is not
    # decoration — ai_summary and flags.note below describe the profile's characteristic
    # misconception, so dropping it at random would ship reports whose prose contradicts their
    # own structure, and the rollup counts structure while the instructor reads prose.
    misconceptions = []
    for i, mid in enumerate(misc_ids):
        if i > 0 and rng.random() >= 0.45:
            continue
        label, desc = L4_MISCONCEPTIONS[mid]
        misconceptions.append({
            "id": mid, "label": label, "description": desc,
            "severity": "major" if name in ("weak", "unread") else "minor",
            "evidence": rng.choice(L4_EVIDENCE[mid]),
        })

    duration = {"strong": (12, 18), "solid": (10, 15), "partial": (7, 12),
                "weak": (4, 8), "unread": (3, 7)}[name]
    data = {
        "schema": 1,
        "producer": "lesson-04-electric-fields-and-electric-field-lines@2026-08",
        "effort": effort,
        "effort_rationale": L4_EFFORT_RATIONALE[name],
        "completed": name != "unread",
        "duration_min": rng.randint(*duration),
        "message_count": rng.randint(6, 22),
        "overall_understanding": understanding,
        "objectives": objectives,
        "misconceptions": misconceptions,
        "reading_reflection": {
            "text": reflection,
            "meaningful": meaningful,
            "engagement": engagement,
            "topics": ["field-lines"] + (["representation"] if name in ("strong", "solid") else []),
            "sentiment": "positive" if name in ("strong", "solid") else
                         "neutral" if name == "partial" else "negative",
        },
        "honor": {"status": "none", "note": None},
        "ai_summary": L4_SUMMARY[name],
        "key_strengths": L4_STRENGTHS[name],
        "recommended_review": L4_REVIEW[name],
        # Set per profile, not derived from the numbers: L4_FLAG_NOTE already commits to whether
        # this student needs a check-in, and the two must not disagree. (The written path's
        # `effort <= 2 or understanding <= 1` anchor would leave the `weak` profile unflagged
        # while its own note says "follow up".)
        "flags": {
            "needs_follow_up": name in ("weak", "unread"),
            "notable": name == "strong" and understanding == 5,
            "note": L4_FLAG_NOTE[name],
        },
        "source_provenance": {
            "note": "Synthetic instructor-training data. Not a real student conversation.",
            "generated_by": "seed-training-lessons-03-04@2026-07-27",
        },
    }

    misc_rows = "\n".join(
        f"| {m['label']} | {m['severity']} | {m['evidence']} |" for m in misconceptions
    ) or "| _none observed_ | — | — |"
    obj_rows = "\n".join(
        f"| {o['label']} | {'—' if o['understanding'] is None else o['understanding']}/5 |"
        for o in objectives
    )
    markdown = f"""# JiTT Conversation Report

## Cadet Information
- **Name / Cadet Identifier:** {student_name}
- **Lesson:** Physics 215, Fall 2026, Lesson 4 — Electric Fields & Electric Field Lines
- **Approximate Duration:** {data['duration_min']} minutes

## Cadet's Reading Reflection (verbatim)

> "{reflection}"

## Objective Assessment

| Objective | Understanding |
|---|---|
{obj_rows}

## Misconceptions Observed

| Misconception | Severity | Evidence |
|---|---|---|
{misc_rows}

## Summary

{data['ai_summary']}

**Strengths.** {data['key_strengths']}

**Recommended review.** {data['recommended_review']}

## Effort

**{effort}/5** — {data['effort_rationale']}

---
*Synthetic training report — generated for instructor practice, not a real conversation.*
"""
    return data, markdown


L4_EVIDENCE = {
    "field-only-on-lines": [
        "\"B is between the lines so there's no field there\"",
        "\"the field only exists along the arrows\"",
        "\"nothing is at B because no line goes through it\"",
    ],
    "lines-are-trajectories": [
        "\"a charge would slide along the line to the other side\"",
        "\"the line shows the path it takes\"",
    ],
    "on-line-means-stronger": [
        "\"A is stronger because it's actually on a line\"",
        "\"if you're on the line you get the full field\"",
    ],
    "field-needs-test-charge": [
        "\"there's no field until you put a charge there to feel it\"",
        "\"the field turns on when something is there\"",
    ],
    "more-lines-more-charge-only": [
        "\"you just count the lines to see how strong it is\"",
        "\"more lines drawn means a bigger field everywhere\"",
    ],
}

L4_FLAG_NOTE = {
    "strong": "Exemplary: separated the representation from the physics unprompted.",
    "solid": "Solid session; minor confusion about the space between lines.",
    "partial": "Reads the diagram as the physics — worth a check-in.",
    "weak": "Low understanding and a path/line confusion; follow up.",
    "unread": "Did not do the reading; address the reading expectation directly.",
}


# ══════════════════════════════════════════════════════════════════════════════
# DB helpers
# ══════════════════════════════════════════════════════════════════════════════

def db_connect():
    cfg, tiers = load()
    if "dml" not in tiers:
        sys.exit("No PREP_APP_DML_ROLE / _PASSWORD in supabase/admin/.env — see app_schema_bootstrap.sql.")
    conn = connect(cfg, tiers["dml"])
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("SET search_path = app")
    cur.close()
    return conn


def guard_training(cur, offering_id):
    """Refuse to run against anything but the training sandbox."""
    cur.execute("""
        SELECT t.code, t.label, c.code AS course
          FROM course_offerings co
          JOIN terms t   ON t.id = co.term_id
          JOIN courses c ON c.id = co.course_id
         WHERE co.id = %s
    """, (offering_id,))
    row = cur.fetchone()
    if not row:
        sys.exit(f"No course_offering {offering_id}.")
    if "TRAINING" not in (row["label"] or "").upper():
        sys.exit(f"REFUSING: offering {offering_id} is term '{row['label']}', not a training "
                 f"sandbox. This script only ever writes fake data.")
    return row


def lesson_context(cur, offering_id, slug):
    """The assignment offering plus its graded activity for one lesson."""
    cur.execute("""
        SELECT ao.id AS assignment_offering_id, ao.due_at, ao.due_by_day, ao.points_possible,
               ao.grading_mode, a.slug, a.title
          FROM assignment_offerings ao
          JOIN assignments a ON a.id = ao.assignment_id
         WHERE ao.course_offering_id = %s AND a.slug = %s
    """, (offering_id, slug))
    ao = cur.fetchone()
    if not ao:
        sys.exit(f"No assignment offering for {slug} in {offering_id}.")

    cur.execute("""
        SELECT act.id, act.slug, act.modality, oa.grading_role
          FROM offering_activities oa
          JOIN activities act ON act.id = oa.activity_id
         WHERE oa.assignment_offering_id = %s
         ORDER BY oa.position
    """, (ao["assignment_offering_id"],))
    acts = cur.fetchall()
    graded = [a for a in acts if a["grading_role"] == "graded"]
    if len(graded) != 1:
        sys.exit(f"{slug}: expected exactly one graded activity, found {len(graded)}.")
    return ao, graded[0], acts


def roster(cur, offering_id):
    cur.execute("""
        SELECT e.id AS enrollment_id, e.student_id, st.name, sec.code AS section,
               sec.id AS section_id, sec.meeting_days
          FROM enrollments e
          JOIN sections sec ON sec.id = e.section_id
          JOIN students st  ON st.student_id = e.student_id
         WHERE sec.course_offering_id = %s AND e.status = 'active'
         ORDER BY sec.code, st.student_id
    """, (offering_id,))
    return cur.fetchall()


def existing_submissions(cur, assignment_offering_id):
    cur.execute("SELECT enrollment_id FROM submissions WHERE assignment_offering_id = %s",
                (assignment_offering_id,))
    return {r["enrollment_id"] for r in cur.fetchall()}


def commit_times(rng, n, now):
    """Spread commits over the ten days before now — well inside both lessons' deadlines, so
    nothing is seeded late. (Fabricating a future committed_at to manufacture lateness would
    put timestamps ahead of the clock every page reads.)"""
    return [now - timedelta(hours=rng.uniform(2, 240)) for _ in range(n)]


# ══════════════════════════════════════════════════════════════════════════════
# Build + write
# ══════════════════════════════════════════════════════════════════════════════

def plan_lesson(cur, offering_id, slug, rng):
    ao, graded, acts = lesson_context(cur, offering_id, slug)
    people = roster(cur, offering_id)
    already = existing_submissions(cur, ao["assignment_offering_id"])
    now = datetime.now(timezone.utc)

    by_section = {}
    for p in people:
        by_section.setdefault(p["section"], []).append(p)

    rows, skipped_missing, skipped_existing = [], [], []
    for section, members in sorted(by_section.items()):
        n_missing = MISSING_PER_SECTION[slug][section]
        reserved = [m for m in members if m["name"] in RESERVED_NAMES]
        pool = [m for m in members if m["name"] not in RESERVED_NAMES]
        rng.shuffle(pool)
        missing = reserved[:n_missing] + pool[: max(0, n_missing - len(reserved))]
        missing_ids = {m["enrollment_id"] for m in missing}
        skipped_missing += [(section, m["name"]) for m in missing]

        submitters = [m for m in members if m["enrollment_id"] not in missing_ids]
        times = commit_times(rng, len(submitters), now)
        for person, when in zip(submitters, times):
            if person["enrollment_id"] in already:
                skipped_existing.append((section, person["name"]))
                continue
            rows.append(build_row(rng, slug, graded, person, when))

    return ao, graded, acts, rows, skipped_missing, skipped_existing, len(people)


def build_row(rng, slug, graded, person, when):
    """One student's work, in the shape the browser would have written it."""
    base = {
        "enrollment_id": person["enrollment_id"],
        "student_id": person["student_id"],
        "name": person["name"],
        "section": person["section"],
        "activity_id": graded["id"],
        "committed_at": when,
    }
    if slug == "preflight-03":
        roll = rng.random()
        q3 = rng.choice(L3_Q3_FULL if roll < 0.60 else
                        L3_Q3_WARN if roll < 0.86 else L3_Q3_ZERO)
        q2 = rng.choice(L3_Q2_WEAK) if rng.random() < 0.12 else rng.choice(L3_Q2)
        base["content"] = {"q1": rng.choice(READING_TIMES), "q2": q2, "q3": q3}
        base["report_markdown"] = None
    else:
        profile = rng.choices(L4_PROFILES, weights=[p[1] for p in L4_PROFILES])[0]
        pname = profile[0]
        pool = (L4_REFLECTIONS_NONE if pname == "unread" else
                L4_REFLECTIONS_THIN if pname == "weak" else L4_REFLECTIONS_GOOD)
        data, markdown = l4_report(rng, profile, person["name"], rng.choice(pool))
        base["profile"] = pname
        base["content"] = data
        base["report_markdown"] = markdown
    return base


def write_rows(cur, ao, rows):
    """Draft -> work -> commit, per student. That order is what lets migration 015's trigger
    see the report when an interactive submission commits."""
    aoid = ao["assignment_offering_id"]
    for r in rows:
        cur.execute("""
            INSERT INTO submissions (enrollment_id, assignment_offering_id, status)
                 VALUES (%s, %s, 'draft')
              RETURNING id
        """, (r["enrollment_id"], aoid))
        sub_id = cur.fetchone()["id"]

        cur.execute("""
            INSERT INTO submission_activities
                   (submission_id, activity_id, content, report_markdown, payload_bytes, is_final)
                 VALUES (%s, %s, %s, %s, %s, true)
        """, (sub_id, r["activity_id"], Json(r["content"]), r["report_markdown"],
              len(r["report_markdown"]) if r["report_markdown"] else None))

        cur.execute("""
            UPDATE submissions
               SET chosen_activity_id = %s, status = 'committed', committed_at = %s
             WHERE id = %s
        """, (r["activity_id"], r["committed_at"], sub_id))


def seed(args):
    conn = db_connect()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    term = guard_training(cur, TRAINING_OFFERING)
    print(f"Offering {TRAINING_OFFERING} — {term['course']} · {term['label']}\n")

    lessons = LESSONS if args.lesson == "both" else (f"preflight-{args.lesson}",)
    total_written = 0
    for slug in lessons:
        rng = random.Random(f"{SEED}:{slug}")
        ao, graded, acts, rows, missing, existing, n_roster = plan_lesson(
            cur, TRAINING_OFFERING, slug, rng)

        print(f"── {slug} — {ao['title']}")
        print(f"   graded path: {graded['modality']} ({graded['slug']})")
        print(f"   other paths: " + ", ".join(
            f"{a['modality']}/{a['grading_role']}" for a in acts if a["id"] != graded["id"]))
        print(f"   roster {n_roster} · to write {len(rows)} · deliberately missing {len(missing)}"
              + (f" · already submitted, skipped {len(existing)}" if existing else ""))
        for section in sorted({m[0] for m in missing}):
            names = [m[1] for m in missing if m[0] == section]
            n_sub = sum(1 for r in rows if r["section"] == section)
            print(f"     {section}: {n_sub} submitting, {len(names)} missing — {', '.join(names)}")
        if slug == "preflight-04" and rows:
            dist = {}
            for r in rows:
                dist[r["profile"]] = dist.get(r["profile"], 0) + 1
            print("     report profiles: " + ", ".join(
                f"{k}×{v}" for k, v in sorted(dist.items(), key=lambda kv: -kv[1])))
            print("     (interactive + graded → migration 015 auto-grades each on commit)")
        else:
            print("     (written + graded → ungraded until /preflight-analyze runs)")

        if args.commit:
            write_rows(cur, ao, rows)
            total_written += len(rows)
        print()

    if not args.commit:
        conn.rollback()
        print("[dry run] nothing written — re-run with --commit.")
        return

    conn.commit()
    print(f"Committed: {total_written} submissions.")
    for slug in lessons:
        ao, _g, _a = lesson_context(cur, TRAINING_OFFERING, slug)
        cur.execute("""
            SELECT (SELECT count(*) FROM submissions
                     WHERE assignment_offering_id = %(ao)s AND status = 'committed') AS committed,
                   (SELECT count(*) FROM grades WHERE assignment_offering_id = %(ao)s) AS grades
        """, {"ao": ao["assignment_offering_id"]})
        v = cur.fetchone()
        print(f"  read-back {slug}: {v['committed']} committed submissions, {v['grades']} grade rows")


def clean(args):
    conn = db_connect()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    term = guard_training(cur, TRAINING_OFFERING)
    print(f"Offering {TRAINING_OFFERING} — {term['course']} · {term['label']}\n")

    lessons = LESSONS if args.lesson == "both" else (f"preflight-{args.lesson}",)
    aoids = []
    for slug in lessons:
        ao, _g, _a = lesson_context(cur, TRAINING_OFFERING, slug)
        aoids.append((slug, ao["assignment_offering_id"]))

    snapshot = {}
    for slug, aoid in aoids:
        cur.execute("""
            SELECT su.id, su.enrollment_id, su.status, su.committed_at,
                   sa.activity_id, sa.content, sa.report_markdown, sa.is_final
              FROM submissions su
              LEFT JOIN submission_activities sa ON sa.submission_id = su.id
             WHERE su.assignment_offering_id = %s
        """, (aoid,))
        subs = [dict(r) for r in cur.fetchall()]
        cur.execute("SELECT * FROM grades WHERE assignment_offering_id = %s", (aoid,))
        grades = [dict(r) for r in cur.fetchall()]
        cur.execute("""
            SELECT * FROM analysis_reports WHERE scope = 'assignment_offering' AND scope_id = %s
        """, (aoid,))
        reports = [dict(r) for r in cur.fetchall()]
        snapshot[slug] = {"assignment_offering_id": aoid, "submissions": subs,
                          "grades": grades, "analysis_reports": reports}
        print(f"── {slug}: {len({s['id'] for s in subs})} submissions, {len(grades)} grades, "
              f"{len(reports)} analysis_reports")

    out = Path(args.out)
    out.write_text(json.dumps(snapshot, indent=2, default=str), encoding="utf-8")
    print(f"\nSnapshot written to {out} ({out.stat().st_size:,} bytes).")

    if not args.commit:
        conn.rollback()
        print("[dry run] nothing deleted — re-run with --clean --commit.")
        return

    for slug, aoid in aoids:
        cur.execute("DELETE FROM analysis_reports WHERE scope='assignment_offering' AND scope_id=%s",
                    (aoid,))
        cur.execute("DELETE FROM grades WHERE assignment_offering_id = %s", (aoid,))
        cur.execute("DELETE FROM submissions WHERE assignment_offering_id = %s", (aoid,))
        print(f"  {slug}: deleted.")
    conn.commit()
    print("Training data for these lessons removed.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--lesson", choices=("03", "04", "both"), default="both")
    ap.add_argument("--commit", action="store_true", help="actually write (default: dry run)")
    ap.add_argument("--clean", action="store_true", help="remove the seeded work")
    ap.add_argument("--out", default="training_lessons_snapshot.json",
                    help="--clean: where the pre-delete snapshot goes")
    a = ap.parse_args()
    (clean if a.clean else seed)(a)
