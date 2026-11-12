// tutorials-catalog.js -- the list of tutorials. Data only: no DOM, no network, nothing runs at import.
//
// The engine that runs them is tutorials.js. The rules for adding one are in docs/decisions/TUTORIALS.md.
//
// TWO KINDS
//   tour  Shows a person around. It can start by itself (the welcome tour on a first sign-in, a page
//         tour on the first visit to a main page) and it ends after its last step or when left.
//   task  Walks a person through a real job, such as making a course. It starts only by hand, from
//         Help, and it ends when the real thing exists. The guide never makes the thing: the person
//         clicks the page's own buttons, under their own permissions.
//
// A STEP: { page, tab?, target, title, text, advance, optional?, absent?, entry?, fail? }
//   page      the path ending the step lives on ('faculty/terms.html'), or null for any page
//   tab       for faculty/admin.html: the sub-tab that must be showing
//   target    a CSS selector, or a list of them (the first one that is visible wins), or null for a
//             step about the whole page. Resolved fresh every time: these pages re-render whole sections.
//   advance   'next'                    an info step; the card has a Next button
//             { click: sel }            moves on when the person clicks that element
//             { input: sel }            Next is enabled once that field has a value
//             { until: sel }            moves on when that selector appears (a new element, not one that
//                                       was already there when the step began)
//             { gone: sel }             moves on when nothing visible matches that selector
//             { page: path }            moves on when the person arrives on that page
//   fail      a selector whose visible text is an error to show on the card while the step waits
//   optional  skip the step if its target has not appeared in 8 seconds. A plain 'next' step is not
//             skipped: after a moment it is shown without a highlight, with `absent` (or a stock note)
//   absent    for an optional 'next' step: one sentence saying why the thing is not on the page yet
//   entry     a task may begin at this step when the person is already on its page

/** Bump this when a new feature gets a tutorial, so it shows once to people who turned tutorials off. */
export const TUTORIAL_RELEASE = '2026-11-10';

export const TIERS = ['student', 'instructor', 'director', 'admin'];
export const KINDS = ['tour', 'task'];

/** The page names the card uses when it asks a person to go somewhere. */
export const PAGE_NAMES = {
  'faculty/dashboard.html': 'Dashboard',
  'faculty/items.html': 'Assignments',
  'faculty/gradebook.html': 'Gradebook',
  'faculty/admin.html': 'Admin',
  'faculty/grade.html': 'Grade',
  'faculty/report.html': 'Report',
  'faculty/terms.html': 'Courses and terms',
  'student/summary.html': 'All classes',
};

const SINCE = TUTORIAL_RELEASE;
const BAR = ['#nav-links', '[data-burger]'];            // the top bar, or the menu button it folds into
const COURSE = ['.course-btn', '.brand-sub'];

