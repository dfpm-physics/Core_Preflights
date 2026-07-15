---
name: setup-preflight
description: >
  One-time setup wizard for the preflight-analyze skill. Run when a new instructor,
  admin, or course director needs to configure their local machine to use the
  preflight analysis and grading tools. Triggers on /setup-preflight, "set up the
  skill", "configure the skill", "first time setup", "how do I get started grading",
  "set up preflight analyze", "onboard to the skill".
---

# Preflight Skill Setup Wizard

You are helping a new Physics 110/215 instructor configure their local machine to run
the `/preflight-analyze` skill. Walk through each step in order, waiting for the user's
input before proceeding. Be conversational and clear — the person may not be technical.

---

## Step 1 — Check for an Existing Config

Run this command to check whether a config file already exists:

```bash
ls ~/.claude/skills/preflight-analyze/config.json 2>/dev/null && echo "EXISTS" || echo "NOT_FOUND"
```

- If `EXISTS`: read the file, show the current values (mask the service key — show only the first 12 characters followed by `…`), and ask: **"A config file already exists. Would you like to update it or keep it as-is?"**
  - If they want to keep it, jump straight to Step 5 (verify connection).
  - If they want to update it, continue from Step 2.
- If `NOT_FOUND`: tell them you'll walk them through creating it now, then continue to Step 2.

---

## Step 2 — Explain What Is Needed

Tell the user the following before asking for any values:

> To use the preflight analysis skill you need three pieces of information. All of them
> come from the Supabase project dashboard — your course director can give you access
> if you don't have it yet.
>
> **1. Supabase Project URL**
> In the Supabase dashboard: open the project → **Project Settings** (gear icon) →
> **API** → copy the **Project URL**. It looks like:
> `https://xxxxxxxxxxxxxxxxxxxx.supabase.co`
>
> **2. Service Role Secret Key**
> On the same API page, under **Project API keys**, click **Reveal** next to
> `service_role`. Copy the full key — it is a long string starting with `eyJ`.
> ⚠️ Keep this secret. It bypasses all row-level security and should never be shared
> or committed to the repo.
>
> **3. Textbook PDF folder path**
> The skill reads textbook pages to ground its analysis. You need the full path to
> the folder on your machine that contains the OpenStax PDF files. Your course director
> can point you to the shared OneDrive folder or a local copy.
>
> Ready? Let's collect them one at a time.

---

## Step 3 — Collect Each Config Value

Ask for each value **one at a time**, validating before moving on.

### 3a. Supabase URL

Ask: **"Paste your Supabase Project URL:"**

Validate:
- Must start with `https://`
- Must end with `.supabase.co`

If invalid, explain what's wrong and ask again. Store as `SUPA_URL`.

### 3b. Service Role Key

Ask: **"Paste your Supabase service_role key:"**

