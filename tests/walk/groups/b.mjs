// Group B: cadets use the assignment group A made. One works the Questions path to a submit, another takes the tutor card as far as
// the page allows, and a homework item shows what the cadet dashboard says about its questions.
import * as L from '../lib.mjs';

export async function runB(W) {
  const title = W.state.titleA;
  if (!title) { L.blockedBy('B0', 'group B needs the assignment group A makes', 'group A did not run'); return; }
  const item = L.itemByTitle(title);
  if (!item || !item.is_published) { L.blockedBy('B0', 'the published Both assignment exists', 'group A did not leave a published assignment'); return; }
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // ---- Cadet 101: the chooser, and the Questions path to a submit ----
  const c1 = await L.Session.start(W.browser, W.base, L.cadetLogin(W.seed, 101));
  await L.check('B1', 'cadet: the published assignment is in the list, marked as a choice of format', async () => {
    await c1.go('student/lessons.html');
    const t = await c1.until(new RegExp(esc(title)));
    const row = await c1.page.evaluate((tt) => { const a = [...document.querySelectorAll('a.list-item')].find(x => x.innerText.includes(tt)); return a ? a.innerText : null; }, title);
    L.assert(row, 'no list row'); L.assert(/Your choice of format/.test(row), 'the row does not say it is a choice of format: ' + row.replace(/\s+/g, ' '));
  });
  await L.check('B2', 'cadet: opening it shows the chooser with a Questions card and a tutor card', async () => {
    await c1.go(`student/lessons.html?l=${item.id}`);
    await c1.until(/Choose how to complete this assignment/);
    const t = await c1.text('main');
    L.assert(/Written preflight/.test(t) && /Interactive lesson/.test(t), 'a card is missing: ' + t.replace(/\s+/g, ' ').slice(0, 200));
    L.assert(/Start writing/.test(t), 'no Start writing button');
  }, { needs: ['B1'] });
  await L.check('B3', 'cadet: works the Questions path to a submit, and the database holds a committed written submission', async () => {
    await c1.page.evaluate(() => [...document.querySelectorAll('a.btn')].find(a => /Start writing|Resume writing/.test(a.innerText)).click());
    await c1.untilSel('textarea[data-qid]');
    const ids = await c1.page.$$eval('textarea[data-qid]', els => els.map(e => e.dataset.qid));
    L.assert(ids.length >= 3, 'expected the reading questions plus the added question, found ' + ids.length);
    for (const id of ids) { await c1.page.type(`textarea[data-qid="${id}"]`, `ZZ walk answer for ${id}. Invented text.`); }
    await L.wait(1500);
    await c1.click('#submit-btn');
    await c1.page.waitForFunction(() => /submitted|Submitted/.test(document.body.innerText), { timeout: 20000 });
    await L.wait(800);
    const r = L.sql(`select s.status, oa.delivery from submissions s join enrollments e on e.id=s.enrollment_id left join offering_activities oa on oa.assignment_offering_id=s.assignment_offering_id and oa.activity_id=s.chosen_activity_id
        where s.assignment_offering_id=${L.lit(item.id)} and e.student_id=${W.seed.cadets['3000000101'] ? 3000000101 : 0}`);
    L.assert(r.length === 1, 'no submission row'); L.eq(r[0].status, 'committed', 'submission status'); L.eq(r[0].delivery, 'typed_response', 'chosen path');
  }, { needs: ['B2'] });
  await c1.close();

  // ---- Cadet 102: the tutor card, as far as the page allows without claude.ai ----
  const c2 = await L.Session.start(W.browser, W.base, L.cadetLogin(W.seed, 102));
  await L.check('B4', 'cadet: the tutor card is live and launching it asks the browser to open the tutor link (nothing is opened)', async () => {
    await c2.go(`student/lessons.html?l=${item.id}`);
    await c2.until(/Choose how to complete this assignment/);
    const btn = await c2.page.$('#choice-claude, #choice-gemini');
    L.assert(btn, 'no tutor launch button');
    L.assert(!(await c2.page.$eval('#choice-claude, #choice-gemini', e => e.disabled)), 'the tutor launch button is disabled');
    await c2.page.$eval('#choice-claude, #choice-gemini', e => e.click());
    await L.wait(500);
    const opened = await c2.opened_();
    L.eq(opened.length, 1, 'windows the page tried to open');
    L.assert(opened[0].startsWith('https://example.org/zz-walk-tutor') || /gemini|backup/.test(opened[0]), 'the page tried to open an unexpected address: ' + opened[0]);
    const rows = L.sql(`select count(*) n from submissions s join enrollments e on e.id=s.enrollment_id where s.assignment_offering_id=${L.lit(item.id)} and e.student_id=3000000102`);
    L.eq(Number(rows[0].n), 0, 'submissions this cadet has (launching the tutor must not submit anything)');
  }, { needs: ['B2'] });
  await c2.close();

  // ---- The homework item: what the cadet dashboard says about its questions (a known fault is recorded here, not fixed) ----
  const hwTitle = `${W.run} homework`;
  W.state.titleHw = hwTitle;
  const d = W.state.directorA;
  await L.check('B5a', 'director: makes a homework assignment with one numeric question and publishes it', async () => {
    await d.go('faculty/items.html'); await d.untilSel('#new-btn');
    await d.click('#new-btn'); await d.untilSel('#item-modal.open');
    await d.set('#i-title', hwTitle);
    await d.select('#i-kind', 'homework');
    await d.set('#i-alldate', L.fmtDate(L.inDays(1)));    // soonest due, so the dashboard's short list includes it
    await d.click('#im-save');
    await d.page.waitForFunction(() => document.getElementById('im-note').innerText.length > 0 || getComputedStyle(document.getElementById('im-error')).display !== 'none', { timeout: 20000 });
    const err = await d.visible('#im-error') ? await d.text('#im-error') : '';
    L.assert(!err, 'the form refused: ' + err);
    const hw = L.itemByTitle(hwTitle); L.assert(hw, 'not saved');
    L.eq(hw.paths[0].delivery, 'online_questions', 'delivery');
    await d.go(`faculty/questions.html?a=${hw.id}`);
    await d.click('#add-btn'); await d.untilSel('#q-modal.open');
    await d.set('#q-qid', 'zz-walk-q1');
    await d.select('#q-format', 'numeric');
    await d.set('#q-points', '1');
    await d.set('#q-prompt', 'ZZ walk: what is 2 + 2?');
    await d.set('#q-value', '4'); await d.set('#q-tolabs', '0');
    await d.click('#qm-save');
    await d.until(/zz-walk-q1/, { sel: '#main' });
    await d.go('faculty/items.html'); await d.untilSel('#items-table');
    await d.page.evaluate((t) => { [...document.querySelectorAll('#items-table tbody tr')].find(r => r.innerText.includes(t)).querySelector('[data-edit]').click(); }, hwTitle);
    await d.untilSel('#item-modal.open'); await L.wait(500);
    await d.tick('#i-publish', true);
    await d.click('#im-save');
    await d.page.waitForFunction(() => !document.getElementById('item-modal').classList.contains('open') || getComputedStyle(document.getElementById('im-error')).display !== 'none', { timeout: 30000 });
    const err2 = await d.visible('#im-error') ? await d.text('#im-error') : '';
    L.assert(!err2, 'publish refused: ' + err2);
    L.eq(L.itemByTitle(hwTitle).is_published, true, 'published');
  }, { needs: [] });
  await L.check('B5b', 'cadet dashboard: the homework row does not claim "0 questions" (a known fault)', async () => {
    const c = await L.Session.start(W.browser, W.base, L.cadetLogin(W.seed, 103));
    try {
      await c.go('student/dashboard.html');
      await c.until(new RegExp(esc(hwTitle)));
      const row = await c.page.evaluate((tt) => { const a = [...document.querySelectorAll('a.list-item')].find(x => x.innerText.includes(tt)); return a ? a.innerText.replace(/\s+/g, ' ') : null; }, hwTitle);
      L.assert(row, 'the homework is not on the dashboard');
      // The lesson page for the same item says "Homework, checked as you answer".
      await c.go(`student/lessons.html?l=${L.itemByTitle(hwTitle).id}`);
      const lessonText = await c.until(/Homework/);
      if (/\b0 questions\b/.test(row)) {
        L.fault({ id: 'P2', login: 'cadet103', steps: 'Sign in as a cadet > Dashboard, with a published assignment whose work is auto-checked questions entered on the questions page.',
          expected: 'The row names the kind of work, as the lessons page does ("Homework, checked as you answer"), or the real question count.',
          actual: `The dashboard row reads: "${row.slice(0, 120)}". The count is read from the old preflight field, which an assignment of questions on the questions page does not fill.`,
          where: 'site/student/dashboard.html:87-92 (modeLabel counts l.preflight.questions and has no branch for l.autoChecked); the lessons page has that branch at site/student/lessons.html:118-122; lessons.html:549 and :592 count the same old field' });
        throw new Error(`dashboard row says "0 questions": ${row.slice(0, 100)}`);
      }
    } finally { await c.close(); }
  }, { needs: ['B5a'] });
}
