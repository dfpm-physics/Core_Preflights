## The short version

A cadet who cannot sign in has one remedy: **a course director resets them to the default, from
Course Admin → Students.** PREP has no mail server, so there is no reset link to send and no code
to wait for.

Nobody sees or chooses their password. Resetting puts it back to the last six digits of their
cadet ID — a value already printed on the roster — and PREP then forces them to pick a new one
before they can do anything else.

## Resetting a student's password

1. Open **Admin** → the **Students** tab.
2. Find the cadet — the search box matches name, cadet ID, squadron or section.
3. Select **Reset password**, and confirm.

Tell them their password is back to the last six digits of their cadet ID. Say it in person rather
than emailing it: for the few minutes before they sign in, that value is a working credential.

The button only appears for cadets who already have an account. If it is missing, they have not
been provisioned yet — the **Auth** column reads `—` rather than `✓`, and **Provision accounts** on
the same tab creates the logins.

**This is a course-director action.** The underlying `reset-student-password` function would accept
any staff member of the offering — it derives the password from a cadet ID you are already looking
at, so it reveals nothing — but the only page carrying the button has always been director-only, so
in practice an instructor asks their director. If that turns out to make lockouts last a day, the
fix is to expose the Students tab read-only to instructors, not to hand out a password field.

## Why you cannot choose a password for them

There is no field to type one, anywhere, by design. An instructor who knows a cadet's password
holds a working credential for that account — and at the database level, a session opened with it
is indistinguishable from the cadet's own. Every submission, every honor statement, and every
grade appeal made under it would be too.

Resetting to the derived default avoids that entirely: you learn nothing you did not already know
from the roster, and the cadet replaces it at their next sign-in.

## Signing in, for cadets

Their username is the **email address on their roster row**, typed in full. Cadets whose accounts
were created before 21 July 2026 still sign in with the older `<cadet ID>@usafa.edu` address —
that mailbox does not receive mail and never did, which is exactly why password recovery happens
in person now.

A cadet can change their own password any time from **Account**. Encourage it: everyone starts on
the same predictable default, so until they change it, it is not really private.

## If you are the one locked out

Instructor accounts have no cadet ID, so there is no default to restore and no equivalent button.
Ask a system admin, who resets staff accounts from the Supabase dashboard.

## Importing a roster

**Admin → Students**, in the collapsed **Import the registrar's roster** panel below the student
table. A course-director action.

Use the registrar's export as-is — save it as CSV (or tab-separated text) and drop it on that
panel. It must contain **Cadet EMPLID**, **Cadet Name**, **Email**, **Cadet Squadron**, and
**Section**; Term, Subject, Course Number, majors, sex, and advisor are picked up when present and
everything else is ignored.

Two things the upload does that are worth knowing:

- **Rows for other courses are filtered out** by subject and course number, and it shows you which
  ones and why rather than dropping them silently.
- **Cadets you already have are flagged for review.** For each, you choose whether to keep the
  record you have or take the file's version, field by field. The default is to keep what you
  have — a stale export should not quietly overwrite a correction somebody made by hand.

If the file names a section that does not exist yet, the preview offers to create it and re-check.
A section created this way has its meeting days filled in from its code — `M1A` becomes an M-day
section, `T3B` a T-day one — so its deadlines are right immediately. That is a starting value you
can change, not a rule the system keeps applying: **if a section's code does not start with the day
it meets, open it and correct the meeting days**, or it will fall back to each assignment's default
deadline instead of its own day's.

Once the import lands, **Provision accounts** on the same tab creates a login for every enrolled
cadet who does not have one, with the default password already set. **Move** and **Remove** on each
row handle the rest of add/drop — moving a cadet between sections carries their submissions and
grades with them, because those hang off the enrollment rather than the section.
