import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// create-instructor — create a Supabase Auth user plus their staffing rows.
//
// MOVED TO SCHEMA `app` (PREP v2):
//   course_id 'phys-215'      -> course_offering_id (uuid). Staffing is per TERM: directing
//                                Physics 215 in Fall 2026 does not mean directing it forever.
//   instructor_course_access  -> staff_assignments (with an optional section_id; NULL means
//                                offering-wide, which is how a director is recorded)
//   instructors.is_director   -> GONE. 001_core_model.sql dropped it deliberately so that
//                                course-level authority has exactly one source of truth. The
//                                old code read it as a second global-admin flag, which meant a
//                                legacy course director could create SYSTEM ADMINS. That is
//                                fixed here, not merely ported: only is_global_admin counts.
//
// Rollback on partial failure is preserved: an orphaned auth user with no instructors row
// would be able to sign in and resolve to no role at all.
//
// ── 2026-07-27: THE CALLER NO LONGER SUPPLIES A PASSWORD ─────────────────────────────────────
// It used to be required, and the Add-staff form pre-filled the field with the literal string
// `prep-temp-2026`. Whatever anybody accepted that default for shared one credential across every
// account, and nothing obliged the new instructor to change it — an account that finalizes grades,
// on a password printed in a form field.
//
// The password is now DERIVED here (last name + 1234) and the account is flagged
// `must_change_password`, so the default survives exactly one sign-in: auth.js bounces every page
// to the account page until the user picks their own. Deriving is what makes the value safe to
// know — the director works it out from the name they just typed — while the absence of a
// parameter is what stops one person CHOOSING another's credential and then signing in as them.
// Same argument, same shape, as reset-student-password.
//
// A `password` IS still accepted from a system admin, and only from one: that is the unbuilt
// tier D of PLAN-2026-07-20-ACCOUNTS.md §3, and refusing it outright would remove the only way to
// create an account for somebody whose name derives an unusable default.

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

/**
 * A staff account's default password: last name + `1234`.
 *
 * "First word before any hyphen and space" (director, 2026-07-27): the surname is the last
 * whitespace-separated token, and a compound one is cut at its first hyphen or space —
 * `Jane Smith-Jones` -> `smith1234`.
 *
 * THE ENFORCING COPY. `defaultStaffPassword()` in site/js/faculty-admin.js and
 * `defaultStaffPasswordFor()` in reset-staff-password must derive the identical value: the browser
 * one only tells the director what to say, and the reset one has to reproduce what was created
 * here. They may not drift. (Duplicated rather than shared because a Deno edge function and a
 * browser module have no common import path — the same trade `set-own-password` makes with
 * MIN_PASSWORD.)
 */
function defaultStaffPasswordFor(name: string): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  const surname = parts.length ? parts[parts.length - 1] : "";
  const stem = surname.split(/[-\s]/)[0].replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  return stem ? `${stem}1234` : "";
}

