// block_network.mjs -- preloaded (node --import) by run_offline_suites.py.
//
// The suites listed as offline are meant to touch no network. This makes that a checked
// property instead of a reading of the code: any fetch, socket connect or DNS lookup is refused
// and appended to the file named by CI_NET_LOG, and the runner fails the suite if that file is
// non-empty. Only the host is logged, never a header, key or body.
import net from 'node:net';
import dns from 'node:dns';
import { appendFileSync } from 'node:fs';

const note = (kind, what) => {
  try { appendFileSync(process.env.CI_NET_LOG, `${kind} ${what}\n`); } catch { /* log is best effort */ }
};
const hostOf = (u) => { try { return new URL(String((u && u.url) || u)).host; } catch { return 'unparsed'; } };

globalThis.fetch = async (u) => { note('fetch', hostOf(u)); throw new TypeError('network blocked in CI'); };
net.Socket.prototype.connect = function (...a) {
  note('socket', String((a[0] && (a[0].host || a[0].port)) || 'unknown'));
  throw new Error('network blocked in CI');
};
dns.lookup = (host, ...rest) => { note('dns', host); rest.pop()(new Error('network blocked in CI')); };
