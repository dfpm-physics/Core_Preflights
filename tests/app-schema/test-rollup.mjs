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
  writtenSignals, writtenReport, effortSignal, FREE_RESPONSE_KEY, FREE_RESPONSE_LABEL, int05,
  minutes, median, pinnedQuestion, reflectionQuestionId,
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

const { summarizeReports, loadAnalysis: loadAnalysisRaw, canonMisconceptionId, taughtSectionIds } =
  await import('../../site/app/js/faculty-rollup.js');

// loadAnalysis returned a bare scope map until 2026-07-22, when it grew two offering-level
// siblings (`aliases`, `glossary`) and started returning { scopes, aliases, glossary }. Every
// assertion below was written against the scope map and still tests exactly what it did before,
// so they read it through this shim rather than being rewritten to say `.scopes` 8 times.
const loadAnalysis = async (id) => (await loadAnalysisRaw(id)).scopes;

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

/* ── The written schema:1 assessment (/preflight-analyze) ─────────────────── */
section('written schema:1 — recognition');

const s1 = { schema: 1, source: 'preflight-analyze', effort: 4, overall_understanding: 3,
             objectives: [], misconceptions: [{ id: 'scalar-sum', label: 'Scalar sum',
               description: 'Adds magnitudes without direction.', severity: 'major' }],
             reading_reflection: { meaningful: true, engagement: 4 },
             flags: { needs_follow_up: false, notable: false } };

eq('a schema:1 diagnostic is recognized', writtenReport({ diagnostic: s1 })?.effort, 4);
check('a q2/q3-only diagnostic is NOT mistaken for one',
      writtenReport({ diagnostic: { q2_effort: 4, q3_understanding: 2 } }) === null);
check('an absent diagnostic is null', writtenReport(null) === null);
check('a diagnostic without schema:1 is null',
      writtenReport({ diagnostic: { effort: 4, misconceptions: [] } }) === null);
eq('the q2/q3 pair survives alongside a schema:1 payload',
   writtenSignals({ diagnostic: { ...s1, q2_effort: 5, q3_understanding: 1 } }),
   { effort: 5, understanding: 1 });

section('written schema:1 — effort precedence');

eq('the whole-attempt assessment outranks the reflection-only q2_effort',
   effortSignal({ diagnostic: { ...s1, effort: 4, q2_effort: 1 } }, null),
   { effort: 4, source: 'report' });
eq('q2_effort still serves grades written before schema:1 existed',
   effortSignal({ diagnostic: { q2_effort: 3 } }, null), { effort: 3, source: 'diagnostic' });
eq('a human grade still outranks the assessment',
   effortSignal({ effort: 5, diagnostic: s1 }, null), { effort: 5, source: 'grade' });

section('written schema:1 — it reaches the cohort summary');

// The payoff: a written cohort whose grades carry schema:1 now produces the panels that were
// interactive-only. These rows are what loadInteractionData yields once the bridge surfaces
// grades.diagnostic as report_data.
const s1Row = (id, over) => ({
  student_id: id, path: 'written', effort: over.effort, understanding: over.q3 ?? null,
  report_data: { ...s1, ...over },
});
const writtenStructured = summarizeReports([
  s1Row(1, { effort: 4, overall_understanding: 3, q3: 2 }),
  s1Row(2, { effort: 2, overall_understanding: 1, q3: 1,
             misconceptions: [{ id: 'scalar-sum', label: 'Scalar sum', description: 'x', severity: 'major' }],
             flags: { needs_follow_up: true, notable: false } }),
], 2);

eq('misconceptions are now COUNTED for a written cohort',
   writtenStructured.misconceptions.map(m => [m.id, m.count]), [['scalar-sum', 2]]);
eq('…with severity carried through', writtenStructured.misconceptions[0].major, 2);
eq('flags tally for a written cohort', writtenStructured.flags.needs_follow_up, 1);
eq('the reflection gate is assessed', writtenStructured.reflection.assessed, 2);
eq('understanding comes from the holistic read, not the free-response question',
   writtenStructured.understanding.overall, 2);
