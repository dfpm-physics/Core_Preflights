// handler.js — the logic of check-answer, with every outside thing passed in, so it runs offline in a test.
// index.ts is only the wiring (Deno server, the two Supabase clients); nothing that decides anything is there.
//
// WHAT THIS FUNCTION IS
//   One answer in, one right-or-wrong out. The student's browser never receives the key, a score, or anything
//   that depends on the key beyond that one boolean.
//
// WHO DECIDES WHAT
//   * Who the student is:        the signed-in session (deps.getUser), never a field of the request.
//   * Whether the answer may be taken at all (enrolled, published, released, before the deadline or late work
//     allowed, attempts left): the database, in app.answer_context and again, under a lock, in app.record_answer.
//   * Whether the answer is right: this file, with numeric-answer.js and symbolic-answer.js (the same files the site carries), against
//     the key the database hands only to this function.
//   * What is written: app.record_answer, which takes only the raw answer, the number read from it, the verdict
//     and the key version it was marked against. The grade is recomputed there from stored attempts.
//   The request body is read for exactly three things: assignment_offering_id, question_id and answer. Any other
//   field (is_correct, points, score, attempt_no, student_id, enrollment_id, ...) is ignored, not obeyed.
//
// A REFUSED ANSWER IS NOT AN ATTEMPT
//   An unreadable number, an ambiguous comma, a choice that is not on the list: the student is told why and no
//   attempt is stored or counted. The same holds when the QUESTION is at fault: a key the checker cannot read (no value, too
//   many digits, no correct choice) gives 'key_fault', stores nothing, costs no attempt and marks nothing wrong.
//
// ANSWERS ARE ALWAYS HTTP 200
//   { ok: true, correct, attempt_no, attempts_left } or { ok: false, code, error }. The site's other functions do
//   the same, so the browser client never has to unpick a transport error.

import { parseAnswer, checkNumeric, checkChoices, MAX_ANSWER_CHARS } from './numeric-answer.js';
import { checkSymbolic } from './symbolic-answer.js';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_CHARS = 2000;
const MAX_CHOICES = 40;

/** Plain sentences for the database's refusal codes. None of them says anything about the key. */
export const MESSAGES = {
  not_found: 'That question was not found. Reload the page.',
  not_enrolled: 'You are not enrolled in this course.',
  not_open: 'This assignment is not open yet.',
  closed: 'This assignment is closed. The deadline has passed.',
  late_unavailable: 'The deadline has passed, and late work cannot be accepted because the end of the term has not been set. Tell your instructor.',
  key_fault: 'There is a fault in this question, not in your answer. Nothing was counted against you. Tell your instructor.',
  limit_reached: 'You have used all of your attempts on this question.',
  retired: 'This question has been withdrawn.',
  no_key: 'This question cannot be checked yet. Tell your instructor.',
  key_unchecked: 'This question cannot be checked yet. Tell your instructor.',
  not_auto_checked: 'This question is not checked automatically.',
  deadline_unreadable: 'This assignment has no usable deadline. Tell your instructor.',
  key_changed: 'The question was corrected while you answered. Please answer again.',
  busy: 'The system is busy. Please try again.',
};

