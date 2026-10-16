import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// genai-mil-proxy — the server half of the GenAI.mil iPREP builds (`site/genai/<course>/`).
// The page speaks Google's generateContent shape; this function holds the key, translates to
// GenAI.mil's OpenAI shape, and translates the answer back. Ported from the local proxy in the
// AI Hub project (`projects/socratic-interaction/local/server.py`), which is where every rule
// below was measured.
//
// ── THE KEY ──────────────────────────────────────────────────────────────────────────────────
// A Supabase secret, never in the repo and never sent to a browser:
//
//     Dashboard → Edge Functions → Secrets → GENAI_MIL_API_KEY
//
// It is replaced about every 30 days. Replacing it is an edit of that one secret; nothing is
// redeployed. Separately, the key LOCKS every 14 days and only the named key holder can unlock
// it on GenAI.mil — that shows up here as an upstream 401 "locked", reported to the page as 503.
//
// Optional secrets: GENAI_MIL_MODEL (default below), GENAI_MIL_BASE_URL,
// GENAI_MIL_REQUIRE_STAFF ("1" by default — see below).
//
// ── STAFF-ONLY UNTIL SOMEONE OPENS IT ────────────────────────────────────────────────────────
// The pages are reachable by URL once pushed, but nothing links them for students. This gate is
// what actually keeps cadets out: a cadet who finds the URL gets "not open yet" on the start
// screen. Opening it is one secret: GENAI_MIL_REQUIRE_STAFF=0. The check reads `app.instructors`
// through the CALLER's token, so RLS decides who is staff, as in asksage-proxy.
//
// ── TWO RULES THAT ARE NOT OPTIONAL ──────────────────────────────────────────────────────────
// 1. GenAI.mil KEEPS ONLY THE LAST MESSAGE and still answers 200. So the whole conversation —
//    instructions first, then a labelled transcript — goes in ONE user message (FLATTEN). A
//    tutor without this answers turn one well and then forgets the lesson exists.
// 2. The model comes from the secret, never from the page's URL.
//
// ── AUDIT ────────────────────────────────────────────────────────────────────────────────────
// The key's terms require recording which user caused which call. One JSON line per call goes
// to the function log: auth user id, model, status, timing, token counts. NEVER conversation
// text (CORE.md §3). Free-tier function logs are short-lived; a durable audit table would need
// DDL on `app`, which is a separate coordinated change.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const BASE_URL = (Deno.env.get("GENAI_MIL_BASE_URL") || "https://api.genai.mil/v1").replace(/\/+$/, "");
const MODEL = Deno.env.get("GENAI_MIL_MODEL") || "gemini-3.7-flash";
const REQUIRE_STAFF = (Deno.env.get("GENAI_MIL_REQUIRE_STAFF") || "1") !== "0";

const MAX_BODY = 4 * 1024 * 1024;
// Supabase stops a function at ~150 s. One attempt may take up to 110 s (a report call takes
// ~30 s); a retry is attempted only while there is clearly time for it.
const ATTEMPT_TIMEOUT_MS = 110000;
const RETRY_WINDOW_MS = 30000;
const RETRYABLE = new Set([429, 500, 502]);
const MAX_RETRIES = 2;

const TUTOR_LABEL = "TUTOR";
const CADET_LABEL = "CADET";

// Real status codes here, unlike the other functions: the page uses plain fetch, not
// supabase-js, and its error handling branches on the status.
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
const fail = (status: number, message: string, extra: Record<string, unknown> = {}) =>
  json(status, { error: { code: status, message, ...extra } });

type Part = { text?: string };
type Turn = { role?: string; parts?: Part[] };

function flatten(body: Record<string, unknown>) {
  const sysi = (body.systemInstruction || {}) as { parts?: Part[] };
  const sysText = (sysi.parts || []).map((p) => p.text || "").join("");
  const lines: string[] = [];
  for (const t of (body.contents || []) as Turn[]) {
    const who = t.role === "model" ? TUTOR_LABEL : CADET_LABEL;
    lines.push(`${who}: ${(t.parts || []).map((p) => p.text || "").join("")}`);
  }
  const parts: string[] = [];
  if (sysText) parts.push(sysText);
  if (lines.length) parts.push("=== CONVERSATION SO FAR ===\n\n" + lines.join("\n\n"));
  parts.push(
    "=== YOUR TURN ===\n\n" +
      `Reply as ${TUTOR_LABEL}, continuing the conversation above. Write only your reply -- do not ` +
      "repeat the transcript and do not prefix your reply with a speaker label.",
  );
  const out: Record<string, unknown> = {
    model: MODEL,
    messages: [{ role: "user", content: parts.join("\n\n") }],
  };
  // thinkingConfig is Google's and has no OpenAI equivalent: dropped, because an unknown field
  // on a strict endpoint is a 400.
  const gen = (body.generationConfig || {}) as Record<string, unknown>;
  if (typeof gen.maxOutputTokens === "number") out.max_tokens = gen.maxOutputTokens;
  if (typeof gen.temperature === "number") out.temperature = gen.temperature;
  return { payload: out, sysChars: sysText.length, turns: lines.length };
}

