-- ============================================================
-- seed_demo_interaction.sql  —  SYNTHETIC interaction-rollup data
-- ------------------------------------------------------------
-- Populates a clearly-fake "demo" lesson interaction with one synthetic
-- report per REAL student in a course, so you can preview the faculty
-- rollup (app/faculty/interactions.html -> summarizeReports()) with a
-- realistic spread of effort, understanding, misconceptions, reflections,
-- honor statuses, and triage flags.
--
-- WHERE TO RUN: Supabase Dashboard > SQL Editor > New Query > paste > Run.
--   The SQL Editor runs as `postgres`, which BYPASSES RLS, so this can write
--   reports on behalf of every student (a normal browser session cannot —
--   the only INSERT policy on preflight_interaction_reports is "a student
--   inserts their own row").
--
-- SAFETY: This NEVER touches a real interaction or a real student's real
--   submissions. It writes only into the demo interaction created below.
--   Tear it all down with the one-line DELETE at the very bottom (the FK
--   cascade removes every demo report with it).
--
-- Re-runnable: ON CONFLICT upserts, so running it again just refreshes the
--   synthetic data. The `score` column is left to the migration-013 trigger.
--
-- Conforms to INTERACTION-DATA-CONTRACT.md (schema 1).
-- Authored 2026-06-23.
-- ============================================================

-- ============ CONFIG — edit these two, then run the whole file ============
--  * The demo slug is fake on purpose; keep it or change it.
--  * The course MUST match the course you select in the faculty UI, because
--    the rollup only loads students whose section.course_id = that course.
--    Both the interaction's course_id (Step 1) and the student filter
--    (Step 2, "sec.course_id = ...") must use the SAME value.
--      -> change 'phys-215' to 'phys-110' in BOTH places to seed that course.

BEGIN;

-- 1) Upsert the demo interaction (draft, so students never see it). -----------
INSERT INTO interactions (id, course_id, title, description, artifact_url, is_published)
VALUES (
  'demo-rollup-sandbox',
  'phys-215',                                   -- <-- COURSE (keep in sync with Step 2)
  'DEMO — Rollup Sandbox (synthetic data)',
  'Synthetic submissions for previewing the interaction rollup. Safe to delete; teardown is at the bottom of supabase/seed_demo_interaction.sql.',
  NULL,
  FALSE
)
ON CONFLICT (id) DO UPDATE
  SET course_id   = EXCLUDED.course_id,
      title       = EXCLUDED.title,
      description = EXCLUDED.description;

