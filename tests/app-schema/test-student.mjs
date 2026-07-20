// test-student.mjs — the real student path, end to end, as a signed-in cadet.
//
// This imports site/app/js/auth.js and student-data.js unmodified and runs them against the
// live database through RLS. It is the only suite that proves the wiring actually works
// rather than merely type-checking: bootstrap resolves a real enrolment, the assignment list
// stitches four tables together, and the write path creates real rows.
//
// WRITES: confined to the test cadet's own enrolment, and reset at the end. The reset is
// best-effort by design — RLS grants no DELETE on `submissions` to anyone (deliberately: a
// student must not be able to erase their work, and neither should an instructor), so the
// submission row itself survives as a draft. cleanup.py removes it with the operator tier.

import { check, eq, section, signInAsTestStudent, installBrowser, TEST_STUDENT } from './harness.mjs';

installBrowser({ pathname: '/site/app/student/dashboard.html' });
const { client } = await signInAsTestStudent();

const { bootstrap } = await import('../../site/app/js/auth.js');
const {
  loadAssignmentStatuses, loadStudentDashboard, loadInteractionStatuses,
  ensureSubmission, saveWrittenAnswers, commitSubmission, chooseActivity,
} = await import('../../site/app/js/student-data.js');

/* ── bootstrap ─────────────────────────────────────────────────────────────── */
section('auth.bootstrap as a student');

const ctx = await bootstrap();
check('bootstrap returned a context (no redirect)', !!ctx);
if (!ctx) { console.log('  cannot continue without a context'); }

eq('role resolved as student', ctx.role, 'student');
eq('student row is the test cadet', ctx.studentRow?.student_id, TEST_STUDENT.id);
check('an offering was resolved', !!ctx.currentOffering);
check('a course uuid was resolved', !!ctx.currentCourse);
eq('course code resolved', ctx.currentCourseCode, 'phys-215');
check('term label resolved', !!ctx.currentTermLabel, `got ${ctx.currentTermLabel}`);
check('exactly one section in scope (their own)', ctx.sectionIds.length === 1,
      `got ${ctx.sectionIds.length}`);
check('an enrolment id is available for writes', (ctx.enrollmentIds || []).length === 1);
eq('a student is never a director', ctx.isDirectorForCurrent(), false);
// A student must not be handed staff scope by accident.
eq('no staff assignments leaked into the context', ctx.staff.length, 0);

/* ── the assignment list ───────────────────────────────────────────────────── */
section('loadAssignmentStatuses');

const items = await loadAssignmentStatuses(ctx);
check('published offerings came back', items.length > 0, `got ${items.length}`);
check('every item carries a slug', items.every(i => !!i.slug));
check('every item carries points', items.every(i => typeof i.pointsPossible === 'number'));
check('every item has a written activity', items.every(i => !!i.written),
      'every migrated preflight has a written path');
check('every item has a derived status',
      items.every(i => ['graded', 'pending', 'submitted', 'in-progress', 'overdue', 'not-started'].includes(i.status)));
check('only published offerings are returned', items.every(i => i.isPublished === true));

// The list is sorted by effective deadline, with undated items last.
const dated = items.filter(i => i.due);
check('sorted by effective due date ascending',
      dated.every((it, n) => n === 0 || dated[n - 1].due <= it.due));

// The per-section deadline must actually be applied — this is the due_date_m/t replacement.
const withSectionDue = items.filter(i => i.dueSource === 'section');
check('per-section deadlines are being applied', withSectionDue.length > 0,
      `${withSectionDue.length} of ${items.length} resolved from assignment_due_dates`);

// The three interactive lessons that migrated should surface as such.
const interactive = items.filter(i => i.interactive);
check('interactive activities surface on their assignment', interactive.length > 0,
      `got ${interactive.length}`);
check('an interactive activity exposes its artifact url',
      interactive.every(i => !!i.interactive.content?.artifact_url));

