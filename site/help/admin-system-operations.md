> **Starter stub.** The operational detail lives in `docs/operations/SYSTEM_GUIDE.md`; this page is
> the orientation layer over it. Expand as procedures settle.

## Start of semester

**Unpause Supabase first.** The project sits on the free tier and pauses after roughly a week
of inactivity — a paused database looks exactly like a broken site. Unpause it from the Supabase
dashboard before students arrive.

Then, in order: **roster import** and **section→instructor assignment**. **Student account
provisioning runs by itself** as of 2026-07-27 — the import creates a login for every new cadet and
reports how many. The **Provision accounts** button is still there and still matters: it is how you
finish the job after supplying an address for anyone the import had to skip (below). It
bulk-creates auth accounts for everyone in the course who lacks one, runs serially, and reports
per-student failures rather than aborting.

**Sections are normally created by the import**, from the section codes the roster file references,
which is why the import comes first. On a first import into a brand-new course that is *every*
section in the file: the preview lists them and offers **Create these sections and re-check** in one
click, then imports the rows against them.

For a section that appears later, **Admin → Staff → Section coverage → + Add section** creates one
at a time. There is still no rename or retire control.

*(Corrected 2026-07-28. This said sections could not be created on their own and that the import was
the only route — while the import, on an offering with no sections at all, skipped its own
unknown-section check and then refused to commit. A new course could not be populated by either
path. Both work now.)*

A section made this way also gets its **meeting days** filled in from its code, so its deadlines are
correct straight away — `M1A` is an M-day section, `T3B` a T-day one. It is a starting value stored
on the section, not a rule applied on every read, so a code that does not begin with the day it
meets needs correcting once; left wrong, that section falls back to each assignment's default
deadline rather than its own day's.

**Provisioning depends on the roster carrying real email addresses.** A cadet's login is the
address on their roster row, taken from the registrar's export; anyone imported without one is
skipped rather than given a fabricated address, and the count is reported back. New accounts start
on the last six digits of the cadet ID and are forced to change it at first sign-in.

**Staff accounts work the same way** (2026-07-27): a new instructor is created on a derived default
— their last name plus `1234` — is forced to replace it before PREP will do anything, and can be
put back on it by a course director from **Admin → Staff**. Nobody types or is shown a password at
any point, for either role. There is no password reset by email anywhere in PREP — see
[Student accounts and passwords](help.html?doc=accounts).

## Deploys

The site is static, served by GitHub Pages from `main`. **Pushing to `main` changes the production
site** after a one-to-two minute rebuild. Editing a file locally changes nothing until it is
committed *and* pushed. There is no build step, and the site itself has no Node dependency — do not
add one. (Optional developer tooling may use Node locally; nothing on the deploy path may need it.)

## Migrations

**There are two chains, numbered independently, and they must not be interleaved.**
`supabase/migrations/*.sql` is the chain for the original schema; `supabase/migrations/app/*.sql` is
the chain for the PREP v2 schema. A `014` in one has nothing to do with a `014` in the other.

**Adding a migration file is not applying it.** Applying one is coordinated in advance — never two
at once, and never while another operator is mid-run — and recorded in `CHANGELOG.md`.

Applying anything in the v2 chain needs one extra step: the role that owns that schema is
deliberately left unable to log in, so a schema change there starts with a person re-enabling it and
ends with them sealing it again. That is intentional friction, not an obstacle to route around.

## Frozen contracts

Two URLs may not move: the endpoint an interactive lesson posts its report to, and the authoring
page that AI-generated prefill links target. Both were forwarding stubs until the site redesign was
promoted onto the public URLs on 2026-07-28; each is now the real page, at the identical address,
which is what the stubs existed to guarantee. Changing either means rebuilding every deployed lesson
artifact by hand — a between-semesters operation, never mid-term.

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
