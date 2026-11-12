/* Create staff -- one page that makes ONE new staff account.
 *
 * It replaced the "Or create a new account" half of the Add staff dialog on Admin -> Staff
 * (2026-11-12). That form shared the dialog's role select, which defaults to Instructor, so a new
 * director or system admin was easy to create with the wrong role. Here the role is an EXPLICIT
 * choice: nothing is selected until the person picks one, and submitting without one is refused.
 *
 * Who: a system admin, or a director of at least one offering. The page's filtering is a
 * convenience. The gate is the create-instructor edge function, which refuses a system_admin from
 * anyone but a system admin and refuses anyone who is not a director of the named offering.
 *
 * No password is shown or accepted: the account starts on the derived default (last name + 1234)
 * and must be changed at first sign-in. Submission goes through addStaff() in faculty-admin.js.
 */
import { bootstrap } from './auth.js';
import { renderNav } from './nav.js';
import { initTheme } from './theme.js';
import { esc, runPage } from './util.js';
import * as A from './faculty-admin.js';

const ctx = await bootstrap({ require: 'faculty' });
runPage(ctx, init);

const $ = (id) => document.getElementById(id);
const isAdmin = () => !!ctx?.instructorRow?.is_global_admin;
const directed = () => (ctx.courses || []).filter(c => isAdmin() || c.role === 'director');
const offeringLabel = (c) => `${c.courseCode || 'Course'} · ${c.termLabel || c.termCode || ''}`.trim();
const roleWord = { instructor: 'Instructor', director: 'Director', system_admin: 'System admin' };

// Where "Back to Staff" goes: only when the page was opened from the Staff tab with ?offering=.
let backOffering = null;
try { backOffering = new URLSearchParams(location.search).get('offering'); } catch { /* no address */ }

function init() {
  initTheme();
  renderNav(ctx, { active: 'create-staff', onCourseChange: () => location.reload() });
  if (!isAdmin() && !directed().length) {
    $('main').innerHTML = head() + `<div class="empty-state"><div class="es-ic">🔒</div><h3>Not allowed</h3>
      <p>Only a system admin or a course director can create a staff account.</p></div>`;
    return;
  }
  renderForm();
}

const head = () => `<div class="page-head"><h1>Create staff</h1>
  <div class="sub">Make a new PREP login for somebody who has never used PREP.</div></div>`;

function renderForm() {
  const offerings = directed();
  const roles = [['instructor', 'Instructor — grades their sections'],
                 ['director', 'Director — full administration']];
  if (isAdmin()) roles.push(['system_admin', 'System admin — every course, every term']);
  const wanted = offerings.find(c => c.offeringId === backOffering)?.offeringId || '';
  $('main').innerHTML = head() + `
    <form id="cs-form" class="card" style="max-width:560px" novalidate>
      <div class="field"><label for="cs-name">Full name</label>
        <input id="cs-name" type="text" autocomplete="off" placeholder="Jane Doe">
        <div class="field-hint">Their first password is derived from it — last name + <code>1234</code>.</div></div>
      <div class="field"><label for="cs-email">Email</label>
        <input id="cs-email" type="email" autocomplete="off" placeholder="jane.doe@afacademy.af.edu">
        <div class="field-hint">Becomes their sign-in address.</div></div>
      <div class="field"><label for="cs-role">Role</label>
        <select id="cs-role" required>
          <option value="" selected disabled>Choose a role…</option>
          ${roles.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}
        </select>
        <div class="field-hint">There is no default.${isAdmin() ? '' : ' Only a system admin can create a system admin.'}</div></div>
      <div class="field" id="cs-off-field"><label for="cs-off">Offering</label>
        <select id="cs-off">
          <option value=""${wanted ? '' : ' selected'} disabled>Choose an offering…</option>
          ${offerings.map(c => `<option value="${esc(c.offeringId)}"${c.offeringId === wanted ? ' selected' : ''}>${esc(offeringLabel(c))}</option>`).join('')}
        </select>
        <div class="field-hint">${isAdmin() ? 'Any offering.' : 'Only offerings you direct are listed.'}
          This grants nothing in any other term.</div></div>
      <div class="alert alert-info">They are put on the default password and <strong>must change it</strong>
        before they can do anything in PREP. Tell them in person — PREP has no mail server.</div>
      <div id="cs-error" class="alert alert-error" style="display:none" role="alert"></div>
      <button type="submit" class="btn btn-primary" id="cs-go">Create account</button>
    </form>`;
  const sync = () => {
    $('cs-off-field').style.display = $('cs-role').value === 'system_admin' ? 'none' : '';
  };
  $('cs-role').addEventListener('change', sync);
  sync();
  $('cs-form').addEventListener('submit', submit);
}

async function submit(e) {
  e.preventDefault();
  const err = (m) => { const b = $('cs-error'); b.textContent = m; b.style.display = m ? '' : 'none'; };
  const name = $('cs-name').value.trim();
  const email = $('cs-email').value.trim();
  const role = $('cs-role').value;
  const offering = $('cs-off').value;
  err('');
  if (!name || !email) return err('Enter a full name and an email.');
  if (!role) return err('Choose a role.');
  if (role !== 'system_admin' && !offering) return err('Choose an offering.');
  const btn = $('cs-go');
  btn.disabled = true;
  const { data, error } = await A.addStaff(ctx, { name, email, role,
    offeringId: role === 'system_admin' ? null : offering });
  const msg = data?.error || error?.message;
  if (msg) { btn.disabled = false; return err(msg); }
  const off = directed().find(c => c.offeringId === offering);
  const where = role === 'system_admin' ? 'every course and term' : off ? offeringLabel(off) : 'the chosen offering';
  const back = backOffering
    ? ` <a class="btn" href="admin.html?tab=staff&amp;offering=${encodeURIComponent(backOffering)}">Back to Staff</a>` : '';
  $('main').innerHTML = head() + `<div class="alert alert-success" role="status" style="max-width:560px">
      <strong>${esc(name)}</strong> was created as <strong>${esc(roleWord[role])}</strong> for ${esc(where)}.
      Their first password is last name + <code>1234</code>, and they must change it when they first sign in.</div>
    <p><a class="btn btn-primary" href="create-staff.html" id="cs-again">Create another</a>${back}</p>`;
  $('cs-again').addEventListener('click', (ev) => { ev.preventDefault(); renderForm(); });
}
