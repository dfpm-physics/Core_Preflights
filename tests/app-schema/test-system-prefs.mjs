// test-system-prefs.mjs — the view defaults behind System > Data.
//
// WHY THIS EARNS ITS PLACE
//   CURATED_COLUMNS names columns as strings. Nothing in JavaScript checks a string against the
//   database, so a migration that renames or drops a column leaves a curated entry pointing at
//   nothing — and the symptom is silent: system-prefs.js filters unknown names out, so the column
//   simply stops appearing and the administrator never learns it existed. That is exactly the
//   failure a test should catch, and it is cheap to catch: db-schema.js already knows every real
//   column name.
//
//   The humanizer is tested because it decides what every header, picker entry and modal title
//   says. Its one subtle rule — strip `_id` for a real foreign key, keep it otherwise — is the
//   difference between "Course Offering" (correct: the cell shows the offering's label) and
//   "Student" for students.student_id (wrong: that column is a cadet number, not a hidden key).
//
// Pure and offline: system-prefs.js imports only db-schema.js, deliberately, so this needs no
// database and no network. It does need a localStorage stub for the persistence checks.

import { check, eq, section, installBrowser } from './harness.mjs';

// Must precede the import: system-prefs.js touches localStorage on first read.
installBrowser({ pathname: '/site/faculty/system.html' });

const P = await import('../../site/js/system-prefs.js');
const { DB_SCHEMA, TABLE_NAMES, tableMeta } = await import('../../site/js/db-schema.js');

section('system-prefs.js — display names');

eq('humanizeTable underscores to Title Case',
   P.humanizeTable('assignment_offerings'), 'Assignment Offerings');
eq('humanizeTable single word', P.humanizeTable('courses'), 'Courses');
eq('humanizeTable three words',
   P.humanizeTable('submission_activities'), 'Submission Activities');

// `course_offering_id` IS a foreign key on sections, so the suffix goes: the cell renders the
// offering's label, not the uuid.
eq('foreign key drops the _id suffix',
   P.humanizeColumn('sections', 'course_offering_id'), 'Course Offering');
eq('foreign key drops _id (staff_assignments.instructor_id)',
   P.humanizeColumn('staff_assignments', 'instructor_id'), 'Instructor');

// `students.student_id` is the primary key — a cadet number, not a foreign key — so it keeps its
// suffix, and `id` is an acronym rather than a word.
eq('non-FK _id column keeps its suffix as an acronym',
   P.humanizeColumn('students', 'student_id'), 'Student ID');
eq('plain column Title Cases', P.humanizeColumn('grades', 'is_finalized'), 'Is Finalized');
eq('single word column', P.humanizeColumn('grades', 'effort'), 'Effort');

section('system-prefs.js — curated defaults exist in the schema');

// The drift guard. Every curated column must be a real column on that table, and every curated
// table must be a real table.
let unknownTables = [], unknownColumns = [];
for (const [table, columns] of Object.entries(P.CURATED_COLUMNS)) {
  if (!DB_SCHEMA[table]) { unknownTables.push(table); continue; }
  const real = new Set(tableMeta(table).columns.map(c => c.name));
  for (const col of columns) if (!real.has(col)) unknownColumns.push(`${table}.${col}`);
}
check('every curated table exists', !unknownTables.length, unknownTables.join(', '));
check('every curated column exists', !unknownColumns.length,
      `${unknownColumns.join(', ')} — a migration renamed or dropped these; update CURATED_COLUMNS`);

const uncurated = TABLE_NAMES.filter(t => !P.CURATED_COLUMNS[t]);
check('every table has a curated column list', !uncurated.length,
      `${uncurated.join(', ')} — will fall back to the automatic rule, which is fine but worth a look`);

let unknownHidden = [...P.DEFAULT_HIDDEN_TABLES].filter(t => !DB_SCHEMA[t]);
check('every default-hidden table exists', !unknownHidden.length, unknownHidden.join(', '));

section('system-prefs.js — the automatic rule');

// The rule must produce something usable for a table nobody has curated, since that is what a
// future migration's table gets.
for (const name of TABLE_NAMES) {
  const cols = P.defaultColumns(name);
  const real = new Set(tableMeta(name).columns.map(c => c.name));
  const bad = cols.filter(c => !real.has(c));
  if (cols.length === 0 || bad.length) {
    check(`defaultColumns(${name}) is usable`, false,
          cols.length ? `unknown: ${bad.join(', ')}` : 'returned nothing');
  }
}
check('defaultColumns returns real columns for every table', true);

// Audit noise and blobs stay out of the automatic result, or the rule is not earning its keep.
const autoActivities = P.defaultColumns('activities');
check('curated list wins for a curated table',
      JSON.stringify(autoActivities) === JSON.stringify(P.CURATED_COLUMNS.activities),
      autoActivities.join(', '));

section('system-prefs.js — visibility and persistence');

const shown = P.defaultTables();
eq('default tables exclude the hidden set',
   shown.length, TABLE_NAMES.length - P.DEFAULT_HIDDEN_TABLES.size);
check('grade_events is hidden by default', !shown.includes('grade_events'));
check('courses is shown by default', shown.includes('courses'));

// Round-trip through the stubbed localStorage.
check('columns start uncustomised', !P.columnsCustomised('courses'));
P.setVisibleColumns('courses', ['code', 'title']);
eq('a saved column choice is returned', JSON.stringify(P.visibleColumns('courses')),
   JSON.stringify(['code', 'title']));
check('…and reports as customised', P.columnsCustomised('courses'));
P.resetColumns('courses');
eq('reset restores the curated default', JSON.stringify(P.visibleColumns('courses')),
   JSON.stringify(P.CURATED_COLUMNS.courses));
check('…and reports as uncustomised again', !P.columnsCustomised('courses'));

// A saved choice naming only dropped columns must fall back, not render an empty table.
P.setVisibleColumns('courses', ['column_removed_by_a_migration']);
eq('a stale saved choice falls back to the default',
   JSON.stringify(P.visibleColumns('courses')), JSON.stringify(P.CURATED_COLUMNS.courses));
P.resetColumns('courses');

P.setVisibleTables(['courses', 'terms']);
eq('a saved table choice is returned', JSON.stringify(P.visibleTables()),
   JSON.stringify(['courses', 'terms']));
P.setVisibleTables(['courses', 'no_such_table']);
eq('an unknown table is filtered out of a saved choice',
   JSON.stringify(P.visibleTables()), JSON.stringify(['courses']));
P.resetTables();
eq('reset restores the default table set', P.visibleTables().length, shown.length);
