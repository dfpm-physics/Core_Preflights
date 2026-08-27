// PREP — system health.
//
// One page that answers "is the system working?" without anyone running a script or
// spending an agent turn on it. Every number here is read live through the ordinary
// anon-key client, so RLS applies exactly as it does everywhere else.
//
// ── WHY THIS IS ADMIN-ONLY FOR NOW ───────────────────────────────────────────────────────
// The page makes claims about TOTALS — "37 offerings", "no lesson is missing a fallback",
// "completion is 74%". RLS answers *what may you see*, never *what exists*, and it does not
// say which question it answered (CORE.md §3, which records a published, confident, wrong
// count taken through a staff session). A global admin's reads are unfiltered, so for that
// caller the two questions have the same answer. Widening this to instructors means either
// scoping every claim to their sections or moving the aggregation server-side; until one of
// those is done, the gate is what keeps the numbers honest.
//
// ── VOCABULARY ───────────────────────────────────────────────────────────────────────────
// iPREP = the interactive (Claude-artifact) path.  PREP = the written question set.
// The code says `interactive` / `written` because that is what `activities.modality` holds;
// every label a human reads says iPREP / PREP.
//
// ── THE ISSUES PANEL IS THE POINT ────────────────────────────────────────────────────────
// Counting things is easy and mostly not useful. What an operator needs is "here is what is
// wrong, and here is what to do about it". Every check in CHECKS carries a `fix` written for
// the person who has to act, not a description of the symptom. Adding a check is adding one
// entry to that array — nothing else on the page needs to change.

import { esc, pct } from './util.js';

// Resolved at CALL time, not at import time. config.js is a classic script that assigns
// window.db, and reading it here at module scope would both couple the load order and make
// every pure function below untestable outside a browser — which is where they are checked.
const client = () => window.db;

/* Modality labels. The DB says interactive/written; humans say iPREP/PREP. */
export const MODALITY_LABEL = { interactive: 'iPREP', written: 'PREP' };

/* Band colours for the completion stack. Deliberately NOT red/green for the two paths —
 * neither iPREP nor PREP is "the good one", and colouring them that way would editorialise
 * a choice the cadet is allowed to make. Red is reserved for the one band that IS a problem. */
// `label` is the legend and the tooltip; `short` is the callout printed beside a band too
// thin to hold its own number. They differ because the callout sits in a 46px column and a
// full label there collides with the next lesson's bar.
export const BAND = {
  interactive: { colour: 'var(--h-iprep)', label: 'iPREP',                    short: 'iPREP' },
  written:     { colour: 'var(--h-prep)',  label: 'PREP',                     short: 'PREP' },
  errored:     { colour: 'var(--h-bad)',   label: 'Hit an error, nothing in', short: 'err' },
  missing:     { colour: 'var(--h-none)',  label: 'Not in',                   short: 'not in' },
};

export const SEVERITY = { critical: 2, warning: 1, info: 0 };

/* ── The shared time axis ────────────────────────────────────────────────────────────────
 * Every row on this page must cover the SAME stretch of the term, or the rows cannot be
 * compared and the page is four unrelated charts stacked up. "The last six lessons of each
 * course" is not a shared window: phys-310 is on lesson 9 while phys-110 is on preflight 11,
 * so per-course windows silently put different weeks side by side.
 *
 * The unit is the academy's own teaching-day slot — an M-day and its paired T-day — which is
 * NOT in the database and NOT derivable (CORE.md §2: the obvious guess, weekdays alternating
 * minus holidays, is wrong in every direction). The ground truth is the published USAFA
 * calendar, mirrored at `site/data/academic-calendar.json`, which names each teaching day
 * `M<n>` / `T<n>`. A column is one slot. A class with no preflight in that slot gets a gap,
 * and the gap is information rather than an absence.
 */
export const CALENDAR_URL = '../data/academic-calendar.json';

/** How many teaching days AHEAD of the one in progress the axis runs.
 *  The window is anchored on today rather than on the last lesson that closed, because the
 *  two questions this page is opened with are "did the one that just closed go in?" and
 *  "is the next one set up?" — and the second cannot be answered by a chart that stops at
 *  the present. Everything left over after the anchor and its lookahead is filled with
 *  PRIOR days, so widening the window buys history, never more empty columns. */
export const LOOKAHEAD_SLOTS = 2;

/** Local calendar date of an instant, in the timezone the deadlines were authored in.
 *  A deadline is 23:59:59 America/Denver; read in any other zone it can land on the wrong
 *  day and put the lesson in the wrong column. */
const denverDate = (iso) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(iso));

/** [{ n, M: 'YYYY-MM-DD', T: 'YYYY-MM-DD' }] for one term, in teaching order. */
export function buildSlots(calendar, termCode) {
  const term = (calendar?.terms || []).find(t => t.code === termCode);
  if (!term) return [];
  const by = new Map();
  for (const d of term.days || []) {
    if (!by.has(d.n)) by.set(d.n, { n: d.n, M: null, T: null });
    by.get(d.n)[d.track] = d.date;
  }
  return [...by.values()].sort((x, y) => x.n - y.n);
}

