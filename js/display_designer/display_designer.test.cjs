"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

/**
 * Load the browser module without a DOM. Scene helpers do not create UI until
 * open() is called, so their persistence contract can be tested in Node.
 */
function loadApi() {
  const window = {
    atob: value => Buffer.from(value, "base64").toString("binary"),
    btoa: value => Buffer.from(value, "binary").toString("base64")
  };
  const codecSource = fs.readFileSync(path.join(__dirname, "mfnt_codec.js"), "utf8");
  const bitmapSource = fs.readFileSync(path.join(__dirname, "bitmap_codec.js"), "utf8");
  const compilerSource = fs.readFileSync(path.join(__dirname, "scene_compiler.js"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "display_designer.js"), "utf8");
  const context = {window, atob: window.atob, btoa: window.btoa};
  vm.runInNewContext(codecSource, context);
  vm.runInNewContext(bitmapSource, context);
  vm.runInNewContext(compilerSource, context);
  vm.runInNewContext(source, context);
  return window.ESPIDE_DISPLAY_DESIGNER;
}

test("ships designer artwork as local SVG assets", () => {
  const css = fs.readFileSync(path.join(__dirname, "display_designer.css"), "utf8");
  for (const name of ["brush", "eraser", "trash"]) {
    const fileName = `display_designer_${name}.svg`;
    assert.equal(fs.existsSync(path.join(__dirname, "../../media", fileName)), true);
    assert.match(css, new RegExp(`\\.\\./\\.\\./media/${fileName}`));
  }
});

test("keeps contextual controls outside the fixed display scaling stage", () => {
  const source = fs.readFileSync(path.join(__dirname, "display_designer.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "display_designer.css"), "utf8");

  assert.match(source, /espide-display-designer-stage/);
  assert.match(source, /gridResizeObserver\.observe\(elements\.displayStage\)/);
  assert.match(source,
    /visualViewport\.addEventListener\("resize", scheduleGridRender\)/);
  assert.match(source, /elements\.displayStage\.clientHeight - 20/);
  assert.match(css, /grid-template-rows:\s*auto minmax\(0, 1fr\) 52px/);
  assert.match(css, /\.espide-display-designer-context-controls\s*\{[^}]*height:\s*52px/s);
  assert.match(css, /\.espide-display-designer-brush-size select\s*\{[^}]*margin:\s*0/s);
  assert.match(css, /@media \(max-width:\s*820px\)[\s\S]*min-height:\s*360px/);
  assert.match(css, /@media \(max-width:\s*820px\)[\s\S]*height:\s*96px/);
  assert.match(css, /height:\s*clamp\(360px,\s*70dvh,\s*620px\)/);
  assert.match(css, /\.espide-display-designer-overlay\.is-maximized[^{]*\.espide-display-designer-main\s*\{[^}]*width:\s*100%/s);
});

test("creates a backward-compatible 128x64 monochrome scene", () => {
  const scene = loadApi().createEmptyScene();
  assert.equal(scene.schema, "espide.display-designer");
  assert.equal(scene.version, 1);
  assert.equal(scene.width, 128);
  assert.equal(scene.height, 64);
  assert.equal(scene.mode, "mono");
  assert.equal(scene.layers.length, 0);
  assert.equal(scene.fonts.length, 0);
});

test("creates and normalizes adaptive display scenes without changing the legacy fallback", () => {
  const api = loadApi();
  const created = api.createEmptyScene({width: 400, height: 300});
  assert.equal(created.width, 400);
  assert.equal(created.height, 300);
  assert.equal(created.extensions[api.ADAPTIVE_EXTENSION].width, 400);

  const restored = api.normalizeScene({
    width: 128,
    height: 64,
    extensions: {
      "espide.adaptive-display-v1": {version: 1, width: 400, height: 300}
    },
    layers: [{id: "edge", type: "rect", x: 399, y: 299,
      width: 1, height: 1, filled: true}]
  });
  assert.equal(restored.width, 400);
  assert.equal(restored.height, 300);
  assert.equal(restored.layers[0].x, 399);
  assert.equal(restored.layers[0].y, 299);
});

test("balances integer zoom, available space and readable grid detail", () => {
  const api = loadApi();

  assert.deepEqual(
    JSON.parse(JSON.stringify(api.calculatePreviewScale(1.93, 1))),
    {cssScale: 1.93, physicalScale: 1.93, snapped: false}
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.calculatePreviewScale(1.93, 1.25))),
    {cssScale: 1.93, physicalScale: 2.4125, snapped: false}
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.calculatePreviewScale(7.25, 1))),
    {cssScale: 7, physicalScale: 7, snapped: true}
  );
  assert.equal(api.calculatePreviewScale(2.37, 1).cssScale, 2);
  assert.equal(api.calculatePreviewScale(2.7, 1).cssScale, 2.7);
  assert.equal(api.calculatePreviewScale(0.85, 3).cssScale, 0.85);
  assert.equal(api.gridModeForScale(1.9), "pixel");
  assert.equal(api.gridModeForScale(2), "pixel");
  assert.equal(api.gridModeForScale(0.8), "major");
  assert.equal(api.gridModeForScale(0.3), "none");
});

