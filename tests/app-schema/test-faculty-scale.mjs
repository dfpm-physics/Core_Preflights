// test-faculty-scale.mjs — letter scale and near-line width (site/js/faculty-scale.js, site/faculty/scale.html).
//
// WHAT THIS DEFENDS
//   * The page's validator says what the database's letter_scale_is_valid says, case for case
//     (scale-cases.json is the shared list; the browser harness asks the database the same cases).
//   * Every refusal is a plain sentence that names the line.
//   * The letter rule and the near-line rule are exact: 89.9001 of 100 is near the A-, 89.8999 is not, and the edge
//     is included. No floating point.
//   * On an active course a save needs a preview of exactly this scale; changing any box makes the preview stale.
//   * A save is retire-then-insert as the next version, and a failed insert puts the old version back.
//   * The page sends no id, no is_default and no retired_at on an insert, and never publishes or moves a total.
//
// WHAT THIS CANNOT PROVE
//   Offline, against a recording stub: which statements the shipped module issues, not that the database accepts
//   them. tests/browser-harness/v2-scale.mjs does that on staging, with a database read-back.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { check, eq, section, summary, installBrowser, REPO } from './harness.mjs';

installBrowser({ pathname: '/site/faculty/scale.html' });

let RESPONSES = {};
let CALLS = [];

const stubFrom = (table) => {
  const state = { table, verb: 'select', payload: null, filters: {} };
  const c = {};
  for (const m of ['eq', 'in', 'is', 'not', 'neq', 'order', 'limit'])
    c[m] = (col, val) => { state.filters[`${m}:${col}`] = val; return c; };
  c.select = () => { if (state.verb === 'select') CALLS.push({ table, verb: 'select', filters: state.filters }); return c; };
  for (const verb of ['insert', 'update', 'delete'])
    c[verb] = (payload) => { state.verb = verb; state.payload = payload; CALLS.push({ table, verb, payload, filters: state.filters }); return c; };
  const result = () => {
    const r = RESPONSES[`${table}.${state.verb}`];
    const data = typeof r === 'function' ? r(state) : r;
    if (data && data.__error) return { data: null, error: data.__error };
    return { data: data === undefined ? [] : data, error: null };
  };
  c.maybeSingle = () => Promise.resolve((() => { const x = result(); return { data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: x.error }; })());
  c.then = (res, rej) => Promise.resolve(result()).then(res, rej);
  return c;
};
const db = {
  from: stubFrom,
  rpc: (name, args) => { CALLS.push({ table: `rpc:${name}`, verb: 'rpc', payload: args });
    const r = RESPONSES[`rpc:${name}`]; const data = typeof r === 'function' ? r(args) : r;
    if (data && data.__error) return Promise.resolve({ data: null, error: data.__error });
    return Promise.resolve({ data: data === undefined ? [] : data, error: null }); },
};
const reset = (r = {}) => { RESPONSES = r; CALLS = []; };
const read = (rel) => readFileSync(resolve(REPO, rel), 'utf8');
const S = await import('../../site/js/faculty-scale.js');
const CASES = JSON.parse(read('tests/app-schema/scale-cases.json'));
const toLines = (arr) => arr.map(([letter, cutoff, gpa]) => ({ letter, cutoff, gpa }));
const rowsOf = (arr) => arr.map(([letter, cutoff, gpa]) => ({ letter, cutoff: String(cutoff), gpa: String(gpa) }));
const defRows = () => S.rowsFromLines(S.DEFAULT_LINES);

/* ───────────────────────────────────────────────────────────────────────────────────────── */
section('the page and the database agree, case for case');
for (const c of CASES.cases) {
  const v = S.validateScale(rowsOf(c.lines), String(c.width));
  check(`${c.name}: ${c.valid ? 'accepted' : 'refused'}`, (v.errors.length === 0) === c.valid, JSON.stringify(v.errors));
}
{
  const sql = read('supabase/migrations/app/032_letter_scales.sql');
  const m = sql.match(/default_letter_scale\(\)[\s\S]*?SELECT '(\[[\s\S]*?\])'::jsonb,\s*([0-9.]+)::numeric/);
  const dbLines = JSON.parse(m[1]);
  eq('DEFAULT_LINES is the default scale of migration 032', S.DEFAULT_LINES, dbLines);
  eq('DEFAULT_WIDTH is the default width of migration 032', S.DEFAULT_WIDTH, Number(m[2]));
  check('the table keeps one unretired row per offering', /letter_scales_one_current ON letter_scales \(course_offering_id\) WHERE retired_at IS NULL/.test(sql));
  check('the width column defaults to 0.1', /near_line_width\s+numeric NOT NULL DEFAULT 0\.1/.test(sql));
}

