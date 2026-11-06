// homework.js — the student's page for an auto-checked item: read the questions, answer one at a time, be told at once.
//
// WHAT IS HERE AND WHAT IS NOT
//   This file never marks an answer, never reads a key, and never adds up a score. The question text comes from
//   app.student_homework (migration 073: only once the item is released, never with key data). Each answer goes to the
//   check-answer function, which replies right or wrong and the tries left. The score shown is read back from the
//   student's grade row after every answer, so there is one calculation and it is the database's.
//
//   The 7-day release rule is NOT applied here. The page is handed the item by the one student loader
//   (student-data.js loadAssignmentStatuses), which drops what is not released yet; this file only reads what it got.
//
// WHAT TOUCHES THE OUTSIDE   everything arrives through `deps`, so a test can stand in for the network:
//   deps.loadItem()           -> the item from loadAssignmentStatuses, or null (not open yet, or not theirs)
//   deps.loadQuestions()      -> the document from student_homework: { status, attempt_limit, attempt_rule, questions }
//   deps.readGrade()          -> the student's own grade row for this item, or null when there is none yet
//   deps.invoke(name, body)   -> { data, error }, like supabase-js functions.invoke
// A failed read throws and the page shows the failure; it never shows an empty page or a score of 0 in its place.
//
// NOT PROVEN LIVE   check-answer is not deployed, so the call in sendAnswer() has only run against a stand-in.
//
// THE GRADE SOURCE   the grade is read with GRADE_SOURCE below: the `my_grades` view, never the table (a student module
//   does not read `grades`). The view lists a cell the gradebook shows the student points for, and that includes an
//   auto-checked grade before the deadline; a database test pins it (test_step2_together_scratch.py, section 10).

import { esc, fmtDateTime } from './util.js';
import { parseSymbolic } from './symbolic-answer.js';

export const ANSWER_FUNCTION = 'check-answer';
/** The relation the grade row is read from: the student's view of their own grades (see the header). */
export const GRADE_SOURCE = 'my_grades';
export const GRADE_COLUMNS = 'enrollment_id,assignment_offering_id,points_earned,points_possible,question_scores,source,is_finalized';

export const TEXT = {
  network: 'Could not reach the server. That answer was not counted. Try again.',
  noAnswer: 'Type your answer first.',
  noExpression: 'Type your answer first. It can be an expression, for example m*v^2/2.',
  noChoice: 'Choose an answer first.',
  scoreMissing: 'Your answer was counted, but your score could not be loaded. Reload the page.',
  notOpen: 'This homework is not open yet.',
  notFound: 'This homework was not found.',
  closed: 'The deadline has passed. You can read the questions, but not answer them.',
  late: 'The deadline has passed. Your instructor allows late work, so you can still answer.',
};

export const heldBackText = (n) => `${n} ${n === 1 ? 'question is' : 'questions are'} not available yet. Your instructor is still checking ${n === 1 ? 'it' : 'them'}.`;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
/** 2 -> "2", 1.5 -> "1.5", 2.50 -> "2.5". */
export const fmt = (v) => String(Math.round(num(v) * 100) / 100);
const pts = (v) => `${fmt(v)} ${num(v) === 1 ? 'point' : 'points'}`;
const tries = (n) => `${n} ${n === 1 ? 'try' : 'tries'}`;

export function ruleText(rule) {
  return rule === 'last' ? 'Your last try on each question counts.'
    : rule === 'first' ? 'Your first try on each question counts.'
    : 'Your best try on each question counts.';
}

/** "3 tries left", "No tries left", or '' when the item sets no limit. */
export function triesLeftText(limit, used) {
  if (limit === null || limit === undefined) return '';
  const left = Math.max(0, num(limit) - num(used));
  return left === 0 ? 'No tries left.' : `${tries(left)} left.`;
}

/** The score line, from the grade row only. No row means no answer has been stored yet. */
export function scoreText(grade, item) {
  const possible = grade?.points_possible ?? item?.pointsPossible ?? 0;
  if (!grade) return { text: `No answers yet. This homework is worth ${pts(possible)}.`, earned: null, possible: num(possible) };
  return { text: `Score so far: ${fmt(grade.points_earned)} of ${fmt(possible)}.`, earned: num(grade.points_earned), possible: num(possible) };
}

/**
 * Put the three reads together into what the page draws. No arithmetic on scores: every number shown here was
 * written by the database (the grade row) or is a count of tries.
 */
