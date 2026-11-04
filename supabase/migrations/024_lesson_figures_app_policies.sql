-- Migration 024: lesson-figures Storage policies, gated on schema `app` instead of `public`
-- ============================================================================
-- Run as `postgres` (Supabase SQL Editor). The `storage` schema needs elevated privileges, same
-- constraint as migrations 019 and 023. Idempotent / re-runnable.
--
-- WHY THIS EXISTS
--   019 creates the bucket and gates uploads on `EXISTS (SELECT 1 FROM public.instructors ...)`.
--   That has two problems for PREP v2:
--     1. A database built from the `app` chain has no `public.instructors`, so 019 cannot run
--        on it at all. The staging project is such a database.
--     2. In production the gate still reads the retired `public` model, which CORE.md section 0
--        says no served page depends on, and which is meant to be droppable one day. Dropping
--        it would quietly break figure upload.
--   This file makes the bucket the same as 019 and gates on `app.is_staff()`, as 023 already does.
--
-- PRODUCTION: not applied (2026-11-04). It replaces 019's policies by name, so it is safe to
-- run there at the v2 cutover. Staff in `app.instructors` keep the access they have today.
-- ============================================================================

-- The bucket, exactly as 019 defines it.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('lesson-figures', 'lesson-figures', TRUE, 5242880,
        ARRAY['image/png','image/jpeg','image/gif','image/webp','image/svg+xml'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "lesson-figures public read" ON storage.objects;
CREATE POLICY "lesson-figures public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'lesson-figures');

DROP POLICY IF EXISTS "lesson-figures faculty insert" ON storage.objects;
CREATE POLICY "lesson-figures faculty insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'lesson-figures' AND app.is_staff());

DROP POLICY IF EXISTS "lesson-figures faculty update" ON storage.objects;
CREATE POLICY "lesson-figures faculty update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'lesson-figures' AND app.is_staff());

DROP POLICY IF EXISTS "lesson-figures faculty delete" ON storage.objects;
CREATE POLICY "lesson-figures faculty delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'lesson-figures' AND app.is_staff());
