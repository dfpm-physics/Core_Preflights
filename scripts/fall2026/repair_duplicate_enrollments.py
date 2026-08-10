#!/usr/bin/env python3
"""Reconcile duplicated active enrollments against the registrar roster.

WHAT WENT WRONG
---------------
`commitRoster()` in site/js/faculty-roster.js upserts enrollments with
`onConflict: 'student_id,section_id', ignoreDuplicates: true`. That key means a cadet who
MOVES sections produces a NEW enrollment row while the old one stays `active` — the
importer only drops enrollments the operator explicitly confirmed as departures, and a
cadet who merely changed sections is still in the file, so they are never flagged.

Fall 2026 result, both courses: the 2026-07-28 roster build, then an August re-import that
correctly placed the movers and left their old rows behind. phys-215 carries 25 such pairs,
phys-110 carries 17.

WHY THE OLD ROW CANNOT SIMPLY BE DROPPED
----------------------------------------
A student page writes work through `myEnrollmentIds(ctx)[0]` (site/js/student-data.js) — an
ARBITRARY pick among a cadet's enrollments. So the submissions landed on whichever row
sorted first, which is the stale one. Dropping it without moving the work would strand the
cadet's preflight on an inactive enrollment: every faculty surface filters `status='active'`,
so the work would vanish from the gradebook and the cadet would re-appear as a non-submitter
in their real section.

THE REGISTRAR IS THE ONLY AUTHORITY HERE
-----------------------------------------
Nothing in the database distinguishes the real section from the stale one — enrolment dates
do not, and work location provably does not. This script therefore REQUIRES the registrar
CSV export (`AFA_AA_CLASS_ROSTER_BY_ACADORG_*.csv`: a `Section` column and a
`Cadet EMPLID` column) and refuses any pair it cannot resolve against it.

WHAT IT DOES, PER DUPLICATED CADET
-----------------------------------
  1. repoint the stale enrollment's `submissions` row to the registrar enrollment
  2. resolve `grades` so the registrar enrollment ends with the one grade belonging to that
     submission. The AI `no_submission` zero already sitting there is DELETED when a real
     grade must take its exact (enrollment, offering) slot, and merely UN-FINALIZED when
     nothing replaces it — un-finalized is already invisible to the cadet under
     `grades_own_finalized`, so deleting would cost the audit trail and buy nothing.
  3. set the stale enrollment `status='dropped'`

Grades move only behind a submission. Where no work changes hands, the registrar
enrollment's own grade is already authoritative and the stale row's goes inactive with it.

Order matters and mirrors commitRoster()'s own reasoning: the drop is LAST, so a failure
part-way leaves a cadet double-enrolled (visible, already the status quo) rather than
un-enrolled with their work detached (invisible, and much worse).

NEVER OVERWRITTEN: a grade whose `source` is not `ai_suggested` is human work. Any pair
needing one deleted is reported and skipped whole, for a person to settle.

Usage:
    python scripts/fall2026/repair_duplicate_enrollments.py --roster ~/Downloads/roster.csv
    python scripts/fall2026/repair_duplicate_enrollments.py --roster ... --expect 25 --commit

Stdlib only (CORE.md §2). Credentials per CORE.md §3. Dry-run by default.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict

CONFIG = pathlib.Path(os.path.expanduser("~/.claude/skills/preflight-analyze/config.json"))
SNAPSHOT_DIR = pathlib.Path(__file__).resolve().parents[2] / "_snapshots"


class Rest:
    def __init__(self, url: str, key: str) -> None:
        self.url, self.key = url, key

    def _h(self, write: bool) -> dict:
        h = {"apikey": self.key, "Authorization": f"Bearer {self.key}", "Accept-Profile": "app"}
        if write:
            h |= {"Content-Profile": "app", "Content-Type": "application/json",
                  "Prefer": "return=representation"}
        return h

    def _call(self, method: str, table: str, body=None, **params):
        q = urllib.parse.urlencode(params, safe="().,*:")
        req = urllib.request.Request(
            f"{self.url}/rest/v1/{table}?{q}",
            data=json.dumps(body).encode() if body is not None else None,
            method=method,
        )
        for k, v in self._h(method != "GET").items():
            req.add_header(k, v)
        with urllib.request.urlopen(req) as r:
            txt = r.read().decode()
            return json.loads(txt) if txt.strip() else []

    def get(self, table, **p):            return self._call("GET", table, None, **p)
    def patch(self, table, body, **p):    return self._call("PATCH", table, body, **p)
    def delete(self, table, **p):         return self._call("DELETE", table, None, **p)


def chunked(seq, n=60):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def load_registrar(path: pathlib.Path) -> dict[int, str]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        cols = {c.strip().lower(): c for c in (reader.fieldnames or [])}
        sec_col = cols.get("section")
        id_col = next((cols[c] for c in cols if "emplid" in c), None)
        if not sec_col or not id_col:
            sys.exit(f"{path.name}: need a 'Section' column and a 'Cadet EMPLID' column; "
                     f"found {reader.fieldnames}")
        out = {}
        for row in reader:
            raw = (row.get(id_col) or "").strip()
            sec = (row.get(sec_col) or "").strip()
            if raw and sec:
                out[int(raw)] = sec
    if not out:
        sys.exit(f"{path.name}: no rows parsed.")
    return out


def resolve_offering(api: Rest, course: str, term: str) -> str:
    courses = api.get("courses", select="id,code", code=f"eq.{course}")
    if not courses:
        sys.exit(f"No course {course!r}.")
    offs = api.get("course_offerings", select="id,terms!inner(code)",
                   course_id=f"eq.{courses[0]['id']}")
    match = [o for o in offs if o["terms"]["code"] == term]
    if len(match) != 1:
        sys.exit(f"Expected one {course} offering in term {term!r}, found {len(match)}. "
                 f"Terms present: {', '.join(sorted(o['terms']['code'] for o in offs))}.")
    return match[0]["id"]


def build_plan(api: Rest, offering_id: str, registrar: dict[int, str]):
    sections = api.get("sections", select="id,code", course_offering_id=f"eq.{offering_id}")
    code_of = {s["id"]: s["code"] for s in sections}
    id_of = {v: k for k, v in code_of.items()}

    enrollments = []
    for ids in chunked(list(code_of)):
        enrollments += api.get("enrollments", select="id,student_id,section_id,enrolled_at",
                               section_id=f"in.({','.join(ids)})", status="eq.active")

    by_student = defaultdict(list)
    for e in enrollments:
        by_student[e["student_id"]].append(e)

    # Report-only: a cadet with ONE enrollment that disagrees with the registrar is a
    # different defect (a mis-imported section, not a leftover), and this script does not
    # touch it — moving a lone enrollment is a re-section, which is the director's call.
    misplaced = [
        (sid, code_of[rows[0]["section_id"]], registrar[sid])
        for sid, rows in by_student.items()
        if len(rows) == 1 and sid in registrar and code_of[rows[0]["section_id"]] != registrar[sid]
    ]
    unknown = sorted(set(by_student) - set(registrar))
    dups = {k: v for k, v in by_student.items() if len(v) > 1}

    ids = [r["id"] for v in dups.values() for r in v]
    subs, grades = {}, {}
    for ch in chunked(ids):
        joined = ",".join(ch)
        for s in api.get("submissions", select="id,enrollment_id,assignment_offering_id,status",
                         enrollment_id=f"in.({joined})"):
            subs[(s["enrollment_id"], s["assignment_offering_id"])] = s
        for g in api.get("grades",
                         select="id,enrollment_id,assignment_offering_id,points_earned,"
                                "is_finalized,source,submission_id,question_scores,diagnostic,"
                                "effort,points_possible,graded_by,graded_at",
                         enrollment_id=f"in.({joined})"):
            grades[(g["enrollment_id"], g["assignment_offering_id"])] = g

    actions, blocked = [], []
    for sid, rows in sorted(dups.items()):
        want = registrar.get(sid)
        if want is None or want not in id_of:
            blocked.append({"student_id": sid, "why": f"registrar section {want!r} unknown here"})
            continue
        keep = [r for r in rows if r["section_id"] == id_of[want]]
        stale = [r for r in rows if r["section_id"] != id_of[want]]
        if len(keep) != 1:
            blocked.append({"student_id": sid,
                            "why": f"{len(keep)} enrollments match registrar section {want}"})
            continue
        keep_e, act = keep[0], {"student_id": sid, "keep_section": want,
                                "keep_enrollment_id": keep[0]["id"], "stale": []}
        human_block = None
        for st in stale:
            offerings = {k[1] for k in list(subs) + list(grades) if k[0] == st["id"]}
            moves = {"enrollment_id": st["id"], "section": code_of[st["section_id"]],
                     "repoint_submissions": [], "repoint_grades": [],
                     "delete_grades": [], "unfinalize_grades": []}
            for off in sorted(offerings):
                s_sub, k_sub = subs.get((st["id"], off)), subs.get((keep_e["id"], off))
                s_gr, k_gr = grades.get((st["id"], off)), grades.get((keep_e["id"], off))
                if s_sub and k_sub:
                    human_block = (f"both enrollments hold a submission for offering "
                                   f"{off[:8]} — merge by hand")
                    break

                # GRADES MOVE ONLY BEHIND A SUBMISSION. With no work changing hands the
                # registrar enrollment's own grade is already the authoritative one, and the
                # stale row's grade goes inactive with the drop — repointing a zero over an
                # identical zero would destroy a finalized row to change nothing.
                if not s_sub:
                    continue

                moves["repoint_submissions"].append(s_sub["id"])

                if k_gr and k_gr["source"] != "ai_suggested" and s_gr:
                    human_block = (f"offering {off[:8]}: work moves in, but the registrar "
                                   f"enrollment already carries a {k_gr['source']!r} grade "
                                   f"and the stale row has one too")
                    break

                if k_gr and k_gr["source"] == "ai_suggested":
                    # Written while this enrollment had no submission — `no_submission` in its
                    # diagnostic. One is about to arrive, so the row is false either way. How
                    # it is retired depends on whether anything must take its place:
                    #
                    #   * a real grade is being repointed onto this (enrollment, offering) —
                    #     `grades_unique` allows only one, so the false row must GO.
                    #   * nothing replaces it — then UN-FINALIZE rather than delete. Under
                    #     `grades_own_finalized` an un-finalized row never reaches the cadet,
                    #     so the false zero stops being visible either way, and the row
                    #     survives for the instructor and for /preflight-analyze to update in
                    #     place. Deleting would buy nothing and cost the audit trail.
                    if s_gr:
                        moves["delete_grades"].append({
                            "id": k_gr["id"], "why": "superseded by the repointed grade",
                            "points_earned": k_gr["points_earned"], "_pre": k_gr})
                    elif k_gr["is_finalized"]:
                        moves["unfinalize_grades"].append({
                            "id": k_gr["id"],
                            "why": "asserts no_submission, but the work is moving here",
                            "points_earned": k_gr["points_earned"],
                            "leaves_ungraded": True, "_pre": k_gr})
                if s_gr:
                    moves["repoint_grades"].append({"id": s_gr["id"], "_pre": s_gr})
            if human_block:
                break
            act["stale"].append(moves)
        if human_block:
            blocked.append({"student_id": sid, "why": human_block})
        else:
            actions.append(act)
    return actions, blocked, misplaced, unknown, code_of


def snapshot(actions, label):
    SNAPSHOT_DIR.mkdir(exist_ok=True)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = SNAPSHOT_DIR / f"enrollment-repair-{label}-{stamp}.json"
    path.write_text(json.dumps({
        "taken_at": stamp,
        "purpose": "pre-image before repointing work and dropping stale enrollments",
        "restore": "re-PATCH each submission/grade enrollment_id back, re-activate the "
                   "enrollment, and re-INSERT any deleted grade row verbatim",
        "actions": actions,
    }, indent=2, default=str))
    return path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--roster", required=True, type=pathlib.Path)
    ap.add_argument("--course", default="phys-215")
    ap.add_argument("--term", default="fall-2026")
    ap.add_argument("--expect", type=int, default=None,
                    help="required number of cadets to repair; refuses on a mismatch")
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()

    if not CONFIG.exists():
        sys.exit(f"Config not found at {CONFIG} — see CORE.md §3.")
    cfg = json.loads(CONFIG.read_text())
    api = Rest(cfg["supabase_url"].rstrip("/"), cfg["supabase_service_key"])

    registrar = load_registrar(args.roster)
    offering_id = resolve_offering(api, args.course, args.term)
    print(f"Course   : {args.course} ({args.term})")
    print(f"Registrar: {args.roster.name} — {len(registrar)} cadets, "
          f"{len(set(registrar.values()))} sections\n")

    actions, blocked, misplaced, unknown, code_of = build_plan(api, offering_id, registrar)

    n_sub = sum(len(m["repoint_submissions"]) for a in actions for m in a["stale"])
    n_grp = sum(len(m["repoint_grades"]) for a in actions for m in a["stale"])
    n_del = sum(len(m["delete_grades"]) for a in actions for m in a["stale"])
    n_unf = sum(len(m["unfinalize_grades"]) for a in actions for m in a["stale"])
    n_drop = sum(len(a["stale"]) for a in actions)

    print(f"REPAIRABLE ({len(actions)} cadets):")
    for a in actions:
        for m in a["stale"]:
            bits = []
            if m["repoint_submissions"]: bits.append(f"{len(m['repoint_submissions'])} submission")
            if m["repoint_grades"]:      bits.append(f"{len(m['repoint_grades'])} grade")
            if m["delete_grades"]:       bits.append(f"delete {len(m['delete_grades'])} AI zero")
            if m["unfinalize_grades"]:   bits.append(f"un-finalize {len(m['unfinalize_grades'])} AI zero")
            print(f"  {a['student_id']}  {m['section']} -> {a['keep_section']}"
                  f"   {'; '.join(bits) if bits else 'no work to move'}")
    if not actions:
        print("  none")

    # Anyone whose only grade was a deleted AI zero ends the run with work and no grade.
    # That is the honest state — nothing has assessed the submission on this enrollment —
    # but it is a re-grade owed, so it is named rather than left to be discovered.
    regrade = sorted({a["student_id"] for a in actions for m in a["stale"]
                      for d in m["delete_grades"] + m["unfinalize_grades"]
                      if d.get("leaves_ungraded")})
    if regrade:
        print(f"\nOWED A RE-GRADE ({len(regrade)}) — work moved in, the false zero was removed,\n"
              f"and no grade replaced it. Re-run /preflight-analyze for this lesson afterwards:")
        print("  " + ", ".join(str(s) for s in regrade))

    print(f"\nBLOCKED ({len(blocked)}) — left alone for a human:")
    for b in blocked:
        print(f"  {b['student_id']}: {b['why']}")
    if not blocked:
        print("  none")

    if misplaced:
        print(f"\nNOTE — {len(misplaced)} cadets hold a SINGLE enrollment that disagrees with "
              f"the registrar. Not touched (a re-section is your call):")
        for sid, have, want in misplaced:
            print(f"  {sid}: in {have}, registrar says {want}")
    if unknown:
        print(f"\nNOTE — {len(unknown)} active cadets are absent from the registrar file: {unknown}")

    print(f"\nTOTALS: repoint {n_sub} submissions, repoint {n_grp} grades, "
          f"delete {n_del} AI zeros, un-finalize {n_unf} AI zeros, "
          f"drop {n_drop} enrollments.")

    if args.expect is not None and len(actions) != args.expect:
        print(f"\nREFUSING: --expect {args.expect} but planned {len(actions)}.")
        return 2
    if not args.commit:
        print(f"\nDRY RUN — nothing written. Re-run with --expect {len(actions)} --commit.")
        return 0
    if not actions:
        print("\nNothing to do.")
        return 0

    snap = snapshot(actions, f"{args.course}-{args.term}")
    if len(json.loads(snap.read_text())["actions"]) != len(actions):
        print("REFUSING: snapshot did not round-trip.")
        return 2
    print(f"\nSnapshot verified: {len(actions)} cadets -> {snap}\n")

    now = dt.datetime.now(dt.timezone.utc).isoformat()
    done = defaultdict(int)
    for a in actions:
        for m in a["stale"]:
            # 1 — free the unique key before anything claims it.
            for d in m["delete_grades"]:
                api.delete("grades", id=f"eq.{d['id']}", source="eq.ai_suggested")
                done["grades_deleted"] += 1
            for u in m["unfinalize_grades"]:
                api.patch("grades", {"is_finalized": False},
                          id=f"eq.{u['id']}", source="eq.ai_suggested")
                done["grades_unfinalized"] += 1
            # 2 — move the work onto the registrar's enrollment.
            for sid_ in m["repoint_submissions"]:
                api.patch("submissions", {"enrollment_id": a["keep_enrollment_id"]},
                          id=f"eq.{sid_}", enrollment_id=f"eq.{m['enrollment_id']}")
                done["submissions_repointed"] += 1
            for g in m["repoint_grades"]:
                api.patch("grades", {"enrollment_id": a["keep_enrollment_id"]},
                          id=f"eq.{g['id']}", enrollment_id=f"eq.{m['enrollment_id']}")
                done["grades_repointed"] += 1
            # 3 — drop LAST, so a failure above leaves the cadet double-enrolled, not detached.
            api.patch("enrollments", {"status": "dropped", "dropped_at": now},
                      id=f"eq.{m['enrollment_id']}", status="eq.active")
            done["enrollments_dropped"] += 1
        print(f"  repaired {a['student_id']} -> {a['keep_section']}")

    print(f"\nWROTE: {dict(done)}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode()[:600]}")
