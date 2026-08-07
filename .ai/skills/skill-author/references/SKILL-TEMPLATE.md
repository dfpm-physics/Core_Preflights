<!--
  SKILL-TEMPLATE.md — copy this whole file to .ai/skills/{{SKILL_NAME}}/SKILL.md
  and fill every {{SLOT}}. Delete guidance comments as you satisfy them; delete
  optional blocks you do not use. Before commit, run:

      grep -rn "{{" .ai/skills/{{SKILL_NAME}}/    # must return nothing
      grep -rn "<!--" .ai/skills/{{SKILL_NAME}}/  # only intentional comments

  Any {{SLOT}} left in a shipped skill is an unfinished skill, not a flexible one.
-->
---
name: {{SKILL_NAME}}
<!-- MUST equal the directory name, kebab-case. Verified by the Step 7 grep. -->
description: >
  {{CATEGORY_CAPS}} — {{ONE_SENTENCE_NAMING_THE_SINGLE_UNIT_OF_WORK}}.
  <!-- Part 1: CAPS noun phrase, then the unit. One unit only (SKILL.md Step 1). -->
  Reads {{INPUTS}}; writes {{OUTPUTS}}.
  <!-- Part 2: real paths, so the model can predict blast radius before invoking. -->
  Use when the user wants to {{INTENT_1}}, {{INTENT_2}}, or {{INTENT_3}}.
  <!-- Part 3: intents, not vocabulary. -->
  Triggers: "{{LITERAL_PHRASE_1}}", "{{LITERAL_PHRASE_2}}",
  "{{LITERAL_PHRASE_3}}", /{{SKILL_NAME}}.
  <!-- Part 4: words a user actually types, in quotes, plus the slash command. -->
  NOT for {{EXCLUDED_CASE}} — that is `{{SIBLING_SKILL}}`; NOT for
  {{OTHER_EXCLUDED_CASE}}, which is `{{OTHER_SIBLING_SKILL}}`.
  <!-- Part 5: name REAL siblings. "Other skills" tests nothing. Never omit. -->
  Run {{PREREQUISITE_SKILL}} first, because {{SEQUENCING_REASON}}.
  <!-- Part 6: delete these two lines entirely if there is no ordering constraint. -->
  {{WHO_MAY_RUN_IT}}; requires {{PRECONDITION}}.
  <!-- Part 7: the precondition Step 0 will actually check and refuse on. -->
  Argument: {{ARGUMENT_DESCRIPTION}} — default {{ARGUMENT_DEFAULT}}.
  <!-- Part 8: arguments last. Write "Takes no arguments." if it takes none. -->
---
<!-- Target 8-16 folded lines. Under 8, you dropped the negative boundary. -->

# {{SKILL_NAME}} — {{EM_DASH_GLOSS_NAMING_THE_UNIT}}

> This skill owns {{WHAT_IT_OWNS}}. It does not own {{WHAT_IT_DOES_NOT_OWN}} —
> that is `{{SIBLING_SKILL}}`. {{OPTIONAL_STANDING_HAZARD}}.
<!--
  Scope blockquote, directly after the H1. Two halves, both required: what this
  owns and what it does not. The boundary sentence is what stops a later author
  growing this skill into its neighbour.
-->

Where this skill and `CORE.md` disagree, `CORE.md` wins.

---

## Step 0 — Preflight

<!--
  ALWAYS Step 0. ALWAYS able to refuse. Check every precondition BEFORE any
  read that costs money or any write at all — a precondition discovered midway
  through a write is a half-finished state no one planned for.
-->

Confirm all of the following. **If any check fails, stop** and report using the
refusal shape below — do not proceed and do not work around it.

| check | how to confirm | if missing |
|---|---|---|
| {{PRECONDITION_1}} | `{{CHECK_COMMAND_1}}` | {{REMEDY_1}} |
| {{PRECONDITION_2}} | `{{CHECK_COMMAND_2}}` | {{REMEDY_2}} |
| {{PRECONDITION_3}} | `{{CHECK_COMMAND_3}}` | {{REMEDY_3}} |

Refusal shape — name the missing precondition exactly, then give a
copy-pasteable remedy:

> Stopping. `{{SKILL_NAME}}` requires {{PRECONDITION_1}}; {{OBSERVED_STATE}}.
> Run `{{REMEDY_COMMAND}}`, then re-run `/{{SKILL_NAME}}`.

<!-- "Preconditions aren't met" is not a refusal — it costs a round-trip and
     teaches the user the skill is flaky. Name it, then fix it for them. -->

---

## Step 1 — Read {{INPUTS}}

<!--
  Gather EVERY input before deciding anything. An agent that interleaves reads
  and writes cannot dry-run, because half the writes have landed by the time it
  can show a plan.
-->

Read, in this order:

1. `{{INPUT_PATH_1}}` — for {{WHAT_YOU_NEED_FROM_IT}}.
2. `{{INPUT_PATH_2}}` — for {{WHAT_YOU_NEED_FROM_IT}}.
3. {{OPTIONAL_INPUT}} — only when {{CONDITION}}.

