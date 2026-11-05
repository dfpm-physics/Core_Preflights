// lesson-link.js — the prefill link and the destination chooser, as pure functions the Assignments page uses.
//
// WHY THIS FILE EXISTS
//   An AI tutor build hands a director a one-click link to faculty/lessons.html. The URL and every parameter name are a
//   FROZEN contract (docs/contracts/INTERACTION-PREFILL-LINK.md), and the older editor reads them inside its page. The
//   newer Assignments page has to read the same link and mean the same thing, so the reading lives here, where a test can
//   run it beside the older page's own code on the same query (tests/app-schema/test-lesson-link.mjs does that).
//
//   Nothing here touches the database or the page. The page owns the screen; this file owns what a link says.
//
// THE PARAMETERS (all optional)
//   new, id, course, title, desc, policy, num, due_m, due_t, url (or iurl), iid, ititle, idesc, pub
//   A link is a link when ANY of new, id, iid or title is present, which is the older page's own rule.
//
// ON `policy`
//   The link says preflight, interaction or choice. The page's own words for the same three are typed, tutor and choice
//   (typed response earns credit, tutor earns credit, either earns credit). POLICY_FROM_LINK is the one translation.

/** The link parameters whose presence means "this URL is a prefill link". */
export const PREFILL_TRIGGERS = ['new', 'id', 'iid', 'title'];

export const hasPrefill = (search) => {
  const p = new URLSearchParams(search || '');
  return PREFILL_TRIGGERS.some(k => p.has(k));
};

/** Link word -> the page's word. Anything else in `policy` is ignored, as the older page ignores it. */
export const POLICY_FROM_LINK = { preflight: 'typed', interaction: 'tutor', choice: 'choice' };

export const POLICIES = ['choice', 'typed', 'tutor'];

/**
 * Which path earns credit under each policy. This is the older editor's roleFor() under the page's own words; a test
 * compares the two for every combination, so they cannot drift.
 */
export function rolesFor(policy) {
  if (policy === 'tutor') return { typed: 'practice', tutor: 'graded' };
  if (policy === 'typed') return { typed: 'graded', tutor: 'practice' };
  return { typed: 'graded', tutor: 'graded' };                  // choice
}

/** The policy a pair of stored roles says. The older page reads the same way (policyOf). */
export function policyFromRoles(typedRole, tutorRole) {
  if (typedRole === 'graded' && tutorRole === 'graded') return 'choice';
  if (typedRole === 'graded') return 'typed';
  if (tutorRole === 'graded') return 'tutor';
  return null;                                                  // neither earns credit: not a state this page writes
}

/**
 * A course code from a link -> the offering to start from, and whether the code was honoured. Prefers the term already
 * in view; `courses` is sorted newest term first, so the fallback lands on the current semester.
 * `matched` is returned, never swallowed: a link naming a course this person does not run must be said out loud.
 */
export function resolveOffering(courses, currentOffering, code) {
  if (!code) return { offeringId: currentOffering, requestedCode: null, matched: true };
  const here = (courses || []).find(c => c.offeringId === currentOffering && c.courseCode === code);
  const any = here || (courses || []).find(c => c.courseCode === code);
  return { offeringId: any?.offeringId || currentOffering, requestedCode: code, matched: !!any };
}

/** The offerings this person may author in. Authoring is director-gated, so a course they only teach is not offered. */
export function authorableOfferings(courses, isGlobalAdmin) {
  return (courses || []).filter(c => !!isGlobalAdmin || c.role === 'director');
}

/**
 * Read a prefill link. Returns null when the query is not a link.
 * @param {string} search  location.search
 * @param {{courses: object[], currentOffering: string}} ctx
 */
export function parsePrefill(search, ctx) {
  const p = new URLSearchParams(search || '');
  if (!PREFILL_TRIGGERS.some(k => p.has(k))) return null;
  const scope = resolveOffering(ctx.courses, ctx.currentOffering, p.get('course'));
  return {
    id: p.get('id'), offeringId: scope.offeringId,
    requestedCode: scope.requestedCode, codeMatched: scope.matched,
    title: p.get('title'), desc: p.get('desc'),
    policy: p.get('policy'), num: p.get('num'), due_m: p.get('due_m'), due_t: p.get('due_t'),
    iid: p.get('iid'), iurl: p.get('url') ?? p.get('iurl'),
    ititle: p.get('ititle'), idesc: p.get('idesc'),
    pub: p.has('pub') ? ['1', 'true', 'yes'].includes((p.get('pub') || '').toLowerCase()) : null,
  };
}

