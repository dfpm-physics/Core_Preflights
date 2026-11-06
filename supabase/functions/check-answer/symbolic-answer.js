// symbolic-answer.js — the ONE reader of a typed expression, and the ONE checker of a symbolic answer. Pure: no DOM, no
// network, no imports, so the browser (the staff preview, the student preview) and the Deno edge function run the same file.
//
// SOURCE OF TRUTH: THIS FILE (site/js/symbolic-answer.js). It lives three times:
//   site/js/symbolic-answer.js                              the source: edit only this one
//   supabase/functions/check-answer/symbolic-answer.js      byte-for-byte copies, because a deployed function can only carry
//   supabase/functions/remark-question/symbolic-answer.js   files inside its own folder.
//   tests/app-schema/test-check-answer-function.mjs and test-remark-function.mjs (offline suites) fail if a copy differs
//   (line endings aside). After an edit, copy this file over the other two.
//
// WHAT THIS DOES
//   Decides whether two expressions are the same function. It reads the student's text and the key's text with the same
//   small grammar, evaluates both at a fixed set of test points, and compares the numbers. It never calls AI.
//
// WHAT THIS DOES NOT DO
//   It proves two answers are equal at the test points, not that one is simplified. A difference smaller than about one
//   part in 10^9 is not seen. Units, vectors and equations are not part of the grammar.
//
// NOTHING IS EVER EXECUTED
//   The text is split into tokens by a fixed pattern and read by a recursive-descent parser written here. The result is a
//   tree of plain objects; it is evaluated by a switch over a handful of node kinds. There is no eval, no Function
//   constructor, no property lookup by a name the student typed (names are looked up in a Map and a list), and no global.
//
// LIMITS (stated to staff on the question page)
//   MAX_SYMBOLIC_CHARS  200   characters in an answer or a key
//   MAX_TOKENS          150   tokens
//   MAX_DEPTH            20   nesting: brackets, function calls, signs in a row, a tower of powers
//   MAX_NODES           200   nodes in the tree
//   MAX_VARIABLES         8   variables a question may allow
//   Every limit is checked while reading, before anything is evaluated, so a hostile answer is refused in constant time.
//
// THE GRAMMAR
//   expression  = term { ("+" | "-") term }
//   term        = unary { ("*" | "/" | <next token starts an operand>) unary-without-sign }
//   unary       = { "+" | "-" } power
//   power       = primary [ ("^" | "**") exponent ]            right to left: x^y^z is x^(y^z)
//   exponent    = { "+" | "-" } power
//   primary     = number | name | function "(" expression ")" | "(" expression ")"
//   Numbers: 12  3.5  .5  1e3  2.5E-4.   Spacing and a few look-alike characters (a real minus sign, a times sign, a
//   superscript digit) are tidied first.
//   Names: the variables the question allows, and the constants pi (or the Greek letter) and e. A run of letters that is
//   not a name is split into names ONLY IF there is exactly one way to do it (xy is x*y; mpi is refused when m, p, i
//   and pi are all names). Multiplying by juxtaposition (2x, x y, 2(x+1), (a)(b)) works.
//   Functions: sin cos tan asin acos atan sinh cosh tanh sqrt exp ln log10 abs. log alone is refused, because it means ln
//   in some books and log10 in others.
//
// WHAT IS REFUSED RATHER THAN GUESSED
//   * 1/2x, 1/2m, 1/2(m), a/b c, 1/x y: after a division, juxtaposition could mean (1/2)x or 1/(2x). The student is asked
//     to bracket it. ONE case is read: a plain number over a plain number, then a SPACE, then a factor, is the fraction
//     times that factor (1/2 m v^2 is (1/2)*m*v^2; 3/4 x is (3/4)*x; 1 / 2 m the same). Without the space it stays refused.
//   * 3 4 (two numbers side by side), an equals sign, a unit, a function without brackets, an unknown name, a bad character.
//   A refusal is a plain sentence and costs no attempt. Nothing here marks an answer wrong because it could not be read.
//
// THE TEST POINTS
//   Fixed for a question: a seeded generator whose seed is a hash of the question's variable names (sorted), so listing
//   them in another order, or re-marking next year, gives the same points. 96 candidate points, magnitudes from 0.25 to
//   40. BY DEFAULT EVERY VARIABLE IS TESTED ON POSITIVE VALUES ONLY, because the quantities in physics (mass, length,
//   charge magnitude, time) mostly are; so sqrt(k)/sqrt(m) is the same as sqrt(k/m), ln(a)-ln(b) the same as ln(a/b), and
//   sqrt(x^2) the same as x. Staff mark a variable "can be negative" on the question page (the key's signed_variables),
//   and only those variables are also tested at negative values. Every point at which the KEY is defined is used
//   (normally all of them). An answer that is undefined (division by zero, a root of a negative, an overflow) at a point
//   where the key is defined is wrong. If the key is defined at fewer than 8 of 96 candidate points, that is the
//   QUESTION's fault, not the student's.
//
// THE COMPARISON
//   Per test point: |a - b| <= 1e-9 * max(|a|, |b|) + 4 * E, where E is the rounding error bounded for the two expressions
//   at that point (each operation adds 2.3e-16 times its own result to what it inherits). So rounding noise left by a
//   cancellation is forgiven in proportion to the numbers that cancelled, and nothing is forgiven by an absolute amount:
//   a key of 6.63e-34*f is not matched by 0 or by 2*6.63e-34*f. A key that is 0 with no subtraction in it must be
//   matched exactly.
//
// GREEK AND LATIN SPELLINGS
//   A Greek letter and its Latin spelling are the same name (theta and the Greek letter, mu and its Greek letter, pi and
//   its Greek letter), in the answer, in the key and in the variable list. The micro sign counts as mu.

