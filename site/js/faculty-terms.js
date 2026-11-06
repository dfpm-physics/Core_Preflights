// faculty-terms.js — data layer for the courses-and-terms page (faculty/terms.html), schema `app`.
//
// WHAT A PERSON CAN DO WITH IT
//   1. Create a course (a catalogue entry), a term, and an offering of a course in a term. Only a
//      site administrator can: the database admits courses and terms from nobody else, and an
//      offering of a course the person does not yet direct would be invisible to its creator.
//      The page says so rather than offering a button that fails.
//   2. Choose, at creation, whether the offering is active. The database allows one active
//      offering per course (course_offerings_one_active) and refuses a second in a plain sentence.
//   3. Roll an offering over into another offering of the same course: a dry-run list first, then
//      one write. Rollover is a COPY of course design, never of people or of work.
//   4. Set an existing offering active or inactive (an administrator), after a plain statement of what that
//      changes and the counts of enrolled cadets and published items. A second active offering of a course is
//      refused in a sentence. Deactivating deletes and hides nothing.
//
// WHAT ROLLOVER COPIES
//   assignments (with origin_assignment_id pointing at the source, and a term-qualified slug),
//   their activities (new slugs; written content verbatim), questions that are not retired, the
//   CURRENT key of each question (as version 1, UNCHECKED: the database stamps whoever checks a
//   key, so a copy cannot claim a check nobody made), the offering columns (points, grading mode,
//   late/bonus/Prog flags, attempt rules, position), the path rows (delivery and grading), and the
//   offering's current letter scale when the target has none.
//
// WHAT ROLLOVER NEVER DOES
//   It never changes the source offering, never publishes (every copy is is_published = false),
//   and never copies students, enrollments, sections, submissions, grades, extensions, groups,
//   closures or excusals. Dates are not carried silently: the person leaves them blank or shifts
//   them by a number of calendar days, Mountain time, keeping each clock time. An interactive
//   tutor activity is copied without its link, because the tutor's id is its address and one
//   artifact cannot serve two terms (PER-OFFERING-CONTENT-ISOLATION.md section 5).
//
// NO NODE, NO BUILD STEP. Every function that touches the database is handed the client, so a
// test can pass a recording stub (tests/app-schema/test-faculty-terms.mjs).

import { zoneWallToInstant, instantToZone, pathSlug, isRealDate, isLostResponse, isTwoTrack, meetingDays } from './faculty-items.js';

/* ══════════════════════════════════════════════════════════════════════════════
 * Plain sentences for refusals
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * A database error as a sentence a person can act on. The raw error is logged by the caller.
 * `partial` is true when the caller has already told the person what was written before the stop (a rollover that
 * copied some items), so a sentence that ends "Nothing was changed." would contradict it and is left off.
 */
export function termsError(error, { partial = false } = {}) {
  const raw = String(error?.message || error || 'Unknown error');
  const nothing = partial ? '' : ' Nothing was changed.';
  if (isLostResponse(error)) {
    return 'The connection dropped before an answer came back, so it is not known whether this was written. ' +
      'Reload the page and look at the offering before you try again.';
  }
  if (error?.code === '22023') return raw.replace(/^[a-z_]+:\s*/i, '');   // a refusal the database worded for a person
  if (/course_offerings_one_active/.test(raw)) {
    return 'That course already has an active term, and only one term of a course can be active at a time. ' +
      'Create this one as inactive, or make the other one inactive first.';
  }
  if (/course_offerings_unique/.test(raw)) return 'That course already has an offering in that term.';
  if (/courses_code_key|courses_code/.test(raw)) return 'A course with that code already exists.';
  if (/terms_code_key|terms_code/.test(raw)) return 'A term with that code already exists.';
  if (/terms_date_order/.test(raw)) return 'The term cannot end before it starts.';
  if (error?.code === '42501' || /row-level security|permission denied/i.test(raw)) {
    return 'You do not have permission to do this. Creating a course, a term or an offering is for a site administrator; ' +
      'rolling over needs a director of the offering you copy into.';
  }
  if (error?.code === '23505') return 'Something with that name already exists.' + nothing;
  if (error?.code === '57014' || /statement timeout/i.test(raw)) {
    return 'The database took too long. Wait a moment and try again. Nothing that was started is left half-done unless this page says so.';
  }
  if (error?.code === '42703' || error?.code === 'PGRST205' || /schema cache|does not exist/i.test(raw)) {
    return 'This database has not been upgraded for this page yet.' + nothing;
  }
  return 'The database refused this: ' + raw.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, 'this row');
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Checking the three small forms
 * ════════════════════════════════════════════════════════════════════════════ */

export const CODE_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

export function checkCourse(form) {
  const out = [];
  const code = String(form.code || '').trim();
  if (!CODE_RE.test(code)) out.push('Give the course a code: 2 to 40 lowercase letters, numbers and hyphens, such as phys-310.');
  if (!String(form.title || '').trim()) out.push('Give the course a title, such as Physics 310.');
  if (String(form.title || '').length > 120) out.push('Keep the title under 120 characters.');
  if (String(form.department || '').length > 80) out.push('Keep the department under 80 characters.');
  return out;
}

