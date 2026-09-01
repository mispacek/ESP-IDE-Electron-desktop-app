"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const appRoot = path.resolve(__dirname, "..");

test("loads the initial Blockly locale between core and block definitions", () => {
  const html = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
  const core = html.indexOf('writeVersionedScript("js/blockly_compressed.js"');
  const locale = html.indexOf(
      '"js/" + window.ESPIDE_BOOTSTRAP_BLOCKLY_LANGUAGE + ".js"');
  const blocks = html.indexOf('writeVersionedScript("js/blocks_compressed.js"');

  assert.ok(core >= 0 && locale >= 0 && blocks >= 0);
  assert.ok(core < locale && locale < blocks,
      "Blockly.Msg must be populated before stock blocks validate BKY references");
  assert.match(html, /let currentBlocklyLanguage\s*=\s*\n?\s*window\.ESPIDE_BOOTSTRAP_BLOCKLY_LANGUAGE/);
});

test("every stock BKY reference exists in each bundled locale", () => {
  const blocks = fs.readFileSync(
      path.join(appRoot, "js/blocks_compressed.js"), "utf8");
  const references = new Set(
      Array.from(blocks.matchAll(/%\{BKY_([A-Z0-9_]+)\}/g), match => match[1]));

  for (const language of ["cs", "en", "de"]) {
    const source = fs.readFileSync(
        path.join(appRoot, `js/${language}.js`), "utf8");
    const defined = new Set(
        Array.from(source.matchAll(/Blockly\.Msg\["([A-Z0-9_]+)"\]/g),
            match => match[1]));
    const missing = Array.from(references).filter(key => !defined.has(key));
    assert.deepEqual(missing, [], `${language}.js is missing Blockly messages`);
  }
});
