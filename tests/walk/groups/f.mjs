// Group F: meeting days per course. A site admin makes a course that meets W and F, and one left on the default M and T; the sections
// screen offers only the course's days, keeps a day it already holds, and the roster preview names an unlisted day. Synthetic only.
import * as L from '../lib.mjs';
import { SYNTH_ID_LOW } from '../cleanup.mjs';

export async function runF(W) {
  const a = await L.Session.start(W.browser, W.base, L.staffLogin(W.seed, 'admin'));
  const term = L.sql(`select id from terms where code='fall-2026'`)[0].id;
  const days = (code) => L.sql(`select meeting_days from courses where code=${L.lit(code)}`)[0]?.meeting_days;
  const offeringOf = (code) => L.sql(`select co.id from course_offerings co join courses c on c.id=co.course_id where c.code=${L.lit(code)} and co.term_id=${L.lit(term)}`)[0]?.id;
  const sectionDays = (offering, code) => L.sql(`select meeting_days from sections where course_offering_id=${L.lit(offering)} and code=${L.lit(code)}`)[0]?.meeting_days;
  const norm = (v) => [...(Array.isArray(v) ? v : String(v || '').replace(/[{}]/g, '').split(',').filter(Boolean))].sort();

  const makeCourse = async (code, titleText, openMore, pick) => {
    await a.go('faculty/terms.html'); await a.untilSel('#sec-setup');
    await a.page.$eval('#su-cm-new', e => e.click());
    await a.set('#su-ccode', code); await a.set('#su-ctitle', titleText);
    const moreOpenAtStart = await a.page.$eval('#su-c-more', e => e.open);
    L.assert(moreOpenAtStart === false, 'the meeting-days box is open before anyone asked for it');
    const hint = await a.page.$eval('#su-c-more', e => e.textContent);
    L.assert(/M and T is the split schedule/.test(hint), 'the hint does not explain M and T: ' + hint.slice(0, 160));
    const defaults = await a.page.$$eval('.su-c-day:checked', els => els.map(e => e.value).sort());
    L.eq(defaults, ['M', 'T'], 'days ticked by default');
    if (openMore) {
      await a.page.$eval('#su-c-more', e => { e.open = true; });
      await a.page.$$eval('.su-c-day', (els, want) => els.forEach(e => { if (e.checked !== want.includes(e.value)) e.click(); }), pick);
    }
    await a.page.select('#su-term', term);
    await a.click('#su-go');
    await a.page.waitForFunction(() => document.getElementById('setup-done') || document.getElementById('setup-error'), { timeout: 30000 });
    const err = await a.exists('#setup-error') ? await a.text('#setup-error') : '';
    L.assert(!err, 'set-up refused: ' + err);
  };

  await L.check('F1', 'site admin: a course set to W and F under More options (closed at first) is stored with those days', async () => {
    await makeCourse('zz-walk-wf', 'ZZ walk W F course', true, ['W', 'F']);
    L.eq(norm(days('zz-walk-wf')), ['F', 'W'], 'stored meeting days');
    L.assert(offeringOf('zz-walk-wf'), 'no offering was made');
  });
  await L.check('F2', 'site admin: a course left on the default is stored as M and T', async () => {
    await makeCourse('zz-walk-mt', 'ZZ walk M T course', false, []);
    L.eq(norm(days('zz-walk-mt')), ['M', 'T'], 'stored meeting days');
  });

  const switchTo = async (offering) => {
    await a.go('faculty/admin.html'); await a.untilSel('.subtabs');
    await a.page.waitForSelector(`.course-opt[data-course="${offering}"]`);
    await a.page.$eval(`.course-opt[data-course="${offering}"]`, e => e.click());
    await L.wait(1500);
    await a.page.$eval('[data-tab="staff"]', e => e.click());
    await a.untilSel('#sec-add', { timeout: 30000 });
  };
  const openAdd = async () => { await a.click('#sec-add'); await a.untilSel('#ns-code', { visible: true }); await L.wait(500); };
  const offered = () => a.page.$$eval('.ns-day', els => els.map(e => e.value));
  const createSection = async (code, tickDays) => {
    await openAdd();
    await a.page.type('#ns-code', code);
    await L.wait(300);
    const ticked = await a.page.$$eval('.ns-day:checked', els => els.map(e => e.value));
    if (tickDays) await a.page.$$eval('.ns-day', (els, want) => els.forEach(e => { if (e.checked !== want.includes(e.value)) e.click(); }), tickDays);
    await a.click('#mk-ok');
    await a.page.waitForFunction(() => !document.getElementById('mk-modal').classList.contains('open'), { timeout: 20000 }).catch(() => {});
    await L.wait(800);
    return ticked;
  };

  await L.check('F3', 'Add section on the W and F course offers only W and F', async () => {
    await switchTo(offeringOf('zz-walk-wf'));
    await openAdd();
    L.eq((await offered()).sort(), ['F', 'W'], 'days offered');
    L.assert(/This course meets W and F/.test(await a.text('#ns-days-hint')), 'the hint does not say which days: ' + await a.text('#ns-days-hint'));
    await a.page.$eval('#mk-modal [data-close]', e => e.click()).catch(() => {});
  }, { needs: ['F1'] });

  await L.check('F4', 'a section is made with a listed day and the database holds it', async () => {
    const t = await createSection('W1A', ['W']);
    L.eq(norm(sectionDays(offeringOf('zz-walk-wf'), 'W1A')), ['W'], 'stored section days');
  }, { needs: ['F3'] });

  await L.check('F5', 'a section whose code reads as another day keeps that day, is marked as outside the list, and still holds it after a reload', async () => {
    await openAdd();
    await a.page.type('#ns-code', 'M1A'); await L.wait(400);
    const extra = await a.page.$eval('#ns-days', e => e.innerText);
    L.assert(/not in the course's list/.test(extra), 'the extra day is not marked: ' + extra.replace(/\s+/g, ' '));
    L.assert((await a.page.$$eval('.ns-day:checked', els => els.map(e => e.value))).includes('M'), 'M is not ticked');
    await a.click('#mk-ok');
    await a.page.waitForFunction(() => !document.getElementById('mk-modal').classList.contains('open'), { timeout: 20000 }).catch(() => {});
    await L.wait(1000);
    L.eq(norm(sectionDays(offeringOf('zz-walk-wf'), 'M1A')), ['M'], 'stored section days');
    await a.page.reload({ waitUntil: 'networkidle2' }); await L.wait(800);
    await a.page.$eval('[data-tab="staff"]', e => e.click()); await a.untilSel('#sec-add', { timeout: 30000 });
    const t = await a.text('main');
    L.assert(/Meets M\b[^.]*not in the course's list/s.test(t.replace(/\s+/g, ' ')), 'the section screen does not show M as outside the list');
    L.eq(norm(sectionDays(offeringOf('zz-walk-wf'), 'M1A')), ['M'], 'section days after the reload');
  }, { needs: ['F3'] });

  await L.check('F6', 'the roster preview names an unlisted day for a new section and does not block the import', async () => {
    await a.page.$eval('[data-tab="students"]', e => e.click());
    await a.untilSel('#paste-text', { timeout: 30000 });
    await a.page.$eval('#imp', e => { e.open = true; }); await a.page.$eval('#paste-box', e => { e.open = true; });
    const id = (n) => SYNTH_ID_LOW + n;
    const text = ['Cadet EMPLID,Cadet Name,Email,Section',
      `${id(11)},"Walkone, Zz",zz-walk-one@prep-staging.example,T3A`,
      `${id(12)},"Walktwo, Zz",zz-walk-two@prep-staging.example,W2B`].join('\n');
    await a.page.$eval('#paste-text', (e, v) => { e.value = v; }, text);
    await a.click('#paste-check');
    await a.untilSel('#imp-days-note', { timeout: 30000 });
    const note = await a.text('#imp-days-note');
    L.assert(/T3A would meet on Tuesday \(T\), which is not one of this course's meeting days/.test(note), 'note: ' + note);
    L.assert(!/W2B/.test(note), 'a listed day was flagged');
    L.assert(/It will still be created and imported/.test(note), 'the note does not say the import goes ahead');
    L.assert(await a.page.evaluate(() => { const b = [...document.querySelectorAll('#csv-preview button')].find(x => /Create|Import/.test(x.innerText)); return !!b && !b.disabled; }), 'no enabled import control in the preview');
    // nothing is imported: close the preview and check the course has no enrollments from these rows
    L.eq(L.sql(`select count(*) n from students where student_id between ${id(11)} and ${id(12)}`)[0].n, 0, 'students written by a preview');
  }, { needs: ['F3'] });

  await L.check('F7', 'the explanation in the preview of default meeting days does not contradict itself', async () => {
    const t = await a.text('#csv-preview');
    L.assert(/Each new section starts with/.test(t), 'the explanation is not on screen');
    if (/not a day letter followed by a digit \(such as M1A\)/.test(t)) {
      L.fault({ id: 'P3', login: 'admin', steps: 'Course Admin > Students > paste roster rows naming a new section > Check these rows > read the grey line under "Create this section".',
        expected: 'An example of a code that gets no meeting days, such as LAB-3.', actual: 'The line reads: "A code that is not a day letter followed by a digit (such as M1A) gets no meeting days". M1A is a day letter followed by a digit, and it does get a day, so the example says the opposite of the rule.',
        where: 'site/faculty/admin.html:693' });
      throw new Error('the explanation uses M1A as its example of a code with no day');
    }
  }, { needs: ['F6'] });

  await L.check('F8', 'Add section on the default course offers M and T', async () => {
    await switchTo(offeringOf('zz-walk-mt'));
    await openAdd();
    L.eq((await offered()).sort(), ['M', 'T'], 'days offered');
    await a.page.$eval('#mk-modal [data-close]', e => e.click()).catch(() => {});
  }, { needs: ['F2'] });
  await a.close();
}
