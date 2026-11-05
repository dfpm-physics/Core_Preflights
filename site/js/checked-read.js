/**
 * One way to read a Supabase result so that a failed read cannot look like an empty one.
 *
 * `const { data } = await db.from(...)` throws the error away. `data` is then null, the page treats
 * null as "nothing there", and the screen says "no grades", "all caught up" or writes a blank
 * export that looks complete. Every loader whose answer decides what a person sees or exports reads
 * through these instead, so a failure stops the load and says what could not be read.
 *
 *   checkedRows(res, what)  -> the rows, [] when the query matched none; throws ReadFailed on an error
 *   checkedOne(res, what)   -> the row or null (a maybeSingle); throws ReadFailed on an error
 *   checkedAll(list, what)  -> the same list, after throwing ReadFailed if any result carries an error
 *
 * Plain ES module, no dependency, so it runs offline in the tests.
 */

export class ReadFailed extends Error {
  constructor(what, cause) {
    super(`Could not load ${what}: ${cause?.message || cause || 'the request failed'}. Nothing was changed.`);
    this.name = 'ReadFailed';
    this.what = what;
    this.cause = cause || null;
  }
}

function fail(res, what) {
  // A missing result object is a failure too: a stub or a dropped request must not read as "no rows".
  if (!res || typeof res !== 'object') throw new ReadFailed(what, 'no response');
  if (res.error) throw new ReadFailed(what, res.error);
}

export function checkedRows(res, what) {
  fail(res, what);
  if (res.data == null) return [];
  return Array.isArray(res.data) ? res.data : [res.data];
}

export function checkedOne(res, what) {
  fail(res, what);
  return res.data ?? null;
}

export function checkedAll(list, what) {
  const items = list || [];
  const i = items.findIndex(r => !r || typeof r !== 'object' || r.error);
  if (i >= 0) fail(items[i], what);
  return list;
}
