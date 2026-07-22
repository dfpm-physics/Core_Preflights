// test-student-detail.mjs — the per-student page's pure logic (roadmap P1.2).
//
// Named test-student-DETAIL to stay clear of test-student.mjs, which is a LIVE suite about the
// student-facing portal. Two different pages, opposite audiences; the collision would be a
// genuine trap for whoever ran the wrong one and believed the result.
//
// WHAT THIS SUITE IS PROTECTING
//   This page concentrates everything about one identifiable cadet on one screen, so three of the
//   rules below are privacy rules rather than correctness rules, and each is the kind that gets
//   quietly "simplified" by someone who does not know it is load-bearing:
//
//   1. backTarget() ALLOWLISTS. document.referrer is attacker-controllable — any page anywhere can
//      link here carrying any referrer — so a back link built from it unvalidated is an open
//      redirect. A same-origin check is NOT enough and the tests below encode why.
//   2. visibleQuestions() hides zero-point questions. Q1 is the reading-time reflection and
//      CORE.md §2 keeps it off per-student surfaces. grade.html:207,215 does the same filter; if
//      this one drifts, the privacy rule holds in one place and not the other.
//   3. commentCard() names the cadet, on purpose — it is addressed to a person about a person.
//      That is exactly why there must never be a "copy all" that runs it over a section. Nothing
//      here tests for the absence of a feature, but the reasoning belongs next to the tests.
//
//   The rest is arithmetic that two pages have to agree on: the gradebook and this page compute
//   totals from the SAME functions, and a divergence would show as a student whose row says 78%
//   in the grid and 82% on their own page.

import { check, eq, section, summary, installBrowser, makeClient } from './harness.mjs';

// faculty-student.js imports faculty-rollup.js -> supabase.js, which throws at import time when
// window.db is absent. Same reason test-tasks.mjs does this; it makes no network call.
installBrowser({ pathname: '/site/app/faculty/student.html' });
globalThis.window.db = makeClient();

const S = await import('../../site/app/js/faculty-student.js');
const { CELL } = await import('../../site/app/js/faculty-gradebook.js');

/* ══════════════════════════════════════════════════════════════════════════ */
section('backTarget — an allowlist, not a same-origin check');

eq('a plain gradebook referrer comes back', S.backTarget('https://x.test/site/app/faculty/gradebook.html'), 'gradebook.html');
eq('roster is allowed (the second real drill-down path)', S.backTarget('https://x.test/site/app/faculty/roster.html'), 'roster.html');
eq('grade is allowed', S.backTarget('https://x.test/site/app/faculty/grade.html?i=abc'), 'grade.html');
eq('no referrer at all falls back', S.backTarget(''), 'gradebook.html');
eq('undefined referrer falls back', S.backTarget(undefined), 'gradebook.html');

// The three that matter. Each is a real shape an open redirect takes.
eq('an OFF-SITE referrer does not become the back link',
   S.backTarget('https://evil.test/phish.html'), 'gradebook.html');
eq('an off-site referrer that ENDS IN an allowed name is still refused by origin-independence',
   // It resolves to 'gradebook.html' by filename, which is the point: the function returns a bare
   // relative filename, never the referrer itself, so even a match cannot navigate off-site.
   S.backTarget('https://evil.test/gradebook.html'), 'gradebook.html');
eq('a javascript: referrer cannot survive', S.backTarget('javascript:alert(1)'), 'gradebook.html');
eq('a protocol-relative referrer cannot survive', S.backTarget('//evil.test/x.html'), 'gradebook.html');
eq('an unlisted faculty page falls back rather than being trusted',
   S.backTarget('https://x.test/site/app/faculty/system.html'), 'gradebook.html');
eq('the login page is not a back target', S.backTarget('https://x.test/site/app/login.html'), 'gradebook.html');
check('the return value is always a bare relative filename, never a URL',
      !S.backTarget('https://evil.test/whatever').includes('//'),
      'a value containing // could navigate off-origin');

/* ══════════════════════════════════════════════════════════════════════════ */
section('visibleQuestions — zero-point questions stay hidden (CORE.md §2)');

const QS = [
  { id: 'q1', prompt: 'How long did you spend reading?', points: 0 },
  { id: 'q2', prompt: 'Reading reflection', points: 1 },
  { id: 'q3', prompt: 'Free response', points: 1 },
];
eq('Q1 is filtered out', S.visibleQuestions(QS).map(q => q.id), ['q2', 'q3']);
eq('a question with points missing entirely is treated as zero-point and hidden',
   S.visibleQuestions([{ id: 'qx', prompt: 'x' }]).map(q => q.id), []);
