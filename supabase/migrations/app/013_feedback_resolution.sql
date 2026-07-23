-- PREP v2 — resolution state for in-app feedback
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 012_feedback.sql.
--
-- WHY THIS EXISTS
--   012 gave instructors somewhere to put a comment. It gave nobody anywhere to answer one. A
--   suggestion box that is never visibly acted on stops being used by about week three — the same
--   failure mode the roadmap predicts for one-at-a-time EI logging — so the point of this migration
--   is not storage, it is CLOSURE: every comment reaches a decision, and an accepted one has a
--   recorded destination.
--
-- THE CONTRACT THE ROADMAP SKILL WILL QUERY (not built yet — deliberately)
--   The director's plan is that accepted feedback gets rolled into docs/ROADMAP.md by a skill. That
--   skill needs an unambiguous work list, and this is it:
--
--       SELECT * FROM app.feedback WHERE status = 'accepted' AND roadmap_ref IS NULL;
--
--   i.e. "agreed to, not yet written down". When the skill lands the item it stamps `roadmap_ref`
--   with the roadmap's own id ('P1.16'), and the row leaves the work list forever. That is why
--   there is no 'roadmapped' STATUS: a status would have to be kept in step with the roadmap by
--   hand, whereas `roadmap_ref IS NULL` cannot drift from the thing it describes. One fact, one
--   column.
--
-- WHY FOUR STATUSES AND NOT MORE
--   'new' / 'accepted' / 'declined' / 'duplicate'. Triage needs exactly the decisions somebody will
--   actually make on a Friday afternoon. 'wontfix' is 'declined'; 'in progress' belongs to the
--   roadmap, not here; a 'done' state would make this table a second, worse issue tracker competing
--   with the roadmap it feeds. The moment an item is real work, the roadmap owns it.
--
-- EVERY ROW IS A FREE RESPONSE, SO NOTHING IS FILTERED
--   Worth stating because the admin view is specified as being "only for free responses": in 012
--   `message` is NOT NULL with a non-blank CHECK while the like/dislike sentiment is OPTIONAL. So
--   there is no such thing as a bare-reaction row — every row already carries a comment, and the
--   view resolves all of them. The sentiment is context shown beside the text, never the subject.
--
-- SITE ADMINS ONLY, AND THAT IS A DELIBERATE NARROWING
--   012 already restricted SELECT to is_admin() (= instructors.is_global_admin). The UPDATE policy
--   below matches it rather than widening to directors. Feedback is course-wide product input and
--   frequently names a colleague's page as confusing; letting every director edit the resolution of
--   a comment about somebody else's screen invites exactly the argument the box exists to avoid.

BEGIN;

SET LOCAL search_path = app, public;

ALTER TABLE feedback
  -- Untriaged until a human says otherwise. DEFAULT 'new' means the widget's INSERT — which knows
  -- nothing about any of this and must keep knowing nothing — keeps working untouched.
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'new',

  -- Why it was decided that way. The single most valuable field here six months from now, when
  -- somebody asks why an obvious-looking request was declined.
  ADD COLUMN IF NOT EXISTS resolution_note text,

  -- The roadmap item this became ('P1.16'). NULL until the skill writes it. See the header.
  ADD COLUMN IF NOT EXISTS roadmap_ref text,

  -- Attribution for the decision. SET NULL, not CASCADE: an admin leaving must not erase the
  -- record that the decision was made, exactly as ei_sessions.instructor_id and grades.graded_by
  -- already decide.
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES instructors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,

  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  ALTER TABLE feedback ADD CONSTRAINT feedback_status_ck
    CHECK (status IN ('new', 'accepted', 'declined', 'duplicate'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE feedback ADD CONSTRAINT feedback_resolution_note_size
    CHECK (resolution_note IS NULL OR length(resolution_note) <= 2000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Short by construction: it holds an identifier like 'P1.16', not a description. A cap keeps
-- somebody from pasting the whole roadmap entry into the column the skill matches on.
DO $$ BEGIN
  ALTER TABLE feedback ADD CONSTRAINT feedback_roadmap_ref_size
    CHECK (roadmap_ref IS NULL OR (length(btrim(roadmap_ref)) > 0 AND length(roadmap_ref) <= 60));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A roadmap_ref only means anything on an accepted row. Without this a declined comment could be
-- stamped with a roadmap id, and the skill's work list would quietly disagree with the triage.
DO $$ BEGIN
  ALTER TABLE feedback ADD CONSTRAINT feedback_roadmap_ref_accepted_ck
    CHECK (roadmap_ref IS NULL OR status = 'accepted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN feedback.status IS
  'Triage decision: new | accepted | declined | duplicate. There is deliberately no ''roadmapped'' '
  'state — an accepted item is "written down" exactly when roadmap_ref is non-NULL.';
COMMENT ON COLUMN feedback.roadmap_ref IS
  'The roadmap item this became (e.g. P1.16), stamped by the roadmap skill. The skill''s work list '
  'is: status = ''accepted'' AND roadmap_ref IS NULL. Only valid on an accepted row.';
COMMENT ON COLUMN feedback.resolution_note IS
  'Why it was decided this way — the field that answers "why was this declined?" months later.';

-- The two reads the admin view makes: the triage list (newest first) and the skill's work list.
CREATE INDEX IF NOT EXISTS feedback_status_idx ON feedback (status, created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_pending_roadmap_idx ON feedback (created_at DESC)
  WHERE status = 'accepted' AND roadmap_ref IS NULL;

-- Resolution is an admin act. Matches 012's SELECT policy exactly rather than widening it; see the
-- header for why directors are not included.
--
-- NOTE the deliberate asymmetry: there is no DELETE policy, here or in 012. A comment cannot be
-- made to disappear by the people it is about — the strongest reason anyone would want to delete
-- one is the worst reason to allow it. 'declined' with a note is the way to say no.
DROP POLICY IF EXISTS feedback_admin_update ON feedback;
CREATE POLICY feedback_admin_update ON feedback FOR UPDATE TO authenticated
USING (is_admin()) WITH CHECK (is_admin());

CREATE TRIGGER feedback_touch BEFORE UPDATE ON feedback
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMIT;
