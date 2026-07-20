# Accounts & passwords — design (2026-07-20)

**Status:** Proposed. Mocked, not built.

*Authored 2026-07-20 by Matthew Recker (via Claude). Companion to
[`PLAN-2026-07-16-ADMIN.md`](PLAN-2026-07-16-ADMIN.md) (whose Tier 3 deferred this) and
[`COURSE-ADMIN-INVENTORY.md`](COURSE-ADMIN-INVENTORY.md). Backlog of everything this plan does **not**
take on: [`LEGACY-AUDIT-2026-07-20.md`](LEGACY-AUDIT-2026-07-20.md). Mocks:
[`tests/browser/test-account.html`](../../tests/browser/test-account.html) and the Staff/People tabs of
[`tests/browser/test-admin.html`](../../tests/browser/test-admin.html).*

---

## 1. Why now

`PLAN-2026-07-16-ADMIN.md` Tier 3 deferred all password work on the grounds that it "needs a new edge
function under `supabase/functions/`, which is outside this plan's file boundary." That reasoning held
for *admin* password operations. It quietly swept up two things it should not have:

1. **Self-service change-password already exists and works in legacy**
   (`site/admin.html:2411-2441`) — `db.auth.updateUser({ password })`, no backend, no edge function.
   It is in neither `COURSE-ADMIN-INVENTORY.md` nor the port plan, so **promotion deletes it**.
2. **There is no account page at all** in either generation. Preferences that already exist
   (`cp.theme`, `cp.currentOffering`) are set by side effect — a theme toggle in the nav, a course pill
   you happened to click last — and can be neither seen nor reset.

The deadline pressure is real: provisioning sets every cadet password to the last six digits of their
ID, and today **nothing in the app lets them change it**. That default is shared knowledge in a
squadron.

## 2. What is being added

| # | Surface | Who | Mechanism |
|---|---|---|---|
| A | **Account page** — identity, change password, preferences, sign out everywhere | everyone | `account.html`, reached from the user dropdown |
| B | **Self-service reset** — "forgot password", six-digit code by email | everyone, signed out | Supabase recovery OTP |
| C | **Send reset email** — trigger B for someone else | **director and up** | edge function |
| D | **Set password** — assign one by hand, forced replacement at next sign-in | **system admin only** | edge function + Admin API |

The split between C and D is the whole design. **C is safe to delegate because the person who
triggers it never learns the password** — the user still chooses it from the emailed code. **D is not
delegable**, because the administrator necessarily knows the password they typed. So D is restricted
to system admins *and* the resulting password is treated as compromised from birth: the account is
flagged, and the user must replace it before reaching any page.

Rejected: giving directors the D power "because they'll need it for their own sections." A course
director resetting a cadet's password by hand and reading it out is indistinguishable, at the
database level, from a director signing in as that cadet. The emailed-code path (C) covers the real
need without creating that ambiguity.

Also rejected: **security questions** ("mother's maiden name"). They are a second, weaker password
that cannot be rotated, and for a cohort this homogeneous the answers are largely guessable from
public roster data.

## 3. Mechanism, concretely

**A — change password.** `db.auth.updateUser({ password })`. Note that Supabase does **not** verify
the current password on this call. The mock shows a "current password" field anyway and the
implementation should honour it by re-authenticating first
(`signInWithPassword` with the typed current password, then `updateUser`) — otherwise anyone with a
borrowed unlocked laptop changes the password without knowing the old one.

**B — reset by code.** `db.auth.resetPasswordForEmail(email)` sends the recovery mail; the template is
switched from `{{ .ConfirmationURL }}` to `{{ .Token }}` so it carries a **six-digit code rather than
a link**. Verification is `db.auth.verifyOtp({ email, token, type: 'recovery' })`, then
`updateUser({ password })`.

> A code, not a link, on purpose. Cadets read this mail on a phone and act on a lab desktop; a
> magic link only authenticates the device that opened it. A code crosses devices. It also survives
> mail scanners that pre-fetch links and silently consume single-use tokens.

The request screen always reports success, whether or not the address exists. Legacy did the
opposite: `site/index.html:197-212` runs a second query purely to say "ID not found" vs. "incorrect
password" — an enumeration oracle that also restates the default-password rule to an anonymous caller.
**Do not port that behaviour.**

**C — send reset email.** New edge function `reset-password`, verifying the caller is a director of an
offering the target belongs to (or a global admin) before calling `resetPasswordForEmail`. It must be
an edge function rather than a direct client call so it can be rate-limited and attributed; the
Supabase endpoint itself is public and unauthenticated.

**D — set password.** Same edge function or a sibling, calling
`auth.admin.updateUserById(id, { password })` under the service role, gated on `is_global_admin`
exactly as `create-instructor` now gates the `system_admin` role.

**The forced-rotation flag.** Store it as `user_metadata.must_change_password` on the auth user, set
by D and cleared when the user sets their own. This deliberately avoids a table column: schema `app`
DDL is sealed (`prep_app_owner` is `NOLOGIN`; a change means a human unsealing it under CORE.md §0),
and `user_metadata` is writable from the Admin API the edge function already uses. **No migration
required.** `bootstrap()` in `js/auth.js` reads the flag and redirects to `account.html` before
resolving anything else; the interstitial renders with no nav and no dismiss.

## 4. What could go wrong

- **`@usafa.edu` mail may not deliver.** Everything in B and C rests on it, and it has never been
  tested. **Verify deliverability to a real cadet address before building C.** If it fails, D is not a
  fallback — it is the only path, and the plan's shape changes.
- **Rate limiting.** Supabase's default recovery limits are modest; a director resetting a whole
  section one at a time can trip them. Measure before promising bulk behaviour.
- **`user_metadata` is user-writable in some configurations.** Confirm that the anon client cannot
  clear `must_change_password` itself; if it can, the flag moves to `app_metadata`, which is
  service-role-only.

## 5. How we would know this was wrong

- **Signal:** password-related requests to the course director *rise* after launch instead of falling.
- **Threshold:** more than ~5% of the cohort needing D (admin-set) in the first two weeks.
- **Then:** email delivery is not working for cadets and B/C are theatre. Fall back to a printed
  one-time code issued at the first class meeting, and reopen the "is email the right channel"
  question rather than adding more UI.

## 6. Open, deliberately

- **Which preferences are real.** The mock shows appearance and default course because those already
  exist as localStorage keys. Anything else (notification settings, density, default section filter)
  is invention until someone asks for it.
- **Can a student change their display name?** Currently it comes from the roster CSV. Letting it
  drift breaks the name a grader recognises.
- **Should "sign out everywhere" exist?** Mocked because shared lab machines are real here, but it
  needs `auth.signOut({ scope: 'global' })` and has no precedent in the app.
