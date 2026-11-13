# The public test site

A copy of the PREP site that people can try before anything goes live. It shows the **staging**
database and nothing else, and everything in it is invented.

| | |
|---|---|
| Address | `https://dfpm-physics.github.io/iPREP-staging/site/` |
| Repository | `dfpm-physics/iPREP-staging` (public), branch `main`, Pages from the root |
| Database | staging, Supabase project `wkibeptktbnaddfynrwr`. Never production |
| Data | invented people and lessons only. **Never put real cadet data in staging** |
| Built by | `scripts/staging/publish_test_site.py` in `dfpm-physics/Core_Preflights` |
| Fed by | the operator, by running this publisher by hand. The tester-feedback job (`scripts/staging/feedback_job.py`) never publishes and never commits: nothing lands unattended, and every fix is a proposal the operator approves before any commit (course director's decision, 2026-11-13). The job checks an AI's edits and writes each passing fix into its own uncommitted git worktree, with a risk hint (`text` or `code`) in `held.json`; the operator reviews the worktree, commits it to this repository, and then publishes. The job never runs git in the tree the AI edited. |

The repository is generated. Nobody edits it by hand; the next publish replaces its files.

## Security note: read this before sharing the address

The sign-in rules below are the site's own, and they are public. Anyone who finds the address can sign
in to staging as any role, including global admin. That is acceptable only because staging holds
invented data. **If a real name, a real cadet ID or a real answer ever reaches staging, the test site
is a leak.** Do not seed such data, and do not ask testers to enter it.

## Logins

Every address ends in `@prep-staging.example`. Passwords follow the site's own rules and are not
written here: **staff** use the last name in lower case followed by `1234`; **cadets** use the last six
digits of the cadet ID. No account is forced to change its password, so a tester goes straight in.
The names are in the header of each seed script.

| Role | Address | Sees |
|---|---|---|
| Global admin | `admin@` | every course below |
| Director | `director@` | Physics 215 (STAGING TEST) |
| Instructor | `instructor@` | Physics 215, section M1A only |
| Director of another course | `otherdirector@` | Physics 110 (STAGING TEST) only |
| Training director | `trainingdirector@` | the PREP Training Course, both sections |
| Training instructor | `traininginstructor@` | the PREP Training Course, both sections |
| Cadet | `cadet101@` to `cadet103@` | Physics 215, section M1A |
| Cadet | `cadet104@`, `cadet106@` | Physics 215, section T3A |
| Cadet | `cadet105@` | two classes: Physics 215 (T3A) and Physics 120 (S1). Shows the "All classes" page |
| Cadet | `cadet201@` | Physics 110 only |
| Cadet | `cadet321@` | Physics 310 only, a course with no day tracks |
| Cadet | `cadet1101@` to `cadet1103@` | the PREP Training Course, section TR-M |
| Cadet | `cadet1104@` to `cadet1106@` | the PREP Training Course, section TR-T |

Testers who just want to play should use the **PREP Training Course** accounts. The Physics 215, 110,
120 and 310 data exists for the test suites and is rewritten whenever `seed_staging.py` is re-run;
`cadet999@` (3009999999) belongs to the suites and should be left alone.

## What the training course holds

Course `prep-train`, one active offering in term `training-sandbox`, sections `TR-M` and `TR-T`, six
cadets, and four written preflights: one past due (five cadets submitted, four graded, one waiting for
review), two open, and one draft. Deadlines are set around the day the seed was last run.

## Publishing

1. Make sure what you want shown is committed on this repository, since the copy is stamped with the
   short commit id of `HEAD`. The tool warns about uncommitted changes under `site/` and refuses to
   publish them without `--allow-dirty`.
2. Keep a local clone of `dfpm-physics/iPREP-staging` on branch `main`, outside this repository. The clone is a generated, disposable copy: `--commit` resets it to `origin/main`, and a dirty clone or one with local commits is refused.
3. Look first. This builds, verifies, and prints how many files would be added, changed and removed:

   ```
   python scripts/staging/publish_test_site.py --repo <path to the clone>
   ```
   The change count compares the build with `origin/main` (unpacked to a temporary folder; the clone is not touched) and prints how many commits the clone's HEAD is behind it.
4. Publish. This replaces the clone's files, commits "Publish test site from Core_Preflights <sha>"
   and pushes `origin main`. It never force-pushes:

   ```
   python scripts/staging/publish_test_site.py --repo <path to the clone> --commit
   ```

   GitHub Pages rebuilds in a minute or two.

To inspect a build without a clone: `python scripts/staging/publish_test_site.py --out <new empty
directory outside the repository>`.

### What the build changes

It copies `site/` only, and rewrites each text file the way `serve_local.py` does while serving: the
production Supabase address and key become staging's, and the live site address becomes the test
site's. Every Content-Security-Policy that allowed `*.supabase.co` is narrowed to the staging host, so
the browser itself refuses production. It then checks that no output file holds the production project
reference, the production key or `github.io/Core_Preflights`, and stops with a non-zero exit, naming
files and never contents, if one does. `site/js/config.js` already chooses staging for this address.

## Same browser origin as the live site

The test site is served from `dfpm-physics.github.io`, which is also the live site's origin (the paths
differ: `/iPREP-staging/` and `/Core_Preflights/`). Browser storage is shared by origin, so do not sign
in to both in the same browser profile: use a separate profile for the test site until it moves to its
own domain.

## Re-seeding

Deadlines are set around the day a seed ran, so after a few days work becomes past due. Run both seeds
again to move them. Each is a dry run unless `--commit` is given, and each is safe to re-run. From the
repository root, with the staging variables set: set the staging environment variables (`STAGING_DB_URL` and the `STAGING_APP_*_PASSWORD` names) in the command's own environment from the operator's local secret store, and never print them:

```
<python of the repo venv> scripts/staging/seed_test_site.py --expect-ref wkibeptktbnaddfynrwr
<python of the repo venv> scripts/staging/seed_staging.py --expect-ref wkibeptktbnaddfynrwr
```

Read the plan, then add `--commit` to write.

The sandbox cadets are 3000001101 to 3000001106. An earlier version of the seed used 3000000801 to
3000000806, a block the roster walkthrough owns and wipes. A staging database that ran that version
still holds those six in the sandbox offering; `scripts/staging/clean_test_site_old_cadets.py` removes
only them (dry run by default). Before `--commit` it writes a snapshot of every row the delete removes, found by walking the live foreign keys recursively (cascade children, plus rows that would block the delete or be set to null), re-reads the snapshot from disk and checks each file's count against a live `count(*)`, and refuses on any mismatch, any blocking row, a walk cut by its depth cap, or a plan that changed after the rows were locked. Not snapshotted: rows removed by triggers, Storage objects; `auth.users` files omit password and token columns. These are machine-specific paths; another machine needs
its own way of supplying `STAGING_DB_URL`.

## What does not work on the test site

- **The AI proxies.** The GenAI and Ask Sage proxy functions are not deployed on staging, on purpose,
  so a lesson page that calls one fails there.
- **A real claude.ai lesson still submits to production.** Its submit address is baked into the
  published artifact, which the test site cannot rewrite. A tester must never open a real lesson link
  from the test site. Only the generated copies under `site/gemini/` are redirected.
- **Email.** PREP has no email on either project, so nothing is sent and there is no password reset
  by email. A director restores a default password from Course Admin.
- **Anything that needs production data**, such as the real roster or real grades. That is the point.
