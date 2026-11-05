// free-response-ui.js — draws the free-response question editor inside the Assignments page's item form.
//
// All the rules live in free-response.js (pure, tested). This file only draws and listens. It holds one
// editor object (the shape editorFromContent returns), mutates it as the person types, and redraws on structure
// changes. No inline event handlers: every control is wired with addEventListener, as the page's content security
// policy requires.

import { esc } from './util.js';
import { uploadFigure } from './faculty-lessons.js';
import {
  QUESTION_TYPES, TYPE_LABEL, READING_TIME_NOTE, newQuestion, pinnedState, pinOn, pinOff,
  ragLabel, parseRagManifest, showKeys, PINNED_ROLES, removeQuestion, canChangeType,
} from './free-response.js';

const ROLE_LABEL = { reading_time: 'Reading time question', reading_reflection: 'Reading reflection question' };

/** Fetch the list of reference PDFs the grader can read. [] on any failure: the select then offers only "other". */
export async function loadManifest(url = '../../textbook-pdfs/rag-manifest.txt') {
  try {
    const r = await fetch(url);
    if (!r.ok) return [];
    return parseRagManifest(await r.text());
  } catch { return []; }
}

/**
 * Mount the editor in `host`. Returns { set(editor), get(), setManifest(list) }.
 * `opts.aiDrafted()` says whether the item is graded by AI drafts (the page reads its grading select).
 */
