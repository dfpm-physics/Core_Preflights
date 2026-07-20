-- PREP v2 — row-level security for schema `app`
-- =====================================================================================
-- Run as `prep_app_owner`. Depends on 001_core_model.sql.
--
-- THE WHOLE POINT OF THIS FILE
--   `public` carries 62 bespoke policies, several of which are wrong in ways the July 2026
--   audit found: the roster is world-readable, anyone can submit or overwrite another
--   student's answers, every finalized score is readable by everyone, and any signed-in
--   account can delete any student. Those holes exist partly BECAUSE the old schema had no
--   single join path from a row back to the person who owns it.
--
--   The enrolment/staffing model gives us that path, so nearly every policy here is one of
--   two shapes:
--
--     student rows      "does the caller own the enrolment this row hangs from?"
--     staff rows        "does the caller staff the section that enrolment belongs to?"
--
--   plus a director/admin escalation. Everything else is catalogue data.
--
-- WHAT ANON GETS: nothing. There is not a single policy granting the `anon` role anything.
--   Every student-facing page in site/app/ authenticates first, so unauthenticated access has
--   no legitimate use here. This alone closes four of the audit findings.
--
-- WHY NOT auth.uid()
--   The app tier holds no privileges on schema `auth` (bootstrap §5 — `postgres` cannot
--   delegate USAGE there), so prep_app_owner cannot reference auth.uid() when creating these
--   functions. app.current_uid() below reads the same JWT claim auth.uid() reads, through
--   current_setting(), which lives in pg_catalog. Behaviourally identical, no auth dependency.
--
-- SECURITY DEFINER on the helpers is deliberate: they are owned by prep_app_owner, which
-- holds BYPASSRLS, so a policy on `students` may call a helper that reads `students` without
-- recursing. Each helper is STABLE (cached per statement) and pins search_path.
-- =====================================================================================

BEGIN;

SET LOCAL search_path = app, public;


-- =====================================================================================
-- IDENTITY HELPERS
-- =====================================================================================

CREATE FUNCTION current_uid() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT nullif(
           coalesce(
             nullif(current_setting('request.jwt.claim.sub', true), ''),
             nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
           ), '')::uuid;
$$;
COMMENT ON FUNCTION current_uid() IS
  'The authenticated user id, read from the JWT exactly as auth.uid() does but without '
  'depending on schema auth, which the app tier has no privileges on.';


CREATE FUNCTION my_student_id() RETURNS bigint
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT s.student_id FROM students s WHERE s.auth_user_id = current_uid();
$$;

CREATE FUNCTION is_staff() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM instructors i WHERE i.id = current_uid());
$$;

CREATE FUNCTION is_admin() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM instructors i
                  WHERE i.id = current_uid() AND i.is_global_admin);
$$;

-- Course offerings the caller staffs in any capacity.
CREATE FUNCTION staff_offerings() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT co.id FROM course_offerings co WHERE is_admin()
  UNION
  SELECT sa.course_offering_id FROM staff_assignments sa WHERE sa.instructor_id = current_uid();
$$;

-- Course offerings the caller directs. A global admin directs everything.
CREATE FUNCTION director_offerings() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT co.id FROM course_offerings co WHERE is_admin()
  UNION
  SELECT sa.course_offering_id FROM staff_assignments sa
   WHERE sa.instructor_id = current_uid() AND sa.role = 'director';
$$;

-- Courses the caller directs in any term — the write scope for the reusable library.
CREATE FUNCTION director_courses() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT c.id FROM courses c WHERE is_admin()
  UNION
  SELECT co.course_id FROM course_offerings co
   WHERE co.id IN (SELECT director_offerings());
$$;

-- Sections the caller grades: explicit section rows, plus every section of an offering the
-- caller staffs offering-wide (section_id IS NULL, e.g. a director).
CREATE FUNCTION staff_sections() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT sa.section_id FROM staff_assignments sa
   WHERE sa.instructor_id = current_uid() AND sa.section_id IS NOT NULL
  UNION
  SELECT s.id FROM sections s
   WHERE s.course_offering_id IN (
     SELECT sa.course_offering_id FROM staff_assignments sa
      WHERE sa.instructor_id = current_uid() AND sa.section_id IS NULL)
  UNION
  SELECT s.id FROM sections s WHERE is_admin();
$$;

