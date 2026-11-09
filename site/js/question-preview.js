// question-preview.js — how a typed-response question set looks to a cadet, read-only, for the Assignments page.
//
// This was the older lesson editor's preview, kept inside that page where no test could reach it. It is a module now so the
// Assignments page and a test use one function. It draws what a cadet would see (the text, a note, a figure, the kind of box)
// with every control disabled, and states nothing about grading.

import { esc } from './util.js';

/** The preview markup for one assignment's questions. An empty list says there is nothing to preview. */
export function previewHtml(title, questions) {
  if (!questions || !questions.length) {
    return `<div class="muted">This assignment has no typed-response questions to preview. A tutor is a separate page and is not shown here.</div>`;
  }
  const head = `<h3 style="margin-top:0">${esc(title || 'Assignment')}</h3>`;
  return head + questions.map((q, i) => {
    const pts = q.points != null && q.points !== '' ? ` <span class="muted" style="font-size:.8em">(${esc(q.points)} pt${Number(q.points) === 1 ? '' : 's'})</span>` : '';
    const note = q.student_note ? `<div class="muted" style="font-size:.84em;margin:4px 0">${esc(q.student_note)}</div>` : '';
    const fig = q.figure_url ? `<img src="${esc(q.figure_url)}" alt="figure for question ${i + 1}" style="max-width:100%;border-radius:8px;margin:8px 0;display:block">` : '';
    let input;
    if (q.type === 'multiple_choice') {
      input = (q.options || []).map((o) => `<label class="check-inline" style="display:block;margin:2px 0"><input type="radio" name="prev-${i}" disabled> ${esc(o)}</label>`).join('');
    } else if (q.type === 'numerical') {
      input = `<input type="number" disabled placeholder="Your answer" style="max-width:220px">`;
    } else {
      input = `<textarea rows="3" disabled placeholder="Type your answer..."></textarea>`;
    }
    return `<div class="card" style="margin-bottom:12px">
          <div style="font-weight:600">Q${i + 1}.${pts}</div>
          <div style="margin:6px 0;white-space:pre-wrap">${esc(q.text || '')}</div>
          ${note}${fig}
          <div class="field" style="margin-bottom:0">${input}</div>
        </div>`;
  }).join('');
}
