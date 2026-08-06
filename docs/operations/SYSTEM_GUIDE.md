# Core Preflights — System Guide

**Live site**: https://dfpm-physics.github.io/Core_Preflights/site/
**Admin panel**: https://dfpm-physics.github.io/Core_Preflights/site/admin.html
**Supabase dashboard**: https://supabase.com/dashboard/project/shzvpmlnqfmzfmuxkowi
**GitHub repo**: https://github.com/dfpm-physics/Core_Preflights

---

## Roles

There are three roles, each with increasing access:

| Role | Access | Use for |
|---|---|---|
| **Instructor** | Grade their own sections, view reports, export, grant student extensions | Regular instructors |
| **Course Director** | Full access to one course — create assignments, upload roster, manage sections and instructors | Section leaders per course |
| **System Admin** | Full access to all courses (Physics 110 and Physics 215) | Department directors, system maintainers |

Director-only tabs (Assignments, Roster, Sections, Instructors) are hidden from regular Instructor accounts. System Admins see all tabs for all courses.

Only a System Admin can create another System Admin.

---

## Adding an Instructor

> **This section describes the admin panel that is live today (`site/admin.html`, schema `public`).**
> The PREP v2 app (`site/faculty/admin.html` → **Staff**) replaced it, and two differences will
> bite whoever follows the steps below after the cutover:
>
> - **You no longer type a temporary password, and there is no field for one.** The account is
>   created on a derived default — the person's last name plus `1234`, lowercase, cut at the first
>   hyphen — and PREP forces them to replace it before they can do anything. Tell them in person.
>   A director can restore that default later with **Reset password** on the Staff row.
> - **Adding a colleague who already has a PREP login does not create a second account.** Search
>   for them in the Add-staff panel; a duplicate would split their grading history across two
>   identities with no way to rejoin it.
>
> The **Grader** role was withdrawn on 2026-07-27. It meant "grades only, no authoring", but
> authoring has always been gated on *director*, so it granted exactly what *instructor* grants.
> Existing rows keep working; no new ones can be created.

Everything is done from the admin panel — no SQL required.

1. Log into the admin panel as a Course Director or System Admin
2. Go to the **Instructors** tab
3. Fill in the instructor's name, USAFA email, and a temporary password
4. Select their role and click **Add Instructor**:
   - **Instructor** — grades their own sections only
   - **Course Director** — full access to the currently selected course
   - **System Admin** — full access to all courses (Physics 110 + 215); only an existing System Admin can create another one
