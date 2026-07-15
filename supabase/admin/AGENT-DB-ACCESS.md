# Claude Code — Database Access: establishment, rules & operating guide

**Audience:** future iterations of Claude Code operating in this repo. This is the authoritative
guide for *how Claude connects to and operates the PREP Supabase database directly*. If you are a
human setting this up on a new machine, read [`README.md`](README.md) instead (the step-by-step
runbook); this doc is the operating manual + the provenance.

*Established 2026-06-25 by Matthew Recker (via Claude). Companion to [`README.md`](README.md),
[`claude_code_role.sql`](claude_code_role.sql), and the project memory `claude-code-db-access.md`.*

---

## 1. TL;DR for an iteration

You (Claude) have a **dedicated, scoped Postgres role** for this project. To use it:

```bash
# from the repo root, always via the project venv:
.venv/Scripts/python supabase/admin/db_check.py            # verify access first (read/write/DDL-denied)
.venv/Scripts/python supabase/admin/interaction_reports.py stats
```

- You can **read and write data**. You **cannot** change the schema (enforced by Postgres).
- Connect through the **Session pooler** host — never the direct `db.<ref>.supabase.co` host.
- The credential is in a **gitignored** config file; never print or commit it.
- For interaction-report work, drive the **`interaction_reports.py`** helper, not raw SQL.

---

## 2. How this was established (provenance)

The goal was to let Claude Code read/write course data directly **without** the broad
`service_role` key that `/preflight-analyze` uses, and **without** disturbing that other director's
setup. The decisions that produced the current arrangement:

1. **Scoped role, not the service key.** A Supabase API key just maps to a Postgres role; the role's
   GRANTs are the real permission boundary. So instead of reusing the powerful `service_role` key, we
   created a new role `claude_code_recker` with data-only privileges. See
   [`claude_code_role.sql`](claude_code_role.sql) (strictly additive; transactional; has a full undo).
2. **No DDL by construction.** The role owns nothing and is granted only DML, so `ALTER`/`DROP`/
   `TRUNCATE` are refused by Postgres itself — not by Claude's restraint. `BYPASSRLS` is set on this
   role only (so it can see rows) without editing any existing RLS policy.
3. **Isolation from the existing skill.** Creating a new role touches no existing role, key, table, or
   policy, so `/preflight-analyze` and the student/instructor frontends are unaffected.
4. **Transport = direct Postgres via the Session pooler.** psql/psycopg weren't installed; the user
   approved a project-local `.venv` + `psycopg2-binary` (`requirements.txt`). The **direct**
   `db.<ref>.supabase.co` host is **IPv6-only and does not resolve** from this machine (confirmed:
   `could not translate host name … Name or service not known`), so we use the **Session pooler**
   host, which is IPv4-resolvable.
5. **Credential location.** The user chose to keep the config **in the project** (gitignored) rather
   than the home dir, accepting that the repo's OneDrive location means the file syncs to their
   private OneDrive (never to git/GitHub).
6. **Verified end-to-end** with [`db_check.py`](db_check.py): connects as `claude_code_recker`, reads
   real rows, writes (rolled back), and `ALTER`/`DROP` come back **DENIED**.

---

## 3. The connection

| Field | Value |
|---|---|
| Role | `claude_code_recker` |
| Host | **Session pooler** — `aws-1-us-west-2.pooler.supabase.com` (port `5432`) |
| User | `claude_code_recker.shzvpmlnqfmzfmuxkowi` (pooler format is `<role>.<project-ref>`) |
| Database | `postgres` |
| SSL | `sslmode=require` |
| Config file | `supabase/admin/config.json` (**gitignored**) |
| Python | project venv `.venv/` (gitignored) — `psycopg2-binary` per `requirements.txt` |

Minimal connect (the helper scripts already do this — reuse them rather than re-implementing):

```python
import json, pathlib, psycopg2
cfg = json.loads(pathlib.Path("supabase/admin/config.json").read_text("utf-8"))
conn = psycopg2.connect(
    host=cfg["host"], port=cfg["port"], dbname=cfg["dbname"],
    user=cfg["user"], password=cfg["password"], sslmode=cfg["sslmode"],
    connect_timeout=15,
)
```

Run Python through `.venv/Scripts/python.exe` (Windows) and set `PYTHONIOENCODING=utf-8` when
printing report text — reports contain emoji (e.g. the 🟡 readiness flag) and Windows' default
cp1252 stdout will crash on them. (`interaction_reports.py` forces UTF-8 internally.)

---

## 4. What the role can and cannot do

- **CAN:** `SELECT` / `INSERT` / `UPDATE` / `DELETE` on every table in schema `public`, and read
  RLS-protected rows (`BYPASSRLS`).
