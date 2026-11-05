-- Rollback for 059_key_version_guard.sql. Run as `prep_app_owner`.
-- Drops the trigger and its function. A director can then change or delete a replaced answer key version through
-- the API again, as the policy `question_keys_write_director` allows. Holds no data and loses none.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

DROP TRIGGER question_keys_old_version_guard ON question_keys;
DROP FUNCTION question_keys_old_version_guard();

COMMIT;
