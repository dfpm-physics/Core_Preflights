# Tutor behaviour parity — what each build carries, and what the builder must still adopt

*Written 2026-08-21, after nine changes landed on the Gemini builds in one day and none of them
reached the artifact builder.*

**One lesson now exists as three different programs.** They share a prompt, a slug, a report format
and a submit contract, and they have drifted apart everywhere else. This file is the single table of
what each one carries, so that the next person to change a tutor behaviour can see — before they
write it — which of the three they are changing and which of the others should have it too.

It exists because that judgment is currently unrecoverable. Every fact below is spread across
eighteen `CHANGELOG.md` entries, two tool headers, and the `gemini-port` skill. An agent asked to
"update the artifact builder" cannot reconstruct from those which fixes were transport-specific and
which were universal, and the cost of guessing wrong runs in one direction: a fix that *looks*
applied because it exists somewhere.

> **Scope.** Behaviour of the running tutor — models, failure handling, pacing, the finish screen,
> session persistence. Not content, not grounding, not grading. Where this file and
> [`CORE.md`](../../.ai/instructions/CORE.md) disagree, CORE.md wins.

---

## 1. The three surfaces

| # | Surface | What it is | Where it lives | Who changes it |
|---|---|---|---|---|
| **A** | **The kit** | The build system a Claude Project reads to emit a **new** artifact. Hash-locked | `_builder/preflight-kit/skill/preflight-factory-v2/SKILL.md` (+ 6 more in `MANIFEST.sha256`) | a human, deliberately, then re-hashes the manifest |
| **B** | **The 51 published sources** | Artifacts already built and published on claude.ai. Cached at `_builder/courses/<course>/artifacts/*.jsx`, stored in the private `artifact-sources` bucket | claude.ai serves what was **published**; the cache is what tools read | `scripts/artifacts/patch_artifacts.py`, then a human **republishes** each one |
| **C** | **The 44 Gemini builds** | The same lessons as pages on our own site, talking to Google's API with the cadet's key. **The default path since 2026-08-21** | `site/gemini/<course>/<slug>.html` | `scripts/artifacts/to_gemini.py`, regenerated — never hand-edited |

**A produces B produces C.** That is the whole reason parity matters: a behaviour absent from **A**
is absent from every artifact built from tomorrow on, and no amount of patching **B** or **C** puts
it back. `patch_artifacts.py` is a retrofit, not a source of truth.

**A fourth surface is the sandbox**, `tests/browser/test-gemini-new-ladder.html` — a **C** build
emitted under a different policy flag. It is not a separate program and must never become one;
see §4.

### The cost asymmetry, which is why this file is a table and not prose

Fixing **C** is free and reversible: regenerate, commit, push. Fixing **B** costs a human
republishing artifacts by hand on claude.ai, one at a time, and updating each lesson's
`activities.artifact_url`. Fixing **A** costs a manifest re-hash and affects only future builds.

So the pressure is always to fix **C** and move on, which is exactly what happened nine times on
2026-08-21 and is not wrong — it is where cadets are. The failure mode is silent: the fix is real,
it works, cadets benefit, and **A** quietly keeps producing artifacts without it.

---

## 2. The parity table

Everything that changed between 2026-08-19 and 2026-08-21. **Verified by reading the files on
2026-08-21**, not from the CHANGELOG.

Legend: **✅** carries it · **❌** does not · **n/a** does not apply to that surface

### 2.1 The 2026-08-20 resilience fix set

| Behaviour | A (kit) | B (sources) | C (Gemini) | Note |
|---|---|---|---|---|
| `stepModel()` — walk the model ladder | ✅ | ✅ | ✅ (as `seatLadder`/`nextModel`) | different machinery, same job |
| 429 steps DOWN instead of "wait and Retry" | ✅ | ✅ | ✅ | C also reads `RetryInfo` to tell a per-minute burst from a daily cap |
| `errorMessage()` has a `quota` case | ✅ | ✅ | ✅ | |
| Phase-deferred prompt (grounding blocks sent late) | ✅ | ✅ | ✅ | invented in C, moved to B, then adopted by A |
| Submit records `&v=claude` / `&v=gemini` | ✅ | ✅ | ✅ | contract §8 permits new optional keys |
| `BACKUP_ENDPOINT` + the backup button | ✅ | ✅ | n/a (stripped — C *is* the backup) | phys-110's five got it from the patcher |
| Mid-lesson `Continue on Gemini →` with transcript handoff | ✅ | ✅ | n/a (receives it) | three-link chain; `gemini-handoff.mjs` |

**This row set is in good shape.** The kit was updated the same day (commit `29daee4`) and its
manifest re-hashed, which is the process working.

### 2.2 The 2026-08-21 changes

**None of these reached the kit.** Probed for eleven markers — `stampSubmitted`, `finish-bar`,
`OPENING_WELCOME`, `LZ_ATTEMPTS`, `spentModels`, `AbortError`, `clearSession`, `8192`,
`scriptedDelay`, `2026-08-21` — and every count is **0**. The only date the kit skill names is
`2026-08-20`.

| # | Behaviour | A | B | C | Verdict for the builder |
|---|---|---|---|---|---|
| 1 | **Request deadline** — abort a request that never returns | ❌ | ❌ | ✅ | **ADOPT.** See §5.1 |
| 2 | **5xx marks the model spent and walks** | ❌ | ❌ | ✅ | **ADOPT.** See §5.2 |
| 3 | **Empty response marks the model spent and walks** | ❌ | ❌ | ✅ | **ADOPT.** See §5.3 |
| 4 | **Output-token cap raised for the report** | ❌ 4096 | ❌ 4096 | ✅ 8192 | **DECIDE.** See §5.4 |
| 5 | **Finish bar** — large centred Submit + "Keep talking" | ❌ | ❌ | ✅ | **ADOPT.** See §5.5 |
| 6 | **Submitting stamps the session instead of clearing it** | n/a | n/a | ✅ | Gemini-only — see §6 |
| 7 | **Session survives a reload** (`localStorage` snapshot) | ❌ | ❌ | ✅ | **CONSIDER** — see §6, this is not free on claude.ai |
| 8 | **lz-string loader retries instead of giving up at 10 s** | ❌ | ❌ | ✅ | **ADOPT.** See §5.6 |
| 9 | **Report ladder no longer heads on the slowest model** | n/a | n/a | ✅ | Gemini model names; no Claude equivalent |
| 10 | **App-delivered opening** (`APP_OPENING`) | n/a | n/a | sandbox only | **DO NOT ADOPT** — see §6 |
| 11 | **Scripted turns are paced** (`scriptedDelay`) | n/a | n/a | sandbox only | rides with 10 |
| 12 | **`OPENING_WELCOME` — greet and name the lesson** | ✅ *(as prompt text)* | ✅ | sandbox only | A is already correct; see §6 |
| 13 | **BACKUP VERSION banner removed** | n/a | n/a | ✅ | presentation of C only |
| 14 | **Site copy stops ranking Claude above Gemini** | n/a | n/a | n/a | `site/` pages; done |

---

### 2.3 The 2026-08-25 diagnosability + thinking-budget fix set

**This is the set that closes the "No usable Gemini model was found for this key" reports.**
It went to **C only**, in one operation with the port
(`to_gemini.py` now calls `patch_tutor_diagnostics.apply_fixset` on every build it emits), and
to the six phys-110 builds that have no `.jsx` source and therefore cannot be ported at all.