test("matches the pixel-grid backing store to a scaled mobile viewport", () => {
  const api = loadApi();

  assert.deepEqual(
    JSON.parse(JSON.stringify(api.calculateGridBackingSize(640, 320, 1, 1))),
    {width: 640, height: 320, rasterScale: 1}
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.calculateGridBackingSize(640, 320, 2, 0.625))),
    {width: 800, height: 400, rasterScale: 1.25}
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.calculateGridBackingSize(625.4, 312.7, 3, 0.6))),
    {width: 1126, height: 563, rasterScale: 1.7999999999999998}
  );
});

test("keeps milestone 1 scenes compatible", () => {
  const scene = loadApi().normalizeScene({name: "Saved screen", layers: []});
  assert.equal(scene.name, "Saved screen");
  assert.equal(scene.layers.length, 0);
});

test("normalizes rectangle sizes but preserves off-screen coordinates", () => {
  const scene = loadApi().normalizeScene({
    layers: [
      {id: "same", type: "rect", x: 120, y: 60, width: 99, height: 99,
        radius: 99, filled: true},
      {id: "same", type: "rect", x: -10, y: -20, width: 0, height: 0},
      {id: "ignored", type: "future-shape", x: 1, y: 1}
    ]
  });

  assert.equal(scene.layers.length, 2);
  assert.equal(scene.layers[0].id, "same");
  assert.equal(scene.layers[1].id, "same-2");
  assert.deepEqual(JSON.parse(JSON.stringify(scene.layers[0])), {
    id: "same",
    type: "rect",
    label: "",
    x: 120,
    y: 60,
    width: 99,
    height: 64,
    radius: 32,
    filled: true,
    color: 1,
    bindings: {},
    visible: true
  });
  assert.deepEqual(JSON.parse(JSON.stringify(scene.layers[1])), {
    id: "same-2",
    type: "rect",
    label: "",
    x: -10,
    y: -20,
    width: 1,
    height: 1,
    radius: 0,
    filled: false,
    color: 1,
    bindings: {},
    visible: true
  });
});

test("preserves off-screen line endpoints and keeps IDs unique", () => {
  const scene = loadApi().normalizeScene({
    layers: [
      {id: "shared", type: "rect", x: 1, y: 2, width: 3, height: 4},
      {id: "shared", type: "line", x1: -5, y1: 70, x2: 200, y2: 8,
        strokeWidth: 5}
    ]
  });

  assert.deepEqual(JSON.parse(JSON.stringify(scene.layers[1])), {
    id: "shared-2",
    type: "line",
    label: "",
    x1: -5,
    y1: 70,
    x2: 200,
    y2: 8,
    strokeWidth: 5,
    color: 1,
    bindings: {},
    visible: true
  });
});

test("defaults old shape properties and rejects unsupported line widths", () => {
  const scene = loadApi().normalizeScene({layers: [
    {id: "rect", type: "rect", x: 0, y: 0, width: 8, height: 6},
    {id: "line", type: "line", x1: 1, y1: 2, x2: 3, y2: 4,
      strokeWidth: 4}
  ]});

  assert.equal(scene.layers[0].radius, 0);
  assert.equal(scene.layers[1].strokeWidth, 1);
});

