// zero-checks.mjs — the rule that a suite which records no checks has tested nothing.
//
// Pure functions, so test-zero-checks.mjs can run them against fake suites. run.mjs applies them
// to every suite it runs.

/** Suites that may finish with zero checks because they announce a skip. Only these. */
export const ZERO_CHECK_ALLOWED = new Set(['test-edge-functions.mjs']);

/** True when a line is the harness's exact skip marker, at the start of the line. */
export const isSkipLine = (line) => /^\s*\[SKIPPED\] /.test(line);

/** Passed or failed checks printed in a suite's output. */
export function countChecks(output) {
  return (String(output).match(/^\s*\[(?:pass|FAIL)\]/gm) || []).length;
}

/** Null when the suite is acceptable, otherwise the reason it is not. */
export function zeroCheckVerdict(suiteName, checks, output) {
  if (checks > 0) return null;
  const base = String(suiteName).split(/[\/]/).pop();
  const announced = String(output).split('\n').some(isSkipLine);
  if (ZERO_CHECK_ALLOWED.has(base) && announced) return null;
  return `suite ${base} ran ZERO checks`;
}
