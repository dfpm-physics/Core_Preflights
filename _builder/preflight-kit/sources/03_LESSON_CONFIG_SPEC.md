# Lesson Configuration Specification

Defines the **variable, per-lesson** content embedded in each cadet-facing `.md` as the `LESSON_CONFIG` block.

The instructor sees a compact preview of this content in the workflow (probe topics + candidate extension problems). All other fields are drafted by Claude Code and embedded into the file without instructor approval, because they are inputs the cadet's AI needs to do its job — not pedagogical decisions the instructor needs to make.

The actual OpenStax textbook content is **not** in `LESSON_CONFIG`. It is attached as a separate PDF, copied from `<Course>/Lesson Text/<Topic>.pdf` (pre-split upstream); the `LESSON_CONFIG` only references its filename via the `textbook_pdf` field below.

## Required Fields

### `lesson_id`
Course code, semester, lesson number, and topic title. Calendar dates are deliberately omitted because M-day and T-day sections cover the same lesson on different days; the cadet's submission timestamp (auto-captured in the output report) handles the actual date.
Example: *Physics 215, Spring 2026, Lesson 17 — Moving Charged Particle in a Magnetic Field*

### `reading_assignment`
The volume, chapter, and section of the **reference text** the AI uses for grounding (OpenStax). This documents where the reference content lives; it is not necessarily the cadet's own assigned reading, and the AI does not cite it to the cadet.
Example: *OpenStax University Physics Vol 2, §11.2–§11.3 (Magnetic Force on Moving Charge; Motion in a Magnetic Field)*

### `textbook_pdf`
Filename of the attached PDF containing the OpenStax pages for today's reading. Always lives in the same folder as the preflight `.md`. The file is **copied** at preflight-generation time from `<Course>/Lesson Text/<Topic>.pdf` (pre-split upstream); it is not regenerated from the full OpenStax volume.
Example: *lesson_17_textbook.pdf — copied from `Physics 215/Lesson Text/Moving Charged Particle in a Magnetic Field.pdf`; OpenStax Vol 2, printed pp. 466–473.* The printed page range is for instructor/AI reference only; the cadet's AI uses the PDF as its grounding reference but does not cite sections or page numbers to the cadet.

### `probe_topics` (3–5 items, in priority order — DEFAULT 4, HARD CAP 5)
The specific things the cadet's AI will test through conversation. Phrased as **what the AI will probe**, not as instructor-facing learning objectives.

Examples (good — specific, testable in conversation):
- Whether the cadet correctly applies F = qv × B, including the right-hand rule and the sin θ dependence.
- Whether the cadet recognizes the magnetic force does no work on a moving charge, and can explain why.
- Whether the cadet can derive (or justify) the cyclotron radius r = mv/(|q|B).
- Whether the cadet identifies the special case of v parallel to B (zero force) and the case of v perpendicular to B (circular motion).

Examples (bad — vague, untestable in conversation):
- "Understands magnetic force." → too generic
- "Can do magnetism problems." → not a probe target

**Priority order matters.** If the conversation runs short, the cadet's AI probes from the top. Time budget: 7–9 min of probing ÷ 4 topics ≈ 2 min per probe. Five is the maximum that fits the window, but because the tutor asks one question at a time and waits, 4 is the comfortable default.

### `common_misconceptions` (4–6 items)
Specific wrong models the cadet's AI watches for and surfaces. Generated automatically by Claude Code based on the topic. Not shown to instructor in preview unless requested.

### `prerequisites` (free-form)
Tier 2 fair-game material from prior coursework. Generated automatically. The cadet's AI may reference these without strict citation.

### `lateral_connections` (2–4 items)
Anticipated places sharp cadets may connect this material to other physics, engineering, or real-world systems. Generated automatically. The cadet's AI engages with these confidently rather than redirecting them as out-of-scope.

### `extension_problems` (3–5 items)

**A curated list of classic problems the cadet's AI offers during the untimed post-report extension. These are NOT used during the timed portion of the conversation — the timed portion is conceptual only.**

Each item includes:
- **Statement** — clear and unambiguous.
- **Worked solution** — for tutor reference only; the cadet's AI does not reveal unless the cadet has worked the problem to a conclusion and is checking their answer. Help during the extension is by Socratic probing, not by solution.
- **Calibration note** — which concept(s) from today's reading the problem exercises and a brief difficulty read.

Claude Code drafts 3–5 candidates per lesson with variety in difficulty and conceptual focus (avoid clustering on a single sub-topic — the cadet should have meaningful choices). The instructor reviews the list and may reject any candidates that do not align with the course; non-rejected candidates are embedded in LESSON_CONFIG as the offered set. The cadet's AI may also draft additional related problems on the fly if the cadet wants more.

### `scope_note` (optional, free-form)
Anything the instructor flagged in the preview round that narrows scope (e.g., "we're not discussing helical motion"). Tells the cadet's AI what to engage with only on cadet initiative versus what to probe unprompted. Empty by default; only present when the instructor signals scope-narrowing.

## Quality Checklist (Claude Code self-checks before presenting preview)

- [ ] Probe topics are specific enough to be tested in conversation, not vague.
- [ ] Priority order reflects what matters most for class readiness.
- [ ] Topic count fits the time budget (≤ 5, default 4).
- [ ] Misconceptions are specific and observable.
- [ ] Extension problems: at least 3 candidates, each solvable in a few minutes by a prepared cadet.
- [ ] Extension problems exercise concepts from today's reading; the set spans some variety in difficulty and focus.
- [ ] Each extension problem's worked solution independently re-derived (two-pass check).
- [ ] `textbook_pdf` page range covers the assigned section(s) and ends at a clean section/page boundary (or audit-flag if it includes a few lines of an adjacent section).
