// Group A: the director makes an assignment, sets up how cadets do the work, adds a question, publishes it, opens its report.
import * as L from '../lib.mjs';

export async function runA(W) {
  const title = `${W.run} preflight`;
  W.state.titleA = title;
  const tutorSlug = 'zz-walk-tutor-' + W.run.slice(-5).toLowerCase();
  W.state.tutorSlug = tutorSlug;
  const s = await L.Session.start(W.browser, W.base, L.staffLogin(W.seed, 'director'));
  W.state.directorA = s;
  const dueDate = L.fmtDate(L.inDays(5));
  const item = () => L.itemByTitle(title);

  const openRow = async () => {   // close the form if open, reload, press Edit on the row
    await s.go('faculty/items.html');
    await s.untilSel('#items-table');
    await s.page.evaluate((t) => { const tr = [...document.querySelectorAll('#items-table tbody tr')].find(r => r.innerText.includes(t)); tr.querySelector('[data-edit]').click(); }, title);
    await s.untilSel('#item-modal.open');
    await L.wait(500);
  };
  const saveForm = async () => {
    // A save on a saved assignment closes the form; a refusal leaves it open with a message. Wait for one or the other.
    await s.click('#im-save');
    await s.page.waitForFunction(() => !document.getElementById('item-modal').classList.contains('open')
      || getComputedStyle(document.getElementById('im-error')).display !== 'none', { timeout: 30000 });
    await L.wait(700);
    const err = await s.visible('#im-error') ? await s.text('#im-error') : '';
    if (err) throw new Error('the form refused: ' + err.slice(0, 200));
  };
  const selected = () => s.page.$eval('#i-cards .selected', e => e.dataset.mode).catch(() => null);

  await L.check('A1', 'new assignment: saves unpublished and opens for setup with the next-step line', async () => {
    await s.go('faculty/items.html');
    await s.click('#new-btn');
    await s.untilSel('#item-modal.open');
    await s.set('#i-title', title);
    await s.set('#i-points', '2');
    await s.set('#i-alldate', dueDate);
    // 2026-11-09: the chooser is on the new form too, and a preflight gets the four typed-work cards, starting on Instructor-graded questions.
    L.assert(await s.visible('#i-setup'), 'the setup section is not shown on a new form');
    L.eq(await s.page.$$eval('#i-cards [data-mode]', els => els.map(e => e.dataset.mode)), ['ai', 'human', 'tutor', 'both'], 'the cards on a new preflight');
    L.eq(await selected(), 'human', 'the card a new preflight starts on');
    await s.click('#im-save');
    await s.until(/Next: choose how cadets do this work/, { sel: '#im-note' });
    L.eq(await s.text('#im-title'), 'Edit assignment', 'form title after the first save');
    L.assert(await s.visible('#i-setup'), 'the setup section is not shown after the first save');
    L.assert((await s.text('#i-setup')).includes('How cadets do this work'), 'section heading missing');
    const row = item();
    L.assert(row, 'no assignment in the database'); L.eq(row.is_published, false, 'published');
  });

  const dbPaths = () => (item()?.paths || []);
  await L.check('A2', 'Instructor-graded questions card: saved, reopened, and the database holds one typed path with no tutor', async () => {
    await s.click('#i-cards [data-mode="human"]');
    L.eq(await selected(), 'human', 'selected card');
    await saveForm();
    const p = dbPaths();
    L.eq(p.length, 1, 'path count'); L.eq(p[0].delivery, 'typed_response', 'delivery'); L.eq(p[0].modality, 'written', 'modality');
    await openRow();
    L.eq(await selected(), 'human', 'card after reopening');
  }, { needs: ['A1'] });

  await L.check('A3', 'Interactive tutor card: saved, reopened, and the database holds a single tutor path', async () => {
    await s.click('#i-cards [data-mode="tutor"]');
    L.eq(await selected(), 'tutor', 'selected card');
    L.assert(await s.visible('#i-drop'), 'the tutor file drop is not shown');
    await s.page.$eval('#i-hand', e => { e.open = true; });     // the boxes sit under "Enter the details by hand"
    L.assert(await s.visible('#i-islug'), 'tutor id field not shown');
    await s.set('#i-islug', tutorSlug);
    await s.set('#i-iurl', 'https://example.org/zz-walk-tutor');
    await s.set('#i-ititle', `${W.run} tutor`);
    await saveForm();
    const p = dbPaths();
    L.eq(p.length, 1, 'path count'); L.eq(p[0].delivery, 'interactive_tutor', 'delivery'); L.eq(p[0].modality, 'interactive', 'modality'); L.eq(p[0].slug, tutorSlug, 'tutor id');
    W.state.tutorActivityId = p[0].activity_id;
    await openRow();
    L.eq(await selected(), 'tutor', 'card after reopening');
    L.eq(await s.page.$eval('#i-islug', e => e.value), tutorSlug, 'tutor id shown after reopening');
  }, { needs: ['A1'] });

  await L.check('A4', 'Both card, reached from the tutor: saved, reopened, and the database holds a typed path and a tutor path with a choice rule', async () => {
    await s.click('#i-cards [data-mode="both"]');
    L.eq(await selected(), 'both', 'selected card');
    L.assert(await s.visible('#i-twopath'), 'the credit rule is not shown for Both');
    if (await s.page.$eval('#i-islug', e => !e.value)) await s.set('#i-islug', tutorSlug);
    await saveForm();
    const it = item(), p = it.paths;
    if (p.length !== 2) {
      L.fault({ id: 'P1', login: 'director', steps: 'Assignments > Edit an assignment that is set to Interactive tutor and saved > choose the Both card > Save assignment (no dialog appears).',
        expected: 'Two paths: the typed questions and the tutor, with a rule for who chooses.', actual: `The assignment is left with ${p.length} path (${p.map(x => x.delivery).join(', ')}); the tutor is gone and nothing said so.`,
        where: 'site/js/faculty-items.js:1222 (replacesPath is true when the tutor path is swapped for a typed one) and :1433 (the tutor is added back only when the OLD single path was written, which a tutor never is)' });
    }
    L.assert(p.length === 2, `path count: expected 2, got ${p.length}`);
    L.eq(p.map(x => x.delivery).sort(), ['interactive_tutor', 'typed_response'], 'deliveries');
    L.assert(it.switch_policy, 'no switch rule stored');
    const tut = p.find(x => x.delivery === 'interactive_tutor');
    L.eq([tut && tut.activity_id, tut && tut.slug, tut && tut.url], [W.state.tutorActivityId, tutorSlug, 'https://example.org/zz-walk-tutor'], 'the tutor keeps its row, id and link');
    await openRow();
    L.eq(await selected(), 'both', 'card after reopening');
  }, { needs: ['A3'] });

  // The Both card again, reached from the questions path (Both to Questions first, then Questions to Both).
  await L.check('A4b', 'Both card, reached from the questions path: the database holds a typed path and a tutor path with a choice rule', async () => {
    await s.go('faculty/items.html'); await s.untilSel('#items-table');
    await openRow();
    if ((await selected()) !== 'human') { await s.click('#i-cards [data-mode="human"]'); await saveForm(); await openRow(); }
    L.eq(await selected(), 'human', 'card before choosing Both');
    await s.click('#i-cards [data-mode="both"]');
    L.assert(await s.visible('#i-twopath'), 'the credit rule is not shown for Both');
    await s.page.$eval('#i-hand', e => { e.open = true; });
    await s.set('#i-islug', tutorSlug);
    await s.set('#i-iurl', 'https://example.org/zz-walk-tutor');
    await saveForm();
    const it = item(), p = it.paths;
    L.eq(p.map(x => x.delivery).sort(), ['interactive_tutor', 'typed_response'], 'deliveries');
    L.assert(it.switch_policy, 'no switch rule stored');
    await openRow();
    L.eq(await selected(), 'both', 'card after reopening');
  }, { needs: ['A3'] });

  const q = `${W.run} What moves the charge?`;
  await L.check('A5', 'add a question: it is saved into the written path', async () => {
    await s.click('#i-written [data-add="free_response"]');
    const idx = await s.page.$$eval('#i-written textarea[data-f="text"]', els => els.length - 1);
    await s.set(`#i-written textarea[data-q="${idx}"][data-f="text"]`, q);
    await s.set(`#i-written [data-q="${idx}"][data-f="points"]`, '1');
    await saveForm();
    const written = dbPaths().find(x => x.modality === 'written');
    L.assert(written && written.qtexts.includes(q), 'the question is not in the written path');
  }, { needs: ['A4b'] });

  await L.check('A6', 'publish: the box is ticked, saved, and the database says published', async () => {
    await openRow();
    await s.tick('#i-publish', true);
    await saveForm();
    L.eq(item().is_published, true, 'is_published');
    L.assert(s.alerts.every(a => !/not published/i.test(a)), 'an alert said it was not published: ' + s.alerts.join(' | '));
  }, { needs: ['A5'] });

  await L.check('A7', 'the Report link on the row opens that assignment\'s report', async () => {
    await s.go('faculty/items.html');
    await s.untilSel('#items-table');
    const href = await s.page.evaluate((t) => { const tr = [...document.querySelectorAll('#items-table tbody tr')].find(r => r.innerText.includes(t)); const a = [...tr.querySelectorAll('a')].find(x => /^Report/.test(x.getAttribute('aria-label') || x.innerText.trim())); return a ? a.getAttribute('href') : null; }, title);
    L.assert(href, 'no Report link on the published row');
    L.assert(href.includes(encodeURIComponent(item().id)), 'the link names a different assignment: ' + href);
    await s.go('faculty/' + href);
    await s.until(new RegExp(W.run.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), { sel: '#rm-title' });
  }, { needs: ['A6'] });
}
