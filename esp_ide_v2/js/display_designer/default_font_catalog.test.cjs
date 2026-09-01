"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const mfnt = require("./mfnt_codec.js");

const catalogDir = path.join(__dirname, "default_fonts");
const expectedFiles = [
  "font_3x6.mfnt",
  "font_5x8.mfnt",
  "font_6x14_bold.mfnt",
  "font_12x24.mfnt",
  "font_16x28.mfnt",
  "font_7x16.mfnt",
  "spleen_8.mfnt",
  "spleen_12.mfnt",
  "spleen_16.mfnt",
  "spleen_24.mfnt",
  "spleen_32.mfnt",
  "spleen_64.mfnt",
  "ter_14_narrow.mfnt",
  "ter_16_narrow.mfnt",
  "ter_20_narrow.mfnt",
  "ter_22_narrow.mfnt",
  "ter_24_narrow.mfnt",
  "ter_28_narrow.mfnt",
  "ter_32_narrow.mfnt",
  "ter_12_bold.mfnt",
  "ter_14_bold.mfnt",
  "ter_16_bold.mfnt",
  "ter_20_bold.mfnt",
  "ter_22_bold.mfnt",
  "ter_24_bold.mfnt",
  "ter_32_bold.mfnt",
  "Tamzen_8.mfnt",
  "Tamzen_13.mfnt",
  "Tamzen_16.mfnt",
  "Tamzen_8_bold.mfnt",
  "Tamzen_13_bold.mfnt",
  "Tamzen_16_bold.mfnt",
  "7_Seg_33x19.mfnt"
];

function loadCatalog() {
  const window = {};
  const source = fs.readFileSync(path.join(catalogDir, "catalog.js"), "utf8");
  vm.runInNewContext(source, {window});
  return window.ESPIDE_DEFAULT_FONTS;
}

test("catalog exposes every integrated font with a valid bitmap preview", () => {
  const catalog = loadCatalog();
  assert.equal(catalog.length, expectedFiles.length);
  assert.deepEqual(Array.from(catalog, item => item.fileName), expectedFiles);
  assert.equal(new Set(catalog.map(item => item.id)).size, catalog.length);
  assert.equal(catalog.find(item => item.id === "font-5x8").fileName,
      "font_5x8.mfnt");

  const generatedMfnt = fs.readdirSync(catalogDir)
      .filter(name => name.endsWith(".mfnt")).sort();
  const generatedPng = fs.readdirSync(catalogDir)
      .filter(name => name.endsWith(".png")).sort();
  assert.deepEqual(generatedMfnt, [...expectedFiles].sort(),
      "stale MFNT files must be removed from the generated catalog");
  assert.deepEqual(generatedPng,
      expectedFiles.map(name => name.replace(/\.mfnt$/, ".png")).sort(),
      "every font has exactly one preview and no stale PNG remains");

  const serviceWorker = fs.readFileSync(
      path.join(__dirname, "../../sw.js"), "utf8");
  for (const item of catalog) {
    assert.ok(serviceWorker.includes(`'${item.path}'`),
        `${item.fileName} is available offline`);
    assert.ok(serviceWorker.includes(`'${item.preview}'`),
        `${path.basename(item.preview)} is available offline`);
  }
  assert.doesNotMatch(serviceWorker, /display_designer\/system_fonts\//,
      "legacy fallback fonts must not delay the required startup precache");

  for (const item of catalog) {
    assert.equal(item.sample,
        item.id === "7-seg-33x19" ? "0123.456789" : "ABCabc123");
    const fontPath = path.join(catalogDir, item.fileName);
    const previewPath = path.join(catalogDir, path.basename(item.preview));
    const validation = mfnt.validate(fs.readFileSync(fontPath));
    assert.equal(validation.valid, true, item.fileName);
    assert.equal(validation.font.formatId, mfnt.FORMAT_VLSB, item.fileName);
    assert.equal(validation.font.width, item.width, item.fileName);
    assert.equal(validation.font.height, item.height, item.fileName);
    assert.deepEqual([...fs.readFileSync(previewPath).subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10], item.preview);
  }
});

test("7 Segment advertises digits and decimal point while letters stay blank", () => {
  const item = loadCatalog().find(entry => entry.id === "7-seg-33x19");
  const font = mfnt.parse(fs.readFileSync(path.join(catalogDir, item.fileName)));

  for (const character of "0123456789.") {
    assert.equal(mfnt.decodeGlyph(
        font, character.charCodeAt(0) - mfnt.FIRST_CHAR).some(Boolean), true,
    character);
  }
  for (const character of "ABCabc") {
    assert.equal(mfnt.decodeGlyph(
        font, character.charCodeAt(0) - mfnt.FIRST_CHAR).some(Boolean), false,
    character);
  }
});
