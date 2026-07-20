// account.js — data layer for the account page and the three password flows.
//
// Shared by student/account.html and faculty/account.html. Those two pages exist for the same
// reason help.html does (nav.js): every nav link is a bare filename, so a role-neutral page needs
// a copy in each role directory. The logic lives here once.
//
// ── THE PASSWORD MODEL ───────────────────────────────────────────────────────────
// Three flows, deliberately different in who learns the password:
//
//   A  change      the user knows the old one and picks the new one          (here)
//   B  reset       the user proves control of their mailbox with a code      (here + reset.html)
//   C  send reset  a director triggers B for someone else                    (edge function)
//   D  set         a system admin types a password for someone else          (edge function)
//
// A and B are the only ones a user can run for themselves, and are the only ones in this file.
// C is safe to delegate because the sender never learns the password. D is not, which is why it
// is system-admin-only AND flags the account — see mustChangePassword() below.
//
// Design record: site/app/PLAN-2026-07-20-ACCOUNTS.md

import { db } from './supabase.js';

/* ══════════════════════════════════════════════════════════════════════════════
 * Identity — what the account page shows, and why most of it is read-only
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * The identity rows for the signed-in user, as [label, value, why-not-editable] triples.
 *
 * Almost nothing here is editable, and that is the point: a name or a section that drifts
 * out from under a grade breaks the link between work and the person who did it. Identity is
 * owned by the roster and by staff assignments; this page reports it.
 */
export async function loadIdentity(ctx) {
  return ctx.role === 'faculty' ? facultyIdentity(ctx) : studentIdentity(ctx);
}

async function studentIdentity(ctx) {
  const sid = ctx.studentRow?.student_id;
  const rows = [
    ['Cadet ID', String(sid ?? '—'), 'Issued by the registrar. Not editable here.'],
    ['Sign-in email', ctx.user?.email || '—', 'Derived from your cadet ID.'],
  ];

  // One row per active enrolment. A student may hold several — that is the whole reason
  // enrollments exists as a table rather than a column on students.
  (ctx.enrollments || []).forEach(e => {
    const sec = e.sections;
    const o = sec?.course_offerings;
    if (!o) return;
    const label = `${o.courses?.title || o.courses?.code || 'Course'} · ${o.terms?.label || ''}`.trim();
    rows.push([label, `Section ${sec.code}`,
      'Set by your enrolment. Ask your instructor to move you.']);
  });

  if (!(ctx.enrollments || []).length) {
    rows.push(['Enrolment', '— none active —',
      'You are not enrolled in any section yet. Your instructor uploads the roster.']);
  }
  return { name: ctx.studentRow?.name || 'Student', rows, roleLabel: 'Student' };
}

