// faculty-artifacts.js — the artifact library's data layer.
//
// WHAT THIS PAGE IS FOR
//   PREP consumes Claude artifacts; `_builder/` produces them. Everything about how an artifact
//   was made — the objectives it probes, the textbook pages it was grounded in, the source
//   defects the build had to work around, the JSX itself — used to live in a second repository
//   that this site could not read. It now lives in the private `artifact-sources` Storage
//   bucket, and this module is how the page gets at it.
//
// THREE THINGS THE PAGE DOES
//   browse    read index.json per course; drill into build.json + source.jsx per artifact
//   review    accept/reject each objective with a note, written back to review-notes.json
//   register  paste a published artifact URL, get the prefill link that creates its lesson row
//
// WHY STORAGE AND NOT A TABLE
//   A table would need DDL on schema `app`, which is sealed — `prep_app_owner` is NOLOGIN and
//   unsealing is a coordination event (CORE.md §0). Buckets and their policies live in schema
//   `storage` and were applied by the service role, exactly like migration 019. Nothing here
//   writes a row in `app` or `public`.
//
// THE BUCKET IS PRIVATE, SO EVERY FETCH IS AUTHENTICATED
//   No public URLs. `db.storage.from(...).download()` carries the session, and RLS does the rest:
//   read needs `app.is_staff()`, write needs a director. A signed-out request is refused.
//   Note the failure mode — Storage answers `NoSuchBucket` for BOTH a denied request and a
//   mistyped path, so an unexpected "bucket not found" is worth checking the path over before
//   concluding it is a policy problem.
//
//   ONE read here is neither authenticated nor from the bucket: the Gemini backup manifest, a
//   static JSON committed under `site/`. See "the Gemini backup builds" near the foot of this
//   file — including why a failure to read it must never take the artifact list down with it.

import { db } from './supabase.js';

const BUCKET = 'artifact-sources';

/** The courses that have a builder tree.
 *
 *  STILL NOT DERIVED FROM `courses`, for the reason this comment has always given: a course can
 *  exist in PREP with no artifacts, and asking Storage for a prefix that was never written is a
 *  400, not an empty list. Deriving it from STORAGE is the opposite case — a prefix is in the
 *  listing precisely because something was written there, so the answer cannot name a shelf that
 *  is not on the wall.
 *
 *  The value below is the FALLBACK, not the answer. It was the whole answer, hardcoded, until
 *  2026-08-19, and that made onboarding a course a code change to this file — which is how
 *  PHYS 110 came to have five published interactive lessons, no library shelf, and no way for its
 *  author to review an objective. `loadBuilderCourses()` replaces it at page load.
 *
 *  Kept as a fallback rather than an empty array on purpose: a listing that fails must degrade to
 *  the library this page has always shown, never to a page with no courses on it at all. */
export let BUILDER_COURSES = ['phys-215', 'phys-310'];

/**
 * Every course prefix that actually exists in the bucket, newest listing wins.
 *
 * A `_`-prefixed entry is not a course — `_examples/` is PREP's own archived example, kept
 * outside the course prefixes so it never appears in the library as one more lesson
 * (sync_artifacts.py build_payload). The same exclusion lives on the Python side in
 * `local_courses()`; the two must agree, and both say so.
 *
 * NEVER REJECTS. Same rule as `loadBackups()` below: this is how the page decides which shelves
 * to draw, and a failed listing must leave the previous answer standing rather than empty the
 * library. Returns the array it set, so a caller can use the result directly.
 */
export async function loadBuilderCourses() {
  try {
    const { data, error } = await db.storage.from(BUCKET).list('', { limit: 100 });
    if (error) throw new Error(error.message);
    const found = (data || [])
      .filter((e) => e && e.id === null && !e.name.startsWith('_'))   // id === null marks a folder
      .map((e) => e.name)
      .sort();
    if (found.length) BUILDER_COURSES = found;
  } catch {
    /* keep the fallback — see above */
  }
  return BUILDER_COURSES;
}