- **CANNOT:** any schema change (`CREATE` / `ALTER` / `DROP` / `TRUNCATE`), touch the `service_role`
  or `anon` keys, or modify any RLS policy. These fail at the database with `InsufficientPrivilege` —
  that's expected and correct, not a bug to work around.

If a task genuinely needs a schema change (new column/table/index/trigger), you do **not** have the
rights — and must not. Write the migration SQL and hand it to the user to run as `postgres` in the
Supabase SQL Editor (the same pattern as `claude_code_role.sql` and the numbered migrations).

---

## 5. Operating rules for iterations  (read before any write)

1. **Verify first.** Run `db_check.py` at the start of a DB session. If it can't connect, the cause
   is almost always the **wrong host** (someone put the direct `db.<ref>` host in the config) — fix to
   the Session pooler host before anything else.
2. **Never the direct host.** Always the `…pooler.supabase.com` host. The direct host won't resolve.
3. **Protect the secret.** Never print the password or the full config in output; never commit
   `config.json` or `.venv/` (both are gitignored — keep it that way). Reference the password as
   `[role password]` if you must show a connection shape.
4. **Reads are free; writes are deliberate.** Default to read-only. For writes, prefer the purpose-built
   helper (`interaction_reports.py`) and **always `--dry-run` first**, then commit. For ad-hoc writes,
   wrap in an explicit transaction and confirm the row count before `COMMIT`.
5. **No DDL — ever.** It will fail anyway. Hand schema changes to the user as migration SQL.
6. **Respect the grade model.** Write only `effort` + `report_data`; the migration-013 trigger derives
   `score`. **Never set `score` directly.** Apply the reading-reflection cap (effort ≤ 2 when the
   reflection isn't meaningful — `interaction_reports.py` re-clamps as a guard). Grades stay
   instructor-finalized; you produce suggestions.
7. **Mark provenance.** Anything you generate (not artifact-emitted) gets
   `producer: "backfill-from-report@<date>"` (or similar) in `report_data` so it's auditable.
8. **Idempotent + non-destructive.** The backfill writer fills only rows where `report_data IS NULL`
   unless `--force`. Don't overwrite real data without an explicit reason and the user's awareness.
9. **Keep PII out of the repo.** Reports contain student names. Dump batches and analysis files to the
   **session scratchpad**, never under the repo tree.
10. **Don't disturb the neighbours.** Do not modify RLS policies, the `service_role`/`anon` keys, or
    anything `/preflight-analyze` depends on. The role is sandboxed; keep your actions sandboxed too.
11. **Honor the contract.** All `report_data` you write must conform to
    [`INTERACTION-DATA-CONTRACT.md`](../../docs/contracts/INTERACTION-DATA-CONTRACT.md) (schema 1). The canonical
    *shape* to emit is the object built in [`../seed_demo_interaction.sql`](../seed_demo_interaction.sql).

---

## 6. Common operations

```bash
# Survey what's missing structured data, per interaction:
.venv/Scripts/python supabase/admin/interaction_reports.py stats

# Pull reports lacking report_data into a scratch file (read it, analyze each Markdown):
.venv/Scripts/python supabase/admin/interaction_reports.py list-missing \
    --interaction <slug> --out <scratchpad>/batch.json

# Write model-produced report_data back (validate, then commit):
.venv/Scripts/python supabase/admin/interaction_reports.py write --in <scratchpad>/filled.json --dry-run
.venv/Scripts/python supabase/admin/interaction_reports.py write --in <scratchpad>/filled.json
```

The full backfill workflow + grading rubric is in the skill:
[`../../.ai/skills/interaction-backfill/SKILL.md`](../../.ai/skills/interaction-backfill/SKILL.md).

---

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `could not translate host name … Name or service not known` | Using the **direct** host. Switch the config `host` to the Session pooler host. |
| `connection timed out` | Wrong pooler region/port, or network. Re-copy the Session pooler string (port 5432). |
| `password authentication failed` | Config `user` must be `<role>.<project-ref>` (pooler format), and the password must match the one set in `claude_code_role.sql`. |
| `permission denied` / `must be owner of table` on `ALTER`/`DROP` | **Expected.** The role has no DDL by design. Don't work around it — hand the change to the user as migration SQL. |
| `UnicodeEncodeError … charmap` when printing | Set `PYTHONIOENCODING=utf-8` (reports contain emoji). |
| `No PG* env vars and no config.json` | The credential file is missing — see [`README.md`](README.md) §4. |

---

## 8. Teardown / rotation

Full undo (drops the role + grants) is the comment block at the bottom of
[`claude_code_role.sql`](claude_code_role.sql). To rotate the password: `ALTER ROLE
claude_code_recker PASSWORD '…';` in the SQL Editor, then update `config.json`. The role is
independent of the `service_role` key, so revoking/rotating it never affects `/preflight-analyze`.
