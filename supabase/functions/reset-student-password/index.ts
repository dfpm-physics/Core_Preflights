import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// reset-student-password — put one cadet's password back to the default, and force a rotation.
//
// ── WHY THIS FUNCTION EXISTS AT ALL ──────────────────────────────────────────────────────────
// PREP has no SMTP. Every "reset by email" path in the app was sending a code to
// <cadet_id>@usafa.edu — an address the provisioning script invented, which no mail server has
// ever accepted. The reset flow looked complete and recovered nobody. So recovery moves
// in-person: a cadet who is locked out asks an instructor, and the instructor presses a button.
//
// ── THE ONE DESIGN CONSTRAINT ────────────────────────────────────────────────────────────────
// The caller does NOT supply a password, and there is no parameter through which they could.
// The value is derived here from the cadet ID. That is the whole security argument for letting
// an instructor — rather than only a system admin — hold this power:
//
//   * The instructor learns nothing they did not already know. The default is a function of the
//     cadet ID, which is on the roster in front of them. Pressing this button reveals no secret.
//   * They cannot choose a password and then sign in as the student. An instructor who picks a
//     password knows a working credential for a cadet's account, and at the database level that
//     is indistinguishable from the cadet's own session — every submission, every honor
//     statement, every grade appeal made under it. Removing the parameter removes the capability.
//   * The account is flagged, so the cadet must replace the shared-knowledge default before they
//     can do anything. The window in which the instructor's knowledge is useful is one sign-in.
//
// A system admin setting an arbitrary password is a different, unbuilt tier (PLAN-2026-07-20-
// ACCOUNTS.md, tier D). Do not add a `password` field here to serve it — that would silently
// convert every course director into that tier.
//
// ── WHY THE FLAG LIVES IN app_metadata, NOT user_metadata ────────────────────────────────────
// `user_metadata` is writable by the user's own anon-key session. A cadet could clear the
// forced-rotation flag from a browser console and keep the default password — which is exactly
// the state the flag exists to end. `app_metadata` is service-role-only, so only this function
// and its siblings can set or clear it. auth.js reads both for the transition period.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Every response is 200 with the outcome in the body — a non-2xx makes supabase-js throw
// FunctionsHttpError and swallow the message the operator needs. Same convention as the
// other three functions.
function ok(body: object) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** The default password, in one place: the last 6 digits of the cadet ID. */
function defaultPasswordFor(studentId: number | string): string {
  return String(studentId).slice(-6);
}

// ── Transient database faults vs. real ones ───────────────────────────────────────────────────
// SQLSTATEs that mean "the database was briefly unavailable", not "your request was wrong". A
// course director can act on none of them, and the raw text actively misleads.
//
// 25P02 is the one that prompted this (2026-08-09, a reset that failed three times running and
// then worked). It means the pooled connection this query was handed was ALREADY inside a failed
// transaction: Supavisor runs in transaction-pooling mode, so a server connection left aborted
// poisons whoever borrows it next. The query itself is fine — the same read ran 30/30 clean
// minutes later. So the operator is shown the wreckage downstream of a cause they are never
// shown, phrased as though the roster or their permissions were at fault. Both were fine.
//
// Keep the SQLSTATE in the message. It means nothing to a director and is the first thing the
// next operator will want.
const TRANSIENT_SQLSTATES = new Set([
  "25P02", // in_failed_sql_transaction — a poisoned pooled connection
  "40001", // serialization_failure
  "53300", // too_many_connections
  "57014", // query_canceled — usually a statement timeout
  "57P01", // admin_shutdown
  "57P03", // cannot_connect_now — e.g. the project waking from a free-tier pause
  "08000", "08003", "08006", // connection exceptions
]);

/**
 * Turn a database error into a sentence the person at the keyboard can act on.
 *
 * `what` names the step in plain language and reads after "Could not …", so a genuine,
 * non-transient failure still says exactly where it happened and still carries the raw message.
 */