eq('…and is attributed to the written path, not inflated as interactive coverage',
   writtenStructured.understanding.from, { interactive: 0, written: 2 });
eq('effort still merges as one population', writtenStructured.effort.avg, 3);
eq('the free-response objective still reports q3 separately from the holistic read',
   writtenStructured.objectives.find(o => o.key === FREE_RESPONSE_KEY)?.understanding, 1.5);
check('an empty objectives[] puts no phantom axis on the radar',
      writtenStructured.radar.axisCount === 1 && writtenStructured.radar.reason === 'written-only');

/* ── Reading time (Q1) ────────────────────────────────────────────────────── */
section('reading time — minutes, median, buckets');

eq('whole positive minutes are accepted', [minutes(15), minutes(75), minutes(30.4)], [15, 75, 30]);
check('zero is rejected — /preflight-analyze omits the key rather than writing 0',
      minutes(0) === null);
check('negatives and absurd values are rejected', minutes(-5) === null && minutes(5000) === null);
check('non-numbers are rejected', minutes('30') === null && minutes(null) === null);

eq('median of an odd list', median([10, 60, 30]), 30);
eq('median of an even list averages the middle pair', median([10, 20, 40, 60]), 30);
eq('median of nothing is null', median([]), null);

const rt = (id, mins) => ({
  student_id: id, path: 'written', effort: 3, understanding: 3,
  report_data: { ...s1, effort: 3, reading_minutes: mins },
});
const reading = summarizeReports([
  rt(1, 10), rt(2, 20), rt(3, 35), rt(4, 50), rt(5, 90), rt(6, undefined),
], 2);

eq('only students who named a duration are counted', reading.reading.assessed, 5);
eq('a student who answered without a duration is tracked separately',
   reading.reading.notStated, 1);
eq('the median is reported, not the mean (mean would be 41)', reading.reading.median, 35);
eq('buckets span the ranges', reading.reading.buckets.map(b => [b.key, b.count]),
   [['lt15', 1], ['m15_29', 1], ['m30_44', 1], ['m45_59', 1], ['gte60', 1]]);
eq('the spread is reported for context',
   [reading.reading.min, reading.reading.max], [10, 90]);

// The outlier case the median exists for.
const skewed = summarizeReports([rt(1, 20), rt(2, 25), rt(3, 30), rt(4, 180)], 2);
eq('one three-hour reader does not move the median', skewed.reading.median, 27.5);
eq('…but is still visible in the top bucket',
   skewed.reading.buckets.find(b => b.key === 'gte60').count, 1);

const noReading = summarizeReports([
  interactiveRow(1, { effort: 4, overall: 4 }),
  interactiveRow(2, { effort: 3, overall: 3 }),
], 2);
eq('an interactive cohort reports no reading time (Q1 is a written question)',
   noReading.reading.assessed, 0);
eq('…and is not counted as having withheld it', noReading.reading.notStated, 0);
eq('…with a null median rather than a zero', noReading.reading.median, null);

const unassessed = summarizeReports([
  { student_id: 1, path: 'written', effort: null, understanding: null, report_data: null },
], 2);
eq('an ungraded submission is not counted as "gave no duration"',
   unassessed.reading.notStated, 0);

/* ── loadAnalysis: retired by_question rows must not corrupt the panel map ─── */
section('loadAnalysis — retired by_question rows are ignored, not merged');

// /preflight-analyze stopped writing these on 2026-07-21 and the UI block is gone, but the rows
// SURVIVE in the database. They carry no scope map, so a reader that let one through would file
// it under '__all__' with null panels and overwrite a real cohort scope — the regression these
// assertions were written for. Keeping them is the point; deleting them invites it back.

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
eq('retired rows contribute no scope of their own', Object.keys(map).sort(), ['__all__']);

ANALYSIS_ROWS = [byQuestionRow('r1', 'Roth')];
const onlyQ = await loadAnalysis('off-1');
eq('a by_question row alone does not invent an all-null cohort panel', onlyQ.__all__, undefined);
eq('…and yields nothing at all', onlyQ, {});