// ── raw Storage access ───────────────────────────────────────────────────────

async function downloadText(path) {
  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (error) throw new Error(`${path}: ${error.message}`);
  return data.text();
}

async function downloadJSON(path) {
  return JSON.parse(await downloadText(path));
}

/**
 * Fetch an object that CHANGES, bypassing every cache between here and Storage.
 *
 * Storage stamps uploads with `Cache-Control: max-age=3600` by default, and `download()` is an
 * ordinary GET, so the browser will happily serve an hour-old copy. For `source.jsx` and
 * `build.json` that is exactly what you want — they are rewritten only by a re-ingest. For the
 * two objects this page WRITES it is a correctness bug, and it showed up in the nastiest
 * possible form: a saved review decision read back as the previous revision, so the save was
 * reported to the reviewer as failed while having actually landed.
 *
 * A signed URL fetched with `cache: 'no-store'` is the way out. Setting `cacheControl: '0'` on
 * upload is NOT sufficient on its own — it fixes future responses, while the copy already in the
 * browser's cache stays valid until it expires.
 */
async function downloadFresh(path) {
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 60);
  if (error) throw new Error(`${path}: ${error.message}`);
  const resp = await fetch(data.signedUrl, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`${path}: ${resp.status}`);
  return resp.json();
}

/** One course's library index — everything the list view needs, in a single request.
 *  Fetched fresh: the Register panel writes a published URL back into it. */
export async function loadIndex(course) {
  return downloadFresh(`${course}/index.json`);
}

/** One artifact's full build record: the parsed BUILD-LOG section, the JSX parameters, and the
 *  raw markdown of that section so nothing is lost to a parser that did not understand it. */
export async function loadBuild(course, slug) {
  return downloadJSON(`${course}/${slug}/build.json`);
}

/** The `.jsx` itself. 115–250 KB, so this is fetched on demand and never as part of the list. */
export async function loadSource(course, slug) {
  return downloadText(`${course}/${slug}/source.jsx`);
}

// ── the review sidecar ───────────────────────────────────────────────────────

const reviewPath = (course) => `${course}/review-notes.json`;

export async function loadReviews(course) {
  try {
    // Fresh, always — this is the object the page writes, and a cached read here is what made a
    // successful save look like a lost update. See downloadFresh.
    return await downloadFresh(reviewPath(course));
  } catch (err) {
    // ONLY a genuinely absent sidecar becomes the empty shape. Catching everything here was a
    // bug with real consequences: a failed read returned `revision: 0`, the save's confirmation
    // step compared against that, and a write that had landed was reported as lost. A read that
    // fails for any other reason must say so.
    if (/not.?found|404|does not exist/i.test(String(err.message))) {
      return { schema: 1, course, revision: 0, artifacts: {} };
    }
    throw err;
  }
}

/**
 * Apply a change to a course's review sidecar.
 *
 * THREE RULES, CARRIED OVER FROM THE LOCAL TOOL THAT USED TO OWN THIS FILE:
 *
 *  1. MERGE, NEVER CLOBBER. `mutate` is handed a FRESH read, not the copy the page was
 *     rendered from. A second tab, or a reload after a crash, cannot silently drop earlier
 *     decisions — the only thing that can be lost is a field two people edited simultaneously.
 *
 *  2. EVERY NOTE CARRIES THE `sha` OF THE PROSE IT WAS JUDGED AGAINST. A rebuilt artifact
 *     changes that prose, and the note then reads as stale rather than as current advice about
 *     text that no longer exists.
 *
 *  3. EVERY DECISION IS ATTRIBUTED. The seeded entries carry `by: "published <date>"`, meaning
 *     an approval INFERRED from the fact that somebody published the artifact. A decision made
 *     on this page carries the reviewer's name. That distinction is the whole point of the
 *     field: only the second kind records that a human actually read the prose.
 *
 * Lost-update detection is a compare-after-write. Storage has no conditional PUT we can reach
 * from the browser, so instead we bump a revision, write, read back, and confirm ours landed.
 * If it did not, somebody else wrote in between — re-merge onto their version and try once more.
 */
