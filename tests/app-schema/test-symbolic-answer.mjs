// test-symbolic-answer.mjs — the symbolic answer reader and checker (site/js/symbolic-answer.js).
//
// WHAT THIS DEFENDS
//   * An answer that is the same expression written another way is right: expanded, factored, reordered, with
//     implicit multiplication, with ** or a superscript for a power, with a different spelling of a function.
//   * An answer that is a different expression is wrong, including near misses: a sign, a power, a missing factor,
//     a term that is nearly zero at some points, a form that agrees at one or two points only (false matches from
//     random testing: the points are fixed per question, there are many, and they cover both signs).
//   * An answer that cannot be read is REFUSED with a plain sentence and is never marked wrong: unknown variable,
//     unbalanced bracket, an equals sign, a function without brackets, a division followed by implicit multiplication
//     (unclear), a character that is not part of the grammar, an answer too long or nested too deep.
//   * Nothing is ever executed: no eval, no Function. A hostile answer cannot hang the checker.
//   * Division by zero and very large values are decided, not crashed on. An answer undefined where the key is
//     defined is wrong; a key undefined everywhere is the QUESTION's fault, not the student's.
//   * A key that does not parse, uses a variable that is not allowed, or is empty is a key fault: nothing is marked.
//   * The same points are used every time, so a re-mark gives the same result.
//
// WHAT THIS CANNOT PROVE
//   That the edge function carries the same file (test-check-answer-function.mjs), or that the database stores the key.
//   It proves two expressions agree at the test points, not that one is simplified.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { check as check0, eq as eq0, section, summary } from './mini-assert.mjs';
const esc = (s) => String(s).replace(/[^\x00-\x7f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const check = (d, ...r) => check0(esc(d), ...r);
const eq = (d, ...r) => eq0(esc(d), ...r);

const here = new URL('.', import.meta.url);
const target = process.env.SA_MODULE ? pathToFileURL(resolve(process.env.SA_MODULE)).href
  : new URL('../../site/js/symbolic-answer.js', here).href;
const S = await import(target);

// Most of the older cases were written when every variable was tested at both signs, so these helpers mark every variable
// as able to be negative unless a case says otherwise (pass `signed`: [] for the default, positive values only).
const same = (key, vars, answers, signed = vars) => answers.map(a => [a, S.checkSymbolic(a, key, vars, signed)]);
function expectRight(key, vars, answers, label = key, signed = vars) {
  for (const [a, r] of same(key, vars, answers, signed)) check(`${label}: "${a}" is right`, r.ok && r.correct === true, JSON.stringify(r));
}
function expectWrong(key, vars, answers, label = key, signed = vars) {
  for (const [a, r] of same(key, vars, answers, signed)) check(`${label}: "${a}" is wrong, not refused`, r.ok && r.correct === false, JSON.stringify(r));
}
function expectRefused(key, vars, answers, code, label = key, signed = vars) {
  for (const [a, r] of same(key, vars, answers, signed)) {
    check(`${label}: "${String(a).slice(0, 40)}" is refused${code ? ` (${code})` : ''}, not marked`, r.ok === false && !r.keyFault && (!code || r.code === code)
      && typeof r.message === 'string' && r.message.length > 8 && !('correct' in r), JSON.stringify(r).slice(0, 200));
  }
}

section('equivalent forms are right');
expectRight('m*v^2/2', ['m', 'v'], ['m*v^2/2', '(1/2)*m*v^2', '0.5 m v^2', '0.5*m*v**2', 'm v^2 / 2', 'v^2*m/2', 'm*(v*v)/2', '(m v^2)/2', 'm*v²/2', '1/2*m*v^2', 'm*v^2*0.5', '(m/2)*v^2', '(v^2)(m)/2', 'v*m*v/2']);
expectRight('(x+1)^2', ['x'], ['x^2+2x+1', '1+2*x+x^2', '(1+x)(1+x)', '(x+1)*(x+1)', 'x*x+2*x+1', '(x+1)**2', 'x^2 + 2 x + 1']);
expectRight('x^2 - y^2', ['x', 'y'], ['(x-y)(x+y)', '(x+y)*(x-y)', '-(y^2) + x^2', 'x^2-y*y', '-y^2+x^2']);
expectRight('sin(x)^2 + cos(x)^2', ['x'], ['1', '1.0', 'cos(x)^2+sin(x)^2', '2 - 1']);
expectRight('1/(1/a + 1/b)', ['a', 'b'], ['a*b/(a+b)', '(a b)/(a+b)', '1/((a+b)/(a*b))']);
expectRight('exp(-t/tau)', ['t', 'tau'], ['e^(-t/tau)', 'exp(-1*t/tau)', 'e^-(t/tau)', '1/exp(t/tau)', 'e^(-(t)/(tau))']);
expectRight('sqrt(x)', ['x'], ['x^0.5', 'x^(1/2)', 'sqrt(x)*1']);
expectRight('2*pi*r', ['r'], ['2 pi r', '2πr', 'pi*2*r', 'r*pi*2', '6.283185307179586*r']);
expectWrong('ln(x*y)', ['x', 'y'], ['ln(x)+ln(y)']);   // the key is defined when x and y are both negative; ln(x)+ln(y) is not, so they are different functions
expectRight('v0*t + a*t^2/2', ['v0', 't', 'a'], ['v0 t + a t^2/2', 'a*t^2/2 + v0*t', 't*(v0 + a*t/2)']);
expectRight('x', ['x'], ['+x', '--x', '(((x)))', '  x  ', 'x*1', 'x/1', 'x+0', '−(−x)']);
expectRight('3', ['x'], ['3', '3.0', '6/2', '1+2', '3e0', '0.3e1', 'x-x+3']);
expectRight('-x^2', ['x'], ['-(x^2)', '-1*x^2', '0-x*x', '-x**2']);
expectRight('x^-2', ['x'], ['1/x^2', 'x^(-2)', '(1/x)^2', '1/(x*x)']);
expectRight('abs(x)', ['x'], ['sqrt(x^2)', 'abs(-x)', 'abs(x)*1']);
expectRight('x y', ['x', 'y'], ['xy', 'x*y', 'y x', 'yx', 'y*x']);                     // adjacent variable names split when only one split exists
expectRight('F_g*r', ['F_g', 'r'], ['F_g r', 'r*F_g']);
expectRight('q1*q2/(4*pi*eps0*r^2)', ['q1', 'q2', 'eps0', 'r'], ['q1 q2/(4 pi eps0 r^2)', 'q1*q2/(4*π*eps0*r**2)', 'q2*q1/(r^2*eps0*pi*4)']);
expectRight('θ', ['θ'], ['θ', 'θ*1']);
expectRight('tan(x)', ['x'], ['sin(x)/cos(x)']);
expectRight('cosh(x)', ['x'], ['(exp(x)+exp(-x))/2']);

section('different expressions are wrong');
expectWrong('m*v^2/2', ['m', 'v'], ['m*v/2', 'm*v^2', 'm*v^2/4', '(m*v)^2/2', 'm^2*v/2', '-m*v^2/2', 'm*v^3/2', 'v^2/2', 'm/2', '0', '1', 'm+v^2/2', 'm*v^2/2+1', 'm*v^2/2 + 0.001', 'm*v^2/2*1.0001']);
expectWrong('(x+1)^2', ['x'], ['x^2+1', 'x^2+2x', 'x^2-2x+1', '(x-1)^2', 'x^2+2x+2', 'x^2+x+1', '(x+1)^3', '2x+1', 'x^2+2x+1.000001']);
expectWrong('x^2 - y^2', ['x', 'y'], ['(x-y)^2', '(x+y)^2', 'x^2+y^2', 'y^2-x^2', 'x^2-y', 'x-y']);
expectWrong('sin(x)', ['x'], ['x', 'cos(x)', 'tan(x)', 'sin(2x)', 'x - x^3/6', '-sin(x)', 'sin(x)+1e-5', 'sin(x)*(1+1e-6)']);
expectWrong('abs(x)', ['x'], ['x', '-x', 'x^2', 'sqrt(x)', 'x*abs(x)']);
expectWrong('x', ['x', 'y'], ['y', 'x+y', 'x*y', 'x/y', 'x+1e-4*y']);
expectWrong('1/x', ['x'], ['x', '-1/x', '1/x^2', '1/(x+1)', '1/x + 1/1000']);
expectWrong('sqrt(x)', ['x'], ['x', 'x^2', 'x^(1/3)']);
expectRight('sqrt(x)', ['x'], ['sqrt(abs(x))'], 'where the key is undefined the point is not used, so this agrees everywhere the key exists');
expectWrong('exp(-t/tau)', ['t', 'tau'], ['exp(t/tau)', 'exp(-t)/tau', 'exp(-t*tau)', '1-exp(-t/tau)', 'exp(-2t/tau)']);

section('false matches: forms that agree at some points but not at the fixed test points');
// A fixed small set of points would be fooled by these; the checker draws a dozen or more points of both signs.
expectWrong('x', ['x'], ['x + sin(pi*x)*0.01', 'x*(1+0.01*cos(10*x))', 'x + 0.01*(x-1)*(x-2)*(x+1)', 'x + (x-0.5)*(x-1)*(x-2)*(x-3)*1e-3', 'x + sin(100*x)/100']);
expectWrong('x^2', ['x'], ['x*abs(x)', 'x^2 + x*(x-1)*(x+1)*0.01', '(x^4)^0.5 + 1e-4']);
expectWrong('0', ['x'], ['sin(x)', 'x', 'x^2*1e-3', '1e-6*x', 'sin(x)^2 + cos(x)^2 - 1 + 1e-6']);
expectWrong('x', ['x'], ['x + 1e-7', 'x*(1 + 1e-7)']);       // the tolerance is relative 1e-9, so a part in 10^7 is seen
{
  // Random testing must not depend on luck: the same question gives the same points, and re-checking gives the same answer.
  const a = S.testPoints(['x', 'y'], ['x', 'y']); const b = S.testPoints(['y', 'x'], ['y', 'x']); const c = S.testPoints(['x', 'y'], ['x', 'y']);
  eq('the test points are fixed for a question: same variables, same points (any order of listing)', [a, b], [c, c]);
  check('there are 96 candidate points', a.length === 96, `${a.length}`);
  check('the points cover positive and negative values of each variable', ['x', 'y'].every(v => a.some(p => p[v] > 0) && a.some(p => p[v] < 0)));
  check('no point is near zero or huge by accident', a.every(p => Object.values(p).every(x => Math.abs(x) >= 0.25 && Math.abs(x) <= 40)));
  const other = S.testPoints(['x', 'z'], ['x', 'z']);
  check('different variables give different points', JSON.stringify(other) !== JSON.stringify(a));
  const r1 = S.checkSymbolic('x+sin(100*x)/100', 'x', ['x']); const r2 = S.checkSymbolic('x+sin(100*x)/100', 'x', ['x']);
  eq('re-marking gives the same verdict', r1, r2);
}

section('a plain fraction, a space, then a factor reads as the fraction times that factor');
expectRight('0.5*m*v^2', ['m', 'v'], ['1/2 m v^2', '1/2 m*v^2', '1 / 2 m v^2', '1/2 (m v^2)', 'm v^2 / 2'], '0.5*m*v^2', []);
expectRight('0.75*x', ['x'], ['3/4 x'], '0.75*x', []);
{
  const wrong = S.checkSymbolic('1/2 m v', '0.5*m*v^2', ['m', 'v']);
  check('1/2 m v is a clear wrong answer, not unclear', wrong.ok === true && wrong.correct === false, JSON.stringify(wrong));
  for (const a of ['1/2mv^2', '1/2m v^2', '1/2(m v^2)']) {
    const r = S.checkSymbolic(a, '0.5*m*v^2', ['m', 'v']);
    check(`"${a}" with no space is unclear, not marked`, r.ok === false && r.code === 'ambiguous_division' && !('correct' in r), JSON.stringify(r));
  }
  const u = S.checkSymbolic('a/b c', 'a/b', ['a', 'b', 'c']);
  check('letters over letters then a factor stays unclear', u.ok === false && u.code === 'ambiguous_division', JSON.stringify(u));
  const u2 = S.checkSymbolic('1/x y', 'x', ['x', 'y']);
  check('1 over a variable then a factor stays unclear', u2.ok === false && u2.code === 'ambiguous_division', JSON.stringify(u2));
  const key = S.previewKey('1/2 m v^2', ['m', 'v']);
  check('a key written this way reads, and the preview shows the reading', key.ok === true && key.reading === '(1 / 2) * m * v^2', JSON.stringify(key));
  const bad = S.previewKey('1/2m v^2', ['m', 'v']);
  check('a key with no space is refused in the preview', bad.ok === false, JSON.stringify(bad));
  const ans = S.parseSymbolic('1 / 2 m', ['m']);
  check('the answer reading shows the grouping', ans.ok && ans.reading === '(1 / 2) * m', JSON.stringify(ans));
  const two = S.parseSymbolic('1/2 3', ['m']);
  check('a fraction then a number is still two numbers side by side', two.ok === false && two.code === 'missing_operator', JSON.stringify(two));
}

section('answers that cannot be read are refused, not marked');
expectRefused('x+y', ['x', 'y'], ['z', 'x+z', 'x + w y', 'velocity', 'Sin(x)'], 'unknown_name', 'unknown variable');
expectRefused('x+y', ['x', 'y'], ['(x+y', 'x+y)', '((x+y)', '()', 'x+(y'], null, 'brackets');
expectRefused('x+y', ['x', 'y'], ['x+', '*x', 'x**', 'x+*y', '/x', 'x^', '^2', '3 4', 'x y 3 4'], null, 'incomplete');
expectRefused('x+y', ['x', 'y'], ['x = y', 'F = x + y', 'x+y=', '=x'], 'equals', 'an equals sign');
expectRefused('x+y', ['x', 'y'], ['sin x', 'sin', 'sqrt', 'sin^2(x)', 'sqrt 4'], null, 'function without brackets');
expectRefused('x+y', ['x', 'y'], ['', '   ', '\t'], 'empty', 'empty');
expectRefused('x+y', ['x', 'y'], ['x+y;', 'x+y!', 'x|y|', '[x+y]', 'x,y', '1,5x', 'x+y$', 'x@y', '√ x', 'x≤y', '"x"', 'x+y # c', '`x`', 'x\\y'], 'bad_character', 'a character that is not in the grammar');
expectRefused('x', ['a', 'b', 'x'], ['a/b a', '1/2x', 'x/2 x', '1/2(x)'], 'ambiguous_division', 'a division followed by implicit multiplication');
expectRefused('x', ['x'], ['1e999', '9'.repeat(40), '1e400*x'], 'number_range', 'a number too large');
expectRefused('x+y', ['x', 'y'], ['xyz'], 'unknown_name', 'run-together names that cannot be split');
expectRefused('x', ['x'], ['5 N', '9.8 m/s^2', 'x kg', '3 m'], 'unknown_name', 'a unit typed after the answer');
{
  check('"ab" with variables a, b and ab is read as the variable ab first, so a*b and ab are different here', S.checkSymbolic('ab', 'ab', ['a', 'b', 'ab']).correct === true);
  const amb = S.checkSymbolic('mpi', 'x', ['m', 'p', 'i', 'x']);
  check('a run-together name with two readings is refused as unclear', amb.ok === false && amb.code === 'ambiguous_name', JSON.stringify(amb));
  check('a refusal for an unknown name lists the allowed variables and not the key',
    (() => { const q = S.checkSymbolic('z', 'x*y', ['x', 'y']); return q.ok === false && /x/.test(q.message) && /y/.test(q.message) && !/x\*y/.test(q.message); })());
}

section('nothing is executed: hostile answers');
{
  const hostile = [
    'process.exit(1)', 'constructor.constructor("return 1")()', '__proto__', 'x.constructor', 'this', 'globalThis', 'import("fs")',
    '(()=>1)()', 'alert(1)', '"; while(1){}', '${1+1}', '`${1}`', 'x; while(true){}', 'eval("1")', 'Function("return 1")()', 'toString', 'valueOf()',
    'x[constructor]', 'x["a"]', '{}', '[]', 'new Array(1e9)', 'while(1);', '1;process.exit()', 'require("fs")',
  ];
  globalThis.__ran = false;
  for (const h of hostile) {
    const r = S.checkSymbolic(h, 'x', ['x']);
    check(`hostile "${h.slice(0, 30)}": refused or wrong, never an exception, never right`, r.ok === false || r.correct === false, JSON.stringify(r).slice(0, 120));
  }
  check('nothing ran', globalThis.__ran === false);
  const src = readFileSync(new URL('../../site/js/symbolic-answer.js', here), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  check('the source has no eval, no Function constructor, no dynamic import, no with, no setTimeout', !/\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(|\bimport\s*\(|\bwith\s*\(|setTimeout|setInterval|require\s*\(/.test(src));
  check('the source reads no global and no property by a name the student chose', !/globalThis|window\b|document\b|process\b/.test(src));
  const lookups = S.checkSymbolic('toString', 'x', ['x']);
  check('a name like toString is an unknown variable, not an object property', lookups.ok === false && lookups.code === 'unknown_name');
  const proto = S.checkSymbolic('constructor', 'x', ['x']);
  check('constructor is an unknown variable', proto.ok === false && proto.code === 'unknown_name');
  check('a variable named __proto__ is not allowed as a name', S.variableProblem(['__proto__']) !== null);
}

section('limits: length and nesting, so a hostile answer cannot hang or crash');
{
  const t0 = Date.now();
  const long = S.checkSymbolic('x+'.repeat(150) + 'x', 'x', ['x']);
  check('an answer over the length limit is refused with a plain sentence', long.ok === false && long.code === 'too_long', JSON.stringify(long).slice(0, 100));
  const deep = S.checkSymbolic('('.repeat(60) + 'x' + ')'.repeat(60), 'x', ['x']);
  check('60 nested brackets are refused (nesting limit)', deep.ok === false && deep.code === 'too_deep', JSON.stringify(deep).slice(0, 100));
  const unary = S.checkSymbolic('-'.repeat(100) + 'x', 'x', ['x']);
  check('100 minus signs in a row are refused (nesting limit), not a stack overflow', unary.ok === false && (unary.code === 'too_deep' || unary.code === 'too_long'), JSON.stringify(unary).slice(0, 100));
  const pow = S.checkSymbolic('2^'.repeat(80) + '2', 'x', ['x']);
  check('a tower of powers is refused, not evaluated', pow.ok === false, JSON.stringify(pow).slice(0, 100));
  const fn = S.checkSymbolic('sin('.repeat(30) + 'x' + ')'.repeat(30), 'x', ['x']);
  check('30 nested functions are refused (nesting limit)', fn.ok === false && fn.code === 'too_deep');
  const edge = S.checkSymbolic('('.repeat(15) + 'x' + ')'.repeat(15), 'x', ['x']);
  check('15 nested brackets are still fine', edge.ok === true && edge.correct === true, JSON.stringify(edge).slice(0, 100));
  const many = S.checkSymbolic('x'.repeat(199), 'x', ['x']);
  check('a long run of letters that cannot be split is refused quickly', many.ok === false);
  const manySplit = S.checkSymbolic('x'.repeat(100), 'x', ['x']);
  check('a long run of one variable name is refused or marked, quickly (token limit)', manySplit.ok === false || manySplit.correct === false);
  const pathological = S.checkSymbolic('ab'.repeat(90), 'x', ['a', 'b', 'ab']);
  check('a run that can be split in a huge number of ways is refused, not counted', pathological.ok === false);
  check('all of these together ran in well under a second', Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
  const nonString = S.checkSymbolic(12345, 'x', ['x']);
  check('a non-string answer is refused', nonString.ok === false && nonString.code === 'not_text');
  check('a null answer is refused', S.checkSymbolic(null, 'x', ['x']).ok === false);
  check('an object answer is refused', S.checkSymbolic({ toString() { return 'x'; } }, 'x', ['x']).ok === false);
}

section('division by zero and very large values');
{
  const r1 = S.checkSymbolic('1/x', '1/x', ['x']);
  check('a key that is undefined at no sampled point still works', r1.ok && r1.correct);
  expectWrong('x', ['x'], ['x + 0/0*0', '(x*x)/x*x/x*(1/0)', 'x/(x-x)'], 'an answer that divides by zero where the key is defined');
  expectRight('x/x', ['x'], ['1', 'x^0']);                                      // 0 is never a test point, so x/x is 1 everywhere it is tested
  check('1/0 is not a number', S.checkSymbolic('1/0', 'x', ['x']).ok === true && S.checkSymbolic('1/0', 'x', ['x']).correct === false);
  const big = S.checkSymbolic('10^300*10^300*x', 'x', ['x']);
  check('an answer that overflows to infinity is wrong, not an exception', big.ok && big.correct === false, JSON.stringify(big));
  const bigKey = S.checkSymbolic('x', '10^200*10^200 + x', ['x']);
  check('a key that overflows at every point is a key fault, not the student\'s mistake', bigKey.ok === false && bigKey.keyFault === true, JSON.stringify(bigKey));
  expectRight('10^100 * x', ['x'], ['x * 1e100', '1e100*x', '10^100x', 'x*10^100'], 'a large constant');
  expectWrong('10^100 * x', ['x'], ['x * 1e99', '1e101*x', '(1+1e-6)*1e100*x']);
  expectRight('exp(x)', ['x'], ['e^x', 'exp(x)*1'], 'exp, which is large but finite at the test points');
  expectWrong('exp(x)', ['x'], ['exp(x)+1', 'exp(2x)', 'exp(x)*(1+1e-6)']);
  expectRight('x^50', ['x'], ['(x^25)^2', 'x^49*x'], 'a high power stays finite at the test points');
  expectWrong('x^50', ['x'], ['x^51', 'x^49', 'x^50*(1+1e-6)']);
  check('0^0 does not crash', S.checkSymbolic('0^0', 'x', ['x']).ok === true);
  check('a negative number to a fractional power is undefined, so wrong where the key is defined', (() => { const r = S.checkSymbolic('(-x)^0.5', 'x', ['x']); return r.ok && r.correct === false; })());
  const tiny = S.checkSymbolic('x', 'x*1e-300', ['x']);
  check('a tiny key is compared with an absolute floor, not by relative error alone', tiny.ok === true);
  expectRight('0', ['x'], ['x-x', '0*x', 'sin(x)^2+cos(x)^2-1', '(x+1)^2-x^2-2x-1'], 'a key of zero: rounding error is tolerated by an absolute floor');
}

section('a question key that does not parse is a key fault');
{
  for (const [label, key, vars] of [
    ['an empty key', '', ['x']], ['a blank key', '   ', ['x']], ['a key with an unbalanced bracket', '(x+1', ['x']],
    ['a key with a variable that is not allowed', 'x+y', ['x']], ['a key that is an equation', 'y = x', ['x', 'y']],
    ['a key with a character that is not in the grammar', 'x;1', ['x']], ['a key that is not text', null, ['x']],
    ['a key too long', 'x+'.repeat(150) + 'x', ['x']], ['a key nested too deep', '('.repeat(60) + 'x' + ')'.repeat(60), ['x']],
    ['a key that is undefined at every test point', 'sqrt(-1-x^2)', ['x']], ['a key with a division in front of implicit multiplication', '1/2x', ['x']],
  ]) {
    const r = S.checkSymbolic('x', key, vars);
    check(`${label}: key fault, no verdict`, r.ok === false && r.keyFault === true && !('correct' in r) && typeof r.message === 'string', JSON.stringify(r).slice(0, 140));
  }
  for (const [label, vars] of [
    ['no variables', []], ['variables not a list', 'x'], ['a variable named like a function', ['sin']],
    ['a duplicate variable', ['x', 'x']], ['a variable with a space', ['a b']], ['a variable starting with a digit', ['1x']], ['too many variables', 'abcdefghi'.split('')],
    ['a variable name that is too long', ['a'.repeat(13)]], ['an empty variable name', ['']], ['a variable named __proto__', ['__proto__']], ['a variable named constructor', ['constructor']],
  ]) {
    const r = S.checkSymbolic('x', 'x', vars);
    check(`${label}: key fault`, r.ok === false && r.keyFault === true, JSON.stringify(r).slice(0, 120));
    check(`${label}: variableProblem says why`, typeof S.variableProblem(vars) === 'string');
  }
  check('good variable names pass', S.variableProblem(['x', 'y', 'v_0', 'F_g', 'theta', 'M1', 'μ_0']) === null);
  const leak = S.checkSymbolic('z', 'x*y*secret', ['x', 'y']);
  check('a key fault message says nothing about the key', leak.keyFault === true && !/secret|x\*y/.test(leak.message));
}

section('the preview says how an answer is read');
{
  const reading = (t, vars = ['m', 'v', 'x', 'y', 'a', 'b']) => { const r = S.parseSymbolic(t, vars); return r.ok ? r.reading : `REFUSED ${r.code}`; };
  eq('implicit multiplication is shown', reading('m v^2/2'), 'm * v^2 / 2');
  eq('a power is a power', reading('m*v**2'), 'm * v^2');
  eq('a superscript is a power', reading('v²'), 'v^2');
  eq('brackets stay where they change the meaning', reading('(x+y)*a'), '(x + y) * a');
  eq('and are dropped where they do not', reading('((x))+(y*a)'), 'x + y * a');
  eq('a minus before a power binds looser than the power', reading('-x^2'), '-x^2');
  eq('a power of a negative keeps its bracket', reading('(-x)^2'), '(-x)^2');
  eq('subtraction groups to the left', reading('x-(y-a)'), 'x - (y - a)');
  eq('a division by a product keeps its bracket', reading('x/(y*a)'), 'x / (y * a)');
  eq('functions', reading('sin(x)cos(y)'), 'sin(x) * cos(y)');
  eq('pi is shown as pi', reading('2π x'), '2 * pi * x');
  eq('adjacent names are split and shown apart', reading('xy'), 'x * y');
  eq('a power tower groups to the right', reading('x^y^a'), 'x^y^a');
  eq('an ambiguous division is refused, not guessed', reading('1/2x'), 'REFUSED ambiguous_division');
  const r = S.parseSymbolic('m v^2', ['m', 'v']);
  check('the parse reports which variables the answer uses', r.ok && JSON.stringify(r.used) === JSON.stringify(['m', 'v']));
  check('the reading never contains the key', true);
}

section('the grammar function list');
{
  for (const f of ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'sqrt', 'exp', 'ln', 'log10', 'abs']) {
    const r = S.parseSymbolic(`${f}(x)`, ['x']);
    check(`${f}(x) is read`, r.ok === true, JSON.stringify(r));
  }
  const log = S.parseSymbolic('log(x)', ['x']);
  check('log(x) alone is refused as unclear (natural or base 10), with a sentence saying ln or log10', log.ok === false && /ln/.test(log.message) && /log10/.test(log.message), JSON.stringify(log));
  check('two arguments are refused', S.parseSymbolic('atan(x, 2)', ['x']).ok === false);
  check('an empty call is refused', S.parseSymbolic('sin()', ['x']).ok === false);
  eq('ln(e) is 1 and log10(1000) is 3', [S.checkSymbolic('ln(e)', '1', ['x']).correct, S.checkSymbolic('log10(1000)', '3', ['x']).correct], [true, true]);
}

section('tolerance scales with the size of the values: a tiny key does not accept zero or a wrong multiple');
{
  // Physical constants at both ends of the scale. The old tolerance had an absolute floor of 1, so a key below about 1e-9
  // at every test point accepted ANY other tiny expression, including 0.
  for (const [c, v, other] of [['6.63e-34', 'f', 'h'], ['1.6e-19', 'V', 'q'], ['8.99e9', 'q', 'k'], ['6.02e23', 'n', 'N'], ['1.38e-23', 'T', 'k']]) {
    const key = `${c}*${v}`;
    expectRight(key, [v], [`${v}*${c}`, `${v} ${c}`, `${c}${v}`, `(${v}*${c})*1`], `${other} constant ${c}`);
    expectWrong(key, [v], ['0', `2*${key}`, `${key}*(1+1e-6)`, `${key}/2`, `-${key}`, `${key}+${c}`, v, '1e-20*' + v, `${c}`], `${other} constant ${c}`);
  }
  expectWrong('6.63e-34*3e8/lambda', ['lambda'], ['1e-25/lambda', '0', '6.63e-34*3e8/lambda*1.001'], 'hc over lambda');
  expectRight('6.63e-34*3e8/lambda', ['lambda'], ['3e8*6.63e-34/lambda', '1.989e-25/lambda*(6.63e-34*3e8/1.989e-25)'], 'hc over lambda');
  expectWrong('1.6e-19*V', ['V'], ['3.2e-19*V', '0'], 'electron charge times V');
  // a key that is really 0 (at a point, or everywhere) still works, rounding error included
  expectRight('0', ['x'], ['x-x', '0*x', '(x+1)^2-x^2-2x-1', 'sin(x)^2+cos(x)^2-1'], 'a key that is zero everywhere');
  expectWrong('0', ['x'], ['1e-6*x', 'x^2*1e-3'], 'a key that is zero everywhere');
  expectRight('abs(x)-x', ['x'], ['abs(x)-x', '2*abs(x)-2*x-(abs(x)-x)'], 'a key that is zero at some points only (positive x)');
  expectRight('x*(x-x)', ['x'], ['0', 'x-x'], 'a key that is zero at every point');
  // cancellation: large intermediates leave rounding noise, which must not refuse a correct answer
  expectRight('1', ['x'], ['cosh(x)^2-sinh(x)^2', 'sin(x)^2+cos(x)^2'], 'cancellation of large intermediates');
  expectRight('(x+1000000)^2-1000000^2-2000000*x', ['x'], ['x^2'], 'cancellation in the key');
  eq('the exported tolerance helper agrees on equal numbers and refuses a relative 1e-6 difference at 1e-30', [S.agree(1e-30, 1e-30, 0), S.agree(1e-30, 1.000001e-30, 0)], [true, false]);
}

section('by default a variable is tested on positive values only (physics quantities are mostly positive)');
{
  // The split forms students write. Each is right under the default; none was before.
  expectRight('sqrt(k/m)', ['k', 'm'], ['sqrt(k)/sqrt(m)', 'k^0.5/m^0.5', 'sqrt(k)*m^(-1/2)', 'sqrt(k)*m^-0.5', '(k/m)^(1/2)'], 'sqrt(k/m)', []);
  expectRight('2*pi*sqrt(L/g)', ['L', 'g'], ['2*pi*sqrt(L)/sqrt(g)', '2π√(L/g)', '2 pi L^0.5 g^-0.5'], 'pendulum period', []);
  expectRight('ln(a/b)', ['a', 'b'], ['ln(a)-ln(b)', '-ln(b/a)', '-(ln(b)-ln(a))'], 'ln(a/b)', []);
  expectRight('ln(x*y)', ['x', 'y'], ['ln(x)+ln(y)'], 'ln(x*y)', []);
  expectRight('sqrt(k)/sqrt(m)', ['k', 'm'], ['sqrt(k/m)'], 'the reverse direction still agrees', []);
  expectRight('x', ['x'], ['sqrt(x^2)', 'abs(x)', 'x*abs(x)/x'], 'with positive values sqrt(x^2) is x', []);
  expectRight('x^2', ['x'], ['x*abs(x)'], 'with positive values x*abs(x) is x^2', []);
  // still wrong where it is different
  expectWrong('sqrt(k/m)', ['k', 'm'], ['sqrt(k)*sqrt(m)', 'sqrt(k)/m', 'k/m', 'sqrt(m/k)'], 'sqrt(k/m)', []);
  expectWrong('ln(a/b)', ['a', 'b'], ['ln(a)+ln(b)', 'ln(b/a)', 'ln(a)/ln(b)'], 'ln(a/b)', []);
  // the default has no negative point; the points are the same ones whichever variable is signed
  const pos = S.testPoints(['x', 'y']);
  check('by default every value of every variable is positive', pos.every(p => p.x > 0 && p.y > 0));
  const onlyX = S.testPoints(['x', 'y'], ['x']);
  check('a variable marked can-be-negative takes both signs, the others stay positive', onlyX.some(p => p.x < 0) && onlyX.some(p => p.x > 0) && onlyX.every(p => p.y > 0));
  check('marking a variable does not move the magnitudes', pos.every((p, i) => Math.abs(p.x) === Math.abs(onlyX[i].x) && p.y === onlyX[i].y));
  check('the first six points are positive even for a signed variable', onlyX.slice(0, 6).every(p => p.x > 0));
  check('a signed variable is listed in either spelling', JSON.stringify(S.testPoints(['theta'], ['θ'])) === JSON.stringify(S.testPoints(['θ'], ['theta'])));
  check('at least 8 points are defined for a key that is defined on positive values', S.previewKey('sqrt(x)', ['x']).ok && S.previewKey('sqrt(x)', ['x']).points >= 8);
}

section('a variable marked "can be negative" is also tested at negative values');
{
  expectWrong('x', ['x'], ['sqrt(x^2)', 'abs(x)', 'x*abs(x)/x'], 'x marked signed', ['x']);
  expectWrong('x^2', ['x'], ['x*abs(x)'], 'x marked signed', ['x']);
  expectRight('x^2', ['x'], ['x*x', '(-x)^2', 'abs(x)^2', 'sqrt(x^4)'], 'x marked signed', ['x']);
  // an answer undefined where the key is defined stays wrong: with k and m signed, the key sqrt(k/m) exists where both are
  // negative and sqrt(k)/sqrt(m) does not
  expectWrong('sqrt(k/m)', ['k', 'm'], ['sqrt(k)/sqrt(m)'], 'an answer undefined where the key is defined is wrong', ['k', 'm']);
  expectRight('sqrt(k/m)', ['k', 'm'], ['sqrt(k/m)', '(k/m)^0.5'], 'the same expression is right when signed', ['k', 'm']);
  // only the marked variable takes a negative value
  expectRight('sqrt(k/m)', ['k', 'm'], ['sqrt(k)/sqrt(m)'], 'only an unmarked pair is positive', []);
  expectWrong('x*y', ['x', 'y'], ['x*abs(y)'], 'only y marked', ['y']);
  expectRight('x*y', ['x', 'y'], ['abs(x)*y'], 'only y marked, x is positive', ['y']);
  // the preview says which variables are tested at negative values
  const pv = S.previewKey('x^2', ['x', 'y'], ['x']);
  check('the preview names the variables tested at negative values', pv.ok && JSON.stringify(pv.negativeOn) === JSON.stringify(['x']), JSON.stringify(pv));
  check('the preview with none marked names none', JSON.stringify(S.previewKey('x^2', ['x']).negativeOn) === '[]');
  check('a signed name that is not a variable is refused by the preview', S.previewKey('x', ['x'], ['q']).ok === false);
  check('a signed name that is not a variable is a key fault when checking', S.checkSymbolic('x', 'x', ['x'], ['q']).keyFault === true);
  check('signed given as text is a key fault, never a crash', S.checkSymbolic('x', 'x', ['x'], 'x').keyFault === true);
  check('signed = null is the default (positive only)', S.checkSymbolic('sqrt(x^2)', 'x', ['x'], null).correct === true);
  check('a key defined only for negative values is a key fault by default and works when marked',
    S.checkSymbolic('sqrt(-x)', 'sqrt(-x)', ['x']).keyFault === true && S.checkSymbolic('sqrt(-x)', 'sqrt(-x)', ['x'], ['x']).correct === true);
  check('signedProblem passes a good list and an empty one', S.signedProblem(['x'], ['x']) === null && S.signedProblem([], ['x']) === null);
}

section('a Greek letter and its Latin spelling are the same name');
{
  const pairs = [['α', 'alpha'], ['β', 'beta'], ['γ', 'gamma'], ['δ', 'delta'], ['ε', 'epsilon'], ['ζ', 'zeta'], ['η', 'eta'],
    ['θ', 'theta'], ['ι', 'iota'], ['κ', 'kappa'], ['λ', 'lambda'], ['μ', 'mu'], ['ν', 'nu'], ['ξ', 'xi'], ['ο', 'omicron'],
    ['ρ', 'rho'], ['σ', 'sigma'], ['τ', 'tau'], ['υ', 'upsilon'], ['φ', 'phi'], ['χ', 'chi'], ['ψ', 'psi'], ['ω', 'omega'],
    ['Γ', 'Gamma'], ['Δ', 'Delta'], ['Θ', 'Theta'], ['Λ', 'Lambda'], ['Σ', 'Sigma'], ['Φ', 'Phi'], ['Ω', 'Omega']];
  for (const [g, l] of pairs) {
    expectRight(`2*${l}`, [l], [`2*${g}`, `2${g}`, `${g}*2`], `variable ${l}, answer in Greek`, []);
    expectRight(`2*${g}`, [g], [`2*${l}`, `${l}*2`], `variable ${g}, answer in Latin`, []);
    expectRight(`2*${g}`, [l], [`2*${l}`, `2*${g}`], `key typed in Greek, variable in Latin (${l})`, []);
    expectRight(`2*${l}`, [g], [`2*${l}`, `2*${g}`], `key typed in Latin, variable in Greek (${g})`, []);
    check(`${l} and ${g} listed together are a duplicate`, S.variableProblem([l, g]) !== null);
  }
  // pi stays the constant, in either spelling
  expectRight('2*pi*r', ['r'], ['2*π*r', '2πr', '2 pi r'], 'pi in either spelling', []);
  expectRight('mu_0*I/(2*pi*r)', ['mu_0', 'I', 'r'], ['μ_0 I/(2πr)', 'μ_0*I/(2*π*r)', 'mu_0*I/(2*pi*r)'], 'mu_0 in either spelling', []);
  expectRight('μ_0*I/(2*π*r)', ['μ_0', 'I', 'r'], ['mu_0*I/(2*pi*r)'], 'mu_0 key in Greek', []);
  expectRight('sin(theta)', ['theta'], ['sin(θ)', 'sin(θ)^2/sin(θ)'], 'sin theta', []);
  expectRight('m*g*h*sin(θ)', ['m', 'g', 'h', 'θ'], ['mghsin(theta)', 'm g h sin(theta)', 'm*g*h*sin(θ)'], 'Greek and Latin together', []);
  expectRight('λ*ν', ['lambda', 'nu'], ['νλ', 'lambda nu', 'λν'], 'adjacent Greek letters', []);
  check('the micro sign is mu', S.checkSymbolic('µ*x', 'mu*x', ['mu', 'x']).correct === true);
  check('a pi and a variable p, i do not make a run ambiguous when Greek', S.checkSymbolic('2πr', '2*pi*r', ['r', 'p', 'i']).correct === true);
  check('a Greek letter that is not a name is an unknown name, not a crash', S.checkSymbolic('θ', 'x', ['x']).code === 'unknown_name');
  check('the folded name is shown in the reading', S.parseSymbolic('θ', ['theta']).reading === 'theta');
  check('foldName leaves Latin names alone', S.foldName('F_g') === 'F_g' && S.foldName('') === '');
}

section('look-alike characters: minus, superscript digits, subscript digits, fractions, square root');
{
  expectRight('x^2-y^2', ['x', 'y'], ['x²−y²', 'x² − y²', 'x²–y²'], 'real minus sign and superscripts', []);
  expectRight('x^-2', ['x'], ['x⁻²', 'x^−2', 'x^(−2)'], 'superscript minus', []);
  expectRight('x^12', ['x'], ['x¹²'], 'two superscript digits', []);
  expectRight('v0*t', ['v0', 't'], ['v₀ t', 'v₀*t'], 'subscript zero', []);
  expectRight('m*v^2/2', ['m', 'v'], ['½mv²', '½ m v^2'], 'one half sign', []);
  expectRight('sqrt(2*g*h)', ['g', 'h'], ['√(2gh)', '√ (2 g h)'], 'square root sign before a bracket', []);
  expectRefused('x', ['x'], ['√x'], 'bad_character', 'a bare square root sign is still refused');
}

section('the buttons insert square roots, pi and e: the forms they make are read and compared by value');
{
  expectRight('x', ['x'], ['sqrt(x)^2', 'sqrt(x)*sqrt(x)', 'sqrt(x^2)', '(x^(1/2))^2'], 'sqrt(x)^2 is x for a positive x', []);
  expectRight('sqrt(x)', ['x'], ['x^(1/2)', 'x^0.5', '√(x)', 'sqrt(x)*1', 'x/sqrt(x)'], 'x^(1/2) is sqrt(x)', []);
  expectRight('pi*r^2', ['r'], ['r^2*pi', 'π r²', 'pi r^2', '3.141592653589793*r^2', 'r*r*pi'], 'pi r squared', []);
  expectRight('m/(2*k)', ['m', 'k'], ['(m)/(2*k)', '(m)/((2)*(k))', 'm/2/k', '(m/2)/(k)'], 'a stacked fraction typed with brackets is the slash form', []);
  expectRight('a*b/c', ['a', 'b', 'c'], ['(a*b)/(c)', '(a)*(b)/(c)', 'a*(b/c)'], 'brackets round a numerator and a denominator', []);
  expectWrong('pi*r', ['r'], ['2*pi*r', 'r', '3*r', '3.14*r', 'pi*r^2', 'e*r'], '2*pi is not pi', []);
  expectWrong('x^2', ['x'], ['x^3', 'x', 'x^(1/2)', 'x^(2/3)', 'sqrt(x)', '2*x', 'x^-2'], 'the wrong power is wrong', []);
  expectWrong('sqrt(x)', ['x'], ['x', 'x^2', 'x^(1/3)', 'sqrt(2*x)', 'x^(1/2)+1', '-sqrt(x)'], 'the wrong root is wrong', []);
  expectRight('e^(-x)', ['x'], ['exp(-x)', '1/exp(x)', 'e^-x', '1/e^x'], 'e as the constant', []);
  expectRight('2*pi*sqrt(m/k)', ['m', 'k'], ['2*pi*sqrt((m)/(k))', '2 π √(m/k)', '2*pi*m^(1/2)/k^(1/2)'], 'a period', []);
  for (const t of ['sqrt()', 'sqrt', '()/()', '()', 'x^()', 'sqrt(x']) {
    const r = S.parseSymbolic(t, ['x']);
    check(`what a button leaves before it is filled in, "${t}", is refused with a sentence and never marked`, r.ok === false && typeof r.message === 'string' && r.message.length > 8, JSON.stringify(r));
  }
}

section('a variable of the question wins over a constant of the same name');
{
  check('a variable named e is allowed', S.variableProblem(['e']) === null && S.variableProblem(['pi']) === null && S.variableProblem(['π']) === null);
  check('a function name is still not allowed as a variable', S.variableProblem(['sqrt']) !== null && S.variableProblem(['sin']) !== null && S.variableProblem(['log']) !== null);
  // e as the electron charge
  const vars = ['e', 'V'];
  expectRight('e*V', vars, ['V*e', 'V e', 'eV', 'e*V*1'], 'e is the question variable', []);
  expectWrong('e*V', vars, ['2.718281828459045*V', 'exp(1)*V', 'V', 'e*V*2'], 'e is NOT 2.718 here', []);
  const t = S.parseSymbolic('e*V', vars);
  check('the tree holds a variable for e, and the reading says e', t.ok && t.ast.a.k === 'var' && t.ast.a.name === 'e' && t.used.join() === 'e,V', JSON.stringify(t.ast));
  const nv = S.parseSymbolic('e*V', ['V']);
  check('without such a variable, e is the constant', nv.ok && nv.ast.a.k === 'const' && nv.ast.a.name === 'e' && nv.used.join() === 'V');
  // pi as a variable
  expectRight('pi*r', ['pi', 'r'], ['r*pi', 'π r', 'πr'], 'pi is the question variable', []);
  expectWrong('pi*r', ['pi', 'r'], ['3.141592653589793*r'], 'pi is NOT 3.14159 here', []);
  check('the Greek pi is the variable too when the question declares pi', S.parseSymbolic('π', ['pi']).ast.k === 'var' && S.parseSymbolic('pi', ['π']).ast.k === 'var');
  check('the constant works as before when no such variable is declared', S.parseSymbolic('π', ['r']).ast.k === 'const' && S.parseSymbolic('pi', ['r']).ast.name === 'pi');
  check('and a key that uses e as the constant is not changed by other variables', S.checkSymbolic('e^x', 'exp(x)', ['x']).correct === true);
  check('...but with e a variable, e^x is no longer exp(x)', S.checkSymbolic('e^x', 'exp(x)', ['e', 'x']).correct === false);
  check('the test points of other questions do not move (the seed is the variable names)', JSON.stringify(S.testPoints(['x']).slice(0, 2)) === JSON.stringify(S.testPoints(['x']).slice(0, 2)));
}

section('number notation 1e3, and "2e" / "2 e"');
{
  expectRight('1000*x', ['x'], ['1e3*x', '1E3 x', '1e3x', '1.0e3*x', '0.001e6*x'], '1e3 is a number', []);
  expectRight('0.0001*x', ['x'], ['1e-4*x', '1e-04x', '1E-4 x'], 'a small number', []);
  expectRight('2*e', ['x'], ['2e', '2 e', '2*e', 'e2'.slice(0, 0) + 'e*2', '2(e)'], '2e and 2 e are 2 times the constant e', []);
  expectWrong('2*e', ['x'], ['2e3', '2e+3', '2e-3', '2*x', '2'], '2e is not a number', []);
  expectRight('2000', ['x'], ['2e3', '2E3', '2e+3'], '2e3 is two thousand', []);
  expectRight('2*e', ['e'], ['2e', '2 e', 'e*2'], '2e is 2 times the variable e when the question declares e', []);
  expectRight('2000', ['e'], ['2e3'], '2e3 is still two thousand when the question declares e', []);
  expectRight('2000', ['e'], ['2e+3'], '2e+3 is still the number 2000 when e is a variable: write 2*e+3 for the other reading', []);
  expectRight('2*e+3', ['e'], ['2*e+3', '2 e + 3'], '2*e+3 with a spaced sign', []);
  check('a number followed by exp( is a product with exp', S.checkSymbolic('2exp(x)', '2*exp(x)', ['x']).correct === true);
  check('e2 is an unknown name, not 2e', S.parseSymbolic('e2', ['x']).code === 'unknown_name');
  check('1 e3 is refused, not guessed', S.parseSymbolic('1 e3', ['x']).ok === false);
}

section('a square root of a negative number: undefined, never zero and never complex');
{
  // default: every variable is positive, so every point is defined
  check('sqrt(x) is defined at enough points for a positive x', S.previewKey('sqrt(x)', ['x']).ok === true);
  // x marked "can be negative"
  const sg = ['x'];
  check('sqrt(x) with x signed: the key is defined only where x is positive, and there are enough such points', (() => { const p = S.previewKey('sqrt(x)', ['x'], sg); return p.ok && p.points >= 8 && p.points < 96; })());
  expectRight('sqrt(x)', ['x'], ['x^(1/2)', 'x^0.5', 'sqrt(x)*1'], 'signed x: where the key is undefined nothing is asked', sg);
  expectRight('x', ['x'], ['x', '(x)'], 'signed x identity', sg);
  expectWrong('x', ['x'], ['sqrt(x)^2', 'sqrt(x^2)', 'abs(x)'], 'signed x: sqrt(x)^2 is undefined where x<0, so it is not x; sqrt(x^2) is |x|', sg);
  expectWrong('abs(x)', ['x'], ['x', 'sqrt(x)^2'], 'signed x: x is not |x|', sg);
  expectRight('abs(x)', ['x'], ['sqrt(x^2)', 'sqrt(x)^2'.slice(0, 0) + 'sqrt(x*x)'], 'signed x: sqrt(x^2) is |x|', sg);
  expectWrong('x^2', ['x'], ['sqrt(x^2)', 'abs(x)', 'x^(1/2)^4'], 'signed x: a root that is undefined for a negative x is not x^2', sg);
  // a root of a negative is NaN: it must not become 0, and a wrong answer that is undefined where the key exists is wrong
  expectWrong('1', ['x'], ['sqrt(x)/sqrt(x)', 'x^(1/2)/x^(1/2)'], 'signed x: an answer undefined at negative x is not the constant 1', sg);
  expectWrong('sqrt(1+x^2)', ['x'], ['sqrt(x)', 'sqrt(x^2)', 'sqrt(1-x^2)'], 'a wrong root is wrong', sg);
  // a negative number under a root, as a typed constant
  const key = S.checkSymbolic('sqrt(-4)', 'sqrt(x)', ['x']);
  check('sqrt(-4) is not 2 and not 2i: it is wrong at every point, not refused', key.ok && key.correct === false, JSON.stringify(key));
  check('a key that is a root of a negative everywhere is a key fault', S.checkSymbolic('x', 'sqrt(-1-x^2)', ['x']).keyFault === true);
  // rounding noise around zero under a root must not decide a mark
  expectRight('abs(cos(x))', ['x'], ['sqrt(1-sin(x)^2)', 'sqrt(cos(x)^2)'], 'noise under a root: 1-sin^2 is cos^2 and can come out as a tiny negative', []);
  expectRight('sqrt(1-sin(x)^2)', ['x'], ['abs(cos(x))', 'sqrt(cos(x)^2)'], 'noise under a root, the key being the root form', []);
  expectRight('sqrt(cosh(x)^2-sinh(x)^2-1+x^2)', ['x'], ['x', 'abs(x)'], 'noise under a root, a root of a cancelling sum', []);
  expectRight('0', ['x'], ['sqrt(cosh(x)^2-sinh(x)^2-1)'], 'a root of rounding noise is 0 within the rounding, not undefined', []);
  expectWrong('0', ['x'], ['sqrt(x-1)', 'sqrt(1e-3)', 'sqrt(cosh(x)^2-sinh(x)^2-1+1e-6)'], 'but a real positive root, or a real negative one, is not 0', []);
  expectWrong('x', ['x'], ['sqrt(x^2-1e-3)+x-sqrt(x^2-1e-3)'.slice(0, 0) + 'sqrt(x^2-0.001)'], 'a root of a clearly negative number at some points is undefined, not near zero', []);
  check('a real negative argument is not mistaken for noise', S.checkSymbolic('sqrt(x-3)', 'sqrt(x-3)', ['x']).correct === true && S.checkSymbolic('0', 'sqrt(x-3)', ['x']).correct === false);
}

section('the exported limits are the ones stated to staff');
{
  eq('limits', [S.MAX_SYMBOLIC_CHARS, S.MAX_DEPTH, S.MAX_TOKENS, S.MAX_VARIABLES], [200, 20, 150, 8]);
}


section('a tower of powers reads right to left: x^2^3 is x^(2^3), not (x^2)^3 (small item 5)');
{
  const val = (text, x) => { const p = S.parseSymbolic(text, ['x']); return p.ok ? S.evaluate(p.ast, new Map([['x', x]])) : null; };
  eq('x^2^3 at x=2 is 2^8 = 256', val('x^2^3', 2), 256);
  eq('x**2**3 reads the same way', val('x**2**3', 2), 256);
  eq('x^(2^3) is the same', val('x^(2^3)', 2), 256);
  eq('(x^2)^3 is the other reading, 64', val('(x^2)^3', 2), 64);
  eq('2^3^2 is 2^9 = 512', S.evaluate(S.parseSymbolic('2^3^2', ['x']).ast, new Map()), 512);
  eq('the reading shown to staff keeps the order: x^2^3', S.parseSymbolic('x^2^3', ['x']).reading, 'x^2^3');
  eq('the reading of the other order is bracketed', S.parseSymbolic('(x^2)^3', ['x']).reading, '(x^2)^3');
  expectRight('x^2^3', ['x'], ['x^(2^3)', 'x**2**3', 'x^8'], 'a key of x^2^3');
  expectWrong('x^2^3', ['x'], ['(x^2)^3', 'x^6'], 'a key of x^2^3');
  expectRight('(x^2)^3', ['x'], ['x^6', 'x^2*x^2*x^2'], 'a key of (x^2)^3');
  expectWrong('(x^2)^3', ['x'], ['x^2^3', 'x^8'], 'a key of (x^2)^3');
}

process.exit(summary() ? 0 : 1);