// A row predating the `kind` column, recognized by payload shape instead.
ANALYSIS_ROWS = [{ ...byQuestionRow('r-old', 'Legacy'), kind: null }];
eq('a by_question payload with no kind is still recognized by its axis',
   await loadAnalysis('off-1'), {});

/* ── Finding the reading reflection when nobody marked it ──────────────────── */
section('pinnedQuestion — must agree with lesson_aggregate.py, case for case');

// Same fixtures as aggregate_summarize_test.py. The aggregator quotes reflections the browser
// also renders; if these two resolvers disagree, the prose cites students the panel never shows.
const act = questions => ({ content: { questions } });

// 0 of 74 live written activities carry ANY role, so the text fallback is load-bearing this term.
const LIVE_SHAPE = act([
  { id: 'q1', type: 'free_response', points: 0,
    text: 'How much time did you spend reading the book in preparation for this lesson?' },
  { id: 'q2', type: 'free_response', points: 1,
    text: 'What did you find most confusing or most interesting about the reading? Be specific.' },
  { id: 'q3', type: 'free_response', points: 1, text: 'Can an object have a velocity…' },
]);
eq('live Fall shape: reading time found by text',
   pinnedQuestion(LIVE_SHAPE, 'reading_time'), { id: 'q1', how: 'text' });
eq('live Fall shape: reflection found by text',
   pinnedQuestion(LIVE_SHAPE, 'reading_reflection'), { id: 'q2', how: 'text' });

const ROLED = act([
  { id: 'qA', role: 'reading_reflection', text: 'anything' },
  { id: 'qB', role: 'reading_time', text: 'anything' },
]);
eq('an explicit role wins over position',
   pinnedQuestion(ROLED, 'reading_time'), { id: 'qB', how: 'role' });
eq('…and over text', pinnedQuestion(ROLED, 'reading_reflection'), { id: 'qA', how: 'role' });

const REORDERED = act([
  { id: 'q2', points: 1, text: 'What did you find most confusing or most interesting?' },
  { id: 'q1', points: 0, text: 'How much time did you spend reading the book?' },
]);
eq('text matching survives reordering',
   pinnedQuestion(REORDERED, 'reading_time'), { id: 'q1', how: 'text' });

const UNRECOGNIZABLE = act([{ id: 'q1', text: 'Something else entirely' },
                            { id: 'q2', text: 'Also unrelated' }]);
eq('falls back to position, and says so',
   pinnedQuestion(UNRECOGNIZABLE, 'reading_reflection'), { id: 'q2', how: 'position' });
eq('…and gives up rather than guessing when even position is absent',
   pinnedQuestion(act([{ id: 'zz', text: 'nope' }]), 'reading_reflection'), { id: null, how: null });
eq('an interactive activity has no questions and resolves to null',
   reflectionQuestionId({ content: { artifact_url: 'https://claude.ai/x' } }), null);
eq('a missing activity does not throw', reflectionQuestionId(null), null);

/* ── The payload shape the writer ACTUALLY produces ────────────────────────── */
section('loadAnalysis — payload.scopes, as lesson_aggregate.py writes it');

