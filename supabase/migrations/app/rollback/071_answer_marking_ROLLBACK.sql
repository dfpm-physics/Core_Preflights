-- Rollback for 071_answer_marking.sql. Run as `prep_app_owner`.
-- Drops the three functions. Stored attempts and the grades written from them stay (they are data); a grade with
-- source auto_checked then simply stops being recomputed. Also puts the attempt uniqueness back to one number per student and
-- question; that step fails, and stops the rollback, if two items of one term already hold attempts of one shared question
-- with the same attempt number. Run before rolling back 070.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

ALTER TABLE question_attempts DROP CONSTRAINT question_attempts_unique;
ALTER TABLE question_attempts ADD CONSTRAINT question_attempts_unique UNIQUE (enrollment_id, question_id, attempt_no);

DROP FUNCTION record_answer(uuid, uuid, uuid, jsonb, text, boolean, uuid);
DROP FUNCTION answer_context(uuid, uuid, uuid);
DROP FUNCTION _answer_gate(uuid, uuid, uuid, boolean);

COMMIT;
