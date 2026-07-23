## The short version

A cadet who cannot sign in has one remedy: **you reset them to the default from the Roster page.**
PREP has no mail server, so there is no reset link to send and no code to wait for.

You never see or choose their password. Resetting puts it back to the last six digits of their
cadet ID — a value already printed on your roster — and PREP then forces them to pick a new one
before they can do anything else.

## Resetting a student's password

1. Open **Roster**.
2. Find the cadet and select **Reset password**.
3. Confirm.

Tell them their password is back to the last six digits of their cadet ID. Say it in person rather
than emailing it: for the few minutes before they sign in, that value is a working credential.

The button only appears for cadets who already have an account. If it is missing, they have not
been provisioned yet — that is your course director's **Enrollment** page, not yours. Roster tells
you which cadets are in that state: the **Auth** column reads `—` rather than `✓`.

**Any instructor assigned to the course can do this**, not just the course director. That is
deliberate: the cadet is standing in front of whoever teaches their section, and sending them
away for a button that reveals nothing would just make the lockout last a day.

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

## Uploading a roster

**This is on the Enrollment page, and it is a course-director action** — Roster itself is read-only
for everyone. The two were one page until 23 July 2026, which is why Roster used to be closed to
instructors: you cannot hand somebody a lookup table whose first card overwrites the roster.

Use the registrar's export as-is — save it as CSV (or tab-separated text) and drop it on the
Enrollment page. It must contain **Cadet EMPLID**, **Cadet Name**, **Email**, **Cadet Squadron**,
and **Section**; Term, Subject, Course Number, majors, sex, and advisor are picked up when present
and everything else is ignored.

Two things the upload does that are worth knowing:

- **Rows for other courses are filtered out** by subject and course number, and it shows you which
  ones and why rather than dropping them silently.
- **Cadets you already have are flagged for review.** For each, you choose whether to keep the
  record you have or take the file's version, field by field. The default is to keep what you
  have — a stale export should not quietly overwrite a correction somebody made by hand.

If the file names a section that does not exist yet, the preview offers to create it and re-check.

Once the import lands, **Provision accounts** on the same page creates a login for every enrolled
cadet who does not have one, with the default password already set.