// `cohortRow` above (kind:'cohort', panels at the top level) is a shape NO producer emits. The
// real writer stores payload.scopes keyed by section uuid plus '__all__' (SKILL.md, "Why the
// per-section rows became one row with scopes inside it"). Because the fixture encoded the wrong
// shape, this reader could look for `by_section`, pass every assertion, and still render "coming
// soon" on every scope of every real run. Assert against the producer, not against a paraphrase.
const readinessRow = {
  id: 'r-real', scope: 'assignment_offering', scope_id: 'off-1', audience_id: null,
  kind: 'readiness', generated_at: '2026-07-21T18:14:21Z',
  payload: {
    kind: 'readiness', axis: 'objective', generated_by: 'lesson-aggregate@2026-07-21',
    activity_slug: 'lesson-02-electric-charge-coulombs-law', assignment_slug: 'preflight-02',
    scopes: {
      'sec-uuid-1': {
        section_id: 'sec-uuid-1', section_code: 'M1A',
        readiness_summary: 'M1A is the strongest section.',
        misconception_trends: 'One protons-move case.',
        misconception_recommendation: 'Open with what actually moves during friction charging.',
        selected_quotes: [{ student_id: 3000990009, section_id: 'sec-uuid-1' }],
        meta: { n: 16, generated_by: 'lesson-aggregate@2026-07-21', day: 'M' },
      },
      __all__: {
        section_id: null, section_code: '__all__',
        readiness_summary: 'Cohort is engaged.',
        misconception_trends: 'Two halves of one gap.',
        misconception_recommendation: 'Spend ten minutes on charge conservation before the lab.',
        selected_quotes: [],
        meta: { n: 64, generated_by: 'lesson-aggregate@2026-07-21',
                coverage: { complete: true, this_run: ['T1A'], from_stored: ['M1A'] } },
      },
    },
  },
};

ANALYSIS_ROWS = [readinessRow];
const real = await loadAnalysis('off-1');
eq('a real lesson-aggregate row exposes its whole-course panels',
   real.__all__?.readiness_summary, 'Cohort is engaged.');
eq('…and its whole-course trends', real.__all__?.misconception_trends, 'Two halves of one gap.');
eq('…and its per-section panels, keyed by section uuid',
   real['sec-uuid-1']?.readiness_summary, 'M1A is the strongest section.');
eq('…and the per-section trends', real['sec-uuid-1']?.misconception_trends, 'One protons-move case.');
eq('…and the AI-selected quotes the rollup resolves to live text',
   real['sec-uuid-1']?.selected_quotes[0].student_id, 3000990009);
eq('…with no quotes on the whole-course scope', real.__all__?.selected_quotes, []);
eq('…and meta.n, which drives the staleness hint', real.__all__?.meta?.n, 64);

// The tripwire. A field the writer stores and panels() forgets to list is written to the database
// and displayed nowhere — silently, with no error. That has now happened twice on this table
// (`scopes` vs `by_section`, and the whole by_question breakdown), so every panel field gets an
// assertion here the moment it is added to the contract.
eq('the trends recommendation reaches the renderer, per section',
   real['sec-uuid-1']?.misconception_recommendation,
   'Open with what actually moves during friction charging.');
eq('…and on the whole-course scope, where quotes are forbidden but a recommendation is not',
   real.__all__?.misconception_recommendation,
   'Spend ten minutes on charge conservation before the lab.');
eq('a scope with no recommendation reports null, not undefined',
   (await loadAnalysis('off-1'))['sec-uuid-1']?.misconception_recommendation !== undefined, true);
// Day-scoped provenance rides in meta and must survive untouched — status reads it back.
eq('meta.day survives for a day-scoped section scope', real['sec-uuid-1']?.meta?.day, 'M');
eq('meta.coverage survives on the course scope', real.__all__?.meta?.coverage?.complete, true);

// Both producers write this offering, exactly as they do live.
ANALYSIS_ROWS = [byQuestionRow('r1', 'Roth'), readinessRow, byQuestionRow('r2', 'Hardy')];
const bothProducers = await loadAnalysis('off-1');
eq('scopes panels survive alongside retired by_question rows',
   bothProducers.__all__?.readiness_summary, 'Cohort is engaged.');
eq('…and the retired rows add no scopes of their own',
   Object.keys(bothProducers).sort(), ['__all__', 'sec-uuid-1']);

// The older top-level shape must keep loading.
ANALYSIS_ROWS = [{ ...readinessRow, payload: {
  by_section: { 'sec-uuid-1': { readiness_summary: 'Legacy section.' } },
  readiness_summary: 'Legacy course.' } }];
const legacy = await loadAnalysis('off-1');
eq('a by_section row still loads its sections',
   legacy['sec-uuid-1']?.readiness_summary, 'Legacy section.');