export const MAX_SYMBOLIC_CHARS = 200;
export const MAX_TOKENS = 150;
export const MAX_DEPTH = 20;
export const MAX_NODES = 200;
export const MAX_VARIABLES = 8;
export const MAX_NAME_CHARS = 12;
export const MAX_CANDIDATE_POINTS = 96;
export const MIN_POINTS = 8;
const REL_TOL = 1e-9;
const ROUND = 2.3e-16;                                  // the relative rounding of one operation
const ERROR_ALLOWANCE = 4;                              // how many times the bounded rounding error is forgiven

const FUNCTIONS = new Map([
  ['sin', Math.sin], ['cos', Math.cos], ['tan', Math.tan], ['asin', Math.asin], ['acos', Math.acos], ['atan', Math.atan],
  ['sinh', Math.sinh], ['cosh', Math.cosh], ['tanh', Math.tanh], ['sqrt', Math.sqrt], ['exp', Math.exp],
  ['ln', Math.log], ['log10', Math.log10], ['abs', Math.abs],
]);
const CONSTANTS = new Map([['pi', Math.PI], ['π', Math.PI], ['e', Math.E]]);
const NAME_RE = /^[A-Za-zͰ-Ͽ][A-Za-z0-9_Ͱ-Ͽ]*$/;
const OBJECT_NAMES = new Set(Object.getOwnPropertyNames(Object.prototype));

// A Greek letter and its Latin spelling are one name. The micro sign (U+00B5) is read as mu.
const GREEK = {
  'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon', 'ϵ': 'epsilon', 'ζ': 'zeta',
  'η': 'eta', 'θ': 'theta', 'ϑ': 'theta', 'ι': 'iota', 'κ': 'kappa', 'λ': 'lambda', 'μ': 'mu',
  'µ': 'mu', 'ν': 'nu', 'ξ': 'xi', 'ο': 'omicron', 'π': 'pi', 'ρ': 'rho', 'σ': 'sigma',
  'ς': 'sigma', 'τ': 'tau', 'υ': 'upsilon', 'φ': 'phi', 'ϕ': 'phi', 'χ': 'chi', 'ψ': 'psi',
  'ω': 'omega',
  'Γ': 'Gamma', 'Δ': 'Delta', 'Θ': 'Theta', 'Λ': 'Lambda', 'Ξ': 'Xi', 'Π': 'Pi', 'Σ': 'Sigma',
  'Φ': 'Phi', 'Ψ': 'Psi', 'Ω': 'Omega',
};
/** A name with every Greek letter replaced by its Latin spelling (a letter with no spelling is kept). */
export const foldName = (s) => String(s).replace(/[µͰ-Ͽ]/g, (c) => GREEK[c] ?? c);

const fail = (code, message) => { const e = { symbolicError: true, code, message }; throw e; };
const refuse = (code, message) => ({ ok: false, code, message });

/* ── the variables a question allows ────────────────────────────────────────────────────────────────────── */

