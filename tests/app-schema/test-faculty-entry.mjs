// test-faculty-entry.mjs — the read/write layer behind the score entry page (site/js/faculty-entry.js).
// No network, no login. A stub client stands in for the database; ids and names are invented.

import { check, eq, section, installBrowser, summary } from './harness.mjs';

installBrowser({ pathname: '/site/faculty/entry.html' });
const E = await import('../../site/js/faculty-entry.js');

const stub = (impl) => {
  const calls = [];
  return { calls, rpc: async (name, args) => { calls.push([name, args]); return impl(name, args); } };
};

section('enterGrades: what the database says about the save');
{
  const db = stub(() => ({ data: { saved: 3, replaced_published: 1 }, error: null }));
  const r = await E.enterGrades(db, 'i1', [{ enrollmentId: 'e1', cents: 850, updatedAt: null }, { enrollmentId: 'e2', cents: 1000, updatedAt: 'v' }]);
  eq('saved and replaced are both reported', r, { saved: 3, replacedPublished: 1 });
  eq('scores go as exact text, with the version the page read', db.calls[0][1].p_rows, [
    { enrollment_id: 'e1', points: '8.5', expect: null }, { enrollment_id: 'e2', points: '10', expect: 'v' }]);
}
{
  const db = stub(() => ({ data: null, error: { message: 'x' } }));
  eq('an error comes back as an error', Object.keys(await E.enterGrades(db, 'i1', [])), ['error']);
}

section('writeSummary: a replaced published score is not called a draft');
eq('all drafts', E.writeSummary({ saved: 3, replacedPublished: 0 }), { kind: 'success', text: 'Saved 3 score(s) as drafts.' });
{
  const s = E.writeSummary({ saved: 3, replacedPublished: 2 });
  check('some replaced', s.kind === 'warn' && /2 of them replaced/.test(s.text) && /live to students/.test(s.text) && /1 .*draft/.test(s.text), s.text);
}
{
  const s = E.writeSummary({ saved: 2, replacedPublished: 2 });
  check('all replaced says none are drafts', /live to students/.test(s.text) && !/as drafts/.test(s.text), s.text);
}

section('publishColumn and publishPreview: the answer comes from the database');
{
  const db = stub(() => ({ data: { published: 4, closed: 2, zeroed: 3, held_ai: 1, close_applies: true }, error: null }));
  const r = await E.publishColumn(db, 'i1', 's1', 'fp-1');
  eq('counts are passed through', r, { published: 4, closed: 2, zeroed: 3, heldAi: 1, closeApplies: true });
  eq('the page sends the preview fingerprint and does not choose to close', db.calls[0], ['publish_column', { p_offering: 'i1', p_section: 's1', p_fingerprint: 'fp-1' }]);
}
{
  const db = stub(() => ({ data: { item_published: false, hand_entered: true, drafts: 2, held_ai: 0, live: 0, close_applies: true, open_sections: 2, sections: 2,
    blank_count: 1, blank_cadets: [{ enrollment_id: 'e1', section_id: 's1' }], waiting_count: 1, fingerprint: 'fp-2', publish_closed_sections: 0, hand_closed_sections: 1 }, error: null }));
  const r = await E.publishPreview(db, 'i1', null);
  eq('the preview is camel-cased and nothing is computed', r.preview, { itemPublished: false, handEntered: true, drafts: 2, heldAi: 0, live: 0, closeApplies: true, openSections: 2, sections: 2,
    blankCount: 1, blankCadets: [{ enrollment_id: 'e1', section_id: 's1' }], waitingCount: 1, fingerprint: 'fp-2', publishClosedSections: 0, handClosedSections: 1 });
}
{
  const db = stub(() => ({ data: null, error: { message: 'boom' } }));
  check('a failed preview is an error, not an empty preview', !!(await E.publishPreview(db, 'i1', null)).error);
}
{
  const db = stub(() => ({ data: { unpublished: 3, reopened: 2, kept_closed: 1 }, error: null }));
  eq('unpublish returns the counts, including the columns it left closed', await E.unpublishColumn(db, 'i1', null), { unpublished: 3, reopened: 2, keptClosed: 1 });
  eq('and reopens by default', db.calls[0], ['unpublish_column', { p_offering: 'i1', p_section: null, p_reopen: true }]);
}

