// Group T: tutorials (2026-11-10). A welcome tour starts by itself once on a first sign-in and does not come back; the off switch stops
// it, and a tour newer than the moment it was turned off shows once more; a cadet gets their own tour; a task tutorial is started from
// Help, highlights the real controls, and ends with the real thing made (a course by the site admin, an assignment by a director);
// "I've got it from here" closes the guide and leaves the page as the person had it; a director opening "create a course" is told who
// does it and is not left at a dead end. Everything it makes is a "zz-walk" course or a "ZZ walk" assignment and is cleaned up with
// the rest. The synced tutorial preference of each login it uses is reset before and after.
import * as L from '../lib.mjs';

export async function runT(W) {
  const tag = W.run.slice(-5).toLowerCase();
  const opts = { tours: true };
  const open = [];                                         // sessions to close
  const start = async (key) => {
    const s = await L.Session.start(W.browser, W.base, L.staffLogin(W.seed, key), opts); open.push(s); return s;
  };
  const startCadet = async (n) => { const s = await L.Session.start(W.browser, W.base, L.cadetLogin(W.seed, n), opts); open.push(s); return s; };

  /* The synced preference of the signed-in person, removed, and this browser's copy with it. Done from a page that never starts a tour. */
  const resetPrefs = async (s, where) => {
    await s.go(where); await L.wait(1500);                 // let any flush from the landing page finish first
    await s.inPage(async (db) => {
      const { data: { user } } = await db.auth.getUser();
      const { data } = await db.from('user_preferences').select('prefs').eq('user_id', user.id).maybeSingle();
      const prefs = { ...(data?.prefs || {}) }; delete prefs['cp.tutorials'];
      const { error } = await db.from('user_preferences').upsert({ user_id: user.id, prefs }, { onConflict: 'user_id' });
      if (error) throw new Error(error.message);
    });
    await s.page.evaluate(() => { localStorage.removeItem('cp.tutorials'); sessionStorage.removeItem('cp.tutorial.run'); });
  };
  const setPrefsInDb = (s, value) => s.inPage(async (db, [v]) => {
    const { data: { user } } = await db.auth.getUser();
    const { data } = await db.from('user_preferences').select('prefs').eq('user_id', user.id).maybeSingle();
    const prefs = { ...(data?.prefs || {}), 'cp.tutorials': JSON.stringify(v) };
    const { error } = await db.from('user_preferences').upsert({ user_id: user.id, prefs }, { onConflict: 'user_id' });
    if (error) throw new Error(error.message);
  }, value);
  const dbPrefs = async (s) => {
    const raw = await s.inPage(async (db) => {
      const { data: { user } } = await db.auth.getUser();
      const { data } = await db.from('user_preferences').select('prefs').eq('user_id', user.id).maybeSingle();
      return data?.prefs?.['cp.tutorials'] ?? null;
    });
    return raw ? JSON.parse(raw) : null;
  };
  const untilPref = async (s, test, what) => {
    const t0 = Date.now(); let p = null;
    while (Date.now() - t0 < 15000) { p = await dbPrefs(s); if (p && test(p)) return p; await L.wait(500); }
    throw new Error(`the saved preference never became ${what}; it is ${JSON.stringify(p)}`);
  };

  const card = (s) => s.page.$eval('.tut-card', e => ({ text: e.innerText.replace(/\s+/g, ' '), title: e.querySelector('.tut-title')?.innerText || '' })).catch(() => null);
  const untilTitle = async (s, title, timeout = 20000) => {
    const t0 = Date.now(); let c = null;
    while (Date.now() - t0 < timeout) { c = await card(s); if (c && c.title === title) return c; await L.wait(250); }
    throw new Error(`waited for the guide to say "${title}"; it says ${c ? `"${c.title}"` : 'nothing'}; page at ${s.page.url().replace(s.base, '')}`);
  };
  const noCard = async (s, ms = 2500) => { await L.wait(ms); return (await s.page.$('.tut-card')) === null; };
  const press = async (s, act) => {
    try { await s.page.waitForSelector(`.tut-card [data-tut="${act}"]`, { timeout: 10000 }); }
    catch { throw new Error(`no "${act}" button on the guide; it says: ${(await card(s))?.text || 'nothing'}`); }
    await s.page.$eval(`.tut-card [data-tut="${act}"]`, e => e.click());
  };
  /** The highlight is drawn: the step's target was found (the card can say the title while it is still waiting for the page). */
  const untilHl = (s) => s.page.waitForFunction(() => { const h = document.querySelector('.tut-hl'); return h && !h.hidden; }, { timeout: 15000 });
  /** The card and the target do not overlap (the card never covers what it points at). */
  const clear = (s, sel) => s.page.evaluate((q) => {
    const c = document.querySelector('.tut-card').getBoundingClientRect();
    const el = [...document.querySelectorAll(q)].find(e => e.getClientRects().length);
    if (!el) return 'no target';
    const t = el.getBoundingClientRect();
    const hit = Math.min(c.right, t.right) - Math.max(c.left, t.left) > 1 && Math.min(c.bottom, t.bottom) - Math.max(c.top, t.top) > 1;
    return hit ? 'the card covers the target' : 'ok';
  }, sel);
  const go = async (s, path) => { await s.go(path); };
  const stepOf = async (s) => (await card(s))?.text.match(/step (\d+) of (\d+)/) || null;

  /* ── 1. the staff welcome tour: once, then never again ─────────────────────── */
  const ins = await start('instructor');
  await resetPrefs(ins, 'faculty/account.html');
  await L.check('T1', 'instructor: the welcome tour starts by itself on the dashboard, highlights the top bar beside it, and ends after its last step', async () => {
    await go(ins, 'faculty/dashboard.html');
    const c = await untilTitle(ins, 'Welcome to PREP');
    L.assert(/step 1 of 7/.test(c.text), 'count: ' + c.text);
    L.assert(await ins.page.$eval('.tut-hl', e => e.hidden), 'a whole-page step dimmed something');
    L.eq((await ins.page.$$('.tut-card')).length, 1, 'cards on the page');
    await press(ins, 'next');
    await untilTitle(ins, 'The top bar');
    L.assert(await ins.page.$eval('.tut-hl', e => !e.hidden && e.getBoundingClientRect().width > 50), 'the top bar is not highlighted');
    L.eq(await clear(ins, '#nav-links'), 'ok', 'card against the bar');
    // Walk to the end. Sections that are not on this dashboard are skipped after a few seconds, so allow for that.
    for (const t0 = Date.now(); Date.now() - t0 < 60000;) {
      const c2 = await card(ins); if (!c2) break;
      if (!(await ins.page.$('.tut-card [data-tut="next"]'))) { await L.wait(500); continue; }
      const label = await ins.page.$eval('.tut-card [data-tut="next"]', e => e.innerText.trim());
      await press(ins, 'next');
      if (label === 'Finish') break;
      await L.wait(300);
    }
    L.assert(await noCard(ins, 1200), 'the guide is still on the page after Finish');
    L.eq(await ins.page.$eval('#tut-root', e => e.children.length).catch(() => 0), 0, 'leftover guide elements');
  });
  await L.check('T2', 'instructor: the tour does not return on a reload, and the choice is saved to the account', async () => {
    await untilPref(ins, p => p.seen.includes('welcome-staff@1'), 'seen');
    await ins.page.reload({ waitUntil: 'networkidle2' });
    L.assert(await noCard(ins, 3000), 'the tour came back on reload');
    const p = await dbPrefs(ins);
    L.eq(p.auto, true, 'automatic tutorials still on'); L.assert(p.seen.includes('welcome-staff@1'), 'not recorded as seen');
  }, { needs: ['T1'] });

  /* ── 2. the off switch ────────────────────────────────────────────────────── */
  await resetPrefs(ins, 'faculty/account.html');
  await L.check('T3', 'turning automatic tutorials off from the tour card closes it, stores the moment, and no tour starts on this or another page', async () => {
    await go(ins, 'faculty/dashboard.html');
    await untilTitle(ins, 'Welcome to PREP');
    L.assert(/Turn off automatic tutorials/.test((await card(ins)).text), 'no off link on an automatic tour');
    await press(ins, 'off');
    L.assert(await noCard(ins, 800), 'the card stayed after turning off');
    const p = await untilPref(ins, q => q.auto === false, 'off');
    L.assert(/^\d{4}-\d{2}-\d{2}$/.test(p.offAt || ''), 'no moment stored: ' + JSON.stringify(p));
    await ins.page.reload({ waitUntil: 'networkidle2' });
    L.assert(await noCard(ins, 2500), 'a tour started after turning tutorials off');
    await go(ins, 'faculty/gradebook.html');
    L.assert(await noCard(ins, 2500), 'the gradebook tour started with tutorials off');
  });
  await L.check('T4', 'a tour newer than the moment tutorials were turned off shows once, says New feature, and offers the switch again', async () => {
    await setPrefsInDb(ins, { auto: false, offAt: '2026-01-01', seen: [] });
    await go(ins, 'faculty/dashboard.html');
    const c = await untilTitle(ins, 'Welcome to PREP');
    L.assert(/New feature/.test(c.text), 'no New feature label: ' + c.text);
    L.assert(/Turn off automatic tutorials/.test(c.text), 'no off link');
    await press(ins, 'leave');                              // leaving marks it seen
    L.assert(await noCard(ins, 800), 'the card stayed after End tour');
    await untilPref(ins, q => q.seen.includes('welcome-staff@1'), 'seen after leaving');
    await ins.page.reload({ waitUntil: 'networkidle2' });
    L.assert(await noCard(ins, 2500), 'the new-feature tour showed a second time');
  }, { needs: ['T3'] });
  await L.check('T5', 'the Account page has the switch and the reset, and they write the same preference', async () => {
    await go(ins, 'faculty/account.html');
    await ins.untilSel('#pf-tutorials');
    L.eq(await ins.page.$eval('#pf-tutorials', e => e.value), 'off', 'switch shows off');
    await ins.select('#pf-tutorials', 'on');
    const on = await untilPref(ins, q => q.auto === true && q.offAt === null, 'on');
    L.assert(on.seen.includes('welcome-staff@1'), 'turning on forgot what was seen');
    await ins.click('#pf-tutorials-reset');
    const cleared = await untilPref(ins, q => q.seen.length === 0, 'cleared');
    L.eq(cleared.auto, true, 'reset changed the switch');
    await go(ins, 'faculty/dashboard.html');
    await untilTitle(ins, 'Welcome to PREP');              // and it shows again
    await press(ins, 'leave');
  }, { needs: ['T4'] });

  /* ── 3. a cadet ───────────────────────────────────────────────────────────── */
  const cad = await startCadet(101);
  await resetPrefs(cad, 'student/account.html');
  await L.check('T6', 'cadet: the welcome tour starts on All classes, is the cadet\'s own, and a reload after ending does not bring it back', async () => {
    await go(cad, 'student/summary.html');
    const c = await untilTitle(cad, 'Welcome to PREP');
    L.assert(/step 1 of 6/.test(c.text), 'count: ' + c.text);
    await press(cad, 'leave');
    await untilPref(cad, p => p.seen.includes('welcome-student@1'), 'seen');
    await cad.page.reload({ waitUntil: 'networkidle2' });
    L.assert(await noCard(cad, 2500), 'the tour came back');
  });
  await L.check('T7', 'cadet: the user menu has Tutorials, Help lists them first, and only the cadet\'s own are offered', async () => {
    await go(cad, 'student/help.html#tutorials');
    await cad.untilSel('#tutorials [data-tutorial-start]');
    const order = await cad.page.evaluate(() => [...document.querySelectorAll('#main > section, #main section.help-group')].map(s => s.id || s.querySelector('h2')?.innerText));
    L.eq(order[0], 'tutorials', 'the Tutorials section is not first: ' + order.join(' | '));
    const ids = await cad.page.$$eval('[data-tutorial-start]', els => els.map(e => e.dataset.tutorialStart));
    L.assert(ids.includes('welcome-student') && ids.includes('task-start-assignment'), 'a cadet tutorial is missing: ' + ids.join(','));
    L.eq([...ids].sort(), ['task-start-assignment', 'welcome-student'], 'the tutorials offered to a cadet');
    L.assert(await cad.page.$eval('#user-menu-pop', e => /Tutorials/.test(e.innerText) && !!e.querySelector('a[href="help.html#tutorials"]')), 'no Tutorials entry in the user menu');
  });
  await L.check('T8', 'cadet: "Start an assignment" highlights the next row and ends on the assignment page', async () => {
    await go(cad, 'student/help.html#tutorials');
    await cad.untilSel('[data-tutorial-start="task-start-assignment"]');
    await cad.click('[data-tutorial-start="task-start-assignment"]');
    await untilTitle(cad, 'Your next assignment');          // sent to All classes, and the guide resumed
    L.assert(/student\/summary\.html/.test(cad.page.url()), 'not on All classes: ' + cad.page.url());
    await untilHl(cad);
    await cad.page.click('.list-item');
    await untilTitle(cad, 'You are in');
    await press(cad, 'next');
    L.assert(await noCard(cad, 800), 'the guide stayed after Finish');
  });

  /* ── 4. a director, and a task that is not theirs to finish ───────────────── */
  const dir = await start('director');
  await resetPrefs(dir, 'faculty/account.html');
  await L.check('T9', 'director: "Create a new course" says who does it, sends them to the page with a link, and shows their own checklist', async () => {
    await go(dir, 'faculty/help.html#tutorials');
    await dir.untilSel('[data-tutorial-start="task-create-course"]');
    await dir.click('[data-tutorial-start="task-create-course"]');
    await untilTitle(dir, 'Who makes a course');
    await press(dir, 'next');
    await dir.untilSel('.tut-goto a');                      // still on Help: the card asks them to go, with a link
    L.assert(/Open Courses and terms/.test(await dir.text('.tut-goto a')), 'no link to the page');
    await dir.page.click('.tut-goto a');
    await untilTitle(dir, 'Your course checklist');
    L.assert(/terms\.html/.test(dir.page.url()), 'not on Courses and terms');
    await press(dir, 'leave');
    L.assert(await noCard(dir, 600), 'the guide stayed');
  });

  /* ── 5. "Add an assignment", as a director, with the real thing at the end ── */
  await L.check('T10', 'director: "Add an assignment" is started from Help, sends them to Assignments, highlights the real buttons, and ends with a saved unpublished assignment', async () => {
    const title = `${W.run} tutorial`;
    W.state.titleT = title;
    await go(dir, 'faculty/help.html#tutorials');
    await dir.untilSel('[data-tutorial-start="task-add-assignment"]');
    await dir.click('[data-tutorial-start="task-add-assignment"]');
    await untilTitle(dir, 'New assignment');
    L.assert(/faculty\/items\.html/.test(dir.page.url()), 'not sent to Assignments');
    await untilHl(dir);
    L.eq(await clear(dir, '#new-btn'), 'ok', 'card against New assignment');
    await dir.page.click('#new-btn');
    await untilTitle(dir, 'The title');
    L.assert(await dir.page.$eval('.tut-card [data-tut="next"]', e => e.disabled), 'Next is on before the title is typed');
    await dir.set('#i-title', title);
    await L.wait(600);
    L.assert(await dir.page.$eval('.tut-card [data-tut="next"]', e => !e.disabled), 'Next stayed off after the title was typed');
    await press(dir, 'next'); await untilTitle(dir, 'The kind');
    await press(dir, 'next'); await untilTitle(dir, 'Points');
    await dir.set('#i-points', '2'); await L.wait(600); await press(dir, 'next');
    await untilTitle(dir, 'The due date'); await press(dir, 'next');
    await untilTitle(dir, 'How cadets do this work');
    await dir.page.click('#i-cards [data-mode]');
    await untilTitle(dir, 'Save it');
    await dir.page.click('#im-save');
    await untilTitle(dir, 'Not published yet', 30000);
    const row = L.itemByTitle(title);
    L.assert(row, 'no assignment in the database'); L.eq(row.is_published, false, 'published');
    await press(dir, 'next');
    L.assert(await noCard(dir, 800), 'the guide stayed after Finish');
  });

  /* ── 6. "Create a new course", as the site admin, ends with a real course ─── */
  const adm = await start('admin');
  await resetPrefs(adm, 'faculty/account.html');
  const code = `zz-walk-tut-${tag}`;
  const course = () => L.sql(`select c.id, c.title, (select count(*) from course_offerings co where co.course_id=c.id) offerings,
      (select bool_or(co.is_active) from course_offerings co where co.course_id=c.id) active from courses c where c.code=${L.lit(code)}`)[0];
  await L.check('T11', 'site admin: "Create a new course" walks the real form, and at the end the course exists and is not active', async () => {
    await go(adm, 'faculty/help.html#tutorials');
    await adm.untilSel('[data-tutorial-start="task-create-course"]');
    await adm.click('[data-tutorial-start="task-create-course"]');
    await untilTitle(adm, 'Open your menu');                // on Help, no page change: the first step is the menu
    L.assert(/faculty\/help\.html/.test(adm.page.url()), 'left Help');
    await adm.page.click('[data-user-toggle]');
    await untilTitle(adm, 'Courses and terms');
    await adm.page.click('#user-menu-pop a[href="terms.html"]');
    await untilTitle(adm, 'The setup form');                // arrived on the page and the guide resumed
    L.assert(/faculty\/terms\.html/.test(adm.page.url()), 'not on Courses and terms');
    await press(adm, 'next'); await untilTitle(adm, 'Make a new course');
    await untilHl(adm);
    L.eq(await clear(adm, '#su-cm-new'), 'ok', 'card against the radio');
    await adm.page.$eval('#su-cm-new', e => e.click());
    await untilTitle(adm, 'The course code');
    await adm.set('#su-ccode', code); await L.wait(600); await press(adm, 'next');
    await untilTitle(adm, 'The course title');
    await adm.set('#su-ctitle', 'ZZ walk tutorial course'); await L.wait(600); await press(adm, 'next');
    await untilTitle(adm, 'Department'); await press(adm, 'next');
    await untilTitle(adm, 'The term');
    const term = L.sql(`select id from terms where code='fall-2026'`)[0].id;
    await adm.page.select('#su-term', term);
    await press(adm, 'next');
    await untilTitle(adm, 'Who directs it'); await press(adm, 'next');
    await untilTitle(adm, 'Set it up');
    L.assert(!course(), 'the course existed before the last button');
    await adm.page.click('#su-go');
    await untilTitle(adm, 'The checklist', 30000);          // advanced by #setup-done appearing, which is the page's own result
    const c = course();
    L.assert(c, 'no course in the database'); L.eq(Number(c.offerings), 1, 'offerings'); L.assert(c.active !== true, 'the new course is already active');
    await press(adm, 'next');
    const last = await untilTitle(adm, 'Your course exists');
    L.assert(/not active yet, so cadets cannot see it/.test(last.text), 'closing words: ' + last.text);
    await press(adm, 'next');
    L.assert(await noCard(adm, 800), 'the guide stayed after Finish');
  });

  /* ── 7. leaving a task keeps the page as it is ────────────────────────────── */
  await L.check('T12', '"I\'ve got it from here" closes the guide, keeps what was typed, makes nothing, and the guide does not return on a reload', async () => {
    await go(adm, 'faculty/help.html#tutorials');
    await adm.untilSel('[data-tutorial-start="task-create-course"]');
    await adm.click('[data-tutorial-start="task-create-course"]');
    await untilTitle(adm, 'Open your menu');
    await adm.page.click('[data-user-toggle]'); await untilTitle(adm, 'Courses and terms');
    await adm.page.click('#user-menu-pop a[href="terms.html"]'); await untilTitle(adm, 'The setup form');
    await press(adm, 'next'); await untilTitle(adm, 'Make a new course');
    await adm.page.$eval('#su-cm-new', e => e.click());
    await untilTitle(adm, 'The course code');
    const code2 = `zz-walk-tut-left-${tag}`;
    await adm.set('#su-ccode', code2);
    const label = await adm.page.$eval('.tut-card [data-tut="leave"]', e => e.innerText.trim());
    L.eq(label, 'I\'ve got it from here', 'leave button for a task');
    await press(adm, 'leave');
    L.assert(await noCard(adm, 800), 'the guide stayed');
    L.eq(await adm.page.$eval('#su-ccode', e => e.value), code2, 'the typed code was lost');
    L.eq(await adm.page.$eval('#su-cm-new', e => e.checked), true, 'the radio was changed');
    L.assert(!L.sql(`select 1 from courses where code=${L.lit(code2)}`).length, 'a course was made');
    await adm.page.reload({ waitUntil: 'networkidle2' });
    L.assert(await noCard(adm, 2500), 'the guide came back on reload');
  }, { needs: ['T11'] });

  // Put every login back to having no tutorial preference, so the next run (or a person trying the tours by hand) starts clean.
  for (const [s, where] of [[ins, 'faculty/account.html'], [cad, 'student/account.html'], [dir, 'faculty/account.html'], [adm, 'faculty/account.html']]) {
    try { await resetPrefs(s, where); } catch (e) { L.record('T99', 'reset a login\'s tutorial preference', 'fail', String(e.message).slice(0, 200)); }
  }
  for (const s of open) await s.close();
}
