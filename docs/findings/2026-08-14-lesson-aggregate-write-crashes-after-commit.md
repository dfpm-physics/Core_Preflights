# `lesson_aggregate.py write-analysis` throws after the write has already committed

**Status:** Verified — awaiting fix

*Found 2026-08-14 by Casey Pellizzari (via Claude) during the scheduled `/lesson-cycle` run for
phys-215 `preflight-04`, M-day.*

---

## 1. The defect

`supabase/admin/lesson_aggregate.py`, `cmd_write` (the `write-analysis` command), reuses the local
name `written` for two different things inside the same loop body:

- an **integer** accumulator, incremented once per successfully-written offering
  (`written += 1`, currently line 1866);
- a **list** of scope keys, built for the `analysis_runs` audit row
  (`written = sorted(...)`, currently line 1848).

Line 1848 runs first and rebinds `written` from `int` to `list`. Line 1866 then executes
`written += 1` on that list, which calls `list.__iadd__(1)` — and `1` is not iterable, so Python
raises `TypeError: 'int' object is not iterable`. The `except Exception` block at line 1867 catches
it, prints `[err] offering <id>: TypeError: ...`, and calls `conn.rollback()`.

**Verified:** reproduced live on 2026-08-14 running
`lesson_aggregate.py write-analysis --in <file> --day M` against the phys-215 `preflight-04`
offering — the traceback and line numbers above match the actual run. The final summary line then
prints `wrote=[...]` (a Python list repr) instead of `wrote=<N>`, which is the visible symptom: any
non-dry-run commit that reaches this line will show this shape in its output.

## 2. Why it looks alarming but is not (this time) — verified, not inferred

The crash happens **after** two commits have already occurred earlier in the same call stack:

- `_run_start(conn, …)` (called as the first argument to `_run_finish` at line 1852) issues its own
  `conn.commit()` at line 959, with the comment *"committed on its own so it survives a later
  rollback"* — this commits the `INSERT INTO analysis_reports` from line 1824-1829 that ran just
  before it in the same offering's loop iteration.
- `_run_finish` (line 964-974) issues a second `conn.commit()` at line 974 after its own
  `UPDATE analysis_runs`.

So by the time execution reaches line 1866 and crashes, **both the scope payload and the
`analysis_runs` row for this run are already durable**, and the subsequent `conn.rollback()` in the
`except` block has nothing left to undo — it rolls back an empty transaction.

**Verified independently, bypassing the tool**, against the live `app.analysis_reports` and
`app.analysis_runs` tables via direct `service_role` REST reads (`Accept-Profile: app`) for the
2026-08-14 run: the `analysis_reports` row for the affected offering carries all 13 intended scope
keys (8 sections + 5 instructors) with the expected `generated_at`, and the matching
`analysis_runs` row exists with `status = 'success'`, correct `summary`, and correct `detail`
(`all_scope_reason: "awaiting-track"`, `scopes_stored_total: 13`). Nothing was lost.

## 3. Why this is still a defect worth fixing

The commit-before-crash ordering that saves this run is an accident of two unrelated `conn.commit()`
calls buried inside helper functions, not a designed guarantee. It also means:

- **The printed `[err]` line is misleading.** An operator (or an unattended agent) reading
  `[err ] offering <id>: TypeError: 'int' object is not iterable` has every reason to believe the
  write failed and needs retrying. A retry would re-run `write-analysis` against an offering whose
  scopes are already correctly stored — harmless here because the writer merges, but wasted work,
  and a different reader might reasonably choose to treat it as a hard failure and stop before
  updating the calling skill's own run record.
- **The final `errored` counter and `written` count in the top-level summary become wrong.** `err=1`
  is reported for a call that, in the two observed runs, fully succeeded.
- **If the crash ever happened before both inner commits** (e.g. `_run_start` itself raised, or a
  future refactor reorders these calls), the rollback would be real and would silently discard a
  scope write while still printing partial `[ok]` lines above it — the current code has no test
  distinguishing "crashed before any commit" from "crashed after both."

## 4. The fix

Rename the list at line 1848 to something that doesn't collide with the outer accumulator — e.g.
`scope_labels` or `written_keys` — and leave `written` as the integer counter throughout. This is a
pure rename with no behavioral change intended; grep both symbols within `cmd_write` to confirm the
list's only other use is the `detail={"scopes_written": written, …}` argument to `_run_finish` at
line 1857, which should use the renamed variable.

**Add a regression test** that calls `write-analysis` non-dry-run against a fixture offering and
asserts the process exits cleanly with no `[err]` line and a `written` count matching the number of
offerings in the input file — the kind of assertion that would have caught this before it shipped.

## 5. How you would know this diagnosis is wrong

- If a future run shows `[err] offering <id>: TypeError: ...` **and** the corresponding
  `analysis_reports` row is missing or stale (`generated_at` older than the run), the commit-timing
  argument in §2 does not hold for that case and the rollback destroyed real work — stop and
  re-diagnose rather than assuming it's this same harmless shape.
- If `_run_start` or `_run_finish` is refactored to defer its `conn.commit()` (e.g. batching commits
  across offerings), §2's safety argument no longer applies and this becomes a real data-loss bug,
  not a cosmetic one.

## 6. Scope

Not fixed here — the finder was mid-`/lesson-cycle` run with a firm no-commit/no-push instruction
for this session and unrelated primary task (grading + aggregating `preflight-04`). Handed off per
this directory's convention.
