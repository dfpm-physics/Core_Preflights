// test-roster-import.mjs — the pure parsing and reconciliation rules in site/js/roster-import.js.
// No network, no login: these import the shipped module and exercise it directly.
//
// The fixtures below are deliberately nasty, because the real registrar export is. Every case
// here is one that the previous three-column parser got wrong or could not express.

import { check, eq, section, installBrowser } from './harness.mjs';
import {
  parseDelimited, sniffDelimiter, mapHeaders, normalizeName, emailProblem,
  studentIdProblem, rowMatchesCourse, identityFlags, termKey,
  parseRosterFile, reconcile, summarize,
  departures, returning, sectionMoves,
  REQUIRED_FIELDS,
  sectionDefaultsFrom,
} from '../../site/js/roster-import.js';

// The display half of the name pipeline lives in util.js, which resolves its icon base from
// location.pathname at import time — hence the stub and the dynamic import. roster-import.js
// itself needs neither; that is the whole point of it being pure.
installBrowser({ pathname: '/site/faculty/admin.html' });
const { lastFirst, splitName, initials } = await import('../../site/js/util.js');


/* ── Delimited parsing ─────────────────────────────────────────────────────── */
section('parseDelimited');

eq('splits a plain row', parseDelimited('a,b,c')[0].length, 3);
eq('keeps a comma inside quotes together',
   parseDelimited('"Doe, Jane",3001234567')[0][0], 'Doe, Jane');
eq('and does not shift the next column',
   parseDelimited('"Doe, Jane",3001234567')[0][1], '3001234567');
eq('unescapes a doubled quote',
   parseDelimited('"She said ""hi""",x')[0][0], 'She said "hi"');
eq('handles a newline inside quotes',
   parseDelimited('"line1\nline2",b').length, 1);
eq('normalises CRLF', parseDelimited('a,b\r\nc,d').length, 2);
eq('drops blank spacer rows', parseDelimited('a,b\n\n\nc,d').length, 2);
eq('parses tabs when asked', parseDelimited('a\tb\tc', '\t')[0].length, 3);

section('sniffDelimiter');
eq('detects comma', sniffDelimiter('a,b,c\n1,2,3'), ',');
eq('detects tab', sniffDelimiter('a\tb\tc\n1\t2\t3'), '\t');
eq('a comma inside one quoted header does not beat tabs',
   sniffDelimiter('Cadet Name\tEmail\tSquadron'), '\t');

/* ── Header mapping ────────────────────────────────────────────────────────── */
section('mapHeaders');

const REGISTRAR_HEADERS = [
  'Term', 'Class Nbr', 'Subject', 'Course Number', 'Course Title', 'Section',
  'Cadet EMPLID', 'Cadet Name', 'Final Grade', 'ESL', 'Scholars Program', 'Srvc Reasn',
  'Major 1', 'Major 2', 'Major 3', 'Minor 1', 'Minor 2', 'Minor 3',
  'Cadet Squadron', 'Sex', 'International', 'Sport', 'Cumulative GPA', 'MPA GPA',
  'PEA GPA', 'Core GPA', 'Email', 'Advisor Name', 'Unit Taken', 'Instructor Name(s)',
];
const m = mapHeaders(REGISTRAR_HEADERS);

eq('maps Cadet EMPLID', m.student_id, 6);
eq('maps Cadet Name', m.name, 7);
eq('maps Email past the GPA columns', m.email, 26);
eq('maps Cadet Squadron', m.squadron, 18);
eq('maps Section', m.section, 5);
eq('maps Advisor Name', m.advisor_name, 27);
eq('maps Major 1', m.major_1, 12);
eq('maps Major 2', m.major_2, 13);
check('every required field is mapped', REQUIRED_FIELDS.every(f => f in m),
      `missing: ${REQUIRED_FIELDS.filter(f => !(f in m)).join(', ')}`);

// The header spelling has already drifted once; matching must survive the next drift.
const drift = mapHeaders(['cadet_emplid', 'CADET NAME', 'e-mail', 'CadetSquadron']);
eq('tolerates snake_case', drift.student_id, 0);
eq('tolerates upper case', drift.name, 1);
eq('tolerates punctuation', drift.email, 2);
eq('tolerates removed spaces', drift.squadron, 3);

const legacy = mapHeaders(['student_id', 'name', 'section']);
eq('still accepts the legacy three-column header', legacy.student_id, 0);
eq('legacy name', legacy.name, 1);
eq('legacy section', legacy.section, 2);

