// test-safe-next.mjs — the page that follows sign-in only goes to a path on this site.
//
// WHAT THIS DEFENDS: the `?next=` value after sign-in. WHAT IT CANNOT PROVE: how a given browser parses an address;
// the cases are the ones the standard says are read as another host.
import { check, eq, section, summary, readRepoFile } from './harness.mjs';
import { safeNext } from '../../site/js/safe-next.js';

section('paths on this site are kept');
for (const ok of ['/', '/Core_Preflights/site/student/dashboard.html', '/site/faculty/grade.html?course=phys-215&x=1#top']) {
  eq(`kept: ${ok}`, safeNext(ok), ok);
}

section('anything that can leave the site falls back');
const bad = ['//evil.example', '/\\evil.example', '\\\\evil.example', '/\t/evil.example', '/\n/evil.example', '/\r/evil.example',
  '/a\\b', 'https://evil.example', 'javascript:alert(1)', 'data:text/html,x', 'evil.example', '', null, undefined, 42,
  '/\u0000/x', '/' + 'a'.repeat(9000)];
for (const b of bad) eq(`refused: ${JSON.stringify(b)?.slice(0, 40)}`, safeNext(b), 'index.html');
eq('the fallback can be set', safeNext('//x', 'login.html'), 'login.html');

section('a long prefilled link is kept; another page of the same host is not');
const longLink = '/Core_Preflights/site/faculty/lessons.html?new=1&desc=' + 'a%20b'.repeat(500);
check('a 2500-character link is kept', longLink.length > 2000 && safeNext(longLink) === longLink, String(longLink.length));
const root = '/Core_Preflights/site/';
eq('under the root: kept', safeNext('/Core_Preflights/site/student/dashboard.html', 'index.html', root), '/Core_Preflights/site/student/dashboard.html');
eq('another repository on the same host: refused', safeNext('/other-repo/', 'index.html', root), 'index.html');
eq('the host root: refused', safeNext('/', 'index.html', root), 'index.html');
eq('a sibling that only shares the start of the name: refused', safeNext('/Core_Preflights/site-x/a.html', 'index.html', root), 'index.html');
eq('no root known (outside a browser): any path of the origin', safeNext('/other-repo/'), '/other-repo/');
globalThis.location = { pathname: '/Core_Preflights/site/login.html' };
eq('the root is read from the address the page is served at: another repository is refused', safeNext('/other-repo/'), 'index.html');
eq('and this site is kept', safeNext('/Core_Preflights/site/faculty/grade.html'), '/Core_Preflights/site/faculty/grade.html');
delete globalThis.location;

section('the login page uses it');
const html = readRepoFile('site/login.html');
check('login.html imports safeNext from the module', /import \{ safeNext \} from '\.\/js\/safe-next\.js'/.test(html));
check('login.html no longer carries its own check', !/n\.startsWith\('\/'\)/.test(html));

summary();