| Behaviour | A (kit) | B (sources) | C (Gemini) | Note |
|---|---|---|---|---|
| A thinking budget is sent, and `MAX_TOKENS` is 32768 | ❌ | ❌ | ✅ | **the cadet-facing bug** — see below |
| A `MAX_TOKENS` blank retries the SAME model with less thinking | ❌ | ❌ | ✅ | instead of burning a rung on a fault every rung shares |
| A 400 naming the thinking field drops it and retries | ❌ | ❌ | ✅ | so a model that rejects it does not 400 every turn |
| `nextModel()` skips rungs already marked spent | ❌ | n/a | ✅ | `seatLadder` always did; these two disagreed |
| `advance()` = step down, then one bounded whole-ladder retry | ❌ | n/a | ✅ | does in-app what a cadet was doing by reloading |
| A 404 marks the model spent | ❌ | n/a | ✅ | the only walking path that never did |
| ~~`gemini-2.5-flash-lite` is the ladder floor~~ | — | — | — | **reversed the same evening — see §2.4** |
| Per-model telemetry from `usageMetadata` | ❌ | ❌ | ✅ | calls, outcomes, and prompt/**thinking**/output tokens |
| The running model is shown DURING the session | ❌ | ❌ | ✅ | it existed only on the start screen |
| The error bar carries the full diagnostic + Copy | ❌ | ❌ | ✅ | so a screenshot is actionable |
| Errors POST to `log-tutor-error` | ❌ | ❌ | ✅ | reaches the cadet who gives up and never submits |
| The extension turn has a working Retry | ❌ | ❌ | ✅ | it shipped with none, at the report stage |

**The one that mattered.** Gemini 3.x and 2.5 think before they answer, and thinking tokens are
charged against `maxOutputTokens`. At the old ceiling of 8192 a long turn could spend the whole
budget on thoughts and return a candidate with `finishReason: MAX_TOKENS` and **no text**.
`callTutor` read that as a broken model, marked it spent, and stepped down — so a cadet with
thousands of requests still available walked off the bottom of a five-rung ladder in a few turns
and was told no usable model existed.

**§2.1 of this file already recorded the signature and read it as capacity**: *"real INPUT tokens
and ZERO output tokens"*, on an instructor's dashboard, far below every limit. That is what
prompted dropping `3.7-flash` from the report pool. Dropping it was not wrong — the latency
argument in §4.3 stands on its own — but it was not the fix, and the bug survived it on every
other rung.

**A and B are untouched and that is a real gap, not an oversight deferred quietly.** Every row
above except the four ladder-mechanics ones applies just as much to a published Claude artifact:
claude.ai injects the model, so the thinking rows read differently there, but the diagnostics, the
central log and the extension-turn Retry do not. Carried into §5 as backlog.

### 2.4 The 2026-08-25 evening correction — the floor was a 404, and two branches recorded nothing

**§2.3 shipped a floor that does not exist, and the error log it shipped alongside caught it the
same evening.** That is the log working on its first real day, and it is the reason this row is a
correction and not a term-long mystery.

Instructors reported cadets completing a backup lesson and nothing reaching PREP. The pipe was
fine — 665 Gemini reports stored over ten days, 661 auto-graded. The sessions were dying upstream.

**What the first 30 rows of `app.tutor_error_log` said** (01:06–01:12 UTC, both courses):

| Observation | Reading |
|---|---|
| All 30 terminal errors are `kind=model http=404 model=gemini-2.5-flash-lite` | `kind: model` is thrown **only** from the 404 branch, so this is a real HTTP 404 from Google — not an exhaustion symptom |
| `gemini-2.5-flash` shows `kinds: {model: 3}` in the same rows | the 404 is the whole 2.5 line, not one name |
| Every row carries `ladder_resets: 2` | the ladder was walked three times over before the cadet was told anything |
| Two rows are `phase=report`; one at turn 22, `session_sec` 1061 | **an eighteen-minute conversation the cadet finished and could not submit** — the instructor report, in one row |
| Every rung *above* the 2.5 line reads `calls: 12, ok: 0, fail: 0, kinds: {}` | twelve requests and no account of one of them — see the second fix below |

**`discoverModel()` does not save you here.** The cadets' keys **list** both 2.5 names with
`generateContent` support, and `:generateContent` then answers 404. A listing is not an
entitlement, so the names have to come out of the source ladder.

They were also not earning the place. Across the last 400 stored Gemini reports,
`content->>'model'` reads **`gemini-3.6-flash` 375, `gemini-3.5-flash-lite` 12,
`gemini-3.5-flash` 6, `gemini-3.1-flash-lite` 4, `gemini-2.5-flash` one, `gemini-2.5-flash-lite`
zero.** A rung that wins once in 400 is not a safety net; at the bottom of the ladder it is the
failure kind the cadet is shown.

| Behaviour | A (kit) | B (sources) | C (Gemini) | Note |
|---|---|---|---|---|
| The 2.5 line is gone; the floor is `gemini-3.1-flash-lite` | ❌ | n/a | ✅ | a ladder must END on a model that answers |
| A 429 calls `noteFail(model, "quota")` | ❌ | ❌ | ✅ | it marked the model spent and recorded nothing |
| A 5xx calls `noteFail(model, "capacity")` | ❌ | ❌ | ✅ | same blind spot, same fix |

**What this fixes, and what it does not.** It does not conjure a rung for a cadet whose key is out
of quota. What it stops is the **lie**: with the dead floor gone the ladder ends on a model that
answers, so an exhausted session throws `quota` and the cadet reads *"wait and Retry"* instead of
*"No usable Gemini model was found for this key. Tell your instructor"* — a dead end that sends a
cadet with a working key to go find a person.

**The second fix is what makes the next thirty rows readable.** The 429 and 5xx branches both
marked the model spent and walked **without calling `noteFail`**, so a rung burned by quota was
indistinguishable in the log from a rung never tried. That is why the 30 rows above cannot say
whether those cadets were rate-limited or whether Google was refusing capacity — the single fact
that would decide what to do next.

**A caution for whoever reads this next.** Two floors were chosen in one day, on reasoning that
sounded good both times, and neither was checked against what the fleet had actually run.
`content->>'model'` over recent `submission_activities` answers that in one query. **Ask it before
adding a rung, not after.**


### 2.5 The same evening, later — one failing turn burned the whole ladder in twenty seconds

**§2.4 read the rungs above the 404 floor as "used up by quota". That was wrong, and the course
director rejected it on arithmetic**: the lite rungs carry ~500 requests/day and a session is
10–14 requests, so a cadet cannot reach them by spending. The objection is what found this.

**Summed per model across all 75 error rows:**

| model | calls | ok | fail | spent | kinds |
|---|---|---|---|---|---|
| `gemini-3.6-flash` | 1269 | **284** | 0 | 75/75 | `{}` |
| `gemini-3.5-flash` | 1005 | 28 | 0 | 75/75 | `{}` |
| `gemini-3.5-flash-lite` | 948 | 46 | 0 | 75/75 | `{}` |
| `gemini-3.1-flash-lite` | 924 | 0 | 0 | 75/75 | `{}` |
| `gemini-2.5-flash-lite` | 471 | 0 | 471 | 75/75 | `{model: 471}` |
| `gemini-2.5-flash` | 225 | 0 | 225 | 75/75 | `{model: 225}` |

**`gemini-3.6-flash` answered 284 times and was still marked spent in every one of the 75
sessions.** A model that is answering is not out of quota. And the per-session call totals settle
it: **60, 61, 58, 61, 62 API calls — to reach turn 5.** 81 by turn 22.

**The arithmetic.** `rawCall` retried a 429 or a 5xx **three** times (0.5s / 1s / 2s) before
walking, so one bad response cost **4 calls in ~3.5 s** on that rung. Six rungs = 24 calls in ~21
seconds; `resetLadder` ran that twice more = **72**. The observed 58–81 is exactly this, and all of
it happens **inside a single turn**. Nothing about it is a daily budget.

