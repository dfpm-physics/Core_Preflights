// target.mjs — which database the live suites may talk to. Exactly one answer: staging.
//
// The rule is fail-closed. A URL is accepted only when it is EXACTLY the staging project's
// address; anything else (the production address, a typo, an empty string, a lookalike host, a
// URL that merely contains the staging ref) is refused. Nothing here asks "is this production?"
// because that question has to enumerate every wrong answer; this asks "is this staging?".
//
// The refs are written here on purpose and are checked against site/js/config.js by
// test-target-guard.mjs, so a drift between the two is reported.

export const STAGING_REF = 'wkibeptktbnaddfynrwr';
export const PRODUCTION_REF = 'shzvpmlnqfmzfmuxkowi';
export const STAGING_URL = `https://${STAGING_REF}.supabase.co`;

/** Throws unless `url` is exactly the staging project's API address. Returns it unchanged. */
export function assertStagingUrl(url, what = 'Supabase URL') {
  if (typeof url !== 'string' || url !== STAGING_URL) {
    throw new Error(
      `REFUSED: ${what} is not the staging project. The live test suites only run against `
      + `${STAGING_URL}.`);
  }
  return url;
}

/**
 * Throws unless a Postgres connection string names the staging project and nothing else.
 * Same rule as scripts/staging/db_target.py: a URL this reader does not fully understand is refused.
 */
export function assertStagingDbUrl(url, what = 'database URL') {
  const ref = dbUrlRef(url);
  if (ref !== STAGING_REF) {
    throw new Error(`REFUSED: ${what} does not name the staging project (${STAGING_REF}).`);
  }
  return ref;
}

/**
 * The project ref named by a connection string, or null when the URL is refused. Strict on
 * purpose: a percent escape in the user or host, more than one '@', any query key but sslmode,
 * an empty host, an upper-case ref, a host that is not `<name>.pooler.supabase.com` or exactly
 * `db.<ref>.supabase.co` (lower case, no trailing dot), or a user and host that name different
 * projects all give null.
 */
export function dbUrlRef(url) {
  if (typeof url !== 'string' || !url || /\s/.test(url) || url.includes('#')) return null;
  const m = /^postgres(?:ql)?:\/\/([^/?]*)(\/[^?]*)?(?:\?(.*))?$/.exec(url);
  if (!m) return null;
  const [, authority, path = '', query] = m;
  if (query) for (const pair of query.split('&')) if (pair.split('=')[0] !== 'sslmode') return null;
  if (authority.split('@').length > 2) return null;
  const at = authority.lastIndexOf('@');
  const userinfo = at >= 0 ? authority.slice(0, at) : '';
  const hostport = at >= 0 ? authority.slice(at + 1) : authority;
  const user = userinfo.split(':')[0];
  if (user.includes('%') || hostport.includes('%')) return null;
  if (/[\[\],]/.test(hostport) || hostport.split(':').length > 2) return null;
  const [host, port] = hostport.split(':');
  if (!host || (port !== undefined && !/^[0-9]{1,5}$/.test(port))) return null;
  if (!/^[A-Za-z0-9_.-]*$/.test(path.slice(1))) return null;
  const refs = new Set();
  const um = /^postgres\.([A-Za-z0-9]+)$/.exec(user);
  if (um) {
    if (um[1] !== um[1].toLowerCase()) return null;
    refs.add(um[1]);
  }
  const hm = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(host);
  if (hm) refs.add(hm[1]);
  else if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.pooler\.supabase\.com$/.test(host)) return null;
  return refs.size === 1 ? [...refs][0] : null;
}