async function facultyIdentity(ctx) {
  const instr = ctx.instructorRow;
  const rows = [['Sign-in email', ctx.user?.email || '—',
    'Contact a system admin to change the address you sign in with.']];

  if (instr?.is_global_admin) {
    rows.push(['System admin', 'Every course, in every term',
      'Implicit access — you hold no staff assignment rows and do not need any.']);
  }

  // Section-scoped staff rows carry a section_id but no code, so resolve the codes in one
  // query rather than one per row.
  const staff = ctx.staff || [];
  const sectionIds = [...new Set(staff.map(s => s.section_id).filter(Boolean))];
  let codeOf = {};
  if (sectionIds.length) {
    const { data } = await db.from('sections').select('id, code').in('id', sectionIds);
    codeOf = Object.fromEntries((data || []).map(s => [s.id, s.code]));
  }

  // Collapse to one row per offering: an offering-wide row wins, otherwise list the sections.
  const byOffering = new Map();
  staff.forEach(sa => {
    const o = sa.course_offerings;
    if (!o) return;
    const label = `${o.courses?.title || o.courses?.code || 'Course'} · ${o.terms?.label || ''}`.trim();
    const prev = byOffering.get(o.id) || { label, role: sa.role, wide: false, sections: [] };
    if (!sa.section_id) { prev.wide = true; }
    else if (codeOf[sa.section_id]) { prev.sections.push(codeOf[sa.section_id]); }
    // Strongest role wins when someone holds more than one row for the same offering.
    if (sa.role === 'director') prev.role = 'director';
    else if (sa.role === 'instructor' && prev.role === 'grader') prev.role = 'instructor';
    byOffering.set(o.id, prev);
  });

  const ROLE = { director: 'Director', instructor: 'Instructor', grader: 'Grader' };
  [...byOffering.values()].forEach(v => {
    const scope = v.wide ? 'all sections' : (v.sections.sort().join(', ') || 'no sections yet');
    rows.push([v.label, `${ROLE[v.role] || v.role} — ${scope}`, '']);
  });

  if (!byOffering.size && !instr?.is_global_admin) {
    rows.push(['Courses', '— none assigned —',
      'You hold no staff assignment. A course director adds you to an offering.']);
  }

  const roleLabel = instr?.is_global_admin ? 'System admin'
    : ctx.isDirectorForCurrent?.() ? 'Course director' : 'Instructor';
  return { name: instr?.name || 'Account', rows, roleLabel };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * A — change your own password
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Change the signed-in user's password, verifying the current one first.
 *
 * Supabase's updateUser() does NOT check the existing password — it trusts the session. That
 * means an unlocked, unattended browser is enough to take an account over. So we re-authenticate
 * with the typed current password before changing anything. A failed sign-in attempt does not
 * disturb the existing session, so a wrong guess is safe.
 */
export async function changePassword(email, currentPw, newPw) {
  const check = await db.auth.signInWithPassword({ email, password: currentPw });
  if (check.error) return { error: { message: 'That is not your current password.' } };

  const { error } = await db.auth.updateUser({ password: newPw });
  if (error) return { error };
  return { error: null };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * B — reset by emailed code (signed out)
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Send a recovery code. Always resolves as if it worked.
 *
 * Never reveal whether an address exists. Legacy did the opposite — site/index.html ran a second
 * query purely to say "ID not found" versus "incorrect password", which turned the login form
 * into a roster oracle and restated the default-password rule to an anonymous caller. The error
 * is swallowed on purpose; the caller shows one message either way.
 *
 * The email carries a SIX-DIGIT CODE, not a link, which requires the Supabase recovery template
 * to use {{ .Token }} rather than {{ .ConfirmationURL }}. Cadets read mail on a phone and act on
 * a lab desktop; a link only authenticates the device that opened it, and mail scanners that
 * pre-fetch links silently burn single-use tokens.
 */
export async function requestReset(email) {
  try { await db.auth.resetPasswordForEmail(email); } catch (_) { /* see above */ }
  return { error: null };
}

/** Exchange a recovery code for a session, then set the new password. */
export async function completeReset(email, code, newPw) {
  const { error: vErr } = await db.auth.verifyOtp({ email, token: code, type: 'recovery' });
  if (vErr) {
    return { error: { message: 'That code is not valid, or it has expired. Request a new one.' } };
  }
  const { error } = await db.auth.updateUser({ password: newPw });
  if (error) return { error };
  await clearMustChange();          // a self-service reset also satisfies a forced rotation
  return { error: null };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * D (read side) — forced rotation after an admin-set password
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Did an administrator set this password by hand?
 *
 * Stored on the auth user rather than in a table on purpose: schema `app` DDL is sealed
 * (prep_app_owner is NOLOGIN and unsealing is a coordinated human action under CORE.md §0),
 * while user_metadata is writable from the Admin API the edge function already holds. So this
 * costs no migration.
 *
 * The WRITE side belongs to the not-yet-built `set-password` edge function. Reading it here is
 * harmless until then — the flag is simply never set.
 */
export function mustChangePassword(user) {
  return user?.user_metadata?.must_change_password === true;
}

/** Clear the flag once the user has chosen their own password. */
export function clearMustChange() {
  return db.auth.updateUser({ data: { must_change_password: false } });
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Sessions & preferences
 * ════════════════════════════════════════════════════════════════════════════ */

/** Sign out of every device, not just this browser — for shared lab machines. */
export function signOutEverywhere() {
  return db.auth.signOut({ scope: 'global' });
}

/**
 * Preferences are browser-local by design.
 *
 * Both keys already exist and are already written by other parts of the app — the nav's theme
 * toggle owns cp.theme, and auth.js owns cp.currentOffering. This page does not invent storage;
 * it makes two settings that were only ever set as a side effect visible and resettable.
 */
export const PREF_KEYS = { theme: 'cp.theme', offering: 'cp.currentOffering' };

export function readPrefs() {
  const get = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  return { theme: get(PREF_KEYS.theme) || 'system', offering: get(PREF_KEYS.offering) || '' };
}

/** Password rules, in one place so the meter and the validator cannot disagree. */
export const MIN_PASSWORD = 8;

export function passwordProblem(pw, confirm) {
  if (!pw || pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (pw !== confirm) return 'The two passwords do not match.';
  return null;
}

/** 0–3, for the strength meter. Length dominates because it genuinely does. */
export function passwordStrength(pw) {
  if (!pw || pw.length < MIN_PASSWORD) return 0;
  if (pw.length >= 16) return 3;
  const varied = /[a-z]/.test(pw) && /[A-Z0-9]/.test(pw);
  return pw.length >= 12 || varied ? 2 : 1;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * View — rendered here, not in the page
 *
 * student/account.html and faculty/account.html are byte-identical shells apart from their
 * relative paths. Putting the markup in either one guarantees the two drift; the same reasoning
 * that put renderModel() in faculty-dashboard.js applies here.
 * ════════════════════════════════════════════════════════════════════════════ */

import { esc } from './util.js';
import { setTheme } from './theme.js';

export async function renderAccount(ctx, root) {
  const id = await loadIdentity(ctx);
  const prefs = readPrefs();
  const isFaculty = ctx.role === 'faculty';
  const sel = (v, want) => (v === want ? ' selected' : '');

  root.innerHTML = `
    <div class="page-head"><h1>Account</h1>
      <div class="sub">${esc(id.name)} · ${esc(id.roleLabel)}</div></div>

    <div class="card">
      <div class="card-title">Who you are</div>
      <div class="card-meta">Identity comes from the roster and your course assignments, so most of it
        is not editable here — that is what keeps work attached to the right person.</div>
      ${id.rows.map(([k, v, why]) => `<div class="acct-row">
        <span class="k">${esc(k)}</span>
        <span class="v">${esc(v)}${why ? `<span class="why">${esc(why)}</span>` : ''}</span>
      </div>`).join('')}
    </div>

    <div class="card">
      <div class="card-title">Change password</div>
      <div class="card-meta">You stay signed in here. Other devices are signed out.</div>
      <div class="field"><label for="pw-cur">Current password</label>
        <input type="password" id="pw-cur" autocomplete="current-password"></div>
      <div class="field"><label for="pw-new">New password</label>
        <input type="password" id="pw-new" autocomplete="new-password">
        <div class="pwbar" id="pwbar"><span></span></div>
        <div class="field-hint">At least ${MIN_PASSWORD} characters. Longer beats complicated.</div></div>
      <div class="field"><label for="pw-cf">Confirm new password</label>
        <input type="password" id="pw-cf" autocomplete="new-password"></div>
      <div class="row wrap" style="gap:10px">
        <button class="btn btn-primary" id="pw-save">Update password</button>
        <span id="pw-status" style="font-size:0.85em"></span>
      </div>
      <div class="muted" style="font-size:0.82em;margin-top:10px">Forgot your current one?
        <a href="../reset.html">Reset it by email</a>.</div>
    </div>

    <div class="card">
      <div class="card-title">Preferences</div>
      <div class="card-meta">Saved to this browser only — they do not follow you to another device.</div>
      <div class="field"><label for="pf-theme">Appearance</label>
        <select id="pf-theme">
          <option value="system"${sel(prefs.theme, 'system')}>Match my system</option>
          <option value="light"${sel(prefs.theme, 'light')}>Light</option>
          <option value="dark"${sel(prefs.theme, 'dark')}>Dark</option>
        </select>
        <div class="field-hint">Applies immediately.</div></div>
      ${isFaculty && ctx.courses.length > 1 ? `
      <div class="field"><label for="pf-offering">Course on sign-in</label>
        <select id="pf-offering">
          ${ctx.courses.map(c => `<option value="${esc(c.offeringId)}"${sel(ctx.currentOffering, c.offeringId)}>${esc(ctx.courseTitleOf(c.offeringId))} · ${esc(c.termLabel || '')}</option>`).join('')}
        </select>
        <div class="field-hint">Remembered from your last visit today; setting it here makes it
          deliberate instead of a surprise.</div></div>` : ''}
    </div>

    <div class="card">
      <div class="card-title">Sessions</div>
      <div class="card-meta">If you signed in on a shared or lab machine and forgot to sign out.</div>
      <div class="row wrap" style="gap:10px">
        <button class="btn btn-secondary" id="so-all">Sign out everywhere</button>
        <span id="so-status" style="font-size:0.85em"></span>
      </div>
    </div>`;

  wireAccount(ctx, root);
}

function wireAccount(ctx, root) {
  const $ = (id) => root.querySelector('#' + id);

  // Live strength meter
  const pwNew = $('pw-new'), bar = $('pwbar');
  pwNew?.addEventListener('input', () => {
    const s = passwordStrength(pwNew.value);
    bar.className = 'pwbar' + (s >= 3 ? ' s3' : s === 2 ? ' s2' : s === 1 ? ' s1' : '');
  });

  $('pw-save')?.addEventListener('click', async () => {
    const status = $('pw-status'), btn = $('pw-save');
    const cur = $('pw-cur').value, next = pwNew.value, cf = $('pw-cf').value;
    const problem = passwordProblem(next, cf);
    if (!cur) { status.style.color = 'var(--red)'; status.textContent = 'Enter your current password.'; return; }
    if (problem) { status.style.color = 'var(--red)'; status.textContent = problem; return; }

    btn.disabled = true; status.style.color = 'var(--muted)'; status.textContent = 'Updating…';
    const { error } = await changePassword(ctx.user.email, cur, next);
    btn.disabled = false;
    if (error) { status.style.color = 'var(--red)'; status.textContent = '⚠ ' + error.message; return; }
    await clearMustChange();
    status.style.color = 'var(--green)'; status.textContent = '✓ Password updated';
    $('pw-cur').value = pwNew.value = $('pw-cf').value = '';
    bar.className = 'pwbar';
  });

  $('pf-theme')?.addEventListener('change', (e) => setTheme(e.target.value));

  $('pf-offering')?.addEventListener('change', async (e) => {
    await ctx.setCurrentOffering(e.target.value);
  });

  $('so-all')?.addEventListener('click', async () => {
    const status = $('so-status');
    status.style.color = 'var(--muted)'; status.textContent = 'Signing out…';
    await signOutEverywhere();
    location.replace('../login.html');
  });
}