// 'major' is an alias of major_1; it must not also satisfy major_2.
const oneMajor = mapHeaders(['Cadet EMPLID', 'Major']);
eq('a single Major column binds to major_1', oneMajor.major_1, 1);
check('and leaves major_2 unmapped', !('major_2' in oneMajor));

/* ── Value normalisation ───────────────────────────────────────────────────── */
section('normalizeName');

eq('flips Last, First to First Last', normalizeName('Doe, Jane'), 'Jane Doe');
eq('keeps a middle initial with the given names', normalizeName('Doe, Jane M.'), 'Jane M. Doe');
eq('leaves an already-First-Last name alone', normalizeName('Jane Doe'), 'Jane Doe');
eq('collapses runs of whitespace', normalizeName('  Doe,   Jane  '), 'Jane Doe');
eq('empty stays empty', normalizeName(''), '');
eq('a lone surname survives', normalizeName('Doe'), 'Doe');

/* ── The suffix round trip ─────────────────────────────────────────────────────
 * The registrar puts a generational suffix INSIDE the last-name field —
 * `"Fulkman IV,John William"` — so normalizeName() stores `John William Fulkman IV`, which is
 * right, and the display side then has to know that `IV` is not the surname. These two halves
 * are in different modules and were written years apart; that is exactly why the round trip is
 * pinned here rather than each half being tested against its own idea of the other.
 * Real case, 2026-08-10: fifteen cadets rendered as "IV, John William Fulkman".
 */
section('normalizeName -> lastFirst, with a generational suffix');

eq('the suffix stays with the surname on import',
   normalizeName('Fulkman IV,John William'), 'John William Fulkman IV');
eq('…and the display flip keeps it there',
   lastFirst(normalizeName('Fulkman IV,John William')), 'Fulkman IV, John William');
eq('Jr survives the same trip',
   lastFirst(normalizeName('Degenhart Jr,William Warren')), 'Degenhart Jr, William Warren');
eq('a one-given-name cadet too',
   lastFirst(normalizeName('Thomas Jr,Issac')), 'Thomas Jr, Issac');
eq('an ordinary name is untouched', lastFirst(normalizeName('Doe, Jane M.')), 'Doe, Jane M.');
eq('a surname that merely ENDS in a suffix letter is not peeled',
   lastFirst('Jane Ivy'), 'Ivy, Jane');
eq('two tokens are never split, or the surname would vanish',
   lastFirst('Jane Jr'), 'Jr, Jane');
eq('a trailing period on the suffix is tolerated',
   lastFirst('John Calvin North Jr.'), 'North Jr., John Calvin');
eq('splitName reports both halves', splitName('John William Fulkman IV'),
   { first: 'John William', last: 'Fulkman IV' });
eq('a lone name is all surname', splitName('Madonna'), { first: '', last: 'Madonna' });
eq('initials skip the suffix', initials('John William Fulkman IV'), 'JF');

section('emailProblem');
check('accepts a real address', emailProblem('jane.doe@afacademy.af.edu') === null);
check('rejects an empty cell', emailProblem('') !== null);
check('rejects a bare word', emailProblem('jane') !== null);
check('rejects a domain with no dot', emailProblem('jane@usafa') !== null);
check('rejects embedded whitespace', emailProblem('jane doe@usafa.edu') !== null);

section('studentIdProblem');
eq('accepts an in-range id', studentIdProblem('3001234567').value, 3001234567);
eq('strips incidental formatting', studentIdProblem(' 3001234567 ').value, 3001234567);
check('rejects out-of-range', studentIdProblem('1234567').error !== undefined);
check('rejects empty', studentIdProblem('').error !== undefined);

section('rowMatchesCourse');
check('matches subject + number',
      rowMatchesCourse({ subject: 'Phys', course_number: '215' }, 'phys-215'));
check('rejects another subject',
      !rowMatchesCourse({ subject: 'Chem', course_number: '215' }, 'phys-215'));
check('rejects another number',
      !rowMatchesCourse({ subject: 'Phys', course_number: '110' }, 'phys-215'));
check('a file with no course columns is treated as already scoped',
      rowMatchesCourse({ subject: '', course_number: '' }, 'phys-215'));

/* ── Course identity, field by field ─────────────────────────────────────────
 * A mismatch is a flag on a VALUE, not a verdict on a row, so that the operator can approve
 * "Course Number 215S" without also approving "Term Spring 2027" for a row that says both. */
section('identityFlags');

