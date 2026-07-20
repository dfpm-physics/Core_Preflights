// PREP — Supabase connection config for the app portal (site/app/).
// Fill in your values from Supabase Project Settings → API.
// This file is safe to commit — the publishable key is protected by Row Level Security.
//
// Loaded as a CLASSIC script (not a module) AFTER the supabase-js CDN bundle, so it
// runs before any `<script type="module">` (modules are deferred). It defines the
// global `window.db` that js/supabase.js re-exports for the rest of the app.
//
// ── SCHEMA `app`, NOT `public` ────────────────────────────────────────────────
// Every query from site/app/ goes to the PREP v2 model in schema `app`. The legacy
// pages (site/admin.html, site/index.html) load their OWN config at site/js/config.js
// and stay pointed at `public`; the two clients are independent on purpose, so the
// legacy site keeps working untouched while this tree runs on the new model.
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
