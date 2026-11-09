// Group K: the "How cadets do this work" chooser depends on the kind of work (2026-11-09), and a tutor can be set up from a file.
// A preflight shows four cards and each saves the pair it names; every other kind shows In class, Auto-graded questions (grayed unless
// the kind is answered on the site) and Done elsewhere; a saved setting that is not one of a kind's cards opens as it was saved and
// is not changed by opening; a tutor setup file dropped on the tutor card fills the boxes and writes nothing until Save.
// Everything it makes is a "ZZ walk" row.
import * as L from '../lib.mjs';

export async function runK(W) {
  const s = await L.Session.start(W.browser, W.base, L.staffLogin(W.seed, 'director'));
  const tag = W.run.slice(-5).toLowerCase();
  const cardIds = () => s.page.$$eval('#i-cards [data-mode]', els => els.map(e => e.dataset.mode));
  const selected = () => s.page.$eval('#i-cards .selected', e => e.dataset.mode).catch(() => null);
  const cardInfo = (id) => s.page.$eval(`#i-cards [data-mode="${id}"]`, e => ({ off: e.classList.contains('is-off'), aria: e.getAttribute('aria-disabled'), title: e.getAttribute('title') || '', text: e.innerText }));
  const openNew = async () => { await s.go('faculty/items.html'); await s.untilSel('#new-btn'); await s.click('#new-btn'); await s.untilSel('#item-modal.open'); };
  // first: the first save of a new assignment leaves the form open with a note; a later save closes it (or shows a refusal).
  const save = async (first = false) => {
    await s.click('#im-save');
    await s.page.waitForFunction((f) => !document.getElementById('item-modal').classList.contains('open')
      || getComputedStyle(document.getElementById('im-error')).display !== 'none'
      || (f && (document.getElementById('im-note').innerText || '').includes('Next: choose')), { timeout: 30000 }, first);
    await L.wait(700);
    const err = await s.visible('#im-error') ? await s.text('#im-error') : '';
    if (err) throw new Error('the form refused: ' + err.slice(0, 200));
  };
  const openRow = async (title) => {
    await s.go('faculty/items.html'); await s.untilSel('#items-table');
    await s.page.evaluate((t) => { const tr = [...document.querySelectorAll('#items-table tbody tr')].find(r => r.innerText.includes(t)); tr.querySelector('[data-edit]').click(); }, title);
    await s.untilSel('#item-modal.open'); await L.wait(500);
  };
  const pairs = (title) => (L.itemByTitle(title)?.paths || []).map(p => `${p.delivery}/${p.grading}`).sort();
  const newItem = async (title, kind) => {
    await openNew(); await s.set('#i-title', title); if (kind) await s.select('#i-kind', kind);
    await s.set('#i-points', '2'); await s.set('#i-alldate', L.fmtDate(L.inDays(6)));
    await save(true);
  };

  await L.check('K1', 'the chooser follows the kind: four cards for a preflight, three for the others, Auto-graded grayed unless homework', async () => {
    await openNew();
    L.eq(await cardIds(), ['ai', 'human', 'tutor', 'both'], 'preflight cards');
    L.eq(await selected(), 'human', 'preflight starts on');
    const names = await s.page.$$eval('#i-cards .choice-title', els => els.map(e => e.innerText));
    L.eq(names, ['AI-graded questions', 'Instructor-graded questions', 'Interactive tutor', 'Both (cadets choose)'], 'the card titles');
    L.assert(await s.visible('#i-setup-info .info-btn'), 'no information control beside the heading');
    await s.select('#i-kind', 'homework');
    L.eq(await cardIds(), ['class', 'auto', 'elsewhere'], 'homework cards'); L.eq(await selected(), 'auto', 'homework starts on');
    L.eq((await cardInfo('auto')).off, false, 'Auto-graded questions is grayed on homework');
    for (const [kind, start] of [['quiz', 'elsewhere'], ['exam', 'class'], ['lab', 'elsewhere'], ['group_project', 'elsewhere']]) {
      await s.select('#i-kind', kind);
      L.eq(await cardIds(), ['class', 'auto', 'elsewhere'], `${kind} cards`); L.eq(await selected(), start, `${kind} starts on`);
      const a = await cardInfo('auto');
      L.assert(a.off && a.aria === 'true', `${kind}: Auto-graded questions is not grayed`);
      L.assert(/Only homework is answered on the site/.test(a.title) && /Only homework is answered on the site/.test(a.text), `${kind}: the reason is missing: ${a.title}`);
      await s.page.$eval('#i-cards [data-mode="auto"]', e => e.click());
      L.eq(await selected(), start, `${kind}: a click on the grayed card changed the setting`);
      L.eq(await s.page.$eval('#i-delivery', e => e.value), start === 'class' ? 'in_person' : 'elsewhere', `${kind}: the delivery moved`);
    }
    await s.select('#i-kind', 'case_study');
    L.eq(await cardIds(), ['ai', 'human', 'tutor', 'both'], 'case study cards (its default delivery is a typed response)');
    await s.select('#i-kind', 'preflight');
    L.eq(await selected(), 'human', 'back on a preflight');
  });

  await L.check('K2', 'a preflight: each of the four cards saves the pair it names', async () => {
    const title = `${W.run} K cards`;
    await newItem(title, 'preflight');                    // saved unpublished, reopened for setup
    L.eq(pairs(title), ['typed_response/human_graded'], 'a new preflight starts as Instructor-graded questions');
    const move = async (id, want, tutor = false) => {
      await s.click(`#i-cards [data-mode="${id}"]`);
      if (tutor) { await s.page.$eval('#i-hand', e => { e.open = true; }); if (await s.page.$eval('#i-islug', e => !e.value)) await s.set('#i-islug', 'zz-walk-k-' + tag); if (await s.page.$eval('#i-iurl', e => !e.value)) await s.set('#i-iurl', 'https://example.org/zz-walk-k'); }
      await save();
      L.eq(pairs(title), want.sort(), `after the ${id} card`);
      await openRow(title);
      L.eq(await selected(), id, `the ${id} card after reopening`);
    };
    await move('ai', ['typed_response/ai_drafted']);
    await move('human', ['typed_response/human_graded']);
    await move('tutor', ['interactive_tutor/effort'], true);
    await move('both', ['interactive_tutor/effort', 'typed_response/ai_drafted'], true);
    L.assert(L.itemByTitle(title).switch_policy, 'Both stored no rule for a cadet who has chosen');
  });

  await L.check('K3', 'homework, a quiz and an exam: each starts on its card and a card saves the pair it names; leaving automatic marking is refused as before', async () => {
    const hw = `${W.run} K homework`;
    await newItem(hw, 'homework');
    L.eq(pairs(hw), ['online_questions/auto_checked'], 'a new homework');
    // switching to or from automatic marking is an existing refusal at Save, and the card now says so before the click
    for (const id of ['class', 'elsewhere']) {
      const c = await cardInfo(id);
      L.assert(c.off && c.aria === 'true', `${id}: not grayed on a saved auto-graded assignment`);
      L.assert(/cannot switch to or from auto-graded questions\. Make a new assignment instead\./.test(c.title) && /Make a new assignment instead/.test(c.text), `${id}: the reason is missing: ${c.title}`);
    }
    L.eq(await selected(), 'auto', 'the saved card should be selected');
    await s.page.$eval('#i-cards [data-mode="class"]', e => e.click());
    L.eq(await selected(), 'auto', 'a click on the locked card changed the setting');
    L.eq(pairs(hw), ['online_questions/auto_checked'], 'a locked card changed the assignment');
    const qz = `${W.run} K quiz`;
    await newItem(qz, 'quiz');
    L.eq(pairs(qz), ['elsewhere/imported'], 'a new quiz');
    await s.click('#i-cards [data-mode="class"]'); await save(); L.eq(pairs(qz), ['in_person/hand_entered'], 'a quiz taken in class');
    await openRow(qz); L.eq(await selected(), 'class', 'In class after reopening');
    await s.click('#i-cards [data-mode="elsewhere"]'); await save(); L.eq(pairs(qz), ['elsewhere/imported'], 'Done elsewhere');
    const ex = `${W.run} K exam`;
    await newItem(ex, 'exam');
    L.eq(pairs(ex), ['in_person/hand_entered'], 'a new exam');
  });

  await L.check('K4', 'homework whose kind is changed to quiz keeps its saved setting: that card is selected and usable, a plain line says it is older, and opening changes nothing', async () => {
    const qz = `${W.run} K older`;
    await newItem(qz, 'homework');
    await s.select('#i-kind', 'quiz');                   // a saved assignment keeps its path when the kind changes
    await save();
    L.eq(pairs(qz), ['online_questions/auto_checked'], 'saved as questions on the site');
    const before = JSON.stringify(L.itemByTitle(qz));
    await openRow(qz);
    L.eq(await selected(), 'auto', 'the saved card is selected');
    const a = await cardInfo('auto');
    L.assert(!a.off && a.aria === null, 'the saved card is grayed');
    L.assert(await s.visible('#i-older') && /older setting/.test(await s.text('#i-older')), 'no plain line about the older setting: ' + await s.text('#i-older'));
    await s.page.$eval('#item-modal [data-close]', e => e.click()); await L.wait(300);
    L.eq(JSON.stringify(L.itemByTitle(qz)), before, 'opening and closing changed the saved assignment');
    await openRow(qz);
    await s.page.$eval('#i-more', e => { e.open = true; });
    await s.select('#i-grading', 'human_graded');
    L.eq(await selected(), 'current', 'an unusual setting is shown as the current setting');
    L.assert(/graded by a person/i.test(await s.text('#i-cards [data-mode="current"]')), 'the current setting is not described');
    await s.page.$eval('#item-modal [data-close]', e => e.click());
  });

  const setupFile = (o) => JSON.stringify({ format: 'prep-tutor', version: 1, slug: `zz-walk-file-${tag}`, course: 'phys-215', title: `${W.run} file tutor`,
    description: 'From a file.', url: 'https://example.org/zz-walk-file', objective_keys: ['zz-key-one', 'zz-key-two'], lesson_no: 7, ...o });
  await L.check('K5', 'a tutor setup file dropped on the tutor card fills the boxes, writes nothing until Save, and Save creates the tutor path', async () => {
    const title = `${W.run} K file`;
    await newItem(title, 'preflight');
    await s.click('#i-cards [data-mode="tutor"]');
    L.assert(await s.visible('#i-drop') && /Drop the tutor setup file here/.test(await s.text('#i-drop')), 'no drop zone on the tutor card');
    L.assert(await s.visible('#i-drop-pick'), 'no Choose file button');
    L.eq(await s.page.$eval('#i-hand', e => e.open), false, 'the hand-entry disclosure should start closed');
    // a file for another course is refused in plain words and fills nothing
    await s.dropFile('#i-drop', 'tutor.json', setupFile({ course: 'phys-110' }), 'application/json');
    await s.until(/is for phys-110, but this page is on phys-215/, { sel: '#i-drop-err' });
    L.eq(await s.page.$eval('#i-islug', e => e.value), '', 'a refused file filled the id');
    await s.dropFile('#i-drop', 'tutor.json', 'not json at all', 'application/json');
    await s.until(/not valid JSON/, { sel: '#i-drop-err' });
    await s.dropFile('#i-drop', 'tutor.json', setupFile({ slug: 'Bad Slug' }), 'application/json');
    await s.until(/lowercase letters, numbers and hyphens/, { sel: '#i-drop-err' });
    // a good file
    await s.dropFile('#i-drop', 'tutor.json', setupFile(), 'application/json');
    await s.until(/Nothing is saved until you click Save/, { sel: '#i-drop-sum' });
    const sum = await s.text('#i-drop-sum');
    L.assert(sum.includes(`zz-walk-file-${tag}`) && sum.includes('Objectives: 2') && sum.includes('phys-215'), 'the summary is missing a field: ' + sum.replace(/\s+/g, ' '));
    L.assert(!(await s.visible('#i-drop-err')), 'the refusal is still showing after a good file');
    await s.page.$eval('#i-hand', e => { e.open = true; });
    L.eq(await s.page.$$eval('#i-islug,#i-iurl,#i-ititle,#i-idesc', els => els.map(e => e.value)), [`zz-walk-file-${tag}`, 'https://example.org/zz-walk-file', `${W.run} file tutor`, 'From a file.'], 'the tutor boxes');
    L.eq(pairs(title), ['typed_response/human_graded'], 'reading the file changed the saved assignment');
    await save();
    const it = L.itemByTitle(title);
    L.assert(it, 'not saved'); L.eq(it.paths.map(p => `${p.delivery}/${p.grading}`), ['interactive_tutor/effort'], 'the tutor path');
    L.eq([it.paths[0].slug, it.paths[0].url], [`zz-walk-file-${tag}`, 'https://example.org/zz-walk-file'], 'the tutor id and link');
    const obj = L.sql(`select objectives from assignments where id = ${L.lit(it.assignment_id)}`)[0].objectives;
    L.eq((Array.isArray(obj) ? obj : JSON.parse(obj)).map(o => o.key), ['zz-key-one', 'zz-key-two'], 'the objectives written with the save');
  });

  await L.check('K6', 'a new assignment is never locked; a saved one grays Auto-graded questions with the reason', async () => {
    const qz = `${W.run} K lock`;
    await newItem(qz, 'homework');                       // saved, auto-graded
    await s.select('#i-kind', 'homework');
    await s.page.$eval('#item-modal [data-close]', e => e.click()); await L.wait(300);
    await openNew(); await s.select('#i-kind', 'homework');
    for (const id of ['class', 'auto', 'elsewhere']) L.assert(!(await cardInfo(id)).off, `a new homework: ${id} is grayed`);
    await s.page.$eval('#item-modal [data-close]', e => e.click());
    const ex = `${W.run} K lock2`;
    await newItem(ex, 'exam');                           // saved, in person
    await openRow(ex);
    const a = await cardInfo('auto');
    L.assert(a.off && a.aria === 'true' && /cannot switch to or from auto-graded questions/.test(a.title), `a saved in-person exam: Auto-graded questions is not locked with the reason: ${a.title}`);
    L.assert(!(await cardInfo('elsewhere')).off, 'Done elsewhere should stay usable on a saved in-person exam');
    await s.page.$eval('#item-modal [data-close]', e => e.click());
  });

  await L.check('K7', 'a prefill link with a tutor opens a new form on the Both card (AI-graded typed side); a tutor-only link on the tutor card; nothing is written', async () => {
    const open = async (query) => {
      await s.go('faculty/items.html?new=1' + query);
      await s.page.waitForFunction(() => document.getElementById('dest-modal')?.classList.contains('open'), { timeout: 20000 });
      await s.page.$eval('#dest-modal [data-dest="new"]', e => e.click());
      await s.untilSel('#item-modal.open'); await L.wait(500);
    };
    const base = `&title=ZZ%20walk%20K7&iurl=${encodeURIComponent('https://example.org/zz-walk-k7')}&pub=0`;
    await open(`&id=zz-walk-k7-${tag}&iid=zz-walk-k7i-${tag}${base}`);
    L.eq(await selected(), 'both', 'a link with a tutor should select Both');
    L.eq(await s.page.$$eval('#i-delivery,#i-grading', els => els.map(e => e.value)), ['typed_response', 'ai_drafted'], 'the typed side it would save');
    L.assert(!(await s.visible('#i-ai-gap')), 'the note shows although every starting question has its guidance');
    await s.page.$eval('#i-written [data-add="free_response"]', e => e.click()); await L.wait(400);
    L.assert(await s.visible('#i-ai-gap') && /description of a good answer/.test(await s.text('#i-ai-gap')), 'no plain note about what an AI-graded question still needs');
    await s.page.$eval('#item-modal [data-close]', e => e.click());
    await open(`&id=zz-walk-k7b-${tag}&iid=zz-walk-k7bi-${tag}&policy=interaction${base}`);
    L.eq(await selected(), 'tutor', 'a tutor-only link should select Interactive tutor');
    L.eq(await s.page.$eval('#i-delivery', e => e.value), 'interactive_tutor', 'the delivery it would save');
    await s.page.$eval('#item-modal [data-close]', e => e.click());
    L.eq(L.sql(`select count(*) n from assignments where title like 'ZZ walk K7%' or slug like 'zz-walk-k7%'`)[0].n, 0, 'a prefill link must not save anything');
  });
  await s.close();
}
