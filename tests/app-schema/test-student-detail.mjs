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
//   The rest is about ONE calculation: neither this page nor the gradebook computes a total. Both print what the
//   database functions gradebook_cells and course_totals return, so a cadet's row cannot say 78% in the grid and
//   82% here, or 90% where the database holds 89.9.

import { check, eq, section, summary, installBrowser, makeClient } from './harness.mjs';

// faculty-student.js imports faculty-rollup.js -> supabase.js, which throws at import time when
// window.db is absent. Same reason test-tasks.mjs does this; it makes no network call.
installBrowser({ pathname: '/site/faculty/student.html' });
globalThis.window.db = makeClient();

const S = await import('../../site/js/faculty-student.js');
const { CELL } = await import('../../site/js/faculty-gradebook.js');

/* ══════════════════════════════════════════════════════════════════════════ */
section('backTarget — an allowlist, not a same-origin check');

eq('a plain gradebook referrer comes back', S.backTarget('https://x.test/site/faculty/gradebook.html'), 'gradebook.html');
// Course Admin's Students tab is the second real drill-down path, since 2026-07-23 — it replaced
// the standalone roster page, which no longer exists.
eq('course admin is allowed', S.backTarget('https://x.test/site/faculty/admin.html'), 'admin.html');
eq('the deleted roster page is NOT allowed', S.backTarget('https://x.test/site/faculty/roster.html'), 'gradebook.html');
eq('grade is allowed', S.backTarget('https://x.test/site/faculty/grade.html?i=abc'), 'grade.html');
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
   S.backTarget('https://x.test/site/faculty/system.html'), 'gradebook.html');
eq('the login page is not a back target', S.backTarget('https://x.test/site/login.html'), 'gradebook.html');
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

// A row of gradebook_cells for this cadet. The page never decides a state; it prints this one.
const dbc = (o = {}) => ({ enrollment_id: 'e1', section_id: SEC, assignment_offering_id: 'o1', state: 'released', has_draft_score: false,
  is_late: false, no_work_received: false, deadline_invalid: false, late_closed: false, points_earned: 2, points_possible: 2, ...o });
const dbt = (o = {}) => ({ enrollment_id: 'e1', section_id: SEC, student_id: 3000000001, earned_text: '2', possible_text: '4', percent_text: '50',
  percent_key_text: '50.0000000000000000000000', letter: 'F', gpa: 0, near_line_letter: null, rank: 7, tie_group: null, missing_count: 1,
  ungraded_count: 0, unreleased_count: 0, excused_count: 0, bonus_only: false, no_work_count: 0, invalid_deadline_count: 0, ...o });

const base = {
  enrollment: { enrollmentId: 'e1', sectionId: SEC, studentId: 3000000001, sectionCode: 'M1A' },
  extensions: [], submissions: [], grades: [],
  offerings: [offering('o1', 'preflight-01', PAST), offering('o2', 'preflight-02', FUTURE)],
  dbCells: [dbc({ assignment_offering_id: 'o1', state: 'missing', points_earned: null }), dbc({ assignment_offering_id: 'o2', state: 'not_due', points_earned: null })],
  now: NOW,
};

{
  const rows = S.lessonRows(base);
  eq('one row per published offering', rows.length, 2);
  eq('rows are in due order', rows.map(r => r.slug), ['preflight-01', 'preflight-02']);
  eq('a past lesson the database counts as missing is MISSING', rows[0].cell.state, CELL.MISSING);
  eq('a future lesson the database calls not due is PENDING', rows[1].cell.state, CELL.PENDING);
  check('without a database row a lesson is blank, not a local guess',
        S.lessonRows({ ...base, dbCells: [] })[0].cell.state === CELL.PENDING && S.lessonRows({ ...base, dbCells: [] })[0].cell.points == null);
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
    dbCells: [dbc({ assignment_offering_id: 'o1', state: 'released', points_earned: 2 })],
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
    dbCells: [dbc({ assignment_offering_id: 'o1', state: 'submitted_ungraded', has_draft_score: true, points_earned: 1 })],
  });
  eq('a drafted score is DRAFT, not GRADED, and keeps its points', [rows[0].cell.state, rows[0].cell.points], [CELL.DRAFT, 1]);
}
{
  const r = (state, o = {}) => S.lessonRows({ ...base, dbCells: [dbc({ assignment_offering_id: 'o1', state, ...o })] })[0].cell;
  eq('an excused item is EXCUSED', r('excused', { points_earned: null }).state, CELL.EXCUSED);
  eq('a published score held by a release date is HELD', r('graded_unreleased').state, CELL.HELD);
  eq('work in with no score is UNGRADED', r('submitted_ungraded', { points_earned: null }).state, CELL.UNGRADED);
}

