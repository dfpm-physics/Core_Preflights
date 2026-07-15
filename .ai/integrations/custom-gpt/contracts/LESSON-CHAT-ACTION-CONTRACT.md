# Lesson Chat Input + Custom GPT Action Contract

> Archived July 15, 2026 when the Custom GPT transfer path was paused.

**Status:** Version 1 design is frozen for staged implementation. No behavior in this
document is live until the applicable stages are completed and verified.

**Scope:** The one-click handoff from a Custom GPT that has generated a lesson interaction,
the faculty choice to create a new lesson or attach/update an existing lesson, persistence of
the lesson-specific Markdown input, and the read-only Actions that later retrieve that input.

**Companion contracts:**

- `INTERACTION-PREFILL-LINK.md` — current query-string prefill links. They remain supported.
- `INTERACTION-DATA-CONTRACT.md` — student interaction report submission. This contract does
  not change its endpoint, hash keys, codec, or schema.
- `LESSON-UNIFICATION.md` — lesson/component ownership and completion policies.

---

## 1. Outcomes

After implementation, the authoring workflow is:

1. A Custom GPT generates an interaction artifact plus the Markdown that should guide the
   lesson conversation.
2. The GPT calls the `createLessonPrefillLink` Action with the generated lesson metadata,
   interaction metadata, and Markdown.
3. The Action validates and compresses the payload, then returns one clickable faculty link.
4. Opening the link loads `site/app/faculty/lessons.html`, restores the payload across login if
   necessary, and opens a review form. Nothing has been written yet.
5. The default destination is **Create a new lesson**.
6. The director may instead select **Assign to existing lesson…**, review the exact effect,
   change the selection, or return to new-lesson mode without writing anything.
7. The final, effect-specific Save button performs one atomic database operation.
8. The saved Markdown can later be discovered with `listCourseLessons` and retrieved with
   `getLessonChatInput` by the Custom GPT.

The link transports Markdown text and an optional source filename. It does not transport a
browser `File` object or arbitrary binary data. If ChatGPT produced a `.md` file, the Action
request contains the file's UTF-8 text and may preserve its filename as metadata.

---

## 2. Frozen invariants

These rules are requirements, not implementation suggestions:

1. **Default-new:** Every generated link starts in new-lesson mode. A matching slug must never
   silently convert the operation into an update.
2. **Review before write:** Decoding a link, choosing a destination, changing a destination,
   previewing Markdown, and returning to new-lesson mode perform no database writes.
3. **Immutable incoming package:** The decoded GPT payload is retained as a pristine source.
   A destination-specific editor model is derived from it; changing destinations rebuilds the
   model rather than carrying values forward from the previously selected lesson.
4. **Preserve existing lesson metadata:** Assigning to an existing lesson does not replace its
   lesson id, course, title, description, lesson number, objectives, due dates, points,
   publication state, preflight id, or preflight questions.
5. **Interaction-only overlay:** For an existing destination, only the incoming interaction
   fields and lesson chat input are candidates for change, plus the policy transition described
   in Section 7.
6. **Explicit replacement:** If the destination already points at a different interaction id,
   replacement requires an explicit confirmation after the picker shows both ids.
7. **Submitted-work guard:** A different interaction may not replace the destination's current
   interaction after any `preflight_interaction_reports` row exists for the current interaction.
8. **No cross-lesson hijack:** An incoming interaction id already attached to another lesson may
   not be silently moved or shared. The director must update its current lesson or choose a new
   interaction id.
9. **Atomic final save:** An existing-lesson attach/update must save the interaction, chat input,
   lesson foreign key, and completion-policy transition together or save none of them.
10. **Optimistic concurrency:** Final save must fail safely if the lesson, current interaction,
    or current input version changed after the destination was selected.
11. **No implicit deletion:** Replacing an unsubmitted interaction detaches the old interaction
    but does not delete its row. Clearing or replacing Markdown creates an explicit version
    change; deleting a lesson may cascade its current input according to the schema contract.
12. **Published-only retrieval:** GPT retrieval Actions expose only published lessons. Draft
    lesson input remains private even when it has been saved.
13. **No service secret in the browser:** Supabase service credentials and the GPT Action secret
    exist only in Edge Function secrets.