export const TUTORIALS = [
  /* ── Tours ─────────────────────────────────────────────────────────────── */
  {
    id: 'welcome-staff', kind: 'tour', tier: 'instructor', since: SINCE, version: 1,
    title: 'Welcome tour for staff',
    summary: 'The top bar, the dashboard sections, the course menu and your account menu.',
    auto: { page: 'faculty/dashboard.html' },
    steps: [
      { page: 'faculty/dashboard.html', target: null, title: 'Welcome to PREP',
        text: 'This takes about a minute. It shows you where things are. You can leave it at any time.', advance: 'next' },
      { page: 'faculty/dashboard.html', target: BAR, title: 'The top bar',
        text: 'Dashboard is this page. Gradebook shows every cadet and every column. Assignments lists the work and opens grading. Admin, for directors, holds the roster and staff.', advance: 'next' },
      { page: 'faculty/dashboard.html', target: '#dashBacklog', optional: true, title: 'Backlog',
        text: 'What is waiting on you, across your sections. It is the quickest way to find grading that needs a person.', advance: 'next',
        absent: 'It appears on this page once the course has published assignments.' },
      { page: 'faculty/dashboard.html', target: '#dashReports', optional: true, title: 'Recent reports',
        text: 'The newest assignment reports. Open one to see how the class did and what to teach next.', advance: 'next',
        absent: 'It appears on this page once the course has published assignments.' },
      { page: 'faculty/dashboard.html', target: COURSE, optional: true, title: 'The course menu',
        text: 'The course you are looking at. If you work in more than one course or term, this is where you switch.', advance: 'next' },
      { page: 'faculty/dashboard.html', target: '[data-user-toggle]', title: 'Your menu',
        text: 'Account, Help and Tutorials are in here. Tutorials lists every guide, including walk-throughs for real jobs such as adding an assignment.', advance: 'next' },
      { page: 'faculty/dashboard.html', target: null, title: 'Turning these off',
        text: 'Automatic tutorials can be switched off from the link on any tour card, or under Account, Automatic tutorials. Every tutorial stays available from Help whenever you want it.', advance: 'next' },
    ],
  },
  {
    id: 'welcome-student', kind: 'tour', tier: 'student', since: SINCE, version: 1,
    title: 'Welcome tour for cadets',
    summary: 'All classes, what is due next, the top bar and the Help page.',
    auto: { page: 'student/summary.html' },
    steps: [
      { page: 'student/summary.html', target: null, title: 'Welcome to PREP',
        text: 'This takes about a minute. It shows you where things are. You can leave it at any time.', advance: 'next' },
      { page: 'student/summary.html', target: '[data-group="classes"]', optional: true, title: 'All classes',
        text: 'This page lists every class you are in. Open a class to see only its work.', advance: 'next',
        absent: 'Your classes appear here once you are enrolled.' },
      { page: 'student/summary.html', target: '.list-item', optional: true, title: 'What is due next',
        text: 'Work due soonest is listed first. Click a row to open that assignment.', advance: 'next',
        absent: 'Nothing is due right now. Work appears here in the week before it is due.' },
      { page: 'student/summary.html', target: BAR, title: 'The top bar',
        text: 'Assignments, Schedule and My grades are here. All classes brings you back to this page.', advance: 'next' },
      { page: 'student/summary.html', target: '[data-user-toggle]', title: 'Your menu',
        text: 'Account, Help and Tutorials are in here. Help explains how AI is used on your work.', advance: 'next' },
      { page: 'student/summary.html', target: null, title: 'Turning these off',
        text: 'Automatic tutorials can be switched off from the link on any tour card, or under Account, Automatic tutorials. Every tutorial stays available from Help.', advance: 'next' },
    ],
  },
  {
    id: 'tour-assignments', kind: 'tour', tier: 'instructor', since: SINCE, version: 1,
    title: 'The Assignments page',
    summary: 'The table, the icon buttons on each row, and where grading starts.',
    auto: { page: 'faculty/items.html' },
    steps: [
      { page: 'faculty/items.html', target: '#items-table', optional: true, title: 'Everything graded in this course',
        text: 'One row for each assignment: its kind, how cadets do it, how it is graded, its points and its dates.', advance: 'next',
        absent: 'This course has no assignments yet. The table appears with the first one.' },
      { page: 'faculty/items.html', target: '#items-table tr[data-item] td:last-child', optional: true, title: 'The row buttons',
        text: 'Hold the pointer over an icon to read what it does. Grade opens grading for that assignment, and Report shows how the class did.', advance: 'next',
        absent: 'Each assignment row has these buttons. This course has no rows yet.' },
      { page: 'faculty/items.html', target: '#new-btn', optional: true, title: 'New assignment',
        text: 'Directors make a new assignment here. It is saved unpublished, and cadets cannot see it until you publish it.', advance: 'next',
        absent: 'Only a director of this course sees this button.' },
      { page: 'faculty/items.html', target: '#grade-assignments-btn', optional: true, title: 'Grade assignments',
        text: 'Scores that are typed or imported open here. Work that a person reads answer by answer opens the Grade page.', advance: 'next',
        absent: 'This button appears once the course has assignments to grade.' },
    ],
  },
  {
    id: 'tour-gradebook', kind: 'tour', tier: 'instructor', since: SINCE, version: 1,
    title: 'The Gradebook',
    summary: 'Every cadet and every column, and how a column heading opens its report.',
    auto: { page: 'faculty/gradebook.html' },
    steps: [
      { page: 'faculty/gradebook.html', target: 'table.gb', optional: true, title: 'The gradebook',
        text: 'One row for each cadet and one column for each assignment, with the total at the right.', advance: 'next',
        absent: 'The table appears once the course has cadets.' },
      { page: 'faculty/gradebook.html', target: 'th.gb-col', optional: true, title: 'A column heading',
        text: 'Click a column heading to open that assignment\'s class report.', advance: 'next',
        absent: 'Columns appear once the course has published assignments.' },
    ],
  },
  {
    id: 'tour-admin', kind: 'tour', tier: 'director', since: SINCE, version: 1,
    title: 'Course administration',
    summary: 'The tabs: Students, Staff, Extensions and Export.',
    auto: { page: 'faculty/admin.html' },
    steps: [
      { page: 'faculty/admin.html', target: '.subtabs', title: 'The tabs',
        text: 'Students holds the roster and its import. Staff holds who runs the course and which sections each person grades. Extensions and Export are here too.', advance: 'next' },
      { page: 'faculty/admin.html', target: '#panel > :first-child', title: 'The work happens here',
        text: 'The tab you pick fills the area below it. Nothing is written until you press a button that says so.', advance: 'next' },
    ],
  },
  {
    id: 'tour-grade', kind: 'tour', tier: 'instructor', since: SINCE, version: 1,
    title: 'The Grade page',
    summary: 'Cards, the three colors, and finalizing.',
    auto: { page: 'faculty/grade.html' },
    steps: [
      { page: 'faculty/grade.html', target: '#asgn', title: 'Pick the assignment',
        text: 'Choose the assignment to grade, and the section.', advance: 'next' },
      { page: 'faculty/grade.html', target: '#lamps', title: 'The three colors',
        text: 'Green is full credit. Yellow is full credit that was flagged for a look. Red is no credit. The lamps filter the answers by color.', advance: 'next' },
      { page: 'faculty/grade.html', target: '.grade-card', optional: true, title: 'A card for each cadet',
        text: 'Each card holds one cadet\'s answers. Click a credit chip to change it.', advance: 'next' },
      { page: 'faculty/grade.html', target: '#grade-actions', optional: true, title: 'Save and finalize',
        text: 'Save draft keeps your changes. Finalize and publish makes the grades final for every card on screen, so do it when you have looked at them all.', advance: 'next' },
    ],
  },

  /* ── Tasks ─────────────────────────────────────────────────────────────── */
  {
    id: 'task-create-course', kind: 'task', tier: 'director', since: SINCE, version: 1,
    title: 'Create a new course',
    summary: 'Make a course for a term with the setup form. A site administrator does this step.',
    steps: [
      { page: null, target: '[data-user-toggle]', title: 'Open your menu',
        text: 'Click your name to open the menu.', advance: { click: '[data-user-toggle]' } },
      { page: null, target: ['#user-menu-pop a[href="terms.html"]', '[data-user-toggle]'], title: 'Courses and terms',
        text: 'Click Courses and terms. If the menu closed, open it again.', advance: { click: '#user-menu-pop a[href="terms.html"]' } },
      { page: 'faculty/terms.html', entry: true, target: '#sec-setup', title: 'The setup form',
        text: 'This one form makes a course for a term. Nothing is made until you press the last button.', advance: 'next' },
      { page: 'faculty/terms.html', target: '#su-cm-new', title: 'Make a new course',
        text: 'Choose Make a new course.', advance: { click: '#su-cm-new' } },
      { page: 'faculty/terms.html', target: '#su-ccode', title: 'The course code',
        text: 'Type a short code, with lowercase letters, numbers and hyphens, then press Next.', advance: { input: '#su-ccode' } },
      { page: 'faculty/terms.html', target: '#su-ctitle', title: 'The course title',
        text: 'Type the title cadets will see, then press Next.', advance: { input: '#su-ctitle' } },
      { page: 'faculty/terms.html', target: '#su-cdept', title: 'Department',
        text: 'The department is optional. Under More options you can change the days the course meets.', advance: 'next' },
      { page: 'faculty/terms.html', target: ['#su-term-existing', '#su-term-new'], title: 'The term',
        text: 'Pick a term that already exists, or choose Make a new term and fill in its name and dates.', advance: 'next' },
      { page: 'faculty/terms.html', target: '#su-director', title: 'Who directs it',
        text: 'Choose the director. You can leave this for later and add one from the Staff tab.', advance: 'next' },
      { page: 'faculty/terms.html', target: '#su-go', title: 'Set it up',
        text: 'Press Set up this course.', advance: { click: '#su-go' } },
      { page: 'faculty/terms.html', target: '#sec-setup', title: 'Making the course',
        text: 'Working on it.', advance: { until: '#setup-done' }, fail: '#setup-error' },
      { page: 'faculty/terms.html', target: 'section.checklist ol.cl-steps', optional: true, title: 'The checklist',
        text: 'A checklist appears for the new course: the roster, the assignments, the letter scale, and making it active. Each button takes you to that step.', advance: 'next' },
      { page: 'faculty/terms.html', target: null, title: 'Your course exists',
        text: 'Your course exists. It is not active yet, so cadets cannot see it.', advance: 'next' },
    ],
    stepsNonAdmin: [
      { page: null, target: null, title: 'Who makes a course',
        text: 'A site administrator makes new courses, so there is no form for you to fill in. Your own course already exists, and this page shows its checklist.', advance: 'next' },
      { page: 'faculty/terms.html', entry: true, target: 'section.checklist', optional: true, title: 'Your course checklist',
        text: 'Each course you direct has a checklist: the roster, the assignments, the letter scale, and a site administrator making it active.', advance: 'next' },
      { page: 'faculty/terms.html', target: null, title: 'Next steps',
        text: 'The other tutorials in Help walk you through the roster and the assignments.', advance: 'next' },
    ],
  },
  {
    id: 'task-add-students', kind: 'task', tier: 'director', since: SINCE, version: 1,
    title: 'Add students to a course',
    summary: 'Import the registrar\'s roster, check the preview, and commit it.',
    steps: [
      { page: 'faculty/admin.html', tab: 'students', entry: true, target: '#imp > summary', title: 'The import box',
        text: 'This box imports the registrar\'s roster. Open it if it is closed.', advance: 'next' },
      { page: 'faculty/admin.html', tab: 'students', target: '#dropzone', title: 'Bring in the rows',
        text: 'Drop the registrar\'s file here or choose it. You can also open Or paste the rows here, paste them, and press Check these rows. Nothing is saved yet.', advance: { until: '#csv-commit' } },
      { page: 'faculty/admin.html', tab: 'students', target: '#csv-preview', title: 'Read the preview',
        text: 'The list sorts every row by what you can do about it: sections to create, rows that stay out, and changes to people already enrolled. Read it before you go on.', advance: 'next' },
      { page: 'faculty/admin.html', tab: 'students', target: '#csv-commit', title: 'Import',
        text: 'Press the Import button when the preview looks right.', advance: { click: '#csv-commit' } },
      { page: 'faculty/admin.html', tab: 'students', target: '#panel', title: 'Done',
        text: 'The import runs, then PREP makes sign-in accounts for the new cadets and the line under the roster says how many were added.', advance: 'next' },
    ],
  },
  {
    id: 'task-add-assignment', kind: 'task', tier: 'director', since: SINCE, version: 1,
    title: 'Add an assignment',
    summary: 'Make an assignment and choose how cadets do it. It is saved unpublished.',
    steps: [
      { page: 'faculty/items.html', entry: true, target: '#new-btn', title: 'New assignment',
        text: 'Click New assignment.', advance: { click: '#new-btn' } },
      { page: 'faculty/items.html', target: '#i-title', title: 'The title',
        text: 'Type a title, then press Next.', advance: { input: '#i-title' } },
      { page: 'faculty/items.html', target: '#i-kind', title: 'The kind',
        text: 'The kind is a label and a report group. It also decides which choices the next card offers.', advance: 'next' },
      { page: 'faculty/items.html', target: '#i-points', title: 'Points',
        text: 'Type how many points it is worth, then press Next.', advance: { input: '#i-points' } },
      { page: 'faculty/items.html', target: '#i-alldate', title: 'The due date',
        text: 'Pick the due date, or leave it empty for no deadline. Then press Next.', advance: 'next' },
      { page: 'faculty/items.html', target: '#i-cards', title: 'How cadets do this work',
        text: 'Pick one card. It sets how cadets do the work and how it is graded.', advance: { click: '#i-cards [data-mode]' } },
      { page: 'faculty/items.html', target: '#im-save', title: 'Save it',
        text: 'Press Save assignment. It is saved unpublished.', advance: { click: '#im-save' } },
      { page: 'faculty/items.html', target: '#i-setup', title: 'Saving',
        text: 'Working on it.', advance: { until: '#im-note' }, fail: '#im-error' },
      { page: 'faculty/items.html', target: '#i-publish', title: 'Not published yet',
        text: 'Your assignment is saved and is in the table. Cadets cannot see it until you tick Published and save. This guide stops here so that you choose when.', advance: 'next' },
    ],
  },
  {
    id: 'task-add-staff', kind: 'task', tier: 'director', since: SINCE, version: 1,
    title: 'Add a staff member',
    summary: 'Add an instructor or a director to this course.',
    steps: [
      { page: 'faculty/admin.html', tab: 'staff', entry: true, target: '#add-btn', title: 'Add staff',
        text: 'Click Add staff.', advance: { click: '#add-btn' } },
      { page: 'faculty/admin.html', tab: 'staff', target: '#ax-search', title: 'Who',
        text: 'Tick the people who already have a PREP login. For somebody new, use Create a new staff account below it.', advance: 'next' },
      { page: 'faculty/admin.html', tab: 'staff', target: '#ax-role', title: 'Their role',
        text: 'An instructor grades their own sections. A director runs the whole course.', advance: 'next' },
      { page: 'faculty/admin.html', tab: 'staff', target: '#mk-ok', title: 'Add them',
        text: 'Press Add to offering.', advance: { click: '#mk-ok' } },
      { page: 'faculty/admin.html', tab: 'staff', target: '#mk-ok', title: 'Adding',
        text: 'Working on it.', advance: { gone: '#mk-modal.open' }, fail: '#mk-error' },
      { page: 'faculty/admin.html', tab: 'staff', target: '.staff-tbl', optional: true, title: 'Added',
        text: 'They are in the table now, and the line under it names them. Which sections each person grades is set on the grid below.', advance: 'next' },
    ],
  },
  {
    id: 'task-grade', kind: 'task', tier: 'instructor', since: SINCE, version: 1,
    title: 'Grade an assignment',
    summary: 'Open an assignment, mark an answer and save a draft.',
    steps: [
      { page: 'faculty/items.html', entry: true, target: 'a[href^="grade.html?a="]', title: 'Open grading',
        text: 'Click the Grade icon on the assignment you want to grade.', advance: { click: 'a[href^="grade.html?a="]' } },
      { page: 'faculty/grade.html', target: '#asgn', title: 'The assignment',
        text: 'This is the assignment, and the section is beside it. Change either to grade something else.', advance: 'next' },
      { page: 'faculty/grade.html', target: '.grade-card', optional: true, title: 'A card for each cadet',
        text: 'Each card holds one cadet\'s answers. A card whose grade is already published is locked.', advance: 'next' },
      { page: 'faculty/grade.html', target: '.grade-card [data-act="toggle"]', optional: true, title: 'Mark an answer',
        text: 'Click a credit chip to cycle it: full credit, flagged, or none.', advance: { click: '.grade-card [data-act="toggle"]' } },
      { page: 'faculty/grade.html', target: '#save-btn', optional: true, title: 'Save a draft',
        text: 'Press Save draft to keep what you have marked. Cadets do not see it yet.', advance: { click: '#save-btn' } },
      { page: 'faculty/grade.html', target: '#finalize-btn', optional: true, title: 'Finalize when you are ready',
        text: 'Finalize and publish makes every card on screen final and shows it to cadets. This guide stops before it, so that you decide when.', advance: 'next' },
    ],
  },
  {
    id: 'task-open-report', kind: 'task', tier: 'instructor', since: SINCE, version: 1,
    title: 'Open a class report',
    summary: 'From the dashboard to how the class did on an assignment.',
    steps: [
      { page: 'faculty/dashboard.html', entry: true, target: '#dashReports a[href^="report.html?i="]', title: 'Recent reports',
        text: 'Click Open report on any row.', advance: { click: '#dashReports a[href^="report.html?i="]' } },
      { page: 'faculty/report.html', target: null, title: 'The class report',
        text: 'This is how the class did: the readiness summary, the common misunderstandings, and a suggestion for what to teach next.', advance: 'next' },
    ],
  },
  {
    id: 'task-start-assignment', kind: 'task', tier: 'student', since: SINCE, version: 1,
    title: 'Start an assignment',
    summary: 'From All classes to opening the next piece of work.',
    steps: [
      { page: 'student/summary.html', entry: true, target: '.list-item', title: 'Your next assignment',
        text: 'Work due soonest is first. Click a row to open it.', advance: { click: '.list-item' } },
      { page: null, target: null, title: 'You are in',
        text: 'Read what it asks, do the work, and submit it. If you get stuck on the page, Help explains how AI is used on your work.', advance: 'next' },
    ],
  },
];