/** null when the list is a good set of variable names, else a plain sentence for staff. */
export function variableProblem(variables) {
  if (!Array.isArray(variables) || variables.length === 0) return 'Name at least one variable the answer may use.';
  if (variables.length > MAX_VARIABLES) return `A question may allow at most ${MAX_VARIABLES} variables.`;
  const seen = new Set();
  for (const v of variables) {
    if (typeof v !== 'string' || v === '') return 'A variable name cannot be empty.';
    if (v.length > MAX_NAME_CHARS) return `The variable name "${v.slice(0, 14)}" is longer than ${MAX_NAME_CHARS} characters.`;
    if (!NAME_RE.test(v)) return `The variable name "${v}" must start with a letter and use only letters, digits and underscores.`;
    const f = foldName(v);
    if (FUNCTIONS.has(f) || CONSTANTS.has(f) || f === 'log') return `"${v}" is a function or constant name and cannot also be a variable.`;
    if (OBJECT_NAMES.has(v) || OBJECT_NAMES.has(f)) return `"${v}" cannot be used as a variable name. Choose another.`;
    if (seen.has(f)) return `The variable "${v}" is listed twice (a Greek letter and its Latin spelling are the same name).`;
    seen.add(f);
  }
  return null;
}

/** null when `signed` is a good list of the question's variables that may be negative, else a plain sentence for staff. */
export function signedProblem(signed, variables) {
  if (signed === null || signed === undefined) return null;
  if (!Array.isArray(signed)) return 'The list of variables that can be negative must be a list.';
  const names = new Set((Array.isArray(variables) ? variables : []).map(foldName));
  for (const v of signed) {
    if (typeof v !== 'string' || !names.has(foldName(v))) return `"${String(v).slice(0, 14)}" is marked as able to be negative but is not one of the variables.`;
  }
  return null;
}

/* ── reading: characters, tokens, names ─────────────────────────────────────────────────────────────────── */

const SUPERSCRIPT = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6',
  '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-' };

const SUBSCRIPT_DIGITS = /[₀-₉]/g;
const FRACTIONS = { '½': '(1/2)', '¼': '(1/4)', '¾': '(3/4)' };

