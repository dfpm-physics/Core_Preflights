import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// set-own-password — change your own password, and clear the forced-rotation flag.
//
// ── WHY A FUNCTION, WHEN THE BROWSER COULD ALREADY DO MOST OF THIS ───────────────────────────
// The browser can change a password (`auth.updateUser({ password })`). What it cannot do is
// clear `app_metadata.must_change_password`, because `app_metadata` is service-role-only — and
// that is precisely why the flag lives there. The forced-rotation flag used to sit in
// `user_metadata`, which the user's own anon session can write: a cadet could clear it from a
// browser console and stay on the shared-knowledge default password forever, which is the exact
// state the flag exists to end.
//
// Moving the flag out of reach closed that hole and, in the same motion, made a server-side
// change-password endpoint necessary — otherwise a student who dutifully changed their password
// would stay flagged and be redirected back to the account page on every single page load,
// forever. The two halves have to land together.
//
// ── WHY THE CURRENT PASSWORD IS RE-VERIFIED HERE ─────────────────────────────────────────────
// `updateUser` trusts the session and does not check the existing password, so an unlocked
// unattended browser in a lab is enough to take an account over permanently. Verifying costs one
// sign-in call and closes that. The check is skipped in exactly one case: an account under forced
// rotation, where the "current" password is one an instructor just reset and the user may
// legitimately not know it — requiring it there would lock out the people the flow exists to
// rescue. The session itself is the proof in that case, which is no weaker: they are already
// signed in either way.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function ok(body: object) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Mirrors MIN_PASSWORD in site/app/js/account.js. Duplicated rather than shared because a Deno
// edge function and a browser module have no common import path — but the client check is for
// feedback and THIS one is the enforcement, so they may not silently drift apart.
const MIN_PASSWORD = 8;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { current_password: currentPassword, new_password: newPassword } = await req.json();

    if (!newPassword || String(newPassword).length < MIN_PASSWORD) {
      return ok({ error: `Your new password must be at least ${MIN_PASSWORD} characters.` });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return ok({ error: "Not authenticated" });

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } }, db: { schema: "app" } }
    );

    const { data: { user: caller }, error: authErr } = await supabaseClient.auth.getUser();
    if (authErr || !caller) return ok({ error: "Not authenticated: " + (authErr?.message ?? "no user") });

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "app" } }
    );

    // Read the flag from the ADMIN client. The caller's own JWT carries a copy of app_metadata
    // that was minted when the session started, so a flag set by an instructor five minutes ago
    // would not be visible there — and this decides whether to demand the current password.
    const { data: adminUser, error: getErr } =
      await supabaseAdmin.auth.admin.getUserById(caller.id);
    if (getErr) return ok({ error: "Could not read your account: " + getErr.message });

    const mustChange =
      adminUser.user?.app_metadata?.must_change_password === true ||
      adminUser.user?.user_metadata?.must_change_password === true;  // legacy location

    if (!mustChange) {
      if (!currentPassword) return ok({ error: "Enter your current password." });

      // A failed sign-in does not disturb the existing session, so a wrong guess is safe. This
      // uses a THROWAWAY client: signInWithPassword on the request-scoped client above would
      // replace the caller's session token mid-request.
      const probe = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { auth: { persistSession: false, autoRefreshToken: false } }
      );
      const { error: pwErr } = await probe.auth.signInWithPassword({
        email: caller.email!,
        password: String(currentPassword),
      });
      if (pwErr) return ok({ error: "That is not your current password." });
    }

    // Clear the flag in BOTH places. app_metadata is where it lives now; user_metadata is
    // cleared too so an account flagged before this function shipped does not stay in a
    // redirect loop against a copy nothing else reads.
    const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(caller.id, {
      password: String(newPassword),
      app_metadata: { must_change_password: false },
      user_metadata: { must_change_password: false },
    });

    if (updErr) return ok({ error: "Could not update your password: " + updErr.message });

    return ok({ success: true, was_forced: mustChange });

  } catch (err) {
    return ok({ error: "Unexpected error: " + (err as Error).message });
  }
});