**If {{AMBIGUITY_CONDITION}} — for example two files match `{{PATTERN}}` — stop
and report both candidates.** Ambiguity is an abort, not a guess.

---

## Step 2 — Derive {{THE_DERIVED_THING}}

<!--
  Do the judgement in the open. State what you computed BEFORE you use it, so a
  human reading the transcript catches a wrong premise early instead of a wrong
  output late.
-->

From the inputs, determine {{DERIVED_VALUE}} by {{DERIVATION_RULE}}.

State the result explicitly before using it:

```
{{DERIVED_OUTPUT_FORMAT}}
```

**Stop and report if {{DERIVATION_FAILURE_CONDITION}}** — {{WHY_IT_MATTERS}}.

---

## Step 3 — Dry-run

<!--
  Required for anything that writes. Show paths, counts, AND sample content —
  the count was never the risky part. For irreversible operations, hand off to
  `safe-change` instead of rebuilding its gate here.
-->

Print the planned changes and **stop for confirmation before writing**:

```
{{SKILL_NAME}} — dry run
  target:  {{TARGET_PATH}}
  action:  {{CREATE_OR_UPDATE}}
  changes: {{N}} ({{BREAKDOWN}})
  sample:
    {{ACTUAL_CONTENT_TO_BE_WRITTEN}}
  skipped: {{N}} ({{IDEMPOTENCY_REASON}})
```

Proceed only on explicit confirmation. {{OPTIONAL_AUTO_PROCEED_CONDITION}}.

---

## Step 4 — Write {{OUTPUTS}}

<!--
  Smallest possible set of mutations, each traceable to something Step 2 named.
-->

For each {{UNIT}}:

1. {{WRITE_ACTION_1}}.
2. {{WRITE_ACTION_2}}.

**Idempotency:** {{NAMED_MECHANISM}} — a unique key on {{FIELD}}, a
skip-if-present filter on {{IDENTIFIER}}, a content hash, or an upsert keyed on
{{NATURAL_KEY}}. Pick one and name it here.
<!-- "Be careful" and "avoid duplicates" are wishes. The next agent cannot
     execute a wish. Name the mechanism. -->

**Never clobber human work.** If {{TARGET}} already contains content this skill
did not author, **stop** and report the path, the conflicting content, and the
change you intended. Machine-written regions are marked at write time with
{{SENTINEL}} — authorship cannot be detected retroactively.

**Abort conditions.** Stop and report if: {{ABORT_1}}; {{ABORT_2}};
{{ABORT_3}}. Report what was already written before the abort, by path.

---

## Step 5 — Verify

<!-- Machine check AND human spot-check. Never one alone. -->

**Machine check** — re-read the artifact from disk, not from memory of what you
intended, and assert presence and absence:

```bash
{{PRESENCE_CHECK_COMMAND}}   # asserts {{EXPECTED_CONTENT}} is present
{{ABSENCE_CHECK_COMMAND}}    # asserts {{SUPERSEDED_CONTENT}} is gone
```

<!-- Presence-only checks pass happily on a file holding the new section AND
     the stale one it was meant to replace. Always assert both. -->

**Human spot-check** — {{WHAT_A_PERSON_SHOULD_EYEBALL}}. Show
{{WHAT_TO_SHOW_THEM}} and ask for confirmation that {{WHAT_THEY_CONFIRM}}.

**Log it.** Add a `CHANGELOG.md` entry per `CORE.md` §5.
{{OPTIONAL_DOC_SOURCES_REGISTRATION}}

---

## Rules

<!--
  6-12 numbered items. Each opens with a BOLDED imperative or noun-phrase policy
  label, then the reasoning, then the enforcement point. Back-reference steps as
  (Step 4). These are the rules a reader should retain after forgetting the
  steps — not a summary of the steps.
-->

1. **{{RULE_LABEL_1}}.** {{RULE_BODY}} — because {{CONCRETE_FAILURE_MODE}}. Enforcement: {{HOW_ITS_CAUGHT}} (Step {{N}}).
2. **{{RULE_LABEL_2}}.** {{RULE_BODY}} — because {{CONCRETE_FAILURE_MODE}} (Step {{N}}).
3. **{{RULE_LABEL_3}}.** {{RULE_BODY}} — because {{CONCRETE_FAILURE_MODE}} (Step {{N}}).
4. **{{RULE_LABEL_4}}.** {{RULE_BODY}} — because {{CONCRETE_FAILURE_MODE}} (Step {{N}}).
5. **{{RULE_LABEL_5}}.** {{RULE_BODY}} — because {{CONCRETE_FAILURE_MODE}} (Step {{N}}).
6. **{{RULE_LABEL_6}}.** {{RULE_BODY}} — because {{CONCRETE_FAILURE_MODE}} (Step {{N}}).

<!--
  Optional, delete if unused:
    references/{{REFERENCE_FILE}}.md — a schema, template, or taxonomy that
    would drown the steps. Link it from the step that needs it, with a sentence
    on when to open it. Guards NEVER move into a reference.

    SKILL-claude.md / SKILL-codex.md — only when a tool or platform genuinely
    differs. Default is no addendum. Three to five bullets, tools only, ending
    with the supremacy clause.
-->