export async function saveReview(course, mutate) {
  let lastSeen = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await loadReviews(course);
    lastSeen = current;
    const next = JSON.parse(JSON.stringify(current));
    next.schema = 1;
    next.course = course;
    next.artifacts = next.artifacts || {};
    mutate(next);
    next.revision = (Number(current.revision) || 0) + 1;
    next.updated = new Date().toISOString().slice(0, 10);

    const body = new Blob([JSON.stringify(next, null, 1) + '\n'], { type: 'application/json' });
    const { error } = await db.storage.from(BUCKET).upload(reviewPath(course), body, {
      contentType: 'application/json',
      upsert: true,
      // `cacheControl: '0'` is load-bearing, not tuning. Storage defaults to caching an object
      // for an hour, so the read-back below returned the PREVIOUS revision and the
      // compare-after-write concluded the save had been clobbered — for a save that had in fact
      // landed. The visible symptom was the worst possible one: a decision that persisted
      // through a reload, reported to the reviewer as "NOT saved".
      cacheControl: '0',
    });
    if (error) throw new Error(`could not save review notes: ${error.message}`);

    const after = await loadReviews(course);
    if (Number(after.revision) >= next.revision) return after;
    // A LOWER revision than we just wrote means somebody else's write won. Their version is on
    // disk and ours is gone, so loop and re-apply onto theirs rather than overwriting what they
    // just did. (`>=` rather than `===` on purpose: if a third writer has since moved it further
    // forward, our change is still in the merged document and re-running would only duplicate
    // work.)
  }
  throw new Error(
    'Another reviewer saved at the same moment, twice running. Your change was NOT saved — '
    + 'reload and re-apply it.',
  );
}

/** Record one objective decision. `sha` pins it to the prose that was on screen. */
export function objectiveDecision({ slug, key, label, sha, decision, comment, by, file }) {
  return (doc) => {
    const art = doc.artifacts[slug] || (doc.artifacts[slug] = { objectives: {} });
    art.objectives = art.objectives || {};
    if (file) art.file = file;
    art.reviewed = new Date().toISOString().slice(0, 10);
    art.objectives[key] = { decision, comment: comment || '', sha, label, by };
  };
}

/** Record a comment on one of the artifact's baked-in parameters. */
export function paramComment({ slug, param, comment, by }) {
  return (doc) => {
    const art = doc.artifacts[slug] || (doc.artifacts[slug] = { objectives: {} });
    art.params = art.params || {};
    art.reviewed = new Date().toISOString().slice(0, 10);
    if (comment) art.params[param] = { comment, by };
    else delete art.params[param];
  };
}

/** Persist a published URL discovered on this page, so the library stops depending on somebody
 *  hand-editing BUILD-LOG.md for every artifact published after the import. */
export async function recordPublishedUrl(course, slug, url) {
  const idx = await loadIndex(course);
  const row = (idx.artifacts || []).find((a) => a.slug === slug);
  if (!row) throw new Error(`${slug} is not in ${course}/index.json`);
  row.published_url = url;
  row.published_on = row.published_on || new Date().toISOString().slice(0, 10);
  const body = new Blob([JSON.stringify(idx, null, 1) + '\n'], { type: 'application/json' });
  const { error } = await db.storage.from(BUCKET)
    .upload(`${course}/index.json`, body, { contentType: 'application/json', upsert: true });
  if (error) throw new Error(`could not record the URL: ${error.message}`);
  return idx;
}

// ── the live model ───────────────────────────────────────────────────────────

/**
 * Which of these slugs already have an activity row — i.e. which artifacts a cadet can actually
 * reach. READ ONLY. The page never writes to `app`; registration ends at a director's click on
 * Save in the Assignments form.
 *
 * This is the gap the library exists to make visible. A published artifact with no row is a live
 * URL nothing links to, and if a row's slug ever differs from the artifact's `#i=`, every cadet
 * report is discarded with no error anywhere.
 */
