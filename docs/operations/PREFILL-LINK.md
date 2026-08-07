# Runbook — registering a built artifact on the DFPM site

**Reader:** recker, holding a finished `.jsx` and wanting the interaction live on the course site.
**Reviewed:** 2026-08-04

> **Written for PHYS 310; the procedure is general, the values are not.** As of 2026-08-04 a second
> course exists (`courses/phys-215/`), and the two deliberately differ on **the slug shape** and on
> `course`. Every step below is correct for either course once you substitute the right values from
> that course's `COURSE_PROFILE.md` — but **substitute deliberately**, because a slug that looks
> wrong for one course is correct for the other:
>
> | | PHYS 310 | PHYS 215 |
> |---|---|---|
> | slug | `phys310-<topic>-<8hex>` — **no lesson number** | `lesson-<NN>-<topic>-<8hex>` — **lesson number required** |
> | `course` | `phys-310` | `phys-215` |
> | artifacts | `courses/phys-310/artifacts/` | `courses/phys-215/artifacts/` |
>
> The 8-hex suffix is contract §3.2 and is **mandatory for both.**

You have three things to do in order: **publish** the artifact, **get a prefill link**, **click Save
on the site**. Nothing about this is automated — the artifact is published from a Claude session by
hand, and the site is written by a form you submit yourself.

> **The one thing that silently destroys a lesson:** the `id` in the prefill link must equal the
> slug the artifact embeds in `#i=`, byte for byte. If they differ, every cadet completes the
> session, sees a success screen, and the receiver rejects the report because it cannot resolve the
> slug. There is no error, no bounce, and no acknowledgement hop — you find out when you go looking
> for submissions that were never stored. **Verify the slug yourself (Step 3). Do not take Claude's
> word for it.**

---

## Step 1 — Publish the artifact and copy its URL

In the course's Claude Project, publish the `.jsx`. Copy the public URL — it looks like
`https://claude.ai/public/artifacts/<id>`.

Publishing is the irreversible step (`CORE.md` §6): slug, objective keys, submit URL, and model
candidates are baked in at publish time. Changing any of them later is a rebuild **and** a
re-publish, not an edit.

## Step 2 — Ask Claude for the prefill link

Paste this into the same session, filling the three bracketed values:

```text
Generate the DFPM prefill link for this artifact, following
contracts/INTERACTION-PREFILL-LINK.md.

  artifact URL: [paste the public URL from Step 1]
  lesson title: [the cadet-facing title, e.g. "Atoms and Nuclei"]
  lesson number: [the Lsn number from the schedule, e.g. 2]

Rules:
- course = phys-310
- id = the INTERACTION_ID constant already in this artifact's source. Read it
  from the file. Do NOT invent, re-derive, or re-slugify it.
- policy = interaction   (PHYS 310 preflights are artifact-only)
- pub = 0                (save as draft; I publish from the site)
- Build it with URLSearchParams so encoding is handled.
- Print the INTERACTION_ID on its own line above the link so I can verify it.
```

The last rule is the point of the whole step. **A link whose `id` Claude re-derived instead of
reading from the file is the exact failure this runbook exists to prevent.**

That was already true when the slug was minted from topic text alone — one character normalized
differently produces a plausible, wrong slug. It is now **impossible to re-derive at all**, which is
stronger: `INTERACTION-DATA-CONTRACT.md` §3.2 requires the slug to end in **8 random lowercase hex**,
minted once per build (`phys310-atoms-and-nuclei-83022f32`). Nothing can regenerate that suffix. If
the `id=` Claude hands you has no 8-hex tail, or has a *different* tail than the file, the link is
wrong and every cadet report against it will be rejected by the receiver.

## Step 3 — Verify the slug against the file

Do not skip this. From the repository root:

```bash
grep -n 'INTERACTION_ID' "courses/phys-310/artifacts/<file>.jsx"
```

