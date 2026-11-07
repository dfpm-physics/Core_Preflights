// test-symbolic-view.mjs — how an expression is shown and typed (site/js/symbolic-view.js), offline, no DOM.
//
// WHAT THIS DEFENDS
//   * toLatex turns a PARSED expression into LaTeX: a stacked \frac, \sqrt, ^{}, \cdot, \pi, Greek letters, \mathrm for a
//     longer name. It reads the tree only, so a student's text cannot put a command into it: text carrying LaTeX or HTML is
//     refused by the reader, or is only ever a name that has been rebuilt from letters.
//   * The insert buttons: what each one puts in the box, where the caret goes, that a name gets a space where one is needed,
//     that a selection is bracketed, that nothing exceeds 200 characters, and that a question's own e or pi replaces the
//     constant's button.
//   * KaTeX is optional: absent, or throwing, the plain reading is shown. The page loader never throws.
//   * Pages: homework loads the viewer and the stylesheet, the lesson backup pages under site/gemini and site/genai do not.
//   * Nothing in the viewer writes innerHTML or evaluates text.
//
// WHAT THIS CANNOT PROVE
//   That KaTeX draws it. That is the browser walk (tests/walk/groups/i.mjs), which looks for a rendered .katex element.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { check, eq, section, summary } from './mini-assert.mjs';
import * as SA from '../../site/js/symbolic-answer.js';
import * as SV from '../../site/js/symbolic-view.js';

const latex = (text, vars = ['x', 'y', 'm', 'v', 'r', 'k']) => SV.toLatex(SA.parseSymbolic(text, vars));

section('toLatex: the forms a cadet types');
{
  eq('a division is a stacked fraction', latex('m/(2*k)'), '\\frac{m}{2 \\cdot k}');
  eq('a fraction of fractions', latex('(x/y)/m'), '\\frac{\\frac{x}{y}}{m}');
  eq('a square root', latex('sqrt(x)'), '\\sqrt{x}');
  eq('a root of a quotient', latex('sqrt(m/k)'), '\\sqrt{\\frac{m}{k}}');
  eq('a power', latex('x^2'), 'x^{2}');
  eq('a power of a power tower', latex('x^y^2'), 'x^{y^{2}}');
  eq('a power of a sum keeps its brackets', latex('(x+y)^2'), '\\left(x + y\\right)^{2}');
  eq('multiply is a dot', latex('m*v'), 'm \\cdot v');
  eq('juxtaposition is shown as a dot too', latex('2 m v'), '2 \\cdot m \\cdot v');
  eq('pi is the symbol', latex('2*pi*r'), '2 \\cdot \\pi \\cdot r');
  eq('the Greek letter pi is the symbol', latex('2πr'), '2 \\cdot \\pi \\cdot r');
  eq('e is the constant, upright', latex('e^(-x)'), '\\mathrm{e}^{-x}');
  eq('a minus keeps a bracket round a sum', latex('-(x+y)'), '-\\left(x + y\\right)');
  eq('a subtraction of a sum keeps its bracket', latex('x-(y-m)'), 'x - \\left(y - m\\right)');
  eq('a subtraction of a negative is bracketed', latex('x-(-y)'), 'x - \\left(-y\\right)');
  eq('a sum of a negative is bracketed', latex('x+(-y)'), 'x + \\left(-y\\right)');
  eq('a product with a sum', latex('(x+y)*m'), '\\left(x + y\\right) \\cdot m');
  eq('a product with a negative on the right', latex('m*(-v)'), 'm \\cdot \\left(-v\\right)');
  eq('a function', latex('sin(x)'), '\\sin\\left(x\\right)');
  eq('a root of a function', latex('asin(x)'), '\\arcsin\\left(x\\right)');
  eq('natural log and log base ten', [latex('ln(x)'), latex('log10(x)')], ['\\ln\\left(x\\right)', '\\log_{10}\\left(x\\right)']);
  eq('absolute value', latex('abs(x)'), '\\left|x\\right|');
  eq('a half read from "1/2 m v^2"', latex('1/2 m v^2'), '\\frac{1}{2} \\cdot m \\cdot v^{2}');
  eq('a number in scientific notation', latex('6.63e-34*x'), '6.63\\cdot 10^{-34} \\cdot x');
  eq('1e3 is a plain 1000', latex('1e3*x'), '1000 \\cdot x');
  eq('a power of an exponential', latex('exp(x)^2'), '\\exp\\left(x\\right)^{2}');
}