export function checkTerm(form) {
  const out = [];
  const code = String(form.code || '').trim();
  if (!CODE_RE.test(code)) out.push('Give the term a code: 2 to 40 lowercase letters, numbers and hyphens, such as spring-2027.');
  if (!String(form.label || '').trim()) out.push('Give the term a label, such as Spring 2027.');
  if (form.startsOn && !isRealDate(form.startsOn)) out.push('The start date is not a real date.');
  if (form.endsOn && !isRealDate(form.endsOn)) out.push('The end date is not a real date.');
  if (form.startsOn && form.endsOn && isRealDate(form.startsOn) && isRealDate(form.endsOn) && form.startsOn > form.endsOn) {
    out.push('The term cannot end before it starts.');
  }
  return out;
}

export function checkOffering(form) {
  const out = [];
  if (!form.courseId) out.push('Choose a course.');
  if (!form.termId) out.push('Choose a term.');
  if (form.isActive !== true && form.isActive !== false) out.push('Say whether the offering is active or inactive.');
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Dates for rollover (Mountain time, calendar days)
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * The stored instant moved by a whole number of CALENDAR days in Mountain time, keeping the clock
 * time. A 23:59:59 deadline stays 23:59:59 across a daylight-saving change, which adding 24-hour
 * multiples would not. Null or unreadable stays null.
 */
export function shiftInstant(iso, days) {
  if (iso === null || iso === undefined || iso === '') return null;
  const ms = new Date(iso).getTime();
  if (isNaN(ms)) return null;
  const z = instantToZone(iso);
  const [y, m, d] = z.date.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  const pastMinute = ms - Math.floor(ms / 60000) * 60000;   // zone offsets are whole minutes, so seconds carry over
  return new Date(zoneWallToInstant(date, z.time) + pastMinute).toISOString();
}

/** A per-day deadline map with every instant moved. Keys and anything that is not a string stay as they are. */
export function shiftDueByDay(map, days) {
  const out = {};
  for (const [k, v] of Object.entries(map || {})) out[k] = typeof v === 'string' ? shiftInstant(v, days) : v;
  return out;
}

/** "2026-12-10 23:59" or "no date", for the dry-run list. */
export function dateText(iso) {
  const z = instantToZone(iso);
  return z ? `${z.date} ${z.time}` : 'no date';
}

export function checkRolloverOptions(opts) {
  const out = [];
  if (opts.dates !== 'blank' && opts.dates !== 'shift') out.push('Say what to do with dates: leave them blank, or shift them.');
  if (opts.dates === 'shift') {
    const text = String(opts.days ?? '').trim();
    const n = Number(text);
    if (!/^[+-]?\d{1,5}$/.test(text) || !Number.isInteger(n)) {
      out.push('Enter the shift as a whole number of days, digits only (for example 126). A negative number moves dates earlier.');
    } else if (n === 0) {
      out.push('A shift of 0 would copy every date as it is, and dates are never copied as they are. Leave the dates blank, or enter the number of days to move them.');
    } else if (Math.abs(n) > 3650) out.push('A shift of more than ten years is almost certainly a typing slip.');
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Slugs
 * ════════════════════════════════════════════════════════════════════════════ */

function randomHex(n) {
  const buf = new Uint8Array(Math.ceil(n / 2));
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(buf);
  else for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  return [...buf].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, n);
}

/**
 * The assignment slug a copy takes. `assignments_slug_unique` is per course, and the source lives
 * in the same course, so the clean slug is always taken. The copy is qualified by the target term
 * (preflight-02-spring-2027), with a short random tail as the last resort. The set is extended so
 * two copies in one run cannot take the same slug.
 */
export function copySlug(base, termCode, taken, rand = randomHex) {
  let slug = `${base}-${termCode || 'copy'}`;
  while (taken.has(slug)) slug = `${base}-${termCode || 'copy'}-${rand(4)}`;
  taken.add(slug);
  return slug;
}

/** An interactive tutor's id for a copy: its readable stem and eight new hex digits. Never reused. */
export function copyTutorSlug(oldSlug, fallbackStem, rand = randomHex) {
  const stem = String(oldSlug || '').replace(/-[0-9a-f]{8}$/, '') || fallbackStem || 'lesson';
  return `${stem}-${rand(8)}`;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Reading what a rollover needs
 * ════════════════════════════════════════════════════════════════════════════ */

const PAGE = 1000;
const CHUNK = 40;

async function pagedIn(db, table, select, column, ids, order) {
  const rows = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    for (let from = 0; ; from += PAGE) {
      let q = db.from(table).select(select).in(column, part);
      if (order) q = q.order(order);
      const r = await q.range(from, from + PAGE - 1);
      if (r.error) return { error: r.error };
      rows.push(...(r.data || []));
      if ((r.data || []).length < PAGE) break;
    }
  }
  return { rows };
}

const ITEM_SELECT = '*, assignments(*), offering_activities(*, activities(*)), assignment_due_dates(section_id, due_at)';
const OFFERING_SELECT = 'id, is_active, course_id, term_id, courses(id, code, title), terms(id, code, label, starts_on, ends_on)';

export function shapeOffering(r) {
  return {
    id: r.id, isActive: !!r.is_active,
    courseId: r.course_id, courseCode: r.courses?.code, courseTitle: r.courses?.title,
    termId: r.term_id, termCode: r.terms?.code, termLabel: r.terms?.label,
    startsOn: r.terms?.starts_on || null, endsOn: r.terms?.ends_on || null,
  };
}

/** Every offering the signed-in person can see, newest term first. */
export async function loadOfferings(db) {
  const r = await db.from('course_offerings').select(OFFERING_SELECT);
  if (r.error) return { error: r.error };
  const list = (r.data || []).map(shapeOffering).sort((a, b) =>
    String(b.termCode || '').localeCompare(String(a.termCode || '')) ||
    String(a.courseCode || '').localeCompare(String(b.courseCode || '')));
  return { offerings: list };
}

export async function loadCatalogue(db) {
  const [c, t, i] = await Promise.all([
    db.from('courses').select('id, code, title').order('code'),
    db.from('terms').select('id, code, label, starts_on, ends_on').order('code', { ascending: false }),
    db.from('instructors').select('id, name').order('name'),
  ]);
  if (c.error) return { error: c.error };
  if (t.error) return { error: t.error };
  // The instructors list only fills the optional "director" box; a refusal there loses nothing else.
  return { courses: c.data || [], terms: t.data || [], instructors: i.error ? [] : (i.data || []) };
}

/**
 * Every assignment of a course: slug, title, origin and the offerings that use it. Read a page at a time, because
 * the API serves at most 1000 rows per request whatever limit is asked for: a single read of a big course would give
 * a short list of taken slugs (so a copy picks one that exists and can never finish) and a short lineage.
 */
async function pagedCourseAssignments(db, courseId) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const r = await db.from('assignments').select('id, slug, title, origin_assignment_id, assignment_offerings(id, course_offering_id)')
      .eq('course_id', courseId).order('id').range(from, from + PAGE - 1);
    if (r.error) return { error: r.error };
    rows.push(...(r.data || []));
    if ((r.data || []).length < PAGE) break;
  }
  return { rows };
}

