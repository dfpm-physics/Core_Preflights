---
name: gemini-port
description: >
  GEMINI BACKUP BUILD — ports exactly one published Claude preflight artifact to a
  Gemini-API build hosted on our own site, for cadets whose free Claude account is
  answering HTTP 429. Reads the artifact `.jsx` from the gitignored
  `_builder/courses/<course>/artifacts/` cache (filled from the private
  `artifact-sources` bucket) and that course's `index.json`; writes
  `site/gemini/<course>/<slug>.html`, a row in `site/data/backup-builds.json`, and a
  `CHANGELOG.md` entry. Use when cadets cannot reach the Claude tutor at all, when a
  lesson needs a fallback before its deadline, or when a fix to the porting tool means
  existing builds must be regenerated. Triggers: "make a backup version of this lesson",
  "gemini backup", "cadets are getting 429", "port the artifact to Gemini", "regenerate
  the backup builds", /gemini-port. NOT for building or republishing the Claude artifact
  itself — that is the course's Claude Project and `_builder/preflight-kit/`; NOT for
  registering a lesson so cadets can reach it, which is a director's job in
  `site/faculty/lessons.html` (see `docs/contracts/INTERACTION-PREFILL-LINK.md`). The
  artifact must already be PUBLISHED and its slug already minted — this skill never mints
  one. Any agent may run it; requires the local source cache and a real browser to verify
  in. Argument: a course plus one of `--slug`, `--lesson N`, `--from-lesson N`, `--all`.
---

# gemini-port — one published artifact, one hosted backup build