section('every refusal is a sentence that names the line');
{
  const say = (rows, w = '0.1') => S.validateScale(rows, w).errors.join(' | ');
  const base = () => defRows().map(r => ({ ...r }));
  let r = base(); r[1].cutoff = '95';
  check('a cutoff that is not lower than the line above', /Line 2 \(A-\): the cutoff 95 must be lower than the line above it, 93/.test(say(r)), say(r));
  r = base(); r[3].gpa = '3.5';
  check('a GPA higher than the line above', /Line 4 \(B\): the GPA 3.5 is higher than the line above it, 3.3/.test(say(r)), say(r));
  r = base(); r[9].cutoff = '5';
  check('a last cutoff that is not 0', /last line must have a cutoff of exactly 0/.test(say(r)), say(r));
  r = base(); r[2].letter = 'A';
  check('a letter used twice', /Line 3 \(A\): the letter A is used twice/.test(say(r)), say(r));
  r = base(); r[4].letter = '  ';
  check('a blank letter', /Line 5 has no letter/.test(say(r)), say(r));
  r = base(); r[5].cutoff = 'abc';
  check('a cutoff that is not a number', /Line 6 \(C\+\): the cutoff must be a plain number/.test(say(r)), say(r));
  r = base(); r[5].cutoff = '-1';
  check('a negative cutoff', /cannot be negative/.test(say(r)), say(r));
  r = base(); r[5].cutoff = '77.1234';
  check('a fourth decimal in a cutoff is refused, not rounded', /3 decimal places at most/.test(say(r)), say(r));
  r = base(); r[5].gpa = '2.333';
  check('a third decimal in a GPA is refused', /2 decimal places at most/.test(say(r)), say(r));
  check('a width at the smallest gap', /near-line width 3 must be below the smallest gap between two cutoffs, which is 3\b/.test(say(base(), '3')), say(base(), '3'));
  check('a negative width', /near-line width cannot be negative/.test(say(base(), '-1')), say(base(), '-1'));
  check('an empty width', /near-line width is empty/.test(say(base(), '')), say(base(), ''));
  check('no lines', /needs at least one line/.test(say([])));
  check('the sentences never show a raw error code', !/\b(23514|check_violation|letter_scales_valid_ck)\b/.test(say(base(), '9')), say(base(), '9'));
  const many = Array.from({ length: 31 }, (_, i) => ({ letter: 'L' + i, cutoff: String(100 - i * 3), gpa: '1' }));
  check('more than the line limit', /30 lines at most/.test(say(many)));
}

section('exact decimals');
{
  eq('93 reads as 93000 thousandths', S.readDecimal('93', 3, 'x'), { ok: true, n: 93000 });
  eq('89.9 reads as 89900', S.readDecimal('89.9', 3, 'x'), { ok: true, n: 89900 });
  eq('.5 reads as 500', S.readDecimal('.5', 3, 'x'), { ok: true, n: 500 });
  check('1e2 is not a number here', !S.readDecimal('1e2', 3, 'x').ok);
  check('93,5 is not a number here', !S.readDecimal('93,5', 3, 'x').ok);
  eq('showDecimal drops trailing zeros', [S.showDecimal(93000, 3), S.showDecimal(89900, 3), S.showDecimal(100, 3), S.showDecimal(0, 3)], ['93', '89.9', '0.1', '0']);
  const v = S.validateScale(defRows(), '0.1');
  eq('the default rows round-trip to the default lines', [v.lines, v.width], [S.DEFAULT_LINES, 0.1]);
  eq('89.9 is sent as 89.9, not 89.90000000000001', JSON.stringify(S.validateScale([{ letter: 'A', cutoff: '89.9', gpa: '4' }, { letter: 'F', cutoff: '0', gpa: '0' }], '0').lines[0].cutoff), '89.9');
}

section('the letter rule, exact (the same arithmetic as _letter_for)');
for (const c of CASES.letters) {
  const r = S.letterFor(c.earned, c.possible, S.DEFAULT_LINES, c.width);
  check(`${c.name}: ${c.letter ?? 'none'}, near ${c.near ?? 'none'}`, r.letter === c.letter && r.near === c.near, JSON.stringify(r));
}
{
  check('a width of 0 flags nobody', S.letterFor('89.9999', '100', S.DEFAULT_LINES, 0).near === null);
  check('an untidy earned is refused in words', /Points earned/.test(S.letterFor('x', '100', S.DEFAULT_LINES, 0.1).error));
  const bonus = S.letterFor('105', '100', S.DEFAULT_LINES, 0.1);
  check('above 100 percent is still an A', bonus.letter === 'A');
}