**The half that made it permanent.** `spentModels` is module scope and only `resetLadder` ever
cleared it — twice per page load, then never again. `seatLadder` walks past every spent rung to the
**last** one. So from the first failing turn onward the cadet was **pinned to the bottom rung for
the rest of the session**, and until §2.4 the bottom rung was a guaranteed 404. That is the entire
reported symptom: a session that works, one bad turn, then *"No usable Gemini model was found for
this key"* forever after — with 284 good answers' worth of model idle at the top of the ladder.

| Behaviour | A (kit) | B (sources) | C (Gemini) | Note |
|---|---|---|---|---|
| `spentModels[name]` records **why** it was spent | ❌ | n/a | ✅ | truthiness unchanged, so every existing check still works |
| `freshTurn()` revives transient spends at the top of every turn | ❌ | n/a | ✅ | **the pinned-session fix** |
| A 404 spend is deliberately **kept** | ❌ | n/a | ✅ | quota/capacity/timeout/empty all pass; a 404 does not |
| `resetLadder()` refuses when every rung is a 404 | ❌ | n/a | ✅ | the old one walked a dead ladder twice more to prove it |
| `WALK_RETRIES = 1` on a 429 or 5xx | ❌ | ❌ | ✅ | 2 calls a rung, not 4; the network path keeps all 3 |

**Still unknown, and worth stating plainly: whether the trigger is a 429 or a 5xx.** All 75 rows
predate §2.4's `noteFail` counters, carry no Google message and no per-model status. The two want
opposite handling — a 429 says back off, a 5xx says walk fast — so this set reduces
**self-inflicted** load rather than tuning a response to an unconfirmed cause. The next burst will
say which.

**The lesson that outlives both fixes.** §2.4 was written from the *last* error in each session and
reached a wrong cause; §2.5 was written from the *per-model counters* and reached a checkable one.
The terminal error names where a session died, never why. **Read the `models` array, not
`http_status`.**


### 2.6 The next evening — measured, after two readings had been overturned by arithmetic

**§2.5 ended by saying "the next burst will say" whether the trigger is a 429 or a 5xx. It did,
within a day, and it said 429.** It also said that §2.5's own reading of the lite rungs was
wrong. So this section is the first one here written from an experiment rather than from a
usage dashboard.

**The pattern this file keeps recording.** §2.4 read the terminal error and reached a wrong
cause. §2.5 read the per-model counters and reached a checkable one. §2.6's first draft read the
dashboard and reached a cause the course director rejected on the lite rungs' arithmetic — 6 and
4 calls against a cap of 15 is not a rate limit being hit. **Three rounds of inference, two of
them wrong.** The fix was to stop inferring: `tests/browser/test-gemini-rate-limits.html` asks
Google directly, and every constant in set 7 is one of its outputs.

**What it measured** — 2026-08-26, live free-tier key, 32 requests:

| Measurement | Result | Consequence |
|---|---|---|
| quota id | `GenerateRequestsPerMinutePerProjectPerModel-FreeTier` | per project **and** per model. Google's "per project, not per API key" is true and does **not** mean one ceiling across models |
| dimensions | `{"model": "...", "location": "global"}` | scoped to one model |
| **blast radius** | **`gemini-3.1-flash-lite` = 200 while `gemini-3.5-flash-lite` refused** | **walking the ladder on a 429 is CORRECT.** The neighbour has its own allowance |
| the wall | 15 answered, 16th refused | the documented 15/min is exact |
| recovery | **20.6 s** | not a daily cap; not a full minute |
| RetryInfo | `8s` on a wall still standing 11 s later; `57s` on one that cleared in 10 s | **do not wait Google's number literally** |

**Why the cadet's session died.** Flash is 5/min and the old walk sent 6 per model per turn — one
turn breaks Flash. Lite is 15/min and 6 is fine once, but the cadet "kept cycling", and three
attempts inside a minute is 18 against 15. Self-inflicted on both tiers, by different arithmetic.

| Behaviour | A (kit) | B (sources) | C (Gemini) | Note |
|---|---|---|---|---|
| A 429 walks instead of retrying its rung (`QUOTA_WALK_RETRIES = 0`) | ❌ | ❌ | ✅ | **the biggest reduction** — 2 calls a rung becomes 1 |
| A 5xx keeps its retry | n/a | n/a | ✅ | capacity is a different failure from a rate limit |
| One whole-ladder lap per turn, not two | ❌ | n/a | ✅ | with the above, 3 requests per model per turn against a cap of 5 |
| The wait happens once the WHOLE ladder is spent | ❌ | ❌ | ✅ | waiting on a rung whose neighbour answers is wasted |
| The wait is bounded at 25s by **our** number, not Google's | ❌ | ❌ | ✅ | `RetryInfo` may only shorten it |
| The wait is SHOWN, counting down | ❌ | ❌ | ✅ | drives the existing `onModelSwitch` strip |
| The 429 body is read once, before the walk | ❌ | ❌ | ✅ | `res.json()` can be called only once |
| **The `QuotaFailure` name is recorded (`noteQuota`)** | ❌ | ❌ | ✅ | **the row to carry forward** — see below |

**Why the last row outlives the rest.** The probe is a one-off; it will not be re-run mid-term,
and nobody should have to re-derive this from a dashboard again. The quota id now rides in every
cadet's error block and in `log-tutor-error`, so the *next* failure names its own cause. A name
carrying `PerModel` says the neighbouring rung still has an allowance and the walk was right; one
that does not says the ceiling is shared and the walk was never going to help.

**Two things an earlier draft of set 7 shipped, and the probe removed.** A 65s honoured-wait
ceiling, reasoned from "a per-minute window is sixty seconds" — correct arithmetic, wrong answer
once `RetryInfo` was measured. And a 1.2s inter-rung gap, hedging against a project-wide ceiling
that **does not exist**. Both are recorded rather than quietly dropped, because the reasoning
behind them was sound and still wrong, and that is the whole argument for measuring.

**What set 7 does NOT claim.** In the original evidence the first call of *every* rung failed,
including the first call of the turn, so that key was already throttled before the walk began.
**The walk is an amplifier, not the origin.** Set 7 stops the amplification; it cannot un-throttle
a key.

**One assertion pins the arithmetic** so it cannot regress quietly:
`(QUOTA_WALK_RETRIES + 1) * (LADDER_RESET_LIMIT + 1 + LADDER_WAITS_PER_TURN) <= 5`.

**Still unverified: a real tutor turn on a live key with the new code.** The ladder-wait path has
never executed.


### 2.7 The morning after — a per-day 429 and a per-minute 429 are opposite problems

**§2.6 made the ladder stop thrashing. It did not make it stop paying for the wrong thing.** Set
7 treats every 429 alike, and the two kinds want opposite responses:

| | clears | waiting | retrying |
|---|---|---|---|
| **per minute** | ~20 s, measured | correct, and worth a countdown | correct, once |
| **per day** | midnight **Pacific** | worthless | worse than worthless — each attempt spends a request against a cap already full |

**The daily case is the expensive one, and it is the common one.** `gemini-3.6-flash` is **20
requests per day** and a lesson is ~14, so a cadet's *second* lesson of the day begins with the
top rung already dead. `freshTurn()` — §2.5's fix, and a good one — then revived it at the top of
every turn, seated it, and spent one guaranteed refusal on it and another on `3.5-flash` beneath
it. Over a 30-turn session that is **~60 requests whose only possible outcome is a refusal**,
plus two round trips of latency in front of everything the cadet types. The 2026-08-25 log
carries the fingerprint: one session at `calls 20, ok 6` on `gemini-3.6-flash` — the entire daily
allowance, in one lesson.

**The course director's reasoning, 2026-08-26, and it is sound:** if the first few requests of a
session are refused, that cannot be a per-minute limit — the smallest cap on this ladder is
5/min — so it must be the daily one.

