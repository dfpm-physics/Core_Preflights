-- ============================================================
-- 015_interaction_due_date.sql
-- Adds an OPTIONAL due date to lesson interactions so the faculty
-- dashboard can identify the "active" (next-due) lesson and frame the
-- others as past / today / upcoming — the Just-in-Time-Teaching view
-- ("what do I need to know before my next class?").
--
-- PURELY ADDITIVE. One nullable column on an existing table; no data is
-- altered and nothing depends on it being set. Interactions with a NULL
-- due_date are simply ordered by created_at as a fallback (see the
-- dashboard loader in site/app/js/faculty-data.js → loadFacultyDashboard).
-- Idempotent: safe to run more than once.
--
-- Single course-wide date (not the M-day/T-day split assignments use):
-- the dashboard's active-lesson spotlight is one lesson for the whole
-- director view, so a per-interaction date is enough. An M/T split could
-- be added later as two more nullable columns without a breaking change.
-- ============================================================

ALTER TABLE interactions
  ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ;

-- Order published lessons cheaply by their effective sequence date.
CREATE INDEX IF NOT EXISTS interactions_due_date_idx
  ON interactions (course_id, due_date);
