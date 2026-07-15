// guard.js — director-only soft gate for the design sandboxes (tests/browser/).
//
// These are internal design/preview pages, so restrict them to course directors (or higher).
// Static-site client-side gate: anonymous users are bounced to the app login; signed-in
// non-directors get an access-denied message. Requires the Supabase client (window.db) from
// ../../site/app/js/config.js, loaded as a classic script BEFORE this module.
//
// The page is hidden (opacity 0, set by an inline head script) until this resolves, so gated
// content never flashes before the check completes.

const APP = '../../site/app/';   // relative → resolves both locally and under /Core_Preflights/ on Pages

function reveal() { document.documentElement.style.opacity = ''; }
function deny(msg) {
  document.documentElement.style.opacity = '';
  document.body.innerHTML =
    `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:440px;margin:16vh auto;text-align:center;padding:24px">
       <h2 style="margin:0 0 8px">${msg}</h2>
       <p style="color:#6b7280">These design sandboxes are for course directors.</p>
       <p style="margin-top:16px"><a href="${APP}login.html">Sign in</a></p>
     </div>`;
}

try {
  if (!window.db || !window.db.auth) {
    deny('Sign-in required');
  } else {
    const { data: { session } } = await window.db.auth.getSession();
    if (!session) {
      location.replace(`${APP}login.html?next=${encodeURIComponent(location.pathname)}`);
    } else {
      const uid = session.user.id;
      const { data: instr } = await window.db.from('instructors')
        .select('is_director, is_global_admin').eq('id', uid).maybeSingle();
      let ok = !!(instr && (instr.is_global_admin || instr.is_director));
      if (!ok && instr) {
        // Course-scoped directors (newer model) qualify too.
        const { data: acc } = await window.db.from('instructor_course_access')
          .select('role').eq('instructor_id', uid).eq('role', 'director').limit(1);
        ok = !!(acc && acc.length);
      }
      ok ? reveal() : deny('Director access required');
    }
  }
} catch (e) {
  deny('Could not verify access');
}
