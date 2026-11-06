// handler.js — the logic of remark-question, with every outside thing passed in, so it runs offline in a test.
// index.ts is only the wiring (Deno server, the service-role client); nothing that decides anything is there.
//
// WHAT THIS FUNCTION IS
//   After a key is corrected, every stored answer to that question is read again with the SAME checker the answer
//   function uses (numeric-answer.js), against the question's CURRENT key. A person calls it twice: a preview that
//   shows what would change and writes nothing, then a commit that carries the token the preview returned.
//
// WHO DECIDES WHAT
//   * Who is calling:        the signed-in session (deps.getUser), never a field of the request.
//   * May they re-mark:      the database (_may_correct_key): a global admin or a director of the question's course.
//   * Is an answer right:    this file, with numeric-answer.js. The database never reads a number.
//   * What is written:       app.remark_apply, in ONE transaction: attempts, the auto_checked grades through the same
//                            calculation record_answer uses, and one key_remark_runs row. A grade that a person has
//                            taken over (any source but auto_checked) is listed and not changed.
//   The request body is read for exactly three fields: question_id, mode ('preview' or 'commit') and, for a commit,
//   preview_token (the token the preview returned). Anything else is ignored.
//   Only attempts in an ACTIVE term are changed. The preview breaks the numbers down by term and lists the terms it refuses.
//
// SAFE TO RUN TWICE
//   An attempt already marked against the current key with the same result is left alone, so a second commit changes 0.
//
// ANSWERS ARE ALWAYS HTTP 200   { ok: true, ... } or { ok: false, code, error }, as the site's other functions do.
// The reply is for staff and carries counts, enrollment ids of listed grades and attempt ids. It never carries the key.

import { parseAnswer, checkNumeric, checkChoices } from './numeric-answer.js';
import { checkSymbolic } from './symbolic-answer.js';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_CHARS = 1000;

export const MESSAGES = {
  not_allowed: 'Only a director of this course in its current term can re-mark its answers.',
  not_found: 'That question was not found.',
  not_auto_checked: 'This question is not checked automatically, so there is nothing to re-mark.',
  no_key: 'This question has no current key.',
  key_unchecked: 'The current key was written by AI and nobody has checked it yet. Check it first.',
  key_changed: 'The key was corrected while this ran. Run the preview again.',
  key_unreadable: 'The current key could not be read by the checker, so nothing was re-marked. Fix the key first.',
  key_fault: 'The current key cannot be read by the checker (no value, too many digits, or no correct choice), so nothing was re-marked. Fix the key first.',
  attempts_moved: 'A student answered while this ran. Run the preview again.',
  changed_since_preview: 'The answers or the key changed since the preview. Run the preview again and confirm what it shows.',
  too_many: 'There are too many students on this question to re-mark in one step. Tell the maintainers.',
  bad_request: 'The request was not valid.',
  busy: 'The system is busy. Try again.',
};

