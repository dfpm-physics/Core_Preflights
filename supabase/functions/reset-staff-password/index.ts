import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// reset-staff-password — put one staff member's password back to the default, and force a rotation.
//
// ── WHY THIS EXISTS NOW, WHEN IT DELIBERATELY DID NOT BEFORE ─────────────────────────────────
// Staff recovery was refused on purpose until 2026-07-27, and the reasoning is worth keeping
// because only its PREMISE changed, not its conclusion:
//
//   An instructor account has no cadet ID and therefore no derivable default, so any staff reset
//   would mean one person CHOOSING another person's password — and whoever knows a colleague's
//   password is indistinguishable, at the database level, from that colleague, including for grade
//   finalization.
//
// Staff now have a derivable default: last name + `1234` (director, faculty beta 2026-07-27). So
// the reset restores a value the caller can already work out from the name in front of them, and
// nobody chooses anything. The prohibition on choosing is intact and is enforced structurally —
// there is no password parameter, and one that arrives is refused rather than ignored.
//
// The other half is what makes the default safe to hold at all: the account is flagged
// `must_change_password`, so auth.js bounces every page to the account page until the user picks
// their own. The window in which the caller's knowledge is useful is one sign-in. Neither half
// works alone, which is why this function does both or neither.
//
// ── AUTHORIZATION IS NARROWER THAN THE STUDENT EQUIVALENT ────────────────────────────────────
// `reset-student-password` admits ANY staff member of the offering, because the cadet in front of
// them is locked out today and routing them to the director means losing a day for a button that
// reveals nothing. That argument does not carry: a colleague is not standing at a desk waiting,
// and the account being reset can publish grades and administer a course. So this is DIRECTORS and
// system admins, and a director may not reset a SYSTEM ADMIN — mirroring remove-instructor, where
// only a system admin may act on another system admin.
//
// A system admin resetting themselves out of their own session is allowed and harmless (they end
// up on the default and are forced to rotate); resetting the person you are is otherwise pointless,
// so the UI does not offer it and this does not forbid it.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Every response is 200 with the outcome in the body — a non-2xx makes supabase-js throw
// FunctionsHttpError and swallow the message the operator needs. Same convention as its siblings.
function ok(body: object) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * The default password, in one place: last name + `1234`, the surname cut at its first hyphen or
 * space. MUST derive the identical value to `defaultStaffPasswordFor()` in create-instructor and
 * `defaultStaffPassword()` in site/app/js/faculty-admin.js — this one has to reproduce what that
 * one created, and the browser copy is what the director is told to say out loud.
 */
function defaultStaffPasswordFor(name: string): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  const surname = parts.length ? parts[parts.length - 1] : "";
  const stem = surname.split(/[-\s]/)[0].replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  return stem ? `${stem}1234` : "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const courseOfferingId = body.course_offering_id;
    const instructorId = body.instructor_id;

    if (!courseOfferingId) return ok({ error: "course_offering_id is required" });
    if (!instructorId) return ok({ error: "instructor_id is required" });

    // Refuse the parameter that would turn this into tier D, rather than ignoring it. A caller
    // sending one has misunderstood what this endpoint does, and silence would let a UI ship that
    // appears to set passwords and does not.
    if (body.password !== undefined) {
      return ok({
        error: "This endpoint does not accept a password. It only resets to the default " +
               "(last name + 1234).",
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

    // ── Authorization: a DIRECTOR of this offering, or a system admin ────────────────────
    const { data: callerInstructor, error: instrErr } = await supabaseAdmin
      .from("instructors")
      .select("is_global_admin")
      .eq("id", caller.id)
      .maybeSingle();

    if (instrErr) return ok({ error: "Could not verify caller: " + instrErr.message });
    if (!callerInstructor) return ok({ error: "Caller is not an instructor" });

    const isGlobalAdmin = callerInstructor.is_global_admin === true;

    if (!isGlobalAdmin) {
      const { data: callerStaff } = await supabaseAdmin
        .from("staff_assignments")
        .select("id")
        .eq("instructor_id", caller.id)
        .eq("course_offering_id", courseOfferingId)
        .eq("role", "director")
        .limit(1);

      if (!callerStaff?.length) {
        return ok({ error: "Only a course director or a system admin can reset a staff password." });
      }
    }

    // ── The target must be somebody who staffs THIS offering ─────────────────────────────
    // Authorization is per-offering, so the target has to be reached through it. Without this a
    // director of Physics 110 could reset any instructor in the database by passing an offering
    // they direct and an id they have no relationship with. Exactly the join
    // reset-student-password makes through enrollments.
    const { data: target, error: tErr } = await supabaseAdmin
      .from("instructors")
      .select("id, name, is_global_admin")
      .eq("id", instructorId)
      .maybeSingle();

    if (tErr) return ok({ error: "Could not look up that person: " + tErr.message });
    if (!target) return ok({ error: "No such instructor." });

    // A system admin implicitly staffs every offering and holds no staff_assignments row, so the
    // membership check below would reject them. Only another system admin may act on one anyway
    // (mirrors remove-instructor), so that check comes first and subsumes it.
    if (target.is_global_admin && !isGlobalAdmin) {
      return ok({ error: "Only a system admin can reset another system admin's password." });
    }

    if (!target.is_global_admin) {
      const { data: staff } = await supabaseAdmin
        .from("staff_assignments")
        .select("id")
        .eq("instructor_id", instructorId)
        .eq("course_offering_id", courseOfferingId)
        .limit(1);

      if (!staff?.length) {
        return ok({ error: "That person does not staff this course, so you cannot reset them here." });
      }
    }

    const password = defaultStaffPasswordFor(target.name);
    if (!password) {
      // Only reachable when the surname holds nothing alphanumeric, which would derive "1234".
      return ok({
        error: `Could not derive a default password from the name "${target.name}". ` +
               `A system admin must reset this account from the Supabase dashboard.`,
      });
    }

    const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(
      instructorId,
      { password, app_metadata: { must_change_password: true } }
    );

    if (updErr) return ok({ error: "Could not reset the password: " + updErr.message });

    // Deliberately NOT returning the password. The caller derives it from the name they are
    // already looking at; putting it in an HTTP response body would write it to any proxy log and
    // devtools history between here and their screen.
    return ok({
      success: true,
      instructor_id: instructorId,
      name: target.name,
      must_change_password: true,
    });

  } catch (err) {
    return ok({ error: "Unexpected error: " + (err as Error).message });
  }
});
