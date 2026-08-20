# Onboarding an artifact author

**Reader:** you build Claude preflight artifacts for one course, and you need them **in this
system's library** — so they can be reviewed objective by objective, so a Gemini backup can be
generated from them, and so the next person can see what was built. Possibly you have artifacts
already published that were never uploaded.

**This is not [`MACHINE-SETUP.md`](MACHINE-SETUP.md).** That brings a machine to full development
parity — every credential, the 968 MB textbook corpus, publish access. You need almost none of it.
This runbook is the capability-scoped path, the same way
[`ONBOARD-AGGREGATION.md`](ONBOARD-AGGREGATION.md) is for closing out a lesson.

**This is also not [`PUBLISH-ARTIFACT.md`](PUBLISH-ARTIFACT.md).** That is the other direction —
taking a finished `.jsx` and making it live on claude.ai. This one takes an artifact you already
have and puts it in the library. If you are doing both, publish first, then come here.

---

## What the library is, and why an artifact outside it is a problem

The `.jsx` is not in git — 51 artifacts is ~8.5 MB and it would sit in every clone's history forever.
It lives in the private `artifact-sources` Storage bucket, and the repository keeps the human
record beside it. That bucket is what the faculty **Artifacts** page reads.

An artifact that was published but never uploaded is invisible to all of it:

- **Nobody can review it.** The accept/reject-an-objective UI reads the library.
- **It can get no Gemini backup.** `to_gemini.py` ports from the `.jsx`, so there is nothing to port
  and a cadet throttled by Claude on that lesson has nowhere to go.
- **Its build has no record.** The published URL, in particular, lives nowhere else.

That was PHYS 110's exact situation on 2026-08-19: five published interactive lessons, no library.
They were uploaded that day and ported the next, and all five now have a Gemini build.

> **Uploading unblocks the backup. It does not make the backup reachable.** Those five were built
> outside the preflight-kit, before the backup router existed, so they had never learned its URL.
> Once their Gemini builds existed the builds sat on the server with **nothing in the lesson
> pointing at them** — a cadet capped by Claude still had nowhere to go, and the library looked
> complete from every angle that reports anything. `scripts/artifacts/patch_artifacts.py` closed it
> on 2026-08-20 by giving the five a `BACKUP_ENDPOINT` and both backup buttons, first, before any
> other step, so everything after it saw one dialect instead of two.
>
> **An artifact built outside the kit is the one to check twice.** `grep -c BACKUP_ENDPOINT` should
> report **3** — the constant, the start-screen button, and the `Continue on Gemini` button in the
> mid-lesson error bar. Zero means the lesson has no door to its own backup.

---

## 0. What you need

| | |
|---|---|
| This repo, cloned, on `main` | `git clone https://github.com/dfpm-physics/Core_Preflights.git` |
| Python 3 | Standard library only. No venv needed for this task, no Node, no build step |
| One credential file | `supabase/admin/.env` — **ask the course director.** Never from the repo, never guessed |

Check what the machine already has — read-only, and it runs before anything is installed:

```
python scripts/onboarding/prep_doctor.py
```

**You do not need the service-role key.** Every command below takes `--as-staff`, which signs in
through the account in that `.env` and obeys the ordinary browser permissions. Per CORE.md §3 that
is the right instrument for a write and the wrong one for an audit — which is what this is.

---

## 1. Put the `.jsx` where the tool looks

```
_builder/courses/<course-id>/artifacts/<anything>.jsx
```

So for PHYS 110, `_builder/courses/phys-110/artifacts/`. The directory is **gitignored** — it is a
local cache, and the bucket is the real home. Filenames are free; the tool never trusts them.

**Getting the file out of claude.ai:** open the artifact, click **Code**, copy it. If you still
have the Claude Project you built it in, the source is in that conversation and it is faster.

> **Copy the bytes; do not retype anything, ever.** Every artifact carries an `INTERACTION_ID` —
> its slug — ending in 8 random hex minted once at build time. That string is the lesson's
> identity: cadet reports land in the row it names. It cannot be re-derived from anything, and a
> hand transcription has already corrupted one published artifact's identity in this project
> (PROJECT.md, sharp edges). Read a slug **out of** the file; never type one **into** it.

---

## 2. See what would happen

```
python scripts/artifacts/sync_artifacts.py status --as-staff
```

Your course must appear with a count. Two answers that are not that:

| What it says | What it means |
|---|---|
| `SKIPPED — no artifacts/ directory` | Step 1 did not happen, or the path is misspelled |
| Your course is **not listed at all** | It has no `COURSE_PROFILE.md`. See §5 |

Courses are discovered from what is on disk, not from a list in the code — *(since 2026-08-19;
before that an unlisted course reported success and moved nothing)*.

---

## 3. Push

```
python scripts/artifacts/sync_artifacts.py push --as-staff              # dry run, prints the plan
python scripts/artifacts/sync_artifacts.py push --as-staff --commit     # writes
```

Dry-run by default and idempotent: every object is compared by sha256 and skipped when it already
matches, so re-running is free and safe.

**This is a live write to shared storage** — CORE.md §0 applies. Check nobody else is mid-run,
then record what you did in `CHANGELOG.md`.

---

## 4. Verify it landed, and review it

