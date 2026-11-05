// free-response.js — the question-set model for a typed-response item, for the Assignments page (faculty/items.html).
//
// WHAT THIS IS
//   Pure functions over a plain object, no database and no DOM, so a test can import it. The page shows the object
//   (free-response-ui.js) and the data layer saves it (faculty-items.js). The shapes written are the ones the older
//   lesson editor writes into `activities.content`, because the grader, the aggregator, the student page and the
//   key-filing trigger (migration 047) all read that shape. Helpers that already exist in faculty-lessons.js are
//   imported, never copied. The few rules that live inside the older PAGE (the standard wording of the two pinned
//   questions, adopting and dropping a pinned role) cannot be imported from a page, so they are written here once and a
//   test compares the wording with the page's own text.
//
// THE EDITOR OBJECT
//   { questions: [ {id, type, role, text, points, expected_response?, correct_answer?, options?, tolerance?,
//                   figure_url?, student_note?, _keyShown?} ],
//     reading_link, reference_pdf, reference_pages, access }
//   `_keyShown` records which key boxes were filled from the key table; questionsForSave() removes it and also
//   leaves an untouched key box out of the save (migration 047, faculty-lessons.js "ANSWER KEYS IN THE EDITOR").
//
// ROLES  Pinned: `reading_time` (0 points, names hidden) and `reading_reflection` (1 point, the meaningful-reflection
//   gate). Everything else is `free_response`. The roles are stored on the question, not inferred from position, so a
//   lesson may have either, both or neither, and the rollup still reads the right question.

import {
  PINNED_ROLES, FREE_RESPONSE_ROLE, roleRank, adoptPinnedRoles, pinnedPresence, stampRoles,
  questionsForSave, showKeys,
} from './faculty-lessons.js';
import { ACCESS_OPEN, ACCESS_BY_PERMISSION, writtenAccessOf } from './schema.js';

export { PINNED_ROLES, FREE_RESPONSE_ROLE, showKeys };

/* The standard wording of the two pinned questions. The older page holds the same strings inside its script; a test
 * reads that page and fails if either copy changes without the other. */
export const READING_REFLECTION_TEXT =
  'What did you find most confusing or most interesting about the reading? Be specific and thorough in your discussion.';
export const READING_REFLECTION_GUIDANCE =
  'Reading reflection: judge whether this is a meaningful engagement with the reading — '
  + 'genuine and specific, not blank, gibberish, or a throwaway one-liner. It need not be long, '
  + 'just meaningful. A non-meaningful reflection caps the student\'s effort.';
export const READING_TIME_TEXT = 'How much time did you spend reading the book in preparation for this lesson?';
export const READING_TIME_NOTE =
  'Your response is visible to your instructor, but your name is not shown — it is for an overall class diagnostic.';

export const QUESTION_TYPES = ['free_response', 'numerical', 'multiple_choice'];
export const TYPE_LABEL = { free_response: 'Free response', numerical: 'Numerical', multiple_choice: 'Multiple choice' };

/**
 * The next `qN` id nobody has used. `used` holds ids that are not in the list but must not be given out again: the ids
 * the stored item had when it was opened, the ids it has keys for, and every question removed in this session. An id
 * is the key that cadets' answers, scores and the grader's guidance hang on, so a removed question's id is never
 * handed to a different question.
 */
export function nextQid(questions, used = []) {
  let max = 0;
  const see = (id) => { const m = /^q(\d+)$/.exec(id || ''); if (m) max = Math.max(max, +m[1]); };
  (questions || []).forEach(q => see(q?.id));
  (used || []).forEach(see);
  return 'q' + (max + 1);
}

/** A new ordinary question. It carries the `free_response` role from the start (see stampRoles in faculty-lessons.js). */
export function newQuestion(type, questions, used = []) {
  const t = QUESTION_TYPES.includes(type) ? type : 'free_response';
  return {
    id: nextQid(questions, used), type: t, role: FREE_RESPONSE_ROLE, text: '', points: 1,
    options: t === 'multiple_choice' ? ['A. ', 'B. ', 'C. ', 'D. '] : undefined,
    correct_answer: '', expected_response: '', figure_url: '',
    ...(t === 'numerical' ? { tolerance: 0.05 } : {}),
  };
}

/** The standard question for a pinned role. */
export function pinnedQuestion(role, questions, used = []) {
  return role === 'reading_time'
    ? { id: nextQid(questions, used), type: 'free_response', text: READING_TIME_TEXT, points: 0,
        student_note: READING_TIME_NOTE, role: 'reading_time', figure_url: '' }
    : { id: nextQid(questions, used), type: 'free_response', text: READING_REFLECTION_TEXT, points: 1,
        expected_response: READING_REFLECTION_GUIDANCE, role: 'reading_reflection', figure_url: '' };
}

