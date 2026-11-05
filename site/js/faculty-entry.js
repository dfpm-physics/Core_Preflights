// faculty-entry.js — loads and writes the data behind the score entry page (site/faculty/entry.html).
//
// The rules (what a score is, what a file means, what a plan holds) are in faculty-entry-parse.js and
// are tested offline. This file only reads rows and calls the database. It adds no arithmetic: totals,
// states and letters come from the database functions, never from here.
//
// WRITE PATHS THAT NEED A REAL RUN ON STAGING, once the freeze ends (each is proven offline or on a
// scratch database only): enterGrades, publishColumn, reopenColumn, excuse, revokeExcusal.

import { fetchAll } from './schema.js';
import { dbCents, centsText } from './faculty-entry-parse.js';

/** An item is entered by hand when any of its paths is graded by hand entry or by import. */
export const isHandEntered = (paths) => (paths || []).some(p => p.grading === 'hand_entered' || p.grading === 'imported');
// Whether publishing also closes a column is NOT decided here. The database decides it, by the same test the
// total rule uses, and publish_preview / publish_column say what it decided (closeApplies).

export function shapeEntryItem(r) {
  return {
    id: r.id, title: r.assignments?.title || r.id, slug: r.assignments?.slug || '',
    pointsCents: dbCents(r.points_possible), bonus: !!(r.is_bonus || r.allow_over_max),
    published: !!r.is_published, position: r.position ?? 0,
  };
}

const ITEM_SELECT = 'id,points_possible,is_bonus,allow_over_max,is_published,position,assignments!inner(slug,title),offering_activities(delivery,grading)';

/**
 * Everything the page shows. Resolves { error } on any failed read, so the page can say so; it never
 * hands back a partial picture. Roster rows carry every status, because matching must be able to say
 * "this cadet is only dropped".
 */
export async function loadEntry(db, courseOfferingId) {
  const secR = await db.from('sections').select('id,code').eq('course_offering_id', courseOfferingId).order('code');
  if (secR.error) return { error: secR.error };
  const secIds = (secR.data || []).map(s => s.id);
  const itemsR = await db.from('assignment_offerings').select(ITEM_SELECT).eq('course_offering_id', courseOfferingId);
  if (itemsR.error) return { error: itemsR.error };
  const items = (itemsR.data || []).filter(r => isHandEntered(r.offering_activities)).map(shapeEntryItem)
    .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
  if (!secIds.length) return { sections: [], items, roster: [], grades: {}, excused: {}, closures: {} };

  const enrR = await fetchAll(() => db.from('enrollments').select('id,section_id,status,student_id,students(student_id,name,email)').in('section_id', secIds));
  if (enrR.error) return { error: enrR.error };
  const roster = (enrR.data || []).map(e => ({
    enrollmentId: e.id, sectionId: e.section_id, status: e.status, studentId: e.student_id,
    name: e.students?.name || '', email: e.students?.email || '',
  }));
  const itemIds = items.map(i => i.id);
  const grades = {}, excused = {}, closures = {};
  if (itemIds.length) {
    const gR = await fetchAll(() => db.from('grades').select('id,enrollment_id,assignment_offering_id,points_earned,is_finalized,updated_at').in('assignment_offering_id', itemIds));
    if (gR.error) return { error: gR.error };
    for (const g of gR.data || []) grades[`${g.enrollment_id}|${g.assignment_offering_id}`] = { cents: dbCents(g.points_earned), finalized: !!g.is_finalized, updatedAt: g.updated_at };
    const xR = await fetchAll(() => db.from('grade_excusals').select('id,enrollment_id,assignment_offering_id,reason').in('assignment_offering_id', itemIds).is('revoked_at', null));
    if (xR.error) return { error: xR.error };
    for (const x of xR.data || []) excused[`${x.enrollment_id}|${x.assignment_offering_id}`] = { id: x.id, reason: x.reason };
    const cR = await fetchAll(() => db.from('column_closures').select('id,assignment_offering_id,section_id').in('assignment_offering_id', itemIds).is('reopened_at', null));
    if (cR.error) return { error: cR.error };
    for (const c of cR.data || []) closures[`${c.section_id}|${c.assignment_offering_id}`] = c.id;
  }
  return { sections: secR.data || [], items, roster, grades, excused, closures };
}

