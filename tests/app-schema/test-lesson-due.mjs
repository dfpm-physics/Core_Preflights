// test-lesson-due.mjs — the assignment editor's deadline arithmetic, and the staff default
// password. (Faculty beta, 2026-07-27)
//
// WHY THIS EARNS ITS PLACE
//   Two of these are silent-wrong-answer bugs: nothing errors, a plausible number is stored, and
//   the only symptom is a student losing an evening or an account nobody can sign into.
//
//   1. TIME-ZONE. `endOfDay()` returned the naive string it was given — '2026-08-24T23:59:59' with
//      no offset. Postgres resolves that against the SESSION zone, which is UTC on Supabase, so a
//      deadline authored as 2359 was enforced at 1659 in Denver. It is now converted through a
//      real Date, and `toEditorDue()` is its inverse; a round trip that does not land back on the
//      same wall clock is the bug returning.
//
//   2. BACK-COMPATIBILITY. Every deadline already stored, and every prefill link (`due_m=`/`due_t=`
//      — a FROZEN contract), carries a bare 'YYYY-MM-DD'. A date with no time must still mean 2359,
//      or scheduling one lesson quietly moves the rest.
//
//   3. THE STAFF DEFAULT PASSWORD has three copies (this module, create-instructor,
//      reset-staff-password) because a Deno function and a browser module share no import path.
//      Only one can be tested here; what it pins is the RULE, so a copy that drifts is a diff
//      against a stated expectation rather than an account nobody can get into.
//
// Offline: every function under test is pure. The client below exists only because these modules
// import supabase.js, which throws at import when window.db is absent.

import { check, eq, section, summary, installBrowser, makeClient } from './harness.mjs';

installBrowser({ pathname: '/site/faculty/lessons.html' });
globalThis.window.db = makeClient();

const L = await import('../../site/js/faculty-lessons.js');
const A = await import('../../site/js/faculty-admin.js');

/* Local wall clock of an ISO instant, in the zone this process is running in — which is the same
   zone the browser code converts through. Comparing wall clocks rather than strings is the whole
   point: the UTC text differs by zone, the wall clock is what the director typed. */
const wall = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
       + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/* ── 1. A bare date still means 2359 local ────────────────────────────────── */

section('faculty-lessons.js — a date with no time');

const dateOnly = L.defaultDueFrom({ M: '2026-08-24' });
check('a date-only value produces a real UTC instant', /Z$/.test(dateOnly || ''));
eq('…landing on 2359:59 of that day, locally', wall(dateOnly), '2026-08-24 23:59:59');

/* ── 2. A date + time is honoured ─────────────────────────────────────────── */

section('faculty-lessons.js — a date with a time');

eq('an explicit time is stored as that local wall clock',
   wall(L.defaultDueFrom({ M: '2026-08-24T07:50' })), '2026-08-24 07:50:59');

// :59 rather than :00 — a deadline is inclusive of its minute, and :00 would make the last 59
// seconds of it late for no reason anyone could explain to a cadet.
check('…with seconds pinned to :59', /:59$/.test(wall(L.defaultDueFrom({ M: '2026-08-24T07:50' }))));

/* ── 3. Round trip ────────────────────────────────────────────────────────── */

section('faculty-lessons.js — toEditorDue is the inverse of endOfDay');

for (const entered of ['2026-08-24T23:59', '2026-08-24T07:50', '2026-12-31T00:05']) {
  const stored = L.defaultDueFrom({ M: entered });
  eq(`re-opening the editor shows what was typed (${entered})`, L.toEditorDue(stored), entered);
}
// The date-only path lands on the same place the time box defaults to, which is what makes the
// old bare-date lessons open with 23:59 already selected rather than looking edited.
eq('a legacy date-only deadline re-opens as 23:59',
   L.toEditorDue(L.defaultDueFrom({ M: '2026-08-24' })), '2026-08-24T23:59');

eq('an empty value round-trips to empty, not to the epoch', L.toEditorDue(''), '');
eq('…and an unparseable one does too', L.toEditorDue('not a date'), '');
eq('no dates at all means no default deadline', L.defaultDueFrom({}), null);

/* ── 4. The earliest per-day value is the offering default ────────────────── */

section('faculty-lessons.js — defaultDueFrom picks the earliest');

// "so nobody's default is late" — a section with no explicit row falls back to due_at, and that
// fallback must not be later than any day's real deadline.
eq('the earlier of two days wins',
   wall(L.defaultDueFrom({ M: '2026-08-25T23:59', T: '2026-08-24T23:59' })), '2026-08-24 23:59:59');