/** Mirrors MIN_PASSWORD in site/js/account.js and set-own-password. */
const MIN_PASSWORD = 8;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { name, email, password, role } = body;
    const courseOfferingId = body.course_offering_id;
    const sectionId = body.section_id ?? null;   // null => offering-wide

    if (!name || !email) {
      return ok({ error: "name and email are required" });
    }
    if (role !== "system_admin" && !courseOfferingId) {
      return ok({
        error: body.course_id
          ? "course_id is no longer accepted — staffing is per term. Send course_offering_id."
          : "course_offering_id is required for instructor and director roles",
      });
    }
    // 'grader' was withdrawn on 2026-07-27: it meant "grades only, no authoring", and authoring
    // has always been gated on DIRECTOR, so it was privilege-identical to 'instructor'. The CHECK
    // constraint still admits it (DDL on `app` is sealed) and existing rows keep working — this
    // only stops NEW ones being minted. See ROLE_LABEL in site/js/faculty-admin.js.
    if (role && !["system_admin", "director", "instructor"].includes(role)) {
      return ok({
        error: role === "grader"
          ? 'The "grader" role is retired — it granted exactly what "instructor" grants. Use "instructor".'
          : `Unknown role "${role}"`,
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "app" } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return ok({ error: "Not authenticated" });

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } }, db: { schema: "app" } }
    );

    const { data: { user: caller }, error: authErr } = await supabaseClient.auth.getUser();
    if (authErr || !caller) return ok({ error: "Not authenticated: " + (authErr?.message ?? "no user") });

    const { data: callerInstructor, error: instrErr } = await supabaseAdmin
      .from("instructors")
      .select("is_global_admin")
      .eq("id", caller.id)
      .maybeSingle();

    if (instrErr) return ok({ error: "Could not verify caller: " + instrErr.message });
    if (!callerInstructor) return ok({ error: "Caller is not an instructor" });

    const isGlobalAdmin = callerInstructor.is_global_admin === true;

    let isCourseDirector = false;
    if (courseOfferingId) {
      const { data: callerStaff } = await supabaseAdmin
        .from("staff_assignments")
        .select("role")
        .eq("instructor_id", caller.id)
        .eq("course_offering_id", courseOfferingId)
        .eq("role", "director");
      isCourseDirector = (callerStaff || []).length > 0;
    }

    // Only a system admin may mint another system admin.
    if (role === "system_admin" && !isGlobalAdmin) {
      return ok({ error: "Only system admins can create other system admins" });
    }
    if (role !== "system_admin" && !isGlobalAdmin && !isCourseDirector) {
      return ok({ error: "Only course directors or system admins can add instructors" });
    }

    // A caller-supplied password is tier D and is admitted only from a system admin — see the
    // header. Everyone else gets the derived default, whatever they sent.
    let initialPassword = defaultStaffPasswordFor(name);
    let derived = true;
    if (password && isGlobalAdmin) {
      if (String(password).length < MIN_PASSWORD) {
        return ok({ error: `A supplied password must be at least ${MIN_PASSWORD} characters.` });
      }
      initialPassword = String(password);
      derived = false;
    }
    if (!initialPassword) {
      // Only reachable when the surname has nothing alphanumeric in it, which would derive the
      // bare string "1234". Refuse rather than create an account on a two-character password.
      return ok({
        error: `Could not derive a default password from the name "${name}". ` +
               `A system admin can create this account with an explicit password.`,
      });
    }

    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: initialPassword,
      email_confirm: true,          // no mail is sent; PREP has no SMTP
      // The account is on a password somebody else knows, so it cannot be carried into normal
      // use: auth.js redirects every page to the account page until it is replaced. In
      // `app_metadata` rather than `user_metadata` because the latter is writable by the user's
      // own session — they could clear the flag from a browser console and keep the default.
      app_metadata: { must_change_password: true },
    });

    if (createError) return ok({ error: "Auth create failed: " + createError.message });

    const userId = newUser.user.id;

    const { error: instrInsertError } = await supabaseAdmin
      .from("instructors")
      .insert({ id: userId, name, is_global_admin: role === "system_admin" });

    if (instrInsertError) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return ok({ error: "Instructors insert failed: " + instrInsertError.message });
    }

    if (role !== "system_admin") {
      const { error: staffError } = await supabaseAdmin
        .from("staff_assignments")
        .insert({
          instructor_id: userId,
          course_offering_id: courseOfferingId,
          section_id: sectionId,
          role: role || "instructor",
        });

      if (staffError) {
        await supabaseAdmin.from("instructors").delete().eq("id", userId);
        await supabaseAdmin.auth.admin.deleteUser(userId);
        return ok({ error: "Staff assignment insert failed: " + staffError.message });
      }
    }

    // `must_change_password` is reported so a UI can say the account is on a one-use default.
    // The PASSWORD itself is deliberately not returned: the caller derives it from the name they
    // just typed, and putting it in a response body would write it to every proxy log and devtools
    // history between here and the director's screen. Same rule as reset-student-password.
    return ok({ success: true, user_id: userId, must_change_password: true, derived_password: derived });

  } catch (err) {
    return ok({ error: "Unexpected error: " + (err as Error).message });
  }
});