const keys = (row, opts) => identityFlags(row, opts).map(f => f.key).join(',');
const PHYS = { courseCode: 'phys-215', termCode: 'fall-2026' };

eq('a row that agrees raises nothing',
   keys({ subject: 'Phys', course_number: '215', term: 'Fall 2026' }, PHYS), '');
// The Fall 2026 case this was built for: the registrar exported 215 and 215S in one file.
eq('a suffixed catalog number is one flag, on its own value',
   keys({ subject: 'Phys', course_number: '215S' }, PHYS), 'course_number=215s');
eq('a wrong subject and a wrong number are two independent flags',
   keys({ subject: 'Chem', course_number: '100' }, PHYS), 'subject=chem,course_number=100');
eq('a wrong term is its own flag', keys({ course_number: '215', term: 'Spring 2027' }, PHYS),
   'term=spring-2027');

// Silence is not disagreement, in either direction — this is what keeps every file that used to
// import cleanly importing cleanly.
eq('a blank cell says nothing about the course', keys({ subject: '', course_number: '215' }, PHYS), '');
eq('a file with no course columns at all says nothing either', keys({}, PHYS), '');
eq('a term string this cannot read is not a wrong term', keys({ term: '1271' }, PHYS), '');
eq('an offering with no term of its own cannot catch one',
   keys({ term: 'Spring 2027' }, { courseCode: 'phys-215' }), '');

const flag = identityFlags({ subject: 'Phys', course_number: '215S' }, PHYS)[0];
eq('the flag quotes the file verbatim', flag.value, '215S');
eq('…beside what this course actually is', flag.expected, '215');
eq('…under the registrar column name', flag.label, 'Course Number');
eq('case and punctuation collapse, so one tick covers both spellings',
   identityFlags({ course_number: '215-s' }, PHYS)[0].key, flag.key);

section('termKey');
eq('the registrar spelling', termKey('Fall 2026'), 'fall-2026');
eq('the terms.code spelling normalises to the same thing', termKey('fall-2026'), 'fall-2026');
eq('spring', termKey('Spring 2027'), 'spring-2027');
// Refusing to guess is the point: a false term flag on every correct file teaches the operator
// to tick without reading, which defeats the whole mechanism.
eq('a numeric term code yields nothing rather than a guess', termKey('1271'), '');
eq('a season with no year is not a term', termKey('Fall'), '');

/* ── Whole-file parse ──────────────────────────────────────────────────────── */
section('parseRosterFile');

const KNOWN = { M1A: { id: 'sec-m1a', code: 'M1A' }, T3A: { id: 'sec-t3a', code: 'T3A' } };

const FILE = [
  'Term,Subject,Course Number,Course Title,Section,Cadet EMPLID,Cadet Name,Major 1,Cadet Squadron,Sex,Email,Advisor Name',
  // A normal row, with the comma-bearing name that broke the old parser.
  'Fall 2026,Phys,215,General Physics II,M1A,3001234567,"Doe, Jane M.",Astro,CS-07,F,jane.doe@afacademy.af.edu,"Smith, John"',
  // Another course entirely — must be excluded, and reported as such.
  'Fall 2026,Chem,100,General Chemistry,C1A,3007654321,"Roe, Richard",Chem,CS-13,M,r.roe@afacademy.af.edu,',
  // A section this offering does not have.
  'Fall 2026,Phys,215,General Physics II,Z9Z,3002222222,"Poe, Edgar",English,CS-01,M,e.poe@afacademy.af.edu,',
  // Bad cadet ID.
  'Fall 2026,Phys,215,General Physics II,T3A,999,"Bad, Row",Math,CS-02,M,b.row@afacademy.af.edu,',
  // Missing email — required.
  'Fall 2026,Phys,215,General Physics II,T3A,3003333333,"No, Email",Math,CS-02,M,,',
  // Duplicate cadet ID of line 2.
  'Fall 2026,Phys,215,General Physics II,T3A,3001234567,"Doe, Jane M.",Astro,CS-07,F,other@afacademy.af.edu,',
  // Valid second student.
  'Fall 2026,Phys,215,General Physics II,T3A,3004444444,"Fine, Sally",Physics,CS-30,F,s.fine@afacademy.af.edu,"Jones, Amy"',
].join('\n');

const parsed = parseRosterFile(FILE, { knownSections: KNOWN, courseCode: 'phys-215' });

eq('no file-level errors', parsed.errors.length, 0);
eq('keeps only the valid, in-course, known-section rows', parsed.rows.length, 2);
eq('and accounts for every other row', parsed.skipped.length, 5);

