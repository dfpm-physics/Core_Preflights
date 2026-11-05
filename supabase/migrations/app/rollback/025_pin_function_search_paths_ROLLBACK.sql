-- Rollback for 025_pin_function_search_paths.sql. Run as `prep_app_owner`.
--
-- Removes the stored search_path from the seven functions that 025 pinned, returning them to
-- resolving names through the caller's path. Changes no data and no function body. Roll back
-- only if a pinned function is refusing something legitimate; the unpinned state depends on
-- the caller's session path, which is the reason 025 exists.

BEGIN;

SET LOCAL search_path = app, public;

ALTER FUNCTION touch_updated_at()                          RESET search_path;
ALTER FUNCTION submissions_check_gradable()                RESET search_path;
ALTER FUNCTION submissions_lock_activity()                 RESET search_path;
ALTER FUNCTION grades_points_from_effort()                 RESET search_path;
ALTER FUNCTION assignment_offerings_snapshot_guard()       RESET search_path;
ALTER FUNCTION freeze_assignment_offering(uuid, boolean)   RESET search_path;
ALTER FUNCTION freeze_term(text, boolean)                  RESET search_path;

COMMIT;
