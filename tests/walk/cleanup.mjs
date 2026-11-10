// cleanup.mjs -- removes what the walk made, by its "ZZ walk" name. Staging only (db.py refuses any other project).
// It touches only rows the walk created: assignments titled "ZZ walk%", courses coded "zz-walk-%", and the synthetic cadet
// whose ID is in the reserved range below. It reports what it removed and what it could not.
import * as L from './lib.mjs';

export const SYNTH_ID_LOW = 3009990001, SYNTH_ID_HIGH = 3009990099;   // reserved for the walk's own invented cadets

export function cleanup() {
  const out = { removed: {}, left: [] };
  const count = (q) => Number(L.sql(q)[0]?.n || 0);
  const before = {
    assignments: count(`select count(*) n from assignments where title like 'ZZ walk%'`),
    courses: count(`select count(*) n from courses where code like 'zz-walk-%'`),
    students: count(`select count(*) n from students where student_id between ${SYNTH_ID_LOW} and ${SYNTH_ID_HIGH}`),
  };
  const attempt = (label, statements) => {
    try { L.exec(statements); } catch (e) { out.left.push(`${label}: ${String(e.message).slice(0, 200)}`); }
  };
  // Offerings first (their grades, submissions, paths and closures go with them), then the assignment rows (RESTRICT otherwise).
  attempt('assignment offerings', [[`delete from assignment_offerings where assignment_id in (select id from assignments where title like 'ZZ walk%')`, null]]);
  attempt('assignments', [[`delete from assignments where title like 'ZZ walk%'`, null]]);
  attempt('synthetic cadets', [[`delete from students where student_id between ${SYNTH_ID_LOW} and ${SYNTH_ID_HIGH}`, null]]);
  attempt('walk courses', [
    [`delete from assignment_offerings where course_offering_id in (select co.id from course_offerings co join courses c on c.id=co.course_id where c.code like 'zz-walk-%')`, null],
    [`delete from courses where code like 'zz-walk-%'`, null]]);
  // The walk switches tutorials off in its own browsers and group T sets them, so the synced preference can be left on a seeded login.
  // Put those people back to having none, so a person trying the tours by hand on staging sees them.
  attempt('tutorial preference', [[`update user_preferences set prefs = prefs - 'cp.tutorials' where prefs ? 'cp.tutorials'`, null]]);
  const after = {
    assignments: count(`select count(*) n from assignments where title like 'ZZ walk%'`),
    courses: count(`select count(*) n from courses where code like 'zz-walk-%'`),
    students: count(`select count(*) n from students where student_id between ${SYNTH_ID_LOW} and ${SYNTH_ID_HIGH}`),
  };
  for (const k of Object.keys(before)) { out.removed[k] = before[k] - after[k]; if (after[k]) out.left.push(`${k}: ${after[k]} remain`); }
  return out;
}
