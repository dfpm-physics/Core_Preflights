-- Migration 019: lesson-figures Storage bucket + RLS
-- ============================================================================
-- Creates a PUBLIC Supabase Storage bucket for question/lesson figures uploaded from the faculty
-- lesson creator, plus row-level policies on storage.objects so any authenticated instructor may
-- upload/replace/remove, and everyone may read (public bucket → public URLs). This is what lets a
-- static GitHub Pages site accept drag-and-drop image uploads: the browser posts straight to
-- Supabase Storage and stores the returned public URL in questions[].figure_url — GitHub is never
-- written to.
--
-- Run in the Supabase SQL Editor with the SERVICE ROLE (Project > SQL Editor). The `storage` schema
-- requires elevated privileges, so this CANNOT be applied by the scoped claude_code_recker DB role.
-- Idempotent / re-runnable. Record application in CHANGELOG.md per CORE.md §5.
-- ============================================================================

-- The bucket. 5 MB cap, common web image types only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('lesson-figures', 'lesson-figures', TRUE, 5242880,
        ARRAY['image/png','image/jpeg','image/gif','image/webp','image/svg+xml'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public read. (A public bucket already serves public URLs without auth; this covers the
-- authenticated storage API path too.)
DROP POLICY IF EXISTS "lesson-figures public read" ON storage.objects;
CREATE POLICY "lesson-figures public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'lesson-figures');

-- Any authenticated instructor may upload figures (only directors reach the lesson-creator UI, but
-- gating on instructor membership is a safe, simple predicate).
DROP POLICY IF EXISTS "lesson-figures faculty insert" ON storage.objects;
CREATE POLICY "lesson-figures faculty insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'lesson-figures'
             AND EXISTS (SELECT 1 FROM public.instructors WHERE id = auth.uid()));

DROP POLICY IF EXISTS "lesson-figures faculty update" ON storage.objects;
CREATE POLICY "lesson-figures faculty update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'lesson-figures'
         AND EXISTS (SELECT 1 FROM public.instructors WHERE id = auth.uid()));

DROP POLICY IF EXISTS "lesson-figures faculty delete" ON storage.objects;
CREATE POLICY "lesson-figures faculty delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'lesson-figures'
         AND EXISTS (SELECT 1 FROM public.instructors WHERE id = auth.uid()));
