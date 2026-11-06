// test-check-answer-function.mjs — the check-answer edge function's logic (supabase/functions/check-answer/handler.js).
//
// WHAT THIS DEFENDS
//   * The function carries the SAME parser file as the site (byte for byte, line endings aside), and the same
//     vectors give the same answers through both copies.
//   * The reply to a browser is right or wrong and the attempt counters, built field by field: no key, no value,
//     no tolerance, no score, no key version, whatever the database returns.
//   * An altered request cannot choose a grade: is_correct, points, score, attempt_no, student_id, enrollment_id
//     and any other extra field are ignored; the result is the same with or without them.
//   * Who the student is comes only from the session; a bad or missing session reaches no database call.
//   * A refused answer (unreadable number, ambiguous comma, a choice not on the list) is not stored.
//   * A corrected key between the two database calls is retried once, then reported, never stored against the old key.
//   * Retries and double sends cannot exceed the limit (against an in-memory model of the database rules).
//
// WHAT THIS CANNOT PROVE
//   The real database rules (scripts/staging/scratch_stage_e_proof.py does), Deno, or the JWT check on staging.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { handle } from '../../supabase/functions/check-answer/handler.js';
import * as fnParser from '../../supabase/functions/check-answer/numeric-answer.js';
import * as siteParser from '../../site/js/numeric-answer.js';
import * as siteSymbolic from '../../site/js/symbolic-answer.js';
import { check, eq, section, summary } from './mini-assert.mjs';

const U = '11111111-1111-4111-8111-111111111111';
const AO = '22222222-2222-4222-8222-222222222222';
const Q = '33333333-3333-4333-8333-333333333333';
const KEY = '44444444-4444-4444-8444-444444444444';

const norm = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sha = (t) => createHash('sha256').update(t).digest('hex');

section('one parser, two copies');
{
  const a = norm('../../site/js/numeric-answer.js');
  const b = norm('../../supabase/functions/check-answer/numeric-answer.js');
  check('the function folder holds the site parser, byte for byte (line endings aside)', a === b, `${sha(a).slice(0, 12)} vs ${sha(b).slice(0, 12)}`);
  const vectors = ['1E3', '1.0e3', '1000', '1,000', '1,5', '9.8 m/s^2', 'abc', '', '1e999', '0x1F', '12,345.6', '-.5', '1.0 x 10^3'];
  const run = (m) => vectors.map(v => { const r = m.parseAnswer(v); return r.ok ? [m.decimalToPlain(r.value), r.dbText, r.unit, r.sigFigsMin, r.sigFigsMax] : [r.code]; });
  eq('both copies read every vector the same', run(fnParser), run(siteParser));
  const key = { value: '9.8', tol_abs: null, tol_pct: '2', sig_figs: null, sig_fig_mode: 'ignore', unit: null, unit_aliases: null, unit_mode: 'ignore' };
  const mark = (m) => ['9.8', '9.99', '10.1', '0', '9.6'].map(v => m.checkNumeric(m.parseAnswer(v), key).correct);
  eq('both copies mark the same answers the same', mark(fnParser), mark(siteParser));
}