test("normalizes ellipse size without clipping its off-screen extent", () => {
  const scene = loadApi().normalizeScene({
    layers: [
      {id: "ellipse-1", type: "ellipse", x: 126, y: 62, width: 20, height: 20, filled: true}
    ]
  });

  assert.deepEqual(JSON.parse(JSON.stringify(scene.layers[0])), {
    id: "ellipse-1",
    type: "ellipse",
    label: "",
    x: 126,
    y: 62,
    width: 20,
    height: 20,
    filled: true,
    color: 1,
    bindings: {},
    visible: true
  });
});

test("keeps one valid embedded MFNT asset and removes broken font data", () => {
  const mfnt = require("./mfnt_codec.js");
  const bytes = mfnt.createBlankFont(8, 8, mfnt.FORMAT_HLSB);
  const data = Buffer.from(bytes).toString("base64");
  const scene = loadApi().normalizeScene({
    fonts: [
      {id: "font-1", name: "Tiny", fileName: "tiny.mfnt", data},
      {id: "broken", name: "Broken", data: "bm90LWEtZm9udA=="}
    ]
  });

  assert.equal(scene.fonts.length, 1);
  assert.equal(scene.fonts[0].id, "font-1");
  assert.equal(scene.fonts[0].fileName, "tiny.mfnt");
  assert.equal(scene.fonts[0].data, data);
});

test("normalizes text layers against their embedded MFNT metrics", () => {
  const mfnt = require("./mfnt_codec.js");
  const bytes = mfnt.createBlankFont(5, 8, mfnt.FORMAT_HLSB);
  const data = Buffer.from(bytes).toString("base64");
  const scene = loadApi().normalizeScene({
    fonts: [{
      id: "builtin-font-5x8",
      name: "Font 5×8",
      fileName: "font_5x8.mfnt",
      source: "builtin",
      catalogId: "font-5x8",
      data
    }],
    layers: [{
      id: "text-1",
      type: "text",
      x: 125,
      y: 62,
      text: "ABC",
      fontId: "builtin-font-5x8",
      inverted: true
    }]
  });

  assert.equal(scene.fonts[0].source, "builtin");
  assert.equal(scene.fonts[0].catalogId, "font-5x8");
  assert.deepEqual(JSON.parse(JSON.stringify(scene.layers[0])), {
    id: "text-1",
    type: "text",
    label: "",
    x: 125,
    y: 62,
    width: 17,
    height: 8,
    text: "ABC",
    fontId: "builtin-font-5x8",
    color: 0,
    parameterId: null,
    bindings: {},
    visible: true
  });
});

test("keeps complete bounds for text wider than the display", () => {
  const mfnt = require("./mfnt_codec.js");
  const bytes = mfnt.createBlankFont(5, 8, mfnt.FORMAT_HLSB);
  const data = Buffer.from(bytes).toString("base64");
  const scene = loadApi().normalizeScene({
    fonts: [{id: "wide-font", name: "Wide", fileName: "wide.mfnt", data}],
    layers: [{
      id: "wide-text",
      type: "text",
      x: -60,
      y: 2,
      text: "A".repeat(40),
      fontId: "wide-font"
    }]
  });

  assert.equal(scene.layers[0].width, 239,
      "40 five-pixel glyphs and 39 one-pixel gaps stay in the hit bounds");
  assert.equal(scene.layers[0].height, 8);
});

test("keeps layer visibility and defaults older layers to visible", () => {
  const scene = loadApi().normalizeScene({
    layers: [
      {id: "old", type: "rect", x: 0, y: 0, width: 4, height: 4},
      {id: "hidden", type: "line", x1: 0, y1: 0, x2: 3, y2: 3, visible: false}
    ]
  });

  assert.equal(scene.layers[0].visible, true);
  assert.equal(scene.layers[1].visible, false);
});

