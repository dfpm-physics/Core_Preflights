// Group E: Reports. The nav entry for a director and an instructor, the picker, one report, what an instructor may see, and the course switch.
import * as L from '../lib.mjs';

const PHYS110 = 'd52bf8a8-2325-59ba-a3e5-2521681c916c';

export async function runE(W) {
  const title = W.state.titleA;
  const need = title && L.itemByTitle(title)?.is_published;
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pickerRow = (s, t) => s.page.evaluate((x) => { const tr = [...document.querySelectorAll('#report-list tbody tr')].find(r => r.innerText.includes(x)); return tr ? { text: tr.innerText.replace(/\s+/g, ' '), href: tr.querySelector('a')?.getAttribute('href') || null } : null; }, t);
  // Wait for the bar to be drawn first: read too early, it is empty, and "no Reports link" passes for the wrong reason.
  const navLabels = async (s) => { await s.untilSel('#nav-links a'); return s.page.$$eval('#nav-links a', as => as.map(a => a.innerText.trim())); };

  // ---- Director ----
  const d = await L.Session.start(W.browser, W.base, L.staffLogin(W.seed, 'director'));
  await L.check('E1', 'director: Reports is reached from the dashboard (All reports), and opens a picker listing the term\'s assignments', async () => {
    await d.go('faculty/dashboard.html');
    const labels = await navLabels(d); L.assert(!labels.includes('Reports'), 'nav labels: ' + labels.join(' | '));
    await d.untilSel('#dashReports a[href="report.html"]');
    await d.page.evaluate(() => document.querySelector('#dashReports a[href="report.html"]').click());
    await d.untilSel('#report-list');
    L.assert(!/dashboard\.html/.test(d.page.url()), 'sent to the dashboard');
    const total = await d.page.$$eval('#report-list tbody tr', r => r.length);
    L.assert(total >= 1, 'the picker is empty');
    if (need) L.assert(await pickerRow(d, title), 'the new assignment is not in the picker');
  });
  await L.check('E2', 'director: a report opens from the picker and names its assignment', async () => {
    const r = await pickerRow(d, title); L.assert(r && r.href, 'no Open report link for ' + title);
    L.assert(/Open report/.test(r.text), 'row text: ' + r.text);
    await d.go('faculty/' + r.href);
    await d.until(new RegExp(esc(title)), { sel: '#rm-title' });
    await d.untilSel('#rm-aggregate'); await L.wait(1500);
    W.state.reportDirectorScope = await d.text('#rm-scope');
  }, { needs: ['E1'] });

  // ---- Instructor ----
  const ins = await L.Session.start(W.browser, W.base, L.staffLogin(W.seed, 'instructor'));
  await L.check('E3', 'instructor: Reports is reached from the dashboard and the picker lists the assignment', async () => {
    await ins.go('faculty/dashboard.html');
    const labels = await navLabels(ins); L.assert(!labels.includes('Reports'), 'nav labels: ' + labels.join(' | '));
    L.assert(labels.includes('Assignments'), 'the instructor does not see the Assignments link (read-only since 2026-11-09)');
    await ins.untilSel('#dashReports a[href="report.html"]');
    await ins.page.evaluate(() => document.querySelector('#dashReports a[href="report.html"]').click());
    await ins.untilSel('#report-list');
    if (need) L.assert(await pickerRow(ins, title), 'the assignment is not in the instructor\'s picker');
  });
  await L.check('E4', 'instructor: the report shows only their own section, the director\'s shows more', async () => {
    const r = await pickerRow(ins, title); L.assert(r && r.href, 'no link');
    await ins.go('faculty/' + r.href);
    await ins.until(new RegExp(esc(title)), { sel: '#rm-title' }); await L.wait(2000);
    const scope = await ins.text('#rm-scope'); const body = await ins.text('#report-body');
    L.assert(/M1A/.test(scope + body), 'the instructor does not see their own section M1A');
    for (const other of ['T3A', 'W5A', 'MT7A']) L.assert(!(scope + body).includes(other), `the instructor can see section ${other}`);
    // the director's scope line, read in E2, is allowed to name more than one section
    L.assert(/T3A/.test(String(W.state.reportDirectorScope)) && /M1A/.test(String(W.state.reportDirectorScope)), 'the directors scope control does not name every section: ' + W.state.reportDirectorScope);
  }, { needs: ['E3', 'E2'] });

  // ---- Course switch (site admin sees every course) ----
  const a = await L.Session.start(W.browser, W.base, L.staffLogin(W.seed, 'admin'));
  await L.check('E5', 'switching course re-reads the Reports list (the page stays on Reports)', async () => {
    await a.go('faculty/report.html'); await a.untilSel('#report-picker .page-head');
    // a site admin can see every course, so first choose the course the assignment is in
    await a.page.waitForSelector(`.course-opt[data-course="${L.PHYS215}"]`);
    await a.page.$eval(`.course-opt[data-course="${L.PHYS215}"]`, e => e.click());
    await L.wait(1500); await a.untilSel('#report-list');
    if (need) L.assert(await pickerRow(a, title), 'the assignment is not in the first course\'s list');
    const before = await a.text('#report-picker');
    await a.page.waitForSelector(`.course-opt[data-course="${PHYS110}"]`);
    await a.page.$eval(`.course-opt[data-course="${PHYS110}"]`, e => e.click());
    await a.page.waitForFunction((t) => !document.getElementById('report-picker').innerText.includes(t) || false, { timeout: 20000 }, need ? title : '\u0000never');
    await L.wait(1200);
    L.assert(/report\.html/.test(a.page.url()), 'left the Reports page: ' + a.page.url());
    const after = await a.text('#report-picker');
    L.assert(after !== before, 'the list did not change');
    if (need) L.assert(!after.includes(title), 'the other course\'s list still shows the first course\'s assignment');
    L.assert(/Reports/.test(after), 'the heading is gone');
  });
  for (const s of [d, ins, a]) await s.close();
}