14. **Backward compatibility:** Existing query-string lesson prefill links and the frozen student
    report-submission contract continue to work.

---

## 3. Action surface

Custom GPT Actions require authentication configuration and an OpenAPI JSON/YAML schema with
operation ids. API-key Bearer authentication is supported for server-to-server access. See
OpenAI's current [Configuring actions in GPTs](https://help.openai.com/en/articles/9442513).

The implementation will expose these operations under the Supabase Edge Function domain:

| Operation id | Method | Purpose | Mutates course data? |
|---|---|---|---|
| `createLessonPrefillLink` | `POST` | Validate/compress an incoming authoring package and return a faculty link | No |
| `listCourseLessons` | `GET` | List published lessons and their input availability for one course | No |
| `getLessonChatInput` | `GET` | Return one published lesson's current Markdown input | No |

All three operations use the same configured Bearer Action secret. The Edge Functions validate
that secret independently of Supabase user JWTs. The authoring link still requires the director
to authenticate in the faculty site before saving.

### 3.1 `createLessonPrefillLink`

Conceptual route:

```text
POST /functions/v1/gpt-create-lesson-link
```

Request body: the uncompressed payload in Section 4.

Successful response:

```json
{
  "schema": 1,
  "url": "https://dfpm-physics.github.io/Core_Preflights/site/app/faculty/lessons.html#lp=...",
  "raw_bytes": 18422,
  "packed_characters": 6910,
  "expires_at": null
}
```

This Action is stateless: it does not save a draft or course record. `expires_at` is therefore
`null`; the field is reserved for a possible future short-token fallback.

The returned URL must not exceed **24,000 characters** in version 1. If it would, the Action
returns `422 prefill_too_large` with the measured sizes and asks the GPT to shorten/split the
input. A short-token fallback is explicitly deferred.

### 3.2 `listCourseLessons`

Conceptual route:

```text
GET /functions/v1/gpt-list-lessons?course_id=phys-215
```

Successful response shape:

```json
{
  "schema": 1,
  "course": { "id": "phys-215", "title": "Physics 215" },
  "lessons": [
    {
      "lesson_id": "lesson-02-charge",
      "lesson_number": 2,
      "title": "Electric Charge and Coulomb's Law",
      "description": null,
      "completion_policy": "choice",
      "input_available": true,
      "input_version": 3,
      "next_action": {
        "operation_id": "getLessonChatInput",
        "arguments": {
          "course_id": "phys-215",
          "lesson_id": "lesson-02-charge"
        }
      }
    }
  ]
}
```

All published lessons for the course appear, including published lessons whose input is missing.
For missing input, `input_available` is `false`, `input_version` is `null`, and `next_action` is
`null`. Draft lessons never appear.

### 3.3 `getLessonChatInput`

Conceptual route:

```text
GET /functions/v1/gpt-lesson-input?course_id=phys-215&lesson_id=lesson-02-charge
```

Successful response shape:

```json
{
  "schema": 1,
  "course_id": "phys-215",
  "lesson_id": "lesson-02-charge",
  "lesson_number": 2,
  "title": "Electric Charge and Coulomb's Law",
  "content_type": "text/markdown",
  "source_filename": "lesson-02-input.md",
  "version": 3,
  "content_sha256": "lowercase-hex-digest",
  "updated_at": "2026-07-13T18:00:00Z",
  "markdown": "# Lesson 02\n\n..."
}
```

The function returns `404` for an unknown lesson, a course/lesson mismatch, an unpublished
lesson, or a lesson without input. Those cases must not reveal whether a private draft exists.

---

## 4. Authoring payload v2

The Action receives and validates this uncompressed JSON object:

```json
{
  "schema": 2,
  "kind": "lesson_interaction_prefill",
  "lesson": {
    "id": "lesson-02-charge",
    "course_id": "phys-215",
    "title": "Electric Charge and Coulomb's Law",
    "description": "Optional lesson description",
    "lesson_number": 2,
    "completion_policy": "interaction",
    "due_date_m": null,
    "due_date_t": null,
    "objectives": [
      { "key": "charge-model", "label": "Charge model" }
    ]
  },
  "interaction": {
    "id": "lesson-02-charge",
    "title": "Charge and Coulomb's Law Interaction",
    "description": "Optional student-facing description",
    "artifact_url": "https://chatgpt.com/..."
  },
  "chat_input": {
    "format": "markdown",
    "source_filename": "lesson-02-input.md",
    "markdown": "# Lesson 02\n\n..."
  }
}
```

