import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// asksage-proxy — forward ONE tutor turn to Ask Sage and hand back the reply plus its token
// usage. This is also the ANSWER TO "where does the API key live".
//
// ── WHY A FUNCTION, AND NOT A KEY IN THE PAGE ────────────────────────────────────────────────
// The site is static HTML on GitHub Pages (CORE.md §2). Anything the browser can read, anyone
// can read: a key in `config.js`, in a data file, or fetched from Storage is a key published to
// the internet. The existing Gemini backup builds dodge this by making each CADET paste their
// OWN key, which is exactly the thing this trial is trying to stop doing.
//
// So the key is a SUPABASE SECRET. It exists only in the function's environment, is never sent
// to a browser, and is never committed:
//
//     supabase secrets set ASKSAGE_API_KEY=<the key>
//     supabase functions deploy asksage-proxy
//
// One key serves every model, which is what was asked for — the model is a request FIELD, not a
// credential. Rotating it is one `secrets set` and no redeploy of anything else.
//
// ── WHY STAFF-ONLY, FOR NOW ──────────────────────────────────────────────────────────────────
// The pool is 10M tokens a month and a single iPREP session is measured in HUNDREDS OF
// THOUSANDS. Until the trial has produced real numbers, an endpoint any signed-in cadet can
// call is an endpoint that can empty the month's budget in an afternoon, by accident, with
// nothing to stop it. `REQUIRE_STAFF` below is what holds that line; opening it to students is
// a deliberate later change, made once the arithmetic is known and a per-student cap exists.
//
// The gate is a real identity check, not a UI convenience: the caller's own JWT is used to read
// `app.instructors`, so RLS decides, not this file.
//
// ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────────────────────────
// It does not store the conversation. CORE.md §3 bars free-text student writing paired with an
// identity, and a proxy that logged prompts would be a database full of exactly that. Token
// COUNTS come back to the caller and are tallied in the browser; nothing is written to any
// table here.
//
// It also does not stream. A streamed reply cannot carry a `usage` object at the end of a plain
// fetch, and usage is the entire point of this trial. Streaming is a later change, and it is
// the reason `stream` is refused rather than ignored.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Every response is HTTP 200 with { success } or { error }, matching the other functions here:
// a non-2xx makes supabase-js throw FunctionsHttpError and hides the body, so the caller would
// lose the very message that says what went wrong.
const ok = (body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Ask Sage's OpenAI-compatible surface. Chosen over the native /server/query endpoint for two
// reasons the trial depends on: it takes a `messages` ARRAY with a `system` role, which is the
// shape an iPREP turn already has, and its response carries a `usage` object with
// prompt_tokens / completion_tokens / total_tokens — the numbers being measured.
const ASKSAGE_URL = "https://api.asksage.ai/server/openai/v1/chat/completions";

// Overridable so a new model can be trialled without editing this file, but NOT open-ended.
// An allowlist on a shared token pool is a spend control: a caller cannot reach for a model
// nobody costed by typing its name.
const DEFAULT_MODELS = "gemini-3.5-flash,claude-opus-4-6";
const ALLOWED = new Set(
  (Deno.env.get("ASKSAGE_MODELS") || DEFAULT_MODELS).split(",").map((s) => s.trim()).filter(Boolean),
);

const REQUIRE_STAFF = (Deno.env.get("ASKSAGE_REQUIRE_STAFF") || "1") !== "0";

// A whole lesson's system prompt is the big one: the largest build measured 147,652 characters
// before any conversation is added. A megabyte leaves real headroom for that plus a full
// history, and still refuses anything absurd before it is parsed.
const MAX_BODY = 1024 * 1024;
const MAX_MESSAGES = 240;
const MAX_CONTENT = 400 * 1024;
const UPSTREAM_TIMEOUT_MS = 120000;

type Msg = { role: string; content: string };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return ok({ error: "POST only" });

  const key = Deno.env.get("ASKSAGE_API_KEY");
  if (!key) return ok({ error: "Server is not configured with an Ask Sage key." });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;

  // ── Identity ───────────────────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return ok({ error: "Sign-in required." });

  const asCaller = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    db: { schema: "app" },
  });

  const { data: { user } } = await asCaller.auth.getUser();
  if (!user) return ok({ error: "Sign-in required." });

  if (REQUIRE_STAFF) {
    // Read through the CALLER's token on purpose. RLS answers "what may you see", which is the
    // right question here: a row coming back means this user really is staff. Doing the same
    // lookup with the service role would answer a different question and always say yes.
    const { data: instr } = await asCaller
      .from("instructors").select("id").eq("id", user.id).maybeSingle();
    if (!instr) {
      return ok({ error: "This endpoint is limited to staff during the Ask Sage token trial." });
    }
  }

  // ── Payload ────────────────────────────────────────────────────────────────────────────────
  const raw = await req.text();
  if (raw.length > MAX_BODY) return ok({ error: "Request too large." });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return ok({ error: "Malformed JSON." });
  }

  if (body.stream) {
    return ok({ error: "Streaming is not supported here — the usage totals arrive only on a whole response." });
  }

  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!ALLOWED.has(model)) {
    return ok({ error: `Model not allowed. Allowed: ${[...ALLOWED].join(", ")}` });
  }

  const system = typeof body.system === "string" ? body.system : "";
  const inMsgs = Array.isArray(body.messages) ? body.messages : [];
  if (!inMsgs.length) return ok({ error: "messages is required and must be non-empty." });
  if (inMsgs.length > MAX_MESSAGES) return ok({ error: "Too many messages." });

  const messages: Msg[] = [];
  if (system) {
    if (system.length > MAX_CONTENT) return ok({ error: "System prompt too large." });
    messages.push({ role: "system", content: system });
  }
  for (const m of inMsgs) {
    const o = (m && typeof m === "object") ? m as Record<string, unknown> : {};
    const role = o.role === "assistant" ? "assistant" : o.role === "system" ? "system" : "user";
    const content = typeof o.content === "string" ? o.content : "";
    if (!content) continue;
    if (content.length > MAX_CONTENT) return ok({ error: "A message is too large." });
    messages.push({ role, content });
  }
  if (!messages.some((m) => m.role !== "system")) {
    return ok({ error: "messages must contain at least one user or assistant turn." });
  }

  const maxTokens = Number.isFinite(body.max_tokens as number)
    ? Math.min(32768, Math.max(64, Math.trunc(body.max_tokens as number)))
    : 4096;
  const temperature = Number.isFinite(body.temperature as number)
    ? Math.min(2, Math.max(0, body.temperature as number))
    : 0.7;

  // ── Upstream ───────────────────────────────────────────────────────────────────────────────
  const t0 = Date.now();
  const ctl = new AbortController();
  const deadline = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(ASKSAGE_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
      signal: ctl.signal,
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return ok({
      error: aborted
        ? `Ask Sage did not answer within ${UPSTREAM_TIMEOUT_MS / 1000}s.`
        : "Could not reach Ask Sage.",
      ms: Date.now() - t0,
    });
  } finally {
    clearTimeout(deadline);
  }

  const text = await res.text();
  const ms = Date.now() - t0;

  if (!res.ok) {
    // Pass Ask Sage's own wording through, capped. Guessing at a cause is what makes a 400, a
    // 401 and a 403 all read as "auth" — three different problems with three different fixes.
    // The key itself is never in this string; it rides in a request header and is not echoed.
    return ok({ error: `Ask Sage returned ${res.status}`, detail: text.slice(0, 600), ms });
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    return ok({ error: "Ask Sage returned a non-JSON body.", detail: text.slice(0, 600), ms });
  }

  const choice = (Array.isArray(data.choices) ? data.choices[0] : null) as
    Record<string, unknown> | null;
  const message = (choice?.message ?? null) as Record<string, unknown> | null;
  const reply = typeof message?.content === "string" ? message.content : "";

  // `usage` is the reason this endpoint exists, so its ABSENCE is reported rather than
  // defaulted to zero. A silent zero would read as "this turn was free", which is the single
  // most misleading number the trial could produce.
  const usage = (data.usage ?? null) as Record<string, unknown> | null;

  return ok({
    success: true,
    text: reply,
    finish_reason: choice?.finish_reason ?? null,
    model: data.model ?? model,
    usage,
    usage_missing: !usage,
    ms,
  });
});