const jane = parsed.rows[0];
eq('name is stored First Last', jane.name, 'Jane M. Doe');
eq('email survives verbatim', jane.email, 'jane.doe@afacademy.af.edu');
eq('squadron is captured', jane.squadron, 'CS-07');
eq('major is captured', jane.major_1, 'Astro');
eq('advisor is flipped too', jane.advisor_name, 'John Smith');
eq('section is upper-cased', jane.section_code, 'M1A');
eq('term rides along', jane.term, 'Fall 2026');

const reasonFor = (id) => (parsed.skipped.find(s => s.raw.student_id === String(id)) || {}).code;
eq('the chemistry row is skipped as another course', reasonFor(3007654321), 'other-course');
eq('the unknown section is classified, not lumped in with bad data',
   reasonFor(3002222222), 'unknown-section');
eq('the bad id is invalid', reasonFor(999), 'invalid');
eq('the missing email is invalid', reasonFor(3003333333), 'invalid');
eq('unknown sections are surfaced for the create-sections offer',
   parsed.unknownSections.join(','), 'Z9Z');

const dupSkip = parsed.skipped.find(s => /duplicate/.test(s.reason));
check('the in-file duplicate names the line it collides with',
      !!dupSkip && /line 2/.test(dupSkip.reason), dupSkip?.reason);

// Missing required columns must stop the import outright, and say which.
const short = parseRosterFile('Cadet EMPLID,Cadet Name\n3001234567,"Doe, Jane"', {});
eq('a file without Email is rejected', short.rows.length, 0);
check('and the message names the missing column',
      /Email/.test(short.errors[0]), short.errors[0]);

/* ── Squadron is optional, at BOTH scales (director, 2026-07-28) ──────────────────────────────
 * It used to be required, and a cadet with an empty squadron cell was dropped from the import
 * entirely — losing a real name, email and section to protect an advisory, nullable column that
 * nothing reads. The row rule and the column rule go together: if one cadet may be imported
 * without a squadron, so may a file whose export never carried the column. */
check('Cadet Squadron is not a required column', !REQUIRED_FIELDS.includes('squadron'));

const noSq = parseRosterFile([
  'Section,Cadet EMPLID,Cadet Name,Email,Cadet Squadron',
  'M1A,3001234567,"Doe, Jane",jane.doe@afacademy.af.edu,CS-07',
  'M1A,3005555555,"Nosq, Sam",s.nosq@afacademy.af.edu,',
].join('\n'), { knownSections: KNOWN });
eq('a blank squadron cell no longer costs the cadet their row', noSq.rows.length, 2);
eq('…and nobody is skipped for it', noSq.skipped.length, 0);
eq('the blank is stored as NULL, not as an empty string', noSq.rows[1].squadron, null);
eq('…which is counted for the preview', noSq.noSquadron, 1);
eq('a squadron that IS present still lands', noSq.rows[0].squadron, 'CS-07');

// The whole column absent is the same rule one scale up.
const noSqCol = parseRosterFile([
  'Section,Cadet EMPLID,Cadet Name,Email',
  'M1A,3001234567,"Doe, Jane",jane.doe@afacademy.af.edu',
].join('\n'), { knownSections: KNOWN });
eq('a file with no Cadet Squadron column is accepted', noSqCol.errors.length, 0);
eq('…and imports its rows', noSqCol.rows.length, 1);
eq('…with a null squadron', noSqCol.rows[0].squadron, null);

/* An EMPTY section map is not the same as no map. Passing null turns the unknown-section check
 * off, which is what the admin page used to do for an offering with no sections yet — so a first
 * import parsed clean, offered to create nothing, and was then refused at commit. */
const firstImport = parseRosterFile(FILE, { knownSections: {}, courseCode: 'phys-215' });
eq('an empty section map classifies every row as unknown-section, not as valid',
   firstImport.rows.length, 0);
eq('…and surfaces the codes so the page can offer to create them',
   firstImport.unknownSections.slice().sort().join(','), 'M1A,T3A,Z9Z');

eq('an empty file is rejected', parseRosterFile('', {}).errors.length, 1);

// A tab-separated export of the same data must parse identically.
const tabbed = parseRosterFile(FILE.split('\n').map(l =>
  parseDelimited(l)[0].join('\t')).join('\n'), { knownSections: KNOWN, courseCode: 'phys-215' });
eq('a tab-separated export yields the same rows', tabbed.rows.length, 2);
eq('and the same names', tabbed.rows[0].name, 'Jane M. Doe');

