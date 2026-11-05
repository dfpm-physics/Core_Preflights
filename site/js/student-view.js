// student-view.js -- the wording and the grouping behind the student schedule and grade list.
//
// PURE. No imports, no network, no DOM, so a test can load it anywhere. The pages stay thin and the
// words live here, once, because the same state has to read the same way on the dashboard, the
// schedule and the grade list.
//
// WHAT THIS FILE DOES NOT DO: add anything up. The course total comes from the database
// (`my_course_total`, migration 039), and each item's state and score from `gradebook_cells`. This
// file only chooses words for what those functions returned and sorts rows into groups. A total
// worked out here would be the second calculation that the grade rules forbid.
//
// WORDING RULES (student pages only)
//   * Say "assignment" or the item's own title, never "lesson" or "preflight" for the container. The
//     container is any kind of work now: homework, a lab, an exam, a quiz.
//   * Points come from the item. A missing value is shown as nothing, never as a default.
//   * "Graded on effort" is said only about an item whose grading mode is effort.
//   * "Missed" is not used. Work with no submission yet is "Past due" while a late submission is still
//     possible, and "Not submitted" once the database has counted it as a zero.

/** Student-facing words for the seven database states (docs/decisions/V2-DATA-MODEL.md section 7). */
const STATE_WORDS = {
  excused:            { word: 'Excused',                 tone: 'grey',  note: 'Left out of your total.' },
  released:           { word: 'Graded',                  tone: 'green', note: '' },
  // The database already turns a held grade into this state for a student, so it can never show a score early.
  submitted_ungraded: { word: 'Waiting for a grade',     tone: 'blue',  note: 'Not in your total yet.' },
  missing:            { word: 'Not submitted',           tone: 'red',   note: 'Counts as 0 until work is graded.' },
  in_progress:        { word: 'In progress',             tone: 'amber', note: '' },
  not_due:            { word: 'Not due yet',             tone: 'grey',  note: '' },
};

/** The word, tone and note for one database state. An unknown state reads as nothing, not as a guess. */
export function stateWords(state) {
  return STATE_WORDS[state] || { word: '', tone: 'grey', note: '' };
}

/** A number the way a person writes it: no trailing zeros, no float noise on two-decimal values. */
export function fmtNum(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return String(Number(n.toFixed(6)));
}

/** "10 pts", "1 pt", or '' when the item states no points. Never a default. */
export function pointsText(points) {
  if (points == null || points === '' || !Number.isFinite(Number(points))) return '';
  const n = Number(points);
  return `${fmtNum(n)} ${n === 1 ? 'pt' : 'pts'}`;
}

/** "8 / 10 pts", or '' when either side is unknown. */
export function scoreText(earned, possible) {
  if (earned == null || possible == null) return '';
  return `${fmtNum(earned)} / ${fmtNum(possible)} pts`;
}

/** The score a grades row shows. The database's cell function already hands points only for a released cell and for an
 *  auto-checked cell still in progress (a score so far), so a row shows a score exactly when it holds points. The page
 *  must not add a state test of its own: it hid the in-progress score the database had given. */
export function visibleScore(row) { return row ? scoreText(row.earned, row.possible) : ''; }

/** Said only about an item graded on effort. Any other grading mode says nothing about effort. */
export function gradingNote(gradingMode) {
  return gradingMode === 'effort' ? 'Graded on effort' : '';
}

/** The state of work that has no submission and a date that has passed, for the schedule's own
 *  status text. `late` says whether the item still accepts work after the date. */
export function pastDueWord({ hasSubmission, late }) {
  if (hasSubmission) return '';
  return late ? 'Past due, still open' : 'Past due';
}

/**
 * The line a student reads under a locked item, from the instant it opens.
 * @param {Date|null} releasesAt
 */
export function opensText(releasesAt, fmt) {
  if (!releasesAt || isNaN(releasesAt)) return 'Opens before it is due';
  return `Questions open ${fmt(releasesAt)}`;
}

/**
 * One row of the schedule: an item from the shared loader (loadAssignmentStatuses with includeLocked)
 * joined to its cell from gradebook_cells.
 *
 * `cell` may be missing (an item the database does not count for this student). The row then carries
 * no state word rather than an invented one.
 */