eq('an empty list is safe', S.visibleQuestions([]), []);
eq('null is safe', S.visibleQuestions(null), []);
check('filtering is by the points PROPERTY, not by position',
      S.visibleQuestions([{ id: 'a', points: 1 }, { id: 'b', points: 0 }]).length === 1
      && S.visibleQuestions([{ id: 'a', points: 1 }, { id: 'b', points: 0 }])[0].id === 'a',
      'LEGACY-AUDIT:102-108 flags position-based anonymity as the defect to avoid');

/* ══════════════════════════════════════════════════════════════════════════ */
section('lessonRows — the two layers stay apart');

const PAST = new Date('2026-07-01T23:59:00Z').toISOString();
const FUTURE = new Date('2026-09-01T23:59:00Z').toISOString();
const NOW = new Date('2026-08-01T12:00:00Z');
const SEC = 'sec-M1A';

const offering = (id, slug, dueAt, extra = {}) => ({
  offeringId: id, slug, title: slug, dueAt, position: 0, pointsPossible: 2,
  dueBySection: {}, gradingMode: 'points', written: null, interactive: null, ...extra,
});

const base = {
  enrollment: { enrollmentId: 'e1', sectionId: SEC, studentId: 3000000001, sectionCode: 'M1A' },
  extensions: [], submissions: [], grades: [],
  offerings: [offering('o1', 'preflight-01', PAST), offering('o2', 'preflight-02', FUTURE)],
  now: NOW,
};

{
  const rows = S.lessonRows(base);
  eq('one row per published offering', rows.length, 2);
  eq('rows are in due order', rows.map(r => r.slug), ['preflight-01', 'preflight-02']);
  eq('a past lesson with nothing submitted is MISSING', rows[0].cell.state, CELL.MISSING);
  eq('a future lesson with nothing submitted is PENDING', rows[1].cell.state, CELL.PENDING);
  eq('shortcodes come through for the table', rows.map(r => r.code), ['PF01', 'PF02']);
}

{
  // The separation this whole module is built around: a diagnostic must never reach the points.
  const rows = S.lessonRows({
    ...base,
    grades: [{
      assignment_offering_id: 'o1', points_earned: 2, points_possible: 2, is_finalized: true,
      // 0-5 diagnostics, deliberately DIFFERENT numbers from the points so a leak is visible.
      diagnostic: { q2_effort: 4, q3_understanding: 3 },
    }],
  });
  eq('points are the grade', rows[0].cell.points, 2);
  eq('effort is read from the diagnostic, not the points', rows[0].effort, 4);
  eq('understanding is read from the diagnostic', rows[0].understanding, 3);
  check('the diagnostic never becomes the grade',
        rows[0].cell.points === 2 && rows[0].understanding === 3,
        'ROADMAP Q2: measurement is 0-5, the grade is 2 points, and they are different layers');
}

{
  const rows = S.lessonRows({
    ...base,
    grades: [{ assignment_offering_id: 'o1', points_earned: 1, points_possible: 2, is_finalized: false }],
  });
  eq('an unfinalized grade is DRAFT, not GRADED', rows[0].cell.state, CELL.DRAFT);
}