eq('…and its top-level whole-course panels', legacy.__all__?.readiness_summary, 'Legacy course.');

ANALYSIS_ROWS = [];
eq('no rows is an empty map, not a throw', await loadAnalysis('off-1'), {});

/* ── Misconception id canonicalization + the persisted alias fold ───────────── */
section('canonMisconceptionId — variants must not split one misconception into several bars');

// Both producers may coin ids (contract §5.4), and every counting site keys on the exact string.
// Reading-reflection topics have always been trimmed+lowercased; ids never were, so `scalar-sum`,
// `Scalar-Sum` and `scalar-sum ` rendered as three bars of one misconception.
eq('trims surrounding whitespace', canonMisconceptionId('  scalar-sum '), 'scalar-sum');
eq('lowercases', canonMisconceptionId('Scalar-Sum'), 'scalar-sum');
eq('collapses internal whitespace to hyphens', canonMisconceptionId('scalar sum'), 'scalar-sum');
eq('empty stays empty (caller drops it)', canonMisconceptionId('   '), '');
eq('null does not throw', canonMisconceptionId(null), '');
// The alias map is what /lesson-aggregate persists so its clustering reaches the bars.
const AL = { 'adds-magnitudes': 'scalar-sum' };
eq('an alias folds a coined variant onto its canonical id',
   canonMisconceptionId('Adds-Magnitudes', AL), 'scalar-sum');
eq('a non-aliased id passes through', canonMisconceptionId('forces-cancel', AL), 'forces-cancel');
// A hand-edited map could contain a cycle; one hop means it terminates instead of hanging.
eq('a self-referential alias terminates',
   canonMisconceptionId('a', { a: 'b', b: 'a' }), 'b');

section('summarizeReports — misconceptions carry their own explanation');

let mcSeq = 0;
const mcRow = (id, extra = {}) => ({
  student_id: 9000 + (mcSeq++), path: 'interactive', effort: 4, understanding: null,
  report_data: { schema: 1, effort: 4, objectives: [], misconceptions: [
    { id, label: 'Scalar sum of forces', description: 'Adds magnitudes, ignores direction.',
      severity: 'major', evidence: `I added 3N and 5N to get 8N (${mcSeq})`, ...extra }] },
});
const mcSum = summarizeReports([mcRow('scalar-sum'), mcRow('Scalar-Sum '), mcRow('adds-magnitudes')],
  2, { aliases: { 'adds-magnitudes': 'scalar-sum' } });
eq('three id variants collapse to ONE bar', mcSum.misconceptions.length, 1);
eq('…counting all three students', mcSum.misconceptions[0].count, 3);
eq('…and all three as major', mcSum.misconceptions[0].major, 3);
eq('description survives to the cohort bar (it used to be dropped here)',
   mcSum.misconceptions[0].description, 'Adds magnitudes, ignores direction.');
eq('evidence surfaces as an example, capped at 2',
   mcSum.misconceptions[0].examples.length, 2);
// Only a GENUINE fold is a variant. `Scalar-Sum ` normalizes to the canonical id and is the same
// id spelled differently, so it must not appear; `adds-magnitudes` folded via the alias map and
// must. Reporting the former would fill the popover with noise on every bar.
eq('an alias-folded id is reported so the merge is visible, not silent',
   mcSum.misconceptions[0].variants.includes('adds-magnitudes'), true);
eq('…but a mere casing/spacing difference is not a variant',
   mcSum.misconceptions[0].variants.includes('Scalar-Sum'), false);
eq('…so exactly one variant is listed', mcSum.misconceptions[0].variants.length, 1);

// The longest description wins — producers write one per student and the fuller one is the better
// tooltip. Deterministic regardless of row order.
const longer = summarizeReports([
  mcRow('scalar-sum', { description: 'Short.' }),
  mcRow('scalar-sum', { description: 'A much longer and more useful explanation of the error.' }),
], 2);
eq('the fullest description wins',
   longer.misconceptions[0].description, 'A much longer and more useful explanation of the error.');

