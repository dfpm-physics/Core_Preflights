// test-rollup.mjs — the cross-modality summary rules.
//
// Covers the 2026-07-21 change that made the faculty summaries describe BOTH ways a lesson can
// be worked. Before it, a written-path student contributed nothing: they have no schema:1
// report and `grades.effort` is NULL on that path (written offerings are grading_mode='points'),
// so every effort number silently described only the artifact takers.
//
// Two units under test, both pure:
//   site/app/js/schema.js        writtenSignals / effortSignal — where each path's numbers live
//   site/app/js/faculty-rollup.js summarizeReports — how the two are folded into one summary
//
// summarizeReports is pure, but faculty-rollup.js imports supabase.js at module load, which
// requires window.db. Hence the shim below — and hence run.mjs spawning this suite in its own
// process, so the client binding cannot leak into the live suites.

import { check, eq, section, installBrowser, summary } from './harness.mjs';
import {
  writtenSignals, effortSignal, FREE_RESPONSE_KEY, FREE_RESPONSE_LABEL, int05,
} from '../../site/app/js/schema.js';

installBrowser();

// A stub client, installed BEFORE the import because supabase.js captures window.db at module
// load. summarizeReports is pure and never touches it; loadAnalysis is the one function here
// that queries, and what it must do with the rows it gets back is exactly what we are testing.
let ANALYSIS_ROWS = [];
const chain = () => {
  const c = { select: () => c, eq: () => c, then: (res) => res({ data: ANALYSIS_ROWS, error: null }) };
  return c;
};
globalThis.window.db = { from: () => chain() };

const { summarizeReports, loadAnalysis, BY_QUESTION_KEY } =
  await import('../../site/app/js/faculty-rollup.js');

/* ── Row builders, named for the path they represent ───────────────────────── */

// An artifact taker: understanding resolves per objective inside the schema:1 payload.
const interactiveRow = (id, { effort, overall, objectives = [] } = {}) => ({
  student_id: id, path: 'interactive', effort, understanding: null,
  report_data: { schema: 1, effort, overall_understanding: overall, objectives },
});
// A question-set taker: effort and understanding both come off grades.diagnostic, which
// loadInteractionData has already unpacked into these two fields.
const writtenRow = (id, { effort, understanding } = {}) => ({
  student_id: id, path: 'written', effort, understanding, report_data: null,
});
const bothRow = (id, { effort, overall, understanding, objectives = [] } = {}) => ({
  student_id: id, path: 'both', effort, understanding,
  report_data: { schema: 1, effort, overall_understanding: overall, objectives },
});

const obj = (key, understanding, label = key) => ({ key, label, understanding });

/* ── schema.js: where each path's numbers live ─────────────────────────────── */
section('learner signals — written diagnostics');

eq('writtenSignals unpacks the q2/q3 pair',
   writtenSignals({ diagnostic: { q2_effort: 4, q3_understanding: 2 } }),
   { effort: 4, understanding: 2 });
eq('an interactive grade yields no written signals (schema:1 payload has no q2/q3 keys)',
   writtenSignals({ diagnostic: { schema: 1, overall_understanding: 4, objectives: [] } }),
   { effort: null, understanding: null });
eq('a missing diagnostic is nulls, not a throw', writtenSignals(null), { effort: null, understanding: null });
eq('an empty diagnostic (the NOT NULL DEFAULT) is nulls',
   writtenSignals({ diagnostic: {} }), { effort: null, understanding: null });
eq('out-of-range diagnostics are rejected rather than clamped',
   writtenSignals({ diagnostic: { q2_effort: 7, q3_understanding: -1 } }),
   { effort: null, understanding: null });
eq('a non-integer diagnostic is rejected',
   writtenSignals({ diagnostic: { q2_effort: 3.5, q3_understanding: '4' } }),
   { effort: null, understanding: null });
check('int05 accepts the range ends', int05(0) === 0 && int05(5) === 5);
check('int05 rejects just outside', int05(-1) === null && int05(6) === null);

section('learner signals — effort precedence');

eq('a graded effort wins over everything',
   effortSignal({ effort: 5, diagnostic: { q2_effort: 1 } }, { effort: 2 }),
   { effort: 5, source: 'grade' });
