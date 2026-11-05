// test-zero-checks.mjs — a suite that records no checks must fail the run. OFFLINE.
//
// Fake suites are written to a temporary folder and run in their own process; their real output
// is what the rule is applied to.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, eq, section } from './harness.mjs';
import { zeroCheckVerdict, countChecks, isSkipLine, ZERO_CHECK_ALLOWED } from './zero-checks.mjs';

section('zero-check rule — fake suites');

const dir = mkdtempSync(join(tmpdir(), 'zero-checks-'));
function fake(name, body) {
  const f = join(dir, name);
  writeFileSync(f, body);
  const r = spawnSync(process.execPath, [f], { encoding: 'utf8' });
  return { status: r.status, out: r.stdout };
}
const verdict = (name, body) => {
  const r = fake(name, body);
  return { r, v: zeroCheckVerdict(name, countChecks(r.out), r.out) };
};

try {
  eq('the allow-list holds only the edge-function suite', [...ZERO_CHECK_ALLOWED], ['test-edge-functions.mjs']);

  let t = verdict('test-empty.mjs', "console.log('hello');");
  check('an empty suite exits 0 yet is refused', t.r.status === 0 && t.v !== null, t.v);

  t = verdict('test-lower.mjs', "console.log('  [skipped] something');");
  check('a lower-case "skipped" does not excuse zero checks', t.v !== null, t.v);

  t = verdict('test-word.mjs', "console.log('this was SKIPPED somewhere in the middle');");
  check('the word SKIPPED inside a sentence does not excuse zero checks', t.v !== null, t.v);

  t = verdict('test-other.mjs', "console.log('  [SKIPPED] a thing — reason');");
  check('the exact marker does not excuse a suite that is not on the list', t.v !== null, t.v);

  t = verdict('test-edge-functions.mjs', "console.log('  [SKIPPED] a proxy — not deployed');");
  check('the listed suite with the exact marker line is accepted', t.v === null, t.v);

  t = verdict('test-edge-functions.mjs', "console.log('nothing at all');");
  check('the listed suite with no marker is still refused', t.v !== null, t.v);

  t = verdict('test-edge-functions.mjs', "console.log('x [SKIPPED] y');");
  check('the marker must start the line', t.v !== null, t.v);

  t = verdict('test-real.mjs', "console.log('  [pass] one');");
  check('a suite with a pass is accepted', t.v === null, t.v);

  t = verdict('test-failing.mjs', "console.log('  [FAIL] one');");
  check('a suite with only a failure is not "zero checks"', t.v === null, t.v);

  check('isSkipLine is case-sensitive', isSkipLine('  [SKIPPED] x') && !isSkipLine('  [skipped] x'));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
