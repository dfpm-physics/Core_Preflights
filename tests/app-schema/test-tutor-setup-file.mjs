// test-tutor-setup-file.mjs — the tutor setup file: its reader, its refusals, and how the setup page uses it.
// Offline: it reads files and runs the reader (site/js/tutor-setup-file.js) on small stand-in files. It makes no network call.
//
// WHAT THIS DEFENDS
//   * A good file gives back exactly the fields the tutor boxes hold, and nothing is saved by reading it.
//   * A bad file is refused in a plain sentence that names what is wrong: not JSON, wrong format, wrong version, no id, an id the form
//     would refuse, a link that is not http(s), a file for another course, an unusable objective key.
//   * Unknown fields are ignored, so a later version of the builder can add some.
//   * The page puts the file into the tutor boxes only, keeps the objectives for the next Save, never saves by itself, and offers a
//     button for the keyboard as well as the drop.
//
// WHAT THIS CANNOT PROVE
//   That a drop works in a real browser or that the objectives reach the database. The browser walk checks the first.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { check, eq, section, summary, REPO } from './harness.mjs';

const T = await import('../../site/js/tutor-setup-file.js');
const html = readFileSync(resolve(REPO, 'site/faculty/items.html'), 'utf8').replace(/\r\n/g, '\n');
const script = (html.match(/<script type="module">([\s\S]*?)<\/script>/) || [])[1] || '';
const markup = html.replace(/<script[\s\S]*?<\/script>/g, '');
const doc = readFileSync(resolve(REPO, 'docs/contracts/TUTOR-SETUP-FILE.md'), 'utf8');

const good = { format: 'prep-tutor', version: 1, slug: 'lesson-02-charge', course: 'phys-215', title: 'Electric charge', description: 'One line.',
  url: 'https://claude.ai/public/artifacts/abc', objective_keys: ['charge-conservation', 'coulomb'], lesson_no: 2 };
const read = (o, page = { course: 'phys-215' }) => T.parseTutorSetup(typeof o === 'string' ? o : JSON.stringify(o), page);
const problem = (o, page) => { const r = read(o, page); return r.ok ? '' : r.problem; };

section('a good file');
{
  const r = read(good);
  check('it is read', r.ok);
  eq('the fields the tutor boxes hold', [r.setup.slug, r.setup.title, r.setup.description, r.setup.url, r.setup.lessonNo, r.setup.course],
    ['lesson-02-charge', 'Electric charge', 'One line.', 'https://claude.ai/public/artifacts/abc', 2, 'phys-215']);
  eq('keys alone become objectives labelled with the key', r.setup.objectives, [{ key: 'charge-conservation', label: 'charge-conservation' }, { key: 'coulomb', label: 'coulomb' }]);
  eq('labelled objectives keep their labels, and a key listed twice is kept once', read({ ...good, objectives: [{ key: 'coulomb', label: 'Coulomb\'s law' }] }).setup.objectives,
    [{ key: 'coulomb', label: 'Coulomb\'s law' }, { key: 'charge-conservation', label: 'charge-conservation' }]);
  eq('only the required fields are enough', read({ format: 'prep-tutor', version: 1, slug: 'a-1', course: 'phys-110', title: 'T' }, { course: 'phys-110' }).setup,
    { slug: 'a-1', course: 'phys-110', title: 'T', description: '', url: '', lessonNo: null, objectives: [] });
  check('a field it does not know is ignored', read({ ...good, future_field: { a: 1 } }).ok);
  check('a byte-order mark and surrounding space do not matter', read('﻿  ' + JSON.stringify(good) + '\n').ok);
  check('the course is compared without regard to case', read({ ...good, course: 'PHYS-215' }).ok);
  check('no page course given: the course is not compared', read(good, {}).ok);
  check('the summary names title, id, link, course and the number of objectives', (() => {
    const t = summaryLines().join('|');
    return /Electric charge/.test(t) && /lesson-02-charge/.test(t) && /claude\.ai/.test(t) && /phys-215/.test(t) && /Objectives: 2/.test(t);
  })());
  function summaryLines() { return T.summaryLines(read(good).setup); }
}

