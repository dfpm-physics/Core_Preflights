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

//
// ── WHICH DATABASE ────────────────────────────────────────────────────────────
// Production is chosen ONLY on the exact published address. Every other address --
// localhost, a file, a staging site under the same github.io host -- gets staging. So a
// new or unexpected address can never reach live data by default; the mistake that is
// possible is a live page on staging, which is loud, and not the other way round.
//
// A staging entry with no key throws rather than falling back. An empty site is the
// right failure.
//
// The 92 lesson pages in site/gemini/ and site/genai/ do NOT load this file. They carry the
// production values themselves. Serve locally with scripts/staging/serve_local.py, which
// covers them; plain `python -m http.server` does not. Both publishable keys are public by
// design: RLS is what protects the data.

const PREP_PROD = {
  url: 'https://shzvpmlnqfmzfmuxkowi.supabase.co',
  anon: 'sb_publishable_wHlVYRPryp7fgByHaDujZw_AXvonsru',
};
const PREP_STAGING = {
  url: 'https://wkibeptktbnaddfynrwr.supabase.co',
  anon: 'sb_publishable_x5LGaqE9MbNDh0RLY01IZw_mmR1mnef',
};

const PREP_IS_LIVE_ADDRESS = location.hostname === 'dfpm-physics.github.io'
  && location.pathname.startsWith('/Core_Preflights/');
const PREP_TARGET = PREP_IS_LIVE_ADDRESS ? PREP_PROD : PREP_STAGING;
if (!PREP_TARGET.anon) {
  throw new Error('PREP: this address uses the staging database, and config.js has no staging key.');
}

const SUPABASE_URL  = PREP_TARGET.url;
const SUPABASE_ANON = PREP_TARGET.anon;

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  db: { schema: 'app' },
});
window.db = db;
