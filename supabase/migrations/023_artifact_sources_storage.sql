-- Migration 023: artifact-sources Storage bucket + RLS
-- ============================================================================
-- Creates a PRIVATE Supabase Storage bucket holding the source of every Claude interaction
-- artifact this department has built — the .jsx itself, the parsed build record, and the review
-- sidecar the faculty Artifacts page writes. It is what lets `site/faculty/artifacts.html` show a
-- director what went into an artifact without the ~8 MB of .jsx living in the git repository.
--
-- Run in the Supabase SQL Editor with the SERVICE ROLE (Project > SQL Editor). The `storage`
-- schema requires elevated privileges, so this CANNOT be applied by the scoped
-- claude_code_recker DB role — same constraint as migration 019.
--
-- THIS DOES NOT NEED THE `app` UNSEAL. Every object created here lives in schema `storage`.
-- No table, column, policy or function in `app` is touched, so `prep_app_owner` stays NOLOGIN
-- and CORE.md section 0's coordination event does not apply.
--
-- Idempotent / re-runnable. Reversal: 023_artifact_sources_storage_ROLLBACK.sql, which returns
-- the project to having exactly one bucket (lesson-figures). Record application in CHANGELOG.md
-- per CORE.md section 5.
-- ============================================================================

-- ── The bucket ──────────────────────────────────────────────────────────────
-- PRIVATE, unlike lesson-figures. The .jsx is not a secret — claude.ai now shows an artifact's
-- formatted source behind a Code button, so anyone who can open the artifact can already read
-- it. The BUILD RECORD is a different matter: it carries grounding section and page numbers
-- (CORE.md section 6 — never surfaced to a cadet), the tutor system prompt, the misconception
-- taxonomy, and worked extension problems. Those are instructor-side by design.
--
-- 2 MB cap against a largest-known artifact of 250 KB, so a future artifact carrying embedded
-- figures still fits without a migration. text/plain covers .jsx (there is no registered type
-- for it, and plain text is what makes a browser render it as source rather than download it);
-- application/json covers index.json, build.json and review-notes.json.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('artifact-sources', 'artifact-sources', FALSE, 2097152,
        ARRAY['text/plain', 'application/json'])
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ── Read: any staff member ──────────────────────────────────────────────────
-- app.is_staff() is SECURITY DEFINER and owned by prep_app_owner, so it reads app.instructors
-- without the caller holding rights on that table. `authenticated` already has USAGE on schema
-- app and EXECUTE on its functions (app_schema_bootstrap.sql lines 118-129), which is what
-- makes this callable from a storage policy at all.
--
-- Note this is broader than the page's audience: every instructor may READ the library, because
-- an instructor teaching a section has a legitimate reason to see what their cadets are about to
-- work through. Writing is narrower, below.
DROP POLICY IF EXISTS "artifact-sources staff read" ON storage.objects;
CREATE POLICY "artifact-sources staff read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'artifact-sources' AND app.is_staff());


-- ── Write: a director of any offering, or a global admin ────────────────────
-- Reviewing an artifact is an authoring act, and CORE.md section 6 reserves those for a
-- director. The predicate is spelled out inline rather than wrapped in a helper because adding
-- a function to schema `app` would be DDL on the sealed schema; app.staff_assignments'
-- own `staff_read_own` policy (`instructor_id = current_uid()`) is what lets this EXISTS see
-- the caller's rows, so no new privilege is required.
--
-- It is deliberately NOT scoped per course. Object paths begin with a course *code*
-- ('phys-215/...') and mapping a code to a course uuid inside a storage policy would mean
-- either a join this policy cannot express cheaply or a new helper function — i.e. the unseal.
-- The narrowing that matters (staff cannot write; only directors can) is achieved; a director
-- of one course being able to write another's review sidecar is a real but small gap, and every
-- decision is attributed by name inside the JSON. Revisit if a second department ever shares
-- this project.
--
-- Ingest from scripts/artifacts/sync_artifacts.py uses the service_role key, which bypasses RLS
-- entirely — these four policies govern the browser, not the tooling.
DROP POLICY IF EXISTS "artifact-sources director insert" ON storage.objects;
CREATE POLICY "artifact-sources director insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'artifact-sources'
              AND (app.is_admin() OR EXISTS (
                     SELECT 1 FROM app.staff_assignments sa
                      WHERE sa.instructor_id = app.current_uid()
                        AND sa.role = 'director')));

DROP POLICY IF EXISTS "artifact-sources director update" ON storage.objects;
CREATE POLICY "artifact-sources director update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'artifact-sources'
         AND (app.is_admin() OR EXISTS (
                SELECT 1 FROM app.staff_assignments sa
                 WHERE sa.instructor_id = app.current_uid()
                   AND sa.role = 'director')))
  WITH CHECK (bucket_id = 'artifact-sources'
              AND (app.is_admin() OR EXISTS (
                     SELECT 1 FROM app.staff_assignments sa
                      WHERE sa.instructor_id = app.current_uid()
                        AND sa.role = 'director')));

DROP POLICY IF EXISTS "artifact-sources director delete" ON storage.objects;
CREATE POLICY "artifact-sources director delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'artifact-sources'
         AND (app.is_admin() OR EXISTS (
                SELECT 1 FROM app.staff_assignments sa
                 WHERE sa.instructor_id = app.current_uid()
                   AND sa.role = 'director')));


-- ── Verify (run these after applying; all four should read as stated) ───────
-- SELECT id, public, file_size_limit, allowed_mime_types
--   FROM storage.buckets WHERE id = 'artifact-sources';
--     -> one row, public = false, 2097152, {text/plain,application/json}
--
-- SELECT polname FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
--  WHERE c.relname = 'objects' AND polname LIKE 'artifact-sources%' ORDER BY 1;
--     -> exactly 4 rows: staff read, director insert, director update, director delete
--
-- The live probes that matter are NOT SQL, because a service-role session bypasses RLS and
-- would pass whatever you wrote. Run them from a browser, per the plan's Step 1 after-test:
--   1. signed out            -> downloading any object is refused
--   2. signed in as staff    -> read succeeds, upload is refused
--   3. signed in as director -> read and upload both succeed