### 4.1 Required fields and validation

| Field | Rule |
|---|---|
| `schema` | Exactly `2` |
| `kind` | Exactly `lesson_interaction_prefill` |
| `lesson.id` | Lowercase letters, digits, and hyphens; 1–100 characters |
| `lesson.course_id` | Non-empty existing/allowed course id; 1–100 characters |
| `lesson.title` | Non-empty; at most 300 characters |
| `lesson.description` | Optional/null; at most 2,000 characters |
| `lesson.lesson_number` | Optional/null nonnegative integer |
| `lesson.completion_policy` | `interaction` or `choice` for generated interaction links |
| `lesson.due_date_m`, `due_date_t` | Optional/null `YYYY-MM-DD` strings |
| `lesson.objectives` | At most 20 unique keys; each key matches the slug rule; labels at most 300 characters |
| `interaction.id` | Same slug rule as lesson id; does not have to equal lesson id |
| `interaction.title` | Optional/null; defaults to lesson title; at most 300 characters |
| `interaction.description` | Optional/null; at most 2,000 characters |
| `interaction.artifact_url` | Required absolute `https` URL; at most 2,000 characters |
| `chat_input.format` | Exactly `markdown` |
| `chat_input.source_filename` | Optional/null display metadata; basename only; at most 255 characters |
| `chat_input.markdown` | Required nonblank UTF-8 text; at most 100,000 UTF-8 bytes |

Unknown fields are ignored for forward compatibility, but the Action returns only normalized
known fields in the packed payload. HTML is permitted as inert Markdown content; it is never
executed by the editor. Any preview must sanitize rendered output.

The payload cannot request publication. Generated links always open for review, and publication
remains an explicit faculty decision.

---

## 5. Link transport and login recovery

### 5.1 Codec and URL

The Action normalizes the payload, then encodes:

```js
LZString.compressToEncodedURIComponent(JSON.stringify(normalizedPayload))
```

using **lz-string 1.5.0**, matching the repository's existing interaction-report codec.

The version-2 authoring link is:

```text
https://dfpm-physics.github.io/Core_Preflights/site/app/faculty/lessons.html#lp=<packed-payload>
```

The full package lives in the URL fragment. It is not sent to GitHub Pages as part of the HTTP
request. It is still visible to anyone who possesses the link, in browser history until cleared,
and in the ChatGPT conversation that produced it. Faculty must not place unrelated secrets in the
lesson input.

### 5.2 Capture before authentication

The faculty page must capture a valid-looking `#lp=` value into `sessionStorage` before calling
the shared `bootstrap()` function because the current login `next` round-trip does not preserve
fragments.

Session record:

```json
{
  "schema": 1,
  "path": "/Core_Preflights/site/app/faculty/lessons.html",
  "packed": "...",
  "captured_at": 1783972800000
}
```

Rules:

- Key: `cp.lessonPrefill.v2`.
- Maximum age: two hours.
- Restore only on the same normalized lessons-page path.
- Prefer the current URL fragment over a stored value.
- Remove the stored value after successful decode or explicit dismissal.
- Reject and remove expired, malformed, oversized, wrong-schema, or wrong-kind values.
- After capture/decode, replace browser history with `location.pathname` so refresh does not
  reopen the package and the fragment is removed from the visible URL.
- A decoding error opens no editor and performs no write; show an actionable faculty error.

Existing query-string prefill parsing remains available. If both formats are present, the `#lp=`
version-2 payload wins and the query prefill is ignored.

---

## 6. Faculty destination state model

The UI maintains separate state:

```js
incomingPrefill  // deep-cloned/deep-frozen normalized payload; never edited
destination      // { mode: 'new' } or { mode: 'existing', lessonId, baseline tokens }
editorModel      // newly derived whenever incomingPrefill or destination changes
editorDirty      // whether the director edited the current derived model
```