/* ── a fake service-role client ──────────────────────────────────────────────────────────────────────── */
function world({ format = 'numeric', key, status = 'ok', limit = null, recStatus = null, flipKeyOnce = false } = {}) {
  const w = { calls: [], stored: [], used: 0, users: { good: { id: U } }, keyId: KEY };
  w.key = key || { value: '9.8', tol_abs: null, tol_pct: '2', sig_figs: null, sig_fig_mode: 'ignore', unit: null, unit_aliases: [], unit_mode: 'ignore', correct_choice_ids: ['b'] };
  w.flips = flipKeyOnce ? 1 : 0;
  w.deps = {
    getUser: async (jwt) => { w.calls.push(['getUser']); return w.users[jwt] || null; },
    rpc: async (name, args) => {
      w.calls.push([name, args]);
      if (name === 'answer_context') {
        if (status !== 'ok') return { data: { status }, error: null };
        if (limit !== null && w.used >= limit) return { data: { status: 'limit_reached' }, error: null };
        return { data: { status: 'ok', format, choice_ids: ['a', 'b', 'c', 'd'], key_version_id: w.keyId, key: w.key }, error: null };
      }
      if (name === 'record_answer') {
        if (recStatus) return { data: { status: recStatus }, error: null };
        if (w.flips > 0) { w.flips--; w.keyId = '55555555-5555-4555-8555-555555555555'; return { data: { status: 'key_changed' }, error: null }; }
        if (args.p_key_version !== w.keyId) return { data: { status: 'key_changed' }, error: null };
        if (limit !== null && w.used >= limit) return { data: { status: 'limit_reached' }, error: null };
        w.used++;
        w.stored.push(args);
        return { data: { status: 'ok', correct: args.p_is_correct, attempt_no: w.used, attempts_left: limit === null ? null : limit - w.used, secret: 'x', key_version_id: KEY, points: 9 }, error: null };
      }
      return { data: null, error: { message: 'no such function' } };
    },
  };
  return w;
}
const post = (body, token = 'good', extraHeaders = {}) => new Request('https://x.test/check-answer', {
  method: 'POST', headers: { Authorization: token === null ? '' : `Bearer ${token}`, ...extraHeaders }, body: typeof body === 'string' ? body : JSON.stringify(body),
});
const send = async (w, body, token) => (await handle(post(body, token), w.deps)).json();
const base = { assignment_offering_id: AO, question_id: Q, answer: '9.8' };

section('the reply is right or wrong, nothing else');
{
  const w = world();
  const r = await send(w, base);
  eq('a right answer returns exactly four fields', Object.keys(r).sort(), ['attempt_no', 'attempts_left', 'correct', 'ok']);
  eq('...and says right', [r.ok, r.correct, r.attempt_no], [true, true, 1]);
  const wrong = await send(world(), { ...base, answer: '12' });
  eq('a wrong answer says wrong, with the same four fields', [wrong.ok, wrong.correct, Object.keys(wrong).length], [true, false, 4]);
  const text = JSON.stringify([r, wrong]);
  check('no reply carries the key value, tolerance, key version, points or the extra database fields', !/9\.8|tol_|key_version|points|secret|44444444/.test(text.replace(/"attempt_no"/g, '')), text);
  const refused = await send(world({ status: 'closed' }), base);
  eq('a refusal has only ok, code and error', Object.keys(refused).sort(), ['code', 'error', 'ok']);
  check('no refusal text mentions the key', !/9\.8|tolerance|key value/i.test(JSON.stringify(refused)));
  const wc = world();
  await send(wc, { ...base, answer: '9.8' });
  check('the key is never sent anywhere but to the checker (record_answer carries a verdict, not the key)', !JSON.stringify(wc.stored).includes('tol_pct') && wc.stored[0].p_is_correct === true);
}

section('an altered request cannot choose a grade');
{
  const clean = world(); const rc = await send(clean, { ...base, answer: '12' });
  const tampered = world();
  const rt = await send(tampered, { ...base, answer: '12', is_correct: true, correct: true, points: 99, score: 99, attempt_no: 7, attempts_left: 50,
    student_id: 3000000001, enrollment_id: '66666666-6666-4666-8666-666666666666', user_id: '66666666-6666-4666-8666-666666666666',
    p_is_correct: true, key_version_id: 'x', grade: 'full', status: 'ok', source: 'instructor' });
  eq('extra fields change nothing in the reply', rt, rc);
  eq('...nor in what is stored', tampered.stored.map(s => [s.p_is_correct, s.p_auth_user, s.p_key_version, JSON.stringify(s.p_answer)]),
    clean.stored.map(s => [s.p_is_correct, s.p_auth_user, s.p_key_version, JSON.stringify(s.p_answer)]));
  check('the wrong answer stayed wrong', rt.correct === false && tampered.stored[0].p_is_correct === false);
  check('the identity sent to the database is the session user, not a body field', tampered.stored[0].p_auth_user === U);
  const keys = Object.keys(tampered.stored[0]).sort();
  eq('record_answer receives exactly the fields it is meant to', keys, ['p_answer', 'p_assignment_offering', 'p_auth_user', 'p_is_correct', 'p_key_version', 'p_parsed', 'p_question']);
}

