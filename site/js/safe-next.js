// safe-next.js — choose where to go after sign-in from a `?next=` value.
//
// Only a path on this site is accepted. Anything else returns the fallback. A path is refused when it starts with two
// slashes or a slash and a backslash (browsers read both as another host), holds a backslash or a control character
// (browsers drop tabs and line breaks inside a URL, so "/<tab>/host" becomes "//host"), or resolves to another origin.
// The path must also sit under this site's own path (everything up to and including "/site/" in the current address,
// or the `root` argument), so another page on the same host is not a destination. A long link (a prefilled form) is
// kept up to 8000 characters.
const siteRootOf = () => {
  const p = globalThis.location?.pathname;
  const i = typeof p === 'string' ? p.indexOf('/site/') : -1;
  return i < 0 ? '' : p.slice(0, i + 6);
};
export function safeNext(raw, fallback = 'index.html', root = siteRootOf()) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 8000) return fallback;
  if (root && !raw.startsWith(root)) return fallback;
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
