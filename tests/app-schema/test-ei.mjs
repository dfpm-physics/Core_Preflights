// test-ei.mjs — extra-instruction logging.  (Roadmap P1.4)
//
// WHY THIS EARNS ITS PLACE
//   Two of the three things this module does are invisible when they are wrong, which is exactly
//   the profile that justifies a unit test:
//
//     1. TIME. `ei_sessions.started_at` is timestamptz stored UTC; the modal is an
//        <input type="datetime-local">, whose value is a local wall-clock string carrying no zone
//        at all. A sign error in that conversion produces a session logged an hour off — or six —
//        and it still looks like a perfectly ordinary row. Nobody audits it. Nothing complains.
//        The round-trip check below is the one that would catch it; a check of either direction
//        alone would not, because two matching sign errors cancel.
//     2. COUNTING. A bulk log writes one row per cadet sharing a batch_id, because a group sitting
//        is ONE sitting. Count rows instead and the dashboard tells a director they held 40
//        sessions when they held 9 — a flattering, plausible, entirely wrong number that nobody
//        has any reason to doubt.
//
//   The third thing — validation — is duplicated from the database constraints in migration 011
//   on purpose, so the operator gets a sentence rather than a Postgres constraint name. That
//   duplication is only worth anything if every rejection path really does return a sentence,
//   which is what the validateEi() section pins down.
//
// Offline: every function under test is pure. The client below exists only because faculty-ei.js
// imports supabase.js, which throws at import when window.db is absent — nothing here reaches the
// network (logEi/loadEi*/updateEi/deleteEi need a faculty session and are not covered).

import { check, eq, section, summary, installBrowser, makeClient } from './harness.mjs';

installBrowser({ pathname: '/site/app/faculty/gradebook.html' });
globalThis.window.db = makeClient();

const EI = await import('../../site/app/js/faculty-ei.js');

/* ══ 1. localInputValue ═══════════════════════════════════════════════════════ */

section('faculty-ei.js — localInputValue');

// Constructed with the local-time Date constructor and read back with the local getters, so these
// say the same thing in Denver, in Reykjavik, and on a laptop in Kathmandu's +05:45.
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi, 30, 500);

// Rounded DOWN to five minutes: the thing being logged is "the twenty minutes after class", not
// an instant, and a prefill reading 14:37 invites the operator to correct a number that never
// mattered.
eq('minutes floor to the nearest five', EI.localInputValue(at(2026, 7, 22, 14, 37)),
   '2026-07-22T14:35');
eq('an exact five-minute boundary is left alone', EI.localInputValue(at(2026, 7, 22, 14, 35)),
   '2026-07-22T14:35');
eq('the top of the hour stays at :00', EI.localInputValue(at(2026, 7, 22, 14, 0)),
   '2026-07-22T14:00');
// Floors, never rounds: :04 must not become :05, which would be a time that had not happened yet.
eq('four past the hour floors to :00', EI.localInputValue(at(2026, 7, 22, 14, 4)),
   '2026-07-22T14:00');
eq('fifty-nine past floors to :55', EI.localInputValue(at(2026, 7, 22, 14, 59)),
   '2026-07-22T14:55');

// datetime-local rejects a value that is not exactly YYYY-MM-DDTHH:MM, so every field is padded.
eq('month, day, hour and minute are all zero-padded',
   EI.localInputValue(at(2026, 1, 5, 9, 5)), '2026-01-05T09:05');
eq('midnight on the first is padded, not collapsed',
   EI.localInputValue(at(2026, 1, 1, 0, 0)), '2026-01-01T00:00');
check('the result always matches the datetime-local format',
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(EI.localInputValue(at(2026, 1, 5, 9, 5))));

// An unparseable date must yield '' — assigning 'Invalid Date' or 'NaN-NaN-NaN' to the input
// would silently blank the field with no explanation.
eq('an invalid Date yields an empty string', EI.localInputValue(new Date('nonsense')), '');
eq('a non-Date yields an empty string', EI.localInputValue('2026-07-22T14:35'), '');
eq('null yields an empty string', EI.localInputValue(null), '');

