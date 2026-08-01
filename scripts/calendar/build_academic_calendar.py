#!/usr/bin/env python3
"""Turn the USAFA Academic Calendar (.ics) into a static JSON the site can read.

WHY THIS EXISTS
    Which calendar dates are M-days and which are T-days is the one fact the PREP data model
    does not hold and cannot derive. `assignment_offerings.due_by_day` says "the M deadline is
    this timestamp"; `sections.meeting_days` says "this section meets on M". Neither says WHICH
    DAY IS AN M-DAY, because at USAFA that is a property of the academic calendar, not of the
    course.

    It is also not derivable. The obvious guess — weekdays alternating M, T, M, T, skipping
    holidays — is wrong. In the real Fall 2026 sequence the gap between a lesson's M-day and its
    T-day is 1 day 32 times, 2 days once, 3 days six times and 4 days twice; the weekday spread
    is uneven (18 Tuesdays, 15 Fridays); and Fall 2025 simply has no M7 at all, because that day
    was cancelled ("M7 Canceled - USAFA Down Day"). Any rule you write to reproduce that is a
    rule you have to maintain against a calendar somebody else publishes.

    So: read the published calendar, and keep the answer in the repo.

WHAT IT PRODUCES
    site/data/academic-calendar.json — one entry per term, each carrying the ordered list of
    teaching days (date, track, lesson number, and whether that day runs a modified schedule)
    plus the non-teaching events that fall inside the term. See the file's own `_readme`.

    It lands under site/ because a static JSON beside the pages is the only way a no-build-step
    frontend can read it: the source is an Outlook publish URL on another origin, so a browser
    fetching it directly would be refused by CORS, and the shipped site has no server to proxy
    through. Regenerating is this script's job, not the page's.

WHAT THE SOURCE LOOKS LIKE
    Every event is all-day. A teaching day is an event whose SUMMARY is exactly `M<n>` or
    `T<n>` — the track AND the lesson number, which is why this file can say "lesson 14 meets
    for T-day sections on 2026-09-24" rather than having to count.

    "SSoC" in local speech appears in the calendar as `Modified SOC - …`, most often
    "Afternoon Sections Start 1 Hour Early". The variants matter and are kept verbatim: Fall
    2026 also carries "Modified SOC - Lt Gen Moga Change of Command", and Spring has one where
    only P5 and P6 move, by 90 minutes. A modified SOC changes when class MEETS; it does not
    move a preflight deadline, which is set the evening before.

USE
    python scripts/calendar/build_academic_calendar.py              # dry run — prints the diff
    python scripts/calendar/build_academic_calendar.py --commit     # writes the JSON
    python scripts/calendar/build_academic_calendar.py --ics local.ics --commit

    Read-only and idempotent by default, in the spirit of CORE.md section 4: it prints what
    would change and writes nothing without --commit. It touches no database.
"""

import argparse
import json
import re
import sys
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ICS_URL = (
    "https://outlook.office365.com/owa/calendar/"
    "d8fbe643dd404faa85cfa326d86d43b6@afacademy.af.edu/"
    "785d8eab2f1c490da906c78b2c0946374871920484251035494/calendar.ics"
)

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "site" / "data" / "academic-calendar.json"

# A teaching day: SUMMARY is exactly the track letter and the lesson number.
DAY_RE = re.compile(r"^([MT])(\d+)$")
# A cancelled one still names itself, e.g. "M7 Canceled - USAFA Down Day" (Fall 2025).
CANCELLED_RE = re.compile(r"^([MT])(\d+)\s+cancel+ed\b(.*)$", re.I)

# A gap larger than this between consecutive teaching days means a new term, not a break.
# The longest real in-term gap is Thanksgiving (Fall 2026: 2026-11-24 -> 2026-12-01, 7 days);
# the shortest between-term gap is a month. 21 sits between them with room either side.
TERM_GAP_DAYS = 21


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "PREP-calendar-build/1.0"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read().decode("utf-8", errors="replace")