/* ── Overriding a course/term mismatch ───────────────────────────────────────
 * Fall 2026: the registrar's Physics 215 export carried a second block numbered 215S, and 57
 * cadets were dropped with no way to say "those are mine" short of editing the file by hand.
 * The rule these assertions pin down is that an approval is granted to a CLAIM and spent per ROW:
 * approving 215S takes the rows whose only disagreement is 215S, and nothing else. */
section('parseRosterFile — overrides');

const MIXED = [
  'Term,Subject,Course Number,Section,Cadet EMPLID,Cadet Name,Email',
  'Fall 2026,Phys,215,M1A,3001234567,"Doe, Jane",jane.doe@afacademy.af.edu',
  'Fall 2026,Phys,215S,T3A,3005555555,"Ess, Sam",s.ess@afacademy.af.edu',
  'Fall 2026,Phys,215S,T3A,3006666666,"Ess, Pat",p.ess@afacademy.af.edu',
  // Two claims at once — the row that proves an approval is not a skeleton key.
  'Spring 2027,Phys,215S,T3A,3007777777,"Next, Term",n.term@afacademy.af.edu',
  // Flagged AND broken. Approving the flag must not import a row with no email.
  'Fall 2026,Phys,215S,T3A,3008888888,"Bad, Email",',
].join('\n');
const MOPTS = { knownSections: KNOWN, courseCode: 'phys-215', termCode: 'fall-2026' };

const strict = parseRosterFile(MIXED, MOPTS);
eq('with nothing approved, only the exact match is staged', strict.rows.length, 1);
eq('…and the other four are held as other-course',
   strict.skipped.filter(s => s.code === 'other-course').length, 4);

// What the page renders the control from: distinct claims with counts, not a list of rows.
eq('the file is reduced to its distinct claims, each with a row count',
   strict.identityGroups.map(g => `${g.key}:${g.rows}`).join(' '),
   'course_number=215s:4 term=spring-2027:1');
check('and none of them is approved yet', strict.identityGroups.every(g => !g.approved));

const ok = parseRosterFile(MIXED, { ...MOPTS, approved: ['course_number=215s'] });
eq('approving one claim admits the rows whose only disagreement it is', ok.rows.length, 3);
eq('…and says how many came in that way', ok.overridden, 2);
eq('…while an ordinary row is not marked as overridden', ok.rows[0].overrides.length, 0);

const spring = ok.skipped.find(s => s.raw.student_id === '3007777777');
eq('a row with a second, unapproved claim stays out', spring?.code, 'other-course');
check('…and its reason names only what is still unapproved',
      /Term "Spring 2027"/.test(spring?.reason) && !/215S/.test(spring?.reason), spring?.reason);
check('…and reads as a term problem rather than a course one',
      /not this term$/.test(spring?.reason), spring?.reason);

// An override lets a row be CONSIDERED. It does not let it in.
const bad = ok.skipped.find(s => s.raw.student_id === '3008888888');
eq('an overridden row still faces every other check', bad?.code, 'invalid');
check('…and now reports what is actually wrong with it', /email/i.test(bad?.reason), bad?.reason);

const all = parseRosterFile(MIXED, { ...MOPTS,
  approved: ['course_number=215s', 'term=spring-2027'] });
eq('approving both claims admits the two-claim row as well', all.rows.length, 4);
eq('…leaving only the genuinely broken row behind', all.skipped.length, 1);
check('…and the groups report themselves as approved for the checkboxes',
      all.identityGroups.every(g => g.approved));

// The count on the control must not collapse when the control is used — an operator who ticks a
// box has to be able to see what it did and untick it.
eq('an approved claim still reports how many rows it covers',
   all.identityGroups.find(g => g.key === 'course_number=215s').rows, 4);

/* ── Reconciliation ────────────────────────────────────────────────────────── */
section('reconcile');

const EXISTING = [
  // Same human, back from a previous term, with drifted details.
  { student_id: 3001234567, name: 'Jane Doe', email: 'jdoe@afacademy.af.edu',
    squadron: 'CS-13', sex: 'F', major_1: 'Astro', major_2: null, major_3: null,
    advisor_name: 'John Smith' },
];
const rec = reconcile(parsed.rows, EXISTING, new Set([3001234567]));

eq('a never-seen cadet is fresh', rec.fresh.length, 1);
eq('and a returning one is a conflict', rec.conflicts.length, 1);