export function buildView({ item, doc, grade }) {
  const limit = doc.attempt_limit ?? null;
  const past = !!item?.isPast;
  const late = !!doc.late_allowed;
  const scores = grade?.question_scores || {};
  return {
    title: item?.title || 'Homework',
    dueText: item?.due ? `Due ${fmtDateTime(item.due)}` : 'No due date',
    limit,
    rule: doc.attempt_rule || 'best',
    readOnly: past && !late,
    banner: past ? (late ? TEXT.late : TEXT.closed) : '',
    score: scoreText(grade, item),
    heldBack: Math.max(0, Math.floor(num(doc.held_back))),
    questions: (doc.questions || []).map((q, i) => {
      const used = num(q.attempts_used);
      const s = scores[q.qid];
      return {
        id: q.id, qid: q.qid, number: i + 1, prompt: q.prompt_md || '', figureUrl: q.figure_url || '',
        unitHint: q.unit_hint || '', format: q.format, choices: q.choices || [], points: num(q.points),
        variables: Array.isArray(q.variables) ? q.variables.filter(v => typeof v === 'string') : [],
        used, left: limit === null ? null : Math.max(0, num(limit) - used),
        counts: s && s.max !== undefined ? { score: num(s.score), max: num(s.max) } : null,
        message: null,
      };
    }),
  };
}

/**
 * What one reply from check-answer means for the student. Never returns the key (the function does not send one).
 * { kind: 'checked' | 'refused' | 'error', text, correct?, attemptNo?, left?, spent?, closed? }
 *   refused   the answer was not an attempt (unreadable, not on the list) or the server said no (closed, no tries left)
 *   spent     the student has no tries left on this question
 *   closed    the deadline has passed
 */
export function describeReply(res, limit) {
  if (!res || res.error || !res.data || typeof res.data !== 'object') return { kind: 'error', text: TEXT.network };
  const d = res.data;
  if (d.ok === true) {
    const left = d.attempts_left === null || d.attempts_left === undefined ? null : num(d.attempts_left);
    const more = left === null ? '' : left === 0 ? ' No tries left.' : ` ${tries(left)} left.`;
    return { kind: 'checked', correct: d.correct === true, attemptNo: num(d.attempt_no), left, spent: left === 0,
             text: (d.correct === true ? 'Correct.' : 'Not correct.') + more };
  }
  const text = typeof d.error === 'string' && d.error ? d.error : 'That answer could not be checked.';
  return { kind: 'refused', text, spent: d.code === 'limit_reached', closed: d.code === 'closed' };
}

/** Read what the student entered for one question. { ok, value } or { ok:false, text }. */
/**
 * How an expression answer reads, before it is sent. Local only: it uses the same reader as the server, so a typing error
 * is caught here, but it NEVER says whether the answer is right (this file holds no key). { tone, text }.
 */
export function symbolicPreview(q, text) {
  const t = String(text ?? '');
  if (t.trim() === '') return { tone: '', text: '' };
  const r = parseSymbolic(t, q.variables || []);
  if (!r.ok) return { tone: 'bad', text: `I cannot read that yet: ${r.message} Nothing is counted until you press Check answer, and an answer that cannot be read does not use a try.` };
  return { tone: 'ok', text: `Your answer reads as: ${r.reading}` };
}

export function readEntry(q, entry) {
  if (q.format === 'symbolic') {
    const v = String(entry?.text ?? '').trim();
    return v ? { ok: true, value: v } : { ok: false, text: TEXT.noExpression };
  }
  if (q.format === 'numeric') {
    const v = String(entry?.text ?? '').trim();
    return v ? { ok: true, value: v } : { ok: false, text: TEXT.noAnswer };
  }
  const picked = Array.isArray(entry?.choices) ? entry.choices : [];
  if (!picked.length) return { ok: false, text: TEXT.noChoice };
  return { ok: true, value: q.format === 'multiple_select' ? picked : picked[0] };
}

/** Send one answer. Only the offering, the question and the answer leave the browser. */
export async function sendAnswer(deps, offeringId, q, value, limit) {
  let res;
  try {
    res = await deps.invoke(ANSWER_FUNCTION, { assignment_offering_id: offeringId, question_id: q.id, answer: value });
  } catch (e) {
    res = { data: null, error: e };
  }
  return describeReply(res, limit);
}

/* ── drawing ─────────────────────────────────────────────────────────────────────────────────────────────── */