/* ══ 2. toUtcISO / fromUtcISO ═════════════════════════════════════════════════ */

section('faculty-ei.js — UTC conversion');

/* THE round trip. Either direction on its own can carry a sign error and still look right; only
 * composing them exposes it, because two mirrored errors cancel and a single one does not. Every
 * value here is already on a five-minute boundary, so the floor in localInputValue() is a no-op
 * and any difference is a timezone fault. */
for (const local of ['2026-07-22T14:35', '2026-01-05T09:05', '2026-01-01T00:00',
                     '2026-12-31T23:55', '2026-11-01T01:30']) {
  eq(`${local} survives the trip to UTC and back`, EI.fromUtcISO(EI.toUtcISO(local)), local);
}

check('the stored value really is UTC, not the local string passed through',
      /Z$/.test(EI.toUtcISO('2026-07-22T14:35')),
      `got ${EI.toUtcISO('2026-07-22T14:35')}`);
check('…and is a full ISO instant the database will accept',
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(EI.toUtcISO('2026-07-22T14:35')));

// Null rather than a throw or a bogus instant: validateEi() leans on this to tell an unreadable
// time apart from a missing one.
eq('an empty value converts to null', EI.toUtcISO(''), null);
eq('an unparseable value converts to null', EI.toUtcISO('garbage'), null);
eq('null converts to null', EI.toUtcISO(null), null);
eq('an empty ISO comes back as an empty field', EI.fromUtcISO(''), '');
eq('an unparseable ISO comes back as an empty field', EI.fromUtcISO('garbage'), '');
eq('null comes back as an empty field', EI.fromUtcISO(null), '');

/* ══ 3. fmtDuration ═══════════════════════════════════════════════════════════ */

section('faculty-ei.js — fmtDuration');

eq('under an hour reads in minutes', EI.fmtDuration(30), '30 min');
eq('a whole hour drops the minutes entirely', EI.fmtDuration(60), '1 h');
eq('an hour and a half reads as both parts', EI.fmtDuration(90), '1 h 30 min');
eq('fifty-nine minutes is still minutes', EI.fmtDuration(59), '59 min');
eq('two whole hours drop the minutes too', EI.fmtDuration(120), '2 h');
eq('a long session still reads at a glance', EI.fmtDuration(480), '8 h');

// A zero-length session is not a session. An em dash says "nothing here" without implying the
// meeting lasted no time.
eq('zero is a dash, not "0 min"', EI.fmtDuration(0), '—');
eq('a negative duration is a dash', EI.fmtDuration(-5), '—');
eq('NaN is a dash', EI.fmtDuration(NaN), '—');
eq('a non-numeric value is a dash', EI.fmtDuration('abc'), '—');
eq('null is a dash', EI.fmtDuration(null), '—');
eq('undefined is a dash', EI.fmtDuration(undefined), '—');

/* ══ 4. validateEi ════════════════════════════════════════════════════════════ */

section('faculty-ei.js — validateEi');

const valid = { startedAt: '2026-07-22T14:35', durationMinutes: 30,
                enrollmentIds: ['e1'], notes: 'Worked Gauss law problems.' };

eq('a complete, legal log is accepted', EI.validateEi(valid), null);
eq('…and notes are optional', EI.validateEi({ ...valid, notes: '' }), null);
eq('…and notes of exactly 4000 characters are still legal',
   EI.validateEi({ ...valid, notes: 'x'.repeat(4000) }), null);
eq('…and the duration ceiling itself is legal',
   EI.validateEi({ ...valid, durationMinutes: 480 }), null);

