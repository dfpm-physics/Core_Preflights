// test-key-names-health.mjs -- migration 088 and the Health line for symbolic keys the checker cannot read.
//
// WHAT THIS DEFENDS
//   * The database's name folding (_fold_name in migration 088) holds the SAME table as the reader's foldName
//     (site/js/symbolic-answer.js), letter for letter, so the database check and the reader agree on which names are one.
//   * The migration folds before the duplicate, signed-variable and function-name checks, and keeps every other message.
//   * symbolic_key_problems checks inside the function that the caller staffs the offering, is granted to signed-in
//     users only, returns no key, expression or variable name, and its rollback restores the 087 check.
//   * The Health page reads that list once per offering, shows the count and a link per question, and shows an error
//     when the read fails: a failed or missing read is never "clear".
//
// WHAT THIS CANNOT PROVE
//   Offline. It reads the migration text and runs the shipped Health module against a recording stub. It does not run
//   the SQL: scripts/staging/scratch_symbolic_proof.py does that on a scratch database (088 section), by hand.

import { readFileSync, existsSync } from 'node:fs';
import { check, eq, section, summary, installBrowser, REPO } from './harness.mjs';

installBrowser({ pathname: '/site/faculty/health.html' });

const MIG = REPO + '/supabase/migrations/app/088_key_names_folded_and_health.sql';
const ROLL = REPO + '/supabase/migrations/app/rollback/088_key_names_folded_and_health_ROLLBACK.sql';
const M087 = REPO + '/supabase/migrations/app/087_key_variable_e_pi.sql';

section('the migration exists with its rollback');
check('088 is written', existsSync(MIG));
check('its rollback is written', existsSync(ROLL));
const sql = existsSync(MIG) ? readFileSync(MIG, 'utf8') : '';
const roll = existsSync(ROLL) ? readFileSync(ROLL, 'utf8') : '';

section('the database folds names with the reader\'s table');
const R = await import('../../site/js/symbolic-answer.js');
const table = new Map();
for (const m of sql.matchAll(/\(E'\\u([0-9A-Fa-f]{4})',\s*'([A-Za-z]+)'\)/g)) table.set(String.fromCharCode(parseInt(m[1], 16)), m[2]);
check('the migration carries a table of letters', table.size >= 30, String(table.size));
// every character in the Greek block, the micro sign, and the letters the table names must fold the same way
const probe = [];
for (let c = 0x0370; c <= 0x03FF; c++) probe.push(String.fromCharCode(c));
probe.push('\u00B5');
const bad = probe.filter(ch => (table.get(ch) ?? ch) !== R.foldName(ch));
eq('no character folds differently in the database table and in the reader', bad.map(ch => 'U+' + ch.charCodeAt(0).toString(16)), []);
const extra = [...table.keys()].filter(ch => R.foldName(ch) === ch);
eq('the database table names no letter the reader leaves alone', extra, []);

section('the key check folds before it compares');
check('_fold_name is defined', /CREATE FUNCTION _fold_name\(p text\)/.test(sql));
check('the duplicate check folds', /count\(DISTINCT _fold_name\(v\)\)/.test(sql));
check('the signed-variable check folds both sides', /_fold_name\(v\) = _fold_name\(s\.n\)/.test(sql));
check('the function-name check folds', /_fold_name\(v_name\) = ANY/.test(sql));
check('_key_problem is replaced with the same signature', /CREATE OR REPLACE FUNCTION _key_problem\(p_format text, p_choices jsonb, k question_keys\)/.test(sql));
const msgs087 = [...readFileSync(M087, 'utf8').matchAll(/RETURN '((?:[^']|'')*)'/g)].map(m => m[1]);
const missing = msgs087.filter(t => !sql.includes(t) && !t.startsWith('a variable is listed twice') && !t.startsWith('a variable cannot be named'));
eq('every other refusal sentence of 087 is kept word for word', missing, []);
check('the database check still refuses a variable named like a function', /a variable cannot be named like a function/.test(sql));
check('e and pi stay allowed as variable names (087 is kept)', !/'e', 'pi'/.test(sql));
check('_fold_name is granted to no role', /REVOKE ALL ON FUNCTION _fold_name\(text\) FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read/.test(sql)
  && !/GRANT[^;]*_fold_name/.test(sql));

section('the staff list');
const fn = sql.slice(sql.indexOf('CREATE FUNCTION symbolic_key_problems'));
check('the list function exists', fn.length > 0);
check('it is a security definer with a fixed search path', /SECURITY DEFINER\s+SET search_path = app, pg_temp/.test(fn));
check('it checks inside the function that the caller staffs the offering', /staff_offerings\(\)/.test(fn) && /p_course_offering/.test(fn));
check('it returns nothing when the check fails', /THEN\s+RETURN;\s+END IF;/.test(fn));
check('a missing caller returns nothing', /current_uid\(\) IS NULL/.test(fn));
const header = fn.slice(0, fn.indexOf('AS $$'));
check('it returns no key, expression, variable or value column', !/expression|variables|value|tol_/.test(header), header.replace(/\s+/g, ' '));
const body = fn.slice(fn.indexOf('RETURN QUERY'), fn.indexOf('END; $$'));
check('it selects no key column', !/k\.(expression|variables|signed_variables|value|tol_abs|tol_pct|correct_choice_ids)/.test(body));
check('it lists only published items, symbolic questions that are not retired, and the current key', /ao\.is_published/.test(body)
  && /q\.format = 'symbolic'/.test(body) && /NOT q\.is_retired/.test(body) && /k\.superseded_at IS NULL/.test(body));
