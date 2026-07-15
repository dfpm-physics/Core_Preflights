# Supabase Setup — Physics 215

Follow these steps once at the start. Takes about 15 minutes.

---

## Step 1 — Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) → Sign in → New Project
2. Name it `physics215` (or similar)
3. Choose a strong database password (save it somewhere — you won't use it often)
4. Region: choose closest to Colorado (e.g., US East or US West)
5. Wait for the project to finish provisioning (~2 min)

---

## Step 2 — Run the Schema

1. In your Supabase project → left sidebar → **SQL Editor** → **New Query**
2. Open `schema.sql` from this folder, paste the entire contents, click **Run**
3. You should see "Success. No rows returned."

---

## Step 3 — Run Row Level Security Policies

1. Same SQL Editor → New Query
2. Open `rls.sql`, paste the entire contents, click **Run**

---

## Step 4 — Create Your Admin Account

1. Supabase → left sidebar → **Authentication** → **Users** → **Add User**
2. Email: your USAFA email
3. Password: choose a strong password
4. Click **Create User** — copy the UUID shown (you'll need it in Step 5)

---

## Step 5 — Register Yourself as Course Director

1. SQL Editor → New Query → run:
```sql
INSERT INTO instructors (id, name, is_director)
VALUES (
  'YOUR-UUID-FROM-STEP-4',
  'Your Name',
  TRUE
);
```
Replace `YOUR-UUID-FROM-STEP-4` with the UUID from Step 4.

---

## Step 6 — Get Your API Keys

1. Supabase → **Project Settings** (gear icon) → **API**
2. Copy two values:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon / public key** — long `eyJ...` string (safe to include in the website code)
   - **service_role / secret key** — longer `eyJ...` string (NEVER commit this to GitHub)

---

## Step 7 — Create the preflight-analyze Config

Create this file locally (it is never uploaded to GitHub). The template lives at
`.ai/skills/preflight-analyze/config.json.template`:

**File**: `~/.claude/skills/preflight-analyze/config.json`

```json
{
  "supabase_url": "https://YOUR_PROJECT_ID.supabase.co",
  "supabase_service_key": "sb_secret_REPLACE_ME",
  "textbook_base_path": "/path/to/your/local/textbooks/",
  "default_course_id": "phys-215"
}
```

---

## Step 8 — Update the Website Config

Open `physics215/js/config.js` and fill in your public values:

```js
const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'eyJ... (anon key)';
```

These are safe to commit — they only grant access based on RLS policies.

---

## Step 9 — Add a Test Section

```sql
INSERT INTO sections (id, instructor_id)
VALUES ('M1A', 'YOUR-UUID-FROM-STEP-4');
```

---

## Semester Reset Checklist (each new semester)

- [ ] Delete old students: `TRUNCATE students CASCADE;`  
  *(this also removes responses and scores — only do this between semesters)*
- [ ] Upload new roster via admin page → Roster tab
- [ ] Reassign instructors to sections in admin → Sections tab
- [ ] Invite new instructors: Authentication → Users → Add User; then run:
  ```sql
  INSERT INTO instructors (id, name, is_director) VALUES ('new-uuid', 'Name', FALSE);
  ```
- [ ] Create new assignments for the semester
