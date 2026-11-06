// Group C: Grade assignments. A hand-entered assignment, typed scores, three grade-file formats dropped on the table,
// a wrong file, publishing the column, and what a cadet and the gradebook then show.
import * as L from '../lib.mjs';

const csv = (rows) => rows.map(r => r.map(c => { const t = String(c ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; }).join(',')).join('\r\n') + '\r\n';
const lastFirst = (n) => { const p = n.split(' '); return `${p.slice(1).join(' ')}, ${p[0]}`; };

export async function runC(W) {
  const title = `${W.run} exam`;
  W.state.titleC = title;
  const d = await L.Session.start(W.browser, W.base, L.staffLogin(W.seed, 'director'));
  W.state.directorC = d;
  const cadet = (n) => { const id = n === 999 ? '3009999999' : `3000000${n}`; return { n, id, name: W.seed.cadets[id].name, section: W.seed.cadets[id].section }; };
  const emailOf = (n) => L.sql(`select email from students where student_id=${cadet(n).id}`)[0]?.email || '';
  const grade = (n) => L.sql(`select g.points_earned, g.is_finalized, g.source from grades g join enrollments e on e.id=g.enrollment_id where g.assignment_offering_id=${L.lit(W.state.itemC?.id)} and e.student_id=${cadet(n).id}`);
  const scoreOf = (n) => { const r = grade(n); return r.length && r[0].points_earned !== null ? Number(r[0].points_earned) : null; };
  const rowInput = async (n) => d.page.evaluateHandle((nm) => { const tr = [...document.querySelectorAll('#entry-table tbody tr')].find(r => r.cells[0].innerText.trim() === nm); return tr ? tr.querySelector('.score-in') : null; }, lastFirst(cadet(n).name));

  await L.check('C1', 'director: makes a hand-entered assignment (an exam) due next week, with no scores', async () => {
    await d.go('faculty/items.html'); await d.untilSel('#new-btn');
    await d.click('#new-btn'); await d.untilSel('#item-modal.open');
    await d.set('#i-title', title);
    await d.select('#i-kind', 'exam');
    await d.set('#i-points', '10');
    await d.set('#i-alldate', L.fmtDate(L.inDays(7)));
    await d.click('#im-save');
    await d.page.waitForFunction(() => document.getElementById('im-note').innerText.length > 0 || getComputedStyle(document.getElementById('im-error')).display !== 'none', { timeout: 20000 });
    const err = await d.visible('#im-error') ? await d.text('#im-error') : '';
    L.assert(!err, 'the form refused: ' + err);
    const it = L.itemByTitle(title); L.assert(it, 'not saved'); W.state.itemC = it;
    L.eq(it.paths.map(p => p.grading), ['hand_entered'], 'grading'); L.eq(it.is_published, false, 'published');
    L.eq(L.sql(`select count(*) n from grades where assignment_offering_id=${L.lit(it.id)}`)[0].n, 0, 'grades');
  });

  await L.check('C2', 'Grade assignments: the list shows it with its due date, how it is graded, and what is waiting', async () => {
    await d.go('faculty/entry.html');
    await d.untilSel('#grade-list');
    L.assert((await d.text('.page-head h1')).includes('Grade assignments'), 'page title');
    const row = await d.page.evaluate((t) => { const tr = [...document.querySelectorAll('#grade-list tbody tr')].find(r => r.innerText.includes(t)); return tr ? [...tr.cells].map(c => c.innerText.replace(/\s+/g, ' ').trim()) : null; }, title);
    L.assert(row, 'the assignment is not in the list');
    L.assert(/\d/.test(row[1]), 'no due date: ' + row[1]);
    L.assert(/Scores typed in by staff/.test(row[2]), 'how graded: ' + row[2]);
    L.assert(/no score entered yet/.test(row[3]) && /Not published/.test(row[3]), 'what is waiting: ' + row[3]);
    L.assert(/Open the score table/.test(row[4]), 'no open button: ' + row[4]);
    L.assert((await d.text('nav, #topnav')).includes('Grade assignments'), 'the nav does not say Grade assignments');
  }, { needs: ['C1'] });

  await L.check('C3', 'type scores and save; reload and read them back; the database holds them as drafts', async () => {
    await d.page.evaluate((t) => { [...document.querySelectorAll('#grade-list tbody tr')].find(r => r.innerText.includes(t)).querySelector('[data-open]').click(); }, title);
    await d.untilSel('#entry-table');
    const vals = { 101: '7', 102: '8.5', 103: '9' };
    for (const [n, v] of Object.entries(vals)) { const h = await rowInput(Number(n)); L.assert(h.asElement(), `no row for cadet ${n}`); await h.asElement().type(v); }
    await d.click('#save-btn');
    await d.until(/Saved 3 score\(s\) as drafts/, { sel: '#note' });
    await d.page.reload({ waitUntil: 'networkidle2' }); await d.untilSel('#entry-table');
    for (const [n, v] of Object.entries(vals)) {
      const shown = await d.page.evaluate((nm) => { const tr = [...document.querySelectorAll('#entry-table tbody tr')].find(r => r.cells[0].innerText.trim() === nm); return tr ? [tr.cells[2].innerText.trim(), tr.cells[3].innerText.trim()] : null; }, lastFirst(cadet(Number(n)).name));
      L.eq(shown, [v, 'Draft'], `table row for cadet ${n} after reload`);
      L.eq(scoreOf(Number(n)), Number(v), `stored score for cadet ${n}`);
    }
  }, { needs: ['C2'] });

  // ---- three formats, each dropped as a real file-drop event on the table ----
  const dropAndRead = async (name, text) => {
    await d.click('#imp-btn').catch(() => {});
    await L.wait(300);
    await d.dropFile('#drop-area', name, text);
    await L.wait(600);
  };
  const preview = async () => ({ text: await d.text('#import-panel'), fmt: await d.text('#import-panel .field-hint') });
  const importApply = async () => { await d.click('#imp-apply'); await d.until(/Imported\./, { sel: '#note' }); await d.untilSel('#entry-table'); };

  await L.check('C4', 'WebAssign file: detected, previewed, imported; NS and ND stay blank', async () => {
    const pts = '10';
    const rows = [['Class Report', '', '', '', '', ''], ['', '', '', '', '', ''], ['', '', '', '', '', ''], ['', '', '', '', '', ''],
      ['Name', 'Email', 'Student ID', '', '', '', title], ['', '', '', '', '', '', '"Nov 20, 2026"'], ['', '', '', '', '', '', pts], ['', '', '', '', '', ''], ['', '', '', '', '', ''],
      [lastFirst(cadet(104).name), emailOf(104), cadet(104).id, '', '', '', '8'],
      [lastFirst(cadet(105).name), emailOf(105), cadet(105).id, '', '', '', 'NS'],
      [lastFirst(cadet(106).name), emailOf(106), cadet(106).id, '', '', '', 'ND']];
    // The due-date cell holds a comma, so it is written already quoted; csv() would quote it again.
    const text = rows.map(r => r.map(c => /^"/.test(c) ? c : (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n') + '\r\n';
    await dropAndRead('zz-walk-webassign.csv', text);
    const p = await d.until(/Import preview/, { sel: '#import-panel' });
    L.assert(/Recognised as WebAssign/.test(p), 'format not shown as WebAssign: ' + p.replace(/\s+/g, ' ').slice(0, 200));
    L.assert(/3 row\(s\) in the file, 3 matched to a cadet, 0 not matched\. 1 score\(s\) would change/.test(p), 'preview counts: ' + p.replace(/\s+/g, ' ').slice(0, 300));
    L.assert(/marked NS or ND were left blank/.test(p), 'the NS/ND note is missing');
    const sel = await d.page.$eval('#import-panel select[data-col]', e => e.options[e.selectedIndex].text);
    L.assert(sel.includes(title), 'the file column was not matched to the assignment: ' + sel);
    await importApply();
    L.eq(scoreOf(104), 8, 'cadet 104 score'); L.eq(scoreOf(105), null, 'NS cadet score'); L.eq(scoreOf(106), null, 'ND cadet score');
    L.eq(grade(105).length + grade(106).length, 0, 'grade rows for NS and ND cadets');
  }, { needs: ['C3'] });

  await L.check('C5', 'Teams file: detected, previewed, imported', async () => {
    const text = csv([['First Name', 'Last Name', 'Email Address', title, 'Points', 'Feedback'],
      [cadet(301).name.split(' ')[0], 'Testcadet', emailOf(301), '6', '10', 'ZZ walk note'],
      [cadet(302).name.split(' ')[0], 'Testcadet', emailOf(302), '7', '10', '']]);
    await d.click('#imp-btn').catch(() => {});
    await dropAndRead('zz-walk-teams.csv', text);
    const p = await d.until(/Import preview/, { sel: '#import-panel' });
    L.assert(/Recognised as Teams/.test(p), 'format not shown as Teams: ' + p.replace(/\s+/g, ' ').slice(0, 200));
    L.assert(/2 row\(s\) in the file, 2 matched to a cadet, 0 not matched\. 2 score\(s\) would change/.test(p), 'preview counts: ' + p.replace(/\s+/g, ' ').slice(0, 300));
    await importApply();
    L.eq(scoreOf(301), 6, 'cadet 301'); L.eq(scoreOf(302), 7, 'cadet 302');
  }, { needs: ['C3'] });

  await L.check('C6', 'Gradescope file: detected, previewed, imported; Missing stays blank', async () => {
    const text = csv([['First Name', 'Last Name', 'SID', 'Email', 'Total Score', 'Max Points', 'Status'],
      ['Kai', 'Testcadet', cadet(303).id, emailOf(303), '5', '10', 'Graded'],
      ['Lane', 'Testcadet', cadet(304).id, emailOf(304), '9', '10', 'Graded'],
      ['Marlowe', 'Testcadet', cadet(305).id, emailOf(305), '0', '10', 'Missing']]);
    await dropAndRead('zz-walk-gradescope.csv', text);
    const p = await d.until(/Import preview/, { sel: '#import-panel' });
    L.assert(/Recognised as Gradescope/.test(p), 'format not shown as Gradescope: ' + p.replace(/\s+/g, ' ').slice(0, 200));
    L.assert(/3 row\(s\) in the file, 3 matched to a cadet, 0 not matched\. 2 score\(s\) would change/.test(p), 'preview counts: ' + p.replace(/\s+/g, ' ').slice(0, 300));
    await importApply();
    L.eq(scoreOf(303), 5, 'cadet 303'); L.eq(scoreOf(304), 9, 'cadet 304'); L.eq(scoreOf(305), null, 'Missing cadet');
  }, { needs: ['C3'] });

  await L.check('C7', 'a wrong file is refused in plain words and nothing changes', async () => {
    const before = L.sql(`select count(*) n from grades where assignment_offering_id=${L.lit(W.state.itemC.id)}`)[0].n;
    await dropAndRead('zz-walk-notes.csv', 'colour,size\r\nred,large\r\nblue,small\r\n');
    const e = await d.until(/not a WebAssign, Teams or Gradescope grade export/, { sel: '#import-panel' });
    L.assert(await d.exists('#imp-error'), 'no error box');
    // A real Teams file, read as the wrong format on purpose
    const text = csv([['First Name', 'Last Name', 'Email Address', title, 'Points', 'Feedback'], ['Kai', 'Testcadet', emailOf(303), '1', '10', '']]);
    await dropAndRead('zz-walk-teams2.csv', text);
    await d.until(/Import preview/, { sel: '#import-panel' });
    await d.select('#imp-format', 'gradescope');
    await d.until(/does not look like a Gradescope export\. It looks like Teams/, { sel: '#import-panel' });
    L.eq(L.sql(`select count(*) n from grades where assignment_offering_id=${L.lit(W.state.itemC.id)}`)[0].n, before, 'grade rows after the refusals');
    await d.click('#imp-cancel');
  }, { needs: ['C3'] });

  await L.check('C8', 'publishing the column needs the assignment published first, and says so', async () => {
    const t = await d.until(/not published to students yet/, { sel: '#pub-info' });
    L.assert(await d.page.$eval('#pub-btn', e => e.disabled), 'the Publish button is enabled for an unpublished assignment');
  }, { needs: ['C3'] });

  await L.check('C9', 'publish the column: scores go live, the assignment leaves the list and shows under the finished control', async () => {
    // publish the assignment itself on the Assignments page
    await d.go('faculty/items.html'); await d.untilSel('#items-table');
    await d.page.evaluate((t) => { [...document.querySelectorAll('#items-table tbody tr')].find(r => r.innerText.includes(t)).querySelector('[data-edit]').click(); }, title);
    await d.untilSel('#item-modal.open'); await L.wait(500);
    await d.tick('#i-publish', true);
    await d.click('#im-save');
    await d.page.waitForFunction(() => !document.getElementById('item-modal').classList.contains('open') || getComputedStyle(document.getElementById('im-error')).display !== 'none', { timeout: 30000 });
    L.eq(L.itemByTitle(title).is_published, true, 'assignment published');
    await d.go(`faculty/entry.html?i=${W.state.itemC.id}`); await d.untilSel('#entry-table');
    await d.page.waitForFunction(() => !document.getElementById('pub-btn').disabled, { timeout: 20000 });
    const info = await d.text('#pub-info');
    L.assert(/drafted score\(s\) would be published/.test(info), 'the preview line: ' + info.slice(0, 200));
    await d.click('#pub-btn');
    await d.until(/Published \d+ score\(s\)/, { sel: '#note' });
    const fin = L.sql(`select count(*) n from grades where assignment_offering_id=${L.lit(W.state.itemC.id)} and is_finalized and points_earned is not null`)[0].n;
    L.assert(Number(fin) >= 8, 'published scores in the database: ' + fin);
    // back to the list: the row is gone until the finished control is ticked
    await d.go('faculty/entry.html'); await d.untilSel('main');
    await L.wait(800);
    const hasRow = (t) => d.page.evaluate((x) => !![...document.querySelectorAll('#grade-list tbody tr')].find(r => r.innerText.includes(x)), t);
    L.assert(!(await hasRow(title)), 'the finished assignment is still in the list');
    L.assert(await d.exists('#show-finished'), 'no finished control');
    await d.tick('#show-finished', true); await L.wait(500);
    L.assert(await hasRow(title), 'the assignment is not shown under the finished control');
    const row = await d.page.evaluate((t) => [...document.querySelectorAll('#grade-list tbody tr')].find(r => r.innerText.includes(t)).innerText, title);
    L.assert(/Nothing waiting/.test(row), 'finished row text: ' + row.replace(/\s+/g, ' '));
  }, { needs: ['C3'] });

  await L.check('C10', 'cadet My grades shows the published score', async () => {
    const c = await L.Session.start(W.browser, W.base, L.cadetLogin(W.seed, 101));
    try {
      await c.go('student/grades.html');
      await c.untilSel(`[data-row="${W.state.itemC.id}"]`);
      const badge = await c.page.$eval(`[data-row="${W.state.itemC.id}"] .score-badge`, e => e.innerText.trim());
      L.assert(/^7(\.0+)?\s*\/\s*10$/.test(badge) || /^7\b/.test(badge), 'the score badge reads: ' + badge);
    } finally { await c.close(); }
  }, { needs: ['C9'] });

  await L.check('C11', 'the gradebook agrees with the stored and the cadet-visible score', async () => {
    const cells = await d.inPage(async (db, a) => { const r = await db.rpc('gradebook_cells', { p_course_offering: a[0], p_scope: 'final' }); return r.error ? { error: r.error.message } : r.data.filter(x => x.assignment_offering_id === a[1]).map(x => ({ e: x.enrollment_id, p: x.points_earned, s: x.state })); }, PHYS215_ID(), W.state.itemC.id);
    L.assert(Array.isArray(cells), 'gradebook_cells failed: ' + JSON.stringify(cells));
    const mine = L.sql(`select e.id, e.student_id from enrollments e where e.student_id in (${[101, 102, 103, 104, 301, 302, 303, 304].map(n => cadet(n).id).join(',')})`);
    const want = { 101: 7, 102: 8.5, 103: 9, 104: 8, 301: 6, 302: 7, 303: 5, 304: 9 };
    for (const [n, v] of Object.entries(want)) {
      const enr = mine.find(m => String(m.student_id) === cadet(Number(n)).id); const cell = cells.find(c => c.e === enr.id);
      L.assert(cell, `no gradebook cell for cadet ${n}`); L.eq(Number(cell.p), v, `gradebook points for cadet ${n}`);
    }
    // and the page itself shows the first one
    await d.go('faculty/gradebook.html'); await d.untilSel('table');
    const t = title;
    await d.page.waitForFunction((x) => [...document.querySelectorAll('td.gb-cell')].some(c => (c.title || '').includes(x)), { timeout: 20000 }, t);
    const cellsShown = await d.page.evaluate((x) => [...document.querySelectorAll('td.gb-cell')].filter(c => (c.title || '').includes(x)).map(c => c.innerText.trim().replace(/[?H]$/, '')), t);
    L.assert(cellsShown.includes('7') && cellsShown.includes('8.5') && cellsShown.includes('9'), 'the gradebook page cells for this assignment read: ' + cellsShown.slice(0, 12).join(','));
  }, { needs: ['C9'] });
}
const PHYS215_ID = () => L.PHYS215;
