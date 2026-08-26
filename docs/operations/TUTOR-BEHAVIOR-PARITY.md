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
