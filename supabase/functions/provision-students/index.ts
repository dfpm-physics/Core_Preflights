import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// provision-students — bulk-create Supabase Auth accounts for enrolled students.
//
// MOVED TO SCHEMA `app` (PREP v2). What changed, and why each change was forced:
//   course_id 'phys-215'      -> course_offering_id (uuid). Provisioning is a per-TERM action:
//                                staff_assignments and enrollments both attach people to an
//                                offering, so "the students of Physics 215" is only answerable
//                                for a given semester.
//   instructor_course_access  -> staff_assignments (role='director' on that offering)
//   students.section_id       -> enrollments (a student may hold several)
//
// The admin client is pinned to schema `app`; `public` is no longer touched by this function.
// The email/password convention is unchanged: <cadetId>@usafa.edu, password = last 6 digits.

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
    const courseOfferingId = body.course_offering_id;

    if (!courseOfferingId) {
      // Name the migration explicitly rather than failing as "missing field": a caller still
      // sending course_id is running pre-v2 code, and that is the useful thing to say.
      return ok({
        error: body.course_id
          ? "course_id is no longer accepted — provisioning is per term. Send course_offering_id."
          : "course_offering_id is required",
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "app" } }
    );

    // Verify caller is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return ok({ error: "Not authenticated" });

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } }, db: { schema: "app" } }
    );

    const { data: { user: caller }, error: authErr } = await supabaseClient.auth.getUser();
    if (authErr || !caller) return ok({ error: "Not authenticated: " + (authErr?.message ?? "no user") });

    // Authorized = global admin, or a director OF THIS OFFERING.
    const { data: callerInstructor, error: instrErr } = await supabaseAdmin
      .from("instructors")
      .select("is_global_admin")
      .eq("id", caller.id)
      .maybeSingle();

    if (instrErr) return ok({ error: "Could not verify caller: " + instrErr.message });
    if (!callerInstructor) return ok({ error: "Caller is not an instructor" });

    const { data: callerStaff } = await supabaseAdmin
      .from("staff_assignments")
      .select("role")
      .eq("instructor_id", caller.id)
      .eq("course_offering_id", courseOfferingId)
      .eq("role", "director");

    const isGlobalAdmin = callerInstructor.is_global_admin === true;
    const isCourseDirector = (callerStaff || []).length > 0;

    if (!isGlobalAdmin && !isCourseDirector) {
      return ok({ error: "Only course directors or system admins can provision student accounts" });
    }

    // Students enrolled in this offering who have no auth account yet.
    const { data: sections, error: sectErr } = await supabaseAdmin
      .from("sections")
      .select("id")
      .eq("course_offering_id", courseOfferingId);

    if (sectErr) return ok({ error: "Could not fetch sections: " + sectErr.message });

    const sectionIds = (sections || []).map((s: { id: string }) => s.id);
    if (!sectionIds.length) return ok({ success: true, count: 0, errors: [] });

    // Reach the person through the enrolment. `students` no longer carries a section, and a
    // person may be enrolled in another course this function has no business provisioning.
    const { data: enrolments, error: enrErr } = await supabaseAdmin
      .from("enrollments")
      .select("student_id, students!inner(student_id, auth_user_id)")
      .in("section_id", sectionIds)
      .eq("status", "active")
      .is("students.auth_user_id", null);

    if (enrErr) return ok({ error: "Could not fetch students: " + enrErr.message });
    if (!enrolments?.length) return ok({ success: true, count: 0, errors: [] });

    // One person may hold several enrolments in the same offering; provision them once.
    const studentIds = [...new Set(enrolments.map((e: { student_id: number }) => e.student_id))];

    // Provision serially to avoid rate limiting.
    let count = 0;
    const errors: string[] = [];

    for (const studentId of studentIds) {
      const studentIdStr = String(studentId);
      const email = studentIdStr + "@usafa.edu";
      const password = studentIdStr.slice(-6); // last 6 digits

      const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

      if (createErr) {
        errors.push(`${studentId}: ${createErr.message}`);
        continue;
      }

      const { error: updateErr } = await supabaseAdmin
        .from("students")
        .update({ auth_user_id: newUser.user.id })
        .eq("student_id", studentId);

      if (updateErr) {
        // The auth user exists but is unlinked. Say so precisely — re-running will now fail
        // with "email already registered" for this cadet, and the operator needs to know the
        // fix is to link the existing user, not to create another.
        errors.push(`${studentId} (auth account created but NOT linked — link it manually): ${updateErr.message}`);
        continue;
      }

      count++;
    }

    return ok({ success: true, count, errors });

  } catch (err) {
    return ok({ error: "Unexpected error: " + (err as Error).message });
  }
});
