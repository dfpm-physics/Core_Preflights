// test-permission-block.mjs — the iPREP-primary lesson layout, rendered from the shipped page.
//
// Fall 2026 lessons 8-11: both paths carry credit, but the interactive IS the assignment and the
// written preflight is offered underneath it only with an instructor's permission. That layout is
// `permissionBlock()` in site/student/lessons.html, and the sentence it carries was written by the
// course director — so this reads the FUNCTION BODY OUT OF THE PAGE and runs it, rather than
// asserting against a copy. A reworded fallback fails here instead of shipping quietly.
//
// It sits with the offline suites (no network, no login) for the same reason test-modals.mjs does:
// the subject is a string in a page, and the page is a file.
//
// WHAT IT CANNOT SEE. It runs the function, not a browser — so it proves the markup and the copy,
// and proves nothing about how the CSS lays them out. The one-column grid and the dashed fallback
// panel still want a human's eyes on a real screen.

import { check, eq, section, summary, readRepoFile } from './harness.mjs';

/* ── Lift permissionBlock() out of site/student/lessons.html ──────────────────
 * Brace-balanced from the function's opening `{`, so the extraction survives the function growing
 * and fails loudly if it is renamed or removed — which is the point: a test that silently found
 * nothing would pass forever. */
const page = readRepoFile('site/student/lessons.html');
const start = page.indexOf('    function permissionBlock(l) {');
check('permissionBlock() is still in site/student/lessons.html', start >= 0);
if (start < 0) { summary(); process.exit(1); }

let depth = 0, end = -1;
for (let j = page.indexOf('{', start); j < page.length; j++) {
  if (page[j] === '{') depth++;
  else if (page[j] === '}' && --depth === 0) { end = j + 1; break; }
}
const src = page.slice(start, end);

// The page's own helpers, stubbed to something inspectable. Only their SHAPE matters here —
// launchRow's real markup is exercised where every other layout uses it.
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATE = { NOT_STARTED: 'not-started', DRAFT: 'draft' };
const launchRow = (l, where, opt) => `<LAUNCH where=${where} disabled=${!!opt?.disabled}>`;
const launchNote = () => '<NOTE>';
const writtenHref = l => `?a=${l.offeringId}`;

const permissionBlock = new Function(
  'esc', 'STATE', 'launchRow', 'launchNote', 'writtenHref',
  `${src}; return permissionBlock;`)(esc, STATE, launchRow, launchNote, writtenHref);

// The course director's wording, 2026-08-24. Verbatim, deliberately: this is the sentence a cadet
// is asked to act on, and paraphrasing it in a later edit changes what they were told.
const SENTENCE = 'If you are not able to complete the interactive iPREP and you have permission ' +
                 'from your instructor, you may complete the assignment using PREP.';

const norm = s => s.replace(/\s+/g, ' ');
// The sentence carries markup inside it (the permission clause is bold + underlined), so the
// wording check strips tags first. Checking the raw HTML instead would make every styling tweak
// look like a copy change, which is the opposite of what this file is for.
const text = s => norm(s.replace(/<[^>]*>/g, ''));
const base = { offeringId: 'off-1', points: 2, state: STATE.NOT_STARTED,
               interactiveAvailable: true, preflight: { questions: [{}, {}, {}] } };

/* ── The default state: nothing started, interactive live ──────────────────── */
section('permissionBlock — the offered fallback');

let html = norm(permissionBlock(base));
check("carries the director's sentence verbatim", text(permissionBlock(base)).includes(SENTENCE));
// The CONDITION is emphasised, not the whole sentence: a cadet skimming the box is deciding
// whether it applies to them, and this is the clause that decides it. Asserted as one unbroken
// run so a reformat that splits the tags across the clause fails here.
check('the permission clause is bold AND underlined',
      /<strong><u>and you have permission from your instructor<\/u><\/strong>/.test(
        norm(permissionBlock(base))));
check('the interactive is the headline', html.includes('Complete the interactive iPREP lesson'));
check('the interactive card is launchable', html.includes('<LAUNCH where=choice disabled=false>'));
check('the written path is given a working link', html.includes('href="?a=off-1"'));
check('an unstarted written path says Start writing', html.includes('>Start writing<'));
check('the switch warning survives — an interactive report still becomes the grade',
      html.includes('becomes your grade for this assignment'));
eq('the question count is shown, plural', html.includes('3 questions'), true);

/* ── The layout claim, which is the whole reason this block exists ──────────── */
// docs/architecture/STUDENT-LESSON-VIEW.md section 5 requires equal weight between the two paths.
// This lesson range is a recorded exception, and these checks are what "not equal" means in
// markup: ONE .choice-card, and the fallback rendered after it in a different container. If a
// later edit restores the pair, the exception has been undone by accident and this fails.
section('permissionBlock — the written path is subordinate, not a twin');

eq('exactly one .choice-card, so the two do not read as a pair',
   (html.match(/class="choice-card"/g) || []).length, 1);
check('the interactive card comes before the fallback panel',
      html.indexOf('choice-card') < html.indexOf('fallback-card'));
check('the grid is forced to a single column', html.includes('grid-template-columns:1fr'));

/* ── The states a cadet can actually be in ─────────────────────────────────── */
section('permissionBlock — draft, gated, and singular');

html = norm(permissionBlock({ ...base, state: STATE.DRAFT }));
check('a started draft says Resume writing', html.includes('>Resume writing<'));
check('the permission sentence is still there mid-draft',
      text(permissionBlock({ ...base, state: STATE.DRAFT })).includes(SENTENCE));

// A lesson whose interactive is not launchable yet must NOT withdraw the fallback: the cadet who
// cannot run iPREP is exactly the person reading this, and a dead button plus no alternative is
// the state that sends them to their instructor with nothing to do.
html = norm(permissionBlock({ ...base, interactiveAvailable: false,
                              interactiveGateReason: 'on Monday' }));
check('a gated interactive shows a disabled button, not a dead live one',
      html.includes('<LAUNCH where=choice disabled=true>'));
check('it says WHEN rather than just refusing', html.includes('Available on Monday'));
check('the written fallback is still offered while the interactive is gated',
      html.includes('href="?a=off-1"'));

html = norm(permissionBlock({ ...base, preflight: { questions: [{}] } }));
check('one question is "1 question", not "1 questions"', !html.includes('1 questions'));

// A malformed lesson must still render the sentence rather than throw: this layout is the last
// thing standing between a blocked cadet and a blank page.
const bare = { offeringId: 'off-2', state: STATE.NOT_STARTED,
               interactiveAvailable: true, preflight: null };
html = norm(permissionBlock(bare));
check('a lesson with no question set still renders the fallback',
      text(permissionBlock(bare)).includes(SENTENCE));
check('a missing points value falls back to 2', html.includes('2 points'));

summary();
