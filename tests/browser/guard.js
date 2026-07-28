// guard.js — director-only soft gate for the design sandboxes (tests/browser/).
//
// These are internal design/preview pages, so restrict them to course directors (or higher).
// Static-site client-side gate: anonymous users are bounced to the app login; signed-in
// non-directors get an access-denied message. Requires the Supabase client (window.db) from
// ../../site/js/config.js, loaded as a classic script BEFORE this module.
//
// The page is hidden (opacity 0, set by an inline head script) until this resolves, so gated
// content never flashes before the check completes.

const APP = '../../site/';   // relative → resolves both locally and under /Core_Preflights/ on Pages

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

      // Schema `app` (PREP v2). Two columns this used to read are gone, and the way they
      // failed together is why every sandbox locked:
      //   • instructors.is_director no longer exists — 001_core_model.sql dropped it so that
      //     course-level authority has ONE source of truth. Selecting it made PostgREST
      //     return 400, so `instr` came back null…
      //   • …and the fallback was gated on `instr` being truthy, so it never ran. A director
      //     was therefore denied by a query that failed before it could ever say yes.
      //     The fallback is deliberately UN-GATED now: it is the authoritative check, not a
      //     top-up, and it must run even when the first lookup returns nothing.
      //   • instructor_course_access -> staff_assignments (term-scoped).
      const { data: instr } = await window.db.from('instructors')
        .select('id, is_global_admin').eq('id', uid).maybeSingle();

      let ok = !!instr?.is_global_admin;
      if (!ok) {
        // A director of ANY offering qualifies — these are internal design pages, not
        // course-scoped content, so there is no particular offering to check against.
        const { data: staff } = await window.db.from('staff_assignments')
          .select('role').eq('instructor_id', uid).eq('role', 'director').limit(1);
        ok = !!(staff && staff.length);
      }
      ok ? reveal() : deny('Director access required');
    }
  }
} catch (e) {
  deny('Could not verify access');
}
