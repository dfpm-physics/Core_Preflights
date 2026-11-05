// safe-next.js — choose where to go after sign-in from a `?next=` value.
//
// Only a path on this site is accepted. Anything else returns the fallback. A path is refused when it starts with two
// slashes or a slash and a backslash (browsers read both as another host), holds a backslash or a control character
// (browsers drop tabs and line breaks inside a URL, so "/<tab>/host" becomes "//host"), or resolves to another origin.
export function safeNext(raw, fallback = 'index.html') {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2000) return fallback;
  if (raw[0] !== '/' || raw[1] === '/' || raw[1] === '\\') return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;
  try {
    const base = 'https://site.invalid';
    if (new URL(raw, base).origin !== base) return fallback;
  } catch {
    return fallback;
  }
  return raw;
}
