import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// remove-instructor — revoke staffing on one offering, or clear the system-admin flag.
//
// MOVED TO SCHEMA `app` (PREP v2):
//   course_id 'phys-215'      -> course_offering_id (uuid); revocation is per TERM
//   instructor_course_access  -> staff_assignments
//   instructors.is_director   -> GONE. As in create-instructor, the old code treated it as a
//                                second global-admin flag, so a legacy course director could
//                                remove SYSTEM ADMINS. Only is_global_admin counts now.
//
// The instructors row itself is never deleted. Grades reference it via graded_by, and
// submissions via unlocked_by; deleting the person would null those out and quietly erase who
// did what. Revoking their staffing removes their access, which is the actual intent.

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
    const { instructor_id } = body;
    const courseOfferingId = body.course_offering_id ?? null;

    if (!instructor_id) return ok({ error: "instructor_id is required" });
    if (!courseOfferingId && body.course_id) {
      return ok({ error: "course_id is no longer accepted — send course_offering_id (or omit it to revoke everywhere)." });
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

    const { data: callerInstructor } = await supabaseAdmin
      .from("instructors")
      .select("is_global_admin")
      .eq("id", caller.id)
      .maybeSingle();

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

    if (!isGlobalAdmin && !isCourseDirector) {
      return ok({ error: "Only course directors or system admins can remove instructors" });
    }

    const { data: target } = await supabaseAdmin
      .from("instructors")
      .select("is_global_admin")
      .eq("id", instructor_id)
      .maybeSingle();

    if (!target) return ok({ error: "No such instructor" });

    // Only system admins can remove other system admins.
    if (target.is_global_admin && !isGlobalAdmin) {
      return ok({ error: "Only system admins can remove other system admins" });
    }

    if (target.is_global_admin) {
      const { error: updateErr } = await supabaseAdmin
        .from("instructors")
        .update({ is_global_admin: false })
        .eq("id", instructor_id);

      if (updateErr) return ok({ error: "Failed to remove system admin: " + updateErr.message });
    }

    // Revoke staffing: on one offering, or everywhere when none is named.
    let del = supabaseAdmin.from("staff_assignments").delete().eq("instructor_id", instructor_id);
    if (courseOfferingId) del = del.eq("course_offering_id", courseOfferingId);
    const { error: delErr } = await del;
    if (delErr) return ok({ error: "Failed to revoke staff assignment: " + delErr.message });

    return ok({ success: true });

  } catch (err) {
    return ok({ error: "Unexpected error: " + (err as Error).message });
  }
});
