// Group G: roles. An instructor gets no Assignments writes; the director of the other course cannot reach this course's assignments.
import * as L from '../lib.mjs';

export async function runG(W) {
  const title = W.state.titleA || W.state.titleC;
  const item = title ? L.itemByTitle(title) : null;
  if (!item) { L.blockedBy('G0', 'groups G needs an assignment from group A or C', 'neither group made one'); return; }
  const courseId = L.sql(`select course_id from course_offerings where id=${L.lit(L.PHYS215)}`)[0].course_id;
  const pointsNow = () => Number(L.sql(`select points_possible from assignment_offerings where id=${L.lit(item.id)}`)[0].points_possible);
  const before = pointsNow();

  // ---- Instructor ----
  const ins = await L.Session.start(W.browser, W.base, L.staffLogin(W.seed, 'instructor'));
  await L.check('G1', 'instructor: no Assignments link on the bar, and the page says directors only', async () => {
    await ins.go('faculty/dashboard.html');
    const labels = await ins.page.$$eval('#nav-links a', as => as.map(a => a.innerText.trim()));
    L.assert(!labels.includes('Assignments'), 'the bar offers Assignments: ' + labels.join(' | '));
    await ins.go('faculty/items.html');
    await ins.until(/Directors only/);
    L.assert(!(await ins.exists('#new-btn')) && !(await ins.exists('[data-edit]')), 'a write control is on the page');
  });
  await L.check('G2', 'instructor: the database refuses an insert and an update on assignments (nothing changes)', async () => {
    await ins.go('faculty/dashboard.html');
    const out = await ins.inPage(async (db, a) => {
      const ins1 = await db.from('assignments').insert({ course_id: a[0], kind_id: 'homework', slug: 'zz-walk-denied', title: 'ZZ walk denied by role' }).select();
      const up = await db.from('assignment_offerings').update({ points_possible: 99 }).eq('id', a[1]).select();
      const del = await db.from('assignment_offerings').delete().eq('id', a[1]).select();
      return { ins: ins1.error ? ins1.error.code || ins1.error.message : (ins1.data || []).length, up: up.error ? up.error.code || up.error.message : (up.data || []).length, del: del.error ? del.error.code || del.error.message : (del.data || []).length };
    }, courseId, item.id);
    L.assert(typeof out.ins === 'string', 'the insert was not refused: ' + JSON.stringify(out));
    L.assert(out.up === 0 || typeof out.up === 'string', 'the update changed a row: ' + JSON.stringify(out));
    L.assert(out.del === 0 || typeof out.del === 'string', 'the delete removed a row: ' + JSON.stringify(out));
    L.eq(pointsNow(), before, 'points after the attempts');
    L.eq(Number(L.sql(`select count(*) n from assignments where slug='zz-walk-denied'`)[0].n), 0, 'rows made by the refused insert');
    L.assert(L.sql(`select 1 from assignment_offerings where id=${L.lit(item.id)}`).length === 1, 'the assignment is gone');
  });
  await ins.close();

  // ---- The director of the other course ----
  const od = await L.Session.start(W.browser, W.base, L.staffLogin(W.seed, 'otherdirector'));
  await L.check('G3', 'other director: the course menu and the Assignments page show their own course only', async () => {
    await od.go('faculty/items.html');
    await od.until(/Assignments/, { sel: 'h1' });
    await L.wait(1200);
    const t = await od.text('main');
    L.assert(!t.includes(title), 'this offering\'s assignment is listed');
    const courses = await od.page.$$eval('.course-opt', els => els.map(e => e.dataset.course));
    L.assert(!courses.includes(L.PHYS215), 'the course menu offers this course');
    L.assert(await od.exists('#new-btn'), 'their own Assignments page has no New button (they are a director of their own course)');
  });
  await L.check('G4', 'other director: reads and writes against this offering reach nothing', async () => {
    const out = await od.inPage(async (db, a) => {
      const rd = await db.from('assignment_offerings').select('id').eq('id', a[1]);
      const rdAll = await db.from('assignment_offerings').select('id').eq('course_offering_id', a[0]);
      const up = await db.from('assignment_offerings').update({ points_possible: 99 }).eq('id', a[1]).select();
      const rdGr = await db.from('grades').select('id').eq('assignment_offering_id', a[1]);
      return { read: rd.error ? 'err' : (rd.data || []).length, readAll: rdAll.error ? 'err' : (rdAll.data || []).length, up: up.error ? up.error.code || up.error.message : (up.data || []).length, grades: rdGr.error ? 'err' : (rdGr.data || []).length };
    }, L.PHYS215, item.id);
    L.eq(out.read, 0, 'rows of this assignment visible'); L.eq(out.readAll, 0, 'assignments of this offering visible');
    L.assert(out.up === 0 || typeof out.up === 'string', 'the update reached a row: ' + JSON.stringify(out)); L.eq(out.grades, 0, 'grades visible');
    L.eq(pointsNow(), before, 'points after the attempt');
  });
  await L.check('G5', 'other director: the review screen and the report for this assignment show nothing of it', async () => {
    await od.go(`faculty/grade.html?a=${item.id}`); await L.wait(2000);
    L.assert(!(await od.text('main')).includes(title), 'the review screen names this assignment');
    await od.go(`faculty/report.html?i=${item.id}`); await L.wait(2500);
    L.assert(!(await od.text('main')).includes(title), 'the report names this assignment');
  });
  await od.close();
}
