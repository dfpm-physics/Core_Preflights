// test-items-page.mjs — the structure of site/faculty/items.html, checked without a browser.
// Offline: it reads files and makes no network call.
//
// WHY THIS EXISTS
//   A page fault that shows only in a browser (an id the script reads that the markup does not have, an import that does
//   not resolve, a policy hash that no longer matches the script) is the known risk of a page with no build step. This
//   cannot run the page. It checks the things that make the page fail to start, and the rules the page must keep:
//   a new assignment still opens short, new fields live behind "More options", nothing names a kind, and the publish
//   control is on the form where the director sees it, set by a link and never acted on by one.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { check, section, summary, REPO } from './harness.mjs';

const PAGE = 'site/faculty/items.html';
const html = readFileSync(resolve(REPO, PAGE), 'utf8').replace(/\r\n/g, '\n');
const script = (html.match(/<script type="module">([\s\S]*?)<\/script>/) || [])[1] || '';
const markup = html.replace(/<script[\s\S]*?<\/script>/g, '');

section('every id the script reads exists in the markup or in a template the script builds');
{
  const used = new Set();
  for (const m of script.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)) used.add(m[1]);
  for (const m of script.matchAll(/getElementById\('([A-Za-z0-9_-]+)'\)/g)) used.add(m[1]);
  const declared = new Set([...markup.matchAll(/\bid="([^"$]+)"/g)].map(m => m[1]));
  // ids the script writes into its own templates (the table, the load-time banner, per-day boxes)
  const templated = new Set([...script.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)].map(m => m[1]));
  check(`the script reads ${used.size} ids`, used.size > 40);
  for (const id of [...used].sort()) check(`#${id} exists`, declared.has(id) || templated.has(id));
  const ids = [...markup.matchAll(/\bid="([^"$]+)"/g)].map(m => m[1]);
  check('no id is declared twice', new Set(ids).size === ids.length);
}

section('every import resolves');
{
  const imports = [...script.matchAll(/from '(\.\.\/js\/[^']+)'/g)].map(m => m[1]);
  check('the page imports modules', imports.length >= 8);
  for (const rel of imports) {
    const file = resolve(REPO, 'site/faculty', rel);
    check(`${rel} exists`, existsSync(file));
  }
  // a name taken from a module must be exported by it
  for (const m of script.matchAll(/import \{([^}]+)\} from '(\.\.\/js\/[^']+)'/g)) {
    const src = readFileSync(resolve(REPO, 'site/faculty', m[2]), 'utf8');
    for (const name of m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
      check(`${m[2]} exports ${name}`, new RegExp(String.raw`export\s+(async\s+)?(function|const|let|class)\s+${name}\b|export\s*\{[^}]*\b${name}\b`).test(src));
    }
  }
  // every I.x / LK.x the script calls exists in its module
  for (const [ns, file] of [['I', 'site/js/faculty-items.js'], ['LK', 'site/js/lesson-link.js']]) {
    const src = readFileSync(resolve(REPO, file), 'utf8');
    const names = new Set([...script.matchAll(new RegExp(String.raw`\b${ns}\.([A-Za-z_][A-Za-z0-9_]*)`, 'g'))].map(m => m[1]));
    for (const name of [...names].sort()) {
      check(`${ns}.${name} is exported by ${file.split('/').pop()}`,
        new RegExp(String.raw`export\s+(async\s+)?(function|const|let|class)\s+${name}\b|export\s*\{[^}]*\b${name}\b`).test(src));
    }
  }
}

section('the policy hash matches the final script');
{
  const meta = (html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/) || [])[1] || '';
  const hash = 'sha256-' + createHash('sha256').update(script, 'utf8').digest('base64');
  check('the inline module script is allowed by hash', meta.includes(`'${hash}'`));
}