const c = rec.conflicts[0];
eq('defaults to the non-destructive resolution', c.resolution, 'attach');
check('knows they are already enrolled here', c.alreadyEnrolled);
const changed = c.diffs.map(d => d.field).sort();
eq('lists exactly the fields that differ', changed.join(','), 'email,name,squadron');
check('and carries both sides for display',
      c.diffs.some(d => d.field === 'squadron' && d.from === 'CS-13' && d.to === 'CS-07'));

// An export missing a column must not read as "clear that field".
const sparse = reconcile(
  [{ student_id: 3001234567, name: 'Jane Doe', email: 'jdoe@afacademy.af.edu',
     squadron: 'CS-13', major_1: null, advisor_name: null }],
  EXISTING);
eq('an identical row produces no diffs', sparse.conflicts[0].diffs.length, 0);
check('and is marked trivial so the page need not ask', sparse.conflicts[0].trivial);

/* ── Departures: who is enrolled but not in the file ─────────────────────────
 *
 * The dangerous direction. Every assertion here is a way an over-eager version of this function
 * removes a cadet who never left — which is the failure mode that matters, because the operator's
 * only defence is a confirmation list they are being trained to trust.
 *
 * Scope is the WHOLE offering, deliberately. An earlier cut restricted departures to sections the
 * file itself covered, as a hedge against a partial export; the director's rule is that only
 * directors import and they import a whole course at a time, so the hedge bought nothing and cost
 * the reconciliation of any section the export omitted entirely.
 */
section('departures');

const ENROLLED = [
  { enrollment_id: 'en-1', status: 'active', student_id: 3001111111, name: 'Ann Alpha',  section_id: 's-m1a', section_code: 'M1A' },
  { enrollment_id: 'en-2', status: 'active', student_id: 3002222222, name: 'Ben Bravo',  section_id: 's-m1a', section_code: 'M1A' },
  { enrollment_id: 'en-3', status: 'active', student_id: 3003333333, name: 'Cal Charlie', section_id: 's-t3a', section_code: 'T3A' },
  { enrollment_id: 'en-4', status: 'dropped', student_id: 3004444444, name: 'Dot Delta', section_id: 's-m1a', section_code: 'M1A' },
];
const row = (id, code) => ({ student_id: id, section_code: code });
const file = (rows, skipped = []) => ({ rows, skipped });

const gone = departures(file([row(3001111111, 'M1A')]), ENROLLED);
eq('everyone the file does not name is a departure, in any section', gone.length, 2);
eq('…carrying the enrollment ids to drop', gone.map(d => d.enrollment_id).sort().join(','), 'en-2,en-3');

// The point of dropping the section scope: a whole-course export that has lost a section is
// exactly the case a director needs reconciled, and the old rule made it invisible.
check('a section absent from the file entirely is still reconciled',
      gone.some(d => d.section_code === 'T3A'));
eq('naming everybody proposes nobody',
   departures(file([row(3001111111, 'M1A'), row(3002222222, 'M1A'), row(3003333333, 'T3A')]),
              ENROLLED).length, 0);

// Already dropped is already removed. Re-proposing them every import grows the list without
// bound and is precisely how an operator learns to stop reading it.
check('an already-dropped enrollment is never re-proposed',
      !gone.some(d => d.enrollment_id === 'en-4'));

/* THE ONE REMAINING GUARD, and the reason it is not the scope rule in disguise: zero matched rows
 * is the signature of a WRONG FILE — bad course filter, wrong export, sections that do not exist
 * yet — and reading it as "remove the entire roster" is the worst thing this function could do.
 * The operator sees the parse errors instead. */
eq('a file that matched nothing proposes no removals at all', departures(file([]), ENROLLED).length, 0);
eq('…and so does a null parse', departures(null, ENROLLED).length, 0);
eq('no enrollments, no departures', departures(file([row(3001111111, 'M1A')]), null).length, 0);

/* A cadet named on a row that was SKIPPED for a data problem has not left — their row had a
 * malformed email or a bad cadet ID, which is reported separately for the operator to fix. Letting
 * a typo in one cell read as "this person left the course" is the subtle version of the same
 * failure the guard above prevents loudly. */
const skippedRow = { code: 'invalid', raw: { student_id: '3002222222' } };
check('a cadet on a skipped row is protected, not removed',
      !departures(file([row(3001111111, 'M1A')], [skippedRow]), ENROLLED)
        .some(d => d.enrollment_id === 'en-2'));
eq('…and a cadet ID with stray formatting still matches',
   departures(file([row(3001111111, 'M1A')], [{ code: 'invalid', raw: { student_id: '300-222-2222' } }]),
              ENROLLED).map(d => d.enrollment_id).join(','), 'en-3');
