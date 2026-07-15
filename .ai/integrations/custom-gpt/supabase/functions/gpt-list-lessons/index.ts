// Archived July 15, 2026; the deployed function remains live until explicitly removed.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  actionError,
  adminClient,
  authenticateAction,
  COURSE_ID_PATTERN,
  jsonResponse,
  methodNotAllowed,
  optionsResponse,
  queryParameter,
} from "../_shared/gpt-action.ts";

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "GET") return methodNotAllowed("GET");

  const authFailure = await authenticateAction(req);
  if (authFailure) return authFailure;

  const courseId = queryParameter(new URL(req.url), "course_id", COURSE_ID_PATTERN);
  if (!courseId) {
    return actionError(400, "invalid_request", "course_id is required and must be a lowercase slug.");
  }

  try {
    const db = adminClient();
    const { data: course, error: courseError } = await db
      .from("courses")
      .select("id, title")
      .eq("id", courseId)
      .maybeSingle();
    if (courseError) throw new Error("course query failed");
    if (!course) {
      return actionError(404, "not_found", "The requested course is unavailable.");
    }

    const { data: lessons, error: lessonsError } = await db
      .from("lessons")
      .select("id, lesson_number, title, description, completion_policy")
      .eq("course_id", courseId)
      .eq("is_published", true)
      .order("lesson_number", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true });
    if (lessonsError) throw new Error("lesson query failed");

    const lessonIds = (lessons || []).map((lesson) => lesson.id);
    let inputs: Array<{ lesson_id: string; version: number }> = [];
    if (lessonIds.length) {
      const { data, error } = await db
        .from("lesson_chat_inputs")
        .select("lesson_id, version")
        .in("lesson_id", lessonIds);
      if (error) throw new Error("input metadata query failed");
      inputs = data || [];
    }
    const inputVersions = new Map(inputs.map((input) => [input.lesson_id, input.version]));

    return jsonResponse({
      schema: 1,
      course: { id: course.id, title: course.title || course.id },
      lessons: (lessons || []).map((lesson) => {
        const inputVersion = inputVersions.get(lesson.id) ?? null;
        return {
          lesson_id: lesson.id,
          lesson_number: lesson.lesson_number,
          title: lesson.title,
          description: lesson.description,
          completion_policy: lesson.completion_policy,
          input_available: inputVersion !== null,
          input_version: inputVersion,
          next_action: inputVersion === null
            ? null
            : {
              operation_id: "getLessonChatInput",
              arguments: { course_id: courseId, lesson_id: lesson.id },
            },
        };
      }),
    });
  } catch {
    return actionError(500, "internal_error", "The published lesson catalog could not be retrieved.");
  }
}

if (import.meta.main) serve(handler);
