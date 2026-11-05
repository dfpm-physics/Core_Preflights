// faculty-export.js — the gradebook export and the per-course Blackboard export.
//
// ONE CALCULATION. Every total, percent, letter, GPA and rank written here is a value the database
// returned from course_totals; every cell state is the one gradebook_cells returned. This file turns
// those into columns and escapes them. It adds, divides and compares nothing.
//
// The Blackboard export is separate from site/js/blackboard-fill.js on purpose. That tool fills the
// PREFLIGHT columns of a Blackboard file the director uploads, and matches nothing else, so that a
// homework column can never be overwritten with a preflight score. This export is the other
// direction: one overall grade per cadet, at Prog or at Final, in the column names the course chose.
// It reads the live total for now; reading an approved checkpoint is the Prog and Final stage.

import { fetchAll } from './schema.js';
import { loadCellsAndTotals } from './faculty-totals.js';
import { centsText } from './faculty-entry-parse.js';

/** One CSV field. A cell that starts like a formula is prefixed so a spreadsheet shows it as text. */
export function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const csvLine = (cells) => cells.map(csvCell).join(',');

/** A database numeric that arrived as a JSON number, shown as its two-decimal text. */
const pts = (n) => (n == null ? '' : centsText(Math.round(Number(n) * 100)));

/** What one cell prints in the gradebook export. Translation of the database's state, not a rule. */
export function cellText(cell) {
  if (!cell) return '';
  if (cell.state === 'excused') return 'EX';
  if (cell.state === 'missing') return '0';
  if (cell.state === 'released') return pts(cell.points_earned);
  return '';
}

/**
 * The gradebook export, one row per cadet.
 * d = { items: [{ id, title }], people: { [enrollmentId]: { name, cadetId, section } }, cells, totals, scope }
 */
export function gradebookCsv(d) {
  const byEnr = new Map();
  for (const c of d.cells) byEnr.set(`${c.enrollment_id}|${c.assignment_offering_id}`, c);
  const head = ['Cadet ID', 'Name', 'Section', ...d.items.map(i => i.title),
    'Earned', 'Possible', 'Percent', 'Letter', 'GPA', 'Rank', 'Missing', 'Awaiting grade', 'Held by release date', 'Excused'];
  const rows = [...d.totals].sort((a, b) => (d.people[a.enrollment_id]?.name || '').localeCompare(d.people[b.enrollment_id]?.name || ''))
    .map(t => {
      const p = d.people[t.enrollment_id] || {};
      return csvLine([p.cadetId ?? t.student_id, p.name || '', p.section || '',
        ...d.items.map(i => cellText(byEnr.get(`${t.enrollment_id}|${i.id}`))),
        t.earned_text, t.possible_text, t.percent_key_text, t.letter, t.gpa, t.rank,
        t.missing_count, t.ungraded_count, t.unreleased_count, t.excused_count]);
    });
  return [csvLine(head), ...rows].join('\r\n') + '\r\n';
}

/**
 * The Blackboard export: one overall grade per cadet.
 * settings = { blackboard_export, bb_prog_column, bb_final_column } or null
 * -> { error } when the course has not chosen it or has not named the column; else { csv, filename }
 */
export function blackboardCsv({ totals, people, scope, settings, courseCode }) {
  if (!settings?.blackboard_export) return { error: 'This course has not chosen the Blackboard export. A Director turns it on in the course settings.' };
  const column = scope === 'prog' ? settings.bb_prog_column : settings.bb_final_column;
  if (!column || !String(column).trim()) return { error: `The ${scope === 'prog' ? 'Prog' : 'Final'} column name is not set for this course.` };
  const rows = [...totals].sort((a, b) => (people[a.enrollment_id]?.name || '').localeCompare(people[b.enrollment_id]?.name || ''))
    .map(t => csvLine([people[t.enrollment_id]?.cadetId ?? t.student_id, t.percent_key_text == null ? '' : t.percent_key_text.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''), t.letter]));
  const csv = [csvLine(['Student ID', column, `${column} letter`]), ...rows].join('\r\n') + '\r\n';
  return { csv, filename: `${courseCode || 'course'}-blackboard-${scope}.csv` };
}

/** Everything both exports need, in one read. Resolves { error } rather than a partial picture. */
export async function loadExport(db, courseOfferingId, scope) {
  // The two total functions are read through faculty-totals.js: paged, so a large course is never cut short.
  const [ct, itemsR, setR, secR] = await Promise.all([
    loadCellsAndTotals(db, courseOfferingId, scope),
    db.from('assignment_offerings').select('id,position,is_published,prog_included,assignments!inner(title)').eq('course_offering_id', courseOfferingId),
    db.from('course_offering_settings').select('blackboard_export,bb_prog_column,bb_final_column').eq('course_offering_id', courseOfferingId).maybeSingle(),
    db.from('sections').select('id,code').eq('course_offering_id', courseOfferingId),
  ]);
  const error = ct.error || itemsR.error || setR.error || secR.error;
  if (error) return { error };
  const secIds = (secR.data || []).map(s => s.id);
  const enrR = secIds.length ? await fetchAll(() => db.from('enrollments').select('id,section_id,student_id,students(name)').in('section_id', secIds)) : { data: [] };
  if (enrR.error) return { error: enrR.error };
  const code = Object.fromEntries((secR.data || []).map(s => [s.id, s.code]));
  const people = Object.fromEntries((enrR.data || []).map(e => [e.id, { name: e.students?.name || '', cadetId: e.student_id, section: code[e.section_id] || '' }]));
  const shown = new Set(ct.cells.map(c => c.assignment_offering_id));
  const items = (itemsR.data || []).filter(i => shown.has(i.id)).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(i => ({ id: i.id, title: i.assignments?.title || i.id }));
  return { cells: ct.cells, totals: ct.totals, items, people, settings: setR.data || null };
}