/** Turn a database or network error into a sentence a person can act on. */
export function plainEntryError(e) {
  const m = String(e?.message || e || '');
  if (/changed since you read the preview/.test(m)) return 'The column changed after the preview was read, so nothing was published. The preview has been read again: check it, then publish again.';
  if (/would count \d+ blank/.test(m)) return 'Publishing this column would count blank scores as 0, and the preview was not confirmed. Nothing was published. Reload the page and publish again.';
  if (e?.code === '40001' || /changed since you read|removed since you read/.test(m)) return 'A grade changed while you were looking at it. Reload the page and check the numbers again. Nothing was saved.';
  if (/already published/.test(m)) return 'A score you are changing is already published to students. Nothing was saved. Confirm the replacement and try again.';
  if (/not a plain number|too large|above the item|below zero|more than two decimals/.test(m)) return 'A score is out of range or is not a plain number. Nothing was saved.';
  if (/not published to students/.test(m)) return 'This item is not published to students yet, so publishing its scores would show them nothing. Publish the item first.';
  if (/not entered by hand or by import/.test(m)) return 'This item is not entered by hand or by import. Its scores are published from the grade page.';
  if (/not an enrolled cadet/.test(m)) return 'A cadet in this batch is not in one of your sections. Nothing was saved.';
  if (/Failed to fetch|NetworkError|timeout/i.test(m)) return 'The connection dropped, so it is not known whether this was saved. Reload and check before trying again.';
  if (e?.code === '42501' || /permission denied|row-level security/i.test(m)) return 'The database refused this. Only a Director can do it.';
  if (/Could not find the function|PGRST202/.test(m)) return 'This database has not been upgraded for this page yet.';
  return m ? `Could not finish: ${m}` : 'Could not finish.';
}

/**
 * Save a batch of scores for one item, all or nothing. `changes` come from buildEntryChanges or
 * buildImportPlan. Each row carries the version it was read at, so a grade someone else changed is
 * refused, not overwritten.
 */
export async function enterGrades(db, itemId, changes, { source = 'instructor', allowPublished = false } = {}) {
  const rows = changes.map(c => ({ enrollment_id: c.enrollmentId, points: centsText(c.cents), expect: c.updatedAt || null }));
  const { data, error } = await db.rpc('enter_grades', { p_offering: itemId, p_rows: rows, p_source: source, p_allow_published: allowPublished });
  return error ? { error } : { saved: data?.saved ?? 0, replacedPublished: data?.replaced_published ?? 0 };
}

/**
 * The sentence for a save. A score that replaced a published one is live to students the moment it is saved, so it
 * is never called a draft.
 */
export function writeSummary({ saved, replacedPublished }) {
  const live = replacedPublished || 0;
  if (!live) return { kind: 'success', text: `Saved ${saved} score(s) as drafts.` };
  const drafts = saved - live;
  return {
    kind: 'warn',
    text: drafts > 0
      ? `Saved ${saved} score(s). ${live} of them replaced a published score and went live to students at once; the other ${drafts} ${drafts === 1 ? 'is a draft' : 'are drafts'}.`
      : `Saved ${saved} score(s). ${saved === 1 ? 'It replaced' : 'All of them replaced'} a published score and went live to students at once. None of them is a draft.`,
  };
}

/** What publishing this item for this section would do right now, from the database's own rules. */
export async function publishPreview(db, itemId, sectionId) {
  const { data, error } = await db.rpc('publish_preview', { p_offering: itemId, p_section: sectionId || null });
  if (error) return { error };
  return { preview: {
    itemPublished: !!data?.item_published, handEntered: !!data?.hand_entered, drafts: data?.drafts ?? 0,
    heldAi: data?.held_ai ?? 0, live: data?.live ?? 0, closeApplies: !!data?.close_applies,
    openSections: data?.open_sections ?? 0, sections: data?.sections ?? 0,
    blankCount: data?.blank_count ?? 0, blankCadets: Array.isArray(data?.blank_cadets) ? data.blank_cadets : [],
    waitingCount: data?.waiting_count ?? 0, fingerprint: data?.fingerprint ?? null,
    publishClosedSections: data?.publish_closed_sections ?? 0, handClosedSections: data?.hand_closed_sections ?? 0 } };
}

