// student-summary.js — the student's "All classes" page (site/student/summary.html).
//
// A cadet is often in more than one course that uses PREP. This page lists the work due across every class they
// are actively enrolled in, soonest deadline first, and gives each class a short block with a link to its own
// dashboard.
//
// ONE LOADER, CALLED ONCE PER ENROLLMENT. Every number and every row comes from loadLessonStatuses() (a projection
// over loadAssignmentStatuses in student-data.js), called with a ctx narrowed to one offering. That is the same
// loader the course dashboard and the assignment list use, so:
//   - the release window (LOOKAHEAD_DAYS) is applied inside it, exactly as on those pages, and nothing here can
//     bypass it with a query of its own;
//   - the state of a row (not started, draft, past due) is its resolveState(), never re-derived;
//   - a deadline is the student's own (their section's, or their extension), because the loader resolved it.
// This file adds no total and does not branch on what kind of assignment a row is. It only merges lists and groups
// them by deadline.
//
// A failed read for one class is that class's error. It is never an empty list: "all caught up" is said only for a
// class whose read succeeded and had nothing open.

import { loadLessonStatuses, STATE } from './student-lessons.js';
import { releaseNote } from './schema.js';
import { infoHTML, esc, relativeDue, fmtDateTime, deadlineClass } from './util.js';

/** A deadline inside this many hours is "due soon"; the groups are overdue, due soon, and later. */
export const SOON_HOURS = 48;

/** The classes a student is actively in: not a finished (completed) term. */
export function activeCourses(ctx) {
  return (ctx.courses || []).filter(c => !c.past);
}

/**
 * A ctx narrowed to one offering, for the loaders. Reads fall through to the real ctx; only the fields that name
 * "the current offering" and the student's own enrollments in it are replaced.
 */
export function courseCtx(ctx, course) {
  const mine = (ctx.enrollments || []).filter(e => e.sections?.course_offering_id === course.offeringId);
  return Object.assign(Object.create(ctx), {
    currentOffering: course.offeringId,
    currentIsPast: !!course.past,
    currentCourse: course.courseId,
    currentCourseCode: course.courseCode,
    currentTermLabel: course.termLabel,
    sectionIds: mine.map(e => e.section_id),
    enrollmentIds: mine.map(e => e.id),
  });
}

/** Which rows the summary lists: open work (not started, or a saved draft) and work already past due. */
export const isListed = (l) => l.state === STATE.NOT_STARTED || l.state === STATE.DRAFT || l.state === STATE.MISSED;

export const courseTitle = (c) => c.courseTitle || c.courseCode || 'Course';

/**
 * Load every active class, in parallel. Never rejects: each class comes back as
 * `{ course, rows, lockedCount }` or `{ course, error }`.
 * @param {object} ctx
 * @param {{ load?: Function }} [opts] `load` replaces the loader (tests)
 */
export async function loadSummary(ctx, { load = loadLessonStatuses } = {}) {
  const courses = activeCourses(ctx);
  return Promise.all(courses.map(async (course) => {
    try {
      const items = await load(courseCtx(ctx, course));
      return { course, rows: items.filter(isListed), lockedCount: items.lockedCount || 0, total: items.length };
    } catch (err) {
      console.error('[summary] could not load', course.courseCode, err);
      return { course, error: err };
    }
  }));
}

const dueMs = (l) => (l.due ? new Date(l.due).getTime() : Infinity);

/**
 * Merge the classes' rows into the three groups, soonest deadline first inside each.
 * @returns {{ overdue: Row[], soon: Row[], later: Row[] }} where a Row is the loader's row plus `course`
 */
export function groupRows(perCourse, now = new Date()) {
  const all = [];
  for (const c of perCourse) for (const l of (c.rows || [])) all.push({ ...l, course: c.course });
  all.sort((a, b) => dueMs(a) - dueMs(b));
  const edge = now.getTime() + SOON_HOURS * 3600 * 1000;
  return {
    overdue: all.filter(l => l.state === STATE.MISSED),
    soon: all.filter(l => l.state !== STATE.MISSED && dueMs(l) <= edge),
    later: all.filter(l => l.state !== STATE.MISSED && dueMs(l) > edge),
  };
}

/** Where a row goes: the same assignment page the course dashboard opens (it shows every way to do the work), in that class. */
export const rowHref = (l) => `lessons.html?l=${encodeURIComponent(l.id)}&offering=${encodeURIComponent(l.course.offeringId)}`;
/** A class's own dashboard. */
export const courseHref = (course) => `dashboard.html?offering=${encodeURIComponent(course.offeringId)}`;

