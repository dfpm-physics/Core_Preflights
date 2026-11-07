// symbolic-view.js — how a parsed expression is SHOWN, and the buttons that help type one. Not the reader (that is
// symbolic-answer.js) and not the checker: nothing here decides whether an answer is right, and nothing here is sent to a server.
//
// WHAT IT HOLDS
//   toLatex(parsed)        a LaTeX string built from the PARSED tree only. Pure: no DOM, no KaTeX, runs anywhere.
//   buttonsFor(variables)  the row of insert buttons for one question.
//   insertSnippet(...)     what a button click does to the text in the answer box. Pure.
//   loadKatex / showMath   typesetting with the vendored KaTeX (site/vendor/katex), loaded only when a page asks for it.
//
// WHY THE LATEX CANNOT BE INJECTED INTO
//   The string is assembled from fixed command words, finite numbers, and variable names that are rebuilt letter by letter
//   from [A-Za-z0-9] (anything else is dropped). The student's own text is never copied into it: text that is not a valid
//   expression has no tree, so there is nothing to typeset. A backslash, a brace or an HTML tag typed by a student is
//   refused by the reader as "a character I cannot read" before this file is reached. KaTeX is also run with trust: false.
//
// KATEX IS OPTIONAL
//   If the script or its stylesheet cannot load, or KaTeX throws, the plain reading text is shown instead and says that
//   nothing is lost. The answer box, the buttons and the marking do not depend on it.

const GREEK_LOWER = new Set(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda',
  'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega']);
const GREEK_UPPER = new Set(['Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega']);
const FUNCTION_LATEX = {
  sin: '\\sin', cos: '\\cos', tan: '\\tan', asin: '\\arcsin', acos: '\\arccos', atan: '\\arctan',
  sinh: '\\sinh', cosh: '\\cosh', tanh: '\\tanh', exp: '\\exp', ln: '\\ln',
};
const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, neg: 3, '^': 4 };

const ascii = (s) => String(s).replace(/[^A-Za-z0-9]/g, '');
const word = (s) => (s.length === 1 ? s : `\\mathrm{${s}}`);

/** One name as LaTeX: a Greek spelling becomes its letter, a trailing digit run or a part after "_" becomes a subscript. */
export function nameLatex(name) {
  const m = /^([A-Za-z]+)_?([A-Za-z0-9_]*)$/.exec(String(name));
  if (!m) { const a = ascii(name); return a ? word(a) : '?'; }
  const base = GREEK_LOWER.has(m[1]) || GREEK_UPPER.has(m[1]) ? `\\${m[1]}` : word(m[1]);
  const rest = m[2].replace(/_+/g, ',').replace(/^,|,$/g, '');
  if (rest === '') return base;
  const sub = /^[0-9,]+$/.test(rest) ? rest : word(rest.replace(/,/g, ''));
  return `${base}_{${sub}}`;
}

function numberLatex(v) {
  const s = String(v);
  const m = /^([0-9.]+)e([+-]?[0-9]+)$/.exec(s);
  if (m) return `${m[1]}\\cdot 10^{${Number(m[2])}}`;
  return /^[0-9.]+$/.test(s) ? s : '?';
}

function latexOf(n) {
  const wrap = (child, need) => {
    const own = child.k === 'bin' ? PREC[child.op] : child.k === 'neg' ? PREC.neg : 9;
    const s = latexOf(child);
    return own < need ? `\\left(${s}\\right)` : s;
  };
  switch (n.k) {
    case 'num': return numberLatex(n.v);
    case 'const': return n.name === 'pi' ? '\\pi' : '\\mathrm{e}';
    case 'var': return nameLatex(n.name);
    case 'neg': return `-${wrap(n.a, PREC.neg)}`;
    case 'call':
      if (n.fn === 'sqrt') return `\\sqrt{${latexOf(n.a)}}`;
      if (n.fn === 'abs') return `\\left|${latexOf(n.a)}\\right|`;
      if (n.fn === 'log10') return `\\log_{10}\\left(${latexOf(n.a)}\\right)`;
      if (FUNCTION_LATEX[n.fn]) return `${FUNCTION_LATEX[n.fn]}\\left(${latexOf(n.a)}\\right)`;
      throw new Error('unknown function');
    case 'bin':
      switch (n.op) {
        case '+': return `${wrap(n.a, 1)} + ${wrap(n.b, n.b.k === 'neg' ? 9 : 1)}`;
        case '-': return `${wrap(n.a, 1)} - ${wrap(n.b, n.b.k === 'neg' ? 9 : 2)}`;
        case '*': return `${wrap(n.a, 2)} \\cdot ${n.b.k === 'neg' || (n.b.k === 'bin' && PREC[n.b.op] < 2) ? `\\left(${latexOf(n.b)}\\right)` : latexOf(n.b)}`;
        case '/': return `\\frac{${latexOf(n.a)}}{${latexOf(n.b)}}`;
        case '^': return `${wrap(n.a, 9)}^{${latexOf(n.b)}}`;
        default: throw new Error('unknown operator');
      }
    default: throw new Error('unknown node');
  }
}

/**
 * LaTeX for a parsed expression (the object parseSymbolic returns), or null when there is nothing to typeset (not parsed,
 * not ok). Only the tree is read: no student text goes into the result.
 */
export function toLatex(parsed) {
  if (!parsed || parsed.ok !== true || !parsed.ast) return null;
  try { return latexOf(parsed.ast); } catch { return null; }
}

/* ── the insert buttons ─────────────────────────────────────────────────────────────────────────────────── */

const foldGreekPi = (s) => (s === 'π' ? 'pi' : s);