/**
 * Publish the hand-entered or imported drafts of one item for a section (or all the caller's sections). The database
 * also closes the column when the item takes no submission: that is part of publishing, and the page does not choose
 * it. `fingerprint` is the value the preview showed; the database refuses a publish whose column has changed since.
 */
export async function publishColumn(db, itemId, sectionId, fingerprint) {
  const { data, error } = await db.rpc('publish_column', { p_offering: itemId, p_section: sectionId || null, p_fingerprint: fingerprint ?? null });
  return error ? { error } : { published: data?.published ?? 0, closed: data?.closed ?? 0, zeroed: data?.zeroed ?? 0, heldAi: data?.held_ai ?? 0, closeApplies: !!data?.close_applies };
}

/** Undo a publish: the scores go back to drafts and, by default, the columns that publish closed reopen. A column closed any other way stays closed. */
export async function unpublishColumn(db, itemId, sectionId, reopen = true) {
  const { data, error } = await db.rpc('unpublish_column', { p_offering: itemId, p_section: sectionId || null, p_reopen: !!reopen });
  return error ? { error } : { unpublished: data?.unpublished ?? 0, reopened: data?.reopened ?? 0, keptClosed: data?.kept_closed ?? 0 };
}

/** The sentence for a publish. Publishing nothing is never reported as a success. */
export function publishSummary({ published, closed, zeroed, heldAi }) {
  const ai = heldAi ? ` ${heldAi} AI-suggested draft(s) were left out: a person reviews those on the grade page.` : '';
  if (!published && !closed) {
    return { kind: heldAi ? 'warn' : 'info', text: `Nothing was published: there were no drafted scores to publish.${ai}` };
  }
  const parts = [published ? `Published ${published} score(s)` : 'No scores needed publishing'];
  if (closed) parts.push(`closed ${closed} section column(s)`);
  if (zeroed) parts.push(`${zeroed} blank score(s) now count as 0`);
  return { kind: heldAi ? 'warn' : 'success', text: `${parts.join('; ')}.${ai}` };
}

/**
 * After a successful write, the page re-reads. If that read fails the write still happened, and the page must say
 * both things: the save succeeded, and what it could not read back. It keeps no stale table.
 * -> { vm, banners: [{ kind, text }] }
 */
export function afterWrite(okNote, fresh) {
  if (fresh?.error) {
    return { vm: null, banners: [okNote, {
      kind: 'error',
      text: `The page could not be read back after saving, so the numbers below are not shown: ${plainEntryError(fresh.error)} Your change was saved. Reload the page to see it.`,
    }] };
  }
  return { vm: fresh, banners: [okNote] };
}

export async function reopenColumn(db, closureId) {
  const { error } = await db.from('column_closures').update({ reopened_at: new Date().toISOString() }).eq('id', closureId);
  return error ? { error } : {};
}

/** Excuse one cadet from one item. A Director only: the database refuses everyone else. */
export async function excuse(db, enrollmentId, itemId, reason) {
  const why = String(reason || '').trim();
  if (!why) return { error: { message: 'A reason is required.' } };
  const { error } = await db.from('grade_excusals').insert({ enrollment_id: enrollmentId, assignment_offering_id: itemId, reason: why });
  return error ? { error } : {};
}

export async function revokeExcusal(db, excusalId, reason) {
  const why = String(reason || '').trim();
  if (!why) return { error: { message: 'A reason is required.' } };
  const { error } = await db.from('grade_excusals').update({ revoked_at: new Date().toISOString(), revoked_reason: why }).eq('id', excusalId);
  return error ? { error } : {};
}