// Each rejection has to be a SENTENCE the operator can act on — the whole reason these rules are
// duplicated out of the migration-011 constraints instead of letting Postgres refuse the insert.
const rejections = [
  ['no students picked',        { ...valid, enrollmentIds: [] }],
  ['a null student list',       { ...valid, enrollmentIds: null }],
  ['no time given',             { ...valid, startedAt: '' }],
  ['a time that cannot be read', { ...valid, startedAt: 'last tuesdayish' }],
  ['a zero-minute session',     { ...valid, durationMinutes: 0 }],
  ['a negative duration',       { ...valid, durationMinutes: -30 }],
  ['a duration one minute over the ceiling', { ...valid, durationMinutes: 481 }],
  ['notes one character too long', { ...valid, notes: 'x'.repeat(4001) }],
];
for (const [why, input] of rejections) {
  const msg = EI.validateEi(input);
  check(`${why} is rejected with a sentence`,
        typeof msg === 'string' && msg.length > 0 && /[.!]$/.test(msg),
        `got ${JSON.stringify(msg)}`);
}

// An unreadable time and a missing time are different operator mistakes and must not share a
// message — "pick a date and time" is unhelpful advice to someone who already did.
check('an unreadable time is distinguished from a missing one',
      EI.validateEi({ ...valid, startedAt: 'last tuesdayish' })
        !== EI.validateEi({ ...valid, startedAt: '' }));

/* ══ 5. eiRows ════════════════════════════════════════════════════════════════ */

section('faculty-ei.js — eiRows');

const base = { instructorId: 'i1', startedAt: '2026-07-22T14:35', durationMinutes: 30,
               notes: 'After-class help.' };

const solo = EI.eiRows({ ...base, enrollmentIds: ['e1'] });
eq('one enrollment produces one row', solo.length, 1);
// A batch of one gets a NULL batch_id, matching migration 011. Minting a batch for every single
// log would make `batch_id IS NOT NULL` stop meaning "this was a group sitting" — which is the
// only question the column exists to answer, and what summarizeEi() counts on below.
eq('…with a null batch_id, so batch_id keeps meaning "group sitting"', solo[0].batch_id, null);
eq('…and carries the instructor and duration through',
   [solo[0].instructor_id, solo[0].duration_minutes], ['i1', 30]);

const group = EI.eiRows({ ...base, enrollmentIds: ['e1', 'e2', 'e3'] });
eq('three enrollments produce three rows', group.length, 3);
check('…every one with a batch_id', group.every((r) => r.batch_id));
eq('…and it is the SAME batch_id on all of them',
   new Set(group.map((r) => r.batch_id)).size, 1);
eq('…one row per enrollment, in order', group.map((r) => r.enrollment_id), ['e1', 'e2', 'e3']);

// Two separate bulk logs must not be conflated into one sitting.
check('a second batch gets a different batch_id',
      EI.eiRows({ ...base, enrollmentIds: ['e1', 'e2'] })[0].batch_id
        !== group[0].batch_id);
eq('an explicit batchId is honoured rather than regenerated',
   EI.eiRows({ ...base, enrollmentIds: ['e1', 'e2'], batchId: 'given' })
     .map((r) => r.batch_id), ['given', 'given']);

// A checkbox list can hand the same enrollment over twice; the row would violate nothing in the
// database, it would just charge one cadet for two sittings they did not have.
eq('duplicate enrollment ids are de-duplicated',
   EI.eiRows({ ...base, enrollmentIds: ['e1', 'e2', 'e1'] }).map((r) => r.enrollment_id),
   ['e1', 'e2']);
// …and a "batch" that de-duplicates down to one person is a solo log, not a group sitting.
eq('…and a list that collapses to one enrollment is back to a null batch_id',
   EI.eiRows({ ...base, enrollmentIds: ['e1', 'e1'] })[0].batch_id, null);
eq('falsy entries are dropped',
   EI.eiRows({ ...base, enrollmentIds: ['e1', null, '', undefined] }).map((r) => r.enrollment_id),
   ['e1']);
eq('an empty list produces no rows', EI.eiRows({ ...base, enrollmentIds: [] }), []);