export async function registeredSlugs(slugs) {
  if (!slugs.length) return new Map();
  const out = new Map();
  // Chunked: a 46-slug `in.()` filter is a long URL, and PostgREST has a request-line limit.
  for (let i = 0; i < slugs.length; i += 25) {
    const chunk = slugs.slice(i, i + 25);
    const { data, error } = await db
      .from('activities')
      .select('slug, assignment_id, title, assignments(slug, title, course_id)')
      .in('slug', chunk);
    if (error) throw new Error(`could not check registration: ${error.message}`);
    for (const row of data || []) out.set(row.slug, row);
  }
  return out;
}

// ── the Gemini backup builds ─────────────────────────────────────────────────
//
// A cadet on a free claude.ai account can be turned away with an HTTP 429 and simply not be able
// to do the preflight. So an artifact published on claude.ai also gets a BACKUP BUILD: the same
// lesson with the transport swapped to Google Gemini against the cadet's own free API key,
// served from this site at `site/gemini/<course>/<slug>.html`. When the Claude artifact's
// connection check fails it offers a button to `site/student/backup.html?i=<slug>`, and that
// router resolves the slug through the manifest read below.
//
// FOUR THINGS THIS PAGE MUST NOT MISSTATE ABOUT THEM:
//   · A backup submits under the SAME slug as the Claude artifact, so its report lands in the
//     same activity row and rolls up identically. It is not a second assignment and cannot
//     split a cohort.
//   · It is a FALLBACK, not an alternative. The Claude artifact is the intended path; the backup
//     is rougher and exists for the cadet that path has locked out.
//   · Backups are REGENERATED, never hand-edited — `scripts/artifacts/to_gemini.py` writes them
//     and the generated HTML carries a DO-NOT-EDIT banner.
//   · An artifact with NO backup is normal, not broken: one that was never published on
//     claude.ai has nothing to back up.
//
// A manifest that will not load must degrade to "availability unknown" and never to a broken
// library — the Claude artifacts are this page's job and the backup column is an annotation on
// them. `loadBackups()` therefore resolves rather than rejects, and hands back the reason.

const BACKUP_MANIFEST = '../data/backup-builds.json';

/** The cadet-facing router, relative to `site/faculty/`. */
export const BACKUP_ROUTER = '../student/backup.html';

let backupsOnce = null;

/**
 * Read `site/data/backup-builds.json` once per page load and reuse it. One in-flight promise,
 * kept: the manifest covers every course, so switching courses must not refetch it.
 *
 * Cache-busted the same way the cadet router does it — the file changes whenever a build is
 * added or withdrawn, and a stale copy would tell a director a backup exists that does not.
 *
 * Resolves to `{ builds, error }` and NEVER rejects. A non-null `error` means availability is
 * UNKNOWN, and a caller has to render it as unknown rather than as "none": one failed fetch
 * would otherwise become a page full of confident, wrong claims.
 */
