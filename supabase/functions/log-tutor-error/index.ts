import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// log-tutor-error — record one tutor request failure a cadet actually saw.
//
// ── WHY THIS IS A FUNCTION AND NOT AN INSERT POLICY ──────────────────────────────────────────
// The Gemini backup lessons are standalone pages: no login, no Supabase client, no session.
// A cadet launches one from a link and types a cadet ID. There is therefore no authenticated
// identity to hang an RLS policy on, and giving `anon` INSERT on app.tutor_error_log would put
// an open, unvalidated write endpoint on a live table.
//
// So this is the only writer. It takes the public anon key like any other browser call, then
// validates, caps and WHITELISTS the payload before writing with the service role. The table
// has no write policy at all — see migration app/020.
//
// ── WHY IT IS UNAUTHENTICATED, WHICH IS THE POINT ────────────────────────────────────────────
// The whole reason this exists is the cadet who hits an error, gives up, and never submits.
// Nothing about that session reaches PREP today, so every diagnosis has been built from the
// survivors. Requiring a login here would preserve exactly that blind spot.
//
// The cost is that `cadet_id` is a CLAIM, not an identity — anyone can post any ID. That is
// acceptable precisely because nothing here grades, schedules or identifies: it is a diagnostic
// counter. Do not add a column to this table that anything downstream trusts.
//
// ── WHAT IT REFUSES TO STORE ─────────────────────────────────────────────────────────────────
// No conversation text, ever. The insert is built field by field from a fixed list — a
// whitelist, not a redactor — so a future caller cannot leak a cadet's writing by adding a key
// the server forgot to strip. CORE.md §3 bars free-text student writing paired with an
// identity, and this endpoint is on the wrong side of that line unless it is built this way.
// `detail` holds GOOGLE's error message, capped, never anything the cadet typed.
//
// ── ABUSE POSTURE ────────────────────────────────────────────────────────────────────────────
// It is a public write endpoint, so assume it will be hit. Every field is length-capped, the
// body is size-capped before parsing, `models` is capped in both length and per-entry shape,
// and the response says nothing useful to a prober. It is a diagnostic table with no read path
// for students and no effect on any grade, so the worst case is noise an instructor filters by
// date — not a breach and not a corrupted record.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Every response is HTTP 200 with { success } or { error }, matching the other functions:
// a non-2xx makes supabase-js throw FunctionsHttpError and hides the body. Here it matters
// even less than usual — the caller ignores the result entirely — but a lesson page that
// starts logging console errors about its own error logger is its own small problem.
const ok = (body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const MAX_BODY = 16 * 1024;      // a well-formed payload is ~2 KB
const MAX_MODELS = 12;           // the ladder is 6; twice that is generous

const str = (v: unknown, n: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, n) : null;
};
const int = (v: unknown, lo: number, hi: number): number => {
  const n = typeof v === "number" ? Math.trunc(v) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.min(hi, Math.max(lo, n));
};

// A cadet ID is a claim typed on an unauthenticated page. Shape-check it and store it; do not
// reject on a miss, because a typo'd ID on a failing session is itself worth seeing.
const cadet = (v: unknown): number | null => {
  const n = typeof v === "number" ? Math.trunc(v)
          : typeof v === "string" ? parseInt(v.replace(/\D/g, ""), 10) : NaN;
  return Number.isFinite(n) && n > 0 && n < 1e12 ? n : null;
};

// Counters only, and only these. Anything else in the object is dropped on the floor.
const models = (v: unknown) => {
  if (!Array.isArray(v)) return [];
  return v.slice(0, MAX_MODELS).map((m) => {
    const o = (m && typeof m === "object") ? m as Record<string, unknown> : {};
    const kinds: Record<string, number> = {};
    const k = o.kinds;
    if (k && typeof k === "object") {
      for (const [name, count] of Object.entries(k as Record<string, unknown>).slice(0, 10)) {
        kinds[String(name).slice(0, 40)] = int(count, 0, 100000);
      }
    }
    return {
      model: str(o.model, 60) ?? "?",
      calls: int(o.calls, 0, 100000),
      ok: int(o.ok, 0, 100000),
      fail: int(o.fail, 0, 100000),
      prompt_tokens: int(o.prompt_tokens, 0, 100000000),
      thinking_tokens: int(o.thinking_tokens, 0, 100000000),
      output_tokens: int(o.output_tokens, 0, 100000000),
      spent: o.spent === true,
      kinds,
    };
  });
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return ok({ error: "POST only" });

  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return ok({ error: "too large" });

    let p: Record<string, unknown>;
    try {
      p = JSON.parse(raw);
    } catch {
      return ok({ error: "bad json" });
    }

    const slug = str(p.slug, 120);
    if (!slug) return ok({ error: "slug required" });

    // THE WHITELIST. Every column, named once, from a checked accessor. Adding a field here
    // is a deliberate act; nothing arrives by being forgotten.
    const row = {
      slug,
      cadet_id: cadet(p.cadet_id),
      kind: str(p.kind, 40) ?? "unknown",
      http_status: int(p.http_status, 0, 599),
      finish_reason: str(p.finish_reason, 60),
      detail: str(p.detail, 300),
      model: str(p.model, 60),
      mode: str(p.mode, 20),
      phase: str(p.phase, 20),
      turn: int(p.turn, 0, 10000),
      session_sec: int(p.session_sec, 0, 86400),
      ladder_resets: int(p.ladder_resets, 0, 100),
      max_tokens: int(p.max_tokens, 0, 10000000),
      thinking_budget: int(p.thinking_budget, -1, 10000000),
      models: models(p.models),
      client: str(p.ua, 180),
    };

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { db: { schema: "app" }, auth: { persistSession: false } },
    );

    const { error } = await admin.from("tutor_error_log").insert(row);
    if (error) return ok({ error: error.message });
    return ok({ success: true });
  } catch (e) {
    // Never surface a stack to a public caller, and never fail loudly: the page calling this
    // is already showing the cadet one error.
    console.error("log-tutor-error:", e);
    return ok({ error: "failed" });
  }
});