export function mountFreeResponse(host, opts = {}) {
  const moreHost = opts.moreHost || null;
  let editor = null;
  let manifest = [];
  let notice = '';
  let pdfOther = false;          // "Other" was picked and nothing has been typed yet

  const get = () => editor;
  const set = (e) => { editor = e; notice = ''; pdfOther = false; draw(); };
  const setManifest = (list) => { manifest = list || []; if (editor) draw(); };

  function pdfSelect() {
    const cur = editor.reference_pdf || '';
    const known = manifest.includes(cur);
    const other = (cur && !known) || pdfOther;
    const opts2 = ['<option value="">No reference file</option>']
      .concat(manifest.map(p => `<option value="${esc(p)}"${p === cur ? ' selected' : ''}>${esc(ragLabel(p))}</option>`))
      .concat([`<option value="__other"${other ? ' selected' : ''}>Other (type the path)</option>`]);
    return `<select data-f="pdf">${opts2.join('')}</select>` +
      (other ? `<input type="text" data-f="pdf-text" value="${esc(cur)}" placeholder="Text_Book_PDFs/…" style="margin-top:6px">` : '');
  }

  function qHtml(q, i) {
    const pinned = PINNED_ROLES.includes(q.role);
    const typeSel = pinned ? `<span class="muted">${esc(ROLE_LABEL[q.role])}</span>` :
      !canChangeType(q) ? `<span class="muted" title="To change the type, remove this question and add a new one.">${esc(TYPE_LABEL[q.type])}</span>` :
      `<select data-q="${i}" data-f="type">${QUESTION_TYPES.map(t =>
        `<option value="${t}"${t === q.type ? ' selected' : ''}>${esc(TYPE_LABEL[t])}</option>`).join('')}</select>`;
    let body = `<div class="field"><label>Question text</label><textarea data-q="${i}" data-f="text" rows="2">${esc(q.text)}</textarea></div>`;
    if (q.type === 'numerical') {
      body += `<div class="row wrap" style="gap:12px"><div class="field"><label>Correct answer (a number)</label>
          <input type="text" data-q="${i}" data-f="correct_answer" value="${esc(q.correct_answer ?? '')}"></div>
        <div class="field"><label>Tolerance (0 to 1, e.g. 0.05 is 5%)</label>
          <input type="text" data-q="${i}" data-f="tolerance" value="${esc(q.tolerance ?? 0.05)}" style="width:90px"></div></div>`;
    } else if (q.type === 'multiple_choice') {
      body += `<div class="field"><label>Options (one per line, with its letter)</label>
          <textarea data-q="${i}" data-f="options" rows="4">${esc((q.options || []).join('\n'))}</textarea></div>
        <div class="field"><label>Correct option (copy its line)</label>
          <input type="text" data-q="${i}" data-f="correct_answer" value="${esc(q.correct_answer ?? '')}"></div>`;
    } else {
      body += `<div class="field"><label>What a good answer looks like (for the grader; students never see this)</label>
          <textarea data-q="${i}" data-f="expected_response" rows="2">${esc(q.expected_response ?? '')}</textarea>
          ${q._stored ? '<div class="field-hint">Emptying this box does not remove guidance already stored. Replace it with new text to change it.</div>' : ''}</div>`;
    }
    const fig = q.figure_url
      ? `<span class="muted">Figure attached.</span> <button type="button" class="btn btn-ghost btn-sm" data-q="${i}" data-act="fig-clear">Remove figure</button>`
      : `<label class="btn btn-ghost btn-sm" style="cursor:pointer">Add figure<input type="file" accept="image/*" data-q="${i}" data-f="figure" style="display:none"></label>`;
    return `<div class="card" style="padding:10px;margin-bottom:10px" data-card="${i}">
      <div class="row" style="justify-content:space-between;gap:8px;align-items:center"><strong>Question ${i + 1}</strong>${typeSel}
        ${q.role === 'reading_time' ? '<span class="muted">0 points</span>' : `<span class="field" style="margin:0"><label style="font-weight:500">Points</label>
          <input type="text" data-q="${i}" data-f="points" value="${esc(q.points)}" style="width:60px"></span>`}</div>
      ${body}
      <div class="row" style="gap:8px">${fig}
        <button type="button" class="btn btn-ghost btn-sm" data-q="${i}" data-act="up"${i === 0 ? ' disabled' : ''}>Up</button>
        <button type="button" class="btn btn-ghost btn-sm" data-q="${i}" data-act="down"${i === editor.questions.length - 1 ? ' disabled' : ''}>Down</button>
        ${pinned ? '' : `<button type="button" class="btn btn-ghost btn-sm" data-q="${i}" data-act="remove">Remove</button>`}</div></div>`;
  }

  function draw() {
    if (!editor) { host.innerHTML = ''; if (moreHost) moreHost.innerHTML = ''; return; }
    const pins = pinnedState(editor);
    // The reading fields and the two pinned-question switches go to the page's "More options" when it gave a
    // second place for them, so a new assignment opens short. With no second place they stay above the questions.
    const readingHtml = `
      <div class="field"><label>Reading</label>
        <div class="row wrap" style="gap:12px"><div class="field grow" style="min-width:220px"><label style="font-weight:500">Reference file the grader reads</label>${pdfSelect()}</div>
          <div class="field"><label style="font-weight:500">Pages</label><input type="text" data-f="pages" value="${esc(editor.reference_pages)}" style="width:110px" placeholder="170-179"></div></div>
        <div class="field"><label style="font-weight:500">Reading link (optional)</label><input type="text" data-f="link" value="${esc(editor.reading_link)}" placeholder="https://"></div></div>
      <div class="row wrap" style="gap:20px;margin-bottom:8px">
        <label class="check-inline"><input type="checkbox" data-pin="reading_time"${pins.reading_time ? ' checked' : ''}> <span>Ask how long the reading took (worth 0 points)</span></label>
        <label class="check-inline"><input type="checkbox" data-pin="reading_reflection"${pins.reading_reflection ? ' checked' : ''}> <span>Ask for a reading reflection</span></label></div>
      <div class="field-hint">${esc(READING_TIME_NOTE)}</div>
      ${notice ? `<div class="alert alert-info">${esc(notice)}</div>` : ''}`;
    const questionsHtml = `
      <div id="fr-list">${editor.questions.map(qHtml).join('')}</div>
      <div class="row wrap" style="gap:8px"><span class="muted">Add a question:</span>
        ${QUESTION_TYPES.map(t => `<button type="button" class="btn btn-ghost btn-sm" data-add="${t}">${esc(TYPE_LABEL[t])}</button>`).join('')}</div>
      ${opts.aiDrafted && opts.aiDrafted() ? `<div class="field-hint" style="margin-top:8px">Graded by AI drafts: each free-response question needs
        a description of a good answer above, because that is what the overnight draft is checked against. A person still reviews every grade.</div>` : ''}`;
    if (moreHost) { moreHost.innerHTML = readingHtml; host.innerHTML = questionsHtml; }
    else host.innerHTML = readingHtml + questionsHtml;
  }

  const onInput = (ev) => {
    const el = ev.target; if (!editor || !(el instanceof HTMLElement)) return;
    const f = el.dataset.f, qi = el.dataset.q;
    if (f === 'pages') editor.reference_pages = el.value;
    else if (f === 'link') editor.reading_link = el.value;
    else if (f === 'pdf-text') editor.reference_pdf = el.value;
    else if (qi !== undefined && f && f !== 'type' && f !== 'figure') {
      const q = editor.questions[Number(qi)]; if (!q) return;
      if (f === 'options') q.options = el.value.split('\n').map(s => s.trim()).filter(Boolean);
      else if (f === 'points') q.points = el.value.trim() === '' ? '' : Number(el.value);
      else if (f === 'tolerance') q.tolerance = el.value.trim() === '' ? '' : Number(el.value);
      else q[f] = el.value;
      if (f === 'expected_response' || f === 'correct_answer') q._keyShown = true;
    }
    opts.onChange && opts.onChange();
  };

  const onChange = async (ev) => {
    const el = ev.target; if (!editor || !(el instanceof HTMLElement)) return;
    if (el.dataset.pin) {
      const on = el.checked;
      const r = on ? pinOn(editor, el.dataset.pin) : pinOff(editor, el.dataset.pin);
      notice = r === 'kept' ? 'That question was reworded, so it was kept as an ordinary free-response question.' : '';
      draw(); opts.onChange && opts.onChange(); return;
    }
    if (el.dataset.f === 'pdf') {
      if (el.value === '__other') { pdfOther = true; editor.reference_pdf = ''; } else { pdfOther = false; editor.reference_pdf = el.value; }
      draw(); return;
    }
    if (el.dataset.f === 'type') {
      const i = Number(el.dataset.q); const old = editor.questions[i];
      if (!canChangeType(old)) return;
      const fresh = newQuestion(el.value, [], editor.used_ids);
      editor.questions[i] = { ...fresh, id: old.id, role: old.role, text: old.text, points: old.points, figure_url: old.figure_url };
      draw(); opts.onChange && opts.onChange(); return;
    }
    if (el.dataset.f === 'figure' && el.files && el.files[0]) {
      const i = Number(el.dataset.q);
      try {
        const up = await uploadFigure(el.files[0]);
        if (up.error || !up.url) notice = 'The figure could not be uploaded: ' + (up.error?.message || 'no address came back');
        else { editor.questions[i].figure_url = up.url; notice = ''; }
      } catch (e) { notice = 'The figure could not be uploaded: ' + (e?.message || 'unknown error'); }
      draw(); opts.onChange && opts.onChange();
    }
  };

  const onClick = (ev) => {
    const b = ev.target instanceof HTMLElement ? ev.target.closest('button') : null;
    if (!b || !editor) return;
    if (b.dataset.add) { editor.questions.push(newQuestion(b.dataset.add, editor.questions, editor.used_ids)); draw(); opts.onChange && opts.onChange(); return; }
    const i = Number(b.dataset.q), qs = editor.questions;
    if (b.dataset.act === 'remove') { if (PINNED_ROLES.includes(qs[i]?.role)) return; removeQuestion(editor, i); }
    else if (b.dataset.act === 'up' && i > 0) [qs[i - 1], qs[i]] = [qs[i], qs[i - 1]];
    else if (b.dataset.act === 'down' && i < qs.length - 1) [qs[i + 1], qs[i]] = [qs[i], qs[i + 1]];
    else if (b.dataset.act === 'fig-clear') delete qs[i].figure_url;
    else return;
    draw(); opts.onChange && opts.onChange();
  };

  for (const h of [host, moreHost]) {
    if (!h) continue;
    h.addEventListener('input', onInput);
    h.addEventListener('change', onChange);
    h.addEventListener('click', onClick);
  }

  return { set, get, setManifest, redraw: draw, showKeys };
}
