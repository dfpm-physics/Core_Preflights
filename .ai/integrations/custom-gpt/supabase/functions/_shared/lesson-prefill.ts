// Archived July 15, 2026; retained with the paused Custom GPT implementation.
import LZString from "npm:lz-string@1.5.0";

const SLUG = /^[a-z0-9-]{1,100}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const encoder = new TextEncoder();

export class PrefillError extends Error {
  constructor(
    public status: number,
    public code:
      | "invalid_request"
      | "input_too_large"
      | "invalid_prefill"
      | "prefill_too_large"
      | "internal_error",
    message: string,
    public details?: Record<string, number>,
  ) {
    super(message);
  }
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown, field: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PrefillError(422, "invalid_prefill", `${field} must be an object.`);
  }
  return value as JsonRecord;
}

function requiredString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new PrefillError(
      422,
      "invalid_prefill",
      `${field} must be nonblank and at most ${max} characters.`,
    );
  }
  return value.trim();
}

function optionalString(value: unknown, field: string, max: number): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > max) {
    throw new PrefillError(
      422,
      "invalid_prefill",
      `${field} must be null or at most ${max} characters.`,
    );
  }
  const normalized = value.trim();
  return normalized || null;
}

function slug(value: unknown, field: string): string {
  const normalized = requiredString(value, field, 100);
  if (!SLUG.test(normalized)) {
    throw new PrefillError(
      422,
      "invalid_prefill",
      `${field} must contain only lowercase letters, digits, and hyphens.`,
    );
  }
  return normalized;
}

function optionalDate(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || !DATE.test(value)) {
    throw new PrefillError(
      422,
      "invalid_prefill",
      `${field} must be null or a YYYY-MM-DD date.`,
    );
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new PrefillError(422, "invalid_prefill", `${field} is not a valid calendar date.`);
  }
  return value;
}

function lessonNumber(value: unknown): number | null {
  if (value == null) return null;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new PrefillError(
      422,
      "invalid_prefill",
      "lesson.lesson_number must be a nonnegative integer or null.",
    );
  }
  return value as number;
}

function objectives(value: unknown): Array<{ key: string; label: string }> {
  if (!Array.isArray(value) || value.length > 20) {
    throw new PrefillError(
      422,
      "invalid_prefill",
      "lesson.objectives must be an array with at most 20 items.",
    );
  }
  const seen = new Set<string>();
  return value.map((raw, index) => {
    const item = record(raw, `lesson.objectives[${index}]`);
    const key = slug(item.key, `lesson.objectives[${index}].key`);
    if (seen.has(key)) {
      throw new PrefillError(422, "invalid_prefill", "lesson.objectives keys must be unique.");
    }
    seen.add(key);
    if (typeof item.label !== "string" || item.label.length > 300) {
      throw new PrefillError(
        422,
        "invalid_prefill",
        `lesson.objectives[${index}].label must be at most 300 characters.`,
      );
    }
    return { key, label: item.label.trim() };
  });
}

function artifactUrl(value: unknown): string {
  const normalized = requiredString(value, "interaction.artifact_url", 2000);
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:") throw new Error("not https");
  } catch {
    throw new PrefillError(
      422,
      "invalid_prefill",
      "interaction.artifact_url must be an absolute HTTPS URL.",
    );
  }
  return normalized;
}

function sourceFilename(value: unknown): string | null {
  const normalized = optionalString(value, "chat_input.source_filename", 255);
  if (
    normalized
    && (normalized.includes("/") || normalized.includes(String.fromCharCode(92)))
  ) {
    throw new PrefillError(
      422,
      "invalid_prefill",
      "chat_input.source_filename must be a basename without a path.",
    );
  }
  return normalized;
}

export interface NormalizedPrefill {
  schema: 2;
  kind: "lesson_interaction_prefill";
  lesson: {
    id: string;
    course_id: string;
    title: string;
    description: string | null;
    lesson_number: number | null;
    completion_policy: "interaction" | "choice";
    due_date_m: string | null;
    due_date_t: string | null;
    objectives: Array<{ key: string; label: string }>;
  };
  interaction: {
    id: string;
    title: string;
    description: string | null;
    artifact_url: string;
  };
  chat_input: {
    format: "markdown";
    source_filename: string | null;
    markdown: string;
  };
}