/** Which slot a deadline belongs to: the NEAREST teaching day of that track, ties going to
 *  the later one.
 *
 *  The obvious rule — "the first teaching day on or after the deadline", since a preflight is
 *  due the evening before its meeting — is wrong on real data, and wrong in the direction that
 *  matters. A deadline that ran a full day late then lands in the FOLLOWING slot, i.e. the
 *  lesson is drawn a column to the right of where it was taught. Deadlines here have been a
 *  day late before, five of them at once (CORE.md §2), so this is not hypothetical.
 *
 *  Nearest-with-ties-later gets both cases: an ordinary night-before deadline is 1 day from
 *  its own meeting and 3+ from the neighbouring one; a day-late deadline is 1 day from its own
 *  meeting on the other side; a deadline moved onto the morning of its lesson is 0 away. The
 *  tie-break matters because M-days can sit two days apart, which puts a night-before deadline
 *  equidistant between its own lesson and the previous one — and the night before is by far
 *  the more likely of the two.
 *
 *  Checked against two independently recorded meeting dates: phys-310 lesson 8 (taught on its
 *  own deadline day) and lesson 9 (Mon 31 Aug), both from CHANGELOG 2026-08-26. */
function slotForDeadline(iso, track, slots) {
  const day = Date.parse(denverDate(iso) + 'T00:00:00Z');
  let best = null, bestGap = Infinity;
  for (const sl of slots) {
    if (!sl[track]) continue;
    const gap = Math.abs(Date.parse(sl[track] + 'T00:00:00Z') - day);
    if (gap <= bestGap) { bestGap = gap; best = sl.n; }   // <= : a tie takes the later slot
  }
  return best;
}

/** The slot an assignment offering sits in: the earliest its tracks agree on. */
export function slotOfOffering(a, slots) {
  const cands = [];
  const byDay = a.due_by_day || {};
  for (const track of ['M', 'T']) {
    if (byDay[track]) cands.push(slotForDeadline(byDay[track], track, slots));
  }
  if (!cands.length && a.due_at) {
    for (const track of ['M', 'T']) cands.push(slotForDeadline(a.due_at, track, slots));
  }
  const live = cands.filter(n => n != null);
  return live.length ? Math.min(...live) : null;
}

/** A training sandbox is a parallel copy of a real course with an untouched roster. Left in,
 *  its blank lessons read as a cohort finishing nothing and its setup gaps count as real
 *  findings. The marker is the TERM, which is where the two offerings of phys-215 differ. */
export const isTrainingOffering = (o) =>
  /^training[-_]/i.test(o?.terms?.code || '') || /TRAINING/.test(o?.terms?.label || '');

/* ── Loading ─────────────────────────────────────────────────────────────────────────────
 * Five table reads plus the calendar, all filtered server-side. The only one that can grow
 * without bound is `submissions`, so it is scoped to the offerings inside the slot window —
 * which is why the window is a control and not "everything, always". A whole term is ~40
 * lessons x ~900 cadets; pulling that into a browser to count it would work today and stop
 * working the term somebody doubles the roster.
 */
export async function loadHealth({ lessonWindow = 6, errorDays = 14 } = {}) {
  const db = client();
  const since = new Date(Date.now() - errorDays * 86400000).toISOString();

  const [calendar, offRes, secRes, enrRes, aoRes, errRes] = await Promise.all([
    fetch(CALENDAR_URL).then(r => (r.ok ? r.json() : null)).catch(() => null),
    db.from('course_offerings')
      .select('id,course_id,is_active,courses(code,title),terms(code,label)')
      .eq('is_active', true),
    db.from('sections').select('id,code,meeting_days,course_offering_id'),
    db.from('enrollments')
      .select('id,student_id,section_id,status,students(student_id,name)')
      .eq('status', 'active'),
    db.from('assignment_offerings')
      .select('id,course_offering_id,is_published,opens_at,due_at,due_by_day,points_possible,' +
              'grading_mode,assignments!inner(id,slug,title),' +
              'offering_activities(grading_role,is_visible,activities(id,slug,modality,title,content))')
      .order('due_at', { ascending: true }),
    db.from('tutor_error_log')
      .select('id,logged_at,slug,kind,cadet_ref,cadet_id,http_status,model')
      .gte('logged_at', since)
      .order('logged_at', { ascending: false })
      .limit(5000),
  ]);

  for (const r of [offRes, secRes, enrRes, aoRes, errRes]) if (r.error) throw r.error;

  // Sandboxes are dropped HERE, once. Everything downstream filters on the surviving ids, so
  // there is no second place for one to leak back in.
  const offerings = (offRes.data || []).filter(o => !isTrainingOffering(o));
  const activeIds = new Set(offerings.map(o => o.id));
  const sections = (secRes.data || []).filter(s => activeIds.has(s.course_offering_id));
  const allAssignments = (aoRes.data || []).filter(a => activeIds.has(a.course_offering_id));

  // One term drives the axis: the one the live offerings are in.
  const termCode = offerings[0]?.terms?.code || null;
  const allSlots = buildSlots(calendar, termCode);

  // The window: the teaching day in progress, the next LOOKAHEAD_SLOTS after it, and as
  // much history before it as the width allows. "In progress" is the last day whose first
  // meeting has arrived — on a Thursday between T8 and M9 that is still slot 8, which is
  // the lesson whose deadline just passed and the one an operator is actually asking about.
  const today = denverDate(new Date().toISOString());
  let cur = -1;
  allSlots.forEach((sl, i) => { if ((sl.M || sl.T) <= today) cur = i; });
  const end = cur < 0 ? Math.min(allSlots.length, lessonWindow)
                      : Math.min(allSlots.length, cur + 1 + LOOKAHEAD_SLOTS);
  const slots = allSlots.slice(Math.max(0, end - lessonWindow), end);
  const inWindow = new Set(slots.map(sl => sl.n));

  for (const a of allAssignments) a.slot = allSlots.length ? slotOfOffering(a, allSlots) : null;
  const shown = allAssignments.filter(a => a.slot != null && inWindow.has(a.slot));

  const shownIds = shown.map(a => a.id);
  let submissions = [];
  if (shownIds.length) {
    const { data, error } = await db.from('submissions')
      .select('id,enrollment_id,assignment_offering_id,chosen_activity_id,status,committed_at')
      .in('assignment_offering_id', shownIds)
      .eq('status', 'committed');
    if (error) throw error;
    submissions = data || [];
  }

  return {
    readAt: new Date(),
    lessonWindow, errorDays,
    calendarOk: !!allSlots.length, termCode, slots, allSlots,
    offerings, sections, enrollments: enrRes.data || [],
    assignments: shown, allAssignments,
    submissions, errors: errRes.data || [],
  };
}