async function loadSide(db, offeringId, withContent) {
  const off = await db.from('course_offerings').select(OFFERING_SELECT).eq('id', offeringId).maybeSingle();
  if (off.error) return { error: off.error };
  if (!off.data) return { error: { message: 'That offering is not visible to you.' } };
  const offering = shapeOffering(off.data);

  const [items, sections, courseAssignments, scale] = await Promise.all([
    db.from('assignment_offerings').select(ITEM_SELECT).eq('course_offering_id', offeringId).order('position', { ascending: true }).limit(PAGE),
    db.from('sections').select('id, code, meeting_days').eq('course_offering_id', offeringId),
    pagedCourseAssignments(db, offering.courseId),
    db.from('letter_scales').select('*').eq('course_offering_id', offeringId).is('retired_at', null)
      .order('version', { ascending: false }).limit(1),
  ]);
  for (const r of [items, sections, courseAssignments, scale]) if (r.error) return { error: r.error };
  if ((items.data || []).length >= PAGE) {
    return { error: { message: 'This offering holds more assignments than one rollover handles at once.' } };
  }
  const side = {
    offering, items: items.data || [], sections: sections.data || [],
    takenSlugs: courseAssignments.rows.map(a => a.slug),
    // every assignment of the course with its lineage and the offerings that use it: the chain of origins is followed
    // across all of them, and one with no offering at all is a half-written copy
    lineage: courseAssignments.rows,
    scale: (scale.data || [])[0] || null,
    questions: new Map(), keys: new Map(),
  };
  if (!withContent) return side;

  const activityIds = side.items.flatMap(it => (it.offering_activities || []).map(oa => oa.activity_id));
  const q = await pagedIn(db, 'questions', '*', 'activity_id', activityIds, 'position');
  if (q.error) return { error: q.error };
  for (const row of q.rows) {
    if (row.is_retired) continue;
    if (!side.questions.has(row.activity_id)) side.questions.set(row.activity_id, []);
    side.questions.get(row.activity_id).push(row);
  }
  const k = await pagedIn(db, 'question_keys', '*', 'question_id', q.rows.map(x => x.id));
  if (k.error) return { error: k.error };
  for (const row of k.rows) {
    if (row.superseded_at) continue;
    if (!side.keys.has(row.question_id)) side.keys.set(row.question_id, []);
    side.keys.get(row.question_id).push(row);
  }
  return side;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * The plan (pure) — what a rollover would write
 * ════════════════════════════════════════════════════════════════════════════ */

// is_group_work is deliberately NOT here: groups are not copied, so a copied flag would mark an item as group work with
// no group to do it. part_set_id is not here either (a part set belongs to the offering it was made in). Both are noted
// in the dry run, item by item.
const OFFERING_COPY = ['points_possible', 'grading_mode', 'switch_policy', 'position', 'late_allowed', 'is_bonus',
  'allow_over_max', 'prog_included', 'attempt_limit', 'attempt_rule', 'entered_on_new_page'];
const PATH_COPY = ['grading_role', 'available_after', 'is_visible', 'position', 'delivery', 'grading', 'warn_earns_full'];
const QUESTION_COPY = ['qid', 'position', 'prompt_md', 'figure_url', 'unit_hint', 'format', 'choices', 'points'];
const KEY_COPY = ['variant_key', 'correct_choice_ids', 'select_rule', 'value', 'tol_abs', 'tol_pct', 'sig_figs',
  'sig_fig_mode', 'unit', 'unit_aliases', 'unit_mode', 'reference_text', 'written_by'];

const pick = (row, cols) => Object.fromEntries(cols.map(c => [c, row[c] ?? null]));

/**
 * Build the plan from what was read. Pure: no database, no clock, and the random tail is injectable.
 *
 * src and tgt are the objects loadSide() returns. opts = { dates: 'blank'|'shift', days }.
 * @returns {{ problems: string[], items: object[], toCopy: number, skipped: number,
 *             counts: object, scale: 'copy'|'target-has-one'|'none' }}
 */
export function buildRolloverPlan(src, tgt, opts, rand = randomHex) {
  const problems = [...checkRolloverOptions(opts)];
  if (src.offering.id === tgt.offering.id) problems.push('Choose two different offerings: copy from one, into another.');
  if (src.offering.courseId !== tgt.offering.courseId) {
    problems.push('Rollover copies between two terms of the same course. These are different courses.');
  }
  if (problems.length) return { problems, items: [], toCopy: 0, skipped: 0, counts: {}, scale: 'none' };

  // ---- lineage: is this item already in the target? -----------------------------------------------------------------
  // An item is the same item as another when they share a ROOT: follow origin_assignment_id until it ends. That sees
  // a copy of a copy (Fall -> Spring -> next Fall), a roll back to the term the item came from, and a retitled copy
  // (the title never enters into it). It cannot see through a broken chain: deleting an item in the middle sets the
  // origin of its copy to nothing, and that copy then looks like a new item. Items entered by hand have no lineage.
  const lineageRows = tgt.lineage || src.lineage || [];
  const originOf = new Map(lineageRows.map(a => [a.id, a.origin_assignment_id || null]));
  const rootOf = (id) => {
    let cur = id;
    for (let hops = 0; hops < 50; hops++) {
      const next = originOf.get(cur);
      if (!next) return cur;
      cur = next;
    }
    return cur;
  };
  const inTarget = new Map();                       // root -> the assignment the target already holds for it
  for (const held of tgt.items) if (held.assignments?.id) inTarget.set(rootOf(held.assignments.id), held);
  const orphanByRoot = new Map();                   // root -> a copy that has no offering at all (a half-written copy)
  for (const a of lineageRows) {
    if (a.origin_assignment_id && !(a.assignment_offerings || []).length) orphanByRoot.set(rootOf(a.id), a);
  }
  const twoTrack = isTwoTrack(tgt.sections) || isTwoTrack(src.sections);
  const days = meetingDays(tgt.sections.length ? tgt.sections : src.sections);
  const taken = new Set([...(src.takenSlugs || []), ...(tgt.takenSlugs || [])]);
  const srcCode = new Map(src.sections.map(s => [s.id, s.code]));
  const tgtByCode = new Map(tgt.sections.map(s => [s.code, s.id]));
  const shift = opts.dates === 'shift' ? Number(opts.days) : null;
  const counts = { items: 0, activities: 0, questions: 0, keys: 0 };

  const items = [];
  for (const it of src.items) {
    const a = it.assignments;
    const notes = [];
    const root = rootOf(a.id);
    const there = inTarget.get(root);
    const pathsThere = (there?.offering_activities || []).length, pathsHere = (it.offering_activities || []).length;
    const whole = !there || pathsThere >= pathsHere;
    const row = { sourceAoId: it.id, sourceAssignmentId: a.id, title: a.title, kindId: a.kind_id, notes,
                  alreadyDone: !!there && whole, blocked: false };
    if (row.alreadyDone) { notes.push('Already in this offering (the same assignment, copied earlier); skipped.'); items.push(row); continue; }
    if (there && !whole) {
      row.blocked = true;
      notes.push(`A copy of this assignment is in the target but has only ${pathsThere} of ${pathsHere} paths, so it is not whole ` +
        '(an earlier run was cut off). It is not copied again. Remove the half-built copy on the assignments page, then run this again.');
      items.push(row); continue;
    }
    if (orphanByRoot.has(root)) {
      row.blocked = true;
      notes.push(`A half-written copy of this assignment exists in the course with no offering (${orphanByRoot.get(root).slug}). ` +
        'It is not copied again. A site administrator has to remove that leftover first, then run this again.');
      items.push(row); continue;
    }

    row.slug = copySlug(a.slug, tgt.offering.termCode, taken, rand);
    row.assignment = {
      course_id: tgt.offering.courseId, kind_id: a.kind_id, slug: row.slug, title: a.title,
      description: a.description ?? null, objectives: a.objectives ?? [], origin_assignment_id: a.id,
    };

    const dates = { due_at: null, opens_at: null, grades_release_at: null, due_by_day: {} };
    row.dueRows = [];
    // CORE.md section 2: an EMPTY per-day map on a course with M and T sections puts every section on the M-day
    // date, one to four days early for the T-day sections, and every date still looks right. A shift would copy
    // that defect forward under a plausible new date. So the item's dates are left BLANK instead, and the note says
    // why; a person sets them on the items page, where the per-day boxes exist.
    const hasMap = Object.keys(it.due_by_day || {}).length > 0;
    const hasRows = (it.assignment_due_dates || []).length > 0;
    const trap = shift !== null && twoTrack && !!it.due_at && !hasMap && !hasRows;
    if (trap) {
      notes.push('The source has one main date and no per-day dates, and this course has M-day and T-day sections, so a shifted ' +
        'date would put every section on the M-day date. The dates are left blank. Set the M and T dates on the assignments page.');
    } else if (shift !== null && twoTrack && hasMap && days.some(d => !(d in it.due_by_day))) {
      notes.push(`The source has dates for ${Object.keys(it.due_by_day).join(', ')} only; a section meeting on ` +
        `${days.filter(d => !(d in it.due_by_day)).join(', ')} takes the main date. Check it on the assignments page.`);
    }
    if (shift !== null && !trap) {
      dates.due_at = shiftInstant(it.due_at, shift);
      dates.opens_at = shiftInstant(it.opens_at, shift);
      dates.grades_release_at = shiftInstant(it.grades_release_at, shift);
      dates.due_by_day = shiftDueByDay(it.due_by_day, shift);
      const lost = [];
      for (const d of it.assignment_due_dates || []) {
        const code = srcCode.get(d.section_id);
        const target = code && tgtByCode.get(code);
        if (target) row.dueRows.push({ section_id: target, due_at: shiftInstant(d.due_at, shift) });
        else lost.push(code || 'a section');
      }
      if (lost.length) {
        notes.push(`No section ${[...new Set(lost)].join(', ')} in the new term, so a section's own date is not carried. ` +
          'Its cadets take the per-day date for the day their section meets, and the main date if there is none.');
      }
    }
    row.dates = dates;
    row.dueText = shift === null ? 'blank' : trap ? 'blank (see note)' : `${dateText(it.due_at)} -> ${dateText(dates.due_at)}`;
    row.offering = { ...pick(it, OFFERING_COPY), ...dates, is_published: false };
    if (it.is_published) notes.push('Published in the source; the copy is unpublished.');
    if (it.part_set_id) {
      notes.push('This assignment is part of a part set in the source ("do all of these"). Part sets are not copied, so the copy stands alone; set the parts again if they should stay together.');
    }
    if (it.is_group_work) {
      notes.push('This assignment is group work in the source. Groups are not copied, so the copy is not marked as group work; mark it again once the groups exist.');
    }

    row.activities = [];
    let qn = 0, kn = 0;
    for (const oa of [...(it.offering_activities || [])].sort((x, y) => (x.position ?? 0) - (y.position ?? 0))) {
      const act = oa.activities;
      if (!act) continue;
      const interactive = act.modality === 'interactive';
      let content = act.content ?? {};
      if (interactive) {
        content = { ...content, artifact_url: null };
        notes.push('Interactive tutor: copied without its link, under a new tutor id. On the assignments page, set its link; the id can be changed there until a link is saved.');
      }
      const slug = interactive ? copyTutorSlug(act.slug, row.slug, rand)
        : pathSlug(tgt.offering.courseCode, row.slug, act.modality);
      const questions = (src.questions.get(act.id) || []).map(q => ({
        row: pick(q, QUESTION_COPY),
        key: (src.keys.get(q.id) || []).map(k => ({ ...pick(k, KEY_COPY), version: 1, checked_by: null, checked_at: null })),
      }));
      qn += questions.length; kn += questions.reduce((n, q) => n + q.key.length, 0);
      row.activities.push({
        activity: { modality: act.modality, slug, title: act.title ?? null, content, position: act.position ?? 0 },
        path: pick(oa, PATH_COPY), questions,
      });
    }
    if (kn) notes.push('Keys are copied unchecked; check them before publishing.');
    row.questionCount = qn; row.keyCount = kn;
    counts.items++; counts.activities += row.activities.length; counts.questions += qn; counts.keys += kn;
    items.push(row);
  }

  // The scale is copied only into an INACTIVE target that has none in force. An active target may already have graded
  // work, and a new scale changes letters; the scale page shows who would change first, and a copy here would skip that.
  const scale = !src.scale ? 'none' : tgt.scale ? 'target-has-one' : tgt.offering.isActive ? 'target-active' : 'copy';
  return {
    problems: [], items, counts, scale,
    toCopy: items.filter(i => !i.alreadyDone && !i.blocked).length, skipped: items.filter(i => i.alreadyDone).length,
    blocked: items.filter(i => i.blocked).length,
  };
}

/** Read both sides and plan. Read-only. */
export async function previewRollover(db, sourceId, targetId, opts, rand) {
  const early = checkRolloverOptions(opts);
  if (early.length) return { plan: { problems: early, items: [], toCopy: 0, skipped: 0, counts: {}, scale: 'none' } };
  const [src, tgt] = await Promise.all([loadSide(db, sourceId, true), loadSide(db, targetId, false)]);
  if (src.error) return { error: src.error };
  if (tgt.error) return { error: tgt.error };
  return { plan: buildRolloverPlan(src, tgt, opts, rand), src, tgt };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Writing
 * ════════════════════════════════════════════════════════════════════════════ */

export async function createCourse(db, form) {
  const r = await db.from('courses').insert({
    code: String(form.code).trim(), title: String(form.title).trim(),
    department: String(form.department || '').trim() || null,
  }).select('id').single();
  return r.error ? { error: r.error } : { error: null, id: r.data.id };
}

export async function createTerm(db, form) {
  const r = await db.from('terms').insert({
    code: String(form.code).trim(), label: String(form.label).trim(),
    starts_on: form.startsOn || null, ends_on: form.endsOn || null,
  }).select('id').single();
  return r.error ? { error: r.error } : { error: null, id: r.data.id };
}

/**
 * Create an offering, with the active flag the person chose (never defaulted here), and optionally
 * make one instructor its director. If the director row fails the offering stays and the result
 * says so, because the offering itself is valid and an administrator can add staff later.
 */
export async function createOffering(db, form) {
  // No RETURNING on this insert: the row-level rule that lets an administrator READ an offering is
  // evaluated against the snapshot from before this statement, so asking for the new row back in the
  // same statement is refused even though the insert itself is allowed. The id is read in a second step.
  const r = await db.from('course_offerings').insert({
    course_id: form.courseId, term_id: form.termId, is_active: form.isActive === true,
  });
  if (r.error) return { error: r.error };
  const got = await db.from('course_offerings').select('id').eq('course_id', form.courseId).eq('term_id', form.termId).maybeSingle();
  if (got.error || !got.data) return { error: got.error || { message: 'The offering was created but could not be read back.' } };
  const out = { error: null, id: got.data.id, directorError: null };
  if (form.directorId) {
    const s = await db.from('staff_assignments').insert({
      instructor_id: form.directorId, course_offering_id: got.data.id, section_id: null, role: 'director',
    });
    if (s.error) out.directorError = s.error;
  }
  return out;
}

/**
 * Remove what one failed item left behind: the offering first (it restricts the assignment). The answers are READ:
 * a delete that fails leaves the item half built, and the caller has to say so. Returns the list of what stayed.
 */
async function undoItem(db, made) {
  const stayed = [];
  if (made.offeringId) {
    const r = await db.from('assignment_offerings').delete().eq('id', made.offeringId);
    if (r.error) stayed.push("the assignment's offering row");
  }
  if (made.assignmentId) {
    if (stayed.length) {
      stayed.push('the assignment itself (its questions and paths with it)');   // it cannot go while its offering row stays
    } else {
      const r = await db.from('assignments').delete().eq('id', made.assignmentId);
      if (r.error) stayed.push('the assignment itself (its questions and paths with it)');
    }
  }
  return stayed;
}

async function writeItem(db, tgtOfferingId, item, made) {
  let r = await db.from('assignments').insert(item.assignment).select('id').single();
  if (r.error) return r.error;
  made.assignmentId = r.data.id;

  const pathRows = [];
  for (const a of item.activities) {
    r = await db.from('activities').insert({ ...a.activity, assignment_id: made.assignmentId }).select('id').single();
    if (r.error) return r.error;
    const activityId = r.data.id;
    pathRows.push({ activityId, path: a.path });
    if (a.questions.length) {
      const q = await db.from('questions').insert(a.questions.map(x => ({ ...x.row, activity_id: activityId }))).select('id, qid');
      if (q.error) return q.error;
      const idByQid = new Map((q.data || []).map(x => [x.qid, x.id]));
      const keyRows = [];
      for (const x of a.questions) for (const k of x.key) keyRows.push({ ...k, question_id: idByQid.get(x.row.qid) });
      if (keyRows.length) {
        const kr = await db.from('question_keys').insert(keyRows);
        if (kr.error) return kr.error;
      }
    }
  }

  // The offering row is written unpublished and stays so; nothing here asks for it to be published.
  r = await db.from('assignment_offerings').insert({
    ...item.offering, course_offering_id: tgtOfferingId, assignment_id: made.assignmentId, is_published: false,
  }).select('id').single();
  if (r.error) return r.error;
  made.offeringId = r.data.id;

  if (pathRows.length) {
    const p = await db.from('offering_activities').insert(pathRows.map(x => ({
      ...x.path, assignment_offering_id: made.offeringId, activity_id: x.activityId,
    })));
    if (p.error) return p.error;
  }
  if (item.dueRows.length) {
    const d = await db.from('assignment_due_dates').insert(item.dueRows.map(x => ({ ...x, assignment_offering_id: made.offeringId })));
    if (d.error) return d.error;
  }
  return null;
}

/**
 * Write a plan. One item at a time; an item that fails is removed whole and the run stops, so what
 * is left is whole items only. Running it again skips the items already copied (origin lineage).
 *
 * @param {object} actor  unused; kept so callers need not change. The scale's author is stamped by the database.
 * @returns {Promise<{ error: object|null, copied: number, failedTitle?: string, scaleCopied: boolean, scaleError?: object }>}
 */
export async function runRollover(db, plan, tgtOfferingId, src, actor) {
  if (plan.problems?.length) return { error: { message: plan.problems.join(' ') }, copied: 0, scaleCopied: false };
  let copied = 0;
  for (const item of plan.items) {
    if (item.alreadyDone) continue;
    const made = {};
    const err = await writeItem(db, tgtOfferingId, item, made);
    if (err) {
      const stayed = await undoItem(db, made);
      // When the connection dropped, the write may have reached the database although no answer came back, so the
      // ids above can be missing and the undo could not name the rows. Say that the outcome is unknown.
      return { error: err, copied, failedTitle: item.title, scaleCopied: false, stayed, outcomeUnknown: isLostResponse(err) };
    }
    copied++;
  }
  const out = { error: null, copied, scaleCopied: false };
  if (plan.scale === 'copy' && src?.scale) {
    // The one-step save (migration app/041): the target has no scale in force, so nothing is retired; the next version
    // number comes after any retired ones; the lines are validated; the author is stamped from the sign-in.
    const s = await db.rpc('save_letter_scale', {
      p_course_offering: tgtOfferingId, p_lines: src.scale.lines, p_width: Number(src.scale.near_line_width), p_expected_version: 0,
    });
    if (s.error) out.scaleError = s.error; else out.scaleCopied = true;
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Active or inactive
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * What a person should know before turning an offering active or inactive. Plain sentences, so the page and the
 * tests read the same words. Nothing in it is a promise the database does not keep: active steers jobs and the
 * Health page and gates publishing and scale changes; it hides a course from nobody, and turning it off deletes nothing.
 */
export function activeStatement(makeActive) {
  const shared = 'Active steers the nightly jobs and the Health page, lets assignments be published, and makes a change to the letter scale ask to see its effect first. It hides the course from nobody.';
  return makeActive
    ? `${shared} A course can have only one active offering.`
    : `${shared} Making it inactive deletes nothing and hides nothing: every assignment, grade, question and scale stays exactly as it is. While it is inactive, no new assignment can be published in it and scale changes no longer ask for a preview.`;
}

/**
 * Can this offering be switched? Pure. `offerings` is what loadOfferings returned.
 * A second active offering of a course is refused here in a sentence; the database refuses it too (one-active index).
 */
export function checkActiveChange(offering, makeActive, offerings) {
  if (!offering) return ['That offering is not visible to you.'];
  if (offering.isActive === makeActive) return [`That offering is already ${makeActive ? 'active' : 'inactive'}.`];
  if (makeActive) {
    const other = (offerings || []).find(o => o.courseId === offering.courseId && o.isActive && o.id !== offering.id);
    if (other) {
      return [`${other.courseTitle || other.courseCode} · ${other.termLabel} is already the active term of this course, and only one can be active at a time. Make that one inactive first.`];
    }
  }
  return [];
}

/** Counts shown in the confirmation: active enrollments in the offering's sections, and its published items. */
export async function offeringImpact(db, offeringId) {
  const sec = await db.from('sections').select('id').eq('course_offering_id', offeringId);
  if (sec.error) return { error: sec.error };
  const ids = (sec.data || []).map(x => x.id);
  let enrolled = 0;
  for (let i = 0; i < ids.length; i += 50) {
    const r = await db.from('enrollments').select('*', { count: 'exact', head: true }).in('section_id', ids.slice(i, i + 50)).eq('status', 'active');
    if (r.error) return { error: r.error };
    enrolled += r.count || 0;
  }
  const pub = await db.from('assignment_offerings').select('*', { count: 'exact', head: true })
    .eq('course_offering_id', offeringId).eq('is_published', true);
  if (pub.error) return { error: pub.error };
  return { error: null, enrolled, published: pub.count || 0 };
}

/** The sentence that goes in the confirmation, with the counts. */
export function activeConfirmText(offering, makeActive, impact) {
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  return `Make ${offering.courseTitle || offering.courseCode} · ${offering.termLabel} ${makeActive ? 'active' : 'inactive'}?

` +
    `It has ${n(impact.enrolled, 'enrolled cadet', 'enrolled cadets')} and ${n(impact.published, 'published assignment', 'published assignments')}.

` +
    activeStatement(makeActive);
}

/**
 * Set the flag and read it back. Returns { error } or { isActive }. A row that did not change (no permission, or the
 * offering is gone) is an error, never a silent success.
 */
export async function setOfferingActive(db, offeringId, makeActive) {
  const r = await db.from('course_offerings').update({ is_active: !!makeActive }).eq('id', offeringId).select('id,is_active');
  if (r.error) return { error: r.error };
  if (!r.data || r.data.length !== 1) return { error: { message: 'The offering was not changed (you may not have permission, or it is gone). Reload the page.' } };
  if (r.data[0].is_active !== !!makeActive) return { error: { message: 'The database did not keep the change. Reload the page and check.' } };
  return { error: null, isActive: r.data[0].is_active };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Setting up a course for a term: one guided path over the same three writes
 * ════════════════════════════════════════════════════════════════════════════ */

/*
 * The data model is unchanged: a course, a term, and a row that joins them (an "offering"). The first-time path used
 * to be three separate forms, in an order the person had to know. This is one form that picks or makes the course,
 * picks or makes the term, chooses a director, and does the writes in that order, stopping at the first one that
 * fails and saying what was made. The writes are the same functions as before (createCourse, createTerm,
 * createOffering), so the database decides who may do what exactly as it did. A term set up this way is always
 * created inactive: going active is a later step, on the checklist.
 *
 * The page does not show the word "offering" on this path. The words here are course, term and "course for a term".
 */

/** Problems with the guided form, as plain sentences. `form` = { course, term, directorId }, each part { mode, id, ... }. */
export function checkSetup(form, existing = []) {
  const out = [];
  const c = form?.course || {}, t = form?.term || {};
  if (c.mode === 'new') out.push(...checkCourse(c));
  else if (!c.id) out.push('Choose the course, or make a new one.');
  if (t.mode === 'new') out.push(...checkTerm(t));
  else if (!t.id) out.push('Choose the term, or make a new one.');
  if (!out.length && c.mode !== 'new' && t.mode !== 'new') {
    const dup = (existing || []).find(o => o.courseId === c.id && o.termId === t.id);
    if (dup) out.push('That course is already set up for that term. Open it from the list below.');
  }
  return out;
}

/**
 * Do the writes in order: course, term, then the course-for-a-term row and its director. Returns what was made and, if a
 * step failed, which one. A course or term made before a failure stays made and is returned, so the page can select it
 * and a second press does not try to make it again.
 *
 * @returns {Promise<{ made: object, failedAt: ('course'|'term'|'link'|null), error: object|null, directorError: object|null }>}
 */
export async function runSetup(db, form, existing = []) {
  const made = { courseId: null, courseCode: null, termId: null, termLabel: null, offeringId: null };
  const c = form.course, t = form.term;
  const problems = checkSetup(form, existing);
  if (problems.length) return { made, failedAt: null, error: { message: problems.join(' ') }, directorError: null, refused: true };

  if (c.mode === 'new') {
    const r = await createCourse(db, c);
    if (r.error) return { made, failedAt: 'course', error: r.error, directorError: null };
    made.courseId = r.id; made.courseCode = String(c.code).trim(); made.courseCreated = true;
  } else {
    made.courseId = c.id;
  }
  if (t.mode === 'new') {
    const r = await createTerm(db, t);
    if (r.error) return { made, failedAt: 'term', error: r.error, directorError: null };
    made.termId = r.id; made.termLabel = String(t.label).trim(); made.termCreated = true;
  } else {
    made.termId = t.id;
  }
  const o = await createOffering(db, { courseId: made.courseId, termId: made.termId, directorId: form.directorId || '', isActive: false });
  if (o.error) return { made, failedAt: 'link', error: o.error, directorError: null };
  made.offeringId = o.id;
  return { made, failedAt: null, error: null, directorError: o.directorError || null };
}

/**
 * What to tell the person after a guided setup, in plain words with no mention of "offerings". On a failure it lists
 * what WAS made and what to do next, so nobody is left guessing whether to start over.
 */
export function setupMessage(res, form) {
  const c = form?.course || {}, t = form?.term || {};
  const cName = c.mode === 'new' ? `“${String(c.title || c.code || '').trim()}”` : 'the course';
  const tName = t.mode === 'new' ? `“${String(t.label || t.code || '').trim()}”` : 'the term';
  if (!res.error) {
    const bits = [];
    if (res.made.courseCreated) bits.push(`the course ${cName}`);
    if (res.made.termCreated) bits.push(`the term ${tName}`);
    bits.push('the course for that term (not active yet)');
    let text = `Done. Made ${bits.join(', ')}.`;
    if (res.directorError) text += ` The director could not be added: ${termsError(res.directorError)} Add them from the Staff tab of Course Admin.`;
    else if (form.directorId) text += ' The director has been added.';
    return text + ' Next, work down the checklist below.';
  }
  if (res.refused) return res.error.message;
  const done = [];
  if (res.made.courseCreated) done.push(`the course ${cName}`);
  if (res.made.termCreated) done.push(`the term ${tName}`);
  const madeText = done.length ? `Made ${done.join(' and ')}. ` : 'Nothing was made. ';
  const what = { course: 'The course could not be made', term: 'The term could not be made', link: 'The course could not be set up for that term' }[res.failedAt] || 'It stopped';
  const next = done.length
    ? 'What you made is already chosen below. Fix the problem and press Set up again; it will not make those twice.'
    : 'Fix the problem and press Set up again.';
  return `${madeText}${what}: ${termsError(res.error, { partial: !!done.length })} ${next}`;
}

/**
 * Which offerings get a checklist. A director gets one for each offering they DIRECT (not each course they
 * merely teach in), at most six. An administrator directs everything, so "yours" would list them all: they get
 * the offering chosen in the menu and the one just set up. Pure.
 */
export function checklistTargets(offerings, courses, { isAdmin = false, currentOffering = '', focusId = '' } = {}) {
  const directs = new Set((courses || []).filter(c => c.role === 'director').map(c => c.offeringId));
  const ids = new Set();
  if (isAdmin) { for (const id of [focusId, currentOffering]) if (id) ids.add(id); }
  else for (const o of offerings || []) if (directs.has(o.id)) ids.add(o.id);
  let targets = (offerings || []).filter(o => ids.has(o.id));
  if (focusId) targets = [...targets.filter(o => o.id === focusId), ...targets.filter(o => o.id !== focusId)];
  return targets.slice(0, 6);
}

/** The steps of the director's checklist, from the counts. Pure. `c` = { enrolled, assignments, scaleSaved, isActive }. */
export function checklistSteps(c) {
  return [
    { key: 'roster', title: 'Roster', done: (c.enrolled || 0) > 0,
      detail: (c.enrolled || 0) > 0 ? `${c.enrolled} cadet${c.enrolled === 1 ? '' : 's'} enrolled` : 'No cadets yet' },
    { key: 'assignments', title: 'Assignments', done: (c.assignments || 0) > 0,
      detail: (c.assignments || 0) > 0 ? `${c.assignments} assignment${c.assignments === 1 ? '' : 's'} entered` : 'No assignments yet' },
    { key: 'scale', title: 'Letter scale', done: !!c.scaleSaved,
      detail: c.scaleSaved ? 'A letter scale is saved' : 'No letter scale saved yet' },
    { key: 'active', title: 'Go active', done: !!c.isActive,
      detail: c.isActive ? 'Active' : 'Not active yet' },
  ];
}

/** The counts the checklist needs, for one course-for-a-term row. */
export async function loadChecklist(db, offeringId, isActive) {
  const sec = await db.from('sections').select('id').eq('course_offering_id', offeringId);
  if (sec.error) return { error: sec.error };
  const ids = (sec.data || []).map(x => x.id);
  let enrolled = 0;
  for (let i = 0; i < ids.length; i += 50) {
    const r = await db.from('enrollments').select('*', { count: 'exact', head: true }).in('section_id', ids.slice(i, i + 50)).eq('status', 'active');
    if (r.error) return { error: r.error };
    enrolled += r.count || 0;
  }
  const a = await db.from('assignment_offerings').select('*', { count: 'exact', head: true }).eq('course_offering_id', offeringId);
  if (a.error) return { error: a.error };
  const s = await db.from('letter_scales').select('*', { count: 'exact', head: true }).eq('course_offering_id', offeringId);
  if (s.error) return { error: s.error };
  return { error: null, enrolled, assignments: a.count || 0, scaleSaved: (s.count || 0) > 0, isActive: !!isActive };
}
