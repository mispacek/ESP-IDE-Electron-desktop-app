"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const importer = require("./bitmap_font_importer.js");
const mfnt = require("./mfnt_codec.js");

function glyph(result, character) {
  return result.glyphs[character.charCodeAt(0) - 32];
}

function assertMfntReady(result) {
  const bytes = mfnt.serialize({
    width: result.width,
    height: result.height,
    formatId: mfnt.FORMAT_HLSB,
    glyphs: result.glyphs
  });
  const validation = mfnt.validate(bytes);
  assert.equal(validation.valid, true, validation.errors.join("; "));
  assert.equal(validation.warnings.length, 0);
}

test("imports BDF BBX pixels into the global fixed cell", () => {
  const bdf = `STARTFONT 2.1
FONT -espide-test-medium-r-normal--8-80-75-75-c-50-iso10646-1
FAMILY_NAME "ESP IDE Test"
FONTBOUNDINGBOX 5 8 0 -1
CHARS 3
STARTCHAR space
ENCODING 32
DWIDTH 5 0
BBX 0 0 0 0
BITMAP
ENDCHAR
STARTCHAR question
ENCODING 63
DWIDTH 5 0
BBX 5 7 0 0
BITMAP
70
88
08
10
20
00
20
ENDCHAR
STARTCHAR A
ENCODING 65
DWIDTH 5 0
BBX 5 7 0 0
BITMAP
70
88
88
F8
88
88
88
ENDCHAR
ENDFONT`;
  const result = importer.parseBdf(bdf);

  assert.equal(result.sourceFormat, "BDF");
  assert.equal(result.name, "ESP IDE Test");
  assert.equal(result.width, 5);
  assert.equal(result.height, 8);
  assert.deepEqual(Array.from(glyph(result, "A").slice(0, 5)), [0, 1, 1, 1, 0]);
  assert.equal(glyph(result, "A")[7 * 5], 0);
  assert.deepEqual(result.glyphs[95], glyph(result, "?"));
  assert.ok(result.warnings.some(message => message.includes("Missing 92")));
  assertMfntReady(result);
});

test("imports PSF1 row bytes with direct code-point indices", () => {
  const height = 8;
  const bytes = new Uint8Array(4 + 256 * height);
  bytes.set([0x36, 0x04, 0x00, height]);
  const a = 4 + 65 * height;
  bytes.set([0x70, 0x88, 0x88, 0xf8, 0x88, 0x88, 0x88, 0x00], a);
  const question = 4 + 63 * height;
  bytes.set([0x70, 0x88, 0x08, 0x10, 0x20, 0x00, 0x20, 0x00], question);

  const result = importer.parsePsf(bytes);
  assert.equal(result.sourceFormat, "PSF1");
  assert.equal(result.width, 8);
  assert.equal(result.height, 8);
  assert.deepEqual(Array.from(glyph(result, "A").slice(0, 8)), [0, 1, 1, 1, 0, 0, 0, 0]);
  assert.deepEqual(result.glyphs[95], glyph(result, "?"));
  assert.deepEqual(result.warnings, []);
  assertMfntReady(result);
});

test("uses a PSF1 Unicode table instead of assuming glyph indices", () => {
  const height = 1;
  const glyphCount = 256;
  const glyphBytes = new Uint8Array(glyphCount * height);
  glyphBytes[0] = 0x80;
  glyphBytes[1] = 0x40;
  const table = [];
  for (let index = 0; index < glyphCount; index++) {
    if (index === 0) table.push(65, 0);
    if (index === 1) table.push(63, 0);
    table.push(0xff, 0xff);
  }
  const bytes = Uint8Array.from([0x36, 0x04, 0x02, height, ...glyphBytes, ...table]);
  const result = importer.parsePsf1(bytes);

  assert.equal(glyph(result, "A")[0], 1);
  assert.equal(glyph(result, "A")[1], 0);
  assert.equal(glyph(result, "?")[0], 0);
  assert.equal(glyph(result, "?")[1], 1);
});

test("imports non-byte-aligned PSF2 glyphs and its UTF-8 Unicode table", () => {
  const width = 9;
  const height = 2;
  const rowBytes = 2;
  const glyphSize = rowBytes * height;
  const header = new Uint8Array(32);
  const view = new DataView(header.buffer);
  header.set([0x72, 0xb5, 0x4a, 0x86]);
  view.setUint32(4, 0, true);
  view.setUint32(8, 32, true);
  view.setUint32(12, 1, true);
  view.setUint32(16, 2, true);
  view.setUint32(20, glyphSize, true);
  view.setUint32(24, height, true);
  view.setUint32(28, width, true);
  const bitmaps = Uint8Array.from([
    0x80, 0x80, 0x40, 0x00,
    0x40, 0x00, 0x20, 0x00
  ]);
  const unicode = Uint8Array.from([0x41, 0xff, 0x3f, 0xff]);
  const bytes = new Uint8Array(header.length + bitmaps.length + unicode.length);
  bytes.set(header); bytes.set(bitmaps, header.length); bytes.set(unicode, header.length + bitmaps.length);

  const result = importer.parse(bytes, "test.psfu");
  assert.equal(result.sourceFormat, "PSF2");
  assert.equal(result.width, 9);
  assert.equal(result.height, 2);
  assert.equal(glyph(result, "A")[0], 1);
  assert.equal(glyph(result, "A")[8], 1);
  assert.equal(glyph(result, "A")[9 + 1], 1);
  assert.deepEqual(result.glyphs[95], glyph(result, "?"));
  assertMfntReady(result);
});

test("rejects unsupported and truncated font data", () => {
  assert.throws(() => importer.parse(Uint8Array.from([1, 2, 3]), "font.bin"), /Unsupported/);
  assert.throws(() => importer.parsePsf(Uint8Array.from([0x36, 0x04, 0, 8])), /Truncated/);
  assert.throws(() => importer.parseBdf("STARTFONT 2.1\nENDFONT"), /FONTBOUNDINGBOX/);
});
