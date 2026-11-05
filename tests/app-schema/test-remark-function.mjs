// test-remark-function.mjs — the remark-question edge function's logic (supabase/functions/remark-question/handler.js).
//
// WHAT THIS DEFENDS
//   * The function folder carries the SAME parser file as the site and as check-answer (byte for byte, line endings
//     aside): there is no second parser.
//   * The re-mark uses that checker: the same answers get the same verdicts here as in check-answer.
//   * A preview writes nothing and returns a token; a commit must carry that token; a second commit changes 0.
//   * Only attempts of an active term are changed; the preview shows each term and lists the ones it refuses; a stale
//     token (the data or the key moved) is refused.
//   * An answer the checker cannot read is left as it was, not marked wrong. A key the checker cannot read stops the run.
//   * A session that is missing, forged or not a director reaches no write. The body cannot choose a verdict.
//   * The reply to a caller carries counts and ids and never the key.
//
// WHAT THIS CANNOT PROVE
//   The real database rules (scripts/staging/scratch_stage_e_part2_proof.py does), Deno, or the JWT check on staging.
//   The in-memory model below copies the rules of app.remark_apply; it is a model, not the database.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { handle, markAttempt } from '../../supabase/functions/remark-question/handler.js';
import * as siteParser from '../../site/js/numeric-answer.js';
import { check, eq, section, summary } from './mini-assert.mjs';

const U = '11111111-1111-4111-8111-111111111111';
const Q = '33333333-3333-4333-8333-333333333333';
const K2 = '55555555-5555-4555-8555-555555555555';
const K1 = '44444444-4444-4444-8444-444444444444';
const norm = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

