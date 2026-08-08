# Onboarding an operator to close out a lesson

**Reader:** someone who has just been given this repo and told they need to be able to close out
lessons — grade the preflight and produce the instructor rollup — starting with the one that
closes in a couple of days.

**This is not [`MACHINE-SETUP.md`](MACHINE-SETUP.md).** That runbook brings a machine to full
development parity: every credential, the 968 MB textbook corpus, the Node harnesses, publish
access. It is the right document for a second development desktop and the wrong one for this.
Most of it is not needed to run a close-out, and reading it end to end is how a two-day runway
gets spent on a PDF download.

---

## 0. First, find out what you already have

```
python scripts/onboarding/prep_doctor.py
```

Read-only, stdlib-only, and it runs **before** anything is installed — that is what it is for. It
reports per **capability** rather than per setup step, because the capabilities have genuinely
different requirements and most people only need one of them:

```
WHAT THIS MACHINE CAN DO
  [  OK  ]  /lesson-aggregate  - cohort rollup
  [BLOCKED]  /preflight-analyze - grade written work
             blocked by: analyze_cfg, grounding
```

Everything below is just the fix list the doctor prints, with the reasoning attached. Re-run it
after each step; it never writes anything and never prints a credential's value.

---

## 1. Which path do you need?

**Ask which activity is the GRADED one.** That is the whole question, and it is a property of the
offering, not of the student.

| The graded activity is… | interactive (an artifact) | written questions |
|---|---|---|
| Who produces the per-student assessment | the artifact, at submit time | `/preflight-analyze`, afterwards |
| You need | **the light path** | **the full path** |
| Setup time | ~10 minutes | ~10 minutes + a 968 MB download |

This is the whole reason the two paths exist. The cohort rollup is *modality-blind*: it folds a
`schema: 1` assessment per student regardless of where it came from. When the artifact is the
graded activity that assessment already exists, so aggregation is all there is to do. When written
questions are, nothing has assessed anything yet and grading must run first — which is what needs
the service key and the textbook PDFs.

**An offering can carry both activities, and that does not mean the student picks.** The second one
is usually attached as `practice`, and **a practice activity can never be chosen for credit** — the
database enforces it. So seeing an interactive activity on the lesson tells you nothing about which
path you need. Read `grading_role`:

```sql
select act.modality, oa.grading_role, oa.is_visible
  from offering_activities oa
  join activities act on act.id = oa.activity_id
 where oa.assignment_offering_id = '<offering uuid>';
```

**Do not assume the light path is enough.** As of 2026-08-07 both phys-310 `lesson-01` and phys-110
`preflight-02` carry an interactive activity — and on both it is `practice`, with written questions
graded. All 10 and all 39 submissions are written accordingly. Across the whole system 29
interactive activities *are* the graded one (27 of them in phys-215), so the light path is real —
just not for the lessons closing this week.

---

## 2. The light path — aggregation only (~10 minutes)

Enough to run `/lesson-aggregate` on any lesson whose students are already assessed.

1. **Python 3.11+**, then the venv:
   ```
   python -m venv .venv
   .venv\Scripts\python -m pip install -r requirements.txt
   ```
   Never install these globally and never copy a `.venv` between machines.

2. **`supabase/admin/.env`** — ask the course director for it, out of band. Never by email
   attachment to a list, never pasted into a chat that logs. It carries the `prep_app_*` database
   roles. `supabase/admin/.env.template` shows the shape but not the values.

   The `PREP_DB_HOST` must be the **Session pooler** host (`aws-<n>-<region>.pooler.supabase.com`,
   port 5432). The direct `db.<ref>.supabase.co` host is IPv6-only and simply will not resolve —
   this is the single most common setup failure.

3. **Claude Code**, pointed at this repo. See the next section for why.

4. Confirm:
   ```
   python scripts/onboarding/prep_doctor.py
   .venv\Scripts\python supabase\admin\worklist_dayscope_test.py
   ```

---

## 3. You are not running a script — you are running a skill

**The aggregation is not a command that produces a rollup.** It is three steps, and the middle
one is an AI agent doing the actual work:

```
lesson_aggregate.py pull  ──▶  the model writes the prose  ──▶  write-analysis
      (dumps the cohort)        (readiness summary,              (validates + merges
                                 recommendation, quotes)          into analysis_reports)
```

So "being able to run the aggregation" means **having Claude Code working against this clone**,
with the repo's skills readable at `.ai/skills/`. A person with Python and the `.env` but no agent
can dump the data and can commit a file, and can do nothing in between.