**One correction was needed, and it is the whole reason this section exists.** *"The first few
requests"* has to mean the first few **this key has sent**, not the first few **this page has
sent**. Every counter in the transport lived in module scope and died on each reload, so a cadet
who reloaded — or who ran a lesson an hour earlier — looked identical to a cadet on their first
request ever. The inference was correct and the evidence it needed did not survive the page. Set
9 therefore puts the ledger in `localStorage`, keyed by the **Pacific** date.

**And Google just says so, which is cheaper than any inference.** Set 7 already parses the
`QuotaFailure` violation out of the 429 body; the name reads
`GenerateRequestsPerMinutePerProjectPerModel-FreeTier`. Matching `/PerDay/` against it is the
primary test and the director's arithmetic is the fallback for a body carrying no `QuotaFailure`
at all. Both are kept — §2.6's lesson was to stop inferring where a measurement exists, not to
throw away the reasoning that still answers when one does not.

| Behaviour | A (kit) | B (sources) | C (Gemini) | Note |
|---|---|---|---|---|
| A 429 is classified `day` vs `minute` | n/a | n/a | ✅ | Google's quota id first; our own send history second |
| A day lock survives the page load (`localStorage`, Pacific date) | n/a | n/a | ✅ | the reload was the blind spot, not the arithmetic |
| `reviveSpent()` keeps a day lock, clears a minute one | ❌ | n/a | ✅ | **the ~60 wasted requests** — see above |
| Today's locks are seeded onto the ladder before turn 1 | n/a | n/a | ✅ | so lesson two starts where lesson one finished |
| Per-**model** pacing before the send | n/a | n/a | ✅ | walk instead of sending a refusal we can predict |
| A fully day-locked ladder skips the 25 s wait | ❌ | ❌ | ✅ | that wait cannot help before midnight |
| A pause ≤ 3 s is taken **silently** | ❌ | ❌ | ✅ | announcing a 2 s wait as an error teaches a working page as broken |
| The cadet is told **which** limit, and what to do about it | ❌ | ❌ | ✅ | *"wait a minute"* and *"come back tomorrow"* are different instructions |

**Deliberately NOT built, and both were tempting:**

- **A global pacer across all models.** §2.6's probe settled it: asked every other model the
  instant one was walled, `gemini-3.1-flash-lite` answered **200** while `gemini-3.5-flash-lite`
  was still refusing. The ceiling is per project **and per model**, so a project-wide pacer would
  slow every rung to guard against a limit that does not exist.
- **A token check.** TPM on the free tier is 250,000/min and a turn is a few thousand; the probe
  drew a 429 on a **two-character** prompt. Tokens are already counted and logged. Gating on them
  would add a branch that never fires.

**Why A and B are mostly `n/a` here.** Quota ids, `RetryInfo`, per-model daily caps and midnight
Pacific are **Google's** semantics. The Claude artifact walks its own ladder against claude.ai,
whose limits this repository has never measured. Two rows are not `n/a` and do carry forward as
*concepts*: **do not revive a rung that cannot recover**, and **do not show a countdown for a
wait that will not help**. Both are surface-independent, and both are currently wrong in the kit.

**The number that survives set 9 unchanged.** This stops waste; it cannot make the free tier
bigger. Chat still starts on a 5/min · 20/day model and falls to 15/min · 500/day, spending the
scarce budget first — see §4.2. That reorder remains a teaching-quality decision for the course
director, and set 9 makes its cost easier to read rather than smaller.

---

### 2.8 The same day — "it starts with AIza" was a guess, and it was usually wrong

**Reported by the course director: cadets seeing a message that a Gemini key starts with `AIza`,
and the Start button greyed out.** Both come from one branch in `discoverModel`:

```js
if (res.status === 400 || res.status === 401 || res.status === 403) {
  throw { kind: "auth", status: res.status };
}
```

The greyed button is the same event — `connStatus` is not `"ok"`, and both Start and Study are
disabled on that. **Those three codes are three different problems:**

| Google says | What it actually is | What the cadet was told |
|---|---|---|
| **400** | the key really is wrong or malformed | correct |
| **403** | the key is **fine** — the Generative Language API is off for its project, the key carries a referrer/IP restriction, or a school Google account blocks AI Studio | **wrong**, and it sends them to re-copy a perfect key |
| **401** | no key was sent | rare from this page |

**Google says which one it is, in the response body, and all 44 builds threw it away.** Measured:
0 of 44 read `error.message` before throwing. The *mid-session* 400 branch has read that sentence
since §2.3 — that fix exists precisely because a too-long request was being reported as a bad key —
and the start screen, which is where a cadet is actually stopped, never got it.

**Two more findings came out of looking.**

**The start screen has never written to the error log.** All 878 rows in `app.tutor_error_log`
carry phase `chat`, `opening` or `report` and nothing else, because `checkConnection`'s catch was
the only error path in the build that did not log. A cadet blocked at the door produced no count,
no name and no cause — the only evidence anyone had was a cadet saying it went grey. **This is why
the reported symptom could not be diagnosed from the data**, only from the source.

**A mid-session 403 killed the session and blamed the key.** One cadet took a 403 at **turn 9**,
after eight turns that worked (`lesson-09-application-of-newtons-laws`, 2026-08-26 16:16 UTC, the
first row ever to carry a `cadet_ref`). A key does not go bad at turn 9. A 403 whose message never
mentions the key is **this model refusing this project** — the same per-model failure the 404 and
429 branches already walk away from. Ten `auth` rows exist in total; all ten stored `detail` NULL,
so none of them can say what Google meant.

| Behaviour | A (kit) | B (sources) | C (Gemini) | Note |
|---|---|---|---|---|
| 400/401/403 classified from Google's message | n/a | n/a | ✅ | `apioff` / `keyrestricted` / `region` / `forbidden` / `auth` |
| Google's sentence shown under our advice | ❌ | ❌ | ✅ | our advice is a classification and can still be wrong |
| The start screen reaches the central log | ❌ | ❌ | ✅ | **0 of 878 rows** came from it before |
| A non-key 403 walks the ladder | ❌ | n/a | ✅ | it is per model, exactly like 404 and 429 |
| `auth` and `badrequest` carry `detail` | ❌ | ❌ | ✅ | all ten auth rows stored NULL |

**Why `keyErrorKind` is conservative on purpose.** Anything unrecognised at 403 becomes
`forbidden`, whose message says *"this is not a typo, and here is what Google said"* rather than
naming a cause. Guessing wrong is the entire subject of this section; a fallback that guesses is
the same bug with better vocabulary.

**No edge-function change was needed.** `log-tutor-error` takes `kind` as a free string capped at
40 characters, so the four new names land without a deploy — unlike `quota_ids` in §2.6, which the
`models[]` whitelist dropped silently.

**One thing this section had to work around.** The 44 builds are **two vintages** that differ in
whitespace and in one CSS rule: 33 carry a tight `connMsg` declaration and a wrapped `.conn-msg`
rule, the 11 phys-110 builds carry a column-aligned declaration and a single-line rule.
`checkConnection` itself is byte-identical in both, so this is cosmetic drift from when those were
ported, not a fork. The patcher matches **both shapes and asserts one landed**, rather than
normalising 11 builds to look like the other 33 — the diff for that would have been indistinguishable
from the line-ending rewrite in PROJECT.md's sharp-edges table.

---

### 2.9 Hours later — "come back tomorrow" was being said on no evidence at all

**Set 9 shipped in the morning. By evening the live log had falsified its main premise.**

```
quota ids Google named, across all 885 rows of 2026-08-26:   NONE
```

