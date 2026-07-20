// test-nav.mjs — the course-view picker, tested without a DOM.
//
// courseMenuHTML() is exported as a pure function precisely so this is possible: the rest of
// renderNav() writes innerHTML and needs a browser, but the decision of WHAT to offer — who
// sees a picker at all, how terms are grouped, which row is marked current — is exactly the
// part worth testing, and it is all string in / string out.

import { check, eq, section, installBrowser } from './harness.mjs';

installBrowser({});   // nav.js imports util.js, which reads `location` at module load
const { courseMenuHTML } = await import('../../site/app/js/nav.js');

const OFF_215 = { offeringId: 'o-215-f26', courseId: 'c-215', courseCode: 'phys-215',
                  courseTitle: 'Physics 215', termCode: 'fall-2026', termLabel: 'Fall 2026', role: 'director' };
const OFF_110 = { offeringId: 'o-110-f26', courseId: 'c-110', courseCode: 'phys-110',
                  courseTitle: 'Physics 110', termCode: 'fall-2026', termLabel: 'Fall 2026', role: 'instructor' };
const OFF_215_S27 = { ...OFF_215, offeringId: 'o-215-s27', termCode: 'spring-2027',
                      termLabel: 'Spring 2027', role: 'instructor' };

const ctxOf = (courses, current, extra = {}) =>
  ({ courses, currentOffering: current, role: 'faculty', instructorRow: { name: 'X' }, ...extra });

section('course-view picker — when it appears');

eq('no picker with a single offering (nothing to switch to)',
   courseMenuHTML(ctxOf([OFF_215], 'o-215-f26')), '');
eq('no picker with no offerings at all',
   courseMenuHTML(ctxOf([], null)), '');
check('picker appears with two offerings',
      courseMenuHTML(ctxOf([OFF_215, OFF_110], 'o-215-f26')).includes('course-opt'));

section('current selection');

const two = courseMenuHTML(ctxOf([OFF_215, OFF_110], 'o-215-f26'));
check('both offerings are listed', (two.match(/class="menu-item course-opt/g) || []).length === 2);
check('exactly one row is marked active', (two.match(/course-opt active/g) || []).length === 1);
check('the active row is the current offering',
      /course-opt active[\s\S]*?data-course="o-215-f26"/.test(two));
check('the active row is checked for assistive tech', two.includes('aria-checked="true"'));
check('the inactive row is not checked', two.includes('aria-checked="false"'));
check('each row carries its offering id for the click handler',
      two.includes('data-course="o-215-f26"') && two.includes('data-course="o-110-f26"'));

section('term grouping');

// One term: the term is per-row detail, not a heading — a heading would just repeat itself.
check('single term => no term subheadings', !two.includes('menu-subhead'));
check('single term => term shown on the row instead', two.includes('Fall 2026'));

// Two terms: the term becomes the grouping, and stops being repeated on every row.
const across = courseMenuHTML(ctxOf([OFF_215, OFF_215_S27], 'o-215-f26'));
check('multiple terms => term subheadings appear', across.includes('menu-subhead'));
eq('one subheading per term', (across.match(/menu-subhead/g) || []).length, 2);
check('both terms are named', across.includes('Fall 2026') && across.includes('Spring 2027'));
check('the same course in two terms is two distinct rows',
      across.includes('data-course="o-215-f26"') && across.includes('data-course="o-215-s27"'));

section('role labelling');

check('a director sees their role on the row', two.includes('Director'));
check('an instructor sees theirs', two.includes('Instructor'));
// A global admin holds every offering; auth.js labels them all 'director', which would be
// misleading on the row. The picker says Admin instead.
const admin = courseMenuHTML(ctxOf([OFF_215, OFF_110], 'o-215-f26',
                                   { instructorRow: { name: 'A', is_global_admin: true } }));
check('a global admin is labelled Admin, not Director',
      admin.includes('Admin') && !admin.includes('Director'));

section('escaping');

// Course titles are director-supplied text, so they reach this function untrusted.
const nasty = courseMenuHTML(ctxOf(
  [{ ...OFF_215, courseTitle: '<img src=x onerror=alert(1)>' }, OFF_110], 'o-215-f26'));
check('a course title is HTML-escaped', !nasty.includes('<img src=x'));
check('…and the escaped form is present', nasty.includes('&lt;img'));

section('students switch too');

// A student enrolled in two courses needs this for the same reason faculty do.
const student = courseMenuHTML({
  courses: [OFF_215, OFF_110], currentOffering: 'o-110-f26', role: 'student', studentRow: { name: 'S' },
});
check('a student with two enrolments gets a picker', student.includes('course-opt'));
check('…marking the right one', /course-opt active[\s\S]*?data-course="o-110-f26"/.test(student));
