"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {JSDOM} = require("../../../blockly-6.20210701.0/node_modules/jsdom");
const mfnt = require("./mfnt_codec.js");

function loadScript(window, fileName) {
  window.eval(fs.readFileSync(path.join(__dirname, fileName), "utf8"));
}

test("font editor saves legacy input as page-aligned MONO_VLSB", () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    runScripts: "outside-only",
    url: "http://127.0.0.1/esp_ide_v2/"
  });
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    fillRect() {},
    imageSmoothingEnabled: false,
    fillStyle: ""
  });

  loadScript(dom.window, "mfnt_codec.js");
  loadScript(dom.window, "font_editor.js");

  const legacy = mfnt.createBlankFont(3, 10, mfnt.FORMAT_HLSB);
  let savedAssets = null;
  dom.window.ESPIDE_FONT_EDITOR.open({
    fonts: [{
      id: "legacy",
      name: "Legacy 3x10",
      fileName: "legacy.mfnt",
      data: Buffer.from(legacy).toString("base64")
    }],
    onSave: assets => {
      savedAssets = assets;
    }
  });

  assert.match(
      dom.window.document.querySelector(".espide-font-editor-format-note").textContent,
      /MONO_VLSB/);
  dom.window.document.querySelector('[data-action="save"]').click();

  assert.equal(savedAssets.length, 1);
  const bytes = Buffer.from(savedAssets[0].data, "base64");
  const validation = mfnt.validate(bytes);
  assert.equal(validation.valid, true);
  assert.equal(validation.font.formatId, mfnt.FORMAT_VLSB);
  assert.equal(validation.font.glyphSize, 3 * Math.ceil(10 / 8));
  dom.window.close();
});