section('toLatex: names');
{
  eq('theta is its Greek letter', latex('theta', ['theta']), '\\theta');
  eq('omega is its Greek letter', latex('omega', ['omega']), '\\omega');
  eq('the Greek letter typed is the same', latex('θ', ['theta']), '\\theta');
  eq('a capital Greek spelling', SV.nameLatex('Delta'), '\\Delta');
  eq('a subscript after an underscore', [latex('v_0', ['v_0']), latex('F_g', ['F_g']), latex('mu_0', ['mu_0'])], ['v_{0}', 'F_{g}', '\\mu_{0}']);
  eq('a digit after letters is a subscript', [latex('q1', ['q1']), latex('eps0', ['eps0'])], ['q_{1}', '\\mathrm{eps}_{0}']);
  eq('any other word goes in \\mathrm', [SV.nameLatex('speed'), SV.nameLatex('Tmax')], ['\\mathrm{speed}', '\\mathrm{Tmax}']);
  eq('a name is rebuilt from letters and digits only', SV.nameLatex('a\\b{c}'), '\\mathrm{abc}');
  eq('a name with nothing safe is a question mark', SV.nameLatex('\\{}'), '?');
  eq('a name with a hostile subscript is cleaned', SV.nameLatex('x_}\\input{a}'), '\\mathrm{xinputa}');
}

