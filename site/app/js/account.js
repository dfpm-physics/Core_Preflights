// account.js — data layer for the account page and the three password flows.
//
// Shared by student/account.html and faculty/account.html. Those two pages exist for the same
// reason help.html does (nav.js): every nav link is a bare filename, so a role-neutral page needs
// a copy in each role directory. The logic lives here once.
//
// ── THE PASSWORD MODEL ───────────────────────────────────────────────────────────
// Two flows, and the absence of a third is the design:
//
//   A  change         the user knows the old one and picks the new one    (here)
//   B  reset-to-default  a staff member restores the default for someone  (reset-student-password)
//
// THERE IS NO EMAIL RECOVERY, AND THERE CANNOT BE ONE. PREP has no SMTP, and until 2026-07-21
// every cadet's address was FABRICATED by the provisioning script as <cadet_id>@usafa.edu — a
// string no mail server has ever accepted. The reset-by-emailed-code flow that used to live in
// this file (requestReset/completeReset + reset.html) was therefore complete, tested, and
// incapable of recovering a single account. It was removed rather than left in place, because a
// recovery path that looks like it works is worse than none: a locked-out cadet follows it,
// waits for mail that will never arrive, and does not ask the person who can actually help.
//
// Recovery is in-person instead. A cadet asks an instructor, who resets them to the default —
// last 6 digits of the cadet ID — from the roster page. The instructor never chooses or sees a
// password, and the account is flagged so the cadet must pick their own on the next sign-in.
//
// Design record: site/app/PLAN-2026-07-20-ACCOUNTS.md (tiers C and D there describe the email
// world this replaced; the "send reset email" tier no longer exists).

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

  // One row per active enrollment. A student may hold several — that is the whole reason
  // enrollments exists as a table rather than a column on students.
  (ctx.enrollments || []).forEach(e => {
    const sec = e.sections;
    const o = sec?.course_offerings;
    if (!o) return;
    const label = `${o.courses?.title || o.courses?.code || 'Course'} · ${o.terms?.label || ''}`.trim();
    rows.push([label, `Section ${sec.code}`,
      'Set by your enrollment. Ask your instructor to move you.']);
  });

  if (!(ctx.enrollments || []).length) {
    rows.push(['Enrollment', '— none active —',
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

  // 'grader' is retired (2026-07-27) but rows may still carry it — label it rather than render
  // a bare slug. See ROLE_LABEL in faculty-admin.js.
  const ROLE = { director: 'Director', instructor: 'Instructor', grader: 'Grader (retired)' };
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
 * Change the signed-in user's password.
 *
 * Goes through the `set-own-password` edge function rather than `auth.updateUser()`, for one
 * reason: the forced-rotation flag lives in `app_metadata`, which a browser session cannot
 * write. If the browser changed the password directly, a flagged user would change it, stay
 * flagged, and be bounced back to this page on every navigation forever.
 *
 * The function also re-verifies the current password server-side — `updateUser` does NOT check
 * it, so an unlocked unattended browser in a lab would otherwise be enough to take an account
 * over. It skips that check for an account under forced rotation, where the user may genuinely
 * not know the password an instructor just set for them.
 *
 * @param {string|null} currentPw  may be null when the user is under forced rotation
 */
export async function changePassword(currentPw, newPw) {
  const { data, error } = await db.functions.invoke('set-own-password', {
    body: { current_password: currentPw ?? null, new_password: newPw },
  });
  if (error) return { error: { message: error.message } };
  if (data?.error) return { error: { message: data.error } };
  return { error: null, wasForced: data?.was_forced === true };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Forced rotation after a staff reset-to-default
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Is this account still on a password somebody else knows?
 *
 * Set by `reset-student-password` (a staff reset) and by `provision-students` (a brand-new
 * account), both of which leave the user on the default derived from their cadet ID — a value
 * printed on the roster and, in a squadron, effectively public.
 *
 * READS BOTH LOCATIONS ON PURPOSE. The flag now lives in `app_metadata`, which only the service
 * role can write; it previously lived in `user_metadata`, which the user's own session can write
 * — meaning a cadet could have cleared it from a browser console and kept the default password,
 * the exact state the flag exists to prevent. Accounts flagged before the move still carry the
 * old copy, so both are honoured until every one of them has rotated. `set-own-password` clears
 * both, so this pair converges on its own and the `user_metadata` read can be deleted once no
 * flagged accounts predate 2026-07-21.
 */
export function mustChangePassword(user) {
  return user?.app_metadata?.must_change_password === true
      || user?.user_metadata?.must_change_password === true;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Sessions & preferences
 * ════════════════════════════════════════════════════════════════════════════ */

/** Sign out of every device, not just this browser — for shared lab machines. */
export function signOutEverywhere() {
  return db.auth.signOut({ scope: 'global' });
}

/**
 * Preferences follow the person, as of P1.3 — see prefs.js for the full design.
 *
 * Both keys already exist and are already written by other parts of the app — the nav's theme
 * toggle owns cp.theme, and auth.js owns cp.currentOffering. This page does not invent storage;
 * it makes two settings that were only ever set as a side effect visible and resettable.
 *
 * What changed: those writes now go through prefs.js, which mirrors them into
 * `app.user_preferences`. localStorage is still the read path (the anti-FOUC snippet needs a
 * synchronous theme at first paint), so nothing here reads the database directly.
 *
 * An ABSENT cp.theme means "match my system" — that is the whole encoding, and it is why
 * setTheme('system') stores an empty value rather than the string 'system'. Storing the literal
 * made the <head> snippet read a value that was neither null nor 'dark', so "Match my system"
 * silently meant "always light" until P1.3 (fixed 2026-07-22).
 */
export const PREF_KEYS = {
  theme: 'cp.theme',
  offering: 'cp.currentOffering',
  understanding: 'cp.rollup.understanding',
};

export function readPrefs() {
  return {
    theme: getPref(PREF_KEYS.theme) || 'system',
    offering: getPref(PREF_KEYS.offering) || '',
    // Absent means the default rendering, which is the histogram (P1.5).
    understanding: getPref(PREF_KEYS.understanding) || 'histogram',
    synced: isSynced(),
  };
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
import { getPref, setPref, isSynced } from './prefs.js';

export async function renderAccount(ctx, root) {
  const id = await loadIdentity(ctx);
  const prefs = readPrefs();
  const isFaculty = ctx.role === 'faculty';
  const sel = (v, want) => (v === want ? ' selected' : '');

  // auth.js redirects here with ?rotate=1 when the account is flagged. Explaining WHY beats a
  // bare "change your password" — someone who just had a password read to them by an instructor
  // needs to know this is the expected next step and not a fault.
  const rotate = mustChangePassword(ctx.user);

  root.innerHTML = `
    <div class="page-head"><h1>Account</h1>
      <div class="sub">${esc(id.name)} · ${esc(id.roleLabel)}</div></div>

    ${rotate ? `<div class="alert alert-warn">
      <strong>Choose a new password to continue.</strong>
      Your account is on its default password — ${isFaculty
        ? 'your last name followed by <code>1234</code>'
        : 'the last 6 digits of your ID'} — which means
      someone else knows it. Pick your own below and the rest of PREP unlocks.</div>` : ''}

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
      ${rotate ? '' : `<div class="field"><label for="pw-cur">Current password</label>
        <input type="password" id="pw-cur" autocomplete="current-password"></div>`}
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
        ${ctx.role === 'student'
          ? 'Ask your instructor to reset it. They can put it back to the default — the last 6 digits of your ID — but cannot look up or choose a password for you.'
          // Staff recovery stopped being a Supabase-dashboard errand on 2026-07-27: a derivable
          // default (last name + 1234) means a director can restore it without choosing anything,
          // which is the same bargain cadets have always had. See faculty-admin.js.
          : 'Ask your course director to reset it from Course administration → Staff. They can put it back to the default — your last name followed by 1234 — but cannot look up or choose a password for you.'}</div>
    </div>

    <div class="card">
      <div class="card-title">Preferences</div>
      <div class="card-meta">${prefs.synced === false
        ? 'Saved to this browser only — PREP could not reach your account, so these will not follow you to another device.'
        : 'Saved to your account, so they follow you to any device you sign in on.'}</div>
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
        <div class="field-hint">Remembered from your last visit; setting it here makes it
          deliberate instead of a surprise.</div></div>` : ''}
      ${isFaculty ? `
      <div class="field"><label for="pf-understanding">Understanding by objective</label>
        <select id="pf-understanding">
          <option value="histogram"${sel(prefs.understanding, 'histogram')}>Histogram — counts at each score</option>
          <option value="curve"${sel(prefs.understanding, 'curve')}>Smoothed curve — estimated distribution</option>
        </select>
        <div class="field-hint">How the assignment rollup draws each objective's 0–5 spread. The
          histogram matches the effort chart above it and shows the actual counts; the curve is
          an estimate that reads more smoothly for a large cohort.</div></div>` : ''}
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
    // The current-password field is absent under forced rotation — the user may not know the
    // password an instructor just set for them, and the server skips the check in that case.
    const curField = $('pw-cur');
    const cur = curField ? curField.value : null;
    const next = pwNew.value, cf = $('pw-cf').value;
    const problem = passwordProblem(next, cf);
    if (curField && !cur) { status.style.color = 'var(--red)'; status.textContent = 'Enter your current password.'; return; }
    if (problem) { status.style.color = 'var(--red)'; status.textContent = problem; return; }

    btn.disabled = true; status.style.color = 'var(--muted)'; status.textContent = 'Updating…';
    const { error, wasForced } = await changePassword(cur, next);
    btn.disabled = false;
    if (error) { status.style.color = 'var(--red)'; status.textContent = '⚠ ' + error.message; return; }

    status.style.color = 'var(--green)'; status.textContent = '✓ Password updated';
    if (curField) curField.value = '';
    pwNew.value = $('pw-cf').value = '';
    bar.className = 'pwbar';

    // The rotation flag is on the JWT, and bootstrap() re-reads it on every page load — so a
    // user who was flagged is still flagged in this tab's session and would be bounced back
    // here on the next click. Reload to pick up the cleared flag and let them through.
    // Both role directories hold account.html beside dashboard.html, so one relative path
    // serves either.
    if (wasForced) {
      status.textContent = '✓ Password updated — taking you to PREP…';
      await db.auth.refreshSession();
      setTimeout(() => location.replace('dashboard.html'), 900);
    }
  });

  $('pf-theme')?.addEventListener('change', (e) => setTheme(e.target.value));

  // No live preview to update — the rollup reads this at render time, so the change lands on the
  // next visit to a lesson report. Saying so beats leaving someone to wonder whether it took.
  $('pf-understanding')?.addEventListener('change', (e) => {
    setPref(PREF_KEYS.understanding, e.target.value);
    const hint = e.target.parentElement?.querySelector('.field-hint');
    if (hint && !hint.dataset.saved) {
      hint.dataset.saved = '1';
      hint.insertAdjacentHTML('beforeend',
        ' <span class="ok-note">Saved — applies next time you open an assignment rollup.</span>');
    }
  });

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