def unfold(raw):
    """RFC 5545 line unfolding — a continuation line begins with a space or tab."""
    return raw.replace("\r\n", "\n").replace("\n ", "").replace("\n\t", "").split("\n")


def unescape(v):
    """RFC 5545 TEXT escaping, the parts that appear here."""
    return (v.replace("\\n", "\n").replace("\\,", ",")
             .replace("\\;", ";").replace("\\\\", "\\"))


def parse_events(raw):
    """[{summary, start: date, end: date (exclusive)}] for every VEVENT."""
    events, cur = [], None
    for ln in unfold(raw):
        if ln == "BEGIN:VEVENT":
            cur = {}
        elif ln == "END:VEVENT":
            if cur and "SUMMARY" in cur and "DTSTART" in cur:
                start = _date(cur["DTSTART"])
                end = _date(cur["DTEND"]) if "DTEND" in cur else start + timedelta(days=1)
                events.append({"summary": unescape(cur["SUMMARY"]).strip(),
                               "start": start, "end": end})
            cur = None
        elif cur is not None and ":" in ln:
            name, val = ln.split(":", 1)
            k = name.split(";")[0].upper()
            if k in ("SUMMARY", "DTSTART", "DTEND"):
                cur[k] = val
    return events


def _date(v):
    v = v[:8]
    return date(int(v[0:4]), int(v[4:6]), int(v[6:8]))


def classify(summary):
    """A coarse kind for a non-teaching event, so the view can choose what to draw.

    Deliberately coarse, and everything unmatched keeps `other` rather than being dropped:
    this file is meant to be a faithful record of the source, and deciding what is worth
    drawing is the calendar view's job, not the extractor's. `other` is where the training
    series live (BCT-*, A1/A2/A3-*, Silver Training Weekend) — real events, but not ones a
    course calendar has any business rendering.
    """
    s = summary.lower()
    if "modified soc" in s:                                   return "soc"
    if "no classes" in s:                                     return "no-class"
    if "break" in s:                                          return "break"
    if s.startswith("finals") or s == "finals":               return "finals"
    if "study day" in s:                                      return "study-day"
    if "grades due" in s:                                     return "grades-due"
    if "graduation" in s or "grad week" in s:                 return "graduation"
    if "training day" in s:                                   return "no-class"
    return "other"


def segment_terms(days):
    """Split the ordered teaching days into terms on a long gap."""
    terms, cur = [], [days[0]]
    for prev, nxt in zip(days, days[1:]):
        if (nxt["date"] - prev["date"]).days > TERM_GAP_DAYS:
            terms.append(cur)
            cur = []
        cur.append(nxt)
    terms.append(cur)
    return terms


def term_identity(first_day):
    """`fall-2026` / `spring-2027` from the term's first teaching day.

    Matches the `terms.code` convention already in `app` (CORE.md's data model), so a term in
    this file can be joined to the one in the database by code rather than by date arithmetic.
    """
    season = "fall" if first_day.month >= 6 else "spring"
    return f"{season}-{first_day.year}", f"{season.capitalize()} {first_day.year}"


