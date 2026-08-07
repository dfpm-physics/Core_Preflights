-- Migration 023 ROLLBACK: remove the artifact-sources Storage bucket + RLS
-- ============================================================================
-- Reverses 023_artifact_sources_storage.sql completely, returning the project to exactly one
-- Storage bucket (lesson-figures) — the state recorded in
-- _snapshots/builder-import-2026-08-07/RESTORE-POINT.json.
--
-- Run in the Supabase SQL Editor with the SERVICE ROLE, same as the forward migration.
--
-- THIS SHIPS IN THE SAME COMMIT AS THE FORWARD MIGRATION, ON PURPOSE. A reversal written
-- after something has gone wrong is written by someone under pressure who is guessing at what
-- the forward change actually did. This one was written by someone who had just done it.
--
-- ============================================================================
-- ⚠ ORDER MATTERS, AND STEP 1 IS NOT OPTIONAL.
--
--   `DELETE FROM storage.buckets` FAILS while the bucket still holds objects (foreign key from
--   storage.objects). That failure is the good case. The bad case is reaching for a blind
--   `DELETE FROM storage.objects WHERE bucket_id = ...` to clear the way — which would destroy
--   any review decision a director had recorded on the site, with no copy anywhere.
--
--   So do this FIRST, outside SQL:
--
--       python scripts/artifacts/sync_artifacts.py pull-reviews --commit   # decisions -> git
--       python scripts/artifacts/sync_artifacts.py purge                   # dry run, read it
--       python scripts/artifacts/sync_artifacts.py purge --commit          # objects removed
--
--   `purge` deletes only the paths listed in the upload manifest it wrote, never a prefix
--   sweep, so an object somebody else put in this bucket is left alone and this script then
--   refuses to drop the bucket — which is the correct outcome, not an obstacle.
-- ============================================================================

-- 1) Confirm the bucket is empty. If this returns anything, STOP and run the purge above.
SELECT count(*) AS objects_remaining
  FROM storage.objects
 WHERE bucket_id = 'artifact-sources';


-- 2) The five policies. Safe to run whether or not they exist.
--    Four on storage.objects, and one on storage.buckets — that last one exists because a
--    PRIVATE bucket's row is otherwise invisible to `authenticated` and every download fails as
--    "Bucket not found". Dropping it returns storage.buckets to having no policies at all,
--    which is the state this project was in before migration 023.
DROP POLICY IF EXISTS "artifact-sources bucket visible to staff" ON storage.buckets;
DROP POLICY IF EXISTS "artifact-sources staff read"      ON storage.objects;
DROP POLICY IF EXISTS "artifact-sources director insert"  ON storage.objects;
DROP POLICY IF EXISTS "artifact-sources director update"  ON storage.objects;
DROP POLICY IF EXISTS "artifact-sources director delete"  ON storage.objects;


-- 3) The bucket. Errors if objects remain — deliberately. See the warning above.
DELETE FROM storage.buckets WHERE id = 'artifact-sources';


-- ── Verify the reversal ─────────────────────────────────────────────────────
-- SELECT id FROM storage.buckets ORDER BY 1;
--     -> exactly one row: lesson-figures
--
-- SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
--  WHERE c.relname = 'objects' AND p.polname LIKE 'artifact-sources%';
--     -> 0
--
-- Then, from the repo, the real proof:
--     python scripts/artifacts/restore_point.py verify
--     -> "Storage buckets" and "bucket 'artifact-sources' absent" both ok
--
-- NOTHING ELSE NEEDS REVERSING HERE. Migration 023 creates no table, no column, no function
-- and no row in `app` or `public`; the faculty page reads app.activities but never writes it.
-- Undoing the repository half is a separate lever (`git revert`), and the two are independent
-- — you can drop this bucket with the page still deployed, and the page will simply report
-- that it cannot reach the library.
