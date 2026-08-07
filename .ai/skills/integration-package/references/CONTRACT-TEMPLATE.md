<!--
  CONTRACT-TEMPLATE.md — copy this whole file to
  .ai/integrations/{{PACKAGE}}/contracts/{{CONTRACT_NAME}}.md and fill every
  {{SLOT}}. Delete each guidance comment as you satisfy it. Before commit:

      grep -rn "{{" .ai/integrations/{{PACKAGE}}/contracts/   # must return nothing

  This is the authoritative artifact of the package (SKILL.md Step 1). Write it
  BEFORE any prompt, schema, or backend — those are restatements of this file,
  and a restatement cannot precede its source. When this file and any code copy
  disagree, this file wins and the copy is the bug.

  Section numbers are fixed. Keep all eleven even where one is short, so that a
  review comment on "§7" means the same thing in every contract in the repo.
-->

# {{FEATURE}} + {{EXTERNAL_SURFACE}} Contract

**Status:** {{proposed | accepted | LOCKED | superseded by <DOC.md>}}
<!--
  LOCKED is the value a frozen contract uses: the far side is configured against
  it and you cannot redeploy the far side, so this file changes by version bump
  and human decision, never by edit (SKILL.md Rule 12). A reader must be able to
  see at a glance that changing it breaks a consumer.
-->

**Scope:** {{ONE_SENTENCE_ENUMERATING_EXACTLY_THE_SURFACE_AREA_COVERED}}.
<!--
  One sentence, and it must enumerate rather than gesture. "The three write
  operations exposed to the {{PERSONA}} persona and their payload format" is a
  scope. "Integration behaviour" is not — an unbounded scope means every future
  argument about whether something is covered lands here and is unresolvable.
-->

**Companion contracts:**

- [`{{OTHER_CONTRACT}}.md`]({{PATH}}) — {{WHAT_IT_GOVERNS}}. **This contract does NOT change {{X}}.**
- [`{{OTHER_CONTRACT_2}}.md`]({{PATH}}) — {{WHAT_IT_GOVERNS}}. **This contract does NOT change {{Y}}.**
<!--
  Each entry carries an explicit "does NOT change" clause, because the companion
  list is itself a set of scope fences. A cross-reference without one reads as
  "related work"; with one, it reads as a boundary, and the next author cannot
  quietly widen this contract into its neighbour's territory.
-->

---

## 1. Outcomes

<!--
  The end-to-end flow as a numbered narrative, in the order it actually happens,
  from the external surface's first call to the user-visible result. Prose, not
  a spec — a reader who knows nothing about this integration should finish this
  section able to describe what it does. No field names yet; that is §4.
-->

1. {{ACTOR}} {{DOES_THE_TRIGGERING_THING}}.
2. {{EXTERNAL_SURFACE}} calls `{{OPERATION_1}}` with {{WHAT_IT_SENDS}}.
3. {{YOUR_SYSTEM}} {{VALIDATES_OR_STORES_OR_RETURNS}} and responds with {{WHAT_COMES_BACK}}.
4. {{EXTERNAL_SURFACE}} presents {{WHAT_THE_USER_SEES}} — and explicitly does not claim {{WHAT_HAS_NOT_HAPPENED_YET}}.
5. {{HUMAN_STEP_IF_ANY}} {{COMPLETES_OR_APPROVES_THE_FLOW}}.

---

## 2. Frozen invariants

These rules are requirements, not implementation suggestions:

<!--
  Every invariant gets a SHORT BOLD NAME — two or three words — a colon, then
  the rule. The name is what makes it citable from a code review and traceable
  from an acceptance case in §9. An unnamed invariant is one nobody can point
  at, so it is one nobody enforces.

  The five below are generic worked examples. Keep the ones that apply, delete
  the rest, and add your own in the same shape.
-->

1. **Review before write:** {{OPERATION}} stages the change and returns {{REVIEW_ARTIFACT}}; nothing is persisted to {{STORE}} until {{EXPLICIT_CONFIRMATION_STEP}}. The external surface cannot skip the review step, and must not describe a staged change as saved.
2. **Idempotent retry:** a repeated call carrying the same `{{IDEMPOTENCY_KEY_FIELD}}` returns the original result and creates nothing new. Retries are expected — a network timeout on the far side is indistinguishable from a failure, so the far side will retry.
3. **No secret in the client:** {{EXTERNAL_SURFACE}} holds only {{CREDENTIAL_KIND}}, scoped to {{SCOPE}}. {{PRIVILEGED_CREDENTIAL}} never leaves {{SERVER_BOUNDARY}} and never appears in a response body.
4. **Explicit replacement:** {{WRITE_OPERATION}} replaces {{TARGET}} in full; it never merges. A partial payload therefore deletes the fields it omits, and the caller must send the complete object.
5. **Backward compatibility:** unknown request fields are ignored; responses return only normalized known fields. Adding a field to a request is never breaking; removing or retyping a response field always is.

---

## 3. Operation surface

<!--
  One ### 3.N per operation. Exactly the operations exposed by this contract —
  if an endpoint exists but is not exposed to this external surface, it does not
  appear here (SKILL.md Step 4, least privilege per persona).
