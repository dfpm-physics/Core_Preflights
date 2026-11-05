// faculty-items.js — data layer for the item entry page (faculty/items.html), against schema `app`.
//
// WHAT AN "ITEM" IS HERE
//   One assignment offering of the selected course offering, with its one path. Kind is a label and
//   a report group; it carries no behaviour. Nothing in this file branches on kind. It branches on
//   DELIVERY (how the student does the work) and GRADING (how it is marked), because those are what
//   the database checks. Kind only prefills those two boxes, from data in `assignment_kinds`.
//
// WHAT THE PAGE NEVER DOES
//   It does not publish: every item it writes carries `entered_on_new_page = true` and
//   `is_published = false`. Publishing is a separate act (publishItem, further down), and the database
//   rules that used to refuse it for these items are removed by migration 079.
//
// DEADLINES
//   Stored by the same helpers the older lesson editor uses (`dueRowsFor`, `defaultDueFrom`,
//   `dueByDayRow` in faculty-lessons.js), imported, not copied. Those helpers read a local time
//   string in the BROWSER's zone, so the page first turns the Mountain-time wall clock the director
//   typed (23:59 by default) into the local string for that same instant. The stored result is then
//   23:59:59 America/Denver, as UTC, whatever zone the browser is in (CORE.md section 2).
//
// TESTABILITY
//   Every function that touches the database is handed the client, so a test can pass a recording
//   stub (tests/app-schema/test-faculty-items.mjs).

import { NEW_PAGE_COLUMN } from './new-page-guard.js';
import { dueRowsFor, defaultDueFrom, dueByDayRow, toEditorDue, pointsChanged, retroactivelyUpdateGrades } from './faculty-lessons.js';
import { contentFromEditor, checkEditor } from './free-response.js';

/* ══════════════════════════════════════════════════════════════════════════════
 * Delivery and grading
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * The (delivery, grading) pairs the database accepts. This is a copy of the CHECK
 * `offering_activities_delivery_grading_ck` in migration app/027, and a test reads that file and
 * fails if the two ever differ. The database stays the authority; this list only keeps the form
 * from offering a combination it would refuse.
 */
export const ALLOWED_PAIRS = [
  ['online_questions', 'auto_checked'],
  ['online_questions', 'human_graded'],
  ['typed_response', 'human_graded'],
  ['typed_response', 'ai_drafted'],
  ['interactive_tutor', 'effort'],
  ['in_person', 'hand_entered'],
  ['in_person', 'imported'],
  ['elsewhere', 'hand_entered'],
  ['elsewhere', 'imported'],
];

/** The activity modality a delivery needs (the trigger `offering_activities_fill_path` checks it). */
export const DELIVERY_MODALITY = {
  online_questions: 'questions',
  typed_response: 'written',
  interactive_tutor: 'interactive',
  in_person: 'external',
  elsewhere: 'external',
};

export const DELIVERY_LABEL = {
  online_questions: 'Questions answered on the site',
  typed_response: 'Typed response',
  interactive_tutor: 'Interactive tutor',
  in_person: 'In person',
  elsewhere: 'Done elsewhere (for example Gradescope)',
};

export const GRADING_LABEL = {
  auto_checked: 'Checked automatically',
  human_graded: 'Graded by a person',
  ai_drafted: 'Free response: AI drafts overnight, a person reviews',
  effort: 'Effort',
  hand_entered: 'Scores typed in by staff',
  imported: 'Scores imported',
};

export const deliveries = () => [...new Set(ALLOWED_PAIRS.map(p => p[0]))];

/** The gradings the database accepts with this delivery. */
export const gradingsFor = (delivery) => ALLOWED_PAIRS.filter(p => p[0] === delivery).map(p => p[1]);

export const pairAllowed = (delivery, grading) =>
  ALLOWED_PAIRS.some(p => p[0] === delivery && p[1] === grading);

/**
 * Whether a yellow (warn) mark earns full credit on this path. True for a typed response, graded by a person or drafted
 * by the AI: that is what the grader's rule and the older editor have always written. False for everything else.
 * (offering_activities_warn_needs_human_ck allows it only with those two gradings; migration 077.)
 */
export const warnEarnsFull = (delivery, grading) =>
  delivery === 'typed_response' && (grading === 'human_graded' || grading === 'ai_drafted');

/** A typed response: the delivery that carries a set of free-response questions. */
export const isTypedResponse = (delivery) => delivery === 'typed_response';

/**
 * An auto-checked path owns the offering's points: a database trigger (migration app/030) sets them
 * to the sum of its questions, so a number typed here would be overwritten. The form therefore shows
 * the points as set by the questions, and never writes them. Until questions exist the sum is 0.
 */
export const pointsOwnedByQuestions = (grading) => grading === 'auto_checked';

/**
 * The delivery and grading to start a form on, from a kind row's own columns. If the stored pair is
 * missing or not one the database accepts, the first allowed grading for the delivery is used, and
 * with no usable delivery the first allowed pair.
 */
