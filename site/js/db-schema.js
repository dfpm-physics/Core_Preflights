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
// tests/app-schema/test-db-schema.mjs fails when this file drifts from staging.
//
// Source: scripts/app/gen_db_schema.py · schema `app` · 46 tables
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
          "comment": "written and interactive are the original two. questions (online question set marked by the system) and external (in person, or worked elsewhere and entered or imported) carry no artifact and no typed response.",
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
          "interactive",
          "questions",
          "external"
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
        },
        {
          "name": "report_code",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "The heading and group a report prints for this kind. A label, never a switch for behaviour.",
          "pk": false
        },
        {
          "name": "default_delivery",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "Prefill for the entry form only. No code branches on it; the path row (offering_activities) is what counts.",
          "pk": false
        },
        {
          "name": "default_grading",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "Prefill for the entry form only. No code branches on it; the path row (offering_activities) is what counts.",
          "pk": false
        }
      ],
      "foreignKeys": [],
      "enums": {
        "default_delivery": [
          "online_questions",
          "typed_response",
          "interactive_tutor",
          "in_person",
          "elsewhere"
        ],
        "default_grading": [
          "auto_checked",
          "human_graded",
          "effort",
          "hand_entered",
          "imported"
        ]
      },
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
        },
        {
          "name": "due_by_day",
          "type": "jsonb",
          "udt": "jsonb",
          "nullable": false,
          "default": "'{}'::jsonb",
          "maxLength": null,
          "generated": false,
          "comment": "Per-meeting-day deadlines for this scheduled assignment, keyed by the day letters used in sections.meeting_days: {\"M\": timestamptz, \"T\": timestamptz}. The DEFAULT deadline source for a section, resolved as due_by_day[day] for each day in that section's meeting_days. A section added after scheduling is therefore correct with no lesson re-save. Precedence: student extension > assignment_due_dates (explicit per-section override) > due_by_day > due_at. `{}` means no per-day schedule and due_at applies to everyone.",
          "pk": false
        },
        {
          "name": "late_allowed",
          "type": "boolean",
          "udt": "bool",
          "nullable": false,
          "default": "false",
          "maxLength": null,
          "generated": false,
          "comment": "Whether late work is accepted. The DEFAULT stays false so current preflights keep refusing late work; the new entry page starts it checked, as GRADE-RULES.md says.",
          "pk": false
        },
        {
          "name": "is_bonus",
          "type": "boolean",
          "udt": "bool",
          "nullable": false,
          "default": "false",
          "maxLength": null,
          "generated": false,
          "comment": "Adds to earned only; contributes 0 to possible.",
          "pk": false
        },
        {
          "name": "allow_over_max",
          "type": "boolean",
          "udt": "bool",
          "nullable": false,
          "default": "false",
          "maxLength": null,
          "generated": false,
          "comment": "An ordinary item (an exam with an extra-credit question) may score above its maximum.",
          "pk": false
        },
        {
          "name": "prog_included",
          "type": "boolean",
          "udt": "bool",
          "nullable": false,
          "default": "false",
          "maxLength": null,
          "generated": false,
          "comment": "Counts at Prog. An instructor sets it, through set_prog_flag().",
          "pk": false
        },
        {
          "name": "grades_release_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "NULL means a grade shows when it is finalized.",
          "pk": false
        },
        {
          "name": "attempt_limit",
          "type": "smallint",
          "udt": "int2",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "Per question, auto-checked paths only. NULL means no limit.",
          "pk": false
        },
        {
          "name": "attempt_rule",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": "'best'::text",
          "maxLength": null,
          "generated": false,
          "comment": "Which attempt counts, per question: best, last or first.",
          "pk": false
        },
        {
          "name": "part_set_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "Joins required parts for display. See part_sets.",
          "pk": false
        },
        {
          "name": "entered_on_new_page",
          "type": "boolean",
          "udt": "bool",
          "nullable": false,
          "default": "false",
          "maxLength": null,
          "generated": false,
          "comment": "Says which page owns a row: true means entered on a v2 page. TEMPORARY, removed at step 2 with the three step 1 rules. It says who owns the row, never what kind of work it is.",
          "pk": false
        },
        {
          "name": "is_group_work",
          "type": "boolean",
          "udt": "bool",
          "nullable": false,
          "default": "false",
          "maxLength": null,
          "generated": false,
          "comment": "Group work: scores are spread to members through app.apply_group_score.",
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
        },
        {
          "name": "assignment_offerings_part_set_fk",
          "columns": [
            "part_set_id",
            "course_offering_id"
          ],
          "refTable": "part_sets",
          "refColumns": [
            "id",
            "course_offering_id"
          ],
          "onDelete": "set null"
        }
      ],
      "enums": {
        "attempt_rule": [
          "best",
          "last",
          "first"
        ],
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
        },
        {
          "name": "origin_assignment_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "Lineage for rollover. Rollover still makes new assignment and activity rows with new slugs; this only records where a copy came from. SET NULL, so deleting a source lesson still works.",
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
        },
        {
          "name": "assignments_origin_assignment_id_fkey",
          "columns": [
            "origin_assignment_id"
          ],
          "refTable": "assignments",
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
    "checkpoint_tie_choices": {
      "name": "checkpoint_tie_choices",
      "comment": null,
      "rls": true,
      "primaryKey": [
        "run_id",
        "tie_group"
      ],
      "labelColumn": "run_id",
      "columns": [
        {
          "name": "run_id",
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
          "name": "tie_group",
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
          "name": "choice",
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
          "name": "chosen_by",
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
          "name": "chosen_at",
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
          "name": "checkpoint_tie_choices_run_id_fkey",
          "columns": [
            "run_id"
          ],
          "refTable": "grade_checkpoint_runs",
          "refColumns": [
            "id"
          ],
          "onDelete": "restrict"
        }
      ],
      "enums": {
        "choice": [
          "same_rank",
          "alphabetical"
        ]
      },
      "policyCommands": [
        "SELECT"
      ],
      "writable": false
    },
    "column_closures": {
      "name": "column_closures",
      "comment": "An instructor closes the column of a no-submission item for one section. Before that a blank is awaiting entry and leaves the total; after it a blank counts 0. Nothing closes by itself. Reopening stamps reopened_at; the row stays as the record.",
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
          "name": "closed_by",
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
          "name": "closed_at",
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
          "name": "reopened_by",
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
          "name": "reopened_at",
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
          "name": "column_closures_assignment_offering_id_fkey",
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
          "name": "column_closures_closed_by_fkey",
          "columns": [
            "closed_by"
          ],
          "refTable": "instructors",
          "refColumns": [
            "id"
          ],
          "onDelete": "set null"
        },
        {
          "name": "column_closures_reopened_by_fkey",
          "columns": [
            "reopened_by"
          ],
          "refTable": "instructors",
          "refColumns": [
            "id"
          ],
          "onDelete": "set null"
        },
        {
          "name": "column_closures_section_id_fkey",
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
        "INSERT",
        "SELECT",
        "UPDATE"
      ],
      "writable": true
    },
    "course_grade_history": {
      "name": "course_grade_history",
      "comment": "Prior terms' averages and GPAs, entered by hand; later terms fill from approved checkpoints. The comparison report prints two prior terms. Staff of the course read, Directors write, no student policy.",
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
          "name": "term_report_code",
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
          "name": "prog_gpa",
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
          "name": "final_gpa",
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
          "name": "prog_avg",
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
          "name": "final_avg",
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
          "name": "source",
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
          "name": "course_grade_history_course_id_fkey",
          "columns": [
            "course_id"
          ],
          "refTable": "courses",
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
    "course_offering_settings": {
      "name": "course_offering_settings",
      "comment": "Staff-only settings of one course offering. A row is optional. Kept apart from course_offerings because every cadet of an offering can read every column of their course_offerings row.",
      "rls": true,
      "primaryKey": [
        "course_offering_id"
      ],
      "labelColumn": "course_offering_id",
      "columns": [
        {
          "name": "course_offering_id",
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
          "name": "incoming_gpa",
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
          "name": "blackboard_export",
          "type": "boolean",
          "udt": "bool",
          "nullable": false,
          "default": "false",
          "maxLength": null,
          "generated": false,
          "comment": "Whether this course uses the one-overall-grade Blackboard export.",
          "pk": false
        },
        {
          "name": "bb_prog_column",
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
          "name": "bb_final_column",
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
          "name": "course_offering_settings_course_offering_id_fkey",
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
          "default": "false",
          "maxLength": null,
          "generated": false,
          "comment": "Steers tools, not people: it decides what jobs and the Health page look at. It hides a course from nobody. DEFAULT false; at most one active offering per course (course_offerings_one_active).",
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
        },
        {
          "name": "subject",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "Report heading, for example PHYS. Provisional until the report copies arrive.",
          "pk": false
        },
        {
          "name": "course_number",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "Report heading, for example 215. Provisional until the report copies arrive.",
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
        },
        {
          "name": "completed_at",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "When the accepted item was actually built. NULL = agreed to, not done yet. Separate from status on purpose: status is the triage DECISION, this is the OUTCOME. Does NOT affect the roadmap work list (status = 'accepted' AND roadmap_ref IS NULL) — a shipped item still wants a ROADMAP.md §8 line.",
          "pk": false
        },
        {
          "name": "completed_by",
          "type": "uuid",
          "udt": "uuid",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "Which admin marked it done. NULL when never completed, or when that admin's row was deleted.",
          "pk": false
        }
      ],
      "foreignKeys": [
        {
          "name": "feedback_completed_by_fkey",
          "columns": [
            "completed_by"
          ],
          "refTable": "instructors",
          "refColumns": [
            "id"
          ],
          "onDelete": "set null"
        },
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
    "grade_checkpoint_rows": {
      "name": "grade_checkpoint_rows",
      "comment": "A frozen record. enrollment_id, student_id and section_id are plain values with no foreign key, so removing a person or a section never touches an approved record.",
      "rls": true,
      "primaryKey": [
        "run_id",
        "enrollment_id"
      ],
      "labelColumn": "run_id",
      "columns": [
        {
          "name": "run_id",
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
          "name": "enrollment_id",
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
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "earned",
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
          "name": "possible",
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
          "name": "percent_text",
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
          "name": "percent_key",
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
          "name": "letter",
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
          "name": "gpa",
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
          "name": "rank",
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
          "name": "tie_group",
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
          "name": "near_line_letter",
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
          "name": "missing_count",
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
          "name": "ungraded_count",
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
          "name": "unreleased_count",
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
          "name": "excused_count",
          "type": "integer",
          "udt": "int4",
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
          "name": "grade_checkpoint_rows_run_id_fkey",
          "columns": [
            "run_id"
          ],
          "refTable": "grade_checkpoint_runs",
          "refColumns": [
            "id"
          ],
          "onDelete": "restrict"
        }
      ],
      "enums": {},
      "policyCommands": [
        "SELECT"
      ],
      "writable": false
    },
    "grade_checkpoint_runs": {
      "name": "grade_checkpoint_runs",
      "comment": "One run of a Prog or Final checkpoint. Every run is kept. Once approved the header refuses every change except approved -> superseded; the rows and tie choices refuse every write.",
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
          "name": "period",
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
          "name": "run_no",
          "type": "integer",
          "udt": "int4",
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
          "default": "'draft'::text",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "scale_snapshot",
          "type": "jsonb",
          "udt": "jsonb",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "rule_version",
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
          "name": "as_of",
          "type": "timestamp with time zone",
          "udt": "timestamptz",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "source_fingerprint",
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
          "name": "exceptions",
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
          "name": "created_by",
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
          "name": "approved_by",
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
          "name": "approved_at",
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
          "name": "revises_run_id",
          "type": "uuid",
          "udt": "uuid",
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
          "name": "grade_checkpoint_runs_course_offering_id_fkey",
          "columns": [
            "course_offering_id"
          ],
          "refTable": "course_offerings",
          "refColumns": [
            "id"
          ],
          "onDelete": "restrict"
        },
        {
          "name": "grade_checkpoint_runs_revises_run_id_fkey",
          "columns": [
            "revises_run_id"
          ],
          "refTable": "grade_checkpoint_runs",
          "refColumns": [
            "id"
          ],
          "onDelete": "restrict"
        }
      ],
      "enums": {
        "period": [
          "prog",
          "final"
        ],
        "status": [
          "draft",
          "approved",
          "superseded"
        ]
      },
      "policyCommands": [
        "SELECT"
      ],
      "writable": false
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
    "grade_excusal_events": {
      "name": "grade_excusal_events",
      "comment": "Append-only. Written only by the SECURITY DEFINER trigger on grade_excusals; no foreign keys, so the log outlives the excusal, the enrollment and the lesson it describes.",
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
          "name": "excusal_id",
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
          "name": "enrollment_id",
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
          "name": "action",
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
          "name": "at",
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
          "name": "reason",
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
      "enums": {
        "action": [
          "excused",
          "revoked",
          "removed"
        ]
      },
      "policyCommands": [
        "SELECT"
      ],
      "writable": false
    },
    "grade_excusals": {
      "name": "grade_excusals",
      "comment": "An excusal removes an item from a student's total. Only a Director can set one (RLS), every change is logged (grade_excusal_events), and the grade row is never touched. Removal is a revoke, never a delete.",
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
          "name": "reason",
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
          "name": "set_by",
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
          "name": "set_at",
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
          "comment": null,
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
          "comment": null,
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
          "name": "grade_excusals_assignment_offering_id_fkey",
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
          "name": "grade_excusals_enrollment_id_fkey",
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
          "name": "grade_excusals_revoked_by_fkey",
          "columns": [
            "revoked_by"
          ],
          "refTable": "instructors",
          "refColumns": [
            "id"
          ],
          "onDelete": "set null"
        },
        {
          "name": "grade_excusals_set_by_fkey",
          "columns": [
            "set_by"
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
        "SELECT",
        "UPDATE"
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
        },
        {
          "name": "over_max_allowed",
          "type": "boolean",
          "udt": "bool",
          "nullable": false,
          "default": "false",
          "maxLength": null,
          "generated": false,
          "comment": "True only when a trigger found the offering is_bonus or allow_over_max. A client cannot set it: grades_over_max_guard overwrites whatever was sent.",
          "pk": false
        },
        {
          "name": "student_group_id",
          "type": "uuid",
          "udt": "uuid",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "The group this grade was written from, if any. The grade outlives the group.",
          "pk": false
        },
        {
          "name": "student_group_adjusted",
          "type": "boolean",
          "udt": "bool",
          "nullable": false,
          "default": "false",
          "maxLength": null,
          "generated": false,
          "comment": "True once one member's score was changed by hand. apply_group_score skips such rows unless a Director names them.",
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
          "name": "grades_student_group_id_fkey",
          "columns": [
            "student_group_id"
          ],
          "refTable": "student_groups",
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
          "imported",
          "auto_checked"
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
    "key_remark_runs": {
      "name": "key_remark_runs",
      "comment": "One row per re-mark of a question against a corrected key: who, when, from and to which version, how many attempts changed, and how many instructor-corrected grades were listed rather than changed. Written by app.remark_question (Stage E).",
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
          "name": "question_id",
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
          "name": "from_key_version",
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
          "name": "to_key_version",
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
          "name": "run_by",
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
          "name": "run_at",
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
          "name": "attempts_changed",
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
          "name": "grades_recomputed",
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
          "name": "grades_listed",
          "type": "integer",
          "udt": "int4",
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
          "name": "key_remark_runs_question_id_fkey",
          "columns": [
            "question_id"
          ],
          "refTable": "questions",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        }
      ],
      "enums": {},
      "policyCommands": [
        "SELECT"
      ],
      "writable": false
    },
    "letter_scales": {
      "name": "letter_scales",
      "comment": "Versioned letter scale per course offering. Editing makes a new version and retires the old one; checkpoints keep a copy of the scale they used. An offering with no row uses default_letter_scale().",
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
          "name": "version",
          "type": "integer",
          "udt": "int4",
          "nullable": false,
          "default": "1",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "lines",
          "type": "jsonb",
          "udt": "jsonb",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "near_line_width",
          "type": "numeric",
          "udt": "numeric",
          "nullable": false,
          "default": "0.1",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "created_by",
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
          "name": "retired_at",
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
          "name": "letter_scales_course_offering_id_fkey",
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
          "name": "letter_scales_created_by_fkey",
          "columns": [
            "created_by"
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
        },
        {
          "name": "delivery",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "How the student does the work. Nullable until step 2 (NOT NULL after the backfill); the fill trigger supplies it for written and interactive paths.",
          "pk": false
        },
        {
          "name": "grading",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "How the work is graded. See offering_activities_delivery_grading_ck for the allowed pairs.",
          "pk": false
        },
        {
          "name": "warn_earns_full",
          "type": "boolean",
          "udt": "bool",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "Whether a yellow (warn) mark earns full credit. True only with human_graded. New items write false; backfilled preflights write true.",
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
    "part_sets": {
      "name": "part_sets",
      "comment": "Required parts of one piece of work (a lab: prelab online, report elsewhere). Each part is its own assignment_offerings row with its own column, points, deadline and grade; this row only joins them for display. Alternatives (do one of these) are NOT parts: those stay as several graded paths on one offering.",
      "rls": true,
      "primaryKey": [
        "id"
      ],
      "labelColumn": "title",
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
        }
      ],
      "foreignKeys": [
        {
          "name": "part_sets_course_offering_id_fkey",
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
    "question_attempts": {
      "name": "question_attempts",
      "comment": "Every answer is a row, written only by a server function. The grade is recomputed from these rows and written to grades (source auto_checked); the total reads grades, never attempts. answer holds the raw text and parsed_value the number read from it. key_version_id records which key version marked it.",
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
          "name": "question_id",
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
          "name": "attempt_no",
          "type": "integer",
          "udt": "int4",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "answer",
          "type": "jsonb",
          "udt": "jsonb",
          "nullable": false,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "parsed_value",
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
          "name": "is_correct",
          "type": "boolean",
          "udt": "bool",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "points_awarded",
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
          "name": "key_version_id",
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
          "name": "answered_at",
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
          "name": "is_late",
          "type": "boolean",
          "udt": "bool",
          "nullable": false,
          "default": "false",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        }
      ],
      "foreignKeys": [
        {
          "name": "question_attempts_assignment_offering_id_fkey",
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
          "name": "question_attempts_enrollment_id_fkey",
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
          "name": "question_attempts_key_version_id_fkey",
          "columns": [
            "key_version_id"
          ],
          "refTable": "question_keys",
          "refColumns": [
            "id"
          ],
          "onDelete": "restrict"
        },
        {
          "name": "question_attempts_question_id_fkey",
          "columns": [
            "question_id"
          ],
          "refTable": "questions",
          "refColumns": [
            "id"
          ],
          "onDelete": "restrict"
        }
      ],
      "enums": {},
      "policyCommands": [
        "SELECT"
      ],
      "writable": false
    },
    "question_keys": {
      "name": "question_keys",
      "comment": "Answer keys. Staff-only and versioned; a corrected key is a new version and the old one gets superseded_at. variant_key is empty today, so per-student values can be added later with no change here. A correct value of 0 must carry tol_abs, because a percentage tolerance is useless there. NO student policy, ever.",
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
          "name": "question_id",
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
          "name": "variant_key",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": "''::text",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "version",
          "type": "integer",
          "udt": "int4",
          "nullable": false,
          "default": "1",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "correct_choice_ids",
          "type": "ARRAY",
          "udt": "_text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "select_rule",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": "'all_or_nothing'::text",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "value",
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
          "name": "tol_abs",
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
          "name": "tol_pct",
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
          "name": "sig_figs",
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
          "name": "sig_fig_mode",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": "'ignore'::text",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "unit",
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
          "name": "unit_aliases",
          "type": "ARRAY",
          "udt": "_text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "unit_mode",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": "'ignore'::text",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "reference_text",
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
          "name": "written_by",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": "'human'::text",
          "maxLength": null,
          "generated": false,
          "comment": "human or ai. Publishing is refused while an ai-written key has no checked_by.",
          "pk": false
        },
        {
          "name": "checked_by",
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
          "name": "checked_at",
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
          "name": "created_by",
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
          "name": "superseded_at",
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
          "name": "question_keys_checked_by_fkey",
          "columns": [
            "checked_by"
          ],
          "refTable": "instructors",
          "refColumns": [
            "id"
          ],
          "onDelete": "set null"
        },
        {
          "name": "question_keys_created_by_fkey",
          "columns": [
            "created_by"
          ],
          "refTable": "instructors",
          "refColumns": [
            "id"
          ],
          "onDelete": "set null"
        },
        {
          "name": "question_keys_question_id_fkey",
          "columns": [
            "question_id"
          ],
          "refTable": "questions",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        }
      ],
      "enums": {
        "sig_fig_mode": [
          "ignore",
          "warn",
          "require"
        ],
        "unit_mode": [
          "ignore",
          "warn",
          "require"
        ],
        "written_by": [
          "human",
          "ai"
        ]
      },
      "policyCommands": [
        "ALL",
        "SELECT"
      ],
      "writable": true
    },
    "questions": {
      "name": "questions",
      "comment": "One row per question of an activity. qid is the stable id (the key in grades.question_scores) and is never reused. A retired question stays, so old attempts still resolve. Answer keys are NOT here; see question_keys.",
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
          "name": "qid",
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
          "name": "prompt_md",
          "type": "text",
          "udt": "text",
          "nullable": false,
          "default": "''::text",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "figure_url",
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
          "name": "unit_hint",
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
          "name": "is_retired",
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
          "name": "format",
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
          "name": "choices",
          "type": "jsonb",
          "udt": "jsonb",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "[{\"id\",\"text\"}] for multiple choice and select. Which choice is correct is not stored here.",
          "pk": false
        },
        {
          "name": "points",
          "type": "numeric",
          "udt": "numeric",
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
          "name": "questions_activity_id_fkey",
          "columns": [
            "activity_id"
          ],
          "refTable": "activities",
          "refColumns": [
            "id"
          ],
          "onDelete": "cascade"
        }
      ],
      "enums": {
        "format": [
          "multiple_choice",
          "multiple_select",
          "numeric",
          "prose"
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
    "student_group_grades": {
      "name": "student_group_grades",
      "comment": "The group's score for an item. Each member still gets a normal grades row written from it.",
      "rls": true,
      "primaryKey": [
        "group_id",
        "assignment_offering_id"
      ],
      "labelColumn": "group_id",
      "columns": [
        {
          "name": "group_id",
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
          "name": "points",
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
          "name": "entered_by",
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
          "name": "entered_at",
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
          "name": "student_group_grades_assignment_offering_id_fkey",
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
          "name": "student_group_grades_group_id_fkey",
          "columns": [
            "group_id"
          ],
          "refTable": "student_groups",
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
    "student_group_members": {
      "name": "student_group_members",
      "comment": null,
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
          "name": "group_id",
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
          "name": "joined_at",
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
          "name": "left_at",
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
          "name": "student_group_members_enrollment_id_fkey",
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
          "name": "student_group_members_group_id_fkey",
          "columns": [
            "group_id"
          ],
          "refTable": "student_groups",
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
    "student_group_snapshots": {
      "name": "student_group_snapshots",
      "comment": "Who was in the group when that work was handed in. Plain who-column, no foreign key.",
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
          "name": "group_id",
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
          "name": "captured_at",
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
          "name": "captured_by",
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
          "name": "reason",
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
          "name": "student_group_snapshots_assignment_offering_id_fkey",
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
          "name": "student_group_snapshots_enrollment_id_fkey",
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
          "name": "student_group_snapshots_group_id_fkey",
          "columns": [
            "group_id"
          ],
          "refTable": "student_groups",
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
    "student_groups": {
      "name": "student_groups",
      "comment": "A named group of enrollments within one course offering, for group work.",
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
          "name": "student_groups_course_offering_id_fkey",
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
        },
        {
          "name": "class_year",
          "type": "smallint",
          "udt": "int2",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "Cadet year on approval sheets. Filled by a later roster import. Provisional.",
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
    "submission_receipts": {
      "name": "submission_receipts",
      "comment": "For typed and tutor work: what was committed (a hash) and when. committed_at is set by the database, never by the client. actor is a plain uuid, with no foreign key, so removing a person never touches a receipt.",
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
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": false
        },
        {
          "name": "content_sha256",
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
          "name": "committed_at",
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
          "name": "is_late",
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
          "name": "actor",
          "type": "uuid",
          "udt": "uuid",
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
          "name": "submission_receipts_activity_id_fkey",
          "columns": [
            "activity_id"
          ],
          "refTable": "activities",
          "refColumns": [
            "id"
          ],
          "onDelete": "set null"
        },
        {
          "name": "submission_receipts_submission_id_fkey",
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
        "SELECT"
      ],
      "writable": false
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
        },
        {
          "name": "report_code",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "The term as a report prints it, such as 20261. Provisional.",
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
    "tutor_error_log": {
      "name": "tutor_error_log",
      "comment": "One row per tutor request failure a cadet actually saw, written by the log-tutor-error edge function. Contains no conversation text by construction (CORE.md section 3).",
      "rls": true,
      "primaryKey": [
        "id"
      ],
      "labelColumn": "slug",
      "columns": [
        {
          "name": "id",
          "type": "bigint",
          "udt": "int8",
          "nullable": false,
          "default": "nextval('app.tutor_error_log_id_seq'::regclass)",
          "maxLength": null,
          "generated": false,
          "comment": null,
          "pk": true
        },
        {
          "name": "logged_at",
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
          "name": "cadet_id",
          "type": "bigint",
          "udt": "int8",
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
          "name": "http_status",
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
          "name": "finish_reason",
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
          "name": "model",
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
          "name": "mode",
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
          "name": "phase",
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
          "name": "turn",
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
          "name": "session_sec",
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
          "name": "ladder_resets",
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
          "name": "max_tokens",
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
          "name": "thinking_budget",
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
          "name": "models",
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
          "name": "client",
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
          "name": "cadet_ref",
          "type": "text",
          "udt": "text",
          "nullable": true,
          "default": null,
          "maxLength": null,
          "generated": false,
          "comment": "Whatever the cadet typed into the identity box -- on the backup lessons that is a LAST NAME, not an ID. A claim typed on an unauthenticated page; match by eye, never trust downstream.",
          "pk": false
        }
      ],
      "foreignKeys": [],
      "enums": {},
      "policyCommands": [
        "SELECT"
      ],
      "writable": false
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
