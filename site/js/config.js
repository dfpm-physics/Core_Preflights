// Physics 215 — Supabase connection config
// Fill in your values from Supabase Project Settings → API
// This file is safe to commit — anon key is protected by Row Level Security.

const SUPABASE_URL  = 'https://shzvpmlnqfmzfmuxkowi.supabase.co';
const SUPABASE_ANON = 'sb_publishable_wHlVYRPryp7fgByHaDujZw_AXvonsru';

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
