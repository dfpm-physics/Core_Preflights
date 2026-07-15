// Archived July 15, 2026; the deployed function remains live until explicitly removed.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  actionError,
  authenticateAction,
  jsonResponse,
  methodNotAllowed,
  optionsResponse,
} from "../_shared/gpt-action.ts";
import {
  buildPrefillLink,
  normalizePrefill,
  PrefillError,
} from "../_shared/lesson-prefill.ts";

const encoder = new TextEncoder();
const MAX_REQUEST_BYTES = 300000;

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return methodNotAllowed("POST");

  const authFailure = await authenticateAction(req);
  if (authFailure) return authFailure;

  try {
    const contentLength = Number(req.headers.get("Content-Length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      return actionError(413, "input_too_large", "The Action request is too large.");
    }

    const raw = await req.text();
    if (encoder.encode(raw).length > MAX_REQUEST_BYTES) {
      return actionError(413, "input_too_large", "The Action request is too large.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return actionError(400, "invalid_request", "The request body must be valid JSON.");
    }

    const normalized = normalizePrefill(parsed);
    const link = buildPrefillLink(normalized);
    return jsonResponse({
      schema: 1,
      url: link.url,
      raw_bytes: link.rawBytes,
      packed_characters: link.packedCharacters,
      expires_at: null,
    });
  } catch (error) {
    if (error instanceof PrefillError) {
      const body: Record<string, unknown> = {
        error: { code: error.code, message: error.message },
      };
      if (error.details) body.measurements = error.details;
      return jsonResponse(body, error.status);
    }
    return actionError(500, "internal_error", "The faculty link could not be created.");
  }
}

if (import.meta.main) serve(handler);
