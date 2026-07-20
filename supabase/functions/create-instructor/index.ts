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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { name, email, password, role } = body;
    const courseOfferingId = body.course_offering_id;
    const sectionId = body.section_id ?? null;   // null => offering-wide

    if (!name || !email || !password) {
      return ok({ error: "name, email, and password are required" });
    }
    if (role !== "system_admin" && !courseOfferingId) {
      return ok({
        error: body.course_id
          ? "course_id is no longer accepted — staffing is per term. Send course_offering_id."
          : "course_offering_id is required for instructor and director roles",
      });
    }
    if (role && !["system_admin", "director", "instructor", "grader"].includes(role)) {
      return ok({ error: `Unknown role "${role}"` });
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

    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
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

    return ok({ success: true, user_id: userId });

  } catch (err) {
    return ok({ error: "Unexpected error: " + (err as Error).message });
  }
});
