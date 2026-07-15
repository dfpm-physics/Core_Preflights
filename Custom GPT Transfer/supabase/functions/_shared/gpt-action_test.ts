// Archived July 15, 2026; retained with the paused Custom GPT implementation.
import LZString from "npm:lz-string@1.5.0";
import { authenticateAction } from "./gpt-action.ts";
import { buildPrefillLink, normalizePrefill, PrefillError } from "./lesson-prefill.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function validPayload() {
  return {
    schema: 2,
    kind: "lesson_interaction_prefill",
    lesson: {
      id: "lesson-02-charge",
      course_id: "phys-215",
      title: "Charge and Coulomb's Law",
      description: null,
      lesson_number: 2,
      completion_policy: "interaction",
      due_date_m: null,
      due_date_t: "2026-08-20",
      objectives: [{ key: "charge-model", label: "Charge model" }],
      ignored_future_field: true,
    },
    interaction: {
      id: "lesson-02-charge",
      title: null,
      description: "Student-facing description",
      artifact_url: "https://chatgpt.com/example",
    },
    chat_input: {
      format: "markdown",
      source_filename: "lesson-02-input.md",
      markdown: "# Lesson 02\n\nUnicode: Δ, café, 中文\n\n~~~js\nconst x = '&';\n~~~",
    },
    ignored_future_field: { safe: true },
  };
}

Deno.test("prefill normalization and compressed link preserve Markdown exactly", () => {
  const payload = validPayload();
  const normalized = normalizePrefill(payload);
  assertEquals(normalized.interaction.title, payload.lesson.title, "interaction title fallback");
  assert(!("ignored_future_field" in normalized), "unknown root fields must not be packed");

  const link = buildPrefillLink(normalized);
  assert(link.url.startsWith("https://"), "link must use HTTPS");
  assert(link.url.length <= 24000, "link must satisfy the URL ceiling");
  const packed = new URL(link.url).hash.slice(4);
  const unpacked = LZString.decompressFromEncodedURIComponent(packed);
  assert(unpacked, "packed payload must decompress");
  const decoded = JSON.parse(unpacked);
  assertEquals(decoded.chat_input.markdown, payload.chat_input.markdown, "Markdown round trip");
  assertEquals(decoded.chat_input.source_filename, "lesson-02-input.md", "filename round trip");
});

Deno.test("prefill rejects a source filename containing a path", () => {
  const payload = validPayload();
  payload.chat_input.source_filename = "folder\\lesson.md";
  try {
    normalizePrefill(payload);
    throw new Error("expected invalid_prefill");
  } catch (error) {
    assert(error instanceof PrefillError, "expected PrefillError");
    assertEquals(error.code, "invalid_prefill", "error code");
  }
});

Deno.test("prefill enforces the Markdown UTF-8 byte ceiling", () => {
  const payload = validPayload();
  payload.chat_input.markdown = "😀".repeat(25001);
  try {
    normalizePrefill(payload);
    throw new Error("expected input_too_large");
  } catch (error) {
    assert(error instanceof PrefillError, "expected PrefillError");
    assertEquals(error.status, 413, "HTTP status");
    assertEquals(error.code, "input_too_large", "error code");
  }
});

Deno.test("Action bearer authentication accepts only the configured secret", async () => {
  const previous = Deno.env.get("GPT_ACTION_SECRET");
  const secret = "stage7-test-secret-that-is-at-least-32-characters";
  Deno.env.set("GPT_ACTION_SECRET", secret);
  try {
    const missing = await authenticateAction(new Request("https://example.test"));
    assertEquals(missing?.status, 401, "missing bearer status");

    const wrong = await authenticateAction(new Request("https://example.test", {
      headers: { Authorization: "Bearer wrong-secret" },
    }));
    assertEquals(wrong?.status, 401, "incorrect bearer status");

    const accepted = await authenticateAction(new Request("https://example.test", {
      headers: { Authorization: `Bearer ${secret}` },
    }));
    assertEquals(accepted, null, "correct bearer result");
  } finally {
    if (previous == null) Deno.env.delete("GPT_ACTION_SECRET");
    else Deno.env.set("GPT_ACTION_SECRET", previous);
  }
});
