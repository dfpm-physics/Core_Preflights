// test-written-merge.mjs - the page sends only the answers it changed (migration 048, save_written_answers).
// Offline: window.db is a recording stub, nothing reaches the network.
import { check, eq, section, summary, installBrowser } from './harness.mjs';

installBrowser();
const RPCS = [];
const stub = () => {
  const c = {};
  for (const m of ['eq', 'in', 'is', 'not', 'order', 'limit', 'select']) c[m] = () => c;
  c.maybeSingle = () => Promise.resolve({ data: { id: 'sub-1', enrollment_id: 'enr-1', assignment_offering_id: 'off-1',
    status: 'draft', chosen_activity_id: null, submission_activities: [] }, error: null });
  return c;
};
globalThis.window.db = {
  from: stub,
  rpc: (name, args) => { RPCS.push({ name, args }); return Promise.resolve({ data: null, error: null }); },
};
const { saveWrittenAnswers } = await import('../../site/js/student-data.js');
const ctx = { enrollmentIds: ['enr-1'] };

section('only changed answers are sent');
await saveWrittenAnswers(ctx, 'off-1', 'act-1', { q1: 'a', q2: 'b' });
eq('first save sends both', RPCS[0].args.p_patch, { q1: 'a', q2: 'b' });
eq('...through the merge function', RPCS[0].name, 'save_written_answers');
await saveWrittenAnswers(ctx, 'off-1', 'act-1', { q1: 'a', q2: 'b2' });
eq('a later save sends only the changed answer', RPCS[1].args.p_patch, { q2: 'b2' });
const n = RPCS.length;
await saveWrittenAnswers(ctx, 'off-1', 'act-1', { q1: 'a', q2: 'b2' });
eq('nothing changed: no call at all', RPCS.length, n);
await saveWrittenAnswers(ctx, 'off-1', 'act-1', { q1: 'a', q2: '' });
eq('clearing an answer is a change and is sent', RPCS[n].args.p_patch, { q2: '' });
await saveWrittenAnswers(ctx, 'off-1', 'act-2', { q1: 'z' });
eq('another activity has its own base', RPCS[n + 1].args.p_patch, { q1: 'z' });
check('the submission and activity are named', RPCS[0].args.p_submission === 'sub-1' && RPCS[0].args.p_activity === 'act-1');
process.exit(summary() ? 0 : 1);