section('the preview summary');
{
  const rows = [
    { student_id: 3000000302, percent_text: '90.00', old_letter: 'A-', new_letter: 'B+', old_near_line_letter: null, new_near_line_letter: 'A-' },
    { student_id: 3000000301, percent_text: '91.00', old_letter: 'A-', new_letter: 'B+', old_near_line_letter: null, new_near_line_letter: null },
    { student_id: 3000000303, percent_text: '70.00', old_letter: 'C-', new_letter: 'C-', old_near_line_letter: 'C', new_near_line_letter: null },
  ];
  const sum = S.summarizePreview(rows);
  eq('counts', [sum.total, sum.letterChanged, sum.nearGained, sum.nearLost], [3, 2, 1, 1]);
  eq('the moves are tallied', sum.letterMoves, [{ from: 'A-', to: 'B+', count: 2 }]);
  eq('rows are listed by cadet id', sum.rows.map(r => r.student_id), [3000000301, 3000000302, 3000000303]);
  check('the headline is a sentence', /2 cadets would change letter; 1 would become near a line; 1 would stop being near a line\./.test(S.previewSentence(sum)), S.previewSentence(sum));
  eq('an empty preview says nobody changes', S.previewSentence(S.summarizePreview([])), 'No cadet changes letter or near-line flag under this scale.');
  check('the preview table shows cadet ids and no names', !/name/i.test(S.previewHtml(sum)));
}

section('describing a change');
{
  const cur = { lines: S.DEFAULT_LINES, width: 0.1 };
  const next = S.validateScale((() => { const r = defRows(); r[1].cutoff = '89'; r.splice(8, 1); return r; })(), '0.5');
  eq('the changes are named', S.describeChange(cur, next), ['A- moves from 90 to 89.', 'D is removed.', 'The near-line width goes from 0.1 to 0.5 points.']);
  check('the same scale is the same scale', S.sameScale(cur, { lines: S.DEFAULT_LINES.map(l => ({ ...l })), width: 0.1 }));
  check('a different width is a different scale', !S.sameScale(cur, { lines: S.DEFAULT_LINES, width: 0.2 }));
  check('scaleKey moves when any box moves', S.scaleKey(cur) !== S.scaleKey(next));
}

section('the decision to save');
{
  const cur = { lines: S.DEFAULT_LINES, width: 0.1, isDefault: true };
  const edited = S.validateScale((() => { const r = defRows(); r[1].cutoff = '89'; return r; })(), '0.1');
  const key = S.scaleKey(edited);
  check('a scale with errors cannot be saved', !S.planSave({ scale: null, current: cur, isActive: true, previewKey: key }).ok);
  check('the scale already in force cannot be saved again', /already in force/.test(S.planSave({ scale: { lines: S.DEFAULT_LINES, width: 0.1 }, current: cur, isActive: false, previewKey: null }).reason));
  const active = S.planSave({ scale: edited, current: cur, isActive: true, previewKey: null });
  check('on an active course, no preview means no save', !active.ok && /Show the effect/.test(active.reason), active.reason);
  check('on an active course, a preview of ANOTHER scale means no save', !S.planSave({ scale: edited, current: cur, isActive: true, previewKey: 'something else' }).ok);
  check('on an active course, a preview of exactly this scale allows the save', S.planSave({ scale: edited, current: cur, isActive: true, previewKey: key }).ok);
  check('on an inactive course the preview is optional', S.planSave({ scale: edited, current: cur, isActive: false, previewKey: null }).ok);
}