eq('the written diagnostic is used when nothing is graded',
   effortSignal({ effort: null, diagnostic: { q2_effort: 3 } }, null),
   { effort: 3, source: 'diagnostic' });
eq("the artifact's own claim ranks last",
   effortSignal({ effort: null, diagnostic: {} }, { effort: 4 }),
   { effort: 4, source: 'claimed' });
eq('effort 0 is a value, not an absence (must not fall through to the claim)',
   effortSignal({ effort: 0 }, { effort: 5 }), { effort: 0, source: 'grade' });
eq('a written q2_effort of 0 likewise holds',
   effortSignal({ diagnostic: { q2_effort: 0 } }, { effort: 5 }), { effort: 0, source: 'diagnostic' });
eq('nothing anywhere is a null with no source', effortSignal(null, null), { effort: null, source: null });

/* ── Effort: ONE distribution across both modalities ───────────────────────── */
section('summarizeReports — effort merges across modalities');

const mixed = summarizeReports([
  interactiveRow(1, { effort: 5, overall: 4 }),
  interactiveRow(2, { effort: 3, overall: 3 }),
  writtenRow(3, { effort: 4, understanding: 2 }),
  writtenRow(4, { effort: 1, understanding: 1 }),
], 2);

eq('every student is counted, whichever path they took', mixed.n, 4);
eq('the effort histogram holds both paths', mixed.effort.hist, [0, 1, 0, 1, 1, 1]);
eq('the effort mean is over both paths', mixed.effort.avg, (5 + 3 + 4 + 1) / 4);
eq('nobody falls into not-assessed', mixed.effort.notAssessed, 0);
eq('paths are reported so the mean can be calibrated',
   { i: mixed.paths.interactiveN, w: mixed.paths.writtenN, mixed: mixed.paths.mixed },
   { i: 2, w: 2, mixed: true });

// The regression this whole change exists to prevent.
const writtenOnly = summarizeReports([
  writtenRow(1, { effort: 4, understanding: 3 }),
  writtenRow(2, { effort: 2, understanding: 1 }),
], 2);
eq('a question-only cohort reports a real effort mean (was null before this change)',
   writtenOnly.effort.avg, 3);
eq('…and a real distribution', writtenOnly.effort.hist, [0, 0, 1, 0, 1, 0]);
eq('…and is not silently counted as unassessed', writtenOnly.effort.notAssessed, 0);
eq('…and is labelled as written-only',
   { i: writtenOnly.paths.interactiveN, w: writtenOnly.paths.writtenN, mixed: writtenOnly.paths.mixed },
   { i: 0, w: 2, mixed: false });

const doneBoth = summarizeReports([bothRow(1, { effort: 4, overall: 3, understanding: 2 })], 2);
eq('a student who worked both paths is counted once, not twice', doneBoth.n, 1);
eq('…and appears in both path tallies',
   { i: doneBoth.paths.interactiveN, w: doneBoth.paths.writtenN, both: doneBoth.paths.both },
   { i: 1, w: 1, both: 1 });
eq('…contributing exactly one entry to the effort histogram',
   doneBoth.effort.hist.reduce((s, c) => s + c, 0), 1);

/* ── Understanding: the free-response objective ────────────────────────────── */
section('summarizeReports — free-response understanding');

const objectified = summarizeReports([
  interactiveRow(1, { effort: 4, overall: 4, objectives: [obj('coulomb', 4, 'Coulomb magnitude'), obj('vector', 2, 'Vector sum')] }),
  interactiveRow(2, { effort: 5, overall: 4, objectives: [obj('coulomb', 5, 'Coulomb magnitude'), obj('vector', 3, 'Vector sum')] }),
  writtenRow(3, { effort: 4, understanding: 1 }),
  writtenRow(4, { effort: 3, understanding: 3 }),
], 2);

const fr = objectified.objectives.find(o => o.key === FREE_RESPONSE_KEY);
check('the written path contributes one synthetic objective', !!fr);
eq('…labelled for a human', fr.label, FREE_RESPONSE_LABEL);
eq('…tagged as written so the UI can mark it', fr.source, 'written');
eq('…averaging only the students who answered it', fr.understanding, 2);
eq('…counting them as assessed', fr.assessed, 2);
eq('…with a 0–5 distribution shaped like an objective', fr.dist, [0, 1, 0, 1, 0, 0]);
eq('interactive objectives are tagged too',
   objectified.objectives.filter(o => o.source === 'interactive').map(o => o.key).sort(),
   ['coulomb', 'vector']);