Every 429 that day carried the bare sentence *"Resource has been exhausted (e.g. check
quota)."* — **no `QuotaFailure` block and no `RetryInfo`**. So §2.7's primary test never fired
once, and every classification fell through to the tiebreaker:

```js
return sentSince(name, 60000) < RPM_FLASH ? "day" : "minute";
```

**A rung the ladder WALKS TO has had exactly one call, and one is always fewer than five.** So
every walked-to rung was labelled `day`, `allDay` went true, and a cadet five turns into a
lesson was told to come back after midnight. §2.7 shipped a branch that could not return
`minute` for a walked-to rung at tutoring pace — the code existed and was unreachable.

**Observed, from the screenshot the course director forwarded and the rows behind it:** one
cadet took the daily message at turn 5 after four good turns; another was told to come back
tomorrow, reloaded, and was told it again **four seconds into the new session** (19:27:08 and
19:27:12, turns 0 and 1). The lite rungs in those rows had made **one call each** against a
measured 500/day.

**The two errors are not the same size, and §2.7 defaulted to the expensive one:**

| | truth is per-minute | truth is per-day |
|---|---|---|
| we say **day** | **lesson over for nothing** | correct |
| we say **minute** | correct | a 25 s wait, then an honest failure |

**So `day` now needs receipts.** The ledger §2.7 built — how many requests this key has sent to
this model *today*, across reloads — is the receipt, and §2.7 never consulted it for this. A
daily claim now requires our own count to have reached `DAILY_CONFIDENCE` (0.8) of that model's
daily cap. Not 1.0, because the ledger is per browser: a cadet who started on a phone begins the
laptop session at zero, and undercounting must fail **safe** — it yields `minute` or `unknown`,
never a false *"come back tomorrow"*.

**And a third answer was added, because two were not enough for what the log shows.** Every rung
refusing at once, seconds apart, with Google naming nothing, is **not** the shape of a per-model
limit — §2.6's probe hit a per-model wall and Google named it every single time. `unknown` says
that plainly, gives both actions, and promises neither.

| Behaviour | A (kit) | B (sources) | C (Gemini) | Note |
|---|---|---|---|---|
| `day` requires our own ledger to back it | n/a | n/a | ✅ | ending a lesson needs evidence |
| A third scope, `unknown`, for the unnamed refusal | n/a | n/a | ✅ | **the common case in live data** |
| The real scope is stored, not flattened to `"quota"` | n/a | n/a | ✅ | confident vs unexplained must survive to the throw |
| Only quota-spent rungs vote on the scope | n/a | n/a | ✅ | a 404 says nothing about anyone's allowance |
| `detail` carries the scope name, not daily-or-nothing | ❌ | ❌ | ✅ | `[day]` / `[minute]` / `[unknown]` in the log |

> **These constants are still not measured, and that is now the top of the backlog.** `RPD_FLASH
> = 20` and `RPD_LITE = 500` come from documentation and from §2.6's probe, which measured the
> *minute* wall and never exhausted a key. `keyErrorKind`'s patterns in §2.8 are matched against
> **Google's wording as we imagine it**, not wording anyone has captured. Four fix sets in two
> days have each corrected the previous one's inference; the way out is a testbed that
> deliberately exhausts a disposable key and records what Google actually returns. See
> `tests/browser/` — §2.6's probe is the shape to extend.

---

### 2.10 The next day — 107 requests, and three of the four fix sets turn out to be answering the wrong question

**This is the first entry in this section whose numbers were measured rather than inferred.**
Sets 9, 10 and 11 each shipped an inference and were corrected within a day by the cadet who met
it. The course director's response to the fourth was *"this has to be tested to death"*, which was
right, and the answer was
[`tests/browser/test-gemini-api-truth.html`](../../tests/browser/test-gemini-api-truth.html) —
a harness that deliberately exhausts a disposable key and records status, headers and body for
every call. **107 requests, 12m 55s.** Read alongside a census of `app.tutor_error_log`.

#### What the caps actually are

| | Guessed | Measured | |
|---|---|---|---|
| Flash requests per day | 20 | walled on request **20** | exact |
| Lite requests per minute | 15 | walled on request **16** | exact |
| Blast radius of a wall | one model | other three rungs returned 200 | exact |
| A daily lock clearing on its own | no | still refusing after 90 s | exact |
| Recovery from a per-minute wall | 20.6 s | **41 s** | **the shipped wait was too short** |
| Lite requests per day | 500 | hit 503 capacity at 39 | **still unmeasured** |

The ladder's *shape* is therefore right — per-model walls, walked around, are exactly what the
ladder is for. Two of its *numbers* were not.

#### A real quota refusal is chatty. The one hitting cadets says nothing.

Both measured 429s named everything:

```
GenerateRequestsPerMinutePerProjectPerModel-FreeTier   {model: gemini-3.1-flash-lite, location: global}
  "Quota exceeded for metric: ...generate_content_free_tier_requests, limit: 15,
   model: gemini-3.1-flash-lite. Please retry in 31.944139553s."

GenerateRequestsPerDayPerProjectPerModel-FreeTier      {model: gemini-3.5-flash, location: global}
  "... limit: 20, model: gemini-3.5-flash. Please retry in 44.016147424s."
```

**All 781 quota refusals in the live log on 2026-08-26 look like neither.** Every one carries the
bare sentence *"Resource has been exhausted (e.g. check quota)."* — no metric, no limit, no model,
no retry delay, and `quota_ids: {}` on every row. One logged row settles it without any argument
about wording:

```
gemini-3.5-flash-lite    calls 1    ok 0    kinds {quota: 1}
```

**One request**, against measured caps of 15/minute and 500/day. A first call cannot exhaust
either. Whatever refused it was not that key's allowance.

The timing says the same thing from the other side. All 781 fall between **02:20 and 05:25 UTC** —
20:20 to 23:25 Mountain, the evening the whole cohort works before a deadline — peaking at 22
refusals a minute. That is the shape of shared free-tier capacity, not of one cadet's quota.

> **So §2.7's entire day-versus-minute question is the wrong question for the common case.**
> §2.9 was right to add `unknown` and right that this was the common branch; what it still got
> wrong was the *words*, which told the cadet the usual cause was their daily allowance and to come
> back after the reset. Set 12 stops saying that. **It does not substitute a better guess** — it
> says what the ledger actually knows, which is that the cadet is nowhere near a limit.

#### Set 10's five patterns matched nothing. Two causes nobody guessed produced 13 rows.

| Real message, from the log | Rows | Set 10 said | Truth |
|---|---|---|---|
| `Permission denied: Consumer 'api_key:…' has been suspended.` | 10 | `auth` — "re-copy your key" | Google **suspended the project**. Re-copying cannot help |
| `The bound service account is deleted or disabled.` | 3 | `auth` — "re-copy your key" | the project behind the key is gone |
| `API key not valid. Please pass a valid API key.` | 11 | `auth` | correct |
| *(apioff / keyrestricted / region)* | **0** | — | never observed |

**Ten cadets hold keys Google has suspended**, and every one of them was told to check their
typing. Note *why* the first one missed: set 10's `forbidden` test excludes any message mentioning
a key, and this message contains the literal string `api_key:`. **A guessed exclusion caught a real
case.** The two new tests are therefore ordered *above* it.

The apioff / keyrestricted / region patterns are left in place — they are cheap, they now sit below
the measured ones, and an unfired branch is not the same as a branch known never to fire.

#### And Google's real wording for a bad key, captured at last (this part costs no quota)

| What the cadet did | Status | Google says |
|---|---|---|
| pasted a key with trailing junk | **401** | *"Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie…"* |
| pasted nothing | **403** | *"Method doesn't allow unregistered callers…"* |
| pasted something that is not a key | **400** | *"API key not valid. Please pass a valid API key."* |