/* ── Shaping ─────────────────────────────────────────────────────────────────────────────
 * One row per (assignment offering x meeting track). A track is a section's `meeting_days`
 * — M-day and T-day cohorts sit different deadlines and finish at different rates, so
 * folding them together hides the thing worth seeing.
 */
export function shapeHealth(raw, { offeringId = 'all' } = {}) {
  const courseOf = new Map(raw.offerings.map(o => [o.id, o.courses?.code || o.course_id]));
  const sectionById = new Map(raw.sections.map(s => [s.id, s]));

  // A COURSE CODE DOES NOT IDENTIFY AN OFFERING, and assuming it does is a mistake this
  // system has already paid for: phys-215 has two active offerings, Fall 2026 and an
  // 80-cadet TRAINING SANDBOX, differing only by term. Shown as bare "phys-215" they are
  // indistinguishable, and the sandbox's untouched lessons read as a real cohort finishing
  // nothing. Every offering therefore carries its term, and only one is ever selected at a
  // time unless the operator asks for all of them.
  const offeringLabels = raw.offerings
    .map(o => ({
      id: o.id,
      course: o.courses?.code || o.course_id,
      term: o.terms?.label || o.terms?.code || '',
      label: (o.courses?.code || o.course_id) + (o.terms?.label ? ' · ' + o.terms.label : ''),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const labelOf = new Map(offeringLabels.map(o => [o.id, o]));

  // enrollment -> {student_id, track, course_offering_id}
  const enrInfo = new Map();
  for (const e of raw.enrollments) {
    const sec = sectionById.get(e.section_id);
    if (!sec) continue;                                   // a section outside the active set
    const days = sec.meeting_days || [];
    if (days.length !== 1) continue;                      // multi-day sections have no single track
    enrInfo.set(e.id, {
      studentId: e.student_id,
      name: e.students?.name || '',
      track: days[0],
      courseOfferingId: sec.course_offering_id,
    });
  }

  // Last-name tokens -> student ids, for matching the hand-typed `cadet_ref` on an error row.
  // It is a CLAIM a cadet typed, never an identity: a first name or a typo matches nothing,
  // and a shared surname matches several. Both cases are reported rather than guessed at.
  const tokenToStudents = new Map();
  for (const info of enrInfo.values()) {
    for (const tok of String(info.name).replace(/,/g, ' ').split(/\s+/)) {
      if (tok.length < 2) continue;
      const k = tok.toLowerCase();
      if (!tokenToStudents.has(k)) tokenToStudents.set(k, new Set());
      tokenToStudents.get(k).add(info.studentId);
    }
  }

  const activityById = new Map();
  for (const a of raw.assignments)
    for (const oa of a.offering_activities || [])
      if (oa.activities) activityById.set(oa.activities.id, oa.activities);

  // Errors grouped by the artifact slug they were reported against.
  const errBySlug = new Map();
  for (const e of raw.errors) {
    if (!e.slug) continue;
    if (!errBySlug.has(e.slug)) errBySlug.set(e.slug, []);
    errBySlug.get(e.slug).push(e);
  }

  const subsByOffering = new Map();
  for (const s of raw.submissions) {
    if (!subsByOffering.has(s.assignment_offering_id)) subsByOffering.set(s.assignment_offering_id, []);
    subsByOffering.get(s.assignment_offering_id).push(s);
  }

  const rosterByCourseTrack = new Map();                  // "coid|M" -> Set(studentId)
  for (const info of enrInfo.values()) {
    const k = info.courseOfferingId + '|' + info.track;
    if (!rosterByCourseTrack.has(k)) rosterByCourseTrack.set(k, new Set());
    rosterByCourseTrack.get(k).add(info.studentId);
  }

  const lessons = [];
  for (const a of raw.assignments) {
    if (offeringId !== 'all' && a.course_offering_id !== offeringId) continue;
    const acts = (a.offering_activities || []).map(oa => ({ ...oa, activity: oa.activities }))
      .filter(x => x.activity);
    const interactive = acts.find(x => x.activity.modality === 'interactive');
    const written = acts.find(x => x.activity.modality === 'written');
    const gradedModalities = acts.filter(x => x.grading_role === 'graded')
      .map(x => x.activity.modality);

    const subs = subsByOffering.get(a.id) || [];
    const doneByStudent = new Map();                      // studentId -> modality
    for (const s of subs) {
      const info = enrInfo.get(s.enrollment_id);
      if (!info) continue;
      const act = activityById.get(s.chosen_activity_id);
      if (act) doneByStudent.set(info.studentId, act.modality);
    }

    // Cadets this lesson's artifact reported a failure for, resolved to roster ids.
    const errStudents = new Set();
    let errUnmatched = 0;
    const rows = interactive ? (errBySlug.get(interactive.activity.slug) || []) : [];
    const claimed = new Set(rows.map(r => (r.cadet_ref || '').trim().toLowerCase()).filter(Boolean));
    for (const c of claimed) {
      const hit = tokenToStudents.get(c);
      if (hit) hit.forEach(id => errStudents.add(id));
      else errUnmatched += 1;
    }

    const tracks = [];
    for (const track of ['M', 'T']) {
      const roster = rosterByCourseTrack.get(a.course_offering_id + '|' + track);
      if (!roster || !roster.size) continue;
      let iprep = 0, prep = 0, errored = 0, missing = 0;
      for (const sid of roster) {
        const mod = doneByStudent.get(sid);
        if (mod === 'interactive') iprep += 1;
        else if (mod === 'written') prep += 1;
        else if (errStudents.has(sid)) errored += 1;
        else missing += 1;
      }
      const enrolled = roster.size;
      tracks.push({
        track, enrolled, iprep, prep, errored, missing,
        done: iprep + prep,
        completion: pct(iprep + prep, enrolled),
        dueAt: a.due_by_day?.[track] || a.due_at || null,
      });
    }

    lessons.push({
      id: a.id,
      slot: a.slot,
      courseCode: courseOf.get(a.course_offering_id) || '—',
      offeringLabel: labelOf.get(a.course_offering_id)?.label ||
                     courseOf.get(a.course_offering_id) || '—',
      // Whether the LAST track has closed. A lesson still open reads 0% and is not a fault;
      // saying so is the difference between a chart and an accusation.
      allClosed: tracks.length > 0 &&
                 tracks.every(t => t.dueAt && Date.parse(t.dueAt) < Date.now()),
      anyOpen: tracks.some(t => !t.dueAt || Date.parse(t.dueAt) >= Date.now()),
      courseOfferingId: a.course_offering_id,
      slug: a.assignments?.slug || '—',
      title: a.assignments?.title || '',
      isPublished: !!a.is_published,
      opensAt: a.opens_at,
      dueAt: a.due_at,
      dueByDay: a.due_by_day,
      hasInteractive: !!interactive,
      hasWritten: !!written,
      interactiveSlug: interactive?.activity?.slug || null,
      artifactUrl: interactive?.activity?.content?.artifact_url || null,
      gradedModalities,
      errorRows: rows.length,
      errorUnmatched: errUnmatched,
      tracks,
    });
  }

  // ── Every lesson in the term, config only ──────────────────────────────────────────
  // The four SETUP checks must not be scoped to the lesson window. Narrowing the window
  // from 8 to 6 made a published iPREP with no artifact link read "clear", which is the
  // worst possible failure for a checklist: a fault silently became a pass. A misconfigured
  // lesson three weeks out is exactly what this page should catch EARLY, so setup is
  // checked across the whole term and only the OUTCOME checks follow the window.
  const allLessons = raw.allAssignments
    .filter(a => offeringId === 'all' || a.course_offering_id === offeringId)
    .map(a => {
      const acts = (a.offering_activities || []).filter(x => x.activities);
      const interactive = acts.find(x => x.activities.modality === 'interactive');
      return {
        courseOfferingId: a.course_offering_id,
        offeringLabel: labelOf.get(a.course_offering_id)?.label ||
                       courseOf.get(a.course_offering_id) || '—',
        slug: a.assignments?.slug || '—',
        isPublished: !!a.is_published,
        dueAt: a.due_at,
        dueByDay: a.due_by_day,
        hasInteractive: !!interactive,
        artifactUrl: interactive?.activities?.content?.artifact_url || null,
        gradedModalities: acts.filter(x => x.grading_role === 'graded')
          .map(x => x.activities.modality),
      };
    });

  // A course has more than one track only if its sections do. That decides whether an empty
  // `due_by_day` is a finding or simply how a single-track course looks.
  const tracksPerCourse = new Map();
  for (const s of raw.sections) {
    const days = s.meeting_days || [];
    if (days.length !== 1) continue;
    if (!tracksPerCourse.has(s.course_offering_id)) tracksPerCourse.set(s.course_offering_id, new Set());
    tracksPerCourse.get(s.course_offering_id).add(days[0]);
  }

  const errorsByKind = {};
  for (const e of raw.errors) errorsByKind[e.kind] = (errorsByKind[e.kind] || 0) + 1;

  return {
    ...raw,
    offeringId,
    offeringLabels,
    lessons,
    allLessons,
    slots: raw.slots || [],
    tracksPerCourse,
    errorsByKind,
    totals: {
      // OFFERINGS, not courses: phys-215 is one course and two active offerings, and calling
      // that "2 courses" is the same conflation the labels above exist to prevent.
      offerings: raw.offerings.length,
      cadets: new Set([...enrInfo.values()]
        .filter(i => offeringId === 'all' || i.courseOfferingId === offeringId)
        .map(i => i.studentId)).size,
      lessonsShown: lessons.length,
      lessonsAll: raw.allAssignments.length,
      errors: raw.errors.length,
      erroredCadets: new Set(raw.errors.map(e => (e.cadet_ref || e.cadet_id || '')).filter(Boolean)).size,
    },
  };
}

/* ── Checks ──────────────────────────────────────────────────────────────────────────────
 * Each entry: what it looks for, how loudly, and — the part that matters — what to DO.
 * `fix` is addressed to the operator and names the actual command or control, because a
 * finding whose remedy has to be re-derived every time gets ignored the third time it fires.
 *
 * `detect` returns [{ where, detail }]; an empty array is a pass.
 */
export const CHECKS = [
  {
    scope: 'term',
    id: 'due-by-day-empty',
    label: 'Lesson has no per-day deadline',
    severity: 'critical',
    why: 'Every section inherits the M-day deadline, so a T-day cadet is due one to four days early — and it looks correct on a spot check, because due_at IS the M-day date.',
    fix: 'Run <code>python scripts/fall2026/set_due_dates.py --course &lt;code&gt;</code>. It is dry-run by default and idempotent, and writes all three storage locations. Check the dates against the syllabus, not just against emptiness — and note that a repair moving any deadline EARLIER is a decision for the course director, not an automatic fix.',
    detect: (m) => m.allLessons.filter(L =>
      (m.tracksPerCourse.get(L.courseOfferingId)?.size || 0) > 1 &&
      (!L.dueByDay || !Object.keys(L.dueByDay).length))
      .map(L => ({ where: `${L.offeringLabel} · ${L.slug}`, detail: 'due_by_day is empty' })),
  },
  {
    scope: 'term',
    id: 'no-graded-fallback',
    label: 'iPREP is the only graded path',
    severity: 'warning',
    why: 'A cadet whose tutor will not start has nowhere to go. This is exactly what happened on lesson 07: completion fell to 49% on the largest cohort, and recovered once a graded PREP was added.',
    fix: 'Open the lesson in <a href="lessons.html">Assignments</a> and add a written PREP path with grading role <em>graded</em>. The two paths can both be graded; a cadet picks one.',
    detect: (m) => m.allLessons.filter(L =>
      L.gradedModalities.includes('interactive') && !L.gradedModalities.includes('written'))
      .map(L => ({ where: `${L.offeringLabel} · ${L.slug}`, detail: 'no graded PREP fallback' })),
  },
  {
    scope: 'term',
    id: 'artifact-url-missing',
    label: 'Published iPREP with no artifact link',
    severity: 'critical',
    why: 'The lesson appears to cadets and the Launch button goes nowhere.',
    fix: 'Open the lesson in <a href="lessons.html">Assignments</a> and paste the published claude.ai URL. If the artifact was republished, its URL moved — the slug does not.',
    detect: (m) => m.allLessons.filter(L => L.isPublished && L.hasInteractive && !L.artifactUrl)
      .map(L => ({ where: `${L.offeringLabel} · ${L.slug}`, detail: 'activities.content.artifact_url is empty' })),
  },
  {
    scope: 'term',
    id: 'unpublished-but-due',
    label: 'Unpublished lesson inside its release window',
    severity: 'warning',
    why: 'Cadets should be able to see it by now and cannot. Publishing is not releasing — a published lesson still only appears in the 7 days before that cadet\'s own deadline.',
    fix: 'Publish it in <a href="lessons.html">Assignments</a>, or push its due date back if it is not meant to run yet.',
    detect: (m) => m.allLessons.filter(L => !L.isPublished && L.dueAt &&
      Date.parse(L.dueAt) - Date.now() < 7 * 86400000)
      .map(L => ({ where: `${L.offeringLabel} · ${L.slug}`, detail: 'not published, due within 7 days' })),
  },
  {
    scope: 'errors',
    id: 'dead-keys',
    label: 'Cadets with a dead Google API key',
    severity: 'critical',
    why: 'Google suspended the account behind the key. Waiting does not clear it and neither does retrying — the cadet is stuck until they make a new one.',
    fix: 'Tell the cadet to create a <strong>brand-new</strong> API key at aistudio.google.com and paste it into the lesson. Re-using the suspended key, or the same Google account\'s other keys, will fail the same way.',
    detect: (m) => {
      const rows = m.errors.filter(e => e.kind === 'suspended' || e.kind === 'deadproject');
      const named = new Set(rows.map(e => (e.cadet_ref || '').trim().toLowerCase()).filter(Boolean));
      const anon = rows.filter(e => !e.cadet_ref).length;
      const out = named.size ? [{ where: `${named.size} named cadet${named.size === 1 ? '' : 's'}`,
                                  detail: `${rows.length} failures in the window` }] : [];
      if (anon) out.push({ where: `${anon} failure${anon === 1 ? '' : 's'} with no name`,
                           detail: 'logged before the cadet typed one' });
      return out;
    },
  },
  {
    scope: 'errors',
    id: 'quota-pressure',
    label: 'Quota refusals are a large share of failures',
    severity: 'warning',
    why: 'Google is turning cadets away for using too much. It clears on its own, but while it lasts a cadet sees the lesson refuse to start.',
    fix: 'Check that the tutor\'s model ladder still steps down to a spare model rather than stopping. If refusals cluster after 7 p.m., tell cadets to start earlier — the evening peak is when the shared quota runs out.',
    detect: (m) => {
      const total = m.errors.length;
      const quota = m.errorsByKind.quota || 0;
      if (!total || quota / total < 0.25) return [];
      return [{ where: `${Math.round(100 * quota / total)}% of failures`,
                detail: `${quota} of ${total} in the last ${m.errorDays} days` }];
    },
  },
  {
    scope: 'window',
    id: 'errored-no-submission',
    label: 'Cadets hit an error and never handed in',
    severity: 'warning',
    why: 'These are the cadets the error log can actually name who have no work recorded for that lesson. They are the ones worth chasing individually.',
    fix: 'Open <a href="tutor-errors.html">Tutor errors</a>, filter to the lesson, and pass the names to the section instructor. A cadet blocked by the tutor should be offered the PREP path or an extension.',
    detect: (m) => m.lessons.flatMap(L => {
      const n = L.tracks.reduce((t, x) => t + x.errored, 0);
      return n ? [{ where: `${L.offeringLabel} · ${L.slug}`,
                    detail: `${n} cadet${n === 1 ? '' : 's'}` }] : [];
    }),
  },
  {
    scope: 'window',
    id: 'low-completion',
    label: 'Closed lesson finished below 80%',
    severity: 'warning',
    why: 'The written PREP baseline for this system is around 90%. A closed cohort well under that is a lesson worth looking at, not a cadet problem.',
    fix: 'Check three things in order: did the track have its own deadline (see the per-day check above), was there a graded PREP fallback, and did the tutor fail for that cohort. <a href="tutor-errors.html">Tutor errors</a> answers the third.',
    detect: (m) => m.lessons.flatMap(L => L.tracks
      .filter(t => t.dueAt && Date.parse(t.dueAt) < Date.now() && t.completion < 80)
      .map(t => ({ where: `${L.offeringLabel} · ${L.slug} · ${t.track}-day`,
                   detail: `${t.completion}% of ${t.enrolled}` }))),
  },
  {
    scope: 'errors',
    id: 'unmatched-error-names',
    label: 'Error reports naming nobody on the roster',
    severity: 'info',
    why: 'The name box takes whatever the cadet types. A first name, a nickname or a typo matches no one, so that failure cannot be followed to a submission.',
    fix: 'Nothing to repair — this is a measurement limit, not a fault. It matters only when reading the "hit an error, nothing in" band, which undercounts by roughly this much.',
    detect: (m) => {
      const n = m.lessons.reduce((t, L) => t + L.errorUnmatched, 0);
      return n ? [{ where: `${n} typed name${n === 1 ? '' : 's'}`, detail: 'no roster match' }] : [];
    },
  },
];

/** Run every check. Returns findings ordered loudest-first, passes kept so the page can
 *  show what was actually verified — a checklist that only ever shows failures reads as
 *  though nothing was checked. */
export function runChecks(model) {
  return CHECKS.map(c => ({ ...c, findings: c.detect(model) || [] }))
    .sort((a, b) => (b.findings.length ? SEVERITY[b.severity] + 1 : -1) -
                    (a.findings.length ? SEVERITY[a.severity] + 1 : -1));
}

/* ── Rendering ───────────────────────────────────────────────────────────────────────────
 * The geometry is lifted from the printed faculty brief this page replaces, because that
 * brief was iterated on until it read correctly and there is no reason to re-derive it:
 * a 134px bar, 38px wide, 13px between the tracks of one lesson and 46px between lessons,
 * a 34px axis column carrying 100/75/50/25/0.
 *
 * ONE ROW PER CLASS. Grouping the other way round — a lesson group holding every course's
 * bars — is what the brief did, and it worked there because there were two courses and four
 * lessons. With four active offerings it becomes thirty-odd groups that wrap onto five
 * ragged rows, and a wrapped row cannot be read as a trend at all. A class per row, lessons
 * running left to right inside it, is the same chart with the axes swapped, and it is the
 * only arrangement where "is this course getting worse?" is answerable by looking.
 */
const BAR_H = 134, BAR_W = 38, GAP_IN = 13, GAP_OUT = 46, AXIS_W = 34;

/** The sub-columns inside one lesson-day cell, in fixed order.
 *
 *  A class that meets on only one of them leaves the other EMPTY rather than centring its
 *  single bar. That was asked for and it is right: phys-310 is a T-day course, so its bars
 *  belong under the T bars of every other row. A site-wide problem on one particular day —
 *  an outage, a bad deploy, a quota wall — then shows up as a column of damage across the
 *  classes, which a centred single bar would break up and hide. */
export const TRACK_ORDER = ['M', 'T'];

/** One normalized stacked column: grey on top, work done at the bottom.
 *  Normalized because the question is "what fraction is in", and the cohorts are different
 *  sizes — an absolute bar would make PHYS 110's T-day look worse purely for being bigger.
 *  The roster size is printed under the bar so the denominator is never hidden.
 *
 *  A band too thin to hold its own number moves that number to a coloured line under the
 *  bar label. At 38px wide a leader line would run straight through the neighbouring bar. */
export function columnHTML(t, key = '') {
  const bands = [
    ['missing', t.missing], ['errored', t.errored],
    ['written', t.prep], ['interactive', t.iprep],
  ].filter(([, v]) => v > 0);

  const hs = bands.map(([, v]) => Math.max(2, (v / t.enrolled) * BAR_H));
  const over = hs.reduce((a, b) => a + b, 0) - BAR_H;
  if (over > 0) {                                  // the 2px floor cannot inflate the total
    let big = 0;
    hs.forEach((h, i) => { if (h > hs[big]) big = i; });
    hs[big] -= over;
  }

  let y = 0, inner = '', outside = '';
  bands.forEach(([key, v], i) => {
    const h = hs[i], b = BAND[key];
    let label = '';
    if (h >= 12) label = `<span class="hh-bandnum">${v}</span>`;
    else if (h >= 7.5) label = `<span class="hh-bandnum sm">${v}</span>`;
    else outside += `<div class="hh-outnum" style="color:${b.colour}">` +
                    `${v} ${esc(b.short)}</div>`;
    inner += `<div class="hh-band${key === 'missing' ? ' pale' : ''}" ` +
             `style="top:${y.toFixed(1)}px;height:${h.toFixed(1)}px;background:${b.colour}` +
             `${i === 0 ? ';border-radius:4px 4px 0 0' : ''}">${label}</div>`;
    y += h;
  });

  // No `title=`: a native tooltip racing the popover below shows two answers at once.
  return `<div class="hh-col" data-k="${esc(key)}" tabindex="0">
    <div class="hh-stack">${inner}</div>
    <div class="hh-collab">
      <div class="hh-track">${esc(t.track)}</div>
      <div class="hh-n">n=${t.enrolled}</div>
      ${outside || '<div class="hh-outnum">&nbsp;</div>'}
    </div>
  </div>`;
}

/** "preflight-07" -> "07"; "lesson-09" -> "09"; anything else is left alone. */
function lessonNumber(slug) {
  const m = /^(?:preflight|lesson)-(.+)$/.exec(slug);
  return (m ? m[1] : slug).toUpperCase();
}

const SHORT_DATE = { month: 'short', day: 'numeric' };

/** The chart: one shared column of teaching-day slots, one row per class.
 *
 *  Every row is drawn against the SAME slot list, so a column means the same week in every
 *  row and a class with no preflight that week leaves a gap. A column is always sized for a
 *  full M/T pair even when a class only meets on one of them — a single-track class centres
 *  its one bar in the pair's width, which is what keeps the columns of different rows in
 *  register. Sizing each row to its own track count would put phys-310's lesson 8 under
 *  phys-110's lesson 10, which is worse than useless. */
export function chartHTML(m) {
  const slots = m.slots || [];
  if (!slots.length) return `<div class="hh-chart"><div class="hh-empty">
    The academic calendar did not load, so there is no shared time axis to draw against.<br>
    Regenerate it with <code>python scripts/calendar/build_academic_calendar.py --commit</code>.
    </div></div>`;

  const rows = m.offeringLabels
    .map(o => ({
      o,
      // slot number -> the one lesson that class ran in that slot
      bySlot: new Map(m.lessons
        .filter(L => L.courseOfferingId === o.id && L.tracks.length && L.slot != null)
        .map(L => [L.slot, L])),
    }))
    .filter(r => r.bySlot.size);

  if (!rows.length) return `<div class="hh-chart"><div class="hh-empty">
    No lessons fall in this stretch of the term.</div></div>`;

  const COL_W = 2 * BAR_W + GAP_IN;           // always a full M/T pair, occupied or not
  const fmt = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString(undefined, SHORT_DATE) : '';

  // The axis is stated ONCE, at the top. Repeating it per row would say four times over
  // that these are different charts, which is exactly what they are not.
  // "Lesson 6", not "M6 · T6". Every bar underneath is already labelled M or T, so the
  // header repeating the split spent the widest line in the column re-stating it.
  const head = slots.map(sl => `<div class="hh-slot" style="flex:0 0 ${COL_W}px">
      <div class="hh-slotn">Lesson ${sl.n}</div>
      <div class="hh-slotd">${esc(fmt(sl.M))}${sl.M && sl.T ? ' &middot; ' : ''}${esc(fmt(sl.T))}</div>
    </div>`).join('');

  const ticks = [[0, '100%'], [0.25, '75%'], [0.5, '50%'], [0.75, '25%'], [1, '0%']]
    .map(([f, v]) => `<div class="hh-tick" style="top:${(BAR_H * f - 5).toFixed(1)}px">${v}</div>`)
    .join('');

  const body = rows.map(({ o, bySlot }) => {
    const cells = slots.map(sl => {
      const L = bySlot.get(sl.n);
      if (!L) return `<div class="hh-cell empty" style="flex:0 0 ${COL_W}px">
        <div class="hh-nolesson">no preflight</div></div>`;

      const paths = [L.hasInteractive ? 'iPREP' : null, L.hasWritten ? 'PREP' : null]
        .filter(Boolean).join(' + ') || 'no path';
      // A lesson still open reads near 0% and is not a fault, so whether it has closed is
      // the one thing the bar cannot say for itself and the one thing printed here. Which
      // PATHS it offered is not printed: the bar is already blue for iPREP and gold for
      // PREP, and spelling it out again needs ~100px in an 89px column, which is what pushed
      // every later column out of the grid. It stays in the hover text.
      const when = L.allClosed ? 'closed' : 'open';
      const due = L.dueAt ? new Date(L.dueAt).toLocaleDateString(undefined, SHORT_DATE) : 'no date';
      const bars = TRACK_ORDER.map(tr => {
        const t = L.tracks.find(x => x.track === tr);
        return t ? columnHTML(t, `${L.id}|${tr}`) : '<div class="hh-col ghost"></div>';
      }).join('');
      return `<div class="hh-cell" style="flex:0 0 ${COL_W}px">
        <div class="hh-lnum">${esc(lessonNumber(L.slug))}</div>
        <div class="hh-lnote">${esc(when)} ${esc(due)}</div>
        <div class="hh-bars">${bars}</div>
      </div>`;
    }).join('');

    const roster = [...bySlot.values()][0].tracks
      .map(t => `${t.enrolled} on ${t.track}`).join(' \u00b7 ');

    return `<div class="hh-row">
      <div class="hh-rowname">${esc(o.label)}<span class="hh-rowsub">${esc(roster)}</span></div>
      <div class="hh-plot"><div class="hh-axis">${ticks}</div>${cells}</div>
    </div>`;
  }).join('');

  const key = Object.values(BAND).map(b =>
    `<span><i style="background:${b.colour}"></i>${esc(b.label)}</span>`).join('');

  return `<div class="hh-chart">
    <div class="hh-scroll">
      <div class="hh-heads"><div class="hh-axispad">lesson day</div>${head}</div>
      ${body}
    </div>
    <div class="hh-legend">${key}</div>
  </div>`;
}

/* ── The popover ─────────────────────────────────────────────────────────────────────────
 * A 38px bar can carry four numbers and nothing else. Everything an operator then wants —
 * the percentages, the exact deadline, which paths the lesson offered, how many tutor
 * failures it logged — has to arrive on demand or not at all.
 *
 * Hover shows it; CLICKING PINS IT. Pinning matters more than it looks: the numbers here are
 * read in order to be acted on (copied into a message, compared against the next column),
 * and a panel that vanishes the moment the pointer leaves the bar cannot be read that way.
 * A pinned panel also survives the pointer travelling to its own close button.
 */

/** Every stat the popover shows, for one bar. Pure — the page renders it. */
export function barStats(m, L, t) {
  const done = t.iprep + t.prep;
  const share = (v) => (t.enrolled ? Math.round((v / t.enrolled) * 100) : 0);
  return {
    offering: L.offeringLabel,
    slug: L.slug,
    slot: L.slot,
    track: t.track,
    enrolled: t.enrolled,
    rows: [
      { key: 'interactive', v: t.iprep,   pctv: share(t.iprep) },
      { key: 'written',     v: t.prep,    pctv: share(t.prep) },
      { key: 'errored',     v: t.errored, pctv: share(t.errored) },
      { key: 'missing',     v: t.missing, pctv: share(t.missing) },
    ],
    done, donePct: pct(done, t.enrolled),
    dueAt: t.dueAt,
    closed: !!(t.dueAt && Date.parse(t.dueAt) < Date.now()),
    paths: [L.hasInteractive ? 'iPREP' : null, L.hasWritten ? 'PREP' : null]
      .filter(Boolean).join(' + ') || 'no path',
    graded: (L.gradedModalities || []).map(x => MODALITY_LABEL[x] || x).join(' + ') || 'none',
    errorRows: L.errorRows,
  };
}

const LONG_DATE = { weekday: 'short', month: 'short', day: 'numeric',
                    hour: 'numeric', minute: '2-digit' };

/** The popover's inner HTML for one bar. */
export function popoverHTML(st) {
  const line = (r) => {
    const b = BAND[r.key];
    return `<div class="hh-prow${r.v ? '' : ' zero'}">
      <span class="hh-pkey"><i style="background:${b.colour}"></i>${esc(b.label)}</span>
      <span class="hh-pv">${r.v}</span><span class="hh-pp">${r.pctv}%</span></div>`;
  };
  const due = st.dueAt
    ? new Date(st.dueAt).toLocaleString(undefined, LONG_DATE)
    : 'no deadline set';
  return `
    <div class="hh-phead">
      <div class="hh-ptitle">Lesson ${st.slot} &middot; ${esc(st.track)}-day</div>
      <div class="hh-psub">${esc(st.offering)} &middot; ${esc(st.slug)}</div>
      <button class="hh-pclose" data-close aria-label="Close">&times;</button>
    </div>
    <div class="hh-pbody">
      ${st.rows.map(line).join('')}
      <div class="hh-prow total"><span class="hh-pkey">Handed in</span>
        <span class="hh-pv">${st.done}</span><span class="hh-pp">${st.donePct}%</span></div>
      <div class="hh-prow"><span class="hh-pkey">Roster</span>
        <span class="hh-pv">${st.enrolled}</span><span class="hh-pp"></span></div>
    </div>
    <div class="hh-pfoot">
      <div><span>Deadline</span><b>${st.closed ? 'closed' : 'due'} ${esc(due)}</b></div>
      <div><span>Paths offered</span><b>${esc(st.paths)}</b></div>
      <div><span>Graded path</span><b>${esc(st.graded)}</b></div>
      <div><span>Tutor failures, this lesson</span><b>${st.errorRows}</b></div>
    </div>`;
}

/** key -> popover HTML, for every bar the chart drew. Built once per render. */
export function popoverIndex(m) {
  const out = new Map();
  for (const L of m.lessons) {
    for (const t of L.tracks) out.set(`${L.id}|${t.track}`, popoverHTML(barStats(m, L, t)));
  }
  return out;
}

/** The geometry, for the page's stylesheet — one source of truth for both. */
export const CHART_METRICS = { BAR_H, BAR_W, GAP_IN, GAP_OUT, AXIS_W };
