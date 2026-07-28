// PREP — Supabase connection config for the app portal (site/).
// Fill in your values from Supabase Project Settings → API.
// This file is safe to commit — the publishable key is protected by Row Level Security.
//
// Loaded as a CLASSIC script (not a module) AFTER the supabase-js CDN bundle, so it
// runs before any `<script type="module">` (modules are deferred). It defines the
// global `window.db` that js/supabase.js re-exports for the rest of the app.
//
// ── SCHEMA `app`, NOT `public` ────────────────────────────────────────────────
// Every query from site/ goes to the PREP v2 model in schema `app`. This is now the
// ONLY client on the site: the legacy pages that carried their own `public`-facing
// config (site/admin.html, site/interactions*.html, site/review.html, and the old
// site/index.html) were deleted at the 2026-07-28 promotion, so nothing served from
// this repo reads `public` any more. Schema `public` itself is untouched and remains
// the rollback (docs/operations/PREP-V2-CUTOVER.md, "Out of scope — dropping public").
//
// `db: { schema: 'app' }` sets the PostgREST profile headers (Accept-Profile on reads,
// Content-Profile on writes) for every db.from(...) call, so no call site needs to
// name the schema. db.auth and db.functions are schema-independent and unaffected.
//
// REQUIRES: `app` listed under Dashboard → Settings → API → Exposed schemas.
// Without it PostgREST cannot see the schema and every table 404s.

const SUPABASE_URL  = 'https://shzvpmlnqfmzfmuxkowi.supabase.co';
const SUPABASE_ANON = 'sb_publishable_wHlVYRPryp7fgByHaDujZw_AXvonsru';

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  db: { schema: 'app' },
});
window.db = db;
