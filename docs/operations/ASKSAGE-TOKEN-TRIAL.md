# Ask Sage token trial — where the key lives, and what a lesson costs

**Status:** trial, opened 2026-09-11. Nothing here is in front of a cadet.
**Reader:** a course director holding (or about to request) an Ask Sage API key, who needs to put
it somewhere safe and find out whether the 10M-token monthly pool can carry iPREP.

Today every cadet running a backup lesson pastes **their own** Google API key into the page. Ask
Sage would replace that with one institutional key nobody has to see. This runbook is how that key
is stored, and how the cost of using it is measured before anyone commits to it.

---

## 1. Where the key goes — and why it cannot go anywhere else

**The key is a Supabase secret. It never reaches a browser and is never committed.**

The site is static HTML on GitHub Pages (CORE.md §2). Anything the browser can read, anyone can
read — a key in `site/js/config.js`, in a JSON data file, or fetched from Storage is a key
published to the internet the moment `main` is pushed. `site/js/config.js` holds a key today only
because the anon key is *designed* to be public and is fenced by RLS. An Ask Sage key has no such
fence: it is a bearer token against a shared spending pool.

So the key lives in the environment of one edge function, `supabase/functions/asksage-proxy/`:

```
supabase secrets set ASKSAGE_API_KEY=<the key>
supabase functions deploy asksage-proxy
```

**One key serves every model.** The model is a request *field*, not a credential, so switching
from `gemini-3.5-flash` to `claude-opus-4-6` changes a dropdown and nothing else. Rotating the key
is one `secrets set` and no redeploy of anything.

Two optional secrets, both with safe defaults:

| Secret | Default | What it does |
|---|---|---|
| `ASKSAGE_MODELS` | `gemini-3.5-flash,claude-opus-4-6` | Allowlist. A caller cannot reach a model nobody has costed by typing its name. |
| `ASKSAGE_REQUIRE_STAFF` | `1` (on) | Staff-only. **Leave it on during the trial.** |

**Why staff-only matters more than it looks.** One iPREP session is measured in *hundreds of
thousands* of tokens (§3). An endpoint any signed-in cadet can call is an endpoint that can empty
the month's pool in an afternoon, by accident, with nothing to stop it. Opening it to students is
a deliberate later change, made once the arithmetic is known **and** a per-student cap exists.

The proxy stores **no conversation text**. CORE.md §3 bars free-text student writing paired with
an identity, and a proxy that logged prompts would be a table full of exactly that. Token counts
come back to the caller and are tallied in the browser; nothing is written to any table.

---

## 2. Running the meter

`tests/browser/test-asksage-tokens.html`, linked from **Test views** in the user menu (global
admins) or directly at `/tests/`.

```
python scripts/asksage/extract_prompts.py --all --commit      # sizes for all 47 lessons
python scripts/asksage/extract_prompts.py --course phys-215 --lesson 02 --commit   # + its text
python -m http.server 8000                                    # from the repo root
```

Then open `http://localhost:8000/tests/browser/test-asksage-tokens.html` and sign in as a
director.

The page sends a **real** lesson's tutor system prompt — the one the published backup build
actually sends, pulled out of the build by `extract_prompts.py`, not a sample and not a guess —
and reads the `usage` object off every reply. Send turns by hand, or press **Simulate a full
session** for the fourteen-request arc the published builds measured for themselves. Export CSV
when done.

Three things the page does on purpose:

- It **never estimates what it can measure.** The 4-chars-per-token figure appears only before the
  first call, labelled an estimate. Every total after that is Ask Sage's own `prompt_tokens` and
  `completion_tokens`.
- A reply with **no** `usage` object is reported as *usage missing*, not counted as zero. A silent
  zero would read as a free turn, which is the single most misleading number this trial could
  produce.
- The projection panel shows **nothing at all** until at least one turn has been measured.

Smoke test for the page itself (never sends a turn, so it spends nothing):

```
node tests/browser-harness/asksage-meter.mjs
```

---

## 3. The arithmetic, before you spend a token

**The system prompt is re-sent on every turn.** That single fact dominates everything else. A
tutor session is not one big request; it is ~14 requests, each carrying the whole grounding
document again, plus everything said so far.

Measured with `extract_prompts.py` across all 47 built lessons, 2026-09-11:

| | Lesson | Prompt | Estimated tokens |
|---|---|---|---|
| smallest | phys-110 L17 conservation of energy | 41,539 chars | ~10,400 |
| median | phys-215 L2 electric charge | 69,691 chars | ~17,400 |
| largest | phys-215 L15 DC circuits | 147,652 chars | ~36,900 |

For the **median** lesson, over 14 requests, with the conversation growing behind it:

```
input   14 x 17,400  +  growth of the history   ~= 275,000 tokens
output  13 short turns + one large report       ~=   6,400 tokens
                                                 ----------------
one cadet, one lesson                            ~= 281,000 tokens
```

Against a 10,000,000-token month:

- **~35 sessions per month.** One lesson, for about 35 cadets.
- 300 cadets × **one** lesson ≈ 84M tokens — **8.4 months** of pool.
- 300 cadets × 40 lessons ≈ 3.4B tokens — roughly **340 months** of pool.

The smallest lesson in the catalogue improves this by about 40%, which does not change the
conclusion. **The pool as it stands is a pilot budget, not a term budget.** Confirm it with the
meter before acting on it — these are character estimates and the measured figure may differ by a
fifth in either direction — but a fifth is not the gap that matters here.

### What actually moves the number

Listed in order of how much they move it. Note that **the model is not on this list**, which is
the least obvious thing in this document.

1. **The size of the system prompt.** It is 60-95% of the spend. Cutting `TEXTBOOK_REFERENCE`,
   `LESSON_CONFIG` and the 24k-character instruction preamble is the only lever with an order of
   magnitude in it.
2. **Prompt caching**, *if* Ask Sage exposes it and *if* cached input is discounted against the
   pool rather than merely against a bill. Both are unknown and both are worth one email. A ~10×
   cut on input is the difference between a pilot and a term.
3. **The number of turns.** Fourteen requests is the design, not an accident — a shorter
   conversation is a different lesson, not a cheaper one.
4. **Reasoning/thinking tokens**, which bill as output. A reasoning-heavy model on fourteen turns
   can multiply the output column several times over. This is the one place the model choice bites.

---

## 4. Choosing a model

**Switching models barely moves the pool, and that surprises people.** The pool is denominated in
*tokens*, not dollars. The same lesson sends the same prompt and the same history whichever model
answers, so the input column — the 95% — is very nearly identical for `gemini-3.5-flash` and
`claude-opus-4-6`. What a cheaper model saves is *money per token*, which is not the constraint
here. What a model genuinely changes is **speed** and **how many thinking tokens it burns**.

**Recommended: `gemini-3.5-flash` for the conversation.** Not on price — on evidence already in
this repo. The published backup builds ladder `gemini-3.6-flash` → `gemini-3.5-flash` and run real
cadet sessions on them. `gemini-3.7-flash` was tried as the top rung on 2026-08-21 and the course
director's verdict was immediate: the first reply took long enough that the page reads as broken,
on every turn, for a quality difference nobody could point to. Slower is not more thorough; a
tutor a cadet gives up waiting on teaches nothing.

**Consider `claude-opus-4-6` for the report turn only.** The report is **one** request per session
— the graded artifact the cohort rollup reads — and it is the one generation where thoroughness is
worth paying for. The Gemini builds already split this way (`MODEL_CHAT` vs `MODEL_REPORT`), so it
is a pattern this system has, not a new idea. One Opus request in fourteen costs about 7% of the
session; one Opus request in *every* turn costs the speed of the whole lesson.

**Is there something better?** Possibly, and the answer is one call away rather than a guess:

```
curl -X POST "https://api.asksage.ai/server/get-models" -H "x-access-tokens: $ASKSAGE_API_TOKEN"
```

Look for a **flash-lite-class** model for the conversation turns. The Gemini builds already use
exactly that tier as their floor and rate it usable, and it is the only change on the model axis
likely to help latency without costing thoroughness where thoroughness is measured. Add whatever
you find to `ASKSAGE_MODELS` and put it head-to-head in the meter — same lesson, same script,
compare the CSVs.

---

## 5. What the trial has to decide

1. **Does Ask Sage bill cached input against the pool?** Ask them. It is the single question with
   an order of magnitude behind it.
2. **Does the stateful Responses API (`/server/openai/v1/responses`) re-bill the history on every
   turn?** If not, that is the second order of magnitude.
3. **What is a realistic pilot?** At ~281k tokens a session the pool carries about 35 sessions a
   month — one section, one lesson, comfortably. That is a genuine offer and it is worth making.
4. **Is the prompt reducible?** Nothing has ever asked that question of it, because until now the
   cadet was paying.

Answers land in `CHANGELOG.md`; a decision to adopt lands in `docs/decisions/`.

---

## Related

- `supabase/functions/asksage-proxy/index.ts` — the proxy, and the key's only home
- `scripts/asksage/extract_prompts.py` — pulls real prompts out of the builds
- `tests/browser/test-asksage-tokens.html` — the meter
- `tests/browser-harness/asksage-meter.mjs` — smoke test for the meter
- `docs/operations/TUTOR-BEHAVIOR-PARITY.md` — which tutor surface owns which behaviour
- `.ai/skills/gemini-port/SKILL.md` — the existing backup-build route this would replace