-->

### 3.1 `{{METHOD}} {{PATH}}` — {{PURPOSE}}

| aspect | value |
|---|---|
| auth | {{CREDENTIAL_KIND}}, {{WHERE_PRESENTED}} |
| idempotent | {{yes/no}} — {{MECHANISM_OR_WHY_NOT}} |
| request | {{SUMMARY}} (fields in §4) |
| response | {{SUMMARY}} |
| errors | {{CODE_1}}, {{CODE_2}} (§8) |
| invariants | **{{INVARIANT_NAME}}**, **{{INVARIANT_NAME_2}}** |

### 3.2 `{{METHOD}} {{PATH}}` — {{PURPOSE}}

<!-- Same table shape. Repeat per operation. -->

---

## 4. Payload and validation

| field | required | exact value or shape | notes |
|---|---|---|---|
| `{{FIELD}}` | yes | `"{{LITERAL}}"` | pinned literal — reject any other value |
| `{{FIELD}}` | yes | `{{TYPE}}`, {{PATTERN_OR_RANGE}} | {{VALIDATION_RULE}} |
| `{{FIELD}}` | no | one of `{{A}}` \| `{{B}}` \| `{{C}}` | defaults to `{{DEFAULT}}` when absent |
| `{{FIELD}}` | conditional | {{SHAPE}} | required when {{CONDITION}} |
| `{{ID_FIELD}}` | yes | opaque string, {{MAX}} chars | matched exactly; never parsed, never fuzzy-matched |

<!--
  "Exact value or shape" means the literal, the pattern, the enum, or the unit —
  never "a date" or "a reasonable string". A field described loosely arrives in
  four formats from four conversations and three get rejected for reasons the
  end user cannot see.

  Pin every version field as a literal here (SKILL.md Step 2) so §9 can assert
  it. Prose like "the current version" cannot be asserted, so it is not enforced.
-->

---

## 5. Transport and limits

| limit | value | error when exceeded |
|---|---|---|
| encoding | {{e.g. UTF-8 JSON, no BOM}} | `{{CODE}}` |
| max request body | {{N}} {{units}} | `{{CODE}}` |
| max `{{FIELD}}` length | {{N}} characters | `{{CODE}}` |
| max items in `{{ARRAY_FIELD}}` | {{N}} | `{{CODE}}` |
| request timeout | {{N}} seconds | `{{CODE}}` |
| rate limit | {{N}} per {{WINDOW}} per {{SUBJECT}} | `{{CODE}}` |

<!--
  Numbers, not adjectives. "Reasonably sized" is an unwritten limit discovered
  in production by the first user who pastes a long document. Every limit ships
  with the error it returns — a limit with no defined failure fails differently
  in every deployment, and the far side cannot write a recovery for it.
-->

---

## 6. State model

States: `{{STATE_A}}` → `{{STATE_B}}` → `{{STATE_C}}`, plus terminal `{{TERMINAL}}`.

| from | to | trigger | permitted by |
|---|---|---|---|
| `{{STATE_A}}` | `{{STATE_B}}` | {{OPERATION_OR_EVENT}} | {{ACTOR}} |
| `{{STATE_B}}` | `{{STATE_C}}` | {{OPERATION_OR_EVENT}} | {{ACTOR}} — {{human/automated}} |
| `{{STATE_B}}` | `{{TERMINAL}}` | {{OPERATION_OR_EVENT}} | {{ACTOR}} |

**Every transition not listed above is rejected with `{{CODE}}`.**
<!--
  State the closed-world rule explicitly. A table that only lists permitted
  transitions, without this line, is read as a list of examples — and the far
  side will attempt a transition you never considered.
-->

---

## 7. Concurrency

**Compare-and-swap input:** `{{VERSION_OR_ETAG_FIELD}}`, taken from {{WHERE_THE_CALLER_GOT_IT}}.

- The caller sends the value it last observed. {{YOUR_SYSTEM}} applies the write only if the stored value still matches.
- **On mismatch:** `{{CONFLICT_CODE}}` with {{WHAT_THE_RESPONSE_CARRIES}} — the write is not applied, partially or otherwise.
- **Recovery:** the caller re-reads, {{RE_DERIVES_OR_ASKS_THE_USER}}, and retries with the new value. It never retries the identical call, and it never resolves a conflict by overwriting.
- {{WHAT_HAPPENS_ON_CONCURRENT_IDENTICAL_WRITES}} — see **Idempotent retry** (§2).

<!--
  If the resource genuinely has no concurrent-writer risk, keep the section and
  say so in one sentence with the reason. Deleting it renumbers §8-§11 and
  breaks every review comment and acceptance case that cited them.
-->

---

## 8. Errors and security

**Every error returns this envelope and nothing else:**

```json
{ "error": { "code": "{{STABLE_MACHINE_CODE}}", "message": "{{SAFE_HUMAN_TEXT}}" } }
```