Open the faculty **Artifacts** page. Your course now has a tab — *the tab exists because the push
created its shelf, so this is the correct order and not a delay*. Open an artifact and you get its
objectives, each with **accept / reject** and a note.

**Objectives are parsed out of the `.jsx` itself**, from the `Reports under objective key:` blocks
— not from any file you have to author. So review works on the first push, before any build log
exists.

Decisions are written to `<course>/review-notes.json` in the bucket by the browser. To bring them
back into git, where they are diffable and an agent can read them:

```
python scripts/artifacts/sync_artifacts.py pull-reviews --as-staff --commit
```

That is the loop: **review in the browser → pull into git → an agent reads the rejections and
revises the artifact → republish → push again.**

---

## 5. A course that has never had an artifact

It needs one file before step 2 will see it:

```
_builder/courses/<course-id>/COURSE_PROFILE.md
```

Copy `_builder/courses/phys-215/COURSE_PROFILE.md` and edit the fenced ```` ```profile ```` block.
Four values must be real for the library: `course_id`, `course_title`, `prefill_base`,
`submit_endpoint`. **Copy the two URLs verbatim** — they are frozen contract URLs (CORE.md §6) and
a wrong one fails silently, sending cadet work nowhere.

Everything else may stay `UNSET`. Uploading works with them unset; **building a new artifact does
not** — `localize.py` refuses, which is the point. The grounding text and session shape are that
course's teaching decisions, and inheriting another course's numbers by copy-paste is how one
course's pedagogy quietly becomes another's.

> **Write that file with LF line endings.** `localize.py` finds the block with the regex
> ```` ```profile\n ````, and a CRLF puts `\r` before the `\n` so it silently stops matching.
> `_builder/**` is `-text` in `.gitattributes` for exactly this reason; it has already bitten twice
> and **the working tree looked correct through both**.

---

## 6. Things that will bite

**`BUILD-LOG.md` is not optional bookkeeping — `index.json` is derived from it.** Register a
published URL through the website, forget to write it into the log, and the next `push` regenerates
the index without it and takes the URL away. No error. That happened on 2026-08-19; it is in the
CHANGELOG. **After anyone registers a published URL, write it into `BUILD-LOG.md` before the next
push.**

**Publishing is the irreversible step — but only a REBUILD mints a new slug.** Anything you
change here reaches cadets only when a human republishes it on claude.ai, because claude.ai serves
what was published and not what is in this repository. What differs between the two cases is the
slug, and only the slug. A **factory rebuild** mints a fresh 8-hex suffix and therefore registers as
a *new lesson row* — that is contract §3.2, and it is a rule about a new **offering**. A **patched
republish into the same offering keeps its slug, and must**: `activities.slug` is globally unique
and every student report hangs off the row it names, so minting a new one mid-term orphans the
work of every cadet who has already finished. `patch_artifacts.py` asserts byte-equality of the
slug line before it writes, so the rule cannot be broken by accident. Read
[`PUBLISH-ARTIFACT.md`](PUBLISH-ARTIFACT.md) §5 before touching anything cadets can see.

*(This paragraph said flatly until 2026-08-20 that "a rebuild mints a new 8-hex slug, which is a
new lesson row". Read literally on the 2026-08-20 fix set, that made a patch to 51 published
artifacts look like 51 rebuilds and 51 new lesson rows — when the correct action was 51 patched
sources republished under their unchanged slugs. PROJECT.md carries the same correction.)*

**`node --check` does not validate JSX.** It exits 0 on invalid JSX whenever the file contains an
`import`. `check_artifact.py` is not a syntax check either, however green. Publishing is the only
JSX parser this project has.

**Effort is the grade, not correctness.** A cadet who works through the whole conversation and
understands nothing earns full marks. Everything diagnostic stays diagnostic.

---

## 7. After the first push: the Gemini backup

Once an artifact is in the library it can get a backup build — the same lesson on the Gemini API,
for cadets Claude has rate-limited. That is a separate procedure with its own browser verification
per build: [`.ai/skills/gemini-port/SKILL.md`](../../.ai/skills/gemini-port/SKILL.md). Ask for it
rather than running it blind; the browser check is the only parser those pages get.

**Patch the source before you port it.** The phase-deferred prompt and the 429 ladder walk were
invented inside the porter, back when only the Gemini builds needed them; on 2026-08-20 they moved
into the Claude source itself and the porter stopped performing them — it now *inherits* them and
adds only what is genuinely Gemini-specific. So the order is:

```
python scripts/artifacts/patch_artifacts.py                          # dry run, every course
python scripts/artifacts/patch_artifacts.py --commit
python scripts/artifacts/to_gemini.py --course <id> --all             # dry run
python scripts/artifacts/to_gemini.py --course <id> --all --commit
```

Both read `_builder/courses/<id>/artifacts/*.jsx`, so make sure what is on disk is the **current
published bytes** (§1) before either runs — patching a stale cache and pushing it is how a fix
lands on a file nobody is serving.

**`to_gemini.py` refuses an unpatched source rather than warning about one**, and names the remedy
in the error. That is deliberate: porting one silently would produce a build with no phase deferral,
which is the exact token burn the deferral exists to prevent, and it would exhaust a cadet's free
Gemini quota in a couple of runs with nothing downstream reporting why.