eq('free response sorts weakest-first alongside the objectives, not appended',
   objectified.objectives.map(o => o.key), [FREE_RESPONSE_KEY, 'vector', 'coulomb']);

const noWritten = summarizeReports([interactiveRow(1, { effort: 4, overall: 4, objectives: [obj('a', 3)] })], 2);
check('no free-response row when nobody answered a question set',
      !noWritten.objectives.some(o => o.key === FREE_RESPONSE_KEY));

const blankWritten = summarizeReports([writtenRow(1, { effort: 2, understanding: null })], 2);
check('no free-response row when the written understanding was never assessed',
      !blankWritten.objectives.some(o => o.key === FREE_RESPONSE_KEY));

section('summarizeReports — headline understanding folds both paths');

eq('a written cohort reports understanding (was null before this change)',
   writtenOnly.understanding.overall, 2);
eq('…attributed to the written path', writtenOnly.understanding.from, { interactive: 0, written: 2 });
eq('a mixed cohort splits the attribution',
   objectified.understanding.from, { interactive: 2, written: 2 });
eq('…and averages across both', objectified.understanding.overall, (4 + 4 + 1 + 3) / 4);
eq('an interactive overall wins over the same student\'s free-response score',
   summarizeReports([bothRow(1, { effort: 4, overall: 5, understanding: 1 })], 2).understanding.overall, 5);
eq('…and is attributed to the interactive path',
   summarizeReports([bothRow(1, { effort: 4, overall: 5, understanding: 1 })], 2).understanding.from,
   { interactive: 1, written: 0 });

/* ── The radar: available, or unavailable WITH A REASON ────────────────────── */
section('summarizeReports — radar availability');

const threeObjectives = summarizeReports([
  interactiveRow(1, { effort: 4, overall: 4, objectives: [obj('a', 4), obj('b', 3), obj('c', 2)] }),
], 2);
eq('three interactive objectives make a radar', threeObjectives.radar.available, true);
eq('…with no reason to report', threeObjectives.radar.reason, null);
eq('…and three axes', threeObjectives.radar.axisCount, 3);

const twoPlusFree = summarizeReports([
  interactiveRow(1, { effort: 4, overall: 4, objectives: [obj('a', 4), obj('b', 3)] }),
  writtenRow(2, { effort: 4, understanding: 2 }),
], 2);
eq('the free-response axis can be what makes a radar drawable', twoPlusFree.radar.available, true);
eq('…as a third axis', twoPlusFree.radar.axisCount, 3);
check('…and it is genuinely on the chart',
      twoPlusFree.radar.axes.some(o => o.key === FREE_RESPONSE_KEY));

eq('a question-only cohort cannot have a radar', writtenOnly.radar.available, false);
eq('…for a reason the UI can explain', writtenOnly.radar.reason, 'written-only');
eq('…because one free-response score is one axis', writtenOnly.radar.axisCount, 1);

const twoObjectives = summarizeReports([
  interactiveRow(1, { effort: 4, overall: 4, objectives: [obj('a', 4), obj('b', 3)] }),
], 2);
eq('two objectives is a different failure than written-only', twoObjectives.radar.reason, 'too-few-objectives');
eq('an empty scope reports no-data, not too-few', summarizeReports([], 2).radar.reason, 'no-data');
eq('…and is not available', summarizeReports([], 2).radar.available, false);

// An objective nobody scored must not become a phantom axis at the origin.
const unscored = summarizeReports([
  interactiveRow(1, { effort: 4, overall: 4, objectives: [obj('a', 4), obj('b', 3), obj('c', null)] }),
], 2);
eq('an unassessed objective is excluded from the radar axes', unscored.radar.axisCount, 2);
check('…but still listed in the breakdown', unscored.objectives.some(o => o.key === 'c'));

/* ── The written path produces no interactive-only artefacts ───────────────── */
section('summarizeReports — what the written path does NOT produce');

