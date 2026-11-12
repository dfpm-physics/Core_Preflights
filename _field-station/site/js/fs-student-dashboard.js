// Field Station: the student dashboard, rebuilt as the concept's first screen.
//
// Same data calls as site/student/dashboard.html (loadStudentLessonDashboard, releaseNote, totalView ...),
// the same bootstrap and the same nav. Only the arrangement is new: the next piece of work as one card,
// real counts, a real week, then what the page already offered (past due, recently graded).
//
// Nothing is shown that the data does not hold. There is no "Draft saved" unless this lesson's state is
// a saved draft, no lesson number unless the row has one, no section unless the cadet has one. A failed
// read is an error with a retry button; it is never "all caught up". The code branches on state and on
// delivery, never on the kind of work.

import { bootstrap } from './auth.js';
import { renderNav } from './nav.js';
import { initTheme } from './theme.js';
import { loadStudentLessonDashboard, STATE } from './student-lessons.js';
import { releaseNote } from './schema.js';
import { pointsText, scoreText, gradingNote, totalView, modeLabel } from './student-view.js';
import { esc, relativeDue, fmtDateTime, runPage, guarded } from './util.js';

const ctx = await bootstrap({ require: 'student' });
runPage(ctx, () => { initTheme(); renderNav(ctx, { active: 'dashboard', onCourseChange: guarded(() => main()) }); return main(); });

const FS = new URL('../fs/', import.meta.url).pathname;        // /site/fs/
const firstName = (ctx?.studentRow?.name || '').split(/\s+/)[0] || 'Cadet';
const lessonHref = (l) => `lessons.html?l=${encodeURIComponent(l.id)}`;
// A lesson with two ways to do it (written and interactive) always opens the page that shows both, as the real
// dashboard did. Only plain auto-checked homework goes straight to its own page.
const openHref = (l) => ((l.canChoose || l.hasInteraction) ? lessonHref(l) : (l.homeworkHref || lessonHref(l)));

/* ── which sketch, if any ───────────────────────────────────────────────────── */
let sketchMapOnce = null;
function sketchMap() {
  if (!sketchMapOnce) {
    sketchMapOnce = fetch(`${FS}sketch-map.json`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { sketches: [] })).catch(() => ({ sketches: [] }));
  }
  return sketchMapOnce;
}
async function sketchFor(l) {
  const map = await sketchMap();
  // ?fs-sketch=dipole forces one, for judging the design. It is never set by the page itself.
  const forced = new URLSearchParams(location.search).get('fs-sketch');
  const text = String(l.title || '');   // the title only: a description that mentions a force or a field says nothing about the topic
  for (const s of map.sketches || []) {
    const hit = forced === s.id || (s.match || []).some(p => { try { return new RegExp(p, 'i').test(text); } catch { return false; } });
    if (hit) return s;
  }
  return null;
}

/* ── words, all from the row's own state ────────────────────────────────────── */
function stateWord(l) {
  switch (l.state) {
    case STATE.NOT_STARTED: return 'Not started';
    case STATE.DRAFT:       return 'Draft saved';
    case STATE.SUBMITTED:   return 'Submitted · editable until due';
    case STATE.COMPLETE:    return 'Complete · interactive';
    case STATE.GRADING:     return 'Submitted · grading in progress';
    case STATE.GRADED:      return `Graded ${scoreText(l.completion?.points, l.points) || pointsText(l.completion?.points)}`.trim();
    case STATE.MISSED:      return 'Past due';
    case STATE.EXCUSED:     return 'Excused · left out of your total';
    default:                return '';
  }
}
const dueLine = (l) => (l.due ? `${relativeDue(l.due)} · ${fmtDateTime(l.due)}` : 'No due date');
const isLate = (l) => !!l.due && l.due < new Date() && l.state === STATE.MISSED;

/* ── pieces ─────────────────────────────────────────────────────────────────── */
function figure(s) {
  if (!s) return '';
  return `<figure class="fs-art">
    <img class="fs-art-light" src="${FS}${esc(s.light)}" alt="" loading="lazy">
    <img class="fs-art-dark" src="${FS}${esc(s.dark)}" alt="" loading="lazy">
  </figure>`;
}

async function nextCard(vm) {
  const todo = [...vm.toDo].sort((a, b) => (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity));
  const l = todo[0];
  if (!l) {
    const locked = releaseNote(vm.lockedCount);
    const art = locked ? 'nothing-open-yet' : 'all-caught-up';
    return `<section class="fs-next no-art" aria-labelledby="fs-next-h"><div class="fs-state">
      <img class="fs-light" src="${FS}graphics/light/${art}.svg" alt=""><img class="fs-dark" src="${FS}graphics/dark/${art}.svg" alt="">
      <div><div class="fs-eyebrow">Up next</div>
      <h2 id="fs-next-h">${locked ? 'Nothing open right now.' : 'All caught up.'}</h2>
      <p>${esc(locked || 'You have no open assignments right now.')}</p>
      <p style="margin-top:14px"><a class="btn btn-ghost" href="lessons.html">See all assignments</a></p></div></div></section>`;
  }
  const art = figure(await sketchFor(l));
  const meta = [modeLabel(l), pointsText(l.points)].filter(Boolean).join(' · ');
  const label = l.state === STATE.DRAFT ? 'Continue' : 'Start';
  return `<section class="fs-next${art ? '' : ' no-art'}" aria-labelledby="fs-next-h">
    <div>
      <div class="fs-eyebrow">Up next${l.lesson_number != null ? ` / Lesson ${esc(l.lesson_number)}` : ''}</div>
      <h2 id="fs-next-h">${esc(l.title)}</h2>
      <div class="fs-due${l.due && l.due < new Date() ? ' overdue' : ''}">${esc(dueLine(l))}</div>
      <div class="fs-meta">${esc([stateWord(l), meta].filter(Boolean).join(' · '))}</div>
      <a class="btn btn-primary" href="${esc(openHref(l))}" aria-label="${label}: ${esc(l.title)}">${label} <span aria-hidden="true">›</span></a>
      ${l.canChoose ? '<div class="fs-note">You can do this one in writing or with the interactive lesson. The next page shows both.</div>' : ''}
    </div>${art}</section>`;
}