function normalize(text) {
  return text
    .replace(/µ/g, 'μ')                                     // the micro sign is the Greek mu
    .replace(SUBSCRIPT_DIGITS, (c) => String(c.charCodeAt(0) - 0x2080))   // v with a subscript 0 is v0
    .replace(/[½¼¾]/g, (c) => FRACTIONS[c])
    .replace(/√\s*\(/g, 'sqrt(')                                    // the square-root sign before a bracket
    .replace(/[−‒–—]/g, '-')
    .replace(/[×·⋅∙]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[     ]/g, ' ')
    .replace(/[⁺⁻]?[⁰¹²³⁴-⁹]+/g, (m) => `^(${[...m].map(c => SUPERSCRIPT[c]).join('')})`);
}

const ALLOWED_CHAR = /^[A-Za-z0-9_Ͱ-Ͽ.+\-*/^() \t]$/;

function badCharacter(text) {
  for (const c of text) {
    if (ALLOWED_CHAR.test(c)) continue;
    if (c === '=') fail('equals', 'Type just the expression, without an equals sign. For example, write m*a, not F = m*a.');
    if (c === ',') fail('bad_character', 'A comma is not used in an expression. Use * to multiply, and a decimal point for a decimal, for example 1.5.');
    if (c === '[' || c === ']' || c === '{' || c === '}') fail('bad_character', 'Use round brackets ( ) only.');
    if (c === '|') fail('bad_character', 'Vertical bars are not read. Write abs(x) for the absolute value.');
    if (c === '!') fail('bad_character', 'A factorial is not read. Write out the product.');
    const shown = c.codePointAt(0) < 32 ? 'a control character' : `"${c}"`;
    fail('bad_character', `I cannot read the character ${shown}. Use letters, digits, + - * / ^ and round brackets.`);
  }
}

function tokenize(text) {
  const tokens = [];
  const re = /\s+|(\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-zͰ-Ͽ][A-Za-z0-9_Ͱ-Ͽ]*|\*\*|[-+*/^()]|./gy;
  let m;
  let space = false;                                       // whitespace came just before the next token
  while ((m = re.exec(text)) !== null) {
    const s = m[0];
    if (/^\s/.test(s)) { space = true; continue; }
    const before = tokens.length;
    const sp = space;
    space = false;
    if (tokens.length >= MAX_TOKENS) fail('too_long', `That answer is too long to read. Keep it under ${MAX_TOKENS} symbols.`);
    if (m[1] !== undefined) {
      const v = Number(s);
      if (s.length > 30 || !Number.isFinite(v)) fail('number_range', 'A number in that answer is too large or has too many digits. Round it, or write it as a power of ten, like 3e8.');
      tokens.push({ t: 'num', v });
    } else if (/^[A-Za-zͰ-Ͽ]/.test(s)) {
      tokens.push({ t: 'id', v: s });
    } else if (s === '**') {
      tokens.push({ t: 'op', v: '^' });
    } else if (s === '.') {
      fail('incomplete', 'There is a stray decimal point in that answer.');
    } else {
      tokens.push({ t: 'op', v: s });
    }
    if (sp && tokens.length > before) tokens[before].sp = true;   // a space stood before this token
  }
  return tokens;
}

/**
 * Turn each name token into a variable, a constant, a function, or a product of names. A function name must be followed
 * by a bracket. A name that is none of these is split into names only when there is exactly ONE way to do it.
 */
function resolveNames(tokens, vocab, variables) {
  const out = [];
  const words = [...vocab].sort((a, b) => b.length - a.length);
  const unknown = (name) => {
    const lead = [...FUNCTIONS.keys()].find(f => name.startsWith(f) && name.length > f.length);
    const hint = lead ? ` If you meant ${lead} of something, write ${lead}( ) with brackets.` : '';
    fail('unknown_name', `I do not know "${name.slice(0, 16)}". This question allows: ${variables.join(', ')}.${hint} Units are not part of the answer.`);
  };
  // the ways to read one run of Latin letters as names: the words it is made of, or fail when there is no way or two
  const splitRun = (name) => {
    if (vocab.has(name)) return [name];
    const n = name.length;
    const ways = new Array(n + 1).fill(0);
    const pick = new Array(n + 1).fill(null);
    ways[n] = 1;
    for (let p = n - 1; p >= 0; p--) {
      let total = 0;
      for (const w of words) {
        if (name.startsWith(w, p) && ways[p + w.length] > 0) {
          if (total === 0) pick[p] = w;
          total = Math.min(2, total + ways[p + w.length]);
        }
      }
      ways[p] = total;
    }
    if (ways[0] === 0) unknown(name);
    if (ways[0] > 1) fail('ambiguous_name', `It is unclear how to read "${name.slice(0, 16)}" as a product of names. Put a space or * between them.`);
    const parts = [];
    for (let p = 0; p < n;) { const w = pick[p]; parts.push(w); p += w.length; }
    return parts;
  };
  let mark = -1;                                           // where the output of a token that had a space before it begins
  for (let i = 0; i < tokens.length; i++) {
    if (mark >= 0 && mark < out.length) out[mark].sp = true;
    const tk = tokens[i];
    mark = tk.sp ? out.length : -1;
    if (tk.t !== 'id') { out.push(tk); continue; }
    const name = tk.v;
    const next = tokens[i + 1];
    if (FUNCTIONS.has(name)) {
      if (!(next && next.t === 'op' && next.v === '(')) fail('function_brackets', `Write ${name} with brackets round its argument, for example ${name}(x).`);
      out.push({ t: 'fn', v: name });
      continue;
    }
    if (name === 'log') fail('log_unclear', 'It is unclear whether log means the natural logarithm or base 10. Write ln(x) for natural, or log10(x) for base 10.');
    const folded = foldName(name);
    if (vocab.has(folded)) { out.push({ t: 'id', v: folded }); continue; }
    // a run of names. A Greek letter is a name of its own: split the run at each one, then split each Latin stretch.
    const pieces = name.match(/[\u0370-\u03ff]|[^\u0370-\u03ff]+/g) || [name];
    for (const piece of pieces) {
      if (/^[\u0370-\u03ff]$/.test(piece)) {
        const f = foldName(piece);
        if (!vocab.has(f)) unknown(name);
        out.push({ t: 'id', v: f });
      } else {
        // a function name stuck to the names before it (the Greek letter pi then sqrt, or m g h then sin) when a bracket follows
        const last = piece === pieces[pieces.length - 1];
        const fn = last && next && next.t === 'op' && next.v === '(' && !vocab.has(piece)
          ? [...FUNCTIONS.keys()].sort((a, b) => b.length - a.length).find(f => piece.endsWith(f)) : undefined;
        if (fn) {
          const before = piece.slice(0, piece.length - fn.length);
          if (before !== '') for (const w of splitRun(before)) out.push({ t: 'id', v: w });
          out.push({ t: 'fn', v: fn });
        } else {
          for (const w of splitRun(piece)) out.push({ t: 'id', v: w });
        }
      }
      if (out.length > MAX_TOKENS) fail('too_long', `That answer is too long to read. Keep it under ${MAX_TOKENS} symbols.`);
    }
  }
  if (mark >= 0 && mark < out.length) out[mark].sp = true;
  return out;
}

/* ── the parser ─────────────────────────────────────────────────────────────────────────────────────────── */

function parseTokens(tokens) {
  let pos = 0;
  let depth = 0;
  let nodes = 0;
  const node = (n) => { if (++nodes > MAX_NODES) fail('too_long', 'That answer is too long to read. Make it shorter.'); return n; };
  const peek = () => tokens[pos];
  const isOp = (t, v) => t && t.t === 'op' && t.v === v;
  const nest = (f) => {
    if (++depth > MAX_DEPTH) fail('too_deep', 'That answer has too many brackets or signs inside one another. Simplify it.');
    try { return f(); } finally { depth--; }
  };
  const startsOperand = (t) => t && (t.t === 'num' || t.t === 'id' || t.t === 'fn' || isOp(t, '('));
  const describe = (t) => (t ? (t.t === 'num' ? String(t.v) : t.v) : 'the end');

  function parseExpr() {
    return nest(() => {
      let left = parseTerm();
      while (isOp(peek(), '+') || isOp(peek(), '-')) {
        const op = tokens[pos++].v;
        left = node({ k: 'bin', op, a: left, b: parseTerm() });
      }
      return left;
    });
  }
  function parseTerm() {
    let left = parseUnary();
    let lastWasDivide = false;
    let lastWasPlainFraction = false;                      // the division just read is a plain number over a plain number
    let lastWasNumber = left.k === 'num';
    for (;;) {
      const t = peek();
      if (isOp(t, '*') || isOp(t, '/')) {
        pos++;
        const op = t.v;
        const right = parseUnary();
        lastWasPlainFraction = op === '/' && left.k === 'num' && right.k === 'num';
        left = node({ k: 'bin', op, a: left, b: right });
        lastWasDivide = op === '/';
        lastWasNumber = right.k === 'num';
      } else if (startsOperand(t)) {
        // 1/2 m v^2 is (1/2)*m*v^2: a plain fraction, a space, then a factor. Without the space it stays unclear.
        if (lastWasDivide && lastWasPlainFraction && t.sp) left.frac = true;
        else if (lastWasDivide) fail('ambiguous_division', 'It is unclear whether you mean (a/b) times the next factor, or a divided by the product. Put brackets round the part you divide by, or write * to multiply.');
        if (t.t === 'num' && lastWasNumber) fail('missing_operator', 'Two numbers side by side. Put an operator between them, for example 3*4.');
        const right = parsePower();
        left = node({ k: 'bin', op: '*', a: left, b: right });
        lastWasDivide = false;
        lastWasPlainFraction = false;
        lastWasNumber = right.k === 'num';
      } else {
        return left;
      }
    }
  }
  function parseUnary() {
    const t = peek();
    if (isOp(t, '+') || isOp(t, '-')) {
      pos++;
      const neg = t.v === '-';
      const operand = nest(parseUnary);
      return neg ? node({ k: 'neg', a: operand }) : operand;
    }
    return parsePower();
  }
  function parsePower() {
    const base = parsePrimary();
    if (isOp(peek(), '^')) {
      pos++;
      return node({ k: 'bin', op: '^', a: base, b: nest(parseExponent) });
    }
    return base;
  }
  function parseExponent() {
    const t = peek();
    if (isOp(t, '+') || isOp(t, '-')) {
      pos++;
      const operand = nest(parseExponent);
      return t.v === '-' ? node({ k: 'neg', a: operand }) : operand;
    }
    return parsePower();
  }
  function parsePrimary() {
    const t = tokens[pos];
    if (!t) fail('incomplete', 'That answer ends too soon. Something is missing after the last symbol.');
    if (t.t === 'num') { pos++; return node({ k: 'num', v: t.v }); }
    if (t.t === 'id') {
      pos++;
      return node(CONSTANTS.has(t.v) ? { k: 'const', name: t.v === 'π' ? 'pi' : t.v, v: CONSTANTS.get(t.v) } : { k: 'var', name: t.v });
    }
    if (t.t === 'fn') {
      pos++;
      pos++;                                             // the "(" resolveNames checked is there
      const arg = parseExpr();
      if (!isOp(peek(), ')')) fail('brackets', peek() && isOp(peek(), '*') ? 'A function takes one argument.' : 'A bracket is not closed.');
      pos++;
      return node({ k: 'call', fn: t.v, a: arg });
    }
    if (isOp(t, '(')) {
      pos++;
      const inner = parseExpr();
      if (!isOp(peek(), ')')) fail('brackets', 'A bracket is not closed.');
      pos++;
      return inner;
    }
    if (isOp(t, ')')) fail('brackets', 'There is a closing bracket with no opening bracket, or an empty pair of brackets.');
    fail('incomplete', `I did not expect "${describe(t)}" there. Check that every + - * / ^ has something on each side.`);
  }

  const tree = parseExpr();
  if (pos < tokens.length) {
    const t = tokens[pos];
    if (isOp(t, ')')) fail('brackets', 'There is a closing bracket with no opening bracket.');
    fail('incomplete', `I did not expect "${describe(t)}" there.`);
  }
  return tree;
}

/* ── evaluating and printing a tree ─────────────────────────────────────────────────────────────────────── */

/** The value of a tree at one point. `env` is a Map from a variable name to a number. Always a number (maybe NaN or Infinity). */
export function evaluate(n, env) {
  switch (n.k) {
    case 'num': return n.v;
    case 'const': return n.v;
    case 'var': return env.get(n.name);
    case 'neg': return -evaluate(n.a, env);
    case 'call': return FUNCTIONS.get(n.fn)(evaluate(n.a, env));
    case 'bin': {
      const a = evaluate(n.a, env);
      const b = evaluate(n.b, env);
      switch (n.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return a / b;
        default: return Math.pow(a, b);
      }
    }
    default: return NaN;
  }
}

// How much a function changes its result for a small change in its argument x, whose own value is v at the point.
const SLOPE = {
  sin: () => 1, cos: () => 1, abs: () => 1, atan: (x) => 1 / (1 + x * x), tan: (x, v) => 1 + v * v,
  asin: (x) => 1 / Math.sqrt(1 - x * x), acos: (x) => 1 / Math.sqrt(1 - x * x), sinh: (x) => Math.cosh(x),
  cosh: (x) => Math.abs(Math.sinh(x)), tanh: (x, v) => 1 - v * v, sqrt: (x, v) => 1 / (2 * v), exp: (x, v) => v,
  ln: (x) => 1 / Math.abs(x), log10: (x) => 1 / (Math.abs(x) * Math.LN10),
};

/**
 * The value of a tree at one point AND a bound on the rounding error in it: { v, e }. Each operation adds the rounding of
 * its own result (ROUND * |result|) to the error it inherits from its operands. This is what lets a correct answer that
 * cancels (cosh(x)^2 - sinh(x)^2 against 1) pass, and what keeps the allowance in proportion to the numbers actually
 * involved: nothing is forgiven in absolute terms, so a key of 6.63e-34*f cannot be matched by 0. An error that is not a
 * finite number is taken as 0 (the strict comparison), never as "anything goes".
 */
export function evaluateWithError(n, env) {
  const fin = (x) => (Number.isFinite(x) ? x : 0);
  switch (n.k) {
    case 'num': case 'const': return { v: n.v, e: ROUND * Math.abs(n.v) };
    case 'var': { const v = env.get(n.name); return { v, e: ROUND * Math.abs(v) }; }
    case 'neg': { const a = evaluateWithError(n.a, env); return { v: -a.v, e: a.e }; }
    case 'call': {
      const a = evaluateWithError(n.a, env);
      const v = FUNCTIONS.get(n.fn)(a.v);
      return { v, e: fin(SLOPE[n.fn](a.v, v) * a.e) + ROUND * Math.abs(v) };
    }
    case 'bin': {
      const a = evaluateWithError(n.a, env);
      const b = evaluateWithError(n.b, env);
      let v; let e;
      switch (n.op) {
        case '+': v = a.v + b.v; e = a.e + b.e; break;
        case '-': v = a.v - b.v; e = a.e + b.e; break;
        case '*': v = a.v * b.v; e = Math.abs(a.v) * b.e + Math.abs(b.v) * a.e + a.e * b.e; break;
        case '/': v = a.v / b.v; e = (a.e + Math.abs(v) * b.e) / Math.abs(b.v); break;
        default: v = Math.pow(a.v, b.v); e = Math.abs(v) * (Math.abs(b.v) * a.e / Math.abs(a.v) + Math.abs(Math.log(Math.abs(a.v))) * b.e);
      }
      return { v, e: fin(e) + ROUND * Math.abs(v) };
    }
    default: return { v: NaN, e: 0 };
  }
}

const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, neg: 3, '^': 4 };
function print(n) {
  switch (n.k) {
    case 'num': return String(n.v);
    case 'const':
    case 'var': return n.name;
    case 'call': return `${n.fn}(${print(n.a)})`;
    case 'neg': return `-${wrap(n.a, PREC.neg)}`;
    default: {
      const p = PREC[n.op];
      const left = n.op === '^' ? wrap(n.a, p + 1) : wrap(n.a, p);
      const right = n.op === '^' ? wrap(n.b, p) : wrap(n.b, p + 1);
      const s = n.op === '^' ? `${left}^${right}` : `${left} ${n.op} ${right}`;
      return n.frac ? `(${s})` : s;                                  // a fraction read from "1/2 m" is shown bracketed
    }
  }
}
/** Bracket a child that binds more loosely than `need` requires. A negative number or a sign inside a power is bracketed. */
function wrap(n, need) {
  const own = n.k === 'bin' ? PREC[n.op] : n.k === 'neg' ? PREC.neg : 9;
  const s = print(n);
  return own < need ? `(${s})` : s;
}