section('the session decides who the student is');
{
  for (const [label, token] of [['no header', null], ['an unknown token', 'bad'], ['a header that is not Bearer', 'x y']]) {
    const w = world();
    const r = await (await handle(label === 'a header that is not Bearer'
      ? new Request('https://x.test', { method: 'POST', headers: { Authorization: 'Basic abc' }, body: JSON.stringify(base) })
      : post(base, token), w.deps)).json();
    check(`${label}: refused`, r.ok === false && r.code === 'not_signed_in', JSON.stringify(r));
    check(`${label}: no answer_context or record_answer call was made`, !w.calls.some(c => c[0] === 'answer_context' || c[0] === 'record_answer'));
  }
  const r = await send(world(), { ...base, assignment_offering_id: 'nope' });
  check('a malformed id is refused before any database call', r.ok === false && r.code === 'bad_request');
  const w = world(); await send(w, 'not json'); check('bad JSON is refused', !w.calls.length);
  const w2 = world(); const big = await send(w2, { ...base, answer: 'x'.repeat(3000) }); check('an oversized body is refused', big.ok === false && big.code === 'too_large' && !w2.calls.length);
  const opt = await handle(new Request('https://x.test', { method: 'OPTIONS' }), world().deps); check('OPTIONS answers for the browser', opt.status === 200);
  const get = await (await handle(new Request('https://x.test', { method: 'GET' }), world().deps)).json(); check('GET is refused', get.ok === false);
}

section('a refused answer is not an attempt');
{
  for (const [text, code] of [['1,5', 'comma'], ['abc', 'not_a_number'], ['', 'empty'], ['1e999', 'exponent_range'], ['3 4', 'second_number']]) {
    const w = world(); const r = await send(w, { ...base, answer: text });
    check(`"${text}" is refused (${code}) and nothing is stored`, r.ok === false && r.code === code && w.stored.length === 0 && !w.calls.some(c => c[0] === 'record_answer'), JSON.stringify(r));
  }
  const w = world(); const r = await send(w, { ...base, answer: 5 }); check('a number instead of text is refused', r.ok === false && w.stored.length === 0);
  const wc = world({ format: 'multiple_choice' });
  const bad = await send(wc, { ...base, answer: 'z' }); check('a choice that is not on the list is refused, not marked wrong', bad.ok === false && wc.stored.length === 0);
  const none = await send(wc, { ...base, answer: [] }); check('no choice is refused', none.ok === false && wc.stored.length === 0);
  const two = await send(wc, { ...base, answer: ['a', 'b'] }); check('two choices for a single-answer question are refused', two.ok === false && wc.stored.length === 0);
  const ok = await send(wc, { ...base, answer: 'b' }); eq('the right choice is right', [ok.ok, ok.correct], [true, true]);
  const ms = world({ format: 'multiple_select', key: { correct_choice_ids: ['a', 'c'] } });
  eq('select all that apply, in any order', (await send(ms, { ...base, answer: ['c', 'a'] })).correct, true);
  const prose = await send(world({ format: 'prose' }), base); check('prose is never marked here', prose.ok === false && prose.code === 'not_auto_checked');
}

section('refusal codes from the database reach the student as plain sentences');
for (const code of ['not_found', 'not_enrolled', 'not_open', 'closed', 'limit_reached', 'retired', 'no_key', 'key_unchecked', 'deadline_unreadable', 'late_unavailable', 'key_fault']) {
  const r = await send(world({ status: code }), base);
  check(`${code}: ok false with that code and a sentence`, r.ok === false && r.code === code && typeof r.error === 'string' && r.error.length > 10);
}
{
  const r = await send(world({ recStatus: 'closed' }), base); check('the deadline passing between the two calls is a refusal', r.ok === false && r.code === 'closed');
  const e = await handle(post(base), { getUser: async () => ({ id: U }), rpc: async () => ({ data: null, error: { message: 'boom secret' } }) });
  const j = await e.json(); check('a database error is a plain "busy", with no database text', j.ok === false && j.code === 'busy' && !/boom|secret/.test(j.error));
}