/** The state in the student's words. Only the three listed states can reach here. */
export function statusLabel(l) {
  if (l.state === STATE.MISSED) return 'Past due';
  return l.state === STATE.DRAFT ? 'Draft saved' : 'Not started';
}

/**
 * The page body.
 * @param {Array} perCourse the loadSummary() result
 * @param {{ now?: Date }} [h]
 */
export function renderSummary(perCourse, h = {}) {
  const now = h.now || new Date();
  const failed = perCourse.filter(c => c.error);

  if (!perCourse.length) {
    return `<div class="page-head"><h1>All classes</h1></div>
      <div class="empty-state"><h3>No classes yet</h3>
        <p>You are not in a class that uses PREP. If that is wrong, ask your instructor.</p></div>`;
  }

  const g = groupRows(perCourse, now);
  const row = (l) => `<a class="list-item" href="${esc(rowHref(l))}" data-offering="${esc(l.course.offeringId)}">
      <span class="status-dot ${esc(l.dot)}"></span>
      <div class="li-body">
        <div class="li-title">${l.lesson_number != null ? esc(l.lesson_number) + '. ' : ''}${esc(l.title)}</div>
        <div class="li-meta"><span class="tag blue">${esc(courseTitle(l.course))}</span>
          <span>${esc(statusLabel(l))}</span>
          <span class="deadline ${esc(deadlineClass(l.due, l.isPast))}">${l.due ? esc(`Due ${fmtDateTime(l.due)} · ${relativeDue(l.due)}`) : 'No due date'}</span></div>
      </div>
      <div class="li-right"><span class="li-arrow">›</span></div></a>`;
  const group = (id, title, rows) => rows.length ? `<section class="dash-section" data-group="${id}">
      <div class="section-head"><h2>${title}</h2><span class="count-pill">${rows.length}</span></div>
      <div class="list">${rows.map(row).join('')}</div></section>` : '';

  const nothing = !g.overdue.length && !g.soon.length && !g.later.length;
  const errorBanner = failed.length
    ? `<div class="alert alert-error" role="alert" data-summary-error>Couldn't load the work for ${failed.map(f => esc(courseTitle(f.course))).join(' and ')}.
        What is listed below may be incomplete. Reload the page to try again.</div>` : '';
  // "All caught up" is true only when every class's read worked and none has anything open.
  const caughtUp = nothing && !failed.length
    ? `<div class="empty-state" data-summary-empty><h3>All caught up</h3>
        <p>You have no open or past-due assignments in any of your classes right now.</p></div>` : '';

  const block = (c) => {
    if (c.error) {
      return `<div class="card" data-course="${esc(c.course.offeringId)}">
        <div class="card-title">${esc(courseTitle(c.course))}</div>
        <div class="alert alert-error" role="alert">Couldn't load this class. This is not the same as having nothing to do.</div>
        <a class="btn btn-ghost btn-sm" href="${esc(courseHref(c.course))}">Open ${esc(courseTitle(c.course))}</a></div>`;
    }
    const over = c.rows.filter(l => l.state === STATE.MISSED).length;
    const open = c.rows.length - over;
    const locked = releaseNote(c.lockedCount);
    const line = [open ? `${open} open` : '', over ? `${over} past due` : ''].filter(Boolean).join(' · ')
      || (c.lockedCount ? 'Nothing open right now' : 'Nothing open or past due');
    return `<div class="card" data-course="${esc(c.course.offeringId)}">
      <div class="row wrap" style="justify-content:space-between;gap:10px">
        <div><div class="card-title">${esc(courseTitle(c.course))}</div>
          <div class="muted" style="font-size:0.875rem">${esc(c.course.termLabel || '')}${c.course.termLabel ? ' · ' : ''}${esc(line)}</div></div>
        <a class="btn btn-ghost btn-sm" href="${esc(courseHref(c.course))}">Open class</a></div>
      ${locked ? `<div class="field-hint" style="margin-top:8px">${esc(locked)}</div>` : ''}</div>`;
  };

  return `<div class="page-head"><h1>All classes${infoHTML('Work due across every class you are in, soonest deadline first. An assignment appears here in the days before its deadline, the same as in each class.', 'About this page')}</h1>
      <div class="sub">${perCourse.length === 1 ? 'Your class' : `Your ${perCourse.length} classes`}</div></div>
    ${errorBanner}
    ${group('overdue', 'Past due', g.overdue)}
    ${group('soon', 'Due soon', g.soon)}
    ${group('later', 'Later', g.later)}
    ${caughtUp}
    <section class="dash-section" data-group="classes">
      <div class="section-head"><h2>Your classes</h2></div>
      <div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">${perCourse.map(block).join('')}</div>
    </section>`;
}