function usedNames(n, set = new Set(), order = []) {
  if (n.k === 'var') { if (!set.has(n.name)) { set.add(n.name); order.push(n.name); } }
  else if (n.k === 'neg' || n.k === 'call') usedNames(n.a, set, order);
  else if (n.k === 'bin') { usedNames(n.a, set, order); usedNames(n.b, set, order); }
  return order;
}

/**
 * Read an expression.
 *   ok:  { ok: true, ast, used: [variable names, first use first], reading: "m * v^2 / 2" }
 *   not: { ok: false, code, message }   message is a plain sentence for the person who typed it.
 * `variables` are the names the question allows. Never throws; never executes the text.
 */
export function parseSymbolic(input, variables) {
  try {
    if (typeof input !== 'string') return refuse('not_text', 'Type your answer as an expression, for example m*v^2/2.');
    if (input.length > MAX_SYMBOLIC_CHARS) return refuse('too_long', `That answer is longer than ${MAX_SYMBOLIC_CHARS} characters. Shorten it.`);
    const text = normalize(input).trim();
    if (text === '') return refuse('empty', 'Type your answer first.');
    if (text.length > MAX_SYMBOLIC_CHARS) return refuse('too_long', `That answer is longer than ${MAX_SYMBOLIC_CHARS} characters. Shorten it.`);
    if (variableProblem(variables) !== null) return refuse('no_variables', 'This question has no variables set. Tell your instructor.');
    badCharacter(text);
    const vocab = new Set([...variables, ...CONSTANTS.keys()].map(foldName));
    const tokens = resolveNames(tokenize(text), vocab, variables);
    if (tokens.length === 0) return refuse('empty', 'Type your answer first.');
    const ast = parseTokens(tokens);
    return { ok: true, ast, used: usedNames(ast), reading: print(ast) };
  } catch (e) {
    if (e && e.symbolicError) return refuse(e.code, e.message);
    return refuse('unreadable', 'That answer could not be read. Check it and try again.');
  }
}