// An `other-course` skip is a row for a DIFFERENT course. It says nothing about this one, so it
// must not shield a cadet who really has left this offering.
eq('an other-course skip does not protect anybody',
   departures(file([row(3001111111, 'M1A')],
                   [{ code: 'other-course', raw: { student_id: '3002222222' } }]), ENROLLED)
     .map(d => d.enrollment_id).sort().join(','), 'en-2,en-3');
// …and the other half of that rule. Approving the claim is what changes the answer, and it changes
// it honestly: the row stops being skipped, so it protects its cadet like any other staged row.
eq('an overridden cadet IS named in the file, so they are not a departure',
   departures(all, [{ enrollment_id: 'en-x', status: 'active', student_id: 3007777777,
                      name: 'Term Next', section_id: 's-t3a', section_code: 'T3A' }]).length, 0);

// The file's ids arrive as numbers from studentIdProblem(); enrollment rows come back from
// PostgREST where a bigint can be a string. A === between the two silently removes everybody.
eq('a string student_id in the file still matches a numeric enrollment',
   departures(file([{ student_id: '3001111111', section_code: 'M1A' },
                    { student_id: '3002222222', section_code: 'M1A' },
                    { student_id: '3003333333', section_code: 'T3A' }]), ENROLLED).length, 0);

section('returning');

// The inverse, and the reason it is not optional: the enrollment upsert in commitRoster is
// ignoreDuplicates, so it finds a dropped row, changes nothing, and leaves them out of the course
// no matter how many correct exports name them afterwards.
const back = returning([row(3004444444, 'M1A')], ENROLLED);
eq('a dropped cadet named in the file is returning', back.length, 1);
eq('…carrying the enrollment id to reactivate', back[0].enrollment_id, 'en-4');
eq('an active cadet named in the file is not "returning" — they never left',
   returning([row(3001111111, 'M1A')], ENROLLED).length, 0);
eq('nobody named, nobody returning', returning([], ENROLLED).length, 0);

/* THE SECTION HAS TO MATCH. This assertion used to read the other way — "a dropped cadet is
 * returned even from a section the file otherwise covers differently", expecting 1 — on the
 * grounds that reactivating is the safe direction. It is not, once sectionMoves() exists: a cadet
 * who moved M5B -> M1B leaves a dropped M5B row behind, and a cadet-keyed match reactivates it on
 * the very next import, putting them back in a section they left WHILE they are active in the one
 * they are in. That is the duplicate-enrollment bug arriving by a second route. Reactivation means
 * "this enrollment is back", and only a file naming them in THAT section says so. (2026-08-10 —
 * the 25 rows the phys-215 repair dropped are exactly the rows the old rule would resurrect.) */
eq('a dropped enrollment is NOT revived when the file names that cadet in another section',
   returning([{ student_id: 3004444444, section_code: 'T3A' }], ENROLLED).length, 0);
eq('…and is revived when the file names them in the same section',
   returning([{ student_id: 3004444444, section_code: 'M1A' }], ENROLLED).length, 1);

/* ── section moves ─────────────────────────────────────────────────────────── */
section('sectionMoves');

// The plain case, and the whole reason this exists: the file puts an actively enrolled cadet
// somewhere else. Before 2026-08-10 the upsert inserted a second row and the old one stayed
// active, so the cadet held two enrollments and their work landed on an arbitrary one.
const m1 = sectionMoves([row(3001111111, 'T3A')], ENROLLED);
eq('a cadet the file puts in another section is a move', m1.moves.length, 1);
eq('…carrying the enrollment id to relocate', m1.moves[0].enrollment_id, 'en-1');
eq('…and the section to relocate it to', m1.moves[0].to_section_code, 'T3A');
eq('…and nothing ambiguous about it', m1.ambiguous.length, 0);

eq('a cadet already in the section the file names is not a move',
   sectionMoves([row(3001111111, 'M1A')], ENROLLED).moves.length, 0);
eq('a cadet with no enrollment at all is not a move — they are a new enrollment',
   sectionMoves([row(3009999999, 'M1A')], ENROLLED).moves.length, 0);
eq('a DROPPED enrollment is not moved — that is returning()\'s question',
   sectionMoves([row(3004444444, 'T3A')], ENROLLED).moves.length, 0);
eq('nobody named, nothing moved', sectionMoves([], ENROLLED).moves.length, 0);
eq('no enrollments, nothing moved', sectionMoves([row(3001111111, 'T3A')], null).moves.length, 0);