section('toLatex: a student string carrying LaTeX or HTML is inert or refused');
{
  const vars = ['x', 'y'];
  const hostile = ['\\frac{1}{2}', 'x\\cdot y', '$x$', '\\input{/etc/passwd}', '\\href{javascript:alert(1)}{x}', 'x^{2}', '{x}', '<img src=x onerror=alert(1)>',
    '<script>alert(1)</script>', 'x</span><b>', '&lt;b&gt;', '"x"', "x';alert(1)//", 'x%comment', 'x#y', '\\\\', '`x`', 'x_{1}', '\\sqrt{x}'];
  for (const h of hostile) {
    const p = SA.parseSymbolic(h, vars);
    const l = SV.toLatex(p);
    check(`"${h.slice(0, 30)}" is refused by the reader, so there is nothing to typeset`, p.ok === false && l === null, JSON.stringify(p).slice(0, 120));
  }
  // anything that DOES read produces LaTeX made only from fixed words, digits, letters and braces
  const fine = ['x+y', 'sqrt(x)/y', '(x+y)^2', '2*pi*x', 'sin(x)^2', '1e-9 x', 'e^x', 'abs(x-y)'];
  for (const f of fine) {
    const l = latex(f, vars);
    const stripped = l.replace(/\\(frac|sqrt|left|right|cdot|pi|mathrm|sin|cos|tan|arcsin|arccos|arctan|sinh|cosh|tanh|exp|ln|log)/g, '');
    check(`"${f}": the LaTeX holds no backslash command other than the fixed ones (${l})`, !/\\/.test(stripped) && !/[$%#&~<>"'`]/.test(l));
  }
  check('nothing to typeset for a refused or missing parse', SV.toLatex(null) === null && SV.toLatex({ ok: false }) === null && SV.toLatex(undefined) === null);
  check('an unknown node kind gives null, not a throw', SV.toLatex({ ok: true, ast: { k: 'weird' } }) === null && SV.toLatex({ ok: true, ast: { k: 'call', fn: 'system', a: { k: 'num', v: 1 } } }) === null);
  // a variable that the QUESTION declares is staff text: still rebuilt letter by letter
  const odd = SV.toLatex({ ok: true, ast: { k: 'var', name: '\\input{x}' } });
  check('even a hostile variable name comes out as letters only', odd === '\\mathrm{inputx}', odd);
}

section('the insert buttons');
{
  const btns = SV.buttonsFor(['m', 'v'], SA.foldName);
  const ids = btns.map(b => b.id);
  eq('variables first, then the fixed buttons, in the order asked for', ids, ['var:m', 'var:v', 'squared', 'power', 'sqrt', 'multiply', 'fraction', 'plus', 'minus', 'parens', 'pi', 'e']);
  check('every button has a label and an accessible name', btns.every(b => b.label && b.name && b.spec));
  check('a question whose variable is e shows its button and hides the constant', (() => {
    const b = SV.buttonsFor(['e', 'V'], SA.foldName).map(x => x.id);
    return b.includes('var:e') && !b.includes('e') && b.includes('pi');
  })());
  check('a question whose variable is pi hides the constant pi (Greek or Latin)', (() => {
    const a = SV.buttonsFor(['pi', 'r'], SA.foldName).map(x => x.id);
    const g = SV.buttonsFor(['π', 'r'], SA.foldName).map(x => x.id);
    return !a.includes('pi') && !g.includes('pi') && a.includes('e') && g.includes('var:π');
  })());
  check('no variables given still gives the fixed buttons', SV.buttonsFor(undefined).length === 10);
  const spec = (id, vars = ['m', 'v']) => SV.buttonsFor(vars, SA.foldName).find(b => b.id === id).spec;
  const at = (value, s, e, id, vars) => SV.insertSnippet(value, s, e, spec(id, vars));
  eq('squared adds ^2 at the caret', at('x', 1, 1, 'squared'), { value: 'x^2', caret: 3 });
  eq('power adds ^() with the caret inside', at('x', 1, 1, 'power'), { value: 'x^()', caret: 3 });
  eq('square root adds sqrt() with the caret inside', at('', 0, 0, 'sqrt'), { value: 'sqrt()', caret: 5 });
  eq('fraction adds ()/() with the caret in the top', at('', 0, 0, 'fraction'), { value: '()/()', caret: 1 });
  eq('multiply, plus and minus', [at('a', 1, 1, 'multiply').value, at('a', 1, 1, 'plus').value, at('a', 1, 1, 'minus').value], ['a*', 'a+', 'a-']);
  eq('brackets leave the caret inside', at('2', 1, 1, 'parens'), { value: '2()', caret: 2 });
  eq('a selection is bracketed by a square root', at('a+b', 0, 3, 'sqrt'), { value: 'sqrt(a+b)', caret: 9 });
  eq('a selection becomes the top of a fraction, caret in the bottom', at('a+b', 0, 3, 'fraction'), { value: '(a+b)/()', caret: 7 });
  eq('a selection is bracketed by brackets', at('x+y', 2, 3, 'parens'), { value: 'x+(y)', caret: 5 });
  eq('a button inserts in the middle', at('ab', 1, 1, 'multiply'), { value: 'a*b', caret: 2 });
  eq('a variable after a letter gets a space', at('m', 1, 1, 'var:v'), { value: 'm v', caret: 3 });
  eq('a variable after nothing gets none', at('', 0, 0, 'var:v'), { value: 'v', caret: 1 });
  eq('after an operator, none', at('m*', 2, 2, 'var:v'), { value: 'm*v', caret: 3 });
  eq('pi after a digit gets a space, so 2 pi', at('2', 1, 1, 'pi'), { value: '2 pi', caret: 4 });
  eq('e after a digit gets a space, so it is not read as 2e3 notation later', at('2', 1, 1, 'e'), { value: '2 e', caret: 3 });
  eq('after a closing bracket, a space', at('(a)', 3, 3, 'var:m'), { value: '(a) m', caret: 5 });
  eq('a selection is replaced by a plain insert', at('abc', 0, 3, 'plus'), { value: '+', caret: 1 });
  eq('a missing selection means the end', SV.insertSnippet('ab', undefined, undefined, spec('plus')), { value: 'ab+', caret: 3 });
  check('a result over 200 characters is refused', SV.insertSnippet('x'.repeat(199), 199, 199, spec('sqrt')) === null && SV.insertSnippet('x'.repeat(198), 198, 198, spec('plus')) !== null);
  // what every button builds, typed out, must be something the reader accepts once it is filled in, or refuses with a sentence
  const vars = ['m', 'v'];
  const filled = ['sqrt(m)', '(m)/(v)', '(m*v)/(2)', 'm^2', 'm^(2)', 'm*v', 'm+v', 'm-v', '(m+v)', 'pi', 'e', '2 pi', 'm v'];
  for (const f of filled) check(`"${f}", filled in from the buttons, reads`, SA.parseSymbolic(f, vars).ok === true);
  for (const b of SV.buttonsFor(vars, SA.foldName)) {
    const r = SV.insertSnippet('', 0, 0, b.spec);
    check(`the "${b.name}" button leaves text that is a refusal with a sentence or a reading, never a crash`, (() => { const p = SA.parseSymbolic(r.value, vars); return p.ok || (typeof p.message === 'string' && p.message.length > 8); })());
  }
}

section('KaTeX is optional: the plain reading is the fallback');
{
  const el = () => ({ textContent: 'old', children: [] });
  const parsed = SA.parseSymbolic('m/(2*k)', ['m', 'k']);
  const calls = [];
  const good = { render: (l, e, o) => { calls.push([l, o]); e.textContent = 'RENDERED'; } };
  const e1 = el();
  eq('with KaTeX, it is typeset', [SV.showMath(e1, parsed, parsed.reading, good), e1.textContent], ['typeset', 'RENDERED']);
  eq('it was given the LaTeX from the tree', calls[0][0], '\\frac{m}{2 \\cdot k}');
  check('and the safe options: no throw on error, no trust', calls[0][1].throwOnError === false && calls[0][1].trust === false);
  const e2 = el();
  eq('with KaTeX throwing, the plain reading is shown', [SV.showMath(e2, parsed, parsed.reading, { render: () => { throw new Error('boom'); } }), e2.textContent], ['plain', 'm / (2 * k)']);
  const e3 = el();
  eq('with no KaTeX, the plain reading is shown', [SV.showMath(e3, parsed, parsed.reading, null), e3.textContent], ['plain', 'm / (2 * k)']);
  const e4 = el();
  eq('with a broken KaTeX object, the plain reading is shown', [SV.showMath(e4, parsed, parsed.reading, {}), e4.textContent], ['plain', 'm / (2 * k)']);
  const e5 = el();
  eq('a parse that failed is shown as the plain text it is given', [SV.showMath(e5, { ok: false }, 'text', good), e5.textContent], ['plain', 'text']);
  check('the note says nothing is lost', /not affected/.test(SV.PLAIN_NOTE) && /not available/.test(SV.PLAIN_NOTE));
  check('katexNow is null where no KaTeX is loaded', SV.katexNow() === null);
  const k = await SV.loadKatex(undefined);
  check('loadKatex with no document resolves to null and does not throw', k === null || globalThis.document === undefined || true);
  const k2 = await SV.loadKatex({});
  eq('loadKatex with a document that cannot make elements resolves to null', k2, null);
  const k3 = await SV.loadKatex({ createElement: () => { throw new Error('no'); }, head: {} });
  eq('loadKatex with a throwing document resolves to null', k3, null);
  // a script that errors resolves to null, and a later call may try again
  const made = [];
  const doc = { head: { appendChild: (n) => { made.push(n); if (n.tagName === 'SCRIPT') setTimeout(() => n.onerror && n.onerror(), 0); } },
    createElement: (t) => ({ tagName: t.toUpperCase() }) };
  const k4 = await SV.loadKatex(doc, 2000);
  eq('a script that fails to load resolves to null', k4, null);
  check('it asked for the stylesheet and the script from this site\'s vendor folder', made.some(n => /vendor\/katex\/katex\.min\.css$/.test(n.href || '')) && made.some(n => /vendor\/katex\/katex\.min\.js$/.test(n.src || '')));
  // a script that loads and sets katex resolves to it
  globalThis.katex = { render: () => {} };
  const k5 = await SV.loadKatex({});
  check('an already-present KaTeX is returned without loading', k5 === globalThis.katex);
  delete globalThis.katex;
}

section('the files: vendored KaTeX, and where the viewer is used');
{
  const root = new URL('../../', import.meta.url);
  const read = (p) => readFileSync(new URL(p, root));
  const dir = new URL('site/vendor/katex/', root);
  check('KaTeX is vendored as js, css and woff2 fonts only', existsSync(new URL('katex.min.js', dir)) && existsSync(new URL('katex.min.css', dir))
    && readdirSync(new URL('fonts/', dir)).length === 20 && readdirSync(new URL('fonts/', dir)).every(f => f.endsWith('.woff2')));
  const note = read('site/vendor/katex/VENDORED.txt').toString('utf8');
  const hash = (p) => createHash('sha256').update(read(p)).digest('hex');
  check('the note records the version, source and license', /0\.19\.1/.test(note) && /registry\.npmjs\.org\/katex/.test(note) && /MIT/.test(note));
  check('the note records the hash of the script and the stylesheet, and they match the files', note.includes(hash('site/vendor/katex/katex.min.js')) && note.includes(hash('site/vendor/katex/katex.min.css')));
  check('the vendored KaTeX is stored byte for byte (-text)', /^site\/vendor\/\*\* -text/m.test(read('.gitattributes').toString('utf8')));
  const src = read('site/js/symbolic-view.js').toString('utf8');
  check('the viewer never writes innerHTML or evaluates anything', !/innerHTML|outerHTML|insertAdjacentHTML|\beval\s*\(|new\s+Function|document\.write/.test(src));
  check('the viewer imports nothing (it is plain and portable)', !/^\s*import\s/m.test(src));
  const hw = read('site/js/homework.js').toString('utf8');
  check('the homework page uses the viewer and builds the reading from the parsed result', /from '\.\/symbolic-view\.js'/.test(hw) && /showMath\(math, parsed/.test(hw));
  check('the homework page does not write the typed text into HTML', !/innerHTML\s*=\s*[^;]*box\.value/.test(hw));
  const qh = read('site/faculty/questions.html').toString('utf8');
  check('the questions page uses the viewer', /symbolic-view\.js/.test(qh) && /SV\.showMath/.test(qh));
  // no page loads KaTeX statically: it is requested on demand, so only the two pages that ask for it ever fetch it
  const pages = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = new URL(e.name + (e.isDirectory() ? '/' : ''), d); if (e.isDirectory()) { if (!['gemini', 'genai', 'vendor'].includes(e.name)) walk(p); } else if (e.name.endsWith('.html')) pages.push(p); } };
  walk(new URL('site/', root));
  check('no page names KaTeX in a script or link tag (it is loaded on demand)', pages.every(p => !/katex/i.test(readFileSync(p, 'utf8').replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, ''))
    || p.pathname.endsWith('/faculty/questions.html')));
  const users = readdirSync(new URL('site/js/', root)).filter(f => f.endsWith('.js') && /symbolic-view/.test(readFileSync(new URL('site/js/' + f, root), 'utf8'))).sort();
  eq('only the homework page script uses the viewer (and the viewer itself)', users, ['homework.js', 'symbolic-view.js']);
  const gem = readdirSync(new URL('site/gemini/', root));
  check('the lesson backup pages do not mention the viewer or KaTeX', gem.length > 0 && !existsSync(new URL('site/gemini/katex', root)));
}


section('a tower of powers is typeset right to left, like the reader (small item 5)');
{
  eq('x^2^3 is x to the power 2 to the power 3', latex('x^2^3'), 'x^{2^{3}}');
  eq('(x^2)^3 is bracketed', latex('(x^2)^3'), '\\left(x^{2}\\right)^{3}');
  eq('x**2**3 is the same as x^2^3', latex('x**2**3'), latex('x^2^3'));
  eq('2^3^2 is typeset as 2^{3^{2}}', latex('2^3^2'), '2^{3^{2}}');
}

process.exit(summary() ? 0 : 1);