section('publishSummary: publishing nothing is not success');
{
  const s = E.publishSummary({ published: 0, closed: 0, heldAi: 0, closeApplies: false });
  check('nothing at all', s.kind === 'info' && /Nothing was published/.test(s.text), s.text);
}
{
  const s = E.publishSummary({ published: 0, closed: 0, heldAi: 2, closeApplies: true });
  check('only AI drafts, and they are named', s.kind === 'warn' && /2 AI-suggested/.test(s.text) && /grade page/.test(s.text), s.text);
}
{
  const s = E.publishSummary({ published: 3, closed: 2, heldAi: 0, closeApplies: true });
  check('a real publish', s.kind === 'success' && /Published 3/.test(s.text) && /closed 2/.test(s.text), s.text);
}
{
  const s = E.publishSummary({ published: 3, closed: 0, heldAi: 1, closeApplies: true });
  check('a real publish that left an AI draft out says so', s.kind === 'warn' && /Published 3/.test(s.text) && /1 AI-suggested/.test(s.text), s.text);
}
{
  const s = E.publishSummary({ published: 0, closed: 2, heldAi: 0, closeApplies: true });
  check('closing alone is reported as closing', s.kind === 'success' && /closed 2/.test(s.text) && /No scores needed/.test(s.text), s.text);
}
{
  const s = E.publishSummary({ published: 1, closed: 1, zeroed: 4, heldAi: 0, closeApplies: true });
  check('the number of blanks that now count as 0 is said', /4 blank score\(s\) now count as 0/.test(s.text), s.text);
}
{
  check('a changed column gets its own sentence', /changed after the preview/.test(E.plainEntryError({ code: '40001', message: 'publish_column: the column changed since you read the preview; read it again' })));
  check('and so does a publish that skipped the preview', /preview was not confirmed/.test(E.plainEntryError({ message: 'publish_column: this publish would count 3 blank score(s) as 0; read the preview and confirm it first' })));
}

section('afterWrite: a saved change is not hidden by a failed reload');
{
  const ok = { kind: 'success', text: 'Saved 2 score(s) as drafts.' };
  const good = E.afterWrite(ok, { sections: [], items: [] });
  eq('a good reload keeps the data and the note', [!!good.vm, good.banners], [true, [ok]]);
  const bad = E.afterWrite(ok, { error: { message: 'Failed to fetch' } });
  eq('a failed reload keeps no stale data', bad.vm, null);
  check('and still says the save succeeded', bad.banners[0].kind === 'success' && /Saved 2/.test(bad.banners[0].text));
  check('and says the read failed, plainly', bad.banners[1].kind === 'error' && /could not be read back/.test(bad.banners[1].text) && /Reload/.test(bad.banners[1].text), bad.banners[1].text);
}

section('plainEntryError: words for the new refusals');
check('not a plain number', /not a plain number|out of range|cannot be read/i.test(E.plainEntryError({ message: 'enter_grades: a score is not a plain number' })));
check('item not published', /not published to students/.test(E.plainEntryError({ message: 'publish_column: this item is not published to students yet, so publishing its scores would show them nothing' })));
check('not hand entered', /grade page/.test(E.plainEntryError({ message: 'publish_column: this item is not entered by hand or by import; its scores are published from the grade page' })));
check('too large', /out of range/.test(E.plainEntryError({ message: 'enter_grades: a score is too large' })));

section('shapeEntryItem: no second rule about closing');
{
  const it = E.shapeEntryItem({ id: 'i', points_possible: '10.00', is_published: false, offering_activities: [{ delivery: 'in_person', grading: 'hand_entered' }], assignments: { title: 'Q', slug: 'q' } });
  check('the item says whether students can see it', it.published === false);
  check('and carries no copy of the closing rule', !('noSubmission' in it) && !('takesNoSubmission' in E));
}

process.exit(summary() ? 0 : 1);