Opening a generated link sets `destination = { mode: 'new' }` even when `lesson.id` matches an
existing lesson.

### 6.1 New-lesson destination

- Populate lesson, interaction, objectives, and Markdown from the incoming package.
- Seed the standard reading-reflection question when policy is `choice`.
- Keep Published unchecked.
- If `lesson.id` already exists in the course, disable final save and show:
  **“That lesson id already exists. Assign this interaction to that lesson or choose a new id.”**
- Do not silently add a suffix or silently select the existing row.

### 6.2 Existing-lesson picker

The **Assign to existing lesson…** button opens a picker limited to the incoming package's course.
Each row shows:

- lesson number and title;
- draft/published state;
- completion policy;
- whether a preflight exists and its question count;
- current interaction id, or **No interaction**;
- an effect label: **Add interaction**, **Update same interaction**, **Replacement requires
  confirmation**, or **Unavailable**.

A row click selects/highlights only. A separate **Use selected lesson** button applies the
selection to the unsaved editor. The picker itself never writes.

After selection, a destination banner shows the lesson and an exact change summary, plus:

- **Change destination** — reopen the picker;
- **Return to new lesson** — rebuild from the incoming package;
- no destructive action.

If `editorDirty` is true, changing destinations first confirms that unsaved edits to the current
derived model will be discarded. A clean accidental selection can be changed without a warning.

---

## 7. Existing-lesson merge matrix

Incoming generated lesson metadata is suggestive only when an existing destination is selected.
The destination's lesson-level fields remain authoritative.

| Destination state | Allowed result | Policy result | Extra confirmation |
|---|---|---|---|
| Preflight only | Attach incoming interaction + input; preserve all questions | `preflight` → `choice` | No |
| Interaction only, same interaction id | Update interaction fields + input | stays `interaction` | Show update summary |
| Choice, same interaction id | Update interaction fields + input; preserve preflight | stays `choice` | Show update summary |
| Interaction only, different id, zero current reports | Detach old id and attach incoming id | stays `interaction` | Yes, type/confirm replacement |
| Choice, different id, zero current reports | Detach old id and attach incoming id; preserve preflight | stays `choice` | Yes, type/confirm replacement |
| Any current interaction with one or more reports, different id | Block | unchanged | Not overridable in this workflow |
| Incoming id owned by another lesson | Block | unchanged | Resolve at the owning lesson or change incoming id |

Updating the same interaction id is allowed after reports exist because report foreign keys remain
stable. The UI must warn that changing the artifact/input affects future conversations while prior
reports remain historical records.

For an existing destination, the following always come from the destination baseline:

```text
lesson.id, course_id, title, description, lesson_number, objectives, points,
due_date_m, due_date_t, is_published, preflight_id, preflight.questions
```

The following come from the incoming package after faculty review:

```text
interaction.id, interaction.title, interaction.description,
interaction.artifact_url, chat_input.source_filename, chat_input.markdown
```

The completion policy is derived only by the matrix above; an incoming policy may not remove an
existing preflight or silently change an existing lesson's required path.

---

## 8. Final-save contract

### 8.1 Effect-specific buttons

The final button label must describe the pending operation:

- **Create new lesson**
- **Add interaction to Lesson N**
- **Update interaction for Lesson N**
- **Replace interaction for Lesson N**

The replacement label appears only after explicit replacement confirmation.

### 8.2 Transaction and compare-and-swap inputs

Existing-lesson saves use one Postgres RPC, tentatively `attach_interaction_to_lesson`. It receives:

- target lesson id and course id;
- normalized incoming interaction fields;
- normalized input Markdown and optional filename;
- expected lesson `updated_at`;
- expected current `interaction_id` (including expected null);
- expected current chat-input version (including expected null);
- explicit `confirm_replace` boolean.

Inside one transaction it must:

1. Verify the caller is a global admin or director for the target course.
2. Lock/re-read the target lesson.
3. Compare the expected lesson timestamp, interaction id, and input version.
4. Verify the target course and incoming interaction course match.
5. Reject an incoming interaction id attached to a different lesson.
6. When replacing a different id, require `confirm_replace` and reject if current reports exist.
7. Insert/update the interaction.
8. Insert/update the target lesson's chat input, incrementing its version and checksum when content
   or filename changes.
