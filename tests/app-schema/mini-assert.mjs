// mini-assert.mjs — the same check/eq/section/summary lines as harness.mjs, with no imports.
//
// harness.mjs loads supabase-js and the staging address guard, which a pure-logic suite does not need and a
// fresh clone (no node_modules) cannot load. The output format is identical, so the CI runner reads it the same
// way: "[pass]" and "[FAIL]" lines and a "N passed, M failed" summary.

let passed = 0, failed = 0;
const failures = [];
let skipped = 0;

export function check(desc, ok, detail = '') {
  if (ok) { passed++; console.log(`  [pass] ${desc}`); }
  else { failed++; failures.push(desc); console.log(`  [FAIL] ${desc}${detail ? ` — ${detail}` : ''}`); }
  return ok;
}

export function eq(desc, actual, expected) {
  const a = JSON.stringify(actual, (_, v) => (typeof v === 'bigint' ? `${v}n` : v));
  const b = JSON.stringify(expected, (_, v) => (typeof v === 'bigint' ? `${v}n` : v));
  return check(desc, a === b, a === b ? '' : `expected ${b}, got ${a}`);
}

export function section(title) { console.log(`\n=== ${title} ===`); }

/** A check that did not run, and says why. Never counted as a pass. */
export function skip(desc, reason) { skipped++; console.log(`  [SKIPPED] ${desc} — ${reason}`); }

export function summary() {
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (failed) { console.log('Failed:'); failures.forEach(f => console.log(`  - ${f}`)); }
  return failed === 0;
}
