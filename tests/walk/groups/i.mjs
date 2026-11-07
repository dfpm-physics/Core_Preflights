// Group I: the expression answer box. The insert buttons, the typeset reading under the box (KaTeX), the staff reading, and a
// question whose own variable is called e. Question 1 uses the variables m and V; question 2 uses e and V (the rule that a
// question's own variable wins over the constant), which the database trigger from migration 085 refused until it was relaxed.
import * as L from '../lib.mjs';

export async function runI(W) {
  const title = `${W.run} expression`;
  const d = await L.Session.start(W.browser, W.base, L.staffLogin(W.seed, 'director'));
  let itemId = null;

  const addQuestion = async (qid, vars, expr, trial) => {
    await d.go(`faculty/questions.html?a=${itemId}`);
    await d.click('#add-btn'); await d.untilSel('#q-modal.open');
    await d.set('#q-qid', qid); await d.select('#q-format', 'symbolic'); await d.set('#q-points', '1');
    await d.set('#q-prompt', `ZZ walk: ${qid}`);
    await d.set('#q-expression', expr); await d.set('#q-variables', vars);
    await d.set('#q-try', trial);
    await d.click('#q-sym-check');
    await d.page.waitForSelector('#q-sym-out .katex', { timeout: 15000 });
    const t = await d.text('#q-sym-out');
    L.assert(/reads as/.test(t) && /marked right/.test(t), 'the staff reading is missing: ' + t.replace(/\s+/g, ' ').slice(0, 160));
    L.assert(await d.page.$('#q-sym-out .katex .mfrac'), 'no stacked fraction in the staff reading');
    await d.click('#qm-save');
    const re = new RegExp(qid);
    await d.page.waitForFunction((src) => new RegExp(src).test(document.getElementById('main').innerText)
      || getComputedStyle(document.getElementById('qm-error')).display !== 'none', { timeout: 20000 }, qid);
    if (await d.visible('#qm-error')) throw new Error('the question save was refused: ' + (await d.text('#qm-error')).slice(0, 300));
    await d.until(re, { sel: '#main' });
  };

  await L.check('I1', 'director: an expression question with variables m and V is saved, and the editor shows the key typeset', async () => {
    await d.go('faculty/items.html'); await d.untilSel('#new-btn');
    await d.click('#new-btn'); await d.untilSel('#item-modal.open');
    await d.set('#i-title', title); await d.select('#i-kind', 'homework');
    await d.set('#i-alldate', L.fmtDate(L.inDays(2)));
    await d.click('#im-save');
    await d.page.waitForFunction(() => document.getElementById('im-note').innerText.length > 0 || getComputedStyle(document.getElementById('im-error')).display !== 'none', { timeout: 20000 });
    const hw = L.itemByTitle(title); L.assert(hw, 'not saved'); itemId = hw.id;
    await addQuestion('zz-walk-sym1', 'm, V', 'm*V/2', 'V*m/2');
  });
  await L.check('I1b', 'director: a question whose own variable is e (the electron charge) is saved: a question variable wins over the constant', async () => {
    await addQuestion('zz-walk-sym2', 'e, V', 'e*V/2', 'V*e/2');
  }, { needs: ['I1'] });
  await L.check('I1c', 'director: the item is published', async () => {
    await d.go('faculty/items.html'); await d.untilSel('#items-table');
    await d.page.evaluate((tt) => { [...document.querySelectorAll('#items-table tbody tr')].find(r => r.innerText.includes(tt)).querySelector('[data-edit]').click(); }, title);
    await d.untilSel('#item-modal.open'); await L.wait(500);
    await d.tick('#i-publish', true); await d.click('#im-save');
    await d.page.waitForFunction(() => !document.getElementById('item-modal').classList.contains('open') || getComputedStyle(document.getElementById('im-error')).display !== 'none', { timeout: 30000 });
    L.eq(L.itemByTitle(title).is_published, true, 'published');
  }, { needs: ['I1'] });

  const c = await L.Session.start(W.browser, W.base, L.cadetLogin(W.seed, 103));
  const box = 'input[type="text"][data-entry]';           // the first one is question 1
  const btn = (name) => `button[data-ins][aria-label="${name}"]`;
  const clear = () => c.page.$eval(box, e => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await L.check('I2', 'cadet: a button for each variable and each fixed button, constants pi and e included', async () => {
    await c.go(`student/homework.html?a=${itemId}`); await c.untilSel(box);
    L.assert(await c.exists(btn('Insert m')) && await c.exists(btn('Insert V')), 'a variable button is missing');
    for (const n of ['Squared', 'Power', 'Square root', 'Multiply', 'Fraction', 'Plus', 'Minus', 'Brackets', 'Pi', 'The number e']) L.assert(await c.exists(btn(n)), 'no ' + n + ' button');
    L.eq(await c.page.$$eval('button[data-ins]', els => els.every(b => b.type === 'button')), true, 'buttons are type=button');
  }, { needs: ['I1c'] });
  await L.check('I2b', 'cadet: on the question whose variable is e there is a button for that variable and none for the constant', async () => {
    const r = await c.page.evaluate(() => {
      const blocks = [...document.querySelectorAll('.question-block')];
      const b = blocks[1]; if (!b) return null;
      const names = [...b.querySelectorAll('button[data-ins]')].map(x => x.getAttribute('aria-label'));
      return names;
    });
    L.assert(r, 'the second question is not on the page');
    L.assert(r.includes('Insert e') && r.includes('Insert V'), 'a variable button is missing: ' + r.join(', '));
    L.assert(!r.includes('The number e'), 'the constant e button is shown although the question declares e');
    L.assert(r.includes('Pi'), 'the pi button should still be there');
  }, { needs: ['I1b', 'I2'] });
  await L.check('I3', 'cadet: buttons put plain text at the cursor, keep focus in the box, and do not submit', async () => {
    const url = c.page.url();
    await c.page.click(btn('Insert m')); await c.page.click(btn('Multiply')); await c.page.click(btn('Insert V'));
    L.eq(await c.page.$eval(box, e => e.value), 'm*V', 'the box after three clicks');
    L.eq(await c.page.evaluate(() => !!(document.activeElement && document.activeElement.matches('input[type="text"][data-entry]'))), true, 'focus stayed in the box');
    await clear(); await c.page.click(btn('Square root'));
    L.eq(await c.page.$eval(box, e => [e.value, e.selectionStart]), ['sqrt()', 5], 'square root and caret');
    await clear(); await c.page.click(btn('Fraction'));
    L.eq(await c.page.$eval(box, e => [e.value, e.selectionStart]), ['()/()', 1], 'fraction and caret in the top');
    await clear(); await c.page.click(btn('Insert V')); await c.page.click(btn('Squared'));
    L.eq(await c.page.$eval(box, e => e.value), 'V^2', 'squared');
    L.eq(c.page.url(), url, 'the page address after the clicks');
  }, { needs: ['I2'] });
  await L.check('I4', 'cadet: after a click the page holds a rendered .katex element under the box, with a stacked fraction for a division, and markup is never rendered', async () => {
    await clear();
    await c.page.click(btn('Insert m')); await c.page.click(btn('Multiply')); await c.page.click(btn('Insert V'));
    await c.page.type(box, '/2');
    await c.page.waitForSelector('.mx-preview .mx-math .katex', { timeout: 15000 });
    L.assert(await c.page.$('.mx-preview .mx-math .katex .mfrac'), 'no stacked fraction (.mfrac) for a division');
    const t = await c.text('.mx-preview');
    L.assert(/reads as/.test(t), 'the label is missing: ' + t.slice(0, 80));
    await c.page.$eval(box, e => { e.value = 'sqrt(V)'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await c.page.waitForSelector('.mx-preview .katex .sqrt', { timeout: 15000 });
    await c.page.$eval(box, e => { e.value = 'V^2 pi'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await c.page.waitForSelector('.mx-preview .katex .msupsub', { timeout: 15000 });
    await c.page.$eval(box, e => { e.value = 'V <b>x</b>'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await L.wait(300);
    L.eq(await c.page.$eval('.mx-preview', e => e.querySelectorAll('b, .katex').length), 0, 'elements in the preview for text that cannot be read');
  }, { needs: ['I3'] });
  await L.check('I5', 'cadet: an answer built from buttons is marked right by the deployed check-answer, and a wrong one is marked wrong', async () => {
    await clear();
    await c.page.click(btn('Insert V')); await c.page.click(btn('Multiply')); await c.page.click(btn('Insert m')); await c.page.type(box, '/2');
    await c.page.click('button[data-check]');
    const t = await c.until(/Correct\.|Not correct\./, { sel: '[data-reply]' });
    L.assert(/Correct\./.test(t) && !/Not correct/.test(t), 'a right answer built from buttons was not marked right: ' + t.replace(/\s+/g, ' ').slice(0, 120));
    // The page keeps the box and the button locked while it reads the score back; wait for it to unlock before the next answer.
    await c.page.waitForFunction(() => { const b = document.querySelector('button[data-check]'); const i = document.querySelector('input[type="text"][data-entry]'); return b && !b.disabled && i && !i.disabled; }, { timeout: 30000 });
    await clear(); await c.page.type(box, 'm*V');
    await c.page.click('button[data-check]');
    await c.until(/Not correct\./, { sel: '[data-reply]', timeout: 20000 });
  }, { needs: ['I4'] });
  await c.close();
  await d.close();
}
