-- Rollback for 060_student_reads.sql. Run as `prep_app_owner`.
-- Takes the two grants back and restores `my_offerings()` as 002 defined it (active enrollments only).
-- Holds no data and loses none. After this, a cadet whose enrollments have completed no longer reads that term.
--
-- ORDER. Rollbacks run newest first, so the staff entry migration (065) is rolled back before this one. 065 keeps an
-- idempotent copy of the `gradebook_cells` grant but its rollback does not revoke it, so by the time this file runs
-- the grant is only this file's to take back, and it does. If this file is run FIRST while 065 is still applied (out
-- of order), the grant is left in place, because the staff pages still need it; a notice says so, and removing it
-- is `REVOKE EXECUTE ON FUNCTION app.gradebook_cells(uuid, text) FROM authenticated;` once 065 is rolled back.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

REVOKE EXECUTE ON FUNCTION my_course_total(uuid, text) FROM authenticated;

DO $$
BEGIN
  IF to_regprocedure('app.publish_column(uuid,uuid,boolean)') IS NOT NULL THEN
    RAISE NOTICE 'gradebook_cells left granted: the staff entry functions (065) are still applied. Roll 065 back first.';
  ELSE
    REVOKE EXECUTE ON FUNCTION gradebook_cells(uuid, text) FROM authenticated;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION my_offerings() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT DISTINCT s.course_offering_id
    FROM enrollments e JOIN sections s ON s.id = e.section_id
   WHERE e.student_id = my_student_id() AND e.status = 'active';
$$;

COMMIT;