const inOrder = (questions) => questions.sort((a, b) => roleRank(a) - roleRank(b));   // stable: time, reflection, rest

/** A new item's editor: both pinned questions on, which is what every course so far has used. */
export function emptyEditor() {
  const questions = [];
  questions.push(pinnedQuestion('reading_time', questions));
  questions.push(pinnedQuestion('reading_reflection', questions));
  return { questions: inOrder(stampRoles(questions)), reading_link: '', reference_pdf: '', reference_pages: '',
           access: ACCESS_OPEN, used_ids: [] };
}

/**
 * The editor for a stored typed-response path. Roles are adopted (a legacy list is claimed, not duplicated), then
 * every ordinary question is stamped `free_response`, exactly as the older editor does on opening. `keys` is the map
 * from loadQuestionKeys(); pass null when it could not be read (the boxes then stay blank and a save leaves keys alone).
 * `storedIds` is every question id the activity has a row for (keys may be missing for some), so none is reused.
 * A question that came from storage is marked `_stored`: its type is fixed (see canChangeType below).
 */
export function editorFromContent(content, keys = null, storedIds = []) {
  const c = content || {};
  const questions = (Array.isArray(c.questions) ? c.questions : []).map(q => ({ ...q, options: q.options ? [...q.options] : q.options, _stored: true }));
  const used = new Set([...questions.map(q => q.id), ...(storedIds || []), ...Object.keys(keys || {})].filter(Boolean));
  adoptPinnedRoles(questions);
  stampRoles(questions);
  inOrder(questions);
  if (keys) showKeys(questions, keys);
  return {
    questions,
    reading_link: c.reading_link || '', reference_pdf: c.reference_pdf || '', reference_pages: c.reference_pages || '',
    access: writtenAccessOf({ written: c }),
    used_ids: [...used],
  };
}

/** Fill the key boxes that are still empty from a key read that finished after the person began typing. Never
 *  overwrites a box with text in it. Also remembers the ids those keys belong to. */
export function applyKeys(editor, keys, storedIds = []) {
  for (const q of editor.questions) {
    const text = keys?.[q.id];
    if (!text) continue;
    const field = (q.type === 'multiple_choice' || q.type === 'numerical') ? 'correct_answer' : 'expected_response';
    if (String(q[field] ?? '').trim() === '') showKeys([q], { [q.id]: text });
  }
  editor.used_ids = [...new Set([...(editor.used_ids || []), ...(storedIds || []), ...Object.keys(keys || {})])];
  return editor;
}

/** Remove question `i`. Its id is remembered, so a question added later gets a new one. */
export function removeQuestion(editor, i) {
  const [gone] = editor.questions.splice(i, 1);
  if (gone?.id) editor.used_ids = [...new Set([...(editor.used_ids || []), gone.id])];
  return gone;
}

/** Whether a question may be removed. Once the assignment has any submission or grade (`editor.workLocked`, set by the page
 *  after it counts the work), a question that came from storage may not: its answers and scores belong to it. A question
 *  added in this editing session has no work yet and can go. To drop one, set its points to 0 instead. */
export const canRemove = (editor, q) => !(editor?.workLocked && q?._stored);

/** The sentence shown where a removal is refused, on screen and by the save. */
export const REMOVAL_LOCKED_NOTE = 'This assignment already has work, so a question already saved cannot be removed. Set its points to 0 instead.';

/** Whether a question may change type. One that came from storage may not: its answers, scores and key belong to the
 *  type it has. To change it the director removes it and adds a new one, which gets a new id. */
export const canChangeType = (q) => !q._stored && !PINNED_ROLES.includes(q.role);

/** Which pinned questions the list holds, for the two toggles. */
export const pinnedState = (editor) => pinnedPresence(editor.questions);

/** Turn a pinned question on. Adds the standard one unless the list already holds that role. */
export function pinOn(editor, role) {
  if (editor.questions.some(q => q.role === role)) return 'present';
  editor.questions.push(pinnedQuestion(role, editor.questions, editor.used_ids));
  inOrder(editor.questions);
  return 'added';
}

/**
 * Turn a pinned question off. It never destroys authored text: a question still carrying the standard wording (or
 * empty) is removed; one the director rewrote keeps its text and becomes an ordinary free response.
 * @returns {'removed'|'kept'|'absent'|'locked'} 'locked' means the question holds work and stays as it is
 */
export function pinOff(editor, role) {
  const q = editor.questions.find(x => x.role === role);
  if (!q) return 'absent';
  const standard = role === 'reading_time' ? READING_TIME_TEXT : READING_REFLECTION_TEXT;
  const text = (q.text || '').trim();
  if (!canRemove(editor, q) && (!text || text === standard.trim())) return 'locked';
  if (!text || text === standard.trim()) {
    editor.used_ids = [...new Set([...(editor.used_ids || []), q.id])];
    editor.questions = editor.questions.filter(x => x !== q);
    return 'removed';
  }
  q.role = FREE_RESPONSE_ROLE;
  if (role === 'reading_time' && !(Number(q.points) > 0)) q.points = 1;
  return 'kept';
}

