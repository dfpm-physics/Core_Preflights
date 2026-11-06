// Group H: the six card changes on a saved assignment. Each must do what the card says, and a tutor that stays must keep its row,
// id and link. Nothing is dropped silently.
import * as L from '../lib.mjs';

export async function runH(W) {
  const title = `${W.run} card moves`;
  const slug = 'zz-walk-move-' + W.run.slice(-5).toLowerCase();
  const url = 'https://example.org/zz-walk-move';
  const s = await L.Session.start(W.browser, W.base, L.staffLogin(W.seed, 'director'));
  const item = () => L.itemByTitle(title);
  const paths = () => item()?.paths || [];
  const kinds = () => paths().map(p => p.delivery).sort();
  const openRow = async () => {
    await s.go('faculty/items.html'); await s.untilSel('#items-table');
    await s.page.evaluate((t) => { const tr = [...document.querySelectorAll('#items-table tbody tr')].find(r => r.innerText.includes(t)); tr.querySelector('[data-edit]').click(); }, title);
    await s.untilSel('#item-modal.open'); await L.wait(500);
  };
  const save = async () => {
    await s.click('#im-save');
    await s.page.waitForFunction(() => !document.getElementById('item-modal').classList.contains('open')
      || getComputedStyle(document.getElementById('im-error')).display !== 'none', { timeout: 30000 });
    await L.wait(700);
    const err = await s.visible('#im-error') ? await s.text('#im-error') : '';
    if (err) throw new Error('the form refused: ' + err.slice(0, 200));
  };
  const fillTutor = async () => {
    if (await s.page.$eval('#i-islug', e => !e.value)) await s.set('#i-islug', slug);
    if (await s.page.$eval('#i-iurl', e => !e.value)) await s.set('#i-iurl', url);
  };
  const move = async (mode) => { await openRow(); await s.click(`#i-cards [data-mode="${mode}"]`); if (mode !== 'questions') await fillTutor(); await save(); };
  const tutor = () => paths().find(p => p.delivery === 'interactive_tutor');
  let tutorRow = null;

  await L.check('H0', 'a new assignment starts on the Questions card', async () => {
    await s.go('faculty/items.html'); await s.click('#new-btn'); await s.untilSel('#item-modal.open');
    await s.set('#i-title', title); await s.set('#i-points', '2'); await s.set('#i-alldate', L.fmtDate(L.inDays(6)));
    await s.click('#im-save'); await s.until(/Next: choose how cadets do this work/, { sel: '#im-note' });
    await s.click('#i-cards [data-mode="questions"]'); await save();
    L.eq(kinds(), ['typed_response'], 'paths');
  });
  await L.check('H1', 'Questions to Tutor: the tutor is added and the typed path goes', async () => {
    await move('tutor'); L.eq(kinds(), ['interactive_tutor'], 'paths'); tutorRow = tutor();
    L.eq([tutorRow.slug, tutorRow.url], [slug, url], 'tutor id and link');
  }, { needs: ['H0'] });
  await L.check('H2', 'Tutor to Both: the tutor keeps its row, id and link, and a typed path is added', async () => {
    await move('both'); L.eq(kinds(), ['interactive_tutor', 'typed_response'], 'paths');
    L.eq([tutor().activity_id, tutor().slug, tutor().url], [tutorRow.activity_id, slug, url], 'the tutor');
    L.assert(item().switch_policy, 'no switch rule stored');
  }, { needs: ['H1'] });
  await L.check('H3', 'Both to Tutor: the typed path goes and the tutor keeps its row, id and link', async () => {
    await move('tutor'); L.eq(kinds(), ['interactive_tutor'], 'paths');
    L.eq([tutor().activity_id, tutor().slug, tutor().url], [tutorRow.activity_id, slug, url], 'the tutor');
  }, { needs: ['H2'] });
  await L.check('H4', 'Tutor to Questions: the tutor goes and a typed path is added', async () => {
    await move('questions'); L.eq(kinds(), ['typed_response'], 'paths');
  }, { needs: ['H3'] });
  await L.check('H5', 'Questions to Both: a tutor is added beside the typed path, which stays', async () => {
    const typedId = paths()[0].activity_id;
    await move('both'); L.eq(kinds(), ['interactive_tutor', 'typed_response'], 'paths');
    L.eq(paths().find(p => p.delivery === 'typed_response').activity_id, typedId, 'the typed path is the same row');
  }, { needs: ['H4'] });
  await L.check('H6', 'Both to Questions: the tutor goes and the typed path stays', async () => {
    const typedId = paths().find(p => p.delivery === 'typed_response').activity_id;
    await move('questions'); L.eq(kinds(), ['typed_response'], 'paths');
    L.eq(paths()[0].activity_id, typedId, 'the typed path is the same row');
  }, { needs: ['H5'] });
  await s.close();
}
