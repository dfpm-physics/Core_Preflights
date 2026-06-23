# Prefill link for new lesson interactions (instructions for Claude)

When you (Claude) finish building a **lesson-interaction artifact** and have its public
URL, generate a one-click link for the course director. Opening that link loads the site's
interaction manager with the **"New interaction" form already filled in** — the director
just reviews and clicks **Save**. Nothing is written automatically.

## The link

**Base (in-app manager):**
`https://dfpm-physics.github.io/Core_Preflights/app/faculty/interactions.html`

> The manager currently lives under `/app/` during the front-end refactor. After the app is
> promoted to the site root, drop `/app/` → `…/Core_Preflights/faculty/interactions.html`.
> The legacy page `…/Core_Preflights/interactions-admin.html` accepts the **same**
> parameters and its URL never changes, so use that base instead if you'd rather have a link
> that survives the promotion without editing.

Append a query string with these parameters (URL-encode every value):

| Param | Required | Meaning | Example |
|-------|:--------:|---------|---------|
| `new` | ✅ | Trigger flag — set to `1`. | `new=1` |
| `id` | ✅ | Interaction **slug**: lowercase letters, numbers, hyphens only. **Must equal the slug your artifact uses in its report callback** (see below). | `lesson-02-charge` |
| `course` | ✅ | Course id. | `phys-215` or `phys-110` |
| `title` | ✅ | Human-readable title shown to students. | `Lesson 02 — Charge & Coulomb's Law` |
| `desc` | ⬜ | Short description shown to students. | `Interactive intro to electric charge` |
| `url` | ✅ | The artifact's **public URL** — the link students open to launch the activity. | `https://claude.ai/public/artifacts/abc123` |
| `pub` | ⬜ | `1` = publish immediately; omit or `0` = save as draft (recommended). | `pub=0` |

### ⚠️ Critical: the slug must match in two places
The `id` in this link **must be the exact same slug** your artifact embeds when it sends a
student's report back to the site — i.e. the `#i=<slug>` in
`artifact-submit.html#i=<slug>&r=...` (see `INTERACTION-DATA-CONTRACT.md` for the full
submission format; `interaction-submit.html` still works as a redirect alias). Choose **one**
slug and use it in both places. If they differ, the database rejects every student report
(foreign key to `interactions.id`).

### Encoding
URL-encode each value (`encodeURIComponent`). For example a space → `%20`, an em dash
`—` → `%E2%80%94`, an apostrophe `'` → `%27`, `&` → `%26`.

## Example

Slug `lesson-02-charge`, course `phys-215`, artifact at
`https://claude.ai/public/artifacts/abc123`:

```
https://dfpm-physics.github.io/Core_Preflights/app/faculty/interactions.html?new=1&id=lesson-02-charge&course=phys-215&title=Lesson%2002%20%E2%80%94%20Charge%20%26%20Coulomb%27s%20Law&desc=Interactive%20intro%20to%20electric%20charge&url=https%3A%2F%2Fclaude.ai%2Fpublic%2Fartifacts%2Fabc123&pub=0
```

## Build snippet (drop into your skill)

```js
const SLUG = 'lesson-02-charge';            // pick ONE slug; use it in the artifact too
const base = 'https://dfpm-physics.github.io/Core_Preflights/app/faculty/interactions.html';
const params = new URLSearchParams({
  new: '1',
  id: SLUG,                                  // ← must match the artifact's #i=<slug> callback
  course: 'phys-215',                        // 'phys-215' or 'phys-110'
  title: "Lesson 02 — Charge & Coulomb's Law",
  desc: 'Interactive intro to electric charge',
  url: artifactPublicUrl,                    // the artifact's public URL
  pub: '0',                                  // '0' draft (recommended) or '1' publish now
});
const prefillLink = `${base}?${params.toString()}`;
// Present `prefillLink` to the director as a clickable link.
```

`URLSearchParams.toString()` handles the encoding for you, so you don't need to encode the
values yourself when you build it this way.

## What the director experiences

1. Clicks the link (signs in if not already).
2. The **"New interaction — review & save"** modal opens, prefilled with your values
   (or **"Update — review & save"** if that slug already exists).
3. Reviews — especially the **slug** and **artifact URL** — and clicks **Save**.
4. Publishes when ready (or you set `pub=1` to prepublish).

The query string is cleared from the address bar after the form opens, so a refresh won't
re-open or resubmit it.

## Notes & guardrails

- Only **course directors / admins** can add interactions. An instructor who opens the link
  just lands on the interactions page — the create form won't open for them.
- Nothing is saved until the director clicks **Save** — the link only prefills the form, so
  a crafted link can't write to the database on its own.
- **Re-using a slug updates that interaction.** If the `id` already exists, the link opens it
  in **"Update — review & save"** mode and Save *patches* it (title / description / artifact
  URL / published) instead of erroring on the duplicate id. Any field you omit from the link
  keeps its existing value — so regenerating an artifact and re-sending the link (e.g. with a
  fresh `url`) cleanly refreshes the existing listing rather than creating a duplicate.
- Keep the slug **stable**: it's the permanent id and is referenced by every student report.
  Don't change it after the first reports come in.