/* ── the test points ────────────────────────────────────────────────────────────────────────────────────── */

function hashText(s) {                                   // FNV-1a, 32 bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function generator(seed) {                               // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}

/**
 * The candidate points for a question: MAX_CANDIDATE_POINTS objects { variable: number }. Fixed by the variable names alone.
 * Points 0 to 5 are all positive (0.25 to 3); every sixth point is a larger magnitude (3 to 40). Every variable is
 * POSITIVE at every point, except a variable listed in `signed` (the ones staff marked "can be negative"), which has a
 * random sign at points 6 and after. The generator draws the same numbers whether or not a variable is signed, so marking
 * one never moves the magnitudes. No value is nearer zero than 0.25. Names are folded (theta and the Greek letter agree).
 */
export function testPoints(variables, signed = []) {
  const names = [...variables].map(foldName).sort();
  const canBeNegative = new Set((Array.isArray(signed) ? signed : []).map(foldName));
  const rand = generator(hashText(names.join('\u0001')));
  const points = [];
  for (let i = 0; i < MAX_CANDIDATE_POINTS; i++) {
    const p = {};
    for (const name of names) {
      const big = i % 6 === 5;
      const mag = big ? 3 + 37 * rand() : 0.25 + 2.75 * rand();
      const negative = i >= 6 && rand() < 0.5;
      p[name] = negative && canBeNegative.has(name) ? -mag : mag;
    }
    points.push(p);
  }
  return points;
}

/* ── the checker ────────────────────────────────────────────────────────────────────────────────────────── */

const keyFault = () => ({
  ok: false, keyFault: true, code: 'key_fault',
  message: 'There is a fault in this question, not in your answer. Nothing was counted against you. Tell your instructor.',
});

/**
 * Do two numbers agree at one point: |a - b| <= 1e-9 * max(|a|, |b|) + 4 * (the rounding error bounded in the two
 * expressions, `err`). Both must be finite. There is no absolute floor: a tiny key is judged against its own size.
 */
export const agree = (a, b, err = 0) => Math.abs(a - b) <= REL_TOL * Math.max(Math.abs(a), Math.abs(b)) + ERROR_ALLOWANCE * err;

/**
 * Compare two trees at the question's test points. Returns { points, equal } or { points: n } with equal undefined when the
 * key is defined at too few points to judge. `signed` lists the variables that may be negative (all others are positive).
 */
export function compareTrees(answer, key, variables, signed = []) {
  let used = 0;
  let equal = true;
  for (const p of testPoints(variables, signed)) {
    const env = new Map(Object.entries(p));
    const k = evaluateWithError(key, env);
    if (!Number.isFinite(k.v)) continue;                 // the key does not exist here: this point says nothing
    used++;
    const a = evaluateWithError(answer, env);
    if (!Number.isFinite(a.v) || !agree(a.v, k.v, k.e + a.e)) equal = false;
  }
  if (used < MIN_POINTS) return { points: used, equal: undefined };
  return { points: used, equal };
}

/**
 * Is a typed answer the same expression as the key?
 *   unreadable answer:  { ok: false, code, message }            nothing is marked, no attempt is used
 *   a fault in the key: { ok: false, keyFault: true, code: 'key_fault', message }   nothing is marked, no attempt is used
 *   a verdict:          { ok: true, correct, reading }
 * `keyExpression`, `variables` and `signed` (the variables that may be negative; none when omitted) come from the
 * question's key; they are never sent to a student.
 */
export function checkSymbolic(answerText, keyExpression, variables, signed = []) {
  if (variableProblem(variables) !== null) return keyFault();
  if (signedProblem(signed, variables) !== null) return keyFault();
  if (typeof keyExpression !== 'string' || keyExpression.trim() === '') return keyFault();
  const key = parseSymbolic(keyExpression, variables);
  if (!key.ok) return keyFault();
  const answer = parseSymbolic(answerText, variables);
  if (!answer.ok) return refuse(answer.code, answer.message);
  const res = compareTrees(answer.ast, key.ast, variables, signed || []);
  if (res.equal === undefined) return keyFault();
  return { ok: true, correct: res.equal, reading: answer.reading };
}

/**
 * What staff see beside a key: whether it reads, how, and whether it can be checked at all. Never throws.
 *   { ok: true, reading, points, used, negativeOn: [variables tested at negative values too] }   or   { ok: false, message }
 */
export function previewKey(keyExpression, variables, signed = []) {
  const v = variableProblem(variables);
  if (v) return { ok: false, message: v };
  const sp = signedProblem(signed, variables);
  if (sp) return { ok: false, message: sp };
  const key = parseSymbolic(keyExpression, variables);
  if (!key.ok) return { ok: false, message: key.message };
  const res = compareTrees(key.ast, key.ast, variables, signed || []);
  if (res.equal === undefined) {
    return { ok: false, message: 'This expression has no real value at almost every test point (for example, a square root or a logarithm of a negative number, or a variable you marked as able to be negative). Change it so it is defined for most values of the variables.' };
  }
  return { ok: true, reading: key.reading, points: res.points, used: key.used, negativeOn: (signed || []).map(foldName) };
}