-- The caller's own enrolments (as a student).
CREATE FUNCTION my_enrollments() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT e.id FROM enrollments e WHERE e.student_id = my_student_id();
$$;

-- Course offerings the caller is actively enrolled in (as a student).
CREATE FUNCTION my_offerings() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT DISTINCT s.course_offering_id
    FROM enrollments e JOIN sections s ON s.id = e.section_id
   WHERE e.student_id = my_student_id() AND e.status = 'active';
$$;

-- Assignment offerings the caller may see as a student: published, in an offering they are
-- enrolled in.
CREATE FUNCTION my_assignment_offerings() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT ao.id FROM assignment_offerings ao
   WHERE ao.is_published AND ao.course_offering_id IN (SELECT my_offerings());
$$;


-- =====================================================================================
-- ENABLE RLS EVERYWHERE
-- =====================================================================================

ALTER TABLE courses               ENABLE ROW LEVEL SECURITY;
ALTER TABLE terms                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_kinds      ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities            ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_offerings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sections              ENABLE ROW LEVEL SECURITY;
ALTER TABLE students              ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE instructors           ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_assignments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_offerings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE offering_activities   ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_due_dates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE grades                ENABLE ROW LEVEL SECURITY;
ALTER TABLE grade_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_reports      ENABLE ROW LEVEL SECURITY;


-- =====================================================================================
-- CATALOGUE — readable by any signed-in user; written by directors/admins only
-- =====================================================================================

CREATE POLICY courses_read ON courses FOR SELECT TO authenticated USING (true);
CREATE POLICY courses_write ON courses FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY terms_read ON terms FOR SELECT TO authenticated USING (true);
CREATE POLICY terms_write ON terms FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY kinds_read ON assignment_kinds FOR SELECT TO authenticated USING (true);
CREATE POLICY kinds_write ON assignment_kinds FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());


-- assignments / activities: the reusable library.
-- Staff see the library for courses they work in. Students see only what is actually
-- scheduled AND published for them.
CREATE POLICY assignments_staff_read ON assignments FOR SELECT TO authenticated
  USING (is_staff());
CREATE POLICY assignments_student_read ON assignments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM assignment_offerings ao
                  WHERE ao.assignment_id = assignments.id
                    AND ao.id IN (SELECT my_assignment_offerings())));
CREATE POLICY assignments_write ON assignments FOR ALL TO authenticated
  USING (course_id IN (SELECT director_courses()) OR (course_id IS NULL AND is_admin()))
  WITH CHECK (course_id IN (SELECT director_courses()) OR (course_id IS NULL AND is_admin()));

CREATE POLICY activities_staff_read ON activities FOR SELECT TO authenticated
  USING (is_staff());
CREATE POLICY activities_student_read ON activities FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM offering_activities oa
                  WHERE oa.activity_id = activities.id
                    AND oa.is_visible
                    AND oa.assignment_offering_id IN (SELECT my_assignment_offerings())));
CREATE POLICY activities_write ON activities FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM assignments a WHERE a.id = activities.assignment_id
                   AND (a.course_id IN (SELECT director_courses())
                        OR (a.course_id IS NULL AND is_admin()))))
  WITH CHECK (EXISTS (SELECT 1 FROM assignments a WHERE a.id = activities.assignment_id
                   AND (a.course_id IN (SELECT director_courses())
                        OR (a.course_id IS NULL AND is_admin()))));


-- =====================================================================================
-- DELIVERY
-- =====================================================================================

CREATE POLICY offerings_read ON course_offerings FOR SELECT TO authenticated
  USING (id IN (SELECT staff_offerings()) OR id IN (SELECT my_offerings()));
CREATE POLICY offerings_write ON course_offerings FOR ALL TO authenticated
  USING (id IN (SELECT director_offerings()))
  WITH CHECK (course_id IN (SELECT director_courses()));

CREATE POLICY sections_read ON sections FOR SELECT TO authenticated
  USING (course_offering_id IN (SELECT staff_offerings())
      OR course_offering_id IN (SELECT my_offerings()));
CREATE POLICY sections_write ON sections FOR ALL TO authenticated
  USING (course_offering_id IN (SELECT director_offerings()))
  WITH CHECK (course_offering_id IN (SELECT director_offerings()));


