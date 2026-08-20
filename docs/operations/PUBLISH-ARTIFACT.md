# Publishing a preflight artifact

**For:** whoever holds a finished `.jsx` in `courses/<id>/artifacts/` and needs it live at a URL
cadets can open. **Answers:** *how do I publish this without Claude quietly changing it?*

Publishing is the **irreversible step**. A published artifact lives at its own URL, serves whatever
it was published with, and **cannot be fixed by editing this repository** — only by republishing.
Read `CORE.md` §6 and follow
[`safe-change`](../../.ai/skills/safe-change/SKILL.md) before running this on anything cadets will
see.

> **Republishing does NOT automatically mint a new slug, and conflating the two is expensive in
> both directions.** *(Corrected 2026-08-14; this sentence used to say it did.)* The slug is a
> literal string in the source, and publishing copies the file byte-for-byte — so what mints a new
> one is a **factory rebuild**, which generates a fresh 8-hex suffix (§4). A **hand patch** that
> leaves `INTERACTION_ID` untouched republishes to a new *claude.ai URL* under the *same slug*:
> submissions keep landing in the same `activities` row, and the only database change needed is
> that lesson's `artifact_url`.
>
> Getting this wrong the safe-looking way is what costs: believing every republish needs a new
> lesson row turns a 51-file patch into 51 unnecessary registrations and splits each lesson's
> cohort in two. Getting it wrong the other way — hand-copying a suffix forward onto a genuine
> rebuild — is the failure §4 warns about. **Check whether `INTERACTION_ID` changed; do not infer
> it from the fact that you republished.** The patched-republish path is §5.

**Sequence:** this runbook, then [`PREFILL-LINK.md`](PREFILL-LINK.md). Publishing produces the
public URL; the prefill link registers it. **Until the prefill link is saved, a published artifact
is unreachable by the grading pipeline** — cadets who somehow found the URL would submit into
nothing.

---

## 1. Verify the file before you hand it over

**No local copy?** The `.jsx` is gitignored, so a fresh clone has none. Either run
`python scripts/artifacts/sync_artifacts.py pull`, or open the faculty **Artifacts** page, pick the
lesson, and use **Download .jsx** on the Source card — same bytes, straight from the
`artifact-sources` bucket, named the way the build record names it. The page is the better route
when you only want one file and are about to attach it to a session anyway.

From the repository root, with the artifact path in `A`:

```bash
A=courses/phys-310/artifacts/phys310_preflight_atoms_and_nuclei.jsx
python scripts/artifacts/check_artifact.py "$A"
wc -l "$A"
grep -n 'INTERACTION_ID' "$A"
```

The checker must exit 0. **It is not a syntax check** — there is no JSX parser on this machine and
`node --check` passes invalid JSX silently (`PROJECT.md` §9). The Claude session in step 2 is the
only parser this file will ever meet, which is why step 3 asks you to run a turn.

Write down the **line count** and the **exact `INTERACTION_ID`**. You need both in step 3.

---

## 2. Publish

Start a session and attach the `.jsx`. Paste the prompt below with it, unchanged.

> **If you use the course's Claude Project, the first line is the one that matters.** The
> `preflight-factory-v2` skill is in that project's knowledge and is written to *build* an artifact.
> Attaching a finished one looks to it like an input. Without the first line it may regenerate the
> file from scratch — producing something plausible, differently worded, and with a **different
> slug**, which is the silent failure this whole runbook exists to prevent.