export function normalizePrefill(value: unknown): NormalizedPrefill {
  const root = record(value, "request body");
  if (root.schema !== 2 || root.kind !== "lesson_interaction_prefill") {
    throw new PrefillError(
      422,
      "invalid_prefill",
      "schema must be 2 and kind must be lesson_interaction_prefill.",
    );
  }

  const lesson = record(root.lesson, "lesson");
  const interaction = record(root.interaction, "interaction");
  const chatInput = record(root.chat_input, "chat_input");
  const title = requiredString(lesson.title, "lesson.title", 300);
  const policy = lesson.completion_policy;
  if (policy !== "interaction" && policy !== "choice") {
    throw new PrefillError(
      422,
      "invalid_prefill",
      "lesson.completion_policy must be interaction or choice.",
    );
  }
  if (chatInput.format !== "markdown") {
    throw new PrefillError(422, "invalid_prefill", "chat_input.format must be markdown.");
  }
  if (typeof chatInput.markdown !== "string" || !chatInput.markdown.trim()) {
    throw new PrefillError(
      422,
      "invalid_prefill",
      "chat_input.markdown is required and cannot be blank.",
    );
  }
  const markdownBytes = encoder.encode(chatInput.markdown).length;
  if (markdownBytes > 100000) {
    throw new PrefillError(
      413,
      "input_too_large",
      "chat_input.markdown exceeds 100000 UTF-8 bytes.",
      { markdown_bytes: markdownBytes },
    );
  }

  const interactionTitle = optionalString(interaction.title, "interaction.title", 300) || title;
  return {
    schema: 2,
    kind: "lesson_interaction_prefill",
    lesson: {
      id: slug(lesson.id, "lesson.id"),
      course_id: slug(lesson.course_id, "lesson.course_id"),
      title,
      description: optionalString(lesson.description, "lesson.description", 2000),
      lesson_number: lessonNumber(lesson.lesson_number),
      completion_policy: policy,
      due_date_m: optionalDate(lesson.due_date_m, "lesson.due_date_m"),
      due_date_t: optionalDate(lesson.due_date_t, "lesson.due_date_t"),
      objectives: objectives(lesson.objectives),
    },
    interaction: {
      id: slug(interaction.id, "interaction.id"),
      title: interactionTitle,
      description: optionalString(interaction.description, "interaction.description", 2000),
      artifact_url: artifactUrl(interaction.artifact_url),
    },
    chat_input: {
      format: "markdown",
      source_filename: sourceFilename(chatInput.source_filename),
      markdown: chatInput.markdown,
    },
  };
}

export function buildPrefillLink(prefill: NormalizedPrefill): {
  url: string;
  rawBytes: number;
  packedCharacters: number;
} {
  const normalizedJson = JSON.stringify(prefill);
  const rawBytes = encoder.encode(normalizedJson).length;
  const packed = LZString.compressToEncodedURIComponent(normalizedJson);
  const configuredBase = Deno.env.get("FACULTY_LESSONS_URL")
    || "https://dfpm-physics.github.io/Core_Preflights/site/app/faculty/lessons.html";

  let base: URL;
  try {
    base = new URL(configuredBase);
    if (
      base.protocol !== "https:"
      || base.hash
      || base.username
      || base.password
    ) {
      throw new Error("invalid base");
    }
  } catch {
    throw new PrefillError(
      500,
      "internal_error",
      "The faculty lessons URL is not configured correctly.",
    );
  }

  const url = `${base.toString()}#lp=${packed}`;
  if (url.length > 24000) {
    throw new PrefillError(
      422,
      "prefill_too_large",
      "The compressed faculty link exceeds 24000 characters.",
      {
        raw_bytes: rawBytes,
        packed_characters: packed.length,
        url_characters: url.length,
      },
    );
  }
  return { url, rawBytes, packedCharacters: packed.length };
}