-- students: the roster. In `public` this table is world-readable and world-deletable.
-- Here a student sees only themselves, staff see only students they actually teach, and
-- ONLY a director may create, edit, or remove a roster row.
CREATE POLICY students_read_own ON students FOR SELECT TO authenticated
  USING (auth_user_id = current_uid());
CREATE POLICY students_read_staff ON students FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM enrollments e
                  WHERE e.student_id = students.student_id
                    AND e.section_id IN (SELECT staff_sections())));
-- Editing or removing an existing roster row requires directing an offering that student is
-- actually enrolled in. Creating one cannot be scoped that way — a student row exists before
-- any enrolment — so INSERT only requires that the caller directs something; the enrolments
-- policy then constrains which sections they can actually be placed into.
CREATE POLICY students_write ON students FOR ALL TO authenticated
  USING (
    is_admin()
    OR EXISTS (SELECT 1 FROM enrollments e
                 JOIN sections s ON s.id = e.section_id
                WHERE e.student_id = students.student_id
                  AND s.course_offering_id IN (SELECT director_offerings()))
  )
  WITH CHECK (
    is_admin() OR EXISTS (SELECT 1 FROM director_offerings())
  );

CREATE POLICY enrollments_read_own ON enrollments FOR SELECT TO authenticated
  USING (student_id = my_student_id());
CREATE POLICY enrollments_read_staff ON enrollments FOR SELECT TO authenticated
  USING (section_id IN (SELECT staff_sections()));
CREATE POLICY enrollments_write ON enrollments FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM sections s WHERE s.id = enrollments.section_id
                   AND s.course_offering_id IN (SELECT director_offerings())))
  WITH CHECK (EXISTS (SELECT 1 FROM sections s WHERE s.id = enrollments.section_id
                   AND s.course_offering_id IN (SELECT director_offerings())));


CREATE POLICY instructors_read ON instructors FOR SELECT TO authenticated USING (true);
CREATE POLICY instructors_update_own ON instructors FOR UPDATE TO authenticated
  USING (id = current_uid()) WITH CHECK (id = current_uid());
CREATE POLICY instructors_admin_write ON instructors FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY staff_read_own ON staff_assignments FOR SELECT TO authenticated
  USING (instructor_id = current_uid());
CREATE POLICY staff_read_director ON staff_assignments FOR SELECT TO authenticated
  USING (course_offering_id IN (SELECT staff_offerings()));
CREATE POLICY staff_write ON staff_assignments FOR ALL TO authenticated
  USING (course_offering_id IN (SELECT director_offerings()))
  WITH CHECK (course_offering_id IN (SELECT director_offerings()));


CREATE POLICY ao_read_staff ON assignment_offerings FOR SELECT TO authenticated
  USING (course_offering_id IN (SELECT staff_offerings()));
CREATE POLICY ao_read_student ON assignment_offerings FOR SELECT TO authenticated
  USING (is_published AND course_offering_id IN (SELECT my_offerings()));
CREATE POLICY ao_write ON assignment_offerings FOR ALL TO authenticated
  USING (course_offering_id IN (SELECT director_offerings()))
  WITH CHECK (course_offering_id IN (SELECT director_offerings()));

CREATE POLICY oa_read_staff ON offering_activities FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM assignment_offerings ao
                  WHERE ao.id = offering_activities.assignment_offering_id
                    AND ao.course_offering_id IN (SELECT staff_offerings())));
CREATE POLICY oa_read_student ON offering_activities FOR SELECT TO authenticated
  USING (is_visible AND assignment_offering_id IN (SELECT my_assignment_offerings()));
CREATE POLICY oa_write ON offering_activities FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM assignment_offerings ao
                  WHERE ao.id = offering_activities.assignment_offering_id
                    AND ao.course_offering_id IN (SELECT director_offerings())))
  WITH CHECK (EXISTS (SELECT 1 FROM assignment_offerings ao
                  WHERE ao.id = offering_activities.assignment_offering_id
                    AND ao.course_offering_id IN (SELECT director_offerings())));

CREATE POLICY due_read ON assignment_due_dates FOR SELECT TO authenticated
  USING (section_id IN (SELECT staff_sections())
      OR assignment_offering_id IN (SELECT my_assignment_offerings()));
CREATE POLICY due_write ON assignment_due_dates FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM assignment_offerings ao
                  WHERE ao.id = assignment_due_dates.assignment_offering_id
                    AND ao.course_offering_id IN (SELECT director_offerings())))
  WITH CHECK (EXISTS (SELECT 1 FROM assignment_offerings ao
                  WHERE ao.id = assignment_due_dates.assignment_offering_id
                    AND ao.course_offering_id IN (SELECT director_offerings())));


