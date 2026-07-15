# `supabase/admin/` — operator DB tooling

One-time, **per-operator** database tooling. **Not** part of the numbered migration chain in
`supabase/migrations/` — running (or skipping) anything here has no effect on the schema and
nothing else replays it.

It gives a Course Director / System Admin's **Claude Code** the ability to read and write course
data directly through a **scoped, least-privilege Postgres role** — deliberately separate from the
broad `service_role` key that `/preflight-analyze` uses, so the two never interfere.

> **A future Claude iteration?** Read [`AGENT-DB-ACCESS.md`](AGENT-DB-ACCESS.md) — the operating
> manual (how the access was established, how to connect, and the rules for reading/writing). This
> README is the human setup runbook.

## Files

| File | Purpose |
|---|---|
| `claude_code_role.sql` | Creates the scoped DB role. Run once, in the Supabase SQL Editor. |
| `db_check.py` | Connectivity + permission self-test (read OK, write OK, **DDL denied**). |
| `interaction_reports.py` | DB I/O for the `interaction-backfill` skill (`stats` / `list-missing` / `write`). |

## What the role can and cannot do

- **Can:** `SELECT` / `INSERT` / `UPDATE` / `DELETE` on every table in `public`, and see RLS-protected
  rows (`BYPASSRLS`).
- **Cannot:** any schema change. The role owns nothing and is granted no DDL, so `ALTER` / `DROP` /
  `TRUNCATE` are refused **by Postgres itself** — not by good behavior. It also can't touch the
  `service_role`/`anon` keys or any existing RLS policy (the setup is strictly additive).

## One-time setup (~5 min)

1. **Create the role.** Open [`claude_code_role.sql`](claude_code_role.sql), replace the `REPLACE_ME`
   password with a strong generated one, and run it in **Supabase → SQL Editor** (it runs as
   `postgres`). It's wrapped in a transaction and strictly additive — if the `BYPASSRLS` line isn't
   permitted on your project, the whole thing rolls back and nothing is applied.
   - **Reproducing for a different operator?** Change the role name `claude_code_recker` throughout
     the SQL to `claude_code_<you>`, and use that name everywhere below.

2. **Python environment** (from the repo root):
   ```
   python -m venv .venv
   .venv\Scripts\python -m pip install -r requirements.txt      # Windows
   .venv/bin/python   -m pip install -r requirements.txt        # macOS/Linux
   ```

3. **Get the connection string.** Supabase dashboard → **Connect → Session pooler** (or
   **Project Settings → Database → Connection pooling**, Mode = **Session**). Copy host/port/user.
   - ⚠️ **Use the Session pooler host** (`aws-<n>-<region>.pooler.supabase.com`, port `5432`), **not**
     the direct `db.<ref>.supabase.co` host — the direct host is **IPv6-only** and won't resolve on
     most machines.
   - The pooler **username is `<role>.<project-ref>`**, e.g. `claude_code_recker.shzvpmlnqfmzfmuxkowi`.

4. **Write the config.** Copy the template and fill it in:
   ```
   cp supabase/admin/config.json.template supabase/admin/config.json
   ```
   Set `host` (pooler), `user` (`<role>.<ref>`), `password` (from step 1), `sslmode: "require"`.
   This file is **gitignored** — never commit it. (Because the repo lives in OneDrive, the gitignored
   config syncs to your OneDrive; that's a private cloud copy, not git/GitHub.)

5. **Verify.**
   ```
   .venv\Scripts\python supabase\admin\db_check.py
   ```
   Expect: connects as your role, reads rows, and reports `ALTER` / `DROP` as **DENIED**. If it can't
   connect, you almost certainly used the direct host instead of the Session pooler (step 3).

## Using it

- The **`interaction-backfill`** skill ([`../../.ai/skills/interaction-backfill/SKILL.md`](../../.ai/skills/interaction-backfill/SKILL.md))
  drives `interaction_reports.py` to backfill structured `report_data` onto interaction reports that
  only have `report_markdown`. See that skill for the full workflow; quick commands:
  ```
  .venv\Scripts\python supabase\admin\interaction_reports.py stats
  .venv\Scripts\python supabase\admin\interaction_reports.py list-missing --out batch.json
  .venv\Scripts\python supabase\admin\interaction_reports.py write --in filled.json --dry-run
  ```

## Undo

Full teardown SQL (drops the role and all its grants) is in the comment block at the bottom of
[`claude_code_role.sql`](claude_code_role.sql).