The entry point is `/lesson-cycle`, which sequences grading and aggregation and adds the checks
that only make sense between them. Read `.ai/skills/lesson-cycle/SKILL.md` before the first live
run — the skill is the procedure, and this document only gets you to the point of being able to
follow it.

---

## 4. The full path — add grading

Needed for any lesson with written free-response questions.

1. **`~/.claude/skills/preflight-analyze/config.json`** — `/setup-preflight` walks it
   interactively. It holds the Supabase **service_role** key, which bypasses row-level security
   entirely. It lives outside the repo and stays there: never in a committed file, never in a URL
   or query string, never in `CHANGELOG.md`.

2. **The textbook PDFs** (~968 MB, gitignored) from Teams → Files → `Core_Preflights_PDFs`.

3. **Then point `textbook_base_path` somewhere that is not where you put them, and verify it.**
   This trips up every new machine. The manifest entries — and the `reference_pdf` strings on the
   live activities — all begin `Text_Book_PDFs/<NNN> Sections/`, so the base must be a directory
   *containing* a `Text_Book_PDFs/` tree. Point it at the clone's `textbook-pdfs/` and **nothing
   resolves**. `textbook-pdfs/README.md` gives two ways to satisfy this.

   ```
   python scripts/grounding/check_grounding.py
   ```

   **Run this, and read the number.** It is the one setup step whose failure is invisible
   afterwards: `/preflight-analyze` warns once and then grades the entire cohort with no textbook
   context. Expected as of 2026-08-07: **58 of 58**.

---

## 5. Rehearse before the deadline

The interesting states of a close-out only exist *after* a deadline, which makes the first live
run everybody's first look at the tool. It does not have to be:

```
.venv\Scripts\python supabase\admin\lesson_aggregate.py worklist --course phys-110 ^
    --as-of 2026-08-10T06:30Z
```

`--as-of` moves the clock **only** for "which tracks count as past due". Every figure it prints is
live, it writes nothing, and it prints a rehearsal banner so its output cannot be mistaken later
for an instruction to run. Use it to see exactly what Sunday will look like, on Friday.

---

## 6. Day tracks: the part that is easy to get wrong

A lesson closes **per day track**, and each track is separate work — its own grading pass, its own
section scopes. `worklist` lists one row per track:

```
lesson                 day due              sections       subs assessed  status
preflight-02             M 2026-08-10 05:59 M1A,M1C,M3A,M3   39        0  never analyzed
preflight-02             T 2026-08-10 05:59 T1A,T1B,T1C,T1   39        0  never analyzed
```

**Two tracks of one lesson do not always close on different days.** Whether they do is a
per-course habit, not a rule: phys-215 sets per-section deadlines on every offering and its tracks
close a day apart, while phys-110 sets them on almost none — so both its tracks land on the same
instant and the lesson is two runs back to back rather than two runs two days apart.

Run one track at a time either way, with `--day`. The whole-course `__all__` scope is written only
once every section has a scope, so it appears after the second track — and `status` showing
`__all__` as STALE between the two runs is the signal that the second pass is still owed, not a
fault.

---

## 7. More than one operator

There is **one production database and one live site**, and every write is visible to everyone
else immediately. Before any run:

- **Designate one operator per lesson.** Two people aggregating *different* lessons at once is
  fine — they write different rows. Two people on the *same* lesson is not.
- **Never run two agents in the same working tree.** Separate machines are separate trees and are
  fine; two agents in one clone will collide over git state and edits.
- **`git fetch` and confirm you have not diverged** from `origin/main` before starting. The cycle
  refuses to run on a dirty tree, deliberately.
- **Never force-push.**

Routine grade-and-aggregate runs record themselves in `app.analysis_runs` and do **not** need a
`CHANGELOG.md` entry — a term is roughly forty lessons closed out twice each, and hand-writing
eighty entries would bury what that file is read for. A schema change, bulk correction or one-off
repair still belongs there.

---

## 8. What "done" looks like

```
.venv\Scripts\python supabase\admin\lesson_aggregate.py status --lesson <slug> --day <M|T>
```

Every section in the track has a scope with a plausible `n`, no STALE flag on the sections you
just wrote, and `__all__` present once both tracks are in. Then open the lesson rollup in the site
and confirm the panels render — the rollup is what an instructor actually reads, and it is the
only check that covers the whole path.

---

## Reference

- [`MACHINE-SETUP.md`](MACHINE-SETUP.md) — full development parity, when you need it
- `.ai/skills/lesson-cycle/SKILL.md` — the procedure this document gets you ready to follow
- `.ai/instructions/CORE.md` §0 — the coordination gate, authoritative
- `docs/operations/SYSTEM_GUIDE.md` — the broader operating guide