// The glossary backfills only where the raw rows carried nothing.
const noDesc = summarizeReports(
  [{ student_id: 9500, path: 'interactive', effort: 3, understanding: null,
     report_data: { schema: 1, effort: 3, objectives: [], misconceptions: [{ id: 'units', label: 'units' }] } }],
  2, { glossary: { units: { label: 'Unit errors', description: 'Drops or mixes units.' } } });
eq('glossary backfills a missing description', noDesc.misconceptions[0].description, 'Drops or mixes units.');
eq('…and a better label', noDesc.misconceptions[0].label, 'Unit errors');

section('loadAnalysis — instructor scopes and the offering-level alias map');

ANALYSIS_ROWS = [{
  id: 'r-instr', scope: 'assignment_offering', scope_id: 'off-1', audience_id: null,
  kind: 'readiness', generated_at: '2026-07-22T00:00:00Z',
  payload: {
    scopes: {
      'sec-uuid-1': { section_id: 'sec-uuid-1', section_code: 'M1A',
                      misconception_recommendation: 'Re-derive the vector sum.', selected_quotes: [] },
      'instr:u-1': { instructor_id: 'u-1', instructor_name: 'Roth',
                     section_ids: ['sec-uuid-1', 'sec-uuid-2'],
                     readiness_summary: 'Both sections are ready.',
                     section_notes: [{ section_id: 'sec-uuid-2', section_code: 'M3B',
                                       note: 'Weaker on superposition.' }] },
      __all__: { section_id: null, section_code: '__all__', readiness_summary: 'Course is ready.' },
    },
    misconception_aliases: { 'Adds-Magnitudes': 'scalar-sum', 'bad': '' },
    misconception_glossary: { 'Scalar-Sum': { label: 'Scalar sum', description: 'Ignores direction.' } },
  },
}];
const withInstr = await loadAnalysisRaw('off-1');
eq('an instructor scope loads under its instr: key',
   withInstr.scopes['instr:u-1']?.readiness_summary, 'Both sections are ready.');
eq('…carrying the sections it covers',
   withInstr.scopes['instr:u-1']?.section_ids, ['sec-uuid-1', 'sec-uuid-2']);
eq('…and its per-section departures',
   withInstr.scopes['instr:u-1']?.section_notes?.[0]?.section_code, 'M3B');
eq('the section scope keeps its OWN recommendation',
   withInstr.scopes['sec-uuid-1']?.misconception_recommendation, 'Re-derive the vector sum.');
eq('aliases are lowercased on the way in', withInstr.aliases['adds-magnitudes'], 'scalar-sum');
eq('an alias with an empty target is dropped, not stored', 'bad' in withInstr.aliases, false);
eq('glossary keys are lowercased too', withInstr.glossary['scalar-sum']?.label, 'Scalar sum');

ANALYSIS_ROWS = [];
const bare = await loadAnalysisRaw('off-1');
eq('no rows still yields the three-part shape', Object.keys(bare).sort(), ['aliases', 'glossary', 'scopes']);

section('taughtSectionIds — an offering-wide staff row is visibility, not a teaching assignment');

eq('section-scoped rows are the teaching assignments',
   taughtSectionIds({ currentOffering: 'o1', staff: [
     { course_offering_id: 'o1', section_id: 's1' },
     { course_offering_id: 'o1', section_id: 's2' }] }).sort(), ['s1', 's2']);
eq('a director\'s offering-wide row (section_id NULL) grants no taught section',
   taughtSectionIds({ currentOffering: 'o1', staff: [{ course_offering_id: 'o1', section_id: null }] }), []);
eq('another offering\'s rows are ignored',
   taughtSectionIds({ currentOffering: 'o1', staff: [{ course_offering_id: 'o2', section_id: 's9' }] }), []);
eq('a director who also teaches gets only the section they teach',
   taughtSectionIds({ currentOffering: 'o1', staff: [
     { course_offering_id: 'o1', section_id: null },
     { course_offering_id: 'o1', section_id: 's1' }] }), ['s1']);
