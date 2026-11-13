"""Strict validation of what a model returns. Nothing partial is ever written.

Per student, `validate_grade_output` returns (clean, violations). A non-empty `violations` list
means the output is refused; the caller may re-ask ONCE, quoting the violations (never the
student's text), and a second failure leaves that student without a row.

Student text is untrusted data. This module is the second half of that rule: whatever the model was
talked into, only a well-formed object of known keys, ranges and states gets through.
"""
import json
import re

STATES = ("full", "warn", "zero")
MAX_WARN_FEEDBACK = 600
MAX_ZERO_FEEDBACK = 600
KEBAB = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

# Never name or cite the grounding text to a student (preflight-analyze SKILL.md, feedback rules).
_CITE = [re.compile(p, re.I) for p in (
    r"open\s?stax",
    r"\b(?:chapter|section|page|figure|fig\.|table|example|equation|eq\.)\s+\d+(?:\.\d+)?[a-z]?\b",
    r"\bthe\s+(?:reading|text|textbook|book)\b",
)]
# A feedback string that talks to the grader or repeats the prompt is the mark of an injection.
_INJECTION = re.compile(r"system prompt|ignore (?:all |the )?(?:previous|above|prior)|untrusted|"
                        r"language model|as an ai\b|grading rules|these rules|json object", re.I)


def norm(s):
    return re.sub(r"\s+", " ", str(s or "")).strip().lower()


def strip_fence(text):
    """Tolerate exactly one surrounding code fence."""
    t = (text or "").strip()
    m = re.fullmatch(r"```[a-zA-Z]*\s*\n(.*?)\n?```", t, re.S)
    return m.group(1).strip() if m else t


def _is_int(v, lo, hi):
    return isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi


def _sentences(text):
    return len([s for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s])


MAX_LABEL, MAX_DESC = 80, 300
_URL = re.compile(r"https?://|www\.|\]\(|!\[|<\s*(?:a|img|script)", re.I)


def has_injection(text):
    return bool(_INJECTION.search(text or ""))


def lint_feedback(fb, answers_norm, aggregate=False):
    """Violations for one outward-facing string. `aggregate` skips the "the reading" pattern, which
    instructor prose legitimately uses for the reading-time figure."""
    bad = []
    if _URL.search(fb):
        bad.append("text carries a link or markup")
    for rx in (_CITE[:2] if aggregate else _CITE):
        for m in rx.finditer(fb):
            if norm(m.group(0)) not in answers_norm:      # echoing the student's own citation is allowed
                bad.append("feedback cites or names the grounding text")
                break
    if _INJECTION.search(fb):
        bad.append("feedback repeats or addresses the grader's instructions")
    return bad


