// course-days.js — which days of the week a course meets (courses.meeting_days), and the few rules around it.
//
// The list belongs to the COURSE, so it follows the course into every term and a term copy never has to carry it.
// The default is M and T, the split schedule. It decides what the pages OFFER; it is not a rule on sections: a
// section that already holds another day keeps it, is shown with it, and is never rewritten because of this list.
// DOM-free, so the tests import it directly.

export const ALL_DAYS = ['M', 'T', 'W', 'R', 'F'];
export const DEFAULT_DAYS = ['M', 'T'];
export const DAY_NAMES = { M: 'Monday', T: 'Tuesday', W: 'Wednesday', R: 'Thursday', F: 'Friday' };

/** Keep only the five known letters, once each, in week order. Never returns letters the person did not give. */
export function cleanDays(list) {
  const seen = new Set((Array.isArray(list) ? list : []).map(d => String(d).trim().toUpperCase()));
  return ALL_DAYS.filter(d => seen.has(d));
}

/** The plain reason a list is not allowed, or '' when it is. */
export function daysProblem(list) {
  const given = Array.isArray(list) ? list : [];
  if (given.some(d => !ALL_DAYS.includes(String(d).trim().toUpperCase()))) return 'Meeting days can only be M, T, W, R (Thursday) or F.';
  if (!cleanDays(given).length) return 'Pick at least one day the course meets.';
  return '';
}

export const sameDays = (a, b) => cleanDays(a).join('') === cleanDays(b).join('');

/** "M and T", "M, W and F". */
export function describeDays(list) {
  const d = cleanDays(list);
  if (d.length <= 1) return d.join('');
  return d.slice(0, -1).join(', ') + ' and ' + d[d.length - 1];
}

/**
 * The days a screen offers for one section: the course's days, plus any day the section already holds, so a save
 * can never silently drop the held day. Returned in week order, each flagged when the course does not list it.
 */
export function daysOffered(courseDays, held = []) {
  const course = new Set(cleanDays(courseDays));
  const keep = new Set(cleanDays(held));
  return ALL_DAYS.filter(d => course.has(d) || keep.has(d)).map(d => ({ day: d, outside: !course.has(d) }));
}

/** The days a section holds that its course does not list. Used for a plain note, never to block. */
export const daysOutsideList = (held, courseDays) => {
  const course = new Set(cleanDays(courseDays));
  return cleanDays(held).filter(d => !course.has(d));
};

/** True when the database has not yet been given the column (migration 086 not applied). */
export const columnMissing = (error) => !!error && (
  error.code === '42703' || error.code === 'PGRST204' || /meeting_days/.test(String(error.message || '')) && /(does not exist|could not find)/i.test(String(error.message || '')));

/**
 * Read a course's days. `assumed` is true only when the column does not exist yet, so the pages keep working
 * before the migration is applied; the answer is then the default and the page says nothing more. Any other
 * failed read is returned as an error and the caller shows it.
 */
export async function loadCourseDays(db, courseId) {
  if (!courseId) return { days: [...DEFAULT_DAYS], assumed: true, error: null };
  const r = await db.from('courses').select('meeting_days').eq('id', courseId).maybeSingle();
  if (r.error) {
    if (columnMissing(r.error)) return { days: [...DEFAULT_DAYS], assumed: true, error: null };
    return { days: [...DEFAULT_DAYS], assumed: false, error: r.error };
  }
  const days = cleanDays(r.data?.meeting_days);
  return { days: days.length ? days : [...DEFAULT_DAYS], assumed: !r.data, error: null };
}
