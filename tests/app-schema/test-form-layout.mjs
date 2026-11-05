// test-form-layout.mjs — the shared rule that keeps staff form rows in line.
// Offline: it reads files and makes no network call.
//
// The rule (site/css/styles.css, `.form-grid`): a row of fields is a grid and each field is a subgrid
// across three rows, so labels share a level, controls share a level and captions share a level.
// This cannot test pixels, so it guards the two things that break it quietly: the rule going missing,
// and a staff page going back to a hand-built row (a flex row with per-field widths) that lets a caption
// push a control out of line. The pixel check is done in a browser at 1400, 900 and phone width.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { check, section, summary, REPO } from './harness.mjs';

const read = (rel) => readFileSync(resolve(REPO, rel), 'utf8');
const css = read('site/css/styles.css');

section('the shared rule exists, once, in the shared stylesheet');
{
  check('.form-grid is a grid that wraps by width (auto-fit), so a narrow screen stacks the fields',
    /\.form-grid\s*\{[^}]*display:\s*grid[^}]*repeat\(auto-fit/.test(css));
  check('each field spans three rows and takes them from the row (subgrid)',
    /@supports \(grid-template-rows: subgrid\)\s*\{[^}]*\.form-grid > \.field[^}]*grid-row: span 3[^}]*grid-template-rows: subgrid/.test(css));
  check('label, control and caption have fixed levels 1, 2 and 3',
    /\.form-grid > \.field > label \{ grid-row: 1; \}/.test(css) &&
    /\.form-grid > \.field > :not\(label\):not\(\.field-hint\) \{ grid-row: 2/.test(css) &&
    /\.form-grid > \.field > \.field-hint \{ grid-row: 3/.test(css));
  check('a button with no label has its own slot on level 2', /\.form-grid > \.field-action > \* \{ grid-row: 2/.test(css));
  check('no page-specific copy of the rule', (css.match(/grid-template-rows: subgrid;/g) || []).length === 1);
}

section('the staff forms use it, and not a hand-built row');
{
  const pages = ['site/faculty/items.html', 'site/faculty/questions.html', 'site/faculty/scale.html', 'site/faculty/terms.html', 'site/faculty/admin.html'];
  for (const p of pages) {
    const src = read(p);
    check(`${p} uses form-grid`, /class="form-grid"/.test(src));
    // A field with its own width or flex basis is the old way to line things up by hand.
    check(`${p}: no field sized by hand (min-width / flex basis on a .field)`,
      !/class="field[^"]*" style="[^"]*(min-width|flex:)/.test(src));
    check(`${p}: no row of fields built with align-items:flex-end`,
      !/class="row wrap" style="[^"]*align-items:flex-end[^"]*">\s*<div class="field/.test(src));
  }
  const items = read('site/faculty/items.html');
  check('the assignment form keeps each field\'s caption inside its own field', !/<\/div>\s*<div class="field-hint"[^>]*>[^<]*<\/div>\s*<\/div>\s*<div class="field"><label for="i-points"/.test(items));
}

section('the smaller admin forms use the shared rule');
{
  const admin = read('site/faculty/admin.html');
  for (const id of ['as-sid', 'as-nm', 'as-em', 'as-sq', 'as-sec', 'ns-code', 'ns-period', 'ex-scope'])
    check(`${id} sits in a form-grid`, new RegExp(String.raw`<div class="form-grid"[^>]*>(?:(?!<div class="form-grid")[\s\S])*?id="${id}"`).test(admin));
  check('no hand-sized fields remain in the add-student form', !/class="field[^"]*" style="[^"]*min-width:1[0-9]0px/.test(admin));
}

process.exit(summary() ? 0 : 1);
