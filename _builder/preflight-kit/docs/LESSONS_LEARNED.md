# Lessons Learned — the reasoning behind the rules

The specs tell you what to do. This tells you why, which is what you need when a new course
presents a case the specs did not anticipate. Each of these was paid for once already.

---

## On the design of the assignment

**Effort is the grade, and this has to be defended repeatedly.** A student who works through the
entire conversation and understands nothing earns full marks; a student who dodges and tangents
earns very little. Every stakeholder who encounters this — including the instructor, six weeks
in — will suggest grading correctness instead. The answer is that a preflight graded on
correctness is a quiz, students will optimize against it, and the diagnostic signal you actually
need dies immediately. Keep the weight low enough that nobody has an incentive to game it.

**Diagnose engagement, not knowledge.** The understanding levels, misconceptions, and narrative
summaries are diagnostic only. They tell you which concepts are landing. They must not touch the
grade, or you have rebuilt the quiz through the back door.

**The reading-reflection gate is the one hard rule.** A student who did not do the reading can
still have a pleasant ten-minute conversation with a patient tutor. The opening reflection is
what distinguishes them, so failing to answer it caps the score regardless of everything after.

---

## On the tutor

**Grounding beats fluency.** The single biggest driver of tutor quality is extraction
completeness, not prompt cleverness. The textbook is not attached at runtime — the inlined
reference is the tutor's only source, and every hole in it gets filled with something plausible
and wrong. Rasterize the pages; a text-only extract silently drops exactly the equations and
figures that matter most.

**Tiered grounding, not uniform strictness.** Strict for today's content, permissive for
prerequisites, transparent extrapolation for student-initiated tangents, out of scope for
deliberate verification. A uniformly strict tutor refuses to discuss anything interesting; a
uniformly permissive one invents.

**Never confirm wrong content to be agreeable.** This is the failure mode that destroys trust in
the whole system, and it is the default behavior of an unprompted model talking to a confident
student. Reason from first principles, answer with calibrated confidence, and say so when
uncertain.

**Praise only what is earned.** The sharpened tone in v2.0 exists because empty validation makes
the session feel like a toy. Plain acknowledgment is the default; a real professor, kind but not
fake.

**The grounding text is invisible.** Students read a different book. Citing "§5.3" to a student
who cannot find §5.3 is worse than useless — it manufactures doubt about whether they read the
right thing. State the content directly, having checked yourself silently.

---

## On pacing

**Independent per-topic budgets, no global clock.** The original global cap punished students for
a topic that ran long by rushing everything after it — exactly backwards, since the topic that
ran long is the one they needed. The budget exists to stop the *tutor* from bloviating, not to
cap the student.

**The clock counts engagement, not wall time.** It pauses when typing stops, doesn't charge
thinking time, and freezes at the report. A student who steps away is not penalized. Activity is
detected from the response-box *value*, not from focus or keypresses — focus-based detection
charges students for staring at the screen.

**Offer, don't cut.** At a topic's budget the tutor offers a choice: move on, or stay longer. A
silent cut-off feels arbitrary; silently grinding on wrecks the session length.

---

## On the pipeline

**A wrong endpoint fails silently, which is the worst way to fail.** The student does everything
right and the work evaporates. This is why endpoints are contract-frozen, copied rather than
retyped, and verified against the receiver on disk rather than assumed. Every URL rule in the
kit that looks paranoid was written after this happened or nearly happened.

**Slugs are generated, never requested.** Deterministic from lesson number and topic, and the
prefill link passes the same variable the artifact baked in — so the two literally cannot drift.
Asking the instructor for a slug invites a typo that rejects every report for that lesson.

**Over-capture now.** Deployed artifacts cannot be revised, so a field you omit from the wire
format is a field you cannot retrofit for a whole semester's students. Additive optional fields
are cheap; a schema bump is not.

**Unpin the model.** A dated snapshot strands a published artifact when it retires. Non-dated
aliases with automatic fallback, at least two live families, and a polite dead-end if all of
them go.

---

## On working with Claude to build these

**The preview gate is the entire quality system.** One compact instructor preview — reading
scope, slug, objective keys, probe topics, candidate extension problems — before any code is
written. It costs one turn and it is the only place a bad probe topic gets caught before it
reaches a thousand students. Never let a build skip it to save time.

**Verify arithmetic twice, visibly.** Both passes shown in the worked solution. A wrong answer
propagates to every student and is discovered by the sharpest one, publicly.

**Flag deviations at hand-off.** Anything the build did differently from the spec goes in the
hand-off note, not buried in the code. The instructor's mental model of what shipped has to
match what shipped.

**Don't relitigate settled decisions.** Once a design decision is made, execute. The specs
accumulate rationale precisely so the same argument doesn't get re-run every build.

**Empirical before architectural.** Spike and validate before committing to a design change. The
per-topic budget model, the value-based timer, and the rasterized extraction all came from
watching something fail, not from reasoning about it in advance.