// Empty notes must be NULL, not ''. A whitespace-only string would render as a notes row in the
// history panel that appears to say something and says nothing.
eq('empty notes become null', EI.eiRows({ ...base, notes: '', enrollmentIds: ['e1'] })[0].notes,
   null);
eq('whitespace-only notes become null',
   EI.eiRows({ ...base, notes: '   \n\t ', enrollmentIds: ['e1'] })[0].notes, null);
eq('omitted notes become null',
   EI.eiRows({ instructorId: 'i1', startedAt: '2026-07-22T14:35', durationMinutes: 30,
               enrollmentIds: ['e1'] })[0].notes, null);
eq('real notes are trimmed but kept',
   EI.eiRows({ ...base, notes: '  Gauss law.  ', enrollmentIds: ['e1'] })[0].notes, 'Gauss law.');

check('started_at is written as a UTC ISO instant',
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(solo[0].started_at),
      `got ${solo[0].started_at}`);
eq('…and it round-trips back to the value the operator typed',
   EI.fromUtcISO(solo[0].started_at), '2026-07-22T14:35');
eq('…identically for every row of a batch',
   new Set(group.map((r) => r.started_at)).size, 1);

/* ══ 6. summarizeEi ═══════════════════════════════════════════════════════════ */

section('faculty-ei.js — summarizeEi');

/* Six cadets in one after-class sitting, plus two individual visits. A director held THREE
 * sittings, not eight — counting rows is the mistake this shape exists to prevent, and it is the
 * kind of mistake that inflates a number in a flattering direction, so nobody questions it. */
const BATCH = 'b-1111';
const rows = [
  ...['e1', 'e2', 'e3', 'e4', 'e5', 'e6'].map((e, i) => ({
    id: `r${i + 1}`, enrollment_id: e, batch_id: BATCH, duration_minutes: 30,
    started_at: '2026-07-10T15:00:00.000Z',
  })),
  { id: 'r7', enrollment_id: 'e1', batch_id: null, duration_minutes: 45,
    started_at: '2026-07-12T09:00:00.000Z' },
  { id: 'r8', enrollment_id: 'e7', batch_id: null, duration_minutes: 20,
    started_at: '2026-07-14T09:00:00.000Z' },
];
const s = EI.summarizeEi(rows);

eq('total counts every row', s.total, 8);
eq('a six-person batch counts as ONE sitting, plus two solo visits, is three', s.sittings, 3);
eq('unique students counts the cadet seen twice only once', s.uniqueStudents, 7);
eq('total minutes sums every row, not every sitting', s.totalMinutes, 6 * 30 + 45 + 20);

// Two solo rows must never collapse into each other the way a shared batch does.
eq('two solo rows are two sittings, not one',
   EI.summarizeEi([{ id: 'a', batch_id: null, enrollment_id: 'e1' },
                   { id: 'b', batch_id: null, enrollment_id: 'e2' }]).sittings, 2);

eq('recent is capped at five', s.recent.length, 5);
eq('…newest first', s.recent.slice(0, 2).map((r) => r.id), ['r8', 'r7']);
check('…and strictly descending by started_at',
      s.recent.every((r, i) => i === 0
        || String(s.recent[i - 1].started_at) >= String(r.started_at)));

// With distinct timestamps the ordering is unambiguous, so this pins "the five newest" without
// leaning on sort stability for ties.
const dated = Array.from({ length: 7 }, (_, i) => ({
  id: `d${i}`, enrollment_id: `e${i}`, batch_id: null, duration_minutes: 15,
  started_at: `2026-07-0${i + 1}T12:00:00.000Z`,
}));
eq('recent is the five newest of seven, in descending order',
   EI.summarizeEi(dated).recent.map((r) => r.id), ['d6', 'd5', 'd4', 'd3', 'd2']);