section('a new assignment opens short, and the new fields sit behind More options');
{
  const modal = markup.slice(markup.indexOf('id="item-modal"'), markup.indexOf('id="dest-modal"'));
  const more = modal.slice(modal.indexOf('<details'), modal.indexOf('</details>'));
  const before = modal.slice(0, modal.indexOf('<details'));
  for (const id of ['i-title', 'i-kind', 'i-points', 'i-alldate']) check(`#${id} is in the short form`, before.includes(`id="${id}"`));
  for (const id of ['i-withtutor', 'i-policy', 'i-switch', 'i-ititle', 'i-idesc', 'i-swap', 'i-num', 'i-release', 'i-opens', 'i-openst'])
    check(`#${id} is under More options`, more.includes(`id="${id}"`) && !before.includes(`id="${id}"`));
  check('More options starts closed', /<details[^>]*id="i-more"(?![^>]*\bopen\b)/.test(modal));
  check('the tutor controls start hidden', /id="i-twopath-row" style="display:none/.test(more) && /id="i-twopath"[^>]*display:none/.test(more) && /id="i-interactive"[^>]*display:none/.test(more));
  check('the release boxes start hidden', /id="i-opens-wrap" style="display:none/.test(more) && /id="i-openst-wrap" style="display:none/.test(more));
}

section('the rules the page keeps');
{
  const kinds = ['preflight', 'homework', 'case_study', 'group_project', 'quiz', 'exam', 'lab'];
  for (const k of kinds) check(`no kind id '${k}' is named`, !html.includes(`'${k}'`) && !html.includes(`"${k}"`));
  check('the page never writes a literal publish true', !/is_published:\s*true/.test(script));
  {
    const modal = markup.slice(markup.indexOf('id="item-modal"'), markup.indexOf('id="dest-modal"'));
    const before = modal.slice(0, modal.indexOf('<details'));
    const after = modal.slice(modal.indexOf('</details>'));
    check('the publish control is a checkbox outside More options, so it is always in view',
      /<input type="checkbox" id="i-publish">/.test(modal) && !modal.slice(modal.indexOf('<details'), modal.indexOf('</details>')).includes('id="i-publish"')
      && (before.includes('id="i-publish"') || after.includes('id="i-publish"')));
    check('it sits before the Save button', modal.indexOf('id="i-publish"') < modal.indexOf('id="im-save"'));
    check('the old line saying saving keeps it unpublished is gone', !/Saving keeps the assignment unpublished/.test(markup));
  }
  check('the form sends the control', /publish:\s*\$\('i-publish'\)\.checked/.test(script));
  check('a link publish flag only sets the control, for the director to review', /if \(f\.publishRequested != null\) \$\('i-publish'\)\.checked = f\.publishRequested/.test(script));
  check('an assignment opened for editing starts from its own state', /\$\('i-publish'\)\.checked = item \? item\.isPublished : false/.test(script));
  check('choosing an existing assignment for a link does not carry the flag', !/publishRequested/.test(script.slice(script.indexOf('function applyOverlay'), script.indexOf('function showNote'))));
  check('the note about the link no longer says the page saves unpublished', !/saves unpublished/.test(script));
  check('a publish refusal is shown with the older editor sentence and the save is reported done', /res\.publishError/.test(script) && /publishErrorText\(res\.publishError\)/.test(script));
  check('the list banner no longer says saving keeps assignments unpublished', !/stay unpublished/.test(script));
  check('no inline event handlers', !/\son[a-z]+="/i.test(markup));
  check('no javascript: link', !/javascript:/i.test(html));
  check('the new rows use form-grid', (markup.match(/class="form-grid"/g) || []).length >= 6);
  check('no field sized by hand', !/class="field[^"]*" style="[^"]*(min-width|flex:)/.test(markup));
  check('the chooser keeps the older ids', ['dest-sub', 'dest-offering', 'dest-offering-hint', 'dest-pick', 'dest-pick-note', 'dest-lessons']
    .every(id => markup.includes(`id="${id}"`)) && markup.includes('data-dest="new"') && markup.includes('data-dest="existing"'));
  check('the chooser asks the course and term before the assignment list', markup.indexOf('id="dest-offering"') < markup.indexOf('id="dest-lessons"'));
  check('a prefill link is read once and cleared from the address', /history\.replaceState\(null, '', location\.pathname\)/.test(script));
  check('an assignment from the older page is not selectable as a destination', /if \(!it \|\| !it\.isNew\) return;/.test(script));
  check('the confirmations stack into one acknowledgement', /needsTutorConfirm/.test(script) && /needsPointsConfirm/.test(script) && /ack\.points = true/.test(script));
}

process.exit(summary() ? 0 : 1);