check('it uses the one key rule', /_key_problem\(q\.format, q\.choices, k\)/.test(body));
check('it is granted to signed-in users and nobody else', /GRANT EXECUTE ON FUNCTION symbolic_key_problems\(uuid\) TO authenticated;/.test(sql)
  && !/GRANT[^;]*symbolic_key_problems[^;]*(anon|service_role|PUBLIC|prep_app)/.test(sql)
  && /REVOKE ALL ON FUNCTION symbolic_key_problems\(uuid\) FROM PUBLIC, anon, authenticated, service_role, prep_app_dml, prep_app_read/.test(sql));

section('the rollback');
check('it restores _key_problem from 087', roll.includes('CREATE OR REPLACE FUNCTION _key_problem') && /'e', 'pi'/.test(roll) === false
  && roll.includes('a variable cannot be named like a function') && roll.includes('SELECT count(DISTINCT v) FROM unnest(k.variables) v'));
check('it drops both new functions', /DROP FUNCTION symbolic_key_problems\(uuid\);/.test(roll) && /DROP FUNCTION _fold_name\(text\);/.test(roll));
check('it drops them after the check that uses the folder is replaced', roll.indexOf('CREATE OR REPLACE FUNCTION _key_problem') < roll.indexOf('DROP FUNCTION _fold_name'));
check('both files are plain ASCII', !/[^\x00-\x7f]/.test(sql) && !/[^\x00-\x7f]/.test(roll));

section('Health: the line for keys the checker cannot read');
let RPC = [];
let RPC_REPLY = () => ({ data: [], error: null });
const stubFrom = () => {
  const c = {};
  for (const m of ['eq', 'in', 'is', 'not', 'neq', 'gt', 'lt', 'gte', 'lte', 'order', 'limit', 'filter', 'or', 'range', 'select'])
    c[m] = () => c;
  c.single = c.maybeSingle = () => Promise.resolve({ data: null, error: null });
  c.then = (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej);
  return c;
};
const OFF = (id, code) => ({ id, course_id: 'c-' + id, is_active: true, courses: { code }, terms: { code: 'T', label: 'Term' } });
globalThis.window.db = {
  from: (t) => {
    if (t === 'course_offerings') {
      const c = stubFrom();
      c.then = (res, rej) => Promise.resolve({ data: [OFF('co-a', 'phys-a'), OFF('co-b', 'phys-b')], error: null }).then(res, rej);
      return c;
    }
    return stubFrom();
  },
  rpc: (name, args) => { RPC.push({ name, args }); return Promise.resolve(RPC_REPLY(name, args)); },
};
globalThis.fetch = async () => ({ ok: false, json: async () => null });
const H = await import('../../site/js/faculty-health.js');

RPC_REPLY = (name, args) => ({
  data: args.p_course_offering === 'co-a'
    ? [{ question_id: 'q1', qid: 'energy', assignment_offering_id: 'ao-1', assignment_slug: 'hw-1', problem: 'a variable is listed twice (a Greek letter and its Latin spelling are the same name)' },
       { question_id: 'q2', qid: 'power', assignment_offering_id: 'ao-2', assignment_slug: 'hw-2', problem: 'the expected expression has brackets that do not match' }]
    : [],
  error: null,
});
const raw = await H.loadHealth();
eq('it calls the staff list once per active offering', RPC.map(r => r.args.p_course_offering).sort(), ['co-a', 'co-b']);
check('it calls the list by its name', RPC.every(r => r.name === 'symbolic_key_problems'));
const m = H.shapeHealth(raw);
const ck = H.runChecks(m).find(c => c.id === 'symbolic-key-unreadable');
check('the check exists', !!ck);
eq('the count is the number of questions', ck?.findings.length, 2);
check('each finding links to the item that holds the question', ck?.findings.every(f => /^items\.html\?a=ao-[12]$/.test(f.href)), JSON.stringify(ck?.findings.map(f => f.href)));
check('each finding names the question and says the problem', ck?.findings[0].where.includes('energy') && ck?.findings[0].detail.includes('listed twice'));
check('the check is loud', ck?.severity === 'critical');
check('its wording is plain and says what to do', /key/i.test(ck?.why) && /question/i.test(ck?.fix));
const one = H.runChecks(H.shapeHealth(raw, { offeringId: 'co-b' })).find(c => c.id === 'symbolic-key-unreadable');
eq('narrowing to an offering with none finds none', one.findings.length, 0);

RPC = [];
RPC_REPLY = (name, args) => (args.p_course_offering === 'co-b'
  ? { data: null, error: { message: 'function does not exist' } } : { data: [], error: null });
const rawBad = await H.loadHealth();
const ckBad = H.runChecks(H.shapeHealth(rawBad)).find(c => c.id === 'symbolic-key-unreadable');
check('a failed read is a finding, not a pass', ckBad.findings.length === 1 && /could not be read/i.test(ckBad.findings[0].where), JSON.stringify(ckBad.findings));
check('... and it carries the reason', /does not exist/.test(ckBad.findings[0].detail));
const ckBadOne = H.runChecks(H.shapeHealth(rawBad, { offeringId: 'co-a' })).find(c => c.id === 'symbolic-key-unreadable');
check('... in every view, because the read failed for all of them', ckBadOne.findings.length === 1);

const rawNone = { ...raw }; delete rawNone.keyProblems;
const ckNone = H.runChecks(H.shapeHealth(rawNone)).find(c => c.id === 'symbolic-key-unreadable');
check('a page that never made the read does not report it clear', ckNone.findings.length === 1);

RPC_REPLY = () => ({ data: [], error: null });
const ckOk = H.runChecks(H.shapeHealth(await H.loadHealth())).find(c => c.id === 'symbolic-key-unreadable');
eq('a clean read finds none', ckOk.findings.length, 0);

if (!summary()) process.exit(1);
