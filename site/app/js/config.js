// Physics Preflights — Supabase connection config
// Fill in your values from Supabase Project Settings → API
// This file is safe to commit — anon key is protected by Row Level Security.
//
// Loaded as a CLASSIC script (not a module) AFTER the supabase-js CDN bundle, so it
// runs before any `<script type="module">` (modules are deferred). It defines the
// global `window.db` that js/supabase.js re-exports for the rest of the app.

const SUPABASE_URL  = 'https://shzvpmlnqfmzfmuxkowi.supabase.co';
const SUPABASE_ANON = 'sb_publishable_wHlVYRPryp7fgByHaDujZw_AXvonsru';

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
window.db = db;
