// Archived July 15, 2026; the deployed Custom GPT Action remains live until explicitly removed.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const FACULTY_ORIGIN = "https://dfpm-physics.github.io";
const encoder = new TextEncoder();

const baseHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": FACULTY_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "Vary": "Origin",
};

export type ActionErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "not_found"
  | "input_too_large"
  | "invalid_prefill"
  | "prefill_too_large"
  | "internal_error";

export function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...baseHeaders, ...headers },
  });
}

export function actionError(status: number, code: ActionErrorCode, message: string): Response {
  const headers: Record<string, string> =
    status === 401 ? { "WWW-Authenticate": "Bearer" } : {};
  return jsonResponse({ error: { code, message } }, status, headers);
}

export function optionsResponse(): Response {
  const headers = { ...baseHeaders };
  delete headers["Content-Type"];
  return new Response(null, { status: 204, headers });
}

export function methodNotAllowed(allowed: string): Response {
  return jsonResponse(
    { error: { code: "invalid_request", message: `Use ${allowed} for this operation.` } },
    405,
    { Allow: allowed },
  );
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function authenticateAction(req: Request): Promise<Response | null> {
  const configuredSecret = Deno.env.get("GPT_ACTION_SECRET");
  if (!configuredSecret || configuredSecret.length < 32) {
    return actionError(500, "internal_error", "The Action endpoint is not configured.");
  }

  const match = req.headers.get("Authorization")?.match(/^Bearer[ \t]+(.+)$/i);
  if (!match) {
    return actionError(401, "unauthorized", "A valid Action bearer token is required.");
  }

  const [actualHash, expectedHash] = await Promise.all([
    sha256(match[1]),
    sha256(configuredSecret),
  ]);
  if (!constantTimeEqual(actualHash, expectedHash)) {
    return actionError(401, "unauthorized", "A valid Action bearer token is required.");
  }
  return null;
}

function secretKey(): string | null {
  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacyKey) return legacyKey;

  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!secretKeys) return null;
  try {
    const parsed = JSON.parse(secretKeys) as Record<string, string>;
    return parsed.default || Object.values(parsed)[0] || null;
  } catch {
    return null;
  }
}

export function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = secretKey();
  if (!url || !key) throw new Error("Missing Supabase server credentials");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function queryParameter(url: URL, name: string, pattern: RegExp): string | null {
  const value = url.searchParams.get(name)?.trim() || "";
  return pattern.test(value) ? value : null;
}

export const COURSE_ID_PATTERN = /^[a-z0-9-]{1,100}$/;
export const LESSON_ID_PATTERN = /^[a-z0-9-]{1,100}$/;