export function loadBackups() {
  if (!backupsOnce) {
    backupsOnce = (async () => {
      try {
        const res = await fetch(`${BACKUP_MANIFEST}?_=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const doc = await res.json();
        const builds = doc && typeof doc.builds === 'object' && doc.builds ? doc.builds : {};
        return { builds, error: null };
      } catch (err) {
        return { builds: {}, error: err.message || String(err) };
      }
    })();
  }
  return backupsOnce;
}

/**
 * One slug's backup build, or `null` when it has none.
 *
 * `path` is taken from the manifest verbatim and never rebuilt from course + slug. The manifest
 * is what the cadet router resolves, so a path re-derived here could disagree with where a cadet
 * is actually sent — silently, and only for the artifact whose naming was the exception. It is
 * stored relative to `site/`, and this page sits one directory below that, hence the `../`.
 */
export function backupFor(backups, slug) {
  const b = backups && backups.builds ? backups.builds[slug] : null;
  if (!b || !b.path) return null;
  return {
    course: b.course || '',
    lessonNo: b.lesson_no ?? null,
    title: b.title || '',
    path: b.path,
    url: `../${b.path}`,
    router: `${BACKUP_ROUTER}?i=${encodeURIComponent(slug)}`,
  };
}

// ── the registration link ────────────────────────────────────────────────────

export const ARTIFACT_URL_RE = /^https:\/\/claude\.ai\/public\/artifacts\/[0-9a-fA-F-]{8,}$/;

/**
 * Build the prefill link that opens the Assignments page with a new-lesson form filled in.
 * Contract: docs/contracts/INTERACTION-PREFILL-LINK.md.
 *
 * **`id` is the slug read out of the artifact source. It is never re-derived and never typed.**
 * Contract §3.2 ends every slug in 8 random hex minted once per build, so there is nothing to
 * re-derive it from — and an `id` that does not equal the artifact's `#i=` makes the receiver
 * discard every cadet report with no error anywhere. This repository has already paid for that
 * once: a published phys-310 slug was minted from a word a hand transcription had dropped.
 * The page prints the two values side by side for exactly this reason.
 *
 * Spaces encode as `%20`, not `+`. `URLSearchParams` emits `+`, which only decodes back to a
 * space under form-urlencoded rules — a receiver using `decodeURIComponent` would render the
 * title with literal plus signs.
 *
 * `pub=0` saves as a draft: the link fills the form in and writes nothing until Save is clicked.
 */
export function prefillLink({ base, slug, courseId, title, url, lessonNo }) {
  if (!base || !slug || !url) return '';
  const params = [
    ['new', '1'],
    ['id', slug],
    ['course', courseId],
    ['title', title],
    ['url', url],
    ['policy', 'interaction'],
    ['pub', '0'],
  ];
  if (lessonNo != null) params.push(['num', String(lessonNo)]);
  const qs = params
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${base}?${qs}`;
}

/** Pull `INTERACTION_ID` out of pasted JSX. The ONLY sanctioned way to learn an unregistered
 *  artifact's slug — see prefillLink's note on why it is never typed. */
export function slugFromSource(text) {
  const m = /^const INTERACTION_ID\s*=\s*"([^"]+)"/m.exec(String(text || ''));
  return m ? m[1] : '';
}

// ── source navigation ────────────────────────────────────────────────────────

/**
 * Top-level blocks of a generated artifact, for the source browser.
 *
 * Matches the shapes the factory emits — `const NAME = …`, `function Name(…)`, and the block
 * comment header. Deliberately structural rather than semantic: this is a table of contents, not
 * a parser. **Nothing on this page parses JSX**, because publishing is the only JSX parser this
 * project has (PROJECT.md — `node --check` reports exit 0 on invalid JSX).
 */
export function sourceOutline(text) {
  const lines = String(text).split('\n');
  const marks = [];
  const re = /^(?:const|let|var)\s+([A-Z][A-Z0-9_]*)\s*=|^function\s+([A-Za-z0-9_]+)\s*\(|^\/\* =+$/;
  lines.forEach((ln, i) => {
    const m = re.exec(ln);
    if (m) marks.push({ name: m[1] || m[2] || 'header', line: i + 1 });
  });
  if (!marks.length || marks[0].line > 1) marks.unshift({ name: 'header', line: 1 });
  return marks.map((m, i) => ({
    name: m.name,
    start: m.line,
    end: (i + 1 < marks.length ? marks[i + 1].line - 1 : lines.length),
  })).map((b) => ({ ...b, lines: b.end - b.start + 1 }));
}

/** The blocks worth calling out — the material an artifact was actually built from. */
export const KEY_BLOCKS = new Set([
  'TEXTBOOK_REFERENCE', 'LESSON_CONFIG', 'EXTENSION_PROBLEMS', 'REPORT_FORMAT',
  'OBJECTIVE_KEYS', 'INTERACTION_ID', 'MODEL_CANDIDATES',
]);