-- 2) One synthetic report per real student in that course's sections. ---------
--    Variety is derived deterministically from student_id (no randomness needed,
--    and re-runs are stable). Effort and understanding are decorrelated on
--    purpose so the rollup shows the intended case of "full effort, low
--    understanding" (the grade is effort; understanding is diagnostic).
WITH base AS (
  SELECT st.student_id, st.name, st.section_id,
         (st.student_id % 12)       AS eb,   -- effort bucket
         ((st.student_id / 11) % 6) AS ub,   -- understanding bucket (independent of eb)
         (st.student_id % 5)        AS mb,   -- misconception choice
         (st.student_id % 17)       AS hb    -- honor bucket (rare disclosures/concerns)
  FROM students st
  JOIN sections sec ON sec.id = st.section_id
  WHERE sec.course_id = 'phys-215'            -- <-- COURSE (keep in sync with Step 1)
),
n AS (
  SELECT b.*,
    CASE WHEN eb < 4 THEN 5 WHEN eb < 7 THEN 4 WHEN eb < 9 THEN 3
         WHEN eb = 9 THEN 2 WHEN eb = 10 THEN 1 ELSE 0 END                       AS effort,
    CASE WHEN eb >= 9 THEN FALSE ELSE TRUE END                                    AS meaningful,
    CASE WHEN eb >= 9 THEN FALSE ELSE TRUE END                                    AS completed,
    CASE ub WHEN 0 THEN 2 WHEN 1 THEN 3 WHEN 2 THEN 4 WHEN 3 THEN 5
            WHEN 4 THEN 1 ELSE 3 END                                              AS overall_u
  FROM base b
),
n2 AS (
  SELECT n.*,
    LEAST(5, overall_u + (student_id % 3))                                        AS self_u,
    CASE WHEN (student_id % 13) = 0 THEN NULL
         ELSE GREATEST(0, overall_u - (student_id % 2)) END                       AS o1_u,
    CASE WHEN (student_id %  9) = 0 THEN NULL
         ELSE LEAST(5, overall_u + ((student_id + 1) % 2)) END                    AS o2_u,
    CASE WHEN (student_id %  7) = 0 THEN NULL
         ELSE GREATEST(0, LEAST(5, overall_u + (student_id % 3) - 1)) END          AS o3_u
  FROM n
),
t AS (
  SELECT n2.*,
    CASE WHEN o1_u IS NULL THEN NULL ELSE LEAST(5, o1_u + 1) END                  AS o1_c,
    CASE WHEN o2_u IS NULL THEN NULL ELSE LEAST(5, o2_u)     END                  AS o2_c,
    CASE WHEN o3_u IS NULL THEN NULL ELSE LEAST(5, o3_u + 1) END                  AS o3_c,
    CASE WHEN effort = 0 THEN 1 WHEN effort = 1 THEN 3 ELSE 6 + (student_id % 12) END AS duration_min,
    CASE WHEN effort = 0 THEN 1 WHEN effort = 1 THEN 3 ELSE 8 + (student_id % 13) END AS message_count,
    CASE WHEN NOT meaningful
         THEN CASE student_id % 3 WHEN 0 THEN 'n/a' WHEN 1 THEN 'I read it.' ELSE 'idk' END
         ELSE CASE student_id % 3
                WHEN 0 THEN 'I hadn''t connected conductivity to how free a material''s electrons are — that clicked for me, especially coming from chemistry.'
                WHEN 1 THEN 'The induced charge on a neutral conductor surprised me; I''d assumed neutral meant no interaction at all.'
                ELSE 'Working the polarization step by step helped — seeing why the near face matters more than the far face made the attraction click.'
              END
    END                                                                           AS reflection_text,
    CASE WHEN NOT meaningful THEN (CASE WHEN effort = 0 THEN 0 ELSE 1 END)
         ELSE 4 + (student_id % 2) END                                            AS refl_engagement,
    CASE WHEN NOT meaningful THEN 'negative'
         WHEN student_id % 2 = 0 THEN 'positive' ELSE 'neutral' END               AS refl_sentiment,
    CASE WHEN meaningful THEN jsonb_build_array('conductors','induced-charge')
         ELSE '[]'::jsonb END                                                     AS refl_topics,
    CASE effort
      WHEN 5 THEN 'Sustained, genuine engagement across the full conversation; answered every prompt and follow-up.'
      WHEN 4 THEN 'Solid engagement with minor lapses (a skipped sub-question or brief tangent).'
      WHEN 3 THEN 'Engaged but cut short / intermittently terse.'
      WHEN 2 THEN 'Reading reflection was not meaningful, capping effort at 2.'
      WHEN 1 THEN 'Token effort — mostly one-word, evasive answers.'
      ELSE 'Did not engage substantively.'
    END                                                                           AS effort_rationale,
    CASE hb WHEN 0 THEN 'disclosed' WHEN 1 THEN 'concern' ELSE 'none' END         AS honor_status,
    CASE hb WHEN 0 THEN 'Talked through the reading with a classmate before starting.'
            WHEN 1 THEN 'Phrasing shifts abruptly mid-conversation; possible pasted content.'
            ELSE NULL END                                                         AS honor_note,
    CASE WHEN overall_u >= 4
         THEN 'Demonstrated solid command of the induced-charge mechanism: the near face takes the opposite sign and the object is attracted.'
         WHEN overall_u = 3
         THEN 'Partial grasp — reached attraction but the supporting reasoning was incomplete.'
         ELSE 'Reasoning showed one or more misconceptions about induced charge (see structured data).'
    END                                                                           AS concept_blurb,
    -- misconceptions, drawn from the Preflight-1 electrostatics taxonomy in CLAUDE.md.
    CASE
      WHEN overall_u >= 4 THEN '[]'::jsonb
      ELSE (
        CASE mb
          WHEN 0 THEN jsonb_build_array(jsonb_build_object('id','forces-cancel','label','Forces cancel on the conductor','description','Believes the attractive and repulsive forces on the conductor sum to zero.','objective_key','coulomb-magnitude','severity','major','evidence','"the pushes and pulls would even out"'))
          WHEN 1 THEN jsonb_build_array(jsonb_build_object('id','same-charge-near-face','label','Near face gets the same charge','description','Thinks the conductor''s near face acquires the same sign as the insulator.','objective_key','conductor-insulator','severity','major','evidence','"the close side turns positive too"'))
          WHEN 2 THEN jsonb_build_array(jsonb_build_object('id','shielding','label','Conductor shields the force','description','Uses interior shielding to argue there is no external force.','objective_key','conductor-insulator','severity','minor','evidence','"the field inside is zero so nothing happens"'))
          WHEN 3 THEN jsonb_build_array(jsonb_build_object('id','neutral-no-force','label','Neutral means no force','description','Applies Coulomb''s law to conclude a neutral object feels no force.','objective_key','coulomb-magnitude','severity','major','evidence','"it''s neutral so there''s no force"'))
          ELSE        jsonb_build_array(jsonb_build_object('id','repel-wrong-direction','label','Repelled / electrons move away','description','Predicts repulsion or electrons moving away from the insulator.','objective_key','conductor-insulator','severity','major','evidence','"the electrons get pushed to the far side and it repels"'))
        END
        ||
        CASE WHEN overall_u <= 2
             THEN jsonb_build_array(jsonb_build_object('id','scalar-sum','label','Adds forces as scalars','description','Combines force magnitudes without accounting for direction.','objective_key','coulomb-magnitude','severity','minor'))
             ELSE '[]'::jsonb END
      )
    END                                                                           AS misconceptions
  FROM n2
),
built AS (
  SELECT t.*,
    -- report_markdown: the human-readable surrogate transcript.
    format(
E'# Lesson Interaction — Induced Charge (DEMO)\n\n**Cadet:** %s  \n**Section:** %s  \n**Producer:** demo-rollup-sandbox@2026-06\n\n## Effort (grade-bearing)\nEffort **%s / 5** — %s\n\n## Reading reflection\n> %s\n\n_Meaningful:_ %s\n\n## Concept assessment (diagnostic)\nOverall understanding **%s / 5**. %s\n\n## Academic integrity\n%s\n',
      name, section_id, effort, effort_rationale, reflection_text,
      CASE WHEN meaningful THEN 'yes' ELSE 'no' END,
      overall_u, concept_blurb,
      CASE honor_status WHEN 'none'      THEN 'Cadet affirmed no improper assistance.'
                        WHEN 'disclosed' THEN 'Disclosed outside help: ' || honor_note
                        ELSE 'Flagged for review: ' || honor_note END
    )                                                                             AS md,
    -- report_data: schema-1 structured blob (the source of every numeric rollup).
    jsonb_build_object(
      'schema', 1,
      'producer', 'demo-rollup-sandbox@2026-06',
      'effort', effort,
      'effort_rationale', effort_rationale,
      'completed', completed,
      'duration_min', duration_min,
      'message_count', message_count,
      'overall_understanding', overall_u,
      'self_rated_understanding', self_u,
      'objectives', jsonb_build_array(
        jsonb_build_object('key','coulomb-magnitude','label','Coulomb''s law — magnitude & inverse-square','understanding', o1_u, 'confidence', o1_c),
        jsonb_build_object('key','conductor-insulator','label','Conductors vs. insulators (free electrons)','understanding', o2_u, 'confidence', o2_c),
        jsonb_build_object('key','induced-charge','label','Induced charge on a neutral conductor','understanding', o3_u, 'confidence', o3_c)
      ),
      'misconceptions', misconceptions,
      'reading_reflection', jsonb_build_object(
        'text', reflection_text,
        'meaningful', meaningful,
        'engagement', refl_engagement,
        'topics', refl_topics,
        'sentiment', refl_sentiment
      ),
      'honor', jsonb_build_object('status', honor_status, 'note', honor_note),
      'ai_summary', format('Effort %s/5, overall understanding %s/5. %s', effort, overall_u,
          CASE WHEN overall_u >= 4 THEN 'Solid command of induced charge.'
               WHEN overall_u = 3 THEN 'Partial grasp; some gaps remain.'
               ELSE 'Notable misconceptions remain.' END),
      'key_strengths', CASE WHEN effort <= 1 THEN 'Limited participation to assess.'
                            WHEN overall_u >= 4 THEN 'Clear polarization / vector reasoning.'
                            WHEN overall_u = 3 THEN 'Correct conclusion with developing justification.'
                            ELSE 'Stayed engaged with the prompts despite conceptual gaps.' END,
      'recommended_review', CASE WHEN overall_u >= 4 THEN 'Optional extension: multi-charge superposition.'
                                 ELSE 'Revisit induced charge on a neutral conductor and why the near face dominates.' END,
      'flags', jsonb_build_object(
        'needs_follow_up', (effort <= 2 OR overall_u <= 2),
        'notable', ((effort = 5 AND overall_u <= 2) OR effort = 0),
        'note', CASE WHEN effort = 5 AND overall_u <= 2 THEN 'Full effort but low understanding — good follow-up candidate.'
                     WHEN effort <= 1 THEN 'Very low engagement.'
                     WHEN overall_u <= 2 THEN 'Conceptual gaps to revisit.'
                     ELSE 'None.' END
      )
    )                                                                             AS rd
  FROM t
)
INSERT INTO preflight_interaction_reports
  (interaction_id, student_id, report_markdown, report_data, effort, payload_bytes)