test("normalizes embedded MONO_HLSB bitmap layers", () => {
  const bitmap = require("./bitmap_codec.js");
  const bytes = bitmap.pack(Uint8Array.from([
    1, 0, 1,
    0, 1, 0
  ]), 3, 2);
  const scene = loadApi().normalizeScene({layers: [{
    id: "bitmap-1",
    type: "bitmap",
    x: 2,
    y: 3,
    width: 3,
    height: 2,
    name: "icon.png",
    format: "mono-hlsb",
    data: Buffer.from(bytes).toString("base64"),
    color: 1,
    bindings: {},
    visible: false
  }]});

  assert.deepEqual(JSON.parse(JSON.stringify(scene.layers[0])), {
    id: "bitmap-1",
    type: "bitmap",
    label: "",
    x: 2,
    y: 3,
    width: 3,
    height: 2,
    name: "icon.png",
    format: "mono-hlsb",
    data: Buffer.from(bytes).toString("base64"),
    color: 1,
    transparent: true,
    bindings: {},
    visible: false
  });
});

test("clears non-pixel padding bits in imported bitmap rows", () => {
  const scene = loadApi().normalizeScene({layers: [{
    id: "dirty-padding",
    type: "bitmap",
    x: 0,
    y: 0,
    width: 5,
    height: 2,
    format: "mono-hlsb",
    data: Buffer.from([0xff, 0xff]).toString("base64")
  }]});

  assert.deepEqual(
      Array.from(Buffer.from(scene.layers[0].data, "base64")),
      [0x1f, 0x1f]);
});

test("preserves a bitmap that is partially outside the display", () => {
  const bitmap = require("./bitmap_codec.js");
  const bytes = bitmap.pack(Uint8Array.from([
    1, 0, 1,
    0, 1, 0
  ]), 3, 2);
  const scene = loadApi().normalizeScene({layers: [{
    id: "outside", type: "bitmap", x: -2, y: 63, width: 3, height: 2,
    name: "outside.png", format: "mono-hlsb",
    data: Buffer.from(bytes).toString("base64")
  }]});

  assert.equal(scene.layers[0].x, -2);
  assert.equal(scene.layers[0].y, 63);
  assert.equal(scene.layers[0].width, 3);
  assert.equal(scene.layers[0].height, 2);
  assert.equal(scene.layers[0].data, Buffer.from(bytes).toString("base64"));
});

test("preserves opaque black pixels for bitmap layers", () => {
  const bitmap = require("./bitmap_codec.js");
  const bytes = bitmap.pack(Uint8Array.from([1, 0, 0, 1]), 2, 2);
  const scene = loadApi().normalizeScene({layers: [{
    id: "opaque", type: "bitmap", x: 0, y: 0, width: 2, height: 2,
    name: "opaque.png", format: "mono-hlsb",
    data: Buffer.from(bytes).toString("base64"), transparent: false
  }]});

  assert.equal(scene.layers[0].transparent, false);
});

test("keeps drawing storage full-screen while preserving its movable offset", () => {
  const bitmap = require("./bitmap_codec.js");
  const bytes = new Uint8Array(bitmap.byteLength(128, 64));
  bitmap.setPixel(bytes, 128, 12, 7, 1);
  const scene = loadApi().normalizeScene({layers: [{
    id: "drawing-1", type: "bitmap", kind: "drawing",
    x: 20, y: 20, width: 128, height: 64,
    name: "Drawing", format: "mono-hlsb",
    data: Buffer.from(bytes).toString("base64"), transparent: false,
    bindings: {x: true, y: true, visible: true}
  }]});

  assert.equal(scene.layers[0].kind, "drawing");
  assert.equal(scene.layers[0].x, 20);
  assert.equal(scene.layers[0].y, 20);
  assert.equal(scene.layers[0].width, 128);
  assert.equal(scene.layers[0].height, 64);
  assert.equal(scene.layers[0].transparent, true);
  assert.equal(Buffer.from(scene.layers[0].blackData, "base64").every(
      value => value === 0), true);
  assert.deepEqual(JSON.parse(JSON.stringify(scene.layers[0].bindings)),
      {visible: true});
});

