-- Rollback of 090: removes the insert guard, so a submitter can again choose the workflow columns on INSERT (the forgery 090 closes).
-- Changes no row.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

DROP TRIGGER IF EXISTS feedback_insert_guard ON feedback;
DROP FUNCTION IF EXISTS feedback_insert_guard();

COMMIT;