function dbError(what: string, err: { code?: string; message: string }): string {
  if (err.code && TRANSIENT_SQLSTATES.has(err.code)) {
    return "The database was briefly unavailable, so this did not go through. Nothing was " +
           `changed — please try again in a moment. (${err.code} while trying to ${what}.)`;
  }
  return `Could not ${what}: ${err.message}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const courseOfferingId = body.course_offering_id;
    const studentId = body.student_id;

    if (!courseOfferingId) return ok({ error: "course_offering_id is required" });
    if (!studentId) return ok({ error: "student_id is required" });

    // Refuse the parameter that would turn this into tier D, rather than ignoring it. A caller
    // sending one has misunderstood what this endpoint does, and silence would let a UI ship
    // that appears to set passwords and does not.
    if (body.password !== undefined) {
      return ok({
        error: "This endpoint does not accept a password. It only resets to the default " +
               "(last 6 digits of the cadet ID).",
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

    // ── Authorization ────────────────────────────────────────────────────────────────────
    // Any staff member of the offering may reset — instructor, grader, or director. This is
    // wider than provision-students (director-only) on purpose: the cadet who is locked out is
    // standing in front of whoever teaches their section, and routing them to the course
    // director for a button that reveals nothing would just mean the lockout lasts a day. The
    // narrowing that matters is on WHAT the action can do, not on who may do it.
    const { data: callerInstructor, error: instrErr } = await supabaseAdmin
      .from("instructors")
      .select("is_global_admin")
      .eq("id", caller.id)
      .maybeSingle();

    if (instrErr) return ok({ error: dbError("verify your account", instrErr) });
    if (!callerInstructor) return ok({ error: "Caller is not an instructor" });

    const isGlobalAdmin = callerInstructor.is_global_admin === true;

    if (!isGlobalAdmin) {
      const { data: staff } = await supabaseAdmin
        .from("staff_assignments")
        .select("id")
        .eq("instructor_id", caller.id)
        .eq("course_offering_id", courseOfferingId)
        .limit(1);

      if (!staff?.length) {
        return ok({ error: "You are not assigned to this course, so you cannot reset its students' passwords." });
      }
    }

    // ── The target must be a student of THIS offering ────────────────────────────────────
    // Authorization is per-offering, so the student has to be reached through it. Without this
    // join an instructor of Physics 110 could reset any cadet in the database by passing an
    // offering they staff and a student_id they do not teach.
    const { data: sections, error: sectErr } = await supabaseAdmin
      .from("sections")
      .select("id")
      .eq("course_offering_id", courseOfferingId);

    if (sectErr) return ok({ error: dbError("look up this course's sections", sectErr) });

    const sectionIds = (sections || []).map((s: { id: string }) => s.id);
    if (!sectionIds.length) return ok({ error: "This course has no sections." });

    const { data: enrollment, error: enrErr } = await supabaseAdmin
      .from("enrollments")
      .select("student_id, students!inner(student_id, name, auth_user_id)")
      .in("section_id", sectionIds)
      .eq("student_id", studentId)
      .limit(1)
      .maybeSingle();

    if (enrErr) return ok({ error: dbError("look up the student", enrErr) });
    if (!enrollment) return ok({ error: "That student is not enrolled in this course." });

    const student = enrollment.students as unknown as {
      student_id: number; name: string; auth_user_id: string | null;
    };

    if (!student.auth_user_id) {
      return ok({
        error: `${student.name} does not have a login yet. Use "Provision accounts" instead — ` +
               `that creates the account with the default password already set.`,
      });
    }

    // ── The reset ────────────────────────────────────────────────────────────────────────
    const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(
      student.auth_user_id,
      {
        password: defaultPasswordFor(student.student_id),
        app_metadata: { must_change_password: true },
      }
    );

    if (updErr) return ok({ error: dbError("reset the password", updErr) });

    // Deliberately NOT returning the password. The caller can derive it from the cadet ID they
    // already have; putting it in an HTTP response body would write it to any proxy log and
    // browser devtools history between here and the instructor's screen.
    return ok({
      success: true,
      student_id: student.student_id,
      name: student.name,
      must_change_password: true,
    });

  } catch (err) {
    return ok({ error: "Unexpected error: " + (err as Error).message });
  }
});