All three still classify as `auth`, which is correct — set 10 got them right by accident of its
exclusions, and the harness now pins them against the observed strings rather than against
imagined ones.

| Behaviour | A (kit) | B (sources) | C (Gemini) | Note |
|---|---|---|---|---|
| Ladder wait outlasts the measured 41 s recovery | ❌ | ❌ | ✅ | 25 s expired early every time |
| RetryInfo clamped in **both** directions | ❌ | ❌ | ✅ | it under-states as well as over-states |
| The unnamed 429 stops blaming the cadet's allowance | n/a | n/a | ✅ | measured false |
| `suspended` and `deadproject` named from real wording | ❌ | ❌ | ✅ | 13 live rows, all previously misadvised |
| `suspended` tested above `forbidden` | n/a | n/a | ✅ | the key-exclusion swallowed it |

> **What is still unmeasured, stated plainly.** `RPM_FLASH = 5` and `RPD_LITE = 500` were not
> reached by this run — the lite daily probe hit a 503 capacity refusal at request 39 and stopped.
> The bare 429 itself has **not** been reproduced on demand; it is load-dependent and appears in
> the evening, so the reading above is inference from its shape, its timing and one single-call
> row, not from a controlled repeat. That inference is used only to **remove** a claim, never to
> add one, which is the direction it is safe to be wrong in.

> **The finding no code change addresses.** Twenty Flash requests a day is roughly four tutoring
> turns. A cadet who works two lessons in a day exhausts the top two rungs before the second one
> starts, and the whole cohort shares one free tier at the same hour the night before a deadline.
> **The free tier is not sized for this class**, and no client-side cleverness changes that — it is
> a paid-key or server-proxy decision, and it belongs to the course director.

### 2.11 The next day — the pause read as a fault, and both clocks were blind to it

**Set 12 worked.** Measured across the 2026-08-26 16:30 cutover, from `app.tutor_error_log`:

| | Before | After |
|---|---|---|
| API calls per cadet turn | 8.96 | **1.71** |
| `quota` rows / distinct cadets | 794 / 20 | **13 / 2** |

That is the storm gone — 1.0 is the floor, and the walk now costs less than one extra request a
turn. §2.10 documented the fix set the day it shipped and could not document its result; this row
is the result, and it is recorded because a fix set whose *outcome* is never written down gets
re-litigated by the next person reading the next complaint.

**Which is exactly what happened.** Cadets reported *"2-20 minutes between chat messages"* the
following morning, and the storm was the obvious suspect. It was not the cause, and the first two
things reached for to check it were both measuring something else.

#### Both instruments were blind to the same seconds

| Instrument | What it does | Why it could not see the wait |
|---|---|---|
| `duration_min` in every report | ticks `activeSec` | `if (loading) return;` — *"don't charge tutor thinking time"*. The ENTIRE tutor response is `loading`, the 45s ladder wait and the 120s request deadline included. `IDLE_PAUSE_MS` stops it again 5s after the last keystroke |
| `app.tutor_error_log` | one row per failure | `waitVisibly` has ONE call site and it is on the path that **recovers**. A wait that works completes the turn and writes no row |

So `duration_min` is **cadet keystroke time**. That is the right number for effort and pacing —
what it was built for — and reading it as latency on 2026-08-27 produced *"19 seconds per message"*
for a cohort reporting minutes. A cadet can sit through a 45-second countdown on most turns of a
17-message lesson, roughly **twelve minutes of dead time**, and the system records a six-minute
lesson with zero errors.

**Nothing in this system measured how long a turn took.** Four fix sets had argued about a duration
none of them could see.

#### And the countdown named a fault that was not happening

Set 7 put the ladder wait on the `onModelSwitch` hook, which was right — it needed no new UI. What
it wrote there was `gemini-3.6-flash — rate limited, retrying in 44s`, rendered under the chat as
`Tutor model: gemini-3.6-flash — rate limited, retrying in 44s` in grey 12px, with the typing dots
still running above it. Cadets reported it as a bug in the page. **They were reading it correctly:
"rate limited" names a fault, and this is not one** — the pause is the page protecting a free-tier
allowance they have to make last a semester. The mechanism is unchanged; only the words are.

| Behaviour | A (kit) | B (sources) | C (Gemini) | Note |
|---|---|---|---|---|
| The countdown says what the pause is FOR | ❌ | ❌ | ✅ | expected · self-clearing · nothing lost |
| A wall clock with none of `activeSec`'s gates | ❌ | ❌ | ✅ | the only clock a stopwatch would agree with |
| Per-turn timing (`callTutor` wrapped) | ❌ | ❌ | ✅ | a TURN = one call, however many requests inside |
| Per-request API time, and waits counted separately | ❌ | ❌ | ✅ | our second vs Google's second |
| `timing` in the submission payload | n/a | ❌ | ✅ | additive, contract §8; beside `duration_min`, never instead |
| `timing` survives a reload | n/a | n/a | ✅ | module scope dies with the page |
| The diagnostic block carries it | ❌ | ❌ | ✅ | one screenshot answers the question |

**`duration_min` is deliberately unchanged.** `pacingNote` and the effort model read `activeSec`
and must keep reading it; the new counters sit beside it. Changing it would have silently rescored
pacing for every cadet mid-term to fix a reporting problem.

> **Where this does NOT go, and it is a real gap.** The logged FAILURE row does not carry the
> timings. `app.tutor_error_log` has no column for them and `log-tutor-error` builds its insert
> from a whitelist, so a new key in the POST body is dropped without saying so — and silently
> dropped data is worse than none. The client sends it anyway, so the day a column exists it
> starts working. Adding that column is DDL on `app` and is coordinated (CORE.md §0). **Carried
> as backlog.** Failing sessions already have `session_sec`; it was the SUCCESSFUL ones that were
> unmeasurable, and those submit a payload.

> **What is still unverified.** No real tutor turn has been run on a live key with this code —
> same caveat as §2.6. What ran: `gemini-model-ladder.mjs` (183 assertions, 3 courses) and
> `gemini-build.mjs` in real Chrome across all 47 builds. Both are Node-only (CORE.md §2).
>
> **And the numbers themselves are not in yet.** This set makes the question answerable; it
> answers nothing on its own. The first cohort of payloads carrying `timing` is what says whether
> a turn is 20 seconds or five minutes — query `content->'timing'` over
> `app.submission_activities`. **Ask it before the next fix set, not after.** That is the lesson
> §2.6 recorded and §2.10 had to record again.

---

## 3. What the Claude artifact still gets wrong

**Filed as [`docs/findings/2026-08-21-claude-artifact-unwalked-failure-paths.md`](../findings/2026-08-21-claude-artifact-unwalked-failure-paths.md)** — a work order with a status, where this section is a summary. The finding carries the verification commands, the separation of what was observed from what was inferred, and the falsification conditions.

**Rows 1, 2 and 3 are the same defect that hung a real instructor**, and they are still live in all
51 published artifacts and in the kit that builds new ones.

The Gemini symptom was precise, and the evidence was an instructor's own usage dashboard: the
report stage looped forever with no summary, while the account sat far below every quota. Three
independent causes, all with the same shape — **a failure that does not record the model as spent
puts the next Retry straight back on the rung that just failed.**

Read `rawCall` and `callTutor` in any cached source (`_builder/courses/*/artifacts/*.jsx`):

```js
// 5xx: three retries, then give up. The ladder is never walked.
if (res.status === 529 || res.status >= 500) {
  if (attempt < retries) { await sleep(backoffMs(attempt)); attempt++; continue; }
  throw { kind: "capacity", status: res.status };
}
```

```js
// An empty response is reported as a generic request failure. The ladder is never walked.
const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
if (!text) throw { kind: "request", status: 0 };
```

