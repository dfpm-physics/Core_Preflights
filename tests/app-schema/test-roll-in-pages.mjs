// test-roll-in-pages.mjs -- what the Grade picker, Report and Health do with each way an item can be
// delivered and graded, now that the pages no longer leave newer-page items out (migration 079).
//
// WHAT THIS DEFENDS
//   * The Grade picker lists an item only when a person grades or reviews some path of it. It decides from
//     each path's delivery and grading, never from the item's kind. An older path (delivery not yet written)
//     is treated as a person-graded one, so every row the older editor made is listed exactly as before.
//   * The export and the backup read the same list without that narrowing, so a graded online question set
//     still gets its column in the gradebook export.
//   * Report lists only items that have a typed or tutor path; Health counts completion only for those.
//   * A Health finding about an item made on a newer page links to that page's deep link; an older row keeps
//     the older page.
//
// WHAT THIS CANNOT PROVE
//   Offline, with a recording stub as window.db: it shows what the shipped modules ask for and do with the rows
//   they are handed. It does not show what the database returns.

import { check, eq, section, summary, installBrowser } from './harness.mjs';

installBrowser({ pathname: '/site/faculty/grade.html' });

let RESPONSES = {};
const stubFrom = (table) => {
  const state = { table, verb: 'select', payload: null, filters: {}, cols: null };
  const c = {};
  for (const m of ['eq', 'in', 'is', 'not', 'neq', 'gt', 'lt', 'gte', 'lte',
                   'order', 'limit', 'filter', 'or', 'range'])
    c[m] = (col, val) => { state.filters[col] = val; return c; };
  c.select = (cols) => { state.cols = cols; return c; };
  const result = (mode) => {
    const r = RESPONSES[`${table}.${state.verb}`];
    const data = typeof r === 'function' ? r(state, mode) : r;
    if (data === undefined) return { data: mode === 'many' ? [] : null, error: null };
    return { data, error: null };
  };
  c.single = () => Promise.resolve(result('single'));
  c.maybeSingle = () => Promise.resolve(result('maybe'));
  c.then = (res, rej) => Promise.resolve(result('many')).then(res, rej);
  return c;
};
globalThis.window.db = { from: stubFrom };
globalThis.fetch = async () => ({ ok: false, json: async () => null });

const ctx = { user: { id: 'staff' }, currentOffering: 'co-real', currentCourse: 'course-1',
              isDirectorForCurrent: () => true, sectionIds: [], sectionCodeOf: () => '' };

// An item as the picker's query returns it: the paths carry delivery and grading, or neither for an
// older row. `modality` rides on the activity.
const path = (modality, delivery, grading) => ({
  grading_role: 'graded', is_visible: true, position: 0, delivery, grading,
  activities: { id: 'act-' + modality, slug: 's-' + modality, modality, title: 't', content: {} },
});
const row = (id, paths) => ({
  id, due_at: null, position: 1, is_published: true, points_possible: 2,
  assignments: { slug: id, title: id }, offering_activities: paths,
});
const ITEMS = [
  row('old-written', [path('written', null, null)]),                       // Fall: nothing written yet
  row('old-both', [path('written', null, null), path('interactive', null, null)]),
  row('old-tutor', [path('interactive', null, null)]),
  row('filled-human', [path('written', 'typed_response', 'human_graded')]),
  row('ai-drafted', [path('written', 'typed_response', 'ai_drafted')]),
  row('tutor-effort', [path('interactive', 'interactive_tutor', 'effort')]),
  row('questions-human', [path('questions', 'online_questions', 'human_graded')]),
  row('mixed-auto-plus-ai', [path('questions', 'online_questions', 'auto_checked'),
                             path('written', 'typed_response', 'ai_drafted')]),
  row('no-paths', []),
  row('auto-only', [path('questions', 'online_questions', 'auto_checked')]),
  row('in-person', [path('external', 'in_person', 'hand_entered')]),
  row('in-person-imported', [path('external', 'in_person', 'imported')]),
  row('elsewhere', [path('external', 'elsewhere', 'hand_entered')]),
];
const ids = (list) => list.map(x => x.id);

/* ───────────────────────────────────────────────────────────────────────────────────────── */
section('Grade picker: only items a person grades or reviews');
RESPONSES = { 'assignment_offerings.select': () => ITEMS };
const G = await import('../../site/js/faculty-grade.js');
const picked = ids(await G.gradeAssignmentList(ctx, { gradedByPerson: true }));
eq('listed: older rows, human-graded, ai-drafted, effort, mixed, a row with no paths',
  picked.sort(), ['ai-drafted', 'filled-human', 'mixed-auto-plus-ai', 'no-paths', 'old-both', 'old-tutor',
                  'old-written', 'questions-human', 'tutor-effort']);
const all = ids(await G.gradeAssignmentList(ctx));
eq('the default list (export, backup) still holds every item', all.length, ITEMS.length);
const asked = [];
RESPONSES = { 'assignment_offerings.select': (st) => { asked.push(st.cols); return ITEMS; } };
await G.gradeAssignmentList(ctx, { gradedByPerson: true });
check("the picker asks for each path's delivery and grading",
  asked.some(c => /offering_activities\(delivery, grading\)/.test(c)), asked.join('|'));

