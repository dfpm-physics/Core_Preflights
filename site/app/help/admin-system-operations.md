> **Starter stub.** The operational detail lives in `docs/operations/SYSTEM_GUIDE.md`; this page is
> the orientation layer over it. Expand as procedures settle.

## Start of semester

**Unpause Supabase first.** The project sits on the free tier and pauses after roughly a week
of inactivity — a paused database looks exactly like a broken site. Unpause it from the Supabase
dashboard before students arrive.

Then: roster import, section creation, section→instructor assignment, and student account
provisioning (bulk-creates auth accounts for everyone in the course who lacks one — it runs
serially and reports per-student failures rather than aborting).

**Provisioning depends on the roster carrying real email addresses.** A cadet's login is the
address on their roster row, taken from the registrar's export; anyone imported without one is
skipped rather than given a fabricated address, and the count is reported back. New accounts start
on the last six digits of the cadet ID and are forced to change it at first sign-in. There is no
password reset by email anywhere in PREP — see
[Student accounts and passwords](help.html?doc=accounts).

## Deploys

The site is static, served by GitHub Pages from `main`. **Pushing to `main` changes the production
site** after a one-to-two minute rebuild. Editing a file locally changes nothing until it is
committed *and* pushed. There is no build step, and the site itself has no Node dependency — do not
add one. (Optional developer tooling may use Node locally; nothing on the deploy path may need it.)

## Migrations

SQL lives in `supabase/migrations/`, numbered. **Adding a migration file is not applying it.**
Applying one is coordinated in advance — never two at once, and never while another operator is
mid-run — and recorded in `CHANGELOG.md`.

## Frozen contracts

Two URLs may not move: the endpoint an interactive lesson posts its report to, and the authoring
page that AI-generated prefill links target. Both are currently stubs forwarding into the app and
become the real pages at promotion, so the public URL survives unchanged. Changing either means
rebuilding every deployed lesson artifact by hand — a between-semesters operation, never mid-term.

Multi-term work must be additive: new columns, not changed wire formats.

## Secrets

The service key bypasses row-level security. It belongs in a gitignored local config file and
nowhere else — not in a committed file, not in a URL or query string, not in the changelog. The
anon key in the site config is public on purpose and protected by RLS.

## The changelog is not a lock

It is an audit trail. Before mutating live data or pushing to `main`: designate one operator,
confirm nobody else is mid-run, fetch and confirm your branch has not diverged, and never
force-push. Two agents must never share one working tree.

## Reference

- `docs/operations/SYSTEM_GUIDE.md` — the operating guide
- `.ai/instructions/CORE.md` — the operating contract, authoritative
- `.ai/instructions/PROJECT.md` — architecture, roles, and the full data model