And there is **no `AbortController` anywhere in any of the 51 sources** — so a request that never
returns never returns. The cadet watches a spinner with no timeout behind it.

> **State this honestly.** What is established is that the **defect shape is present**: three
> failure paths that end a request without moving off the model. What is **not** established is how
> often each fires against Anthropic's API — the Gemini evidence (a 503 on one model while another
> served the same session; HTTP 200 with real input tokens and zero output tokens) is evidence
> about Google's infrastructure, not Anthropic's. The empty-response path in particular may be rare
> or may never fire.
>
> That uncertainty is an argument about **priority**, not about whether to fix it. A three-line
> guard that costs nothing when it never fires is worth having on a path whose failure mode is a
> cadet losing a completed session.

**Claude's ladder is also only two rungs** — `claude-sonnet-5` then `claude-haiku-4-5` — and
`stepModel` walks by index with no "spent" concept, so there is less to get wrong than on Gemini's
three pools. The fix is correspondingly smaller.

---

## 4. The model ladder — SHIPPED 2026-08-25, no longer a sandbox

> **This section described a proposal until 2026-08-25.** `--policy teaching` is now what all
> **44** live builds run, applied with `to_gemini.py --policy teaching` (its default) for the 38
> that have a `.jsx` source, and by `patch_tutor_diagnostics.py` for the six phys-110 builds that
> do not. `--policy legacy` still exists and still reproduces the old ordering; nothing runs it.
>
> The sandbox `tests/browser/test-gemini-new-ladder.html` is now the same policy as live, which
> makes it a *regression* fixture rather than a preview. Keep it: the property it was created for
> — that the sandbox and live come out of one script and cannot drift — is unchanged.

### 4.1 The ladder as it ships

`MODEL_LITE` is the high-quota floor where every pool ends:

```js
const MODEL_LITE = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
];
```