eq('duplicates collapse',
   taughtSectionIds({ currentOffering: 'o1', staff: [
     { course_offering_id: 'o1', section_id: 's1' },
     { course_offering_id: 'o1', section_id: 's1' }] }), ['s1']);
eq('no staff at all does not throw', taughtSectionIds({ currentOffering: 'o1' }), []);

section('rollup scope options + default — mirrors report.html scopeOptions()/defaultScope()');

// These mirror report.html exactly. Kept here because the rules are no longer obvious: the option
// is hidden at one section (it would duplicate that section's own tab) and the default moves.
// `visible` is vm.sections — every section the viewer MAY see (all of them, for a director).
// `mine` is the sections they actually teach. Sections they do not teach are hidden unless the
// director-only toggle is on, so a director's normal view of a lesson matches an instructor's.
const scopeOptions = (mine, visible, showOthers = false) => {
  const mineFirst = mine.length > 1 ? ['mine'] : [];
  const own = visible.filter(id => mine.includes(id));
  const base = own.length ? own : visible;
  const extra = (showOthers && own.length) ? visible.filter(id => !mine.includes(id)) : [];
  return [...mineFirst, 'all', ...base, ...extra];
};
const defaultScope = (mine) =>
  mine.length > 1 ? 'mine' : mine.length === 1 ? mine[0] : 'all';

const FOUR = ['s1', 's2', 's3', 's4'];

// THE REPORTED CASE: a director who teaches one of four sections saw all four tabs.
eq('teaches one of four: only their own section is listed',
   scopeOptions(['s3'], FOUR), ['all', 's3']);
eq('…and it is the default', defaultScope(['s3']), 's3');
eq('…with the toggle on, the other three appear AFTER their own',
   scopeOptions(['s3'], FOUR, true), ['all', 's3', 's1', 's2', 's4']);
eq('My sections is NOT offered at one section (it would duplicate that tab)',
   scopeOptions(['s3'], FOUR).includes('mine'), false);

// Teaches two of four.
eq('two sections: My sections is offered, after the course rollup',
   scopeOptions(['s1', 's2'], FOUR), ['mine', 'all', 's1', 's2']);
eq('…and is the default', defaultScope(['s1', 's2']), 'mine');
eq('…toggle on adds only the two they do not teach',
   scopeOptions(['s1', 's2'], FOUR, true), ['mine', 'all', 's1', 's2', 's3', 's4']);

// A director with only an offering-wide staff row teaches nothing here. Hiding "their" sections
// would strand them on an empty list, so they get everything and the toggle is meaningless.
eq('no taught sections: everything is listed regardless of the toggle',
   scopeOptions([], FOUR), ['all', ...FOUR]);
eq('…and the toggle cannot make it different',
   scopeOptions([], FOUR, true), scopeOptions([], FOUR));
eq('…defaulting to the course rollup', defaultScope([]), 'all');

// An instructor's vm.sections already contains only their own, so nothing is ever hidden from them
// and the toggle is never rendered.
eq('an instructor sees the same list with the toggle either way',
   scopeOptions(['s1'], ['s1'], true), scopeOptions(['s1'], ['s1']));

// Teaches everything: 'mine' and 'all' cover the same students but are NOT the same scope — one is
// the union of section reads, the other the course-level synthesis — so both stay on offer.
eq('teaches all four: both are still offered', scopeOptions(FOUR, FOUR), ['mine', 'all', ...FOUR]);
eq('…defaulting to My sections, not the rollup', defaultScope(FOUR), 'mine');

// The course rollup is never the default for anyone who teaches — reaching wider is deliberate.
eq('the rollup is never the default while you teach anything',
   [['s1'], ['s1', 's2'], FOUR].every(m => defaultScope(m) !== 'all'), true);
// Whatever the toggle state, the current scope must remain selectable or the control and the
// content disagree; renderScope falls back to defaultScope() when it does not.
eq('hiding others never removes a section the viewer teaches',
   scopeOptions(['s3'], FOUR).includes('s3'), true);

process.exitCode = summary() ? 0 : 1;