```
Publish the attached .jsx as a React artifact, byte-for-byte as written.

DO NOT run the preflight-factory-v2 skill. This file is already a finished,
verified build. There is nothing to generate.

This file is machine-verified against frozen contracts in its source repository.
Any edit you make — however sensible it looks — breaks a check and can silently
cost cadets their submitted work. Reproduce it exactly.

Specifically, do NOT:
- shorten, summarize, elide, or "..." any string constant. The four String.raw
  blocks (TEXTBOOK_REFERENCE, LESSON_CONFIG, EXTENSION_PROBLEMS, REPORT_FORMAT)
  are long on purpose — they are the tutor's entire knowledge of this lesson.
- change INTERACTION_ID. The 8-hex suffix is a per-offering id required by
  contract; it cannot be regenerated and a changed one routes every cadet
  report to nothing.
- change SUBMIT_ENDPOINT. A wrong URL fails silently — the cadet finishes,
  sees success, and the work reaches nothing.
- change MODEL_CANDIDATES, or "update" them to a newer model. They are
  deliberately non-dated with a fallback.
- remove BACKUP_ENDPOINT, the "Open the backup version" button on the start
  screen, or the "Continue on Gemini" button in the error bar. Two of them is
  not a duplicate: one is offered before the cadet starts, the other after
  their tutor has already died mid-lesson.
- make the tail of buildSystemPrompt unconditional again. EXTENSION_PROBLEMS
  and REPORT_FORMAT are attached by phase on purpose. The blocks themselves
  are complete and must stay complete; only WHEN they are sent is conditional.
- drop the "&v=claude" marker from the submit URL, or the model fields the
  report payload records.
- add an API key field, or any x-api-key / Bearer / anthropic-version header.
  Auth is injected by the platform; adding one breaks it.
- convert to HTML. Raw-HTML artifacts cannot open the submit link.
- change .app height to 100vh/100dvh, or use scrollIntoView. Both make the
  embed grow every turn.
- add Copy or Download buttons, or remove the jitt-data payload handling.
- reformat, refactor, rename, add comments, or "clean up" anything.

If any part of the file is unclear or looks wrong, say so and stop. Do not
fix it.

After publishing, confirm to me:
  1. total line count of what you published
  2. the exact value of INTERACTION_ID
  3. that the last line of the file is a single closing brace
```

Then **Share → Publish** and copy the public URL (`https://claude.ai/public/artifacts/…`).

---

## 3. Check the three confirmations before you trust it

| check | against |
|---|---|
| line count | the `wc -l` from step 1 |
| `INTERACTION_ID` | the `grep` from step 1, **character for character including the 8-hex tail** |
| last line | a single `}` |

**A line count meaningfully below step 1's is the failure to watch for**, and it is invisible: a
truncated `TEXTBOOK_REFERENCE` still compiles, still runs, and still holds a conversation. The tutor
simply knows less than the lesson requires and fills the gap by improvising — which is the one thing
the grounding exists to prevent.

**If any of the three disagree, do not publish.** Start a fresh session and attach the file again;
do not ask the session to patch what it produced, because you cannot see what else it changed.

Then open the published URL and **run one turn** — enter a last name, start, and answer the opening
question. This is the only real syntax check the file gets. Confirm on the start screen: last-name
field, `Start Preflight →`, the Study Mode button, the boxed Honor Code, and the connection dot.
**Nothing on that screen should be wider than the cards it sits in.** The connection row, its red
message and the backup button are all capped at the card width; a control running out past the cards
is the cap having failed to apply, and it is visible on any publish.

**There are now TWO backup doors, and a one-turn check will not produce either of them.**

- **`Open the backup version →`, on the start screen.** It renders only when the connection check
  *fails*, so a healthy publish will not show it. If the dot *does* come up red — common on a capped
  account, which is exactly when a cadet meets it — take the free look: **solid navy fill**, full
  width, no wider than the cards above it. It was a white outline until 2026-08-20, and the fill is
  the point: a cadet whose account is capped needs it to read as an action, not as a footnote under
  the thing that just failed.
- **`Continue on Gemini →`, beside Retry in the error bar.** Added 2026-08-20. It appears only after
  a request has actually failed mid-lesson, and it carries the conversation so far across to the
  backup build so the cadet resumes instead of restarting.

Neither absence proves anything. Check the source instead — `grep -c BACKUP_ENDPOINT` reports **3**
on a patched artifact, one for the constant and one for each door — and confirm the lesson has a
build in [`site/data/backup-builds.json`](../../site/data/backup-builds.json). A button whose slug
has no entry sends the cadet to a page that correctly says "no backup for this lesson yet", which is
honest but useless to someone whose tutor just died.

*(Every artifact has carried `BACKUP_ENDPOINT` since 2026-08-20. The kit dialect has had it since
2026-08-14; PHYS 110's five were built outside the kit and had no backup door at all until
`patch_artifacts.py` gave them one — their Gemini builds existed on the server the whole time with
nothing in the lesson pointing at them.)*

---

## 4. Know what you just made permanent

- **The slug is baked in.** `INTERACTION_ID` carries a per-offering 8-hex suffix
  (`INTERACTION-DATA-CONTRACT.md` §3.2) minted once at build time and **not reproducible**.
  *Rebuilding* this lesson through the factory mints a *different* one, which registers as a *new
  lesson row* rather than updating this one. That is intended — it is what keeps one term's reports
  out of another term's delete. Never hand-copy a suffix forward to avoid it.
  **A hand patch is the other case:** it does not touch `INTERACTION_ID`, so republishing it keeps
  the slug and needs only an `artifact_url` update. That is §5, and it is the common case now.
