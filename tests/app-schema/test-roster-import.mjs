// test-roster-import.mjs — the pure parsing and reconciliation rules in site/app/js/roster-import.js.
// No network, no login: these import the shipped module and exercise it directly.
//
// The fixtures below are deliberately nasty, because the real registrar export is. Every case
// here is one that the previous three-column parser got wrong or could not express.

import { check, eq, section } from './harness.mjs';
import {
  parseDelimited, sniffDelimiter, mapHeaders, normalizeName, emailProblem,
  studentIdProblem, rowMatchesCourse, parseRosterFile, reconcile, summarize,
  REQUIRED_FIELDS,
  sectionDefaultsFrom,
} from '../../site/app/js/roster-import.js';


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
eq('a file without Email/Squadron is rejected', short.rows.length, 0);
check('and the message names the missing columns',
      /Email/.test(short.errors[0]) && /Squadron/.test(short.errors[0]), short.errors[0]);

eq('an empty file is rejected', parseRosterFile('', {}).errors.length, 1);

// A tab-separated export of the same data must parse identically.
const tabbed = parseRosterFile(FILE.split('\n').map(l =>
  parseDelimited(l)[0].join('\t')).join('\n'), { knownSections: KNOWN, courseCode: 'phys-215' });
eq('a tab-separated export yields the same rows', tabbed.rows.length, 2);
eq('and the same names', tabbed.rows[0].name, 'Jane M. Doe');

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

section('summarize');
const sum = summarize(parsed, rec);
eq('counts every line in the file', sum.inFile, 7);
eq('counts the matched rows', sum.matched, 2);
eq('counts the skipped rows', sum.skipped, 5);
eq('counts the ones needing a human decision', sum.needsDecision, 1);
eq('lists the sections touched', sum.sections.join(','), 'M1A,T3A');

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
