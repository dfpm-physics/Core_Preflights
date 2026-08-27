#!/usr/bin/env node
/*
 * Parse a Gemini backup build's JSX with THE SAME Babel the page itself ships.
 *
 * WHY THIS EXISTS
 *   `node --check` returns **exit 0 on invalid JSX** -- Node auto-detects any file containing
 *   `import`/`export` as ESM and does not reject JSX on that path (PROJECT.md, "Sharp edges the
 *   builder already paid for"). So the obvious syntax check proves nothing about these files.
 *
 *   For a Claude artifact, publishing is the only JSX parser the project has. A Gemini build is
 *   different: it is served from this repo and transpiles in the browser against
 *   `site/vendor/babel.min.js`. That vendored Babel IS the build's parser, so it can be run ahead
 *   of time -- which turns "the page renders" from a browser test into a precommit check.
 *
 *   It is a SYNTAX check and nothing more. A build that parses can still be wrong: it does not
 *   run the page, does not touch Google, and does not know what the markup means. Verify UI in a
 *   browser (CORE.md section 2).
 *
 * NODE IS OPTIONAL TOOLING. Nothing on the deploy path needs this file; delete it and the site is
 * unchanged. There is no package.json and no node_modules -- it requires only the vendored Babel
 * the site already serves. CORE.md section 2 is the rule this follows.
 *
 * Usage:
 *   node scripts/artifacts/check_jsx.js site/gemini/phys-215/lesson-04-*.html
 *   node scripts/artifacts/check_jsx.js site/gemini/                 # every build under a dir
 *
 * Exit code is non-zero if any file fails to parse.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const BABEL = path.resolve("site/vendor/babel.min.js");
if (!fs.existsSync(BABEL)) {
  console.error("cannot find " + BABEL + " -- run from the repo root");
  process.exit(2);
}
const Babel = require(BABEL);

function collect(target) {
  const st = fs.statSync(target);
  if (st.isFile()) return [target];
  const out = [];
  for (const entry of fs.readdirSync(target)) {
    const p = path.join(target, entry);
    if (fs.statSync(p).isDirectory()) out.push(...collect(p));
    else if (entry.endsWith(".html")) out.push(p);
  }
  return out.sort();
}

const targets = process.argv.slice(2);
if (!targets.length) {
  console.error("usage: node scripts/artifacts/check_jsx.js <file-or-directory>...");
  process.exit(2);
}

let files = [];
for (const t of targets) files.push(...collect(t));

let failed = 0;
let skipped = 0;
for (const file of files) {
  const html = fs.readFileSync(file, "utf8");
  const m = html.match(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) { skipped++; continue; }            // not a build -- e.g. a plain diagnostic page
  try {
    const out = Babel.transform(m[1], { presets: ["react"], filename: path.basename(file) });
    console.log("ok    " + path.basename(file) + "  (" + out.code.length + " chars out)");
  } catch (e) {
    failed++;
    console.error("FAIL  " + file + "\n      " + String(e.message).split("\n")[0]);
  }
}

console.log("\n" + (files.length - skipped - failed) + " parsed, " + failed + " failed, "
            + skipped + " skipped (no text/babel block)");
process.exit(failed ? 1 : 0);