section('a bad file is refused in plain words');
{
  const has = (o, re, name, page) => check(name, re.test(problem(o, page)));
  has('', /empty/, 'an empty file');
  has('{ not json', /not valid JSON/, 'not JSON');
  has('[1,2]', /not a tutor setup file/, 'a list');
  has({ ...good, format: 'other' }, /format.*prep-tutor/, 'the wrong format');
  has({ ...good, version: 2 }, /version 2.*version 1 only/, 'a version this page does not read');
  has({ ...good, slug: '' }, /no tutor id/, 'no id');
  has({ ...good, slug: 'Has Space' }, /lowercase letters, numbers and hyphens/, 'an id the form would refuse');
  has({ ...good, course: undefined }, /which course/, 'no course');
  has({ ...good, course: 'phys-110' }, /for phys-110, but this page is on phys-215/, 'a file for another course');
  has({ ...good, title: '' }, /no title/, 'no title');
  has({ ...good, title: 'x'.repeat(201) }, /200 characters/, 'a title that is too long');
  has({ ...good, description: 'x'.repeat(501) }, /500 characters/, 'a description that is too long');
  has({ ...good, url: 'ftp://x' }, /http:\/\/ or https:\/\//, 'a link that is not http(s)');
  has({ ...good, lesson_no: 1.5 }, /whole number/, 'a lesson number that is not whole');
  has({ ...good, lesson_no: 99999 }, /whole number/, 'a lesson number out of range');
  has({ ...good, objective_keys: 'a' }, /must be a list/, 'objective keys that are not a list');
  has({ ...good, objective_keys: ['ok', 'bad key!'] }, /objective key.*not usable/, 'an unusable objective key');
  has({ ...good, objective_keys: Array.from({ length: 21 }, (_, i) => 'k' + i) }, /at most 20/, 'too many objectives');
  check('a file over the size limit is refused', T.parseTutorSetup(' '.repeat(T.MAX_FILE_BYTES + 1), {}).ok === false);
  check('a refusal never throws and every one is a sentence', ['{', 'null', '"x"', '{"format":"prep-tutor"}', '{"format":"prep-tutor","version":1}']
    .every(t => { const r = T.parseTutorSetup(t, { course: 'phys-215' }); return !r.ok && /\.$/.test(r.problem); }));
}

section('the page: the drop, the button, and nothing saved by reading');
{
  check('the drop zone says what to drop', /Drop the tutor setup file here/.test(markup));
  check('a Choose file button and a file input are there for the keyboard', /id="i-drop-pick"/.test(markup) && /<input type="file" id="i-drop-file" accept="\.json,application\/json" hidden>/.test(markup));
  check('the page reads the file with the reader, comparing the page\'s own course', /parseTutorSetup\(text, \{ course: ctx\.currentCourseCode \}\)/.test(script));
  check('a refusal is shown in the drop area and no box is changed', /if \(!r\.ok\) \{ showFileError\(r\.problem\); return; \}/.test(script));
  check('only one file is taken from a drop', /files\.length !== 1/.test(script));
  check('a file that is too large is refused before it is read', /file\.size > MAX_FILE_BYTES/.test(script));
  const read2 = script.slice(script.indexOf('async function readTutorFile('), script.indexOf('function wireTutorFile('));
  check('reading fills the four tutor boxes', ['i-islug', 'i-iurl', 'i-ititle', 'i-idesc'].every(id => read2.includes(`$('${id}').value`)));
  check('reading writes nothing: no database call, no save', !/\bdb\b|save\(|createItem|updateItem|\.from\(/.test(read2));
  check('the objectives are kept for the next Save', /pendingObjectives = t\.objectives\.length \? t\.objectives : null/.test(read2));
  check('a saved assignment with another id is handled as a replacement, which the save asks about', /swapOn = !!\(cur && t\.slug !== cur\.slug\)/.test(read2));
  check('an assignment that cannot carry a tutor refuses the file in the page\'s own words', /I\.tutorRefusal\(editing\)/.test(read2));
  check('a summary is shown, with the reminder that nothing is saved yet', /summaryLines\(t\)/.test(read2) && /Nothing is saved until you click Save\./.test(read2));
  check('opening another form forgets the last file', /pendingObjectives = null; clearTutorFile\(\);/.test(script));
  check('the old prefill link still fills the same boxes', /set\('i-islug', f\.interactiveSlug\); set\('i-iurl', f\.interactiveUrl\)/.test(script));
}

section('the contract document');
{
  for (const need of ['prep-tutor', 'version', 'slug', 'course', 'title', 'url', 'objective_keys', 'lesson_no', 'ignored'])
    check(`the document names "${need}"`, doc.includes(need));
  check('it names assignments.objectives as where the objectives go', /assignments\.objectives/.test(doc));
  check('it says nothing is saved until Save is clicked', /Save/.test(doc));
}

process.exit(summary() ? 0 : 1);
