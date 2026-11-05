// faculty-backlog.js — the backlog and near-line views (site/faculty/backlog.html).
//
// States, totals, letters and near-line flags all come from the database (gradebook_cells and
// course_totals). This module only sorts what the database already decided into piles. It never
// adds, divides or compares scores.

import { fetchAll } from './schema.js';
import { loadCellsAndTotals } from './faculty-totals.js';

export const PILES = [
  { key: 'toGrade',   title: 'Work to grade',            hint: 'Work was handed in and has no score yet.' },
  { key: 'toPublish', title: 'Draft scores to publish',  hint: 'A score is drafted but students cannot see it.' },
  { key: 'toEnter',   title: 'Scores to enter',          hint: 'Nothing is entered, the column is open, and the date has passed.' },
  { key: 'held',      title: 'Held by a release date',   hint: 'Graded, but the item\'s release date has not arrived.' },
  { key: 'badDate',   title: 'Date problems',            hint: 'The deadline cannot be worked out, so the item cannot be judged.' },
];

/** Which pile one cell belongs to, or null when it is not backlog. First match wins. */
export function pileOf(cell) {
  if (cell.deadline_invalid) return 'badDate';
  if (cell.state === 'graded_unreleased') return 'held';
  if (cell.has_draft_score) return 'toPublish';
  if (cell.no_work_received) return 'toEnter';
  if (cell.state === 'submitted_ungraded') return 'toGrade';
  return null;
}

/** -> { toGrade: [{ itemId, count, sections: Set }], ... } counted per item. */
export function groupBacklog(cells) {
  const out = Object.fromEntries(PILES.map(p => [p.key, new Map()]));
  for (const c of cells) {
    const k = pileOf(c);
    if (!k) continue;
    const m = out[k];
    const e = m.get(c.assignment_offering_id) || m.set(c.assignment_offering_id, { itemId: c.assignment_offering_id, count: 0, late: 0, sections: new Set() }).get(c.assignment_offering_id);
    e.count += 1; if (c.is_late) e.late += 1; e.sections.add(c.section_id);
  }
  return Object.fromEntries(Object.entries(out).map(([k, m]) => [k, [...m.values()].sort((a, b) => b.count - a.count)]));
}

/** Cadets the database flagged as near a line. Sorted by rank when present, so the closest course-wide come first. */
export function nearLineRows(totals) {
  return totals.filter(t => t.near_line_letter).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
}

export async function loadBacklog(db, courseOfferingId, scope = 'final') {
  // Paged: a course holds far more cells than one API response returns (see faculty-totals.js).
  const ct = await loadCellsAndTotals(db, courseOfferingId, scope);
  if (ct.error) return { error: ct.error };
  const itemsR = await db.from('assignment_offerings').select('id,assignments!inner(title)').eq('course_offering_id', courseOfferingId);
  if (itemsR.error) return { error: itemsR.error };
  // Every counted status, because a completed enrollment is in the totals and must have a name here too.
  const enrR = await fetchAll(() => db.from('enrollments').select('id,section_id,students(name)').in('status', ['active', 'completed']));
  if (enrR.error) return { error: enrR.error };
  return {
    cells: ct.cells, totals: ct.totals,
    titles: Object.fromEntries((itemsR.data || []).map(i => [i.id, i.assignments?.title || i.id])),
    names: Object.fromEntries((enrR.data || []).map(e => [e.id, e.students?.name || ''])),
  };
}