def build(events):
    teaching, cancelled, others = [], [], []
    for e in events:
        m = DAY_RE.match(e["summary"])
        if m:
            teaching.append({"date": e["start"], "track": m.group(1), "n": int(m.group(2))})
            continue
        c = CANCELLED_RE.match(e["summary"])
        if c:
            # Recorded, never scheduled: the day does not happen, and the lesson number it
            # would have carried is simply absent from the sequence. Fall 2025's M7 is the
            # live example, and it is the single clearest proof the sequence is not a formula.
            cancelled.append({"date": e["start"], "track": c.group(1), "n": int(c.group(2)),
                              "summary": e["summary"]})
            continue
        others.append(e)

    if not teaching:
        sys.exit("No M<n>/T<n> events found — the calendar's naming has changed.")
    teaching.sort(key=lambda d: d["date"])

    terms = []
    for group in segment_terms(teaching):
        starts, ends = group[0]["date"], group[-1]["date"]
        code, label = term_identity(starts)

        # Non-teaching events that touch this term. `end` is exclusive in ICS.
        notes = []
        for e in others:
            if e["end"] <= starts or e["start"] > ends + timedelta(days=21):
                continue          # the tail admits finals/grades-due, which follow the last class
            notes.append({
                "date": e["start"].isoformat(),
                "through": (e["end"] - timedelta(days=1)).isoformat()
                           if (e["end"] - e["start"]).days > 1 else None,
                "kind": classify(e["summary"]),
                "label": e["summary"],
            })
        notes.sort(key=lambda n: (n["date"], n["label"]))

        # A modified SOC lands ON a teaching day; carry it there rather than only as a note,
        # so a consumer never has to cross-reference two lists to render one cell.
        soc_by_date = {n["date"]: n["label"] for n in notes if n["kind"] == "soc"}
        days = [{
            "date": d["date"].isoformat(),
            "track": d["track"],
            "n": d["n"],
            "soc": soc_by_date.get(d["date"].isoformat()),
        } for d in group]

        by_track = {}
        for d in group:
            by_track.setdefault(d["track"], []).append(d["n"])
        lesson_slots = sorted({d["n"] for d in group})

        terms.append({
            "code": code,
            "label": label,
            "starts_on": starts.isoformat(),
            "ends_on": ends.isoformat(),
            "lesson_slots": len(lesson_slots),
            "days": days,
            "cancelled": [{**c, "date": c["date"].isoformat()} for c in cancelled
                          if starts <= c["date"] <= ends],
            "notes": notes,
        })

    return {
        "_readme": (
            "Generated by scripts/calendar/build_academic_calendar.py from the USAFA Academic "
            "Calendar publish feed. DO NOT HAND-EDIT — re-run the script. `days` is the ordered "
            "list of teaching days: `track` is M or T, `n` is the lesson number that meets that "
            "day for that track, and `soc` is the verbatim summary when that day runs a modified "
            "schedule of calls (afternoon sections start early) or null. A date absent from "
            "`days` is not a teaching day. `notes` carries the term's non-teaching events with a "
            "coarse `kind`; `other` is training series a course calendar should not draw."
        ),
        "source": {"url": ICS_URL, "events_parsed": len(events)},
        "terms": terms,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--commit", action="store_true", help="write the JSON (default: dry run)")
    ap.add_argument("--ics", help="read a local .ics instead of fetching")
    ap.add_argument("--url", default=ICS_URL)
    args = ap.parse_args()

    raw = Path(args.ics).read_text(encoding="utf-8") if args.ics else fetch(args.url)
    events = parse_events(raw)
    doc = build(events)

    print(f"parsed {len(events)} events -> {len(doc['terms'])} terms")
    for t in doc["terms"]:
        socs = sum(1 for d in t["days"] if d["soc"])
        print(f"  {t['code']:<12} {t['starts_on']} .. {t['ends_on']}  "
              f"{len(t['days']):>3} teaching days, {t['lesson_slots']} lesson slots, "
              f"{socs} modified-SOC, {len(t['cancelled'])} cancelled, {len(t['notes'])} notes")

    new = json.dumps(doc, indent=2) + "\n"
    old = OUT.read_text(encoding="utf-8") if OUT.exists() else None
    if old == new:
        print(f"\n{OUT.relative_to(REPO)} is already current — nothing to do.")
        return
    verb = "would change" if old else "would create"
    print(f"\n{OUT.relative_to(REPO)} {verb} ({len(new):,} bytes)")
    if not args.commit:
        print("dry run — pass --commit to write")
        return
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(new, encoding="utf-8")
    print("written")


if __name__ == "__main__":
    main()