function toGemini(data: Record<string, unknown>) {
  const choice = ((data.choices as unknown[]) || [{}])[0] as Record<string, unknown>;
  const text = ((choice.message || {}) as Record<string, unknown>).content || "";
  const finish = String(choice.finish_reason || "stop");
  const finishMap: Record<string, string> = {
    stop: "STOP", length: "MAX_TOKENS", content_filter: "SAFETY", tool_calls: "STOP",
  };
  const u = (data.usage || {}) as Record<string, unknown>;
  const meta: Record<string, unknown> = {
    promptTokenCount: u.prompt_tokens,
    candidatesTokenCount: u.completion_tokens,
    totalTokenCount: u.total_tokens,
  };
  // A missing cached count stays missing; a zero would read as "no caching".
  const cached = ((u.prompt_tokens_details || {}) as Record<string, unknown>).cached_tokens ??
    u.cached_tokens;
  if (cached != null) meta.cachedContentTokenCount = cached;
  for (const k of Object.keys(meta)) if (meta[k] == null) delete meta[k];
  return {
    candidates: [{
      content: { role: "model", parts: [{ text }] },
      finishReason: finishMap[finish] || finish.toUpperCase(),
    }],
    usageMetadata: meta,
  };
}

async function callUpstream(key: string, payload: unknown) {
  const t0 = Date.now();
  for (let attempt = 0; ; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ATTEMPT_TIMEOUT_MS);
    let status = 0, raw = "";
    try {
      const res = await fetch(BASE_URL + "/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctl.signal,
      });
      status = res.status;
      raw = await res.text();
    } catch (e) {
      raw = e instanceof Error ? e.name : "network";
    } finally {
      clearTimeout(timer);
    }
    const retry = (status === 0 || RETRYABLE.has(status)) && attempt < MAX_RETRIES &&
      Date.now() - t0 < RETRY_WINDOW_MS;
    if (!retry) return { status, raw };
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt + Math.random() * 300));
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const path = new URL(req.url).pathname;
  const isHealth = req.method === "GET" && path.endsWith("/health");
  const isGenerate = req.method === "POST" && path.includes("/models/") &&
    path.endsWith(":generateContent");
  if (!isHealth && !isGenerate) return fail(404, "unknown route");

  // ── Identity ─────────────────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return fail(401, "Sign in to PREP in this browser, then reload this page.");
  }
  const asCaller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    db: { schema: "app" },
  });
  const { data: { user } } = await asCaller.auth.getUser();
  if (!user) return fail(401, "Sign in to PREP in this browser, then reload this page.");

  if (REQUIRE_STAFF) {
    const { data: instr } = await asCaller
      .from("instructors").select("id").eq("id", user.id).maybeSingle();
    if (!instr) {
      return fail(403, "This GenAI.mil tutor is not open to students yet. Use one of the other options.");
    }
  }

  const key = Deno.env.get("GENAI_MIL_API_KEY") || "";
  if (isHealth) {
    // Length and presence only — never the value.
    return json(key ? 200 : 503, { ok: !!key, model: MODEL, key_present: !!key });
  }
  if (!key) return fail(503, "The course GenAI.mil key is not set on the server.");

  // ── Payload ──────────────────────────────────────────────────────────────────────────────
  const rawBody = await req.text();
  if (!rawBody || rawBody.length > MAX_BODY) return fail(400, "bad or oversized body");
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return fail(400, "body is not JSON");
  }

  const { payload, sysChars, turns } = flatten(body);
  const t0 = Date.now();
  const { status, raw } = await callUpstream(key, payload);
  const ms = Date.now() - t0;

  let data: Record<string, unknown> | null = null;
  try { data = JSON.parse(raw); } catch { /* non-JSON body */ }

  if (status === 200 && data) {
    const out = toGemini(data);
    const m = out.usageMetadata as Record<string, unknown>;
    console.log(JSON.stringify({
      audit: "genai-mil", who: user.id, model: MODEL, status: 200, ms, sys_chars: sysChars, turns,
      prompt_tokens: m.promptTokenCount, cached_tokens: m.cachedContentTokenCount,
      output_tokens: m.candidatesTokenCount,
    }));
    return json(200, out);
  }

  const upstreamMsg = String(((data?.error || {}) as Record<string, unknown>).message || raw || "")
    .slice(0, 300);
  console.log(JSON.stringify({
    audit: "genai-mil", who: user.id, model: MODEL, status, ms, sys_chars: sysChars, turns,
    error: upstreamMsg.slice(0, 200),
  }));

  // An upstream 401/403 is the COURSE key (locked, expired, model not enabled) — never the
  // cadet. Reported as 503 so the page does not tell a cadet to fix a key they never had; the
  // page's own 401/403 then mean only "not signed in" / "not open to you".
  if (status === 401 || status === 403) {
    const locked = /locked/i.test(raw);
    return fail(503, locked
      ? "The course GenAI.mil key is locked (it locks every 14 days). Tell your instructor."
      : "GenAI.mil refused the course key. Tell your instructor.", { upstream: status });
  }
  if (status === 0) return fail(502, "GenAI.mil did not answer.");
  return fail(status, upstreamMsg || `GenAI.mil returned ${status}`);
});
