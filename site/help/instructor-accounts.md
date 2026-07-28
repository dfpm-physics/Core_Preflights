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

## Why you cannot choose a password for anyone

There is no field to type one, anywhere, by design — for cadets and for staff alike. Somebody who
knows another person's password holds a working credential for that account, and at the database
level a session opened with it is indistinguishable from theirs. Every submission, every honor
statement, every grade appeal — and for a staff account, every grade published — would be too.

Resetting to the derived default avoids that entirely. You learn nothing you did not already know
(a cadet ID on the roster, a surname on the staff list), and the account is forced onto a password
only its owner knows at the next sign-in. Deriving is safe precisely because choosing is not.

## Signing in, for cadets

Their username is the **email address on their roster row**, typed in full. Cadets whose accounts
were created before 21 July 2026 still sign in with the older `<cadet ID>@usafa.edu` address —
that mailbox does not receive mail and never did, which is exactly why password recovery happens
in person now.

A cadet can change their own password any time from **Account**. Encourage it: everyone starts on
the same predictable default, so until they change it, it is not really private.

## If you are the one locked out

**Ask your course director**, who resets staff accounts from **Admin → Staff → Reset password**.
It works exactly like the cadet one: it restores your default and nothing else, and PREP forces you
to pick a new password before you can do anything.

**A staff default is your last name followed by `1234`** — `doe1234` for Jane Doe, lowercase. A
hyphenated or two-part surname uses the first part only: Jane Smith-Jones gets `smith1234`.

The same is true of a brand-new account: whoever adds you does not type a password, and cannot.
You are created on that default and made to replace it the first time you sign in.

*(Corrected 2026-07-27. This said instructor accounts had no default to restore, so recovery meant
a system admin in the Supabase dashboard. That was true while the only derivable default was a
cadet ID; staff now have one from their name, which is what made a delegated reset safe.)*

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

**Logins are created for you.** As of 2026-07-27 the import provisions every new cadet the moment it
lands, and reports how many logins it made. **Provision accounts** is still on the tab and is still
worth knowing: a cadet with no email address on file is *skipped*, not given a fabricated one, so
after adding the missing address you use that button to finish the job.

**Move** and **Remove** on each row handle the rest of add/drop — moving a cadet between sections
carries their submissions and grades with them, because those hang off the enrollment rather than
the section.

## Adding one cadet

The import is for a registrar export; **+ Add student** on the same tab is for the cadet who
transfers in during week three.

Start by searching. If they are already in PREP — usually because they are in your other course —
select them and they are enrolled with the record they already have. **Nothing about the person
changes**, which is the point: their name, address and squadron stay as they are, and you only add
them to a section here. Use the roster import if a detail actually needs correcting.

If the search finds nobody, fill in the cadet ID, name, email and section and they are created.
Either way the login is provisioned straight away.

### Does adding an existing cadet create a second record?

**No — it merges.** A cadet is one record, keyed on their cadet ID, and being in a course is a
separate thing attached to it. So somebody taking both Physics 110 and Physics 215 is *one* cadet
with *two* enrolments, and their work in each course is attached to the right one. Adding them to a
second course adds the enrolment and leaves the person alone.

This holds even when the search cannot see them. It only finds cadets from courses you staff, so a
cadet who has only ever taken somebody else's class comes back empty — type their cadet ID into the
fields anyway and it still merges onto the record they already have, because the ID is what
identifies them.