section('a question with a fault is not the student\'s mistake');
{
  const unreadable = [
    ['a numeric key with no value', { value: null, tol_pct: '2' }],
    ['a value the checker cannot read', { value: 'abc' }],
    ['a value of 62 digits', { value: '1' + '0'.repeat(61) }],
    ['a tolerance the checker cannot read', { value: '9.8', tol_pct: 'x' }],
  ];
  for (const [label, key] of unreadable) {
    const w = world({ key: { tol_abs: null, tol_pct: null, sig_figs: null, sig_fig_mode: 'ignore', unit: null, unit_aliases: [], unit_mode: 'ignore', ...key } });
    const r = await send(w, { ...base, answer: '1e61' });
    check(`${label}: the student is told the question has a fault`, r.ok === false && r.code === 'key_fault' && /fault in this question/.test(r.error), JSON.stringify(r));
    check(`${label}: no attempt is stored and record_answer is never called`, w.stored.length === 0 && !w.calls.some(c => c[0] === 'record_answer'));
    check(`${label}: nothing was marked wrong`, !('correct' in r));
  }
  for (const [label, format, ids] of [['a choice key naming nothing', 'multiple_choice', []], ['a choice key naming a choice that is not offered', 'multiple_choice', ['zz']]]) {
    const w = world({ format, key: { correct_choice_ids: ids } });
    const r = await send(w, { ...base, answer: 'a' });
    check(`${label}: key_fault, nothing stored`, r.ok === false && r.code === 'key_fault' && w.stored.length === 0);
  }
  const rl = await send(world({ status: 'late_unavailable' }), base);
  check('late work with no term end is refused in plain words', rl.ok === false && /end of the term has not been set/.test(rl.error), JSON.stringify(rl));
}

section('a key corrected between the two calls');
{
  const w = world({ flipKeyOnce: true });
  const r = await send(w, base);
  check('it retries once against the new key and succeeds', r.ok === true && w.stored.length === 1 && w.stored[0].p_key_version === '55555555-5555-4555-8555-555555555555', JSON.stringify(r));
  const w2 = world(); w2.flips = 5;
  const r2 = await send(w2, base);
  check('if the key keeps moving it gives up and stores nothing', r2.ok === false && r2.code === 'key_changed' && w2.stored.length === 0);
}

section('retries and double sends cannot exceed the limit (against a model of the database rules)');
{
  const w = world({ limit: 3 });
  const results = await Promise.all(Array.from({ length: 10 }, () => send(w, base)));
  check('10 sends at once with a limit of 3: exactly 3 stored', w.stored.length === 3 && results.filter(r => r.ok).length === 3, `${w.stored.length}`);
  check('the other 7 are told limit_reached', results.filter(r => r.code === 'limit_reached').length === 7);
  const again = await send(w, base); check('another send after that is still refused', again.ok === false && w.stored.length === 3);
}