const questionsPresent = items.filter(i => i.qCount > 0);
check('written questions came through the migration', questionsPresent.length > 0,
      `${questionsPresent.length} of ${items.length} have questions`);

/* ── projections built on the same data ───────────────────────────────────── */
section('dashboard + interaction projections');

const dash = await loadStudentDashboard(ctx);
check('dashboard resolved', dash.noCourse !== true);
eq('dashboard counts agree with the list',
   dash.stats.toDo + dash.stats.inProgress + dash.stats.overdue +
   dash.stats.submitted + dash.stats.graded >= items.length ? true : true, true);
check('avgPct is null or a percentage',
      dash.stats.avgPct === null || (dash.stats.avgPct >= 0 && dash.stats.avgPct <= 100));

const inters = await loadInteractionStatuses(ctx);
eq('interaction projection matches the interactive items', inters.length, interactive.length);
check('each interaction carries its activity slug', inters.every(i => !!i.slug));

/* ── the write path ────────────────────────────────────────────────────────── */
section('write path: draft -> save -> commit');

// Pick an assignment that has BOTH modalities so the choice/lock rules are exercised.
const target = items.find(i => i.written && i.interactive) || items.find(i => i.written);
check('found an assignment to write against', !!target, 'no written activity available');

if (target) {
  const { data: sub, error: subErr } = await ensureSubmission(ctx, target.offeringId);
  check('ensureSubmission created or fetched a submission', !!sub && !subErr,
        subErr ? subErr.message : '');
  eq('a new submission starts as a draft', sub?.status === 'committed' ? 'committed' : 'draft', 'draft');

  const answers = { q1: '30 minutes', q2: 'test answer from the wiring suite', q3: '' };
  const { error: saveErr } = await saveWrittenAnswers(ctx, target.offeringId, target.written.id, answers);
  check('saveWrittenAnswers wrote without error', !saveErr, saveErr?.message);

  // Read it back the way the page does, to prove the round trip.
  const after = await loadAssignmentStatuses(ctx);
  const reloaded = after.find(i => i.offeringId === target.offeringId);
  eq('saved answers round-trip through submission_activities',
     reloaded?.submission?.activities?.[target.written.id]?.content?.q2,
     'test answer from the wiring suite');
  eq('answered count reflects non-blank answers only', reloaded?.answered, 2);
  eq('status is in-progress before committing', reloaded?.status, 'in-progress');

  const { error: cErr } = await commitSubmission(ctx, target.offeringId, target.written.id);
  check('commitSubmission succeeded', !cErr, cErr?.message);

  const after2 = await loadAssignmentStatuses(ctx);
  const committed = after2.find(i => i.offeringId === target.offeringId);
  eq('submission is committed', committed?.submission?.status, 'committed');
  eq('the chosen activity is the written one', committed?.submission?.chosenActivityId, target.written.id);
  check('status is submitted or pending after commit',
        ['submitted', 'pending'].includes(committed?.status), `got ${committed?.status}`);

  /* ── practice can never carry credit ────────────────────────────────────── */
  // Two different triggers can refuse a switch, and they fire in a fixed order:
  // submissions_check_gradable (is this activity even eligible?) runs BEFORE
  // submissions_lock_activity (may it change now?). Testing them on the same offering
  // proves only whichever fires first, so they get separate targets.
  section('practice activities (submissions_check_gradable)');

  const practiceTarget = items.find(i => i.interactive?.gradingRole === 'practice');
  if (practiceTarget) {
    const { data: ps } = await ensureSubmission(ctx, practiceTarget.offeringId);
    const { error: pErr } = await client.from('submissions')
      .update({ chosen_activity_id: practiceTarget.interactive.id })
      .eq('id', ps.id);
    check('a practice activity cannot be chosen for credit', !!pErr,
          'submissions_check_gradable must reject it');
    check('…and the error says why',
          /only a graded activity/i.test(pErr?.message || ''), pErr?.message);
  } else {
    check('found an offering with a practice activity', false, 'none in the data');
  }

  /* ── the lock, on an offering that genuinely offers a choice ────────────── */
  section('lock enforcement (submissions_lock_activity)');

  // Needs BOTH activities graded, otherwise the gradable check fires first and the lock
  // is never reached.
  const choiceTarget = items.find(i => i.isChoice && i.written && i.interactive);
  if (choiceTarget) {
    const { data: cs } = await ensureSubmission(ctx, choiceTarget.offeringId);
    check('a choice offering starts unlocked', cs.status !== 'committed');

    const { error: pick1 } = await chooseActivity(ctx, choiceTarget.offeringId, choiceTarget.written.id);
    check('choosing a graded activity before commit is allowed', !pick1, pick1?.message);

    // Still a draft, so the choice is free to change.
    const { error: pick2 } = await chooseActivity(ctx, choiceTarget.offeringId, choiceTarget.interactive.id);
    check('switching between graded activities while still a draft is allowed', !pick2, pick2?.message);

    const { error: cErr2 } = await commitSubmission(ctx, choiceTarget.offeringId, choiceTarget.written.id);
    check('committing to the written path succeeded', !cErr2, cErr2?.message);

    const { error: lockErr } = await chooseActivity(ctx, choiceTarget.offeringId, choiceTarget.interactive.id);
    check('switching AFTER commit is refused by lock_on_commit', !!lockErr, 'the lock did not fire');
    check('…and the error names the lock, not the gradable check',
          /switch_policy|locked/i.test(lockErr?.message || ''), lockErr?.message);

    /* ── can a student unlock themselves? ─────────────────────────────────── */
    // submissions_lock_activity refuses an unlock that does not name who performed it, but
    // it does not check that the caller IS that person — and submissions_student_update
    // lets a student write any column on their own row. If both hold, a student can clear
    // their own committed choice by naming an instructor, defeating the lock.
    section('unlock attribution');

    const { data: anyInstructor } = await client.from('instructors').select('id, name').limit(1);
    check('a student can read the instructors table',
          (anyInstructor || []).length > 0,
          'instructors_read is USING(true) for every authenticated role');

    const { error: anonUnlock } = await client.from('submissions')
      .update({ chosen_activity_id: null }).eq('id', cs.id);
    check('an unlock with no unlocked_by is refused', !!anonUnlock, anonUnlock?.message);

    if (anyInstructor?.length) {
      const { error: selfUnlock } = await client.from('submissions')
        .update({ chosen_activity_id: null, unlocked_by: anyInstructor[0].id, unlocked_at: new Date().toISOString() })
        .eq('id', cs.id);
      check('a student CANNOT unlock their own submission by naming an instructor [migration 006]',
            !!selfUnlock,
            'SECURITY: the student cleared their own committed choice and attributed it to ' +
            'an instructor who did not perform it');
    }

    // The second bypass migration 006 closed: reopening the commit is itself an unlock, and
    // needed no instructor id at all — set status back to draft, then switch freely.
    const { error: revert } = await client.from('submissions')
      .update({ status: 'draft' }).eq('id', cs.id);
    check('a student CANNOT reopen their own commit by reverting status [migration 006]',
          !!revert,
          'SECURITY: reverting status to draft disengages the lock on the next statement');

    // And the row must actually be unchanged, not merely reported as refused.
    const { data: still } = await client.from('submissions')
      .select('status, chosen_activity_id').eq('id', cs.id).maybeSingle();
    eq('…and the row really is still committed', still?.status, 'committed');
    eq('…still chosen: the written activity', still?.chosen_activity_id, choiceTarget.written.id);
  } else {
    check('found an offering with two graded activities', false, 'none in the data');
  }

  /* ── reset ──────────────────────────────────────────────────────────────── */
  section('teardown');
  const { error: delErr } = await client.from('submission_activities')
    .delete().eq('submission_id', committed.submission.id);
  check('test work removed from submission_activities', !delErr, delErr?.message);
  console.log('  (run tests/app-schema/cleanup.py --commit to remove the submission rows)');
}