export function prefillFromKind(kind) {
  const d = kind?.default_delivery;
  const g = kind?.default_grading;
  if (d && g && pairAllowed(d, g)) return { delivery: d, grading: g };
  if (d && gradingsFor(d).length) return { delivery: d, grading: gradingsFor(d)[0] };
  return { delivery: ALLOWED_PAIRS[0][0], grading: ALLOWED_PAIRS[0][1] };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Mountain time
 * ════════════════════════════════════════════════════════════════════════════ */

export const COURSE_ZONE = 'America/Denver';
export const DEFAULT_TIME = '23:59';

const zoneFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: COURSE_ZONE, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

function zoneParts(ms) {
  const out = {};
  for (const p of zoneFmt.formatToParts(new Date(ms))) out[p.type] = p.value;
  return out;
}

/** Milliseconds the course zone is ahead of UTC at this instant (negative for Denver). */
function zoneOffsetMs(ms) {
  const p = zoneParts(ms);
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return wall - Math.floor(ms / 1000) * 1000;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export function isRealDate(s) {
  if (!DATE_RE.test(String(s || ''))) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function isRealTime(s) {
  if (!TIME_RE.test(String(s || ''))) return false;
  const [h, m] = s.split(':').map(Number);
  return h < 24 && m < 60;
}

/** The instant (ms) at which a Mountain-time wall clock reads this date and time. */
export function zoneWallToInstant(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi, 0);
  let ms = guess - zoneOffsetMs(guess);
  ms = guess - zoneOffsetMs(ms);          // settle once more across a daylight-saving edge
  return ms;
}

/** A stored instant as the Mountain-time date and time a director would read. */
export function instantToZone(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (isNaN(ms)) return null;
  const p = zoneParts(ms);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${String(+p.hour % 24).padStart(2, '0')}:${p.minute}` };
}

/**
 * The local-time string ('YYYY-MM-DDTHH:MM', in the BROWSER's zone) for the instant at which the
 * Mountain-time wall clock reads this date and time. This is the value the shared deadline helpers
 * take, and giving them this makes their local-time reading land on the right instant.
 */
export function editorDue(date, time = DEFAULT_TIME) {
  return toEditorDue(new Date(zoneWallToInstant(date, time)).toISOString());
}

/* ══════════════════════════════════════════════════════════════════════════════
 * The deadline columns
 * ════════════════════════════════════════════════════════════════════════════ */

/** The distinct meeting days of a course offering's sections, in a fixed order. */
export function meetingDays(sections) {
  const set = new Set();
  for (const sec of sections || []) for (const d of sec.meeting_days || []) set.add(d);
  return [...set].sort();
}

/**
 * True when the sections meet on both M-days and T-days. Such a course has two tracks with their own deadlines
 * (the evening before each track's lesson), so one date typed for everyone would be wrong for one of them.
 * A course whose sections declare no M and T days keeps the single date box.
 */
export const isTwoTrack = (sections) => { const d = meetingDays(sections); return d.includes('M') && d.includes('T'); };

/**
 * The date for each meeting day of a two-track course, as typed. When some days have a date and others do not,
 * the missing days take the typed date ONLY if the person ticked that both tracks get the same date; otherwise
 * they stay empty (and checkForm refuses the save).
 */
export function effectiveDayDates(form, sections) {
  const days = meetingDays(sections);
  const out = {};
  for (const d of days) if (form.dayDates?.[d]) out[d] = form.dayDates[d];
  const given = Object.keys(out);
  if (given.length && given.length < days.length && form.sameDate) {
    for (const d of days) if (!out[d]) out[d] = out[given[0]];
  }
  return out;
}

/** True when this Mountain-time wall clock exists on that date (it does not on the night clocks skip an hour). */
export function timeExists(date, time) {
  const z = instantToZone(new Date(zoneWallToInstant(date, time)).toISOString());
  return !!z && z.date === date && z.time === time;
}

/**
 * The three stored forms of the dates on a form.
 *
 * `allDate`       one date for every section (optional), for a course that is NOT two-track. It becomes the
 *                 offering default `due_at`, a `due_by_day` entry for each meeting day any section has, and one
 *                 row per section that meets on such a day (the older editor does the same).
 * `dayDates`      { M: date, T: date } for a two-track course: one date per meeting day, written the way the
 *                 older lesson editor writes its per-day map. `sameDate` says both tracks get one date.
 * `sectionDates`  { sectionId: date } for sections that need a different date. A section whose date
 *                 equals the date it would get anyway is not an exception. A section may meet on no day at
 *                 all, so an exception is a row of its own, never a day.
 * `time`          Mountain time for every date, '23:59' by default.
 *
 * No date at all stores no deadline: `due_at` null, `due_by_day` empty and no rows.
 *
 * @returns {{ dueAt: string|null, dueByDay: object, rows: object[] }}
 */
export function buildSchedule(form, sections, offeringId) {
  const time = form.time || DEFAULT_TIME;
  const dueByDay = {};
  const two = isTwoTrack(sections);
  const eff = two ? effectiveDayDates(form, sections) : {};
  if (two) {
    for (const [day, date] of Object.entries(eff)) dueByDay[day] = editorDue(date, time);
  } else if (form.allDate) {
    const v = editorDue(form.allDate, time);
    dueByDay._all = v;
    for (const sec of sections || []) for (const day of sec.meeting_days || []) dueByDay[day] = v;
  }
  const bySection = new Map(dueRowsFor(offeringId, dueByDay, sections).map(r => [r.section_id, r]));
  for (const sec of sections || []) {
    const d = form.sectionDates?.[sec.id];
    const derived = two ? eff[(sec.meeting_days || []).find(day => eff[day])] : form.allDate;
    if (!d || d === derived) continue;
    // One synthetic one-day section, so the shared helper does the conversion and the row shape.
    const [row] = dueRowsFor(offeringId, { _s: editorDue(d, time) }, [{ id: sec.id, meeting_days: ['_s'] }]);
    bySection.set(sec.id, row);
  }
  return { dueAt: defaultDueFrom(dueByDay), dueByDay: dueByDayRow(dueByDay), rows: [...bySection.values()] };
}

/**
 * The reverse, for opening a saved item: the all-sections date and time from `due_at` (or, for a two-track course,
 * the date of each meeting day from `due_by_day`), and the sections whose stored row says something other than that.
 */
export function scheduleToForm(offering, dueRows, sections = []) {
  const base = instantToZone(offering?.due_at);
  const sectionDates = {};
  if (isTwoTrack(sections)) {
    const dayDates = {};
    let time = null;
    for (const d of meetingDays(sections)) {
      const z = instantToZone(offering?.due_by_day?.[d]);
      if (z) { dayDates[d] = z.date; time = time || z.time; }
    }
    if (!Object.keys(dayDates).length && base) {          // an assignment saved before the days were stored: its one date
      for (const d of meetingDays(sections)) dayDates[d] = base.date;
      time = base.time;
    }
    const byId = new Map(sections.map(s => [s.id, s]));
    for (const r of dueRows || []) {
      const z = instantToZone(r.due_at);
      if (!z) continue;
      const sec = byId.get(r.section_id);
      const day = sec && (sec.meeting_days || []).find(d => dayDates[d]);
      if (day && z.date === dayDates[day] && z.time === time) continue;     // derived by the save, not an exception
      sectionDates[r.section_id] = z.date;
      time = time || z.time;
    }
    return { allDate: '', dayDates, sameDate: false, time: time || DEFAULT_TIME, sectionDates };
  }
  for (const r of dueRows || []) {
    const z = instantToZone(r.due_at);
    if (!z) continue;
    // A row equal to the all-sections date is one the save derived, not an exception. Showing it
    // would turn it into one the next time the all-sections date changes.
    if (base && z.date === base.date && z.time === base.time) continue;
    sectionDates[r.section_id] = z.date;
  }
  const first = base || instantToZone((dueRows || [])[0]?.due_at);
  return { allDate: base ? base.date : '', time: first ? first.time : DEFAULT_TIME, sectionDates };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Slugs and small helpers
 * ════════════════════════════════════════════════════════════════════════════ */

export function slugify(title) {
  const s = String(title || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/g, '');
  return s || 'item';
}

function randomHex(n) {
  const buf = new Uint8Array(Math.ceil(n / 2));
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(buf);
  else for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  return [...buf].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, n);
}

/** A slug for a path nobody types: course code, item slug, modality and a random tail. */
export const pathSlug = (courseCode, itemSlug, modality) =>
  `${courseCode || 'course'}-${itemSlug}-${modality}-${randomHex(8)}`;

/** The assignment slug: the clean one if free in this course, otherwise with a short tail. */
async function freeSlug(db, courseId, base) {
  const { data, error } = await db.from('assignments').select('slug').eq('course_id', courseId);
  if (error) return { error };
  const taken = new Set((data || []).map(r => r.slug));
  let slug = base;
  while (taken.has(slug)) slug = `${base}-${randomHex(4)}`;
  return { slug };
}

/** True when no answer reached the page (a dropped connection), so the outcome of a write is unknown. */
export function isLostResponse(error) {
  if (!error || error.code) return false;
  return /failed to fetch|networkerror|network request failed|load failed|aborted|timed? ?out|fetch/i.test(String(error.message || error));
}

/** The error for a save refused because the item changed after the form was opened (the optimistic check). */
export const CHANGED_ERROR = Object.freeze({
  code: '40001',
  message: 'This assignment changed after you opened it, so nothing was saved. Reload the page and make your change again.',
});

/** A database error as a sentence a director can act on. The raw error is logged by the caller. */
export function plainError(error) {
  const raw = String(error?.message || error || 'Unknown error');
  const text = raw.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, 'this assignment');
  if (error?.code === '42501' || /row-level security|permission denied/i.test(raw)) {
    return 'You do not have permission to change this. Only a director of this course can.';
  }
  if (error?.code === '40001' || /changed after you opened/i.test(raw)) {
    return 'This assignment changed after you opened it (someone else saved it, or its questions changed its points). Nothing was saved. Reload the page and make your change again.';
  }
  if (error?.code === '23505') {
    // Say which rule was hit: only a title clash is cured by changing the title.
    if (/assignments_slug_unique/.test(raw)) return 'An assignment with that name already exists in this course. Change the title and try again.';
    if (/activities_slug_key/.test(raw)) return 'That tutor id is already used by another lesson. Use a different id.';
    if (/assignment_due_dates/.test(raw)) return 'The dates of this assignment were changed at the same moment from another window. Reload the page and try again.';
    if (/activities_one_per_modality/.test(raw)) return 'This assignment already has a path of that kind.';
    return 'The database says something with the same identity already exists, so this was not saved. Reload the page and try again.';
  }
  if (error?.code === '57014' || /statement timeout|canceling statement/i.test(raw)) {
    return 'The database took too long to answer. Reload the page to see what was saved, then try again.';
  }
  if (error?.code === '23503') return 'Other records still depend on this, so the database refused it.';
  if (error?.code === '23502') return 'A required value was missing, so the database refused it.';
  if (isLostResponse(error)) {
    return 'The connection dropped before an answer came back, so it is not known whether this was saved. Reload the page and look before you try again.';
  }
  if (/stay_unpublished/.test(raw)) return 'Assignments entered on this page cannot be published yet.';
  if (/grades_within_bounds/.test(raw)) {
    return 'A grade on this assignment is above its points. Raise the points, or fix that grade first.';
  }
  if (error?.code === '42703' || /schema cache|does not exist/i.test(raw)) {
    return 'This database has not been upgraded for this page yet. Nothing was changed.';
  }
  return text.replace(/\s*\([a-z_]+\)\s*$/i, '');
}

/** True when an error only means this database predates the columns the page needs. */
export function databaseNotReady(error) {
  if (!error) return false;
  return error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST200' ||
    /does not exist|schema cache|could not find|Could not find/i.test(String(error.message || ''));
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Form checks
 * ════════════════════════════════════════════════════════════════════════════ */

export const emptyForm = (kind, sections) => ({
  kindId: kind?.id || '',
  title: '',
  description: '',
  ...prefillFromKind(kind),
  points: '',
  lateAllowed: true,           // GRADE-RULES.md: new work accepts late submissions, marked as late
  isBonus: false,
  progIncluded: false,
  allDate: '',
  dayDates: Object.fromEntries(meetingDays(sections).map(d => [d, ''])),   // used only by a two-track course
  sameDate: false,
  time: DEFAULT_TIME,
  sectionDates: Object.fromEntries((sections || []).map(s => [s.id, ''])),
  interactiveSlug: '',
  interactiveUrl: '',
});

/** Problems with a form, as plain sentences. An empty list means it may be saved. */
export function checkForm(form, { kinds = [], sections = [], slugFrozen = false, lockedPath = false, pointsLocked = false } = {}) {
  const out = [];
  const pointsOwned = lockedPath ? !!pointsLocked : pointsOwnedByQuestions(form.grading);
  if (!String(form.title || '').trim()) out.push('Give the assignment a title.');
  if (String(form.title || '').length > 200) out.push('Keep the title under 200 characters.');
  if (String(form.description || '').length > 2000) out.push('Keep the description under 2000 characters.');
  if (!kinds.some(k => k.id === form.kindId)) out.push('Choose a kind.');
  if (!lockedPath) {
    if (!pairAllowed(form.delivery, form.grading)) out.push('That delivery and grading do not go together.');
    if (form.delivery === 'interactive_tutor' && !slugFrozen) {
      if (!/^[a-z0-9-]+$/.test(String(form.interactiveSlug || '').trim())) {
        out.push('The interactive tutor needs its id: lowercase letters, numbers and hyphens, the same id the lesson posts to.');
      }
    }
  }
  if (!lockedPath && isTypedResponse(form.delivery) && form.freeResponse) {
    for (const p of checkEditor(form.freeResponse)) out.push(p);
  }
  const pts = String(form.points ?? '').trim();
  if (pointsOwned) { /* set by the questions; nothing to check */ }
  else if (pts === '' || isNaN(Number(pts))) out.push('Enter the points (0 or more).');
  else if (Number(pts) < 0 || Number(pts) > 9999.99) out.push('Points must be between 0 and 9999.99.');
  else if (!/^\d+(\.\d{1,2})?$/.test(pts)) out.push('Points may have at most two decimals.');
  const time = form.time || DEFAULT_TIME;
  if (form.time && !isRealTime(form.time)) out.push('The time must look like 23:59.');
  const dates = [];                                   // every real date on the form, for the clock check below
  if (isTwoTrack(sections)) {
    // A course with M-day and T-day sections has two deadlines. One box typed once must not become both by accident.
    const days = meetingDays(sections);
    for (const d of days) {
      const v = form.dayDates?.[d];
      if (!v) continue;
      if (!isRealDate(v)) out.push(`The ${d}-day date is not a real date.`);
      else dates.push(v);
    }
    const given = days.filter(d => form.dayDates?.[d]);
    if (given.length && given.length < days.length && !form.sameDate) {
      out.push(`This course has ${days.join(' and ')} sections, which are due on different days. Enter a date for each (${days.join(', ')}), or tick "Both tracks get the same date" if that is what you mean.`);
    }
    if (form.sameDate && new Set(given.map(d => form.dayDates[d])).size > 1) {
      out.push('You ticked "Both tracks get the same date" but the dates you entered differ. Clear one, or untick the box.');
    }
  } else if (form.allDate) {
    if (!isRealDate(form.allDate)) out.push('The date for all sections is not a real date.');
    else dates.push(form.allDate);
  }
  const known = new Set(sections.map(s => s.id));
  for (const [id, d] of Object.entries(form.sectionDates || {})) {
    if (!d) continue;
    if (!known.has(id)) continue;
    if (!isRealDate(d)) out.push(`A section date is not a real date (${d}).`);
    else dates.push(d);
  }
  if (isRealTime(time)) {
    const missing = [...new Set(dates)].filter(d => !timeExists(d, time));
    if (missing.length) {
      out.push(`${time} does not exist in Mountain time on ${missing.join(', ')}, because the clocks skip that hour. Choose another time.`);
    }
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * "More options": what a first-time form hides, and when it must show it
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * The form shows title, kind, points and one due date. Everything else sits behind a closed "More options" control:
 * the description, how the work is done and graded, the tutor id and link, late work, bonus, Counts at Prog, the
 * deadline time, a date for each track, and a date for one section.
 *
 * A saved assignment opens with the control already open when ANY of those holds something other than its default,
 * so a value that is set is never hidden from the person editing it. The defaults are: no description, the delivery and
 * grading the kind fills in, late work accepted, not bonus, not counted at Prog, 23:59, and no date that differs
 * between tracks or sections. Pure.
 *
 * @param {object|null} item     the saved assignment, or null for a new one (a new form is closed)
 * @param {object} ctx           { prefill: prefillFromKind(its kind), sections, sched: scheduleToForm(...) }
 */
export function needsMoreOptions(item, { prefill = null, sections = [], sched = null } = {}) {
  if (!item) return false;
  if (String(item.description || '').trim()) return true;
  if (item.lateAllowed === false || item.isBonus || item.progIncluded) return true;
  const paths = item.paths || [];
  if (paths.length !== 1) return true;                      // its path cannot be changed here, and the note says so
  const p = paths[0];
  if (p.modality === 'interactive') return true;            // a tutor id and link live there
  if (prefill && (p.delivery !== prefill.delivery || p.grading !== prefill.grading)) return true;
  if (sched) {
    if (sched.time && sched.time !== DEFAULT_TIME) return true;
    if (Object.values(sched.sectionDates || {}).some(Boolean)) return true;
    if (isTwoTrack(sections)) {
      const days = meetingDays(sections);
      const given = days.map(d => sched.dayDates?.[d]).filter(Boolean);
      if (given.length && (given.length < days.length || new Set(given).size > 1)) return true;
    }
  }
  return false;
}

/**
 * Which hidden field a problem sentence from checkForm() is about: an element id inside "More options", or '' when
 * the sentence is about a field that is always shown. The page opens the control and points at that field.
 */
export function moreOptionsTarget(problem) {
  const t = String(problem || '');
  if (/tutor needs its id/i.test(t)) return 'i-islug';
  if (/time must look like|does not exist in Mountain time/i.test(t)) return 'i-time';
  if (/description/i.test(t)) return 'i-desc';
  if (/delivery and grading/i.test(t)) return 'i-delivery';
  if (/section date/i.test(t)) return 'i-sections';
  if (/reading link/i.test(t)) return 'i-written-more';
  if (/-day date|due on different days|Both tracks get the same date/i.test(t)) return 'i-daybox';
  return '';
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Reading
 * ════════════════════════════════════════════════════════════════════════════ */

const ITEM_SELECT =
  `id,assignment_id,points_possible,grading_mode,due_at,due_by_day,is_published,position,updated_at,` +
  `late_allowed,is_bonus,prog_included,${NEW_PAGE_COLUMN},` +
  `assignments!inner(id,slug,title,description,kind_id),` +
  `offering_activities(grading_role,delivery,grading,position,activities(id,slug,modality,title,content)),` +
  `assignment_due_dates(section_id,due_at)`;

/**
 * Everything the page lists for one course offering.
 * @returns {Promise<{ error?: object, items: object[], sections: object[], kinds: object[] }>}
 */
export async function loadItems(db, courseOfferingId) {
  const [kindsR, secR, itemsR] = await Promise.all([
    db.from('assignment_kinds').select('id,label,sort_order,default_delivery,default_grading').order('sort_order'),
    db.from('sections').select('id,code,meeting_days,period').eq('course_offering_id', courseOfferingId).order('code'),
    db.from('assignment_offerings').select(ITEM_SELECT).eq('course_offering_id', courseOfferingId),
  ]);
  const error = kindsR.error || secR.error || itemsR.error || null;
  if (error) return { error, items: [], sections: [], kinds: [] };
  const kinds = kindsR.data || [];
  const sections = secR.data || [];
  const items = (itemsR.data || []).map(r => shapeItem(r, kinds, sections));
  items.sort((a, b) => (a.firstDue ?? Infinity) - (b.firstDue ?? Infinity) || a.title.localeCompare(b.title));
  return { items, sections, kinds };
}

const fmtDue = (iso) => {
  const z = instantToZone(iso);
  if (!z) return '';
  const [y, m, d] = z.date.split('-').map(Number);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  return `${d} ${mon} ${y}${z.time === DEFAULT_TIME ? '' : ' ' + z.time}`;
};

/** The dates of one item in words: one date, "N different dates", or "No date". */
export function describeDates(row, sections = []) {
  const stamps = new Set();
  if (row.due_at) stamps.add(new Date(row.due_at).getTime());
  for (const r of row.assignment_due_dates || []) stamps.add(new Date(r.due_at).getTime());
  const list = [...stamps].filter(n => !isNaN(n)).sort((a, b) => a - b);
  if (!list.length) return 'No date';
  if (list.length === 1) return fmtDue(new Date(list[0]).toISOString());
  const some = (sections || []).length > 1 ? ' by section' : '';
  return `${list.length} dates${some}, ${fmtDue(new Date(list[0]).toISOString())} to ${fmtDue(new Date(list[list.length - 1]).toISOString())}`;
}

export function shapeItem(r, kinds = [], sections = []) {
  const kind = kinds.find(k => k.id === r.assignments?.kind_id);
  const paths = [...(r.offering_activities || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const dues = [r.due_at, ...(r.assignment_due_dates || []).map(x => x.due_at)].filter(Boolean)
    .map(x => new Date(x).getTime()).filter(n => !isNaN(n));
  return {
    offeringId: r.id,
    assignmentId: r.assignment_id,
    title: r.assignments?.title || '',
    slug: r.assignments?.slug || '',
    description: r.assignments?.description || '',
    kindId: r.assignments?.kind_id || '',
    kindLabel: kind?.label || r.assignments?.kind_id || '',
    points: Number(r.points_possible),
    pointsText: String(r.points_possible ?? ''),
    isNew: r[NEW_PAGE_COLUMN] === true,
    isPublished: r.is_published === true,
    lateAllowed: r.late_allowed === true,
    isBonus: r.is_bonus === true,
    progIncluded: r.prog_included === true,
    paths: paths.map(p => ({
      delivery: p.delivery, grading: p.grading, role: p.grading_role,
      modality: p.activities?.modality, activityId: p.activities?.id, slug: p.activities?.slug,
      content: p.activities?.content || {},
    })),
    deliveryText: paths.map(p => DELIVERY_LABEL[p.delivery] || p.delivery || p.activities?.modality || '').join(' / '),
    gradingText: paths.map(p => GRADING_LABEL[p.grading] || p.grading || '').join(' / '),
    dueText: describeDates(r, sections),
    firstDue: dues.length ? Math.min(...dues) : null,
    dueRows: r.assignment_due_dates || [],
    dueAt: r.due_at,
    dueByDay: r.due_by_day || {},
    updatedAt: r.updated_at || null,        // sent back as the optimistic check on a save
  };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Writing
 * ════════════════════════════════════════════════════════════════════════════ */

const offeringColumns = (form, sched, pointsOwned) => ({
  ...(pointsOwned ? {} : { points_possible: Number(form.points) }),
  due_at: sched.dueAt,
  due_by_day: sched.dueByDay,
  late_allowed: !!form.lateAllowed,
  is_bonus: !!form.isBonus,
  prog_included: !!form.progIncluded,
});

async function replaceDueRows(db, offeringId, rows) {
  const del = await db.from('assignment_due_dates').delete().eq('assignment_offering_id', offeringId);
  if (del.error) return del.error;
  if (rows.length) {
    const ins = await db.from('assignment_due_dates').insert(rows);
    if (ins.error) return ins.error;
  }
  return null;
}

/** Undo a half-made create: the offering first (it restricts the assignment), then the assignment. */
async function undoCreate(db, made) {
  if (made.offeringId) await db.from('assignment_offerings').delete().eq('id', made.offeringId);
  if (made.assignmentId) await db.from('assignments').delete().eq('id', made.assignmentId);
}

/** The `content` for a path that is being created: a tutor's link, a typed response's questions, nothing for the rest. */
function newPathContent(form) {
  if (form.delivery === 'interactive_tutor') {
    return { artifact_url: String(form.interactiveUrl || '').trim() || null, description: null };
  }
  if (isTypedResponse(form.delivery) && form.freeResponse) return contentFromEditor(form.freeResponse, { keepKeys: true });
  return {};
}

/**
 * Create a new item. Never publishes.
 *
 * ctx = { courseId, courseCode, courseOfferingId, sections }
 * @returns {Promise<{ error: object|null, offeringId?: string, assignmentId?: string, slug?: string }>}
 */
export async function createItem(db, ctx, form) {
  const made = {};
  const fail = async (error) => { await undoCreate(db, made); return { error, ...made }; };

  const slugged = await freeSlug(db, ctx.courseId, slugify(form.title));
  if (slugged.error) return { error: slugged.error };
  const modality = DELIVERY_MODALITY[form.delivery];

  let r = await db.from('assignments').insert({
    course_id: ctx.courseId, kind_id: form.kindId, slug: slugged.slug,
    title: String(form.title).trim(), description: String(form.description || '').trim() || null, objectives: [],
  }).select('id').single();
  if (r.error) return { error: r.error };
  made.assignmentId = r.data.id;
  made.slug = slugged.slug;

  const interactive = form.delivery === 'interactive_tutor';
  r = await db.from('activities').insert({
    assignment_id: made.assignmentId,
    modality,
    slug: interactive ? String(form.interactiveSlug).trim() : pathSlug(ctx.courseCode, slugged.slug, modality),
    title: String(form.title).trim(),
    content: newPathContent(form),
    position: 0,
  }).select('id').single();
  if (r.error) return fail(r.error);
  const activityId = r.data.id;

  // The marker goes on at creation, before any path exists, so the rules that hold a new-page item
  // back are in force from its first row. is_published is stated, never left to a default.
  const sched = buildSchedule(form, ctx.sections, null);
  r = await db.from('assignment_offerings').insert({
    course_offering_id: ctx.courseOfferingId,
    assignment_id: made.assignmentId,
    ...offeringColumns(form, sched, pointsOwnedByQuestions(form.grading)),
    ...(pointsOwnedByQuestions(form.grading) ? { points_possible: 0 } : {}),
    is_published: false,
    position: null,
    [NEW_PAGE_COLUMN]: true,
  }).select('id').single();
  if (r.error) return fail(r.error);
  made.offeringId = r.data.id;

  r = await db.from('offering_activities').insert({
    assignment_offering_id: made.offeringId, activity_id: activityId,
    grading_role: 'graded', available_after: 'always', is_visible: true, position: 0,
    delivery: form.delivery, grading: form.grading, warn_earns_full: warnEarnsFull(form.delivery, form.grading),
  });
  if (r.error) return fail(r.error);

  const rows = buildSchedule(form, ctx.sections, made.offeringId).rows;
  const dueErr = await replaceDueRows(db, made.offeringId, rows);
  if (dueErr) return fail(dueErr);

  return { error: null, ...made };
}

/** Counts of work attached to an offering: what a removal or a delivery change would destroy. */
export async function countWork(db, offeringId) {
  const [subs, grades] = await Promise.all([
    db.from('submissions').select('*', { count: 'exact', head: true }).eq('assignment_offering_id', offeringId),
    db.from('grades').select('*', { count: 'exact', head: true }).eq('assignment_offering_id', offeringId),
  ]);
  const error = subs.error || grades.error || null;
  return { error, submissions: subs.count || 0, grades: grades.count || 0 };
}

const chunks = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };

/**
 * How many questions, and how many answer-key versions, the given activities hold. Deleting an activity deletes
 * all of them (their foreign keys cascade) and there is no snapshot, so a removal or a delivery switch says these
 * numbers first. Every version of a key counts, superseded ones included: they are history.
 * @returns {Promise<{ error: object|null, questions: number, keys: number }>}
 */
export async function countQuestionsAndKeys(db, activityIds) {
  const ids = [];
  // The API serves at most 1000 rows a request whatever limit is asked for, so an activity with more questions than
  // that (retired ones count) would show a smaller number here than the cascade deletes. Read a page at a time.
  for (const part of chunks(activityIds || [], 50)) {
    for (let from = 0; ; from += 1000) {
      const r = await db.from('questions').select('id').in('activity_id', part).order('id').range(from, from + 999);
      if (r.error) return { error: r.error, questions: 0, keys: 0 };
      ids.push(...(r.data || []).map(x => x.id));
      if ((r.data || []).length < 1000) break;
    }
  }
  let keys = 0;
  for (const part of chunks(ids, 100)) {
    const r = await db.from('question_keys').select('*', { count: 'exact', head: true }).in('question_id', part);
    if (r.error) return { error: r.error, questions: 0, keys: 0 };
    keys += r.count || 0;
  }
  return { error: null, questions: ids.length, keys };
}

/** Does the acknowledgement the person gave cover exactly what would be deleted now? */
export const ackCovers = (ack, impact) =>
  !!ack && ack.questions === impact.questions && ack.keys === impact.keys && (impact.keys === 0 || ack.keysConfirmed === true);

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The warning shown before an item is removed, with the counts. */
export function removalWarning(title, impact) {
  const base = `Remove "${title}"? This deletes the assignment and its dates. It cannot be undone.`;
  if (!impact || (!impact.questions && !impact.keys)) return base;
  return `${base}\n\nIt also deletes its ${plural(impact.questions, 'question', 'questions')} and ` +
    `${plural(impact.keys, 'answer key version', 'answer key versions')}. There is no copy to bring them back from.`;
}

/** The warning shown before a delivery switch that would delete the old path and everything under it. */
export function switchWarning(title, impact) {
  return `Changing how "${title}" is delivered replaces its current path, and deletes the ${plural(impact.questions, 'question', 'questions')} ` +
    `and ${plural(impact.keys, 'answer key version', 'answer key versions')} under it. There is no copy to bring them back from. Change it anyway?`;
}

export const KEYS_SECOND_CONFIRM =
  'This deletes answer keys, which are versioned history and cannot be recovered. Are you sure you want to delete them?';

/**
 * Save changes to an item entered on this page. Refuses an item the older page owns.
 * The kind, title, description, points, dates and flags always save. Delivery and grading save when
 * the item has exactly one path; with more, the form leaves them alone.
 *
 * Optimistic check: the offering row is updated only if its `updated_at` is still the one the form was opened on
 * (item.updatedAt). If another window saved first, nothing is written.
 *
 * A delivery switch that replaces the path deletes the old path's questions and keys. If there are any, nothing is
 * written and `{ needsConfirm: { questions, keys } }` comes back; call again with `ack` set to those numbers (and
 * `keysConfirmed: true` when keys are among them) after the person has agreed.
 *
 * Order: every check first, then the offering row (guarded; all its columns in one statement), then the title and
 * path, then the date rows. A failure after the offering row is returned with `partial`, a sentence saying what was
 * already saved.
 */
/**
 * Every question id the activity has a row for, including ones no longer in its content and ones with no key. The
 * editor never hands out any of them again. A failed read returns an empty list and the error; the editor then still
 * avoids every id in the stored content and every id that has a key.
 */
export async function loadQuestionIds(db, activityId) {
  const { data, error } = await db.from('questions').select('qid').eq('activity_id', activityId);
  if (error) return { qids: [], error };
  return { qids: (data || []).map(r => r.qid).filter(Boolean), error: null };
}

export async function updateItem(db, ctx, item, form, ack = null) {
  const fresh = await db.from('assignment_offerings')
    .select(`id,updated_at,${NEW_PAGE_COLUMN}`).eq('id', item.offeringId).maybeSingle();
  if (fresh.error) return { error: fresh.error };
  if (!fresh.data) return { error: { message: 'This assignment no longer exists. Reload the page.' } };
  if (fresh.data[NEW_PAGE_COLUMN] !== true) {
    return { error: { message: 'This assignment was entered on the older page. Edit it there. Nothing was changed.' } };
  }
  if (item.updatedAt && fresh.data.updated_at !== item.updatedAt) return { error: CHANGED_ERROR };

  // ---- decide the path step, and refuse or ask, before anything is written ----
  const single = item.paths.length === 1 ? item.paths[0] : null;
  const wantModality = DELIVERY_MODALITY[form.delivery];
  const changesPair = !!single && (single.delivery !== form.delivery || single.grading !== form.grading);
  const replacesPath = changesPair && wantModality !== single.modality;
  if (replacesPath) {
    // The database admits an auto-checked path only as the one path of its offering, so a replacement that begins
    // or ends on one cannot be done by adding the new path first. Say so before the title is touched.
    if (single.grading === 'auto_checked' || form.grading === 'auto_checked') {
      return { error: { message: 'An assignment cannot be switched to or from "Checked automatically" with a different kind of delivery. ' +
        'Create a new assignment with the delivery you want, and remove this one if it is no longer needed. Nothing was changed.' } };
    }
    const w = await countWork(db, item.offeringId);
    if (w.error) return { error: w.error };
    if (w.submissions || w.grades) {
      return { error: { message: `This assignment already has ${w.submissions} submission${w.submissions === 1 ? '' : 's'} and ` +
        `${w.grades} grade${w.grades === 1 ? '' : 's'}, so its delivery cannot change to a different kind. Nothing about the path was changed.` } };
    }
    const impact = await countQuestionsAndKeys(db, [single.activityId]);
    if (impact.error) return { error: impact.error };
    if ((impact.questions || impact.keys) && !ackCovers(ack, impact)) {
      return { error: null, needsConfirm: { questions: impact.questions, keys: impact.keys } };
    }
  }

  // ---- the offering row: one guarded statement carrying every column it owns ----
  const sched = buildSchedule(form, ctx.sections, item.offeringId);
  const owned = single ? pointsOwnedByQuestions(form.grading) : item.paths.some(p => pointsOwnedByQuestions(p.grading));
  // When the switch moves points between "owned by the questions" and "typed here", the points are written after the
  // path step, because the database rule that owns them follows the path.
  const ownershipMoves = !!single && pointsOwnedByQuestions(single.grading) !== pointsOwnedByQuestions(form.grading);
  const o = await db.from('assignment_offerings')
    .update(offeringColumns(form, sched, owned || ownershipMoves))
    .eq('id', item.offeringId).eq('updated_at', fresh.data.updated_at).select('id');
  if (o.error) return { error: o.error };
  if (!o.data || o.data.length !== 1) {
    // Zero rows means either somebody saved first (the row is still readable, with a newer stamp) or the database
    // would not let this person change it (the guarded statement matched nothing). Look, so each gets its own sentence.
    const again = await db.from('assignment_offerings').select('id,updated_at').eq('id', item.offeringId).maybeSingle();
    if (!again.error && again.data && again.data.updated_at === fresh.data.updated_at) {
      return { error: { code: '42501', message: 'row-level security: this person may not change this assignment' } };
    }
    return { error: CHANGED_ERROR };
  }
  const partial = (error) => ({
    error,
    partial: 'The points, dates and flags were already saved; the rest of this save was not. Reload the page to see the assignment as it is.',
  });

  const a = await db.from('assignments').update({
    kind_id: form.kindId, title: String(form.title).trim(), description: String(form.description || '').trim() || null,
  }).eq('id', item.assignmentId);
  if (a.error) return partial(a.error);
  let rescored = 0;      // grades rewritten because a question's points changed (the page says so)

  if (single) {
    const cur = single;
    if (changesPair) {
      if (!replacesPath) {
        // In place means the same kind of activity. A typed response also states warn_earns_full, because an item made
        // before the AI option existed may hold false and the grader's yellow-earns-full rule needs true; no other pair
        // carries the flag, so those updates send the two columns only.
        const patch = { delivery: form.delivery, grading: form.grading };
        if (isTypedResponse(form.delivery)) patch.warn_earns_full = warnEarnsFull(form.delivery, form.grading);
        const u = await db.from('offering_activities').update(patch)
          .eq('assignment_offering_id', item.offeringId).eq('activity_id', cur.activityId);
        if (u.error) return partial(u.error);
      } else {
        const interactive = form.delivery === 'interactive_tutor';
        const ins = await db.from('activities').insert({
          assignment_id: item.assignmentId, modality: wantModality,
          slug: interactive ? String(form.interactiveSlug).trim() : pathSlug(ctx.courseCode, item.slug, wantModality),
          title: String(form.title).trim(),
          content: newPathContent(form),
          position: 0,
        }).select('id').single();
        if (ins.error) return partial(ins.error);
        const oa = await db.from('offering_activities').insert({
          assignment_offering_id: item.offeringId, activity_id: ins.data.id,
          grading_role: 'graded', available_after: 'always', is_visible: true, position: 0,
          delivery: form.delivery, grading: form.grading, warn_earns_full: warnEarnsFull(form.delivery, form.grading),
        });
        if (oa.error) { await db.from('activities').delete().eq('id', ins.data.id); return partial(oa.error); }
        // The old path goes last, so a failure above leaves the item as it was.
        const del = await db.from('offering_activities').delete()
          .eq('assignment_offering_id', item.offeringId).eq('activity_id', cur.activityId);
        if (del.error) return partial(del.error);
        const delA = await db.from('activities').delete().eq('id', cur.activityId);
        if (delA.error) return partial(delA.error);
      }
    }
    if (cur.modality === 'interactive' && wantModality === 'interactive') {
      const content = { ...(cur.content || {}), artifact_url: String(form.interactiveUrl || '').trim() || null };
      const patch = { title: String(form.title).trim(), content };
      const wantSlug = String(form.interactiveSlug || '').trim();
      if (wantSlug && wantSlug !== cur.slug) {
        // A tutor id is the address the lesson posts to. It can still be corrected while no link has been saved and no
        // student has used it (a copy made by a rollover starts like that, with an id nobody has built a lesson for).
        // The state is read again here, not trusted from when the form was opened. The posting contract is untouched:
        // an id that has a link, or has been used, never changes.
        const fresher = await db.from('activities').select('content').eq('id', cur.activityId).maybeSingle();
        if (fresher.error) return partial(fresher.error);
        const used = await db.from('submission_activities').select('*', { count: 'exact', head: true }).eq('activity_id', cur.activityId);
        if (used.error) return partial(used.error);
        if (String(fresher.data?.content?.artifact_url || '').trim() || (used.count || 0) > 0) {
          return partial({ message: 'The tutor id was not changed: this tutor already has a link or has been used, so its id is fixed. Everything else on this form was saved.' });
        }
        patch.slug = wantSlug;
      }
      const u = await db.from('activities').update(patch).eq('id', cur.activityId);
      if (u.error) return partial(u.error);
    }
    if (isTypedResponse(form.delivery) && single.modality === 'written' && form.freeResponse) {
      // The questions of an existing typed-response path. keepKeys is false: a key box the person did not touch is not
      // sent, so a stored key stays as it is (the older editor does the same; faculty-lessons.js, ANSWER KEYS).
      const content = contentFromEditor(form.freeResponse, { keepKeys: false });
      const prevQs = cur.content?.questions || [];
      const u = await db.from('activities').update({ title: String(form.title).trim(), content }).eq('id', cur.activityId);
      if (u.error) return partial(u.error);
      if (pointsChanged(prevQs, content.questions)) {
        try {
          rescored = await retroactivelyUpdateGrades(item.offeringId, content.questions, Number(form.points));
        } catch (e) {
          return partial({ message: 'The questions were saved, but the grades already given could not be updated to the new question points ('
            + (e?.message || 'unknown error') + '). Some grades still hold the old values.' });
        }
      }
    }
    if (ownershipMoves && !pointsOwnedByQuestions(form.grading)) {
      const p = await db.from('assignment_offerings').update({ points_possible: Number(form.points) }).eq('id', item.offeringId);
      if (p.error) return partial(p.error);
    }
  }

  const err = await replaceDueRows(db, item.offeringId, sched.rows);
  if (err) return partial(err);
  return { error: null, offeringId: item.offeringId, assignmentId: item.assignmentId, rescored };
}

/**
 * What a removal would delete, and whether it is allowed at all. Reads only.
 * @returns {Promise<{ error?: object, refused?: boolean, impact?: { questions: number, keys: number }, assignmentId?: string }>}
 *   `impact` counts the questions and key versions that would go: none when another offering shares the item.
 */
export async function previewRemoval(db, offeringId) {
  const fresh = await db.from('assignment_offerings')
    .select(`id,assignment_id,${NEW_PAGE_COLUMN}`).eq('id', offeringId).maybeSingle();
  if (fresh.error) return { error: fresh.error, refused: false };
  if (!fresh.data) return { error: { message: 'This assignment no longer exists. Reload the page.' }, refused: true };
  if (fresh.data[NEW_PAGE_COLUMN] !== true) {
    return { error: { message: 'This assignment was entered on the older page. Remove it there. Nothing was changed.' }, refused: true };
  }
  const w = await countWork(db, offeringId);
  if (w.error) {
    return { error: { message: 'Could not check whether students have work on this assignment, so it was not removed.' }, refused: true };
  }
  if (w.submissions || w.grades) {
    const parts = [];
    if (w.submissions) parts.push(`${w.submissions} submission${w.submissions === 1 ? '' : 's'}`);
    if (w.grades) parts.push(`${w.grades} grade${w.grades === 1 ? '' : 's'}`);
    return { error: { message: `This assignment has ${parts.join(' and ')}, so it cannot be removed here. Nothing was changed.` }, refused: true };
  }
  const others = await db.from('assignment_offerings').select('id')
    .eq('assignment_id', fresh.data.assignment_id).neq('id', offeringId);
  if (others.error) return { error: others.error, refused: false };
  let impact = { questions: 0, keys: 0 };
  if (!(others.data || []).length) {
    // The last offering of the item goes with the item itself, and its activities, questions and keys cascade.
    const acts = await db.from('activities').select('id').eq('assignment_id', fresh.data.assignment_id);
    if (acts.error) return { error: acts.error, refused: false };
    const c = await countQuestionsAndKeys(db, (acts.data || []).map(x => x.id));
    if (c.error) return { error: { message: 'Could not count the questions on this assignment, so it was not removed.' }, refused: true };
    impact = { questions: c.questions, keys: c.keys };
  }
  return { error: null, impact, assignmentId: fresh.data.assignment_id, shared: (others.data || []).length > 0 };
}

/**
 * Remove an item that has no submissions and no grades. Anything else is refused with the counts.
 * An item the older page owns is refused too. If the removal would delete questions or answer keys, nothing is
 * deleted unless `ack` states exactly those numbers (and `keysConfirmed` when keys are among them): otherwise
 * `{ needsConfirm }` comes back with the numbers as they are now.
 */
export async function removeItem(db, offeringId, ack = null) {
  const pre = await previewRemoval(db, offeringId);
  if (pre.error) return { error: pre.error, refused: pre.refused };
  if ((pre.impact.questions || pre.impact.keys) && !ackCovers(ack, pre.impact)) {
    return { error: null, refused: false, needsConfirm: pre.impact };
  }
  const d = await db.from('assignment_offerings').delete().eq('id', offeringId).select('id');
  if (d.error) return { error: d.error, refused: false };
  if (!d.data || d.data.length !== 1) {
    return { error: { message: 'The assignment was not removed (it may already be gone). Reload the page.' }, refused: false };
  }
  if (!pre.shared) {
    const da = await db.from('assignments').delete().eq('id', pre.assignmentId).select('id');
    if (da.error) return { error: da.error, refused: false };
    if (!da.data || da.data.length !== 1) {
      return { error: { message: 'The assignment was removed from this course offering, but its definition could not be removed. Reload the page.' }, refused: false };
    }
  }
  return { error: null, refused: false };
}
