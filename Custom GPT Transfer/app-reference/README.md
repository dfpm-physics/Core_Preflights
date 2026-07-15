# Active-app integration reference

These files preserve source-level reference hunks from the Custom GPT experiment.
They are intentionally named `.patch.txt` and must not be passed to `git apply`.

During archive verification, the large lessons-page capture was found to contain a
literal output-truncation marker in `lessons-html.part-02.patch.txt`. The three
lessons-page files therefore do not form a complete mechanical restore. The
faculty-module and login hunks are intact, but they are retained as reference only
so the archive has one clear restoration policy.

The active app files were independently restored to the pre-experiment Git
baseline and verified clean. If the Custom GPT path resumes, rebuild the app layer
against the then-current code using:

- the frozen contract in `../contracts/`;
- migrations and Edge Function source in `../supabase/`;
- the OpenAPI and GPT configuration files; and
- these source hunks as implementation reference.

The removed app layer included:

- LZ String decoding of a schema-2 `#lp=` package;
- session-storage recovery across faculty authentication;
- private Markdown/filename input controls and UTF-8 byte validation;
- a default-new workflow and existing-lesson destination picker;
- add/update/replace previews and report/ownership safeguards;
- atomic calls to `create_lesson_with_interaction` and
  `attach_interaction_to_lesson`; and
- generated-workflow status and error mapping.

Key preserved reference functions include:

- `capturePackedPrefill`, `clearPackedPrefill`, and
  `prefillFromPackedLink`;
- `validatePackedPrefill` and its normalization helpers;
- `destinationEffect`, `destinationEffectSummary`, and
  `renderDestinationPanel`;
- `saveGeneratedWorkflow` and `generatedSaveError`;
- `loadDestinationLessons`, `createGeneratedLesson`, and
  `attachGeneratedInteraction`.

The pre-existing query-string artifact prefill behavior was not removed from the
active page.