def validate_grade_output(text, finish_reason, *, grade_qids, need_q2, need_q3, need_minutes,
                          need_reflection, answers):
    """Return (clean | None, violations, counts).

    grade_qids  the question ids the model was asked to judge (exactly these must come back)
    need_*      which optional keys are required for this lesson and this student
    answers     {qid: student text}; used only for fidelity checks (never sent back out)
    counts      {"dropped_keys": n} bookkeeping for the run detail
    """
    v, counts = [], {"dropped_keys": 0}
    if finish_reason != "stop":
        return None, [f"the reply did not finish cleanly (finish_reason={finish_reason or 'empty'})"], counts
    body = strip_fence(text)
    if not body:
        return None, ["the reply was empty"], counts
    try:
        obj = json.loads(body)
    except ValueError:
        return None, ["the reply was not a single JSON object"], counts
    if not isinstance(obj, dict):
        return None, ["the reply was not a JSON object"], counts

    known = {"v", "questions", "q1_reading_minutes", "q2_effort", "q3_understanding", "assessment"}
    counts["dropped_keys"] += len(set(obj) - known)
    if obj.get("v") != 1:
        v.append('"v" must be 1')
    answers_norm = " ".join(norm(a) for a in answers.values())

    qs = obj.get("questions")
    clean_q = {}
    if not isinstance(qs, dict):
        v.append('"questions" must be an object')
    else:
        if set(qs) != set(grade_qids):
            v.append(f"questions must be exactly {sorted(grade_qids)}; got {sorted(map(str, qs))}")
        for qid in grade_qids:
            c = qs.get(qid)
            if not isinstance(c, dict):
                continue
            st, fb = c.get("status"), c.get("feedback")
            if st not in STATES:
                v.append(f"{qid}: status must be full, warn or zero")
                continue
            if not isinstance(fb, str):
                v.append(f"{qid}: feedback must be a string")
                continue
            fb = fb.strip()
            if st == "full" and fb:
                v.append(f"{qid}: a full-credit answer must have empty feedback")
            if st == "zero" and not fb:
                v.append(f"{qid}: a zero needs feedback")
            if st in ("warn", "zero"):
                n = _sentences(fb)
                if len(fb) > MAX_WARN_FEEDBACK or (st == "warn" and not 1 <= n <= 4):
                    v.append(f"{qid}: feedback must be at most {MAX_WARN_FEEDBACK} characters and a few sentences")
                v += [f"{qid}: {x}" for x in lint_feedback(fb, answers_norm)]
            clean_q[qid] = {"status": st, "feedback": fb}

    minutes = obj.get("q1_reading_minutes")
    if need_minutes:
        if minutes is not None and not _is_int(minutes, 1, 100000):
            v.append("q1_reading_minutes must be a whole number of minutes (at least 1) or null")
    else:
        minutes = None
    q2 = obj.get("q2_effort")
    q3 = obj.get("q3_understanding")
    if need_q2 and not _is_int(q2, 0, 5):
        v.append("q2_effort must be an integer 0 to 5")
    if need_q3 and not _is_int(q3, 0, 5):
        v.append("q3_understanding must be an integer 0 to 5")

    a = obj.get("assessment")
    clean_a = None
    if not isinstance(a, dict):
        v.append('"assessment" must be an object')
    else:
        counts["dropped_keys"] += len(set(a) - {"effort", "overall_understanding", "objectives",
                                                "misconceptions", "reading_reflection", "notable"})
        if not _is_int(a.get("effort"), 0, 5):
            v.append("assessment.effort must be an integer 0 to 5")
        if not _is_int(a.get("overall_understanding"), 0, 5):
            v.append("assessment.overall_understanding must be an integer 0 to 5")
        if not isinstance(a.get("notable"), bool):
            v.append("assessment.notable must be a boolean")
        rr = a.get("reading_reflection")
        if need_reflection or rr is not None:
            if not (isinstance(rr, dict) and isinstance(rr.get("meaningful"), bool) and _is_int(rr.get("engagement"), 0, 5)):
                v.append("assessment.reading_reflection must be {meaningful: bool, engagement: 0 to 5}")
        mis, seen = [], set()
        raw_m = a.get("misconceptions")
        if not isinstance(raw_m, list):
            v.append("assessment.misconceptions must be a list")
            raw_m = []
        for m in raw_m:
            if not isinstance(m, dict):
                v.append("each misconception must be an object")
                continue
            mid = m.get("id")
            if not (isinstance(mid, str) and KEBAB.match(mid)):
                v.append("a misconception id must be lowercase kebab-case")
                continue
            if mid in seen:
                v.append(f"misconception {mid} appears twice")
            seen.add(mid)
            if not all(isinstance(m.get(k), str) and m.get(k).strip() for k in ("label", "description")):
                v.append(f"misconception {mid} needs a label and a description")
                continue
            if len(m["label"]) > MAX_LABEL or len(m["description"]) > MAX_DESC:
                v.append(f"misconception {mid}: label at most {MAX_LABEL} and description at most {MAX_DESC} characters")
                continue
            if has_injection(m["label"]) or has_injection(m["description"]) or _URL.search(m["label"] + m["description"]):
                v.append(f"misconception {mid}: label or description addresses the grader or carries a link")
                continue
            sev = m.get("severity")
            if sev is not None and sev not in ("major", "minor"):
                v.append(f"misconception {mid}: severity must be major or minor")
            ev = m.get("evidence")
            if ev is not None:
                if not isinstance(ev, str) or norm(ev).strip("\"'“”‘’ ") not in answers_norm:
                    v.append(f"misconception {mid}: evidence must be a quotation from the student's own answers")
            entry = {"id": mid, "label": m["label"].strip(), "description": m["description"].strip()}
            if sev:
                entry["severity"] = sev
            if ev:
                entry["evidence"] = ev.strip()
            mis.append(entry)
        clean_a = {"effort": a.get("effort"), "overall_understanding": a.get("overall_understanding"),
                   "notable": a.get("notable"), "reading_reflection": rr if isinstance(rr, dict) else None,
                   "misconceptions": mis}
    if v:
        return None, v, counts
    return {"questions": clean_q, "q1_reading_minutes": minutes, "q2_effort": q2 if need_q2 else None,
            "q3_understanding": q3 if need_q3 else None, "assessment": clean_a}, [], counts