section('the helper itself');
const S = await import('../../site/js/schema.js');
check('schema.js exports isPersonGraded', typeof S.isPersonGraded === 'function');
if (S.isPersonGraded) {
  eq('no paths is listed', S.isPersonGraded([]), true);
  eq('an older path (null delivery) is listed', S.isPersonGraded([{ delivery: null, grading: null }]), true);
  eq('auto_checked only is not', S.isPersonGraded([{ delivery: 'online_questions', grading: 'auto_checked' }]), false);
  eq('hand_entered only is not', S.isPersonGraded([{ delivery: 'in_person', grading: 'hand_entered' }]), false);
  eq('imported only is not', S.isPersonGraded([{ delivery: 'elsewhere', grading: 'imported' }]), false);
  eq('one reviewed path among others is', S.isPersonGraded([
    { delivery: 'online_questions', grading: 'auto_checked' }, { delivery: 'typed_response', grading: 'ai_drafted' }]), true);
}

section('Report: only items with a typed or tutor path');
const OFFER = ITEMS.map(r => ({ ...r, switch_policy: null, opens_at: null, due_by_day: {}, grading_mode: 'points',
  course_offering_id: 'co-real', assignment_due_dates: [],
  assignments: { id: r.id, slug: r.id, title: r.id, description: '', objectives: [], kind_id: null, course_id: 'c' } }));
RESPONSES = { 'assignment_offerings.select': () => OFFER, 'enrollments.select': () => [] };
const Ro = await import('../../site/js/faculty-rollup.js');
const rep = await Ro.loadManager(ctx);
eq('the Report list holds the typed and tutor items and no online, in-person or elsewhere item',
  ids(rep.interactions.map(i => ({ id: i.assignmentSlug }))).sort(),
  ['ai-drafted', 'filled-human', 'mixed-auto-plus-ai', 'old-both', 'old-tutor', 'old-written', 'tutor-effort']);

section('Health: completion and links');
const H = await import('../../site/js/faculty-health.js');
const T = { id: 'co-real', course_id: 'c', courses: { code: 'phys-x' }, terms: { code: 'T', label: 'Term' } };
const hRow = (id, paths, extra = {}) => ({
  id, course_offering_id: 'co-real', is_published: true, opens_at: null,
  due_at: new Date(Date.now() - 86400000).toISOString(), due_by_day: { M: new Date(Date.now() - 86400000).toISOString() },
  points_possible: 2, grading_mode: 'points', entered_on_new_page: false, slot: 1,
  assignments: { id, slug: id, title: id },
  offering_activities: paths.map(p => ({ grading_role: 'graded', is_visible: true, delivery: p.delivery ?? null,
    grading: p.grading ?? null, activities: { id: 'a-' + id + p.modality, slug: id + '-' + p.modality,
      modality: p.modality, title: 't', content: {} } })),
  ...extra,
});
const rawFor = (assignments) => ({
  offerings: [T], sections: [{ id: 'sec', code: 'M1', meeting_days: ['M'], course_offering_id: 'co-real' }],
  enrollments: [{ id: 'e1', student_id: 1, section_id: 'sec', students: { student_id: 1, name: 'Test, Pat' } }],
  assignments, allAssignments: assignments, submissions: [], errors: [], slots: [], errorDays: 14,
  lessonWindow: 6, loggingSince: null, calendarOk: false, termCode: 'T', readAt: new Date(), fetchDays: 14,
});
const mixed = [
  hRow('typed', [{ modality: 'written', delivery: 'typed_response', grading: 'ai_drafted' }]),
  hRow('auto', [{ modality: 'questions', delivery: 'online_questions', grading: 'auto_checked' }]),
  hRow('inperson', [{ modality: 'external', delivery: 'in_person', grading: 'hand_entered' }]),
  hRow('old', [{ modality: 'written' }]),
];
const m1 = H.shapeHealth(rawFor(mixed));
eq('Health completion rows cover only items with a typed or tutor path',
  m1.lessons.map(l => l.slug).sort(), ['old', 'typed']);

const linkSet = [
  hRow('newpub', [{ modality: 'interactive', delivery: 'interactive_tutor', grading: 'effort' }],
       { entered_on_new_page: true, is_published: false, due_at: new Date(Date.now() + 86400000).toISOString() }),
  hRow('oldpub', [{ modality: 'interactive' }],
       { is_published: false, due_at: new Date(Date.now() + 86400000).toISOString() }),
];
const m2 = H.shapeHealth(rawFor(linkSet));
const finds = H.runChecks(m2).find(c => c.id === 'unpublished-but-due').findings;
const hrefOf = (slug) => finds.find(f => f.where.endsWith(slug))?.href;
eq('a row entered on a newer page links to its deep link', hrefOf('newpub'), 'items.html?a=newpub');
eq('an older row keeps the older page', hrefOf('oldpub'), 'lessons.html');
const finds2 = H.runChecks(H.shapeHealth(rawFor([
  hRow('nolink', [{ modality: 'interactive', delivery: 'interactive_tutor', grading: 'effort' }], { entered_on_new_page: true }),
]))).find(c => c.id === 'artifact-url-missing').findings;
eq('the artifact-link finding links the same way', finds2[0]?.href, 'items.html?a=nolink');

const loadQ = [];
RESPONSES = { 'assignment_offerings.select': (st) => { loadQ.push({ t: 'assignment_offerings', cols: st.cols }); return []; } };
try { await H.loadHealth(); } catch { /* only the query matters */ }
const aoCols = loadQ.find(x => x.t === 'assignment_offerings')?.cols || '';
check('Health reads the marker, delivery and grading', /entered_on_new_page/.test(aoCols) && /delivery/.test(aoCols) && /grading\b/.test(aoCols), aoCols);

if (!summary()) process.exit(1);