> This skill owns the **transport swap**: taking one already-published lesson artifact and emitting the same lesson as a page on our own site that talks to Google's Generative Language API with the cadet's own free-tier key. It does not own building or republishing the artifact (the course's Claude Project and `_builder/preflight-kit/`), it does not own registering the lesson (a director, via the prefill link), and it does not own anything downstream — the backup submits under the same slug, so `/preflight-analyze` and `/lesson-aggregate` cannot tell the two apart and must not have to.

Where this skill and [`CORE.md`](../../instructions/CORE.md) disagree, `CORE.md` wins.

---

## Why this exists, and what it is not

Cadets on free Claude accounts get HTTP 429 when demand is high, and a cadet who cannot reach the tutor cannot do the preflight at all. The backup build is the **same lesson** — same tutor prompt, same grounding, same report, same submit contract — with only the transport changed.

**It is a fallback, not an alternative.** The published Claude artifact stays the intended path: its start screen offers the backup only after its own connection check has already failed, and both the router page and the build's own banner say so on their face. Nothing about a cadet's grade, submission, or rollup contribution changes either way — which is the point, and is what makes the "same slug" rule below non-negotiable.

## When NOT to run it

| situation | why not |
|---|---|
| the artifact is not published yet | there is no minted slug to submit under, and a build against a draft would need re-porting the moment the real one publishes. Publish first. |
| the Claude build works and the lesson is not registered | a backup for a lesson no cadet can reach is a page nobody opens. Registration is the missing step; ask the director for it. |
| the generated HTML is wrong in some detail | do not edit it. Fix `to_gemini.py` and regenerate (Step 3). |
| the artifact's *content* is wrong | that is a rebuild on claude.ai — a **new slug**, a new lesson row, and a decision only the course director makes. A backup build cannot fix a content bug. |
| the change is irreversible or shared-state | that is `safe-change`. Writing files under `site/` is a two-way door; publishing on claude.ai is not. |

---

## Step 0 — Preflight

Confirm all of these. **If any fails, stop and report which one**, with the remedy.

| check | how | if missing |
|---|---|---|
| the artifact is **published**, and its slug read rather than typed | its row in `_builder/courses/<course>/index.json` has a `published_url`. **Never type a slug** — PROJECT.md's sharp-edge table records `phys310-atoms-and-nuclei-83022f32`, minted from a hand transcription of a word that was never in the source, and `check_artifact.py` validates a slug's *shape*, never its *derivation* | the index carries drafts too (phys-310: 17 rows, 3 published). A row with no `published_url` is a draft — stop, and say which lesson it was |
| the local source cache exists | `ls _builder/courses/<course>/artifacts/*.jsx` | `python scripts/artifacts/sync_artifacts.py pull --into _builder/courses --commit` (Step 1) |
| the vendored runtime is present | `ls site/vendor/{react.production.min.js,react-dom.production.min.js,babel.min.js,lz-string.min.js}` | stop — the page loads all four from our own origin and renders nothing without them. Do **not** substitute a CDN: same-origin is what stops a third party swapping the script that can read the cadet's key out of `localStorage` |
| the working tree is clean enough to read a diff | `git status --porcelain` | not fatal, but you must be able to attribute every line of Step 5's diff. Uncommitted work belonging to a human stays uncommitted (`CORE.md` §0) |
| a browser is available to verify in | you will need one at Step 4 | stop — an unverified build is not shippable, and there is no substitute check (Step 4) |

> Stopping. `gemini-port` needs the artifact source for `phys-215` and `_builder/courses/phys-215/artifacts/` is empty. Run `python scripts/artifacts/sync_artifacts.py pull --into _builder/courses --commit`, then re-run `/gemini-port --course phys-215 --lesson 5`.

---

## Step 1 — Get the source, as bytes

`.jsx` source is **not in git**. It lives in the private `artifact-sources` Storage bucket, and `_builder/courses/<course>/artifacts/` is a gitignored local cache (`CORE.md` §2):

```
python scripts/artifacts/sync_artifacts.py pull --into _builder/courses --commit
```

That reads the service-role key from `~/.claude/skills/preflight-analyze/config.json` (`CORE.md` §3). **When that config is absent** — a machine that has never run `/setup-preflight` — the fallback is to authenticate as a staff account and read Storage over REST: migration 023's policies grant `app.is_staff()` read on the bucket, and the object route is `/storage/v1/object/artifact-sources/<path>`, bucket segment included. A wrong path returns `NoSuchBucket`, which is the *same* error a missing `storage.buckets` policy gives — do not read it as a permissions problem until you have checked the route.

**Read and write bytes, never text.** `open(p, encoding="utf-8").read()` applies universal newlines, and PROJECT.md's sharp-edge table records what that cost here: a twelve-string substitution across three artifacts landed as **6,327 insertions and 6,327 deletions** — every line of every file, with the three real changes invisible inside it, and nothing erroring. phys-215 sources are CRLF and phys-310 and phys-110 sources are LF; `to_gemini.py` detects and preserves whichever it finds, and refuses a mixed file rather than guessing.

**Two artifact DIALECTS exist, and the transforms tolerate both.** *(Learned 2026-08-19, porting PHYS 110.)* Artifacts built from `_builder/preflight-kit/` declare the four grounding blocks with `String.raw`, hoist the report marker into `REPORT_MARKER`, label the report format with an `OUTPUT_REPORT_FORMAT` line, and keep each call's arguments on one line. **PHYS 110's five artifacts were built outside this repository** by an earlier revision of the same skill and do none of those things — plain template literals, the marker inlined in `isReportMsg`, no label line, arguments wrapped across several lines, and the declaration `const INTERACTION_ID =` on its own line.

Every anchor is now whitespace- and comment-tolerant, and where the difference is real rather than cosmetic the tool **preserves what it finds** instead of imposing the kit's form — the `OUTPUT_REPORT_FORMAT` label is carried through exactly as present or absent, because that line is prompt text the cadet's tutor reads and adding it would be a change of substance, not transport. What is emphatically **not** loosened is content: the four grounding blocks are still compared byte-for-byte before and after.

> **A third dialect is likely, and the tell is the same.** When a transform reports `matched 0, expected 1`, compare the two files at that anchor before touching anything: the difference has so far always been layout (a blank line, an alignment space, a trailing comment, a wrapped argument list). Loosen the LAYOUT; never the tokens.

> **The dialect also constrains what the injected code may NAME, and that is the half that got missed.** *(2026-08-19, the same day and the same port.)* The tool chose its anchor by dialect correctly — `REPORT_MARKER` where the kit declares it, `isReportMsg` where PHYS 110 does — and then injected a detector that read `m.content.includes(REPORT_MARKER)` in both. In the PHYS 110 dialect that is a free variable. All five builds shipped, because the reference sits inside a `useEffect` that returns early until a graded conversation is under way: they parsed, rendered, served, and passed every assertion, then threw `ReferenceError: REPORT_MARKER is not defined` on the first tutor turn, where the page's `window.onerror` handler replaced the whole lesson with *"This backup build did not load"*. **Injected code may only name what BOTH dialects declare** — prefer the source's own helper (`isReportMsg`) over a constant only one of them hoists. The tool now asserts this against the output and refuses; see the refusal table below.

---

## Step 2 — Dry-run, and read what it prints

Dry run is the default; `--commit` is the only thing that writes.

```
python scripts/artifacts/to_gemini.py --course phys-215 --lesson 5 -v
```

| selector | what it takes |
|---|---|
| `--course <id>` | one course (`phys-215`, `phys-110`, `phys-310`). Required unless `--all-courses` |
| `--all-courses` | every course that has an `index.json` |
| `--slug <slug>` | exactly one artifact, by its minted slug |
| `--lesson N` | the artifact whose `lesson_no` is N |
| `--from-lesson N` | every artifact with `lesson_no >= N` — the one to reach for after a tool fix, when only the newer artifacts share the factory shape the anchors were written against |
| `--all` | every artifact in the course |
| `-v` | print each transform as it matches, by name. Use it the first time you port a lesson; the names are what a later failure will cite |
| `--commit` | write. Without it nothing is written, including the manifest |

One of `--slug`, `--lesson`, `--from-lesson` or `--all` is required — the tool refuses to guess a scope.

Read the output before committing:

- one line per artifact: lesson number, slug, output size, and `WOULD WRITE` / `unchanged`;
- `SKIP <slug>: no local source` means the cache is short of the index — go back to Step 1 rather than porting a subset by accident;
- with `-v`, every transform that matched. A **missing** name is not printed, because a transform that does not match aborts the whole run (Step 3's failure table).

---

## Step 3 — Write, and never hand-edit the result

```
python scripts/artifacts/to_gemini.py --course phys-215 --lesson 5 --commit
```

Outputs, both committed:

| path | what it is |
|---|---|
| `site/gemini/<course>/<slug>.html` | the self-contained page: the ported JSX inside a wrapper that loads React and Babel from `site/vendor/`, compiles in the browser, and surfaces any parse error into a visible `#boom` banner |
| `site/data/backup-builds.json` | the slug → build map `site/student/backup.html` resolves `?i=<slug>` against |

**Idempotency: a byte-compare.** A build whose output already matches is reported `unchanged` and not rewritten, so re-running is free and produces no diff.

**The manifest is add-and-update only.** The tool never removes an entry. **Withdrawing** a backup — a build found to be broken mid-term — is therefore a hand edit: delete its key from `backup-builds.json` (and, if you mean it, the HTML), commit, and the router falls back to "No backup for this lesson yet". The router fetches the manifest with `no-store` and a cache-buster, so the withdrawal takes effect as soon as Pages rebuilds.

**Regenerate; never hand-edit the HTML.** It carries a DO-NOT-EDIT banner and the next run overwrites anything you put there. Every fix — wording, layout, transport behaviour — goes into `to_gemini.py`, where it applies to every build instead of one.

**A backup build is not a republish and mints no slug.** A factory rebuild of a Claude artifact means republishing on claude.ai: a new artifact URL, a new 8-hex slug, and a new lesson row (`PROJECT.md`, the builder's rules). Regenerating a backup is a file change on our own site. **That asymmetry is why the artifact links to a router** (`site/student/backup.html?i=<INTERACTION_ID>`) rather than to a build directly — the artifact knows only two things that never move, this page and its own slug, and everything mutable lives where it can be edited cheaply.

**Building the backup does not put a door to it in the artifact.** The button that appears when the Claude connection check fails comes from the artifact's own source: new artifacts get it from the factory skill, and already-published ones get it from `scripts/artifacts/add_backup_button.py` — whose patch reaches cadets **only when a human republishes that artifact**, because claude.ai serves what was published, not what is in this repository. That republish keeps the slug (a hand patch is not a factory rebuild) but moves the claude.ai URL, so the lesson's `activities.artifact_url` must be updated with it. Until then the route to a backup is the router URL handed out directly. Read that script's header before planning around it; it is a separate unit of work from this skill.

### What the tool refuses to do, and what each refusal means

It **refuses rather than warns** — every one of these is a `SystemExit` before anything is written.

| message | what actually happened | the fix |
|---|---|---|
| `FAILED [<transform name>]: matched N, expected 1` | the artifact's shape has drifted from the factory output the anchor was written against | fix the anchor in `to_gemini.py`. **Never hand-edit the artifact to fit the tool** — the artifact is the published record, and editing it desynchronizes the cache from Storage |
| `could not locate <BLOCK>` | one of the four grounding blocks is not where it is expected | same: an anchor problem, not an artifact problem |
| `<BLOCK> is a plain template literal containing ${...}` / `containing backslash escapes` | the source declares a grounding block with `` ` `` rather than `String.raw` **and** its text would be processed differently by the two forms | stop. The two are interchangeable only for content carrying neither, and porting it as raw would silently change what the tutor is grounded in. Added 2026-08-19 |
| `grounding block <X> was altered - aborting` | a transform's replacement text bled into `TEXTBOOK_REFERENCE`, `LESSON_CONFIG`, `EXTENSION_PROBLEMS` or `REPORT_FORMAT` | narrow the anchor. These four are compared byte-for-byte before and after, because **only the transport may change** |
| `INTERACTION_ID does not match slug` / `INTERACTION_ID changed` | the source's slug is not the one being ported under | stop. See the rule below — this is the one that silently halves a rollup |
| `SUBMIT_ENDPOINT changed` / `Anthropic transport still present` | the frozen submit URL moved, or the Claude transport survived the port | a bug in the transform; do not work around it |
| `API key reachable from the payload: <line>` | the cadet's key appeared on a line that builds the submit URL or the compressed payload | a real defect. Fix it; do not relax the assertion |
| `mixed line endings (N CRLF of M LF)` | the cached source is already corrupted, almost certainly by a text-mode write | re-pull the source (Step 1) |
| `module syntax remains` | `import`/`export default` survived into the page, which a Babel classic script cannot run | a bug in `wrap()` |
| `injected code calls <NAME> but this build never declares it` | a transform emitted code naming something this dialect does not define — the `REPORT_MARKER` failure | fix the injected code to name what BOTH dialects declare. **Do not delete the entry to make it pass**: this refusal is the only thing standing between a free variable and a cadet, because such a build parses, renders and serves before it throws. Added 2026-08-19 |

**The same slug is the load-bearing invariant.** Contract §3.2 mints a slug per **offering**, not per transport. A backup that submitted under a second slug would split one lesson's cohort into two and silently halve every rollup — the numbers would look plausible and nothing would report it. The tool asserts `INTERACTION_ID` is unchanged and refuses.

---

## Step 4 — Verify in a real browser. This is the step that matters.

PROJECT.md's sharp-edge table records that **`node --check` returns exit 0 on invalid JSX** — Node auto-detects any file containing `import`/`export` as ESM and does not reject JSX on that path — which is why "publishing is the only JSX parser this project has". A backup build never gets published on claude.ai, so **the Babel-in-browser page is now that parser**, and a build is unverified until it has been loaded and rendered.

```
python -m http.server 8000          # repo root
# open http://localhost:8000/site/gemini/<course>/<slug>.html
```

Check, in order:

1. **No `#boom` banner.** Babel parse errors land on `window.onerror`, not in the page; the wrapper catches them and shows them. A banner is a hard fail with the message in it.
2. **`#root` actually rendered** — it has children, not just the boot placeholder. Parsing and rendering are different failures and the first can pass while the second does not.
3. **The start screen is intact**: last-name field, the API-key field (`type="password"`), the honor box, the connection light. The key field is what the port adds; the rest is what it must not have broken.
4. **The page does not scroll.** The artifact sizes itself to `window.innerHeight` for claude.ai's embed; the wrapper neutralizes that. If the document scrolls, the composer is below the fold and the lesson is unusable.
5. **The shipped bytes still carry the contract**: the slug, the `interaction-submit.html` endpoint, and `generativelanguage.googleapis.com` present; `api.anthropic.com` absent.
6. **One real turn**, with a free-tier key, at least once per porting-tool change: the connection light resolves to `Ready — <model>`, the tutor answers, and the close sequence produces a report.

Two harnesses cover part of this: `tests/browser-harness/gemini-build.mjs` renders one build in real Chrome (parse, mount, key field, no-scroll, no 404s), and `tests/browser-harness/gemini-model-ladder.mjs` lifts the model block out of a shipped build and exercises the ladders, the scorer and the 429 walk without a key — the logic a browser cannot reach. Neither replaces item 6. This can be driven rather than clicked — `tests/browser-harness/` already runs puppeteer-core against real Chrome, and `tests/browser/` holds the checked-in test pages. A driver that asserts (1) and (2) plus the source strings in (5) is worth having. But Node is **optional** tooling that is guaranteed on no machine but the course director's, and per `CORE.md` §2 a Node-only check is never the sole verification of a change — **if it is all that ran, say so in the `CHANGELOG.md` entry** so the next operator knows what is still unproven.

---

## Step 5 — Commit and record

**Read `git diff --stat` before staging.** A diff the size of the file is a line-ending rewrite until proven otherwise — that is exactly how the 6,327/6,327 incident presented, and the working tree looked correct throughout. Account for every line, and stage explicit paths: `git add -A` has already once committed a human's unrelated edit under an agent's message.

Commit `site/gemini/<course>/<slug>.html`, `site/data/backup-builds.json`, and any change to `scripts/artifacts/to_gemini.py`. The `.jsx` sources are gitignored and stay that way.

Add a `CHANGELOG.md` entry per `CORE.md` §5 — newest first, `## YYYY-MM-DD — <Human> via <Agent>` — carrying what was ported (course, lessons, count), why, what was verified and how, and **what was not**. Push only when asked (`CORE.md` §5; the standing authorization there covers verified `preflight-analyze` runs, not this).

`main` is live: the build is reachable ~1–2 minutes after the push, and the router picks up the manifest immediately after that.

---

## Two properties of the output that look like mistakes and are not

**The page is public, deliberately.** A cadet reaches it *because* Claude has already failed them, so it cannot require a PREP sign-in — there is no session yet, and a second obstacle in front of someone already blocked is the failure this whole path exists to prevent. That exposes the tutor prompt and the extension problems to anyone with the URL, which is the **same exposure the published Claude artifact already carries** (PROJECT.md: "the source is not secret — claude.ai shows an artifact's formatted code behind a Code button"). What stays private is the build **record** — grounding page numbers, `BUILD-LOG.md`, `REVIEW-NOTES.json` — and none of it is copied into the page. The page is `noindex`'d so worked extension problems do not become searchable; **that is not a security control** and must never be described as one. The real gate is unchanged and still at the end: submission requires a signed-in student, and RLS decides whose row it is.

**The cadet's API key never touches the payload.** It lives in a module-scope ref and in `localStorage` under `prep.gemini.apikey`, and it rides in an `x-goog-api-key` **header** — never the `?key=` query string Google's quickstarts use, because a query string lands in browser history and in any `Referer` the page emits. Same authentication, strictly less leakage. PREP never receives it, so **PREP never becomes the custodian of hundreds of third-party credentials**. The cost of that choice, stated plainly because cadets will hit it: a new device means entering the key again, and Safari's ITP drops `localStorage` after 7 days without a visit. A "Forget key" control exists for shared machines. The build asserts the key never appears on a line that constructs the submit URL or the compressed payload.

## Why the prompt is deferred, and where the deferral stops

The graded system prompt is ~63,000 characters and is **resent every turn** — 93–96% of all input tokens in a session. **This is not what exhausts a free-tier key**, though it was recorded here as the cause until 2026-08-20: measured on a real key, a session used 66.7k of a 250,000 token-per-minute ceiling and still stopped dead — on the daily REQUEST cap, which the next section covers. Sending fewer tokens per turn is still worth doing, and it is what makes the cheapest models reachable at all, but it does not buy a cadet a second session. Gemini's explicit context caching cannot help: it needs a paid account and a 32,768-token floor, and rate limits count cached tokens anyway. The only lever is sending less.

So the port defers the two **tail** blocks — `EXTENSION_PROBLEMS` and `REPORT_FORMAT`, about 11,400 characters or ~18% of every turn — until the phase that needs them. They sit at the very end of the prompt, which is why they can be dropped without disturbing a line above.

The trigger is the tutor's **verbatim integrity question**, which the prompt requires it to ask and then *wait* for. That mandated wait is the whole mechanism: it buys one turn of lead time, which is exactly enough to put `REPORT_FORMAT` back in context before the report is written. The backstop is elapsed active time past the whole planned budget, after which deferral stops regardless — a report emitted with no format in context is a broken submission, and the tokens saved are not worth that risk.

**If you change the tutor prompt's close sequence, you have changed this.** The fingerprint (`INTEGRITY_ASKED`) matches the question's opener with one alternate; a reworded close silently disables the primary trigger and leaves only the time backstop.

## Which model a turn uses, and why it is not the newest

**Free-tier quota is per MODEL, not per key.** Every row in the AI Studio dashboard carries its own RPM/TPM/RPD counter, and the daily figures differ by more than an order of magnitude. Measured on a real cadet key, 2026-08-20:

| Model | RPM | RPD |
|---|---|---|
| Gemini 3.7 / 3.6 / 3.5 / 3 Flash, 2.5 Flash, 2.5 Flash Lite | 5–10 | **20** |
| Gemini 3.5 Flash Lite, 3.1 Flash Lite | 15 | **500** |

One tutor session is 10–14 requests. So a 20/day model gives a cadet **one session** and then locks them out until the daily reset at midnight Pacific — which is 1:00 AM in Denver, i.e. *after* a 2359 deadline has already passed. A section hit exactly this on 2026-08-20, at 21 requests against a cap of 20.

**The port used to pick the worst available model, and nothing could see it.** `scoreModel` awarded +25 to any name containing `latest`, so `gemini-flash-latest` outranked every pinned name. Google hot-swaps that alias to whatever shipped most recently — their own docs say it "can be a stable, preview or experimental release" — and a new Flash launches on the tight 20/day quota. So cadets were moved onto a 20/day model *by Google*, with nobody choosing it and nothing reporting it. The `MODEL_REJECT` regex screens names containing `preview`, and never fired: the alias does not **say** preview, it merely **resolves** to one. A name-based screen cannot see through an alias.

**So both ladders are ordered by quota, not by capability.** `MODEL_CHAT` carries the ~12 conversation turns and starts on the 500/day lite models. `MODEL_REPORT` is used for the single request that produces the graded report — the artifact the cohort rollup reads — so it starts on the strongest model the key has, can afford a 20/day cap at one request per session, and falls through into the chat pool rather than failing. A report from a weaker model beats no report. `sysFor()` chooses the pool from the same phase that chooses the prompt, because they are one decision.

**A 429 now moves down the ladder instead of ending the session.** Gemini returns 429 for both the per-minute and the per-day limit and does not say which. The transport retries with backoff first — a per-minute limit clears, and the same model is still the right one — then marks that model spent and steps to the next rung, which carries an independent quota. Spent models stay spent for the session, so the extension phase cannot re-burn one already known exhausted. Only a fully walked ladder raises `quota`. Before this, a cadet was stranded at 20 requests while 500 sat unused one rung down.

**Neither ladder is hard-coded in effect.** `discoverModel()` intersects both with what `ListModels` says the key can actually reach, and if it can reach nothing on either, falls back to scoring the listing — which now prefers `lite` and penalises `latest`. That keeps the property runtime discovery existed for: **this build cannot dead-end on a retired name.** It also means a mistyped or renamed model degrades quietly instead of breaking, so **verify a ladder name against a real key rather than trusting it** — nothing will tell you it was never reached.


---

## Rules

1. **Same slug, always.** The backup submits under the published artifact's `INTERACTION_ID` (contract §3.2 — one slug per *offering*, not per transport). A second slug splits one cohort into two and silently halves every rollup, with plausible-looking numbers and no error. Enforcement: the tool asserts and refuses (Step 3).

2. **Only the transport may change.** `TEXTBOOK_REFERENCE`, `LESSON_CONFIG`, `EXTENSION_PROBLEMS` and `REPORT_FORMAT` are compared byte-for-byte before and after, because a grounding drift changes what the cohort was actually taught while every downstream number keeps working. Enforcement: abort on any difference (Step 3).

3. **Bytes in, bytes out.** Never read or write an artifact in text mode: universal newlines rewrote every line of three files (6,327/6,327) and hid three real changes inside it, with no error and a correct-looking working tree. Enforcement: `git diff --stat` before staging — a diff the size of the file is a line-ending rewrite until proven otherwise (Step 5).

4. **JSX text is not a JS string.** JSX text and attributes do **not** process escape sequences, so `—` written there renders as those six literal characters; real JS string literals do. Use HTML entities (`&mdash;`, `&rarr;`) in JSX text and attributes, `\u` escapes only inside real JS strings, ASCII only in comments. This cost two separate debugging rounds (Step 3).

5. **A build is unverified until a browser has rendered it.** `node --check` passes invalid JSX at exit 0, so the Babel-in-browser page is this project's only JSX parser for a backup build — and a page that parses can still render nothing. Check the `#boom` banner *and* `#root`'s children, plus the contract strings in the shipped bytes (Step 4). A Node-only check is never the sole verification, and if it is all that ran, the CHANGELOG says so (`CORE.md` §2).

6. **The key stays out of the payload and out of the query string.** Header only, `localStorage` only, never sent to PREP — PREP declining custody of hundreds of third-party credentials is a deliberate design position, not an oversight, and the re-entry cost on a new device is the price of it (Two properties, above). Enforcement: the tool scans for `apiKey` on any line that builds the submit URL or the compressed payload and refuses (Step 3).

7. **Public page, private build record.** The generated HTML is public on purpose — a cadet arrives with no session — and carries the same exposure the published artifact already has. Nothing from the build record goes into it, and the `noindex` is search hygiene, not a control (Two properties, above).

8. **Regenerate, never hand-edit.** The output carries a DO-NOT-EDIT banner and the next run overwrites it. Every fix belongs in `to_gemini.py`, where it reaches every build instead of one (Step 3).

9. **An anchor failure is shape drift, not a bad artifact.** When a transform reports `matched 0, expected 1`, fix the anchor — never edit the artifact to fit the tool, because the artifact is the published record and editing the cache desynchronizes it from Storage (Step 3).

10. **The manifest only grows unless a human shrinks it.** Withdrawing a backup is a hand edit to `site/data/backup-builds.json`; the tool will not do it, and the router's fallback ("No backup for this lesson yet") is the correct visible outcome (Step 3).

11. **A backup build is not a republish.** It mints no slug, needs no new lesson row, and cannot fix a content bug — that is a rebuild on claude.ai and a director's decision (When NOT to run it).

12. **Log it.** `CHANGELOG.md` per `CORE.md` §5: what was ported, why, what was verified and how, and what was left unproven. Push only when asked (Step 5).

---

**References:** [`scripts/artifacts/to_gemini.py`](../../../scripts/artifacts/to_gemini.py) — the tool this skill drives, whose module docstring is the authority on what it asserts; [`site/student/backup.html`](../../../site/student/backup.html) — the router, and why the indirection exists; [`docs/contracts/INTERACTION-DATA-CONTRACT.md`](../../../docs/contracts/INTERACTION-DATA-CONTRACT.md) §3 — the frozen submit contract and the per-offering slug rule; [`.ai/instructions/PROJECT.md`](../../instructions/PROJECT.md) § "Sharp edges the builder already paid for" — the line-ending, `node --check`, and transcription failures this skill guards against.
