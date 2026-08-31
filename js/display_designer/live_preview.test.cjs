"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadApi() {
  const window = {
    btoa: value => Buffer.from(value, "binary").toString("base64")
  };
  const source = fs.readFileSync(path.join(__dirname, "live_preview.js"), "utf8");
  vm.runInNewContext(source, {window});
  return window.ESPIDE_DISPLAY_LIVE_PREVIEW;
}

test("builds printable offset commands and a size-aware Python helper", () => {
  const api = loadApi();
  assert.equal(api.writeCommand(128, Uint8Array.from([0, 3, 4, 255])),
      "_espide_preview(128,'AAME/w==')");
  const python = api.buildPythonInitializer(1024);
  assert.match(python, /_espide_preview_expected=1024/);
  assert.match(python, /NO_FRAMEBUFFER/);
  assert.match(python, /NO_SHOW/);
  assert.match(python, /@ESPIDE_PREVIEW:OK/);
  assert.ok(api.buildPythonInitializerCommands(1024).length > 8);
  const ble = api.profileForLink("ble");
  assert.equal(ble.framebufferChunkSize, 48);
  assert.ok(ble.wireChunkChars <= 20);
  assert.ok(ble.wireChunkGapMs >= 60);
  assert.ok(ble.responseTimeoutMs >= 10000);
});

test("sends all chunks initially and only changed chunks afterwards", () => {
  const api = loadApi();
  const first = new Uint8Array(300);
  assert.deepEqual(Array.from(
      api.changedChunks(first, null, 128), item => item.offset),
      [0, 128, 256]);
  const second = first.slice();
  second[140] = 1;
  assert.deepEqual(Array.from(
      api.changedChunks(second, first, 128), item => item.offset),
      [128]);
});

test("packs white canvas pixels as MONO_VLSB bytes", () => {
  const api = loadApi();
  const rgba = new Uint8ClampedArray(2 * 9 * 4);
  function white(x, y) {
    const offset = (y * 2 + x) * 4;
    rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = rgba[offset + 3] = 255;
  }
  white(0, 0);
  white(0, 8);
  white(1, 7);
  const canvas = {
    width: 2,
    height: 9,
    getContext: () => ({getImageData: () => ({data: rgba})})
  };
  assert.deepEqual(Array.from(api.canvasToMonoVlsb(canvas, 2, 9)),
      [0x01, 0x80, 0x01, 0x00]);
});
