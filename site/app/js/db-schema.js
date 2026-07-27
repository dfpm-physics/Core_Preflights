// db-schema.js — GENERATED FILE. Do not edit by hand.
//
// The table catalogue for schema `app`, rendered by faculty/system.html (System > Data). It is
// generated because PostgREST's OpenAPI endpoint now refuses publishable keys ("Secret API key
// required"), so a static page cannot introspect the database at runtime and a static page must
// never carry a secret key.
//
// Regenerate after any migration in supabase/migrations/app/ and commit the result:
//   .venv/Scripts/python scripts/app/gen_db_schema.py
//
// tests/app-schema/test-db-schema.mjs fails when this file drifts from live.
//
// Source: scripts/app/gen_db_schema.py · schema `app` · 26 tables
// Shape per table: { name, comment, rls, primaryKey[], labelColumn, columns[], foreignKeys[],
//                    enums{col:[values]}, policyCommands[], writable }
//
// `writable` and `policyCommands` are STRUCTURAL — they report that a policy exists for a command,
// not that it admits the current caller. Callers must still handle a runtime RLS refusal.

export const DB_SCHEMA = {
    "activities": {
      "name": "activities",
      "comment": "What is INSIDE an assignment. Pure content — the questions or the artifact. Modality is a property here, not a top-level entity, which is what removes the old parallel assignments/interactions worlds and the lesson_completions layer that reconciled them. Whether an activity is graded is NOT stored here; see offering_activities.",
      "rls": true,
      "primaryKey": [
        "id"
      ],
      "labelColumn": "slug",
      "columns": [
        {
          "name": "id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "assignment_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "modality",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "slug",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "FROZEN CONTRACT SURFACE. Deployed Claude artifacts post to interaction-submit.html#i=<slug>. Existing interactions.id values migrate here verbatim. Globally unique because the artifact sends no other context. Never rename a slug that has shipped.",
          "pk": false
        },
        {
          "name": "title",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "content",
          "type": "jsonb",
          "udt": "jsonb",
          "nullable": false,
          "default": "'{}'::jsonb",
          "maxLength": null,
          "generated": false,
          "comment": "Shape by modality. written: {\"questions\":[{id,text,type,points,objective_key,role,expected_response,figure_url}]}. interactive: {\"artifact_url\":\"...\",\"chat_input_markdown\":\"...\",\"content_sha256\":\"...\"}.",
          "pk": false
        },
        {
          "name": "position",
          "type": "smallint",
          "udt": "int2",
          "nullable": false,
          "default": "0",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "created_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "updated_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        }
      ],
      "foreignKeys": [
        {
          "name": "activities_assignment_id_fkey",
          "columns": [
            "assignment_id"
          ],
          "refTable": "assignments",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        }
      ],
      "enums": {
        "modality": [
          "written",
          "interactive"
        ]
      },
      "policyCommands": [
        "ALL",
        "SELECT"
      ],
      "writable": true
    },
    "analysis_reports": {
      "name": "analysis_reports",
      "comment": "One table replacing assignments.analysis_report (a JSONB column) and interaction_analysis (a table) — two differently-shaped stores for the same idea. scope_id is intentionally not a FK: it points at whichever table `scope` names.",
      "rls": true,
      "primaryKey": [
        "id"
      ],
      "labelColumn": "kind",
      "columns": [
        {
          "name": "id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "scope",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "scope_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "audience_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "kind",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "payload",
          "type": "jsonb",
          "udt": "jsonb",
          "nullable": false,
          "default": "'{}'::jsonb",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "generated_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        }
      ],
      "foreignKeys": [
        {
          "name": "analysis_reports_audience_id_fkey",
          "columns": [
            "audience_id"
          ],
          "refTable": "instructors",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        }
      ],
      "enums": {
        "scope": [
          "assignment_offering",
          "section",
          "course_offering"
        ]
      },
      "policyCommands": [
        "SELECT"
      ],
      "writable": false
    },
    "analysis_runs": {
      "name": "analysis_runs",
      "comment": "One row per AI analysis run (preflight-analyze, lesson-aggregate, lesson-cycle), however it was started. Written at start with status='running' and updated on completion, so a run that died leaves a visible trace. Replaces the CHANGELOG.md-entry-per-run convention for these workflows, which does not scale to ~80 runs a term and cannot be read by an instructor.",
      "rls": true,
      "primaryKey": [
        "id"
      ],
      "labelColumn": "id",
      "columns": [
        {
          "name": "id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "skill",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "invoked_by",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": "'human'::text",
          "maxLength": null,
          "generated": false,
          "comment": "'human' (someone typed the command) or 'scheduled' (a cron/Task Scheduler fired it). The audit question is usually \"was anyone watching?\".",
          "pk": false
        },
        {
          "name": "actor",
          "type": "uuid",
          "udt": "uuid",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "course_offering_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "assignment_offering_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "day_track",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "status",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": "'running'::text",
          "maxLength": null,
          "generated": false,
          "comment": "'running' until the skill finishes. 'partial' means it completed but did less than asked (e.g. the whole-course scope deferred); 'skipped' means it correctly declined to act.",
          "pk": false
        },
        {
          "name": "started_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "finished_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "summary",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "detail",
          "type": "jsonb",
          "udt": "jsonb",
          "nullable": false,
          "default": "'{}'::jsonb",
          "maxLength": null,
          "generated": false,
          "comment": "Per-skill counts; shape documented in each SKILL.md. Deliberately jsonb — grading and aggregation report different things and a shared column set would be half-null for both.",
          "pk": false
        },
        {
          "name": "error",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        }
      ],
      "foreignKeys": [
        {
          "name": "analysis_runs_actor_fkey",
          "columns": [
            "actor"
          ],
          "refTable": "instructors",
          "refColumns": [
            "id"
          ],
          "onDelete": "set null"
        },
        {
          "name": "analysis_runs_assignment_offering_id_fkey",
          "columns": [
            "assignment_offering_id"
          ],
          "refTable": "assignment_offerings",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        },
        {
          "name": "analysis_runs_course_offering_id_fkey",
          "columns": [
            "course_offering_id"
          ],
          "refTable": "course_offerings",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        }
      ],
      "enums": {
        "invoked_by": [
          "human",
          "scheduled"
        ],
        "status": [
          "running",
          "success",
          "partial",
          "failed",
          "skipped"
        ]
      },
      "policyCommands": [
        "SELECT"
      ],
      "writable": false
    },
    "assignment_due_dates": {
      "name": "assignment_due_dates",
      "comment": "Generalises due_date_m / due_date_t to any meeting pattern. Absent row = the offering's due_at.",
      "rls": true,
      "primaryKey": [
        "assignment_offering_id",
        "section_id"
      ],
      "labelColumn": "assignment_offering_id",
      "columns": [
        {
          "name": "assignment_offering_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "section_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "due_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        }
      ],
      "foreignKeys": [
        {
          "name": "assignment_due_dates_assignment_offering_id_fkey",
          "columns": [
            "assignment_offering_id"
          ],
          "refTable": "assignment_offerings",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        },
        {
          "name": "assignment_due_dates_section_id_fkey",
          "columns": [
            "section_id"
          ],
          "refTable": "sections",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        }
      ],
      "enums": {},
      "policyCommands": [
        "ALL",
        "SELECT"
      ],
      "writable": true
    },
    "assignment_kinds": {
      "name": "assignment_kinds",
      "comment": "Lookup, not an enum: adding homework/quiz/exam later is an INSERT, not a migration.",
      "rls": true,
      "primaryKey": [
        "id"
      ],
      "labelColumn": "label",
      "columns": [
        {
          "name": "id",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "label",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "sort_order",
          "type": "smallint",
          "udt": "int2",
          "nullable": false,
          "default": "0",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        }
      ],
      "foreignKeys": [],
      "enums": {},
      "policyCommands": [
        "ALL",
        "SELECT"
      ],
      "writable": true
    },
    "assignment_offerings": {
      "name": "assignment_offerings",
      "comment": "An assignment SCHEDULED into one term. Mirrors courses -> course_offerings: the assignment is the reusable definition, this row is one term's run of it. Submissions and grades point HERE, not at the assignment, so a student's Fall 2026 grade stays attached to Fall 2026.",
      "rls": true,
      "primaryKey": [
        "id"
      ],
      "labelColumn": "id",
      "columns": [
        {
          "name": "id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "course_offering_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "assignment_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "points_possible",
          "type": "numeric",
          "udt": "numeric",
          "nullable": false,
          "default": "2",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "grading_mode",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": "'effort'::text",
          "maxLength": null,
          "generated": false,
          "comment": "effort: points derived 0-5 -> 0..points_possible by trigger (today's interaction rule). points: points_earned written directly.",
          "pk": false
        },
        {
          "name": "switch_policy",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": "'lock_on_commit'::text",
          "maxLength": null,
          "generated": false,
          "comment": "The locking rule as DATA, not compiled into a trigger body — the phase sequence of the research design deliberately changes what students may do, and changing the experiment should not require a migration. Enforced by app.submissions_lock_activity().",
          "pk": false
        },
        {
          "name": "opens_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "due_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "is_published",
          "type": "boolean",
          "udt": "bool",
          "nullable": false,
          "default": "false",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "content_snapshot",
          "type": "jsonb",
          "udt": "jsonb",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "What this cohort actually saw: the activities and their content, roles, points and deadlines, captured at term close. This is what lets an artifact URL be safely overwritten for the next term without erasing the record of the previous one.",
          "pk": false
        },
        {
          "name": "position",
          "type": "integer",
          "udt": "int4",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "created_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "updated_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "content_snapshot_frozen_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "When the snapshot was frozen. NULL = not yet frozen and still tracking live content. Non-NULL makes content_snapshot immutable (see assignment_offerings_snapshot_guard).",
          "pk": false
        }
      ],
      "foreignKeys": [
        {
          "name": "assignment_offerings_assignment_id_fkey",
          "columns": [
            "assignment_id"
          ],
          "refTable": "assignments",
          "refColumns": [
            "id"
          ],
          "onDelete": "restrict"
        },
        {
          "name": "assignment_offerings_course_offering_id_fkey",
          "columns": [
            "course_offering_id"
          ],
          "refTable": "course_offerings",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        }
      ],
      "enums": {
        "grading_mode": [
          "effort",
          "points"
        ],
        "switch_policy": [
          "free_until_commit",
          "lock_on_commit",
          "one_way_to_interactive",
          "lock_on_start"
        ]
      },
      "policyCommands": [
        "ALL",
        "SELECT"
      ],
      "writable": true
    },
    "assignments": {
      "name": "assignments",
      "comment": "THE CONTAINER — the reusable definition of a piece of work, holding the possibilities a student may work through. Knows nothing about a semester, a due date, or which activity carries credit; all three are per-term decisions living in assignment_offerings and offering_activities. Replaces the role the old `lessons` table played, but as the primary noun rather than a reconciliation layer bolted over two parallel worlds.",
      "rls": true,
      "primaryKey": [
        "id"
      ],
      "labelColumn": "slug",
      "columns": [
        {
          "name": "id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "course_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "NULL means shared across courses. UNIQUE uses NULLS NOT DISTINCT so two shared assignments cannot share a slug.",
          "pk": false
        },
        {
          "name": "kind_id",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "slug",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "title",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "description",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "objectives",
          "type": "jsonb",
          "udt": "jsonb",
          "nullable": false,
          "default": "'[]'::jsonb",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "is_archived",
          "type": "boolean",
          "udt": "bool",
          "nullable": false,
          "default": "false",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "created_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "updated_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        }
      ],
      "foreignKeys": [
        {
          "name": "assignments_course_id_fkey",
          "columns": [
            "course_id"
          ],
          "refTable": "courses",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        },
        {
          "name": "assignments_kind_id_fkey",
          "columns": [
            "kind_id"
          ],
          "refTable": "assignment_kinds",
          "refColumns": [
            "id"
          ],
          "onDelete": "no action"
        }
      ],
      "enums": {},
      "policyCommands": [
        "ALL",
        "SELECT"
      ],
      "writable": true
    },
    "course_offerings": {
      "name": "course_offerings",
      "comment": "\"Physics 215, Fall 2026\" — the anchor everything term-scoped hangs from.",
      "rls": true,
      "primaryKey": [
        "id"
      ],
      "labelColumn": "id",
      "columns": [
        {
          "name": "id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "course_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "term_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "is_active",
          "type": "boolean",
          "udt": "bool",
          "nullable": false,
          "default": "true",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "created_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        }
      ],
      "foreignKeys": [
        {
          "name": "course_offerings_course_id_fkey",
          "columns": [
            "course_id"
          ],
          "refTable": "courses",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        },
        {
          "name": "course_offerings_term_id_fkey",
          "columns": [
            "term_id"
          ],
          "refTable": "terms",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        }
      ],
      "enums": {},
      "policyCommands": [
        "ALL",
        "SELECT"
      ],
      "writable": true
    },
    "courses": {
      "name": "courses",
      "comment": "Catalogue entry, not an offering. \"Physics 215\" the course, independent of any semester.",
      "rls": true,
      "primaryKey": [
        "id"
      ],
      "labelColumn": "code",
      "columns": [
        {
          "name": "id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "code",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "Stable human identifier. Surrogate uuid PK on purpose: text PKs collided across courses in July 2026.",
          "pk": false
        },
        {
          "name": "title",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "department",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "created_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "updated_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        }
      ],
      "foreignKeys": [],
      "enums": {},
      "policyCommands": [
        "ALL",
        "SELECT"
      ],
      "writable": true
    },
    "ei_sessions": {
      "name": "ei_sessions",
      "comment": "Extra-instruction sessions, one row per student per sitting, keyed on the enrollment so a record belongs to a student's place in a section in a term. STAFF-ONLY: there is no student read policy and that absence is deliberate (ROADMAP Q3) — `notes` may hold an instructor's candid assessment. Repeatable by design: no unique key. A bulk log shares one batch_id.",
      "rls": true,
      "primaryKey": [
        "id"
      ],
      "labelColumn": "id",
      "columns": [
        {
          "name": "id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "enrollment_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "instructor_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "Who held the session. Not forced to equal the caller: a director may log on behalf of the colleague who ran it. Revisit that if EI attendance ever becomes an input to a grade.",
          "pk": false
        },
        {
          "name": "started_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "Session start in UTC. Rendered in America/Denver by the client. No default — logging after the fact is the common case and a default would disguise a mistake as a fact.",
          "pk": false
        },
        {
          "name": "duration_minutes",
          "type": "smallint",
          "udt": "int2",
          "nullable": false,
          "default": "30",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "notes",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "batch_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "Shared uuid for every row logged in one bulk action; NULL for a single session. A grouping token, not an entity — it carries no foreign key.",
          "pk": false
        },
        {
          "name": "created_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "updated_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        }
      ],
      "foreignKeys": [
        {
          "name": "ei_sessions_enrollment_id_fkey",
          "columns": [
            "enrollment_id"
          ],
          "refTable": "enrollments",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        },
        {
          "name": "ei_sessions_instructor_id_fkey",
          "columns": [
            "instructor_id"
          ],
          "refTable": "instructors",
          "refColumns": [
            "id"
          ],
          "onDelete": "set null"
        }
      ],
      "enums": {},
      "policyCommands": [
        "ALL",
        "SELECT"
      ],
      "writable": true
    },
    "enrollments": {
      "name": "enrollments",
      "comment": "The multi-course fix, and the anchor for ALL student work. Because grades hang off the enrollment rather than the student, moving someone between sections no longer silently re-attributes their history.",
      "rls": true,
      "primaryKey": [
        "id"
      ],
      "labelColumn": "id",
      "columns": [
        {
          "name": "id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "student_id",
          "type": "bigint",
          "udt": "int8",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "section_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "status",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": "'active'::text",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "enrolled_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "dropped_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        }
      ],
      "foreignKeys": [
        {
          "name": "enrollments_section_id_fkey",
          "columns": [
            "section_id"
          ],
          "refTable": "sections",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        },
        {
          "name": "enrollments_student_id_fkey",
          "columns": [
            "student_id"
          ],
          "refTable": "students",
          "refColumns": [
            "student_id"
          ],
          "onDelete": "cascade"
        }
      ],
      "enums": {
        "status": [
          "active",
          "dropped",
          "completed"
        ]
      },
      "policyCommands": [
        "ALL",
        "SELECT"
      ],
      "writable": true
    },
    "extensions": {
      "name": "extensions",
      "comment": "A per-student deadline override for one scheduled assignment. Highest-precedence deadline source: extension > assignment_due_dates (per section) > assignment_offerings.due_at.",
      "rls": true,
      "primaryKey": [
        "id"
      ],
      "labelColumn": "id",
      "columns": [
        {
          "name": "id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "enrollment_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "assignment_offering_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "extended_due_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "Replaces the computed deadline outright — it is not an offset.",
          "pk": false
        },
        {
          "name": "reason",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "Why the extra time was granted. Required: the director-facing extensions report exists to start a conversation about volume, and a blank reason column cannot start one.",
          "pk": false
        },
        {
          "name": "granted_by",
          "type": "uuid",
          "udt": "uuid",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "The instructor who granted it. ON DELETE SET NULL so removing a departed instructor never silently revokes a student's extra time.",
          "pk": false
        },
        {
          "name": "created_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "updated_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "revoked_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "Soft revocation. The row stays so the extension still counts as granted — hiding it would defeat the report it is counted in.",
          "pk": false
        },
        {
          "name": "revoked_by",
          "type": "uuid",
          "udt": "uuid",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "The director who revoked it. ON DELETE SET NULL, like granted_by.",
          "pk": false
        },
        {
          "name": "revoked_reason",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        }
      ],
      "foreignKeys": [
        {
          "name": "extensions_assignment_offering_id_fkey",
          "columns": [
            "assignment_offering_id"
          ],
          "refTable": "assignment_offerings",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        },
        {
          "name": "extensions_enrollment_id_fkey",
          "columns": [
            "enrollment_id"
          ],
          "refTable": "enrollments",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        },
        {
          "name": "extensions_granted_by_fkey",
          "columns": [
            "granted_by"
          ],
          "refTable": "instructors",
          "refColumns": [
            "id"
          ],
          "onDelete": "set null"
        },
        {
          "name": "extensions_revoked_by_fkey",
          "columns": [
            "revoked_by"
          ],
          "refTable": "instructors",
          "refColumns": [
            "id"
          ],
          "onDelete": "set null"
        }
      ],
      "enums": {},
      "policyCommands": [
        "ALL",
        "SELECT"
      ],
      "writable": true
    },
    "feedback": {
      "name": "feedback",
      "comment": "In-app feedback from the floating box on every page: one immutable row per submission, tagged with the submitter's auth uid (non-forgeable via RLS), a readable name, the page, and a category (like/dislike/feature/add/remove/other). Meant to be polled to steer future work. STAFF-INVISIBLE except global admins — it is steering data, not a peer-readable board.",
      "rls": true,
      "primaryKey": [
        "id"
      ],
      "labelColumn": "id",
      "columns": [
        {
          "name": "id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "submitted_by",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "Submitter auth uid; the INSERT policy pins it to current_uid() so feedback cannot be filed as another person. This is identity — submitter_name/role are only hints captured alongside it.",
          "pk": false
        },
        {
          "name": "submitter_name",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "role",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "page",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "page_title",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "category",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "message",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "user_agent",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "created_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "status",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": "'new'::text",
          "maxLength": null,
          "generated": false,
          "comment": "Triage decision: new | accepted | declined | duplicate. There is deliberately no 'roadmapped' state — an accepted item is \"written down\" exactly when roadmap_ref is non-NULL.",
          "pk": false
        },
        {
          "name": "resolution_note",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "Why it was decided this way — the field that answers \"why was this declined?\" months later.",
          "pk": false
        },
        {
          "name": "roadmap_ref",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "The roadmap item this became (e.g. P1.16), stamped by the roadmap skill. The skill's work list is: status = 'accepted' AND roadmap_ref IS NULL. Only valid on an accepted row.",
          "pk": false
        },
        {
          "name": "resolved_by",
          "type": "uuid",
          "udt": "uuid",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "resolved_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "updated_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        }
      ],
      "foreignKeys": [
        {
          "name": "feedback_resolved_by_fkey",
          "columns": [
            "resolved_by"
          ],
          "refTable": "instructors",
          "refColumns": [
            "id"
          ],
          "onDelete": "set null"
        }
      ],
      "enums": {
        "category": [
          "like",
          "dislike",
          "feature",
          "add",
          "remove",
          "other"
        ],
        "role": [
          "faculty",
          "student"
        ],
        "status": [
          "new",
          "accepted",
          "declined",
          "duplicate"
        ]
      },
      "policyCommands": [
        "INSERT",
        "SELECT",
        "UPDATE"
      ],
      "writable": true
    },
    "grade_events": {
      "name": "grade_events",
      "comment": "Append-only audit. Cheap insurance: a retroactive rescore silently corrupted totals in the old system once already.",
      "rls": true,
      "primaryKey": [
        "id"
      ],
      "labelColumn": "event",
      "columns": [
        {
          "name": "id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "grade_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "event",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "actor",
          "type": "uuid",
          "udt": "uuid",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "detail",
          "type": "jsonb",
          "udt": "jsonb",
          "nullable": false,
          "default": "'{}'::jsonb",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "occurred_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        }
      ],
      "foreignKeys": [
        {
          "name": "grade_events_actor_fkey",
          "columns": [
            "actor"
          ],
          "refTable": "instructors",
          "refColumns": [
            "id"
          ],
          "onDelete": "set null"
        },
        {
          "name": "grade_events_grade_id_fkey",
          "columns": [
            "grade_id"
          ],
          "refTable": "grades",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        }
      ],
      "enums": {},
      "policyCommands": [
        "INSERT",
        "SELECT"
      ],
      "writable": true
    },
    "grades": {
      "name": "grades",
      "comment": "Exactly one grade per enrollment per assignment offering, bounded by that offering's value. These two constraints replace a whole class of bug: the old model spread a lesson's grade across scores, preflight_interaction_reports.score, and lesson_completions.points with nothing relating earned points to possible points anywhere.",
      "rls": true,
      "primaryKey": [
        "id"
      ],
      "labelColumn": "id",
      "columns": [
        {
          "name": "id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "enrollment_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "assignment_offering_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "submission_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "Nullable on purpose. An in-class exam scored in Gradescope produces a grade with no submission in this system, and both constraints above still hold.",
          "pk": false
        },
        {
          "name": "points_earned",
          "type": "numeric",
          "udt": "numeric",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "points_possible",
          "type": "numeric",
          "udt": "numeric",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "effort",
          "type": "smallint",
          "udt": "int2",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "question_scores",
          "type": "jsonb",
          "udt": "jsonb",
          "nullable": false,
          "default": "'{}'::jsonb",
          "maxLength": null,
          "generated": false,
          "comment": "Per-question 3-state detail, carried over unchanged: {\"q1\":{score,max,status,feedback}} where status is full | warn | zero.",
          "pk": false
        },
        {
          "name": "diagnostic",
          "type": "jsonb",
          "udt": "jsonb",
          "nullable": false,
          "default": "'{}'::jsonb",
          "maxLength": null,
          "generated": false,
          "comment": "The frozen schema:1 payload — overall_understanding, objectives[], misconceptions[], reading_reflection, flags. NEVER contributes to points.",
          "pk": false
        },
        {
          "name": "source",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": "'ai_suggested'::text",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "is_finalized",
          "type": "boolean",
          "udt": "bool",
          "nullable": false,
          "default": "false",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "graded_by",
          "type": "uuid",
          "udt": "uuid",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "graded_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "created_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "updated_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        }
      ],
      "foreignKeys": [
        {
          "name": "grades_assignment_offering_id_fkey",
          "columns": [
            "assignment_offering_id"
          ],
          "refTable": "assignment_offerings",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        },
        {
          "name": "grades_enrollment_id_fkey",
          "columns": [
            "enrollment_id"
          ],
          "refTable": "enrollments",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        },
        {
          "name": "grades_graded_by_fkey",
          "columns": [
            "graded_by"
          ],
          "refTable": "instructors",
          "refColumns": [
            "id"
          ],
          "onDelete": "set null"
        },
        {
          "name": "grades_submission_id_fkey",
          "columns": [
            "submission_id"
          ],
          "refTable": "submissions",
          "refColumns": [
            "id"
          ],
          "onDelete": "set null"
        }
      ],
      "enums": {
        "source": [
          "instructor",
          "ai_suggested",
          "derived",
          "imported"
        ]
      },
      "policyCommands": [
        "ALL",
        "SELECT"
      ],
      "writable": true
    },
    "instructors": {
      "name": "instructors",
      "comment": null,
      "rls": true,
      "primaryKey": [
        "id"
      ],
      "labelColumn": "name",
      "columns": [
        {
          "name": "id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "name",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "is_global_admin",
          "type": "boolean",
          "udt": "bool",
          "nullable": false,
          "default": "false",
          "maxLength": null,
          "generated": false,
          "comment": "System-admin flag only. The legacy is_director boolean is NOT carried over — course-level authority lives in staff_assignments, one source of truth.",
          "pk": false
        },
        {
          "name": "created_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        }
      ],
      "foreignKeys": [],
      "enums": {},
      "policyCommands": [
        "ALL",
        "SELECT",
        "UPDATE"
      ],
      "writable": true
    },
    "offering_activities": {
      "name": "offering_activities",
      "comment": "THE OPERATIONAL LEVER. Which of an assignment's activities are live this term, which one carries credit, and when each opens. Swapping grading_role between two rows moves the whole cohort from one modality to the other — the \"if the interactive breaks, kick everyone over to the questions\" case — without touching the library definition and without disturbing grades already earned.",
      "rls": true,
      "primaryKey": [
        "assignment_offering_id",
        "activity_id"
      ],
      "labelColumn": "assignment_offering_id",
      "columns": [
        {
          "name": "assignment_offering_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "activity_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "grading_role",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": "'graded'::text",
          "maxLength": null,
          "generated": false,
          "comment": "graded:   eligible to be THE graded activity for this offering. Two or more graded rows           means the student chooses; exactly one means it is required. practice: present and workable, but can never carry credit. Covers both directions —           questions available alongside a graded interactive, and an interactive available           alongside graded questions.",
          "pk": false
        },
        {
          "name": "available_after",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": "'always'::text",
          "maxLength": null,
          "generated": false,
          "comment": "always: open from the start. submit: unlocks once the student commits their graded work. due: unlocks at the deadline — study mode.",
          "pk": false
        },
        {
          "name": "is_visible",
          "type": "boolean",
          "udt": "bool",
          "nullable": false,
          "default": "true",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "position",
          "type": "smallint",
          "udt": "int2",
          "nullable": false,
          "default": "0",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        }
      ],
      "foreignKeys": [
        {
          "name": "offering_activities_activity_id_fkey",
          "columns": [
            "activity_id"
          ],
          "refTable": "activities",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        },
        {
          "name": "offering_activities_assignment_offering_id_fkey",
          "columns": [
            "assignment_offering_id"
          ],
          "refTable": "assignment_offerings",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        }
      ],
      "enums": {
        "available_after": [
          "always",
          "submit",
          "due"
        ],
        "grading_role": [
          "graded",
          "practice"
        ]
      },
      "policyCommands": [
        "ALL",
        "SELECT"
      ],
      "writable": true
    },
    "review_signoffs": {
      "name": "review_signoffs",
      "comment": "One instructor attestation per (assignment offering, section): the AI-suggested grades and comments have been read and adjusted. Deliberately NOT the same fact as grades.is_finalized, which publishes to students — an instructor must be able to finish reviewing without releasing, and a director must be able to see who is done before anything is released.",
      "rls": true,
      "primaryKey": [
        "id"
      ],
      "labelColumn": "id",
      "columns": [
        {
          "name": "id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "assignment_offering_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "section_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "reviewed_by",
          "type": "uuid",
          "udt": "uuid",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "Who attested. A trigger refuses a sign-off attributed to anyone but the caller, for the same reason migration 006 refuses a misattributed unlock: an attestation naming someone who did not perform it is worse than none.",
          "pk": false
        },
        {
          "name": "reviewed_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": "Also the staleness clock: the sign-off no longer holds once any grade in this (offering, section) has grades.updated_at > this value. Derived at read time on purpose — a stored counter could disagree with the rows it summarises.",
          "pk": false
        },
        {
          "name": "note",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "created_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "updated_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        }
      ],
      "foreignKeys": [
        {
          "name": "review_signoffs_assignment_offering_id_fkey",
          "columns": [
            "assignment_offering_id"
          ],
          "refTable": "assignment_offerings",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        },
        {
          "name": "review_signoffs_reviewed_by_fkey",
          "columns": [
            "reviewed_by"
          ],
          "refTable": "instructors",
          "refColumns": [
            "id"
          ],
          "onDelete": "set null"
        },
        {
          "name": "review_signoffs_section_id_fkey",
          "columns": [
            "section_id"
          ],
          "refTable": "sections",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        }
      ],
      "enums": {},
      "policyCommands": [
        "ALL",
        "SELECT"
      ],
      "writable": true
    },
    "roster_imports": {
      "name": "roster_imports",
      "comment": "One row per roster upload: who, when, from which file, and what it changed. Exists because roster uploads are frequent live mutations that cannot be recorded in CHANGELOG.md. The created/updated/untouched split is the audit-relevant part — it records which conflict resolution the operator chose, which is the only step of an import that discards data.",
      "rls": true,
      "primaryKey": [
        "id"
      ],
      "labelColumn": "id",
      "columns": [
        {
          "name": "id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "course_offering_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "imported_by",
          "type": "uuid",
          "udt": "uuid",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "filename",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "rows_in_file",
          "type": "integer",
          "udt": "int4",
          "nullable": false,
          "default": "0",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "rows_matched",
          "type": "integer",
          "udt": "int4",
          "nullable": false,
          "default": "0",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "students_created",
          "type": "integer",
          "udt": "int4",
          "nullable": false,
          "default": "0",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "students_updated",
          "type": "integer",
          "udt": "int4",
          "nullable": false,
          "default": "0",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "students_untouched",
          "type": "integer",
          "udt": "int4",
          "nullable": false,
          "default": "0",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "enrollments_created",
          "type": "integer",
          "udt": "int4",
          "nullable": false,
          "default": "0",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "sections_created",
          "type": "integer",
          "udt": "int4",
          "nullable": false,
          "default": "0",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "notes",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "created_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        }
      ],
      "foreignKeys": [
        {
          "name": "roster_imports_course_offering_id_fkey",
          "columns": [
            "course_offering_id"
          ],
          "refTable": "course_offerings",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        },
        {
          "name": "roster_imports_imported_by_fkey",
          "columns": [
            "imported_by"
          ],
          "refTable": "instructors",
          "refColumns": [
            "id"
          ],
          "onDelete": "set null"
        }
      ],
      "enums": {},
      "policyCommands": [
        "INSERT",
        "SELECT"
      ],
      "writable": true
    },
    "sections": {
      "name": "sections",
      "comment": "Section codes are unique per OFFERING, not globally, so two courses can both have an M1A and a code can be reused next term. The old ^[MT][135][A-D]$ CHECK is deliberately gone — it hardcoded a two-course meeting pattern.",
      "rls": true,
      "primaryKey": [
        "id"
      ],
      "labelColumn": "code",
      "columns": [
        {
          "name": "id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "course_offering_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "code",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "meeting_days",
          "type": "ARRAY",
          "udt": "_text",
          "nullable": false,
          "default": "'{}'::text[]",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "period",
          "type": "smallint",
          "udt": "int2",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "created_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        }
      ],
      "foreignKeys": [
        {
          "name": "sections_course_offering_id_fkey",
          "columns": [
            "course_offering_id"
          ],
          "refTable": "course_offerings",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        }
      ],
      "enums": {},
      "policyCommands": [
        "ALL",
        "SELECT"
      ],
      "writable": true
    },
    "staff_assignments": {
      "name": "staff_assignments",
      "comment": "Replaces instructor_course_access AND sections.instructor_id with one term-aware table. A Fall 2026 director is no longer a director of the course in perpetuity.",
      "rls": true,
      "primaryKey": [
        "id"
      ],
      "labelColumn": "id",
      "columns": [
        {
          "name": "id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "instructor_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "course_offering_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "section_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "role",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "created_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        }
      ],
      "foreignKeys": [
        {
          "name": "staff_assignments_course_offering_id_fkey",
          "columns": [
            "course_offering_id"
          ],
          "refTable": "course_offerings",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        },
        {
          "name": "staff_assignments_instructor_id_fkey",
          "columns": [
            "instructor_id"
          ],
          "refTable": "instructors",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        },
        {
          "name": "staff_assignments_section_id_fkey",
          "columns": [
            "section_id"
          ],
          "refTable": "sections",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        }
      ],
      "enums": {
        "role": [
          "director",
          "instructor",
          "grader"
        ]
      },
      "policyCommands": [
        "ALL",
        "SELECT"
      ],
      "writable": true
    },
    "students": {
      "name": "students",
      "comment": "The person, independent of any course. Cadet ID kept as a natural PK — it is the one key here that genuinely identifies its subject.",
      "rls": true,
      "primaryKey": [
        "student_id"
      ],
      "labelColumn": "name",
      "columns": [
        {
          "name": "student_id",
          "type": "bigint",
          "udt": "int8",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "name",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "auth_user_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "created_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "updated_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "email",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "Real address from the registrar export, and the sign-in identity for accounts provisioned after 2026-07-21. NOT authoritative for how an existing user signs in — auth.users.email is. Students provisioned before that date have a fabricated auth email of <cadet_id>@usafa.edu that is deliberately not mirrored here.",
          "pk": false
        },
        {
          "name": "squadron",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "Cadet squadron from the registrar export. Advisory context for instructors; carries no authorization meaning and is not a grouping the grade or roster model knows about.",
          "pk": false
        },
        {
          "name": "sex",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "major_1",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "major_2",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "major_3",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "advisor_name",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        }
      ],
      "foreignKeys": [],
      "enums": {},
      "policyCommands": [
        "ALL",
        "SELECT"
      ],
      "writable": true
    },
    "submission_activities": {
      "name": "submission_activities",
      "comment": "The actual work, one row per activity the student engaged with — including practice ones. BOTH are kept when a student does both, which is the revealed-preference research signal, while only the chosen activity is graded.",
      "rls": true,
      "primaryKey": [
        "id"
      ],
      "labelColumn": "id",
      "columns": [
        {
          "name": "id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "submission_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "activity_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "content",
          "type": "jsonb",
          "udt": "jsonb",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "report_markdown",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "payload_bytes",
          "type": "integer",
          "udt": "int4",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "is_final",
          "type": "boolean",
          "udt": "bool",
          "nullable": false,
          "default": "false",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "created_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "updated_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        }
      ],
      "foreignKeys": [
        {
          "name": "submission_activities_activity_id_fkey",
          "columns": [
            "activity_id"
          ],
          "refTable": "activities",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        },
        {
          "name": "submission_activities_submission_id_fkey",
          "columns": [
            "submission_id"
          ],
          "refTable": "submissions",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        }
      ],
      "enums": {},
      "policyCommands": [
        "ALL",
        "SELECT"
      ],
      "writable": true
    },
    "submissions": {
      "name": "submissions",
      "comment": "One row per enrollment per assignment offering. The choice, the lock, and the identity of the attempt live together here — which is what makes double-credit structurally impossible rather than merely defended against in application code.",
      "rls": true,
      "primaryKey": [
        "id"
      ],
      "labelColumn": "id",
      "columns": [
        {
          "name": "id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "enrollment_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "assignment_offering_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "chosen_activity_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "Which activity counts for credit. A composite FK guarantees it belongs to this offering, and a trigger guarantees it is grading_role='graded' at the moment it is chosen.",
          "pk": false
        },
        {
          "name": "status",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": "'draft'::text",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "committed_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "unlocked_by",
          "type": "uuid",
          "udt": "uuid",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "The escape hatch the old model lacked: an instructor can clear the committed choice when a student picks the wrong path by accident. The trigger REFUSES an unlock that does not name who performed it, so unlocks are always attributable.",
          "pk": false
        },
        {
          "name": "unlocked_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "created_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "updated_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        }
      ],
      "foreignKeys": [
        {
          "name": "submissions_activity_in_offering",
          "columns": [
            "assignment_offering_id",
            "chosen_activity_id"
          ],
          "refTable": "offering_activities",
          "refColumns": [
            "assignment_offering_id",
            "activity_id"
          ],
          "onDelete": "set null"
        },
        {
          "name": "submissions_assignment_offering_id_fkey",
          "columns": [
            "assignment_offering_id"
          ],
          "refTable": "assignment_offerings",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        },
        {
          "name": "submissions_enrollment_id_fkey",
          "columns": [
            "enrollment_id"
          ],
          "refTable": "enrollments",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        },
        {
          "name": "submissions_unlocked_by_fkey",
          "columns": [
            "unlocked_by"
          ],
          "refTable": "instructors",
          "refColumns": [
            "id"
          ],
          "onDelete": "set null"
        }
      ],
      "enums": {
        "status": [
          "draft",
          "committed",
          "superseded"
        ]
      },
      "policyCommands": [
        "INSERT",
        "SELECT",
        "UPDATE"
      ],
      "writable": true
    },
    "terms": {
      "name": "terms",
      "comment": "The axis the old schema had no concept of.",
      "rls": true,
      "primaryKey": [
        "id"
      ],
      "labelColumn": "code",
      "columns": [
        {
          "name": "id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": "gen_random_uuid()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "code",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "label",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "starts_on",
          "type": "date",
          "udt": "date",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "First day of instruction.",
          "pk": false
        },
        {
          "name": "ends_on",
          "type": "date",
          "udt": "date",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "Last day of instruction — NOT the last day of the term; finals follow.",
          "pk": false
        },
        {
          "name": "created_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "finals_start",
          "type": "date",
          "udt": "date",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "First day of the final exam period.",
          "pk": false
        },
        {
          "name": "finals_end",
          "type": "date",
          "udt": "date",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "Last day of the final exam period.",
          "pk": false
        },
        {
          "name": "grades_due_on",
          "type": "date",
          "udt": "date",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "Deadline for submitting final grades.",
          "pk": false
        }
      ],
      "foreignKeys": [],
      "enums": {},
      "policyCommands": [
        "ALL",
        "SELECT"
      ],
      "writable": true
    },
    "user_preferences": {
      "name": "user_preferences",
      "comment": "Per-user view preferences, keyed on the auth user id so one row serves a person across every device and both roles. PRESENTATION ONLY — never authorization, never grades. The user can write any value here (RLS is self-write), so no code may trust it for anything but rendering. localStorage remains the read-through cache; this table is what makes it survive a device change.",
      "rls": true,
      "primaryKey": [
        "user_id"
      ],
      "labelColumn": "user_id",
      "columns": [
        {
          "name": "user_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "prefs",
          "type": "jsonb",
          "udt": "jsonb",
          "nullable": false,
          "default": "'{}'::jsonb",
          "maxLength": null,
          "generated": false,
          "comment": "Open jsonb bag, keys namespaced to match their localStorage keys (cp.theme, cp.currentOffering, …). Deliberately schemaless: adding a preference must not require unsealing `app` for DDL.",
          "pk": false
        },
        {
          "name": "updated_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": "now()",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        }
      ],
      "foreignKeys": [],
      "enums": {},
      "policyCommands": [
        "DELETE",
        "INSERT",
        "SELECT",
        "UPDATE"
      ],
      "writable": true
    }
  };

/** Table names in a stable, human-sensible order for the picker. */
export const TABLE_NAMES = Object.keys(DB_SCHEMA);

/** Column metadata for one table, or undefined. */
export function tableMeta(name) {
  return DB_SCHEMA[name];
}

/** Tables whose foreign keys point AT `name`, with the delete rule that would apply. */
export function referrers(name) {
  const out = [];
  for (const [tbl, meta] of Object.entries(DB_SCHEMA)) {
    for (const fk of meta.foreignKeys) {
      if (fk.refTable === name) out.push({ table: tbl, fk });
    }
  }
  return out;
}
