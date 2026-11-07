// percent-shown.js -- how a course percent is printed. PURE: no imports, no DOM, no network, so any page and any test can load it.

/**
 * A course percent for display. The database states it as text: exact when it ends within six decimals, else cut at six with a
 * trailing ellipsis ("33.333333…"). That is the right thing to STORE and a poor thing to show, so a page prints it through
 * here: one decimal at most, half up, trailing zeros dropped. A value that sits just under a whole number is cut rather than rounded
 * (89.999999… shows 89.9, never 90), because the cadet's letter comes from the full value and a rounded 90 could sit beside a B.
 * Display only: nothing is computed from the result. Text that is not a number comes back as it was.
 */
export function percentShown(text, places = 1) {
  if (text == null || String(text).trim() === '') return '';
  const s = String(text).trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?\s*(…|\.\.\.)?$/.exec(s);
  if (!m) return s;
  const [, sign, int, frac = '', cut] = m;
  if (frac.length <= places) return cut ? s.replace(/\s*(…|\.\.\.)$/, '') : s;
  const kept = frac.slice(0, places);
  const up = frac[places] >= '5';
  const trim = (i, f) => (/^0*$/.test(f) ? i : `${i}.${f.replace(/0+$/, '')}`);
  const scaled = BigInt(int + kept) + (up ? 1n : 0n);
  const digits = scaled.toString().padStart(places + 1, '0');
  const rounded = trim(digits.slice(0, digits.length - places), digits.slice(digits.length - places));
  if (up && !rounded.includes('.') && /[1-9]/.test(frac)) return sign + trim(int, kept);   // just under a whole number
  return sign + rounded;
}