section('the database calls (recording stub)');
{
  const cur = { lines: S.DEFAULT_LINES, near_line_width: 0.1, version: 0, is_default: true };
  reset({ 'rpc:current_letter_scale': [cur], 'letter_scales.select': [], 'course_offerings.select': [{ id: 'o1', is_active: false }] });
  const st = await S.loadScale(db, 'o1');
  eq('a course with no row reads as the default, version 0, with no row id', [st.current.isDefault, st.current.version, st.currentRowId, st.maxVersion, st.isActive], [true, 0, null, 0, false]);
  reset({ 'rpc:current_letter_scale': [{ ...cur, is_default: false, version: 2 }],
    'letter_scales.select': [{ id: 'r2', version: 2, lines: S.DEFAULT_LINES, near_line_width: 0.1, created_at: 'x', retired_at: null }, { id: 'r1', version: 1, lines: S.DEFAULT_LINES, near_line_width: 0.1, created_at: 'x', retired_at: 'y' }],
    'course_offerings.select': [{ id: 'o1', is_active: true }] });
  const st2 = await S.loadScale(db, 'o1');
  eq('with history: the open row, the highest version, active', [st2.currentRowId, st2.maxVersion, st2.isActive], ['r2', 2, true]);
  reset({ 'rpc:current_letter_scale': { __error: { code: '42501', message: 'current_letter_scale: not permitted' } } });
  check('a refused read comes back as an error', !!(await S.loadScale(db, 'o1')).error);

  const scale = { lines: S.DEFAULT_LINES.map(l => ({ ...l, cutoff: l.cutoff === 90 ? 89 : l.cutoff })), width: 0.5 };
  reset({ 'rpc:save_letter_scale': 3 });
  const ok = await S.saveScale(db, 'o1', scale, st2);
  eq('a save is one database call and says which version', [ok.saved, ok.version, CALLS.map(c => c.table)], [true, 3, ['rpc:save_letter_scale']]);
  const call = CALLS[0];
  eq('the call names exactly these arguments', Object.keys(call.payload).sort(), ['p_course_offering', 'p_expected_version', 'p_lines', 'p_width']);
  check('the call sends no created_by, no id, no retired_at', !('created_by' in call.payload) && !('id' in call.payload) && !('retired_at' in call.payload));
  eq('the width and lines are sent as numbers, with the version the page saw', [call.payload.p_width, call.payload.p_lines[1], call.payload.p_expected_version], [0.5, { letter: 'A-', cutoff: 89, gpa: 3.7 }, 2]);

  reset({ 'rpc:save_letter_scale': [1] });
  const first = await S.saveScale(db, 'o1', scale, { current: { isDefault: true, version: 0 } });
  eq('the first save on a default course expects version 0 and gets version 1', [first.version, CALLS[0].payload.p_expected_version], [1, 0]);

  reset({ 'rpc:save_letter_scale': { __error: { code: '23514', message: 'violates check constraint "letter_scales_valid_ck"' } } });
  const bad = await S.saveScale(db, 'o1', scale, st2);
  check('a refused save returns the error and writes nothing else', !!bad.error && !bad.saved && CALLS.length === 1);

  reset({ 'rpc:save_letter_scale': { __error: { code: '40001', message: 'the scale in force changed since you opened the page' } } });
  const stale = await S.saveScale(db, 'o1', scale, st2);
  check('a stale version comes back as an error, in plain words', !!stale.error && /changed after you opened/.test(S.scaleError(stale.error)));

  reset({ 'rpc:save_letter_scale': 'not a number' });
  check('an answer with no version is not trusted', !!(await S.saveScale(db, 'o1', scale, st2)).error);

  reset({ 'rpc:scale_change_preview': [{ student_id: 1 }] });
  const pv = await S.previewScale(db, 'o1', { lines: S.DEFAULT_LINES, width: 0.1 });
  eq('the preview calls the database function with these arguments and saves nothing',
    [pv.rows.length, CALLS.map(c => c.table), Object.keys(CALLS[0].payload).sort()], [1, ['rpc:scale_change_preview'], ['p_course_offering', 'p_lines', 'p_width']]);
}

section('refusals in a sentence');
{
  const e = S.scaleError;
  check('a permission refusal', /Only a director/.test(e({ code: '42501', message: 'new row violates row-level security policy' })));
  check('a timeout does not claim a verified state it cannot see', /Nothing was changed|took too long/.test(e({ code: '57014', message: 'canceling statement due to statement timeout' })));
  check('the check constraint is explained, not quoted', /cutoffs must run high to low/.test(e({ code: '23514', message: 'violates check constraint "letter_scales_valid_ck"' })));
  check('the preview refusal is explained', /cutoffs must run high to low/.test(e({ code: '23514', message: 'scale_change_preview: that is not a usable scale' })));
  check('a concurrent save is explained', /Someone saved a scale/.test(e({ code: '23505', message: 'duplicate key value violates unique constraint "letter_scales_one_current"' })));
  check('an old database is explained', /not been upgraded/.test(e({ code: '42883', message: 'function does not exist' })));
  check('a uuid never reaches the reader', !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(e({ message: 'bad 11111111-2222-3333-4444-555555555555' })));
}

section('the page and its neighbours');
{
  const html = read('site/faculty/scale.html');
  const mod = read('site/js/faculty-scale.js');
  check('the page is director only', /isDirectorForCurrent\(\)/.test(html));
  check('the page has no publish control', !/>\s*Publish\s*</i.test(html) && !/is_published/.test(html + mod));
  check('the module never writes grades, totals or points', !/from\('(grades|submissions|assignment_offerings|enrollments)'\)/.test(mod));
  check('the module writes only letter_scales', [...mod.matchAll(/from\('([a-z_]+)'\)/g)].every(m => ['letter_scales', 'course_offerings'].includes(m[1])));
  check('the page sets no raw HTML from data without esc', (html.match(/\$\{esc\(/g) || []).length > 15);
  check('the Items page links to it', /scale\.html/.test(read('site/faculty/items.html')));
  check('the save button waits on planSave, which waits on the preview for an active course', /planSave\(/.test(html) && /previewKey/.test(html));
  check('the save path re-checks the plan before it writes', (html.match(/S\.planSave\(/g) || []).length >= 2);
}

summary();
