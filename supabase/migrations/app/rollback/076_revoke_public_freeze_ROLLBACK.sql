-- Rollback for 076_revoke_public_freeze.sql. Run as `prep_app_owner`. Gives the two freeze functions back to PUBLIC, as before.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

GRANT EXECUTE ON FUNCTION freeze_assignment_offering(uuid, boolean) TO PUBLIC;
GRANT EXECUTE ON FUNCTION freeze_term(text, boolean) TO PUBLIC;

COMMIT;