9. Attach the interaction id and derive the completion policy from Section 7.
10. Return the committed lesson, interaction, input version, and operation type.

Any failure rolls back all steps. Concurrency failures return a stable conflict code telling the UI
to reload the lesson before retrying.

New-lesson saves may retain the existing component-first workflow during initial implementation,
but must validate slug ownership before an interaction upsert. A later unified create RPC is allowed
without changing this contract.

---

## 9. Persistence and access contract

The current chat input is stored outside `lessons` in a private one-to-one table. It must not be a
new column on `lessons`, because the existing row-level policy publicly exposes published lesson
rows and RLS does not provide column secrecy.

Conceptual current-row fields:

```text
lesson_id (PK/FK), markdown, source_filename, version, content_sha256,
created_at, updated_at, updated_by
```

Requirements:

- `lesson_id` references `lessons(id)` with `ON DELETE CASCADE`.
- Markdown is nonblank and no larger than 100,000 UTF-8 bytes.
- Version begins at 1 and increases only when Markdown or filename changes.
- SHA-256 is computed from the canonical UTF-8 Markdown bytes.
- RLS allows authenticated directors/admins to manage rows within their course scope.
- Ordinary anonymous/public PostgREST reads cannot select the table.
- Edge retrieval uses a server-side credential but explicitly filters published lessons rather
  than relying on service-role RLS bypass.
- Changing a lesson away from an interaction policy does not implicitly delete its input.
- Clearing input is a separate explicit faculty operation and is unavailable when a published
  interaction lesson requires it unless the lesson is first made draft or changed safely.

---

## 10. Errors and security

Action/API errors use JSON:

```json
{
  "error": {
    "code": "stable_machine_code",
    "message": "Faculty/GPT-readable explanation"
  }
}
```

Required cases:

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `invalid_request` | Missing/malformed parameters or JSON |
| 401 | `unauthorized` | Missing/incorrect Action secret |
| 404 | `not_found` | Retrieval target unavailable without leaking draft existence |
| 409 | `lesson_changed` | Optimistic concurrency check failed |
| 409 | `interaction_owned_elsewhere` | Incoming id belongs to another lesson |
| 409 | `replacement_has_reports` | Different current interaction has reports |
| 413 | `input_too_large` | Raw Markdown exceeds 100,000 bytes |
| 422 | `invalid_prefill` | Authoring package failed semantic validation |
| 422 | `prefill_too_large` | Packed URL would exceed 24,000 characters |
| 500 | `internal_error` | Unexpected server failure without secret/detail leakage |

Functions must not log Authorization headers, full Markdown, full generated links, Supabase service
credentials, or student data. CORS may allow the known faculty site for browser diagnostics, but the
GPT Actions are server-to-server and do not depend on browser CORS.

If the GPT is published beyond a private workspace, its configuration must satisfy OpenAI's current
privacy-policy requirements for public GPTs with Actions.

---

## 11. Acceptance cases

### A. Link creation and decoding

- **A1:** A valid package produces an `https` link with a single `#lp=` compressed payload.
- **A2:** Unicode, Markdown headings, equations, code fences, quotes, and ampersands round-trip
  byte-for-byte after UTF-8 normalization.
- **A3:** A `.md` filename survives as metadata; no binary file is expected.
- **A4:** Invalid schema/kind, bad slugs, non-HTTPS artifact URLs, blank Markdown, and oversized
  Markdown are rejected without returning a link.
- **A5:** A packed link over 24,000 characters returns `prefill_too_large`.
- **A6:** A malformed fragment opens no editor, shows an error, and performs no write.
- **A7:** Version-2 fragment wins when a legacy query prefill is also present.
- **A8:** Legacy query-only prefill links still open as before.

### B. Authentication round-trip

- **B1:** An already-authenticated director opens the form directly.
- **B2:** An unauthenticated director's fragment is stored before redirect, restored after login,
  used once, and removed from session storage/history.
- **B3:** An expired, wrong-path, or malformed stored fragment is discarded.
- **B4:** A faculty instructor without director rights cannot open the authoring modal or save.