{
  // The extension case — the specific bug faculty-data.js:148 has and this must not.
  const rows = S.lessonRows({
    ...base,
    extensions: [{ assignment_offering_id: 'o1', extended_due_at: FUTURE }],
    dbCells: [dbc({ assignment_offering_id: 'o1', state: 'not_due', points_earned: null })],
  });
  eq('a student inside an unexpired extension is PENDING, not MISSING', rows[0].cell.state, CELL.PENDING);
  check('…and the row is flagged as extended so the instructor can see why', rows[0].extended === true);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('studentTotal — the database\'s own text, nothing computed');

check('the old local total is gone', S.studentTotals === undefined && S.loadClassContext === undefined);
{
  const t = S.studentTotal(dbt());
  eq('percent, earned, possible, letter and rank are the database text', [t.percentText, t.earnedText, t.possibleText, t.letter, t.rank], ['50', '2', '4', 'F', 7]);
  eq('a band is attached for rendering', t.band.key, 'd1');
}
{
  // The cases the old local rule got wrong. Each total below is whatever the database says, and the page prints it.
  const draftOnly = S.studentTotal(dbt({ earned_text: '0', possible_text: '0', percent_text: null, percent_key_text: null, letter: null, rank: null }));
  eq('a drafted score is not in the total: nothing counts yet, no percent, no band', [draftOnly.percentText, draftOnly.band], [null, null]);
  const exact = S.studentTotal(dbt({ earned_text: '8999', possible_text: '10000', percent_text: '89.99', percent_key_text: '89.9900000000000000000000', letter: 'B+' }));
  eq('89.99 stays 89.99; it is not shown as 90', exact.percentText, '89.99');
  eq('and it is not in the 90 band', exact.band.key, 'd4');
  const bonus = S.studentTotal(dbt({ earned_text: '3', possible_text: '0', percent_text: null, percent_key_text: null, letter: null, bonus_only: true }));
  eq('a bonus-only cadet keeps the earned points visible', [bonus.bonusOnly, bonus.earnedText], [true, '3']);
  eq('excused work is in the count the database gives', S.studentTotal(dbt({ excused_count: 2 })).excused, 2);
  eq('no row from the database is no total', S.studentTotal(undefined), null);
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
    dbCells: [dbc({ assignment_offering_id: 'o1', state: 'released', points_earned: 2 }), dbc({ assignment_offering_id: 'o3', state: 'missing', points_earned: null })],
  });
  const totals = S.studentTotal(dbt());
  const txt = S.commentCard({
    student: { name: 'Jane Cadet' },
    enrollment: { studentId: 3000000001, sectionCode: 'M1A' },
    totals, rows, ei: [],
  });

  check('names the cadet', txt.includes('Jane Cadet'));
  check('states the grade as the database text, earned over possible and a percentage', txt.includes('2 / 4') && txt.includes('50%'));
  check('and the letter and rank the database gave', txt.includes('F') && txt.includes('rank 7'));
  check('lists missing work by name', txt.includes('preflight-03'),
        '"you have one missing assignment" starts an argument; naming it ends one');
  check('prints no class median, which would be a second calculation', !/median/i.test(txt));
  check('surfaces the 0-5 understanding separately from the grade', txt.includes('/ 5'));
  check('is plain text — no markup leaks in', !/[<>]/.test(txt));
}

{
  const rows = S.lessonRows({ ...base, offerings: [offering('o1', 'preflight-01', PAST)],
    grades: [{ assignment_offering_id: 'o1', points_earned: 2, points_possible: 2, is_finalized: true }],
    dbCells: [dbc({ assignment_offering_id: 'o1', state: 'released', points_earned: 2 })] });
  const txt = S.commentCard({
    student: { name: 'Ada' }, enrollment: { studentId: 1, sectionCode: 'T3B' },
    totals: S.studentTotal(dbt({ earned_text: '2', possible_text: '2', percent_text: '100', percent_key_text: '100', letter: 'A', rank: 1 })), rows, ei: [],
  });
  check('a cadet with nothing missing is told so explicitly, not left to infer it',
        txt.includes('Missing work: none'));
}

{
  const rows = S.lessonRows(base);
  const txt = S.commentCard({
    student: { name: 'Ada' }, enrollment: { studentId: 1, sectionCode: 'T3B' },
    totals: S.studentTotal(dbt({ earned_text: '0', possible_text: '0', percent_text: null, percent_key_text: null, letter: null, rank: null })), rows,
    ei: [{ started_at: '2026-08-15T20:00:00Z', duration_minutes: 30 }],
    freeText: 'Spoke after class about vectors.',
  });
  check('a cadet with nothing counted yet is told so, not given 0%', /nothing counts yet/i.test(txt) && !txt.includes('0%'));
  check('EI attendance is summarized', txt.includes('Extra instruction: 1 session'));
  check('the instructor free-text is appended verbatim', txt.includes('Spoke after class about vectors.'));
}
{
  const txt = S.commentCard({ student: { name: 'Ada' }, enrollment: { studentId: 1, sectionCode: 'T3B' }, totals: null, rows: [], ei: [] });
  check('with no total from the database the note says so rather than inventing one', /not available/i.test(txt));
}

summary();
