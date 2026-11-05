// test-faculty-totals.mjs — the paged reader behind every staff total (site/js/faculty-totals.js).
// No network. A stub client serves a set-returning function the way the API does: capped per request.

import { check, eq, section, installBrowser, summary } from './harness.mjs';

installBrowser({ pathname: '/site/faculty/gradebook.html' });
const T = await import('../../site/js/faculty-totals.js');

// A stub that honours order() and range() and caps every response at `cap` rows, like the real API.
function stub(allRows, { cap = 1000, failAtPage = -1 } = {}) {
  const calls = [];
  let page = 0;
  return {
    calls,
    rpc(name, args) {
      const q = { name, args, orders: [] };
      const b = {
        order(col) { q.orders.push(col); return b; },
        range(from, to) {
          calls.push({ ...q, from, to });
          const mine = page++;
          if (mine === failAtPage) return Promise.resolve({ data: null, error: { message: 'boom' } });
          const sorted = [...allRows].sort((x, y) => (x.k < y.k ? -1 : x.k > y.k ? 1 : 0));
          return Promise.resolve({ data: sorted.slice(from, Math.min(to + 1, from + cap)), error: null });
        },
      };
      return b;
    },
  };
}
const rowsN = (n) => Array.from({ length: n }, (_, i) => ({ k: String(i).padStart(6, '0') }));

section('rpcAll: a capped API does not truncate the answer');
{
  const db = stub(rowsN(2500));
  const r = await T.rpcAll(db, 'gradebook_cells', { p_course_offering: 'c', p_scope: 'final' }, ['k']);
  eq('every row comes back', r.data.length, 2500);
  eq('in order, none twice', new Set(r.data.map(x => x.k)).size, 2500);
  check('it walked more than one page', db.calls.length >= 3, String(db.calls.length));
  check('every page was asked for in a fixed order', db.calls.every(c => c.orders.join() === 'k'));
}
{
  const db = stub(rowsN(1000));
  const r = await T.rpcAll(db, 'x', {}, ['k']);
  eq('exactly one full page still ends on the empty page after it', r.data.length, 1000);
}
{
  const db = stub(rowsN(10));
  const r = await T.rpcAll(db, 'x', {}, ['k']);
  eq('a small answer is whole', r.data.length, 10);
  eq('an empty answer is empty, not an error', (await T.rpcAll(stub([]), 'x', {}, ['k'])).data, []);
}

section('rpcAll: a failure is an error, never a short list');
{
  const r = await T.rpcAll(stub(rowsN(2500), { failAtPage: 1 }), 'x', {}, ['k']);
  check('an error on a later page loses nothing quietly', !!r.error && !r.data);
}
{
  const r = await T.rpcAll(stub(rowsN(5000)), 'x', {}, ['k'], { pageSize: 1000, maxPages: 2 });
  check('a read that cannot finish is refused', !!r.error && /Refusing/.test(r.error.message));
}

section('the two readers ask for the right function in a stable order');
{
  const db = stub(rowsN(3));
  await T.loadCells(db, 'co1', 'prog');
  eq('cells: function, arguments and a two-column key', [db.calls[0].name, db.calls[0].args, db.calls[0].orders],
    ['gradebook_cells', { p_course_offering: 'co1', p_scope: 'prog' }, ['enrollment_id', 'assignment_offering_id']]);
  const db2 = stub(rowsN(3));
  await T.loadTotals(db2, 'co1');
  eq('totals: function, arguments and key', [db2.calls[0].name, db2.calls[0].args, db2.calls[0].orders],
    ['course_totals', { p_course_offering: 'co1', p_scope: 'final' }, ['enrollment_id']]);
}
{
  const db = { rpc: (name) => ({ order() { return this; }, range: () => Promise.resolve(name === 'course_totals' ? { data: null, error: { message: 'no' } } : { data: [], error: null }) }) };
  const r = await T.loadCellsAndTotals(db, 'c');
  check('one failing read fails the pair, not half of it', !!r.error && !r.cells);
}

process.exit(summary() ? 0 : 1);
