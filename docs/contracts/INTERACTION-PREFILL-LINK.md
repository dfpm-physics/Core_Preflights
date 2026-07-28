# Prefill link for new lessons (instructions for Claude)

When you (Claude) finish building a **lesson-interaction artifact** and have its public
URL, generate a one-click link for the course director. Opening that link loads the site's
**Lessons** manager with the **New-Lesson form already filled in** — the director just reviews
and clicks **Save**. Nothing is written automatically.

A *lesson* groups a written **Free-Response** preflight and an **AI Interaction** under one id
(see `../architecture/LESSON-UNIFICATION.md`). Your artifact is the interaction half; `policy`
below decides whether the written half exists too.

## The link

**Base:**
`https://dfpm-physics.github.io/Core_Preflights/site/faculty/lessons.html`

> **Use this base and no other.** It survived the app promotion by construction: until 2026-07-28
> `site/faculty/lessons.html` was a stub forwarding into `site/app/faculty/lessons.html`, and the
> promotion moved the app tree up so the real page landed on exactly this path. Links generated
> before that date keep working with no edit, which was the point.
>
> `site/app/faculty/…` no longer exists — it was never a valid target and is now a 404. The older
> `site/interactions-admin.html` and `site/app/faculty/interactions.html` bases are **retired**
> and are not part of this contract.

Append a query string with these parameters (URL-encode every value):

| Param | Required | Meaning | Example |
|-------|:--------:|---------|---------|
| `new` | ✅ | Trigger flag — set to `1`. | `new=1` |
| `id` | ✅ | **Lesson slug** *and*, by default, the **interaction slug**: lowercase letters, numbers, hyphens. **Must equal the slug your artifact posts in `#i=`** (see below). | `lesson-02-charge` |
| `course` | ✅ | Course id. | `phys-215` or `phys-110` |
| `title` | ✅ | Lesson title shown to students. | `Lesson 02 — Charge & Coulomb's Law` |
| `url` | ✅ | The artifact's **public URL** — what students open to launch it. Maps to the interaction's `artifact_url`. | `https://claude.ai/public/artifacts/abc123` |
| `policy` | ⬜ | `preflight` \| `interaction` \| `choice`. Artifact-only lesson → `interaction`; artifact *or* written preflight → `choice`. | `policy=choice` |
| `desc` | ⬜ | Lesson description. | `Interactive intro to electric charge` |
| `iid` | ⬜ | Interaction slug, **only if different** from `id`. Defaults to `id`. | `lesson-02-charge` |
| `ititle` / `idesc` | ⬜ | Interaction title / description. Default to the lesson's. | |
| `num` | ⬜ | Lesson number (ordering). | `2` |
| `due_m` / `due_t` | ⬜ | M-day / T-day due dates, `YYYY-MM-DD`. | `2026-08-24` |
| `pub` | ⬜ | `1` = publish immediately; omit or `0` = save as draft (recommended). | `pub=0` |

> Anything not in this table is **ignored** — the page reads exactly these keys. In particular
> there is no parameter for lesson **objectives**; the director sets those by hand after Save.

### ⚠️ Critical: the slug must match in two places
The `id` in this link **must be the exact same slug** your artifact embeds when it sends a
student's report back to the site — i.e. the `#i=<slug>` in
`site/student/interaction-submit.html#i=<slug>&r=...` (see `INTERACTION-DATA-CONTRACT.md` for the
full submission format). Choose **one** slug and use it in both places. If they differ, the
database rejects every student report (foreign key to `interactions.id`).

### Encoding
URL-encode each value (`encodeURIComponent`). For example a space → `%20`, an em dash
`—` → `%E2%80%94`, an apostrophe `'` → `%27`, `&` → `%26`.

## Example

Slug `lesson-02-charge`, course `phys-215`, artifact at
`https://claude.ai/public/artifacts/abc123`:

```
https://dfpm-physics.github.io/Core_Preflights/site/faculty/lessons.html?new=1&id=lesson-02-charge&course=phys-215&title=Lesson%2002%20%E2%80%94%20Charge%20%26%20Coulomb%27s%20Law&desc=Interactive%20intro%20to%20electric%20charge&url=https%3A%2F%2Fclaude.ai%2Fpublic%2Fartifacts%2Fabc123&policy=choice&pub=0
```

## Build snippet (drop into your skill)

```js
const SLUG = 'lesson-02-charge';            // one slug → lesson id AND the artifact's #i=
const base = 'https://dfpm-physics.github.io/Core_Preflights/site/faculty/lessons.html';
const params = new URLSearchParams({
  new: '1',
  id: SLUG,                                  // ← must match the artifact's #i=<slug> callback
  course: 'phys-215',                        // 'phys-215' or 'phys-110'
  title: "Lesson 02 — Charge & Coulomb's Law",
  desc: 'Interactive intro to electric charge',
  url: artifactPublicUrl,                    // the artifact's public URL
  policy: 'choice',                          // 'interaction' (artifact only) or 'choice' (either path)
  pub: '0',                                  // '0' draft (recommended) or '1' publish now
});
const prefillLink = `${base}?${params.toString()}`;
// Present `prefillLink` to the director as a clickable link.
```

`URLSearchParams.toString()` handles the encoding for you, so you don't need to encode the
values yourself when you build it this way.

## What the director experiences

1. Clicks the link (signs in if not already).
2. The **"New lesson — review & save"** form opens, prefilled with your values (or the
   **Edit lesson** form if that slug already exists).
3. Reviews — especially the **slug** and **artifact URL** — and clicks **Save**.
4. Publishes when ready (or you set `pub=1` to prepublish).

The query string is cleared from the address bar after the form opens, so a refresh won't
re-open or resubmit it.

## Notes & guardrails

- Only **course directors / admins** can add lessons. An instructor who opens the link just
  lands on the page — the form won't open for them.
- Nothing is saved until the director clicks **Save** — the link only prefills the form, so a
  crafted link can't write to the database on its own.
- **Re-using a slug edits that lesson.** If the `id` already exists, the link opens it in the
  edit form and Save patches it, keeping the same interaction row (and therefore the same `#i=`
  slug) rather than erroring on a duplicate id. So regenerating an artifact and re-sending the
  link with a fresh `url` cleanly refreshes the existing lesson instead of creating a duplicate.
- Keep the slug **stable**: it's the permanent id and is referenced by every student report.
  Don't change it after the first reports come in.
