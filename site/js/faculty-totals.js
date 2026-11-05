// faculty-totals.js — the one reader of the two database functions every staff total comes from.
//
// gradebook_cells(course, scope)  one row per cadet and published item: the item's STATE, its points, the flags
// course_totals(course, scope)    one row per cadet: earned, possible, percent, letter, rank and the counts
//
// ONE CALCULATION. The gradebook, the per-cadet page, the backlog and both exports read these two functions and
// nothing else for a total, a state or a letter. This file only fetches; it adds, divides and compares nothing.
//
// WHY THIS PAGES. A course of 400 cadets and 40 items is 16,000 cells, and the API returns at most its row cap per
// request (1,000 by default), silently. A read that stopped there would show a partial gradebook as a whole one.
// So every read walks the pages in a fixed order and stops only on an empty page, exactly as schema.js fetchAll
// does for tables, and a read that cannot finish is an error, never a short list.

export const PAGE_SIZE = 1000;

/**
 * Read every row of a set-returning function.
 * orderBy must be a set of columns that identifies a row, so no page overlaps or skips another.
 * -> { data } | { error }
 */
export async function rpcAll(db, name, args, orderBy, { pageSize = PAGE_SIZE, maxPages = 200 } = {}) {
  const rows = [];
  for (let page = 0; page < maxPages; page++) {
    let q = db.rpc(name, args);
    for (const col of orderBy) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(rows.length, rows.length + pageSize - 1);
    if (error) return { error };
    if (!data || !data.length) return { data: rows };
    rows.push(...data);
  }
  return { error: new Error(`Refusing to page past ${maxPages * pageSize} rows of ${name}`) };
}

export const loadCells = (db, courseOfferingId, scope = 'final') =>
  rpcAll(db, 'gradebook_cells', { p_course_offering: courseOfferingId, p_scope: scope }, ['enrollment_id', 'assignment_offering_id']);

export const loadTotals = (db, courseOfferingId, scope = 'final') =>
  rpcAll(db, 'course_totals', { p_course_offering: courseOfferingId, p_scope: scope }, ['enrollment_id']);

/** Both, together. -> { cells, totals } | { error } */
export async function loadCellsAndTotals(db, courseOfferingId, scope = 'final') {
  const [c, t] = await Promise.all([loadCells(db, courseOfferingId, scope), loadTotals(db, courseOfferingId, scope)]);
  if (c.error) return { error: c.error };
  if (t.error) return { error: t.error };
  return { cells: c.data, totals: t.data };
}
