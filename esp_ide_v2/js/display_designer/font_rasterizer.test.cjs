"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const rasterizer = require("./font_rasterizer.js");

test("converts antialiased RGBA pixels with an explicit threshold", () => {
  const rgba = new Uint8ClampedArray([
    255, 255, 255, 255,
    127, 127, 127, 255,
    255, 255, 255, 64,
    0, 0, 0, 255
  ]);
  assert.deepEqual(Array.from(rasterizer.rgbaToPixels(rgba, 4, 1, 128)), [1, 0, 0, 0]);
});

test("creates a visible fallback box with a cross", () => {
  const pixels = rasterizer.fallbackPixels(5, 5);
  assert.equal(pixels[0], 1);
  assert.equal(pixels[2 * 5 + 2], 1);
  assert.equal(pixels[1 * 5 + 2], 0);
});

test("rasterizes exactly printable ASCII plus fallback and keeps space empty", () => {
  const calls = [];
  let drawn = false;
  const context = {
    clearRect() {},
    fillRect() { if (this.fillStyle === "#000000") drawn = false; },
    fillText(character, x, y) { drawn = true; calls.push({character, x, y}); },
    getImageData() {
      const data = new Uint8ClampedArray(4 * 3 * 5);
      if (drawn) data.set([255, 255, 255, 255]);
      return {data};
    }
  };
  const glyphs = rasterizer.rasterizeAscii(context, {
    width: 3,
    height: 5,
    family: "Test Font",
    fontSize: 5,
    offsetX: 1,
    baselineY: 4,
    threshold: 128
  });

  assert.equal(glyphs.length, 96);
  assert.equal(glyphs[0].some(Boolean), false);
  assert.equal(glyphs[1][0], 1);
  assert.equal(glyphs[95].some(Boolean), true);
  assert.equal(calls.length, 94);
  assert.deepEqual(calls[0], {character: "!", x: 1, y: 4});
  assert.equal(context.font, 'normal normal 5px "Test Font"');
});