const pick = (pv, ev) => (pv != null && pv !== '' ? pv : (ev ?? ''));

/**
 * What a link puts in the form for a NEW assignment. The same fields the older page fills, by the same rules:
 * a value the link omits stays empty, and a `policy` it does not recognise is ignored.
 *
 *   id      the assignment's own id (its slug). Used when the assignment is first saved.
 *   num     the assignment number (stored as its position).
 *   iid     the tutor id. Without it the assignment id stands in, as in the older page.
 *   due_m / due_t   the M-day and T-day dates. The older page keys them by letter into a per-day map; so does this.
 *   pub     carried and shown, never acted on: this page saves unpublished.
 *
 * @param {object} prefill  from parsePrefill
 * @param {object[]} sections  the offering's sections, to place the dates
 * @returns {object}  form fields to lay over an empty form (only the ones the link sets)
 */
export function formFromPrefill(prefill, sections = []) {
  const out = {};
  if (!prefill) return out;
  const t = pick(prefill.title, '');
  if (t) out.title = t;
  const d = pick(prefill.desc, '');
  if (d) out.description = d;
  const n = pick(prefill.num, '');
  if (n !== '') out.lessonNumber = String(n);
  const id = pick(prefill.id, '');
  if (id) out.slug = id;
  if (POLICY_FROM_LINK[prefill.policy]) out.policy = POLICY_FROM_LINK[prefill.policy];
  if (prefill.iid != null || prefill.iurl != null) {
    out.withTutor = true;
    if (prefill.iid != null) out.interactiveSlug = prefill.iid;
    else if (prefill.id) out.interactiveSlug = prefill.id;
    if (prefill.iurl != null) out.interactiveUrl = prefill.iurl;
    if (prefill.ititle != null) out.interactiveTitle = prefill.ititle;
    if (prefill.idesc != null) out.interactiveDesc = prefill.idesc;
  }
  Object.assign(out, datesFromPrefill(prefill, sections));
  if (prefill.pub != null) out.publishRequested = prefill.pub;
  return out;
}

/**
 * The link's two dates placed on the page's date boxes.
 *
 * The older page keeps a per-day map and gives each section the date of the first of its meeting days that has one.
 * Here: a course with both M-day and T-day sections gets a date per track; a course with other days or one track gets
 * one date for everybody, taken from the letter that matches a day its sections meet (else the other letter); a course
 * whose sections declare no days gets one date. A date the link does not give stays empty.
 */
export function datesFromPrefill(prefill, sections = []) {
  const m = pick(prefill?.due_m, ''), t = pick(prefill?.due_t, '');
  if (!m && !t) return {};
  const days = [...new Set((sections || []).flatMap(s => s.meeting_days || []))].sort();
  if (days.includes('M') && days.includes('T')) {
    const dayDates = {};
    for (const day of days) dayDates[day] = day === 'M' ? m : day === 'T' ? t : '';
    return { dayDates };
  }
  if (!days.length) return { allDate: m || t };
  const matching = days.includes('M') ? m : days.includes('T') ? t : '';
  return { allDate: matching || m || t };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * The destination chooser
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * How one existing assignment appears in "Modify or add to assignment" for a link carrying tutor id `iid`.
 * A different id REPLACES the tutor (its reports go with it); the same id only refreshes the link in place, which
 * keeps every report attached and is the outcome to prefer; no tutor yet means the link adds one.
 *
 * @param {{tutorSlug?: string|null, isNew: boolean, isPublished?: boolean, lessonNumber?: number|null}} item
 */
export function destinationCard(item, iid) {
  const has = !!item.tutorSlug;
  const swap = has && item.tutorSlug !== iid;
  const meta = [
    item.lessonNumber != null ? 'L' + item.lessonNumber : null,
    item.isPublished ? 'published' : 'draft',
    !has ? 'no tutor yet' : swap ? `replaces “${item.tutorSlug}”` : 'updates this tutor in place',
  ].filter(Boolean).join(' · ');
  return {
    swap,
    badge: !item.isNew ? 'Older page' : swap ? 'Will replace' : (has ? 'Will update' : 'Add to'),
    meta,
    selectable: !!item.isNew,
  };
}

/**
 * What choosing an existing assignment carries from the link: the tutor and nothing else. The assignment keeps its own
 * title, dates and number; passing the link's lesson-level values would quietly rewrite the one chosen.
 */
export function overlayForExisting(prefill) {
  const iid = prefill.iid || prefill.id;
  return {
    iid,
    iurl: prefill.iurl,
    ititle: prefill.ititle || prefill.title,
    idesc: prefill.idesc || prefill.desc,
  };
}