Validate:
- Must be at least 100 characters (it's a JWT)
- Should start with `eyJ`

If it looks like the anon/public key (the same one in `site/js/config.js`), warn:
> "This looks like the anon key, not the service role key. The service role key is
> much longer and is listed separately under 'service_role' on the API settings page.
> Please double-check and paste it again."

Store as `SUPA_KEY`.

### 3c. Textbook PDF Path

The textbook base path is usually the parent folder of the repo in the shared OneDrive
course folder — the folder that contains `Text_Book_PDFs/215 Sections/`. Derive a
best guess from the repo location first:

```bash
git rev-parse --show-toplevel
```

Store the result as `REPO_ROOT`. Then construct:

```
PDF_BASE = parent directory of REPO_ROOT
```

Check whether PDFs are already in place. For Physics 215:

```bash
ls "{PDF_BASE}/Text_Book_PDFs/215 Sections/"*.pdf 2>/dev/null | head -5
```

**If PDFs are found:** show the first few filenames. Tell the user:
> ✓ Found your textbook PDFs under `{PDF_BASE}/Text_Book_PDFs/`

**If the folder is missing or no PDFs are present:** tell the user:
> The textbook PDF folder was not found under `{PDF_BASE}/Text_Book_PDFs/`. You'll need
> to download the PDFs from the shared Teams channel or point `textbook_base_path` at
> the local folder that contains `Text_Book_PDFs/`. Here's how:
>
> 1. Open the **Physics department Teams channel**
> 2. Go to **Files** → `Core_Preflights_PDFs`
> 3. Download the textbook PDF folder
> 4. Put it where the config's `textbook_base_path` can see `Text_Book_PDFs/215 Sections/`
>
> You can finish setup now and add the PDFs later — the skill will still run without
> them, just without textbook context. Re-run `/setup-preflight` after adding the
> files to verify.

Store `PDF_BASE` as `textbook_base_path`. If the derived path is wrong, ask the user for
the correct base folder and use that instead.

### 3d. Default Course

Ask: **"Which course do you primarily teach?"**
Options: `phys-215` or `phys-110`

Store as `COURSE_ID`.

---

## Step 4 — Write the Config File

Create the directory if it doesn't exist:

```bash
mkdir -p ~/.claude/skills/preflight-analyze
```

Then write the config using a here-doc so special characters in the key are handled safely:

```bash
cat > ~/.claude/skills/preflight-analyze/config.json << 'ENDOFCONFIG'
{
  "supabase_url": "SUPA_URL_PLACEHOLDER",
  "supabase_service_key": "SUPA_KEY_PLACEHOLDER",
  "textbook_base_path": "PDF_BASE_PLACEHOLDER",
  "default_course_id": "COURSE_ID_PLACEHOLDER"
}
ENDOFCONFIG
```

Substitute the actual values for each placeholder before running. Then confirm:

> ✓ Config written to `~/.claude/skills/preflight-analyze/config.json`
> This file lives only on your local machine — it is in `.gitignore` and will never
> be committed to the repo.

---

## Step 5 — Verify the Supabase Connection

Run a quick connection test:

```bash
python3 - <<'PY'
import json
import pathlib
import urllib.error
import urllib.request

cfg = json.loads(pathlib.Path("~/.claude/skills/preflight-analyze/config.json").expanduser().read_text())
url = cfg["supabase_url"].rstrip("/") + "/rest/v1/courses?select=id,title"
req = urllib.request.Request(url, headers={
    "apikey": cfg["supabase_service_key"],
    "Authorization": "Bearer " + cfg["supabase_service_key"],
})
try:
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read() or b"[]")
except urllib.error.HTTPError as e:
    print(f"FAIL: HTTP {e.code} " + e.read().decode(errors="replace"))
except Exception as e:
    print("FAIL: " + str(e))
else:
    print("OK")
    for c in data:
        print(c.get("id", "") + " | " + c.get("title", ""))
PY
```

**If `OK`:** Show the list of courses returned. Tell the user they're connected.

**If `FAIL` with a 401 or `Invalid API key`:**
> "The service role key wasn't accepted. Please check that you copied the **service_role**
> key (not the **anon** key) from Supabase → Project Settings → API.
> Re-run `/setup-preflight` to update it."

**If `FAIL` with a network/DNS error:**
> "Couldn't reach Supabase. Check that the Project URL is correct and that you have an
> internet connection. Re-run `/setup-preflight` to fix the URL."

---

## Step 6 — Remind About PDFs If Missing

If PDFs were found in Step 3c, skip this step entirely.

If the textbook PDFs were not found, print a one-line reminder at the end of the summary:

> ⚠️ **PDFs not yet downloaded.** The skill will run but won't have textbook context.
> Download the textbook PDFs from Teams → Files → `Core_Preflights_PDFs` and make sure
> `textbook_base_path` contains `Text_Book_PDFs/215 Sections/`.

---

## Step 7 — Print a Success Summary

Print this summary (substituting real values):

---

> ✅ **Setup complete!**
>
> Your config is saved at `~/.claude/skills/preflight-analyze/config.json`
>
> ---
>
> **Run your first analysis:**
>
> ```
> /preflight-analyze {COURSE_ID} preflight-1 M
> ```
> Analyzes M-day section submissions for Preflight 1, writes suggested scores to
> Supabase (unfinalized), and prints a per-instructor misconception report.
>
> **Other useful commands:**
> ```
> /preflight-analyze {COURSE_ID} preflight-1 T    ← T-day sections only
> /preflight-analyze {COURSE_ID} preflight-1      ← all sections
> /preflight-analyze {COURSE_ID}                  ← pick from a list of assignments
> ```
>
> Suggested scores are always written as **unfinalized** — instructors review and
> click **Finalize & Publish Grades** in the Admin panel when they're ready.
>
> **Admin panel:** https://dfpm-physics.github.io/Core_Preflights/site/admin.html

---

## Error Handling

- **Permission denied writing config**: If `mkdir` or writing the file fails, suggest
  running `mkdir -p ~/.claude/skills/preflight-analyze` manually and checking permissions.
- **User wants to stop**: At any point if the user says "cancel", "stop", or "never mind",
  stop and tell them they can re-run `/setup-preflight` whenever they're ready.
