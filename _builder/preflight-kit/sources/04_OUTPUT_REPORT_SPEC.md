# Output Report Specification

This document specifies the structured output the cadet's AI must produce at the end of every conversation. The contents below are embedded **verbatim** in every generated lesson `.md` so the cadet's AI knows exactly what to generate.

## Purpose

The output report has three jobs:

1. Tell the instructor what this individual cadet does and does not understand before class.
2. Surface specific misconceptions and open questions the instructor can address.
3. Aggregate cleanly across the class for class-wide JiTT decisions.

---

## OUTPUT_REPORT_FORMAT (begins below)

> The block below is embedded as-is in every lesson `.md` so the cadet's AI produces a consistent format. The cadet copies the entire output and submits it to the instructor.

```markdown
# JiTT Conversation Report

## Cadet Information
- **Name / Cadet Identifier:** [cadet provides; if not given, AI prompts before producing the report]
- **Lesson:** [from LESSON_CONFIG.lesson_id]
- **Date / Time of Conversation:** [auto, in the cadet's local time]
- **Approximate Duration:** [estimate in minutes based on conversation length]

## Cadet's Reading Reflection (verbatim)

The cadet's **exact** answer to the opening question, *"What did you find interesting or difficult in the reading?"* — reproduced word-for-word as they wrote it. Do not paraphrase, summarize, polish, correct grammar, or invent content. If a re-prompt was given for a trite first answer, include both responses in the order given. If the cadet still did not provide a substantive reflection after the single re-prompt, quote exactly what they did say and append *"(Cadet did not provide a substantive reflection.)"*

> [Cadet's exact words. If re-prompted: include the first response, then on a new line *"(after re-prompt:)"*, then the second response.]

## Academic Integrity Self-Report (verbatim)

The cadet's **exact** answer to the closing question, *"Did you receive any outside help during this
conversation, or try to work around the rules of this AI interaction?"* — reproduced word-for-word,
with no judgment or editorializing. If the cadet declined to answer, record that in their own words.

> [Cadet's exact words.]

## Concept-by-Concept Assessment

For each item from `LESSON_CONFIG.probe_topics`, report:

| Concept | Assessment | Evidence |
|---------|------------|----------|
| [concept 1] | Understood / Partial / Not Demonstrated / Not Reached | [1–2 sentence quote or close paraphrase from the conversation] |
| [concept 2] | ... | ... |
| ... | ... | ... |

If a concept was not reached due to time, mark it **Not Reached** rather than guessing.

## Misconceptions Surfaced

- **Predicted misconceptions that appeared:** [list with brief evidence — quote or paraphrase from the conversation]
- **Unexpected misconceptions:** [any wrong models the AI noticed that were not in the predicted list]
- **None observed:** [state explicitly if the cadet did not exhibit significant misconceptions]

## Cadet's Open Questions

Specific things the cadet asked or expressed confusion about that were left unresolved. **High-value content for the instructor.**

- [question 1]
- [question 2]
- [if none: "Cadet did not raise unresolved questions."]

## Lateral Connections Raised

If the cadet made any unprompted connections (Tier 3 in the system prompt), note them here. These often reveal stronger cadets and are valuable signals.

- [connection raised, brief description]
- [if none: "No unprompted lateral connections raised."]

## Overall Readiness Flag

Pick one:

- **🟢 Green — Ready for class.** Solid grasp of priority concepts, no major misconceptions.
- **🟡 Yellow — Soft on specific topics.** Generally tracking but with one or more concept gaps. Specify what is soft below.
- **🔴 Red — Fundamental gaps.** Significant misconception(s) or unable to engage with the material. Specify what is missing below.

**Specifics for Yellow / Red:** [the specific gap(s) the instructor should address in class]

## Tutor's Honest Notes

A 2–4 sentence narrative summary in the AI's voice — what the conversation was actually like, what stood out, anything the structured fields above do not capture.
```

## OUTPUT_REPORT_FORMAT (ends above)

---

## Rules for the AI Producing This Report

- **No flattery, no softening.** The instructor needs accuracy. A cadet who got most of it wrong should not be reported as Yellow when they are Red.
- **The Reading Reflection field is verbatim — never paraphrased, polished, or invented.** This is the one field in the report where fabrication is most tempting and most damaging. Quote the cadet's exact words. If you did not capture an exact quote, say so explicitly rather than reconstructing one.
- **The Academic Integrity Self-Report field is verbatim too, and unjudged.** Record the cadet's exact answer. Do not praise honesty, do not scold, do not warn, and do not let the answer change your assessment of their understanding anywhere else in the report. The instructor decides what it means; your job is to carry it across accurately.
- **Quote selectively.** Direct cadet quotes (or close paraphrases) make the report concrete. Do not fabricate quotes.
- **Stay structured.** Even if the conversation was chaotic, the report follows this exact format.
- **Do not editorialize about the cadet's effort or attitude.** Stick to what they understood.
- **If a section truly has nothing to report, say so explicitly** rather than padding.
- **The cadet receives this report as the AI's final message in the conversation.** The cadet is responsible for submitting it unedited; the system prompt's anti-gaming rules and the honor code govern the integrity of the submission.

---

## Relationship to the structured `d` payload

This document specifies the **human-readable** report only — what the cadet sees and what an
instructor reads to verify a grade. It travels as `r` in the submission.

Alongside it the artifact emits a second, **machine-readable** payload (`d`) carrying the same
session as structured fields: effort, per-objective understanding, misconceptions, the reflection
judgment, honor status, and triage flags. That payload is specified in
`INTERACTION-DATA-CONTRACT.md` §5 and generated per the STRUCTURED DATA PAYLOAD section of the
preflight-factory skill — **not here**, and it is not part of the format block above.

Two consequences worth stating plainly:

1. **The payload is never part of the rendered report.** It is stripped before the report is shown
   to the cadet and before the report is compressed into `r`. Nothing in the block above should ever
   contain JSON.
2. **The two must agree.** The verbatim reflection in the report and `reading_reflection.text` in
   the payload are the same words; the readiness picture in one should not contradict the other.
   They are two views of one assessment, and an instructor comparing them is the audit path that
   makes an auto-written grade trustworthy.