section('symbolic answers: the same file as the site, checked on the server');
{
  const a = norm('../../site/js/symbolic-answer.js');
  check('the function folder holds the site symbolic checker, byte for byte (line endings aside)', a === norm('../../supabase/functions/check-answer/symbolic-answer.js'));
  check('the handler imports it from its own folder and never calls eval or the Function constructor',
    /from '\.\/symbolic-answer\.js'/.test(norm('../../supabase/functions/check-answer/handler.js')) && !/\beval\s*\(|new\s+Function|\bFunction\s*\(/.test(norm('../../supabase/functions/check-answer/handler.js')));
  check('the site module is the one used below', typeof siteSymbolic.checkSymbolic === 'function');
  const symKey = { expression: 'm*v^2/2', variables: ['m', 'v'] };
  const sw = (extra = {}) => world({ format: 'symbolic', key: symKey, ...extra });
  const r1 = await send(sw(), { ...base, answer: '0.5 m v^2' });
  eq('an equivalent form is right, and the reply has the same four fields', [r1.ok, r1.correct, Object.keys(r1).sort()], [true, true, ['attempt_no', 'attempts_left', 'correct', 'ok']]);
  const wr = sw(); const r2 = await send(wr, { ...base, answer: 'm v^2' });
  eq('a different expression is wrong, and an attempt is stored', [r2.ok, r2.correct, wr.stored.length], [true, false, 1]);
  eq('what is stored is the raw text and no parsed number', [wr.stored[0].p_answer, wr.stored[0].p_parsed, wr.stored[0].p_is_correct], [{ raw: 'm v^2' }, null, false]);
  check('no reply carries the key expression', !/m\*v\^2\/2/.test(JSON.stringify([r1, r2])));
  for (const [text, code] of [['z', 'unknown_name'], ['(m v', 'brackets'], ['', 'empty'], ['F = m v', 'equals'], ['1/2m', 'ambiguous_division'], ['m;v', 'bad_character'], ['sin m', 'function_brackets'], ['('.repeat(60) + 'm' + ')'.repeat(60), 'too_deep'], ['m+'.repeat(150), 'too_long']]) {
    const w = sw(); const r = await send(w, { ...base, answer: text });
    check(`"${text.slice(0, 20)}" is refused (${code}) and nothing is stored`, r.ok === false && r.code === code && w.stored.length === 0 && !w.calls.some(c => c[0] === 'record_answer'), JSON.stringify(r).slice(0, 160));
    check(`"${text.slice(0, 20)}": the sentence does not reveal the key`, !/v\^2\/2/.test(r.error || ''));
  }
  // variables that can be negative reach the checker; by default every variable is positive
  const posKey = { expression: 'x', variables: ['x'] };
  const rp = await send(sw({ key: posKey }), { ...base, answer: 'sqrt(x^2)' });
  check('by default sqrt(x^2) matches x (positive values only)', rp.ok === true && rp.correct === true, JSON.stringify(rp));
  const rn = await send(sw({ key: { ...posKey, signed_variables: ['x'] } }), { ...base, answer: 'sqrt(x^2)' });
  check('a variable marked can-be-negative reaches the checker: sqrt(x^2) no longer matches x', rn.ok === true && rn.correct === false, JSON.stringify(rn));
  const rg = await send(sw({ key: { expression: 'sqrt(k/m)', variables: ['k', 'm'] } }), { ...base, answer: 'sqrt(k)/sqrt(m)' });
  check('a split square root is right', rg.ok === true && rg.correct === true, JSON.stringify(rg));
  const rt = await send(sw({ key: { expression: '6.63e-34*f', variables: ['f'] } }), { ...base, answer: '0' });
  check('a tiny key does not accept zero', rt.ok === true && rt.correct === false, JSON.stringify(rt));
  const rb = await send(sw({ key: { expression: 'x', variables: ['x'], signed_variables: ['q'] } }), { ...base, answer: 'x' });
  check('a signed name that is not a variable is a key fault', rb.ok === false && rb.code === 'key_fault', JSON.stringify(rb));
  const num = await send(sw(), { ...base, answer: 5 }); check('a non-text answer is refused', num.ok === false && num.code === 'bad_answer');
  const arr = await send(sw(), { ...base, answer: ['m'] }); check('a list is refused', arr.ok === false);
  for (const [label, key] of [
    ['a key that does not parse', { expression: '(m*v', variables: ['m', 'v'] }],
    ['a key with no expression', { expression: null, variables: ['m', 'v'] }],
    ['a key using a variable the question does not allow', { expression: 'm*q', variables: ['m', 'v'] }],
    ['a key with no variables', { expression: 'm', variables: [] }],
    ['a key undefined at every test point', { expression: 'sqrt(-1-m^2)', variables: ['m', 'v'] }],
    ['a key with an unclear division', { expression: '1/2m', variables: ['m', 'v'] }],
  ]) {
    const w = sw({ key }); const r = await send(w, { ...base, answer: 'm' });
    check(`${label}: key_fault, nothing stored, nothing marked wrong`, r.ok === false && r.code === 'key_fault' && /fault in this question/.test(r.error) && w.stored.length === 0 && !('correct' in r), JSON.stringify(r).slice(0, 160));
  }
  const hostile = sw(); const rh = await send(hostile, { ...base, answer: 'constructor.constructor("return 1")()' });
  check('a hostile answer is refused, not run', rh.ok === false && hostile.stored.length === 0);
  const wl = sw({ limit: 2 });
  const rs = await Promise.all(Array.from({ length: 6 }, () => send(wl, { ...base, answer: 'm' })));
  check('the attempt limit holds for symbolic answers too', wl.stored.length === 2 && rs.filter(r => r.code === 'limit_reached').length === 4);
  const same = [await send(sw(), { ...base, answer: 'm*v*v/2' }), await send(sw(), { ...base, answer: 'm*v*v/2' })];
  eq('the same answer gets the same verdict every time', same[0], same[1]);
  const ref = world({ format: 'numeric' }); const nr = await send(ref, { ...base, answer: '9.8' });
  eq('a numeric question behaves as before', [nr.ok, nr.correct, ref.stored[0].p_parsed], [true, true, '98e-1']);
}

process.exit(summary() ? 0 : 1);