// The case string-sorting alone gets WRONG: '2026-08-24' sorts before '2026-08-24T08:00', but a
// bare date means 2359 and is therefore the LATER of the two. Resolving before comparing is what
// this pins.
eq('a bare date is compared as 2359, not as the start of the day',
   wall(L.defaultDueFrom({ M: '2026-08-24', T: '2026-08-24T08:00' })), '2026-08-24 08:00:59');

/* ── 5. dueByDayRow and dueRowsFor carry the time too ─────────────────────── */

section('faculty-lessons.js — the stored per-day map and per-section rows');

const row = L.dueByDayRow({ M: '2026-08-24T07:50', T: '2026-08-25', _all: '2026-08-26' });
eq('every real day letter is stored', Object.keys(row).sort(), ['M', 'T']);
eq('…with the time it was given', wall(row.M), '2026-08-24 07:50:59');
eq('…and a bare date still means 2359', wall(row.T), '2026-08-25 23:59:59');
// `_all` is the editor's placeholder for "this offering declares no meeting days". Storing it
// would create a key no section's meeting_days can ever match; due_at already covers that case.
check('the _all placeholder is not stored as a day', !('_all' in row));

const SECTIONS = [
  { id: 'sec-m', meeting_days: ['M'] },
  { id: 'sec-t', meeting_days: ['T'] },
  { id: 'sec-mwf', meeting_days: ['M', 'W', 'F'] },
  { id: 'sec-none', meeting_days: [] },
];
const rows = L.dueRowsFor('off-1', { M: '2026-08-24T07:50', T: '2026-08-25' }, SECTIONS);
eq('one row per section that has a matching day', rows.map(r => r.section_id).sort(),
   ['sec-m', 'sec-mwf', 'sec-t']);
eq('…a section with no declared day gets none (due_at covers it)',
   rows.some(r => r.section_id === 'sec-none'), false);
eq('…an M/W/F section takes the M time',
   wall(rows.find(r => r.section_id === 'sec-mwf').due_at), '2026-08-24 07:50:59');

/* ── 6. The staff default password ────────────────────────────────────────── */

section('faculty-admin.js — defaultStaffPassword');

eq('last name plus 1234, lowercased', A.defaultStaffPassword('Jane Doe'), 'doe1234');
eq('a hyphenated surname is cut at the hyphen', A.defaultStaffPassword('Jane Smith-Jones'), 'smith1234');
eq('a multi-word name takes the last token', A.defaultStaffPassword('Ana Maria De La Cruz'), 'cruz1234');
eq('a single name is treated as the surname', A.defaultStaffPassword('Cher'), 'cher1234');
eq('case and punctuation are stripped', A.defaultStaffPassword("Sean O'Neill"), 'oneill1234');
eq('extra whitespace does not change the answer', A.defaultStaffPassword('  Jane   Doe  '), 'doe1234');

// An empty derivation must be reported as empty, NOT as the bare string "1234" — both edge
// functions refuse to create or reset an account on it, and they can only do that if it is falsy.
eq('an empty name derives nothing', A.defaultStaffPassword(''), '');
eq('…and so does a surname with nothing alphanumeric in it', A.defaultStaffPassword('Jane ***'), '');

/* ── 7. The three copies of the rule must agree ───────────────────────────── */

section('the staff password rule has three copies — they may not drift');

// A structural check, not a behavioural one: the two edge functions cannot be imported here (Deno,
// remote https imports), so what is verified is that they still contain the same derivation. If
// somebody changes the rule in one place, this fails and names the others.
const { readFileSync } = await import('node:fs');
const DERIVATION = 'surname.split(/[-\\s]/)[0].replace(/[^A-Za-z0-9]/g, "").toLowerCase()';
for (const fn of ['create-instructor', 'reset-staff-password']) {
  const src = readFileSync(new URL(`../../supabase/functions/${fn}/index.ts`, import.meta.url), 'utf8');
  check(`${fn} derives the password the same way`, src.includes(DERIVATION));
  check(`${fn} refuses an empty derivation`, /Could not derive a default password/.test(src));
}
// No password parameter, in either the browser call or the reset function — that absence IS the
// security boundary (one person choosing another's credential), so it is asserted, not assumed.
const resetSrc = readFileSync(
  new URL('../../supabase/functions/reset-staff-password/index.ts', import.meta.url), 'utf8');
check('reset-staff-password refuses a supplied password rather than ignoring it',
      /body\.password !== undefined/.test(resetSrc));
check('…and flags the account for a forced rotation',
      /must_change_password: true/.test(resetSrc));

process.exit(summary() ? 0 : 1);
