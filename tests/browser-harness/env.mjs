// env.mjs -- the test-faculty login for the browser harness. STAGING ONLY.
//
// These scripts drive a local server (scripts/staging/serve_local.py), which can reach the staging
// project and not production. The login is the seeded staging director (made by
// scripts/staging/seed_staging.py: an invented person whose password follows the site's documented
// default rule), so nothing is read from disk and no credential file is opened here. A different
// staging login can be supplied through the environment (PREP_TEST_FACULTY_EMAIL / _PASSWORD / _UID).

/**
 * Chrome launch flag: the production API host does not resolve inside the browser the harness
 * drives. Several lesson pages under site/gemini/ and site/genai/ carry their own copy of the
 * production address, so config.js choosing staging does not cover them; this does.
 */
export const NO_PRODUCTION_ARG = '--host-resolver-rules=MAP shzvpmlnqfmzfmuxkowi.supabase.co ~NOTFOUND';

/** The test-faculty triple. Any field may be overridden from the environment. */
export function testFaculty() {
  return {
    email: process.env.PREP_TEST_FACULTY_EMAIL || 'director@prep-staging.example',
    password: process.env.PREP_TEST_FACULTY_PASSWORD || 'director1234',
    uid: process.env.PREP_TEST_FACULTY_UID,
  };
}
