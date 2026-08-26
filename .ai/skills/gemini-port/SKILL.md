---
name: gemini-port
description: >
  GEMINI BACKUP BUILD — ports exactly one published Claude preflight artifact to a
  Gemini-API build hosted on our own site, for cadets whose free Claude account has no
  usable model left. (An HTTP 429 no longer ends a Claude session by itself — since
  2026-08-20 the artifact walks its own model ladder first — so this is where an
  exhausted ladder ends, not where the first 429 does.) Reads the artifact `.jsx` from
  the gitignored `_builder/courses/<course>/artifacts/` cache (filled from the private
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
  one — and its source must already carry the 2026-08-20 fix set
  (`scripts/artifacts/patch_artifacts.py`), which the porter now inherits rather than
  performs. Any agent may run it; requires the local source cache and a real browser to
  verify in. Argument: a course plus one of `--slug`, `--lesson N`, `--from-lesson N`, `--all`.
---

# gemini-port — one published artifact, one hosted backup build

> This skill owns the **transport swap**: taking one already-published lesson artifact and emitting the same lesson as a page on our own site that talks to Google's Generative Language API with the cadet's own free-tier key. It does not own building or republishing the artifact (the course's Claude Project and `_builder/preflight-kit/`), it does not own registering the lesson (a director, via the prefill link), and it does not own anything downstream — the backup submits under the same slug, so `/preflight-analyze` and `/lesson-aggregate` cannot tell the two apart and must not have to.

Where this skill and [`CORE.md`](../../instructions/CORE.md) disagree, `CORE.md` wins.

> **A fix written here does not reach the Claude artifact, and that has gone wrong nine times in
> one day.** This tool is the cheapest of the three surfaces to change -- regenerate, commit, push
> -- so it is where a tutor fix naturally lands, and the artifact builder then quietly keeps
> producing artifacts without it. Before adding a behaviour to the porter, decide whether it
> belongs to the transport or to the lesson, and record the answer in
> [`docs/operations/TUTOR-BEHAVIOR-PARITY.md`](../../../docs/operations/TUTOR-BEHAVIOR-PARITY.md)
> -- the three-surface table, the planned ladder in `tests/browser/`, and the carry-forward
> backlog for `_builder/preflight-kit/`.

---

## Why this exists, and what it is not

Cadets on free Claude accounts get HTTP 429 when demand is high, and a cadet who cannot reach the tutor cannot do the preflight at all. The backup build is the **same lesson** — same tutor prompt, same grounding, same report, same submit contract — with only the transport changed.

*Narrowed 2026-08-20.* A 429 no longer ends a Claude session on its own: the artifact now walks its own model ladder the way this port always has, and only a fully walked ladder gives up. So the backup is where an **exhausted** ladder ends, not where the first 429 does — a smaller door, and a cadet who reaches it is genuinely out of Claude.

**It is the DEFAULT path as of 2026-08-21, not a fallback.** Free-tier Claude was timing cadets out mid-lesson, so the course director reversed the preference: `site/student/lessons.html` renders **one** launch button and it is the Gemini one wherever a build exists, the BACKUP VERSION banner is gone from every build, and neither the router nor the help page tells a cadet to prefer Claude any more. **Claude is still the fallback for a lesson with no Gemini build** — that branch is load-bearing, not a leftover: hiding Claude there too would leave the cadet no way into the lesson at all. *(This paragraph said Claude was the intended path and that the build's own banner said so. Both were true until that day.)* There are now **two doors** into the backup from the artifact, both cadet-clicked and neither automatic:

- the **start screen**, once the artifact's own connection check has failed — the original door; and
- the **mid-lesson error bar**, added 2026-08-20: a `Continue on Gemini →` anchor beside Retry, which hands over `backup.html?i=<slug>&go=1#h=<lz>` — the slug, the skip-the-explainer flag, and the transcript compressed into the **hash**, so the cadet resumes instead of restarting. It trims oldest-first under a 60,000-character cap and degrades to a plain link rather than a broken one.

> **The handoff is a chain of three files, and a break in any one of them looks exactly like success.** The Claude source builds `backup.html?i=<slug>&go=1#h=<lz>` (`patch_artifacts.py`); the router carries the hash through untouched on its `location.replace` (`site/student/backup.html`); and the build decompresses it and restores the conversation (`to_gemini.py` step 12). Drop link 2 or link 3 and the cadet still lands in the right lesson — on turn one, with their work gone, and nothing anywhere reporting why.
>
> **All three links exist as of 2026-08-20**, and what the build does with the payload is worth knowing before you describe it to a cadet. It validates before it trusts: `v === 1`, an id equal to its own `INTERACTION_ID`, `mode === "graded"`, and a non-empty message array — anything else is **discarded rather than repaired**, because the hash is fully under the cadet's control and a half-restored transcript would be graded as though it were whole. **A study-mode handoff is deliberately not restored**: practice turns replayed into a graded session would become the graded conversation, so a study cadet arrives on a plain link and restarts something they were never assessed on. The start screen is **not** skipped — they still have to supply their own Gemini key — but the name is prefilled, a banner says how many messages are about to come back, and when the transcript ends on the tutor's turn the build hands control straight to the cadet rather than making the tutor speak twice.
>
> **Verify the chain; do not reason about it.** `tests/browser-harness/gemini-handoff.mjs` drives all three links in real Chrome and asserts the forwarding hop separately from the restore. It compresses the transcript with the build's own vendored lz-string rather than a Node copy, so what it proves is that the build reads what the artifact actually writes. Failing that, grep a shipped build for `decompressFromEncodedURIComponent` — checking the router for the forward tells you about link 2 and nothing else.

Nothing about a cadet's grade, submission, or rollup contribution changes through either door — which is the point, and is what makes the "same slug" rule below non-negotiable.

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
| the artifact is **published**, and its slug read rather than typed | its row in `_builder/courses/<course>/index.json` has a `published_url`. **Never type a slug** — PROJECT.md's sharp-edge table records `phys310-atoms-and-nuclei-83022f32`, minted from a hand transcription of a word that was never in the source, and `check_artifact.py` validates a slug's *shape*, never its *derivation* | the index carries drafts too (phys-310: 17 rows, 4 published as of 2026-08-20). A row with no `published_url` is a draft — stop, and say which lesson it was |
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

> **The third shape arrived on 2026-08-20, and it came from this repository.** It was predicted here as "likely"; the prediction is kept because the tell held. `scripts/artifacts/patch_artifacts.py` applied the resilience fix set to all 51 sources, so a **patched** artifact reads differently from an unpatched one — `buildSystemPrompt` takes a `phase`, `stepModel()` exists, the submit URL carries `&v=claude`, the error bar has a second control. Two things make it easier than a real third dialect: the patcher **normalises** the two build dialects rather than adding to them (PHYS 110's five artifacts got the `BACKUP_ENDPOINT`, backup CSS and button the kit dialect already had), and the axis it introduces is *patched vs. unpatched*, not per-course. The porter requires the patched shape and refuses the other outright (Step 0's refusal, in the table below).
>
> **The tell is unchanged.** When a transform reports `matched 0, expected 1`, compare the two files at that anchor before touching anything: the difference has so far always been layout (a blank line, an alignment space, a trailing comment, a wrapped argument list) — or, since 2026-08-20, a fix set one file carries and the other does not. Loosen the LAYOUT; never the tokens.

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

**Building the backup does not put a door to it in the artifact.** The button that appears when the Claude connection check fails comes from the artifact's own source: new artifacts get it from the factory skill, and already-published ones get it from `scripts/artifacts/patch_artifacts.py` (step 0 of the 2026-08-20 fix set, which added it to the five PHYS 110 sources that never had one) or from the older single-purpose `scripts/artifacts/add_backup_button.py` — whose patch reaches cadets **only when a human republishes that artifact**, because claude.ai serves what was published, not what is in this repository. That republish keeps the slug (a hand patch is not a factory rebuild) but moves the claude.ai URL, so the lesson's `activities.artifact_url` must be updated with it. Until then the route to a backup is the router URL handed out directly. Read that script's header before planning around it; it is a separate unit of work from this skill.

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
| `<slug>: source predates the 2026-08-20 fix set` | the cached `.jsx` still has `buildSystemPrompt(cadetId, localTime)` — the phase deferral and the 429 ladder walk now live in the Claude source, and this tool inherits rather than performs them | run `python scripts/artifacts/patch_artifacts.py --commit`, re-pulling from the `artifact-sources` bucket first if the cache is stale. **Do not port it anyway**: the build would carry no deferral, which is the exact token burn the deferral exists to prevent, and nothing downstream would say so. Added 2026-08-20 |

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

Three harnesses cover part of this: `tests/browser-harness/gemini-build.mjs` renders one build in real Chrome (parse, mount, key field, no-scroll, no 404s), `tests/browser-harness/gemini-model-ladder.mjs` lifts the model block out of a shipped build and exercises the ladders, the scorer and the 429 walk without a key — the logic a browser cannot reach — and `tests/browser-harness/gemini-handoff.mjs` drives the three-link handoff chain, asserting the router's forward separately from the build's restore. None of them replaces item 6. This can be driven rather than clicked — `tests/browser-harness/` already runs puppeteer-core against real Chrome, and `tests/browser/` holds the checked-in test pages. A driver that asserts (1) and (2) plus the source strings in (5) is worth having. But Node is **optional** tooling that is guaranteed on no machine but the course director's, and per `CORE.md` §2 a Node-only check is never the sole verification of a change — **if it is all that ran, say so in the `CHANGELOG.md` entry** so the next operator knows what is still unproven.

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

## Why the prompt is deferred, and why this skill no longer performs the deferral

**The deferral was invented here, and on 2026-08-20 it moved out.** The graded system prompt is ~63,000 characters and is **resent every turn** — 93–96% of all input tokens in a session — so this port dropped the two **tail** blocks, `EXTENSION_PROBLEMS` and `REPORT_FORMAT` (about 11,400 characters, ~18% of every turn), until the phase that needs them. They sit at the very end of the prompt, which is why they can be dropped without disturbing a line above. For a while only the Gemini builds needed that. Then the Claude artifacts wanted the same saving, so it went into the artifact **source** (`scripts/artifacts/patch_artifacts.py`) and `to_gemini.py` **stopped performing it**: the porter now inherits a source in which `buildSystemPrompt(cadetId, localTime, phase)` and `sysFor()` already exist, and adds only what is genuinely Gemini-specific — seating the model pool from the same phase, which is the next section.

**So an unpatched source no longer ports, deliberately.** Step 0 of the tool refuses it by name and prints the remedy:

```
<slug>: source predates the 2026-08-20 fix set.
  Run: python scripts/artifacts/patch_artifacts.py --commit
```

Porting one silently would produce a build with no deferral at all — the exact token burn the deferral exists to prevent — and nothing downstream would report it.

**This is not what exhausts a free-tier key**, though it was recorded here as the cause until 2026-08-20: measured on a real key, a session used 66.7k of a 250,000 token-per-minute ceiling and still stopped dead — on the daily REQUEST cap, which the next section covers. Sending fewer tokens per turn is still worth doing, and it is what makes the cheapest models reachable at all, but it does not buy a cadet a second session. Gemini's explicit context caching cannot help: it needs a paid account and a 32,768-token floor, and rate limits count cached tokens anyway. The only lever is sending less.

**Where the deferral stops is unchanged — it just lives somewhere else now.** The trigger is the tutor's **verbatim integrity question**, which the prompt requires it to ask and then *wait* for. That mandated wait is the whole mechanism: it buys one turn of lead time, which is exactly enough to put `REPORT_FORMAT` back in context before the report is written. The backstop is elapsed active time past the whole planned budget, after which deferral stops regardless — a report emitted with no format in context is a broken submission, and the tokens saved are not worth that risk.

**If you change the tutor prompt's close sequence, you have changed this — in BOTH transports now.** The fingerprint (`INTEGRITY_ASKED`) matches the question's opener with one alternate; a reworded close silently disables the primary trigger and leaves only the time backstop. It is declared in the Claude source by `patch_artifacts.py`, so a fix to it reaches the published artifact and every backup build together — which is the upside of the move, and the reason to make the fix there rather than here.

## Which model a turn uses, and why it is not the newest

**Free-tier quota is per MODEL, not per key.** Every row in the AI Studio dashboard carries its own RPM/TPM/RPD counter, and the daily figures differ by more than an order of magnitude. Measured on a real cadet key, 2026-08-20:

| Model | RPM | RPD |
|---|---|---|
| Gemini 3.7 / 3.6 / 3.5 / 3 Flash, 2.5 Flash, 2.5 Flash Lite | 5–10 | **20** |
| Gemini 3.5 Flash Lite, 3.1 Flash Lite | 15 | **500** |

> **`MODEL_LITE` is `3.5-flash-lite` then `3.1-flash-lite`, and the 2.5 line is NOT in it.**
> *(2026-08-25 evening.)* Both `gemini-2.5-flash` and `gemini-2.5-flash-lite` answer **HTTP 404**
> on `:generateContent` for cadets' keys while `ListModels` lists them with `generateContent`
> support — so `discoverModel()` cannot filter them and they have to come out of the source
> ladder. They were the last rungs, and the last rung's failure kind is the message the cadet
> reads, so every quota exhaustion was being reported as *"No usable Gemini model was found for
> this key"*. Evidence and the full reasoning:
> [`TUTOR-BEHAVIOR-PARITY.md`](../../../docs/operations/TUTOR-BEHAVIOR-PARITY.md) §2.4.
>
> **§2.5, later the same evening, is the one to read first.** Removing the 404 floor fixed where
> sessions *landed*, not why they fell: one failing turn was burning the entire ladder in ~20
> seconds (four blind retries a rung), and `spentModels` never cleared, so the cadet stayed pinned
> to the bottom rung for the rest of the session. A model that had answered 284 times was marked
> spent in all 75 logged sessions. **Read the `models` array in a log row, never `http_status` —
> the terminal error names where a session died, never why.**
> **Before adding a rung back, ask `content->>'model'` over recent `submission_activities` what
> the fleet has actually run.** Two floors were chosen in one day on plausible reasoning and
> neither was checked against that.

One tutor session is 10–14 requests. So a 20/day model gives a cadet **one session** and then locks them out until the daily reset at midnight Pacific — which is 1:00 AM in Denver, i.e. *after* a 2359 deadline has already passed. A section hit exactly this on 2026-08-20, at 21 requests against a cap of 20.

**The port used to pick the worst available model, and nothing could see it.** `scoreModel` awarded +25 to any name containing `latest`, so `gemini-flash-latest` outranked every pinned name. Google hot-swaps that alias to whatever shipped most recently — their own docs say it "can be a stable, preview or experimental release" — and a new Flash launches on the tight 20/day quota. So cadets were moved onto a 20/day model *by Google*, with nobody choosing it and nothing reporting it. The `MODEL_REJECT` regex screens names containing `preview`, and never fired: the alias does not **say** preview, it merely **resolves** to one. A name-based screen cannot see through an alias.

**The conversation ladder is ordered by CAPABILITY; only the floor is ordered by quota.** *(Reversed 2026-08-21. Until then both ladders were ordered by quota and `MODEL_CHAT` started on the 500/day lite models — the paragraph this replaces said so.)*

A cadet reported the result: *"it would try to tutor me and then give me the answer instead of walking me through it."* A lite model **opens** Socratically, because the prompt tells it to, and then collapses into answering — holding that stance across ~12 turns under a ~70,000-character instruction is the reasoning-heavy part. **The prompt was never the weak link**: every Socratic line survives the port at identical counts, and the phase deferral drops only `EXTENSION_PROBLEMS` and `REPORT_FORMAT`, neither of which teaches probing. (Deferring `EXTENSION_PROBLEMS` makes answer-leaking *less* likely, since it carries worked solutions.)

The quota it was protecting was never under pressure. Measured on the course director's key: **22 of flash-lite's 500 requests/day** used across the whole course, while **3.7-flash sat at 23 against a cap of 20** — because the report was the only thing allowed to touch it. **We were spending the best model on the summary an instructor reads and the worst on the conversation a cadet learns from.**

So: `MODEL_CHAT` now runs `3.6 → 3.5`, then falls through to `MODEL_LITE` as its floor. A session is 10–14 requests, so **one whole session fits inside a single 20/day cap** — a cadet doing one lesson a day runs it entirely on 3.6; a second lands on 3.5, and a third reaches the floor. *(This sentence headed the ladder with 3.7 until 2026-08-25; 3.7 was dropped hours after it was written, and the very next paragraph has said so ever since.)* `MODEL_REPORT` keeps the same head, so a chat session that spends 3.7 pushes its own report one rung down. **That trade is deliberate**: summarising is far easier than tutoring, so the strong model is worth more to the conversation. `tests/browser-harness/gemini-model-ladder.mjs` asserts it rather than leaving it to be rediscovered from a report that looks weaker than it used to.

**3.7-flash is absent, deliberately.** It was the head of this ladder for a few hours on 2026-08-21 and was dropped the same day: its first reply takes long enough that the page reads as broken, on every turn, against a quality difference over 3.6 nobody could point to. It is also the likeliest explanation of the freeze that started all this — the cadet who hung was at the **report** stage, the one request the live builds have always sent to 3.7, with a large generation and (until that day) no timeout at all. The harness asserts its **absence**, because a ladder that quietly regains it is the regression.

**The first two tutor turns are delivered by the app, not generated.** The prompt dictates both — the Honor Code reminder is quoted in it verbatim, and the opening question is marked VERBATIM — so generating them cost two of a session's ~14 requests to produce text that was already written, and they were the two the cadet waited on before anything had happened. Both strings are **extracted from the artifact's own prompt at port time** (`RE_HONOR`, `RE_OPENING_Q`), never restated in the tool, and the porter **refuses** rather than falling back if it cannot find them: a build whose scripted opening disagreed with its own prompt would have the tutor deny saying what the cadet just read. There is no Gemini `.jsx` to extract from — `site/gemini/` holds only generated `.html`, so the Claude artifact is the sole place the prompt exists. Three consequences worth knowing: the tutor is told **once**, on the first real turn, that the app delivered the opening (without it, it obeys its own instruction and asks the question again immediately after being answered); the reading reflection is still judged, because the cadet's answer is in the history on that first call; and how far the opening got is **derived from the transcript**, so a restored session resumes in the right place with no extra state to persist.

**lz-string is load-bearing and its failure used to be silent** *(2026-08-21)*. The submit URL IS the report compressed into a hash, so a page without lz-string renders a perfect report the cadet cannot submit. The source hook polls for 10s and then gives up recording **nothing** — no state, no message, no retry — and a resource 404 does not bubble, so the wrapper's `window.onerror` never sees it either. The porter replaces the hook: the script tag's `onerror` is honoured, three attempts each re-inject a cache-busted tag, and it returns `"loading" | "ready" | "failed"` so the finish bar can say which. `lzReady` stays a boolean at every call site. **Do not widen the 10s-give-up assertion to the whole build** — the KaTeX loader carries the identical pattern and is deliberately left alone, because maths falling back to raw LaTeX is ugly, not lost work.

**Three failure paths must mark the model spent, and each was a separate report-stage hang** *(2026-08-21)*. `seatLadder` skips spent models, so any throw that does NOT record one puts the next Retry straight back on the rung that just failed — press Retry, fail the same way, forever, with no summary. All three are now `spentModels[...] = true` plus a walk: a **5xx** (a 503 here is per MODEL, not per project — an instructor's usage dashboard showed 3.7-flash refusing while lite served the same session normally), a **timeout**, and an **empty candidate** (HTTP 200 with no text, which is what that same dashboard caught 3.7-flash doing: real input tokens, zero output tokens). The empty-candidate throw is the subtle one — it lives in `callTutor`, **above** `rawCall`, so it bypassed the ladder machinery entirely. `gemini-model-ladder.mjs` asserts all three against the shipped bytes. The report pool head (now 3.6) only makes a hang rarer; these are what end it.

**Submitting STAMPS the session, it does not clear it** *(2026-08-21)*. `clearSession()` used to fire on the Submit click, before the receiver had validated anything — and the receiver rejects for several reasons, printing *"Re-open the interactive lesson and submit again from the finish screen"* for one of them. That remedy was impossible. `stampSubmitted()` writes `submitted: true` into the snapshot synchronously (the click navigates away, so the snapshot effect gets no further render), and the start screen reads it: *already submitted*, not *unfinished session*. That wording was the only thing clearing ever bought.

**The scripted opening greets before it asks** *(2026-08-21)*. The prompt's own instruction is *"OPENING. Greet the cadet briefly and set expectations. Then ask, as your very first content question, VERBATIM: …"* and the scripted turn delivered only the second half, so a cadet met a bare question with nothing saying which lesson they were in. `OPENING_WELCOME` is a **separate** constant appended **before** `OPENING_QUESTION`, which stays exactly the verbatim string `openerStage` matches on. The lesson name is **extracted from the artifact's own header** (`RE_LESSON_TITLE`) and the port **refuses** if it cannot find it — a build that greets a cadet into the wrong lesson is worse than one that does not greet them at all.

**The finish bar** *(2026-08-21)*. Submit was a 12px link in the footer strip. It is now a panel above the composer with a large Submit and a **Keep talking** beside it that carries the session on as ungraded practice. Keep talking confirms when nothing has been submitted, and the **graded snapshot survives it** — the snapshot effect stops writing once the switch happens, so a reload with the same name restores the report and the Submit button. `tests/browser-harness/gemini-finish-bar.mjs` is the only thing in the repo that can see any of this: it seeds a finished session into localStorage and stubs the model listing, so it reaches the end of a graded run with no key and no tutor turn.

**The scripted turns are paced, not instant** *(2026-08-21, after trying the first build)*. A turn that costs no request lands with no delay at all, and that reads as **broken** rather than fast: the reply beats the cadet's own message onto the screen, and the first real turn then pauses and looks like a fault by comparison. `scriptedDelay` shows the typing indicator the build already has for roughly the time it takes to read the line — floored at 900 ms so the one-line question is not instant either, capped at 2.6 s so pacing never becomes a tax. `startSession` awaits it (async); `send()` uses `setTimeout` (not async); neither can be raced, because `history` is captured and `setLoading(true)` disables the composer. The helper is emitted under **both** policies and only its **use** is gated on `APP_OPENING`, which is what keeps the two policies on one emission path. `gemini-model-ladder.mjs` **runs** it rather than string-matching it: a regression that left the function present and returned `0` would satisfy a substring check and ship the glitch.

`MODEL_STUDY` is new and is **lite-only**. Study mode is ungraded practice with no cap on how often a cadet runs it; before this it shared `MODEL_CHAT`, so practice quietly drew down the same 20/day the graded run needed. It is seated in **two** places — `sysFor()` for ongoing turns and `startSession` for the opener, which does not pass through `sysFor()` — because seating only the first would still leak one strong request per practice run.

`sysFor()` chooses the pool from the same phase that chooses the prompt, because they are one decision.

**A 429 moves down the ladder instead of ending the session — but only after the body is read.** Gemini returns 429 for both the per-minute and the per-day limit, **and the body says which**: a per-minute burst carries a `RetryInfo` naming a few seconds, and the daily cap names a long delay or none. The transport honours a short delay (≤15s, once per model per session) and **keeps the model it is on**; anything longer is treated as the daily cap, so it marks that model spent and steps to the next rung, which carries an independent quota. Spent models stay spent for the session, so the extension phase cannot re-burn one already known exhausted. Only a fully walked ladder raises `quota`.

*This paragraph said until 2026-08-21 that Gemini "does not say which", and the transport backed off ~3.5s before burning a model. That was survivable while the ladder started on a 15 RPM lite model. It is not survivable at the top, where the cap is 5 RPM: burning 3.7-flash after 3.5 seconds throws away 19 of its 20 daily requests over a window that would have cleared on its own.* Note the cadet is watching an unexplained spinner for the whole wait, which is why it is bounded at 15s rather than the full minute.

**`--policy {teaching,legacy}` exists to decouple the 2026-08-21 tutoring changes from the transport fixes that had to ship immediately, and is meant to be short-lived.** *(Named `--ladder` for a few hours the same day; renamed once it started gating the app-delivered opening as well, because a flag called `--ladder` that also decides who writes the opening is the kind of quiet mismatch this project keeps paying for.)* *(Added 2026-08-21.)* `teaching` is the default and is the policy above. `legacy` reproduces the ordering the live builds shipped with — chat on the lite floor, study sharing the chat pool as the same array — so the live set can be rebuilt to carry the freeze fix below and **nothing else** while the reorder is still out for faculty trial. The alternative, hand-editing the tool and putting it back afterwards, would leave 38 live builds matching **no committed state**; a flag is reproducible and an uncommitted edit is not. **`teaching` now carries two things**: the conversation ladder below, and the app-delivered opening (`APP_OPENING`). `legacy` carries neither, so a rebuild of the live set gets the request deadline and the session restore and nothing a cadet would notice in the tutoring. `gemini-model-ladder.mjs` detects which policy a build carries and asserts that policy's invariants — it does **not** accept both shapes for one build, which would make it a test of nothing. **Delete `legacy`, and that branch of the harness, once the reorder ships.**

**Every request has a deadline, and the session survives a reload.** *(Added 2026-08-21, after a cadet froze at the report stage of a live backup and could only escape by losing the session.)* Nothing in this transport had a timeout — no `AbortController`, no deadline anywhere — and `fetch` has none by default, so a connection Google accepts and never answers leaves the promise pending forever. The `finally` that clears the spinner never runs, and the composer and Send are both `disabled={loading}` with no cancel. The only way out was a reload, which erased the transcript: **only the API key was ever persisted.** For a cadet who arrived by `#h=` that is worse than it sounds, because the Claude half of their conversation no longer exists anywhere they can reach.

So: **120s per request** (generous on purpose — a long report genuinely takes ~a minute, and aborting a request about to succeed is worse than waiting) raising `timeout`, **not** auto-retried, because a silent second two-minute wait reads as the same freeze. The session is snapshotted to `localStorage` on every **settled** turn and restored for the same cadet, same lesson, same mode, within 6 hours. **A snapshot outranks a `#h=` handoff** — it already contains the handoff's messages plus everything since, so preferring the hash would roll the cadet back to the moment they arrived. `reportPhase` is **persisted rather than re-derived**, because the effect that sets it reads only the *last* message: a session frozen on the cadet's reply to the integrity question would otherwise resume believing it was still probing and rebuild the prompt without `REPORT_FORMAT`.

**`400` is not an auth failure.** It was lumped in with 401/403, so an over-long request told the cadet their API key was invalid and sent them to regenerate a key that was fine. It is `auth` only when Google's own message names the key; otherwise `badrequest`, which says length is the likely cause — and a handoff reaches that length sooner than a fresh session does. The ListModels 400 in `discoverModel()` is deliberately still `auth`: that call carries no body worth rejecting.

**Anything emitted into the constants block must not read a value declared with the artifact's own identity.** `SESSION_STORE` was a `const` built from `INTERACTION_ID`, and that block is emitted **above** the declaration — *"Cannot access 'INTERACTION_ID' before initialization"*, thrown before React mounts, blanking the page. It is a function now, evaluated on first save. **This is the second temporal dead zone in this file from that same cause**, so treat it as the rule rather than the anecdote; `gemini-build.mjs` is what caught both.

**The Claude artifacts share this transport shape and almost certainly share the missing timeout.** Fixing it there means re-patching and republishing 51 artifacts by hand, so it is recorded and not done. The lost-work half does not apply there — claude.ai keeps the conversation — but the hang does.

**The Claude source now has the same shape, and that is not a coincidence.** *(2026-08-20, `patch_artifacts.py`.)* It gained a `stepModel()` helper, a 429 branch in `rawCall` that backs off first and then steps DOWN `MODEL_CANDIDATES`, the same typed `{ kind: "quota" }` raised only by an exhausted ladder, and its own `errorMessage()` case for it. Until then a 429 fell through to the generic `request` message — *"wait a moment and Retry"* — which for a usage cap is advice that never comes true. **Write a transport fix once and put it where both builds can have it.**

**What is still Gemini-only is the multi-pool structure**, because Claude has one ladder and this build has three: `MODEL_CHAT` for the ~12 conversation turns, `MODEL_REPORT` for the single request that writes the graded report, and `MODEL_STUDY` for ungraded practice. So the port **removes** the inherited helper rather than keeping it (step 9b of the tool): `stepModel` names `MODEL_CANDIDATES`, which no ported build declares, and a free variable inside a function that only runs mid-session is the `REPORT_MARKER` failure exactly — parses, renders, serves, then throws on a cadet. `seatLadder()` and `nextModel()` already cover that ground here.

**No ladder is hard-coded in effect.** `discoverModel()` intersects all three with what `ListModels` says the key can actually reach, and if it can reach nothing on chat, falls back to scoring the listing — which still prefers `lite` and penalises `latest`. That fallback ordering is deliberately unchanged: it fires only when every pinned name has been renamed away, and in that state nothing is known about capability, so not dead-ending is the only property left worth having. `MODEL_STUDY` falls back to `MODEL_CHAT` rather than to the scored list, because practice has to run somewhere — it costs graded quota in that case, which is why it is the fallback and not the default. That keeps the property runtime discovery existed for: **this build cannot dead-end on a retired name.** It also means a mistyped or renamed model degrades quietly instead of breaking, so **verify a ladder name against a real key rather than trusting it** — nothing will tell you it was never reached.

## The transport marker, the model fields, and why the lesson page skips the explainer

*(All added 2026-08-20.)*

**Every build stamps `&v=gemini` into its submit hash.** The receiver sanitises it and stores it as
`submission_activities.content.transport`, so a backup submission can be told apart afterwards.
This is additive under contract §8: the four frozen keys (`t`/`i`/`r`/`d`) are untouched, and a
consumer that has never heard of `v` ignores it.

**The Claude side now stamps `&v=claude`, and that changed what absence means, the same day.**
This section read, until 2026-08-20: *"the absence is what carries the meaning… A published
claude.ai artifact sends no `v` and cannot be made to — republishing one mints a new slug and a new
lesson row (§3.2). So 'no marker' means 'not a build this repository generated', which is today the
same set as 'Claude'."* **Two claims in that failed, and the second one is why the first did.** A
Claude artifact *can* be made to send `v` — `patch_artifacts.py` added `&v=claude` to all 51 sources
the same day. And the reason given for why it could not — that republishing mints a new slug and a
new lesson row — is a misreading of §3.2, which requires a fresh suffix for a new **offering**. A
hand-patched republish into the same term is not that, and **keeps its slug**. With both gone, so is
the conclusion that a missing marker means Claude.

**What a missing `v` means now is a mixture, and it must be read as one:** a Claude artifact
published before 2026-08-20 and not yet republished (claude.ai serves what was published, not what
is in this repository, so this clears lesson by lesson as humans republish), *or* a row written
before the key existed at all, *or* a future producer that forgot it. Contract §3.3 is the
authority and carries the three-population table.

**The rule that did NOT change is the important one: never synthesise `transport: 'claude'` for an
absent marker.** The receiver leaves it null deliberately, and the reason is stronger now than when
it was written — defaulting would stamp a positive, wrong claim onto every historical row *and*
onto every artifact still waiting for its republish, with nothing downstream able to tell the
invented values from the observed ones. Read absence as absence.

**It is stored inside `content`, not in a column of its own.** DDL on `app` is sealed (`CORE.md`
§0) and `content` is already `jsonb`. It is merged over the `d` object and **never in place of a
null** — a null `content` is exactly what the auto-grade trigger and the cohort rollup read as "no
structured data", so inventing an object to carry one string would change behaviour for every
consumer. A report that arrives with no `d` therefore records no transport, which is acceptable
because such a submission already earns no grade (§3.1) and gets opened by hand anyway.

**`d` also records which model wrote the report** — `model` and `model_downgraded`, contract §5.9,
both added 2026-08-20. The two builds must compute the second one differently. The Claude source
tests `model !== MODEL_CANDIDATES[0]`, which is exact *there* because its one ladder never climbs
back; it is **not** a stable test here, because `discoverModel()` rewrites both ladders to what the
cadet's key can actually reach, so the first entry after discovery may never have been the first
entry before it. The port rewrites it to `Object.keys(spentModels).length > 0` — a model lands in
`spentModels` only after it has 429'd out and the walk has moved past it. Same field, same meaning
(*this session did not stay on its first choice*), computed from the state each build actually has.
It is diagnostic: nothing grades on it, and no student page renders it.

**The lesson page's Gemini button goes to `backup.html?i=<slug>&go=1`**, and `go=1` makes the router
resolve the slug and redirect instead of rendering its explainer. The explainer still exists and is
still the default, because the *other* caller — a cadet the Claude artifact bounced here
mid-session — arrives with no context at all. A cadet clicking the button on the lesson page has
just read that context beside the button, so showing it again is a toll rather than a warning.

**The route still goes through the router.** It would be one line shorter to link at the build path
directly, since `student-lessons.js` has already read the manifest to decide whether to show the
button at all. Do not: which build a slug resolves to is allowed to change, and there is meant to be
exactly one answer on this site to "where does this slug go".


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

9. **An anchor failure is shape drift, not a bad artifact.** When a transform reports `matched 0, expected 1`, fix the anchor — never edit the artifact to fit the tool, because the artifact is the published record and editing the cache desynchronizes it from Storage (Step 3). Since 2026-08-20 there is a second cause to rule out first: a fix set the *other* tool has applied to the source (`patch_artifacts.py`), which is a real change of shape rather than drift and is fixed by making the two tools agree about which of them performs what — not by loosening an anchor until it matches both (Step 1, the third shape).

10. **The manifest only grows unless a human shrinks it.** Withdrawing a backup is a hand edit to `site/data/backup-builds.json`; the tool will not do it, and the router's fallback ("No backup for this lesson yet") is the correct visible outcome (Step 3).

11. **A backup build is not a republish.** It mints no slug, needs no new lesson row, and cannot fix a content bug — that is a rebuild on claude.ai and a director's decision (When NOT to run it).

12. **Log it.** `CHANGELOG.md` per `CORE.md` §5: what was ported, why, what was verified and how, and what was left unproven. Push only when asked (Step 5).

---

**References:** [`scripts/artifacts/to_gemini.py`](../../../scripts/artifacts/to_gemini.py) — the tool this skill drives, whose module docstring is the authority on what it asserts; [`scripts/artifacts/patch_artifacts.py`](../../../scripts/artifacts/patch_artifacts.py) — the 2026-08-20 fix set applied to the Claude sources, which this tool now requires and inherits from, and the authority on what the patched shape is; [`site/student/backup.html`](../../../site/student/backup.html) — the router, and why the indirection exists; [`docs/contracts/INTERACTION-DATA-CONTRACT.md`](../../../docs/contracts/INTERACTION-DATA-CONTRACT.md) §3 — the frozen submit contract and the per-offering slug rule; [`.ai/instructions/PROJECT.md`](../../instructions/PROJECT.md) § "Sharp edges the builder already paid for" — the line-ending, `node --check`, and transcription failures this skill guards against.