// The dashboard widget renders this before any session has been logged, so the empty shape has to
// be numbers and an array rather than nulls and undefined.
const none = EI.summarizeEi([]);
eq('an empty list summarizes to zeroes and an empty list',
   [none.total, none.sittings, none.uniqueStudents, none.totalMinutes, none.recent],
   [0, 0, 0, 0, []]);
eq('null summarizes the same way', EI.summarizeEi(null).total, 0);
eq('falsy rows are ignored rather than counted',
   EI.summarizeEi([null, undefined, { id: 'x', batch_id: null, enrollment_id: 'e1',
                                      duration_minutes: 10 }]).total, 1);
eq('a row with an unreadable duration contributes zero minutes, not NaN',
   EI.summarizeEi([{ id: 'x', batch_id: null, enrollment_id: 'e1',
                     duration_minutes: 'oops' }]).totalMinutes, 0);

/* ── renderEiPanel — the dashboard tile (Roadmap P1.8) ───────────────────────
 *
 * Two behaviours carry the panel's honesty, and both are properties of the render rather than of
 * summarizeEi():
 *
 *   ZERO RENDERS NOTHING. Most instructors have no EI logged in week one, and a permanent `0`
 *   sitting on the dashboard teaches people to skip that region of the page — the same failure the
 *   due-out row's registry exists to avoid.
 *
 *   THE HEADLINE IS SITTINGS. summarizeEi() computes it correctly (above); this pins that the
 *   panel actually SHOWS that number rather than `total`, which is the easy slip and produces the
 *   flattering-and-wrong figure the module header warns about.
 */
section('faculty-ei.js — renderEiPanel');

const { esc } = await import('../../site/app/js/util.js');
const fmtDate = (iso) => String(iso || '').slice(0, 10);
const panelOpts = { esc, fmtDate, nameOf: (id) => ({ e1: 'Ada Byron', e2: 'Cadet Two' })[id] || '' };

eq('nothing logged renders nothing at all', EI.renderEiPanel({ total: 0 }, panelOpts), '');
eq('a null summary renders nothing', EI.renderEiPanel(null, panelOpts), '');

// Six cadets in one sitting plus one solo visit: 7 rows, 2 sittings, 7 cadets.
const batchRows = Array.from({ length: 6 }, (_, i) => ({
  id: `b${i}`, batch_id: 'batch-1', enrollment_id: `e${i}`, duration_minutes: 20,
  started_at: '2026-09-08T21:00:00Z', instructors: { name: 'Maj Doe' },
}));
const panel = EI.renderEiPanel(EI.summarizeEi([
  ...batchRows,
  { id: 'solo', batch_id: null, enrollment_id: 'e1', duration_minutes: 30,
    started_at: '2026-09-09T22:00:00Z', instructors: { name: 'Maj Doe' } },
]), panelOpts);

check('the headline is SITTINGS, not the row count', panel.includes('>2</div>'));
check('…and it says so, so 2 is not read as 2 cadets', panel.includes('a group counts once'));
check('the row count survives as cadets seen', /class="ei-n">6</.test(panel));
check('total time is stated', panel.includes('2 h 30 min'));
check('the mini-table names cadets, not enrollment uuids', panel.includes('Ada Byron'));
check('…and who logged it', panel.includes('Maj Doe'));
// Newest first, matching summarizeEi's `recent` — the solo visit is a day later than the batch.
check('the newest sitting is listed first',
      panel.indexOf('2026-09-09') < panel.indexOf('2026-09-08'));
check('a director is told the panel is scoped to what they teach',
      EI.renderEiPanel(EI.summarizeEi(batchRows), { ...panelOpts, scoped: true })
        .includes('your sections'));

// Student names reach this from the database, so they are untrusted here even though nobody is
// currently typing markup into a registrar export.
check('a cadet name is escaped',
      !EI.renderEiPanel(EI.summarizeEi(batchRows),
        { ...panelOpts, nameOf: () => '<img src=x onerror=alert(1)>' }).includes('<img src=x'));

process.exitCode = summary() ? 0 : 1;