/** The steps this person runs: a task may have a shorter path for someone who is not a site administrator. */
export function stepsFor(t, ctx) {
  const admin = !!ctx?.instructorRow?.is_global_admin;
  return !admin && Array.isArray(t.stepsNonAdmin) ? t.stepsNonAdmin : t.steps;
}

export const tierRank = (tier) => TIERS.indexOf(tier);

/** The tutorials a viewer of this tier may see: their own tier and everything below it, as with help topics. */
export function tutorialsForTier(tier, list = TUTORIALS) {
  const mine = tierRank(tier);
  // Cumulative among staff tiers. Cadet tutorials run on cadet pages, which send a staff member back to their own
  // dashboard (auth.js), so a staff list never offers one, and a cadet sees only cadet tutorials.
  const floor = mine > tierRank('student') ? tierRank('instructor') : tierRank('student');
  return list.filter(t => { const r = tierRank(t.tier); return r >= floor && r <= mine; });
}

export const tutorialById = (id, list = TUTORIALS) => list.find(t => t.id === id) || null;

/** Problems with a catalog, as sentences. Empty means it is sound. */
export function validateCatalog(list = TUTORIALS) {
  const bad = [];
  const ids = new Set();
  const advanceKinds = ['click', 'input', 'until', 'gone', 'page'];
  const checkSteps = (t, steps, label) => {
    if (!Array.isArray(steps) || !steps.length) { bad.push(`${t.id}: ${label} is empty`); return; }
    steps.forEach((s, i) => {
      const at = `${t.id} ${label}[${i}]`;
      if (!('page' in s)) bad.push(`${at}: no page (use null for any page)`);
      if (s.page != null && !PAGE_NAMES[s.page]) bad.push(`${at}: page ${s.page} has no name in PAGE_NAMES`);
      if (!('target' in s)) bad.push(`${at}: no target (use null for a whole-page step)`);
      if (!s.title || !s.text) bad.push(`${at}: missing title or text`);
      const a = s.advance;
      if (a !== 'next') {
        if (!a || typeof a !== 'object') bad.push(`${at}: advance must be 'next' or an object`);
        else {
          const keys = Object.keys(a).filter(k => advanceKinds.includes(k));
          if (keys.length !== 1) bad.push(`${at}: advance needs exactly one of ${advanceKinds.join(', ')}`);
          else if (typeof a[keys[0]] !== 'string' || !a[keys[0]]) bad.push(`${at}: advance.${keys[0]} must be a selector or a path`);
        }
      }
      if (s.target == null && a && typeof a === 'object' && (a.click || a.input)) bad.push(`${at}: a click or input step needs a target to show`);
    });
  };
  for (const t of list) {
    if (!t.id || ids.has(t.id)) bad.push(`duplicate or missing id: ${t.id}`);
    ids.add(t.id);
    if (!KINDS.includes(t.kind)) bad.push(`${t.id}: kind ${t.kind} is not one of ${KINDS.join(', ')}`);
    if (!TIERS.includes(t.tier)) bad.push(`${t.id}: tier ${t.tier} is not one of ${TIERS.join(', ')}`);
    if (!t.title || !t.summary) bad.push(`${t.id}: missing title or summary`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.since || '')) bad.push(`${t.id}: since must be a date`);
    else if (t.since > TUTORIAL_RELEASE) bad.push(`${t.id}: since is after TUTORIAL_RELEASE`);
    if (!Number.isInteger(t.version) || t.version < 1) bad.push(`${t.id}: version must be a whole number from 1`);
    if (t.auto && t.kind !== 'tour') bad.push(`${t.id}: only a tour may start by itself`);
    if (t.auto && !PAGE_NAMES[t.auto.page]) bad.push(`${t.id}: auto page ${t.auto?.page} has no name in PAGE_NAMES`);
    checkSteps(t, t.steps, 'steps');
    if (t.stepsNonAdmin) checkSteps(t, t.stepsNonAdmin, 'stepsNonAdmin');
    if (t.kind === 'task' && !t.steps?.some(s => s.entry) && t.steps?.[0]?.page != null) bad.push(`${t.id}: a task starting on a page should mark an entry step`);
  }
  return bad;
}

/** Every selector the catalog names (targets, advance and fail), with where it came from. For the static check in the offline test. */
export function catalogSelectors(list = TUTORIALS) {
  const out = [];
  for (const t of list) {
    for (const [label, steps] of [['steps', t.steps], ['stepsNonAdmin', t.stepsNonAdmin || []]]) {
      steps.forEach((s, i) => {
        const add = (sel) => out.push({ id: t.id, at: `${label}[${i}]`, page: s.page, selector: sel });
        for (const sel of [].concat(s.target || [])) add(sel);
        if (s.advance && typeof s.advance === 'object') for (const k of ['click', 'input', 'until', 'gone']) if (s.advance[k]) add(s.advance[k]);
        if (s.fail) add(s.fail);
      });
    }
  }
  return out;
}
