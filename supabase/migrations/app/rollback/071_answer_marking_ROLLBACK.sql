-- Rollback for 071_answer_marking.sql. Run as `prep_app_owner`.
-- Drops the three functions. Stored attempts and the grades written from them stay (they are data); a grade with
-- source auto_checked then simply stops being recomputed. Run before rolling back 070.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

DROP FUNCTION record_answer(uuid, uuid, uuid, jsonb, text, boolean, uuid);
DROP FUNCTION answer_context(uuid, uuid, uuid);
DROP FUNCTION _answer_gate(uuid, uuid, uuid, boolean);

COMMIT;