// Same string/number hazard departures() has: PostgREST hands back a bigint as a string.
eq('a string student_id in the file still matches a numeric enrollment',
   sectionMoves([{ student_id: '3001111111', section_code: 'T3A' }], ENROLLED).moves.length, 1);

/* WHAT IT REFUSES TO GUESS. Each of these is a repair, not an import, and writing anything would
 * be the same class of mistake as the bug — picking one of a cadet's rows because it sorted first
 * is exactly how the work ended up on the stale enrollment in the first place. */
const DUPED = [
  ...ENROLLED,
  { enrollment_id: 'en-5', status: 'active', student_id: 3001111111, name: 'Ann Alpha', section_id: 's-t3a', section_code: 'T3A' },
];
const m2 = sectionMoves([row(3001111111, 'M5A')], DUPED);
eq('a cadet already holding two active enrollments is ambiguous, not moved', m2.moves.length, 0);
eq('…and is reported for a human', m2.ambiguous.length, 1);
check('…with a reason naming both sections',
      /2 active/.test(m2.ambiguous[0].reason) && /M1A/.test(m2.ambiguous[0].reason));

// Moving INTO a section where the cadet already has a row would be a UNIQUE violation on
// (student_id, section_id) — and a question about which of the two rows owns their work.
const m3 = sectionMoves([row(3004444444, 'M1A')], [
  { enrollment_id: 'en-6', status: 'active', student_id: 3004444444, name: 'Dot Delta', section_id: 's-t3a', section_code: 'T3A' },
  { enrollment_id: 'en-4', status: 'dropped', student_id: 3004444444, name: 'Dot Delta', section_id: 's-m1a', section_code: 'M1A' },
]);
eq('a move onto an existing dropped row is ambiguous, not moved', m3.moves.length, 0);
check('…and says so', /already has a dropped enrollment in M1A/.test(m3.ambiguous[0].reason));

// One cadet on two rows of the same file is a broken export. There is no right answer to pick.
const m4 = sectionMoves([row(3001111111, 'T3A'), row(3001111111, 'T5B')], ENROLLED);
eq('a cadet named in two sections in one file is never moved', m4.moves.length, 0);
check('…and is reported as a bad file', /more than one section/.test(m4.ambiguous[0].reason));

section('summarize');
const sum = summarize(parsed, rec);
eq('counts every line in the file', sum.inFile, 7);
eq('counts the matched rows', sum.matched, 2);
eq('counts the skipped rows', sum.skipped, 5);
eq('counts the ones needing a human decision', sum.needsDecision, 1);
eq('lists the sections touched', sum.sections.join(','), 'M1A,T3A');
eq('counts nothing as overridden when nothing was', sum.overridden, 0);
eq('…and counts them when there were', summarize(all, reconcile(all.rows, [])).overridden, 3);
eq('reports no departures when it is not given any', sum.departing, 0);
eq('…and counts them when it is', summarize(parsed, rec, [{ enrollment_id: 'x' }]).departing, 1);

/* ── section defaults inferred from the code (the import path) ─────────────── */
section('sectionDefaultsFrom');

// This is the fix for the silent one-day-early bug: createSections() used to write
// meeting_days: [], which made resolveDueBySection() unable to place the section, so it inherited
// the offering default — the M-day date — on every lesson.
eq('M1A is an M-day section, period 1', sectionDefaultsFrom('M1A'), { meeting_days: ['M'], period: 1 });
eq('T3B is a T-day section, period 3', sectionDefaultsFrom('T3B'), { meeting_days: ['T'], period: 3 });
eq('lowercase is normalised', sectionDefaultsFrom('t1a'), { meeting_days: ['T'], period: 1 });
eq('W/R/F are recognised too, so this is not hardcoded to M and T',
   sectionDefaultsFrom('W2C'), { meeting_days: ['W'], period: 2 });

// The guard that keeps this a DEFAULT rather than the old read-time sniffing: a code that does
// not follow the convention must not be given an invented meeting day.
eq('a non-day letter yields no meeting day rather than an invented one',
   sectionDefaultsFrom('A1B'), { meeting_days: [], period: 1 });
eq('a code with no digit still infers the day', sectionDefaultsFrom('MA'), { meeting_days: ['M'], period: null });
eq('an empty code is survivable', sectionDefaultsFrom(''), { meeting_days: [], period: null });
eq('null is survivable', sectionDefaultsFrom(null), { meeting_days: [], period: null });