function out(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
const refusal = (code, error) => out({ ok: false, code, error });

/**
 * deps = {
 *   getUser(jwt)  -> { id } | null          verifies the session
 *   rpc(name, args) -> { data, error }       the service-role client, schema app
 * }
 */
export async function handle(req, deps) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return refusal('method', 'Use POST.');

  let text;
  try { text = await req.text(); } catch { return refusal('bad_request', 'The request could not be read.'); }
  if (text.length > MAX_BODY_CHARS) return refusal('too_large', 'That request is too large.');
  let body;
  try { body = JSON.parse(text); } catch { return refusal('bad_request', 'The request is not valid JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return refusal('bad_request', 'The request is not valid.');

  // The only three fields that are read. Everything else in `body` is dropped on the floor.
  const offeringId = body.assignment_offering_id;
  const questionId = body.question_id;
  const answer = body.answer;
  if (typeof offeringId !== 'string' || !UUID.test(offeringId) || typeof questionId !== 'string' || !UUID.test(questionId)) {
    return refusal('bad_request', 'The request is missing the assignment or the question.');
  }

  const header = req.headers.get('Authorization') || '';
  const jwt = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  if (!jwt) return refusal('not_signed_in', 'Sign in to answer.');
  let user = null;
  try { user = await deps.getUser(jwt); } catch { user = null; }
  if (!user || typeof user.id !== 'string' || !UUID.test(user.id)) return refusal('not_signed_in', 'Your session has ended. Sign in again.');

  for (let round = 0; round < 2; round++) {
    // 1. May this student answer, and what is the key. The database decides the first; the key stays in this scope.
    const ctxRes = await deps.rpc('answer_context', {
      p_auth_user: user.id, p_assignment_offering: offeringId, p_question: questionId,
    });
    if (ctxRes.error) return refusal('busy', MESSAGES.busy);
    const ctx = ctxRes.data;
    if (!ctx || ctx.status !== 'ok') {
      const code = ctx?.status || 'not_found';
      return refusal(code, MESSAGES[code] || MESSAGES.not_found);
    }

    // 2. Read and mark. Nothing is stored yet, and a refusal here costs the student no attempt.
    let rawAnswer, parsedText = null, correct;
    if (ctx.format === 'numeric') {
      if (typeof answer !== 'string') return refusal('bad_answer', 'Type your answer as a number.');
      if (answer.length > MAX_ANSWER_CHARS) return refusal('too_long', `That answer is longer than ${MAX_ANSWER_CHARS} characters.`);
      const parsed = parseAnswer(answer);
      if (!parsed.ok) return refusal(parsed.code, parsed.message);
      const verdict = checkNumeric(parsed, ctx.key);
      if (verdict.why === 'key_value_unreadable' || verdict.why === 'key_tolerance_unreadable') {
        return refusal('key_fault', MESSAGES.key_fault);          // the question is at fault: nothing is stored or counted
      }
      correct = verdict.correct;
      rawAnswer = { raw: answer };
      parsedText = parsed.dbText;
    } else if (ctx.format === 'symbolic') {
      // An expression, checked by evaluating it and the key at fixed test points (symbolic-answer.js). Nothing is executed.
      // A refusal (unknown variable, unbalanced bracket, unclear division) costs no attempt, exactly like an unreadable number.
      if (typeof answer !== 'string') return refusal('bad_answer', 'Type your answer as an expression.');
      const res = checkSymbolic(answer, ctx.key?.expression, ctx.key?.variables, ctx.key?.signed_variables ?? []);
      if (!res.ok) return res.keyFault ? refusal('key_fault', MESSAGES.key_fault) : refusal(res.code, res.message);
      correct = res.correct;
      rawAnswer = { raw: answer };
      parsedText = null;
    } else if (ctx.format === 'multiple_choice' || ctx.format === 'multiple_select') {
      const selected = Array.isArray(answer) ? answer : typeof answer === 'string' ? [answer] : null;
      if (!selected || selected.length > MAX_CHOICES) return refusal('bad_answer', 'Choose an answer.');
      const keyIds = ctx.key?.correct_choice_ids || [];
      const offered = ctx.choice_ids || [];
      if (keyIds.length === 0 || keyIds.some(id => !offered.includes(id))) {
        return refusal('key_fault', MESSAGES.key_fault);
      }
      const res = checkChoices(selected, offered, keyIds, ctx.format);
      if (!res.ok) return refusal(res.code, res.message);
      correct = res.correct;
      rawAnswer = { choices: [...new Set(selected)].sort() };
    } else {
      return refusal('not_auto_checked', MESSAGES.not_auto_checked);
    }

    // 3. Store it. The database re-checks everything under a lock and refuses a key that has moved on.
    const rec = await deps.rpc('record_answer', {
      p_auth_user: user.id, p_assignment_offering: offeringId, p_question: questionId,
      p_answer: rawAnswer, p_parsed: parsedText, p_is_correct: correct, p_key_version: ctx.key_version_id,
    });
    if (rec.error) return refusal('busy', MESSAGES.busy);
    const r = rec.data;
    if (r && r.status === 'key_changed' && round === 0) continue;       // the key was corrected between the two calls
    if (!r || r.status !== 'ok') {
      const code = r?.status || 'busy';
      return refusal(code, MESSAGES[code] || MESSAGES.busy);
    }
    // The whole reply. Built field by field so nothing else can ride along.
    return out({ ok: true, correct: r.correct === true, attempt_no: r.attempt_no, attempts_left: r.attempts_left ?? null });
  }
  return refusal('key_changed', MESSAGES.key_changed);
}