**The whole 2.5 line was removed on the evening of 2026-08-25, hours after `gemini-2.5-flash-lite`
was added to it — see [§2.4](#24-the-2026-08-25-evening-correction--the-floor-was-a-404-and-two-branches-recorded-nothing).**
Both 2.5 names answer HTTP 404 on `:generateContent` for the cadets' keys while `ListModels`
happily lists them, so `discoverModel()` cannot filter them out. The last rung is the one that
prints *"No usable Gemini model was found for this key"*, so a 404ing rung there is the worst
possible choice — it converts every quota exhaustion into a message that blames the cadet's key.

| | `legacy` — **nothing runs this** | `teaching` — **all 44 live builds** |
|---|---|---|
| **`MODEL_CHAT`** | `3.5-flash-lite`, `3.1-flash-lite`, `3.5-flash`, `3-flash`, `2.5-flash` | `3.6-flash`, `3.5-flash`, then `.concat(MODEL_LITE)` |
| **`MODEL_STUDY`** | `= MODEL_CHAT` — **the same array object** | `= MODEL_LITE.slice()` |
| **`MODEL_REPORT`** | `3.6-flash`, `3.5-flash`, then `.concat(MODEL_CHAT)` | `3.6-flash`, `3.5-flash`, then `.concat(MODEL_LITE)` |
| **`APP_OPENING`** | `false` | `true` |

Ordering principle: **legacy is ordered by quota, teaching is ordered by capability**, with only
the floor still ordered by quota.

> **`gemini-3-flash` in the legacy column is not a real model.** Google ships
> `gemini-3-flash-preview` and no stable `gemini-3-flash`. `discoverModel()` filtered it out
> whenever the key listing succeeded, which is why it never surfaced as a bug; it was a dead rung
> for as long as it shipped. It is gone from all 44 builds with the teaching ladder.

> **The RPM/RPD figures that used to be quoted here per model are unverifiable and have been
> dropped.** Google no longer publishes a free-tier table — the rate-limit docs now say limits are
> per project and visible only in AI Studio. The numbers still in the code comments are inherited
> guesses; do not order a ladder by them, and do not add more.

### 4.2 Why the reorder was proposed

A cadet's report, 2026-08-21: *"it would try to tutor me and then give me the answer instead of
walking me through it."* A lite model can **open** Socratically — the prompt tells it to — and then
collapses into stating the answer, because holding that stance across ~12 turns under a ~70,000-
character instruction is the reasoning-heavy part. **The prompt was not the problem**: every
Socratic line survives the port at identical counts.

The quota it was conserving was not under pressure. Peak use across the whole course was **22 of
flash-lite's 500 requests/day**, while `3.7-flash` sat at **23 of 20** — over its cap — because the
report was the only thing allowed to use it.

A session is ~14 requests, so it **fits inside one 20/day cap**. A cadet doing one lesson a day
runs it entirely on 3.6; a second lands on 3.5; only a third reaches the floor.

`MODEL_STUDY` is separated for the matching reason: study mode is ungraded practice with no cap on
how often a cadet runs it, and while it shared `MODEL_CHAT` it quietly drew down the same allowance
the graded run needed. Under `teaching` it is pinned to the floor, where 478 of 500 daily requests
go unused.

### 4.3 Three constraints that are easy to break

- **`3.7-flash` is deliberately absent from every pool.** It headed the ladder for a few hours on
  2026-08-21 and was dropped the same day: its first reply takes long enough that the page reads as
  broken, on every turn, against a quality difference over 3.6 nobody could point to. It is also
  the likeliest explanation of the original freeze — the cadet who hung was at the **report** stage,
  the one request the live builds have always sent to 3.7. `gemini-model-ladder.mjs` asserts its
  **absence**, because a ladder that quietly regains it is the regression.
- **`MODEL_REPORT` stays its own array even when its contents match `MODEL_CHAT`.** `seatLadder`
  switches on array **identity**; sharing one object would silently stop the report re-seating.
- **`legacy` is written out in full, not composed from `MODEL_LITE`.** It used to be that both
  ended on `2.5-flash`, so `MODEL_LITE.concat([...])` would have reordered a live ladder while
  looking like a faithful reproduction. Since §2.4 the two no longer share a tail at all —
  `MODEL_LITE` ends on `3.1-flash-lite` and `legacy` still ends on `2.5-flash` — which makes
  composing them worse, not safer: it would silently drag the 404ing 2.5 line back in.

### 4.4 What shipping it means

1. Re-port the live set with `--policy teaching` **from the 38-slug manifest, never `--all`** —
   `--all` yields 51 and would mint builds for unregistered phys-310 artifacts.
2. Verify: `gemini-model-ladder.mjs` detects which policy a build carries and asserts *that*
   policy's invariants. It does **not** accept both shapes for one build, which would make it a
   test of nothing.
3. **Delete `legacy`, its branch of the harness, and this subsection.** A flag kept past its
   occasion becomes a second supported configuration nobody is testing.

`APP_OPENING` ships with it, because `teaching` carries both. That is a bundling the flag chose,
not a necessity — see §6.

---

## 5. Carry-forward backlog for the artifact builder

**In priority order.** Each is a change to **A** (the kit) *and* a `patch_artifacts.py` step for
**B**, and each republish of **B** costs a human doing it by hand on claude.ai.

> **Republishing keeps the slug.** `activities.slug` is globally `UNIQUE` and every student report
> hangs off that one row, so minting a new one mid-term would orphan the work of every cadet who
> has already finished. Contract §3.2's "never reuse a slug" is a rule about a **new offering**,
> not about a patch. `patch_artifacts.py` asserts byte-equality of the slug line before it writes.

### 5.1 A request deadline — highest value, smallest change

No `AbortController` exists in any source. Wrap the `fetch` in `rawCall` in one, and on
`AbortError` mark the model spent and walk:

```js
if (e && e.name === "AbortError") { /* spent + step */ }
```

The Gemini build uses a two-minute deadline. **Why this is first:** it is the only one of the three
whose failure mode is unbounded — the others end in a wrong message, this one ends in nothing at
all, forever.

### 5.2 5xx walks the ladder

Add the step after the retries are spent, exactly as the 429 branch beside it already does. On
Gemini a 503 proved to be **per model, not per project** — an instructor's dashboard showed
`3.7-flash` refusing while lite served the same session normally. Whether Anthropic's 5xx behaves
the same way is unknown; stepping is the right response either way, because the retries have
already given the same model three chances.

### 5.3 An empty response walks the ladder

`if (!text) throw { kind: "request", status: 0 }` in `callTutor`. **This is the subtle one** — it
sits **above** `rawCall`, so it bypasses the ladder machinery entirely, which is precisely why it
was missed on the Gemini side for a full day.

Distinguish a **safety refusal** (a real answer: do not walk, tell the cadet) from an **empty
candidate** (a broken response: walk). The Gemini build checks `finishReason` / `blockReason` for
`SAFETY` and `PROHIBITED_CONTENT`; the Anthropic equivalent is `stop_reason`.

### 5.4 The output-token cap — a decision, not a defect

`MAX_TOKENS = 4096` in every source; the Gemini builds run 8192. The report is the largest
generation of the session and 4096 is the only cap in play. **Establish whether reports are
actually truncating before changing it** — the Gemini raise was reasoning, not measurement, and a
cap that is never reached costs nothing to leave alone. A truncated report is not obviously broken:
it submits, it grades, it is simply short.

### 5.5 The finish bar

Currently the Claude artifact ends a graded session with a **12-pixel link in the footer strip**,
beside "Enter to send":

```jsx
<div className="footer">
  <span className="footer-note">
    {mode === "graded" && hasReport ? "Timed portion complete — submit your report. …" : "Enter to send · …"}
  </span>
  {mode === "graded" && hasReport && (
    <span className="report-actions">
      {submitUrl ? <a className="submit-btn" href={submitUrl} …>Submit report →</a> : <span…>Preparing submit…</span>}
    </span>
  )}
</div>
```

The director asked on 2026-08-21 for a **large centred Submit with a "Keep talking" continue
beside it**, the continue dropping the cadet into ungraded study mode. That shipped on **C** only.
The Claude artifact already has study mode and `buildStudySystemPrompt`, so the change is UI plus a
mode switch — but note the confirm dialog: continuing before submitting must warn, because on
claude.ai there is no session snapshot to come back to (§6).

### 5.6 The lz-string loader

The source hook polls for 10 s, clears the interval, and **records nothing** — so a slow CDN
produced a finished report with a permanently missing submit button and no message explaining it.
The Gemini build retries three times at 40 s and surfaces a `failed` state the finish bar renders
as an instruction. On **B** the script comes from cdnjs at runtime, so this is *more* exposed
there, not less.

*(A test written against a pre-fix build reproduced the original bug: 3 failures and 66 seconds of
dead waiting.)*

---

## 6. Deliberately not carried across

**Do not "fix" these to match.** Each is a considered difference.

| Behaviour | Why C has it and A/B must not |
|---|---|
| **`APP_OPENING`** — the app writes the opening turns | A quota and latency optimisation for a metered third-party key. On claude.ai the prompt's own OPENING instruction is correct and the model writing it is the intended design. Adopting this in the kit would replace a live tutor turn with a canned one for no benefit |
| **`scriptedDelay`** pacing | Only exists because scripted turns cost no request and land instantly, which reads as broken. No scripted turns, no need |
| **Stripping the backup button** | C **is** the backup. A route from the backup back to itself is a loop |
| **`stampSubmitted`** | Meaningless without a session snapshot to stamp |
| **Three model pools** (`MODEL_CHAT` / `MODEL_STUDY` / `MODEL_REPORT`) | Claude has one two-rung ladder and no per-model daily quota to ration. The porter *removes* the inherited `stepModel` helper for exactly this reason — it names `MODEL_CANDIDATES`, which no ported build declares, and a free variable inside a function that only runs mid-session parses, renders, serves, and then throws on a cadet |

**Session persistence (row 7) is the genuinely open question.** On C it is a `localStorage`
snapshot the build owns end to end. On claude.ai an artifact's storage behaviour and lifetime are
not ours, so the same guarantee is not available on the same terms — which is why it is
**CONSIDER** in §2.2 and not **ADOPT**. Before building it, establish what an artifact may actually
persist and for how long. Do not assume the Gemini design ports.

---

## 7. How to verify any of this

`tests/browser-harness/`, puppeteer-core against real Chrome. **Node is optional tooling guaranteed
on no machine but the course director's** (CORE.md §2), so a Node-only check is never the sole
verification — **if it is all that ran, say so in the CHANGELOG entry.**

| Harness | Covers |
|---|---|
| `gemini-build.mjs` | one build renders: parse, mount, key field, no 404s |
| `gemini-model-ladder.mjs` | both ladders, the scorer, the 429 walk, 3.7's absence, all three spent-and-walk paths, `APP_OPENING` per policy. **Runs `scriptedDelay` rather than string-matching it** — a regression returning `0` would satisfy a substring check and ship the glitch |
| `gemini-finish-bar.mjs` | drives a graded session to its end with **no API key**, by seeding a finished session; asserts the bar, the submit stamp, the greeting, and the withheld-lz-string state |
| `gemini-handoff.mjs` | the three-link Claude→Gemini chain, asserting the router's forward separately from the build's restore |
| `lesson-editor.mjs` | Launch goes through the router, never a build path, always a slug the manifest carries |

**Two verification traps this project has already paid for:**

- **`node --check` silently passes invalid JSX.** Node auto-detects any file containing
  `import`/`export` as ESM and does not reject JSX on that path. **Publishing is the only JSX
  parser this project has**, and for a Gemini build the browser page is.
- **A green harness is not evidence about a path the harness never reaches.** Five phys-110 backups
  shipped, parsed, rendered, served and passed every assertion, then threw
  `ReferenceError: REPORT_MARKER is not defined` on the first tutor turn — because the reference sat
  inside a `useEffect` that returns early until a graded conversation is under way.

**Everything in §2.2 was verified Node-only. No real tutor turn has been run against any of it.**

---

## 8. Sources

Read these before acting on this file; it summarises them and they win where they disagree.

| | |
|---|---|
| `CHANGELOG.md` | 2026-08-19 → 2026-08-21, eighteen entries. The **why** for every row above |
| `scripts/artifacts/to_gemini.py` | the porter. §4's ladders are the `LADDER_TEACHING` / `LADDER_LEGACY` constants, quoted from the file |
| `scripts/artifacts/patch_artifacts.py` | the retrofit for **B**; its header lists the 2026-08-20 fix set as steps 0–8 |
| `.ai/skills/gemini-port/SKILL.md` | the runbook for producing **C** |
| `_builder/preflight-kit/skill/preflight-factory-v2/SKILL.md` | **A** itself — hash-locked in `MANIFEST.sha256` |
| `docs/contracts/INTERACTION-DATA-CONTRACT.md` | frozen. The submit wire format all three share |
| `.ai/instructions/PROJECT.md` | "Sharp edges the builder already paid for" |

**Two known defects are open on every surface** and are recorded in the 2026-08-21 (seventh)
CHANGELOG entry:

1. **A report wrapped in code fences blanks itself.** `extractPayload` pairs fences
   left-to-right, so a leading ` ```markdown ` makes the report an empty slice — which then fails
   every later turn.
2. **`isReportMsg` is a bare substring test.** A tutor merely *mentioning* the report heading
   latches `hasReport` early, so the real report is never detected.

Both are "the model did not follow the format exactly" bugs, both affect **A**, **B** and **C**,
and neither is fixed.