# ── aggregation scopes ────────────────────────────────────────────────────────────────────
MAX_SUMMARY, MAX_RECO, MAX_NOTE, MAX_NOTES, MAX_QUOTES = 1200, 1200, 400, 12, 3
_TELLS = re.compile(r"^(?:overall,|in summary,|notably,|it'?s worth noting)", re.I)


def _prose_problems(label, s, cap, single_paragraph=False):
    if not isinstance(s, str) or not s.strip():
        return [f"{label} must be a non-empty string"]
    out = []
    if len(s) > cap:
        out.append(f"{label} is over {cap} characters")
    if single_paragraph and "\n\n" in s.strip():
        out.append(f"{label} must be a single paragraph")
    if _TELLS.search(s.strip()):
        out.append(f"{label} opens with a banned phrase")
    out += [f"{label}: {x}" for x in lint_feedback(s, "", aggregate=True)]
    return out


def number_warnings(prose, numbers):
    """Warn-only: a figure in the prose that appears nowhere in the scope's numbers."""
    blob = json.dumps(numbers, default=str)
    return [n for n in re.findall(r"\d+(?:\.\d+)?", prose or "") if n not in blob and len(n) > 1]


def validate_section_scope(obj, section_id, reports):
    """reports: the section's reports[] from the pull. Quotes must belong to it and be meaningful."""
    if not isinstance(obj, dict):
        return ["the reply is not an object"]
    v = _prose_problems("misconception_recommendation", obj.get("misconception_recommendation"), MAX_RECO, True)
    q = obj.get("selected_quotes")
    if not isinstance(q, list) or len(q) > MAX_QUOTES:
        return v + [f"selected_quotes must be a list of at most {MAX_QUOTES}"]
    ok = {r["student_id"]: r for r in reports}
    seen = set()
    for item in q:
        sid = item.get("student_id") if isinstance(item, dict) else None
        if sid not in ok or str(item.get("section_id")) != str(section_id):
            v.append("a quote names a student who is not a report in this section")
        elif (ok[sid].get("reflection") or {}).get("meaningful") is False:
            v.append("a quote names a student whose reflection was not meaningful")
        if sid in seen:
            v.append("a student is quoted twice")
        seen.add(sid)
    return v


def validate_instr_scope(obj, section_ids):
    if not isinstance(obj, dict):
        return ["the reply is not an object"]
    v = _prose_problems("readiness_summary", obj.get("readiness_summary"), MAX_SUMMARY)
    notes = obj.get("section_notes", [])
    if not isinstance(notes, list) or len(notes) > MAX_NOTES:
        return v + [f"section_notes must be a list of at most {MAX_NOTES}"]
    for n in notes:
        if not isinstance(n, dict) or str(n.get("section_id")) not in set(map(str, section_ids)):
            v.append("a section note names a section this instructor does not teach here")
        else:
            v += _prose_problems("section note", n.get("note"), MAX_NOTE)
    return v


def validate_all_scope(obj):
    if not isinstance(obj, dict):
        return ["the reply is not an object"]
    v = _prose_problems("readiness_summary", obj.get("readiness_summary"), MAX_SUMMARY)
    v += _prose_problems("misconception_recommendation", obj.get("misconception_recommendation"), MAX_RECO, True)
    if obj.get("selected_quotes"):
        v.append("the whole-course scope carries no quotes")
    return v


def validate_aliases(obj, known_ids):
    """{aliases: {variant: canonical}} where every key and value is a misconception id in use."""
    if not isinstance(obj, dict) or not isinstance(obj.get("misconception_aliases", {}), dict):
        return ["misconception_aliases must be an object"]
    v = []
    for k, val in obj.get("misconception_aliases", {}).items():
        if k not in known_ids or not isinstance(val, str) or not KEBAB.match(val):
            v.append("an alias names an id that is not in this lesson's misconceptions")
    return v
