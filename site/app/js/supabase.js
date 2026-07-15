// supabase.js — re-export the single global Supabase client created in config.js.
//
// config.js is a classic (blocking) script and runs before any deferred module, so
// window.db is guaranteed to exist here. We reuse the ONE client so the persisted auth
// session (localStorage) is shared across every page — never create a second client.

if (!window.db) {
  throw new Error(
    '[Preflights] window.db is undefined. Ensure the supabase-js CDN and js/config.js ' +
    'load as classic <script> tags BEFORE any <script type="module"> in the page <head>.'
  );
}

export const db = window.db;