- **The model list is baked in**, and since 2026-08-20 the ladder walks on a *usage* limit as well
  as a missing model. A 404 steps to the next candidate as it always did; a 429 now does too, once
  its retries are spent — so a capped cadet drops to the lighter model instead of being told to
  "wait a moment and Retry", which is advice that never comes true for a usage cap. The ladder never
  climbs back up, which is what makes the model recorded on the report an exact answer to *was this
  session downgraded*. When **every** entry is capped the artifact no longer dead-ends: it says so
  and points at the Gemini button. Every entry being *retired* is the case that still dead-ends, and
  republishing is still the only fix — keeping two live model *families* is what makes it unlikely.
- **The submit endpoint is baked in**, and a wrong one fails with no error anywhere — the cadet
  completes the session, sees a success page, and the work reaches nothing. There is no
  acknowledgement hop.
- **Editing the source in this repository changes nothing** about what is already published.

---

## 5. Republishing a patched artifact

This is now the common case: the `.jsx` was changed **in this repository** — by
[`patch_artifacts.py`](../../scripts/artifacts/patch_artifacts.py) or a hand fix — and the same
lesson has to go live again. It is **not** a rebuild, and that difference is the whole section.

**The slug does not change, and keeping it is REQUIRED, not preferred.** `app.activities.slug` is
`NOT NULL UNIQUE` — globally unique, not per course — and every student report hangs off the row it
names. A new slug is therefore a new row, and every cadet who already finished that lesson is
orphaned: their submission still exists, attached to a lesson nobody is looking at any more, with
nothing reporting the split. A patch leaves `INTERACTION_ID` alone for exactly that reason, and
`patch_artifacts.py` asserts byte-equality of the slug line before it writes so the rule cannot be
broken by accident.

So the database change is at most one field:

| | what happens |
|---|---|
| the lesson row | **not** re-registered. No prefill link, no second row |
| `INTERACTION_ID` | unchanged — and step 3 is what proves it |
| `activities.content.artifact_url` | update it **only if** claude.ai issued a new share URL |
| submissions and grades already collected | untouched, and still attached |

**Publishing a patch is still publishing.** Run steps 1–3 exactly as written, on every file, every
time. Two things move that trip people up:

- **The line count changed**, because a patch adds lines. Take a fresh `wc -l` in step 1 and compare
  step 3's confirmation against *that*, not against a number you wrote down before the patch.
- **The published URL may change.** claude.ai does not guarantee the same share URL on a republish.
  If you get a new one, open that lesson in `site/faculty/lessons.html` and edit the link. Do **not**
  reach for the prefill link: it *creates*, and the row already exists.

Then write the new URL into that course's `BUILD-LOG.md` before the next `sync_artifacts.py push`,
or the regenerated `index.json` drops it silently — see
[`ONBOARD-ARTIFACTS.md`](ONBOARD-ARTIFACTS.md) §6.

---

## 6. Push the source to Storage

**Do this every time you publish, before you close the session.** The `.jsx` is gitignored — it is a
local cache, so a build that only ever exists in your working copy is a build nobody else can read.
The faculty **Artifacts** page loads each source from the `artifact-sources` bucket on demand; an
artifact you skipped is one whose Source card can never open, on every machine but yours.

```
python scripts/artifacts/sync_artifacts.py status          # what differs, changes nothing
python scripts/artifacts/sync_artifacts.py push            # dry run — read the list
python scripts/artifacts/sync_artifacts.py push --commit
```

It is idempotent and compares by hash, so re-running it costs nothing and a clean tree reports
`0 would be pushed`. Push the whole tree rather than hunting for the one file you changed — that is
what makes "did I remember?" a question you never have to answer.

What it uploads per artifact: `source.jsx`, and a `build.json` assembled from `BUILD-LOG.md` +
`REVIEW-NOTES.json`. Review decisions made **on the site** flow the other way — `pull-reviews`
brings those back into the repo, and `push` deliberately never overwrites a review sidecar that
Storage already holds.

> Two bugs made this step look optional until 2026-08-07, and both are fixed: `push` could only
> ever *create* (Storage answers a duplicate with HTTP 400 carrying `statusCode: 409`, so the
> upsert retry never fired and every update failed), and each `build.json` carried a fresh
> `generated_at`, so all 48 records reported as changed on every run whether or not anything had.
> If you see either symptom again, it is a regression, not the normal state.

---

## 7. Next

Go to [`PREFILL-LINK.md`](PREFILL-LINK.md) with the public URL. Nothing is graded until the lesson
row exists and the `id` on it equals this artifact's `INTERACTION_ID`.