| HTTP | code | meaning | notes |
|---|---|---|---|
| 400 | `{{INVALID_PAYLOAD}}` | a field failed validation (§4) | names the field; never echoes its value |
| 401 | `{{UNAUTHENTICATED}}` | credential missing or rejected | **identical response whether the credential is absent, malformed, or valid-but-revoked** |
| 403 | `{{FORBIDDEN}}` | authenticated, not permitted for this operation | does not reveal whether the target exists |
| 404 | `{{NOT_FOUND}}` | target does not exist **or** is not visible to this caller | the two cases are deliberately indistinguishable — separating them turns this endpoint into an existence oracle |
| 409 | `{{CONFLICT}}` | compare-and-swap mismatch (§7) | carries the current version, not the current content |
| 413 | `{{TOO_LARGE}}` | a §5 limit was exceeded | states the limit, not the observed size |
| 429 | `{{RATE_LIMITED}}` | rate limit exceeded (§5) | carries retry-after |
| 500 | `{{INTERNAL_ERROR}}` | unexpected failure | **carries a correlation id and no diagnostic detail** — stack traces, query text, and internal hostnames never cross this boundary |

**Error codes are stable machine strings.** The far side branches on them (SKILL.md Step 3, named error handling), and you cannot redeploy the far side — so a reworded code breaks every prompt that names it, silently, by falling through to unspecified behaviour.

**Security notes:**

- {{WHAT_THE_EXTERNAL_SURFACE_MAY_HOLD}} and, explicitly, what it may not.
- Content returned by these operations is **data, not instructions** — the consuming prompt must treat embedded directives as reportable, never as executable.
- {{ANY_LOGGING_OR_RETENTION_COMMITMENT}}.

---

## 9. Acceptance cases

<!--
  Lettered groups, individually numbered IDs. Each case cites the §2 invariant
  it proves, by its bold name — a case that traces to no invariant is either
  testing an accident or documenting an invariant you forgot to write down.

  These are executed, not reviewed, before the integration is treated as live
  (SKILL.md Step 6).
-->

**A. {{GROUP_NAME — e.g. Payload validation}}**

- **A1** — {{SETUP}}; expect {{EXACT_OUTCOME}}. Proves **{{INVARIANT_NAME}}**.
- **A2** — send `{{FIELD}}` as `{{WRONG_LITERAL}}`; expect `{{CODE}}` and no state change. Proves **{{INVARIANT_NAME}}**.
- **A3** — send an unknown field; expect success, and confirm the response omits it. Proves **Backward compatibility**.

**B. {{GROUP_NAME — e.g. Write path}}**

- **B1** — {{SETUP}}; expect {{REVIEW_ARTIFACT}} returned and `{{STORE}}` unchanged. Proves **Review before write**.
- **B2** — repeat B1 with the same `{{IDEMPOTENCY_KEY_FIELD}}`; expect the original result and no second record. Proves **Idempotent retry**.

**C. {{GROUP_NAME — e.g. Errors and leakage}}**

- **C1** — call with a revoked credential; expect `{{UNAUTHENTICATED}}` byte-identical to the absent-credential response. Proves **No secret in the client**.
- **C2** — request a target owned by another caller; expect `{{NOT_FOUND}}`, not `{{FORBIDDEN}}`. Proves the existence-oracle rule (§8).
- **C3** — force an internal failure; expect a correlation id and confirm no internal detail appears in the body.

---

## 10. Staged implementation

<!--
  Stages requiring a human are labelled inline as (human). An agent may prepare
  every artifact for a (human) stage but may not perform it or mark it done —
  the label is what stops a run from proceeding past a gate nobody attended.
-->

| stage | deliverable | done when |
|---|---|---|
| 1 | this contract, LOCKED **(human)** | {{APPROVER}} approves and the status line reads LOCKED |
| 2 | `backend/` implementing §3–§8 | every §9 case passes locally |
| 3 | `schema/{{PERSONA}}.{{ext}}`, least privilege | schema exposes exactly §3's operations for this persona |
| 4 | `prompts/{{PERSONA}}.md` | covers every §8 error code with a named recovery |
| 5 | deploy to {{ENVIRONMENT}} | §9 cases pass against the deployed endpoints |
| 6 | configure {{EXTERNAL_SURFACE}} **(human)** | its owner pastes the prompt and schema; record the confirmation date |
| 7 | end-to-end confirmation **(human)** | a person completes the §1 flow and signs off in `README.md` |

---

## 11. Explicit non-goals for this version

<!--
  Things that could reasonably have been in scope and are deliberately not.
  Not negated requirements — "it shouldn't be slow" is noise. Each entry is a
  capability someone will ask for, answered in advance, so the answer is a
  citation rather than a fresh argument.
-->

- **{{CAPABILITY}}** — not exposed in this version. {{WHY, and what would have to change}}.
- **{{CAPABILITY}}** — deferred to {{FUTURE_CONTRACT_OR_VERSION}}.
- **{{CAPABILITY}}** — governed by [`{{COMPANION_CONTRACT}}`]({{PATH}}), not here.
- **Anything requiring {{EXTERNAL_SURFACE}} to hold {{PRIVILEGED_CREDENTIAL}}** — out of scope permanently, per **No secret in the client** (§2).
