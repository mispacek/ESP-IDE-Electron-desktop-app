"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const mfnt = require("./mfnt_codec.js");

function glyphPattern(width, height, seed) {
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      pixels[y * width + x] = ((x * 3 + y * 5 + seed) % 7) < 3 ? 1 : 0;
    }
  }
  return pixels;
}

function validGlyphs(width, height) {
  const glyphs = Array.from({length: mfnt.GLYPH_COUNT}, (_, index) =>
    glyphPattern(width, height, index)
  );
  glyphs[0].fill(0);
  return glyphs;
}

for (const formatId of [mfnt.FORMAT_HLSB, mfnt.FORMAT_HMSB, mfnt.FORMAT_VLSB]) {
  test(`round-trips non-byte-aligned glyphs in format ${formatId}`, () => {
    const width = 7;
    const height = 9;
    const glyphs = validGlyphs(width, height);
    const bytes = mfnt.serialize({width, height, formatId, glyphs});
    const font = mfnt.parse(bytes);

    assert.equal(font.width, width);
    assert.equal(font.height, height);
    assert.equal(font.formatId, formatId);
    assert.equal(bytes.length, 8 + 96 * mfnt.glyphSize(width, height, formatId));
    assert.deepEqual(mfnt.decodeGlyph(font, 31), glyphs[31]);
    assert.equal(mfnt.validate(bytes).valid, true);
  });
}

test("canonical MFNT uses zero-padded whole-height VLSB pages", () => {
  const width = 3;
  const height = 10;
  const glyphs = validGlyphs(width, height);
  glyphs[1].fill(1);
  const bytes = mfnt.serialize({
    width,
    height,
    formatId: mfnt.CANONICAL_FORMAT,
    glyphs
  });
  const font = mfnt.parse(bytes);
  const glyphStart = mfnt.glyphOffset(1, font.glyphSize);
  const glyphBytes = bytes.subarray(glyphStart, glyphStart + font.glyphSize);

  assert.equal(mfnt.CANONICAL_FORMAT, mfnt.FORMAT_VLSB);
  assert.equal(font.formatId, mfnt.FORMAT_VLSB);
  assert.equal(font.glyphSize, width * Math.ceil(height / 8));
  assert.deepEqual(Array.from(glyphBytes), [0xff, 0xff, 0xff, 0x03, 0x03, 0x03],
      "the unused six bits in the final vertical page remain zero");
  assert.equal(mfnt.validate(bytes).valid, true);
});

test("uses direct ASCII indices and maps out-of-range text to space", () => {
  assert.equal(mfnt.glyphIndexForCharacter(" "), 0);
  assert.equal(mfnt.glyphIndexForCharacter("~"), 94);
  assert.equal(mfnt.glyphIndexForCharacter("Ž"), 0);
  assert.equal(mfnt.glyphIndexForCharacter(""), 0);
  assert.equal(mfnt.glyphOffset(4, 16), 72);
});

test("creates a blank editable font with a visible fallback", () => {
  const bytes = mfnt.createBlankFont(8, 12, mfnt.FORMAT_HLSB);
  const validation = mfnt.validate(bytes);
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.warnings, []);
  assert.equal(mfnt.decodeGlyph(validation.font, 0).some(Boolean), false);
  assert.equal(mfnt.decodeGlyph(validation.font, 95).some(Boolean), true);
});

test("rejects malformed header, version, format and length", () => {
  const valid = mfnt.createBlankFont(8, 8, mfnt.FORMAT_HLSB);
  const badMagic = valid.slice(); badMagic[0] = 0;
  const badVersion = valid.slice(); badVersion[4] = 2;
  const badFormat = valid.slice(); badFormat[7] = 9;

  assert.throws(() => mfnt.parse(badMagic), /magic/);
  assert.throws(() => mfnt.parse(badVersion), /version/);
  assert.throws(() => mfnt.parse(badFormat), /format/);
  assert.throws(() => mfnt.parse(valid.slice(0, -1)), /file size/);
});

test("reports semantic space and unused-tail-bit defects", () => {
  const bytes = mfnt.createBlankFont(7, 9, mfnt.FORMAT_HLSB);
  const font = mfnt.parse(bytes);
  const broken = bytes.slice();
  broken[mfnt.glyphOffset(0, font.glyphSize)] = 0x80;
  broken[mfnt.glyphOffset(1, font.glyphSize) + font.glyphSize - 1] |= 0x01;
  const validation = mfnt.validate(broken);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some(message => message.includes("Space glyph")));
  assert.ok(validation.errors.some(message => message.includes("unused bits")));
});

test("shifts every glyph inside its fixed cell and counts clipped pixels", () => {
  const width = 4;
  const height = 3;
  const glyphs = Array.from({length: mfnt.GLYPH_COUNT}, () => new Uint8Array(width * height));
  glyphs[1][1 * width + 1] = 1;
  glyphs[1][2 * width + 3] = 1;

  const result = mfnt.shiftGlyphs(glyphs, width, height, 1, -1);
  assert.equal(result.clippedPixels, 1);
  assert.equal(result.glyphs[1][0 * width + 2], 1);
  assert.equal(result.glyphs[1].reduce((sum, value) => sum + value, 0), 1);
  assert.equal(glyphs[1][1 * width + 1], 1, "source data remain unchanged");
  assert.equal(mfnt.validate(mfnt.serialize({
    width, height, formatId: mfnt.FORMAT_HLSB, glyphs: result.glyphs
  })).valid, true);
});

test("rejects invalid global glyph offsets", () => {
  const glyphs = validGlyphs(3, 3);
  assert.throws(() => mfnt.shiftGlyphs(glyphs, 3, 3, 0.5, 0), /offsetX/);
  assert.throws(() => mfnt.shiftGlyphs(glyphs, 3, 3, 0, 256), /offsetY/);
});