test("drops malformed bitmap layers", () => {
  const scene = loadApi().normalizeScene({layers: [{
    id: "broken", type: "bitmap", x: 0, y: 0, width: 16, height: 16,
    data: "AA=="
  }]});
  assert.equal(scene.layers.length, 0);
});

test("preserves a safe future text parameter binding", () => {
  const mfnt = require("./mfnt_codec.js");
  const data = Buffer.from(mfnt.createBlankFont(5, 8, mfnt.FORMAT_HLSB)).toString("base64");
  const scene = loadApi().normalizeScene({
    fonts: [{id: "font-1", name: "Tiny", fileName: "tiny.mfnt", data}],
    layers: [{
      id: "text-1", type: "text", x: 0, y: 0, text: "Value",
      fontId: "font-1", parameterId: "temperature value!"
    }]
  });
  assert.equal(scene.layers[0].parameterId, "temperaturevalue");
  assert.equal(scene.layers[0].bindings.text, true);
});

test("keeps optional dynamic bindings disabled by default and normalizes enabled ones", () => {
  const scene = loadApi().normalizeScene({
    layers: [
      {id: "static", type: "rect", x: 1, y: 2, width: 3, height: 4},
      {id: "dynamic", type: "rect", x: 5, y: 6, width: 7, height: 8,
        bindings: {x: true, y: false, visible: true, width: true}}
    ]
  });

  assert.deepEqual(JSON.parse(JSON.stringify(scene.layers[0].bindings)), {});
  assert.deepEqual(JSON.parse(JSON.stringify(scene.layers[1].bindings)), {
    x: true,
    visible: true
  });
});

test("drops text layers whose font asset is missing or invalid", () => {
  const scene = loadApi().normalizeScene({
    fonts: [],
    layers: [{id: "text-1", type: "text", x: 0, y: 0, text: "Lost", fontId: "missing"}]
  });
  assert.equal(scene.layers.length, 0);
});

test("builds one ordered scene.dat when any scene enables file storage", () => {
  const api = loadApi();
  function block(id, enabled, x) {
    return {
      id,
      type: "espide_display_designer",
      getFieldValue: name => name === "STORE_SCENE_FILE" && enabled ? "TRUE" : "FALSE",
      getDisplayDesignerScene: () => ({
        fonts: [],
        layers: [{id: "pixel", type: "rect", x, y: 0, width: 1, height: 1,
          filled: true, visible: true}]
      })
    };
  }
  const workspace = {
    getAllBlocks: () => [block("scene-b", true, 1), block("scene-a", false, 0)]
  };
  const assets = api.buildRunAssets(workspace);

  assert.equal(assets.enabled, true);
  assert.deepEqual(assets.entries.map(entry => entry.block.id), ["scene-a", "scene-b"]);
  assert.equal(assets.files[0].path, "/gfx/scene.dat");
  assert.equal(assets.files[0].bytes.length, 16 + 2 * 1024);
  assert.equal(assets.files[0].bytes[16], 1);
  assert.equal(assets.files[0].bytes[16 + 1024 + 1], 1);
});

test("uploads MFNT runtime assets for dynamic text without scene.dat mode", () => {
  const api = loadApi();
  const mfnt = require("./mfnt_codec.js");
  const data = Buffer.from(
      mfnt.createBlankFont(5, 8, mfnt.FORMAT_HLSB)).toString("base64");
  const block = {
    id: "dynamic-text-scene",
    type: "espide_display_designer",
    getFieldValue: () => "FALSE",
    getDisplayDesignerScene: () => ({
      fonts: [{id: "font", fileName: "font_5x8.mfnt", data,
        source: "builtin", catalogId: "font-5x8"}],
      layers: [{id: "value", type: "text", x: 0, y: 0, text: "Value",
        fontId: "font", bindings: {text: true}, visible: true}]
    })
  };
  const assets = api.buildRunAssets({getAllBlocks: () => [block]});

  assert.equal(assets.enabled, true);
  assert.equal(assets.sceneFileEnabled, false);
  assert.equal(assets.pack, null);
  assert.deepEqual(Array.from(assets.files, file => file.path), [
    "/gfx/font_5x8.mfnt"
  ]);
});
