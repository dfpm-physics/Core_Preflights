// Group J: the 2026-11-09 review pass and the editor merge. The older Assignments address forwards to the one Assignments page
// (whole query string kept), which opens, saves and removes every assignment whichever page made it. Also: the faculty dashboard
// carries Backlog and Recent reports, a gradebook column heading opens its report, the info control, and the student "All
// classes" page for a cadet who is in two courses (seeded: cadet 105 in phys-215 and phys-120). The merge checks (J1, J9 to J14)
// write only to the walk's own "ZZ walk" rows, plus one save with no changes on the seeded older-page-shaped item, which must
// leave every stored value as it was.
import * as L from '../lib.mjs';

export async function runJ(W) {
  const d = await L.Session.start(W.browser, W.base, L.staffLogin(W.seed, 'director'));
  const waitSavedOrError = () => d.page.waitForFunction(() => !document.getElementById('item-modal').classList.contains('open') || getComputedStyle(document.getElementById('im-error')).display !== 'none', { timeout: 30000 });

  await L.check('J1', 'director: the older Assignments address forwards to the one page, with the query string kept', async () => {
    await d.go('faculty/lessons.html');
    await d.page.waitForFunction(() => /faculty\/items\.html/.test(location.href), { timeout: 15000 });
    await d.untilSel('#items-table');
    L.assert(!/lessons\.html/.test(d.page.url()), 'still on the old address: ' + d.page.url());
    // a prefill link: the new page reads it, offers the chooser, and writes nothing
    await d.go('faculty/lessons.html?new=1&id=zz-walk-j1&title=ZZ%20walk%20J1&pub=0');
    await d.page.waitForFunction(() => /faculty\/items\.html/.test(location.href), { timeout: 15000 });
    await d.page.waitForFunction(() => document.getElementById('dest-modal')?.classList.contains('open') || document.getElementById('item-modal')?.classList.contains('open'), { timeout: 20000 });
    L.eq(L.sql(`select count(*) n from assignments where title like 'ZZ walk J1%' or slug = 'zz-walk-j1'`)[0].n, 0, 'a prefill link must not save anything');
    // the same link with its hash intact reaches the page too (the hash is carried over)
    const fwd = await d.page.evaluate(async () => { const r = await fetch('../js/lessons-forward.js'); return r.text(); });
    L.assert(/location\.search \+ location\.hash/.test(fwd), 'the forwarder does not carry the hash');
  });

  await L.check('J2', 'director: the dashboard has a Backlog section and a Recent reports section, each with its way in', async () => {
    await d.go('faculty/dashboard.html');
    await d.page.waitForFunction(() => { const b = document.querySelector('#dashBacklog [data-backlog]'); const r = document.querySelector('#dashReports [data-reports]');
      return b && r && b.dataset.backlog !== 'loading' && r.dataset.reports !== 'loading'; }, { timeout: 30000 });
    const st = await d.page.evaluate(() => ({ b: document.querySelector('#dashBacklog [data-backlog]').dataset.backlog, r: document.querySelector('#dashReports [data-reports]').dataset.reports,
      bl: document.querySelector('#dashBacklog a[href="backlog.html"]')?.innerText || '', rl: document.querySelector('#dashReports a[href="report.html"]')?.innerText || '' }));
    L.assert(['ready', 'empty'].includes(st.b), 'backlog state: ' + st.b);
    L.assert(['ready', 'empty'].includes(st.r), 'reports state: ' + st.r);
    L.assert(/Open backlog/.test(st.bl) && /All reports/.test(st.rl), 'links: ' + JSON.stringify(st));
    const labels = await d.page.$$eval('#nav-links a', as => as.map(a => a.innerText.trim()));
    L.eq(labels, ['Dashboard', 'Gradebook', 'Assignments', 'Admin'], 'the bar');
  });

  await L.check('J3', 'director: a Recent reports row opens that assignment\'s report', async () => {
    const href = await d.page.evaluate(() => document.querySelector('#dashReports a.btn[href^="report.html?i="]')?.getAttribute('href') || null);
    if (!href) return;      // a term with nothing past due and nothing started has no row to open: the empty line is the answer
    await d.go('faculty/' + href);
    await d.untilSel('#rm-title');
    L.assert(/report\.html\?i=/.test(d.page.url()), 'url ' + d.page.url());
  }, { needs: ['J2'] });

  await L.check('J4', 'director: a gradebook column heading opens the report for that assignment', async () => {
    await d.go('faculty/gradebook.html');
    await d.untilSel('th.gb-col a');
    const href = await d.page.$eval('th.gb-col a', a => a.getAttribute('href'));
    L.assert(/^report\.html\?i=[0-9a-f-]{36}$/.test(href), 'href ' + href);
    await d.page.evaluate(() => document.querySelector('th.gb-col a').click());
    await d.page.waitForFunction(() => /report\.html\?i=/.test(location.href), { timeout: 15000 });
  });

  await L.check('J5', 'the info control: a real button that opens a popover, and Escape closes it', async () => {
    await d.go('faculty/backlog.html');
    await d.untilSel('.info-btn');
    const tag = await d.page.$eval('.info-btn', b => [b.tagName, b.getAttribute('type'), !!b.getAttribute('aria-label')]);
    L.eq(tag, ['BUTTON', 'button', true], 'button');
    await d.page.evaluate(() => document.querySelector('.info-btn').click());
    L.assert(await d.visible('.info-wrap.open .info-pop'), 'the popover did not open');
    await d.page.keyboard.press('Escape');
    L.assert(!(await d.visible('.info-wrap.open .info-pop')), 'Escape did not close it');
  });

  // ── the editor merge ───────────────────────────────────────────────────────────────────────────────────────────────
  const OLDER = 'Test Lesson 9: Older-page item';
  const snap = (id) => L.sql(`select to_jsonb(ao) - 'updated_at' as ao, (select to_jsonb(a) - 'updated_at' from assignments a where a.id = ao.assignment_id) as a,
      (select jsonb_agg(to_jsonb(oa) order by oa.position) from offering_activities oa where oa.assignment_offering_id = ao.id) as oas,
      (select jsonb_agg(to_jsonb(act) - 'updated_at' order by act.position) from activities act where act.id in (select activity_id from offering_activities where assignment_offering_id = ao.id)) as acts,
      (select coalesce(jsonb_agg(to_jsonb(dd) - 'updated_at' order by dd.section_id), '[]'::jsonb) from assignment_due_dates dd where dd.assignment_offering_id = ao.id) as dues,
      ao.updated_at as touched
    from assignment_offerings ao where ao.id = ${L.lit(id)}`)[0];

  await L.check('J9', 'director: the older-page item opens on the Assignments page, with its per-day deadlines, opening date, figure and reference shown', async () => {
    const it = L.itemByTitle(OLDER);
    L.assert(it, 'the seeded older-page item is missing: run seed_staging.py');
    W.state.olderId = it.id;
    const was = snap(it.id);
    L.eq(was.ao.entered_on_new_page, false, 'the seeded item must be older-page shaped');
    L.assert(Object.keys(was.ao.due_by_day || {}).length >= 2 && was.dues.length >= 2, 'the seeded item has no per-day deadlines or rows');
    L.assert(was.ao.opens_at, 'the seeded item has no opening date');
    await d.go('faculty/items.html?a=' + it.id);
    await d.untilSel('#item-modal.open');
    await L.wait(800);
    L.eq(await d.page.$eval('#i-title', e => e.value), OLDER, 'title');
    const rows = await d.text('#items-table');
    L.assert(!/Open in the older editor|Entered on the older page/.test(rows), 'the list still fences off older rows');
    await d.page.$eval('#i-more', e => { e.open = true; });
    L.eq(await d.page.$eval('#i-release', e => e.value), 'custom', 'the opening date shows as a chosen date');
    const want = L.sql(`select to_char(opens_at at time zone 'America/Denver', 'YYYY-MM-DD') as d from assignment_offerings where id = ${L.lit(it.id)}`)[0].d;
    L.eq(await d.page.$eval('#i-opens', e => e.value), want, 'opening date');
    const days = await d.page.$$eval('#i-daybox input', els => els.length);
    L.assert(days >= 2, 'the per-day deadline boxes are not shown: ' + days);
    L.assert(/Test Lesson 9/.test(await d.text('main')), 'page content');
  });

  await L.check('J10', 'director: saving that item with nothing changed leaves every stored value as it was', async () => {
    L.assert(W.state.olderId, 'no item');
    const before = snap(W.state.olderId);
    await d.click('#im-save');
    await waitSavedOrError();
    const err = await d.visible('#im-error') ? await d.text('#im-error') : '';
    L.assert(!err, 'the save was refused: ' + err);
    const after = snap(W.state.olderId);
    for (const k of ['ao', 'a', 'oas', 'acts', 'dues']) L.eq(after[k], before[k], 'stored ' + k);
    console.log('   (offering updated_at ' + (before.touched === after.touched ? 'did not move' : 'moved: an equal-value write by the offering update') + ')');
  }, { needs: ['J9'] });

  await L.check('J11', 'director: a new assignment saved on this page gets the per-day map AND a row for each section, and a chosen opening date', async () => {
    const title = 'ZZ walk J11 merge';
    await d.go('faculty/items.html'); await d.untilSel('#new-btn');
    await d.click('#new-btn'); await d.untilSel('#item-modal.open');
    await d.set('#i-title', title); await d.select('#i-kind', 'homework');
    await d.set('#i-points', '4');
    await d.set('#i-alldate', L.fmtDate(L.inDays(12)));
    await d.page.$eval('#i-more', e => { e.open = true; });
    await d.select('#i-release', 'custom');
    await d.set('#i-opens', L.fmtDate(L.inDays(5)));
    await d.click('#im-save');
    await waitSavedOrError();
    const err = await d.visible('#im-error') ? await d.text('#im-error') : '';
    L.assert(!err, 'the form refused: ' + err);
    const it = L.itemByTitle(title); L.assert(it, 'not saved'); W.state.j11 = it.id;
    const r = snap(it.id);
    const keys = Object.keys(r.ao.due_by_day || {}).sort();
    L.assert(keys.includes('M') && keys.includes('T'), 'due_by_day is missing a track: ' + JSON.stringify(r.ao.due_by_day));
    const secs = L.sql(`select id, meeting_days from sections where course_offering_id = ${L.lit(r.ao.course_offering_id)}`);
    const withDay = secs.filter(x => (x.meeting_days || []).length);
    L.eq(r.dues.length, withDay.length, 'one due-date row for every section that meets');
    for (const row of r.dues) {
      const sec = secs.find(x => x.id === row.section_id);
      const day = (sec.meeting_days || []).find(dd => r.ao.due_by_day[dd]);
      L.eq(new Date(row.due_at).getTime(), new Date(r.ao.due_by_day[day]).getTime(), 'the row for a section follows its own track');
    }
    L.assert(r.ao.opens_at, 'the chosen opening date was not written');
    L.eq(r.ao.entered_on_new_page, true, 'the marker');
  });

  await L.check('J12', 'director: removing an assignment that has cadet work shows the counts and needs a held button', async () => {
    L.assert(W.state.j11, 'no item');
    const en = L.sql(`select e.id from enrollments e join students s on s.student_id = e.student_id where s.student_id = 3000000101 limit 1`)[0].id;
    const act = L.sql(`select activity_id from offering_activities where assignment_offering_id = ${L.lit(W.state.j11)} limit 1`)[0]?.activity_id || null;
    L.exec([[`insert into submissions (assignment_offering_id, enrollment_id, chosen_activity_id, status) values (${L.lit(W.state.j11)}, ${L.lit(en)}, ${L.lit(act)}, 'draft')`, null]]);
    await d.go('faculty/items.html'); await d.untilSel('#items-table');
    await d.page.evaluate(() => [...document.querySelectorAll('#items-table tbody tr')].find(r => r.innerText.includes('ZZ walk J11 merge')).querySelector('[data-remove]').click());
    await d.untilSel('#rm-modal.open');
    await d.until(/submission/, { sel: '#rm-info' });
    L.assert(/1 submission/.test(await d.text('#rm-info')), 'counts: ' + await d.text('#rm-info'));
    // a quick click does nothing
    await d.page.click('#rm-hold');
    await L.wait(600);
    L.eq(L.sql(`select count(*) n from assignment_offerings where id = ${L.lit(W.state.j11)}`)[0].n, 1, 'a click alone must not delete');
    // cancel keeps it
    await d.page.evaluate(() => document.querySelector('#rm-modal [data-close].btn').click());
    L.assert(!(await d.exists('#rm-modal.open')), 'cancel did not close');
    L.eq(L.sql(`select count(*) n from assignment_offerings where id = ${L.lit(W.state.j11)}`)[0].n, 1, 'cancel must not delete');
    // A second assignment with work. The dialog is opened for the first, cancelled, then opened for this one: one hold must
    // remove this one only, whatever was opened and cancelled before.
    const titleB = 'ZZ walk J12 second';
    await d.go('faculty/items.html'); await d.untilSel('#new-btn');
    await d.click('#new-btn'); await d.untilSel('#item-modal.open');
    await d.set('#i-title', titleB); await d.select('#i-kind', 'homework');
    await d.set('#i-points', '4'); await d.set('#i-alldate', L.fmtDate(L.inDays(12)));
    await d.click('#im-save');
    await waitSavedOrError();
    const errB = await d.visible('#im-error') ? await d.text('#im-error') : '';
    L.assert(!errB, 'the second assignment was refused: ' + errB);
    const itB = L.itemByTitle(titleB); L.assert(itB, 'the second assignment was not saved'); W.state.j12b = itB.id;
    const actB = L.sql(`select activity_id from offering_activities where assignment_offering_id = ${L.lit(itB.id)} limit 1`)[0]?.activity_id || null;
    L.exec([[`insert into submissions (assignment_offering_id, enrollment_id, chosen_activity_id, status) values (${L.lit(itB.id)}, ${L.lit(en)}, ${L.lit(actB)}, 'draft')`, null]]);
    const count = (id) => L.sql(`select count(*) n from assignment_offerings where id = ${L.lit(id)}`)[0].n;
    const openRemove = async (title) => {
      await d.go('faculty/items.html'); await d.untilSel('#items-table');
      await d.page.evaluate((t) => [...document.querySelectorAll('#items-table tbody tr')].find(r => r.innerText.includes(t)).querySelector('[data-remove]').click(), title);
      await d.untilSel('#rm-modal.open');
      await d.until(/submission/, { sel: '#rm-info' });
    };
    const holdIt = async () => {
      const box = await (await d.page.$('#rm-hold')).boundingBox();
      await d.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await d.page.mouse.down();
      await L.wait(5600);
      await d.page.mouse.up();
      await d.page.waitForFunction(() => !document.getElementById('rm-modal').classList.contains('open'), { timeout: 15000 });
      await L.wait(1500);
    };
    // Open for the first (J11), cancel, and also close by Escape once more, then open for the second and hold.
    await openRemove('ZZ walk J11 merge');
    await d.page.evaluate(() => document.querySelector('#rm-modal [data-close].btn').click());
    await d.page.evaluate((t) => [...document.querySelectorAll('#items-table tbody tr')].find(r => r.innerText.includes(t)).querySelector('[data-remove]').click(), 'ZZ walk J11 merge');
    await d.untilSel('#rm-modal.open');
    await d.page.keyboard.press('Escape');
    L.assert(!(await d.exists('#rm-modal.open')), 'Escape did not close');
    await d.page.evaluate((t) => [...document.querySelectorAll('#items-table tbody tr')].find(r => r.innerText.includes(t)).querySelector('[data-remove]').click(), titleB);
    await d.untilSel('#rm-modal.open');
    await d.until(/submission/, { sel: '#rm-info' });
    L.assert(/ZZ walk J12 second/.test(await d.text('#rm-msg')), 'the dialog is not showing the second assignment');
    await holdIt();
    L.eq(count(itB.id), 0, 'the held button should have removed the assignment the dialog showed');
    L.eq(count(W.state.j11), 1, 'one hold must not remove the assignment that was opened and cancelled earlier');
    L.eq(L.sql(`select count(*) n from submissions where assignment_offering_id = ${L.lit(W.state.j11)}`)[0].n, 1, 'its work must still be there');
    // holding for the full time on the first deletes it, with its work
    await openRemove('ZZ walk J11 merge');
    await holdIt();
    L.eq(count(W.state.j11), 0, 'the held button should have removed it');
    L.eq(L.sql(`select count(*) n from submissions where assignment_offering_id = ${L.lit(W.state.j11)}`)[0].n, 0, 'its work goes with it');
  }, { needs: ['J11'] });

  await L.check('J13', 'director: Preview shows the typed questions as a cadet sees them, for an assignment from either page', async () => {
    await d.go('faculty/items.html'); await d.untilSel('#items-table');
    await d.page.evaluate((t) => [...document.querySelectorAll('#items-table tbody tr')].find(r => r.innerText.includes(t)).querySelector('[data-prev]').click(), OLDER);
    await d.untilSel('#preview-modal.open');
    const t = await d.text('#preview-body');
    L.assert(/Q3/.test(t) && /TEST QUESTION/.test(t), 'the questions are not shown: ' + t.slice(0, 120));
    L.assert(await d.exists('#preview-body img'), 'the figure is not shown');
    L.assert(await d.page.$$eval('#preview-body textarea', els => els.length && els.every(e => e.disabled)), 'the boxes should be read-only');
    await d.page.evaluate(() => document.querySelector('#preview-modal [data-close].btn').click());
    L.assert(!(await d.exists('#preview-modal.open')), 'close did not close');
  });

  await L.check('J14', 'director: an assignment with a typed response and a tutor offers the access setting, and its prefill link opens it', async () => {
    const it = L.itemByTitle('Test Lesson 6: Current'); L.assert(it, 'seed lesson 6 missing');
    await d.go('faculty/lessons.html?a=' + it.id);
    await d.page.waitForFunction(() => /faculty\/items\.html/.test(location.href), { timeout: 15000 });
    await d.untilSel('#item-modal.open'); await L.wait(800);
    L.assert(await d.visible('#i-access-wrap'), 'the access setting is not offered');
    L.eq(await d.page.$eval('#i-access', e => e.checked), false, 'it must start as the item stored it (open)');
  });
  await d.close();

  const ins = await L.Session.start(W.browser, W.base, L.staffLogin(W.seed, 'instructor'));
  await L.check('J6', 'instructor: Assignments opens read-only, with Grade assignments for every staff member', async () => {
    await ins.go('faculty/items.html');
    await ins.until(/Only directors change assignments/);
    L.assert(await ins.exists('#grade-assignments-btn'), 'no Grade assignments button');
    L.assert(!(await ins.exists('#new-btn')) && !(await ins.exists('[data-edit]')) && !(await ins.exists('[data-remove]')), 'a write control is on the page');
    // an address that asks to add or open an assignment is answered in words, and still shows the read-only list
    await ins.go('faculty/items.html?new=1&title=ZZ%20walk%20J6');
    await ins.until(/Only directors add or change assignments\. Ask your course director\./);
    L.assert(await ins.exists('#items-table'), 'the read-only list is missing');
    L.assert(!(await ins.exists('#item-modal.open')) && !(await ins.exists('#dest-modal.open')), 'a form opened for an instructor');
  });
  await ins.close();

  const c = await L.Session.start(W.browser, W.base, L.cadetLogin(W.seed, 105));
  await L.check('J7', 'a cadet in two courses lands on All classes, with work from both, soonest first, and the window respected', async () => {
    await c.page.waitForFunction(() => /student\/summary\.html/.test(location.href), { timeout: 20000 }).catch(() => {});
    L.assert(/student\/summary\.html/.test(c.page.url()), 'landed on ' + c.page.url());
    await c.untilSel('[data-group="classes"]');
    const t = await c.text('main');
    L.assert(t.includes('Physics 215') && t.includes('Physics 120'), 'both courses are named');
    L.assert(t.includes('Test 120 Lesson 1') && t.includes('Test 120 Lesson 2'), 'phys-120 open work is missing');
    L.assert(!t.includes('Test 120 Lesson 3'), 'a lesson outside the 7-day window is listed');
    L.assert(t.indexOf('Test 120 Lesson 2') < t.indexOf('Test 120 Lesson 1'), 'not soonest first');
    const blocks = await c.page.$$eval('[data-group="classes"] [data-course]', els => els.length);
    L.eq(blocks, 2, 'class blocks');
    const labels = await c.page.$$eval('#nav-links a', as => as.map(a => a.innerText.trim()));
    L.eq(labels[0], 'All classes', 'first link');
  });
  await L.check('J8', 'a summary row opens that assignment in that class', async () => {
    await c.page.evaluate(() => [...document.querySelectorAll('a.list-item')].find(a => a.innerText.includes('Test 120 Lesson 2')).click());
    await c.page.waitForFunction(() => /student\/lessons\.html/.test(location.href), { timeout: 15000 });
    await c.until(/Test 120 Lesson 2/, { sel: 'main' });
    // the page tidies its own address, so the class is read from the header's course name
    const hdr = await c.text('header, #topnav, nav');
    L.assert(/Physics 120|phys-120/.test(hdr), 'not in the phys-120 class: ' + hdr.replace(/\s+/g, ' ').slice(0, 200));
  }, { needs: ['J7'] });
  await c.close();
}
