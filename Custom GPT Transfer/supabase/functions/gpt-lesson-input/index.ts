// Archived July 15, 2026; the deployed function remains live until explicitly removed.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  actionError,
  adminClient,
  authenticateAction,
  COURSE_ID_PATTERN,
  jsonResponse,
  LESSON_ID_PATTERN,
  methodNotAllowed,
  optionsResponse,
  queryParameter,
} from "../_shared/gpt-action.ts";

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "GET") return methodNotAllowed("GET");

  const authFailure = await authenticateAction(req);
  if (authFailure) return authFailure;

  const url = new URL(req.url);
  const courseId = queryParameter(url, "course_id", COURSE_ID_PATTERN);
  const lessonId = queryParameter(url, "lesson_id", LESSON_ID_PATTERN);
  if (!courseId || !lessonId) {
    return actionError(
      400,
      "invalid_request",
      "course_id and lesson_id are required and must be lowercase slugs.",
    );
  }

  const unavailable = () =>
    actionError(404, "not_found", "The requested published lesson input is unavailable.");

  try {
    const db = adminClient();
    const { data: lesson, error: lessonError } = await db
      .from("lessons")
      .select("id, course_id, lesson_number, title")
      .eq("id", lessonId)
      .eq("course_id", courseId)
      .eq("is_published", true)
      .maybeSingle();
    if (lessonError) throw new Error("lesson query failed");
    if (!lesson) return unavailable();

    const { data: input, error: inputError } = await db
      .from("lesson_chat_inputs")
      .select("markdown, source_filename, version, content_sha256, updated_at")
      .eq("lesson_id", lessonId)
      .maybeSingle();
    if (inputError) throw new Error("input query failed");
    if (!input) return unavailable();

    return jsonResponse({
      schema: 1,
      course_id: lesson.course_id,
      lesson_id: lesson.id,
      lesson_number: lesson.lesson_number,
      title: lesson.title,
      content_type: "text/markdown",
      source_filename: input.source_filename,
      version: input.version,
      content_sha256: input.content_sha256,
      updated_at: input.updated_at,
      markdown: input.markdown,
    });
  } catch {
    return actionError(500, "internal_error", "The published lesson input could not be retrieved.");
  }
}

if (import.meta.main) serve(handler);