Compare that string to the `id=` in the link Claude produced. They must match exactly — same
hyphens, **same 8-hex suffix**, no trailing characters, no lesson number added or removed.

**A rebuilt artifact has a different slug, and that is by design.** §3.2 mints a fresh suffix on
every build so each course offering gets its own `activities` row — without that, every term sharing
a lesson shares one row, and deleting a rebuilt lesson in one term can reach another term's reports.
So re-registering a rebuild **creates a new lesson row rather than updating the old one.** Do not
paste an old suffix into a new artifact to keep the same row; that is the reuse §3.2 forbids.

**Whether a lesson number belongs in the slug is per-course, and getting this backwards "fixes" a
correct slug into a broken one.** Check the course's profile, not your memory:

- **PHYS 310** carries **no lesson number** (`COURSE_PROFILE.md` → "Slug namespacing"), so
  `phys310-energy-atoms-and-nuclei-<8hex>` is correct and `phys310-lesson-02-energy-atoms-and-nuclei-<8hex>`
  is a regression someone "restored."
- **PHYS 215** requires one (`COURSE_PROFILE.md` → "Slug rule"), so
  `lesson-02-electric-charge-coulombic-force-<8hex>` is correct and the number is **not** a
  regression to strip. It keeps the pilot's stem so new rows sort with the already-published
  PHYS 215 set.

The `num=` parameter is different from either and is fine — that is display ordering on the site,
not the identity key.

## Step 4 — Open the link and Save

The link opens the **New lesson — review & save** form with everything filled in. Nothing is written
until you click Save; the link only prefills.

Check on the form before saving:

- **slug** — matches Step 3
- **artifact URL** — is the one you just published, not a previous build
- **course** — the `course_id` from that course's profile (`phys-310` or `phys-215`)
- **title** — what you want a cadet to see

Then Save. It saves as a draft (`pub=0`); publish from the site when the lesson is ready.

---

## The parameters, if you ever build a link by hand

Full table and encoding rules: [`INTERACTION-PREFILL-LINK.md`](../../preflight-kit/contracts/INTERACTION-PREFILL-LINK.md)
— a frozen contract, so it is authoritative over this page.

Base — **use this and no other**; the older `site/app/faculty/…` and `site/interactions-admin.html`
bases are retired and now 404:

```
https://dfpm-physics.github.io/Core_Preflights/site/faculty/lessons.html
```

| param | PHYS 310 value |
|---|---|
| `new` | `1` |
| `id` | the artifact's `INTERACTION_ID`, read from the file |
| `course` | `phys-310` |
| `title` | cadet-facing lesson title |
| `url` | the published artifact URL |
| `policy` | `interaction` |
| `pub` | `0` |
| `num` | the `Lsn` number (ordering only — never part of the slug) |
| `due_m` / `due_t` | `YYYY-MM-DD`, optional |

Anything not in the contract's table is ignored by the page. There is no parameter for lesson
**objectives** — set those by hand after Save.

## Re-registering after a rebuild

**Re-using a slug edits that lesson rather than erroring.** Regenerate the artifact, publish it,
generate a link with the same `id` and the new `url`, and Save — the existing lesson is updated and
keeps its interaction row, so previously collected reports still resolve.

**Do not change the slug after the first reports come in.** It is the permanent id every stored
report references. Changing a lesson's *topic text* after publish desynchronizes the slug from the
registered one (`COURSE_PROFILE.md` → "Slug namespacing"), which is the same failure wearing a
different hat — settle topic wording before building.

## Known unverified

**`course_id: phys-310` has never been confirmed to exist on the receiver** (`CORE.md` §8). It
follows the PHYS 215 pilot's pattern, and nobody has checked the DFPM course list. **Confirm it
before the first real lesson ships** — an unknown course id is one of the two ways a submission
lands nowhere silently.

The other way is a wrong `submit_endpoint`, which is why `COURSE_PROFILE.md` marks the two endpoint
values as byte-identical to the pilot and not to be edited.