{
  // The extension case — the specific bug faculty-data.js:148 has and this must not.
  const rows = S.lessonRows({
    ...base,
    extensions: [{ assignment_offering_id: 'o1', extended_due_at: FUTURE }],
  });
  eq('a student inside an unexpired extension is PENDING, not MISSING', rows[0].cell.state, CELL.PENDING);
  check('…and the row is flagged as extended so the instructor can see why', rows[0].extended === true);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('studentTotals — agrees with the gradebook by construction');

{
  const rows = S.lessonRows({
    ...base,
    grades: [{ assignment_offering_id: 'o1', points_earned: 1, points_possible: 2, is_finalized: true }],
  });
  const t = S.studentTotals(rows);
  eq('only the DUE lesson is counted', t.counted, 1);
  eq('earned', t.earned, 1);
  eq('possible excludes the not-yet-due lesson', t.possible, 2);
  eq('pct', t.pct, 0.5);
  eq('a band is attached for rendering', t.band.key, 'd1');
}

{
  const t = S.studentTotals(S.lessonRows({ ...base, offerings: [offering('o2', 'preflight-02', FUTURE)] }));
  eq('a term where nothing has come due yet has pct null, not 0', t.pct, null);
  check('…and no band, so nothing renders a colour for it', t.band === null,
        'a cadet reading 0% in week one because 39 lessons they cannot have done are counted '
        + 'against them is the failure this rule exists to prevent');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('foldMisconceptions — the same canonicalization the rollup uses');

{
  const rows = [
    { code: 'PF01', title: 'One', offeringId: 'o1',
      report: { misconceptions: [{ id: 'Scalar-Sum', description: 'Adds magnitudes' }] } },
    { code: 'PF02', title: 'Two', offeringId: 'o2',
      report: { misconceptions: [{ id: 'scalar sum' }, { id: 'shielding' }] } },
    { code: 'PF03', title: 'Three', offeringId: 'o3',
      report: { misconceptions: ['scalar-sum'] } },
  ];
  const folded = S.foldMisconceptions(rows);
  eq('three spellings of one id fold to one bar', folded.length, 2);
  eq('the repeat sorts first', folded[0].id, 'scalar-sum');
  eq('…and is counted across all three lessons', folded[0].count, 3);
  eq('the lessons it appeared in are named', folded[0].lessons.map(l => l.code), ['PF01', 'PF02', 'PF03']);
  check('a description survives even when only one occurrence carried it',
        folded[0].description === 'Adds magnitudes',
        'both producers emit description; both counting sites used to drop it (P0.13)');
  eq('a bare string misconception is accepted', folded[1].id, 'shielding');
}

eq('no reports at all is safe', S.foldMisconceptions([]), []);
eq('a row with no report is skipped', S.foldMisconceptions([{ code: 'X' }]), []);
eq('a malformed misconceptions field is skipped',
   S.foldMisconceptions([{ code: 'X', report: { misconceptions: 'nope' } }]), []);

/* ══════════════════════════════════════════════════════════════════════════ */
section('commentCard — plain text, and it must not lie');

{
  const rows = S.lessonRows({
    ...base,
    offerings: [offering('o1', 'preflight-01', PAST), offering('o3', 'preflight-03', PAST)],
    grades: [{ assignment_offering_id: 'o1', points_earned: 2, points_possible: 2, is_finalized: true,
               diagnostic: { q3_understanding: 4 } }],
  });
  const totals = S.studentTotals(rows);
  const txt = S.commentCard({
    student: { name: 'Jane Cadet' },
    enrollment: { studentId: 3000000001, sectionCode: 'M1A' },
    totals, rows, ei: [], classStats: { median: 0.75 },
  });

  check('names the cadet', txt.includes('Jane Cadet'));
  check('states the grade as earned/possible AND a percentage', txt.includes('2 / 4') && txt.includes('50%'));
  check('lists missing work by name', txt.includes('preflight-03'),
        '"you have one missing assignment" starts an argument; naming it ends one');
  check('compares to the section median', txt.includes('75%'));
  check('says how far from the median, in the right direction', txt.includes('below'));
  check('surfaces the 0-5 understanding separately from the grade', txt.includes('/ 5'));
  check('is plain text — no markup leaks in', !/[<>]/.test(txt));
}

{
  const rows = S.lessonRows({ ...base, offerings: [offering('o1', 'preflight-01', PAST)],
    grades: [{ assignment_offering_id: 'o1', points_earned: 2, points_possible: 2, is_finalized: true }] });
  const txt = S.commentCard({
    student: { name: 'Ada' }, enrollment: { studentId: 1, sectionCode: 'T3B' },
    totals: S.studentTotals(rows), rows, ei: [],
  });
  check('a cadet with nothing missing is told so explicitly, not left to infer it',
        txt.includes('Missing work: none'));
  check('no section comparison is printed when none was loaded', !txt.includes('median'),
        'the comparison is an optional async read; absent must mean silent, not a wrong number');
}

{
  const rows = S.lessonRows(base);
  const txt = S.commentCard({
    student: { name: 'Ada' }, enrollment: { studentId: 1, sectionCode: 'T3B' },
    totals: S.studentTotals(rows), rows,
    ei: [{ started_at: '2026-08-15T20:00:00Z', duration_minutes: 30 }],
    freeText: 'Spoke after class about vectors.',
  });
  check('EI attendance is summarized', txt.includes('Extra instruction: 1 session'));
  check('the instructor free-text is appended verbatim', txt.includes('Spoke after class about vectors.'));
}

summary();
