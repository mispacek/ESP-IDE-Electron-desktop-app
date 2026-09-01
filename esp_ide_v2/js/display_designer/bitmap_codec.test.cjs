"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const bitmap = require("./bitmap_codec.js");

test("packs horizontal pixels in MicroPython MONO_HLSB order", () => {
  const pixels = Uint8Array.from([
    1, 0, 1, 0, 0, 0, 0, 1, 1,
    0, 1, 0, 0, 0, 0, 0, 0, 1
  ]);
  const bytes = bitmap.pack(pixels, 9, 2);
  assert.deepEqual(Array.from(bytes), [0b10000101, 1, 0b00000010, 1]);
  assert.deepEqual(Array.from(bitmap.unpack(bytes, 9, 2)), Array.from(pixels));
});

test("validates exact bitmap length and dimensions", () => {
  assert.equal(bitmap.validate(new Uint8Array(16), 16, 8).valid, true);
  assert.equal(bitmap.validate(new Uint8Array(15), 16, 8).valid, false);
  assert.equal(bitmap.validate(new Uint8Array(1), 129, 1).valid, false);
});

test("sets and clears individual MONO_HLSB pixels", () => {
  const bytes = new Uint8Array(bitmap.byteLength(128, 64));
  bitmap.setPixel(bytes, 128, 9, 3, 1);
  assert.equal(bitmap.getPixel(bytes, 128, 9, 3), 1);
  assert.equal(bytes[3 * 16 + 1], 0b00000010);
  bitmap.setPixel(bytes, 128, 9, 3, 0);
  assert.equal(bitmap.getPixel(bytes, 128, 9, 3), 0);
});

test("ignores pixel access outside the aligned bitmap buffer", () => {
  const bytes = new Uint8Array(bitmap.byteLength(5, 2));
  bitmap.setPixel(bytes, 5, 0, 0, 1);
  const before = Array.from(bytes);

  bitmap.setPixel(bytes, 5, -1, 0, 1);
  bitmap.setPixel(bytes, 5, 5, 0, 1);
  bitmap.setPixel(bytes, 5, 0, -1, 1);
  bitmap.setPixel(bytes, 5, 0, 2, 1);

  assert.deepEqual(Array.from(bytes), before);
  assert.equal(bitmap.getPixel(bytes, 5, -1, 0), 0);
  assert.equal(bitmap.getPixel(bytes, 5, 5, 0), 0);
  assert.equal(bitmap.getPixel(bytes, 5, 0, -1), 0);
  assert.equal(bitmap.getPixel(bytes, 5, 0, 2), 0);
  assert.equal(bytes.length, 2, "5px rows stay padded to one complete byte");
});

test("clears unused bits in the last byte of every aligned row", () => {
  const dirty = Uint8Array.from([0xff, 0xff]);
  const clean = bitmap.zeroPadding(dirty, 5, 2);

  assert.deepEqual(Array.from(clean), [0x1f, 0x1f]);
  assert.deepEqual(Array.from(dirty), [0xff, 0xff],
      "normalization does not mutate the source bytes");
});

test("fits large images inside 128x64 without upscaling", () => {
  assert.deepEqual(bitmap.fitDimensions(640, 480, 128, 64), {width: 85, height: 64});
  assert.deepEqual(bitmap.fitDimensions(20, 10, 128, 64), {width: 20, height: 10});
});

test("resizes monochrome data with deterministic nearest neighbour", () => {
  const source = bitmap.pack(Uint8Array.from([1, 0, 0, 1]), 2, 2);
  const resized = bitmap.unpack(bitmap.resize(source, 2, 2, 4, 4), 4, 4);
  assert.deepEqual(Array.from(resized), [
    1, 1, 0, 0,
    1, 1, 0, 0,
    0, 0, 1, 1,
    0, 0, 1, 1
  ]);
});

test("converts RGBA with threshold, alpha, inversion and dithering", () => {
  const rgba = Uint8Array.from([
    255, 255, 255, 255,
    20, 20, 20, 255,
    255, 255, 255, 0
  ]);
  assert.deepEqual(Array.from(bitmap.unpack(
      bitmap.fromRgba(rgba, 3, 1, {threshold: 128}), 3, 1)), [1, 0, 0]);
  assert.deepEqual(Array.from(bitmap.unpack(
      bitmap.fromRgba(rgba, 3, 1, {threshold: 128, invert: true}), 3, 1)), [0, 1, 0]);

  const gray = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < 16; i++) {
    gray[i * 4] = gray[i * 4 + 1] = gray[i * 4 + 2] = 112;
    gray[i * 4 + 3] = 255;
  }
  const plain = bitmap.unpack(bitmap.fromRgba(gray, 4, 4, {threshold: 128}), 4, 4);
  const dithered = bitmap.unpack(bitmap.fromRgba(
      gray, 4, 4, {threshold: 128, dither: true}), 4, 4);
  assert.equal(plain.reduce((sum, value) => sum + value, 0), 0);
  assert.ok(dithered.reduce((sum, value) => sum + value, 0) > 0);
});
