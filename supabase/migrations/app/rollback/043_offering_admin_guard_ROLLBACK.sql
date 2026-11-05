-- Rollback for 043_offering_admin_guard.sql. Run as `prep_app_owner`.
-- Drops the trigger and its function. A director of an offering can then change its active flag and delete it
-- through the API again, as the policy `offerings_write` allows. Holds no data and loses none.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

DROP TRIGGER course_offerings_admin_guard ON course_offerings;
DROP FUNCTION course_offerings_admin_guard();

COMMIT;