function questionHTML(q, readOnly) {
  const fig = q.figureUrl ? `<div style="margin:10px 0 14px;text-align:center"><img src="${esc(q.figureUrl)}" alt="Question figure"
    style="max-width:100%;max-height:320px;border-radius:6px;border:1px solid var(--border)"></div>` : '';
  let input;
  if (q.format === 'numeric') {
    input = `<input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" data-entry="${esc(q.id)}"
      placeholder="Type a number" style="max-width:240px" ${readOnly ? 'disabled' : ''}>
      <div class="field-hint">${q.unitHint ? `Give your answer in ${esc(q.unitHint)}. ` : ''}Use a decimal point, not a comma.</div>`;
  } else if (q.format === 'symbolic') {
    const names = (q.variables || []).map(esc).join(', ');
    input = `<input type="text" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="200" data-entry="${esc(q.id)}"
      placeholder="Type an expression" style="max-width:360px" ${readOnly ? 'disabled' : ''}>
      <div class="field-hint">Use ${names ? esc(names) : 'the given letters'}. Write * to multiply, / to divide and ^ for a power, for example m*v^2/2.
        Put brackets round anything you divide by: 1/(2*x), not 1/2x.</div>
      <div class="muted" style="margin-top:6px;font-size:0.88em" data-preview="${esc(q.id)}" aria-live="polite"></div>`;
  } else {
    const type = q.format === 'multiple_select' ? 'checkbox' : 'radio';
    input = `${type === 'checkbox' ? '<div class="field-hint" style="margin-bottom:6px">Choose all that apply.</div>' : ''}
      <div class="mc-options">${q.choices.map(c => `
        <label class="mc-option" data-choice-row="${esc(q.id)}">
          <input type="${type}" name="c-${esc(q.id)}" value="${esc(c.id)}" data-entry="${esc(q.id)}" ${readOnly ? 'disabled' : ''}>
          ${esc(c.text)}</label>`).join('')}</div>`;
  }
  return `<div class="question-block" id="qb-${esc(q.id)}">
    <div class="question-number">Question ${q.number}</div>
    <div class="question-text" style="white-space:pre-wrap">${esc(q.prompt)}</div>${fig}
    <div class="question-pts">${pts(q.points)}</div>
    ${input}
    <div class="row wrap" style="margin-top:12px">
      <button class="btn btn-primary btn-sm" data-check="${esc(q.id)}" ${readOnly ? 'disabled' : ''}>Check answer</button>
      <span class="muted" style="font-size:0.85em" data-tries="${esc(q.id)}"></span>
    </div>
    <div style="margin-top:10px;font-size:0.9em" data-reply="${esc(q.id)}" role="status" aria-live="polite"></div>
    <div class="muted" style="margin-top:6px;font-size:0.82em" data-counts="${esc(q.id)}"></div>
  </div>`;
}

export function renderHomework(view) {
  return `
    <div class="card">
      <div class="card-title">${esc(view.title)}</div>
      <div class="card-meta">${esc(view.dueText)}</div>
      <div style="font-size:0.9em;color:var(--muted)">${esc(ruleText(view.rule))}
        ${view.limit === null ? '' : ` You get ${esc(tries(view.limit))} on each question.`}</div>
      <div style="margin-top:12px;font-weight:700" id="hw-score" role="status" aria-live="polite">${esc(view.score.text)}</div>
    </div>
    ${view.banner ? `<div class="alert ${view.readOnly ? 'alert-warn' : 'alert-info'}">${esc(view.banner)}</div>` : ''}
    ${view.heldBack > 0 ? `<div class="alert alert-info">${esc(heldBackText(view.heldBack))}</div>` : ''}
    <div id="hw-questions">${view.questions.map(q => questionHTML(q, view.readOnly)).join('')}</div>`;
}

/* ── the page ────────────────────────────────────────────────────────────────────────────────────────────── */

const failureHTML = (text) => `
  <div class="alert alert-error"><strong>${esc(text)}</strong></div>
  <button class="btn btn-secondary btn-sm" data-reload>Try again</button>`;

/**
 * Draw the page into `root` and wire it. Returns when the first draw is done.
 * @param {HTMLElement} root
 * @param {{loadItem, loadQuestions, readGrade, invoke, offeringId}} deps
 */
