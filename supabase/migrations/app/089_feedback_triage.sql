-- 089: agent triage of feedback. Two new states (proposed, applied) and the columns that carry the agent's work and the director's answer.
--
-- WHY
--   Testers leave feedback on the staging test site. The course director wants an agent to triage it: a SIMPLE fix is applied by the
--   agent at once and waits for his closeout; a SIGNIFICANT change is proposed and waits for him to APPROVE (with instructions) or
--   DENY. Every item stays visible on the Feedback page. 013 had four states and no place for either the agent's plan or the
--   director's answer, so this adds both.
--
-- LIFECYCLE (status, and who writes it)
--   new       -> applied    agent, simple fix:      triage='simple',      agent_note (what was done), agent_ref, agent_at
--   new       -> proposed   agent, significant:     triage='significant', agent_note (the plan),      agent_at
--   proposed  -> accepted   director approves:      director_instructions (optional), decided_by, decided_at
--   proposed  -> declined   director denies:        decided_by, decided_at; director_instructions holds the reason if he typed one.
--                                                   The agent never works on a declined item.
--   accepted  -> applied    agent finishes:         agent_ref (and agent_note if it changed)
--   applied   + completed_at   director closeout:   completed_at, completed_by (valid on accepted OR applied, see below)
--   The agent writes only: status (new->proposed|applied, accepted->applied), triage, agent_note, agent_ref, agent_at.
--   Nothing in the database enforces that split; it is the agent script's contract.
--
-- WHAT IT CHANGES
--   * feedback_status_ck (013) replaced: status in new, proposed, accepted, applied, declined, duplicate.
--   * new columns: triage, agent_note, agent_ref, agent_at, director_instructions, decided_by (-> instructors, SET NULL like resolved_by
--     and completed_by), decided_at. Sizes capped: agent_note and director_instructions 4000, agent_ref 200.
--   * feedback_completed_accepted_ck (018) replaced: completed_at may be set when status is accepted OR applied.
--     feedback_completed_pair_ck (completed_by needs completed_at) and feedback_roadmap_ref_accepted_ck (roadmap_ref only on an
--     accepted row) are untouched.
--   * RLS, grants, indexes unchanged. No row changes: every existing row keeps its status and has NULL in each new column.
--
-- Rollback: rollback/089_feedback_triage_ROLLBACK.sql

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = app, public;

ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS triage                text,
  ADD COLUMN IF NOT EXISTS agent_note            text,
  ADD COLUMN IF NOT EXISTS agent_ref             text,
  ADD COLUMN IF NOT EXISTS agent_at              timestamptz,
  ADD COLUMN IF NOT EXISTS director_instructions text,
  ADD COLUMN IF NOT EXISTS decided_by            uuid REFERENCES instructors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decided_at            timestamptz;

ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_status_ck;
ALTER TABLE feedback ADD CONSTRAINT feedback_status_ck
  CHECK (status IN ('new', 'proposed', 'accepted', 'applied', 'declined', 'duplicate'));

ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_completed_accepted_ck;
ALTER TABLE feedback ADD CONSTRAINT feedback_completed_accepted_ck
  CHECK (completed_at IS NULL OR status IN ('accepted', 'applied'));

DO $$ BEGIN
  ALTER TABLE feedback ADD CONSTRAINT feedback_triage_ck
    CHECK (triage IS NULL OR triage IN ('simple', 'significant'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE feedback ADD CONSTRAINT feedback_agent_note_size
    CHECK (agent_note IS NULL OR length(agent_note) <= 4000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE feedback ADD CONSTRAINT feedback_agent_ref_size
    CHECK (agent_ref IS NULL OR length(agent_ref) <= 200);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE feedback ADD CONSTRAINT feedback_director_instructions_size
    CHECK (director_instructions IS NULL OR length(director_instructions) <= 4000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN feedback.status IS
  'new | proposed | accepted | applied | declined | duplicate. proposed = the agent wrote a plan and waits for the director; '
  'accepted = approved (or accepted by hand), still to build; applied = the agent made the change, waits for closeout. '
  'There is deliberately no ''roadmapped'' state: an accepted item is written down when roadmap_ref is non-NULL.';
COMMENT ON COLUMN feedback.triage IS
  'The agent''s judgement: simple (applied at once) or significant (proposed, waits for the director). NULL = not triaged by the agent.';
COMMENT ON COLUMN feedback.agent_note IS
  'The agent''s account: what it did (simple) or the plan it proposes (significant).';
COMMENT ON COLUMN feedback.agent_ref IS
  'Where the change lives: a commit sha or branch name. The Feedback page links a sha to the repository.';
COMMENT ON COLUMN feedback.agent_at IS 'When the agent last wrote its note or applied the change.';
COMMENT ON COLUMN feedback.director_instructions IS
  'What the director told the agent when approving, or why he denied. Free text, optional.';
COMMENT ON COLUMN feedback.decided_by IS 'The admin who approved or denied a proposal. SET NULL if that admin is removed.';
COMMENT ON COLUMN feedback.decided_at IS 'When the proposal was approved or denied.';

COMMIT;
