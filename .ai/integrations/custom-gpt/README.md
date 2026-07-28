# Custom GPT Transfer archive

**Paused:** July 15, 2026

This directory preserves the Custom GPT transfer experiment and the exact website
changes that were removed when the project returned to the Claude Artifacts path.
Nothing in this directory should be treated as active application code.

## Why this was paused

The Custom GPT approach required a public Action privacy-policy URL for the
student-facing GPT. The project owner chose not to continue that publication path
without determining whether institutional/legal review would be needed. Claude
Artifacts may continue to provide the generated interaction handoff, so the active
faculty lessons page no longer needs to receive or persist Custom GPT Markdown
packages.

## What was built

The experiment implemented:

- a version-2 compressed lesson package transported in a lessons-page URL fragment;
- login-safe fragment recovery;
- Markdown/text input, optional filename metadata, byte limits, and preview UI;
- default-new lesson creation plus an existing-lesson destination picker;
- safe add/update/replace behavior with report, ownership, and concurrency guards;
- a private, versioned lesson chat-input table;
- atomic database functions for generated new lessons and existing-lesson attachment;
- three authenticated Supabase Edge Functions;
- combined and least-privilege student/faculty OpenAPI schemas;
- student and faculty GPT instruction drafts; and
- a draft privacy page that was not adopted.

## Archive contents

- `contracts/` - frozen behavior and acceptance contract.
- `gpt-config/` - student, faculty, and legacy combined GPT instructions.
- `openapi/` - student, faculty, and legacy combined Action schemas.
- `supabase/config.toml` - the exact per-function JWT-bypass deployment settings.
- `supabase/functions/` - deployed Edge Function and shared source snapshots.
- `supabase/migrations/` - archive copies of migrations 017 and 018.
- `app-reference/` - source-level reference hunks and a behavioral inventory for
  the removed `/app/` integration. See its README before using these files.
- `privacy.html` - the longer draft privacy page. No adoption or deployment was
  confirmed in this work.

The canonical copies of migrations 017 and 018 intentionally remain in
`supabase/migrations/`. They were already applied to the live database and are
part of its additive migration history. Moving or deleting those canonical files
would make a fresh database inconsistent with the live schema.

## Live Supabase state that was not rolled back

Project reference: `shzvpmlnqfmzfmuxkowi` (`Core_Physics_Test`).

The following additive database work was applied and verified:

- `lesson_chat_inputs` private table;
- four row-level policies on that table;
- `lessons_interaction_owner_uidx` partial unique index;
- helper, trigger, and attachment functions from migration 017; and
- `create_lesson_with_interaction(...)` from migration 018.

At verification time, `lesson_chat_inputs` contained zero rows. The migrations did
not rewrite or delete existing lesson, interaction, assignment, or report rows.

The following Edge Functions were deployed as active version 1 with gateway JWT
verification disabled only for these functions:

- `gpt-create-lesson-link`
- `gpt-list-lessons`
- `gpt-lesson-input`

Each function still performs its own constant-time bearer-token check. A
`GPT_ACTION_SECRET` was configured in Supabase, but its value is intentionally not
stored anywhere in this archive. Pausing the website integration does not undeploy
the functions, rotate/delete that secret, or remove the additive database objects.

If the pause becomes permanent, live cleanup must be planned separately. Do not
drop the table/functions or delete the secret casually: first confirm that no GPT
or external client still uses the endpoints and write an explicit rollback
migration.

## Custom GPT configuration state

The student GPT reached this state:

- the least-privilege student schema was imported;
- Bearer authentication was configured;
- the revised student instructions were pasted into the GPT Instructions field;
- `listCourseLessons(course_id=phys-215)` succeeded and returned the Physics 215
  course with an empty published lesson list; and
- `getLessonChatInput` returned the expected non-revealing `not_found` response
  for an unavailable lesson.

Saving/sharing the student GPT then stopped because the builder required a public
privacy-policy URL. The privacy draft in this archive was created, but no
deployment was confirmed.
The faculty-only schema and instructions were prepared; no completed faculty-GPT
import/configuration was confirmed.

The student GPT may still contain the configured Actions until its owner removes
them. That external GPT configuration is not changed by this repository archive.

## Active website removal

The active `/app/` files were restored to their pre-experiment Git versions:

- `site/faculty/lessons.html`
- `site/js/faculty-lessons.js`
- `site/login.html`

This removes the URL-fragment package receiver, Markdown/file controls, destination
picker, chat-input RPC calls, and draft privacy link. The older query-string
artifact prefill workflow already present before this experiment remains available.

## Restoring the archived website work

The app reference hunks are not a supported mechanical patch set. The large
lessons-page capture contains an output-truncation marker discovered during archive
verification, so forcing those files would be unsafe. Rebuild the app integration
against the then-current website using the frozen contract, preserved backend
source, and the behavioral inventory in `app-reference/README.md`.

To resume the complete Custom GPT path, also:

1. review the frozen contract and current OpenAI publication requirements;
2. confirm whether published lesson Markdown may be student-visible;
3. decide whether an institutional privacy notice/legal review is required;
4. rotate or confirm the existing Action secret;
5. restore/redeploy the Edge Function source if it has changed;
6. retest the database and endpoints; and
7. execute the contract acceptance cases before treating the feature as live.

## Security notes

- No bearer secret, Supabase service credential, student password, or student data
  is stored in this archive.
- Generated authoring/report links can contain compressed Markdown in their URL
  fragments and must not contain unrelated secrets.
- A student-facing GPT Action response should be treated as potentially visible to
  the student even when the model is instructed not to quote raw configuration.