export async function mountHomework(root, deps) {
  const fail = (text) => {
    root.innerHTML = failureHTML(text);
    root.querySelector('[data-reload]')?.addEventListener('click', () => mountHomework(root, deps));
  };
  root.innerHTML = '<div class="center-load"><span class="spinner"></span><span>Loading…</span></div>';

  let item, doc, grade;
  try {
    item = await deps.loadItem();
    if (!item) { root.innerHTML = `<div class="alert alert-info">${esc(TEXT.notOpen)}</div>`; return null; }
    doc = await deps.loadQuestions();
    if (!doc || doc.status !== 'ok') {
      root.innerHTML = `<div class="alert alert-info">${esc(doc?.status === 'not_open' ? TEXT.notOpen : TEXT.notFound)}</div>`;
      return null;
    }
    grade = await deps.readGrade();
  } catch (e) {
    fail(`Could not load this homework: ${e?.message || e}`);
    return null;
  }

  const view = buildView({ item, doc, grade });
  root.innerHTML = renderHomework(view);
  const byId = Object.fromEntries(view.questions.map(q => [q.id, q]));
  const $ = (sel) => root.querySelector(sel);
  const busy = new Set();

  const drawTries = (q) => {
    const el = $(`[data-tries="${CSS.escape(q.id)}"]`);
    if (el) el.textContent = triesLeftText(view.limit, q.used);
  };
  const drawCounts = (q) => {
    const el = $(`[data-counts="${CSS.escape(q.id)}"]`);
    if (el) el.textContent = q.counts ? `Counts toward your score: ${fmt(q.counts.score)} of ${fmt(q.counts.max)}.`
                                      : (q.used ? '' : 'Not answered yet.');
  };
  const drawReply = (q, tone, text) => {
    const el = $(`[data-reply="${CSS.escape(q.id)}"]`);
    if (!el) return;
    el.textContent = text || '';
    el.style.color = tone === 'ok' ? 'var(--green, #2e7d32)' : tone === 'bad' ? 'var(--red, #c62828)' : '';
    el.style.fontWeight = tone ? '700' : '';
  };
  const setLocked = (q, locked) => {
    const block = $(`#qb-${CSS.escape(q.id)}`);
    block?.querySelectorAll('[data-entry], [data-check]').forEach(el => { el.disabled = locked; });
  };
  const closedOrSpent = (q) => view.readOnly || (q.left !== null && q.left <= 0);

  view.questions.forEach(q => { drawTries(q); drawCounts(q); if (closedOrSpent(q)) setLocked(q, true); });

  const readEntered = (q) => {
    const block = $(`#qb-${CSS.escape(q.id)}`);
    if (q.format === 'numeric' || q.format === 'symbolic') return { text: block.querySelector('input[type="text"]').value };
    return { choices: [...block.querySelectorAll('input:checked')].map(i => i.value) };
  };

  async function check(q) {
    if (busy.has(q.id) || view.readOnly) return;                    // one send at a time per question
    const entry = readEntry(q, readEntered(q));
    if (!entry.ok) { drawReply(q, 'bad', entry.text); return; }
    busy.add(q.id); setLocked(q, true); drawReply(q, '', 'Checking…');
    const reply = await sendAnswer(deps, deps.offeringId, q, entry.value, view.limit);
    busy.delete(q.id);

    if (reply.kind === 'checked') {
      q.used = reply.attemptNo || q.used + 1;
      q.left = reply.left;
      drawReply(q, reply.correct ? 'ok' : 'bad', reply.text);
    } else {
      if (reply.spent) q.left = 0;
      if (reply.closed) view.readOnly = true;
      drawReply(q, 'bad', reply.text);
    }
    drawTries(q);
    if (reply.kind === 'checked' || reply.spent) {
      try {                                                          // the score is the database's, read back
        const g = await deps.readGrade();
        const s = g?.question_scores?.[q.qid];
        q.counts = s && s.max !== undefined ? { score: num(s.score), max: num(s.max) } : q.counts;
        const sc = scoreText(g, item);
        const el = $('#hw-score'); if (el) el.textContent = sc.text;
        drawCounts(q);
      } catch {
        const el = $('#hw-score'); if (el) el.textContent = 'Your score could not be loaded.';
        drawCounts(q);
        drawReply(q, 'bad', `${reply.text} ${TEXT.scoreMissing}`.trim());
      }
    }
    if (view.readOnly) view.questions.forEach(x => setLocked(x, true));
    else setLocked(q, closedOrSpent(q));
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-check]');
    if (b && byId[b.dataset.check]) check(byId[b.dataset.check]);
  });
  root.addEventListener('keydown', (e) => {
    const t = e.target.closest?.('input[type="text"][data-entry]');
    if (t && e.key === 'Enter' && byId[t.dataset.entry]) { e.preventDefault(); check(byId[t.dataset.entry]); }
  });
  root.addEventListener('input', (e) => {
    const t = e.target.closest?.('input[type="text"][data-entry]');
    const q = t && byId[t.dataset.entry];
    if (!q || q.format !== 'symbolic') return;
    const el = $(`[data-preview="${CSS.escape(q.id)}"]`);
    if (!el) return;
    const p = symbolicPreview(q, t.value);
    el.textContent = p.text;
    el.style.color = p.tone === 'bad' ? 'var(--red, #c62828)' : '';
  });
  root.addEventListener('change', (e) => {
    const r = e.target.closest?.('input[type="radio"][data-entry], input[type="checkbox"][data-entry]');
    if (!r) return;
    root.querySelectorAll(`[data-choice-row="${CSS.escape(r.dataset.entry)}"]`).forEach(l =>
      l.classList.toggle('selected', !!l.querySelector('input:checked')));
  });
  return view;
}
