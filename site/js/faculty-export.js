// faculty-export.js — the gradebook export and the per-course Blackboard export.
//
// ONE CALCULATION. Every total, percent, letter, GPA and rank written here is a value the database
// returned from course_totals; every cell state is the one gradebook_cells returned. This file turns
// those into columns and escapes them. It adds, divides and compares nothing.
//
// The Blackboard export works the way the live preflight fill does (site/js/blackboard-fill.js): the staff
// member uploads Blackboard's own export and gets the same file back with numbers written into columns that
// already exist. It never writes a header. It fills every kind of item, and the Prog and Final grade columns
// under the names the course chose. It reads the live total for now; reading an approved checkpoint is the
// Prog and Final stage.

import { fetchAll } from './schema.js';
import { loadCellsAndTotals } from './faculty-totals.js';
import { centsText } from './faculty-entry-parse.js';
import { lessonNumberOf } from './blackboard-fill.js';

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
 * The Blackboard export is a FILL, like the preflight fill in blackboard-fill.js: the staff member uploads
 * Blackboard's own export and gets the same file back with numbers in columns that already exist. Nothing here
 * writes a header. These two functions say WHAT may be written and WHERE it comes from.
 *
 * blackboardTargets({ items, settings }) -> { targets } | { error }
 *   items    [{ id, title, slug }]   every item the course shows
 *   settings { blackboard_export, bb_prog_column, bb_final_column } or null
 *   An item whose slug names a preflight carries its lesson number; every other item is matched by its title.
 *   A total target exists only when the Director has saved that column's name; each has a percent and a letter.
 */
export function blackboardTargets({ items, settings }) {
  if (!settings?.blackboard_export) return { error: 'This course has not chosen the Blackboard export. A Director turns it on in the course settings.' };
  const targets = (items || []).map(i => ({ key: i.id, kind: 'item', id: i.id, title: i.title, slug: i.slug ?? null, lesson: lessonNumberOf(i.slug ?? '') }));
  for (const [scope, name] of [['prog', settings.bb_prog_column], ['final', settings.bb_final_column]]) {
    if (!name || !String(name).trim()) continue;
    const column = String(name).trim();
    targets.push({ key: `total:${scope}:percent`, kind: 'total', scope, part: 'percent', column });
    targets.push({ key: `total:${scope}:letter`, kind: 'total', scope, part: 'letter', column });
  }
  return { targets };
}

/**
 * The value for one cadet and one target, as TEXT the database already produced, or '' for a blank.
 * cells  gradebook_cells rows; totals { final, prog } course_totals rows; people { enrollmentId: { cadetId } }
 * ONE CALCULATION: a score is the cell's number, a percent and a letter are course_totals' text. A cell that is
 * not released or missing (ungraded, held, excused, not due) is a blank, never a zero we made up.
 */
export function blackboardLookup({ cells, totals, people }) {
  const enrOf = new Map(Object.entries(people || {}).map(([enr, p]) => [Number(p.cadetId), enr]));
  const cellOf = new Map((cells || []).map(c => [`${c.enrollment_id}|${c.assignment_offering_id}`, c]));
  const totOf = {};
  for (const scope of ['final', 'prog']) totOf[scope] = new Map(((totals || {})[scope] || []).map(t => [t.enrollment_id, t]));
  return (cadetId, key) => {
    const enr = enrOf.get(Number(cadetId));
    if (!enr) return '';
    const m = /^total:(prog|final):(percent|letter)$/.exec(String(key));
    if (m) {
      const t = totOf[m[1]].get(enr);
      if (!t) return '';
      if (m[2] === 'letter') return t.letter ?? '';
      return t.percent_key_text == null ? '' : t.percent_key_text.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    }
    const c = cellOf.get(`${enr}|${key}`);
    if (!c) return '';
    if (c.state === 'released') return pts(c.points_earned);
    if (c.state === 'missing') return '0';
    return '';
  };
}

/** Everything the Blackboard fill needs, in one read. -> { items, cells, totals: { final, prog }, people, settings } | { error } */
export async function loadBlackboardData(db, courseOfferingId) {
  const [fin, prog] = await Promise.all([loadExport(db, courseOfferingId, 'final'), loadCellsAndTotals(db, courseOfferingId, 'prog')]);
  if (fin.error) return { error: fin.error };
  if (prog.error) return { error: prog.error };
  return { items: fin.items, cells: fin.cells, totals: { final: fin.totals, prog: prog.totals }, people: fin.people, settings: fin.settings };
}

/** Everything both exports need, in one read. Resolves { error } rather than a partial picture. */
export async function loadExport(db, courseOfferingId, scope) {
  // The two total functions are read through faculty-totals.js: paged, so a large course is never cut short.
  const [ct, itemsR, setR, secR] = await Promise.all([
    loadCellsAndTotals(db, courseOfferingId, scope),
    db.from('assignment_offerings').select('id,position,is_published,prog_included,assignments!inner(title,slug)').eq('course_offering_id', courseOfferingId),
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
    .map(i => ({ id: i.id, title: i.assignments?.title || i.id, slug: i.assignments?.slug ?? null }));
  return { cells: ct.cells, totals: ct.totals, items, people, settings: setR.data || null };
}