### C. Destination selection

- **C1:** Every generated link begins in new-lesson mode even when its slug matches a lesson.
- **C2:** A new-mode slug collision disables save and offers assign-existing/change-id choices.
- **C3:** Opening/canceling the picker does not modify the editor or database.
- **C4:** Row selection alone does not change the editor; **Use selected lesson** does.
- **C5:** Selecting a preflight-only lesson preserves every existing question/objective/date/title
  and previews `preflight → choice`.
- **C6:** Selecting the wrong clean destination and choosing another rebuilds from pristine data
  without a warning or carried fields.
- **C7:** Changing destination after manual edits warns that current unsaved edits will be discarded.
- **C8:** Returning to new mode restores the original incoming lesson suggestions.

### D. Update/replacement safety

- **D1:** Same-id update changes only reviewed interaction fields and input.
- **D2:** Same-id update after reports exist is allowed with a future-conversation warning.
- **D3:** Different-id replacement with no reports requires explicit confirmation.
- **D4:** Different-id replacement with reports is blocked in UI and RPC.
- **D5:** An incoming id owned by another lesson is blocked in UI and RPC.
- **D6:** Replaced old interaction rows are retained, not deleted.
- **D7:** Changing the destination after confirming replacement resets that confirmation.
- **D8:** A stale lesson timestamp, interaction id, or input version causes an atomic conflict and
  no partial update.

### E. Persistence and retrieval

- **E1:** New input starts at version 1 with a correct SHA-256 digest.
- **E2:** Saving unchanged Markdown/filename does not increment version.
- **E3:** Changing Markdown or filename increments version.
- **E4:** Anonymous PostgREST cannot read private input rows.
- **E5:** `listCourseLessons` returns all and only published lessons for the requested course.
- **E6:** Published lessons without input are listed with `input_available=false`.
- **E7:** `getLessonChatInput` returns the current Markdown and metadata for a valid published lesson.
- **E8:** Draft, missing-input, unknown, and course-mismatched retrievals all return non-revealing 404s.
- **E9:** Missing/incorrect Action secrets return 401 for every operation.

### F. Atomicity and regression

- **F1:** Forced input-write failure rolls back interaction and lesson changes.
- **F2:** Forced lesson-update failure rolls back interaction and input changes.
- **F3:** Existing standalone interactions continue to work.
- **F4:** Existing lesson editing without a generated payload continues to work.
- **F5:** Student `artifact-submit.html#t=interaction&i=...&r=...&d=...` submission behavior is unchanged.
- **F6:** Faculty can create a normal lesson manually without using any GPT Action.

---

## 12. Staged implementation map

This contract is implemented only through separately approved stages:

1. **Contract (this document).** Freeze behavior and acceptance cases.
2. **Database authoring.** Add the private input table, scoped RLS, ownership checks, and atomic
   existing-lesson attach/update RPC as a migration file.
3. **Database application (user).** Course owner applies and confirms the migration.
4. **Payload/input UI.** Add lz-string decode, login-safe capture, Markdown editor/preview, and
   payload validation.
5. **Destination UI.** Add default-new state, picker, clean rebuilds, previews, and guards.
6. **Persistence integration.** Connect normal saves and RPC saves, status badges, and browser tests.
7. **Action implementation.** Add three Edge Functions, shared authentication/validation, and the
   OpenAPI schema.
8. **Action deployment (user).** Deploy functions and configure the secret.
9. **Custom GPT configuration (user with guidance).** Import schema, configure Bearer auth and GPT
   instructions, and test in Preview.
10. **End-to-end acceptance.** Execute Section 11, fix defects, and mark the feature live.

---

## 13. Explicit non-goals for version 1

- Uploading/storing binary files through the Action.
- A Supabase Storage bucket for Markdown.
- A short-lived server-side prefill-draft/token service.
- Moving an interaction between lessons after it has student reports.
- Silently attaching an incoming interaction based only on matching slugs.
- Modifying the frozen student interaction-report submission contract.
- Making draft lesson input public.
- Automatically publishing lessons from a generated link.
- Retrofitting legacy standalone assignments/interactions into lessons in bulk.