5. Send them the admin panel URL and their temporary password — they change it themselves after first login (see [Changing Your Password](#changing-your-password) below)
6. Go to the **Sections** tab and assign them to their sections (not needed for System Admins)

> **Note:** The temporary password can be anything — the instructor changes it themselves after logging in.

---

## Removing an Instructor

1. In the **Sections** tab, reassign their sections to another instructor
2. Go to the **Instructors** tab and click **Remove** next to their name

For regular instructors and directors, this removes their course access for the currently selected course. For System Admins, it clears their global admin flag.

Their login account remains in the system but loses all access — if you need to permanently delete it, go to the [Supabase Auth dashboard](https://supabase.com/dashboard/project/shzvpmlnqfmzfmuxkowi/auth/users) and delete the user there.

> **Note:** Only a System Admin can remove another System Admin.

---

## Changing Your Password

Any logged-in instructor can change their own password without contacting the course director.

1. Log into the admin panel
2. Click **Change Password** in the top-right corner of the header
3. Enter a new password (at least 6 characters) and confirm it
4. Click **Save Password** — the modal closes automatically on success

> This is how new instructors should change their temporary password on first login.

---

## Adding Students (Roster Upload)

> ## ⚠ SUPERSEDED — the cutover happened on 2026-07-28
>
> **Everything in this section describes `site/admin.html`, which no longer exists.** The promotion
> deleted it and put the PREP v2 app on the public paths. This banner used to say "none of that is
> live until the cutover; at that point everything below is superseded in one go" — that is the
> event, and this is the go.
>
> **The current procedure is [`site/help/instructor-accounts.md`](../../site/help/instructor-accounts.md)
> → "Importing a roster",** which is the in-app help page a director actually reads. In one
> paragraph, what changed: the import takes the **registrar's export as-is** (not a hand-made
> three-column CSV), requires **Cadet EMPLID / Cadet Name / Email / Section** (Cadet Squadron and
> the three Major columns are optional — a cadet with no squadron imports normally),
> filters out rows for other courses, reviews each returning cadet field by field, offers to create
> sections the file names, provisions logins automatically, and — since 2026-07-28 — proposes
> **removing cadets who are on the roster but not in the file**, listed by name for confirmation.
> That check covers the whole offering, so **export the whole course**, not one section.
> Sign-in is the cadet's **real registrar address**, not `studentID@usafa.edu`.
>
> The text below is kept only as a record of the retired `public` procedure. Do not follow it.

Students are uploaded via CSV at the start of each semester.

**CSV format** (no header row needed, but including one is fine):
```
student_id,name,section
3000123456,Smith John,M1A
3000234567,Jones Jane,T3B
```

- `student_id`: 10-digit number starting with `3000`
- `section`: must match an existing section ID (e.g., `M1A`, `T3C`)

**To upload:**
1. Log into the admin panel
2. Select the correct course (Physics 215 or Physics 110) using the pills at the top
3. Go to the **Roster** tab
4. Click **Choose File**, select your CSV, then click **Upload Roster**

The page will preview the data and report any invalid student IDs or unknown section codes before committing.

After uploading, the Roster tab shows how many students lack login accounts. Click **Provision Accounts** to create those accounts in bulk. Each student's email is `studentID@usafa.edu`, and the default password is the last 6 digits of their student ID number.

---

## Editing or Removing a Student

> **⚠ SUPERSEDED with the section above** — there is no Roster tab. The live equivalents are
> **Course Admin → Students**: **Move** for a section change, **Remove** for a departure. As of
> 2026-07-28 **Remove no longer deletes anything, and nothing in the UI does** — a student may be
> enrolled in another course, and their record is theirs rather than one offering's. Remove marks
> the enrollment `dropped`, which takes the cadet out of the roster, grading, the gradebook and
> every class number while keeping their account, submissions and grades. Removed cadets sit in a
> collapsed list under the roster table with a **Re-enroll** button, and a roster import that names
> them again brings them back automatically. Purging a row outright is an operator-tier script
> action, not a button.
>
> The retired `public` procedure follows.

Both actions are available directly in the **Roster** tab — no SQL required.

**To change a student's section:**
1. Go to the **Roster** tab
2. Find the student and click **Edit Section**
3. Select the new section from the dropdown and click **Save**

**To remove a student:**
1. Go to the **Roster** tab
2. Find the student and click **Remove**
3. Confirm the prompt — this permanently deletes their record, all submissions, and all scores

---

## Granting a Student Extension

Any instructor can grant an extension from the Grade tab.

1. Go to the **Grade** tab and select the assignment
2. Find the student's card and click **📅 Grant Extension**
3. Pick the new due date and time, then click **Save Extension**

The student's assignment page will automatically use the extended date. The extension badge shows on their card so instructors can see it at a glance. Extensions can be edited or removed at any time before the student submits.

---

## Lesson Interactions (Claude Artifacts)

*Added 2026-06-11 by Matthew Recker.*

A **lesson interaction** is an interactive Claude artifact (hosted on claude.ai) that
students work through. When they finish, the artifact sends a report back to the site,
saved to each student's record. This is separate from the assignments system.

### Adding / managing interactions (Course Directors & Admins)

Use the **Manage Interactions** page: `…/interactions-admin.html`

1. Sign in with your instructor email.
2. Click **+ New interaction** and fill in:
   - **Interaction id (slug)** — a stable identifier like `lesson-02-charge`
     (lowercase, numbers, hyphens). **This must exactly match the slug the artifact uses
     in its submit link** — coordinate with whoever built the artifact.
   - **Title**, **Course**, optional **Description**, and the **Artifact URL** (the
     claude.ai link students open).
   - Check **Published** to make it visible to students.
3. The list shows every interaction with its submission count. Use **Edit**, **Publish/
   Unpublish**, or **Delete** (deleting also removes all its student reports).

> The slug is the link between the artifact and this site. If they don't match, student
> submissions are rejected. The slug can't be changed after creation.

### Viewing student reports

1. On the Manage Interactions page, click **View N** in the Submissions column.
2. Pick a **section**, then a **student** — the page renders that student's report.
   (Directors/admins see all sections; instructors see only their own.)

### Student experience

Students open `…/site/student/lessons.html`, click **Launch** on a lesson, complete the artifact,
then sign in on the submit page to save their report.

**They cannot re-submit a graded lesson.** This said "they can re-submit to overwrite" until
2026-07-28, which was true of the retired receiver and is not true now: an interactive submission
grades itself the moment it commits, and both the submit page and the database refuse a second
report once a finalized grade exists. The first report is the one that counts. If a cadet needs
another attempt, reopen their grade in the Grade tab. A lesson set up as **practice** grades
nothing, so re-running that one does replace the stored report.

---

## Running Preflight Analysis (`/preflight-analyze`)

The preflight analysis run reads student submissions, checks them for physics misconceptions, and writes suggested scores to Supabase. It also records a hidden per-student assessment on each submitted student's grade row: the two 0–5 diagnostics (Q2 effort and Q3 physics understanding) plus an overall effort and understanding read, the misconceptions their answers showed, and follow-up flags. None of it affects grades, and student pages neither request nor display any of it. **It writes nothing at the class level** — the per-instructor report it used to store was retired in July 2026, and everything about a cohort now comes from the separate aggregation run, summarized per section and then per course. **Only Course Directors and System Admins initiate these runs** — not individual instructors. A Course Director normally runs the cycle once after the M-day deadline and once after the T-day deadline; instructors then review and finalize their own sections in the Grade tab.

The runbook lives in `.ai/skills/preflight-analyze/SKILL.md`. Every supported AI follows this same agent-neutral runbook; vendor addenda only adapt tooling.

### One-time setup

**1. Install an agent that can run the workflow**

Use Claude Code, Codex, or another trusted operator that can read the repo runbook and write to Supabase with the service key. The operator should read `AGENTS.md` before making any live database changes.

**2. Clone the repo**

```bash
git clone https://github.com/dfpm-physics/Core_Preflights.git
cd Core_Preflights
```

**3. Create your config file**

```bash
mkdir -p ~/.claude/skills/preflight-analyze
cp .ai/skills/preflight-analyze/config.json.template \
   ~/.claude/skills/preflight-analyze/config.json
```

Open `~/.claude/skills/preflight-analyze/config.json` and fill in the values:

```json
{
  "supabase_url": "https://shzvpmlnqfmzfmuxkowi.supabase.co",
  "supabase_service_key": "GET THIS FROM THE COURSE DIRECTOR",
  "textbook_base_path": "/path/to/folder/containing/Text_Book_PDFs/",
  "default_course_id": "phys-215"
}
```

- `supabase_service_key`: a secret key that bypasses Supabase security — get it from the course director, never share it or commit it to GitHub
- `textbook_base_path`: the base folder that contains `Text_Book_PDFs/215 Sections/` and any other textbook PDF folders

The config path is Claude-branded for historical reasons, but Codex uses the same local file. **Never create or commit a real `config.json` inside the repo.**

### Running the skill (Course Director / System Admin only)

Before each live run:

1. Wait until the relevant M-day or T-day deadline has passed.
2. Designate one operator; do not let Claude, Codex, or another teammate grade the same assignment at the same time.
3. From the repo, pull the latest `main` and confirm the working tree is clean.
4. Confirm the assignment ID, reference PDF, and reference pages are set correctly in the Assignments tab.

To initiate grading in Claude Code, open it from the repo folder and run one day group at a time:

```
/preflight-analyze preflight-02 M    ← all M-day sections
/preflight-analyze preflight-02 T    ← all T-day sections
```

To initiate the same grading run in Codex, ask in plain language, for example:

```
Run preflight-analyze for preflight-02 M and write the grades.
Run preflight-analyze for preflight-02 T and write the grades.
```

Each run:
1. Fetches all student responses for that day's sections
2. Reads the relevant textbook pages (if configured on the assignment)
3. Grades numerical and multiple choice questions automatically
4. Analyzes free-response answers for physics misconceptions
5. Assigns hidden Q2-effort and Q3-understanding diagnostics on a 0–5 scale
6. Records a per-student assessment beside the grade — overall effort and understanding, the
   misconceptions the answers showed, and follow-up flags — in the same structured form an
   interactive lesson produces, so both can be summarized by the same cohort run
7. Writes suggested scores, diagnostics and that assessment to Supabase (`is_finalized = false`) for every submitted student
8. Prints a per-section run summary in the terminal or chat — submitted, missing, skipped, average score

The cohort-level panels on the lesson rollup — the readiness summary (written per instructor across
the sections they teach), the teaching recommendation under the misconception bars, and the showcase
quotes — are **not** written by this run. They come from a separate lesson-aggregation run, covering
students who took the interactive lesson and students who answered the question set together.
*(A separate misconception-trends paragraph was retired 2026-07-22 — the bars now carry each
misconception's own description and student evidence.)*

**That run is also per day track, not one run for the class.** It is made after each day's deadline
with a `--day` filter, exactly like grading: it writes a scope for each section that day covers and
for each instructor teaching one, and it writes the whole-course scope only once every section in
the course has been covered. So a lesson with split M/T deadlines is closed out by two runs, and the
second one completes it. Splitting grading from aggregation is deliberate for the same reason:
a cohort summary written over one day's students would describe half a class.

The AI run **does not publish grades to students**. It only writes unfinalized suggestions. After the run, instructors log into the admin panel, go to the **Grade** tab, review green/yellow/red suggestions, edit feedback if needed, click **Save**, then click **Finalize & Publish** to make grades visible to students.

Zero-point reflection questions such as Q1 are intentionally hidden on each student's Grade-tab card; instructors review and toggle only the scored questions. In the Report tab, Q1 raw responses remain anonymous: the **Show names** toggle is removed for Q1 only, while it remains available for other questions.

**Grading policy**: wrong answers that show genuine engagement with the topic are marked yellow (full credit, flagged for review) — not zero. Only blank or completely off-topic responses receive zero credit. Instructors should review all yellow items and decide whether to confirm full credit, downgrade to no credit, or adjust feedback.

---

## Adding Figures to Assignments

Assignments support two levels of optional figures — an assignment-level figure shown above all questions, and per-question figures shown inline with a specific question.

### Where to put image files

Drop image files into the `site/img/assignments/` folder in the repo:

```
Core_Preflights/
  site/
    img/
      assignments/
      coulombs-law-diagram.png
      force-diagram-q2.png
      ...
```

GitHub Pages serves this folder automatically, so the public URL for any file is:

```
https://dfpm-physics.github.io/Core_Preflights/site/img/assignments/your-filename.png
```

Commit and push the image file, then use that URL in the admin panel. The image will be live as soon as GitHub Pages deploys (usually under 2 minutes).

You can also use any external image URL (e.g., a link directly from OpenStax or any publicly accessible host) — just paste the full URL.

### How to add a figure

**Assignment-level figure** (shown above all questions):
1. Go to the **Assignments** tab and open or create an assignment
2. Paste the image URL into the **Assignment Figure** field
3. A live preview appears immediately — verify it looks right before saving

**Per-question figure** (shown below a specific question's text):
1. In the question builder, each question has its own **Question Figure** field
2. Paste the URL there — a preview appears inline in the editor

### What students and instructors see

| Context | Assignment figure | Question figure |
|---|---|---|
| Student submission page | Above all questions | Below the question text, above the answer input |
| Student review (graded) | Above all questions | Below the question text |
| Instructor Grade tab | — | Below the question text in each student's card |

Figures are stored as URLs in the database — no file upload to Supabase is needed.

---

## Starting a New Semester

> **Rewritten 2026-07-27.** The previous version of this section told you to run
> `TRUNCATE TABLE scores; TRUNCATE TABLE responses; DELETE FROM students;` in the SQL editor.
> **Do not do that.** It was written for the legacy `public` schema, where a term's data and the
> course itself were the same rows, so the only way to start a term was to destroy the last one.
> Schema `app` separates them, and running those statements today would delete live data to
> accomplish nothing.

**Nothing is cleared. A term is a row.** `course_offerings` is one course's run of one term, and
every piece of student work — enrollments, submissions, grades, reports — hangs off it. A new
semester is a new `course_offerings` row, so last term keeps its data intact and nothing has to be
deleted for this term to start empty.

Assignments are deliberately term-agnostic: `assignments` is the container, `activities` holds the
content, and `assignment_offerings` schedules one assignment into one term. Scheduling the same
assignment into a new offering therefore **reuses the same content** rather than copying it, which
is why past cohorts keep working — their `content_snapshot` was frozen at publish.

**Step 1 — Create the new offering and copy the schedule**

`scripts/fall2026/split_training_offering.py` is the worked example (it created the clean Fall 2026
phys-215 offering on 2026-07-27). It copies `assignment_offerings` and their `offering_activities`
into a fresh offering and deliberately copies **no** student data. Dry-run by default; `--commit`
to write. Adapt the term codes for the new semester.

Note the unique constraint: `course_offerings` is `UNIQUE (course_id, term_id)`, so a course can
have exactly one offering per term. If you want the old one to stay reachable, give it its own
term — which is how the training sandbox was made, since `course_offerings` has no name column and
the **term label** is what the UI shows.

**Step 2 — Update the due dates**

Each scheduled assignment carries a per-meeting-day schedule in `assignment_offerings.due_by_day`
(`{"M": …, "T": …}`) plus a fallback `due_at`. Edit them in **Lessons** — the editor shows a date
box and a time box per meeting day the offering's sections actually use, so a course meeting W/F
needs no code change. Saving rewrites the per-section rows for every current section.

**Which date goes on which lesson comes from the academy calendar, not from counting.** A preflight
is due the evening before its class, and which calendar days are M-days and which are T-days is a
property of the USAFA Academic Calendar — it is not in the database and it is not a pattern you can
work out. The published calendar is mirrored into the repo at `site/data/academic-calendar.json`
(regenerate with `python scripts/calendar/build_academic_calendar.py --commit`), and it names every
teaching day `M<n>` / `T<n>` — the track **and** the lesson number, so lesson 14's two dates are the
days it lists as `M14` and `T14`. Do not assume the two alternate: in Fall 2026 a lesson's M-day and
T-day are one day apart 32 times, three days apart six times, and **four days apart twice**. The
file also marks the **modified-SOC** days, on which afternoon sections start an hour early — that
changes when class meets and never moves a deadline, but it is worth knowing when you look at a week
that seems oddly shaped. CORE.md §2 carries the full note.

The time box starts on **your course's deadline hour** — 2359 for both Physics 215 and Physics 110
(converged 2026-08-06; 215 was briefly 1759) — and an assignment that already has a deadline reloads
whatever it was saved with, so the default only applies to a date nobody has timed yet. That hour is course policy set by the course director,
hardcoded in three places that must move together; CORE.md §2 names them. To change it for a whole
term that is already built, use `scripts/fall2026/set_due_time.py` rather than editing 37 lessons by
hand — it rewrites all three storage locations, which is what stops the editor putting the old time
back on the next save.

**Step 3 — Upload the new roster**

Follow the Roster Upload steps above. **The import creates the sections** — if the file names a
section the offering does not have (on a first import, that is all of them), the preview lists them
and offers **Create these sections and re-check**. That is the bulk route and the one to use here.

For a single section added later, **Course Admin → Staff → Section coverage → + Add section**.

*(Corrected 2026-07-28. This said "there is no separate section-creation screen and none is needed",
and the import's offer did not fire for an offering with **no** sections at all — it passed a null
section map, which switches the check off — so a new course deadlocked: the import demanded sections
that only the import could create. Both routes are real now.)*

A created section gets its meeting days guessed from its code (`M1A` → M-day, `T3B` → T-day). That
guess is a starting value, not a rule: it is stored on the section and can be corrected, and every
deadline is resolved from the stored value, never from the code. **Check it for any section whose
code does not follow the `[MT][135][A-D]` convention** — a section with no meeting day falls back
to the assignment's default deadline.

**Step 4 — Staff the offering**

Add instructors in **Course Admin → Staff**, and assign sections on the Section Coverage grid.
Staff rows are per offering, so last term's staffing does not carry over — which is the point:
"director of Physics 215 in Fall 2026" should not mean "director of it forever".

**Step 5 — Verify**

Open the student view and confirm the assignment list and deadlines look right for both an M-day
and a T-day section.

---

## Exporting Grades to Blackboard

1. Log into the admin panel as course director
2. Go to the **Export** tab
3. Click **Download Blackboard CSV**

The file (`CorePreflights_Grades_YYYY-MM-DD.csv`) contains one row per student and one column per finalized assignment. Import it directly into Blackboard.

Only finalized assignments are included as columns. Unfinalized assignments are omitted.

---

## One-Time System Setup (Course Director Only)

This section documents what was done to deploy the system — only needed if starting from scratch or re-deploying.

### Deploy the Edge Functions

**Six** edge functions run server-side work a browser session must not be trusted with. They only need to be deployed once (or after any code change to them).

| Function | Why it cannot live in the browser |
|---|---|
| `create-instructor` | Creates an auth user plus its access rows, and rolls back a partial failure. **Derives** the staff default password (last name + `1234`) and flags the account for forced rotation — the caller supplies no password (2026-07-27) |
| `remove-instructor` | Removes course access, or clears the global-admin flag |
| `provision-students` | Bulk-creates cadet auth accounts from the roster |
| `reset-student-password` | Derives the default password server-side, and **rejects** a request that carries one — so nobody can set a cadet's password to a value they then know |
| `reset-staff-password` | The same for a staff account, against the same derived default. Directors and system admins only, and a director cannot reset a system admin (2026-07-27) |
| `set-own-password` | Re-verifies the current password (`updateUser` does not) and clears the forced-rotation flag, which lives in `app_metadata` where a browser session cannot write it |

**1. Install the Supabase CLI**

```bash
brew install supabase/tap/supabase   # Mac
```
Or download from https://supabase.com/docs/guides/cli

**2. Log in and link the project**

```bash
supabase login
supabase link --project-ref shzvpmlnqfmzfmuxkowi
```

**3. Deploy every function**

```bash
supabase functions deploy create-instructor
supabase functions deploy remove-instructor
supabase functions deploy provision-students
supabase functions deploy reset-student-password
supabase functions deploy reset-staff-password
supabase functions deploy set-own-password
```

That's it — the functions run on Supabase's servers from that point on. No one else needs the CLI.

> This list said "both functions" and named only the first two until 2026-07-27. Deploying from
> scratch against that list would have left account provisioning and both password paths missing,
> which fails at the point a cadet cannot sign in. Add any new function here when you write it.

### Run the RLS Migrations

Run each of these once in the [Supabase SQL editor](https://supabase.com/dashboard/project/shzvpmlnqfmzfmuxkowi/sql). The files also live in `supabase/migrations/` in the repo.

**Instructors read policy** — allows the Instructors tab to list all instructor names:

```sql
-- supabase/migrations/instructors_read_policy.sql
ALTER TABLE instructors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "instructors_read_all" ON instructors;
CREATE POLICY "instructors_read_all" ON instructors
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "instructors_update_own" ON instructors
  FOR UPDATE TO authenticated USING (id = auth.uid());
```

**Student write policy** — allows directors to edit sections and remove students from the Roster tab:

```sql
-- supabase/migrations/students_director_write_policy.sql
CREATE POLICY "directors_update_students" ON students
  FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "directors_delete_students" ON students
  FOR DELETE TO authenticated
  USING (true);
```

**Course access read policy** — allows the Instructors tab to list all directors and instructors for a course:

```sql
-- supabase/migrations/instructor_course_access_read_policy.sql
ALTER TABLE instructor_course_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "course_access_read_authenticated" ON instructor_course_access;
CREATE POLICY "course_access_read_authenticated" ON instructor_course_access
  FOR SELECT TO authenticated
  USING (true);
```

---

## Course Director Service Key

The Supabase service role key is required for preflight analysis and bypasses all database security. It is stored locally at:

```
~/.claude/skills/preflight-analyze/config.json
```

To find it: Supabase dashboard → **Project Settings → API → service_role key** (click to reveal).

**Never commit this key to GitHub.** Share it only with authorized analysis operators, normally Course Directors or System Admins, via a secure channel such as a password manager or encrypted message.