/**
 * The `activities.content` for a typed-response path: the same object the older editor writes. `keepKeys` is true for a
 * NEW activity only (what the boxes hold is filed as the first key version); false when an activity already exists, so
 * a key box the person did not touch is not sent and the stored key stays as it is.
 */
export function contentFromEditor(editor, { keepKeys }) {
  const questions = questionsForSave(inOrder(stampRoles(editor.questions.map(q => ({ ...q })))), { keepKeys }).map(q => {
    const { _stored, ...out } = q;                                     // page-only marker, never stored
    if (out.role === 'reading_time') out.points = 0;                   // the reading-time answer is never graded or shown per cadet
    if (out.type === 'numerical') {
      if (out.correct_answer != null) out.correct_answer = String(out.correct_answer).trim();
      if (out.tolerance !== '' && out.tolerance != null) out.tolerance = Number(out.tolerance);
    }
    return out;
  });
  const clean = (v) => String(v ?? '').trim() || null;                 // trimmed, and blank means none, as the older save does
  return {
    questions,
    reading_link: clean(editor.reading_link),
    reference_pdf: clean(editor.reference_pdf),
    reference_pages: clean(editor.reference_pages),
    access: editor.access === ACCESS_BY_PERMISSION ? ACCESS_BY_PERMISSION : ACCESS_OPEN,
  };
}

/** The sum of the question points, shown beside the item's own points so a mismatch is visible. */
export function questionPoints(editor) {
  return (editor.questions || []).reduce((n, q) => n + (isNaN(Number(q.points)) ? 0 : Number(q.points)), 0);
}

/** A question's points are stored as a number; Infinity and 1e999 would be stored as null. Nothing real is worth this much. */
const MAX_QUESTION_POINTS = 1000;

const NUMBER_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

/** Problems with the question set, as plain sentences. An empty list means it may be saved. */
export function checkEditor(editor) {
  const out = [];
  const qs = editor.questions || [];
  if (!qs.length) out.push('Add at least one question.');
  qs.forEach((q, i) => {
    const n = `Question ${i + 1}`;
    if (!String(q.text || '').trim()) out.push(`${n} needs its text.`);
    const pts = Number(q.points);
    // The reading-time question is worth 0 and is saved as 0 whatever the box held, so it needs no check.
    if (q.role !== 'reading_time' && (q.points === '' || q.points == null || !Number.isFinite(pts) || pts < 0 || pts > MAX_QUESTION_POINTS)) out.push(`${n} needs points (0 or more).`);
    if (q.type === 'multiple_choice') {
      const opts = (q.options || []).filter(o => String(o).trim().length > 2);
      if (opts.length < 2) out.push(`${n} needs at least two answer options.`);
      if (!String(q.correct_answer || '').trim()) out.push(`${n} needs its correct answer.`);
    }
    if (q.type === 'numerical') {
      // A plain decimal, optionally with an exponent. Number() alone also takes a blank, "Infinity" and "0x10", none of
      // which the key-filing step files as a number.
      const ca = String(q.correct_answer ?? '').trim();
      if (!NUMBER_RE.test(ca) || !Number.isFinite(Number(ca))) out.push(`${n} needs a number as its correct answer.`);
      const tol = Number(q.tolerance);
      if (q.tolerance === '' || q.tolerance == null || isNaN(tol) || tol < 0 || tol > 1) out.push(`${n} needs a tolerance between 0 and 1.`);
    }
  });
  if (String(editor.reading_link || '').trim() && !/^https?:\/\//i.test(String(editor.reading_link).trim())) {
    out.push('The reading link must start with http:// or https://.');
  }
  const pdf = String(editor.reference_pdf || '').trim();
  if (pdf && !/\.pdf$/i.test(pdf)) out.push('The reference file must be a file name ending in .pdf. Pick one from the list, or leave it empty.');
  return out;
}

/** Whether the set holds a graded free-response question with no guidance (a warning for the grader, not a refusal). */
export function missingGuidance(editor) {
  return (editor.questions || []).filter(q => q.type === 'free_response' && Number(q.points) > 0
    && q.role !== 'reading_time' && !String(q.expected_response || '').trim());
}

/** The label of a reference file in the select: the file name without its extension. */
export const ragLabel = (p) => (String(p).split('/').pop() || p).replace(/\.[^.]+$/, '');

/** The approved reference files from the manifest text: one path a line, '#' lines are comments. */
export const parseRagManifest = (text) =>
  String(text || '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