export function scheduleRow(item, cell) {
  const state = cell?.state || null;
  const words = state ? stateWords(state) : { word: '', tone: 'grey', note: '' };
  const hasPath = !!(item.written || item.interactive);
  return {
    offeringId: item.offeringId,
    title: item.title,
    description: item.description || '',
    due: item.due || null,
    dueSource: item.dueSource || null,
    isExtended: item.dueSource === 'extension',
    locked: item.released === false,
    releasesAt: item.releasesAt || null,
    points: item.pointsPossible ?? null,
    gradingMode: item.gradingMode || null,
    state, stateWord: words.word, tone: words.tone, stateNote: words.note,
    isLate: !!cell?.is_late,
    lateClosed: !!cell?.late_closed,
    // Only an item with something to open on this site links anywhere. In-person and elsewhere work has
    // a date and a grade and nothing else to click.
    openable: hasPath && item.released !== false,
    hasSubmission: !!item.submission,
    // gradebook_cells already nulls the score unless it is released (or an auto-checked score so far).
    earned: cell?.points_earned ?? null,
    possible: cell?.points_possible ?? item.pointsPossible ?? null,
  };
}

/** Rows sorted by date, undated last, then by the instructor's own order. */
export function sortRows(rows) {
  return [...rows].sort((a, b) => {
    if (a.due && b.due) return a.due - b.due || String(a.title).localeCompare(String(b.title));
    if (a.due) return -1;
    if (b.due) return 1;
    return String(a.title).localeCompare(String(b.title));
  });
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

/** Group sorted rows by calendar month of their date, in the viewer's own zone. Undated rows go last. */
export function groupByMonth(rows) {
  const groups = [];
  const index = new Map();
  for (const r of rows) {
    const key = r.due ? `${r.due.getFullYear()}-${String(r.due.getMonth() + 1).padStart(2, '0')}` : 'none';
    if (!index.has(key)) {
      const g = { key, label: r.due ? `${MONTHS[r.due.getMonth()]} ${r.due.getFullYear()}` : 'No date yet', rows: [] };
      index.set(key, g); groups.push(g);
    }
    index.get(key).rows.push(r);
  }
  return groups;
}

/**
 * The course total as the database stated it, ready to print. Returns null when there is no row.
 * `percent_text` is passed through untouched (it can end in an ellipsis where the value does not end).
 */
export function totalView(total) {
  if (!total) return null;
  const hasPercent = total.percent_text != null && total.percent_text !== '';
  return {
    earned: total.earned_text ?? '',
    possible: total.possible_text ?? '',
    percent: hasPercent ? `${total.percent_text}%` : '',
    line: hasPercent
      ? `${total.earned_text} of ${total.possible_text} points · ${total.percent_text}%`
      : (Number(total.possible_text) === 0 ? 'No graded work counts yet.' : ''),
  };
}

/**
 * Rows of the grade list, one per item, joined to feedback. Feedback is attached ONLY for a released
 * cell: a held grade must not show a score or a comment.
 *
 * @param {Array} items   loadAssignmentStatuses result (includeLocked)
 * @param {Map|object} cellsBy  offeringId -> cell
 */
export function gradeRows(items, cellsBy) {
  const get = (id) => (cellsBy instanceof Map ? cellsBy.get(id) : cellsBy?.[id]);
  return sortRows(items.map(item => {
    const cell = get(item.offeringId);
    const row = scheduleRow(item, cell);
    const released = row.state === 'released';
    const g = item.grade;
    row.feedback = released ? feedbackOf(g) : [];
    row.note = released ? String(g?.instructor_note?.text ?? '') : '';
    return row;
  }));
}

/** The per-question comments a student may read: text only, in question order. */
export function feedbackOf(grade) {
  const qs = grade?.question_scores;
  if (!qs || typeof qs !== 'object') return [];
  return Object.keys(qs).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map(k => ({ key: k, score: qs[k]?.score ?? null, max: qs[k]?.max ?? null, text: String(qs[k]?.feedback ?? '') }))
    .filter(f => f.text.trim() !== '' || (f.max != null && Number(f.max) > 0));
}

/** True when this offering is a past term: every enrollment in it is completed. */
export function isPastTerm(enrollmentsOfOffering) {
  const list = enrollmentsOfOffering || [];
  return list.length > 0 && list.every(e => e.status === 'completed');
}