SELECT 'demo-rollup-sandbox', student_id, md, rd, effort,
       octet_length(md) + octet_length(rd::text)
FROM built
ON CONFLICT (student_id, interaction_id) DO UPDATE
  SET report_markdown = EXCLUDED.report_markdown,
      report_data     = EXCLUDED.report_data,
      effort          = EXCLUDED.effort,
      payload_bytes   = EXCLUDED.payload_bytes;   -- score recomputed by the migration-013 trigger

COMMIT;


-- ============================================================
-- ROLLUP PREVIEW — run each SELECT on its own (highlight it, then Run) to
-- see the same numbers the faculty UI folds out of report_data.
-- The real payoff is the UI: open the faculty Interactions page for the
-- course above, pick "DEMO — Rollup Sandbox", and view the summary.
-- ============================================================

-- A) Headline: submissions, avg effort, points, % full credit, % completed.
-- SELECT count(*) AS submissions,
--        round(avg(effort)::numeric, 2)                                      AS avg_effort,
--        sum(score) AS points_total, count(*) * 2                            AS points_max,
--        round(100.0 * count(*) FILTER (WHERE score = 2) / count(*))         AS pct_full_credit,
--        round(100.0 * count(*) FILTER (WHERE (report_data->>'completed')::boolean) / count(*)) AS pct_completed
-- FROM preflight_interaction_reports WHERE interaction_id = 'demo-rollup-sandbox';