section('one parser, three copies');
{
  const site = norm('../../site/js/numeric-answer.js');
  check('remark-question holds the site parser byte for byte', site === norm('../../supabase/functions/remark-question/numeric-answer.js'));
  check('check-answer holds the same file', site === norm('../../supabase/functions/check-answer/numeric-answer.js'));
  check('the handler imports the parser from its own folder and defines no parser of its own',
    /from '\.\/numeric-answer\.js'/.test(norm('../../supabase/functions/remark-question/handler.js'))
    && !/function parse|BigInt|\.split\(','\)|parseFloat|Number\(/.test(norm('../../supabase/functions/remark-question/handler.js').replace(/Number\.isInteger/g, '')));
  check('the site parser module is the one the checks below use', typeof siteParser.parseAnswer === 'function');
}

/* ── an in-memory model of remark_context / remark_apply ─────────────────────────────────────────────── */
const KEY = { value: '9.8', tol_abs: null, tol_pct: '2', sig_figs: null, sig_fig_mode: 'ignore', unit: null, unit_aliases: [], unit_mode: 'ignore', correct_choice_ids: ['b'] };
function world({ format = 'numeric', key = KEY, role = 'director', attempts, graded = {} } = {}) {
  const w = { calls: [], runs: [], keyId: K2, writes: 0, key, format };
  w.attempts = attempts || [
    { id: 'a0000000-0000-4000-8000-000000000001', enr: 'e1', answer: { raw: '9.8' }, c: false, p: 0, k: K1 },     // was wrong against the old key
    { id: 'a0000000-0000-4000-8000-000000000002', enr: 'e2', answer: { raw: '12' }, c: true, p: 2, k: K1 },       // was right against the old key
    { id: 'a0000000-0000-4000-8000-000000000003', enr: 'e3', answer: { raw: '9.7' }, c: true, p: 2, k: K2 },      // already current
    { id: 'a0000000-0000-4000-8000-000000000004', enr: 'e1', answer: { raw: '1,5' }, c: false, p: 0, k: K1 },     // cannot be read
  ];
  for (const a of w.attempts) { a.active ??= true; a.term ??= 'Fall'; }
  w.grades = { e1: 'auto_checked', e2: 'instructor', e3: 'auto_checked', ...graded };
  w.deps = {
    getUser: async (jwt) => (jwt === 'good' || jwt === 'other' ? { id: U } : null),
    rpc: async (name, args) => {
      w.calls.push([name, args]);
      if (role !== 'director') return { data: { status: 'not_allowed' }, error: null };
      if (name === 'remark_context') {
        return { data: { status: 'ok', format, choice_ids: ['a', 'b', 'c'], key_version_id: w.keyId, key: w.key,
          attempts: w.attempts.map(a => ({ id: a.id, answer: a.answer })) }, error: null };
      }
      if (name === 'remark_apply') {
        if (args.p_key_version !== w.keyId) return { data: { status: 'key_changed' }, error: null };
        if (args.p_verdicts.length !== w.attempts.length) return { data: { status: 'attempts_moved' }, error: null };
        const calc = w.attempts.map(a => {
          const v = args.p_verdicts.find(x => x.id === a.id);
          const nc = v.is_correct; const np = nc === null ? a.p : (nc ? 2 : 0); const nk = nc === null ? a.k : args.p_key_version;
          return { a, nc, np, nk, changed: nc !== a.c && nc !== null || np !== a.p || nk !== a.k };
        });
        const live = calc.filter(c => c.a.active);
        const changed = live.filter(c => c.changed).length;
        const token = createHash('md5').update(args.p_key_version + live.filter(c => c.changed).map(c => `${c.a.id}/${c.nc}/${c.np}`).join(',')).digest('hex');
        const terms = [...new Set(calc.map(c => c.a.term))].map(t => {
          const rows = calc.filter(c => c.a.term === t);
          return { term: t, course_offering_id: 'co-' + t, active: rows[0].a.active, attempts: rows.length, would_change: rows.filter(c => c.changed).length,
            grades_affected: new Set(rows.filter(c => c.np !== c.a.p).map(c => c.a.enr)).size, applied: rows[0].a.active,
            reason: rows[0].a.active ? null : 'not an active term: completed work is never re-marked', extra: 'must not appear' };
        });
        const pts = live.filter(c => c.np !== c.a.p);
        const enrs = [...new Set(pts.map(c => c.a.enr))];
        const listed = enrs.filter(e => w.grades[e] !== 'auto_checked').map(e => ({ enrollment_id: e, source: w.grades[e] }));
        const base = { status: 'ok', attempts_total: w.attempts.length, attempts_changed: changed,
          now_correct: calc.filter(c => c.nc === true && c.a.c !== true).length, now_wrong: calc.filter(c => c.nc === false && c.a.c !== false).length,
          unreadable: calc.filter(c => c.nc === null).length, by_term: terms, refused: terms.filter(t => !t.active && t.would_change > 0),
          refused_attempts: calc.filter(c => !c.a.active && c.changed).length, preview_token: token, grades_to_recompute: enrs.length - listed.length, grades_listed: listed.length,
          listed, sample: [], leak: 'must not appear', key: 'must not appear' };
        if (!args.p_commit) return { data: { ...base, committed: false }, error: null };
        if (args.p_preview_token !== token) return { data: { status: 'changed_since_preview', attempts_changed: changed }, error: null };
        for (const c of live) { if (c.changed) { w.writes++; c.a.c = c.nc ?? c.a.c; c.a.p = c.np; c.a.k = c.nk; } }
        w.runs.push({ changed, from: K1, to: args.p_key_version, by: args.p_auth_user });
        return { data: { ...base, committed: true }, error: null };
      }
      return { data: null, error: { message: 'no such function' } };
    },
  };
  return w;
}
const post = (body, token = 'good') => new Request('https://x.test/remark-question', {
  method: 'POST', headers: { Authorization: token === null ? '' : `Bearer ${token}` }, body: typeof body === 'string' ? body : JSON.stringify(body),
});
const send = async (w, body, token) => (await handle(post(body, token), w.deps)).json();

section('markAttempt uses the shared checker');
{
  const ctx = { format: 'numeric', key: KEY, choice_ids: [] };
  const v = (raw) => markAttempt(ctx, { id: 'x', answer: { raw } });
  eq('9.8 against 9.8 +/- 2% is right', v('9.8').is_correct, true);
  eq('9.99 is right (inside 2%)', v('9.99').is_correct, true);
  eq('12 is wrong', v('12').is_correct, false);
  eq('1,5 cannot be read: no verdict, not wrong', v('1,5').is_correct, null);
  eq('the number read from the answer comes back as database text', v('9.8').parsed, '98e-1');
  eq('a stored answer with no text is left alone', markAttempt(ctx, { id: 'x', answer: {} }).is_correct, null);
  const mc = { format: 'multiple_choice', choice_ids: ['a', 'b', 'c'], key: { correct_choice_ids: ['b'] } };
  eq('a right stored choice is right', markAttempt(mc, { id: 'x', answer: { choices: ['b'] } }).is_correct, true);
  eq('a wrong stored choice is wrong', markAttempt(mc, { id: 'x', answer: { choices: ['a'] } }).is_correct, false);
  eq('a stored choice that is no longer on the list is left alone', markAttempt(mc, { id: 'x', answer: { choices: ['z'] } }).is_correct, null);
  eq('a key the checker cannot read stops the run', markAttempt({ format: 'numeric', key: { ...KEY, value: 'abc' } }, { id: 'x', answer: { raw: '9.8' } }), null);
}

section('preview writes nothing; commit needs the preview token');
{
  const w = world();
  const p = await send(w, { question_id: Q, mode: 'preview' });
  check('the preview is ok and not committed', p.ok === true && p.committed === false, JSON.stringify(p));
  eq('four attempts read, two verdict flips, one unreadable', [p.attempts_total, p.now_correct, p.now_wrong, p.unreadable], [4, 1, 1, 1]);
  eq('the preview called remark_apply with commit false', w.calls.filter(c => c[0] === 'remark_apply').map(c => c[1].p_commit), [false]);
  check('nothing was written', w.writes === 0 && w.runs.length === 0);
  eq('an instructor-corrected grade is listed, not changed', p.listed.map(l => l.enrollment_id), ['e2']);
  eq('counts of grades: one to recompute, one listed', [p.grades_to_recompute, p.grades_listed], [1, 1]);
  check('the preview returns a token', /^[0-9a-f]{32}$/.test(p.preview_token), String(p.preview_token));
  const noExpect = await send(w, { question_id: Q, mode: 'commit' });
  check('a commit without the token is refused before any call', noExpect.ok === false && noExpect.code === 'bad_request' && !w.calls.some(c => c[0] === 'remark_apply' && c[1].p_commit));
  const wrong = await send(w, { question_id: Q, mode: 'commit', preview_token: 'f'.repeat(32) });
  check('a commit with a token the preview did not return is refused and writes nothing', wrong.ok === false && wrong.code === 'changed_since_preview' && w.writes === 0, JSON.stringify(wrong));
  const oldNumber = await send(w, { question_id: Q, mode: 'commit', expect_changed: p.attempts_changed });
  check('the old way (a bare count) is no longer a commit', oldNumber.ok === false && oldNumber.code === 'bad_request' && w.writes === 0, JSON.stringify(oldNumber));
  const c1 = await send(w, { question_id: Q, mode: 'commit', preview_token: p.preview_token });
  check('a commit with the preview number is applied', c1.ok && c1.committed === true && w.writes === p.attempts_changed && w.runs.length === 1, JSON.stringify(c1));
  const p2 = await send(w, { question_id: Q, mode: 'preview' });
  eq('run again: the preview now shows 0 changes', p2.attempts_changed, 0);
  const c2 = await send(w, { question_id: Q, mode: 'commit', preview_token: p2.preview_token });
  check('a second commit changes 0 attempts', c2.ok && c2.attempts_changed === 0 && w.writes === p.attempts_changed);
  check('the reply never carries the key or database extras', !/must not appear|9\.8|tol_/.test(JSON.stringify([p, c1, c2])), JSON.stringify(c1));
  eq('the reply has only the intended fields', Object.keys(c1).sort(),
    ['attempts_changed', 'attempts_total', 'by_term', 'committed', 'grades_listed', 'grades_to_recompute', 'listed', 'now_correct', 'now_wrong', 'ok', 'preview_token', 'refused', 'refused_attempts', 'sample', 'unreadable']);
}

section('only an active term is changed; the preview shows every term and what it refuses');
{
  const att = (n, extra) => ({ id: `a0000000-0000-4000-8000-0000000000${n}`, enr: `e${n}`, answer: { raw: '9.8' }, c: false, p: 0, k: K1, ...extra });
  const w = world({ attempts: [att(11, {}), att(12, { active: false, term: 'Past' }), att(13, { active: false, term: 'Past' })], graded: { e11: 'auto_checked', e12: 'auto_checked', e13: 'auto_checked' } });
  const p = await send(w, { question_id: Q, mode: 'preview' });
  eq('the preview counts only the active term as changing', [p.attempts_total, p.attempts_changed, p.refused_attempts], [3, 1, 2]);
  eq('it lists each term, and which one is applied', p.by_term.map(t => [t.term, t.active, t.would_change, t.applied]), [['Fall', true, 1, true], ['Past', false, 2, false]]);
  eq('it names the term it refuses and why', p.refused.map(t => [t.term, t.would_change, /never re-marked/.test(t.reason)]), [['Past', 2, true]]);
  check('a term row carries only the intended fields', p.by_term.every(t => !('extra' in t)), JSON.stringify(p.by_term));
  const c = await send(w, { question_id: Q, mode: 'commit', preview_token: p.preview_token });
  check('the commit writes the active attempt only', c.ok && w.writes === 1, JSON.stringify(c));
  check('the completed term is exactly as it was', w.attempts.filter(a => a.term === 'Past').every(a => a.c === false && a.p === 0 && a.k === K1));
  // a token from before the key or the data moved is stale
  const w2 = world();
  const p2 = await send(w2, { question_id: Q, mode: 'preview' });
  w2.attempts[0].answer = { raw: '50' };
  const stale = await send(w2, { question_id: Q, mode: 'commit', preview_token: p2.preview_token });
  check('a token whose changes are no longer the changes is refused, with nothing written', stale.ok === false && stale.code === 'changed_since_preview' && w2.writes === 0, JSON.stringify(stale));
}

section('who may call, and what the body can choose');
{
  const w = world({ role: 'student' });
  const r = await send(w, { question_id: Q, mode: 'preview' });
  check('a caller the database does not accept gets not_allowed and no apply call', r.ok === false && r.code === 'not_allowed' && !w.calls.some(c => c[0] === 'remark_apply'));
  for (const [label, token] of [['no header', null], ['a forged token', 'bad']]) {
    const w2 = world(); const r2 = await send(w2, { question_id: Q, mode: 'preview' }, token);
    check(`${label}: refused with no database call`, r2.ok === false && r2.code === 'not_signed_in' && !w2.calls.length);
  }
  const w3 = world();
  await send(w3, { question_id: Q, mode: 'preview', is_correct: true, p_verdicts: [], p_auth_user: 'x', user_id: 'x', key_version_id: 'y', points: 99 });
  const apply = w3.calls.find(c => c[0] === 'remark_apply')[1];
  check('the identity sent is the session user and the verdicts come from the checker, not the body',
    apply.p_auth_user === U && apply.p_verdicts.length === 4 && apply.p_key_version === K2);
  for (const bad of [{ mode: 'preview' }, { question_id: 'nope', mode: 'preview' }, { question_id: Q }, { question_id: Q, mode: 'run' },
                     { question_id: Q, mode: 'commit', preview_token: 'abc' }, { question_id: Q, mode: 'commit', preview_token: 3 }, { question_id: Q, mode: 'commit', preview_token: 'F'.repeat(32) }]) {
    const wb = world(); const rb = await send(wb, bad);
    check(`a malformed request ${JSON.stringify(bad).slice(0, 40)} is refused before any call`, rb.ok === false && rb.code === 'bad_request' && !wb.calls.length);
  }
  const wj = world(); const rj = await send(wj, 'not json'); check('bad JSON is refused', rj.ok === false && !wj.calls.length);
  const opt = await handle(new Request('https://x.test', { method: 'OPTIONS' }), world().deps); check('OPTIONS answers for the browser', opt.status === 200);
}

section('refusals reach staff as plain sentences');
{
  const wu = world({ key: { ...KEY, value: 'abc' } });
  const r = await send(wu, { question_id: Q, mode: 'preview' });
  check('an unreadable key stops the run before any apply call', r.ok === false && r.code === 'key_unreadable' && !wu.calls.some(c => c[0] === 'remark_apply'));
  const wk = world(); wk.keyId = K1; const orig = wk.deps.rpc;
  wk.deps.rpc = async (name, args) => { const out = await orig(name, args); if (name === 'remark_context') wk.keyId = K2; return out; };
  const rk = await send(wk, { question_id: Q, mode: 'preview' });
  check('a key that moved between the two calls is reported, nothing written', rk.ok === false && rk.code === 'key_changed' && wk.writes === 0);
  const wm = world(); const o2 = wm.deps.rpc;
  wm.deps.rpc = async (name, args) => { if (name === 'remark_apply') { wm.attempts.push({ id: 'a0000000-0000-4000-8000-000000000009', enr: 'e9', answer: { raw: '1' }, c: false, p: 0, k: K2 }); } return o2(name, args); };
  const rm = await send(wm, { question_id: Q, mode: 'preview' });
  check('an attempt that arrived meanwhile gives attempts_moved', rm.ok === false && rm.code === 'attempts_moved');
  const e = await handle(post({ question_id: Q, mode: 'preview' }), { getUser: async () => ({ id: U }), rpc: async () => ({ data: null, error: { message: 'boom secret' } }) });
  const j = await e.json(); check('a database error is a plain "busy", with no database text', j.ok === false && j.code === 'busy' && !/boom|secret/.test(j.error));
  for (const code of ['not_found', 'not_auto_checked', 'no_key', 'key_unchecked', 'key_fault']) {
    const wc = world(); const o3 = wc.deps.rpc; wc.deps.rpc = async (n, a) => n === 'remark_context' ? { data: { status: code }, error: null } : o3(n, a);
    const rc = await send(wc, { question_id: Q, mode: 'preview' });
    check(`${code}: ok false, that code, a sentence`, rc.ok === false && rc.code === code && rc.error.length > 10);
  }
}

process.exit(summary() ? 0 : 1);
