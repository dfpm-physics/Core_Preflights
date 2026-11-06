// Group D: AI drafts. An invented draft is put in through the staging data role (no AI is called), shows as waiting for approval,
// opens the review screen, and is finalized by a person. A draft on a dropped cadet is not counted.
import * as L from '../lib.mjs';
import { SYNTH_ID_LOW } from '../cleanup.mjs';

export async function runD(W) {
  const title = `${W.run} ai draft`;
  const d = W.state.directorC || await L.Session.start(W.browser, W.base, L.staffLogin(W.seed, 'director'));
  const droppedId = SYNTH_ID_LOW;           // an invented cadet that only the walk makes
  const live = () => L.itemByTitle(title);
  const isGradeRowFor = (id) => `select g.is_finalized, g.source, g.points_earned from grades g join enrollments e on e.id=g.enrollment_id where g.assignment_offering_id=${L.lit(live()?.id)} and e.student_id=${id}`;
  const listRow = () => d.page.evaluate((t) => { const tr = [...document.querySelectorAll('#grade-list tbody tr')].find(r => r.innerText.includes(t)); return tr ? [...tr.cells].map(c => c.innerText.replace(/\s+/g, ' ').trim()) : null; }, title);

  await L.check('D1', 'director: makes a typed-response assignment graded by AI drafts, and publishes it', async () => {
    await d.go('faculty/items.html'); await d.untilSel('#new-btn');
    await d.click('#new-btn'); await d.untilSel('#item-modal.open');
    await d.set('#i-title', title);
    await d.set('#i-points', '2');
    await d.set('#i-alldate', L.fmtDate(L.inDays(5)));
    await d.click('#im-save');
    await d.until(/Next: choose how cadets do this work/, { sel: '#im-note' });
    await d.page.$eval('#i-more', e => { e.open = true; });
    await d.select('#i-grading', 'ai_drafted');
    // each free-response question needs a description of a good answer for the AI draft to be checked against
    await d.page.$$eval('#i-written textarea[data-f="expected_response"], #i-written-more textarea[data-f="expected_response"]', els => els.forEach(e => { if (!e.value) { e.value = 'ZZ walk: any clear statement of the main idea.'; e.dispatchEvent(new Event('input', { bubbles: true })); } }));
    await d.tick('#i-publish', true);
    await d.click('#im-save');
    await d.page.waitForFunction(() => !document.getElementById('item-modal').classList.contains('open') || getComputedStyle(document.getElementById('im-error')).display !== 'none', { timeout: 30000 });
    const err = await d.visible('#im-error') ? await d.text('#im-error') : '';
    L.assert(!err, 'the form refused: ' + err);
    const it = live(); L.eq(it.is_published, true, 'published'); L.eq(it.paths.map(p => p.grading), ['ai_drafted'], 'grading');
  });

  await L.check('D2', 'data role: two invented drafts are inserted, one for an enrolled cadet and one for a dropped cadet', async () => {
    const it = live(); const written = it.paths[0].activity_id;
    const sec = L.sql(`select id from sections where course_offering_id=${L.lit(L.PHYS215)} and code='M1A'`)[0].id;
    const enr = L.sql(`select id from enrollments where student_id=3000000101 and section_id=${L.lit(sec)}`)[0].id;
    L.exec([
      [`insert into students (student_id, name, email) values (${droppedId}, 'Zz Walk Dropped', 'zz-walk-dropped@prep-staging.example') on conflict do nothing`, null],
      [`insert into enrollments (student_id, section_id, status, dropped_at) values (${droppedId}, ${L.lit(sec)}, 'dropped', now()) on conflict do nothing`, null]]);
    const dropEnr = L.sql(`select id from enrollments where student_id=${droppedId}`)[0].id;
    const statements = [];
    for (const [e, tag] of [[enr, 'one'], [dropEnr, 'two']]) {
      statements.push([`with s as (insert into submissions (assignment_offering_id, enrollment_id, chosen_activity_id, status, committed_at) values (${L.lit(it.id)}, ${L.lit(e)}, ${L.lit(written)}, 'committed', now()) returning id),
        sa as (insert into submission_activities (submission_id, activity_id, content, is_final) select id, ${L.lit(written)}, '{"answers":{"q3":"ZZ walk invented answer"}}'::jsonb, true from s)
        insert into grades (assignment_offering_id, enrollment_id, submission_id, points_earned, points_possible, question_scores, source, is_finalized)
        select ${L.lit(it.id)}, ${L.lit(e)}, id, 1, 2, '{"q3":{"score":1,"max":1,"feedback":"ZZ walk invented draft","status":"full"}}'::jsonb, 'ai_suggested', false from s`, null]);
    }
    L.exec(statements);
    L.eq(L.sql(`select count(*) n from grades where assignment_offering_id=${L.lit(it.id)} and source='ai_suggested' and not is_finalized`)[0].n, 2, 'draft rows');
  }, { needs: ['D1'] });

  await L.check('D3', 'the list shows the draft as waiting for approval, counted once (the dropped cadet is not counted)', async () => {
    await d.go('faculty/entry.html'); await d.untilSel('#grade-list');
    const row = await listRow();
    L.assert(row, 'the assignment is not in the list');
    L.assert(/1 AI-suggested draft needs a person to review/.test(row[3]), 'what is waiting: ' + row[3]);
    L.assert(/Review answers/.test(row[4]), 'no review button: ' + row[4]);
  }, { needs: ['D2'] });

  await L.check('D4', 'Review opens the review screen for that assignment, with a way back to the list', async () => {
    await d.page.evaluate((t) => { [...document.querySelectorAll('#grade-list tbody tr')].find(r => r.innerText.includes(t)).querySelector('a[href*="grade.html"]').click(); }, title);
    await d.page.waitForFunction(() => /grade\.html/.test(location.pathname), { timeout: 20000 });
    await d.untilSel('.grade-card, #grade-container .grade-card', { timeout: 30000 });
    L.assert(/back=entry/.test(d.page.url()), 'no back marker in the address');
    const t = await d.text('main');
    L.assert(/Testcadet, Avery|Avery Testcadet|ZZ walk invented draft/.test(t), 'the draft card is not shown');
    L.assert(!/Zz Walk Dropped|Dropped, Zz|Walk Dropped/.test(t), 'the dropped cadet appears on the review screen');
    L.assert(await d.page.evaluate(() => !![...document.querySelectorAll('a')].find(a => /entry\.html/.test(a.getAttribute('href') || ''))), 'no link back to Grade assignments');
  }, { needs: ['D3'] });

  await L.check('D5', 'a person finalizes it: the database holds a final grade and the waiting count drops', async () => {
    await d.click('#finalize-btn');
    await d.until(/Published 1 to students/, { sel: '#save-status', timeout: 30000 });
    const r = L.sql(isGradeRowFor(3000000101));
    L.eq(r.length, 1, 'rows'); L.eq(r[0].is_finalized, true, 'finalized');
    const dropped = L.sql(isGradeRowFor(droppedId));
    L.eq(dropped[0].is_finalized, false, 'the dropped cadet draft must stay a draft');
    await d.go('faculty/entry.html'); await d.untilSel('main'); await L.wait(1200);
    const row = await listRow();
    L.assert(!row || !/AI-suggested/.test(row[3]), 'the draft count is still shown: ' + (row && row[3]));
  }, { needs: ['D4'] });
}