function counts(vm) {
  const tv = totalView(vm.total);
  const points = vm.totalError ? 'Unavailable' : (tv && tv.possible ? `${tv.earned}/${tv.possible}` : '—');
  const c = (n, label) => `<div class="fs-count"><b>${esc(n)}</b><span>${esc(label)}</span></div>`;
  return `<div class="fs-counts" role="group" aria-label="Your counts">
    ${c(vm.stats.toDo, 'To do')}${c(vm.stats.missed, 'Past due')}${c(points, 'Points so far')}${c(vm.stats.graded, 'Graded')}</div>
    ${vm.totalError ? `<div class="fs-err" role="alert"><b>Your running total could not be loaded.</b>${esc(vm.totalError)}</div>` : ''}`;
}

function rows(list, { extra } = {}) {
  return `<ul class="fs-rows">${list.map(l => `<li><a class="list-item" href="${esc(lessonHref(l))}">
    <span class="fs-t">${l.lesson_number != null ? esc(l.lesson_number) + '. ' : ''}${esc(l.title)}</span>
    <span class="fs-d">${esc(l.due ? fmtDateTime(l.due) : 'No due date')}</span>
    <span class="fs-s${isLate(l) ? ' overdue' : ''}">${esc(extra ? extra(l) : stateWord(l))}</span></a></li>`).join('')}</ul>`;
}

function week(vm) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 7 * 86400000);
  const inWeek = (l) => l.due && l.due >= start && l.due < end;
  const open = (l) => l.state !== STATE.MISSED && l.state !== STATE.GRADED;
  const list = vm.lessons.filter(l => inWeek(l) && open(l)).sort((a, b) => a.due - b.due);
  // Everything the real dashboard lists as to do is listed here too: whatever is not due this week goes under Later.
  const later = vm.toDo.filter(l => !list.includes(l)).sort((a, b) => (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity));
  const locked = releaseNote(vm.lockedCount);
  return `<section class="fs-week" aria-labelledby="fs-week-h">
    <h2 id="fs-week-h">Your week</h2>
    ${list.length
      ? `<div class="fs-rowhead" aria-hidden="true"><span>Assignment</span><span>Due</span><span>Status</span></div>${rows(list)}`
      : '<p class="fs-quiet">Nothing is due in the next seven days.</p>'}
    ${later.length ? `<h2 id="fs-later-h" class="fs-sub">Later</h2>${rows(later)}` : ''}
    ${locked ? `<p class="fs-quiet">${esc(locked)}</p>` : ''}
    <p><a class="btn btn-ghost btn-sm" href="lessons.html">All assignments</a></p></section>`;
}

function missed(vm) {
  if (!vm.missed.length) return '';
  return `<section class="fs-block" aria-labelledby="fs-missed-h"><h2 id="fs-missed-h">Past due</h2>${rows(vm.missed)}</section>`;
}

const pathWord = (c) => (!c?.path ? 'nothing submitted' : c.path === 'interaction' ? 'interactive' : 'written');
function graded(vm) {
  if (!vm.graded.length) return '';
  const note = (l) => [scoreText(l.completion?.points, l.points) || pointsText(l.completion?.points),
    gradingNote(l.gradingMode), pathWord(l.completion)].filter(Boolean).join(' · ');
  return `<section class="fs-block" aria-labelledby="fs-graded-h"><h2 id="fs-graded-h">Recently graded</h2>${rows(vm.graded, { extra: note })}</section>`;
}

/* ── the page ───────────────────────────────────────────────────────────────── */
async function main() {
  const root = document.getElementById('main');
  let vm;
  try {
    vm = await loadStudentLessonDashboard(ctx);
  } catch (e) {
    // A failed read is an error. It is never turned into an empty list or "all caught up".
    root.innerHTML = `<div class="fs-dash"><h1>Your next assignment.</h1>
      <div class="fs-err" role="alert"><b>Your assignments could not be loaded.</b>${esc(e?.message || 'Something went wrong.')}
      <div><button class="btn btn-primary btn-sm" id="fs-retry">Try again</button></div></div></div>`;
    document.getElementById('fs-retry')?.addEventListener('click', () => { root.innerHTML = ''; main(); });
    return;
  }
  if (vm.noCourse) {
    root.innerHTML = `<div class="fs-dash"><h1>Welcome, ${esc(firstName)}.</h1>
      <div class="alert alert-warn">Your section isn't assigned to a course yet. Ask your instructor to add you to a section so your assignments appear here.</div></div>`;
    return;
  }
  const card = await nextCard(vm);
  root.innerHTML = `<div class="fs-dash">
    <h1>Your next assignment.</h1>
    ${ctx.currentIsPast ? '<div class="alert alert-warn">Past term, read only.</div>' : ''}
    ${card}${counts(vm)}${week(vm)}${missed(vm)}${graded(vm)}</div>`;
}