-- B) Effort 0–5 distribution.
-- SELECT effort, count(*) FROM preflight_interaction_reports
-- WHERE interaction_id = 'demo-rollup-sandbox' GROUP BY effort ORDER BY effort;

-- C) Per-section rollup.
-- SELECT st.section_id,
--        count(*)                                                            AS submissions,
--        round(avg(r.effort)::numeric, 2)                                    AS avg_effort,
--        round(avg(r.score)::numeric, 2)                                     AS avg_points,
--        round(avg((r.report_data->>'overall_understanding')::int)::numeric, 2) AS avg_understanding,
--        count(*) FILTER (WHERE r.score = 2)                                 AS full_credit
-- FROM preflight_interaction_reports r JOIN students st ON st.student_id = r.student_id
-- WHERE r.interaction_id = 'demo-rollup-sandbox'
-- GROUP BY st.section_id ORDER BY st.section_id;

-- D) Misconception frequency (most common first).
-- SELECT m->>'id' AS id, m->>'label' AS label,
--        count(*) AS n, count(*) FILTER (WHERE m->>'severity' = 'major') AS major
-- FROM preflight_interaction_reports r,
--      jsonb_array_elements(r.report_data->'misconceptions') m
-- WHERE r.interaction_id = 'demo-rollup-sandbox' GROUP BY 1, 2 ORDER BY n DESC;

-- E) Per-objective understanding (weakest first).
-- SELECT o->>'key' AS objective, o->>'label' AS label,
--        round(avg((o->>'understanding')::int)::numeric, 2)                  AS avg_understanding,
--        count(*) FILTER (WHERE o->>'understanding' IS NOT NULL)             AS assessed
-- FROM preflight_interaction_reports r,
--      jsonb_array_elements(r.report_data->'objectives') o
-- WHERE r.interaction_id = 'demo-rollup-sandbox' GROUP BY 1, 2 ORDER BY 3;

-- F) Reflection gate + integrity + triage flags.
-- SELECT count(*) FILTER (WHERE (report_data->'reading_reflection'->>'meaningful')::boolean)       AS reflection_meaningful,
--        count(*) FILTER (WHERE NOT (report_data->'reading_reflection'->>'meaningful')::boolean)   AS reflection_capped,
--        count(*) FILTER (WHERE report_data->'honor'->>'status' = 'disclosed')                     AS honor_disclosed,
--        count(*) FILTER (WHERE report_data->'honor'->>'status' = 'concern')                       AS honor_concern,
--        count(*) FILTER (WHERE (report_data->'flags'->>'needs_follow_up')::boolean)               AS needs_follow_up,
--        count(*) FILTER (WHERE (report_data->'flags'->>'notable')::boolean)                       AS notable
-- FROM preflight_interaction_reports WHERE interaction_id = 'demo-rollup-sandbox';


-- ============================================================
-- TEARDOWN — removes the demo interaction AND every synthetic report
-- (ON DELETE CASCADE). Uncomment and run when you're done.
-- ============================================================
-- DELETE FROM interactions WHERE id = 'demo-rollup-sandbox';