/**
 * The buttons for a question: its variables first, then the fixed ones. `foldName` is the reader's own name folding, passed in
 * so this file imports nothing. A question's variable wins: if it declares e (or pi), its variable button is shown and the
 * constant button is not. Each button: { id, label, name (the accessible name), spec }.
 */
export function buttonsFor(variables, foldName = (s) => s) {
  const vars = (Array.isArray(variables) ? variables : []).map(String);
  const taken = new Set(vars.map((v) => foldGreekPi(foldName(v))));
  const out = vars.map((v) => ({ id: `var:${v}`, label: v, name: `Insert ${v}`, spec: { kind: 'word', text: v } }));
  out.push(
    { id: 'squared', label: 'x²', name: 'Squared', spec: { kind: 'plain', text: '^2' } },
    { id: 'power', label: 'xⁿ', name: 'Power', spec: { kind: 'plain', text: '^()', caret: 2 } },
    { id: 'sqrt', label: '√', name: 'Square root', spec: { kind: 'wrap', pre: 'sqrt(', post: ')' } },
    { id: 'multiply', label: '×', name: 'Multiply', spec: { kind: 'plain', text: '*' } },
    { id: 'fraction', label: 'a/b', name: 'Fraction', spec: { kind: 'wrap', pre: '(', post: ')/()', afterFromEnd: 1 } },
    { id: 'plus', label: '+', name: 'Plus', spec: { kind: 'plain', text: '+' } },
    { id: 'minus', label: '−', name: 'Minus', spec: { kind: 'plain', text: '-' } },
    { id: 'parens', label: '( )', name: 'Brackets', spec: { kind: 'wrap', pre: '(', post: ')' } },
  );
  if (!taken.has('pi')) out.push({ id: 'pi', label: 'π', name: 'Pi', spec: { kind: 'word', text: 'pi' } });
  if (!taken.has('e')) out.push({ id: 'e', label: 'e', name: 'The number e', spec: { kind: 'word', text: 'e' } });
  return out;
}

/**
 * What a button click does to the answer box. `value` is the text, [start, end) the selection. Returns { value, caret } or
 * null when the result would be longer than `max` characters. A 'word' (a name) gets a space before it when the character
 * before is a letter, digit, underscore or closing bracket, so "x" then pi reads x pi and not xpi, and 2 then e is not 2e3.
 * A 'wrap' brackets the selection (sqrt(sel), (sel), (sel)/()) or leaves the caret inside empty brackets.
 */
export function insertSnippet(value, start, end, spec, max = 200) {
  const v = String(value ?? '');
  const s = Math.max(0, Math.min(Number.isInteger(start) ? start : v.length, v.length));
  const e = Math.max(s, Math.min(Number.isInteger(end) ? end : s, v.length));
  const head = v.slice(0, s);
  const sel = v.slice(s, e);
  const tail = v.slice(e);
  let text; let caret;
  if (spec.kind === 'wrap') {
    text = spec.pre + sel + spec.post;
    caret = sel === '' ? head.length + spec.pre.length : head.length + text.length - (spec.afterFromEnd || 0);
  } else if (spec.kind === 'word') {
    const lead = /[A-Za-z0-9_)Ͱ-Ͽ]$/.test(head) ? ' ' : '';
    text = lead + spec.text;
    caret = head.length + text.length;
  } else {
    text = spec.text;
    caret = head.length + (spec.caret ?? text.length);
  }
  const out = head + text + tail;
  return out.length > max ? null : { value: out, caret };
}

/* ── typesetting with KaTeX (optional) ──────────────────────────────────────────────────────────────────── */

const KATEX_OPTIONS = { throwOnError: false, trust: false, displayMode: false, strict: false, maxExpand: 200, maxSize: 20 };
let katexPromise = null;

/** The KaTeX object if it is already on the page, else null. */
export const katexNow = () => (typeof globalThis.katex?.render === 'function' ? globalThis.katex : null);

/**
 * Load the vendored KaTeX once (stylesheet and script from this site). Resolves to the KaTeX object, or to null when it cannot
 * load (no document, a blocked or missing file, a timeout). Never rejects and never throws.
 */
export function loadKatex(doc = globalThis.document, timeoutMs = 8000) {
  if (katexNow()) return Promise.resolve(katexNow());
  if (katexPromise) return katexPromise;
  katexPromise = new Promise((resolve) => {
    try {
      if (!doc || typeof doc.createElement !== 'function') { resolve(null); return; }
      const base = new URL('../vendor/katex/', import.meta.url);
      const done = (v) => { clearTimeout(timer); resolve(v); };
      const timer = setTimeout(() => done(null), timeoutMs);
      const link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL('katex.min.css', base).href;
      doc.head.appendChild(link);
      const script = doc.createElement('script');
      script.src = new URL('katex.min.js', base).href;
      script.async = true;
      script.onload = () => done(katexNow());
      script.onerror = () => done(null);
      doc.head.appendChild(script);
    } catch { resolve(null); }
  }).then((k) => { if (!k) katexPromise = null; return k; });   // a failed load may be tried again later
  return katexPromise;
}

export const PLAIN_NOTE = 'The typeset view is not available on this page. Your answer is not affected.';

/**
 * Show a parsed expression typeset inside `el`. Falls back to the plain reading text (`plain`) when KaTeX is absent or
 * throws. Returns 'typeset' or 'plain'. The element is emptied first; only textContent and katex.render write to it.
 */
export function showMath(el, parsed, plain, katex = katexNow()) {
  el.textContent = '';
  const latex = toLatex(parsed);
  if (latex !== null && katex && typeof katex.render === 'function') {
    try { katex.render(latex, el, KATEX_OPTIONS); return 'typeset'; } catch { el.textContent = ''; }
  }
  el.textContent = plain;
  return 'plain';
}