function out(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
const refusal = (code, error) => out({ ok: false, code, error: error || MESSAGES[code] || MESSAGES.busy });

/**
 * One stored attempt -> a verdict { id, is_correct, parsed } where is_correct is null when the checker cannot read the
 * stored answer (that attempt is then left exactly as it is). Returns null when the key itself is unusable.
 */
export function markAttempt(ctx, attempt) {
  const a = attempt.answer;
  if (ctx.format === 'numeric') {
    if (!a || typeof a.raw !== 'string') return { id: attempt.id, is_correct: null, parsed: null };
    const parsed = parseAnswer(a.raw);
    if (!parsed.ok) return { id: attempt.id, is_correct: null, parsed: null };
    const res = checkNumeric(parsed, ctx.key);
    if (res.why === 'key_value_unreadable' || res.why === 'key_tolerance_unreadable') return null;
    return { id: attempt.id, is_correct: res.correct, parsed: parsed.dbText };
  }
  if (ctx.format === 'symbolic') {
    if (!a || typeof a.raw !== 'string') return { id: attempt.id, is_correct: null, parsed: null };
    const res = checkSymbolic(a.raw, ctx.key?.expression, ctx.key?.variables, ctx.key?.signed_variables ?? []);
    if (res.keyFault) return null;                                   // the key itself cannot be read: nothing is re-marked
    if (!res.ok) return { id: attempt.id, is_correct: null, parsed: null };
    return { id: attempt.id, is_correct: res.correct, parsed: null };
  }
  if (ctx.format === 'multiple_choice' || ctx.format === 'multiple_select') {
    if (!a || !Array.isArray(a.choices)) return { id: attempt.id, is_correct: null, parsed: null };
    const res = checkChoices(a.choices, ctx.choice_ids || [], ctx.key?.correct_choice_ids || [], ctx.format);
    if (!res.ok) return { id: attempt.id, is_correct: null, parsed: null };
    return { id: attempt.id, is_correct: res.correct, parsed: null };
  }
  return null;
}

const termRow = (t) => ({
  term: t?.term ?? null, course_offering_id: t?.course_offering_id ?? null, active: t?.active ?? false,
  attempts: t?.attempts ?? 0, would_change: t?.would_change ?? 0, grades_affected: t?.grades_affected ?? 0,
  applied: t?.applied ?? false, reason: t?.reason ?? null,
});

/**
 * deps = {
 *   getUser(jwt)    -> { id } | null       verifies the session
 *   rpc(name, args) -> { data, error }     the service-role client, schema app
 * }
 */
export async function handle(req, deps) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return refusal('bad_request', 'Use POST.');

  let text;
  try { text = await req.text(); } catch { return refusal('bad_request'); }
  if (text.length > MAX_BODY_CHARS) return refusal('bad_request', 'That request is too large.');
  let body;
  try { body = JSON.parse(text); } catch { return refusal('bad_request'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return refusal('bad_request');

  const questionId = body.question_id;
  const mode = body.mode;
  if (typeof questionId !== 'string' || !UUID.test(questionId)) return refusal('bad_request', 'The request is missing the question.');
  if (mode !== 'preview' && mode !== 'commit') return refusal('bad_request', 'Say whether this is a preview or a commit.');
  let token = null;
  if (mode === 'commit') {
    token = body.preview_token;
    if (typeof token !== 'string' || !/^[0-9a-f]{32}$/.test(token)) {
      return refusal('bad_request', 'A commit must carry the token the preview returned. Run the preview first.');
    }
  }

  const header = req.headers.get('Authorization') || '';
  const jwt = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  if (!jwt) return refusal('not_signed_in', 'Sign in first.');
  let user = null;
  try { user = await deps.getUser(jwt); } catch { user = null; }
  if (!user || typeof user.id !== 'string' || !UUID.test(user.id)) return refusal('not_signed_in', 'Your session has ended. Sign in again.');

  const ctxRes = await deps.rpc('remark_context', { p_auth_user: user.id, p_question: questionId });
  if (ctxRes.error) return refusal('busy');
  const ctx = ctxRes.data;
  if (!ctx || ctx.status !== 'ok') return refusal(ctx?.status || 'not_found');

  const verdicts = [];
  for (const attempt of ctx.attempts || []) {
    const v = markAttempt(ctx, attempt);
    if (v === null) return refusal('key_unreadable');
    verdicts.push(v);
  }

  const res = await deps.rpc('remark_apply', {
    p_auth_user: user.id, p_question: questionId, p_key_version: ctx.key_version_id,
    p_verdicts: verdicts, p_commit: mode === 'commit', p_preview_token: token,
  });
  if (res.error) return refusal('busy');
  const r = res.data;
  if (!r || r.status !== 'ok') {
    const code = r?.status || 'busy';
    return refusal(code);
  }
  // Built field by field so nothing else can ride along.
  return out({
    ok: true, committed: r.committed === true,
    attempts_total: r.attempts_total, attempts_changed: r.attempts_changed,
    now_correct: r.now_correct, now_wrong: r.now_wrong, unreadable: r.unreadable,
    grades_to_recompute: r.grades_to_recompute, grades_listed: r.grades_listed,
    listed: Array.isArray(r.listed) ? r.listed : [],
    sample: Array.isArray(r.sample) ? r.sample : [],
    by_term: Array.isArray(r.by_term) ? r.by_term.map(termRow) : [],
    refused: Array.isArray(r.refused) ? r.refused.map(termRow) : [],
    refused_attempts: r.refused_attempts ?? 0,
    preview_token: typeof r.preview_token === 'string' ? r.preview_token : null,
  });
}
