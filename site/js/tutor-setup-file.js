// tutor-setup-file.js: read a tutor setup file (format "prep-tutor", version 1) and check it, in plain sentences.
//
// The format is written down in docs/contracts/TUTOR-SETUP-FILE.md. This module only READS and CHECKS: it never touches the page,
// the database or the network, and it saves nothing. The page puts what it returns into the tutor boxes and the director saves.
//
// The rules are the ones the form already enforces, so a file cannot do what typing could not:
//   * the id is lowercase letters, numbers and hyphens (checkForm in faculty-items.js);
//   * the link, when there is one, starts with http:// or https://;
//   * the title is at most 200 characters, the description at most 500 (the box limits);
//   * the assignment number is a whole number from 0 to 32767.
// A file for another course is refused: a tutor id is that course's address, and putting it in the wrong course is a quiet mistake.

export const SETUP_FORMAT = 'prep-tutor';
export const SETUP_VERSION = 1;
export const MAX_FILE_BYTES = 100 * 1024;
export const MAX_OBJECTIVES = 20;

const SLUG_RE = /^[a-z0-9-]+$/;
const KEY_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const refuse = (problem) => ({ ok: false, problem });

/**
 * @param {string} text           the file's text
 * @param {{ course?: string }} page   the course code the page is on (compared without regard to case)
 * @returns {{ ok: true, setup: object } | { ok: false, problem: string }}
 */
export function parseTutorSetup(text, page = {}) {
  if (typeof text !== 'string' || !text.trim()) return refuse('The file is empty.');
  if (text.length > MAX_FILE_BYTES) return refuse('The file is too large to be a tutor setup file.');
  let doc;
  try { doc = JSON.parse(text.replace(/^﻿/, '')); } catch { return refuse('That file could not be read as a tutor setup file. It is not valid JSON.'); }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return refuse('That is not a tutor setup file. It should hold one object.');
  if (doc.format !== SETUP_FORMAT) return refuse(`That is not a tutor setup file. Its "format" should be "${SETUP_FORMAT}".`);
  if (doc.version !== SETUP_VERSION) return refuse(`This file is version ${String(doc.version)}. This page reads version ${SETUP_VERSION} only.`);

  const slug = str(doc.slug);
  if (!slug) return refuse('The file has no tutor id ("slug").');
  if (!SLUG_RE.test(slug) || slug.length > 120) return refuse('The tutor id in the file must be lowercase letters, numbers and hyphens, the same id the lesson posts to.');

  const course = str(doc.course);
  if (!course) return refuse('The file does not say which course it is for ("course").');
  if (page.course && course.toLowerCase() !== String(page.course).trim().toLowerCase()) {
    return refuse(`This file is for ${course}, but this page is on ${page.course}. Choose ${course} from the course menu at the top, or use a file made for ${page.course}.`);
  }

  const title = str(doc.title);
  if (!title) return refuse('The file has no title.');
  if (title.length > 200) return refuse('The title in the file is longer than 200 characters.');

  const description = str(doc.description);
  if (description.length > 500) return refuse('The description in the file is longer than 500 characters.');

  const url = str(doc.url);
  if (url && !/^https?:\/\//i.test(url)) return refuse('The tutor link in the file must start with http:// or https://.');

  let lessonNo = null;
  if (doc.lesson_no != null && doc.lesson_no !== '') {
    const n = typeof doc.lesson_no === 'number' ? doc.lesson_no : Number(String(doc.lesson_no).trim());
    if (!Number.isInteger(n) || n < 0 || n > 32767) return refuse('The lesson number in the file must be a whole number from 0 to 32767.');
    lessonNo = n;
  }

  // Objectives: labelled ones win; keys alone are labelled with the key. A key is kept once.
  const objectives = [];
  const seen = new Set();
  const take = (key, label) => {
    const k = str(key);
    if (!k || seen.has(k)) return null;
    if (!KEY_RE.test(k) || k.length > 80) return `An objective key in the file is not usable: "${k.slice(0, 40)}". Keys are letters, numbers, hyphens and underscores.`;
    seen.add(k); objectives.push({ key: k, label: str(label) || k });
    return null;
  };
  if (doc.objectives != null) {
    if (!Array.isArray(doc.objectives)) return refuse('"objectives" in the file must be a list.');
    for (const o of doc.objectives) { const bad = take(o?.key, o?.label); if (bad) return refuse(bad); }
  }
  if (doc.objective_keys != null) {
    if (!Array.isArray(doc.objective_keys)) return refuse('"objective_keys" in the file must be a list.');
    for (const k of doc.objective_keys) { const bad = take(k, ''); if (bad) return refuse(bad); }
  }
  if (objectives.length > MAX_OBJECTIVES) return refuse(`The file lists ${objectives.length} objectives; at most ${MAX_OBJECTIVES} are allowed.`);

  return { ok: true, setup: { slug, course, title, description, url, lessonNo, objectives } };
}

/** The lines a director sees after a file is read, so nothing is a surprise at Save. */
export function summaryLines(setup) {
  const n = setup.objectives.length;
  return [
    `Title: ${setup.title}`,
    `Tutor id: ${setup.slug}`,
    `Link: ${setup.url || 'none in the file (add it by hand before publishing)'}`,
    `Course: ${setup.course}`,
    `Objectives: ${n === 0 ? 'none in the file' : n === 1 ? '1' : n}`,
  ];
}