// "No COUNTED misconceptions" — not "no misconceptions". /preflight-analyze does look for them
// on the written path; it writes them as per-question prose into analysis_reports rather than as
// the structured per-student misconceptions[] this counter folds. loadAnalysis (below) is what
// surfaces them.
eq('no counted misconceptions from a question set', writtenOnly.misconceptions.length, 0);
eq('no flags from a question set', writtenOnly.flags, { needs_follow_up: 0, notable: 0 });
eq('no reflection metadata from a question set', writtenOnly.reflection.assessed, 0);
eq('points still accrue for written students', writtenOnly.effort.pointsTotal > 0, true);

/* ── loadAnalysis: two skills write this table and `kind` separates them ───── */
section('loadAnalysis — by_question rows must not corrupt the panel map');

const cohortRow = {
  id: 'r-cohort', scope: 'assignment_offering', scope_id: 'off-1', audience_id: null,
  kind: 'cohort', generated_at: '2026-07-20T00:00:00Z',
  payload: { readiness_summary: 'Class is ready.', misconception_trends: 'Fading.',
             selected_quotes: ['q'], section_id: null },
};
const byQuestionRow = (id, who) => ({
  id, scope: 'assignment_offering', scope_id: 'off-1', audience_id: who,
  kind: 'by_question', generated_at: '2026-07-21T00:00:00Z',
  payload: {
    instructor_name: who, day_filter: 'M', sections: [{ id: 's1', code: 'M1A' }],
    breakdown: { axis: 'question', items: {
      q2: { summary: 'Reading reflection engaged\nTwo blanks' },
      q3: { summary: 'scalar-sum: adds magnitudes without direction — ~6 students\nStrong answers named the vector sum' },
    } },
    meta: { n: 20 },
  },
});

// The regression: three instructors' by_question rows plus a real cohort row.
ANALYSIS_ROWS = [byQuestionRow('r1', 'Roth'), cohortRow, byQuestionRow('r2', 'Hardy'),
                 byQuestionRow('r3', 'Jones')];
const map = await loadAnalysis('off-1');

eq('the cohort row survives three by_question rows (they used to overwrite it)',
   map.__all__?.readiness_summary, 'Class is ready.');
eq('…with its trends intact', map.__all__?.misconception_trends, 'Fading.');
eq('every by_question row is kept, not collapsed onto one key',
   (map[BY_QUESTION_KEY] || []).length, 3);
eq('…under a key that is not a section and not __all__',
   BY_QUESTION_KEY === '__all__' || /^[0-9a-f-]{36}$/.test(BY_QUESTION_KEY), false);
eq('…carrying the per-question bullets',
   map[BY_QUESTION_KEY][0].items.q3.summary.split('\n').length, 2);
eq('…and who they are about', map[BY_QUESTION_KEY][0].instructor_name, 'Roth');
eq('…and which sections they cover', map[BY_QUESTION_KEY][0].sections[0].code, 'M1A');

ANALYSIS_ROWS = [byQuestionRow('r1', 'Roth')];
const onlyQ = await loadAnalysis('off-1');
eq('a by_question row alone does not invent an all-null cohort panel', onlyQ.__all__, undefined);
eq('…but its breakdown is still returned', (onlyQ[BY_QUESTION_KEY] || []).length, 1);

// A row predating the `kind` column, recognized by payload shape instead.
ANALYSIS_ROWS = [{ ...byQuestionRow('r-old', 'Legacy'), kind: null }];
eq('a by_question payload with no kind is still routed by its axis',
   (await loadAnalysis('off-1'))[BY_QUESTION_KEY]?.length, 1);

// ROLLUP-AGREEMENT §6 says /preflight-analyze SHOULD also write the cohort panels. When it does,
// the row must land in both places rather than being consumed by the breakdown branch.
ANALYSIS_ROWS = [{ ...byQuestionRow('r-both', 'Roth'),
                   payload: { ...byQuestionRow('r-both', 'Roth').payload,
                              readiness_summary: 'Ready.', misconception_trends: 'Scalar sums.' } }];
const both = await loadAnalysis('off-1');
eq('a conforming row yields its breakdown', (both[BY_QUESTION_KEY] || []).length, 1);
eq('…and its cohort panels', both.__all__?.misconception_trends, 'Scalar sums.');

ANALYSIS_ROWS = [];
eq('no rows is an empty map, not a throw', await loadAnalysis('off-1'), {});

process.exitCode = summary() ? 0 : 1;
