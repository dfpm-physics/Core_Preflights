-- Rollback for 073_student_homework.sql. Run as `prep_app_owner`.
-- Drops the one function. Nothing is stored by it, so nothing else changes.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

DROP FUNCTION student_homework(uuid);

COMMIT;