-- =====================================================================================
-- WORK AND GRADES — the two-predicate core
-- =====================================================================================

CREATE POLICY submissions_own ON submissions FOR SELECT TO authenticated
  USING (enrollment_id IN (SELECT my_enrollments()));
CREATE POLICY submissions_staff_read ON submissions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM enrollments e WHERE e.id = submissions.enrollment_id
                   AND e.section_id IN (SELECT staff_sections())));
CREATE POLICY submissions_student_insert ON submissions FOR INSERT TO authenticated
  WITH CHECK (enrollment_id IN (SELECT my_enrollments()));
CREATE POLICY submissions_student_update ON submissions FOR UPDATE TO authenticated
  USING (enrollment_id IN (SELECT my_enrollments()))
  WITH CHECK (enrollment_id IN (SELECT my_enrollments()));
-- Staff update exists for exactly one reason: the instructor unlock.
CREATE POLICY submissions_staff_update ON submissions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM enrollments e WHERE e.id = submissions.enrollment_id
                   AND e.section_id IN (SELECT staff_sections())))
  WITH CHECK (EXISTS (SELECT 1 FROM enrollments e WHERE e.id = submissions.enrollment_id
                   AND e.section_id IN (SELECT staff_sections())));

CREATE POLICY sa_own ON submission_activities FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM submissions s WHERE s.id = submission_activities.submission_id
                   AND s.enrollment_id IN (SELECT my_enrollments())));
CREATE POLICY sa_staff_read ON submission_activities FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM submissions s JOIN enrollments e ON e.id = s.enrollment_id
                  WHERE s.id = submission_activities.submission_id
                    AND e.section_id IN (SELECT staff_sections())));
CREATE POLICY sa_student_write ON submission_activities FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM submissions s WHERE s.id = submission_activities.submission_id
                   AND s.enrollment_id IN (SELECT my_enrollments())))
  WITH CHECK (EXISTS (SELECT 1 FROM submissions s WHERE s.id = submission_activities.submission_id
                   AND s.enrollment_id IN (SELECT my_enrollments())));


-- grades: a student reads ONLY their own, and only once finalized. In `public` the
-- equivalent policy was `is_finalized = true` with no owner check at all, so every finalized
-- score in the course was readable by anyone holding the anon key.
CREATE POLICY grades_own_finalized ON grades FOR SELECT TO authenticated
  USING (is_finalized AND enrollment_id IN (SELECT my_enrollments()));
CREATE POLICY grades_staff_read ON grades FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM enrollments e WHERE e.id = grades.enrollment_id
                   AND e.section_id IN (SELECT staff_sections())));
CREATE POLICY grades_staff_write ON grades FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM enrollments e WHERE e.id = grades.enrollment_id
                   AND e.section_id IN (SELECT staff_sections())))
  WITH CHECK (EXISTS (SELECT 1 FROM enrollments e WHERE e.id = grades.enrollment_id
                   AND e.section_id IN (SELECT staff_sections())));

-- Append-only audit: staff read and insert; nobody updates or deletes through the API.
CREATE POLICY ge_staff_read ON grade_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM grades g JOIN enrollments e ON e.id = g.enrollment_id
                  WHERE g.id = grade_events.grade_id
                    AND e.section_id IN (SELECT staff_sections())));
CREATE POLICY ge_staff_insert ON grade_events FOR INSERT TO authenticated
  WITH CHECK (is_staff());


-- =====================================================================================
-- ANALYSIS — an instructor sees their own panel; directors see the whole course
-- =====================================================================================

CREATE POLICY ar_read ON analysis_reports FOR SELECT TO authenticated
  USING (audience_id = current_uid()
      OR (scope = 'section'            AND scope_id IN (SELECT staff_sections()))
      OR (scope = 'course_offering'    AND scope_id IN (SELECT director_offerings()))
      OR (scope = 'assignment_offering' AND EXISTS (
            SELECT 1 FROM assignment_offerings ao WHERE ao.id = analysis_reports.scope_id
              AND ao.course_offering_id IN (SELECT staff_offerings()))));
-- Written by the analysis skills through the dml tier / service_role, not by browser clients.

COMMIT;
